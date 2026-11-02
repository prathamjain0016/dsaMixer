"""Aggregates for the Stats tab and the emails."""
from datetime import date, timedelta

from ..core import config, db
from . import planner


def _minutes(t: dict) -> int:
    return t["minutes_spent"] if t["minutes_spent"] is not None else t["est_minutes"]


def streak(conn) -> int:
    active = {r[0] for r in conn.execute("SELECT DISTINCT date FROM tickets WHERE status='done'")}
    cur = date.today()
    if cur.isoformat() not in active:
        cur -= timedelta(days=1)
    n = 0
    while cur.isoformat() in active:
        n += 1
        cur -= timedelta(days=1)
    return n


def build(conn) -> dict:
    cfg = config.load(conn)
    by_diff = db.rows(conn.execute(
        """SELECT q.difficulty, COUNT(*) AS total, SUM(CASE WHEN p.status!='new' THEN 1 ELSE 0 END) AS done,
                  SUM(CASE WHEN p.status='mastered' THEN 1 ELSE 0 END) AS mastered
           FROM questions q JOIN progress p USING(num) GROUP BY q.difficulty"""
    ))
    by_section = db.rows(conn.execute(
        """SELECT q.section, MIN(q.num) AS first_num, COUNT(*) AS total,
                  SUM(CASE WHEN p.status!='new' THEN 1 ELSE 0 END) AS done
           FROM questions q JOIN progress p USING(num) GROUP BY q.section ORDER BY first_num"""
    ))
    weak = db.rows(conn.execute(
        """SELECT q.subtopic, ROUND(AVG(p.last_confidence),1) AS avg_conf, COUNT(*) AS n
           FROM questions q JOIN progress p USING(num) WHERE p.status!='new'
           GROUP BY q.subtopic HAVING COUNT(*)>=2 ORDER BY avg_conf, n DESC LIMIT 5"""
    ))
    quality = conn.execute(
        """SELECT COUNT(*) AS n, ROUND(AVG(confidence),2) AS avg_conf,
                  SUM(CASE WHEN result='solved' THEN 1 ELSE 0 END) AS solved,
                  SUM(CASE WHEN result='hints' THEN 1 ELSE 0 END) AS hints,
                  SUM(CASE WHEN result='failed' THEN 1 ELSE 0 END) AS failed
           FROM tickets WHERE kind IN ('dsa','review') AND status='done'"""
    ).fetchone()

    start = date.today() - timedelta(days=27)
    done = db.rows(conn.execute("SELECT * FROM tickets WHERE status='done' AND date>=?", (start.isoformat(),)))
    daily = []
    for i in range(28):
        day = (start + timedelta(days=i)).isoformat()
        ts = [t for t in done if t["date"] == day]
        daily.append({
            "date": day,
            "dsa": sum(_minutes(t) for t in ts if t["kind"] in ("dsa", "review", "upsolve", "contest")),
            "ai": sum(_minutes(t) for t in ts if t["kind"] == "ai"),
            "questions": sum(1 for t in ts if t["kind"] == "dsa"),
        })

    week_start = date.today() - timedelta(days=date.today().weekday())
    ai_week = conn.execute(
        "SELECT COALESCE(SUM(COALESCE(minutes_spent,est_minutes)),0) FROM tickets WHERE kind='ai' AND status='done' AND date BETWEEN ? AND ?",
        (week_start.isoformat(), planner.today()),
    ).fetchone()[0]

    contests = db.rows(conn.execute("SELECT * FROM contests ORDER BY date"))
    rated = [c for c in contests if c["rating"]]
    return {
        "total": sum(r["total"] for r in by_diff),
        "done": sum(r["done"] or 0 for r in by_diff),
        "mastered": sum(r["mastered"] or 0 for r in by_diff),
        "by_difficulty": by_diff,
        "by_section": by_section,
        "weak_patterns": weak,
        "quality": dict(quality),
        "reviews_due": conn.execute(
            "SELECT COUNT(*) FROM progress WHERE status='learning' AND next_review<=?", (planner.today(),)
        ).fetchone()[0],
        "daily": daily,
        "heatmap": heatmap(conn),
        "homework": homework(conn),
        "streak": streak(conn),
        "ai_hours_week": round(ai_week / 60, 1),
        "ai_weekly_target_hours": cfg["ai_weekly_target_hours"],
        "projected_finish": planner.projected_finish(conn),
        "projected_finish_basis": "at your last-14-day pace" if (conn.execute(
            "SELECT MIN(date) FROM tickets WHERE status='done'").fetchone()[0] or "9999") <= (
            date.today() - timedelta(days=14)).isoformat() else "at current budget (pace kicks in after 2 weeks)",
        "knight": knight(conn, cfg, rated, contests),
    }


def knight(conn, cfg, rated, contests) -> dict:
    """The badge tracker. Current rating: your synced LeetCode profile when there is one, else the
    latest logged contest with a rating."""
    profile = db.get_setting(conn, "leetcode_profile") or {}
    user = ((cfg.get("leetcode") or {}).get("username") or "").lower()
    pc = (profile.get("contest") or {}) if user and profile.get("username", "").lower() == user else {}
    from_profile = pc.get("rating") is not None
    return {
        **cfg["knight"],
        "label": config.badge_label(cfg["knight"]),
        "rating": pc["rating"] if from_profile else (rated[-1]["rating"] if rated else None),
        "rating_source": "leetcode" if from_profile else ("contests" if rated else None),
        "earned_badge": pc.get("badge"),
        "contests": len(contests),
        "q3_rate": round(sum(1 for c in contests if c["solved"] >= 3) / len(contests), 2) if contests else None,
    }


