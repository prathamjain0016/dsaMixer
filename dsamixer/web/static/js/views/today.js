// Today: a customizable widget grid. Now (card + timer), day meters, swimlane board with inline composer,
// badge tracker / LeetCode profile / progress / homework / heatmap widgets. Card detail and close day are slide-overs.
import { $, $$, esc, today as todayStr, addDays, fmtDay, hm, LOGGABLE, STATUSES, STATUS_LABEL, LANES, shared, lsGet, lsSet } from "../util.js";
import { api, patchTicket } from "../api.js";
import { icon, openModal, openPopover } from "../ui.js";
import { setViewKeys } from "../keys.js";
import * as timer from "../timer.js";
import { sparkline, heatmap } from "../charts.js";
import { createDashboard } from "../layout.js";
import { openTicketPanel } from "../ticket-panel.js";
import { loadProfile, paintProfileCard, paintSuggestionsBanner, targetText } from "../leetcode.js";
import {
  Toolbar, Button, IconButton, Badge, KindBadge, DiffPill, CarriedBadge, StatusPill, Segmented, Meter, ProgressRing, setRing,
  HBar, EmptyState, Card, SlideOver, TrackDot, toast,
} from "../components/index.js";

let S = null; // per-render state

const DEFS = [
  { id: "now", title: "Now", span: 8, sizes: [8, 12], fixed: true },
  { id: "meters", title: "Today's load", span: 4, sizes: [4, 6, 12] },
  { id: "board", title: "Board", span: 12, fixed: true, flush: true },
  { id: "knight", title: "Badge tracker", span: 3, sizes: [3, 4, 6, 12], actions: `<a href="#/contests">Contests ${icon("arrow")}</a>` },
  { id: "leetcode", title: "LeetCode", span: 3, sizes: [3, 4, 6, 12] },
  { id: "progress", title: "Progress", span: 3, sizes: [3, 4, 6, 12], actions: `<a href="#/questions">Questions ${icon("arrow")}</a>` },
  { id: "homework", title: "This week's homework", span: 3, sizes: [3, 4, 6, 12], actions: `<a href="#/ai">AI course ${icon("arrow")}</a>` },
  { id: "heatmap", title: "Last 12 weeks", span: 3, sizes: [3, 4, 6, 12], actions: `<a href="#/stats">Stats ${icon("arrow")}</a>` },
];

export async function render(root, arg) {
  S = {
    root, date: /^\d{4}-\d\d-\d\d$/.test(arg || "") ? arg : todayStr(), board: null, cap: 0, stats: null, contests: null,
    sel: null, skippedOpen: lsGet("dsm.skippedOpen") === "1", collapsed: new Set(), offs: [],
  };
  root.innerHTML = `<div id="tHead"></div><div id="tBanner"></div><div id="lcBanner"></div><div id="dash"></div>`;
  S.dash = createDashboard({ page: "today", root: $("#dash", root), defs: DEFS, paint: paintAll, controls: () => $("#dashCtl") });
  bindBoard($("#dash", root));
  S.offs.push(timer.onChange(() => { if (S?.board) { paintNow(); paintBoard(); } }));
  const tick = setInterval(tickClock, 1000);
  S.offs.push(() => clearInterval(tick));
  const onAction = (e) => runAction(e.detail);
  document.addEventListener("dsm:action", onAction);
  S.offs.push(() => document.removeEventListener("dsm:action", onAction));
  setViewKeys(onKey);
  await load();
  loadRail();
  if (shared.pendingAction) { const a = shared.pendingAction; shared.pendingAction = null; runAction(a); }
}

export function destroy() {
  S?.offs.forEach((f) => f());
  S = null;
}
export const currentDate = () => S?.date;

const goDay = (d) => { location.hash = d === todayStr() ? "#/today" : `#/today/${d}`; };

async function load() {
  const date = S.date;
  const [board, week] = await Promise.all([api(`/day/${date}`), api(`/week/${date}`)]);
  if (!S || S.date !== date) return;
  const first = !S.board;
  S.board = board;
  S.cap = week.days.find((d) => d.date === date)?.ai_capacity ?? 0;
  paintHead(); paintBanner();
  if (first) S.dash.render(); else paintAll();
}

async function loadRail() {
  const [stats, contests, settings, lc] = await Promise.all([api("/stats"), api("/contests"), S.settings || api("/settings").catch(() => null),
    loadProfile().catch(() => null)]);
  if (!S) return;
  S.stats = stats; S.contests = contests; S.settings = settings; S.lc = lc;
  paintRail();
}

/** After any change: reload the day, refresh the rail and the sidebar streak. */
async function refresh() {
  if (!S) return;
  await load();
  loadRail();
  document.dispatchEvent(new Event("dsm:changed"));
}

