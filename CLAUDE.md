# dsaMixer

A local planner (FastAPI + SQLite + a plain-JS Kanban UI) that turns two study tracks into a daily board:

- **DSA:** 507 interview questions from `data/DSA_Questions_and_Patterns_500.pdf`, mixed across topics every day, with spaced repetition and LeetCode contests. The goal is the Knight badge (rating ~1850) by 2027-05-02.
- **AI course:** about 20h a week. There's a live class Sat and Sun 8:00–11:30 IST (recordings available) and two homeworks a week of about 4h each.

The owner logs each day in the evening ("Close day"), and the app then plans the next day.

**Storage:** the real data lives in **local Postgres** (`DATABASE_URL` in `.env`, database `dsamixer`); treat it as the owner's records. `dsamixer.db` (SQLite) is the pre-Postgres snapshot, copied in on 2026-11-02 and kept as a backup. Setting `DSAMIXER_DB=<path>` forces SQLite, which is how tests run.

## Run

```sh
./run.sh                         # board at http://127.0.0.1:8765 (creates .venv on first run)
./run.sh today                   # today's plan in the terminal
./run.sh notify morning --dry-run
./run.sh schedule install        # launchd: board at login, 8:00/22:00 emails, 14:00/21:30 homework sync
./run.sh db info                 # which database is in use, with row counts
```

`.env` (copy `.env.example`) holds `DATABASE_URL`, `SMTP_*`/`MAIL_TO` for email, and `OPENROUTER_API_KEY` + `OPENROUTER_MODEL` (or `ANTHROPIC_API_KEY`) for the in-app weekly AI planner. `OPENROUTER_MODEL` overrides `ai_planner.openrouter_model` in config. Never read, print or commit it; `db.load_env()` loads it for the app.

## Code map

