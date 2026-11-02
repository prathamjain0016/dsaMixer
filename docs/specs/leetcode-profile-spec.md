# Spec: LeetCode profiles, a friends leaderboard and a badge target

The owner chose this on 2026-11-02. The user enters their own LeetCode username, and can add friends' usernames for a small leaderboard. The fetched profile then:

- keeps the Knight tracker up to date automatically
- logs contests automatically
- offers to mark questions already solved on LeetCode
- shows a profile card

Also: let the user pick the **badge target** (Knight, Guardian, or a custom rating) instead of a hard-coded Knight goal.

**Build after `share-ready-spec.md` lands.** This spec touches the same config, wizard and settings code.

## Data source (checked 2026-11-02)

The public `POST https://leetcode.com/graphql` endpoint needs the same headers as the contest sync, and no auth. I checked this query against a public profile:

```graphql
query($u: String!) {
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
}
```

**Limits:**
- `recentAcSubmissionList` returns only the most recent ~20 accepted submissions. So "already solved" catches only recent solves, not full history. Say so in the UI.
- Contest history gives `problemsSolved` out of `totalProblems`, but not which problems were solved.
- `matchedUser` is null for an unknown username. Show a clear error.

## Changes

### 1. `dsamixer/integrations/leetcode.py`
- **`fetch_profile(username)`:** returns a normalized dict with:
  - `username`, `avatar`, `ranking`
  - `solved {all, easy, medium, hard}`
  - `streak`, `active_days`
  - `badges[]`
  - `contest {rating, attended, global_rank, top_pct, badge}`
  - `history[]` (attended only, each with `title`, `date` IST, `rating` as int, `rank`, `solved`, `total`)
  - `recent_ac[]` (each with `title`, `slug`, `date`)

  It raises `LeetCodeError`, with "user not found" as a distinct case.
- **`sync_profile(conn)`:** for the configured `leetcode.username`:
  1. Fetch the profile and cache it in the setting `leetcode_profile`, with `fetched_at`.
  2. **Auto-log contests.** For each attended history entry dated on or after `start_date`, insert a `contests` row, unless one with the same `name` already exists:
     - `kind` is `weekly` or `biweekly`, taken from the title
     - `solved` = `problemsSolved`
     - `q_solved` = the first N as true and the rest false, out of `totalProblems`
     - `rank`, `rating` (int)
     - `notes`: "auto-logged from LeetCode; which problems were solved is assumed in order"

     Then call `planner.add_upsolve` for it, unless an upsolve for that contest already exists. Use the same SQL portability rules.
  3. **Solved suggestions.** Match `recent_ac` titles to the 507 questions by normalized title: lowercase, remove parentheticals and punctuation, and collapse spaces. Fall back to `difflib` with a ratio ≥ 0.9.

     Store the matches as suggestions in the setting `leetcode_suggestions` (num, title, LeetCode title, date). Exclude questions whose `progress.status` isn't `new`, and exclude ones the user already dismissed (setting `leetcode_dismissed`).

  4. Return a summary: `contests_added` and `suggestions`.
- **`fetch_friends(conn, force=False)`:** fetch each `leetcode.friends` username one after another (no parallel requests). Cache them in `leetcode_friends_cache` for 6 hours. A failing username gets an error entry; it doesn't fail the batch.
- **When it runs:** best-effort, from the existing hooks: the server startup thread and the `notify morning` step, right after the contest sync. Never block startup or crash.

### 2. Config and the badge target
- **Config keys:** add `leetcode: {username: null, friends: []}`. Keep the `knight` config key for compatibility, and add `knight.badge`:
  - `"Knight"` (default)
  - `"Guardian"`
  - `"Custom"`, which needs a `target_rating`

  Presets set `target_rating` to about 1850 for Knight and about 2150 for Guardian. LeetCode awards these badges by percentile (top 25% and top 5% of contest rating), so the numbers move. Label them "approx." in the UI and keep them editable.
- **Tracker title.** Show "<badge> tracker" everywhere it currently says "Knight". The profile's `contest.badge` shows when they've earned one.
- **Rating source.** The tracker's current rating comes from `leetcode_profile.contest.rating` when that's present. Otherwise it falls back to the latest logged contest.

### 3. API
- `GET /api/leetcode/profile`: cached, never fetches.
- `POST /api/leetcode/sync`: runs `sync_profile`. Returns 502 or 404 with a clear message.
- `GET /api/leetcode/friends`: cached. `?refresh=1` re-fetches.
- `POST /api/leetcode/suggestions/{num}/accept`: creates today's dsa ticket for that question, marked done, with result `solved`, confidence 4, 0 minutes spent and the note "imported from LeetCode". It goes through `planner.update_ticket`, so spaced repetition schedules the 21-day check.
- `POST /api/leetcode/suggestions/{num}/dismiss`
- `POST /api/leetcode/suggestions/accept-all`
- Settings: `leetcode.username` and `leetcode.friends` are editable through the existing settings PUT.

### 4. UI (current Linear-style components)
- **Profile card widget** (Today rail and Stats):
  - avatar, username and solved counts (E/M/H)
  - contest rating, global rank, top %, streak and badges
  - "Refresh" and "Synced …"
  - when no username is set, an empty state that links to Settings
- **Badge tracker widget:** the renamed Knight widget, showing the chosen badge, target and deadline.
- **Suggestions.** When there are any, show a banner on Today and Questions: "N questions you solved recently on LeetCode match your list". It opens a slide-over list with Accept, Dismiss and Accept all.
- **Friends leaderboard widget** on the Contests page:
  - a table of username, rating, contests, solved E/M/H, streak and badge, sorted by rating
  - the user's own row highlighted
  - add and remove usernames inline, which saves `leetcode.friends`
  - a refresh button
- **Settings and the setup wizard.** A "LeetCode" section with username, friends and badge target. In the wizard's contests step, ask for the username (optional) and the badge target.
- **Contests page.** Auto-logged contests show a small "from LeetCode" tag.

### 5. Docs
Update:
- `CLAUDE.md`: code map, contests step, settings
- `README.md`: features, commands
- `docs/architecture/system-design.md`
- `docs/guides/customise.md` and `docs/guides/integrations.md`
- the index in `docs/README.md`

CLI:
- `./run.sh leetcode sync`
- `./run.sh leetcode profile USER`, which prints any user's profile as JSON without storing it.

## Testing (never the owner's DB)
- **Setup.** Use scratch SQLite copies via `DSAMIXER_DB` in the scratchpad, and port 8799 for any test server.
- **Unit-style checks**, with `fetch_profile` monkeypatched to a fixture (shaped like the real response above, with attended contests before and after `start_date`, and recent ACs including exact, parenthetical and non-matching titles):
  - Contests are auto-logged once, and running it again adds nothing. Upsolve cards appear only for contests that weren't fully solved.
  - Contests before `start_date` are ignored.
  - Suggestions contain the expected question numbers, exclude non-`new` and dismissed questions, and accepting one creates a done ticket whose `progress.next_review` is 21 days out.
  - Badge presets set the target, and Custom keeps the user's number.
  - An unknown user gives the distinct error.
  - The friends cache respects 6 hours, and one bad username doesn't fail the batch.
- **Live check.** Run `./run.sh leetcode profile lee215` once (a public profile) and show a trimmed output.
- **UI.** Run `node --check` on the changed JS. Take screenshots of the profile card, leaderboard, suggestions slide-over and the Settings LeetCode section, light and dark.

## Report
List the changed files, the pass/fail results, the live check output and the screenshot paths. Don't commit or push.