const byId = (id) => S.board.tickets.find((t) => t.id === id);

function runAction(a) {
  if (!S?.board) return;
  if (a === "newCard") addCard();
  else if (a === "pull") pull();
  else if (a === "closeDay") closeDay();
  else if (a === "toggleTimer") { const t = byId(S.sel) || nowTicket(); if (t) toggleTimer(t); else toast("No open card to time"); }
  else if (a && a.open) { if (byId(a.open)) { select(a.open); openTicket(a.open); } }
}

// ---------- painting ----------
function paintAll() {
  if (!S?.board) return;
  paintNow(); paintMeters(); paintBoard();
  if (S.stats) paintRail();
}

function paintHead() {
  const b = S.board, isToday = b.date === todayStr(), closed = b.day?.closed_at;
  const live = b.tickets.filter((t) => t.status !== "skipped");
  const planned = live.reduce((s, t) => s + t.est_minutes, 0);
  $("#tHead").innerHTML = Toolbar({
    lead: IconButton({ icon: "left", label: "Previous day", tip: "Previous day  [", id: "prevDay", kind: "secondary" }) +
      IconButton({ icon: "right", label: "Next day", tip: "Next day  ]", id: "nextDay", kind: "secondary" }),
    title: `${fmtDay(b.date)}${isToday ? Badge("Today", "accent") : ""}`,
    sub: `<span>Sprint ${b.sprint}</span><span class="faint">·</span><span>${b.tickets.length} card${b.tickets.length === 1 ? "" : "s"} · ${hm(planned)} planned</span>${b.is_buffer ? Badge("Buffer day", "warn", `data-tip="Catch-all day: no new questions, contest and retro"`) : ""}${closed ? Badge(`${icon("check")}Closed`, "ok") : ""}`,
    actions: (isToday ? "" : Button({ label: "Today", kind: "ghost", id: "todayBtn", tip: "Jump to today  ." })) +
      `<span id="dashCtl" class="btn-row"></span><span class="vsep"></span>` +
      Button({ label: "Pull question", icon: "pull", id: "pullBtn", kbd: "P", tip: "Finished early? Add the next question" }) +
      Button({ label: closed ? "Update day log" : "Close day", kind: "primary", id: "closeDay", kbd: "C" }),
  });
  $("#prevDay").onclick = () => goDay(addDays(S.date, -1));
  $("#nextDay").onclick = () => goDay(addDays(S.date, 1));
  $("#todayBtn")?.addEventListener("click", () => goDay(todayStr()));
  $("#pullBtn").onclick = pull;
  $("#closeDay").onclick = closeDay;
  S.dash.paintControls(); // the Customize buttons live in this header
}

function paintMeters() {
  const el = $("#wb-meters");
  if (!el) return;
  const ts = S.board.tickets.filter((t) => t.status !== "skipped");
  const sum = (f) => ts.filter(f).reduce((s, t) => s + t.est_minutes, 0);
  const done = S.board.tickets.filter((t) => t.status === "done").length, total = S.board.tickets.length;
  const spent = S.board.tickets.reduce((s, t) => s + (t.minutes_spent || 0), 0);
  el.innerHTML = `<div class="load-top">${ProgressRing({ value: done, max: total || 1, size: 52, stroke: 5, center: `<b class="ring-num">${total ? Math.round((done / total) * 100) : 0}%</b>`, label: `${done} of ${total} done` })}
      <div><div class="load-big">${done}<span class="faint"> / ${total}</span></div><div class="muted small">cards done · ${hm(spent)} logged</div></div></div>
    <div class="load-meters">
      ${Meter({ label: "DSA", used: sum((t) => LOGGABLE.includes(t.kind)), cap: S.board.dsa_budget, color: "var(--k-dsa)" })}
      ${Meter({ label: "AI course", used: sum((t) => t.kind === "ai"), cap: S.cap, color: "var(--k-ai)" })}
      ${Meter({ label: "Done", used: done, cap: total, color: "var(--accent)", unit: (n) => n })}
    </div>`;
}

function paintBanner() {
  const b = S.board, closed = b.day?.closed_at, el = $("#tBanner");
  if (!b.tickets.length && b.date > todayStr()) {
    el.innerHTML = `<div class="banner info t-banner">${icon("calendar")}<span>This day isn't planned yet. Close ${b.date === addDays(todayStr(), 1) ? "today" : "the day before"} to generate it.</span></div>`;
  } else if (closed) {
    el.innerHTML = `<div class="banner ok t-banner">${icon("check")}<span>Day closed. Tomorrow's plan is ready.</span>${Button({ label: "See tomorrow", iconRight: "right", size: "sm", id: "goTomorrow" })}</div>`;
    $("#goTomorrow").onclick = () => goDay(addDays(b.date, 1));
  } else el.innerHTML = "";
}

