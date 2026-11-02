// Today: focus card with timer, swimlane Kanban, right rail, quick log, close-day drawer.
import { $, $$, esc, today as todayStr, addDays, fmtDay, hm, KIND_LABEL, LOGGABLE, STATUSES, STATUS_LABEL, LANES, laneOf, shared, lsGet, lsSet } from "../util.js";
import { api, patchTicket } from "../api.js";
import { icon, kindChip, diffPill, seg, meterHtml, hbar, toast, openModal, openPopover, openDrawer, confirmDialog } from "../ui.js";
import { setViewKeys } from "../keys.js";
import * as timer from "../timer.js";
import { sparkline, heatmap } from "../charts.js";

let S = null; // per-render state
const CELL_HINT = { todo: "Nothing queued", doing: "Drag a card here to start", done: "Finished cards land here", skipped: "Nothing skipped" };

export async function render(root, arg) {
  S = {
    root, date: /^\d{4}-\d\d-\d\d$/.test(arg || "") ? arg : todayStr(), board: null, cap: 0, stats: null, contests: null,
    sel: null, skippedOpen: lsGet("dsm.skippedOpen") === "1", collapsed: new Set(), offs: [],
  };
  root.innerHTML = `<div class="today-grid">
    <div class="today-main">
      <div class="page-head" id="head"></div>
      <div class="meters" id="meters"></div>
      <div id="banner"></div>
      <div id="now"></div>
      <div id="board"></div>
    </div>
    <aside class="rail" id="rail" aria-label="Progress"></aside>
  </div>`;
  bindBoard();
  S.offs.push(timer.onChange(() => { if (S?.board) { paintNow(); paintBoard(); } }));
  const tick = setInterval(tickClock, 1000);
  S.offs.push(() => clearInterval(tick));
  setViewKeys(onKey);
  await load();
  loadRail();
}

export function destroy() {
  S?.offs.forEach((f) => f());
  S = null;
}

const goDay = (d) => { location.hash = d === todayStr() ? "#/today" : `#/today/${d}`; };

async function load() {
  const date = S.date;
  const [board, week] = await Promise.all([api(`/day/${date}`), api(`/week/${date}`)]);
  if (!S || S.date !== date) return;
  S.board = board;
  S.cap = week.days.find((d) => d.date === date)?.ai_capacity ?? 0;
  paint();
}

async function loadRail() {
  const [stats, contests, settings] = await Promise.all([api("/stats"), api("/contests"), S.settings || api("/settings").catch(() => null)]);
  if (!S) return;
  S.stats = stats; S.contests = contests; S.settings = settings;
  paintRail();
}

/** After any change: reload the day, refresh the rail and the top-bar streak. */
async function refresh() {
  await load();
  loadRail();
  document.dispatchEvent(new Event("dsm:changed"));
}

const byId = (id) => S.board.tickets.find((t) => t.id === id);

// ---------- painting ----------
function paint() {
  paintHead(); paintMeters(); paintBanner(); paintNow(); paintBoard();
}

function paintHead() {
  const b = S.board, isToday = b.date === todayStr(), closed = b.day?.closed_at;
  $("#head").innerHTML = `
    <div class="head-left">
      <button class="btn icon" id="prevDay" aria-label="Previous day" data-tip="Previous day  [">${icon("left")}</button>
      <div class="head-title"><h1>${fmtDay(b.date)}${isToday ? ` <span class="chip accent">Today</span>` : ""}</h1>
        <div class="head-sub"><span class="chip plain">Sprint ${b.sprint}</span>${b.is_buffer ? ` <span class="chip warn plain" data-tip="Catch-all day: no new questions, contest and retro">Buffer day</span>` : ""}</div></div>
      <button class="btn icon" id="nextDay" aria-label="Next day" data-tip="Next day  ]">${icon("right")}</button>
      <button class="btn" id="todayBtn" data-tip="Jump to today  .">Today</button>
    </div>
    <div class="head-actions">
      <button class="btn" id="addCard" data-tip="New card  N">${icon("plus")}Card <kbd>N</kbd></button>
      <button class="btn" id="pullBtn" data-tip="Finished early? Add the next question  P">${icon("pull")}Pull next question <kbd>P</kbd></button>
      <button class="btn primary" id="closeDay" data-tip="Close day  C">${closed ? "Update day log" : "Close day"} <kbd>C</kbd></button>
    </div>`;
  $("#prevDay").onclick = () => goDay(addDays(S.date, -1));
  $("#nextDay").onclick = () => goDay(addDays(S.date, 1));
  $("#todayBtn").onclick = () => goDay(todayStr());
  $("#addCard").onclick = addCard;
  $("#pullBtn").onclick = pull;
  $("#closeDay").onclick = closeDay;
}

