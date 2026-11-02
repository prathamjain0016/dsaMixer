// AI course: weekly planner (preview / edit / apply) and the syllabus.
import { $, $$, esc, fmtDay, hm } from "../util.js";
import { api } from "../api.js";
import { icon } from "../ui.js";
import { Toolbar, Widget, Button, IconButton, Badge, Table, EmptyState, toast } from "../components/index.js";

let weekDraft = null;
const STATUS = [["upcoming", "Upcoming"], ["in_progress", "In progress"], ["done", "Done"]];

export async function render(root) {
  weekDraft = null;
  root.innerHTML = Toolbar({ title: "AI course", sub: `<span id="weekInfo">Loading…</span>` }) + `<div class="grid">
    ${Widget({ id: "planW", title: "Plan this week's AI work", span: 12, body: `
      <p class="muted w-lede">Describe everything you need to get done this week: homework, lectures to rewatch, topics to revise. The more detail, the better the tasks. Claude breaks it into 30–90 min tasks and spreads each goal across the week. You review before anything is added.</p>
      <div id="weekKeyWarn"></div>
      <textarea id="weekGoals" rows="6" aria-label="Goals for the week" placeholder="HW1: implement a transformer encoder block from scratch in PyTorch, test on toy data, write up results (due Friday)&#10;HW2: fine-tune DistilBERT for sentiment on IMDB, compare 2 learning rates&#10;Rewatch Sunday's lecture on attention, the part about positional encodings&#10;Revise backprop through softmax"></textarea>
      <div class="btn-row mt-s">${Button({ label: "Break down with AI", icon: "sparkle", kind: "primary", id: "breakdownBtn" })}</div>
      <div id="weekPreview"></div>` })}
    ${Widget({ id: "modulesW", title: "Syllabus", span: 7, body: `<p class="faint small">The first unfinished module is shown on your AI cards. Mark one “in progress” to pin it.</p><div id="modules"></div>` })}
    ${Widget({ id: "importW", title: "Import modules", span: 5, body: `
      <p class="faint small">Paste one module per line.</p>
      <textarea id="moduleImport" rows="9" aria-label="Modules to import" placeholder="Module 1: Python for ML&#10;Module 2: Linear algebra refresher&#10;…"></textarea>
      <div class="btn-row mt-s">${Button({ label: "Import", id: "importModules" })}</div>` })}
  </div>`;
  $("#breakdownBtn").onclick = breakdown;
  $("#importModules").onclick = importModules;
  await Promise.all([loadModules(), loadWeek()]);
}

async function loadModules(list) {
  list = Array.isArray(list) ? list : await api("/ai-modules");
  $("#modules").innerHTML = list.length
    ? `<ol class="modules">${list.map((m) => `<li class="module st-${m.status}"><span class="mod-n">${m.position}</span><span class="mod-t">${esc(m.title)}</span>
        <select data-mod="${m.id}" class="fit sm" aria-label="Status of ${esc(m.title)}">${STATUS.map(([v, l]) => `<option value="${v}" ${m.status === v ? "selected" : ""}>${l}</option>`).join("")}</select>
        ${IconButton({ icon: "trash", label: `Delete ${m.title}`, size: "sm", cls: "danger", attrs: { "data-delmod": m.id } })}</li>`).join("")}</ol>`
    : EmptyState({ icon: "book", title: "No syllabus yet", hint: "Paste it in Import modules whenever you have it." });
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
    `<div class="banner warn mb">${icon("alert")}<span>No API key found. Add <code>OPENROUTER_API_KEY=…</code> (or <code>ANTHROPIC_API_KEY=…</code>) to <code>.env</code> and restart the app.</span></div>`;
  if (w.plan && !weekDraft) {
    $("#weekGoals").value = w.plan.goals;
    $("#weekPreview").innerHTML = `<div class="banner ok mt">${icon("check")}<span>This week's plan is on your boards (${esc(w.plan.created_at)}). Break it down again to replace the cards you haven't started.</span></div>`;
  }
}

async function breakdown() {
  const goals = $("#weekGoals").value.trim();
  if (!goals) return toast("Describe your goals first");
  const btn = $("#breakdownBtn");
  btn.disabled = true; btn.querySelector(".btn-label").textContent = "Thinking…";
  try {
    weekDraft = { goals, ...(await api("/ai-week/preview", { method: "POST", body: { goals } })) };
    renderPreview();
  } finally {
    btn.disabled = false; btn.querySelector(".btn-label").textContent = "Break down with AI";
  }
}

function renderPreview() {
  const d = weekDraft;
  const dayOpt = (sel) => d.days.map((x) => `<option value="${x}" ${x === sel ? "selected" : ""}>${fmtDay(x, { weekday: "short", day: "numeric" })}</option>`).join("");
  const totals = d.days.map((x) => {
    const used = d.tasks.filter((t) => t.date === x).reduce((s, t) => s + (+t.minutes || 0), 0);
    const over = used > d.capacity[x];
    return Badge(`${over ? icon("alert") : ""}${fmtDay(x, { weekday: "short" })} ${hm(used)} / ${hm(d.capacity[x])}${over ? ` · ${hm(used - d.capacity[x])} over` : ""}`, over ? "warn" : "neutral");
  }).join(" ");
  $("#weekPreview").innerHTML = `
    <div class="preview">
      <p>${esc(d.summary)}</p>
      <div class="chips-row">${totals}</div>
      ${Table({
        rows: d.tasks,
        rowAttrs: (_, i) => `data-i="${i}"`,
        columns: [
          { label: "Day", cls: "shrink", render: (t) => `<select data-f="date" aria-label="Day" class="fit sm">${dayOpt(t.date)}</select>` },
          { label: "Goal", cls: "muted", render: (t) => esc(t.goal) },
          { label: "Task", render: (t) => `<input data-f="title" aria-label="Task" value="${esc(t.title)}" class="sm">` },
          { label: "Min", cls: "shrink", render: (t) => `<input data-f="minutes" aria-label="Minutes" type="number" min="5" step="5" value="${t.minutes}" class="sm" style="width:76px">` },
          { label: `<span class="sr-only">Remove</span>`, cls: "shrink", render: (_, i) => IconButton({ icon: "close", label: "Remove task", size: "sm", attrs: { "data-del": i } }) },
        ],
      })}
      <div class="btn-row mt">${Button({ label: `Add ${d.tasks.length} tasks to boards`, kind: "primary", id: "applyWeek", icon: "check" })}${Button({ label: "Discard", kind: "ghost", id: "discardWeek" })}</div>
    </div>`;
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