function nowTicket() {
  const open = S.board.tickets.filter((t) => t.status === "todo" || t.status === "doing");
  const tm = timer.get();
  return (tm && open.find((t) => t.id === tm.ticketId)) || open.find((t) => t.status === "doing") || open[0] || null;
}

function paintNow() {
  const el = $("#wb-now");
  if (!el) return;
  const t = nowTicket();
  if (!t) {
    const any = S.board.tickets.length;
    el.innerHTML = EmptyState({
      icon: any ? "sparkle" : "inbox",
      title: any ? "Everything on this board is handled" : "Nothing on this board yet",
      hint: any ? "Pull another question if you have energy left, or close the day." : "Add a card in the To do column or pull the next question.",
      action: Button({ label: "Pull next question", icon: "pull", size: "sm", attrs: { "data-act": "pull" } }) + " " + (any ? Button({ label: "Close day", kind: "primary", size: "sm", attrs: { "data-act": "close" } }) : ""),
    });
    el.querySelector('[data-act="pull"]').onclick = pull;
    el.querySelector('[data-act="close"]')?.addEventListener("click", closeDay);
    return;
  }
  const tm = timer.forTicket(t.id), running = timer.isRunning(t.id);
  const elapsedMin = (t.minutes_spent && !tm ? t.minutes_spent : (tm ? tm.baseMinutes : 0) + timer.elapsedMs(tm) / 6e4);
  el.innerHTML = `<div class="now k-${t.kind}" data-id="${t.id}">
    <div class="now-main">
      <div class="now-top">${KindBadge(t.kind)}<span class="c-id">#${t.id}</span>${DiffPill(t.difficulty)}${CarriedBadge(t.carried)}${StatusPill(t.status)}</div>
      <h2 class="now-title">${esc(t.title)}</h2>
      ${t.detail || t.pattern ? `<div class="now-detail">${t.detail ? esc(t.detail) : ""}${t.detail && t.pattern ? " · " : ""}${t.pattern ? `Pattern: ${esc(t.pattern)}` : ""}</div>` : ""}
      <div class="now-meta"><span>${icon("clock")}Estimate ${hm(t.est_minutes)}</span>${t.minutes_spent != null ? `<span>${hm(t.minutes_spent)} logged</span>` : ""}</div>
      <div class="btn-row now-links">${t.url ? Button({ label: "Open on LeetCode", iconRight: "ext", size: "sm", href: t.url, attrs: { target: "_blank", rel: "noopener" } }) : ""}
        ${Button({ label: "Details", size: "sm", kind: "ghost", id: "nowOpen", kbd: "↵" })}</div>
    </div>
    <div class="now-timer">
      ${ProgressRing({ value: elapsedMin, max: t.est_minutes || 1, size: 148, stroke: 6, id: "nowRing", color: running ? "var(--accent)" : "var(--faint)",
        center: `<div><div class="clock ${running ? "running" : ""}" id="nowClock" role="timer" aria-label="Elapsed time">${timer.clockText(tm)}</div><div class="clock-label">${running ? "Running" : tm ? "Paused" : `of ${hm(t.est_minutes)}`}</div></div>`, label: "Time against estimate" })}
      <div class="timer-btns">
        ${Button({ label: running ? "Pause" : tm ? "Resume" : "Start", icon: running ? "pause" : "play", kind: "primary", id: "nowToggle", tip: "Start / pause  Space" })}
        ${Button({ label: "Done", icon: "check", id: "nowDone", tip: "Mark done  X" })}
        ${IconButton({ icon: "skip", label: "Skip this card", id: "nowSkip", kind: "ghost" })}
      </div>
    </div></div>`;
  $("#nowToggle").onclick = () => toggleTimer(t);
  $("#nowDone").onclick = (e) => setStatus(t, "done", e.currentTarget);
  $("#nowSkip").onclick = () => setStatus(t, "skipped");
  $("#nowOpen").onclick = () => openTicket(t.id);
}

function tickClock() {
  const el = $("#nowClock");
  if (!el || !S?.board) return;
  const t = nowTicket();
  const tm = t && timer.forTicket(t.id);
  el.textContent = t ? timer.clockText(tm) : "00:00";
  if (tm) setRing($("#nowRing"), tm.baseMinutes + timer.elapsedMs(tm) / 6e4, t.est_minutes || 1);
}

const DROP_HINT = { todo: "Drop to queue", doing: "Drop to start", done: "Drop to finish", skipped: "Drop to skip" };

