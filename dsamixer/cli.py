"""CLI: python -m dsamixer <command> (run.sh calls this)

  serve                    start the board at http://127.0.0.1:8765
  today                    print today's plan in the terminal
  notify morning|evening   send the email (--dry-run prints it instead)
  schedule install|remove  set up macOS launchd jobs (8:00 / 22:00 emails, 14:00 / 21:30
                           homework sync, board at login)

  plan week [FROM_DATE] [--dry-run]   re-lay the DSA for FROM_DATE..Sunday (default tomorrow); JSON of cards removed/added
                           (--dry-run rolls everything back)

  contests sync            fetch LeetCode's upcoming Weekly/Biweekly into the cache (prints JSON)
  contests upcoming        print the cached schedule

  db info                  which database is in use (Postgres via DATABASE_URL, or SQLite) + row counts
  db copy-from-sqlite [FILE] --yes   replace ALL Postgres data with a SQLite file (default dsamixer.db)

Used by the homework agents (all print JSON):
  homework week [N]                   dates, deadline, plan days and AI capacity for COURSE week N
  homework nbscan FILE.ipynb          per-cell progress summary of a notebook
  homework pdftext FILE.pdf           text of a PDF
  homework apply N PLAN.json|-        put a homework plan on the boards
  tickets list [--from D] [--to D] [--source S] [--kind K]
  tickets add --date D --title T [--minutes M] [--kind ai] [--source homework] [--detail X]
  tickets update ID [--status S] [--note N] [--minutes-spent M] [--date D] [--title T]
"""
import argparse
import json
import plistlib
import shutil
import subprocess
import sys
from datetime import date, timedelta
from pathlib import Path

from .core import config, db
from .integrations import homework, leetcode, notify
from .planning import planner

AGENTS = Path.home() / "Library" / "LaunchAgents"
LOGS = db.ROOT / "logs"


def _jobs():
    py = sys.executable
    return {
        "com.dsamixer.server": {"ProgramArguments": [py, "-m", "dsamixer", "serve"], "RunAtLoad": True, "KeepAlive": True},
        "com.dsamixer.morning": {"ProgramArguments": [py, "-m", "dsamixer", "notify", "morning"],
                                 "StartCalendarInterval": {"Hour": 8, "Minute": 0}},
        "com.dsamixer.evening": {"ProgramArguments": [py, "-m", "dsamixer", "notify", "evening"],
                                 "StartCalendarInterval": {"Hour": 22, "Minute": 0}},
        # Headless Claude Code runs the homework tracker; permissions come from .claude/settings.json.
        "com.dsamixer.homework-sync": {
            "ProgramArguments": [shutil.which("claude") or "claude", "-p", "/homework-sync",
                                 "--permission-mode", "dontAsk", "--model", "claude-sonnet-5-5"],
            "StartCalendarInterval": [{"Hour": 14, "Minute": 0}, {"Hour": 21, "Minute": 30}],
            "EnvironmentVariables": {"PATH": "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"},
        },
    }


def schedule(action: str) -> None:
    LOGS.mkdir(exist_ok=True)
    for label, job in _jobs().items():
        path = AGENTS / f"{label}.plist"
        subprocess.run(["launchctl", "unload", str(path)], capture_output=True)
        if action == "remove":
            path.unlink(missing_ok=True)
            print(f"removed {label}")
            continue
        plist = {"Label": label, "WorkingDirectory": str(db.ROOT),
                 "StandardOutPath": str(LOGS / f"{label}.log"), "StandardErrorPath": str(LOGS / f"{label}.log"), **job}
        path.write_bytes(plistlib.dumps(plist))
        subprocess.run(["launchctl", "load", str(path)], check=True)
        print(f"installed {label} -> {path}")


