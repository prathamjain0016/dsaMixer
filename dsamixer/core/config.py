"""Default plan configuration. Everything here is editable from the Settings tab;
saved values are merged over these defaults."""
import copy
import json
import re
from datetime import date, timedelta

from . import db

WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]

DEFAULTS = {
    # None = the Monday of the week you first set the app up (see load()); sprint 1 starts there.
    "start_date": None,
    # Course week N is done in sprint N - offset. 0: your course week 1 is sprint 1.
    "course_week_offset": 0,
    # Display text only (class times in the wizard and docs). It does not shift any date logic.
    "timezone": "Asia/Kolkata",
    "buffer_day": "sun",                 # no new questions; absorbs carry-over
    # Daily DSA budget in minutes (new questions + reviews + upsolves).
    "dsa_minutes": {"mon": 120, "tue": 120, "wed": 120, "thu": 120, "fri": 120, "sat": 0, "sun": 0},
    # Time estimate per question used to fill the budget.
    "est_minutes": {"Easy": 20, "Medium": 35, "Hard": 55},
    "review_minutes": 10,                # outline the approach, code the key part
    "max_reviews_per_day": 3,
    # Weekend reviews roll to Monday on their own: due reviews are `next_review <= day`.
    "buffer_day_reviews": 0,
    # No DSA at all (new questions, reviews, carried dsa/review cards) on these weekdays.
    "dsa_rest_days": ["sat", "sun"],
    # Days until the next review, by step. Past the last step a question is mastered.
    "review_intervals": [3, 7, 21, 45],
    # Confident first solves (4-5, no hints) get a single check after this many days, then mastered.
    "confident_check_days": 21,
    # False = plan no AI-course cards at all (the AI tab and homework agents then have nothing to plan).
    "ai_enabled": True,
    # Recurring AI-course tickets per weekday (~20h/week). An editable example: the setup wizard
    # rewrites it from your class days, times and homework hours.
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
        # Any Saturday that has a Biweekly; verify on leetcode.com/contest. None = the first Saturday
        # of your first week (a guess; the synced LeetCode schedule overrides it when available).
        "biweekly_anchor": None,
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
            "fri": ["Medium", "Easy"],  # lighter Friday: room for catch-up
            "sat": [], "sun": [],
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
    # The contest-rating goal (the key is still "knight" for older configs). badge: "Knight", "Guardian"
    # or "Custom". The presets fill target_rating (approximate: LeetCode awards badges by percentile,
    # top 25% / top 5%), and it stays editable. deadline None = 26 weeks after start_date.
    "knight": {"badge": "Knight", "target_rating": 1850, "deadline": None},
    # Your LeetCode username (profile card, auto-logged contests, rating) and friends for the leaderboard.
    "leetcode": {"username": None, "friends": []},
    "ai_weekly_target_hours": 20,
}


BADGES = {"Knight": 1850, "Guardian": 2150}  # approx. preset ratings; "Custom" uses your own number


def set_badge(knight: dict, badge: str, target_rating=None) -> dict:
    """A new knight block for a badge choice. A preset fills its approximate rating unless a number is
    given (presets stay editable); Custom needs the number."""
    if badge not in (*BADGES, "Custom"):
        raise ValueError(f"badge must be one of {', '.join(BADGES)} or Custom")
    if target_rating is None:
        if badge == "Custom":
            raise ValueError("a Custom badge target needs a target_rating")
        target_rating = BADGES[badge]
    return {**knight, "badge": badge, "target_rating": int(target_rating)}


def badge_label(knight: dict) -> str:
    """'Knight', 'Guardian', or 'Rating' for a custom target (titles read '<label> tracker')."""
    return knight.get("badge") if knight.get("badge") in BADGES else "Rating"


def clean_leetcode(lc: dict) -> dict:
    """Trim the username (blank = None) and de-duplicate friends, keeping their order."""
    user = (lc.get("username") or "").strip() or None
    seen, friends = set(), []
    for f in lc.get("friends") or []:
        f = str(f).strip()
        if f and f.lower() not in seen and f.lower() != (user or "").lower():
            seen.add(f.lower())
            friends.append(f)
    return {**lc, "username": user, "friends": friends}