function paintBoard() {
  const el = $("#wb-board");
  if (!el) return;
  const ts = S.board.tickets;
  const cnt = (s) => ts.filter((t) => t.status === s).length;
  const lanes = LANES.filter((l) => l.always || ts.some((t) => l.kinds.includes(t.kind)));
  const focused = document.activeElement?.closest?.("#composer") ? { v: $("#cTitle")?.value || "" } : null;
  el.innerHTML = `<div class="board ${S.skippedOpen ? "skip-open" : "skip-closed"}">
    <div class="b-head">
      ${["todo", "doing", "done"].map((s) => `<div class="b-col">${StatusPill(s)}<span class="b-count">${cnt(s)}</span></div>`).join("")}
      <button type="button" class="b-col skip-toggle" id="skipToggle" aria-expanded="${S.skippedOpen}" data-tip="${S.skippedOpen ? "Collapse" : "Expand"} skipped">${StatusPill("skipped")}<span class="b-count">${cnt("skipped")}</span>${icon(S.skippedOpen ? "left" : "right")}</button>
    </div>
    <form class="composer" id="composer" autocomplete="off">
      ${icon("plus")}<input id="cTitle" name="title" placeholder="Add a card to To do…" aria-label="New card title" required>
      <select name="kind" aria-label="Type"><option value="custom">Task</option><option value="ai">AI</option><option value="dsa">DSA</option><option value="contest">Contest</option></select>
      <input name="est_minutes" type="number" min="5" step="5" value="30" aria-label="Estimate in minutes"><span class="muted small c-unit">min</span>
      <kbd class="c-enter">↵</kbd>
    </form>
    ${lanes.map((l) => {
      const lt = ts.filter((t) => l.kinds.includes(t.kind)), mins = lt.filter((t) => t.status !== "skipped").reduce((s, t) => s + t.est_minutes, 0);
      const closed = S.collapsed.has(l.id);
      return `<section class="lane ${closed ? "collapsed" : ""}" data-lane="${l.id}">
        <button type="button" class="lane-head" data-lane-toggle="${l.id}" aria-expanded="${!closed}"><span class="chev">${icon("chev")}</span>${TrackDot(l.kinds[0])}<span class="lane-name">${l.name}</span>
          <span class="lane-count">${lt.length}</span><span class="lane-mins">${hm(mins)} planned</span></button>
        ${closed ? "" : `<div class="cells">${STATUSES.map((s) => {
          const cs = lt.filter((t) => t.status === s);
          return `<div class="cell ${cs.length ? "" : "none"}" data-lane="${l.id}" data-status="${s}" data-label="${STATUS_LABEL[s]}">${s === "skipped" && !S.skippedOpen
            ? (cs.length ? `<div class="skip-mini">${cs.length} skipped</div>` : "")
            : cs.map((t) => Card(t, { selected: S.sel === t.id, running: timer.isRunning(t.id) })).join("")}<div class="drop-hint">${DROP_HINT[s]}</div></div>`;
        }).join("")}</div>`}
      </section>`;
    }).join("")}
  </div>`;
  if (focused) { const i = $("#cTitle"); i.value = focused.v; i.focus(); }
}

function bindBoard(host) {
  host.addEventListener("submit", async (e) => {
    if (e.target.id !== "composer") return;
    e.preventDefault();
    const f = e.target, title = f.title.value.trim();
    if (!title) return;
    S.board = await api("/tickets", { method: "POST", body: { date: S.date, title, kind: f.kind.value, est_minutes: +f.est_minutes.value || 30 } });
    paintAll(); paintHead();
    const i = $("#cTitle"); if (i) i.focus();
    toast("Card added");
    refresh();
  });
  // The composer has several fields and no submit button, so Enter needs an explicit submit.
  host.addEventListener("keydown", (e) => {
    const f = e.target.closest?.("#composer");
    if (f && e.key === "Enter" && !e.isComposing) { e.preventDefault(); f.requestSubmit(); }
    if (f && e.key === "Escape") { e.target.blur(); }
  });
  host.addEventListener("click", (e) => {
    if (!e.target.closest("#wb-board")) return;
    if (e.target.closest("#skipToggle")) { S.skippedOpen = !S.skippedOpen; lsSet("dsm.skippedOpen", S.skippedOpen ? "1" : "0"); return paintBoard(); }
    const lt = e.target.closest("[data-lane-toggle]");
    if (lt) { const id = lt.dataset.laneToggle; S.collapsed.has(id) ? S.collapsed.delete(id) : S.collapsed.add(id); return paintBoard(); }
    if (e.target.closest(".skip-mini")) { S.skippedOpen = true; lsSet("dsm.skippedOpen", "1"); return paintBoard(); }
    const card = e.target.closest(".card");
    if (!card || e.target.closest("a")) return;
    const t = byId(+card.dataset.id);
    const q = e.target.closest("[data-q]");
    if (q) { S.sel = t.id; return q.dataset.q === "done" ? setStatus(t, "done", q) : toggleTimer(t); }
    select(t.id);
    openTicket(t.id);
  });
  host.addEventListener("keydown", (e) => {
    const card = e.target.closest?.(".card");
    if (card && e.target === card && e.key === "Enter") { e.preventDefault(); select(+card.dataset.id); openTicket(+card.dataset.id); }
  });
  const isCard = (e) => e.dataTransfer?.types?.includes("text/plain");
  host.addEventListener("dragstart", (e) => { const c = e.target.closest?.(".card"); if (c) { c.classList.add("dragging"); e.dataTransfer.setData("text/plain", c.dataset.id); $(".board")?.classList.add("dragging-card"); } });
  host.addEventListener("dragend", (e) => { e.target.closest?.(".card")?.classList.remove("dragging"); $(".board")?.classList.remove("dragging-card"); });
  host.addEventListener("dragover", (e) => { const c = e.target.closest?.(".cell"); if (c && isCard(e)) { e.preventDefault(); $$(".cell.drag-over").forEach((x) => x !== c && x.classList.remove("drag-over")); c.classList.add("drag-over"); } });
  host.addEventListener("dragleave", (e) => { const c = e.target.closest?.(".cell"); if (c && !c.contains(e.relatedTarget)) c.classList.remove("drag-over"); });
  host.addEventListener("drop", async (e) => {
    const cell = e.target.closest?.(".cell");
    if (!cell || !isCard(e)) return;
    e.preventDefault();
    cell.classList.remove("drag-over");
    $(".board")?.classList.remove("dragging-card");
    const t = byId(+e.dataTransfer.getData("text/plain"));
    if (t) setStatus(t, cell.dataset.status, cell);
  });
}

