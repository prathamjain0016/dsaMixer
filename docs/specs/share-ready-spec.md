# Spec: make dsaMixer ready to share with the AI course batch

Decided 2026-11-02. The owner is sharing dsaMixer with their AI course batch as a **public GitHub repo** (`prathamjain0016/dsaMixer`). Batchmates should be able to clone it, run it locally and customise it.

The owner's choices:
- **Personalisation:** both a first-run setup wizard in the UI and a documented config template.
- **Included features:** homework agents, weekly AI planner, email reminders, and docs/showcase.
- **Questions:** `dsamixer/data/questions.json` stays in the repo; it comes from course material the batch already has. The PDF is git-ignored.

Already done:
- The owner's effective config is saved in their own DB (`settings.config`), so changing `config.DEFAULTS` won't change their board.
- `homework/` (except `homework/README.md`), `data/*.pdf` and `.DS_Store` are git-ignored, and history was rewritten.

## Requirements

### 1. Generic defaults (`dsamixer/core/config.py`)
- **Dates:** `start_date: None` means "the Monday of the week the app is first set up". Resolve it in `config.load` when unset: use the stored `setup.started_on` if present, otherwise today's Monday. Never write to the DB during `load`.
- **Generic values:**
  - `course_week_offset: 0`
  - `knight.deadline: None`, meaning 26 weeks after `start_date`
  - `knight.target_rating: 1850`
- **AI course template:** stays as an editable example, including the class times. Add a `timezone` default of `Asia/Kolkata` used for display text only. Do **not** add timezone handling to the date logic in this change.
- **Behaviour parity:** with the owner's saved config, behaviour must be identical. Verify this by loading config on a scratch copy that has the owner's saved config and diffing it against the old DEFAULTS.

### 2. First-run setup wizard
- **Trigger:** when the settings key `setup_done` is missing, `GET /api/setup` returns `{needed: true, defaults}`. The UI shows a full-screen, multi-step wizard before the board.
- **Steps** (each with a sensible prefilled value):
  1. Welcome and how it works.
  2. Start date (default: this Monday).
  3. DSA minutes per weekday and rest days (default Mon–Fri 120, Sat/Sun rest). Daily mix preset: "Hard+Medium+Easy" or "Medium+Easy" for beginners.
  4. AI course: on/off. If on, class days, times and minutes, and homework hours per week. This writes `ai_template`. If off, no AI cards are planned; add an `ai_enabled` flag.
  5. Contests: Knight target rating, deadline, and the week to start live contests.
  6. Optional integrations: a short explanation that `.env` holds keys for the AI planner and email, with links to the docs. Never ask for keys in the UI.
  7. Review and finish.
- **Save:** `POST /api/setup` saves config with `config.save`, sets `setup_done` and `setup.started_on`, then plans today. Use existing components (`js/components/`) and the current Linear-style look.
- **Existing databases:** if `settings.config` already exists, treat setup as done and set `setup_done` in `init()`. This protects the owner's DB from ever seeing the wizard.
- **Re-running:** Settings gets a "Run setup again" button.

### 3. Config template for tinkerers
- Add `config.example.json`, documented with an adjacent `docs/guides/customise.md`, since JSON has no comments.
- Add `./run.sh config import FILE` and `./run.sh config export [FILE]`. Import merges over the defaults and validates the keys.

### 4. First-run experience without Postgres
- With no `.env` and no `DATABASE_URL`, `./run.sh` must work out of the box on SQLite (`dsamixer.db`). Verify this on a clean copy of the repo: `git clone` to the scratchpad, `./run.sh`, and the wizard appears.
- `.env.example` must make clear that everything in it is optional.
- `notebooks/connection_check.ipynb` must SKIP missing integrations cleanly.
- `run.sh` targets macOS and Linux. README notes that Windows users should use WSL. `schedule install` is macOS only (launchd), so print a clear message on other OSes, plus a cron example in the docs.

### 5. Owner-specific text
Remove or generalise mentions of the owner's personal schedule, dates and course in CLAUDE.md, README and the agent files. Keep the content structure, and use "you"/"the user" instead of "the owner". The agents must keep working: their `.claude/agents/*.md` files read CLAUDE.md.

Personal docs stay where they are: `docs/research/deployment.md` and `docs/BACKLOG.md`. Remove the claude.ai links at the top of the docs files, because those are private links.

### 6. Docs and showcase
- **README rewrite** for a newcomer, covering:
  - a one-paragraph pitch
  - 3–4 screenshots in `docs/images/`, taken from a seeded scratch DB with headless Chrome at 1440x900: Today light, Week, Stats dark, and the wizard
  - quickstart (clone, `./run.sh`, wizard)
  - features
  - how it plans your day (short)
  - optional integrations (AI planner key, Gmail app password, Claude Code agents)
  - customising
  - the commands table
  - project structure
  - contributing notes (vanilla JS, no build, portable SQL, tests on scratch DBs)
  - credits: the 507 questions come from the course's DSA list
- **`docs/guides/`:**
  - `getting-started.md`
  - `customise.md` (every config key, with what it does and its default)
  - `homework-agents.md` (how to use the Claude Code agents with your own course)
  - `integrations.md` (OpenRouter/Anthropic key, Gmail app password with steps, LeetCode sync)
- **Index:** list every new doc in `docs/README.md`.
- **License:** add MIT, with the copyright holder "Pratham Jain".

## Testing (never the owner's DB)
- Use scratch SQLite copies only, with `DSAMIXER_DB` pointing at the scratchpad, and port 8799 for servers.
- **Fresh clone path:**
  1. Clone the repo into the scratchpad. Run `./run.sh` there with `DSAMIXER_DB` set to a new file, so the wizard appears.
  2. Complete the wizard through the API, the same calls the UI makes.
  3. Check that the board plans correctly for a non-IST, beginner-style setup: 60 min/day, Medium+Easy, AI off.
- **Parity:** a scratch copy carrying the owner's saved config plans exactly the same cards before and after the change. Simulate 2 weeks with `plan_day`, `update_ticket` and `close_day`, and diff the results.
- **Wizard:** screenshot each step light and dark, and confirm no horizontal scroll at 390 px.
- **Code checks:** `node --check` all JS. Python imports must follow `core ← planning ← integrations ← web/cli`.
- **Secrets:** grep the tracked files for secrets, emails and personal paths (`/Users/prathamjain`). Report anything found; don't print secret values.

## Report
List the changed files, the test results (pass/fail), the screenshot paths, the clean-clone result, and anything skipped. Don't commit or push; the owner reviews first.
