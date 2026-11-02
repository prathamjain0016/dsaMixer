// LeetCode profile UI shared by several views: the profile card, the "solved on LeetCode" banner and
// slide-over, and the friends leaderboard. Data comes from /api/leetcode/* (cached server-side).
import { $, $$, esc, fmtDay } from "./util.js";
import { api } from "./api.js";
import { icon } from "./icons.js";
import { Button, IconButton, Badge, DiffPill, EmptyState, Table, SlideOver, toast } from "./components/index.js";

const num = (n) => (n == null ? "—" : Number(n).toLocaleString());
const profileUrl = (u) => `https://leetcode.com/u/${encodeURIComponent(u)}/`;

/** Badge tracker target: "Knight ≈1850" (presets are approximate: badges go by percentile) or the custom number. */
export const targetText = (k) => (k.badge === "Custom" ? `${k.target_rating}` : `${esc(k.badge)} ≈${k.target_rating}`);

/** Relative "Synced …" text for an ISO timestamp. */
export function syncedText(iso) {
  if (!iso) return "Never synced";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 6e4);
  if (mins < 1) return "Synced just now";
  if (mins < 60) return `Synced ${mins} min ago`;
  if (mins < 48 * 60) return `Synced ${Math.round(mins / 60)} h ago`;
  return `Synced ${fmtDay(iso.slice(0, 10), { day: "numeric", month: "short" })}`;
}

/** Avatar with an initial underneath, so a missing or blocked image still shows something. */
export const Avatar = (p, size = 40) =>
  `<span class="lc-avatar" style="--av:${size}px" aria-hidden="true"><span>${esc((p.username || "?")[0].toUpperCase())}</span>${p.avatar ? `<img src="${esc(p.avatar)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}</span>`;

export const loadProfile = () => api("/leetcode/profile");

/**
 * Fill `el` with the profile card. `data` is /api/leetcode/profile. `onChange(data)` runs after a refresh.
 */
export function paintProfileCard(el, data, onChange) {
  if (!el) return;
  if (!data.username) {
    el.innerHTML = EmptyState({ icon: "trophy", title: "Connect your LeetCode profile", compact: true,
      hint: "Add your username to see your rating, solved counts and streak here, and to log contests automatically.",
      action: Button({ label: "Open Settings", size: "sm", href: "#/settings/leetcode" }) });
    return;
  }
  const p = data.profile;
  const foot = `<div class="lc-foot"><span class="faint small" data-tip="${p ? esc(new Date(p.fetched_at).toLocaleString()) : ""}">${syncedText(p?.fetched_at)}</span>${Button({ label: "Refresh", icon: "carried", size: "sm", kind: "ghost", cls: "lc-refresh" })}</div>`;
  if (!p) {
    el.innerHTML = EmptyState({ icon: "trophy", title: `Not synced yet`, hint: `Fetch <b>${esc(data.username)}</b> from LeetCode.`, compact: true }) + foot;
  } else {
    const c = p.contest || {}, s = p.solved || {};
    const badges = [...(c.badge ? [c.badge] : []), ...p.badges.filter((b) => b !== c.badge)];
    el.innerHTML = `<div class="lc-head">${Avatar(p, 40)}<div class="lc-id"><a class="lc-name" href="${profileUrl(p.username)}" target="_blank" rel="noopener">${esc(p.username)}</a>
        <div class="muted small">Rank ${num(p.ranking)} · ${num(s.all)} solved</div></div></div>
      <div class="lc-solved" role="img" aria-label="Solved: ${s.easy} easy, ${s.medium} medium, ${s.hard} hard">
        <span>${DiffPill("Easy")}<b>${num(s.easy)}</b></span><span>${DiffPill("Medium")}<b>${num(s.medium)}</b></span><span>${DiffPill("Hard")}<b>${num(s.hard)}</b></span></div>
      <dl class="kv">
        <dt>Contest rating</dt><dd>${c.rating ?? "Unrated"}</dd>
        <dt>Global rank</dt><dd>${c.global_rank ? num(c.global_rank) : "—"}</dd>
        <dt>Top</dt><dd>${c.top_pct != null ? c.top_pct + "%" : "—"}</dd>
        <dt>Contests</dt><dd>${c.attended ?? 0}</dd>
        <dt>Streak</dt><dd>${p.streak} day${p.streak === 1 ? "" : "s"}</dd>
      </dl>
      ${badges.length ? `<div class="lc-badges">${badges.map((b) => Badge(`${b === c.badge ? icon("trophy") : ""}${esc(b)}`, b === c.badge ? "ok" : "neutral")).join("")}</div>` : ""}
      ${foot}`;
  }
  const btn = $(".lc-refresh", el);
  btn.onclick = async () => {
    btn.disabled = true;
    $(".btn-label", btn).textContent = "Syncing…";
    try {
      const r = await api("/leetcode/sync", { method: "POST" });
      toast(r.contests_added?.length ? `Synced · ${r.contests_added.length} contest${r.contests_added.length > 1 ? "s" : ""} logged from LeetCode` : "LeetCode profile synced");
      document.dispatchEvent(new Event("dsm:changed"));
      onChange?.(r);
    } catch { /* api() toasted it */
      btn.disabled = false;
      $(".btn-label", btn).textContent = "Refresh";
    }
  };
}

