// First-run setup wizard: a full-screen, multi-step dialog shown before the board when the server says
// setup is needed (GET /api/setup), and again from Settings > "Run setup again".
// It collects answers, shows a review, then POSTs them to /api/setup (the server builds the config).
import { $, $$, esc, today as todayStr, mondayOf, fmtDay, addDays } from "./util.js";
import { api } from "./api.js";
import { icon } from "./icons.js";
import { Button, Segmented, toast } from "./components/index.js";

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_LABEL = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
const DAY_LONG = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };
const DOCS = "https://github.com/prathamjain0016/dsaMixer/blob/main/docs/guides/";
const STEPS = ["Welcome", "Start date", "DSA", "AI course", "Contests", "Integrations", "Review"];
const LONG_DATE = { weekday: "long", day: "numeric", month: "long", year: "numeric" };

/** Weekly new-question slots for the chosen days and mix (the same shape the server builds). */
function slotsPerWeek(a) {
  const work = DAYS.filter((d) => !a.rest_days.includes(d));
  const full = a.mix === "me" ? 2 : 3;
  return work.reduce((n, _d, i) => n + (a.mix !== "me" && work.length > 1 && i === work.length - 1 ? 2 : full), 0);
}

const classRow = (c, i) => `<div class="wz-class" data-i="${i}">
  <label class="field"><span class="f-label">Day</span><select data-k="day">${DAYS.map((d) => `<option value="${d}" ${c.day === d ? "selected" : ""}>${DAY_LONG[d]}</option>`).join("")}</select></label>
  <label class="field"><span class="f-label">Starts</span><input type="time" data-k="start" value="${esc(c.start)}"></label>
  <label class="field"><span class="f-label">Minutes</span><input type="number" data-k="minutes" min="15" step="15" value="${c.minutes}"></label>
  <button type="button" class="btn btn-ghost btn-md btn-icon wz-rm" aria-label="Remove class" data-tip="Remove">${icon("close")}</button>
</div>`;

