// Small building blocks that return HTML strings: buttons, keys, badges, pills, segmented controls.
import { esc, KIND_LABEL, STATUS_LABEL } from "../util.js";
import { icon } from "../icons.js";

const attrs = (o = {}) => Object.entries(o).filter(([, v]) => v != null && v !== false)
  .map(([k, v]) => (v === true ? k : `${k}="${esc(v)}"`)).join(" ");

/** Keyboard key hint. "⌘K" style strings are split on spaces into separate keys. */
export const Kbd = (k) => String(k).split(" ").map((x) => `<kbd>${esc(x)}</kbd>`).join("");

/**
 * Button({label, icon, kind: primary|secondary|ghost|danger, size: sm|md, kbd, id, tip, type, attrs})
 * `label` is trusted HTML (callers escape user text).
 */
export function Button({ label = "", icon: ic, iconRight, kind = "secondary", size = "md", kbd, id, tip, type = "button", cls = "", attrs: extra, href } = {}) {
  const c = `btn btn-${kind} btn-${size}${label ? "" : " btn-icon"}${cls ? " " + cls : ""}`;
  const inner = `${ic ? icon(ic) : ""}${label ? `<span class="btn-label">${label}</span>` : ""}${iconRight ? icon(iconRight) : ""}${kbd ? `<span class="btn-kbd">${Kbd(kbd)}</span>` : ""}`;
  const a = attrs({ id, "data-tip": tip, ...extra });
  return href ? `<a class="${c}" href="${esc(href)}" ${a}>${inner}</a>` : `<button type="${type}" class="${c}" ${a}>${inner}</button>`;
}

/** Square icon-only button; `label` is the accessible name (and the tooltip unless `tip` is given). */
export const IconButton = ({ icon: ic, label, kind = "ghost", size = "md", id, tip, cls = "", attrs: extra } = {}) =>
  Button({ icon: ic, kind, size, id, tip: tip ?? label, cls, attrs: { "aria-label": label, ...extra } });

/** Generic badge. kind: neutral|accent|ok|warn|danger|outline. */
export const Badge = (label, kind = "neutral", extra = "") => `<span class="badge badge-${kind}" ${extra}>${label}</span>`;
export const Pill = Badge;

/** Track dot: a small coloured dot for a ticket kind (or any of dsa/ai/review/contest). */
export const TrackDot = (kind, size = 8) => `<i class="dot k-${esc(kind)}" style="--d:${size}px" aria-hidden="true"></i>`;

export const KindBadge = (kind) => `<span class="kind k-${esc(kind)}">${TrackDot(kind)}${KIND_LABEL[kind] || esc(kind)}</span>`;
export const DiffPill = (d) => (d ? `<span class="diff ${esc(d)}">${esc(d)}</span>` : "");
export const StatusPill = (s, label) => `<span class="status-pill st-${esc(s)}"><i aria-hidden="true"></i>${esc(label || STATUS_LABEL[s] || s)}</span>`;
export const CarriedBadge = (n) => (n ? `<span class="badge badge-warn carried" data-tip="Rolled over ${n} time${n > 1 ? "s" : ""}">${icon("carried")}${n}</span>` : "");

/** Five dots for a 1-5 confidence. */
export const Conf = (c) => (c ? `<span class="conf" role="img" aria-label="Confidence ${c} of 5" data-tip="Confidence ${c}/5">${[1, 2, 3, 4, 5].map((n) => `<i class="${n <= c ? "on" : ""}"></i>`).join("")}</span>` : "");

/** Segmented radio group (works inside forms: name/value). options = [[value, label], ...]. */
export function Segmented(name, options, current, { size = "md", label } = {}) {
  return `<div class="seg seg-${size}" role="radiogroup" ${label ? `aria-label="${esc(label)}"` : ""}>${options.map(([v, l]) =>
    `<label><input type="radio" name="${esc(name)}" value="${esc(v)}" ${String(current) === String(v) ? "checked" : ""}><span>${l}</span></label>`).join("")}</div>`;
}

/** Tabs as buttons; the view handles clicks on [data-tab]. */
export const Tabs = (items, active) => `<div class="tabs" role="tablist">${items.map(([v, l]) =>
  `<button type="button" role="tab" class="tab" data-tab="${esc(v)}" aria-selected="${v === active}">${l}</button>`).join("")}</div>`;
