// Stats: KPI row, then a customizable grid: activity heatmap, rating line, minutes per day, difficulty,
// solve quality and weak patterns, progress by topic.
import { $, esc, fmtDay } from "../util.js";
import { api } from "../api.js";
import { icon } from "../ui.js";
import { heatmap, groupedBars, ratingLine, legend } from "../charts.js";
import { createDashboard } from "../layout.js";
import { loadProfile, paintProfileCard } from "../leetcode.js";
import { Toolbar, Stat, HBar, DiffPill, EmptyState } from "../components/index.js";

const DEFS = [
  { id: "kpis", title: "Overview", span: 12, flush: true },
  { id: "heat", title: "Activity · last 26 weeks", span: 12, sizes: [6, 12] },
  { id: "daily", title: "Time per day · last 28 days", span: 8, sizes: [6, 8, 12] },
  { id: "difficulty", title: "By difficulty", span: 4, sizes: [4, 6, 12] },
  { id: "rating", title: "Contest rating", span: 6, sizes: [6, 12], actions: `<a href="#/contests">Contests ${icon("arrow")}</a>` },
  { id: "leetcode", title: "LeetCode profile", span: 6, sizes: [4, 6, 12] },
  { id: "quality", title: "Solve quality", span: 6, sizes: [6, 12] },
  { id: "topics", title: "Progress by topic", span: 12, sizes: [6, 12] },
];

let S = null;

export async function render(root) {
  root.innerHTML = Toolbar({ title: "Stats", sub: "Everything you've logged, at a glance", actions: `<span id="dashCtl" class="btn-row"></span>` }) + `<div id="dash"></div>`;
  S = { data: null };
  const [s, contests, lc] = await Promise.all([api("/stats"), api("/contests"), loadProfile().catch(() => null)]);
  S.data = { s, contests, lc };
  S.dash = createDashboard({ page: "stats", root: $("#dash"), defs: DEFS, paint, controls: () => $("#dashCtl") });
  S.dash.render();
}

export function destroy() { S = null; }

function paint() {
  if (!S?.data) return;
  const { s, contests, lc } = S.data, k = s.knight;
  const set = (id, html) => { const el = $(`#wb-${id}`); if (el) el.innerHTML = html; return el; };

  set("kpis", `<div class="stats-row">${[
    Stat({ label: "Questions solved", value: `${s.done}<small>/ ${s.total}</small>`, sub: `${s.mastered} mastered`, accent: "var(--k-dsa)" }),
    Stat({ label: "Streak", value: `${s.streak}<small>days</small>`, sub: "days with a card done", accent: "var(--k-ai)" }),
    Stat({ label: "Reviews due", value: s.reviews_due, sub: "spaced repetition queue", accent: "var(--k-review)" }),
    Stat({ label: "Projected finish", value: s.projected_finish ? `${fmtDay(s.projected_finish, { day: "numeric", month: "short" })}<small>${s.projected_finish.slice(0, 4)}</small>` : "—", sub: esc(s.projected_finish_basis) }),
    Stat({ label: "AI this week", value: `${s.ai_hours_week}<small>h</small>`, sub: `target ${s.ai_weekly_target_hours}h`, trend: s.ai_hours_week >= s.ai_weekly_target_hours ? { dir: "up", text: "on target" } : null }),
    Stat({ label: "Contest rating", value: k.rating ?? "—", sub: `${k.label === "Rating" ? "target" : esc(k.label)} ${k.target_rating}${k.rating_source === "leetcode" ? " · from LeetCode" : ""}`, accent: "var(--k-contest)" }),
  ].join("")}</div>`);

  if (set("heat", `<div class="w-sub">${s.heatmap.reduce((n, d) => n + d.done, 0)} cards done</div><div id="heat" class="chart"></div>`)) heatmap($("#heat"), s.heatmap, { weeks: 26 });
  if (set("daily", `<div class="legend w-legend">${legend([["s1", "DSA"], ["s2", "AI"]])}</div><div id="dailyChart" class="chart"></div>`)) groupedBars($("#dailyChart"), s.daily);
  if (set("rating", `<div class="legend w-legend">${legend([["s1", "Rating"], ["ref", `${esc(k.label)} target`]])}</div><div id="ratingChart" class="chart"></div>`)) ratingLine($("#ratingChart"), contests.filter((c) => c.rating).reverse(), k.target_rating, k.label);
  if (lc) {
    const onLc = (d) => { if (S?.data) { S.data.lc = d; paint(); } };
    paintProfileCard($("#wb-leetcode"), lc, onLc);
  }

  const order = ["Easy", "Medium", "Hard"];
  set("difficulty", `<div class="hbars">${[...s.by_difficulty].sort((a, b) => order.indexOf(a.difficulty) - order.indexOf(b.difficulty))
    .map((r) => HBar(DiffPill(r.difficulty), r.done || 0, r.total, { color: `var(--${r.difficulty.toLowerCase()})` })).join("")}</div>`);

  const q = s.quality;
  set("quality", `<div class="two-col"><div><h3 class="w-h3">Results</h3>${q.n
    ? `<div class="hbars">${HBar("Solved alone", q.solved || 0, q.n, { color: "var(--ok)" })}${HBar("Needed hints", q.hints || 0, q.n, { color: "var(--k-ai)" })}${HBar("Couldn't solve", q.failed || 0, q.n, { color: "var(--danger)" })}</div><div class="faint small mt-s">Avg confidence ${q.avg_conf ?? "—"} / 5 across ${q.n} logged attempts</div>`
    : EmptyState({ icon: "check", title: "Nothing logged yet", hint: "Log a few questions to see this.", compact: true })}</div>
    <div><h3 class="w-h3">Weakest patterns</h3>${s.weak_patterns.length
    ? `<div class="hbars">${s.weak_patterns.map((w) => HBar(esc(w.subtopic), w.avg_conf, 5, { color: "var(--k-review)", suffix: `${w.avg_conf}<span class="faint">/5</span>` })).join("")}</div>`
    : EmptyState({ icon: "sparkle", title: "No weak spots yet", hint: "Needs at least 2 logged questions in a pattern.", compact: true })}</div></div>`);

  set("topics", `<div class="grid-bars">${s.by_section.map((r) => HBar(esc(r.section), r.done || 0, r.total)).join("")}</div>`);
}