def main() -> None:
    ap = argparse.ArgumentParser(prog="dsamixer")
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("serve")
    s.add_argument("--port", type=int, default=8765)
    s.add_argument("--host", default="127.0.0.1")
    sub.add_parser("today")
    n = sub.add_parser("notify")
    n.add_argument("which", choices=["morning", "evening"])
    n.add_argument("--dry-run", action="store_true")
    sc = sub.add_parser("schedule")
    sc.add_argument("action", choices=["install", "remove"])
    pl = sub.add_parser("plan").add_subparsers(dest="plancmd", required=True)
    pw = pl.add_parser("week")
    pw.add_argument("from_date", nargs="?")
    pw.add_argument("--dry-run", action="store_true")
    dbp = sub.add_parser("db").add_subparsers(dest="dbcmd", required=True)
    dbp.add_parser("info")
    dc = dbp.add_parser("copy-from-sqlite")
    dc.add_argument("file", nargs="?", default=str(db.ROOT / "dsamixer.db"))
    dc.add_argument("--yes", action="store_true", help="confirm: wipes the Postgres tables first")
    ct = sub.add_parser("contests").add_subparsers(dest="ct", required=True)
    ct.add_parser("sync")
    ct.add_parser("upcoming")
    hw = sub.add_parser("homework").add_subparsers(dest="hw", required=True)
    hw.add_parser("week").add_argument("n", type=int, nargs="?")
    hw.add_parser("nbscan").add_argument("file")
    hw.add_parser("pdftext").add_argument("file")
    ha = hw.add_parser("apply")
    ha.add_argument("n", type=int)
    ha.add_argument("plan", help="plan JSON file, or - for stdin")
    tk = sub.add_parser("tickets").add_subparsers(dest="tk", required=True)
    tl = tk.add_parser("list")
    tl.add_argument("--from", dest="start")
    tl.add_argument("--to", dest="end")
    tl.add_argument("--source")
    tl.add_argument("--kind")
    ta = tk.add_parser("add")
    ta.add_argument("--date", required=True)
    ta.add_argument("--title", required=True)
    ta.add_argument("--minutes", type=int, default=30)
    ta.add_argument("--kind", default="ai")
    ta.add_argument("--source")
    ta.add_argument("--detail")
    tu = tk.add_parser("update")
    tu.add_argument("id", type=int)
    for f in ("--status", "--note", "--date", "--title"):
        tu.add_argument(f)
    tu.add_argument("--minutes-spent", type=int)
    args = ap.parse_args()

    if args.cmd == "serve":
        import uvicorn
        uvicorn.run("dsamixer.web.server:app", host=args.host, port=args.port)
        return
    if args.cmd == "schedule":
        schedule(args.action)
        return

    out = lambda obj: print(json.dumps(obj, indent=1, default=str))
    if args.cmd == "db" and args.dbcmd == "copy-from-sqlite":
        if db.backend() != "postgres":
            raise SystemExit("DATABASE_URL isn't set, so there's no Postgres to copy into.")
        if not args.yes:
            raise SystemExit(f"This replaces ALL data in Postgres with {args.file}. Re-run with --yes.")
        out(db.copy_sqlite_to_pg(Path(args.file), db.connect()))
        return

    conn = db.connect()
    db.init(conn)
    if args.cmd == "db":
        out({"backend": db.backend(),
             "counts": {t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in db.TABLES}})
        return
    if args.cmd == "plan":
        start = args.from_date or (date.today() + timedelta(days=1)).isoformat()
        result = planner.relayout_week(conn, start)
        (conn.rollback if args.dry_run else conn.commit)()
        out({"from": start, "dry_run": args.dry_run, "days": result})
        return
    if args.cmd == "contests":
        if args.ct == "sync":
            try:
                out(leetcode.sync(conn))
            except leetcode.LeetCodeError as e:
                raise SystemExit(f"contest sync failed: {e}")
        else:
            out({"synced_at": db.get_setting(conn, "leetcode_synced_at"), "contests": leetcode.get_cache(conn)})
        return
    if args.cmd == "homework":
        cfg = config.load(conn)
        if args.hw == "week":
            out(homework.week_info(cfg, args.n or homework.current_week(cfg)))
        elif args.hw == "nbscan":
            out(homework.nbscan(args.file))
        elif args.hw == "pdftext":
            out(homework.pdftext(args.file))
        else:
            plan = json.load(sys.stdin if args.plan == "-" else open(args.plan))
            out(homework.apply_plan(conn, args.n, plan))
    elif args.cmd == "tickets":
        if args.tk == "list":
            out(homework.list_tickets(conn, args.start, args.end, args.source, args.kind))
        elif args.tk == "add":
            cfg = config.load(conn)
            tid = planner._add(conn, args.date, planner.ensure_sprint(conn, cfg, args.date), args.kind,
                               args.title, args.minutes, detail=args.detail, source=args.source)
            conn.commit()
            out({"id": tid})
        else:
            fields = {k: v for k, v in {"status": args.status, "note": args.note, "date": args.date,
                                        "title": args.title, "minutes_spent": args.minutes_spent}.items()
                      if v is not None}
            t = planner.update_ticket(conn, args.id, fields)
            out(t or {"error": f"ticket {args.id} not found"})
    elif args.cmd == "today":
        print(notify.morning(conn)[1])
    elif args.cmd == "notify":
        if args.which == "morning":
            leetcode.sync_quietly(conn)  # refresh the contest cache before today is planned
        subject, body = getattr(notify, args.which)(conn)
        if args.dry_run:
            print(f"Subject: {subject}\n\n{body}")
        else:
            notify.send(subject, body)
            print(f"sent: {subject}")


if __name__ == "__main__":
    main()
