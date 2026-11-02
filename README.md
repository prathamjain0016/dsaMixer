# dsaMixer

A local Kanban-style daily planner for the 507-question DSA list and the AI course. You get a board of cards each day, log them at night, and the app plans tomorrow from what's left.

## Running it

```sh
./run.sh            # starts the board at http://127.0.0.1:8765
```

### What `./run.sh` does

`run.sh` is the single entry point for everything: the web app, the CLI and the scheduled jobs. Each time you run it, it:

1. **Switches to the project folder,** so it works from any directory (`~/Desktop/dsaMixer/run.sh today` is fine).
2. **Creates `.venv`** (a private Python environment) if it doesn't exist yet.
3. **Installs packages from `requirements.txt`** on the first run, and again whenever that file changes. A stamp file, `.venv/.installed`, records when it last installed. The packages are fastapi, uvicorn, anthropic, pypdf and psycopg.
4. **Runs `python -m dsamixer <your arguments>`** with the venv's Python. With no arguments, that means `serve`.

So `./run.sh tickets list` is exactly `.venv/bin/python -m dsamixer tickets list`. Every command below goes through `dsamixer/cli.py`.

**`serve`** starts a FastAPI server (uvicorn) on `127.0.0.1:8765`, reachable only from this Mac. It serves the board UI from `dsamixer/web/static/` and the JSON API under `/api`. On startup it creates any missing tables and plans today.

**Data:** every command reads `.env` and uses Postgres when `DATABASE_URL` is set, otherwise the SQLite file `dsamixer.db`. Setting `DSAMIXER_DB=/path/to/copy.db` forces SQLite, which is how tests run without touching your real data.

## Command reference

### Everyday

| Command | What it does |
|---|---|
| `./run.sh` | Start the board (same as `./run.sh serve`). Stop it with Ctrl+C. |
| `./run.sh serve --port 9000` | Start on another port (`--host` is also available). |
| `./run.sh today` | Print today's plan in the terminal. It also plans today if that hasn't happened yet. |
| `./run.sh plan week [FROM_DATE] [--dry-run]` | Re-lay the DSA from FROM_DATE (default tomorrow) to Sunday: untouched DSA cards are replaced with the new weekly layout. Prints JSON of cards removed and added per day; `--dry-run` previews and changes nothing. |

### Email and scheduling

| Command | What it does |
|---|---|
| `./run.sh notify morning --dry-run` | Show the morning plan email without sending it. |
| `./run.sh notify evening --dry-run` | Show the evening "close your day" reminder without sending it. |
| `./run.sh notify morning` / `evening` | Send that email for real (needs `SMTP_*` and `MAIL_TO` in `.env`). |
| `./run.sh contests sync` | Fetch LeetCode's upcoming Weekly/Biweekly (read-only public endpoint) into the cache, so contest cards show the real name and time. Also runs at server start and before the 8:00 email. |
| `./run.sh contests upcoming` | Print the cached contest schedule. |
| `./run.sh schedule install` | Install macOS launchd jobs: the board at login, the 8:00 email, the 22:00 reminder, and the homework sync at 14:00 and 21:30. |
| `./run.sh schedule remove` | Remove all of those jobs. |

Scheduled jobs only run while the Mac is awake. Their output goes to `logs/`.

### Database

| Command | What it does |
|---|---|
| `./run.sh db info` | Show which database is in use (`postgres` or `sqlite`) and the row count per table. |
| `./run.sh db copy-from-sqlite --yes` | **Replace all Postgres data** with `dsamixer.db`. Without `--yes` it only warns. |
| `./run.sh db copy-from-sqlite other.db --yes` | Same, from another SQLite file. |
| `pg_dump dsamixer > backup.sql` | Back up Postgres. This is a regular Postgres tool, not part of `run.sh`. |

### Homework (used by the agents, handy by hand too; all print JSON)

