"""Daily planning, carry-over, spaced repetition and contest scheduling.

The cycle: you close a day -> its unfinished cards roll into tomorrow ->
tomorrow is filled up to its DSA budget with due reviews and the next
questions from the list (in pattern order) -> AI and contest cards are
added from the weekly template.
"""
import json
from datetime import date, timedelta

from ..core import config, db

DSA_KINDS = ("dsa", "review", "upsolve")


def d(s: str) -> date:
    return date.fromisoformat(s)


def today() -> str:
    return date.today().isoformat()


def weekday_key(day: str) -> str:
    return config.WEEKDAYS[d(day).weekday()]


def week_no(cfg, day: str) -> int:
    return (d(day) - d(cfg["start_date"])).days // 7 + 1


def ensure_sprint(conn, cfg, day: str) -> int:
    n = max(week_no(cfg, day), 1)
    start = d(cfg["start_date"]) + timedelta(weeks=n - 1)
    conn.execute(
        "INSERT INTO sprints(id,start_date,end_date) VALUES(?,?,?) ON CONFLICT(id) DO NOTHING",
        (n, start.isoformat(), (start + timedelta(days=6)).isoformat()),
    )
    return n


def current_ai_module(conn):
    return conn.execute(
        "SELECT * FROM ai_modules WHERE status!='done' ORDER BY status='in_progress' DESC, position LIMIT 1"
    ).fetchone()


def _add(conn, day, sprint, kind, title, minutes, detail=None, question_num=None, source=None):
    pos = conn.execute("SELECT COALESCE(MAX(position),0)+1 FROM tickets WHERE date=?", (day,)).fetchone()[0]
    return conn.execute(
        "INSERT INTO tickets(date,sprint_id,kind,title,detail,question_num,est_minutes,position,source) "
        "VALUES(?,?,?,?,?,?,?,?,?) RETURNING id",
        (day, sprint, kind, title, detail, question_num, minutes, pos, source),
    ).fetchone()[0]


def has_ai_plan(conn, day: str) -> bool:
    """True when an applied weekly AI plan covers this day (the generic AI cards are then skipped)."""
    week_start = (d(day) - timedelta(days=d(day).weekday())).isoformat()
    row = conn.execute("SELECT days FROM ai_week_plans WHERE week_start=?", (week_start,)).fetchone()
    return bool(row) and day in json.loads(row["days"])


def contest_for(cfg, day: str):
    """Return (title, detail, live) for a contest on this day, or None."""
    c, wk, wd = cfg["contests"], week_no(cfg, day), weekday_key(day)
    if wd == "sun":
        if wk <= c["virtual_until_week"]:
            return ("Virtual contest (any past Weekly)", "90 min timer, no peeking. Log it in Contests.", False)
        if wk >= c["weekly_live_from_week"]:
            if c["weekly_live"]:
                return ("LeetCode Weekly — LIVE 8:00 AM IST", "Rated. Watch today's class recording after.", True)
            return ("Virtual Weekly (after class)", "Do this week's Weekly as a virtual contest.", False)
    if wd == "sat" and wk >= c["biweekly_live_from_week"]:
        if (d(day) - d(c["biweekly_anchor"])).days % 14 == 0:
            return ("LeetCode Biweekly — LIVE 8:00 PM IST", "Rated.", True)
    return None


def _carry_over(conn, day, sprint):
    stale = db.rows(conn.execute(
        "SELECT * FROM tickets WHERE date<? AND status IN ('todo','doing')", (day,)
    ))
    for t in stale:
        if t["kind"] == "contest" and "LIVE" in t["title"]:
            conn.execute("UPDATE tickets SET status='skipped', note=COALESCE(note,'missed') WHERE id=?", (t["id"],))
            continue
        pos = conn.execute("SELECT COALESCE(MAX(position),0)+1 FROM tickets WHERE date=?", (day,)).fetchone()[0]
        conn.execute(
            "UPDATE tickets SET date=?, sprint_id=?, carried=carried+1, status='todo', position=? WHERE id=?",
            (day, sprint, pos, t["id"]),
        )


def _due_reviews(conn, cfg, day, limit=None):
    return db.rows(conn.execute(
        """SELECT q.* FROM progress p JOIN questions q USING(num)
           WHERE p.status='learning' AND p.next_review<=?
             AND NOT EXISTS (SELECT 1 FROM tickets t WHERE t.question_num=q.num
                             AND t.kind='review' AND t.status IN ('todo','doing'))
           ORDER BY p.next_review, q.num LIMIT ?""",
        (day, limit if limit is not None else cfg["max_reviews_per_day"]),
    ))


