// Week: a seven-column planner with per-day meters. Drag a card to another day to reschedule it;
// click a card for its detail slide-over.
import { $, $$, today as todayStr, addDays, mondayOf, fmtDay, hm, LANES } from "../util.js";
import { api, patchTicket } from "../api.js";
import { icon } from "../ui.js";
import { setViewKeys } from "../keys.js";
import { openTicketPanel } from "../ticket-panel.js";
import { Toolbar, Button, IconButton, Badge, Meter, Card, toast } from "../components/index.js";

let S = null;

export async function render(root, arg) {
  const date = /^\d{4}-\d\d-\d\d$/.test(arg || "") ? arg : todayStr();
  const el = document.createElement("div"); // listeners live on this per-render element, not on the shared root
  root.appendChild(el);
  S = { root: el, monday: mondayOf(date), data: null };
  bind();
  setViewKeys((e) => {
    if (e.key === "[") return goWeek(addDays(S.monday, -7)), true;
    if (e.key === "]") return goWeek(addDays(S.monday, 7)), true;
    if (e.key === ".") return goWeek(todayStr()), true;
    return false;
  });
  await load();
}

export function destroy() { S = null; }

const goWeek = (d) => { const m = mondayOf(d); location.hash = m === mondayOf(todayStr()) ? "#/week" : `#/week/${m}`; };
const goDay = (d) => { location.hash = d === todayStr() ? "#/today" : `#/today/${d}`; };

async function load() {
  const monday = S.monday;
  const data = await api(`/week/${monday}`);
  if (!S || S.monday !== monday) return;
  S.data = data;
  paint();
}

function paint() {
  const w = S.data, thisWeek = S.monday === mondayOf(todayStr());
  const range = `${fmtDay(w.start, { day: "numeric", month: "short" })} – ${fmtDay(w.end, { day: "numeric", month: "short" })}`;
  const all = w.days.flatMap((d) => d.tickets), done = all.filter((t) => t.status === "done").length;
  const mins = w.days.reduce((s, d) => s + d.minutes.dsa + d.minutes.ai + d.minutes.other, 0);
  S.root.innerHTML = Toolbar({
    lead: IconButton({ icon: "left", label: "Previous week", tip: "Previous week  [", id: "prevWeek", kind: "secondary" }) +
      IconButton({ icon: "right", label: "Next week", tip: "Next week  ]", id: "nextWeek", kind: "secondary" }),
    title: `${range}${thisWeek ? Badge("This week", "accent") : ""}`,
    sub: `<span>Sprint ${w.sprint}</span><span class="faint">·</span><span>${done}/${all.length} done · ${hm(mins)} planned</span><span class="faint">·</span><span>Drag a card to another day to reschedule it</span>`,
    actions: thisWeek ? "" : Button({ label: "This week", kind: "ghost", id: "thisWeek", tip: "Jump to this week  ." }),
  }) + `<div class="week-grid">${w.days.map(dayHtml).join("")}</div>`;
  $("#prevWeek", S.root).onclick = () => goWeek(addDays(S.monday, -7));
  $("#nextWeek", S.root).onclick = () => goWeek(addDays(S.monday, 7));
  $("#thisWeek", S.root)?.addEventListener("click", () => goWeek(todayStr()));
}