def _merge(base, over):
    out = copy.deepcopy(base)
    for k, v in (over or {}).items():
        out[k] = _merge(out[k], v) if isinstance(v, dict) and isinstance(out.get(k), dict) else v
    return out


def monday_of(day: date) -> date:
    return day - timedelta(days=day.weekday())


def resolve(cfg: dict, started_on: str | None = None, today: date | None = None) -> dict:
    """Fill the date settings that are None. Pure: reads nothing, writes nothing."""
    today = today or date.today()
    if not cfg.get("start_date"):
        cfg["start_date"] = monday_of(date.fromisoformat(started_on) if started_on else today).isoformat()
    start = date.fromisoformat(cfg["start_date"])
    if not cfg["knight"].get("deadline"):
        cfg["knight"]["deadline"] = (start + timedelta(weeks=26)).isoformat()
    if not cfg["contests"].get("biweekly_anchor"):
        cfg["contests"]["biweekly_anchor"] = (start + timedelta(days=5)).isoformat()
    return cfg


def load(conn) -> dict:
    """Defaults, then saved settings, then unset dates resolved. Never writes to the DB."""
    saved = db.get_setting(conn, "config", {}) or {}
    cfg = _merge(DEFAULTS, saved)
    if "badge" not in (saved.get("knight") or {}) and cfg["knight"]["target_rating"] != BADGES["Knight"]:
        cfg["knight"]["badge"] = "Custom"  # saved before badges existed: keep their own number
    return resolve(cfg, (db.get_setting(conn, "setup", {}) or {}).get("started_on"))


def ai_template(cfg: dict) -> dict:
    """The per-weekday AI cards, or nothing when the AI course is switched off."""
    return cfg["ai_template"] if cfg.get("ai_enabled", True) else {}


def save(conn, cfg: dict) -> None:
    db.set_setting(conn, "config", cfg)
    conn.commit()


# ---------- validation (config import) ----------

FREE_FORM = {"rotation_weights", "ai_template", "day_mix"}  # dicts whose keys aren't fixed by DEFAULTS
DATE_KEYS = {"start_date", "deadline", "biweekly_anchor"}
CLOCK = re.compile(r"^\d{1,2}:\d{2}$")
USERNAME = re.compile(r"^[A-Za-z0-9_.-]{1,40}$")


def validate(cfg, base=None, path="") -> list[str]:
    """Problems in a (partial) config, as readable strings. Unknown keys are errors, so typos show up."""
    base = DEFAULTS if base is None else base
    errs = []
    if not isinstance(cfg, dict):
        return [f"{path or 'config'}: expected an object"]
    for k, v in cfg.items():
        here = f"{path}.{k}" if path else k
        if k not in base:
            errs.append(f"{here}: unknown key")
            continue
        want = base[k]
        if here == "knight.badge":
            if v not in (*BADGES, "Custom"):
                errs.append(f"{here}: use Knight, Guardian or Custom")
        elif here == "leetcode.username":
            if v is not None and not (isinstance(v, str) and USERNAME.match(v.strip() or "-")):
                errs.append(f"{here}: expected a LeetCode username (letters, digits, - and _) or null")
        elif here == "leetcode.friends":
            if not (isinstance(v, list) and all(isinstance(f, str) and USERNAME.match(f.strip()) for f in v)):
                errs.append(f"{here}: expected a list of LeetCode usernames")
        elif k in DATE_KEYS:
            try:
                if v is not None:
                    date.fromisoformat(v)
            except (TypeError, ValueError):
                errs.append(f"{here}: expected a date like 2026-11-02 (or null)")
        elif isinstance(want, bool):
            if not isinstance(v, bool):
                errs.append(f"{here}: expected true or false")
        elif isinstance(want, (int, float)):
            if isinstance(v, bool) or not isinstance(v, (int, float)):
                errs.append(f"{here}: expected a number")
        elif isinstance(want, str):
            if not isinstance(v, str):
                errs.append(f"{here}: expected text")
        elif isinstance(want, list):
            if not isinstance(v, list):
                errs.append(f"{here}: expected a list")
        elif isinstance(want, dict):
            if k in FREE_FORM or k in ("dsa_minutes", "est_minutes"):
                errs += _check_weekday_dict(k, v, here)
            else:
                errs += validate(v, want, here)
    return errs


