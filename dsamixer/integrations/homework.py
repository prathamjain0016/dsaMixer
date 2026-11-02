"""Homework support for the agents: week dates, notebook scanning, and turning a plan into tickets.

Layout: homework/weekN/ holds the assignment files for COURSE week N plus an agent-maintained
STATUS.md. Course week N is done in sprint N - course_week_offset (config). Default deadline:
Saturday 08:00 of that sprint week (before class).
"""
import json
from datetime import date, timedelta
from pathlib import Path

from ..core import config, db
from ..planning import planner
from . import ai_planner

HOMEWORK_DIR = db.ROOT / "homework"
SOURCE = "homework"

# Code cells that only contain these still count as "not done".
PLACEHOLDERS = ("TODO", "YOUR CODE HERE", "raise NotImplementedError", "...")


def folder_for(week: int) -> Path:
    """Accepts week4, week04 or week-04; new folders use the week4 style."""
    for name in (f"week{week}", f"week{week:02d}", f"week-{week:02d}", f"week-{week}"):
        if (HOMEWORK_DIR / name).is_dir():
            return HOMEWORK_DIR / name
    return HOMEWORK_DIR / f"week{week}"


def week_info(cfg, week: int, today: date | None = None) -> dict:
    """`week` is the course week; its work happens in sprint week - course_week_offset."""
    today = today or date.today()
    sprint = week - cfg["course_week_offset"]
    monday = planner.d(cfg["start_date"]) + timedelta(weeks=sprint - 1)
    workdays = [monday + timedelta(days=i) for i in range(5)]
    days = [x.isoformat() for x in workdays if x >= today]
    return {
        "week": week,
        "sprint": sprint,
        "folder": str(folder_for(week)),
        "monday": monday.isoformat(),
        "deadline": f"{(monday + timedelta(days=5)).isoformat()} 08:00",
        "plan_days": days,
        "capacity": ai_planner.capacity(cfg, days),
    }


def current_week(cfg) -> int:
    """The course week being worked on now."""
    return planner.week_no(cfg, planner.today()) + cfg["course_week_offset"]


def _is_placeholder(src: str) -> bool:
    lines = [l.strip() for l in src.splitlines() if l.strip() and not l.strip().startswith("#")]
    if not lines:
        return True
    body = "\n".join(lines)
    return all(l in ("pass", "...") for l in lines) or any(p in body for p in PLACEHOLDERS)


def nbscan(path: str) -> dict:
    """Summarize a notebook so an agent can judge progress without reading every cell."""
    nb = json.loads(Path(path).read_text())
    cells, heading = [], None
    for i, c in enumerate(nb.get("cells", [])):
        src = "".join(c.get("source", []))
        if c.get("cell_type") == "markdown":
            first = next((l for l in src.splitlines() if l.strip()), "")
            if first.lstrip().startswith("#"):
                heading = first.lstrip("# ").strip()
            cells.append({"i": i, "type": "markdown", "first_line": first[:120]})
            continue
        outputs = c.get("outputs", [])
        cells.append({
            "i": i,
            "type": "code",
            "section": heading,
            "first_line": next((l for l in src.splitlines() if l.strip()), "")[:120],
            "has_work": not _is_placeholder(src),
            "executed": c.get("execution_count") is not None,
            "outputs": len(outputs),
            "error": next((o.get("ename") for o in outputs if o.get("output_type") == "error"), None),
        })
    code = [c for c in cells if c["type"] == "code"]
    return {
        "path": str(path),
        "code_cells": len(code),
        "with_work": sum(c["has_work"] for c in code),
        "executed": sum(c["executed"] for c in code),
        "errors": sum(bool(c["error"]) for c in code),
        "cells": cells,
    }


def pdftext(path: str, max_chars: int = 40000) -> dict:
    """Plain text of a PDF (the Read tool can't render PDFs without poppler)."""
    from pypdf import PdfReader

    reader = PdfReader(path)
    text = "\n\n".join(f"--- page {i + 1} ---\n{p.extract_text() or ''}" for i, p in enumerate(reader.pages))
    return {"path": str(path), "pages": len(reader.pages), "truncated": len(text) > max_chars, "text": text[:max_chars]}


