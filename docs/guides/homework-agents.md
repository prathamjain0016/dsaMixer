# Homework agents (Claude Code)

Two [Claude Code](https://claude.com/claude-code) agents plan and track your course homework on the board. They plan and tick things off. **They never write solutions**, and the only file they write is `STATUS.md`. The rules they follow are in the "Homework workflow (agents)" section of `CLAUDE.md`.

You need the `claude` CLI installed, and the AI course switched on in setup (`ai_enabled`), because homework tasks are AI-track cards.

## Folder layout

Put each week's material in a folder named after your **course week**:

```
homework/
  week4/
    hw1.ipynb            # whatever your course gives you: notebooks, PDFs, notes
    assignment.pdf
    STATUS.md            # written only by the agents
```

`week4`, `week04` and `week-04` all work. Everything in `homework/` except `homework/README.md` is git-ignored, so your coursework stays on your machine.

## Map course weeks to your calendar

dsaMixer weeks are numbered from your `start_date` (sprint 1 is the week it falls in). Your course may have started earlier or later. `course_week_offset` bridges the two:

> course week N is done in sprint N minus `course_week_offset`

Examples:

- Your course and dsaMixer both start in the same week: offset `0` (the default). Course week 1 is sprint 1.
- You joined dsaMixer in your course's 4th week: offset `3`. Course week 4 is sprint 1.

Set it in **Settings > Advanced** (the JSON), or in your config file. Then check the dates:

```sh
./run.sh homework week 4
```

It prints the folder, the deadline, the working days left and your AI minutes per day. The deadline is the date in the assignment if it gives one. Otherwise it is Saturday 08:00 of that week, before a weekend class. Work is planned only on that week's remaining Monday to Friday.

## Daily use

Run these inside a `claude` session started in the project folder.

| Command | What it does |
|---|---|
| `/homework-plan [course week]` | Reads the week folder, splits each homework into checkable 30 to 90 minute steps (`HW1-Q2`, ...), writes `STATUS.md`, and puts the steps on your board. Running it again replaces planned cards you haven't started. |
| `/homework-sync [course week]` | Scans your notebooks, ticks off steps that have clear evidence of being done, updates the progress and risk level, and marks their cards done. |

A step counts as done only when its code cells have real work, were executed and show no error. Partial evidence is noted in `STATUS.md` and not ticked. The tracker only moves cards forward: it never reopens, deletes or reschedules a card you have touched.

`STATUS.md` shows progress and risk (`ok`, `watch`, `behind`): `behind` when the minutes left on unticked steps exceed your remaining AI capacity before the deadline.

## One-time setup

1. Run `claude` interactively in the project folder once and accept the "trust this folder" prompt. Without that, Claude Code ignores the project's permission rules.
2. Create `.claude/settings.json` if it isn't there, so headless runs can call the CLI and edit only `STATUS.md`:
   ```json
   {
     "permissions": {
       "allow": ["Bash(./run.sh *)", "Edit(/homework/**/STATUS.md)"],
       "deny": ["Read(/.env)", "Edit(/dsamixer.db)"]
     }
   }
   ```
   The agents are not allowed to edit this file themselves.

## Scheduled sync (optional)

On macOS, `./run.sh schedule install` runs `claude -p "/homework-sync" --permission-mode dontAsk --model claude-sonnet-5-5` at 14:00 and 21:30. On Linux, add a cron entry (see [integrations](integrations.md#scheduling-the-emails)):

```cron
0 14 * * * cd /home/you/dsaMixer && claude -p "/homework-sync" --permission-mode dontAsk >> logs/sync.log 2>&1
30 21 * * * cd /home/you/dsaMixer && claude -p "/homework-sync" --permission-mode dontAsk >> logs/sync.log 2>&1
```

`--permission-mode dontAsk` denies anything not pre-allowed, which is why the settings file above matters.

## Use it with your own course

Nothing in the agents is tied to one course. To adapt them:

- Name folders after your course's weeks and set `course_week_offset`.
- Edit your class days and homework hours in setup (or `ai_template`), so the board has the right AI capacity per day.
- Change the models or wording in `.claude/agents/homework-planner.md` and `homework-tracker.md`. They pin `claude-opus-5-5` for planning and `claude-sonnet-5-5` for tracking.
- Keep the hard rules in `CLAUDE.md` (only write `STATUS.md`, use the CLI and never raw SQL). The agents read that file.

## Command line helpers

These print JSON and are what the agents call. They are handy by hand too:

```sh
./run.sh homework nbscan homework/week4/hw1.ipynb   # per-cell progress of a notebook
./run.sh homework pdftext homework/week4/assignment.pdf
./run.sh tickets list --source homework --from 2026-11-02 --to 2026-11-08
./run.sh tickets update 42 --status done --note "finished"
```