def _check_weekday_dict(key, v, here) -> list[str]:
    if not isinstance(v, dict):
        return [f"{here}: expected an object"]
    errs = []
    if key in ("dsa_minutes", "ai_template", "day_mix"):
        errs += [f"{here}.{d}: not a weekday (use mon..sun)" for d in v if d not in WEEKDAYS]
    if key == "est_minutes":
        errs += [f"{here}.{d}: use Easy, Medium or Hard" for d in v if d not in ("Easy", "Medium", "Hard")]
    if key in ("dsa_minutes", "est_minutes", "rotation_weights"):
        errs += [f"{here}.{d}: expected a number" for d, m in v.items() if isinstance(m, bool) or not isinstance(m, (int, float))]
    if key == "ai_template":
        for d, items in v.items():
            ok = isinstance(items, list) and all(isinstance(i, dict) and isinstance(i.get("title"), str)
                                                 and isinstance(i.get("minutes"), int) for i in items)
            if not ok:
                errs.append(f"{here}.{d}: expected a list of {{\"title\": text, \"minutes\": number}}")
    if key == "day_mix":
        for d, items in v.items():
            if not (isinstance(items, list) and all(x in ("Easy", "Medium", "Hard") for x in items)):
                errs.append(f"{here}.{d}: expected a list of Easy / Medium / Hard")
    return errs


# ---------- first-run setup wizard ----------

DEFAULT_CLASSES = [{"day": "sat", "start": "08:00", "minutes": 210}, {"day": "sun", "start": "08:00", "minutes": 210}]


def _clock_end(start: str, minutes: int) -> str:
    h, m = (int(x) for x in start.split(":"))
    t = (h * 60 + m + minutes) % (24 * 60)
    return f"{t // 60}:{t % 60:02d}"


