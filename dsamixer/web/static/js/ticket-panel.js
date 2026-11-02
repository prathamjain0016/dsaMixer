// Card detail slide-over (Today and Week): edit status, minutes, date, note, log fields; timer; delete.
import { $, esc, fmtDay, hm, LOGGABLE, STATUS_LABEL } from "./util.js";
import { api, patchTicket } from "./api.js";
import { confirmDialog } from "./ui.js";
import { SlideOver, KindBadge, DiffPill, CarriedBadge, Segmented, Button, Badge, toast } from "./components/index.js";
import * as timer from "./timer.js";

/**
 * openTicketPanel(t, {onChanged, onContestDone, openDay})
 * onChanged(): reload the view after a save / delete / timer change.
 * onContestDone(t): a contest card moved to Done (go log the result).
 * openDay(date): optional "Open day" button (Week).
 */
export function openTicketPanel(t, { onChanged, onContestDone, openDay } = {}) {
  const loggable = LOGGABLE.includes(t.kind), ai = t.kind === "ai";
  let tick;
  const so = SlideOver({
    width: 520, label: `Card ${t.title}`,
    head: `<div class="tp-head-row">${KindBadge(t.kind)}<span class="c-id">#${t.id}</span>${DiffPill(t.difficulty)}${CarriedBadge(t.carried)}${t.source ? Badge(t.source === "homework" ? "Homework" : "AI plan", "accent") : ""}</div>`,
    onClose: () => clearInterval(tick),
  });

  const facts = [
    t.carried ? `Carried over ${t.carried} time${t.carried > 1 ? "s" : ""}` : null,
    t.result ? `Result: ${{ solved: "solved alone", hints: "needed hints", failed: "couldn't solve" }[t.result] || esc(t.result)}` : null,
    t.confidence ? `Confidence ${t.confidence}/5` : null,
    t.created_at ? `Created ${esc(t.created_at)}` : null,
    t.done_at ? `Finished ${esc(t.done_at)}` : null,
  ].filter(Boolean);

  so.setBody(`<form class="tp-form" id="tpForm" autocomplete="off">
    <textarea class="tp-title" name="title" rows="1" aria-label="Title">${esc(t.title)}</textarea>
    ${t.detail || t.pattern || t.section ? `<div class="tp-detail">${esc([t.detail, t.pattern && !String(t.detail || "").includes(t.pattern) ? `Pattern: ${t.pattern}` : ""].filter(Boolean).join(" · "))}</div>` : ""}
    <div class="btn-row mt-s">${t.url ? Button({ label: "Open on LeetCode", iconRight: "ext", size: "sm", href: t.url, attrs: { target: "_blank", rel: "noopener" } }) : ""}
      ${openDay ? Button({ label: `Open ${fmtDay(t.date, { weekday: "short", day: "numeric", month: "short" })}`, icon: "today", size: "sm", kind: "ghost", id: "tpOpenDay" }) : ""}</div>

    <section class="so-section"><h3>Status</h3>${Segmented("status", [["todo", "To do"], ["doing", "In progress"], ["done", "Done"], ["skipped", "Skipped"]], t.status, { label: "Status" })}</section>

    <section class="so-section tp-timer" id="tpTimer"></section>

    <section class="so-section"><h3>Details</h3>
      <dl class="props">
        <dt>Estimate</dt><dd><input type="number" name="est_minutes" min="0" step="5" value="${t.est_minutes ?? ""}" aria-label="Estimate in minutes"></dd>
        <dt>Time spent</dt><dd><input type="number" name="minutes_spent" min="0" value="${t.minutes_spent ?? ""}" placeholder="minutes" aria-label="Minutes spent"></dd>
        <dt>Date</dt><dd><input type="date" name="date" value="${esc(t.date)}" aria-label="Move to day" ${t.status === "done" ? "disabled" : ""}></dd>
        ${loggable ? `<dt>Result</dt><dd>${Segmented("result", [["solved", "Solved"], ["hints", "Hints"], ["failed", "Couldn't"]], t.result || "solved", { size: "sm" })}</dd>
          <dt>Confidence</dt><dd>${Segmented("confidence", [1, 2, 3, 4, 5].map((n) => [n, n]), t.confidence || 3, { size: "sm" })}</dd>
          <dt>Submission</dt><dd><input name="link" value="${esc(t.link || "")}" placeholder="https://leetcode.com/submissions/…"></dd>` : ""}
      </dl>
    </section>

    <section class="so-section"><h3>${ai ? "What you covered" : loggable ? "Key insight" : "Note"}</h3>
      <textarea name="note" rows="3" placeholder="${ai ? "e.g. backprop derivation, HW Q3" : loggable ? "e.g. shrink window when count > k" : "Anything worth remembering"}">${esc(t.note || "")}</textarea></section>

    ${facts.length ? `<section class="so-section"><h3>History</h3><ul class="tp-facts">${facts.map((f) => `<li>${f}</li>`).join("")}</ul></section>` : ""}
  </form>`);
  so.setFoot(Button({ label: "Delete", icon: "trash", kind: "ghost", cls: "danger", id: "tpDel" }) + `<span class="sp"></span>` +
    Button({ label: "Cancel", kind: "ghost", id: "tpCancel" }) + Button({ label: "Save", kind: "primary", id: "tpSave", kbd: "⌘↵" }));

  const form = $("#tpForm", so.el);
  const title = $(".tp-title", form);
  const grow = () => { title.style.height = "auto"; title.style.height = title.scrollHeight + "px"; };
  title.addEventListener("input", grow);
  requestAnimationFrame(grow);
  title.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) e.preventDefault(); });

  // ----- timer controls -----
  const paintTimer = () => {
    const tm = timer.forTicket(t.id), running = timer.isRunning(t.id), open = ["todo", "doing"].includes(t.status);
    const el = $("#tpTimer", so.el);
    if (!el) return;
    el.innerHTML = `<h3>Timer</h3><div class="tp-timer-row"><span class="tpn-clock ${running ? "running" : ""}" id="tpClock" role="timer">${timer.clockText(tm)}</span>
      <span class="muted small">${running ? "Running" : tm ? "Paused" : t.minutes_spent ? `${hm(t.minutes_spent)} logged` : "Not started"}</span><span class="sp"></span>
      ${open ? Button({ label: running ? "Pause" : tm ? "Resume" : "Start", icon: running ? "pause" : "play", size: "sm", id: "tpToggle", kind: running ? "secondary" : "primary" }) : ""}</div>`;
    $("#tpToggle", el)?.addEventListener("click", async () => {
      if (timer.isRunning(t.id)) timer.pause();
      else {
        await timer.start(t);
        if (t.status === "todo") { await patchTicket(t.id, { status: "doing" }); t.status = "doing"; form.status.value = "doing"; }
        onChanged?.();
      }
      paintTimer();
    });
  };
  paintTimer();
  tick = setInterval(() => { const c = $("#tpClock", so.el); if (c) c.textContent = timer.clockText(timer.forTicket(t.id)); }, 1000);

  // ----- save -----
  async function save() {
    const d = Object.fromEntries(new FormData(form));
    const body = {};
    const num = (v) => (v === "" || v == null ? null : +v);
    if (d.title.trim() && d.title.trim() !== t.title) body.title = d.title.trim();
    if (d.status !== t.status) body.status = d.status;
    if (num(d.est_minutes) !== (t.est_minutes ?? null) && d.est_minutes !== "") body.est_minutes = num(d.est_minutes);
    let spent = num(d.minutes_spent);
    if (body.status === "done" && timer.forTicket(t.id) && spent === (t.minutes_spent ?? null)) spent = timer.totalMinutes(t);
    if (spent !== (t.minutes_spent ?? null)) body.minutes_spent = spent;
    if (d.date && d.date !== t.date && t.status !== "done") body.date = d.date;
    if ((d.note || null) !== (t.note || null)) body.note = d.note || null;
    if (loggable) {
      if ((d.link || null) !== (t.link || null)) body.link = d.link || null;
      if (d.result !== (t.result || "solved") || body.status === "done") body.result = d.result;
      if (+d.confidence !== (t.confidence || 3) || body.status === "done") body.confidence = +d.confidence;
    }
    if (!Object.keys(body).length) return so.close();
    await patchTicket(t.id, body);
    if (body.status === "done" || body.status === "skipped") timer.clearFor(t.id);
    so.close();
    const prev = t.status;
    if (body.date) toast(`Moved to ${fmtDay(body.date)}`);
    else if (body.status) toast(`${STATUS_LABEL[body.status]}: ${t.title}`, { action: { label: "Undo", run: async () => { await patchTicket(t.id, { status: prev }); onChanged?.(); } } });
    else toast("Saved");
    if (body.status === "done" && t.kind === "contest") { await onChanged?.(); return onContestDone?.(t); }
    onChanged?.();
  }
  form.addEventListener("submit", (e) => { e.preventDefault(); save(); });
  so.el.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); } });
  $("#tpSave", so.el).onclick = save;
  $("#tpCancel", so.el).onclick = so.close;
  $("#tpOpenDay", so.el)?.addEventListener("click", () => { so.close(); openDay(t.date); });
  $("#tpDel", so.el).onclick = async () => {
    if (!(await confirmDialog(`Delete “${t.title}”?`))) return;
    await api(`/tickets/${t.id}`, { method: "DELETE" });
    timer.clearFor(t.id);
    so.close();
    toast("Card deleted");
    onChanged?.();
  };
  return so;
}

