// Settings: grouped sections (budgets, estimates, contests, LeetCode, advanced JSON) with a sticky save bar.
import { $, $$, today as todayStr } from "../util.js";
import { api } from "../api.js";
import { Toolbar, Widget, Button, Segmented, toast } from "../components/index.js";
import { runWizard } from "../setup.js";

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_LABEL = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
let cfg = null;

const section = (title, desc, body, id) => `<section class="set-section"${id ? ` id="set-${id}"` : ""}><div class="set-meta"><h2>${title}</h2><p class="muted small">${desc}</p></div><div class="set-body">${body}</div></section>`;

const BADGE_PRESET = { Knight: 1850, Guardian: 2150 }; // approximate: LeetCode awards badges by percentile

export async function render(root, arg) {
  root.innerHTML = Toolbar({ title: "Settings", sub: "Saved settings apply from the next planned day, or replan today to use them now" }) + `
    <div class="settings">
      ${Widget({ id: "setMain", span: 12, body:
        section("Daily DSA budget", "Minutes of DSA per weekday. Sunday is the buffer day.", `<div class="form-grid days" id="budgetInputs"></div>`) +
        section("Estimates", "Minutes per question by difficulty, per review, and the daily review cap.", `<div class="form-grid" id="estInputs"></div>`) +
        section("Contests", "Live contests clash with Sunday class; the class card becomes a recording.", `
          <label class="check"><input type="checkbox" id="weeklyLive"> Do Sunday's Weekly contest live (watch the class recording after)</label>
          <label class="field"><span class="f-label">Biweekly anchor Saturday</span><input type="date" id="biweeklyAnchor" class="fit"><span class="f-hint">Pick any Saturday that has a Biweekly contest (check leetcode.com/contest).</span></label>`) +
        section("LeetCode", "Your public profile keeps the badge tracker's rating current, logs contests you take, and spots questions you already solved. Friends show up on the Contests page.", `
          <label class="field"><span class="f-label">Your username</span><input id="lcUser" class="fit" placeholder="e.g. lee215" autocomplete="off" spellcheck="false" maxlength="40"><span class="f-hint">Public data only; nothing is posted to LeetCode. Leave blank to switch this off.</span></label>
          <label class="field"><span class="f-label">Friends</span><textarea id="lcFriends" rows="3" placeholder="One username per line (or comma-separated)" spellcheck="false"></textarea><span class="f-hint">For the leaderboard on the Contests page. You can also add and remove them there.</span></label>
          <div class="field"><span class="f-label">Badge target</span><div id="badgeSeg"></div></div>
          <div class="form-grid lc-target">
            <label class="field"><span class="f-label">Target rating</span><input type="number" id="badgeRating" min="800" max="3500" step="10"><span class="f-hint" id="badgeHint"></span></label>
            <label class="field"><span class="f-label">Deadline</span><input type="date" id="badgeDeadline"></label>
          </div>`, "leetcode") }) }
      ${Widget({ id: "setSetup", span: 12, body: section("Setup", "Walk through the first-run questions again: start date, DSA budget and rest days, daily mix, course schedule, badge target, LeetCode username and contest weeks.",
        `<div class="btn-row">${Button({ label: "Run setup again", icon: "gear", id: "rerunSetup" })}</div>`) })}
      ${Widget({ id: "setAdv", span: 12, body: `<details class="adv"><summary><span><b>Advanced: full config (JSON)</b><span class="muted small"> · AI weekly template, review intervals, start date and more</span></span></summary>
        <textarea id="rawConfig" rows="22" class="mono" aria-label="Full config JSON"></textarea>
        <div class="btn-row mt-s">${Button({ label: "Save JSON", id: "saveRaw" })}</div></details>` })}
    </div>
    <div class="save-bar" id="saveBar">
      <span class="sb-state" id="sbState">All changes saved</span><span class="sp"></span>
      ${Button({ label: "Replan today", kind: "ghost", id: "replanBtn", tip: "Rebuild today's untouched cards with the saved settings" })}
      ${Button({ label: "Save changes", kind: "primary", id: "saveSettings", icon: "check" })}
    </div>`;
  $("#saveSettings").onclick = save;
  $("#badgeSeg").addEventListener("change", () => {
    const b = $("input[name=badge]:checked").value;
    if (BADGE_PRESET[b]) $("#badgeRating").value = BADGE_PRESET[b];
    badgeHint();
  });
  $("#saveRaw").onclick = saveRaw;
  $("#rerunSetup").onclick = async () => {
    const { defaults } = await api("/setup");
    if (await runWizard(defaults, { rerun: true })) {
      document.dispatchEvent(new Event("dsm:setup"));
      await load();
    }
  };
  $("#replanBtn").onclick = async () => {
    await api(`/day/${todayStr()}/replan`, { method: "POST" });
    toast("Today replanned");
    document.dispatchEvent(new Event("dsm:changed"));
  };
  $(".settings").addEventListener("input", (e) => { if (e.target.id !== "rawConfig") dirty(true); });
  await load();
  if (arg === "leetcode") $("#set-leetcode")?.scrollIntoView({ block: "start" });
}

function badgeHint() {
  const b = $("input[name=badge]:checked")?.value;
  $("#badgeHint").textContent = b === "Custom" ? "Any rating you want to aim for." : `Approx. LeetCode awards ${b} by percentile (top ${b === "Knight" ? "25%" : "5%"} of contest ratings), so the number moves. Edit it if you like.`;
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
  $("#lcUser").value = c.leetcode?.username || "";
  $("#lcFriends").value = (c.leetcode?.friends || []).join("\n");
  $("#badgeSeg").innerHTML = Segmented("badge", [["Knight", "Knight ≈1850"], ["Guardian", "Guardian ≈2150"], ["Custom", "Custom"]], c.knight.badge || "Knight", { label: "Badge target" });
  $("#badgeRating").value = c.knight.target_rating;
  $("#badgeDeadline").value = c.knight.deadline || "";
  badgeHint();
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
  const before = c.leetcode?.username || null, user = $("#lcUser").value.trim() || null;
  c.leetcode = { ...(c.leetcode || {}), username: user, friends: $("#lcFriends").value.split(/[\s,]+/).filter(Boolean) };
  const rating = +$("#badgeRating").value;
  if (!(rating >= 800)) return toast("Enter a target rating of 800 or more.");
  c.knight = { ...c.knight, badge: $("input[name=badge]:checked").value, target_rating: rating, deadline: $("#badgeDeadline").value || null };
  await api("/settings", { method: "PUT", body: c });
  toast("Saved — applies from the next planned day (or hit Replan today)");
  load();
  if (user && user !== before) {
    api("/leetcode/sync", { method: "POST" }).then((r) => {
      toast(`LeetCode profile synced${r.contests_added?.length ? ` · ${r.contests_added.length} contests logged` : ""}`);
      document.dispatchEvent(new Event("dsm:changed"));
    }).catch(() => {});
  }
}

async function saveRaw() {
  let c;
  try { c = JSON.parse($("#rawConfig").value); } catch (e) { return toast("Invalid JSON: " + e.message); }
  await api("/settings", { method: "PUT", body: c });
  toast("Config saved");
  load();
}
