// Sprint: one Mon-Sun week at a glance (KPIs, day strip), with goal and retro notes.
import { $, esc, today as todayStr, fmtDay, KIND_LABEL } from "../util.js";
import { api } from "../api.js";
import { Toolbar, IconButton, Button, Badge, Stat, Widget, ProgressRing, TrackDot, toast } from "../components/index.js";

let sprintId = "current";

export async function render(root) {
  root.innerHTML = `<div id="spHead"></div>
    <div class="grid">
      ${Widget({ id: "spKpis", span: 12, flush: true })}
      ${Widget({ id: "spDays", title: "Days", span: 12 })}
      ${Widget({ id: "spGoal", title: "Sprint goal", span: 6, body: `<textarea id="sprintGoal" rows="5" aria-label="Sprint goal" placeholder="e.g. Finish Arrays two-pointer + sliding window; first virtual contest"></textarea>` })}
      ${Widget({ id: "spRetro", title: "Retro · what worked, what to change", span: 6, body: `<textarea id="sprintRetro" rows="5" aria-label="Retro"></textarea>` })}
    </div>
    <div class="save-row">${Button({ label: "Save sprint", kind: "primary", id: "saveSprint", icon: "check" })}<span class="muted small" id="spDirty"></span></div>`;
  $("#saveSprint").onclick = async () => {
    await api(`/sprint/${sprintId}`, { method: "PATCH", body: { goal: $("#sprintGoal").value, retro: $("#sprintRetro").value } });
    $("#spDirty").textContent = "";
    toast("Sprint saved");
  };
  ["#sprintGoal", "#sprintRetro"].forEach((s) => $(s).addEventListener("input", () => ($("#spDirty").textContent = "Unsaved changes")));
  await load();
}

async function load() {
  const s = await api(`/sprint/${sprintId}`);
  if (!s.id) { toast("No such sprint yet"); throw new Error("no sprint"); }
  sprintId = s.id;
  $("#spHead").innerHTML = Toolbar({
    lead: IconButton({ icon: "left", label: "Previous sprint", id: "prevSprint", kind: "secondary" }) + IconButton({ icon: "right", label: "Next sprint", id: "nextSprint", kind: "secondary" }),
    title: `Sprint ${s.id}${s.id === s.current ? Badge("Current", "accent") : ""}`,
    sub: `${fmtDay(s.start_date, { day: "numeric", month: "short" })} – ${fmtDay(s.end_date, { day: "numeric", month: "short" })} · Mon–Sat work, Sun buffer`,
  });
  $("#prevSprint").onclick = () => { if (sprintId > 1) { sprintId--; load(); } };
  $("#nextSprint").onclick = () => { sprintId++; load().catch(() => { sprintId--; }); };
  const rate = s.planned ? Math.round((s.done / s.planned) * 100) : 0;
  $("#wb-spKpis").innerHTML = `<div class="stats-row sprint-kpis">
    <div class="stat ring-stat">${ProgressRing({ value: s.done, max: s.planned || 1, size: 56, stroke: 5, center: `<b class="ring-num">${rate}%</b>`, label: `${rate}% completion` })}
      <div><div class="stat-label">Cards done</div><div class="stat-value">${s.done}<small>/ ${s.planned}</small></div></div></div>
    ${Stat({ label: "New questions solved", value: s.questions_done, accent: "var(--k-dsa)" })}
    ${Stat({ label: "Cards carried in", value: s.carried_in, sub: "rolled over from an earlier day" })}</div>`;
  $("#wb-spDays").innerHTML = `<div class="sprint-days">${s.days.map((d) => `
    <a class="sday${d.date === todayStr() ? " today" : ""}${new Date(d.date + "T00:00:00").getDay() === 0 ? " buffer" : ""}" href="#/today${d.date === todayStr() ? "" : "/" + d.date}">
      <div class="sd-head"><span class="sd-name">${fmtDay(d.date, { weekday: "short" })}</span><span class="sd-date">${fmtDay(d.date, { day: "numeric" })}</span></div>
      <div class="sd-prog">${d.total ? `<div class="hb-track"><i style="width:${(d.done / d.total) * 100}%"></i></div><span class="muted small">${d.done}/${d.total}</span>` : `<span class="faint small">not planned yet</span>`}</div>
      <ul class="sd-list">${d.tickets.slice(0, 7).map((t) => `<li class="${t.status === "done" ? "done" : ""}" data-tip="${KIND_LABEL[t.kind]} · ${t.status}">${TrackDot(t.kind, 6)}<span>${esc(t.title)}</span></li>`).join("")}${d.tickets.length > 7 ? `<li class="more">+${d.tickets.length - 7} more</li>` : ""}</ul>
    </a>`).join("")}</div>`;
  $("#sprintGoal").value = s.goal || "";
  $("#sprintRetro").value = s.retro || "";
  $("#spDirty").textContent = "";
}
