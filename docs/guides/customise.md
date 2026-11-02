# Customise dsaMixer

There are four ways to change how dsaMixer plans your days:

1. **The `/setup` command in Claude Code** (`/setup --reconfigure` once you are set up) interviews you, writes `config.local.json` and imports it.
2. **The setup wizard** (first run, or **Settings > Run setup again**) covers the common choices.
3. **The Settings tab.** The top sections cover budgets, estimates, contests and LeetCode (username, friends, badge target). **Advanced** holds the full config as JSON.
4. **A config file**, for people who prefer text. Copy [`config.example.json`](../../config.example.json), edit it, and import it:

   ```sh
   ./run.sh config export my-config.json   # your current config, every key filled in
   # edit my-config.json
   ./run.sh config import my-config.json
   ```

   JSON has no comments, so this page is the documentation for every key. Import checks the file first: an unknown key, a wrong type or a bad date is rejected with a message and nothing is saved. The file can hold every key or only a few. A valid file is merged over your current config (the defaults on a fresh install), so keys you leave out keep their current value; nested objects such as `mix` or `contests` are merged key by key too. The one exception is `ai_template`: it describes a whole week, so it is replaced as a unit, and a weekday you leave out of it gets no course cards. Importing also marks setup as done.

   Keep personal files as `config.local.json` in the project folder: that name is git-ignored. The Claude Code `/setup` command writes your answers there and imports it.