// ---------- side widgets ----------
function paintRail() {
  const { stats: s, contests } = S, k = s.knight;
  const rated = contests.filter((c) => c.rating).reverse();
  const left = Math.max(0, Math.ceil((new Date(k.deadline) - new Date()) / 864e5));
  const order = ["Easy", "Medium", "Hard"];
  const diffs = [...s.by_difficulty].sort((a, b) => order.indexOf(a.difficulty) - order.indexOf(b.difficulty));
  const kv = (rows) => `<dl class="kv">${rows.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join("")}</dl>`;
  const set = (id, html) => { const el = $(`#wb-${id}`); if (el) el.innerHTML = html; return el; };

  const kt = $("#w-knight .w-title");
  if (kt) kt.textContent = `${k.label} tracker`;
  set("knight", (k.rating ? `<div class="big-row"><span class="big">${k.rating}</span><span class="muted small">of ${k.target_rating} · ${Math.max(0, k.target_rating - k.rating)} to go</span></div><div class="chart" id="spark"></div>`
    : EmptyState({ icon: "trophy", title: "No rated contests yet", hint: firstWeeklyText(), compact: true })) +
    kv([["Contests", k.contests], ["Q3+ solve rate", k.q3_rate != null ? Math.round(k.q3_rate * 100) + "%" : "—"], ["Target", targetText(k)], ["Deadline", `${fmtDay(k.deadline, { day: "numeric", month: "short", year: "numeric" })} · ${left}d`],
      ...(k.earned_badge ? [["Badge earned", Badge(esc(k.earned_badge), "ok")]] : [])]));
  if (k.rating && $("#spark")) sparkline($("#spark"), rated, k.target_rating);

  if (S.lc) {
    const onLc = (d) => { if (S) { S.lc = d; loadRail(); } };
    paintProfileCard($("#wb-leetcode"), S.lc, onLc);
    paintSuggestionsBanner($("#lcBanner"), S.lc, onLc);
  }

  set("progress", `<div class="big-row"><span class="big">${s.done}<span class="faint"> / ${s.total}</span></span><span class="muted small">solved · ${s.mastered} mastered</span></div>
    <div class="hbars">${diffs.map((r) => HBar(DiffPill(r.difficulty), r.done || 0, r.total, { color: `var(--${r.difficulty.toLowerCase()})` })).join("")}</div>
    ${kv([["Reviews due", s.reviews_due], ["Projected finish", s.projected_finish ? fmtDay(s.projected_finish, { day: "numeric", month: "short", year: "numeric" }) : "—"]])}
    <div class="faint small">${esc(s.projected_finish_basis)}</div>`);

  set("homework", s.homework.length ? s.homework.map((g) => `<div class="hw"><div class="hw-head"><b>${esc(g.goal)}</b><span class="muted small">${g.done}/${g.total}${g.minutes_left ? ` · ${hm(g.minutes_left)} left` : " · complete"}</span></div>
      <div class="hb-track" role="img" aria-label="${g.done} of ${g.total}"><i style="width:${g.total ? (g.done / g.total) * 100 : 0}%;background:var(--k-ai)"></i></div></div>`).join("")
    : EmptyState({ icon: "book", title: "No homework cards this week", hint: "Run /homework-plan or plan the week on the AI course page.", compact: true }));

  const hm12 = set("heatmap", `<div class="chart" id="miniHm"></div>`);
  if (hm12) heatmap($("#miniHm"), s.heatmap, { weeks: 12, mini: true });
}

