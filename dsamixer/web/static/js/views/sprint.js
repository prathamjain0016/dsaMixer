// Sprint: one Mon-Sun week at a glance, with goal and retro notes.
import { $, $$, esc, today as todayStr, fmtDay, KIND_LABEL } from "../util.js";
import { api } from "../api.js";
import { icon, kpi, toast } from "../ui.js";

let sprintId = "current";

export async function render(root) {
  root.innerHTML = `
    <div class="page-head"><div class="head-left">
      <button class="btn icon" id="prevSprint" aria-label="Previous sprint">${icon("left")}</button>
      <div class="head-title"><h1 id="sprintTitle"></h1><div id="sprintSub" class="muted small"></div></div>
      <button class="btn icon" id="nextSprint" aria-label="Next sprint">${icon("right")}</button>
    </div></div>
    <div id="sprintKpis" class="kpis"></div>
    <div id="sprintDays" class="sprint-days"></div>
    <div class="two">
      <label class="field panel">Sprint goal<textarea id="sprintGoal" rows="4" placeholder="e.g. Finish Arrays two-pointer + sliding window; first virtual contest"></textarea></label>
      <label class="field panel">Retro (what worked, what to change)<textarea id="sprintRetro" rows="4"></textarea></label>
    </div>
    <div class="mt"><button class="btn primary" id="saveSprint">Save</button></div>`;
  $("#prevSprint").onclick = () => { if (sprintId > 1) { sprintId--; load(); } };
  $("#nextSprint").onclick = () => { sprintId++; load().catch(() => { sprintId--; }); };
  $("#saveSprint").onclick = async () => {
    await api(`/sprint/${sprintId}`, { method: "PATCH", body: { goal: $("#sprintGoal").value, retro: $("#sprintRetro").value } });
    toast("Sprint saved");
  };
  await load();
}

async function load() {
  const s = await api(`/sprint/${sprintId}`);
  if (!s.id) { toast("No such sprint yet"); throw new Error("no sprint"); }
  sprintId = s.id;
  $("#sprintTitle").innerHTML = `Sprint ${s.id}${s.id === s.current ? ` <span class="chip accent">Current</span>` : ""}`;
  $("#sprintSub").textContent = `${fmtDay(s.start_date, { day: "numeric", month: "short" })} – ${fmtDay(s.end_date, { day: "numeric", month: "short" })} · Mon–Sat work, Sun buffer`;
  const rate = s.planned ? Math.round((s.done / s.planned) * 100) : 0;
  $("#sprintKpis").innerHTML = [
    kpi("Cards done", `${s.done}<small> / ${s.planned}</small>`, `${rate}% completion`),
    kpi("New questions solved", s.questions_done),
    kpi("Cards carried in", s.carried_in, "rolled over from an earlier day"),
  ].join("");
  $("#sprintDays").innerHTML = s.days.map((d) => `
    <a class="sday ${d.date === todayStr() ? "today" : ""} ${new Date(d.date + "T00:00:00").getDay() === 0 ? "buffer" : ""}" href="#/today${d.date === todayStr() ? "" : "/" + d.date}">
      <div class="dname">${fmtDay(d.date, { weekday: "short", day: "numeric" })}</div>
      <div class="muted small">${d.total ? `${d.done}/${d.total} done` : "not planned yet"}</div>
      <div class="mini">${d.tickets.slice(0, 8).map((t) => `<span class="k-${t.kind} ${t.status === "done" ? "done" : ""}" data-tip="${KIND_LABEL[t.kind]} · ${t.status}">${esc(t.title)}</span>`).join("")}${d.tickets.length > 8 ? `<span class="more">+${d.tickets.length - 8} more</span>` : ""}</div>
    </a>`).join("");
  $("#sprintGoal").value = s.goal || "";
  $("#sprintRetro").value = s.retro || "";
}