const STEP_VIEWS = [
  // 1 Welcome
  (a, { rerun }) => `<h2>${rerun ? "Run setup again" : "Welcome to dsaMixer"}</h2>
    <p class="subtle">A daily board that mixes your DSA practice with an AI course (or any second study track). Answer a few questions and it plans your first day. You can change every answer later in Settings.</p>
    ${rerun ? `<div class="banner warn">${icon("alert")}<span>Finishing this replaces your DSA budget, rest days, daily mix, AI template, badge target, LeetCode username and contest weeks. Cards already on the board stay as they are.</span></div>` : ""}
    <ol class="wz-how">
      <li><b>Every morning</b> the board shows a mix of questions from different topics, due reviews, and your course tasks.</li>
      <li><b>Every evening</b> you tap <em>Close day</em>. What you didn't finish rolls into tomorrow.</li>
      <li><b>Spaced repetition</b> brings solved questions back for review, so they stick.</li>
    </ol>
    <p class="muted small">Everything stays on this computer. It takes about two minutes.</p>`,
  // 2 Start date
  (a) => `<h2>When does your plan start?</h2>
    <p class="subtle">Weeks run Monday to Sunday. Pick any day and dsaMixer starts week 1 on the Monday of that week.</p>
    <label class="field"><span class="f-label">Start date</span><input type="date" id="wzStart" class="fit" value="${esc(a.start_date)}"></label>
    <p class="muted small" id="wzStartNote"></p>`,
  // 3 DSA
  (a) => `<h2>Your DSA time</h2>
    <p class="subtle">How many minutes can you give DSA on a working day, and which days are rest days (no DSA at all)?</p>
    <label class="field"><span class="f-label">Minutes per working day</span><input type="number" id="wzMin" class="fit" min="15" step="15" value="${a.dsa_minutes}"><span class="f-hint">A Medium takes about 35 minutes, an Easy 20, a Hard 55.</span></label>
    <div class="field"><span class="f-label">Rest days</span><div class="wz-chips" role="group" aria-label="Rest days">${DAYS.map((d) =>
      `<label class="chip"><input type="checkbox" data-rest="${d}" ${a.rest_days.includes(d) ? "checked" : ""}><span>${DAY_LABEL[d]}</span></label>`).join("")}</div></div>
    <div class="field"><span class="f-label">Daily mix</span>${Segmented("wzMix", [["hme", "Hard + Medium + Easy"], ["me", "Medium + Easy"]], a.mix)}
      <span class="f-hint">Pick Medium + Easy if you're starting out. Each slot comes from a different topic.</span></div>
    <p class="muted small" id="wzSlots"></p>`,
  // 4 AI course
  (a) => `<h2>Your course</h2>
    <p class="subtle">Do you follow a live course or study programme you want on the same board? Turn it off and no course cards are planned.</p>
    <div class="field"><span class="f-label">Course cards</span>${Segmented("wzAi", [["on", "On"], ["off", "Off"]], a.ai.enabled ? "on" : "off")}</div>
    <div id="wzAiBody" ${a.ai.enabled ? "" : "hidden"}>
      <div class="field"><span class="f-label">Live classes</span><div id="wzClasses">${a.ai.classes.map(classRow).join("")}</div>
        <div>${Button({ label: "Add a class", icon: "plus", kind: "ghost", size: "sm", id: "wzAddClass" })}</div></div>
      <label class="field"><span class="f-label">Homework and self-study hours per week</span><input type="number" id="wzHw" class="fit" min="0" step="0.5" value="${a.ai.homework_hours}"><span class="f-hint">Spread over your weekdays in sessions of up to 2 hours.</span></label>
      <label class="field"><span class="f-label">Your timezone (shown in text only)</span><input type="text" id="wzTz" class="fit" value="${esc(a.ai.timezone)}" placeholder="Asia/Kolkata"></label>
    </div>`,
  // 5 Contests
  (a) => `<h2>Contests and your goal</h2>
    <p class="subtle">dsaMixer plans LeetCode contests and tracks your rating. Early weeks use a virtual contest on Sunday; later weeks switch to the live Weekly.</p>
    <div class="field"><span class="f-label">Badge target</span>${Segmented("wzBadge", [["Knight", "Knight ≈1850"], ["Guardian", "Guardian ≈2150"], ["Custom", "Custom"]], a.knight.badge || "Knight")}
      <span class="f-hint">Approximate: LeetCode awards Knight to the top 25% and Guardian to the top 5% of contest ratings, so the numbers move. You can edit the rating.</span></div>
    <div class="form-grid wz-grid">
      <label class="field"><span class="f-label">Target rating</span><input type="number" id="wzRating" min="800" max="3500" step="10" value="${a.knight.target_rating}"></label>
      <label class="field"><span class="f-label">Live contests from week</span><input type="number" id="wzLive" min="1" max="52" value="${a.contests.live_from_week}"></label>
    </div>
    <label class="field"><span class="f-label">Your LeetCode username (optional)</span><input type="text" id="wzLc" class="fit" value="${esc(a.leetcode?.username || "")}" placeholder="e.g. lee215" autocomplete="off" spellcheck="false" maxlength="40"><span class="f-hint">Keeps your rating current, logs contests you take and spots questions you already solved. Public profile data only.</span></label>
    <label class="field"><span class="f-label">Goal deadline</span><input type="date" id="wzDeadline" class="fit" value="${esc(a.knight.deadline || "")}"><span class="f-hint" id="wzDeadlineNote"></span></label>`,
  // 6 Integrations
  () => `<h2>Optional extras</h2>
    <p class="subtle">The board works fully without these. To switch them on later, copy <code>.env.example</code> to <code>.env</code> and fill in what you want. Keys are never typed into this page.</p>
    <ul class="wz-list">
      <li><b>Weekly AI planner.</b> Breaks your weekly goals into tasks. Needs an OpenRouter or Anthropic key. <a href="${DOCS}integrations.md" target="_blank" rel="noopener">How to set it up</a></li>
      <li><b>Email reminders.</b> A morning plan and an evening nudge through a Gmail app password. <a href="${DOCS}integrations.md" target="_blank" rel="noopener">Steps</a></li>
      <li><b>Claude Code homework agents.</b> Plan and track course homework from your own folders. <a href="${DOCS}homework-agents.md" target="_blank" rel="noopener">Guide</a></li>
    </ul>`,
  // 7 Review
  (a) => {
    const work = DAYS.filter((d) => !a.rest_days.includes(d));
    const row = (k, v) => `<div class="wz-row"><dt>${k}</dt><dd>${v}</dd></div>`;
    const cls = a.ai.classes.map((c) => `${DAY_LABEL[c.day]} ${esc(c.start)} (${c.minutes} min)`).join(", ") || "none";
    return `<h2>Review and finish</h2>
      <dl class="wz-review">
        ${row("Starts", `Week 1 on ${fmtDay(mondayOf(a.start_date), LONG_DATE)}`)}
        ${row("DSA", `${a.dsa_minutes} min on ${work.map((d) => DAY_LABEL[d]).join(", ") || "no days"}${a.rest_days.length ? `; rest ${a.rest_days.map((d) => DAY_LABEL[d]).join(", ")}` : ""}`)}
        ${row("Daily mix", `${a.mix === "me" ? "Medium + Easy" : "Hard + Medium + Easy"} (about ${slotsPerWeek(a)} new questions a week)`)}
        ${row("Course", a.ai.enabled ? `On: classes ${cls}; ${a.ai.homework_hours} h/week of homework` : "Off")}
        ${row("Goal", `${a.knight.badge === "Custom" ? "Rating" : `${esc(a.knight.badge)} (approx.)`} ${a.knight.target_rating} by ${a.knight.deadline ? fmtDay(a.knight.deadline, { day: "numeric", month: "short", year: "numeric" }) : "26 weeks after the start"}`)}
        ${row("Contests", `Live from week ${a.contests.live_from_week}`)}
        ${row("LeetCode", a.leetcode?.username ? esc(a.leetcode.username) : "Not connected")}
      </dl>
      <p class="muted small">Finishing saves these settings and plans today. Nothing leaves this computer.</p>`;
  },
];