function paintMeters() {
  const ts = S.board.tickets.filter((t) => t.status !== "skipped");
  const sum = (f) => ts.filter(f).reduce((s, t) => s + t.est_minutes, 0);
  const done = S.board.tickets.filter((t) => t.status === "done").length;
  $("#meters").innerHTML =
    meterHtml({ label: "DSA planned", used: sum((t) => LOGGABLE.includes(t.kind)), cap: S.board.dsa_budget, color: "var(--k-dsa)" }) +
    meterHtml({ label: "AI planned", used: sum((t) => t.kind === "ai"), cap: S.cap, color: "var(--k-ai)" }) +
    meterHtml({ label: "Done", used: done, cap: S.board.tickets.length, color: "var(--k-retro)", unit: (n) => n });
}

function paintBanner() {
  const b = S.board, closed = b.day?.closed_at, el = $("#banner");
  if (!b.tickets.length && b.date > todayStr()) {
    el.innerHTML = `<div class="banner info">${icon("calendar")}<span>This day isn't planned yet. Close ${b.date === addDays(todayStr(), 1) ? "today" : "the day before"} to generate it.</span></div>`;
  } else if (closed) {
    el.innerHTML = `<div class="banner ok">${icon("check")}<span>Day closed. Tomorrow's plan is ready.</span><button class="btn sm" id="goTomorrow">See tomorrow ${icon("right")}</button></div>`;
    $("#goTomorrow").onclick = () => goDay(addDays(b.date, 1));
  } else el.innerHTML = "";
}

function nowTicket() {
  const open = S.board.tickets.filter((t) => t.status === "todo" || t.status === "doing");
  const tm = timer.get();
  return (tm && open.find((t) => t.id === tm.ticketId)) || open.find((t) => t.status === "doing") || open[0] || null;
}

function paintNow() {
  const t = nowTicket(), el = $("#now");
  if (!t) {
    const any = S.board.tickets.length;
    el.innerHTML = `<section class="now empty-now"><span class="empty-icon">${icon(any ? "sparkle" : "inbox")}</span><div><h2>${any ? "Everything on this board is handled" : "Nothing on this board"}</h2>
      <p class="muted">${any ? "Pull another question if you have energy left, or close the day." : "Add a card or pull a question to get going."}</p></div></section>`;
    return;
  }
  const tm = timer.forTicket(t.id), running = timer.isRunning(t.id);
  const spent = t.minutes_spent != null ? ` · ${hm(t.minutes_spent)} logged` : "";
  el.innerHTML = `<section class="now k-${t.kind}" aria-label="Now" data-id="${t.id}">
    <div class="now-main">
      <div class="now-top"><span class="now-label">Now</span>${kindChip(t.kind)}${diffPill(t.difficulty)}<span class="id">#${t.id}</span>
        ${t.carried ? `<span class="chip carried" data-tip="Rolled over ${t.carried} time${t.carried > 1 ? "s" : ""}">${icon("carried")}${t.carried}</span>` : ""}</div>
      <h2 class="now-title">${esc(t.title)}</h2>
      ${t.detail || t.pattern ? `<div class="now-detail">${t.detail ? esc(t.detail) : ""}${t.detail && t.pattern ? " · " : ""}${t.pattern ? `Pattern: ${esc(t.pattern)}` : ""}</div>` : ""}
      <div class="now-meta">Estimate ${hm(t.est_minutes)}${spent}</div>
      ${t.url ? `<a class="btn sm" href="${esc(t.url)}" target="_blank" rel="noopener">Open on LeetCode ${icon("ext")}</a>` : ""}
    </div>
    <div class="now-timer">
      <div class="clock-label">${running ? "Running" : tm ? "Paused" : "Timer"}</div>
      <div class="clock ${running ? "running" : ""}" id="nowClock" role="timer" aria-label="Elapsed time">${timer.clockText(tm)}</div>
      <div class="timer-btns">
        <button class="btn primary lg" id="nowToggle" data-tip="Start / pause  Space">${icon(running ? "pause" : "play")}${running ? "Pause" : tm ? "Resume" : "Start"}</button>
        <button class="btn lg" id="nowDone" data-tip="Mark done  X">${icon("check")}Done</button>
        <button class="btn lg subtle-btn" id="nowSkip" data-tip="Skip this card">${icon("skip")}Skip</button>
      </div>
    </div></section>`;
  $("#nowToggle").onclick = () => toggleTimer(t);
  $("#nowDone").onclick = (e) => setStatus(t, "done", e.currentTarget);
  $("#nowSkip").onclick = () => setStatus(t, "skipped");
}

