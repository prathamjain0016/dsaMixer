"""Sync LeetCode's upcoming contest schedule (public, read-only GraphQL endpoint) into the settings cache.

The planner reads the cache (`leetcode_contests`) to put the real contest name and time on contest cards.
"""
import json
import logging
import os
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from ..core import config, db

log = logging.getLogger("dsamixer.leetcode")

URL = "https://leetcode.com/graphql"
QUERY = "{ upcomingContests { title titleSlug startTime duration } }"
IST = ZoneInfo("Asia/Kolkata")
KEEP_DAYS = 21
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")


class LeetCodeError(Exception):
    pass


def _kind(title: str):
    t = title.lower()
    if t.startswith("biweekly"):
        return "biweekly"
    if t.startswith("weekly"):
        return "weekly"
    return None


def fetch_upcoming(timeout=15) -> list[dict]:
    url = os.environ.get("DSAMIXER_LEETCODE_URL", URL)  # override for failure-path tests
    req = urllib.request.Request(url, data=json.dumps({"query": QUERY}).encode(), method="POST", headers={
        "Content-Type": "application/json", "Referer": "https://leetcode.com/contest/", "User-Agent": UA,
    })
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise LeetCodeError(f"LeetCode returned HTTP {e.code}")
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise LeetCodeError(f"Couldn't reach LeetCode: {getattr(e, 'reason', e)}")
    except json.JSONDecodeError:
        raise LeetCodeError("LeetCode returned something that isn't JSON")
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