function dayHtml(d) {
  const future = d.date > todayStr(), past = d.date < todayStr();
  const lanes = LANES.map((l) => [l, d.tickets.filter((t) => l.kinds.includes(t.kind))]).filter(([, ts]) => ts.length);
  const done = d.tickets.filter((t) => t.status === "done").length;
  const note = !d.planned && future && !d.tickets.length ? `<div class="wd-empty">${icon("calendar")}<span>Not planned yet</span></div>` : !d.tickets.length ? `<div class="wd-empty">${icon("inbox")}<span>No cards</span></div>` : "";
  return `<section class="wday${d.is_today ? " today" : ""}${d.is_buffer ? " buffer" : ""}${past ? " past" : ""}" data-date="${d.date}" aria-label="${fmtDay(d.date)}">
    <a class="wd-head" href="#/today${d.is_today ? "" : "/" + d.date}" data-tip="Open ${fmtDay(d.date)}">
      <span class="wd-name">${fmtDay(d.date, { weekday: "short" })}</span><span class="wd-date">${fmtDay(d.date, { day: "numeric" })}</span>
      <span class="wd-badges">${d.is_buffer ? Badge("Buffer", "outline") : ""}${d.closed ? `<span class="wd-closed" aria-label="Day closed" data-tip="Day closed">${icon("check")}</span>` : ""}${d.tickets.length ? `<span class="wd-count">${done}/${d.tickets.length}</span>` : ""}</span>
    </a>
    <div class="wd-meters">
      ${Meter({ label: "DSA", used: d.minutes.dsa, cap: d.dsa_budget, color: "var(--k-dsa)", compact: true })}
      ${Meter({ label: "AI", used: d.minutes.ai, cap: d.ai_capacity, color: "var(--k-ai)", compact: true })}
      ${d.minutes.other ? `<div class="wd-other"><span>Contest & other</span><b>${hm(d.minutes.other)}</b></div>` : ""}
    </div>
    <div class="wd-body">${note}${lanes.map(([l, ts]) => `<div class="wd-lane">${l.name}</div>${ts.map((t) => Card(t, { compact: true, draggable: t.status !== "done" })).join("")}`).join("")}<div class="wd-drop">Move here</div></div>
  </section>`;
}

/** The week payload is slim; fetch the full card from its day before opening the slide-over. */
async function openCard(id, date) {
  const day = await api(`/day/${date}`);
  const t = day.tickets.find((x) => x.id === id);
  if (!t || !S) return;
  openTicketPanel(t, {
    onChanged: async () => { await load(); document.dispatchEvent(new Event("dsm:changed")); },
    onContestDone: () => goDay(date),
    openDay: goDay,
  });
}

function bind() {
  const root = S.root;
  root.addEventListener("dragstart", (e) => { const c = e.target.closest?.(".card"); if (c) { c.classList.add("dragging"); e.dataTransfer.setData("text/plain", c.dataset.id); root.classList.add("dragging-card"); } });
  root.addEventListener("dragend", (e) => { e.target.closest?.(".card")?.classList.remove("dragging"); root.classList.remove("dragging-card"); $$(".wday.drag-over", root).forEach((x) => x.classList.remove("drag-over")); });
  root.addEventListener("dragover", (e) => { const d = e.target.closest?.(".wday"); if (d) { e.preventDefault(); $$(".wday.drag-over", root).forEach((x) => x !== d && x.classList.remove("drag-over")); d.classList.add("drag-over"); } });
  root.addEventListener("dragleave", (e) => { if (!e.relatedTarget?.closest?.(".wday")) $$(".wday.drag-over", root).forEach((x) => x.classList.remove("drag-over")); });
  root.addEventListener("drop", async (e) => {
    const day = e.target.closest?.(".wday");
    if (!day) return;
    e.preventDefault();
    day.classList.remove("drag-over");
    root.classList.remove("dragging-card");
    const id = +e.dataTransfer.getData("text/plain");
    const from = S.data.days.find((d) => d.tickets.some((t) => t.id === id));
    if (!from || from.date === day.dataset.date || from.tickets.find((t) => t.id === id).status === "done") return;
    await patchTicket(id, { date: day.dataset.date });
    toast(`Moved to ${fmtDay(day.dataset.date)}`, { action: { label: "Undo", run: async () => { await patchTicket(id, { date: from.date }); await load(); document.dispatchEvent(new Event("dsm:changed")); } } });
    await load();
    document.dispatchEvent(new Event("dsm:changed"));
  });
  root.addEventListener("click", (e) => {
    const c = e.target.closest?.(".card");
    if (c) openCard(+c.dataset.id, c.closest(".wday").dataset.date);
  });
  root.addEventListener("keydown", (e) => { const c = e.target.closest?.(".card"); if (c && e.target === c && e.key === "Enter") c.click(); });
}

