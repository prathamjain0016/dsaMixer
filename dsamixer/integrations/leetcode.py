"""LeetCode's public, read-only GraphQL endpoint (no auth): the upcoming contest schedule, user profiles,
and what we derive from your own profile.

Settings it writes (all JSON in the `settings` table):
- `leetcode_contests`, `leetcode_synced_at`: the upcoming schedule. The planner reads it to put the real
  contest name and time on contest cards.
- `leetcode_profile`: your fetched profile plus `fetched_at`. The badge tracker reads its rating.
- `leetcode_suggestions`, `leetcode_dismissed`: recent accepted solves that match the question list.
- `leetcode_friends_cache`: friends' profiles by username, each with `fetched_at` (6-hour cache).
"""
import difflib
import json
import logging
import os
import re
import time
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from ..core import config, db
from ..planning import planner

log = logging.getLogger("dsamixer.leetcode")

URL = "https://leetcode.com/graphql"
QUERY = "{ upcomingContests { title titleSlug startTime duration } }"
IST = ZoneInfo("Asia/Kolkata")
KEEP_DAYS = 21
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")


class LeetCodeError(Exception):
    pass


class UserNotFound(LeetCodeError):
    """The username doesn't exist on LeetCode (matchedUser is null)."""


def _kind(title: str):
    t = title.lower()
    if t.startswith("biweekly"):
        return "biweekly"
    if t.startswith("weekly"):
        return "weekly"
    return None


def _post(query: str, variables: dict | None = None, timeout=15) -> dict:
    """POST a GraphQL query; returns the parsed JSON body. Network and HTTP problems raise LeetCodeError."""
    url = os.environ.get("DSAMIXER_LEETCODE_URL", URL)  # override for failure-path tests
    body = {"query": query, **({"variables": variables} if variables else {})}
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST", headers={
        "Content-Type": "application/json", "Referer": "https://leetcode.com/contest/", "User-Agent": UA,
    })
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise LeetCodeError(f"LeetCode returned HTTP {e.code}")
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise LeetCodeError(f"Couldn't reach LeetCode: {getattr(e, 'reason', e)}")
    except json.JSONDecodeError:
        raise LeetCodeError("LeetCode returned something that isn't JSON")


