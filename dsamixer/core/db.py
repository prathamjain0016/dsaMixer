"""Storage: Postgres when DATABASE_URL is set, otherwise the SQLite file dsamixer.db.

All SQL in the app is written once in SQLite style (`?` placeholders, datetime('now','localtime'));
PgConn translates it for Postgres. DSAMIXER_DB=<path> forces SQLite (used for tests on a scratch copy).
"""
import json
import os
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]  # project root (dsamixer/core/db.py -> ../..)
ENV_PATH = ROOT / ".env"
DB_PATH = Path(os.environ.get("DSAMIXER_DB", ROOT / "dsamixer.db"))
QUESTIONS_JSON = Path(__file__).resolve().parents[1] / "data" / "questions.json"

SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL              -- JSON encoded
);

CREATE TABLE IF NOT EXISTS questions (
    num          INTEGER PRIMARY KEY,
    title        TEXT NOT NULL,
    difficulty   TEXT NOT NULL,      -- Easy | Medium | Hard
    section      TEXT NOT NULL,
    subtopic     TEXT NOT NULL,
    pattern      TEXT NOT NULL,
    pattern_hint TEXT,
    url          TEXT
);

-- Spaced-repetition + mastery state per question.
CREATE TABLE IF NOT EXISTS progress (
    num            INTEGER PRIMARY KEY REFERENCES questions(num),
    status         TEXT NOT NULL DEFAULT 'new',  -- new | learning | mastered
    first_done     TEXT,
    last_done      TEXT,
    next_review    TEXT,
    step           INTEGER NOT NULL DEFAULT 0,   -- index into review intervals
    attempts       INTEGER NOT NULL DEFAULT 0,
    last_confidence INTEGER,
    total_minutes  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sprints (
    id         INTEGER PRIMARY KEY,           -- sprint number, 1-based
    start_date TEXT NOT NULL,
    end_date   TEXT NOT NULL,
    goal       TEXT,
    retro      TEXT
);

-- A ticket is one card on the board for one day.
CREATE TABLE IF NOT EXISTS tickets (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    date          TEXT NOT NULL,
    sprint_id     INTEGER,
    kind          TEXT NOT NULL,   -- dsa | review | ai | contest | upsolve | retro | custom
    title         TEXT NOT NULL,
    detail        TEXT,
    question_num  INTEGER REFERENCES questions(num),
    est_minutes   INTEGER NOT NULL DEFAULT 30,
    status        TEXT NOT NULL DEFAULT 'todo',  -- todo | doing | done | skipped
    position      INTEGER NOT NULL DEFAULT 0,
    carried       INTEGER NOT NULL DEFAULT 0,    -- times rolled over
    -- end-of-task log
    result        TEXT,            -- solved | hints | failed (dsa/review)
    minutes_spent INTEGER,
    confidence    INTEGER,         -- 1..5
    note          TEXT,
    link          TEXT,
    source        TEXT,            -- null | ai_plan | homework
    created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    done_at       TEXT
);
CREATE INDEX IF NOT EXISTS ix_tickets_date ON tickets(date);

-- End-of-day entry. A row exists once the day is planned; closed_at marks the log.
CREATE TABLE IF NOT EXISTS days (
    date       TEXT PRIMARY KEY,
    planned_at TEXT,
    closed_at  TEXT,
    energy     INTEGER,            -- 1..5
    ai_topics  TEXT,
    notes      TEXT
);

CREATE TABLE IF NOT EXISTS contests (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    date        TEXT NOT NULL,
    name        TEXT NOT NULL,     -- e.g. "Weekly Contest 480"
    kind        TEXT NOT NULL,     -- weekly | biweekly | virtual
    solved      INTEGER NOT NULL DEFAULT 0,  -- out of 4
    q_solved    TEXT,              -- JSON [true,false,...] for Q1..Q4
    rank        INTEGER,
    rating      INTEGER,           -- rating after contest (live only)
    notes       TEXT
);

-- A weekly AI plan (goals -> tasks spread over the week). Covered days skip the generic template.
CREATE TABLE IF NOT EXISTS ai_week_plans (
    week_start TEXT PRIMARY KEY,       -- Monday
    days       TEXT NOT NULL,          -- JSON list of dates the plan covers
    goals      TEXT NOT NULL,
    summary    TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS ai_modules (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    position INTEGER NOT NULL,
    title    TEXT NOT NULL,
    week     INTEGER,              -- course week it is taught in (optional)
    status   TEXT NOT NULL DEFAULT 'upcoming',  -- upcoming | in_progress | done
    notes    TEXT
);
"""


NOW_SQLITE = "datetime('now','localtime')"
NOW_PG = "to_char(localtimestamp, 'YYYY-MM-DD HH24:MI:SS')"
PG_SCHEMA = (SCHEMA.replace("INTEGER PRIMARY KEY AUTOINCREMENT", "SERIAL PRIMARY KEY")
             .replace(f"({NOW_SQLITE})", f"({NOW_PG})"))


def load_env() -> None:
    """Read .env into os.environ (existing variables win)."""
    if not ENV_PATH.exists():
        return
    for line in ENV_PATH.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


class Row(dict):
    """A row usable both as r["col"] and r[0], like sqlite3.Row."""

    def __init__(self, cols, values):
        super().__init__(zip(cols, values))
        self._values = values

    def __getitem__(self, key):
        return self._values[key] if isinstance(key, int) else super().__getitem__(key)


def _row_factory(cur):
    cols = [c.name for c in cur.description] if cur.description else []
    return lambda values: Row(cols, values)


class PgConn:
    """Minimal sqlite3.Connection look-alike over psycopg, translating SQLite-style SQL."""

    is_pg = True

    def __init__(self, url):
        import psycopg

        self._c = psycopg.connect(url, row_factory=_row_factory)

    @staticmethod
    def _sql(sql, has_params):
        sql = sql.replace(NOW_SQLITE, NOW_PG)
        return sql.replace("%", "%%").replace("?", "%s") if has_params else sql

    def execute(self, sql, params=()):
        return self._c.execute(self._sql(sql, bool(params)), tuple(params) or None)

    def executemany(self, sql, seq):
        with self._c.cursor() as cur:
            cur.executemany(self._sql(sql, True), [tuple(p) for p in seq])

    def executescript(self, sql):
        self._c.execute(sql)

    def commit(self):
        self._c.commit()

    def close(self):
        self._c.close()


def backend() -> str:
    load_env()
    return "postgres" if os.environ.get("DATABASE_URL") and "DSAMIXER_DB" not in os.environ else "sqlite"


def connect():
    if backend() == "postgres":
        return PgConn(os.environ["DATABASE_URL"])
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init(conn) -> None:
    if getattr(conn, "is_pg", False):
        conn.executescript(PG_SCHEMA)
    else:
        conn.executescript(SCHEMA)
        cols = {r["name"] for r in conn.execute("PRAGMA table_info(tickets)")}
        if "source" not in cols:  # added with the weekly AI planner
            conn.execute("ALTER TABLE tickets ADD COLUMN source TEXT")
    if conn.execute("SELECT COUNT(*) FROM questions").fetchone()[0] == 0:
        qs = json.loads(QUESTIONS_JSON.read_text())
        conn.executemany(
            "INSERT INTO questions VALUES (?,?,?,?,?,?,?,?)",
            [(q["num"], q["title"], q["difficulty"], q["section"], q["subtopic"], q["pattern"],
              q["pattern_hint"], q["url"]) for q in qs],
        )
        conn.executemany("INSERT INTO progress(num) VALUES (?)", [(q["num"],) for q in qs])
    conn.commit()


# Tables in foreign-key order, for copying SQLite -> Postgres.
TABLES = ["settings", "questions", "progress", "sprints", "days", "tickets", "contests", "ai_week_plans", "ai_modules"]
SERIAL_TABLES = ["tickets", "contests", "ai_modules"]


def copy_sqlite_to_pg(sqlite_path: Path, pg) -> dict:
    """Replace everything in Postgres with the contents of a SQLite file. Returns row counts."""
    src = sqlite3.connect(sqlite_path)
    src.row_factory = sqlite3.Row
    init(pg)
    pg.execute(f"TRUNCATE {', '.join(TABLES)} RESTART IDENTITY CASCADE")
    counts = {}
    for t in TABLES:
        cols = [r["name"] for r in src.execute(f"PRAGMA table_info({t})")]
        data = [tuple(r) for r in src.execute(f"SELECT {', '.join(cols)} FROM {t}")]
        if data:
            pg.executemany(f"INSERT INTO {t}({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})", data)
        counts[t] = len(data)
    for t in SERIAL_TABLES:
        pg.execute(f"SELECT setval(pg_get_serial_sequence('{t}', 'id'), COALESCE((SELECT MAX(id) FROM {t}), 0) + 1, false)")
    pg.commit()
    src.close()
    return counts


def rows(cur) -> list[dict]:
    return [dict(r) for r in cur.fetchall()]


def get_setting(conn, key, default=None):
    r = conn.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    return json.loads(r["value"]) if r else default


def set_setting(conn, key, value) -> None:
    conn.execute(
        "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (key, json.dumps(value)),
    )