/** The "N questions you solved recently" banner; empty when there are none. */
export function paintSuggestionsBanner(el, data, onChange) {
  if (!el) return;
  const n = data.suggestions?.length || 0;
  if (!n) { el.innerHTML = ""; return; }
  el.innerHTML = `<div class="banner info t-banner lc-banner">${icon("sparkle")}<span><b>${n} question${n > 1 ? "s" : ""}</b> you solved recently on LeetCode match${n > 1 ? "" : "es"} your list.</span>${Button({ label: "Review", iconRight: "right", size: "sm", cls: "lc-review" })}</div>`;
  $(".lc-review", el).onclick = () => openSuggestions(data, (d) => { paintSuggestionsBanner(el, d, onChange); onChange?.(d); });
}

/** Slide-over with Accept / Dismiss per question and Accept all. */
export function openSuggestions(data, onChange) {
  let list = data.suggestions || [];
  const so = SlideOver({ title: "Solved on LeetCode", width: 520,
    sub: "Recent accepted submissions that match questions you haven't done here yet." });
  const paint = () => {
    so.setBody(list.length ? `<ul class="lc-sugg">${list.map((s) => `<li data-num="${s.num}">
        <div class="lc-sugg-main"><div class="lc-sugg-title"><span class="faint">Q${s.num}</span> ${esc(s.title)} ${DiffPill(s.difficulty)}</div>
          <div class="muted small">LeetCode: ${esc(s.lc_title)} · accepted ${fmtDay(s.date, { day: "numeric", month: "short" })}</div></div>
        <div class="btn-row">${Button({ label: "Dismiss", kind: "ghost", size: "sm", attrs: { "data-act": "dismiss" } })}${Button({ label: "Accept", icon: "check", size: "sm", attrs: { "data-act": "accept" } })}</div></li>`).join("")}</ul>
      <p class="faint small mt-s">Accepting logs the question as solved today (confidence 4, no hints), so it comes back once for a check in 21 days. LeetCode only shares your ~20 most recent accepted solves, so older ones won't show up here.</p>`
      : EmptyState({ icon: "check", title: "All caught up", hint: "Nothing left to review." }));
    so.setFoot(list.length > 1 ? `<span class="sp"></span>${Button({ label: `Accept all ${list.length}`, kind: "primary", icon: "check", id: "lcAcceptAll" })}` : "");
    $("#lcAcceptAll", so.el)?.addEventListener("click", async (e) => {
      e.currentTarget.disabled = true;
      const r = await api("/leetcode/suggestions/accept-all", { method: "POST" });
      toast(`${r.accepted.length} questions logged as solved`);
      done(r);
    });
  };
  const done = (r) => {
    list = r.suggestions;
    paint();
    document.dispatchEvent(new Event("dsm:changed"));
    onChange?.(r);
  };
  so.body.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const n = +b.closest("li").dataset.num;
    b.disabled = true;
    const r = await api(`/leetcode/suggestions/${n}/${b.dataset.act}`, { method: "POST" });
    toast(b.dataset.act === "accept" ? `Q${n} logged as solved` : `Q${n} dismissed`);
    done(r);
  });
  paint();
  return so;
}

// ---------- friends leaderboard ----------

async function saveFriends(mutate) {
  const cfg = await api("/settings");
  cfg.leetcode = { ...(cfg.leetcode || {}), friends: mutate([...(cfg.leetcode?.friends || [])]) };
  await api("/settings", { method: "PUT", body: cfg });
}

