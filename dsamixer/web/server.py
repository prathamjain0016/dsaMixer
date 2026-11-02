"""FastAPI app: JSON API under /api, the board UI at /."""
import json
from contextlib import contextmanager
from datetime import timedelta
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from ..core import config, db
from ..integrations import ai_planner
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
        planner.plan_day(c, planner.today())


# ---------- days & board ----------

@app.get("/api/day/{day}")
def get_day(day: str):
    with conn() as c:
        # Only today and tomorrow get planned on view; planning further out would
        # lock in questions before you've logged the days in between.
        tomorrow = (planner.d(planner.today()) + timedelta(days=1)).isoformat()
        if day == planner.today():
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


@app.delete("/api/contests/{cid}")
def delete_contest(cid: int):
    with conn() as c:
        c.execute("DELETE FROM contests WHERE id=?", (cid,))
        c.commit()
    return list_contests()


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
    with conn() as c:
        config.save(c, cfg)
        return config.load(c)


app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")
