---
description: Set up dsaMixer end to end — install, personalise your plan, optional integrations, start the board
argument-hint: "[--reconfigure]"
model: claude-opus-5-5
---

Set up dsaMixer for this user. Do it end to end, and ask before anything outward-facing. Read `CLAUDE.md` first.

Rules for the whole run:
- **Secrets.** Never read, print or edit `.env`, and never ask the user to paste keys into the chat. Keys go into `.env` by the user's own hand. You may copy `.env.example` to `.env` when `.env` doesn't exist yet.
- **Commands.** Use `./run.sh …` for everything. Don't write raw SQL.
- **Already set up.** If setup is already done and `$ARGUMENTS` isn't `--reconfigure`, don't overwrite the plan. Report the status and offer what's still missing.
- **Questions.** Ask with the AskUserQuestion tool. Group related questions, and always give the recommended default as the first option.

## 1. Check the machine
- Run `python3 --version`; 3.10 or newer is required. Note the OS: on macOS everything works. On Linux, everything except `schedule install`, which uses launchd; the docs give a cron example. On Windows, tell the user to use WSL and stop if they aren't in it.
- Run `./run.sh setup status`. The first run creates `.venv` and installs the requirements, which takes about a minute, so say so. It prints JSON: `setup_done`, `backend` (sqlite or postgres), `env_file` (whether `.env` exists), `integrations` (`ai_planner`, `email`, `postgres`, each true/false, worked out from which variable names are set; values are never printed), `python`, `os`, `schedule_supported` and `board_running` (whether something answers on 127.0.0.1:8765). A `db_error` field means the database couldn't be opened, usually a `DATABASE_URL` pointing at a Postgres that isn't running; tell the user and stop.

## 2. Personalise the plan
Skip this step when `setup_done` is true and there's no `--reconfigure`. Otherwise interview the user in two or three AskUserQuestion rounds:
1. **DSA:** the start date (default: this Monday), DSA minutes per weekday (default 120; offer 60, 90, 120, 150), rest days (default Sat and Sun), and the daily mix: "Hard + Medium + Easy" (default) or "Medium + Easy" for beginners.
2. **AI course:** on or off. If on: class days and times (default Sat and Sun, 8:00–11:30), homework hours per week (default 8), and which course week their first sprint is (this sets `course_week_offset`). If they're unsure, use the default of 0.
3. **Contests and goal:** a badge target of Knight (~1850, default), Guardian (~2150) or a custom rating. The badges are awarded by percentile, so the numbers are approximate. Also ask the deadline (default 26 weeks out), the week to start live contests (default 5), and their LeetCode username (optional).

Then:
- Read `config.example.json` and `docs/guides/customise.md` for the exact keys. Map the answers the way the browser wizard does:
  - start date → `start_date`, snapped to that week's Monday.
  - minutes and rest days → `dsa_minutes` (0 on rest days) and `dsa_rest_days`.
  - daily mix → `mix.day_mix` for all seven days: `[]` on rest days; with "Hard + Medium + Easy", the last working day of the week gets `["Medium", "Easy"]`.
  - AI course off → `"ai_enabled": false`. On → `"ai_enabled": true` and an `ai_template` that lists **all seven days** (a day left out gets no course cards): a class card such as `{"title": "AI live class 8:00–11:30", "minutes": 210}` on each class day (keep "class" in the title; Sunday class cards become recordings when a live contest clashes), and the homework hours split into sessions of at most 120 minutes on the free weekdays. Set `ai_weekly_target_hours` to the total and `course_week_offset` to their answer.
  - goal → `knight.badge` (`"Knight"`, `"Guardian"` or `"Custom"`) and `knight.target_rating`: 1850 for Knight, 2150 for Guardian, or their number for Custom (Custom always needs one). Leave `knight.deadline` as `null` for "26 weeks out".
  - live contests from week N → `contests.weekly_live_from_week: N`, `contests.virtual_until_week: N - 1`, `contests.biweekly_live_from_week: N + 4`.
  - LeetCode username → `leetcode.username` (letters, digits, `-`, `_` and `.`); leave it out, or `null`, if they skipped it. Friends for the leaderboard go in `leetcode.friends` (a list) only if they offer some; they can add them on the Contests page later.
- Write the answers as JSON to `config.local.json` (git-ignored), changing only the keys they answered. Import merges it over the current config, so keys you leave out keep their value.
- Run `./run.sh config import config.local.json`. If validation fails, it lists each bad key; fix the JSON and run it again. Importing also marks setup as done, so the browser wizard won't appear.
- Show a short summary of the plan they now have (`./run.sh config export` prints the effective config).

## 3. Optional integrations
Ask which ones they want: weekly AI planner, email reminders, Postgres instead of SQLite. Ask nothing more about integrations they don't pick. For each one they pick:
- If `.env` doesn't exist, copy `.env.example` to `.env`.
- Tell them exactly which variable names to fill in `.env`, and point them to the right section of `docs/guides/integrations.md`:
  - **AI planner:** `OPENROUTER_API_KEY` and `OPENROUTER_MODEL`, or `ANTHROPIC_API_KEY`.
  - **Email:** `SMTP_USER`, `SMTP_PASSWORD` and `MAIL_TO` (optionally `APP_URL`). `SMTP_PASSWORD` must be a Gmail App Password; work Google accounts usually block these.
  - **Postgres:** `DATABASE_URL`. If they already have data in SQLite, mention `./run.sh db copy-from-sqlite --yes`, which replaces everything in that Postgres database with `dsamixer.db`. Don't run it yourself.
- Wait until they say they're done, then run `./run.sh setup status` again and report which integrations show as configured.

## 4. Homework agents (only if the AI course is on)
- Explain the layout: `homework/weekN/` per course week, then `/homework-plan N` and `/homework-sync N`, as described in `homework/README.md`.
- Offer to create the folder for the current course week, empty. `./run.sh homework week` prints JSON whose `week` and `folder` fields give the number and the path.

## 5. Background jobs (macOS only)
Skip this on Linux (`schedule_supported` is false) and point to the cron example in `docs/guides/integrations.md`. On macOS, ask before installing anything. On yes, run `./run.sh schedule install`, which sets up:
- the board at login
- emails at 8:00 and 22:00
- the homework sync at 14:00 and 21:30

Mention that `./run.sh schedule remove` undoes it.

## 6. Start and verify
- If `board_running` was false and nothing is listening on 127.0.0.1:8765 now, start the board with `./run.sh` as a background command.
- Wait until `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8765/` returns 200.
- Run `./run.sh today` and show today's cards.
- Run `./run.sh contests sync`. If they gave a LeetCode username, also run `./run.sh leetcode sync`: it caches their profile, logs contests they took since the start date, and lists recently solved questions that match the list (they accept or dismiss those on the board). Report what it found in a line or two. A "not found" error means the username is wrong: offer to fix `leetcode.username` and import again. Report network failures as warnings, not errors.

## 7. Wrap up
Reply with:
- the board URL
- what's set up and what was skipped
- the 3 commands they'll use most: `./run.sh`, `/homework-plan N` and `./run.sh today`
- where to change things later: the Settings page, `./run.sh config import`, or `/setup --reconfigure`