/** Date of the first live Weekly (Sunday of sprint `weekly_live_from_week`), from saved settings. */
function firstWeeklyText() {
  const c = S.settings?.contests, start = S.settings?.start_date;
  if (!c || !start || !c.weekly_live) return "Log a live contest to start the rating line.";
  const d = addDays(start, (c.weekly_live_from_week - 1) * 7 + 6);
  return d >= todayStr() ? `Your first live Weekly is ${fmtDay(d, { day: "numeric", month: "short" })}.` : "Log your next live Weekly on the Contests page.";
}

// ---------- actions ----------
function select(id) {
  S.sel = id;
  $$(".card.selected").forEach((c) => c.classList.remove("selected"));
  const c = $(`#wb-board .card[data-id="${id}"]`);
  c?.classList.add("selected");
  c?.scrollIntoView({ block: "nearest" });
}

async function toggleTimer(t) {
  if (timer.isRunning(t.id)) return timer.pause();
  await timer.start(t);
  if (t.status !== "doing") await patchTicket(t.id, { status: "doing" });
  refresh();
}

const undoTo = (t, prev) => ({ label: "Undo", run: async () => { await patchTicket(t.id, { status: prev }); refresh(); } });

/** Single entry point for status changes (buttons, drag, keys). Done opens the quick log. */
async function setStatus(t, status, anchor) {
  if (status === t.status) return;
  const prev = t.status;
  if (status === "done") {
    if (t.kind === "contest") { await patchTicket(t.id, { status: "done" }); await refresh(); return logContest(t); }
    if (LOGGABLE.includes(t.kind) || t.kind === "ai") return quickLog(t, anchor);
    const m = timer.totalMinutes(t);
    await patchTicket(t.id, { status: "done", ...(m != null ? { minutes_spent: m } : {}) });
    timer.clearFor(t.id);
    toast("Marked done", { action: undoTo(t, prev) });
  } else {
    await patchTicket(t.id, { status });
    if (status === "skipped") timer.clearFor(t.id);
    toast(`Moved to ${STATUS_LABEL[status]}`, { action: undoTo(t, prev) });
  }
  refresh();
}

function logContest(t) {
  shared.contestPrefill = { date: t.date, kind: t.title.includes("Biweekly") ? "biweekly" : t.title.includes("LIVE") ? "weekly" : "virtual" };
  location.hash = "#/contests";
  toast("Log the contest result here");
}

/** The quick log for the drag-to-Done moment: result, minutes, confidence, note. Spaced repetition depends on it. */
function quickLog(t, anchor) {
  const loggable = LOGGABLE.includes(t.kind), ai = t.kind === "ai", prev = t.status;
  const mins = timer.totalMinutes(t) ?? t.minutes_spent ?? t.est_minutes;
  openPopover(anchor || $("#wb-now") || document.body, `
    <h3 class="ql-title">${icon("check")} Log · ${esc(t.title)}</h3>
    ${loggable ? `<label class="field"><span class="f-label">Result</span>${Segmented("result", [["solved", "Solved"], ["hints", "Hints"], ["failed", "Couldn't"]], t.result || "solved")}</label>
      <label class="field"><span class="f-label">Confidence</span>${Segmented("confidence", [1, 2, 3, 4, 5].map((n) => [n, n]), t.confidence || 3)}</label>` : ""}
    <label class="field"><span class="f-label">Minutes</span><input type="number" name="minutes_spent" min="0" value="${mins}" autofocus></label>
    <label class="field"><span class="f-label">${ai ? "What you covered" : "Key insight"}</span><input name="note" value="${esc(t.note || "")}" placeholder="${ai ? "e.g. backprop derivation, HW Q3" : "e.g. shrink window when count > k"}"></label>
    ${loggable ? `<label class="field"><span class="f-label">Submission link</span><input name="link" value="${esc(t.link || "")}" placeholder="https://leetcode.com/submissions/…"></label>` : ""}
    <div class="btns"><button type="button" class="btn btn-ghost btn-md" data-act="cancel">Cancel <kbd>Esc</kbd></button><button class="btn btn-primary btn-md">Save <kbd>↵</kbd></button></div>`,
  async (_, d) => {
    const body = { status: "done", minutes_spent: d.minutes_spent !== "" ? +d.minutes_spent : null, note: d.note || null };
    if (loggable) { body.result = d.result; body.confidence = +d.confidence; body.link = d.link || null; }
    await patchTicket(t.id, body);
    timer.clearFor(t.id);
    toast("Marked done", { action: undoTo(t, prev) });
    refresh();
  });
}