| Command | What it does |
|---|---|
| `./run.sh homework week` | Current sprint week: its folder, deadline, the days left to plan, and AI minutes per day. |
| `./run.sh homework week 3` | Same for week 3. |
| `./run.sh homework nbscan homework/week4/homework1.ipynb` | Per-cell progress of a notebook: real work or placeholder, run or not, errors. |
| `./run.sh homework pdftext homework/week4/assignment.pdf` | The text of a PDF. |
| `./run.sh homework apply 2 plan.json` | Put a homework plan on the boards (use `-` to read it from stdin). |

### Tickets (direct board edits from the terminal; all print JSON)

| Command | What it does |
|---|---|
| `./run.sh tickets list --from 2026-11-02 --to 2026-11-08` | Cards in a date range. You can filter with `--source homework` and `--kind ai`/`dsa`/... |
| `./run.sh tickets add --date 2026-11-04 --title "Read LoRA paper" --minutes 45` | Add a card. `--kind` defaults to `ai`; `--source` and `--detail` are optional. |
| `./run.sh tickets update 42 --status done --note "finished"` | Update a card. You can also change `--date`, `--title` and `--minutes-spent`. Marking a DSA card done updates spaced repetition, just like on the board. |

### Claude Code (inside a `claude` session in this folder)

| Command | What it does |
|---|---|
| `/homework-plan [course week]` | Read `homework/weekN/` and turn it into a `STATUS.md` checklist plus board tickets. |
| `/homework-sync [course week]` | Check notebook progress, then update `STATUS.md` and tick tickets done. |
| `claude -p "/homework-sync" --permission-mode dontAsk` | The same sync run headless, the way the 14:00 and 21:30 jobs run it. |

### Development

| Command | What it does |
|---|---|
| `cp dsamixer.db /tmp/t.db && DSAMIXER_DB=/tmp/t.db ./run.sh today` | Try anything on a scratch SQLite copy instead of your real data. |
| `for f in dsamixer/web/static/js/*.js dsamixer/web/static/js/views/*.js; do node --check $f; done` | Syntax-check the UI JavaScript (copy to `.mjs` first if Node rejects the `import` lines). |
| open `notebooks/connection_check.ipynb`, Run All | Check every external connection: Postgres, Gmail SMTP, OpenRouter, Anthropic, the board server, the Claude CLI and the launchd jobs. Prints PASS/FAIL/SKIP, never secrets. Use the `.venv` kernel. |
| `./run.sh --help`, `./run.sh tickets update --help` | Built-in help for any command. |

## Daily loop

