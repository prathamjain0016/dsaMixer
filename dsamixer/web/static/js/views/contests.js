// Contests: Knight tracker, rating line, log form (Q1-Q4), history table.
import { $, $$, esc, today as todayStr, fmtDay, shared } from "../util.js";
import { api } from "../api.js";
import { confirmDialog } from "../ui.js";
import { ratingLine, legend } from "../charts.js";
import { Toolbar, Widget, Stat, Button, IconButton, Badge, Table, EmptyState, ProgressRing, toast } from "../components/index.js";

const KIND = { virtual: "Virtual", weekly: "Weekly", biweekly: "Biweekly" };

export async function render(root) {
  root.innerHTML = Toolbar({ title: "Contests", sub: "Road to Knight: rating, solve rate and every contest you've logged" }) + `<div class="grid">
    ${Widget({ id: "knight", title: "Knight tracker", span: 12, flush: true })}
    ${Widget({ id: "ratingW", title: "Rating", span: 7, actions: `<div class="legend">${legend([["s1", "Rating"], ["ref", "Knight target"]])}</div>`, body: `<div id="ratingChart" class="chart"></div>` })}
    ${Widget({ id: "logW", title: "Log a contest", span: 5, body: `
      <form id="contestForm" class="contest-form" autocomplete="off">
        <div class="cf-grid">
          <label class="field"><span class="f-label">Date</span><input type="date" name="date" required></label>
          <label class="field"><span class="f-label">Type</span><select name="kind"><option value="virtual">Virtual</option><option value="weekly">Weekly (live)</option><option value="biweekly">Biweekly (live)</option></select></label>
          <label class="field span-2"><span class="f-label">Contest</span><input name="name" placeholder="Weekly Contest 480" required></label>
        </div>
        <fieldset class="qchecks"><legend class="f-label">Solved</legend>
          ${[0, 1, 2, 3].map((i) => `<label class="qcheck"><input type="checkbox" name="q${i}"><span>Q${i + 1}</span></label>`).join("")}</fieldset>
        <div class="cf-grid">
          <label class="field"><span class="f-label">Rank</span><input type="number" name="rank" placeholder="—"></label>
          <label class="field"><span class="f-label">Rating after</span><input type="number" name="rating" placeholder="—"></label>
          <label class="field span-2"><span class="f-label">Notes</span><input name="notes" placeholder="What tripped you up?"></label>
        </div>
        <div class="cf-foot"><span class="faint small">Unsolved problems become an upsolve card on the next day's board.</span>${Button({ label: "Add contest", kind: "primary", type: "submit", icon: "plus" })}</div>
      </form>` })}
    ${Widget({ id: "upcomingW", title: "Upcoming on LeetCode", span: 12, flush: true, actions: `<span class="faint small" id="syncedAt"></span>${Button({ label: "Sync now", icon: "pull", size: "sm", id: "syncNow" })}` })}
    ${Widget({ id: "historyW", title: "History", span: 12, flush: true })}
  </div>`;
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
  $("#syncNow").onclick = syncNow;
  await load();
}

const MODE = { live: ["Live", "accent"], virtual: ["Virtual", "neutral"], none: ["Not in your plan yet", "outline"] };

function renderUpcoming(u) {
  $("#syncedAt").textContent = u.synced_at ? `Last synced ${new Date(u.synced_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}` : "Never synced";
  const upcoming = u.contests.filter((c) => c.date >= todayStr());
  $("#wb-upcomingW").innerHTML = Table({
    rows: upcoming,
    empty: EmptyState({ icon: "calendar", title: "Nothing cached", hint: "Press Sync now to fetch the schedule from LeetCode." }),
    columns: [
      { label: "Contest", render: (c) => `<b class="strong">${esc(c.title)}</b>` },
      { label: "Date (IST)", cls: "shrink", render: (c) => fmtDay(c.date, { weekday: "short", day: "numeric", month: "short" }) },
      { label: "Time (IST)", cls: "num shrink", render: (c) => esc(c.time) },
      { label: "Your week", cls: "shrink", render: (c) => Badge(...MODE[c.mode] || [esc(c.mode), "neutral"]) },
    ],
  });
}

