// AI course: weekly planner (preview / edit / apply) and the syllabus.
import { $, $$, esc, fmtDay, hm } from "../util.js";
import { api } from "../api.js";
import { toast, icon } from "../ui.js";

let weekDraft = null;

export async function render(root) {
  weekDraft = null;
  root.innerHTML = `
    <div class="page-head"><h1>AI course</h1></div>
    <div class="panel">
      <div class="panel-head"><h3>Plan this week's AI work</h3><span class="muted small" id="weekInfo"></span></div>
      <p class="muted">Describe everything you need to get done this week: homework, lectures to rewatch, topics to revise. The more detail, the better the tasks. Claude breaks it into 30–90 min tasks and spreads each goal across the week. You review before anything is added.</p>
      <div id="weekKeyWarn"></div>
      <textarea id="weekGoals" rows="7" aria-label="Goals for the week" placeholder="HW1: implement a transformer encoder block from scratch in PyTorch, test on toy data, write up results (due Friday)&#10;HW2: fine-tune DistilBERT for sentiment on IMDB, compare 2 learning rates&#10;Rewatch Sunday's lecture on attention, the part about positional encodings&#10;Revise backprop through softmax"></textarea>
      <div class="mt-s"><button class="btn primary" id="breakdownBtn">Break down with AI</button></div>
      <div id="weekPreview"></div>
    </div>
    <div class="two">
      <div class="panel"><h3>Syllabus</h3>
        <p class="muted small">The first unfinished module is shown on your AI cards. Mark one “in progress” to pin it.</p>
        <div id="modules"></div></div>
      <div class="panel"><h3>Import modules</h3>
        <p class="muted small">Paste one module per line.</p>
        <textarea id="moduleImport" rows="10" aria-label="Modules to import" placeholder="Module 1: Python for ML&#10;Module 2: Linear algebra refresher&#10;…"></textarea>
        <div class="mt-s"><button class="btn primary" id="importModules">Import</button></div></div>
    </div>`;
  $("#breakdownBtn").onclick = breakdown;
  $("#importModules").onclick = importModules;
  await Promise.all([loadModules(), loadWeek()]);
}

async function loadModules(list) {
  list = Array.isArray(list) ? list : await api("/ai-modules");
  $("#modules").innerHTML = list.length
    ? list.map((m) => `<div class="module"><span class="muted">${m.position}.</span><span class="t">${esc(m.title)}</span>
        <select data-mod="${m.id}" aria-label="Status of ${esc(m.title)}">${["upcoming", "in_progress", "done"].map((s) => `<option value="${s}" ${m.status === s ? "selected" : ""}>${s.replace("_", " ")}</option>`).join("")}</select>
        <button class="btn sm icon ghost danger" data-delmod="${m.id}" aria-label="Delete ${esc(m.title)}">${icon("close")}</button></div>`).join("")
    : `<div class="muted small">No syllabus yet — paste it on the right whenever you have it.</div>`;
  $$("[data-mod]").forEach((s) => (s.onchange = async () => loadModules(await api(`/ai-modules/${s.dataset.mod}`, { method: "PATCH", body: { status: s.value } }))));
  $$("[data-delmod]").forEach((b) => (b.onclick = async () => loadModules(await api(`/ai-modules/${b.dataset.delmod}`, { method: "DELETE" }))));
}

async function importModules() {
  const text = $("#moduleImport").value.trim();
  if (!text) return;
  loadModules(await api("/ai-modules/import", { method: "POST", body: { text } }));
  $("#moduleImport").value = "";
  toast("Syllabus imported");
}

