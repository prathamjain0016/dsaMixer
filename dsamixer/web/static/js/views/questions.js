// Questions: searchable table of all 507 with spaced-repetition state. "/" focuses search.
import { $, esc, shared } from "../util.js";
import { api } from "../api.js";
import { icon } from "../ui.js";
import { setViewKeys } from "../keys.js";
import { Toolbar, Widget, Table, DiffPill, StatusPill, Segmented, EmptyState, Kbd } from "../components/index.js";

let questions = null;

export async function render(root) {
  root.innerHTML = Toolbar({ title: "Questions", sub: `<span id="qCount">Loading…</span>` }) + `<div class="grid">
    ${Widget({ id: "qList", span: 12, flush: true, body: `
      <div class="filter-bar">
        <label class="search-field">${icon("search")}<input id="qSearch" type="search" placeholder="Search title or pattern…" aria-label="Search questions"><span class="sf-kbd">${Kbd("/")}</span></label>
        <select id="qSection" aria-label="Section" class="fit"><option value="">All sections</option></select>
        <div id="qStatus">${Segmented("qstatus", [["", "Any"], ["new", "New"], ["learning", "Learning"], ["mastered", "Mastered"]], "", { size: "sm", label: "Status" })}</div>
      </div>
      <div id="qTable"></div>` })}
  </div>`;
  setViewKeys((e) => { if (e.key === "/") { $("#qSearch").focus(); return true; } return false; });
  questions = await api("/questions");
  const secs = [...new Set(questions.map((q) => q.section))];
  $("#qSection").innerHTML += secs.map((s) => `<option>${esc(s)}</option>`).join("");
  if (shared.questionSearch) { $("#qSearch").value = shared.questionSearch; shared.questionSearch = null; }
  ["#qSearch", "#qSection"].forEach((s) => $(s).addEventListener("input", draw));
  $("#qStatus").addEventListener("change", draw);
  draw();
}

function draw() {
  const term = $("#qSearch").value.toLowerCase(), sec = $("#qSection").value, st = $("#qStatus input:checked")?.value || "";
  const list = questions.filter((q) => (!sec || q.section === sec) && (!st || q.status === st) &&
    (!term || (q.title + " " + q.pattern + " " + q.subtopic).toLowerCase().includes(term)));
  $("#qCount").textContent = `${list.length} of ${questions.length} questions`;
  $("#qTable").innerHTML = Table({
    rows: list, sticky: true,
    empty: EmptyState({ icon: "search", title: "No questions match", hint: "Try a different search or clear the filters." }),
    columns: [
      { label: "#", cls: "num shrink faint-cell", render: (q) => q.num },
      { label: "Question", render: (q) => `<a href="${esc(q.url)}" target="_blank" rel="noopener">${esc(q.title)}</a>` },
      { label: "Difficulty", cls: "shrink", render: (q) => DiffPill(q.difficulty) },
      { label: "Pattern", cls: "muted", render: (q) => esc(q.subtopic) },
      { label: "Status", cls: "shrink", render: (q) => StatusPill(q.status, q.status[0].toUpperCase() + q.status.slice(1)) },
      { label: "Attempts", cls: "num shrink", render: (q) => q.attempts || "" },
      { label: "Conf", cls: "num shrink", render: (q) => q.last_confidence ?? "" },
      { label: "Next review", cls: "shrink muted", render: (q) => q.next_review ?? "" },
    ],
  });
}