def next_new_questions(conn, limit=None):
    sql = """SELECT q.* FROM questions q JOIN progress p USING(num)
             WHERE p.status='new'
               AND NOT EXISTS (SELECT 1 FROM tickets t WHERE t.question_num=q.num
                               AND t.kind='dsa' AND t.status IN ('todo','doing','done'))
             ORDER BY q.num"""
    if limit:
        sql += f" LIMIT {int(limit)}"
    return db.rows(conn.execute(sql))


def add_question_ticket(conn, cfg, day, sprint, q):
    _add(conn, day, sprint, "dsa", f"Q{q['num']}. {q['title']}", cfg["est_minutes"][q["difficulty"]],
         detail=f"{q['section']} › {q['subtopic']}", question_num=q["num"])


# ---------- topic mixing: each day = one question per difficulty slot, all from different topics ----------

def rotation_cycle(sections, weights):
    """Smooth weighted round-robin, so a weight-2 topic appears twice per cycle but spread out."""
    w = {s: weights.get(s, 1) for s in sections}
    current = {s: 0 for s in sections}
    out = []
    for _ in range(sum(w.values())):
        for s in sections:
            current[s] += w[s]
        pick = max(sections, key=lambda s: current[s])
        current[pick] -= sum(w.values())
        out.append(pick)
    return out


def _open_dsa_today(conn, day):
    return db.rows(conn.execute(
        """SELECT q.section, q.difficulty FROM tickets t JOIN questions q ON q.num=t.question_num
           WHERE t.date=? AND t.kind='dsa' AND t.status IN ('todo','doing')""", (day,)
    ))


def _pick_mixed(conn, cfg, day, slots, budget=None, fill_from_open=True):
    """For each difficulty in `slots`, take the next question of that difficulty from the next
    topic in the weighted rotation that isn't already on today's board. With `budget`, stop once
    the next pick wouldn't fit. With `fill_from_open`, today's open cards count toward their slot."""
    mix = cfg["mix"]
    pool = next_new_questions(conn)
    if not pool or not slots:
        return []
    by_section = {}
    for q in pool:
        by_section.setdefault(q["section"], []).append(q)
    sections = sorted(by_section, key=lambda s: by_section[s][0]["num"])
    cycle = rotation_cycle(sections, mix["rotation_weights"])
    pos = db.get_setting(conn, "rotation_pos", 0) % len(cycle)

    carried = _open_dsa_today(conn, day)
    used = {r["section"] for r in carried}
    slots = list(slots)
    for r in carried if fill_from_open else []:  # carried cards already fill their difficulty slot
        if r["difficulty"] in slots:
            slots.remove(r["difficulty"])

    picks, spent = [], 0
    for diff in slots:
        choice = None
        # Prefer an unused topic with this difficulty; then any unused topic; then any topic.
        for want_diff, allow_used in ((diff, False), (None, False), (None, True)):
            for i in range(len(cycle)):
                sec = cycle[(pos + i) % len(cycle)]
                if sec in used and not allow_used:
                    continue
                q = next((q for q in by_section[sec] if want_diff in (None, q["difficulty"])), None)
                if q:
                    choice = (q, (pos + i + 1) % len(cycle))
                    break
            if choice:
                break
        if not choice:
            break
        q, next_pos = choice
        c = cfg["est_minutes"][q["difficulty"]]
        if budget is not None and spent + c > budget:
            break
        by_section[q["section"]].remove(q)
        used.add(q["section"])
        picks.append(q)
        spent += c
        pos = next_pos
    db.set_setting(conn, "rotation_pos", pos)
    return picks


