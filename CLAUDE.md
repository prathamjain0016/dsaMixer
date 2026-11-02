# dsaMixer

A local planner (FastAPI, SQLite by default or Postgres, and a plain-JS Kanban UI) that turns two study tracks into a daily board:

- **DSA:** 507 interview questions from `data/DSA_Questions_and_Patterns_500.pdf`, mixed across topics every day, with spaced repetition and LeetCode contests. The default goal is the LeetCode Knight badge (rating ~1850) 26 weeks after the start date; the badge target (Knight, Guardian or a custom rating), deadline and an optional LeetCode username are set in the setup wizard or Settings > LeetCode.
- **AI course (optional):** a second track for a live course. The default template is an editable example of about 20h a week: a live class Sat and Sun 8:00–11:30 and two homeworks of about 4h each. The setup wizard rewrites it from your own class days, times and homework hours, or switches the track off (`ai_enabled`).

You log each day in the evening ("Close day"), and the app then plans the next day.

**First run:** with no saved setup (`settings.setup_done` missing) the UI shows a setup wizard (`GET/POST /api/setup`, `web/static/js/setup.js`) that writes the config, sets `setup_done` and `setup.started_on`, and plans today. A database that already has a saved config is treated as set up (`db.init()`). `./run.sh config import FILE` / `config export [FILE]` do the same from a JSON file (see `config.example.json` and `docs/guides/customise.md`).

**Storage:** by default your data lives in the SQLite file `dsamixer.db` (git-ignored). If `DATABASE_URL` is set in `.env`, the app uses that Postgres database instead. Treat whichever one is in use as the user's records. Setting `DSAMIXER_DB=<path>` forces SQLite, which is how tests run.

## Run

```sh
./run.sh                         # board at http://127.0.0.1:8765 (creates .venv on first run)
./run.sh today                   # today's plan in the terminal
./run.sh notify morning --dry-run
./run.sh schedule install        # launchd: board at login, 8:00/22:00 emails, 14:00/21:30 homework sync
./run.sh plan week [FROM] [--dry-run]  # re-lay the week's DSA and contests (default from tomorrow); --dry-run rolls back
./run.sh contests sync           # fetch LeetCode's upcoming Weekly/Biweekly into the cache (prints JSON)
./run.sh contests upcoming       # print the cached schedule
./run.sh leetcode sync           # your profile (leetcode.username): rating, auto-logged contests, solved suggestions
./run.sh leetcode profile USER   # any user's profile as JSON, nothing stored
./run.sh db info                 # which database is in use, with row counts
./run.sh setup status            # JSON: setup_done, backend, env_file, integrations (true/false), python, os, board_running
./run.sh config import FILE      # merge a full or partial config JSON over the current config; marks setup done
./run.sh config export [FILE]    # the effective config as JSON
```

**Setting up a new copy:** in Claude Code, `/setup` (`.claude/commands/setup.md`) is the recommended path. It checks the machine with `setup status`, interviews the user, writes `config.local.json` (git-ignored) and runs `config import`, explains which `.env` variable names to fill, offers the homework folder and `schedule install` (asking first), then starts and verifies the board. `/setup --reconfigure` re-runs the interview. It never reads `.env` and never asks for keys in chat; only the user edits `.env`. Without Claude Code, the browser wizard does the plan part on first run.

`.env` (copy `.env.example`) holds `DATABASE_URL`, `SMTP_*`/`MAIL_TO` for email, and `OPENROUTER_API_KEY` + `OPENROUTER_MODEL` (or `ANTHROPIC_API_KEY`) for the in-app weekly AI planner. `OPENROUTER_MODEL` overrides `ai_planner.openrouter_model` in config. Never read, print or commit it; `db.load_env()` loads it for the app.

## Code map

