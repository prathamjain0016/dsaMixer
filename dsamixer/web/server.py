"""FastAPI app: JSON API under /api, the board UI at /."""
import json
import threading
from contextlib import contextmanager
from datetime import timedelta
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from ..core import config, db
from ..integrations import ai_planner, leetcode
from ..planning import planner, stats

STATIC = Path(__file__).resolve().parent / "static"
app = FastAPI(title="dsaMixer")


@contextmanager
def conn():
    c = db.connect()
    try:
        yield c
    finally:
        c.close()


@app.on_event("startup")
def startup():
    with conn() as c:
        db.init(c)
        if db.get_setting(c, "setup_done"):  # a fresh install is planned by the setup wizard instead
            planner.plan_day(c, planner.today())
    # Best-effort and off the startup path, so a dead network never blocks or crashes the board.
    threading.Thread(target=_startup_contest_sync, daemon=True).start()


def _startup_contest_sync():
    try:
        with conn() as c:
            leetcode.sync_quietly(c)
            leetcode.sync_profile_quietly(c)
    except Exception:
        leetcode.log.exception("startup LeetCode sync crashed")


# ---------- first-run setup ----------

class SetupClass(BaseModel):
    day: str
    start: str = "08:00"
    minutes: int


class SetupAI(BaseModel):
    enabled: bool
    timezone: str | None = None
    classes: list[SetupClass] = []
    homework_hours: float = 0


class SetupKnight(BaseModel):
    badge: str = "Knight"
    target_rating: int | None = None  # None = the badge preset
    deadline: str | None = None


class SetupLeetCode(BaseModel):
    username: str | None = None


class SetupContests(BaseModel):
    live_from_week: int = 5


class SetupBody(BaseModel):
    start_date: str
    dsa_minutes: int
    rest_days: list[str]
    mix: str  # "hme" (Hard+Medium+Easy) or "me" (Medium+Easy)
    ai: SetupAI
    knight: SetupKnight
    contests: SetupContests
    leetcode: SetupLeetCode | None = None


@app.get("/api/setup")
def get_setup():
    """`needed` is true until the wizard has run; `defaults` are the prefilled answers
    (the current config's values, so re-running setup starts from what you have)."""
    with conn() as c:
        saved = db.get_setting(c, "config", {}) or {}
        return {"needed": not db.get_setting(c, "setup_done"), "defaults": config.setup_answers(config.load(c), saved)}


@app.post("/api/setup")
def post_setup(body: SetupBody):
    if body.mix not in ("hme", "me"):
        raise HTTPException(400, "mix must be 'hme' or 'me'")
    with conn() as c:
        try:
            cfg = config.from_setup(db.get_setting(c, "config", {}) or {}, body.model_dump())
        except (ValueError, KeyError, TypeError) as e:
            raise HTTPException(400, f"Invalid setup: {e}")
        db.set_setting(c, "config", cfg)
        config.mark_setup(c, planner.today())
        c.commit()
        planner.plan_day(c, planner.today())
    return {"ok": True, "today": planner.today()}


# ---------- days & board ----------

@app.get("/api/day/{day}")
def get_day(day: str):
    with conn() as c:
        # Only today and tomorrow get planned on view; planning further out would
        # lock in questions before you've logged the days in between.
        tomorrow = (planner.d(planner.today()) + timedelta(days=1)).isoformat()
        if not db.get_setting(c, "setup_done"):
            pass  # the setup wizard plans the first day with your answers
        elif day == planner.today():
            planner.plan_day(c, day)
        elif day == tomorrow and c.execute(
            "SELECT 1 FROM days WHERE date=? AND closed_at IS NOT NULL", (planner.today(),)
        ).fetchone():
            planner.plan_day(c, day)
        cfg = config.load(c)
        tickets = db.rows(c.execute(
            """SELECT t.*, q.difficulty, q.pattern, q.url, q.section FROM tickets t
               LEFT JOIN questions q ON q.num=t.question_num WHERE t.date=? ORDER BY t.position""", (day,)
        ))
        info = c.execute("SELECT * FROM days WHERE date=?", (day,)).fetchone()
        return {
            "date": day,
            "weekday": planner.weekday_key(day),
            "sprint": planner.week_no(cfg, day),
            "is_buffer": planner.weekday_key(day) == cfg["buffer_day"],
            "day": dict(info) if info else None,
            "tickets": tickets,
            "dsa_budget": cfg["dsa_minutes"].get(planner.weekday_key(day), 0),
        }