function openTicket(id) {
  const t = byId(id);
  if (!t) return;
  openTicketPanel(t, { onChanged: refresh, onContestDone: logContest });
}

/** N: focus the inline composer (or a small modal if the board widget is hidden/collapsed). */
function addCard() {
  const i = $("#cTitle");
  if (i) { i.scrollIntoView({ block: "center", behavior: "smooth" }); i.focus(); return; }
  openModal(`
    <h2>New card · ${fmtDay(S.date)}</h2>
    <label class="field"><span class="f-label">Title</span><input name="title" required autofocus></label>
    <label class="field"><span class="f-label">Type</span><select name="kind"><option value="custom">Task</option><option value="ai">AI</option><option value="dsa">DSA</option><option value="contest">Contest</option></select></label>
    <label class="field"><span class="f-label">Estimate (minutes)</span><input type="number" name="est_minutes" value="30" min="5"></label>
    <div class="btns"><button type="button" class="btn btn-ghost btn-md" data-act="cancel">Cancel</button><button class="btn btn-primary btn-md">Add</button></div>`,
  async (_, d) => {
    S.board = await api("/tickets", { method: "POST", body: { date: S.date, title: d.title, kind: d.kind, est_minutes: +d.est_minutes } });
    paintAll();
    refresh();
  });
}

async function pull() {
  S.board = await api(`/day/${S.date}/pull`, { method: "POST" });
  paintAll(); paintHead();
  toast("Pulled the next question");
  loadRail();
}