| File | What it does |
|---|---|
| `dsamixer/cli.py` | Every `./run.sh` command (`serve`, `today`, `notify`, `schedule`, `setup status`, `config import/export`, `db`, `plan`, `contests`, `leetcode`, `homework`, `tickets`). `__main__.py` just calls `cli.main()`. |
| `dsamixer/core/db.py` | Schema, `connect()` (Postgres via `PgConn` when `DATABASE_URL` is set, else SQLite), `init()` (seeds questions, small migrations), `copy_sqlite_to_pg()`, `load_env()`. |
| `dsamixer/core/config.py` | Every tunable default. Saved settings (`settings.config`) are merged over these; unset dates (`start_date`, `knight.deadline`, `contests.biweekly_anchor`) are resolved in `load()` without writing. Also `validate()` (config import), the setup-wizard builders (`from_setup`, `setup_answers`), and the badge target helpers (`BADGES` presets Knight ≈1850 / Guardian ≈2150, `set_badge`, `badge_label`, `clean_leetcode`). |
| `dsamixer/planning/planner.py` | Day planning, carry-over, topic mix, spaced repetition, contests, `update_ticket()` (changing `date` also sets `sprint_id` and moves the card to the end of that day). |
| `dsamixer/planning/stats.py` | Aggregates for the Stats and Sprint tabs, the week view (`week()`), and `build()` extras: `heatmap` (last 182 days: date, done, minutes) and `homework` (this week's `source='homework'` tickets grouped by goal: goal, done, total, minutes_left). `knight()` is the badge tracker: the config's `knight` block plus `label` ("Knight"/"Guardian"/"Rating"), `rating` from `leetcode_profile.contest.rating` when it matches `leetcode.username`, else the latest logged contest (`rating_source` says which), and `earned_badge`. |
| `dsamixer/integrations/ai_planner.py` | In-app weekly AI planner: an LLM (OpenRouter `OPENROUTER_MODEL`, or Anthropic) turns goals into tasks; `distribute()` spreads them over the days. |
| `dsamixer/integrations/leetcode.py` | `fetch_upcoming()` reads LeetCode's public GraphQL `upcomingContests` (stdlib urllib; `DSAMIXER_LEETCODE_URL` overrides the URL for tests). `sync(conn)` merges it into the settings cache `leetcode_contests` (keeps 21 days) and stores `leetcode_synced_at`. Runs best-effort at server startup and before `notify morning`. Profiles: `fetch_profile(username)` (normalized; `UserNotFound` is a distinct `LeetCodeError`), `sync_profile(conn)` for `leetcode.username` (caches `leetcode_profile`, auto-logs attended Weekly/Biweekly contests on or after `start_date` once by name plus an upsolve via `planner.add_upsolve`, and stores title-matched recent solves in `leetcode_suggestions` minus non-`new` and `leetcode_dismissed`), `accept_suggestion` (a done dsa ticket via `update_ticket`, so the 21-day check is scheduled), `fetch_friends(conn, force)` (one at a time, `leetcode_friends_cache`, 6 h). `sync_profile_quietly` runs right after the contest sync in the same two hooks. |
| `dsamixer/integrations/homework.py` | Homework helpers for the agents: week dates, `nbscan`, `pdftext`, `apply_plan`. |
| `dsamixer/integrations/notify.py` | Gmail SMTP morning/evening emails. |
| `dsamixer/web/server.py` | JSON API under `/api`, plus the static UI. `GET /api/week/{date}` is read-only (never plans a day): Mon–Sun with per-day budget, AI capacity, planned minutes and cards. LeetCode: `GET /api/leetcode/profile` (cached, never fetches; includes open suggestions), `POST /api/leetcode/sync` (404 unknown user, 502 network, 400 no username), `GET /api/leetcode/friends[?refresh=1]` (your row from the profile plus friends), `POST /api/leetcode/suggestions/{num}/accept|dismiss` and `/suggestions/accept-all`. `PUT /api/settings` trims `leetcode` and validates `knight`/`leetcode`. |
| `dsamixer/web/static/` | The UI, vanilla ES modules with no build step, styled as a Linear-like sidebar app: `index.html` (shell: sidebar, top bar, view), `css/` (`tokens.css` light/dark tokens, `base` shell, `components` one block per component, `views`), `js/main.js` (hash router `#/today[/date]`, `#/week[/date]`, `#/sprint`, `#/stats`, `#/contests`, `#/questions`, `#/ai`, `#/settings`; sidebar collapse `dsm.sidebar`; theme; streak; timer pill; opens the wizard first when `GET /api/setup` says `needed`), `js/setup.js` (the first-run setup wizard, also opened by Settings > Run setup again), `js/leetcode.js` (profile card, "solved on LeetCode" banner and slide-over, friends leaderboard; `#/questions/solved` opens the slide-over, `#/settings/leetcode` scrolls to that section), `js/components/` (HTML-string components: `primitives` Button/IconButton/Kbd/Badge/Segmented/Tabs, `data` Toolbar/Widget/Stat/Meter/ProgressRing/HBar/EmptyState/Table, `card` ticket Card, `overlay` SlideOver/Menu/Toast; `index.js` re-exports), `js/layout.js` (customizable widget grid, localStorage `dsm.layout.<page>`), `js/palette.js` (⌘K command palette), `js/ticket-panel.js` (card detail slide-over), `js/api.js`, `js/ui.js` (dialog/popover/drawer/tooltip; legacy helpers re-export components), `js/timer.js` (one timer, localStorage `dsm.timer`), `js/keys.js` (shortcuts, g-sequences), `js/charts.js` (hand-rolled SVG), `js/views/*.js` (one per route, each exports `render(root, arg)` and optionally `destroy()`). |
| `dsamixer/data/questions.json` | The 507 questions parsed from `data/DSA_Questions_and_Patterns_500.pdf`. |
| `notebooks/connection_check.ipynb` | Checks every external connection (PASS/FAIL/SKIP, no secrets printed). |

Imports go one way: `core` ← `planning` ← `integrations` ← `web`/`cli`. Don't import upward (e.g. `planning` must not import `integrations`).

**Tables:**
- `tickets`: one card per day. `kind` is dsa, review, ai, contest, upsolve, retro or custom; `status` is todo, doing, done or skipped; `source` is null, ai_plan or homework.
- `progress`: per-question spaced-repetition state.
- `days`: planned and closed state, `dsa_laid_at` (week layout), plus the evening log.
- `sprints`: one row per Mon–Sun week, with goal and retro.
- `contests`: logged contests. Auto-logged ones have `notes` starting "auto-logged from LeetCode" (the UI tags them).
- `ai_week_plans`, `ai_modules`, `settings` (config plus caches such as `leetcode_profile`, `leetcode_suggestions`, `leetcode_dismissed`, `leetcode_friends_cache`, `leetcode_contests`).

## How a day is planned (`planner.plan_day`)

Planning is idempotent: a day is planned once (`days.planned_at`). Today is planned when it's viewed, and tomorrow when today is closed. The steps, in order:

1. **Carry-over.** Every todo/doing card from earlier days moves to this day, and `carried` goes up by 1. A missed LIVE contest becomes `skipped` instead. On a rest day (`dsa_rest_days`, default Sat+Sun) `dsa` and `review` cards aren't moved; they wait for the next weekday.
2. **AI cards** come from `cfg.ai_template` for that weekday, unless an `ai_week_plans` row covers the day. In that case the planned tasks (weekly planner or homework agent) replace the generic cards. The Sat/Sun class cards always come from the template.
3. **Contests** are laid out for the whole week up front, the same way the DSA mix is: `plan_week_contests` runs right after `plan_week_dsa` and puts a contest card on every day from this date to Sunday that should have one (at most one per day; `_has_contest_card` skips days that already have one), so the Week view shows them before those days are planned. Which contest:
   - Weeks 1 to `virtual_until_week` (default 4): a virtual contest on Sunday.
   - From `weekly_live_from_week` (default 5): the live Weekly, Sun 8:00 IST (LeetCode's schedule). It clashes with class, so the class card becomes "recording".
   - From `biweekly_live_from_week` (default 9): the live Biweekly, Sat 20:00 IST, every 14 days from `biweekly_anchor`, unless the synced LeetCode cache (`leetcode_contests`) has a Biweekly on that date; a cache entry wins. With the cache, contest cards carry the real name and time ("Weekly Contest 531 — LIVE 08:00 IST"; `LIVE` stays in titles for carry-over), and virtual Sundays name the Weekly in the detail. With an empty cache nothing changes. The anchor is unset by default (the first Saturday of your first week, a guess); set the real one in Settings or rely on the synced cache.
4. **Sprint retro** card on the buffer day (Sunday).
5. **DSA**, filled against the weekday budget (`dsa_minutes`, set in the wizard; default 2h Mon–Fri, 0 on Sat/Sun):
   - **Week layout (`plan_week_dsa`):** right after carry-over, planning any weekday lays out the new-question mix for every non-rest weekday of that Mon–Sun week from that date on (date order, so the rotation flows Mon→Fri), so the Week view shows the whole week. `days.dsa_laid_at` marks a laid day; `planned_at` stays null until the day is planned normally. A laid day isn't re-mixed when it's planned, and carried cards don't add slots.
   - **Daily mix:** `mix.day_mix` gives the difficulties (Mon–Thu Hard + Medium + Easy, **Fri Medium + Easy** as a lighter catch-up day, Sat/Sun none). Every slot comes from a **different topic**, picked from a weighted rotation over all 13 sections (Graphs, DP and Trees count double; `rotation_pos` in settings). Within a topic, each difficulty follows PDF order.
   - **Rest days:** no DSA on Sat/Sun: no new questions, no reviews (`buffer_day_reviews` is 0; due reviews are `next_review <= day`, so weekend ones roll to Monday). Contests and upsolves are unchanged.
   - **Reviews:** next comes due spaced-repetition reviews in whatever time is left (carried work is counted first). There's at least 1 on weekdays.
   - **Extra Mediums** from unused topics, only if budget is still left, so they appear when there is no carry-over (typically Friday).
   - `replan_day` clears `dsa_laid_at`. `relayout_week(conn, from_day)` / `./run.sh plan week [FROM] [--dry-run]` drops untouched dsa cards (and untouched reviews on rest days) from FROM to Sunday and lays the week out again, including any missing contest cards (reported per day as `contest`).

**Spaced repetition** (`apply_review`, which runs when a dsa or review card first moves to Done):
- A confident first solve (confidence 4–5, no hints) gets one check after 21 days. If that passes, the question is mastered.
- Hints or confidence ≤2 means a review after 3 days; "couldn't solve" means after 1 day.
- After that, the intervals are `[3, 7, 21, 45]` days, and the question is mastered after the last one.

**Known trade-offs (with the default settings):**
- DSA is Mon–Fri only (about 15 new questions a week); the review backlog grows with that.
- The 84 Easy questions run out about 4 months in, after which the Easy slot takes the next available difficulty.
- The projected finish date uses the last 14 days' pace once that much data exists.

## Homework workflow (agents)

```
homework/
  week4/                   # N = COURSE week; done in sprint N - course_week_offset (with offset 3, week4 → sprint 1)
    hw1.ipynb              # whatever the course provides: notebooks, PDFs, notes
    assignment.pdf
    STATUS.md              # written ONLY by the agents (format below)
```

- Folders are named by **course week** (`week4`, `week5`, …; `week04`/`week-04` also work). `course_week_offset` in config (default 0) maps course week → sprint: with offset 3, course week 4 is done in sprint 1, the week of `start_date`. `./run.sh homework week N` prints the dates for course week N.
- **Deadline:** use the date in the assignment if it gives one. Otherwise it's **Saturday 08:00 of that week**, before the weekend class. Work is planned only on that week's remaining Mon–Fri.

**Two agents** live in `.claude/agents/`, with slash commands in `.claude/commands/`:

- **`homework-planner`** (`/homework-plan [course week]`):
  1. Reads the week folder: notebooks via `nbscan`, PDFs and notes.
  2. Splits each homework into checkable steps of 30–90 min, numbered like `HW1-Q2`, and estimates each one.
  3. Writes `STATUS.md`.
  4. Pipes a plan JSON into `./run.sh homework apply N -`.
  5. Records the returned ticket ids in `STATUS.md`.

  Running it again for the same week replaces planned cards that haven't been started.
- **`homework-tracker`** (`/homework-sync [week]`, also run headless at 14:00 and 21:30 by launchd):
  1. Runs `nbscan` on each notebook and compares it with `STATUS.md` and `./run.sh tickets list --source homework`.
  2. Ticks off steps with clear evidence and marks their tickets done with a note.
  3. Updates progress and the risk level.
  4. Adds a catch-up ticket only when a step is at risk and has no open ticket.

### Hard rules for agents

- **Only ever write `homework/**/STATUS.md`.** Never modify notebooks, PDFs or other homework files. Never write homework solutions. The user does the work; the agents plan and track it.
- **Use the CLI, never raw SQL**, to read or change tickets:
  - `homework week`, `homework nbscan`, `homework pdftext`, `homework apply`
  - `tickets list`, `tickets add`, `tickets update`

  All of them print JSON.
- **The tracker only moves tickets forward.** It may mark a ticket done, but never reopens, deletes or reschedules one the user has touched (`status != 'todo'`, or `carried > 0`). The planner's own carry-over already moves unfinished work forward.
- **Evidence for "done":** the step's code cells have real work (`has_work`), they were executed, and they show no error. If evidence is partial, write that in `STATUS.md`; don't tick the step.
- **Tokens:** keep a run cheap. Run `nbscan` instead of reading whole notebooks, and read a PDF only when a step is unclear.

- Read PDFs with `./run.sh homework pdftext FILE`. The Read tool can't render PDFs on this machine (no poppler).

**Permissions.** The scheduled sync runs `claude -p "/homework-sync" --permission-mode dontAsk`, which denies anything not pre-allowed. You keep these rules in `.claude/settings.json` (it is optional and local to your machine):

```json
{ "permissions": {
    "allow": ["Bash(./run.sh *)", "Edit(/homework/**/STATUS.md)"],
    "deny":  ["Read(/.env)", "Edit(/dsamixer.db)"] } }
```

Agents must not edit that file or add permissions themselves. Claude Code ignores these allow rules until you have trusted the folder (run `claude` here interactively once and accept the trust prompt). Without that, headless syncs get every `./run.sh` call denied and change nothing.

### STATUS.md format (keep it exactly parseable)

```markdown
# Course week 4 (sprint 1) · 2026-11-02 → 2026-11-06
Deadline: 2026-11-07 08:00 (default: before Saturday class)
Last sync: 2026-11-10 21:30 · Progress: 3/8 steps · Risk: ok | watch | behind

## HW1 · Transformer encoder (hw1.ipynb)
- [x] HW1-Q1 Scaled dot-product attention · 60m · #14
- [ ] HW1-Q2 Multi-head attention · 90m · #16 · partial: cells 7-9 empty
- [ ] HW1-Q3 Train on toy data · 90m · #18

## Log
- 2026-11-10 21:30 tracker: HW1-Q1 done (cells 2-4 executed, no errors) → #14 done
```

Risk:
- `behind` when the minutes left on unticked steps exceed the AI capacity left before the deadline.
- `watch` when they exceed 80% of it.
- `ok` otherwise.

Each step line ends with its ticket id (`#14`). The Log is append-only, with the newest entries at the bottom.

## Which model does what (suggested)

The agent files pin these models; change them if you prefer others.

- **Claude Opus 5.5 (`claude-opus-5-5`) for planning:** designing features, architecture decisions, debugging something not yet understood, reviewing a plan, and the `homework-planner` agent.
- **Claude Sonnet 5.5 (`claude-sonnet-5-5`) for routine work:** implementing an agreed plan, mechanical edits and refactors, writing and running tests or simulations, doc updates, and the `homework-tracker` agent plus the scheduled headless sync (`--model claude-sonnet-5-5`).
- When an Opus session hands implementation to a subagent, it gives that subagent `model: sonnet` (Claude Sonnet 5.5) and a precise spec, then reviews the result itself.
- This is about Claude Code only. The in-app "Break down with AI" button uses `OPENROUTER_MODEL` from `.env`.

## Conventions for changing code

- Match the existing style: small modules, raw SQL with `db.rows()`, no ORM, vanilla JS (no frameworks or build step), comments only where the reason isn't obvious.
- **Write SQL once, in SQLite style,** and keep it portable to Postgres: `?` placeholders, `datetime('now','localtime')` (both translated by `PgConn`), `ON CONFLICT ... DO UPDATE/NOTHING` (not `INSERT OR IGNORE`), `RETURNING id` (not `lastrowid`), `SUM(CASE WHEN ... THEN 1 ELSE 0 END)` (not summed booleans), `AS` on every alias, and no aliases in `HAVING`. Postgres returns `ROUND`/`AVG` results as `Decimal`.
- New settings go in `config.DEFAULTS` (and the Settings tab if users will tune them). Schema changes go in `db.SCHEMA`, plus an `ALTER TABLE` guard in `db.init()` for existing databases.
- **Never test against the real database.** Without `DSAMIXER_DB`, the app talks to the user's real data (their Postgres if `DATABASE_URL` is set, otherwise `dsamixer.db`). Copy `dsamixer.db` to a scratch path (or start from an empty file) and run with `DSAMIXER_DB=<copy>` (SQLite). Re-check Postgres-sensitive SQL by reading it against the rule above; only run against Postgres with the user's go-ahead. To exercise planner changes, simulate weeks: loop over days with `plan_day`, mark cards done with `update_ticket`, then `close_day`.
- `node --check` on each file in `dsamixer/web/static/js/` catches JS syntax errors (copy to `.mjs` if Node rejects the `import` lines). The UI can be screenshotted with headless Chrome: `--screenshot`, using URLs like `/?theme=dark#/stats` to open a route in a theme.
- Before changing anything that affects what the user sees or has logged (replanning today, deleting tickets, schema changes), say what will change and confirm with the user first.
- **Docs are Markdown files under `docs/`**, sorted by purpose: `architecture/` (how it works), `research/` (open investigations), `specs/` (build specs and agent briefs), and `BACKLOG.md` (parked ideas). List every new file in `docs/README.md`. This repo is public: don't link private pages (for example claude.ai artifacts) from docs.