async function syncNow() {
  const b = $("#syncNow");
  b.disabled = true;
  try {
    const r = await api("/contests/sync", { method: "POST" });
    renderUpcoming(r);
    toast(r.warnings?.length ? r.warnings[0] : `Synced ${r.fetched} contests`);
  } catch { /* api() already toasted the error */
  } finally {
    b.disabled = false;
  }
}

async function load() {
  api("/contests/upcoming").then(renderUpcoming).catch(() => {});
  const [list, s] = await Promise.all([api("/contests"), api("/stats")]);
  const k = s.knight, BASE = 1500;
  const left = Math.max(0, Math.ceil((new Date(k.deadline) - new Date()) / 864e5));
  const pct = k.rating ? Math.max(0, Math.min(100, ((k.rating - BASE) / (k.target_rating - BASE)) * 100)) : 0;
  $("#wb-knight").innerHTML = `<div class="knight-hero">
    <div class="kh-main">
      ${ProgressRing({ value: pct, max: 100, size: 88, stroke: 7, center: `<b class="ring-num">${Math.round(pct)}%</b>`, label: `Rating progress ${Math.round(pct)}% from ${BASE} to ${k.target_rating}` })}
      <div><div class="stat-label">Current rating</div><div class="huge">${k.rating ?? "Unrated"}</div>
        <div class="muted small">${k.rating ? `${Math.max(0, k.target_rating - k.rating)} to the Knight badge (${k.target_rating})` : "LeetCode starts you at 1500 after your first rated contest"}</div></div>
    </div>
    <div class="stats-row kh-stats">
      ${Stat({ label: "Contests done", value: k.contests, sub: "incl. virtual" })}
      ${Stat({ label: "Solved 3+", value: k.q3_rate != null ? Math.round(k.q3_rate * 100) + "%" : "—", sub: "the Knight habit" })}
      ${Stat({ label: "Days to deadline", value: left, sub: fmtDay(k.deadline, { day: "numeric", month: "short", year: "numeric" }) })}
    </div></div>`;
  ratingLine($("#ratingChart"), list.filter((c) => c.rating).reverse(), k.target_rating);
  $("#wb-historyW").innerHTML = Table({
    rows: list,
    empty: EmptyState({ icon: "trophy", title: "No contests yet", hint: "Your first one is on the Sunday board. Log it here when you're done." }),
    columns: [
      { label: "Date", cls: "shrink", render: (c) => fmtDay(c.date, { day: "numeric", month: "short", year: "numeric" }) },
      { label: "Contest", render: (c) => `<b class="strong">${esc(c.name)}</b>` },
      { label: "Type", cls: "shrink", render: (c) => Badge(KIND[c.kind] || esc(c.kind), c.kind === "virtual" ? "neutral" : "accent") },
      { label: "Q1–Q4", cls: "shrink", render: (c) => `<span class="qdots" aria-label="Solved ${c.solved} of 4">${c.q_solved.map((x) => `<i class="${x ? "on" : ""}"></i>`).join("")}</span> <span class="muted small">${c.solved}/4</span>` },
      { label: "Rank", cls: "num shrink", render: (c) => c.rank ?? "" },
      { label: "Rating", cls: "num shrink", render: (c) => (c.rating ? `<b>${c.rating}</b>` : "") },
      { label: "Notes", cls: "muted", render: (c) => esc(c.notes || "") },
      { label: `<span class="sr-only">Delete</span>`, cls: "shrink", render: (c) => IconButton({ icon: "trash", label: `Delete ${c.name}`, size: "sm", cls: "danger", attrs: { "data-del": c.id } }) },
    ],
  });
  $$("[data-del]", $("#wb-historyW")).forEach((b) => (b.onclick = async () => {
    if (await confirmDialog("Delete this contest?")) { await api(`/contests/${b.dataset.del}`, { method: "DELETE" }); toast("Contest deleted"); load(); }
  }));
}