function tickClock() {
  const el = $("#nowClock");
  if (!el) return;
  const t = nowTicket();
  el.textContent = t ? timer.clockText(timer.forTicket(t.id)) : "00:00";
}

function cardHtml(t) {
  const conf = t.confidence ? `<span class="conf" role="img" aria-label="Confidence ${t.confidence} of 5" data-tip="Confidence ${t.confidence}/5">${[1, 2, 3, 4, 5].map((n) => `<i class="${n <= t.confidence ? "on" : ""}"></i>`).join("")}</span>` : "";
  const mins = t.minutes_spent != null ? `${hm(t.minutes_spent)} spent` : `~${hm(t.est_minutes)}`;
  const open = t.status === "todo" || t.status === "doing";
  const running = timer.isRunning(t.id);
  return `<div class="card k-${t.kind} st-${t.status} ${S.sel === t.id ? "selected" : ""}" draggable="true" tabindex="0" data-id="${t.id}">
    <div class="card-top">${kindChip(t.kind)}<span class="id">#${t.id}</span>${diffPill(t.difficulty)}
      ${t.carried ? `<span class="chip carried" data-tip="Rolled over ${t.carried} time${t.carried > 1 ? "s" : ""}">${icon("carried")}${t.carried}</span>` : ""}
      ${open ? `<span class="quick">
        <button type="button" class="btn sm icon ghost" data-q="done" aria-label="Mark done" data-tip="Mark done  X">${icon("check")}</button>
        <button type="button" class="btn sm icon ghost" data-q="timer" aria-label="${running ? "Pause" : "Start"} timer" data-tip="${running ? "Pause" : "Start"} timer  Space">${icon(running ? "pause" : "play")}</button></span>` : ""}</div>
    <div class="card-title">${esc(t.title)}</div>
    <div class="card-foot"><span class="detail" ${t.detail || t.pattern ? `data-tip="${esc(t.detail || t.pattern)}"` : ""}>${esc(t.detail || t.pattern || "")}</span>
      ${conf}<span class="mins">${mins}</span>
      ${t.url ? `<a href="${esc(t.url)}" target="_blank" rel="noopener" aria-label="Open on LeetCode" data-tip="Open on LeetCode">${icon("ext")}</a>` : ""}</div>
    ${t.note ? `<div class="note">“${esc(t.note)}”</div>` : ""}
  </div>`;
}

function paintBoard() {
  const ts = S.board.tickets, el = $("#board");
  const cnt = (s, f = () => true) => ts.filter((t) => t.status === s && f(t)).length;
  const lanes = LANES.filter((l) => l.always || ts.some((t) => l.kinds.includes(t.kind)));
  el.innerHTML = `<div class="board ${S.skippedOpen ? "skip-open" : "skip-closed"}">
    <div class="b-head" role="row">
      ${["todo", "doing", "done"].map((s) => `<div class="b-col">${STATUS_LABEL[s]} <span class="count">${cnt(s)}</span></div>`).join("")}
      <button class="b-col skip-toggle" id="skipToggle" aria-expanded="${S.skippedOpen}" data-tip="${S.skippedOpen ? "Collapse" : "Expand"} skipped">
        <span class="skip-label">${STATUS_LABEL.skipped}</span> <span class="count">${cnt("skipped")}</span></button>
    </div>
    ${lanes.map((l) => {
      const lt = ts.filter((t) => l.kinds.includes(t.kind)), mins = lt.filter((t) => t.status !== "skipped").reduce((s, t) => s + t.est_minutes, 0);
      const closed = S.collapsed.has(l.id);
      return `<section class="lane ${closed ? "collapsed" : ""}" data-lane="${l.id}">
        <button class="lane-head" data-lane-toggle="${l.id}" aria-expanded="${!closed}"><span class="chev">${icon("chev")}</span><span class="lane-name">${l.name}</span>
          <span class="count">${lt.length}</span><span class="lane-mins">${hm(mins)} planned</span></button>
        ${closed ? "" : `<div class="cells">${STATUSES.map((s) => { const cs = lt.filter((t) => t.status === s); return `<div class="cell ${cs.length ? "" : "none"}" data-lane="${l.id}" data-status="${s}" data-label="${STATUS_LABEL[s]}">${cs.length ? cs.map(cardHtml).join("") : `<div class="cell-hint">${CELL_HINT[s]}</div>`}</div>`; }).join("")}</div>`}
      </section>`;
    }).join("")}
    ${ts.length ? "" : `<div class="empty board-empty">No cards on this day yet.</div>`}
  </div>`;
}