/** Copy the visible step's inputs into the answers object. Returns an error message or null. */
function readStep(i, a) {
  if (i === 1) {
    const v = $("#wzStart").value;
    if (!v) return "Pick a start date.";
    a.start_date = v;
  } else if (i === 2) {
    const m = +$("#wzMin").value;
    if (!(m >= 15)) return "Give DSA at least 15 minutes a working day.";
    a.dsa_minutes = m;
    a.rest_days = $$("[data-rest]").filter((c) => c.checked).map((c) => c.dataset.rest);
    if (a.rest_days.length >= 7) return "Leave at least one day for DSA.";
    a.mix = $("input[name=wzMix]:checked").value;
  } else if (i === 3) {
    a.ai.enabled = $("input[name=wzAi]:checked").value === "on";
    if (a.ai.enabled) {
      a.ai.classes = $$(".wz-class").map((r) => ({ day: $("[data-k=day]", r).value, start: $("[data-k=start]", r).value || "08:00", minutes: +$("[data-k=minutes]", r).value || 0 }));
      if (a.ai.classes.some((c) => c.minutes <= 0)) return "Each class needs a length in minutes.";
      a.ai.homework_hours = Math.max(0, +$("#wzHw").value || 0);
      a.ai.timezone = $("#wzTz").value.trim() || "Asia/Kolkata";
    }
  } else if (i === 4) {
    const r = +$("#wzRating").value, w = +$("#wzLive").value;
    const u = $("#wzLc").value.trim();
    if (!(r >= 800)) return "Enter a target rating of 800 or more.";
    if (!(w >= 1)) return "Live contests start from week 1 at the earliest.";
    if (u && !/^[A-Za-z0-9_.-]{1,40}$/.test(u)) return "That doesn't look like a LeetCode username (letters, digits, - and _).";
    a.knight = { badge: $("input[name=wzBadge]:checked").value, target_rating: r, deadline: $("#wzDeadline").value || null };
    a.leetcode = { username: u || null };
    a.contests.live_from_week = w;
  }
  return null;
}