def plan_day(conn, day: str, force=False) -> None:
    cfg = config.load(conn)
    row = conn.execute("SELECT planned_at FROM days WHERE date=?", (day,)).fetchone()
    if row and row["planned_at"] and not force:
        return
    if d(day) < d(cfg["start_date"]):
        return
    sprint = ensure_sprint(conn, cfg, day)
    wd = weekday_key(day)
    _carry_over(conn, day, sprint)

    existing = {t["title"] for t in db.rows(conn.execute("SELECT title FROM tickets WHERE date=?", (day,)))}

    contest = contest_for(cfg, day)
    module = current_ai_module(conn)
    for item in [] if has_ai_plan(conn, day) else cfg["ai_template"].get(wd, []):
        title = item["title"]
        if contest and contest[2] and wd == "sun" and "class" in title.lower():
            title += " (recording — contest clash)"
        if title not in existing:
            _add(conn, day, sprint, "ai", title, item["minutes"], detail=module["title"] if module else None)
    if contest and contest[0] not in existing:
        _add(conn, day, sprint, "contest", contest[0], cfg["contests"]["minutes"], detail=contest[1])
    if wd == cfg["buffer_day"] and "Sprint retro" not in existing:
        _add(conn, day, sprint, "retro", "Sprint retro", 15, detail="Review the sprint tab, note what to change.")

    # Fill the DSA budget: carried DSA work first, then due reviews, then new questions.
    budget = cfg["dsa_minutes"].get(wd, 0)
    budget -= conn.execute(
        f"SELECT COALESCE(SUM(est_minutes),0) FROM tickets WHERE date=? AND status IN ('todo','doing') "
        f"AND kind IN ({','.join('?' * len(DSA_KINDS))})", (day, *DSA_KINDS),
    ).fetchone()[0]
    mix = cfg["mix"]
    if mix["enabled"]:
        # Today's difficulty mix (e.g. Hard + Medium + Easy, three different topics), then reviews
        # in what's left (at least one), then extra questions if there is still room.
        for q in _pick_mixed(conn, cfg, day, mix["day_mix"].get(wd, [])):
            add_question_ticket(conn, cfg, day, sprint, q)
            budget -= cfg["est_minutes"][q["difficulty"]]
        budget = _add_reviews(conn, cfg, day, sprint, budget, minimum=1)
        for q in _pick_mixed(conn, cfg, day, ["Medium"] * 5, budget, fill_from_open=False):
            add_question_ticket(conn, cfg, day, sprint, q)
    else:
        budget = _add_reviews(conn, cfg, day, sprint, budget)
        for q in next_new_questions(conn, limit=20):
            cost = cfg["est_minutes"][q["difficulty"]]
            if cost > budget:
                break
            add_question_ticket(conn, cfg, day, sprint, q)
            budget -= cost

    conn.execute(
        "INSERT INTO days(date,planned_at) VALUES(?,datetime('now','localtime')) "
        "ON CONFLICT(date) DO UPDATE SET planned_at=excluded.planned_at", (day,),
    )
    conn.commit()