def fetch_upcoming(timeout=15) -> list[dict]:
    data = _post(QUERY, timeout=timeout)
    try:
        items = data["data"]["upcomingContests"]
        if not isinstance(items, list):
            raise TypeError
        out = []
        for it in items:
            kind = _kind(it["title"])
            if not kind:
                continue  # not a Weekly/Biweekly (e.g. a sponsored contest)
            start = datetime.fromtimestamp(int(it["startTime"]), IST)
            out.append({"title": it["title"], "slug": it["titleSlug"], "kind": kind,
                        "start": start.isoformat(), "date": start.date().isoformat(),
                        "time": start.strftime("%H:%M"), "minutes": int(it["duration"]) // 60})
    except (KeyError, TypeError, ValueError):
        raise LeetCodeError("Unexpected response shape from LeetCode")
    return sorted(out, key=lambda c: c["start"])


def get_cache(conn) -> list[dict]:
    return db.get_setting(conn, "leetcode_contests", []) or []


def sync(conn) -> dict:
    fetched = fetch_upcoming()
    cfg = config.load(conn)
    cache = {c["slug"]: c for c in get_cache(conn)}
    added = updated = 0
    for c in fetched:
        if c["slug"] not in cache:
            added += 1
        elif cache[c["slug"]] != c:
            updated += 1
        cache[c["slug"]] = c
    cutoff = (date.today() - timedelta(days=KEEP_DAYS)).isoformat()
    merged = sorted((c for c in cache.values() if c["date"] >= cutoff), key=lambda c: c["start"])
    db.set_setting(conn, "leetcode_contests", merged)
    db.set_setting(conn, "leetcode_synced_at", datetime.now().isoformat(timespec="seconds"))
    conn.commit()
    anchor = date.fromisoformat(cfg["contests"]["biweekly_anchor"])
    warnings = [f"{c['title']} is on {c['date']}, which is not on the 14-day cycle of biweekly_anchor "
                f"({anchor}). LeetCode's date is used; check the anchor in Settings."
                for c in fetched
                if c["kind"] == "biweekly" and (date.fromisoformat(c["date"]) - anchor).days % 14 != 0]
    return {"fetched": len(fetched), "added": added, "updated": updated, "contests": merged, "warnings": warnings}


def sync_quietly(conn) -> dict | None:
    """Best-effort sync: log and return None on any failure."""
    try:
        return sync(conn)
    except Exception as e:  # never let a flaky network break startup or the morning job
        log.warning("LeetCode contest sync failed: %s", e)
        return None


# ---------- profiles ----------

PROFILE_QUERY = """query($u: String!) {
  matchedUser(username: $u) {
    username
    profile { ranking userAvatar }
    submitStatsGlobal { acSubmissionNum { difficulty count } }
    badges { name }
    userCalendar { streak totalActiveDays }
  }
  userContestRanking(username: $u) { attendedContestsCount rating globalRanking topPercentage badge { name } }
  userContestRankingHistory(username: $u) { attended rating ranking problemsSolved totalProblems contest { title startTime } }
  recentAcSubmissionList(username: $u, limit: 20) { title titleSlug timestamp }
}"""
# Friends don't need contest history or recent solves.
SUMMARY_QUERY = PROFILE_QUERY.split("  userContestRankingHistory")[0] + "}"

FRIENDS_TTL = 6 * 3600
AUTO_NOTE = "auto-logged from LeetCode; which problems were solved is assumed in order"


def _ist_date(ts) -> str:
    return datetime.fromtimestamp(int(ts), IST).date().isoformat()


def fetch_profile(username: str, full: bool = True, timeout=15) -> dict:
    """A normalized profile. `full=False` skips contest history and recent solves (friends)."""
    username = (username or "").strip()
    if not username:
        raise LeetCodeError("No LeetCode username given")
    res = _post(PROFILE_QUERY if full else SUMMARY_QUERY, {"u": username}, timeout=timeout)
    data = res.get("data") or {}
    u = data.get("matchedUser")
    if not u:
        raise UserNotFound(f"LeetCode user '{username}' not found")
    try:
        solved = {r["difficulty"].lower(): int(r["count"]) for r in u["submitStatsGlobal"]["acSubmissionNum"]}
        cr = data.get("userContestRanking") or {}
        cal = u.get("userCalendar") or {}
        out = {
            "username": u["username"],
            "avatar": (u.get("profile") or {}).get("userAvatar"),
            "ranking": (u.get("profile") or {}).get("ranking"),
            "solved": {k: solved.get(k, 0) for k in ("all", "easy", "medium", "hard")},
            "streak": cal.get("streak") or 0,
            "active_days": cal.get("totalActiveDays") or 0,
            "badges": list(dict.fromkeys(b["name"] for b in u.get("badges") or [])),  # API repeats some
            "contest": {
                "rating": round(cr["rating"]) if cr.get("rating") is not None else None,
                "attended": cr.get("attendedContestsCount") or 0,
                "global_rank": cr.get("globalRanking"),
                "top_pct": cr.get("topPercentage"),
                "badge": (cr.get("badge") or {}).get("name"),
            },
        }
        if full:
            out["history"] = [{
                "title": h["contest"]["title"], "date": _ist_date(h["contest"]["startTime"]),
                "rating": round(h["rating"]), "rank": h["ranking"],
                "solved": h["problemsSolved"], "total": h["totalProblems"],
            } for h in data.get("userContestRankingHistory") or [] if h.get("attended")]
            out["recent_ac"] = [{"title": r["title"], "slug": r["titleSlug"], "date": _ist_date(r["timestamp"])}
                                for r in data.get("recentAcSubmissionList") or []]
    except (KeyError, TypeError, ValueError):
        raise LeetCodeError("Unexpected response shape from LeetCode")
    return out


def username(conn) -> str | None:
    return ((config.load(conn).get("leetcode") or {}).get("username") or "").strip() or None


def get_profile(conn) -> dict | None:
    return db.get_setting(conn, "leetcode_profile")


# ---------- auto-logged contests ----------

def _log_contests(conn, cfg, history: list[dict]) -> list[str]:
    added = []
    for h in history:
        kind = _kind(h["title"])
        if not kind or h["date"] < cfg["start_date"]:
            continue
        if conn.execute("SELECT 1 FROM contests WHERE name=?", (h["title"],)).fetchone():
            continue
        total = max(int(h["total"] or 4), 1)
        flags = [i < h["solved"] for i in range(total)]
        conn.execute(
            "INSERT INTO contests(date,name,kind,solved,q_solved,rank,rating,notes) VALUES(?,?,?,?,?,?,?,?)",
            (h["date"], h["title"], kind, int(h["solved"]), json.dumps(flags), h["rank"], int(h["rating"]), AUTO_NOTE),
        )
        conn.commit()
        upsolve = conn.execute("SELECT 1 FROM tickets WHERE kind='upsolve' AND title LIKE ?",
                               (f"Upsolve {h['title']}:%",)).fetchone()
        if not upsolve:
            planner.add_upsolve(conn, {"date": h["date"], "name": h["title"], "q_solved": flags})
        added.append(h["title"])
    return added


# ---------- "already solved" suggestions ----------

def norm_title(t: str) -> str:
    t = re.sub(r"\([^)]*\)", " ", (t or "").lower())
    t = re.sub(r"[^a-z0-9 ]+", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def match_questions(questions: list[dict], title: str) -> list[int]:
    """Question numbers whose normalized title equals this one, else the close (ratio >= 0.9) ones."""
    n = norm_title(title)
    exact = [q["num"] for q in questions if norm_title(q["title"]) == n]
    if exact or not n:
        return exact
    return [q["num"] for q in questions if difflib.SequenceMatcher(None, n, norm_title(q["title"])).ratio() >= 0.9]


def _open_suggestions(conn, items: list[dict]) -> list[dict]:
    """Drop dismissed questions and ones that aren't `new` any more."""
    dismissed = set(db.get_setting(conn, "leetcode_dismissed", []) or [])
    new = {r["num"] for r in conn.execute("SELECT num FROM progress WHERE status='new'").fetchall()}
    return [s for s in items if s["num"] in new and s["num"] not in dismissed]


def get_suggestions(conn) -> list[dict]:
    return _open_suggestions(conn, db.get_setting(conn, "leetcode_suggestions", []) or [])


def _suggest(conn, recent_ac: list[dict]) -> list[dict]:
    questions = db.rows(conn.execute("SELECT num, title, difficulty FROM questions ORDER BY num"))
    by_num = {q["num"]: q for q in questions}
    found = {s["num"]: s for s in db.get_setting(conn, "leetcode_suggestions", []) or []}
    for ac in recent_ac:
        for num in match_questions(questions, ac["title"]):
            if num not in found or ac["date"] > found[num]["date"]:
                found[num] = {"num": num, "title": by_num[num]["title"], "difficulty": by_num[num]["difficulty"],
                              "lc_title": ac["title"], "date": ac["date"]}
    out = sorted(_open_suggestions(conn, list(found.values())), key=lambda s: s["num"])
    db.set_setting(conn, "leetcode_suggestions", out)
    return out


def accept_suggestion(conn, num: int) -> dict:
    """Log the question as solved today (confident, no time spent). Spaced repetition then schedules
    the single 21-day check. An open card for the question is reused instead of adding a second one."""
    q = conn.execute("SELECT * FROM questions WHERE num=?", (num,)).fetchone()
    if not q:
        raise KeyError(num)
    day = planner.today()
    cfg = config.load(conn)
    t = conn.execute("SELECT id FROM tickets WHERE question_num=? AND kind='dsa' AND status IN ('todo','doing') "
                     "ORDER BY date LIMIT 1", (num,)).fetchone()
    if t:
        tid = t["id"]
        planner.update_ticket(conn, tid, {"date": day})
    else:
        tid = planner._add(conn, day, planner.ensure_sprint(conn, cfg, day), "dsa", f"Q{num}. {q['title']}",
                           cfg["est_minutes"][q["difficulty"]], detail=f"{q['section']} › {q['subtopic']}",
                           question_num=num)
    ticket = planner.update_ticket(conn, tid, {"status": "done", "result": "solved", "confidence": 4,
                                               "minutes_spent": 0, "note": "imported from LeetCode"})
    _forget(conn, num)
    return ticket


def dismiss_suggestion(conn, num: int) -> None:
    dismissed = db.get_setting(conn, "leetcode_dismissed", []) or []
    if num not in dismissed:
        db.set_setting(conn, "leetcode_dismissed", dismissed + [num])
    _forget(conn, num)


def _forget(conn, num: int) -> None:
    items = db.get_setting(conn, "leetcode_suggestions", []) or []
    db.set_setting(conn, "leetcode_suggestions", [s for s in items if s["num"] != num])
    conn.commit()


# ---------- your profile sync ----------

def sync_profile(conn) -> dict:
    user = username(conn)
    if not user:
        raise LeetCodeError("No LeetCode username set. Add one in Settings > LeetCode.")
    p = fetch_profile(user)
    p["fetched_at"] = datetime.now().isoformat(timespec="seconds")
    db.set_setting(conn, "leetcode_profile", p)
    conn.commit()
    added = _log_contests(conn, config.load(conn), p.get("history") or [])
    suggestions = _suggest(conn, p.get("recent_ac") or [])
    conn.commit()
    return {"username": p["username"], "contests_added": added, "suggestions": suggestions}


def sync_profile_quietly(conn) -> dict | None:
    """Best-effort: nothing to do without a username; log and return None on any failure."""
    try:
        return sync_profile(conn) if username(conn) else None
    except Exception as e:
        log.warning("LeetCode profile sync failed: %s", e)
        return None


# ---------- friends ----------

def _summary(p: dict) -> dict:
    return {k: p.get(k) for k in ("username", "avatar", "ranking", "solved", "streak", "active_days", "badges", "contest")}


def fetch_friends(conn, force: bool = False, now: float | None = None) -> list[dict]:
    """Every `leetcode.friends` profile, one request at a time, cached for 6 hours per username.
    A failing username gets {"username", "error"} instead of failing the batch."""
    now = time.time() if now is None else now
    friends = (config.load(conn).get("leetcode") or {}).get("friends") or []
    cache = db.get_setting(conn, "leetcode_friends_cache", {}) or {}
    out, fresh = [], {}
    for name in friends:
        hit = cache.get(name.lower())
        if hit and not force and now - hit.get("fetched_ts", 0) < FRIENDS_TTL:
            entry = hit
        else:
            try:
                entry = {**_summary(fetch_profile(name, full=False)), "error": None}
            except LeetCodeError as e:
                entry = {"username": name, "error": str(e), "not_found": isinstance(e, UserNotFound)}
            entry["fetched_ts"] = now
            entry["fetched_at"] = datetime.fromtimestamp(now).isoformat(timespec="seconds")
        fresh[name.lower()] = entry
        out.append(entry)
    db.set_setting(conn, "leetcode_friends_cache", fresh)
    conn.commit()
    return out

