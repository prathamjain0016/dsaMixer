"""CLI: python -m dsamixer <command> (run.sh calls this)

  serve                    start the board at http://127.0.0.1:8765
  today                    print today's plan in the terminal
  notify morning|evening   send the email (--dry-run prints it instead)
  schedule install|remove  set up macOS launchd jobs (8:00 / 22:00 emails, 14:00 / 21:30
                           homework sync, board at login). macOS only; docs/guides/integrations.md has a cron example

  setup status             JSON: setup_done, backend, env_file, which integrations are configured
                           (true/false from variable names only; never prints a value), python, os, board_running
  config export [FILE]     write the effective config as JSON (to stdout without FILE)
  config import FILE       validate FILE (all keys or only some), merge it over your current config
                           (the defaults on a fresh install) and save it; marks setup as done

  plan week [FROM_DATE] [--dry-run]   re-lay the DSA for FROM_DATE..Sunday (default tomorrow); JSON of cards removed/added
                           (--dry-run rolls everything back)

  contests sync            fetch LeetCode's upcoming Weekly/Biweekly into the cache (prints JSON)
  contests upcoming        print the cached schedule
  leetcode sync            fetch your profile (leetcode.username): caches it, auto-logs new contests,
                           refreshes "already solved" suggestions (prints JSON)
  leetcode profile USER    print any user's profile as JSON without storing anything

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
import os
import platform
import plistlib
import shutil
import subprocess
import sys
import urllib.request
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
    if sys.platform != "darwin":
        raise SystemExit("`schedule` installs macOS launchd jobs, so it only works on macOS.\n"
                         "On Linux, use cron instead: see 'Scheduling the emails' in docs/guides/integrations.md.")
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


# Which .env variable names switch each optional integration on (values are never read out).
INTEGRATION_VARS = {
    "ai_planner": [["OPENROUTER_API_KEY"], ["ANTHROPIC_API_KEY"], ["ANTHROPIC_AUTH_TOKEN"]],  # any one of these
    "email": [["SMTP_USER", "SMTP_PASSWORD", "MAIL_TO"]],                                     # all of these
    "postgres": [["DATABASE_URL"]],
}


def _board_running(port: int = 8765) -> bool:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=1.5) as r:
            return r.status == 200
    except Exception:
        return False


def setup_status() -> dict:
    """Machine and setup state for /setup. Works before setup and without a .env; prints no secret."""
    db.load_env()
    status = {"setup_done": None, "backend": db.backend(), "env_file": db.ENV_PATH.exists(),
              "integrations": {name: any(all(os.environ.get(v) for v in group) for group in groups)
                               for name, groups in INTEGRATION_VARS.items()},
              "python": platform.python_version(), "os": platform.system(),
              "schedule_supported": sys.platform == "darwin", "board_running": _board_running()}
    try:
        conn = db.connect()
        db.init(conn)
        status["setup_done"] = bool(db.get_setting(conn, "setup_done"))
        conn.close()
    except Exception as e:  # e.g. Postgres configured but not running; say which kind, not the URL
        status["db_error"] = type(e).__name__
    return status


def import_config(conn, imported: dict) -> dict:
    """Merge a (partial) config over the current one. `ai_template` describes a whole week, so it is
    replaced as a unit: a weekday left out of it gets no course cards."""
    merged = config._merge(config._merge(config.DEFAULTS, db.get_setting(conn, "config", {})), imported)
    if "ai_template" in imported:
        merged["ai_template"] = {d: imported["ai_template"].get(d, []) for d in config.WEEKDAYS}
    config.save(conn, merged)
    config.mark_setup(conn)
    conn.commit()
    return merged


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
    sub.add_parser("setup").add_subparsers(dest="setupcmd", required=True).add_parser("status")
    cf = sub.add_parser("config").add_subparsers(dest="cfgcmd", required=True)
    cf.add_parser("export").add_argument("file", nargs="?")
    cf.add_parser("import").add_argument("file")
    ct = sub.add_parser("contests").add_subparsers(dest="ct", required=True)
    ct.add_parser("sync")
    ct.add_parser("upcoming")
    lc = sub.add_parser("leetcode").add_subparsers(dest="lc", required=True)
    lc.add_parser("sync")
    lc.add_parser("profile").add_argument("user")
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
    if args.cmd == "setup":
        print(json.dumps(setup_status(), indent=1))
        return

    out = lambda obj: print(json.dumps(obj, indent=1, default=str))
    if args.cmd == "leetcode" and args.lc == "profile":  # read-only: no database needed
        try:
            out(leetcode.fetch_profile(args.user))
        except leetcode.LeetCodeError as e:
            raise SystemExit(f"profile fetch failed: {e}")
        return
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
    if args.cmd == "config":
        if args.cfgcmd == "export":
            text = json.dumps(config.load(conn), indent=2, ensure_ascii=False) + "\n"
            if args.file:
                Path(args.file).write_text(text)
                print(f"wrote {args.file}")
            else:
                print(text, end="")
        else:
            try:
                imported = json.loads(Path(args.file).read_text())
            except (OSError, ValueError) as e:
                raise SystemExit(f"can't read {args.file}: {e}")
            errs = config.validate(imported)
            if errs:
                raise SystemExit("config not imported:\n  " + "\n  ".join(errs))
            import_config(conn, imported)
            print(f"imported {args.file} ({len(imported)} top-level keys merged over your config); setup marked as done")
        return
    if args.cmd in ("plan", "today", "notify") and not db.get_setting(conn, "setup_done"):
        raise SystemExit("Setup isn't done yet. Run ./run.sh and finish the setup wizard in the browser, "
                         "or run ./run.sh config import config.example.json.")
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
    if args.cmd == "leetcode":
        if not leetcode.username(conn):
            raise SystemExit("No LeetCode username set: add leetcode.username in Settings > LeetCode "
                             "or with ./run.sh config import.")
        try:
            out(leetcode.sync_profile(conn))
        except leetcode.LeetCodeError as e:
            raise SystemExit(f"LeetCode sync failed: {e}")
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
            leetcode.sync_profile_quietly(conn)  # then your profile: rating, auto-logged contests
        subject, body = getattr(notify, args.which)(conn)
        if args.dry_run:
            print(f"Subject: {subject}\n\n{body}")
        else:
            notify.send(subject, body)
            print(f"sent: {subject}")


if __name__ == "__main__":
    main()