def _add_reviews(conn, cfg, day, sprint, budget, minimum=None) -> int:
    """Add due reviews that fit the budget (or `minimum` of them regardless); return what's left."""
    rm = cfg["review_minutes"]
    if weekday_key(day) == cfg["buffer_day"]:
        n = cfg["buffer_day_reviews"]
    elif minimum is not None:
        n = min(max(budget // rm, minimum), cfg["max_reviews_per_day"])
    else:
        n = cfg["max_reviews_per_day"]
    for q in _due_reviews(conn, cfg, day, limit=max(n, 0)):
        _add(conn, day, sprint, "review", f"Review Q{q['num']}. {q['title']}", rm,
             detail=q["subtopic"], question_num=q["num"])
        budget -= rm
    return budget


def replan_day(conn, day: str) -> None:
    """Rebuild a day's fresh (non-carried, untouched) cards, e.g. after changing settings."""
    conn.execute("DELETE FROM tickets WHERE date=? AND status='todo' AND carried=0 AND kind!='custom'", (day,))
    plan_day(conn, day, force=True)


def pull_next(conn, day: str):
    """Finished early? Pull a Medium from a topic that isn't on today's board yet."""
    cfg = config.load(conn)
    picks = _pick_mixed(conn, cfg, day, ["Medium"], fill_from_open=False) if cfg["mix"]["enabled"] else next_new_questions(conn, limit=1)
    if picks:
        add_question_ticket(conn, cfg, day, ensure_sprint(conn, cfg, day), picks[0])
        conn.commit()
    return picks[0] if picks else None


TICKET_FIELDS = {"status", "position", "date", "title", "est_minutes", "result", "minutes_spent",
                 "confidence", "note", "link"}


def update_ticket(conn, tid: int, fields: dict) -> dict | None:
    """Apply a partial update; the first move into Done stamps it and updates spaced repetition."""
    before = conn.execute("SELECT * FROM tickets WHERE id=?", (tid,)).fetchone()
    if not before:
        return None
    fields = {k: v for k, v in fields.items() if k in TICKET_FIELDS}
    if fields.get("date") and fields["date"] != before["date"]:
        # Moved to another day: join that day's sprint and go to the end of its column.
        fields["sprint_id"] = ensure_sprint(conn, config.load(conn), fields["date"])
        fields["position"] = conn.execute(
            "SELECT COALESCE(MAX(position),0)+1 FROM tickets WHERE date=?", (fields["date"],)
        ).fetchone()[0]
    if fields:
        conn.execute(f"UPDATE tickets SET {', '.join(f'{k}=?' for k in fields)} WHERE id=?", (*fields.values(), tid))
    after = dict(conn.execute("SELECT * FROM tickets WHERE id=?", (tid,)).fetchone())
    if after["status"] == "done" and not before["done_at"]:
        conn.execute("UPDATE tickets SET done_at=datetime('now','localtime') WHERE id=?", (tid,))
        apply_review(conn, config.load(conn), after, after["date"])
    conn.commit()
    return dict(conn.execute("SELECT * FROM tickets WHERE id=?", (tid,)).fetchone())


def apply_review(conn, cfg, ticket: dict, day: str) -> None:
    """Spaced repetition. Struggled -> back in 1-3 days; confident -> longer gaps."""
    num = ticket["question_num"]
    if not num or ticket["kind"] not in ("dsa", "review"):
        return
    p = dict(conn.execute("SELECT * FROM progress WHERE num=?", (num,)).fetchone())
    ivals = cfg["review_intervals"]
    conf = ticket.get("confidence") or 3
    result = ticket.get("result") or "solved"
    if result == "failed":
        step, gap = 0, 1
    elif result == "hints" or conf <= 2:
        step, gap = 0, ivals[0]
    else:
        if ticket["kind"] == "dsa" and conf >= 4:
            # Confident first solve: one check later, then mastered on success.
            step, gap = len(ivals) - 1, cfg["confident_check_days"]
        elif ticket["kind"] == "dsa":
            step, gap = 0, ivals[0]
        else:
            step = p["step"] + (2 if conf == 5 else 1)
            gap = ivals[step] if step < len(ivals) else None
    status = "mastered" if gap is None else "learning"
    conn.execute(
        """UPDATE progress SET status=?, step=?, next_review=?, last_done=?, first_done=COALESCE(first_done,?),
           attempts=attempts+1, last_confidence=?, total_minutes=total_minutes+? WHERE num=?""",
        (status, min(step, len(ivals)), (d(day) + timedelta(days=gap)).isoformat() if gap else None,
         day, day, conf, ticket.get("minutes_spent") or 0, num),
    )


def close_day(conn, day: str, energy=None, ai_topics=None, notes=None) -> str:
    conn.execute(
        """INSERT INTO days(date,closed_at,energy,ai_topics,notes) VALUES(?,datetime('now','localtime'),?,?,?)
           ON CONFLICT(date) DO UPDATE SET closed_at=excluded.closed_at, energy=excluded.energy,
           ai_topics=excluded.ai_topics, notes=excluded.notes""",
        (day, energy, ai_topics, notes),
    )
    conn.commit()
    tomorrow = (d(day) + timedelta(days=1)).isoformat()
    plan_day(conn, tomorrow)
    return tomorrow


def add_upsolve(conn, contest: dict) -> None:
    cfg = config.load(conn)
    flags = contest.get("q_solved") or []
    missing = [f"Q{i + 1}" for i, ok in enumerate(flags) if not ok]
    if not missing:
        return
    day = (d(contest["date"]) + timedelta(days=1)).isoformat()
    _add(conn, day, ensure_sprint(conn, cfg, day), "upsolve", f"Upsolve {contest['name']}: {', '.join(missing)}",
         cfg["contests"]["upsolve_minutes"] * len(missing), detail="Read editorial only after a real attempt.")
    conn.commit()


def projected_finish(conn) -> str | None:
    """Use your real pace over the last 14 days once there is one; otherwise simulate the budget."""
    cfg = config.load(conn)
    remaining = [cfg["est_minutes"][q["difficulty"]] for q in next_new_questions(conn)]
    if not remaining:
        return today()
    since = (date.today() - timedelta(days=14)).isoformat()
    first_done = conn.execute("SELECT MIN(date) FROM tickets WHERE status='done'").fetchone()[0]
    if first_done and first_done <= since:
        done = conn.execute(
            "SELECT COUNT(*) FROM tickets WHERE kind='dsa' AND status='done' AND date>? AND date<=?", (since, today())
        ).fetchone()[0]
        if done:
            return (date.today() + timedelta(days=round(len(remaining) * 14 / done))).isoformat()
    cur, i = date.today() + timedelta(days=1), 0
    for _ in range(3650):
        budget = cfg["dsa_minutes"][config.WEEKDAYS[cur.weekday()]] - 2 * cfg["review_minutes"]
        while i < len(remaining) and remaining[i] <= budget:
            budget -= remaining[i]
            i += 1
        if i >= len(remaining):
            return cur.isoformat()
        cur += timedelta(days=1)
    return None