/** Close day as a guided slide-over: 1 summary, 2 evening log, 3 confirm, then "Tomorrow is planned". */
function closeDay() {
  const b = S.board, closed = b.day?.closed_at, prev = b.day || {};
  const open = b.tickets.filter((t) => t.status === "todo" || t.status === "doing");
  const done = b.tickets.filter((t) => t.status === "done");
  const skipped = b.tickets.filter((t) => t.status === "skipped");
  const aiNotes = b.tickets.filter((t) => t.kind === "ai" && t.note).map((t) => t.note).join("; ");
  const log = { energy: prev.energy || 3, ai_topics: prev.ai_topics || aiNotes, notes: prev.notes || "" };
  const spent = done.reduce((s, t) => s + (t.minutes_spent || 0), 0);
  let step = 1;
  const li = (t) => `<li>${TrackDot(t.kind)}<span class="cl-title">${esc(t.title)}</span>${t.minutes_spent ? `<span class="muted small">${hm(t.minutes_spent)}</span>` : ""}</li>`;
  const so = SlideOver({ width: 520, label: "Close day" });
  const steps = ["Review", "Evening log", "Confirm"];

  function head() {
    so.setHead(`<div class="so-titles"><h2>${closed ? "Update day log" : "Close day"} · ${fmtDay(b.date, { weekday: "short", day: "numeric", month: "short" })}</h2>
      <ol class="stepper">${steps.map((s, i) => `<li class="${i + 1 === step ? "on" : i + 1 < step ? "past" : ""}"><span>${i + 1 < step ? icon("check") : i + 1}</span>${s}</li>`).join("")}</ol></div>`);
  }
  function readLog() {
    const f = $("#clForm", so.el);
    if (!f) return;
    const d = Object.fromEntries(new FormData(f));
    Object.assign(log, { energy: +d.energy, ai_topics: d.ai_topics, notes: d.notes });
  }
  function paint() {
    head();
    if (step === 1) {
      so.setBody(`<div class="cl-stats">
          <div><b>${done.length}</b><span>done</span></div><div><b>${open.length}</b><span>still open</span></div><div><b>${skipped.length}</b><span>skipped</span></div><div><b>${hm(spent)}</b><span>logged</span></div></div>
        <section class="so-section"><h3>Done (${done.length})</h3>${done.length ? `<ul class="cl-list">${done.map(li).join("")}</ul>` : `<div class="muted small">Nothing finished yet.</div>`}</section>
        <section class="so-section"><h3>Will carry over to tomorrow (${open.length})</h3>${open.length ? `<ul class="cl-list carry">${open.map(li).join("")}</ul>` : `<div class="muted small">Nothing open. Clean slate.</div>`}</section>
        ${skipped.length ? `<section class="so-section"><h3>Skipped (${skipped.length})</h3><ul class="cl-list skipped">${skipped.map(li).join("")}</ul></section>` : ""}`);
      so.setFoot(`<span class="sp"></span>${Button({ label: "Cancel", kind: "ghost", id: "clCancel" })}${Button({ label: "Next", iconRight: "right", kind: "primary", id: "clNext" })}`);
    } else if (step === 2) {
      so.setBody(`<form id="clForm" autocomplete="off">
        <label class="field"><span class="f-label">Energy today</span>${Segmented("energy", [1, 2, 3, 4, 5].map((n) => [n, n]), log.energy)}</label>
        <label class="field"><span class="f-label">AI topics covered</span><input name="ai_topics" value="${esc(log.ai_topics)}" placeholder="e.g. attention, positional encodings"></label>
        <label class="field"><span class="f-label">Notes / blockers</span><textarea name="notes" rows="5" placeholder="What got in the way? What went well?">${esc(log.notes)}</textarea></label></form>`);
      so.setFoot(`${Button({ label: "Back", icon: "left", kind: "ghost", id: "clBack" })}<span class="sp"></span>${Button({ label: "Next", iconRight: "right", kind: "primary", id: "clNext" })}`);
      $("#clForm", so.el).addEventListener("submit", (e) => { e.preventDefault(); readLog(); step = 3; paint(); });
      $("[name=ai_topics]", so.el).focus();
    } else if (step === 3) {
      so.setBody(`<div class="cl-confirm">
        <p>${closed ? "This updates the evening log for this day." : `Closing <b>${fmtDay(b.date)}</b> saves your evening log and plans tomorrow.`}</p>
        <dl class="kv">
          <dt>Done</dt><dd>${done.length} card${done.length === 1 ? "" : "s"}</dd>
          <dt>Carries over</dt><dd>${open.length} card${open.length === 1 ? "" : "s"}</dd>
          <dt>Energy</dt><dd>${log.energy} / 5</dd>
          <dt>AI topics</dt><dd>${esc(log.ai_topics) || `<span class="faint">—</span>`}</dd>
          <dt>Notes</dt><dd>${esc(log.notes) || `<span class="faint">—</span>`}</dd>
        </dl></div>`);
      so.setFoot(`${Button({ label: "Back", icon: "left", kind: "ghost", id: "clBack" })}<span class="sp"></span>${Button({ label: closed ? "Update day log" : "Close day & plan tomorrow", icon: "check", kind: "primary", id: "clGo" })}`);
      $("#clGo", so.el).focus();
    } else {
      so.setBody(`<div class="cl-done">${ProgressRing({ value: 1, max: 1, size: 64, stroke: 5, color: "var(--ok)", center: icon("check") })}
        <h2>Tomorrow is planned</h2><p class="muted">${S.nextDate ? fmtDay(S.nextDate) : "Your next day"} is ready${open.length ? `, with ${open.length} card${open.length === 1 ? "" : "s"} carried over` : ""}.</p>
        <div class="btn-row">${Button({ label: "View tomorrow", iconRight: "right", kind: "primary", id: "clView" })}${Button({ label: "Stay here", kind: "ghost", id: "clStay" })}</div></div>`);
      so.setFoot("");
      $("#clView", so.el).focus();
    }
    $("#clCancel", so.el)?.addEventListener("click", so.close);
    $("#clStay", so.el)?.addEventListener("click", so.close);
    $("#clNext", so.el)?.addEventListener("click", () => { if (step === 2) readLog(); step++; paint(); });
    $("#clBack", so.el)?.addEventListener("click", () => { if (step === 2) readLog(); step--; paint(); });
    $("#clView", so.el)?.addEventListener("click", () => { const d = S?.nextDate; so.close(); goDay(d); });
    $("#clGo", so.el)?.addEventListener("click", async (e) => {
      e.currentTarget.disabled = true;
      try {
        const next = await api(`/day/${b.date}/close`, { method: "POST", body: { energy: log.energy, ai_topics: log.ai_topics, notes: log.notes } });
        S.nextDate = next.date;
        document.dispatchEvent(new Event("dsm:changed"));
        step = 4; paint();
        refresh();
      } catch { e.currentTarget.disabled = false; }
    });
  }
  paint();
}

// ---------- keyboard ----------
function moveSel(delta) {
  const ids = $$("#wb-board .card").map((c) => +c.dataset.id);
  if (!ids.length) return;
  const i = ids.indexOf(S.sel);
  select(ids[i < 0 ? (delta > 0 ? 0 : ids.length - 1) : Math.min(ids.length - 1, Math.max(0, i + delta))]);
}

function shiftStatus(delta) {
  const t = byId(S.sel);
  if (!t) return false;
  const next = STATUSES[STATUSES.indexOf(t.status) + delta];
  if (next) setStatus(t, next, $(`#wb-board .card[data-id="${t.id}"]`));
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
    case "x": { const t = byId(S.sel); if (!t) return false; setStatus(t, "done", $(`#wb-board .card[data-id="${t.id}"]`)); return true; }
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
