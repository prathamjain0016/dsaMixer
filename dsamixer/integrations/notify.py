"""Morning plan + evening reminder emails over Gmail SMTP.

Reads SMTP_USER, SMTP_PASSWORD (a Gmail App Password), MAIL_TO and APP_URL
from the .env file in the project root.
"""
import os
import smtplib
from email.message import EmailMessage

from ..core import db
from ..planning import planner, stats

load_env = db.load_env


def _tickets(conn, day):
    return db.rows(conn.execute(
        """SELECT t.*, q.difficulty, q.url FROM tickets t LEFT JOIN questions q ON q.num=t.question_num
           WHERE t.date=? ORDER BY t.position""", (day,)
    ))


def morning(conn) -> tuple[str, str]:
    day = planner.today()
    planner.plan_day(conn, day)
    ts = _tickets(conn, day)
    s = stats.build(conn)
    lines = [f"Plan for {day} ({planner.weekday_key(day).title()})", ""]
    for kind, label in [("ai", "AI course"), ("contest", "Contest"), ("upsolve", "Upsolve"),
                        ("review", "Reviews"), ("dsa", "New DSA questions"), ("retro", "Sprint"), ("custom", "Other")]:
        group = [t for t in ts if t["kind"] == kind and t["status"] != "done"]
        if not group:
            continue
        lines.append(f"{label}:")
        for t in group:
            diff = f" [{t['difficulty']}]" if t.get("difficulty") else ""
            carried = " (carried)" if t["carried"] else ""
            lines.append(f"  - {t['title']}{diff} ~{t['est_minutes']}m{carried}")
            if t.get("url"):
                lines.append(f"    {t['url']}")
        lines.append("")
    lines += [
        f"Progress: {s['done']}/{s['total']} questions · streak {s['streak']}d · reviews due {s['reviews_due']}",
        f"Projected finish: {s['projected_finish']}",
        "",
        f"Board: {os.environ.get('APP_URL', 'http://127.0.0.1:8765')}",
    ]
    return f"dsaMixer · today: {len(ts)} cards", "\n".join(lines)


def evening(conn) -> tuple[str, str]:
    day = planner.today()
    ts = _tickets(conn, day)
    left = [t for t in ts if t["status"] in ("todo", "doing")]
    done = [t for t in ts if t["status"] == "done"]
    lines = [f"{len(done)} done, {len(left)} open today.", ""]
    if left:
        lines.append("Still open (these roll into tomorrow when you close the day):")
        lines += [f"  - {t['title']}" for t in left]
        lines.append("")
    lines.append(f"Log your day and see tomorrow's plan: {os.environ.get('APP_URL', 'http://127.0.0.1:8765')}")
    return "dsaMixer · close your day", "\n".join(lines)


def send(subject: str, body: str) -> None:
    load_env()
    user, pw, to = os.environ.get("SMTP_USER"), os.environ.get("SMTP_PASSWORD"), os.environ.get("MAIL_TO")
    if not (user and pw and to):
        raise SystemExit("Set SMTP_USER, SMTP_PASSWORD and MAIL_TO in .env (see .env.example).")
    msg = EmailMessage()
    msg["Subject"], msg["From"], msg["To"] = subject, user, to
    msg.set_content(body)
    with smtplib.SMTP_SSL(os.environ.get("SMTP_HOST", "smtp.gmail.com"), int(os.environ.get("SMTP_PORT", 465))) as s:
        s.login(user, pw)
        s.send_message(msg)
