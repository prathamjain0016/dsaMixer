# Getting started

This guide takes you from a fresh clone to a planned first day. It needs about five minutes.

## What you need

- macOS or Linux. On Windows, use [WSL](https://learn.microsoft.com/windows/wsl/install) and run everything from the WSL shell.
- Python 3.10 or newer (`python3 --version`).
- A browser.

You don't need Postgres, an account or any API key. Everything else is optional (see [integrations](integrations.md)).

## Recommended: `/setup` in Claude Code

If you use [Claude Code](https://claude.com/claude-code), this is the quickest path:

```sh
git clone https://github.com/prathamjain0016/dsaMixer.git
cd dsaMixer
claude
```

Then type `/setup`. It:

1. checks your Python and OS, and installs the packages (`./run.sh setup status`);
2. asks about your DSA time, rest days, daily mix, course and goal, writes the answers to `config.local.json` (git-ignored) and imports them;
3. tells you which variable names to fill in `.env` for the integrations you pick. It never reads `.env` and never asks you to paste a key into the chat;
4. offers to create your homework folder and, on macOS, to install the background jobs (it asks first);
5. starts the board and shows today's cards.

Run `/setup --reconfigure` later to change your answers. The rest of this guide is the manual path, with the browser wizard.

## Alternative: the browser wizard

### 1. Clone and run

```sh
git clone https://github.com/prathamjain0016/dsaMixer.git
cd dsaMixer
./run.sh
```

On the first run, `run.sh` creates a private Python environment in `.venv`, installs the packages from `requirements.txt` and starts the board. Your data goes into a SQLite file, `dsamixer.db`, in the same folder. Open <http://127.0.0.1:8765>.

To use another port: `./run.sh serve --port 9000`.

### 2. Answer the setup wizard

The first time you open the board, a full-screen wizard asks seven short questions. Every step has a prefilled value, so you can click through it in a few seconds.

| Step | What it asks | What it changes |
|---|---|---|
| 1. Welcome | Nothing. It explains the daily loop. | |
| 2. Start date | When week 1 starts. | `start_date` (snapped to that week's Monday) |
| 3. DSA | Minutes per working day, rest days, and the daily mix: Hard + Medium + Easy, or Medium + Easy if you are starting out. | `dsa_minutes`, `dsa_rest_days`, `mix.day_mix` |
| 4. AI course | Course on or off. If on: class days, start times and lengths, homework hours per week, and your timezone. | `ai_enabled`, `ai_template`, `timezone` |
| 5. Contests | Target rating, goal deadline (blank means 26 weeks after the start), and the week live contests begin. | `knight`, `contests` |
| 6. Optional extras | Nothing. It explains `.env` and links to the guides. Keys are never typed into the page. | |
| 7. Review | A summary. **Finish and plan today** saves everything and plans today. | |

Re-running the wizard doesn't change cards already on your board, and you can change any answer later in **Settings**. **Settings > Run setup again** reopens the wizard with your current values.

## Use the board

1. **Morning:** open the board. Today's cards are in **To do**.
2. **During the day:** drag cards across the columns, or press `x` on a selected card. Finishing a DSA card asks for the result (solved, hints, couldn't), the minutes and your confidence from 1 to 5.
3. **Evening:** click **Close day**. Unfinished cards roll into tomorrow, and tomorrow is planned from what is left, including reviews that have come due.

Press `?` in the app for the keyboard shortcuts.

## Skipping the wizard

If you prefer a file to a form, copy [`config.example.json`](../../config.example.json), edit it, and run:

```sh
./run.sh config import my-config.json
```

That validates the file, saves it and marks setup as done, so the wizard won't appear. See [Customise](customise.md) for every key.

## Where your data lives

- `dsamixer.db` in the project folder (git-ignored). Back it up by copying the file while the board is stopped.
- If you set `DATABASE_URL` in `.env`, dsaMixer uses that Postgres database instead.

To try something without touching your real data, copy the file and point `DSAMIXER_DB` at the copy:

```sh
cp dsamixer.db /tmp/scratch.db
DSAMIXER_DB=/tmp/scratch.db ./run.sh today
```

## Troubleshooting

| Problem | Fix |
|---|---|
| `dsaMixer needs Python 3.10 or newer` | Install a newer `python3` (Homebrew, pyenv, or your distro's package). |
| The port is already in use | `./run.sh serve --port 8766`. |
| You want the wizard back on a fresh start | Stop the board, move `dsamixer.db` aside, and start again. This starts a new, empty history. |
| `Setup isn't done yet` in the terminal | Finish the wizard in the browser, or run `./run.sh config import config.example.json`. |
| Check which database is in use | `./run.sh db info`. |
| Check your integrations | Open `notebooks/connection_check.ipynb` with the `.venv` kernel and Run All. Missing integrations are reported as SKIP. |
