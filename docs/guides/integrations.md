# Optional integrations

dsaMixer works fully without any of these. Add one when you want it. All keys go in a `.env` file in the project folder, never in the browser:

```sh
cp .env.example .env
```

`.env` is git-ignored. Everything in `.env.example` is commented out, so uncomment only what you need. After editing `.env`, restart the board.

Run `notebooks/connection_check.ipynb` (kernel: this project's `.venv`) to test them. It reports PASS, FAIL or SKIP for each one and never prints a secret.

## Weekly AI planner

The **AI course** tab can turn your weekly goals into 30 to 90 minute tasks. It needs one API key. Each breakdown is a paid call, and your goals text is sent to the provider.

### OpenRouter

1. Create a key at <https://openrouter.ai/keys>.
2. Add it to `.env`:
   ```sh
   OPENROUTER_API_KEY=sk-or-...
   OPENROUTER_MODEL=openai/gpt-4o-mini
   ```
   Choose any OpenRouter model that supports structured outputs. If you leave `OPENROUTER_MODEL` out, the app uses `ai_planner.openrouter_model` from your config.
3. Restart the board. The AI course tab now shows the provider and the model in use.

### Anthropic API

Add `ANTHROPIC_API_KEY=sk-ant-...` to `.env` instead. With both keys set, OpenRouter wins when `ai_planner.provider` is `auto` (the default). Set `ai_planner.provider` to `anthropic` to force it. The model comes from `ai_planner.model`.

## Email reminders (Gmail)

dsaMixer can email you the day's plan at 8:00 and a "close your day" reminder at 22:00. It sends through Gmail's SMTP server with an app password, so your normal password is never used.

1. Use a personal Gmail account. Work (Google Workspace) accounts often block SMTP logins.
2. Turn on **2-Step Verification** for the account: <https://myaccount.google.com/security>.
3. Create an app password: <https://support.google.com/accounts/answer/185833>. Google shows 16 characters once. Copy them.
4. Add these to `.env` (no quotes, no trailing comments):
   ```sh
   SMTP_USER=you@gmail.com
   SMTP_PASSWORD=xxxx xxxx xxxx xxxx
   MAIL_TO=you@gmail.com
   APP_URL=http://127.0.0.1:8765
   ```
   `MAIL_TO` can be a different address. `SMTP_HOST` and `SMTP_PORT` are optional (default `smtp.gmail.com`, `465`).
5. Preview without sending: `./run.sh notify morning --dry-run`.
6. Send a real one: `./run.sh notify morning`.

If login fails, check that `SMTP_USER` is the exact account the app password was made for, that 2-Step Verification is still on, and that the app password still exists.

### Scheduling the emails

Emails are sent by running `./run.sh notify morning` and `./run.sh notify evening` at the right times.

**macOS.** `./run.sh schedule install` creates launchd jobs: the board at login, the 8:00 email, the 22:00 reminder, and (if you use the [homework agents](homework-agents.md)) the 14:00 and 21:30 sync. `./run.sh schedule remove` undoes it. Jobs run only while the Mac is awake, and their output goes to `logs/`.

**Linux, and anywhere else (cron).** `schedule install` prints a message and does nothing on other systems. Use cron instead. Run `crontab -e` and add (replace the path):

```cron
# dsaMixer: morning plan at 08:00, close-your-day reminder at 22:00
0 8  * * * cd /home/you/dsaMixer && ./run.sh notify morning >> logs/morning.log 2>&1
0 22 * * * cd /home/you/dsaMixer && ./run.sh notify evening >> logs/evening.log 2>&1
```

Create the `logs/` folder first (`mkdir -p logs`). To keep the board running, start it yourself with `./run.sh`, or use a systemd user service or `tmux`.

## LeetCode contest sync

No key needed. dsaMixer reads LeetCode's public contest schedule so contest cards show the real contest name and time, for example "Weekly Contest 531, LIVE 08:00 IST".

- It syncs when the board starts and before the morning email.
- Sync by hand: `./run.sh contests sync`. Show the cache: `./run.sh contests upcoming`.
- If the network is down, nothing breaks. The planner falls back to `contests.biweekly_anchor` and generic card titles.
- LeetCode's times are IST (Asia/Kolkata). The `timezone` setting is for display text only and does not convert them.

## LeetCode profile and friends

No key needed either. Set your username in **Settings > LeetCode** (or in the setup wizard, or `leetcode.username` in a config file) and dsaMixer reads your public profile from the same GraphQL endpoint. Nothing is ever posted to LeetCode.

- **When it syncs:** at board startup and before the morning email (right after the contest sync), from **Refresh** on the profile card, and with `./run.sh leetcode sync`. All of these are best-effort: a dead network or a wrong username never blocks the board.
- **What a sync does:** caches your profile for the profile card (Today and Stats); sets the badge tracker's current rating from your LeetCode contest rating; logs every contest you attended on or after `start_date` that isn't logged yet (tagged "from LeetCode" on the Contests page, with an upsolve card when you didn't solve all problems); and offers recent accepted solves that match the question list as "already solved" (a banner on Today and Questions).
- **Limits:** LeetCode shares only your ~20 most recent accepted submissions, so older solves won't be suggested. Contest history says how many problems you solved, not which, so auto-logged contests assume Q1, Q2, … in order. Titles are matched loosely (parentheses and punctuation ignored), so one LeetCode title can match two list entries, such as "Two Sum (sorted array)" and "Two Sum (HashMap)"; accept only the right one and dismiss the other.
- **Friends:** add usernames on the Contests page (or `leetcode.friends`). They're fetched one at a time and cached for 6 hours; **Refresh** re-fetches. A username that doesn't exist shows "Not found" without breaking the others.
- **Any profile, without storing it:** `./run.sh leetcode profile USER` prints the normalized profile as JSON.

## Claude Code homework agents

See [homework-agents.md](homework-agents.md). They need the [Claude Code](https://claude.com/claude-code) CLI, not an API key in `.env`.

## Postgres instead of SQLite

Only if you want it. Create a database and set `DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/dsamixer` in `.env`. The tables are created on first start. To move an existing SQLite history across: `./run.sh db copy-from-sqlite --yes` (this replaces everything in Postgres). Check with `./run.sh db info`.