function bindBoard() {
  const el = $("#board");
  el.addEventListener("click", (e) => {
    if (e.target.closest("#skipToggle")) { S.skippedOpen = !S.skippedOpen; lsSet("dsm.skippedOpen", S.skippedOpen ? "1" : "0"); return paintBoard(); }
    const lt = e.target.closest("[data-lane-toggle]");
    if (lt) { const id = lt.dataset.laneToggle; S.collapsed.has(id) ? S.collapsed.delete(id) : S.collapsed.add(id); return paintBoard(); }
    const card = e.target.closest(".card");
    if (!card || e.target.closest("a")) return;
    const t = byId(+card.dataset.id);
    const q = e.target.closest("[data-q]");
    if (q) { S.sel = t.id; return q.dataset.q === "done" ? setStatus(t, "done", q) : toggleTimer(t); }
    select(t.id);
    openTicket(t.id);
  });
  el.addEventListener("keydown", (e) => {
    const card = e.target.closest(".card");
    if (card && e.target === card && e.key === "Enter") { e.preventDefault(); select(+card.dataset.id); openTicket(+card.dataset.id); }
  });
  el.addEventListener("dragstart", (e) => { const c = e.target.closest(".card"); if (c) { c.classList.add("dragging"); e.dataTransfer.setData("text/plain", c.dataset.id); } });
  el.addEventListener("dragend", (e) => e.target.closest?.(".card")?.classList.remove("dragging"));
  el.addEventListener("dragover", (e) => { const c = e.target.closest(".cell"); if (c) { e.preventDefault(); c.classList.add("drag-over"); } });
  el.addEventListener("dragleave", (e) => e.target.closest?.(".cell")?.classList.remove("drag-over"));
  el.addEventListener("drop", async (e) => {
    const cell = e.target.closest(".cell");
    if (!cell) return;
    e.preventDefault();
    cell.classList.remove("drag-over");
    const t = byId(+e.dataTransfer.getData("text/plain"));
    if (t) setStatus(t, cell.dataset.status, cell);
  });
}