def sprint(conn, sprint_id: int) -> dict:
    s = conn.execute("SELECT * FROM sprints WHERE id=?", (sprint_id,)).fetchone()
    if not s:
        return {}
    tickets = db.rows(conn.execute(
        "SELECT * FROM tickets WHERE date BETWEEN ? AND ? ORDER BY date, position", (s["start_date"], s["end_date"])
    ))
    days = []
    for i in range(7):
        day = (date.fromisoformat(s["start_date"]) + timedelta(days=i)).isoformat()
        ts = [t for t in tickets if t["date"] == day]
        days.append({
            "date": day,
            "total": len(ts),
            "done": sum(t["status"] == "done" for t in ts),
            "questions_done": sum(t["status"] == "done" and t["kind"] == "dsa" for t in ts),
            "tickets": ts,
        })
    return {
        **dict(s),
        "days": days,
        "planned": len(tickets),
        "done": sum(t["status"] == "done" for t in tickets),
        "questions_done": sum(t["status"] == "done" and t["kind"] == "dsa" for t in tickets),
        "carried_in": sum(t["carried"] > 0 for t in tickets),
    }


def heatmap(conn, days: int = 182) -> list[dict]:
    """The last `days` days ending today: done-ticket count and minutes per day (zeros included)."""
    start = date.today() - timedelta(days=days - 1)
    per_day = {r["date"]: r for r in db.rows(conn.execute(
        """SELECT date, COUNT(*) AS done, SUM(COALESCE(minutes_spent, est_minutes)) AS minutes
           FROM tickets WHERE status='done' AND date>=? AND date<=? GROUP BY date""",
        (start.isoformat(), planner.today()),
    ))}
    out = []
    for i in range(days):
        day = (start + timedelta(days=i)).isoformat()
        r = per_day.get(day)
        out.append({"date": day, "done": int(r["done"]) if r else 0, "minutes": int(r["minutes"] or 0) if r else 0})
    return out


def homework(conn) -> list[dict]:
    """This Mon-Sun week's homework tickets grouped by goal (the detail text before ' · ')."""
    monday = date.today() - timedelta(days=date.today().weekday())
    ts = db.rows(conn.execute(
        """SELECT detail, status, est_minutes FROM tickets WHERE source='homework' AND date BETWEEN ? AND ?
           ORDER BY date, position""",
        (monday.isoformat(), (monday + timedelta(days=6)).isoformat()),
    ))
    goals: dict[str, dict] = {}
    for t in ts:
        if t["status"] == "skipped":
            continue
        name = (t["detail"] or "Homework").split(" · ")[0].strip() or "Homework"
        g = goals.setdefault(name, {"goal": name, "done": 0, "total": 0, "minutes_left": 0})
        g["total"] += 1
        if t["status"] == "done":
            g["done"] += 1
        else:
            g["minutes_left"] += t["est_minutes"]
    return list(goals.values())


def week(conn, cfg, day: str, ai_capacity: dict[str, int]) -> dict:
    """Read-only Mon-Sun week containing `day`: per-day budgets, planned minutes and cards."""
    monday = planner.d(day) - timedelta(days=planner.d(day).weekday())
    dates = [(monday + timedelta(days=i)).isoformat() for i in range(7)]
    tickets = db.rows(conn.execute(
        """SELECT t.id, t.date, t.title, t.kind, t.status, t.est_minutes, t.minutes_spent, t.detail, t.carried,
                  t.source, q.difficulty FROM tickets t LEFT JOIN questions q ON q.num=t.question_num
           WHERE t.date BETWEEN ? AND ? ORDER BY t.date, t.position""",
        (dates[0], dates[-1]),
    ))
    info = {r["date"]: r for r in db.rows(conn.execute(
        "SELECT date, planned_at, closed_at FROM days WHERE date BETWEEN ? AND ?", (dates[0], dates[-1])
    ))}
    out = []
    for dt in dates:
        wd = planner.weekday_key(dt)
        ts = [t for t in tickets if t["date"] == dt]
        live = [t for t in ts if t["status"] != "skipped"]
        mins = lambda kinds: sum(t["est_minutes"] for t in live if kinds(t["kind"]))
        out.append({
            "date": dt, "weekday": wd, "is_today": dt == planner.today(), "is_buffer": wd == cfg["buffer_day"],
            "planned": bool(info.get(dt) and info[dt]["planned_at"]),
            "closed": bool(info.get(dt) and info[dt]["closed_at"]),
            "dsa_budget": cfg["dsa_minutes"].get(wd, 0),
            "ai_capacity": ai_capacity.get(dt, 0),
            "minutes": {
                "dsa": mins(lambda k: k in planner.DSA_KINDS),
                "ai": mins(lambda k: k == "ai"),
                "other": mins(lambda k: k not in planner.DSA_KINDS and k != "ai"),
            },
            "tickets": [{k: v for k, v in t.items() if k != "date"} for t in ts],
        })
    return {"start": dates[0], "end": dates[-1], "sprint": planner.week_no(cfg, dates[0]), "days": out}
