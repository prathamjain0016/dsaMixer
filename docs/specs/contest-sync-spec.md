# Spec: sync the LeetCode contest calendar

This spec covers syncing LeetCode's real contest schedule into dsaMixer, so contest cards carry the real contest name and time and the Biweekly dates come from LeetCode instead of `biweekly_anchor` arithmetic. Decided 2026-11-02.

On 2026-11-02, the public endpoint `POST https://leetcode.com/graphql` with `{"query":"{ upcomingContests { title titleSlug startTime duration } }"}` returned:

| Contest | `startTime` (unix) | IST | Duration (s) |
|---|---|---|---|
| Biweekly Contest 195 | 1794061800 | Sat 2026-11-07 20:00 | 5400 |
| Weekly Contest 527 | 1794105000 | Sun 2026-11-08 08:00 | 5400 |

This confirms that the current `biweekly_anchor` of 2026-11-07 is correct. The endpoint needs `Content-Type: application/json`, a `Referer: https://leetcode.com/contest/` header, and a browser-like User-Agent. No auth is needed.

## Changes

### 1. `dsamixer/integrations/leetcode.py` (new)
- **`fetch_upcoming(timeout=15) -> list[dict]`**
  - Use stdlib `urllib`, as `ai_planner.py` does; no new dependency.
  - Return `[{title, slug, kind: "weekly"|"biweekly", start: ISO datetime in Asia/Kolkata, date: "YYYY-MM-DD", time: "HH:MM", minutes}]`.
  - Use `zoneinfo` for the conversion.
  - Raise a small `LeetCodeError` on a network or HTTP error, or on an unexpected shape.
- **`sync(conn) -> dict`**
  1. Call `fetch_upcoming()`.
  2. Merge the result into the setting `leetcode_contests` (JSON list, keyed by slug).
     - Keep entries from the last 21 days, so recently played contests still resolve.
     - Drop older entries.
  3. Store `leetcode_synced_at`.
  4. Return `{fetched, added, updated, contests}`.
  5. If a fetched Biweekly date is not on the 14-day cycle of `cfg.contests.biweekly_anchor`, report it in `warnings`. Don't change the saved config.

### 2. `dsamixer/planning/planner.py` (`contest_for`)
- Read the cached `leetcode_contests` setting with `db.get_setting`. `contest_for(cfg, day)` has no `conn` today, so add an optional `conn=None` parameter and pass it from `plan_day` and any other callers. The planner must not import `integrations`.
- **Live Sunday Weekly (week 5 or later):** if the cache has a Weekly on that date, the title becomes `"<title> — LIVE <HH:MM> IST"`, for example `"Weekly Contest 531 — LIVE 08:00 IST"`. Keep the word `LIVE`, because the carry-over logic looks for it.
- **Live Saturday Biweekly (week 9 or later):** if the cache has a Biweekly on that date, use the real title. A cache entry overrides the anchor arithmetic. If the cache has no entry for that date, fall back to the current anchor logic.
- **Virtual Sundays (weeks 1–4):** if the cache has a Weekly that day, the detail becomes `"Do <title> as a virtual contest after it ends, or any past Weekly. 90 min timer."`. Leave the title unchanged.
- Existing behaviour must stay the same when the cache is empty.

### 3. CLI and automation
- **`./run.sh contests sync`:** runs `sync()` and prints JSON.
- **`./run.sh contests upcoming`:** prints the cache.
- **Server startup:** call `sync()` best-effort in a background thread, so startup isn't blocked when the network is down. Log failures; never crash.
- **`notify morning`:** call `sync()` best-effort first, so the cache refreshes daily through the existing 8:00 launchd job. No new launchd job is needed.
- **Morning email:** if there's a contest today, include its real title and time.

### 4. API and UI
- **`GET /api/contests/upcoming`:** returns the cache plus `synced_at`. It is read-only and never fetches.
- **`POST /api/contests/sync`:** runs `sync()`. Return 502 with a message on `LeetCodeError`.
- **Contests page:** add an "Upcoming on LeetCode" widget listing title, IST date and time, and live/virtual for your week, with a "Sync now" button and "Last synced …". Use the existing components in `js/components/` and the current redesigned style. Run `node --check` on changed files.

### 5. Docs
Update:
- CLAUDE.md: the code map, the contests step in "How a day is planned", and the run commands.
- README: the command table.
- `docs/architecture/system-design.md`: the contests rule row and the components.

## Testing (never the real DB)
- **Scratch DB:** copy `dsamixer.db` to the scratchpad (`<scratchpad>/contests.db`) and use `DSAMIXER_DB`.
- **Unit-style checks:**
  - Monkeypatch `fetch_upcoming` with the two contests in the table above, plus a synthetic Weekly in week 5 (Sunday 2026-12-06) and a Biweekly in week 9 (Saturday 2027-01-02).
  - Assert `contest_for` titles and details for: a virtual Sunday, a live Weekly, a live Biweekly from the cache, a Biweekly from the anchor fallback with an empty cache, and a non-cycle cache date producing a warning.
- **Live fetch:** run `./run.sh contests sync` once with `DSAMIXER_DB` set. This is a real call to LeetCode, a read-only public endpoint. Show its output.
- **Server failure path:** start the server on port 8799 with a scratch DB and confirm it still starts when the fetch fails. Simulate this by monkeypatching or pointing at a bad host via an env override such as `DSAMIXER_LEETCODE_URL`.
- **Postgres:** keep the SQL portable (settings use the existing `get_setting`/`set_setting`).

## Report
List the changed files, the test results (pass/fail per assertion), the live sync output, and any deviations from this spec.