// ---------- rail ----------
function paintRail() {
  const { stats: s, contests } = S, k = s.knight;
  const rated = contests.filter((c) => c.rating).reverse();
  const left = Math.max(0, Math.ceil((new Date(k.deadline) - new Date()) / 864e5));
  const order = ["Easy", "Medium", "Hard"];
  const diffs = [...s.by_difficulty].sort((a, b) => order.indexOf(a.difficulty) - order.indexOf(b.difficulty));
  $("#rail").innerHTML = `
    <section class="panel rail-panel"><h3>Knight tracker</h3>
      ${k.rating ? `<div class="knight-top"><span class="big">${k.rating}</span><span class="muted">of ${k.target_rating} · ${Math.max(0, k.target_rating - k.rating)} to go</span></div>
      <div class="chart" id="spark"></div>` : `<div class="rail-empty"><span class="empty-icon sm">${icon("trophy")}</span><div><div class="rail-empty-title">No rated contests yet</div>
      <div class="muted small">${firstWeeklyText()}</div></div></div>
      <div class="kv target-row"><span>Target rating</span><b>${k.target_rating}</b></div>`}
      <div class="kv"><span>Contests</span><b>${k.contests}</b><span>Q3+ solve rate</span><b>${k.q3_rate != null ? Math.round(k.q3_rate * 100) + "%" : "—"}</b><span>Days to deadline</span><b>${left}</b></div>
      ${k.rating ? `<div class="legend small mt-s"><span class="key"><i class="sw s1"></i>Rating</span><span class="key"><i class="sw ref"></i>Target ${k.target_rating}</span></div>` : ""}
    </section>
    <section class="panel rail-panel"><h3>Progress</h3>
      <div class="knight-top"><span class="big">${s.done}<span class="of"> / ${s.total}</span></span><span class="muted">solved · ${s.mastered} mastered</span></div>
      ${diffs.map((r) => hbar(diffPillText(r.difficulty), r.done || 0, r.total, "compact")).join("")}
      <div class="kv"><span>Reviews due</span><b>${s.reviews_due}</b><span>Projected finish</span><b>${s.projected_finish ? fmtDay(s.projected_finish, { day: "numeric", month: "short", year: "numeric" }) : "—"}</b></div>
      <div class="muted small">${esc(s.projected_finish_basis)}</div>
    </section>
    <section class="panel rail-panel"><div class="panel-head"><h3>This week's homework</h3><a class="link-arrow small" href="#/ai">AI course ${icon("arrow")}</a></div>
      ${s.homework.length ? s.homework.map((g) => `<div class="hw"><div class="hw-head"><b>${esc(g.goal)}</b><span class="muted small">${g.done}/${g.total} done${g.minutes_left ? ` · ${hm(g.minutes_left)} left` : " · complete"}</span></div>
        <div class="track" role="img" aria-label="${g.done} of ${g.total}"><div class="fill" style="width:${g.total ? (g.done / g.total) * 100 : 0}%;background:var(--k-ai)"></div></div></div>`).join("") : `<div class="muted small">No homework cards this week.</div>`}
    </section>
    <section class="panel rail-panel"><h3>Last 12 weeks</h3><div id="miniHm"></div></section>`;
  if (k.rating) sparkline($("#spark"), rated, k.target_rating);
  heatmap($("#miniHm"), s.heatmap, { weeks: 12, mini: true });
}
const diffPillText = (d) => `<span class="diff ${d}">${d}</span>`;

/** Date of the first live Weekly (Sunday of sprint `weekly_live_from_week`), from saved settings. */
function firstWeeklyText() {
  const c = S.settings?.contests, start = S.settings?.start_date;
  if (!c || !start || !c.weekly_live) return "Log a live contest to start the rating line.";
  const d = addDays(start, (c.weekly_live_from_week - 1) * 7 + 6);
  return d >= todayStr() ? `Your first live Weekly is ${fmtDay(d, { day: "numeric", month: "short" })}.` : "Log your next live Weekly on the Contests tab.";
}

// ---------- actions ----------
function select(id) {
  S.sel = id;
  $$(".card.selected").forEach((c) => c.classList.remove("selected"));
  const c = $(`.card[data-id="${id}"]`);
  c?.classList.add("selected");
  c?.scrollIntoView({ block: "nearest" });
}

async function toggleTimer(t) {
  if (timer.isRunning(t.id)) return timer.pause();
  await timer.start(t);
  if (t.status !== "doing") await patchTicket(t.id, { status: "doing" });
  refresh();
}

/** Single entry point for status changes (buttons, drag, keys). Done opens the quick log. */
async function setStatus(t, status, anchor) {
  if (status === t.status) return;
  if (status === "done") {
    if (t.kind === "contest") { await patchTicket(t.id, { status: "done" }); await refresh(); return logContest(t); }
    if (LOGGABLE.includes(t.kind) || t.kind === "ai") return quickLog(t, anchor);
    const m = timer.totalMinutes(t);
    await patchTicket(t.id, { status: "done", ...(m != null ? { minutes_spent: m } : {}) });
    timer.clearFor(t.id);
    toast("Marked done");
  } else {
    await patchTicket(t.id, { status });
    if (status === "skipped") timer.clearFor(t.id);
  }
  refresh();
}

function logContest(t) {
  shared.contestPrefill = { date: t.date, kind: t.title.includes("Biweekly") ? "biweekly" : t.title.includes("LIVE") ? "weekly" : "virtual" };
  location.hash = "#/contests";
  toast("Log the contest result here");
}