Saved settings apply from the next planned day. To use them for today, click **Replan today** in Settings (it rebuilds only today's untouched cards).

Weekday keys are always three lowercase letters: `mon tue wed thu fri sat sun`.

## Dates and weeks

| Key | Default | What it does |
|---|---|---|
| `start_date` | `null` | The Monday your sprint 1 starts. `null` means the Monday of the week you first set the app up. The wizard saves your choice (snapped to a Monday). Changing it later renumbers your weeks, so avoid that once you have history. |
| `course_week_offset` | `0` | Course week N is done in sprint N minus this number. Only the [homework agents](homework-agents.md) use it. |
| `timezone` | `"Asia/Kolkata"` | An IANA timezone name, used in display text only (the wizard's class times). It does **not** shift any dates or convert LeetCode's contest times, which are IST. |
| `buffer_day` | `"sun"` | The day with no new questions that absorbs carry-over. It gets the "Sprint retro" card. |

## DSA time

| Key | Default | What it does |
|---|---|---|
| `dsa_minutes` | `mon`-`fri`: `120`, `sat`/`sun`: `0` | The DSA budget in minutes per weekday. New questions, reviews and upsolves are filled up to this. |
| `dsa_rest_days` | `["sat", "sun"]` | Days with no DSA at all: no new questions, no reviews, and unfinished DSA cards aren't carried onto them. |
| `est_minutes` | `Easy` 20, `Medium` 35, `Hard` 55 | How long each difficulty is assumed to take when filling the budget. |
| `review_minutes` | `10` | Estimated minutes for one spaced-repetition review. |
| `max_reviews_per_day` | `3` | The most due reviews added to a working day. |
| `buffer_day_reviews` | `0` | How many due reviews to add on the buffer day (only matters if it isn't a rest day). |
| `review_intervals` | `[3, 7, 21, 45]` | Days until the next review, by step. After the last step a question counts as mastered. |
| `confident_check_days` | `21` | A confident first solve (confidence 4 or 5, no hints) gets a single check after this many days, then it is mastered. |

### Daily mix (`mix`)

| Key | Default | What it does |
|---|---|---|
| `mix.enabled` | `true` | `true` mixes topics. `false` falls back to plain list order: due reviews, then the next new questions until the budget is full. |
| `mix.day_mix` | Mon to Thu `["Hard", "Medium", "Easy"]`, Fri `["Medium", "Easy"]`, Sat/Sun `[]` | The difficulties of the new questions each weekday. Every slot comes from a **different topic**. Use `["Medium", "Easy"]` on every day if you are starting out. |
| `mix.rotation_weights` | `Graphs`, `Dynamic Programming`, `Trees`: `2` | How often each topic comes up in the rotation. Topics you don't list get `1`. The 13 topics are: `Arrays`; `Strings`; `Hashing, Math & Bit Manipulation`; `Linked Lists`; `Stacks & Queues`; `Binary Search`; `Trees`; `Graphs`; `Dynamic Programming`; `Backtracking`; `Greedy Algorithms`; `Heaps & Priority Queues`; `System Design & Data Structure Design`. Use the exact section names as they appear in the Questions tab. |

How the week is laid out: planning any weekday puts the new-question mix for every non-rest weekday of that week on the board, so the Week view shows the whole week. Carried-over cards take their own difficulty's slot, and reviews and extra Mediums fill whatever time is left.

## AI course track

| Key | Default | What it does |
|---|---|---|
| `ai_enabled` | `true` | `false` plans no AI-course cards at all (the generic template, class cards and capacity are all skipped). |
| `ai_template` | An example: Mon to Thu homework sessions of 120 min, Fri recording rewatch 150 min, Sat/Sun a live class 8:00 to 11:30 (210 min) | The recurring AI cards per weekday: `{"mon": [{"title": "...", "minutes": 120}], ...}`. It is an editable example. The wizard rewrites it from your class days and homework hours. A card whose title contains "class" is turned into a "recording" card when a live contest clashes on a Sunday. |
| `ai_weekly_target_hours` | `20` | The target shown on the Stats tab. The wizard sets it to your class hours plus homework hours. |

A weekly AI plan (the AI course tab or the homework agents) replaces the generic cards on the days it covers.

### AI planner (`ai_planner`)

| Key | Default | What it does |
|---|---|---|
| `ai_planner.provider` | `"auto"` | `"auto"` uses OpenRouter when `OPENROUTER_API_KEY` is set and Anthropic otherwise. You can force `"openrouter"` or `"anthropic"`. |
| `ai_planner.openrouter_model` | `"anthropic/claude-opus-5.5"` | The OpenRouter model, used only when `.env` has no `OPENROUTER_MODEL`. It must support structured outputs. |
| `ai_planner.model` | `"claude-opus-5-5"` | The model id when calling the Anthropic API directly. |
| `ai_planner.effort` | `"medium"` | Reasoning effort (Anthropic API only). |

Keys and setup: [integrations](integrations.md).

## Contests and your goal

LeetCode contests are fixed to the real schedule: the Weekly is on Sunday and the Biweekly on Saturday.

| Key | Default | What it does |
|---|---|---|
| `contests.virtual_until_week` | `4` | Weeks 1 to this number get one **virtual** contest on Sunday (any past Weekly, 90 minute timer). |
| `contests.weekly_live_from_week` | `5` | From this week the live Weekly is on the board on Sunday. If it clashes with a class card, the class becomes a "recording". |
| `contests.weekly_live` | `true` | `false` keeps Sunday's contest virtual (do it after class) even after `weekly_live_from_week`. |
| `contests.biweekly_live_from_week` | `9` | From this week the live Biweekly is on the board on Saturday. |
| `contests.biweekly_anchor` | `null` | Any Saturday that has a Biweekly. Biweeklies repeat every 14 days from it. `null` means the first Saturday of your first week, which is a guess. Set a real one (check leetcode.com/contest) or rely on the synced LeetCode schedule, which wins when it has data. |
| `contests.minutes` | `90` | The length of a contest card. |
| `contests.upsolve_minutes` | `45` | Minutes per unsolved problem on the upsolve card created when you log a contest. |
| `knight.badge` | `"Knight"` | The badge you aim for: `"Knight"`, `"Guardian"` or `"Custom"`. The tracker is titled after it ("Knight tracker", "Guardian tracker", or "Rating tracker" for a custom number). The key is still called `knight` so older configs keep working; a config saved before badges existed, with a target other than 1850, reads as `"Custom"`. |
| `knight.target_rating` | `1850` | The rating the tracker aims for. Picking Knight or Guardian in Settings or the wizard fills in about 1850 or about 2150. LeetCode awards these badges by percentile (top 25% and top 5% of contest ratings), so the numbers are approximate and stay editable. `"Custom"` needs your own number. |
| `knight.deadline` | `null` | The goal date. `null` means 26 weeks after `start_date`. |

## LeetCode profile (`leetcode`)

| Key | Default | What it does |
|---|---|---|
| `leetcode.username` | `null` | Your LeetCode username. When set, dsaMixer fetches your public profile (no login, nothing is posted) at board startup, in the morning job, from **Refresh** on the profile card, and with `./run.sh leetcode sync`. The badge tracker then uses your LeetCode contest rating; contests you took on or after `start_date` are logged automatically (with an upsolve card when you didn't solve them all); and questions you recently solved on LeetCode that match the list are offered as "already solved". `null` switches all of this off. |
| `leetcode.friends` | `[]` | Friends' usernames for the leaderboard on the Contests page. You can add and remove them there too. Their profiles are cached for 6 hours. |

Limits worth knowing: LeetCode only shares your ~20 most recent accepted submissions, so "already solved" catches recent solves, not your whole history. Contest history says how many problems you solved but not which ones, so auto-logged contests assume you solved them in order (Q1, Q2, …). Accepting a suggestion logs the question as a confident solve today, so it comes back once for a check after `confident_check_days`.

## Examples

**A gentler start** (60 minutes a weekday, no Hard questions):

```json
{
  "dsa_minutes": {"mon": 60, "tue": 60, "wed": 60, "thu": 60, "fri": 60, "sat": 0, "sun": 0},
  "mix": {"day_mix": {"mon": ["Medium", "Easy"], "tue": ["Medium", "Easy"], "wed": ["Medium", "Easy"],
                      "thu": ["Medium", "Easy"], "fri": ["Medium", "Easy"], "sat": [], "sun": []}}
}
```

**No course track:**

```json
{ "ai_enabled": false }
```

**Weekend DSA instead of Friday:**

```json
{
  "dsa_rest_days": ["fri", "sun"],
  "dsa_minutes": {"mon": 90, "tue": 90, "wed": 90, "thu": 90, "fri": 0, "sat": 120, "sun": 0},
  "mix": {"day_mix": {"mon": ["Medium", "Easy"], "tue": ["Medium", "Easy"], "wed": ["Medium", "Easy"],
                      "thu": ["Medium", "Easy"], "fri": [], "sat": ["Hard", "Medium"], "sun": []}}
}
```

Save any of these as a file (for example `config.local.json`) and run `./run.sh config import FILE`. Because import merges over your current config, only the keys you list change.

## Where things are stored

Your config is one JSON value in the `settings` table (key `config`). LeetCode data is cached in more `settings` keys: `leetcode_profile`, `leetcode_suggestions`, `leetcode_dismissed`, `leetcode_friends_cache` and the contest schedule (`leetcode_contests`, `leetcode_synced_at`). Setup progress is two more keys: `setup_done` and `setup` (which records the day you first set up). The defaults live in `dsamixer/core/config.py`.
