"""Weekly AI-course planner: Claude (via OpenRouter or the Anthropic API) breaks your goals into
tasks, code spreads them over the week.

The model only does the breakdown (it is good at turning "finish HW2 on transformers" into
concrete steps). Placement is deterministic: each goal's steps are spread in order across
all plan days, so every goal moves a little every day.
"""
import json
import os
from datetime import date, timedelta

from ..core import config, db
from ..planning import planner
from . import notify

SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "tasks": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "goal": {"type": "string"},
                    "title": {"type": "string"},
                    "minutes": {"type": "integer"},
                },
                "required": ["goal", "title", "minutes"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["summary", "tasks"],
    "additionalProperties": False,
}

SYSTEM = """You plan one week of study for a student taking a live AI/ML course alongside full-time work.
The student describes their goals for the week (homework, lectures to rewatch, topics to revise, projects).
Break every goal into concrete tasks of 30-90 minutes that each produce something checkable
(e.g. "Implement scaled dot-product attention and test on toy input", not "Study attention").
List each goal's tasks in the order they must be done. Use a short goal name (2-4 words) and keep
it identical across that goal's tasks. Keep the total close to the time budget you are given; if the
goals cannot fit, keep the most important work and say what you dropped in the summary.
The summary is 1-3 sentences addressed to the student."""


def plan_days(cfg, today: date | None = None) -> list[str]:
    """Remaining Mon-Fri of this week; from Saturday on, next week's Mon-Fri."""
    today = today or date.today()
    if today.weekday() >= 5:
        start = today + timedelta(days=7 - today.weekday())
    else:
        start = today
    monday = start - timedelta(days=start.weekday())
    return [(monday + timedelta(days=i)).isoformat() for i in range(start.weekday(), 5)]


def capacity(cfg, days: list[str]) -> dict[str, int]:
    """Daily AI minutes, taken from the weekday template (the generic cards it replaces)."""
    return {d: sum(i["minutes"] for i in cfg["ai_template"].get(planner.weekday_key(d), [])) for d in days}


class PlannerError(Exception):
    """A breakdown failure with the HTTP status the API should return."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


def provider(cfg) -> str:
    """'openrouter' or 'anthropic'. 'auto' picks OpenRouter when its key is set."""
    notify.load_env()
    choice = cfg["ai_planner"]["provider"]
    if choice == "auto":
        return "openrouter" if os.environ.get("OPENROUTER_API_KEY") else "anthropic"
    return choice


def model_name(cfg) -> str:
    """The model in use. For OpenRouter, OPENROUTER_MODEL in .env wins over the Settings value."""
    if provider(cfg) == "openrouter":
        return os.environ.get("OPENROUTER_MODEL") or cfg["ai_planner"]["openrouter_model"]
    return cfg["ai_planner"]["model"]


def breakdown(cfg, goals: str, days: list[str]) -> dict:
    budget = sum(capacity(cfg, days).values())
    prompt = (f"Plan days: {', '.join(days)} ({len(days)} days).\n"
              f"Time budget: {budget} minutes total.\n\nMy goals this week:\n{goals}")
    if provider(cfg) == "openrouter":
        return _breakdown_openrouter(cfg, prompt)
    return _breakdown_anthropic(cfg, prompt)


def _breakdown_anthropic(cfg, prompt: str) -> dict:
    import anthropic

    try:
        response = anthropic.Anthropic().beta.messages.create(
            model=cfg["ai_planner"]["model"],
            max_tokens=16000,
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            system=SYSTEM,
            output_config={"effort": cfg["ai_planner"]["effort"], "format": {"type": "json_schema", "schema": SCHEMA}},
            messages=[{"role": "user", "content": prompt}],
        )
    except (anthropic.AuthenticationError, TypeError):  # TypeError: SDK found no credentials at all
        raise PlannerError(401, "No valid API key. Add OPENROUTER_API_KEY or ANTHROPIC_API_KEY to .env and restart.")
    except anthropic.RateLimitError:
        raise PlannerError(429, "Rate limited by the Anthropic API. Try again in a minute.")
    except anthropic.APIConnectionError:
        raise PlannerError(503, "Couldn't reach the Anthropic API. Check your connection.")
    except anthropic.APIStatusError as e:
        raise PlannerError(502, f"Anthropic API error: {e.message}")
    if response.stop_reason == "refusal":
        raise PlannerError(422, "The model declined this request. Try rephrasing your goals.")
    if response.stop_reason == "max_tokens":
        raise PlannerError(422, "The plan was cut off. Try fewer goals or split the week.")
    return json.loads(next(b.text for b in response.content if b.type == "text"))


OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"


def _breakdown_openrouter(cfg, prompt: str) -> dict:
    """OpenRouter's chat-completions API over stdlib HTTP, with a JSON-schema response format."""
    import urllib.error
    import urllib.request

    body = {
        "model": model_name(cfg),
        "max_tokens": 16000,
        "messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": prompt}],
        "response_format": {"type": "json_schema",
                            "json_schema": {"name": "week_plan", "strict": True, "schema": SCHEMA}},
    }
    req = urllib.request.Request(OPENROUTER_URL, data=json.dumps(body).encode(), method="POST", headers={
        "Authorization": f"Bearer {os.environ['OPENROUTER_API_KEY']}",
        "Content-Type": "application/json",
        "X-Title": "dsaMixer",
    })
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            data = json.loads(r.read())
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")[:300]
        messages = {401: "OpenRouter rejected the API key. Check OPENROUTER_API_KEY in .env.",
                    402: "Your OpenRouter account is out of credits.",
                    429: "Rate limited by OpenRouter. Try again in a minute."}
        raise PlannerError(e.code if e.code in messages else 502, messages.get(e.code, f"OpenRouter error {e.code}: {detail}"))
    except (urllib.error.URLError, TimeoutError):
        raise PlannerError(503, "Couldn't reach OpenRouter. Check your connection.")
    if "error" in data:
        raise PlannerError(502, f"OpenRouter error: {data['error'].get('message', data['error'])}")
    choice = data["choices"][0]
    if choice.get("finish_reason") == "length":
        raise PlannerError(422, "The plan was cut off. Try fewer goals or split the week.")
    text = (choice["message"].get("content") or "").strip()
    if text.startswith("```"):  # tolerate a fenced reply if a model ignores the response format
        text = text.strip("`").removeprefix("json").strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        raise PlannerError(502, "The model didn't return a valid plan. Try again.")