def apply_plan(conn, week: int, plan: dict) -> list[dict]:
    """Put a homework plan on the boards.

    plan = {"tasks": [{"ref": "HW1-Q2", "goal": "HW1", "title": "...", "minutes": 60, "date": optional}]}
    Tasks without a date are spread over the week's remaining Mon-Fri within each day's AI capacity.
    Re-planning moves untouched tickets of the same ref in place (ids stay stable for STATUS.md),
    deletes untouched ones no longer in the plan, and never touches started or finished steps.
    """
    cfg = config.load(conn)
    info = week_info(cfg, week)
    days = info["plan_days"]
    if not days:
        raise ValueError(f"No weekdays left in week {week}.")
    all_week = [(planner.d(info["monday"]) + timedelta(days=i)).isoformat() for i in range(7)]
    existing = db.rows(conn.execute(
        f"SELECT * FROM tickets WHERE source=? AND date IN ({','.join('?' * 7)})", (SOURCE, *all_week)
    ))
    ref_of = lambda t: (t["detail"] or "").rsplit(" · ", 1)[-1]
    untouched = {ref_of(t): t for t in existing if t["status"] == "todo" and not t["carried"]}
    started = {ref_of(t) for t in existing if ref_of(t) not in untouched}

    template_titles = {i["title"] for items in config.ai_template(cfg).values() for i in items}
    for day in days:  # generic AI homework cards make way for the real tasks
        for t in db.rows(conn.execute(
            "SELECT id,title FROM tickets WHERE date=? AND kind='ai' AND status='todo' AND carried=0", (day,)
        )):
            if t["title"] in template_titles:
                conn.execute("DELETE FROM tickets WHERE id=?", (t["id"],))

    # Steps the owner already started or finished stay as they are and aren't planned again.
    todo = [t for t in plan["tasks"] if t.get("ref") not in started]
    dated = [t for t in todo if t.get("date")]
    placed = dated + ai_planner.distribute([t for t in todo if not t.get("date")], days, info["capacity"])
    out = []
    for t in placed:
        detail = f"{t['goal']} · {t.get('ref', '')}".strip(" ·")
        old_t = untouched.pop(t.get("ref"), None)
        if old_t:  # same step re-planned: move it, keeping its ticket id (STATUS.md refers to it)
            pos = conn.execute("SELECT COALESCE(MAX(position),0)+1 FROM tickets WHERE date=?", (t["date"],)).fetchone()[0]
            conn.execute(
                "UPDATE tickets SET date=?, sprint_id=?, title=?, est_minutes=?, detail=?, position=? WHERE id=?",
                (t["date"], planner.ensure_sprint(conn, cfg, t["date"]), t["title"], int(t["minutes"]), detail,
                 pos if old_t["date"] != t["date"] else old_t["position"], old_t["id"]),
            )
            tid = old_t["id"]
        else:
            tid = planner._add(conn, t["date"], planner.ensure_sprint(conn, cfg, t["date"]), "ai", t["title"],
                               int(t["minutes"]), detail=detail, source=SOURCE)
        out.append({"ref": t.get("ref"), "id": tid, "date": t["date"], "title": t["title"]})
    for t in untouched.values():  # steps dropped from the new plan
        conn.execute("DELETE FROM tickets WHERE id=?", (t["id"],))
    for day in {t["date"] for t in out}:  # list each day's steps in plan order, after its other cards
        ids = [t["id"] for t in out if t["date"] == day]
        base = conn.execute(
            f"SELECT COALESCE(MAX(position),0) FROM tickets WHERE date=? AND id NOT IN ({','.join('?' * len(ids))})",
            (day, *ids),
        ).fetchone()[0]
        for k, tid in enumerate(ids, 1):
            conn.execute("UPDATE tickets SET position=? WHERE id=?", (base + k, tid))
    out += [{"ref": r, "id": None, "date": None, "title": "kept: already started or done"} for r in sorted(started)]

    conn.execute(
        """INSERT INTO ai_week_plans(week_start,days,goals,summary) VALUES(?,?,?,?)
           ON CONFLICT(week_start) DO UPDATE SET days=excluded.days, goals=excluded.goals,
           summary=excluded.summary, created_at=datetime('now','localtime')""",
        (info["monday"], json.dumps(days), f"homework/{Path(info['folder']).name}", plan.get("summary")),
    )
    conn.commit()
    return out


def list_tickets(conn, start=None, end=None, source=None, kind=None) -> list[dict]:
    sql, args = "SELECT * FROM tickets WHERE 1=1", []
    for col, op, val in (("date", ">=", start), ("date", "<=", end), ("source", "=", source), ("kind", "=", kind)):
        if val:
            sql += f" AND {col}{op}?"
            args.append(val)
    return db.rows(conn.execute(sql + " ORDER BY date, position", args))
