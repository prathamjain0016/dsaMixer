// Settings: grouped sections (budgets, estimates, contests, advanced JSON) with a sticky save bar.
import { $, $$, today as todayStr } from "../util.js";
import { api } from "../api.js";
import { Toolbar, Widget, Button, toast } from "../components/index.js";

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_LABEL = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
let cfg = null;

const section = (title, desc, body) => `<section class="set-section"><div class="set-meta"><h2>${title}</h2><p class="muted small">${desc}</p></div><div class="set-body">${body}</div></section>`;

export async function render(root) {
  root.innerHTML = Toolbar({ title: "Settings", sub: "Saved settings apply from the next planned day, or replan today to use them now" }) + `
    <div class="settings">
      ${Widget({ id: "setMain", span: 12, body:
        section("Daily DSA budget", "Minutes of DSA per weekday. Sunday is the buffer day.", `<div class="form-grid days" id="budgetInputs"></div>`) +
        section("Estimates", "Minutes per question by difficulty, per review, and the daily review cap.", `<div class="form-grid" id="estInputs"></div>`) +
        section("Contests", "Live contests clash with Sunday class; the class card becomes a recording.", `
          <label class="check"><input type="checkbox" id="weeklyLive"> Do Sunday's Weekly contest live (watch the class recording after)</label>
          <label class="field"><span class="f-label">Biweekly anchor Saturday</span><input type="date" id="biweeklyAnchor" class="fit"><span class="f-hint">Pick any Saturday that has a Biweekly contest (check leetcode.com/contest).</span></label>`) })}
      ${Widget({ id: "setAdv", span: 12, body: `<details class="adv"><summary><span><b>Advanced: full config (JSON)</b><span class="muted small"> · AI weekly template, review intervals, start date, Knight target and more</span></span></summary>
        <textarea id="rawConfig" rows="22" class="mono" aria-label="Full config JSON"></textarea>
        <div class="btn-row mt-s">${Button({ label: "Save JSON", id: "saveRaw" })}</div></details>` })}
    </div>
    <div class="save-bar" id="saveBar">
      <span class="sb-state" id="sbState">All changes saved</span><span class="sp"></span>
      ${Button({ label: "Replan today", kind: "ghost", id: "replanBtn", tip: "Rebuild today's untouched cards with the saved settings" })}
      ${Button({ label: "Save changes", kind: "primary", id: "saveSettings", icon: "check" })}
    </div>`;
  $("#saveSettings").onclick = save;
  $("#saveRaw").onclick = saveRaw;
  $("#replanBtn").onclick = async () => {
    await api(`/day/${todayStr()}/replan`, { method: "POST" });
    toast("Today replanned");
    document.dispatchEvent(new Event("dsm:changed"));
  };
  $(".settings").addEventListener("input", (e) => { if (e.target.id !== "rawConfig") dirty(true); });
  await load();
}

function dirty(on) {
  $("#saveBar").classList.toggle("dirty", on);
  $("#sbState").textContent = on ? "Unsaved changes" : "All changes saved";
}

async function load() {
  const c = cfg = await api("/settings");
  $("#budgetInputs").innerHTML = DAYS.map((d) => `<label class="field"><span class="f-label">${DAY_LABEL[d]}</span><input type="number" min="0" step="15" data-budget="${d}" value="${c.dsa_minutes[d]}"></label>`).join("");
  $("#estInputs").innerHTML = ["Easy", "Medium", "Hard"].map((d) => `<label class="field"><span class="f-label">${d}</span><input type="number" min="5" step="5" data-est="${d}" value="${c.est_minutes[d]}"></label>`).join("") +
    `<label class="field"><span class="f-label">Review</span><input type="number" min="5" step="5" id="reviewMin" value="${c.review_minutes}"></label><label class="field"><span class="f-label">Max reviews/day</span><input type="number" min="0" id="maxReviews" value="${c.max_reviews_per_day}"></label>`;
  $("#weeklyLive").checked = c.contests.weekly_live;
  $("#biweeklyAnchor").value = c.contests.biweekly_anchor;
  $("#rawConfig").value = JSON.stringify(c, null, 2);
  dirty(false);
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
