// Settings: budgets, estimates, contest options, replan today, advanced JSON.
import { $, $$, today as todayStr } from "../util.js";
import { api } from "../api.js";
import { toast } from "../ui.js";

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
let cfg = null;

export async function render(root) {
  root.innerHTML = `
    <div class="page-head"><h1>Settings</h1></div>
    <div class="panel">
      <h3>Daily DSA budget (minutes)</h3>
      <div id="budgetInputs" class="form-row"></div>
      <h3 class="mt">Estimate per question (minutes)</h3>
      <div id="estInputs" class="form-row"></div>
      <h3 class="mt">Contests</h3>
      <div class="form-row"><label class="check"><input type="checkbox" id="weeklyLive"> Do Sunday's Weekly contest live (clashes with class; watch the recording after)</label></div>
      <div class="form-row mt-s"><label>Biweekly anchor Saturday<input type="date" id="biweeklyAnchor" style="width:auto"></label>
        <span class="muted small">Pick any Saturday that has a Biweekly contest (check leetcode.com/contest).</span></div>
      <div class="mt btn-row">
        <button class="btn primary" id="saveSettings">Save</button>
        <button class="btn" id="replanBtn" data-tip="Rebuild today's untouched cards with the new settings">Replan today</button>
      </div>
    </div>
    <details class="panel">
      <summary>Advanced: full config (JSON)</summary>
      <p class="muted small">AI weekly template, review intervals, start date, Knight target and more.</p>
      <textarea id="rawConfig" rows="24" class="mono" aria-label="Full config JSON"></textarea>
      <div class="mt-s"><button class="btn primary" id="saveRaw">Save JSON</button></div>
    </details>`;
  $("#saveSettings").onclick = save;
  $("#saveRaw").onclick = saveRaw;
  $("#replanBtn").onclick = async () => {
    await api(`/day/${todayStr()}/replan`, { method: "POST" });
    toast("Today replanned");
    document.dispatchEvent(new Event("dsm:changed"));
  };
  await load();
}

async function load() {
  const c = cfg = await api("/settings");
  $("#budgetInputs").innerHTML = DAYS.map((d) => `<label>${d}<input type="number" min="0" step="15" data-budget="${d}" value="${c.dsa_minutes[d]}"></label>`).join("");
  $("#estInputs").innerHTML = ["Easy", "Medium", "Hard"].map((d) => `<label>${d}<input type="number" min="5" step="5" data-est="${d}" value="${c.est_minutes[d]}"></label>`).join("") +
    `<label>Review<input type="number" min="5" step="5" id="reviewMin" value="${c.review_minutes}"></label><label>Max reviews/day<input type="number" min="0" id="maxReviews" value="${c.max_reviews_per_day}"></label>`;
  $("#weeklyLive").checked = c.contests.weekly_live;
  $("#biweeklyAnchor").value = c.contests.biweekly_anchor;
  $("#rawConfig").value = JSON.stringify(c, null, 2);
}

async function save() {
  const c = cfg;
  $$("[data-budget]").forEach((i) => (c.dsa_minutes[i.dataset.budget] = +i.value));
  $$("[data-est]").forEach((i) => (c.est_minutes[i.dataset.est] = +i.value));
  c.review_minutes = +$("#reviewMin").value;
  c.max_reviews_per_day = +$("#maxReviews").value;
  c.contests.weekly_live = $("#weeklyLive").checked;
  c.contests.biweekly_anchor = $("#biweeklyAnchor").value;
  await api("/settings", { method: "PUT", body: c });
  toast("Saved — applies from the next planned day (or hit Replan today)");
  load();
}

async function saveRaw() {
  let c;
  try { c = JSON.parse($("#rawConfig").value); } catch (e) { return toast("Invalid JSON: " + e.message); }
  await api("/settings", { method: "PUT", body: c });
  toast("Config saved");
  load();
}