/** Leaderboard widget body. `actionsEl` gets the refresh button. */
export async function paintLeaderboard(el, actionsEl, { refresh = false } = {}) {
  if (!el) return;
  if (actionsEl && !actionsEl.dataset.wired) {
    actionsEl.dataset.wired = "1";
    actionsEl.innerHTML = `<span class="faint small" id="lbSynced"></span>${Button({ label: "Refresh", icon: "carried", size: "sm", id: "lbRefresh" })}`;
    $("#lbRefresh").onclick = async (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      try { await paintLeaderboard(el, actionsEl, { refresh: true }); toast("Leaderboard refreshed"); } finally { b.disabled = false; }
    };
  }
  if (!el.innerHTML.trim()) el.innerHTML = `<div class="lb-loading muted small">Loading friends…</div>`;
  const r = await api(`/leetcode/friends${refresh ? "?refresh=1" : ""}`);
  const rows = [...r.rows].sort((a, b) => (b.contest?.rating ?? -1) - (a.contest?.rating ?? -1));
  const stamps = r.rows.filter((x) => !x.me && x.fetched_at).map((x) => x.fetched_at).sort();
  if ($("#lbSynced")) $("#lbSynced").textContent = stamps.length ? syncedText(stamps[0]) : "";
  const addForm = `<form class="lb-add" autocomplete="off"><input name="u" placeholder="Add a friend's LeetCode username" aria-label="Friend's LeetCode username" maxlength="40" required>${Button({ label: "Add", icon: "plus", size: "md", type: "submit" })}</form>`;
  const empty = EmptyState({ icon: "trophy", title: "No friends yet", compact: true,
    hint: r.username ? "Add a friend's username below to compare ratings." : `Add your own username in <a href="#/settings/leetcode">Settings</a>, then add friends below.` });
  el.innerHTML = Table({
    rows, empty, cls: "lb-table",
    rowAttrs: (x) => (x.me ? `class="lb-me"` : ""),
    columns: [
      { label: "#", cls: "num shrink faint-cell", render: (x, i) => (x.error ? "" : i + 1) },
      { label: "User", render: (x) => `<span class="lb-user">${Avatar(x, 22)}<a href="${profileUrl(x.username)}" target="_blank" rel="noopener">${esc(x.username)}</a>${x.me ? Badge("You", "accent") : ""}${x.error ? Badge(x.not_found ? "Not found" : "Couldn't fetch", "danger", `data-tip="${esc(x.error)}"`) : ""}</span>` },
      { label: "Rating", cls: "num shrink", render: (x) => (x.contest?.rating ? `<b>${x.contest.rating}</b>` : x.error ? "" : `<span class="faint">Unrated</span>`) },
      { label: "Contests", cls: "num shrink", render: (x) => x.contest?.attended ?? "" },
      { label: "Solved E / M / H", cls: "num shrink", render: (x) => (x.solved ? `<span class="lb-emh"><i class="e">${x.solved.easy}</i> / <i class="m">${x.solved.medium}</i> / <i class="h">${x.solved.hard}</i></span>` : "") },
      { label: "Streak", cls: "num shrink", render: (x) => (x.streak != null && !x.error ? `${x.streak}d` : "") },
      { label: "Badge", cls: "shrink", render: (x) => (x.contest?.badge ? Badge(esc(x.contest.badge), "ok") : "") },
      { label: `<span class="sr-only">Remove</span>`, cls: "shrink", render: (x) => (x.me ? "" : IconButton({ icon: "close", label: `Remove ${x.username}`, size: "sm", attrs: { "data-rm": x.username } })) },
    ],
  }) + addForm;
  $$("[data-rm]", el).forEach((b) => (b.onclick = async () => {
    const u = b.dataset.rm;
    await saveFriends((f) => f.filter((x) => x.toLowerCase() !== u.toLowerCase()));
    toast(`Removed ${u}`);
    paintLeaderboard(el, actionsEl);
  }));
  const f = $(".lb-add", el);
  f.onsubmit = async (e) => {
    e.preventDefault();
    const u = f.u.value.trim();
    if (!/^[A-Za-z0-9_.-]{1,40}$/.test(u)) return toast("That doesn't look like a LeetCode username");
    f.querySelector("button").disabled = true;
    await saveFriends((list) => [...list, u]);
    toast(`Added ${u}`);
    paintLeaderboard(el, actionsEl);
  };
}