function quickLog(t, anchor) {
  const loggable = LOGGABLE.includes(t.kind), ai = t.kind === "ai";
  const mins = timer.totalMinutes(t) ?? t.minutes_spent ?? t.est_minutes;
  openPopover(anchor || $("#now") || document.body, `
    <h3 class="ql-title">Log · ${esc(t.title)}</h3>
    ${loggable ? `<label class="field">Result ${seg("result", [["solved", "Solved"], ["hints", "Hints"], ["failed", "Couldn't"]], t.result || "solved")}</label>
      <label class="field">Confidence ${seg("confidence", [1, 2, 3, 4, 5].map((n) => [n, n]), t.confidence || 3)}</label>` : ""}
    <label class="field">Minutes<input type="number" name="minutes_spent" min="0" value="${mins}" autofocus></label>
    <label class="field">${ai ? "What you covered" : "Key insight"}<input name="note" value="${esc(t.note || "")}" placeholder="${ai ? "e.g. backprop derivation, HW Q3" : "e.g. shrink window when count > k"}"></label>
    ${loggable ? `<label class="field">Submission link<input name="link" value="${esc(t.link || "")}" placeholder="https://leetcode.com/submissions/…"></label>` : ""}
    <div class="btns"><button type="button" class="btn ghost" data-act="cancel">Cancel <kbd>Esc</kbd></button><button class="btn primary">Save <kbd>↵</kbd></button></div>`,
  async (_, d) => {
    const body = { status: "done", minutes_spent: d.minutes_spent !== "" ? +d.minutes_spent : null, note: d.note || null };
    if (loggable) { body.result = d.result; body.confidence = +d.confidence; body.link = d.link || null; }
    await patchTicket(t.id, body);
    timer.clearFor(t.id);
    toast("Marked done");
    refresh();
  });
}

function openTicket(id) {
  const t = byId(id);
  if (!t) return;
  const loggable = LOGGABLE.includes(t.kind), ai = t.kind === "ai";
  openModal(`
    <h2>${esc(t.title)}</h2>
    <div class="muted small">${KIND_LABEL[t.kind]} · #${t.id}${t.difficulty ? " · " + t.difficulty : ""}${t.pattern ? " · " + esc(t.pattern) : ""}${t.detail ? " · " + esc(t.detail) : ""}</div>
    ${t.url ? `<a class="link-arrow" href="${esc(t.url)}" target="_blank" rel="noopener">Open on LeetCode ${icon("ext")}</a>` : ""}
    <label class="field">Status ${seg("status", [["todo", "To do"], ["doing", "In progress"], ["done", "Done"], ["skipped", "Skip"]], t.status)}</label>
    ${loggable ? `<label class="field">Result ${seg("result", [["solved", "Solved alone"], ["hints", "Needed hints"], ["failed", "Couldn't solve"]], t.result || "solved")}</label>
      <label class="field">Confidence (could you redo it cold?) ${seg("confidence", [1, 2, 3, 4, 5].map((n) => [n, n]), t.confidence || 3)}</label>` : ""}
    <label class="field">Minutes spent<input type="number" name="minutes_spent" min="0" value="${t.minutes_spent ?? t.est_minutes}"></label>
    ${loggable || ai ? `<label class="field">${ai ? "What you covered" : "Pattern / key insight"}<input name="note" value="${esc(t.note || "")}" placeholder="${ai ? "e.g. backprop derivation, HW Q3" : "e.g. shrink window when count > k"}"></label>` : ""}
    ${loggable ? `<label class="field">Submission link<input name="link" value="${esc(t.link || "")}" placeholder="https://leetcode.com/submissions/…"></label>` : ""}
    <div class="btns"><button type="button" class="btn ghost danger spacer" data-act="delete">Delete</button><button type="button" class="btn ghost" data-act="cancel">Cancel</button><button class="btn primary">Save</button></div>`,
  async (action, data) => {
    if (action === "delete") {
      if (!(await confirmDialog("Delete this card?"))) return false;
      await api(`/tickets/${id}`, { method: "DELETE" });
      timer.clearFor(id);
      S.sel = null;
    } else {
      const body = { status: data.status, minutes_spent: data.minutes_spent ? +data.minutes_spent : null };
      if ("note" in data) body.note = data.note || null;
      if ("link" in data) body.link = data.link || null;
      if (loggable) { body.result = data.result; body.confidence = +data.confidence; }
      await patchTicket(id, body);
      if (data.status === "done" || data.status === "skipped") timer.clearFor(id);
      if (data.status === "done" && t.status !== "done" && t.kind === "contest") { await refresh(); logContest(t); return; }
    }
    refresh();
  });
}