@app.get("/api/week/{day}")
def get_week(day: str):
    """Read-only: never plans a day."""
    with conn() as c:
        cfg = config.load(c)
        monday = planner.d(day) - timedelta(days=planner.d(day).weekday())
        dates = [(monday + timedelta(days=i)).isoformat() for i in range(7)]
        return stats.week(c, cfg, day, ai_planner.capacity(cfg, dates))


class CloseDay(BaseModel):
    energy: int | None = None
    ai_topics: str | None = None
    notes: str | None = None


@app.post("/api/day/{day}/close")
def close_day(day: str, body: CloseDay):
    with conn() as c:
        tomorrow = planner.close_day(c, day, body.energy, body.ai_topics, body.notes)
    return get_day(tomorrow)


@app.post("/api/day/{day}/replan")
def replan(day: str):
    with conn() as c:
        planner.replan_day(c, day)
    return get_day(day)


@app.post("/api/day/{day}/pull")
def pull(day: str):
    with conn() as c:
        if not planner.pull_next(c, day):
            raise HTTPException(404, "No questions left — all done!")
    return get_day(day)


class TicketPatch(BaseModel):
    status: str | None = None
    position: int | None = None
    date: str | None = None
    title: str | None = None
    est_minutes: int | None = None
    result: str | None = None
    minutes_spent: int | None = None
    confidence: int | None = None
    note: str | None = None
    link: str | None = None


@app.patch("/api/tickets/{tid}")
def patch_ticket(tid: int, body: TicketPatch):
    with conn() as c:
        t = planner.update_ticket(c, tid, body.model_dump(exclude_unset=True))
    if not t:
        raise HTTPException(404)
    return t


class NewTicket(BaseModel):
    date: str
    title: str
    kind: str = "custom"
    est_minutes: int = 30
    detail: str | None = None


@app.post("/api/tickets")
def create_ticket(body: NewTicket):
    with conn() as c:
        cfg = config.load(c)
        planner._add(c, body.date, planner.ensure_sprint(c, cfg, body.date), body.kind, body.title,
                     body.est_minutes, body.detail)
        c.commit()
    return get_day(body.date)


@app.delete("/api/tickets/{tid}")
def delete_ticket(tid: int):
    with conn() as c:
        c.execute("DELETE FROM tickets WHERE id=?", (tid,))
        c.commit()
    return {"ok": True}


# ---------- sprint, stats ----------

@app.get("/api/sprint/{sid}")
def get_sprint(sid: str):
    with conn() as c:
        cfg = config.load(c)
        n = planner.ensure_sprint(c, cfg, planner.today()) if sid == "current" else int(sid)
        c.commit()
        return {**stats.sprint(c, n), "current": planner.week_no(cfg, planner.today())}


class SprintPatch(BaseModel):
    goal: str | None = None
    retro: str | None = None


@app.patch("/api/sprint/{sid}")
def patch_sprint(sid: int, body: SprintPatch):
    fields = body.model_dump(exclude_unset=True)
    with conn() as c:
        if fields:
            c.execute(f"UPDATE sprints SET {', '.join(f'{k}=?' for k in fields)} WHERE id=?", (*fields.values(), sid))
            c.commit()
    return get_sprint(str(sid))


@app.get("/api/stats")
def get_stats():
    with conn() as c:
        return stats.build(c)


# ---------- questions ----------

@app.get("/api/questions")
def get_questions():
    with conn() as c:
        return db.rows(c.execute("SELECT * FROM questions q JOIN progress p USING(num) ORDER BY num"))


# ---------- contests ----------

class Contest(BaseModel):
    date: str
    name: str
    kind: str
    q_solved: list[bool] = [False, False, False, False]
    rank: int | None = None
    rating: int | None = None
    notes: str | None = None