| File | What it does |
|---|---|
| `dsamixer/cli.py` | Every `./run.sh` command (`serve`, `today`, `notify`, `schedule`, `db`, `homework`, `tickets`). `__main__.py` just calls `cli.main()`. |
| `dsamixer/core/db.py` | Schema, `connect()` (Postgres via `PgConn` when `DATABASE_URL` is set, else SQLite), `init()` (seeds questions, small migrations), `copy_sqlite_to_pg()`, `load_env()`. |
| `dsamixer/core/config.py` | Every tunable default. Saved settings (`settings.config`) are merged over these. |
| `dsamixer/planning/planner.py` | Day planning, carry-over, topic mix, spaced repetition, contests, `update_ticket()` (changing `date` also sets `sprint_id` and moves the card to the end of that day). |
| `dsamixer/planning/stats.py` | Aggregates for the Stats and Sprint tabs, the week view (`week()`), and `build()` extras: `heatmap` (last 182 days: date, done, minutes) and `homework` (this week's `source='homework'` tickets grouped by goal: goal, done, total, minutes_left). |
| `dsamixer/integrations/ai_planner.py` | In-app weekly AI planner: an LLM (OpenRouter `OPENROUTER_MODEL`, or Anthropic) turns goals into tasks; `distribute()` spreads them over the days. |
| `dsamixer/integrations/homework.py` | Homework helpers for the agents: week dates, `nbscan`, `pdftext`, `apply_plan`. |
| `dsamixer/integrations/notify.py` | Gmail SMTP morning/evening emails. |
| `dsamixer/web/server.py` | JSON API under `/api`, plus the static UI. `GET /api/week/{date}` is read-only (never plans a day): Mon–Sun with per-day budget, AI capacity, planned minutes and cards. |
| `dsamixer/web/static/` | The UI, vanilla ES modules with no build step, styled as a Linear-like sidebar app: `index.html` (shell: sidebar, top bar, view), `css/` (`tokens.css` light/dark tokens, `base` shell, `components` one block per component, `views`), `js/main.js` (hash router `#/today[/date]`, `#/week[/date]`, `#/sprint`, `#/stats`, `#/contests`, `#/questions`, `#/ai`, `#/settings`; sidebar collapse `dsm.sidebar`; theme; streak; timer pill), `js/components/` (HTML-string components: `primitives` Button/IconButton/Kbd/Badge/Segmented/Tabs, `data` Toolbar/Widget/Stat/Meter/ProgressRing/HBar/EmptyState/Table, `card` ticket Card, `overlay` SlideOver/Menu/Toast; `index.js` re-exports), `js/layout.js` (customizable widget grid, localStorage `dsm.layout.<page>`), `js/palette.js` (⌘K command palette), `js/ticket-panel.js` (card detail slide-over), `js/api.js`, `js/ui.js` (dialog/popover/drawer/tooltip; legacy helpers re-export components), `js/timer.js` (one timer, localStorage `dsm.timer`), `js/keys.js` (shortcuts, g-sequences), `js/charts.js` (hand-rolled SVG), `js/views/*.js` (one per route, each exports `render(root, arg)` and optionally `destroy()`). |
| `dsamixer/data/questions.json` | The 507 questions parsed from `data/DSA_Questions_and_Patterns_500.pdf`. |
| `notebooks/connection_check.ipynb` | Checks every external connection (PASS/FAIL/SKIP, no secrets printed). |

Imports go one way: `core` ← `planning` ← `integrations` ← `web`/`cli`. Don't import upward (e.g. `planning` must not import `integrations`).

**Tables:**
- `tickets`: one card per day. `kind` is dsa, review, ai, contest, upsolve, retro or custom; `status` is todo, doing, done or skipped; `source` is null, ai_plan or homework.
- `progress`: per-question spaced-repetition state.
- `days`: planned and closed state, plus the evening log.
- `sprints`: one row per Mon–Sun week, with goal and retro.
- `contests`, `ai_week_plans`, `ai_modules`, `settings`.

## How a day is planned (`planner.plan_day`)

Planning is idempotent: a day is planned once (`days.planned_at`). Today is planned when it's viewed, and tomorrow when today is closed. The steps, in order:

1. **Carry-over.** Every todo/doing card from earlier days moves to this day, and `carried` goes up by 1. A missed LIVE contest becomes `skipped` instead.
2. **AI cards** come from `cfg.ai_template` for that weekday, unless an `ai_week_plans` row covers the day. In that case the planned tasks (weekly planner or homework agent) replace the generic cards. The Sat/Sun class cards always come from the template.
3. **Contests:**
   - Weeks 1–4: a virtual contest on Sunday.
   - From week 5: the live Weekly, Sun 8:00 IST. It clashes with class, so the class card becomes "recording".
   - From week 9: the live Biweekly, Sat 20:00, every 14 days from `biweekly_anchor`. That date isn't verified, so the owner should check it.
4. **Sprint retro** card on the buffer day (Sunday).
5. **DSA**, filled against the weekday budget (`dsa_minutes`):
   - **Daily mix:** `mix.day_mix` gives the difficulties (Mon–Fri Hard + Medium + Easy, Sat Medium + Easy, Sun none). Every slot comes from a **different topic**, picked from a weighted rotation over all 13 sections (Graphs, DP and Trees count double; `rotation_pos` in settings). Within a topic, each difficulty follows PDF order. Carried DSA cards fill their own difficulty slot.
   - **Reviews:** next comes due spaced-repetition reviews in whatever time is left. There's at least 1 on weekdays, and up to 8 on Sunday (the "blitz").
   - **Extra Mediums** from unused topics, if budget is still left.

**Spaced repetition** (`apply_review`, which runs when a dsa or review card first moves to Done):
- A confident first solve (confidence 4–5, no hints) gets one check after 21 days. If that passes, the question is mastered.
- Hints or confidence ≤2 means a review after 3 days; "couldn't solve" means after 1 day.
- After that, the intervals are `[3, 7, 21, 45]` days, and the question is mastered after the last one.

**Known trade-offs the owner has accepted:**
- The review backlog grows at roughly 17 new questions a week.
- The 85 Easy questions run out about 4 months in, after which the Easy slot takes the next available difficulty.
- The projected finish date uses the last 14 days' pace once that much data exists.

## Homework workflow (agents)

```
homework/
  week4/                   # N = COURSE week; done in sprint N - course_week_offset (week4 → sprint 1, Nov 2–6)
    hw1.ipynb              # whatever the course provides: notebooks, PDFs, notes
    assignment.pdf
    STATUS.md              # written ONLY by the agents (format below)
```

- Folders are named by **course week** (`week4`, `week5`, …; `week04`/`week-04` also work). `course_week_offset` in config (3) maps course week → sprint: course week 4 is done in sprint 1, Mon 2026-11-02. `./run.sh homework week N` prints the dates for course week N.
- **Deadline:** use the date in the assignment if it gives one. Otherwise it's **Saturday 08:00 of that week**, before class. Work is planned only on that week's remaining Mon–Fri.

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

- **Only ever write `homework/**/STATUS.md`.** Never modify notebooks, PDFs or other homework files. Never write homework solutions. The owner does the work; the agents plan and track it.
- **Use the CLI, never raw SQL**, to read or change tickets:
  - `homework week`, `homework nbscan`, `homework pdftext`, `homework apply`
  - `tickets list`, `tickets add`, `tickets update`

  All of them print JSON.
- **The tracker only moves tickets forward.** It may mark a ticket done, but never reopens, deletes or reschedules one the owner has touched (`status != 'todo'`, or `carried > 0`). The planner's own carry-over already moves unfinished work forward.
- **Evidence for "done":** the step's code cells have real work (`has_work`), they were executed, and they show no error. If evidence is partial, write that in `STATUS.md`; don't tick the step.
- **Tokens:** keep a run cheap. Run `nbscan` instead of reading whole notebooks, and read a PDF only when a step is unclear.

- Read PDFs with `./run.sh homework pdftext FILE`. The Read tool can't render PDFs on this machine (no poppler).

**Permissions.** The scheduled sync runs `claude -p "/homework-sync" --permission-mode dontAsk`, which denies anything not pre-allowed. The owner keeps these rules in `.claude/settings.json`:

```json
{ "permissions": {
    "allow": ["Bash(./run.sh *)", "Edit(/homework/**/STATUS.md)"],
    "deny":  ["Read(/.env)", "Edit(/dsamixer.db)"] } }
```

Agents must not edit that file or add permissions themselves. Claude Code ignores these allow rules until the owner has trusted the folder (run `claude` here interactively once and accept the trust prompt). Without that, headless syncs get every `./run.sh` call denied and change nothing.

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

## Which model does what

- **Claude Opus 5.5 (`claude-opus-5-5`) for planning:** designing features, architecture decisions, debugging something not yet understood, reviewing a plan, and the `homework-planner` agent.
- **Claude Sonnet 5.5 (`claude-sonnet-5-5`) for routine work:** implementing an agreed plan, mechanical edits and refactors, writing and running tests or simulations, doc updates, and the `homework-tracker` agent plus the scheduled headless sync (`--model claude-sonnet-5-5`).
- When an Opus session hands implementation to a subagent, it gives that subagent `model: sonnet` (Claude Sonnet 5.5) and a precise spec, then reviews the result itself.
- This is about Claude Code only. The in-app "Break down with AI" button uses `OPENROUTER_MODEL` from `.env`.

## Conventions for changing code

- Match the existing style: small modules, raw SQL with `db.rows()`, no ORM, vanilla JS (no frameworks or build step), comments only where the reason isn't obvious.
- **Write SQL once, in SQLite style,** and keep it portable to Postgres: `?` placeholders, `datetime('now','localtime')` (both translated by `PgConn`), `ON CONFLICT ... DO UPDATE/NOTHING` (not `INSERT OR IGNORE`), `RETURNING id` (not `lastrowid`), `SUM(CASE WHEN ... THEN 1 ELSE 0 END)` (not summed booleans), `AS` on every alias, and no aliases in `HAVING`. Postgres returns `ROUND`/`AVG` results as `Decimal`.
- New settings go in `config.DEFAULTS` (and the Settings tab if the owner will tune them). Schema changes go in `db.SCHEMA`, plus an `ALTER TABLE` guard in `db.init()` for existing databases.
- **Never test against the real database.** Without `DSAMIXER_DB`, the app talks to the owner's Postgres. Copy `dsamixer.db` to a scratch path and run with `DSAMIXER_DB=<copy>` (SQLite). Re-check Postgres-sensitive SQL by reading it against the rule above; only run against Postgres with the owner's go-ahead. To exercise planner changes, simulate weeks: loop over days with `plan_day`, mark cards done with `update_ticket`, then `close_day`.
- `node --check` on each file in `dsamixer/web/static/js/` catches JS syntax errors (copy to `.mjs` if Node rejects the `import` lines). The UI can be screenshotted with headless Chrome: `--screenshot`, using URLs like `/?theme=dark#/stats` to open a route in a theme.
- Before changing anything that affects what the owner sees or has logged (replanning today, deleting tickets, schema changes), say what will change and confirm with the owner first.