def distribute(tasks: list[dict], days: list[str], capacity: dict[str, int] | None = None) -> list[dict]:
    """Spread each goal's tasks in order across the days, keeping each day within its capacity.

    Day cost: going over capacity costs far more than anything else; then each day's load should stay
    near its share of the total; then work slightly prefers earlier days (buffer before the deadline).
    Small plans (a week's homework) are solved exactly over every order-preserving split, with an extra
    term that keeps each goal progressing at a steady pace. Larger plans line the tasks up by progress
    through their goal and cut that line into one chunk per day.
    """
    if not tasks:
        return []
    goals = list(dict.fromkeys(t["goal"] for t in tasks))
    steps = {g: [t for t in tasks if t["goal"] == g] for g in goals}
    n, total = len(days), sum(t["minutes"] for t in tasks)
    cap = [capacity.get(d, total / n) if capacity else total / n for d in days]
    target = [c * total / sum(cap) for c in cap]

    def load_cost(d, load):
        return 1000 * max(0, load - cap[d]) + (load - target[d]) ** 2 + d * load / 10

    states = 1
    for g in goals:
        states *= len(steps[g]) + 1
    if states <= 600:
        placed = _distribute_exact(goals, steps, n, load_cost)
    else:
        placed = _distribute_line(tasks, goals, n, load_cost)
    out = [{**t, "date": days[d]} for t, d in placed]
    return sorted(out, key=lambda t: (t["date"], goals.index(t["goal"])))


