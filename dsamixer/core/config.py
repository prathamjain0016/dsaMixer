"""Default plan configuration. Everything here is editable from the Settings tab;
saved values are merged over these defaults."""
import copy

from . import db

WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]

DEFAULTS = {
    "start_date": "2026-11-02",          # a Monday; sprint 1 starts here
    "course_week_offset": 3,             # course week 4 is done in sprint 1 (homework/week4)
    "buffer_day": "sun",                 # no new questions; absorbs carry-over
    # Daily DSA budget in minutes (new questions + reviews + upsolves).
    "dsa_minutes": {"mon": 120, "tue": 120, "wed": 120, "thu": 120, "fri": 120, "sat": 90, "sun": 0},
    # Time estimate per question used to fill the budget.
    "est_minutes": {"Easy": 20, "Medium": 35, "Hard": 55},
    "review_minutes": 10,                # outline the approach, code the key part
    "max_reviews_per_day": 3,
    "buffer_day_reviews": 8,             # Sunday review blitz
    # Days until the next review, by step. Past the last step a question is mastered.
    "review_intervals": [3, 7, 21, 45],
    # Confident first solves (4-5, no hints) get a single check after this many days, then mastered.
    "confident_check_days": 21,
    # Recurring AI-course tickets per weekday (~20h/week).
    "ai_template": {
        "mon": [{"title": "AI homework 1 (part 1/2)", "minutes": 120}],
        "tue": [{"title": "AI homework 1 (part 2/2)", "minutes": 120}],
        "wed": [{"title": "AI homework 2 (part 1/2)", "minutes": 120}],
        "thu": [{"title": "AI homework 2 (part 2/2)", "minutes": 120}],
        "fri": [{"title": "AI recording rewatch + notes", "minutes": 150}],
        "sat": [{"title": "AI live class 8:00–11:30", "minutes": 210}],
        "sun": [{"title": "AI live class 8:00–11:30", "minutes": 210}],
    },
    "contests": {
        "virtual_until_week": 4,         # weeks 1-4: one virtual contest on the buffer day
        "weekly_live_from_week": 5,      # Sunday 8:00 AM IST Weekly contest
        "weekly_live": True,             # False = do Sunday's contest as a virtual after class
        "biweekly_live_from_week": 9,    # Saturday 8:00 PM IST Biweekly contest
        "biweekly_anchor": "2026-11-07", # any Saturday that has a Biweekly; verify on leetcode.com/contest
        "minutes": 90,
        "upsolve_minutes": 45,           # per unsolved problem
    },
    # Topic mixing: each slot is one question at that difficulty, every slot from a different
    # topic, picked from a weighted rotation over all sections (PDF order within a topic).
    "mix": {
        "enabled": True,
        "day_mix": {
            "mon": ["Hard", "Medium", "Easy"], "tue": ["Hard", "Medium", "Easy"],
            "wed": ["Hard", "Medium", "Easy"], "thu": ["Hard", "Medium", "Easy"],
            "fri": ["Hard", "Medium", "Easy"], "sat": ["Medium", "Easy"], "sun": [],
        },
        "rotation_weights": {"Graphs": 2, "Dynamic Programming": 2, "Trees": 2},  # others default to 1
    },
    # Weekly AI planner (AI course tab): Claude breaks your goals into tasks.
    # provider: "auto" uses OpenRouter when OPENROUTER_API_KEY is set, else the Anthropic API.
    "ai_planner": {
        "provider": "auto",
        "openrouter_model": "anthropic/claude-opus-5.5",  # used only when .env has no OPENROUTER_MODEL
        "model": "claude-opus-5-5",       # Anthropic API model id
        "effort": "medium",               # Anthropic API only
    },
    "knight": {"target_rating": 1850, "deadline": "2027-05-02"},
    "ai_weekly_target_hours": 20,
}


def _merge(base, over):
    out = copy.deepcopy(base)
    for k, v in (over or {}).items():
        out[k] = _merge(out[k], v) if isinstance(v, dict) and isinstance(out.get(k), dict) else v
    return out


def load(conn) -> dict:
    return _merge(DEFAULTS, db.get_setting(conn, "config", {}))


def save(conn, cfg: dict) -> None:
    db.set_setting(conn, "config", cfg)
    conn.commit()