def build_ai_template(classes: list[dict], homework_hours: float) -> dict:
    """Class cards on the class days, plus the homework hours spread over the free Mon-Fri days
    in sessions of at most 2 hours."""
    tpl = {d: [] for d in WEEKDAYS}
    class_days = set()
    for c in classes:
        start = c["start"] if CLOCK.match(c.get("start", "")) else "08:00"
        tpl[c["day"]].append({"title": f"AI live class {start}–{_clock_end(start, c['minutes'])}", "minutes": c["minutes"]})
        class_days.add(c["day"])
    free = [d for d in WEEKDAYS[:5] if d not in class_days] or WEEKDAYS[:5]
    total = round(homework_hours * 60 / 15) * 15
    if total > 0:
        n = min(len(free), max(1, -(-total // 120)))  # ceil(total / 120), capped by the free days
        share = round(total / n / 15) * 15 or 15
        for i, d in enumerate(free[:n]):
            tpl[d].append({"title": f"AI homework (session {i + 1}/{n})", "minutes": share})
    return tpl


def build_day_mix(rest_days: list[str], preset: str) -> dict:
    """preset 'hme' = Hard+Medium+Easy, 'me' = Medium+Easy. With 'hme' the last working day of the
    week drops the Hard (catch-up day)."""
    work = [d for d in WEEKDAYS if d not in rest_days]
    full = ["Medium", "Easy"] if preset == "me" else ["Hard", "Medium", "Easy"]
    mix = {d: [] for d in WEEKDAYS}
    for d in work:
        mix[d] = list(full)
    if preset != "me" and len(work) > 1:
        mix[work[-1]] = ["Medium", "Easy"]
    return mix


def from_setup(base: dict, a: dict) -> dict:
    """Apply wizard answers over a config (the saved one, or {}). Returns the config to save."""
    cfg = copy.deepcopy(base)
    start = monday_of(date.fromisoformat(a["start_date"]))
    cfg["start_date"] = start.isoformat()
    rest = [d for d in a["rest_days"] if d in WEEKDAYS]
    cfg["dsa_rest_days"] = rest
    cfg["dsa_minutes"] = {d: 0 if d in rest else int(a["dsa_minutes"]) for d in WEEKDAYS}
    cfg["mix"] = {**cfg.get("mix", {}), "enabled": True, "day_mix": build_day_mix(rest, a["mix"])}
    ai = a["ai"]
    cfg["ai_enabled"] = bool(ai["enabled"])
    cfg["timezone"] = ai.get("timezone") or cfg.get("timezone") or DEFAULTS["timezone"]
    if ai["enabled"]:
        classes = [c for c in ai.get("classes", []) if c.get("day") in WEEKDAYS and int(c.get("minutes", 0)) > 0]
        classes = [{**c, "minutes": int(c["minutes"])} for c in classes]
        cfg["ai_template"] = build_ai_template(classes, float(ai.get("homework_hours", 0)))
        cfg["ai_weekly_target_hours"] = round(sum(i["minutes"] for v in cfg["ai_template"].values() for i in v) / 60, 1)
    k = a["knight"]
    cfg["knight"] = set_badge({"deadline": k.get("deadline") or None}, k.get("badge") or "Knight", k.get("target_rating"))
    if a.get("leetcode") is not None:  # older wizard clients leave the username alone
        lc = {**DEFAULTS["leetcode"], **cfg.get("leetcode", {}), "username": (a["leetcode"] or {}).get("username")}
        cfg["leetcode"] = clean_leetcode(lc)
    n = int(a["contests"]["live_from_week"])
    # Same shape as the original plan: virtual contests first, the live Biweekly 4 weeks after the live Weekly.
    cfg["contests"] = {**cfg.get("contests", {}), "virtual_until_week": max(n - 1, 0),
                       "weekly_live_from_week": n, "biweekly_live_from_week": n + 4}
    errs = validate(cfg)
    if errs:
        raise ValueError("; ".join(errs))
    return cfg


def setup_answers(cfg: dict, saved: dict | None = None) -> dict:
    """The wizard's prefilled answers for a (resolved) config: sensible defaults for a fresh install,
    the current values when setup is re-run. `saved` is the raw saved config: a deadline that was
    never saved stays blank in the wizard ("26 weeks after the start") instead of pinning the computed date."""
    rest = list(cfg.get("dsa_rest_days", []))
    work = [cfg["dsa_minutes"].get(d, 0) for d in WEEKDAYS if d not in rest]
    mixes = [m for m in cfg["mix"]["day_mix"].values()]
    classes = []
    for d in WEEKDAYS:
        for i in cfg["ai_template"].get(d, []):
            m = re.search(r"(\d{1,2}:\d{2})", i["title"])
            if "class" in i["title"].lower():
                classes.append({"day": d, "start": m.group(1).zfill(5) if m else "08:00", "minutes": i["minutes"]})
    hw = sum(i["minutes"] for v in cfg["ai_template"].values() for i in v if "class" not in i["title"].lower())
    return {
        "start_date": cfg["start_date"],
        "dsa_minutes": max(work) if work else 120,
        "rest_days": rest,
        "mix": "hme" if any("Hard" in m for m in mixes) else "me",
        "ai": {"enabled": cfg.get("ai_enabled", True), "timezone": cfg["timezone"], "classes": classes or DEFAULT_CLASSES,
               "homework_hours": round(hw / 60, 1)},
        "knight": {"badge": cfg["knight"].get("badge", "Knight"), "target_rating": cfg["knight"]["target_rating"],
                   "deadline": cfg["knight"]["deadline"] if saved is None else (saved.get("knight") or {}).get("deadline")},
        "contests": {"live_from_week": cfg["contests"]["weekly_live_from_week"]},
        "leetcode": {"username": (cfg.get("leetcode") or {}).get("username")},
    }


def mark_setup(conn, started_on: str | None = None) -> None:
    """Record that setup is done (and when it began, which pins an unset start_date). Caller commits."""
    if db.get_setting(conn, "setup") is None:
        db.set_setting(conn, "setup", {"started_on": started_on or date.today().isoformat()})
    db.set_setting(conn, "setup_done", True)