@app.get("/api/contests")
def list_contests():
    with conn() as c:
        out = db.rows(c.execute("SELECT * FROM contests ORDER BY date DESC, id DESC"))
    for r in out:
        r["q_solved"] = json.loads(r["q_solved"] or "[]")
    return out


@app.post("/api/contests")
def add_contest(body: Contest):
    data = body.model_dump()
    with conn() as c:
        c.execute(
            "INSERT INTO contests(date,name,kind,solved,q_solved,rank,rating,notes) VALUES(?,?,?,?,?,?,?,?)",
            (data["date"], data["name"], data["kind"], sum(data["q_solved"]), json.dumps(data["q_solved"]),
             data["rank"], data["rating"], data["notes"]),
        )
        c.commit()
        planner.add_upsolve(c, data)
    return list_contests()


@app.get("/api/contests/upcoming")
def upcoming_contests():
    """The cached LeetCode schedule. Read-only: never fetches."""
    with conn() as c:
        cfg = config.load(c)
        out = [{**x, "mode": planner.contest_mode(cfg, x["kind"], x["date"])} for x in leetcode.get_cache(c)]
        return {"contests": out, "synced_at": db.get_setting(c, "leetcode_synced_at")}


@app.post("/api/contests/sync")
def sync_contests():
    with conn() as c:
        try:
            res = leetcode.sync(c)
        except leetcode.LeetCodeError as e:
            raise HTTPException(502, str(e))
    return {**res, **upcoming_contests()}


@app.delete("/api/contests/{cid}")
def delete_contest(cid: int):
    with conn() as c:
        c.execute("DELETE FROM contests WHERE id=?", (cid,))
        c.commit()
    return list_contests()


# ---------- LeetCode profile, suggestions, friends ----------

def _lc_error(e: "leetcode.LeetCodeError"):
    return HTTPException(404 if isinstance(e, leetcode.UserNotFound) else 502, str(e))


def _profile_payload(c) -> dict:
    user = leetcode.username(c)
    p = leetcode.get_profile(c)
    if p and (not user or p.get("username", "").lower() != user.lower()):
        p = None  # cached for a username that is no longer configured
    return {"username": user, "profile": p, "suggestions": leetcode.get_suggestions(c)}


@app.get("/api/leetcode/profile")
def lc_profile():
    """Cached. Never fetches."""
    with conn() as c:
        return _profile_payload(c)


@app.post("/api/leetcode/sync")
def lc_sync():
    with conn() as c:
        if not leetcode.username(c):
            raise HTTPException(400, "No LeetCode username set. Add one in Settings > LeetCode.")
        try:
            res = leetcode.sync_profile(c)
        except leetcode.LeetCodeError as e:
            raise _lc_error(e)
        return {**_profile_payload(c), "contests_added": res["contests_added"]}


@app.get("/api/leetcode/friends")
def lc_friends(refresh: int = 0):
    """Your friends (6-hour cache; ?refresh=1 re-fetches) plus your own row from your synced profile."""
    with conn() as c:
        friends = leetcode.fetch_friends(c, force=bool(refresh))
        me = _profile_payload(c)["profile"]
        rows = ([{**leetcode._summary(me), "me": True, "error": None}] if me else []) + friends
        return {"username": leetcode.username(c), "rows": rows}


@app.post("/api/leetcode/suggestions/accept-all")
def lc_accept_all():
    with conn() as c:
        nums = [s["num"] for s in leetcode.get_suggestions(c)]
        for n in nums:
            leetcode.accept_suggestion(c, n)
        return {**_profile_payload(c), "accepted": nums}


@app.post("/api/leetcode/suggestions/{num}/accept")
def lc_accept(num: int):
    with conn() as c:
        if num not in {s["num"] for s in leetcode.get_suggestions(c)}:
            raise HTTPException(404, f"Q{num} isn't an open suggestion")
        ticket = leetcode.accept_suggestion(c, num)
        return {**_profile_payload(c), "ticket": ticket}


@app.post("/api/leetcode/suggestions/{num}/dismiss")
def lc_dismiss(num: int):
    with conn() as c:
        leetcode.dismiss_suggestion(c, num)
        return _profile_payload(c)


# ---------- AI syllabus ----------