async function loadWeek() {
  const w = await api("/ai-week");
  const cap = Object.values(w.capacity).reduce((a, b) => a + b, 0);
  const short = { weekday: "short", day: "numeric", month: "short" };
  $("#weekInfo").textContent = w.days.length
    ? `${fmtDay(w.days[0], short)} – ${fmtDay(w.days.at(-1), short)} · ${hm(cap)} of AI time · ${w.model} via ${w.provider === "openrouter" ? "OpenRouter" : "Anthropic"}`
    : "No weekdays left this week";
  $("#weekKeyWarn").innerHTML = w.key_configured ? "" :
    `<div class="banner warn"><span>No API key found. Add <code>OPENROUTER_API_KEY=…</code> (or <code>ANTHROPIC_API_KEY=…</code>) to <code>.env</code> and restart the app.</span></div>`;
  if (w.plan && !weekDraft) {
    $("#weekGoals").value = w.plan.goals;
    $("#weekPreview").innerHTML = `<div class="banner ok mt-s"><span>This week's plan is on your boards (${esc(w.plan.created_at)}). Break it down again to replace the cards you haven't started.</span></div>`;
  }
}

async function breakdown() {
  const goals = $("#weekGoals").value.trim();
  if (!goals) return toast("Describe your goals first");
  const btn = $("#breakdownBtn");
  btn.disabled = true; btn.textContent = "Thinking…";
  try {
    weekDraft = { goals, ...(await api("/ai-week/preview", { method: "POST", body: { goals } })) };
    renderPreview();
  } finally {
    btn.disabled = false; btn.textContent = "Break down with AI";
  }
}

function renderPreview() {
  const d = weekDraft;
  const dayOpt = (sel) => d.days.map((x) => `<option value="${x}" ${x === sel ? "selected" : ""}>${fmtDay(x, { weekday: "short", day: "numeric" })}</option>`).join("");
  const totals = d.days.map((x) => {
    const used = d.tasks.filter((t) => t.date === x).reduce((s, t) => s + (+t.minutes || 0), 0);
    const over = used > d.capacity[x];
    return `<span class="chip plain ${over ? "warn" : ""}">${fmtDay(x, { weekday: "short" })} ${hm(used)} / ${hm(d.capacity[x])}${over ? ` · +${hm(used - d.capacity[x])} over` : ""}</span>`;
  }).join(" ");
  $("#weekPreview").innerHTML = `
    <p class="mt">${esc(d.summary)}</p>
    <div class="chips-row">${totals}</div>
    <div class="table-wrap"><table class="table"><thead><tr><th>Day</th><th>Goal</th><th>Task</th><th>Min</th><th><span class="sr-only">Remove</span></th></tr></thead><tbody>
    ${d.tasks.map((t, i) => `<tr data-i="${i}">
      <td><select data-f="date" aria-label="Day">${dayOpt(t.date)}</select></td>
      <td class="muted">${esc(t.goal)}</td>
      <td><input data-f="title" aria-label="Task" value="${esc(t.title)}" style="width:100%"></td>
      <td><input data-f="minutes" aria-label="Minutes" type="number" min="5" step="5" value="${t.minutes}" style="width:80px"></td>
      <td><button class="btn sm icon ghost" data-del="${i}" aria-label="Remove task">${icon("close")}</button></td></tr>`).join("")}
    </tbody></table></div>
    <div class="mt-s btn-row"><button class="btn primary" id="applyWeek">Add ${d.tasks.length} tasks to boards</button><button class="btn" id="discardWeek">Discard</button></div>`;
  $$("#weekPreview tr[data-i] [data-f]").forEach((el) => (el.onchange = () => {
    const t = d.tasks[+el.closest("tr").dataset.i];
    t[el.dataset.f] = el.dataset.f === "minutes" ? +el.value : el.value;
    if (el.dataset.f !== "title") renderPreview();
  }));
  $$("#weekPreview [data-del]").forEach((b) => (b.onclick = () => { d.tasks.splice(+b.dataset.del, 1); renderPreview(); }));
  $("#discardWeek").onclick = () => { weekDraft = null; $("#weekPreview").innerHTML = ""; };
  $("#applyWeek").onclick = async () => {
    const r = await api("/ai-week/apply", { method: "POST", body: { goals: d.goals, summary: d.summary, tasks: d.tasks } });
    weekDraft = null;
    toast(`Added ${r.added} AI tasks across the week`);
    document.dispatchEvent(new Event("dsm:changed"));
    loadWeek();
  };
}
