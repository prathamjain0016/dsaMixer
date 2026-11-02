// Stats: KPIs, 26-week activity heatmap, 28-day minutes, difficulty / section bars, quality, weak patterns.
import { $, esc, fmtDay } from "../util.js";
import { api } from "../api.js";
import { kpi, hbar } from "../ui.js";
import { heatmap, groupedBars, legend } from "../charts.js";

export async function render(root) {
  root.innerHTML = `
    <div class="page-head"><h1>Stats</h1></div>
    <div id="statKpis" class="kpis"></div>
    <div class="panel"><div class="panel-head"><h3>Activity · last 26 weeks</h3><span class="muted small" id="hmTotal"></span></div><div id="heat" class="chart"></div></div>
    <div class="panel"><div class="panel-head"><h3>Last 28 days · minutes</h3><div class="legend" id="dailyLegend"></div></div><div id="dailyChart" class="chart"></div></div>
    <div class="two">
      <div class="panel"><h3>By difficulty</h3><div id="diffBars"></div></div>
      <div class="panel"><h3>Solve quality</h3><div id="quality"></div><h3 class="mt">Weakest patterns</h3><div id="weak"></div></div>
    </div>
    <div class="panel mt"><h3>By section</h3><div id="sectionBars" class="grid-bars"></div></div>`;
  const s = await api("/stats"), k = s.knight;
  $("#statKpis").innerHTML = [
    kpi("Questions solved", `${s.done}<small> / ${s.total}</small>`, `${s.mastered} mastered`),
    kpi("Streak", `${s.streak}<small> days</small>`, "days with at least one card done"),
    kpi("Reviews due", s.reviews_due, "spaced repetition queue"),
    kpi("Projected finish", s.projected_finish ? fmtDay(s.projected_finish, { day: "numeric", month: "short", year: "numeric" }) : "—", esc(s.projected_finish_basis)),
    kpi("AI this week", `${s.ai_hours_week}<small> h</small>`, `target ${s.ai_weekly_target_hours}h`),
    kpi("Contest rating", k.rating ?? "—", `target ${k.target_rating}`),
  ].join("");
  $("#hmTotal").textContent = `${s.heatmap.reduce((n, d) => n + d.done, 0)} cards done`;
  heatmap($("#heat"), s.heatmap, { weeks: 26 });
  $("#dailyLegend").innerHTML = legend([["s1", "DSA"], ["s2", "AI"]]);
  groupedBars($("#dailyChart"), s.daily);

  const order = ["Easy", "Medium", "Hard"];
  $("#diffBars").innerHTML = [...s.by_difficulty].sort((a, b) => order.indexOf(a.difficulty) - order.indexOf(b.difficulty))
    .map((r) => hbar(`<span class="diff ${r.difficulty}">${r.difficulty}</span>`, r.done || 0, r.total)).join("");
  $("#sectionBars").innerHTML = s.by_section.map((r) => hbar(esc(r.section), r.done || 0, r.total)).join("");
  const q = s.quality;
  $("#quality").innerHTML = q.n
    ? `${hbar("Solved alone", q.solved || 0, q.n)}${hbar("Needed hints", q.hints || 0, q.n)}${hbar("Couldn't solve", q.failed || 0, q.n)}<div class="muted small">Avg confidence ${q.avg_conf ?? "—"} / 5 across ${q.n} logged attempts</div>`
    : `<div class="muted small">Log a few questions to see this.</div>`;
  $("#weak").innerHTML = s.weak_patterns.length
    ? s.weak_patterns.map((w) => `<div class="hbar"><span>${esc(w.subtopic)}</span><div class="track" role="img" aria-label="${w.avg_conf} of 5"><div class="fill" style="width:${(w.avg_conf / 5) * 100}%"></div></div><span class="num">${w.avg_conf}/5</span></div>`).join("")
    : `<div class="muted small">Needs at least 2 logged questions in a pattern.</div>`;
}
