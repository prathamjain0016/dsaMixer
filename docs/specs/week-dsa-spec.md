# Spec: plan the week's DSA up front, weekends free, Friday as catch-up

The owner's decisions (2026-11-02):
- **Weekends:** no DSA on Saturday or Sunday. That means no new questions and no reviews, and unfinished DSA doesn't carry onto a weekend. Contests and upsolves stay as they are, on the Knight path.
- **Weekday budget:** stays at 2h, Mon–Fri. About 15 new questions a week.
- **Week laid out in advance:** the DSA for all of Mon–Fri is put on the board up front, so the Week view shows the whole week's questions.
- **Friday catch-up:** Friday's new questions are lighter (Medium + Easy, no Hard), leaving room for whatever carried over.
- **Adjusting:** carry-over stays as it is (unfinished cards move to the next planned day). Because days are laid out ahead, the existing "fill what's left" step does the adapting: carried work and reviews eat the budget first, and extra Mediums are added only when there is room.

## Changes

### 1. `dsamixer/core/config.py`
There are no saved overrides in the owner's DB, so the defaults apply directly.
- `dsa_minutes`: `sat` 0 (sun is already 0).
- `mix.day_mix`: `fri` becomes `["Medium", "Easy"]` and `sat` becomes `[]`.
- `buffer_day_reviews`: 0. Add a comment that weekend reviews roll to Monday because due reviews are `next_review <= day`.
- New key `dsa_rest_days: ["sat", "sun"]`. It must be configurable and appear in the Settings tab only if that tab already renders similar list settings; otherwise just the default.

### 2. `dsamixer/core/db.py`
Add `days.dsa_laid_at TEXT` to `SCHEMA` and an `ALTER TABLE` guard in `init()`, following the existing guard pattern. It must work on both SQLite and Postgres.

### 3. `dsamixer/planning/planner.py`
- **`plan_week_dsa(conn, cfg, day)`:** for every non-rest weekday of `day`'s Mon–Sun week with date ≥ `day`:
  - Skip it if `days.dsa_laid_at` is set or the day is before `start_date`.
  - Otherwise `_pick_mixed(conn, cfg, that_day, day_mix[wd])`, add the cards with `add_question_ticket`, and set `dsa_laid_at` with an upsert on `days`. Don't touch `planned_at`, so the day is still planned normally later.
  - Lay days out in date order so the rotation flows Mon→Fri. Each day keeps its own different-topic mix.
- **In `plan_day`:**
  - Call `plan_week_dsa(conn, cfg, day)` right after `_carry_over`, so planning the first weekday you view lays out the rest of the week.
  - If `dsa_laid_at` was already set for this day before this call, skip the `day_mix` `_pick_mixed` step. The day was laid out already; carried cards don't add new slots. Keep the review and extra-Medium steps exactly as they are; they adapt to what's left of the budget.
  - On a rest day (weekday in `dsa_rest_days`), skip the whole DSA fill: no reviews, no extras.
- **`_carry_over(conn, day, sprint)`:** on a rest day, don't move `dsa` or `review` cards; they stay on their date and the next weekday carries them. Other kinds (ai, contest, upsolve, custom) carry as before.
- **`_add_reviews`:** the buffer-day branch uses `buffer_day_reviews` (now 0). Make sure nothing adds the "minimum 1" review on a rest day.
- **`replan_day`:** after deleting fresh cards, also clear that day's `dsa_laid_at`, so it re-lays its mix.
- **New `relayout_week(conn, from_day)`:** this is for the one-off re-plan of the current week.
  1. For each date from `from_day` through that week's Sunday, delete `kind='dsa'` cards that are untouched: `status='todo'`, `carried=0`, `minutes_spent IS NULL`, `done_at IS NULL`. On rest days, also delete untouched `kind='review'` cards.
  2. Clear `dsa_laid_at` on those dates.
  3. Run `plan_week_dsa(conn, cfg, from_day)`.
  4. Return a summary listing the cards removed and added per day.

  Don't touch days before `from_day`.

Keep the SQL portable as CLAUDE.md requires: `?` placeholders, `ON CONFLICT`, no `INSERT OR IGNORE`, `AS` on aliases.

### 4. `dsamixer/cli.py`
Add `./run.sh plan week [FROM_DATE] [--dry-run]`, which calls `relayout_week`. It defaults to tomorrow and prints JSON: per day, the cards removed and added (num, title, difficulty, section). With `--dry-run`, do everything inside a transaction and roll back, so the owner can preview the result. Add it to README's command table and to CLAUDE.md.

### 5. UI (only if needed)
`stats.week()` / the Week view may treat a day as "Not planned yet" when `planned_at` is null even though it has laid-out cards. Make sure laid-out cards show in the Week column. The column can still show a subtle "not planned yet" note for the day's AI/reviews, but it must not hide the cards. Keep any change minimal, in the current redesigned UI style (`dsamixer/web/static`).

### 6. Docs
Update CLAUDE.md's "How a day is planned" section with the weekly layout, rest days, Friday catch-up and the `dsa_laid_at` column. Update the config summary if one exists.

## Testing (required, and never against the real DB)
- Copy `dsamixer.db` to the scratchpad (`<scratchpad>/weekdsa.db`) and run everything with `DSAMIXER_DB=<that copy>`.
- **Simulate 3 weeks from 2026-11-02:** for each day, `plan_day`, then mark cards done with `update_ticket` (result "solved", confidence 3). On some weekdays deliberately leave 1–2 DSA cards undone, then `close_day`. Assert:
  - Monday's planning lays out Mon–Fri. After that, Tue–Fri have dsa cards with `dsa_laid_at` set, and Mon–Thu each have Hard + Medium + Easy from 3 different sections.
  - Friday's laid mix is Medium + Easy.
  - Sat and Sun get 0 dsa/review cards. Unfinished Friday DSA shows up on Monday with carried ≥ 1, not on Saturday.
  - When a weekday has carried DSA, no extra Mediums are added and it isn't re-mixed. When Friday has no carry-over, its leftover budget gets reviews and then extras.
  - No question appears on two open tickets at once.
  - Contest and upsolve cards still appear as before (week 5+ Sunday live Weekly; virtual on Sundays in weeks 1–4).
- **Test `relayout_week`** on a scratch copy shaped like the owner's current week (Mon planned with 5 dsa cards, Tue–Fri with only ai cards and no `dsa_laid_at`): `plan week 2026-11-03 --dry-run` changes nothing, and without `--dry-run` it lays out Tue–Fri.
- Also run the new command against a fresh copy initialised via `db.init()`, to exercise the ALTER guard on an old schema.
- Run `node --check` on any JS you change.

## Report
Report the changed files, the simulation output (a per-day table of the first 2 weeks: date, kinds and counts, difficulties, sections), the assertion results, and the dry-run output from the owner-shaped scratch copy. **Do not run anything against the real Postgres DB.** The owner will confirm before the real re-plan.