/** Live hints that depend on the current inputs. */
function wireStep(i, a) {
  if (i === 1) {
    const note = () => { const v = $("#wzStart").value; $("#wzStartNote").textContent = v ? `Week 1 starts on ${fmtDay(mondayOf(v), LONG_DATE)}.` : ""; };
    $("#wzStart").oninput = note; note();
  } else if (i === 2) {
    const slots = () => {
      const t = { ...a, rest_days: $$("[data-rest]").filter((c) => c.checked).map((c) => c.dataset.rest), mix: $("input[name=wzMix]:checked").value };
      $("#wzSlots").textContent = `That is about ${slotsPerWeek(t)} new questions a week, plus reviews.`;
    };
    $(".wz-body").addEventListener("change", slots); slots();
  } else if (i === 3) {
    $$("input[name=wzAi]").forEach((r) => (r.onchange = () => ($("#wzAiBody").hidden = $("input[name=wzAi]:checked").value !== "on")));
    const list = $("#wzClasses");
    list.onclick = (e) => e.target.closest(".wz-rm")?.closest(".wz-class").remove();
    $("#wzAddClass").onclick = () => list.insertAdjacentHTML("beforeend", classRow({ day: "sat", start: "08:00", minutes: 120 }, list.children.length));
  } else if (i === 4) {
    const note = () => {
      const deadline = addDays(mondayOf(a.start_date), 26 * 7);
      $("#wzDeadlineNote").textContent = $("#wzDeadline").value ? "" : `Left blank, the deadline is 26 weeks after the start (${fmtDay(deadline, { day: "numeric", month: "short", year: "numeric" })}).`;
    };
    $("#wzDeadline").oninput = note; note();
    const PRESET = { Knight: 1850, Guardian: 2150 };
    $$("input[name=wzBadge]").forEach((r) => (r.onchange = () => { if (PRESET[r.value]) $("#wzRating").value = PRESET[r.value]; }));
  }
}

/** Open the wizard. Resolves true once setup was saved, false if a re-run was cancelled. */
export function runWizard(defaults, { rerun = false } = {}) {
  return new Promise((resolve) => {
    const a = JSON.parse(JSON.stringify(defaults));
    if (!a.start_date) a.start_date = mondayOf(todayStr());
    let step = 0;
    const el = document.createElement("div");
    el.className = "wizard";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-label", "dsaMixer setup");
    document.body.appendChild(el);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKey = (e) => {
      if (e.key === "Escape" && rerun) close(false);
      else if (e.key === "Enter" && e.target.tagName === "INPUT" && e.target.type !== "checkbox") { e.preventDefault(); $("#wzNext").click(); }
    };
    const close = (ok) => { el.remove(); document.body.style.overflow = prevOverflow; document.removeEventListener("keydown", onKey); resolve(ok); };
    document.addEventListener("keydown", onKey);

    function paint() {
      const last = step === STEPS.length - 1;
      el.innerHTML = `<div class="wz-card">
        <header class="wz-head">
          <span class="logo" aria-hidden="true">d</span><b class="wz-brand">dsaMixer setup</b><span class="wz-sp"></span>
          <span class="muted small" aria-live="polite">Step ${step + 1} of ${STEPS.length} · ${STEPS[step]}</span>
          ${rerun ? Button({ label: "Cancel", kind: "ghost", size: "sm", id: "wzCancel" }) : ""}
        </header>
        <div class="wz-bar" role="progressbar" aria-valuemin="1" aria-valuemax="${STEPS.length}" aria-valuenow="${step + 1}"><i style="width:${((step + 1) / STEPS.length) * 100}%"></i></div>
        <div class="wz-body">${STEP_VIEWS[step](a, { rerun })}<div class="wz-err" id="wzErr" role="alert" hidden></div></div>
        <footer class="wz-foot">
          ${step ? Button({ label: "Back", icon: "left", kind: "ghost", id: "wzBack" }) : "<span></span>"}
          ${last ? Button({ label: "Finish and plan today", icon: "check", kind: "primary", id: "wzNext" }) : Button({ label: step ? "Next" : "Get started", iconRight: "right", kind: "primary", id: "wzNext" })}
        </footer></div>`;
      wireStep(step, a);
      ($("input:not([type=checkbox]):not([type=radio]), select", el) || $("#wzNext")).focus({ preventScroll: true });
      $("#wzBack")?.addEventListener("click", () => { readStep(step, a); step--; paint(); });
      $("#wzCancel")?.addEventListener("click", () => close(false));
      $("#wzNext").onclick = async () => {
        const err = readStep(step, a);
        const box = $("#wzErr");
        if (err) { box.textContent = err; box.hidden = false; return; }
        if (!last) { step++; return paint(); }
        const btn = $("#wzNext");
        btn.disabled = true;
        try {
          await api("/setup", { method: "POST", body: a });
          toast(rerun ? "Setup saved" : "All set. Today is planned.");
          close(true);
        } catch (e) {
          btn.disabled = false;
          box.textContent = String(e.message || e);
          box.hidden = false;
        }
      };
    }
    paint();
  });
}
