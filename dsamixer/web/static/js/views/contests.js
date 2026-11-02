// Contests: Knight tracker, rating line, log form (Q1-Q4), history table.
import { $, $$, esc, today as todayStr, fmtDay, shared } from "../util.js";
import { api } from "../api.js";
import { kpi, toast, confirmDialog, icon } from "../ui.js";
import { ratingLine, legend } from "../charts.js";

export async function render(root) {
  root.innerHTML = `
    <div class="page-head"><h1>Contests</h1></div>
    <section class="panel knight" id="knight"></section>
    <div class="panel"><div class="panel-head"><h3>Rating</h3><div class="legend">${legend([["s1", "Rating"], ["ref", "Knight target"]])}</div></div><div id="ratingChart" class="chart"></div></div>
    <div class="panel">
      <h3>Log a contest</h3>
      <form id="contestForm" class="form-row contest-form">
        <label>Date<input type="date" name="date" required></label>
        <label>Contest<input name="name" placeholder="Weekly Contest 480" required style="width:200px"></label>
        <label>Type<select name="kind"><option value="virtual">Virtual</option><option value="weekly">Weekly (live)</option><option value="biweekly">Biweekly (live)</option></select></label>
        <fieldset class="qchecks"><legend>Solved</legend>
          <label class="check"><input type="checkbox" name="q0">Q1</label><label class="check"><input type="checkbox" name="q1">Q2</label>
          <label class="check"><input type="checkbox" name="q2">Q3</label><label class="check"><input type="checkbox" name="q3">Q4</label></fieldset>
        <label>Rank<input type="number" name="rank" placeholder="Rank"></label>
        <label>Rating after<input type="number" name="rating" placeholder="Rating"></label>
        <label>Notes<input name="notes" placeholder="Notes" style="width:180px"></label>
        <button class="btn primary">Add</button>
      </form>
      <p class="muted small mt-s">Unsolved problems become an upsolve card on the next day's board.</p>
    </div>
    <div class="panel"><div class="table-wrap"><table class="table" id="contestTable"></table></div></div>`;
  const f = $("#contestForm");
  f.date.value = todayStr();
  if (shared.contestPrefill) {
    f.date.value = shared.contestPrefill.date;
    f.kind.value = shared.contestPrefill.kind;
    shared.contestPrefill = null;
    f.name.focus();
  }
  f.onsubmit = async (e) => {
    e.preventDefault();
    await api("/contests", { method: "POST", body: {
      date: f.date.value, name: f.name.value, kind: f.kind.value,
      q_solved: [0, 1, 2, 3].map((i) => f["q" + i].checked),
      rank: f.rank.value ? +f.rank.value : null, rating: f.rating.value ? +f.rating.value : null, notes: f.notes.value || null,
    } });
    f.reset();
    f.date.value = todayStr();
    toast("Contest logged — upsolve card added for tomorrow");
    document.dispatchEvent(new Event("dsm:changed"));
    load();
  };
  await load();
}

async function load() {
  const [list, s] = await Promise.all([api("/contests"), api("/stats")]);
  const k = s.knight, BASE = 1500;
  const left = Math.max(0, Math.ceil((new Date(k.deadline) - new Date()) / 864e5));
  const pct = k.rating ? Math.max(0, Math.min(100, ((k.rating - BASE) / (k.target_rating - BASE)) * 100)) : 0;
  $("#knight").innerHTML = `
    <div class="knight-hero"><div><div class="muted small">Current rating</div><div class="huge">${k.rating ?? "unrated"}</div>
      <div class="muted">${k.rating ? `${Math.max(0, k.target_rating - k.rating)} to the Knight badge (${k.target_rating})` : "LeetCode starts you at 1500 after your first rated contest"}</div>
      <div class="track lg" role="img" aria-label="Rating progress ${Math.round(pct)}% from ${BASE} to ${k.target_rating}"><div class="fill" style="width:${pct}%"></div></div>
      <div class="scale small muted"><span>${BASE}</span><span>${k.target_rating}</span></div></div>
      <div class="knight-kpis">${[
        kpi("Contests done", k.contests, "incl. virtual"),
        kpi("Solved 3+", k.q3_rate != null ? Math.round(k.q3_rate * 100) + "%" : "—", "contests with Q3 solved: the Knight habit"),
        kpi("Days to deadline", left, fmtDay(k.deadline, { day: "numeric", month: "short", year: "numeric" })),
      ].join("")}</div></div>`;
  ratingLine($("#ratingChart"), list.filter((c) => c.rating).reverse(), k.target_rating);
  $("#contestTable").innerHTML = list.length
    ? `<thead><tr><th>Date</th><th>Contest</th><th>Type</th><th>Q1–Q4</th><th>Rank</th><th>Rating</th><th>Notes</th><th><span class="sr-only">Delete</span></th></tr></thead><tbody>` +
      list.map((c) => `<tr><td>${c.date}</td><td>${esc(c.name)}</td><td>${c.kind}</td><td><span class="qdots" aria-label="Solved ${c.solved} of 4">${c.q_solved.map((x) => `<i class="${x ? "on" : ""}"></i>`).join("")}</span></td><td>${c.rank ?? ""}</td><td>${c.rating ?? ""}</td><td>${esc(c.notes || "")}</td>
        <td><button class="btn sm icon ghost danger" data-del="${c.id}" aria-label="Delete ${esc(c.name)}">${icon("close")}</button></td></tr>`).join("") + `</tbody>`
    : `<tbody><tr><td class="empty">No contests yet. Your first one is on the Sunday board.</td></tr></tbody>`;
  $$("[data-del]", $("#contestTable")).forEach((b) => (b.onclick = async () => {
    if (await confirmDialog("Delete this contest?")) { await api(`/contests/${b.dataset.del}`, { method: "DELETE" }); load(); }
  }));
}