def _distribute_exact(goals, steps, n, load_cost):
    """DP over (day, how many steps of each goal are done). Returns [(task, day index)]."""
    import itertools
    from functools import lru_cache

    mins = {g: [0] + list(itertools.accumulate(t["minutes"] for t in steps[g])) for g in goals}

    @lru_cache(maxsize=None)
    def solve(d, done):
        if d == n:
            return (0, ()) if all(done[i] == len(steps[g]) for i, g in enumerate(goals)) else (float("inf"), ())
        best = (float("inf"), ())
        ranges = [range(done[i], len(steps[g]) + 1) for i, g in enumerate(goals)]
        for nxt in itertools.product(*ranges):
            load = sum(mins[g][nxt[i]] - mins[g][done[i]] for i, g in enumerate(goals))
            # steady pace: each goal's finished share should track the share of days elapsed
            pace = sum((mins[g][nxt[i]] / mins[g][-1] - (d + 1) / n) ** 2 for i, g in enumerate(goals) if mins[g][-1])
            rest = solve(d + 1, nxt)
            c = load_cost(d, load) + 2000 * pace + rest[0]
            if c < best[0]:
                best = (c, (nxt,) + rest[1])
        return best

    _, path = solve(0, tuple(0 for _ in goals))
    placed, done = [], [0] * len(goals)
    for d, nxt in enumerate(path):
        for i, g in enumerate(goals):
            placed += [(t, d) for t in steps[g][done[i]:nxt[i]]]
        done = list(nxt)
    return placed


def _distribute_line(tasks, goals, n, load_cost):
    """Line tasks up by progress through their goal, then cut the line into n consecutive chunks."""
    totals = {g: sum(max(t["minutes"], 1) for t in tasks if t["goal"] == g) for g in goals}
    seen, staged = {g: 0 for g in goals}, []
    for k, t in enumerate(tasks):
        m = max(t["minutes"], 1)
        staged.append(((seen[t["goal"]] + m / 2) / totals[t["goal"]], k, t))
        seen[t["goal"]] += m
    line = [t for _, _, t in sorted(staged, key=lambda x: (x[0], x[1]))]
    prefix = [0]
    for t in line:
        prefix.append(prefix[-1] + t["minutes"])
    k = len(line)
    best = [[float("inf")] * (k + 1) for _ in range(n)]
    cut = [[0] * (k + 1) for _ in range(n)]
    for j in range(k + 1):
        best[0][j] = load_cost(0, prefix[j])
    for d in range(1, n):
        for j in range(k + 1):
            for i in range(j + 1):
                c = best[d - 1][i] + load_cost(d, prefix[j] - prefix[i])
                if c < best[d][j]:
                    best[d][j], cut[d][j] = c, i
    placed, j = [], k
    for d in range(n - 1, -1, -1):
        i = cut[d][j] if d else 0
        placed += [(t, d) for t in line[i:j]]
        j = i
    return placed


def preview(conn, goals: str) -> dict:
    cfg = config.load(conn)
    days = plan_days(cfg)
    if not days:
        raise ValueError("No plan days left this week.")
    result = breakdown(cfg, goals, days)
    return {
        "days": days,
        "capacity": capacity(cfg, days),
        "summary": result["summary"],
        "tasks": distribute(result["tasks"], days, capacity(cfg, days)),
    }


def apply(conn, goals: str, summary: str, tasks: list[dict]) -> int:
    """Put the (possibly edited) tasks on the boards and drop untouched generic AI cards on those days."""
    cfg = config.load(conn)
    days = sorted({t["date"] for t in tasks} | set(plan_days(cfg)))
    week_start = (planner.d(days[0]) - timedelta(days=planner.d(days[0]).weekday())).isoformat()
    template_titles = {i["title"] for items in cfg["ai_template"].values() for i in items}
    for day in days:
        for t in db.rows(conn.execute(
            "SELECT id,title,source FROM tickets WHERE date=? AND kind='ai' AND status='todo' AND carried=0", (day,)
        )):
            if t["title"] in template_titles or t["source"] == "ai_plan":
                conn.execute("DELETE FROM tickets WHERE id=?", (t["id"],))
    for t in tasks:
        planner._add(conn, t["date"], planner.ensure_sprint(conn, cfg, t["date"]), "ai", t["title"],
                     int(t["minutes"]), detail=t["goal"], source="ai_plan")
    conn.execute(
        """INSERT INTO ai_week_plans(week_start,days,goals,summary) VALUES(?,?,?,?)
           ON CONFLICT(week_start) DO UPDATE SET days=excluded.days, goals=excluded.goals,
           summary=excluded.summary, created_at=datetime('now','localtime')""",
        (week_start, json.dumps(days), goals, summary),
    )
    conn.commit()
    return len(tasks)


def api_key_configured() -> bool:
    notify.load_env()
    return any(os.environ.get(k) for k in ("OPENROUTER_API_KEY", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"))
