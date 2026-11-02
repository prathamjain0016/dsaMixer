// Questions: searchable table of all 507 with spaced-repetition state. "/" focuses search.
import { $, esc } from "../util.js";
import { api } from "../api.js";
import { setViewKeys } from "../keys.js";

let questions = null;

export async function render(root) {
  root.innerHTML = `
    <div class="page-head"><h1>Questions</h1></div>
    <div class="toolbar">
      <input id="qSearch" type="search" placeholder="Search title or pattern…  ( / )" aria-label="Search questions" style="min-width:260px">
      <select id="qSection" aria-label="Section"><option value="">All sections</option></select>
      <select id="qStatus" aria-label="Status"><option value="">Any status</option><option>new</option><option>learning</option><option>mastered</option></select>
      <span class="muted small" id="qCount"></span>
    </div>
    <div class="panel"><div class="table-wrap"><table class="table sticky" id="qTable"></table></div></div>`;
  setViewKeys((e) => { if (e.key === "/") { $("#qSearch").focus(); return true; } return false; });
  questions = await api("/questions");
  const secs = [...new Set(questions.map((q) => q.section))];
  $("#qSection").innerHTML += secs.map((s) => `<option>${esc(s)}</option>`).join("");
  ["#qSearch", "#qSection", "#qStatus"].forEach((s) => $(s).addEventListener("input", draw));
  draw();
}

function draw() {
  const term = $("#qSearch").value.toLowerCase(), sec = $("#qSection").value, st = $("#qStatus").value;
  const list = questions.filter((q) => (!sec || q.section === sec) && (!st || q.status === st) &&
    (!term || (q.title + " " + q.pattern + " " + q.subtopic).toLowerCase().includes(term)));
  $("#qCount").textContent = `${list.length} of ${questions.length}`;
  $("#qTable").innerHTML = `<thead><tr><th>#</th><th>Question</th><th>Diff</th><th>Pattern</th><th>Status</th><th>Attempts</th><th>Conf</th><th>Next review</th></tr></thead><tbody>` +
    list.map((q) => `<tr><td>${q.num}</td><td><a href="${esc(q.url)}" target="_blank" rel="noopener">${esc(q.title)}</a></td><td><span class="diff ${q.difficulty}">${q.difficulty}</span></td>
      <td class="muted">${esc(q.subtopic)}</td><td><span class="status-pill ${q.status}">${q.status}</span></td><td>${q.attempts || ""}</td><td>${q.last_confidence ?? ""}</td><td>${q.next_review ?? ""}</td></tr>`).join("") + `</tbody>`;
}