function addCard() {
  openModal(`
    <h2>New card · ${fmtDay(S.date)}</h2>
    <label class="field">Title<input name="title" required autofocus></label>
    <label class="field">Type<select name="kind"><option value="custom">Task</option><option value="ai">AI</option><option value="dsa">DSA</option><option value="contest">Contest</option></select></label>
    <label class="field">Estimate (minutes)<input type="number" name="est_minutes" value="30" min="5"></label>
    <div class="btns"><button type="button" class="btn ghost" data-act="cancel">Cancel</button><button class="btn primary">Add</button></div>`,
  async (_, d) => {
    S.board = await api("/tickets", { method: "POST", body: { date: S.date, title: d.title, kind: d.kind, est_minutes: +d.est_minutes } });
    paint();
    refresh();
  });
}

async function pull() {
  S.board = await api(`/day/${S.date}/pull`, { method: "POST" });
  paint();
  toast("Pulled the next question");
  loadRail();
}

function closeDay() {
  const b = S.board, closed = b.day?.closed_at, prev = b.day || {};
  const open = b.tickets.filter((t) => t.status === "todo" || t.status === "doing");
  const done = b.tickets.filter((t) => t.status === "done");
  const aiNotes = b.tickets.filter((t) => t.kind === "ai" && t.note).map((t) => t.note).join("; ");
  const li = (t) => `<li>${kindChip(t.kind)}<span>${esc(t.title)}</span></li>`;
  openDrawer({
    title: `End of day · ${fmtDay(b.date)}`,
    sub: `${done.length} done · ${open.length} open`,
    body: `<h3 class="mt">Done (${done.length})</h3>${done.length ? `<ul class="open-list">${done.map(li).join("")}</ul>` : `<div class="muted small">Nothing finished yet.</div>`}
      <h3 class="mt">Still open (${open.length})</h3>${open.length ? `<div class="muted small">These roll over to tomorrow.</div><ul class="open-list">${open.map(li).join("")}</ul>` : `<div class="muted small">Nothing open. Clean slate.</div>`}
      <label class="field">Energy today ${seg("energy", [1, 2, 3, 4, 5].map((n) => [n, n]), prev.energy || 3)}</label>
      <label class="field">AI topics covered<input name="ai_topics" value="${esc(prev.ai_topics || aiNotes)}"></label>
      <label class="field">Notes / blockers<textarea name="notes" rows="4">${esc(prev.notes || "")}</textarea></label>`,
    submitLabel: closed ? "Update day log" : "Close day & plan tomorrow",
    onSubmit: async (_, d) => {
      const next = await api(`/day/${b.date}/close`, { method: "POST", body: { energy: +d.energy, ai_topics: d.ai_topics, notes: d.notes } });
      toast("Tomorrow is planned");
      document.dispatchEvent(new Event("dsm:changed"));
      goDay(next.date);
    },
  });
}

// ---------- keyboard ----------
function moveSel(delta) {
  const ids = $$(".card", $("#board")).map((c) => +c.dataset.id);
  if (!ids.length) return;
  const i = ids.indexOf(S.sel);
  select(ids[i < 0 ? (delta > 0 ? 0 : ids.length - 1) : Math.min(ids.length - 1, Math.max(0, i + delta))]);
}

function shiftStatus(delta) {
  const t = byId(S.sel);
  if (!t) return false;
  const next = STATUSES[STATUSES.indexOf(t.status) + delta];
  if (next) setStatus(t, next, $(`.card[data-id="${t.id}"]`));
  return true;
}

function onKey(e) {
  if ((e.key === " " || e.key === "Enter") && e.target.closest("button, a, summary")) return false;
  switch (e.key) {
    case "j": case "ArrowDown": moveSel(1); return true;
    case "k": case "ArrowUp": moveSel(-1); return true;
    case "h": case "ArrowLeft": return shiftStatus(-1);
    case "l": case "ArrowRight": return shiftStatus(1);
    case "Enter": if (!S.sel || !byId(S.sel)) return false; openTicket(S.sel); return true;
    case "x": { const t = byId(S.sel); if (!t) return false; setStatus(t, "done", $(`.card[data-id="${t.id}"]`)); return true; }
    case " ": { const t = byId(S.sel) || nowTicket(); if (!t) return false; toggleTimer(t); return true; }
    case "n": addCard(); return true;
    case "p": pull(); return true;
    case "c": closeDay(); return true;
    case "[": goDay(addDays(S.date, -1)); return true;
    case "]": goDay(addDays(S.date, 1)); return true;
    case ".": goDay(todayStr()); return true;
  }
  return false;
}