1. **Morning:** open the board. Today's cards are already in **To do**.
2. **During the day:** drag cards across the columns. Dropping a DSA card into **Done** asks for the result (solved / hints / couldn't), minutes, confidence 1–5 and the key insight.
3. **Night:** click **Close day**, log your energy, AI topics and notes. Unfinished cards roll into tomorrow, and tomorrow is planned from that.

## How a day is planned

- **AI cards** come from the weekly template:
  - Mon–Tue: homework 1
  - Wed–Thu: homework 2
  - Fri: recording rewatch
  - Sat and Sun: live class
- **DSA budget** is minutes per weekday: 2h Mon–Fri, none on Saturday or Sunday (no new questions or reviews; weekend reviews roll to Monday). The whole Mon–Fri week is laid out when the week's first weekday is planned, so the Week view shows it up front. Questions are mixed across data structures:
  - **Mon–Thu:** 1 Hard + 1 Medium + 1 Easy, each from a **different topic**.
  - **Friday:** 1 Medium + 1 Easy, leaving room to catch up on carried work.
  - Topics come from a weighted rotation over all 13 sections. Graphs, DP and Trees appear twice per cycle. Within a topic, each difficulty follows PDF order.
  - Once a topic runs out of a difficulty, that slot takes the next topic that still has one. Once all the Easy questions are done (around 4 months in), the Easy slot is filled with a harder question.
  - The day is filled in this order: carried-over cards (they count toward their difficulty slot), the day's mix, due reviews in whatever time is left (at least 1), then extra Medium questions if there's still room.
- **Spaced repetition:** reviews are 10 min: outline the approach and code the key part.
  - A confident first solve (confidence 4–5) gets one check after 21 days, then counts as mastered.
  - Confidence 3, "needed hints" or confidence ≤2 brings the question back after 3 days, then 7, 21 and 45. "Couldn't solve" brings it back the next day.
- **Sprints** are Mon–Sun. Sunday is the buffer day: carry-over, the contest and the retro.
- **Contests**, aimed at Knight:
  - Weeks 1–4: a virtual contest each Sunday
  - Week 5 onward: the live Weekly, Sunday 8:00 AM IST
  - Week 9 onward: the live Biweekly, Saturday 8:00 PM IST
  - Logging a contest adds an upsolve card for its unsolved problems.
- **Pull next question** adds a Medium from a topic that isn't on today's board yet.

All of these values can be changed in **Settings**. **Replan today** rebuilds today's untouched cards after you change a setting.

## Weekly AI plan

In the **AI course** tab, describe the week's goals in detail: homework, lectures to rewatch, topics to revise. Then click **Break down with AI**.

- Claude turns each goal into 30–90 min tasks, kept in the order they need to be done.
- The app spreads each goal across the remaining Mon–Fri, so every goal moves forward most days and daily totals stay close to your AI time (2h Mon–Thu, 2.5h Fri). From Saturday on, it plans next week instead.
- You can edit, move or delete tasks in the preview. **Add to boards** then puts them on the daily boards and replaces the generic AI homework cards on those days. The Sat/Sun class cards stay.
- Running it again for the same week replaces the planned cards you haven't started.

**Setup:** add `OPENROUTER_API_KEY` to `.env`, or `ANTHROPIC_API_KEY` to call Anthropic directly. If the OpenRouter key is set, the app uses OpenRouter with the model named in `OPENROUTER_MODEL` in `.env` (for example `openai/gpt-4o-mini`). Without that variable it falls back to `ai_planner.openrouter_model` under Settings → Advanced. The model must support structured outputs on OpenRouter. Your goals text is sent to that provider, and each breakdown is a paid API call.

## AI syllabus

In the **AI course** tab, paste one module per line. The first unfinished module (or the one marked *in progress*) is shown on your AI cards.

## Homework agents

Drop each week's homework into `homework/weekN/`, where N is the **course week** (e.g. `homework/week4`). `course_week_offset` in Settings → Advanced maps it to dates: course week 4 is done Mon Nov 2 – Fri Nov 6. Then, in Claude Code, run `/homework-plan` to turn it into a STATUS.md checklist and board tickets, and `/homework-sync` to update progress from your notebooks. `./run.sh schedule install` also runs the sync at 14:00 and 21:30. CLAUDE.md has the full details.

**One-time setup for the scheduled sync:** run `claude` interactively in this folder once and accept the "trust this folder" prompt. Until you do, headless runs ignore `.claude/settings.json` and every `./run.sh` call is denied, so the sync does nothing.

## Email (optional)

Copy `.env.example` to `.env`, then fill in a personal Gmail address and an [App Password](https://support.google.com/accounts/answer/185833) (`SMTP_USER`, `SMTP_PASSWORD`, `MAIL_TO`). Preview with `./run.sh notify morning --dry-run`, and use `./run.sh schedule install` to send the emails automatically. Commands are in the reference above.

## Keyboard shortcuts

Ignored while typing in a field. `?` opens the same list in the app; `Esc` closes any dialog or drawer.

| Key | Where | Action |
|---|---|---|
| `1`–`8` | everywhere | Today, Week, Sprint, Stats, Contests, Questions, AI course, Settings |
| `j` / `k` or `↓` / `↑` | Today | select next / previous card (lane by lane, column by column) |
| `h` / `l` or `←` / `→` | Today | move the selected card to the previous / next column |
| `Enter` | Today | open the selected card (edit) |
| `x` | Today | mark the selected card done (quick log) |
| `Space` | Today | start / pause the timer on the selected card, else the Now card |
| `n` / `p` / `c` | Today | new card / pull next question / close day |
| `[` `]` | Today, Week | previous / next day (Today) or week (Week) |
| `.` | Today, Week | jump to today / this week |
| `/` | Questions | focus search |

The URL is `#/today`, `#/today/2026-11-05`, `#/week`, `#/week/2026-11-02`, `#/stats` … (old `#stats` links still work). `?theme=dark|light` forces a theme for that page load; the top-bar toggle remembers your choice.

## Where is what

```
dsaMixer/
├── README.md               ← you are here: how to use it
├── CLAUDE.md               ← how it works inside, written for Claude Code agents
├── run.sh                  ← the one command that runs everything
├── requirements.txt        ← Python packages (installed by run.sh)
├── .env / .env.example     ← your secrets and settings (DATABASE_URL, keys, Gmail)
├── dsamixer.db             ← SQLite backup from before Postgres (fallback, tests)
│
├── dsamixer/               ← the app (Python package)
│   ├── __main__.py         ← `python -m dsamixer` → cli.main()
│   ├── cli.py              ← every ./run.sh command (serve, today, db, homework, tickets…)
│   ├── core/               ← storage and settings
│   │   ├── db.py           ← Postgres/SQLite connection, schema, copy-from-sqlite
│   │   └── config.py       ← every tunable default (budgets, mix, contests, AI template…)
│   ├── planning/           ← what goes on your board
│   │   ├── planner.py      ← plan a day, carry-over, topic mix, spaced repetition, contests
│   │   └── stats.py        ← numbers for the Stats and Sprint tabs
│   ├── integrations/       ← outside services and files
│   │   ├── ai_planner.py   ← "Break down with AI" (OpenRouter / Anthropic)
│   │   ├── notify.py       ← morning/evening emails (Gmail SMTP)
│   │   ├── leetcode.py     ← sync the LeetCode contest calendar into the settings cache
│   │   └── homework.py     ← homework folder helpers for the agents (nbscan, pdftext, apply)
│   ├── web/                ← the board
│   │   ├── server.py       ← JSON API under /api
│   │   └── static/         ← the UI (vanilla ES modules, no build step)
│   │       ├── index.html  ← shell: top bar + <script type="module" src="/static/js/main.js">
│   │       ├── css/        ← tokens.css (light/dark), base.css, components.css, views.css
│   │       └── js/         ← main.js (hash router, theme, streak), api.js, ui.js (dialogs, tooltip, toast),
│   │                         timer.js, keys.js, charts.js (SVG), util.js, views/{today,week,sprint,
│   │                         stats,contests,questions,ai,settings}.js
│   └── data/
│       └── questions.json  ← the 507 questions parsed from the PDF
│
├── data/
│   └── DSA_Questions_and_Patterns_500.pdf   ← the source question list
├── homework/               ← drop homework here: homework/week4/, week5/ … (+ agent-written STATUS.md)
├── notebooks/
│   └── connection_check.ipynb  ← checks Postgres, Gmail, OpenRouter, server, Claude CLI
├── logs/                   ← output of scheduled jobs (created by `schedule install`)
└── .claude/                ← Claude Code setup
    ├── agents/             ← homework-planner, homework-tracker
    ├── commands/           ← /homework-plan, /homework-sync
    └── settings.json       ← what agents may do without asking
```

**Where to look when…**

| You want to… | Open |
|---|---|
| change how many questions/minutes a day, the difficulty mix, contests, AI hours | Settings tab, or the defaults in `dsamixer/core/config.py` |
| change *how* a day gets built | `dsamixer/planning/planner.py` (`plan_day`) |
| change the look of the board | `dsamixer/web/static/` |
| add an API endpoint | `dsamixer/web/server.py` |
| add a `./run.sh` command | `dsamixer/cli.py` |
| change the database or tables | `dsamixer/core/db.py` |
| change the AI breakdown prompt or model logic | `dsamixer/integrations/ai_planner.py` |
| change email text | `dsamixer/integrations/notify.py` |
| change what the homework agents do | `.claude/agents/*.md` (rules in CLAUDE.md) |

**Your data** lives in local Postgres (`DATABASE_URL` in `.env`); back it up with `pg_dump`. `dsamixer.db` is the SQLite snapshot from before the switch, and it's used whenever `DATABASE_URL` is removed.
