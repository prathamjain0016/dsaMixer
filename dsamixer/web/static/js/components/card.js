// Ticket card, regular (Today board) and compact (Week planner).
import { esc, hm, KIND_LABEL } from "../util.js";
import { icon } from "../icons.js";
import { DiffPill, CarriedBadge, Conf, TrackDot } from "./primitives.js";

/**
 * Card(t, {compact, selected, running, draggable})
 * Quick actions use [data-q="done"|"timer"]; the card carries data-id.
 */
export function Card(t, { compact = false, selected = false, running = false, draggable = true } = {}) {
  const open = t.status === "todo" || t.status === "doing";
  const mins = t.minutes_spent != null ? hm(t.minutes_spent) : `~${hm(t.est_minutes)}`;
  const sub = t.detail || t.pattern || "";
  if (compact) {
    const st = t.status === "done" ? `<span class="c-st done" aria-label="Done">${icon("check")}</span>`
      : t.status === "doing" ? `<span class="c-st doing" aria-label="In progress"></span>`
      : t.status === "skipped" ? `<span class="c-st skipped" aria-label="Skipped">${icon("skip")}</span>` : "";
    const tags = `${DiffPill(t.difficulty)}${CarriedBadge(t.carried)}`;
    return `<div class="card compact k-${t.kind} st-${t.status}" ${draggable ? `draggable="true"` : ""} tabindex="0" data-id="${t.id}">
      <div class="c-row">${TrackDot(t.kind, 6)}<span class="c-kind">${KIND_LABEL[t.kind] || esc(t.kind)}</span><span class="c-sp"></span>${st}<span class="c-min">${hm(t.minutes_spent ?? t.est_minutes)}</span></div>
      <div class="c-title">${esc(t.title)}</div>
      ${tags ? `<div class="c-row c-tags">${tags}</div>` : ""}
    </div>`;
  }
  return `<div class="card k-${t.kind} st-${t.status}${selected ? " selected" : ""}${running ? " running" : ""}" ${draggable ? `draggable="true"` : ""} tabindex="0" data-id="${t.id}">
    <div class="c-row">${TrackDot(t.kind)}<span class="c-kind">${KIND_LABEL[t.kind] || esc(t.kind)}</span><span class="c-id">#${t.id}</span>${DiffPill(t.difficulty)}${CarriedBadge(t.carried)}
      <span class="c-sp"></span>
      ${open ? `<span class="c-quick">
        <button type="button" class="btn btn-ghost btn-sm btn-icon" data-q="timer" aria-label="${running ? "Pause" : "Start"} timer" data-tip="${running ? "Pause" : "Start"} timer  Space">${icon(running ? "pause" : "play")}</button>
        <button type="button" class="btn btn-ghost btn-sm btn-icon" data-q="done" aria-label="Mark done" data-tip="Mark done  X">${icon("check")}</button></span>` : ""}
    </div>
    <div class="c-title">${esc(t.title)}</div>
    <div class="c-foot">${sub ? `<span class="c-detail" data-tip="${esc(sub)}">${esc(sub)}</span>` : `<span class="c-detail"></span>`}
      ${Conf(t.confidence)}${running ? `<span class="c-live">${icon("clock")}live</span>` : ""}<span class="c-min">${mins}</span>
      ${t.url ? `<a href="${esc(t.url)}" target="_blank" rel="noopener" class="c-link" aria-label="Open on LeetCode" data-tip="Open on LeetCode">${icon("ext")}</a>` : ""}</div>
    ${t.note ? `<div class="c-note">${icon("note")}<span>${esc(t.note)}</span></div>` : ""}
  </div>`;
}