@app.get("/api/ai-modules")
def list_modules():
    with conn() as c:
        return db.rows(c.execute("SELECT * FROM ai_modules ORDER BY position"))


class ModuleImport(BaseModel):
    text: str  # one module per line


@app.post("/api/ai-modules/import")
def import_modules(body: ModuleImport):
    lines = [l.strip(" -•\t") for l in body.text.splitlines() if l.strip(" -•\t")]
    with conn() as c:
        start = c.execute("SELECT COALESCE(MAX(position),0) FROM ai_modules").fetchone()[0]
        c.executemany("INSERT INTO ai_modules(position,title) VALUES(?,?)",
                      [(start + i + 1, t) for i, t in enumerate(lines)])
        c.commit()
    return list_modules()


class ModulePatch(BaseModel):
    status: str | None = None
    title: str | None = None
    notes: str | None = None


@app.patch("/api/ai-modules/{mid}")
def patch_module(mid: int, body: ModulePatch):
    fields = body.model_dump(exclude_unset=True)
    with conn() as c:
        if fields:
            c.execute(f"UPDATE ai_modules SET {', '.join(f'{k}=?' for k in fields)} WHERE id=?",
                      (*fields.values(), mid))
            c.commit()
    return list_modules()


@app.delete("/api/ai-modules/{mid}")
def delete_module(mid: int):
    with conn() as c:
        c.execute("DELETE FROM ai_modules WHERE id=?", (mid,))
        c.commit()
    return list_modules()


# ---------- weekly AI plan ----------

@app.get("/api/ai-week")
def ai_week():
    with conn() as c:
        cfg = config.load(c)
        days = ai_planner.plan_days(cfg)
        week_start = (planner.d(days[0]) - timedelta(days=planner.d(days[0]).weekday())).isoformat() if days else None
        plan = c.execute("SELECT * FROM ai_week_plans WHERE week_start=?", (week_start,)).fetchone()
        return {
            "days": days,
            "capacity": ai_planner.capacity(cfg, days),
            "model": ai_planner.model_name(cfg),
            "provider": ai_planner.provider(cfg),
            "key_configured": ai_planner.api_key_configured(),
            "plan": dict(plan) if plan else None,
        }


class WeekGoals(BaseModel):
    goals: str


@app.post("/api/ai-week/preview")
def ai_week_preview(body: WeekGoals):
    if not body.goals.strip():
        raise HTTPException(400, "Describe your goals for the week first.")
    with conn() as c:
        try:
            return ai_planner.preview(c, body.goals)
        except ai_planner.PlannerError as e:
            raise HTTPException(e.status, str(e))


class WeekTask(BaseModel):
    goal: str
    title: str
    minutes: int
    date: str


class WeekApply(BaseModel):
    goals: str
    summary: str | None = None
    tasks: list[WeekTask]


@app.post("/api/ai-week/apply")
def ai_week_apply(body: WeekApply):
    if not body.tasks:
        raise HTTPException(400, "No tasks to add.")
    with conn() as c:
        n = ai_planner.apply(c, body.goals, body.summary, [t.model_dump() for t in body.tasks])
    return {"added": n}


# ---------- settings ----------

@app.get("/api/settings")
def get_settings():
    with conn() as c:
        return config.load(c)


@app.put("/api/settings")
def put_settings(cfg: dict):
    if isinstance(cfg.get("leetcode"), dict):
        cfg["leetcode"] = config.clean_leetcode(cfg["leetcode"])
    errs = config.validate({k: cfg[k] for k in ("knight", "leetcode") if k in cfg})
    if errs:
        raise HTTPException(400, "; ".join(errs))
    with conn() as c:
        config.save(c, cfg)
        return config.load(c)


class _RevalidatedStatic(StaticFiles):
    """Make browsers re-check the UI files on every load (a cheap 304 when unchanged), so an update
    shows up on a normal refresh instead of running stale cached JS modules."""

    async def get_response(self, path, scope):
        res = await super().get_response(path, scope)
        res.headers["Cache-Control"] = "no-cache"
        return res


app.mount("/static", _RevalidatedStatic(directory=STATIC), name="static")


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html", headers={"Cache-Control": "no-cache"})
