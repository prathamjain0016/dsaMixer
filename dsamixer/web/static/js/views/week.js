// Week: Mon-Sun columns with capacity meters; drag a card to another day to reschedule it.
import { $, $$, esc, today as todayStr, addDays, mondayOf, fmtDay, hm, LANES, laneOf, KIND_LABEL } from "../util.js";
import { api, patchTicket } from "../api.js";
import { icon, meterHtml, diffPill, toast } from "../ui.js";
import { setViewKeys } from "../keys.js";

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
  S.root.innerHTML = `
    <div class="page-head">
      <div class="head-left">
        <button class="btn icon" id="prevWeek" aria-label="Previous week" data-tip="Previous week  [">${icon("left")}</button>
        <div class="head-title"><h1>${range}${thisWeek ? ` <span class="chip accent">This week</span>` : ""}</h1><div class="head-sub"><span class="chip plain">Sprint ${w.sprint}</span></div></div>
        <button class="btn icon" id="nextWeek" aria-label="Next week" data-tip="Next week  ]">${icon("right")}</button>
        <button class="btn" id="thisWeek" data-tip="Jump to this week  .">This week</button>
      </div>
      <div class="muted small">Drag a card to another day to reschedule it. Done cards stay put.</div>
    </div>
    <div class="week-grid">${w.days.map(dayHtml).join("")}</div>`;
  $("#prevWeek").onclick = () => goWeek(addDays(S.monday, -7));
  $("#nextWeek").onclick = () => goWeek(addDays(S.monday, 7));
  $("#thisWeek").onclick = () => goWeek(todayStr());
}

function dayHtml(d) {
  const future = d.date > todayStr();
  const lanes = LANES.map((l) => [l, d.tickets.filter((t) => l.kinds.includes(t.kind))]).filter(([, ts]) => ts.length);
  const note = !d.planned && future ? `<div class="wd-empty">${icon("calendar")}<span>Not planned yet</span></div>` : !d.tickets.length ? `<div class="wd-empty">${icon("inbox")}<span>No cards</span></div>` : "";
  return `<section class="wday ${d.is_today ? "today" : ""} ${d.is_buffer ? "buffer" : ""}" data-date="${d.date}" aria-label="${fmtDay(d.date)}">
    <a class="wd-head" href="#/today${d.is_today ? "" : "/" + d.date}" data-tip="Open ${fmtDay(d.date)}">
      <span class="wd-name">${fmtDay(d.date, { weekday: "short" })}</span><span class="wd-date">${fmtDay(d.date, { day: "numeric", month: "short" })}</span>
      <span class="wd-badges">${d.is_today ? `<span class="chip accent">Today</span>` : ""}${d.is_buffer ? `<span class="chip warn plain">Buffer</span>` : ""}${d.closed ? `<span class="chip ok plain" aria-label="Day closed">${icon("check")} Closed</span>` : ""}</span>
    </a>
    <div class="wd-meters">
      ${meterHtml({ label: "DSA", used: d.minutes.dsa, cap: d.dsa_budget, color: "var(--k-dsa)" })}
      ${meterHtml({ label: "AI", used: d.minutes.ai, cap: d.ai_capacity, color: "var(--k-ai)" })}
      ${d.minutes.other ? `<div class="wd-other"><span>Contest & other</span><b>${hm(d.minutes.other)}</b></div>` : ""}
    </div>
    <div class="wd-body">${note}${lanes.map(([l, ts]) => `<div class="wd-lane">${l.name}</div>${ts.map(cardHtml).join("")}`).join("")}</div>
  </section>`;
}

function cardHtml(t) {
  const done = t.status === "done";
  const st = done ? `<span class="w-st" aria-label="Done">${icon("check")}</span>` : t.status === "doing" ? `<span class="chip accent plain">In progress</span>` : t.status === "skipped" ? `<span class="chip plain">Skipped</span>` : "";
  return `<div class="wcard k-${t.kind} st-${t.status}" ${done ? "" : `draggable="true"`} data-id="${t.id}" tabindex="0" data-tip="${esc(t.title)}${t.detail ? " · " + esc(t.detail) : ""}${done ? "" : "  (drag to move)"}">
    <div class="w-top"><span class="w-kind">${KIND_LABEL[t.kind]}</span>${diffPill(t.difficulty)}${t.carried ? `<span class="chip carried" aria-label="Carried ${t.carried}">${icon("carried")}${t.carried}</span>` : ""}${st}<span class="w-min">${hm(t.minutes_spent ?? t.est_minutes)}</span></div>
    <div class="w-title">${esc(t.title)}</div></div>`;
}

function bind() {
  const root = S.root;
  root.addEventListener("dragstart", (e) => { const c = e.target.closest?.(".wcard"); if (c) { c.classList.add("dragging"); e.dataTransfer.setData("text/plain", c.dataset.id); } });
  root.addEventListener("dragend", (e) => e.target.closest?.(".wcard")?.classList.remove("dragging"));
  root.addEventListener("dragover", (e) => { const d = e.target.closest?.(".wday"); if (d) { e.preventDefault(); $$(".wday.drag-over").forEach((x) => x !== d && x.classList.remove("drag-over")); d.classList.add("drag-over"); } });
  root.addEventListener("dragleave", (e) => { if (!e.relatedTarget?.closest?.(".wday")) $$(".wday.drag-over").forEach((x) => x.classList.remove("drag-over")); });
  root.addEventListener("drop", async (e) => {
    const day = e.target.closest?.(".wday");
    if (!day) return;
    e.preventDefault();
    day.classList.remove("drag-over");
    const id = +e.dataTransfer.getData("text/plain");
    const from = S.data.days.find((d) => d.tickets.some((t) => t.id === id));
    if (!from || from.date === day.dataset.date || from.tickets.find((t) => t.id === id).status === "done") return;
    await patchTicket(id, { date: day.dataset.date });
    toast(`Moved to ${fmtDay(day.dataset.date)}`);
    await load();
    document.dispatchEvent(new Event("dsm:changed"));
  });
  root.addEventListener("click", (e) => {
    const c = e.target.closest?.(".wcard");
    if (c) { const d = c.closest(".wday").dataset.date; location.hash = d === todayStr() ? "#/today" : `#/today/${d}`; }
  });
  root.addEventListener("keydown", (e) => { const c = e.target.closest?.(".wcard"); if (c && e.target === c && e.key === "Enter") c.click(); });
}
