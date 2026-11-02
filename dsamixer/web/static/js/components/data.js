// Layout and data display components: Toolbar, Widget, Stat, Meter, ProgressRing, HBar, EmptyState, Table.
import { esc, hm } from "../util.js";
import { icon } from "../icons.js";

/** Page header: optional leading controls, title + sub, trailing actions. */
export const Toolbar = ({ title, sub = "", lead = "", trail = "", actions = "", id } = {}) =>
  `<header class="toolbar" ${id ? `id="${id}"` : ""}>
    <div class="tb-left">${lead}<div class="tb-title"><h1>${title}</h1>${sub ? `<div class="tb-sub">${sub}</div>` : ""}</div>${trail}</div>
    <div class="tb-actions">${actions}</div>
  </header>`;

/**
 * The standard card: header (small title, optional actions), body, optional footer.
 * `span` is a 12-column span. `edit` is extra header HTML shown only in customize mode.
 */
export const Widget = ({ id, title = "", actions = "", body = "", footer = "", span = 12, cls = "", edit = "", flush = false, bodyId } = {}) =>
  `<section class="widget span-${span}${flush ? " flush" : ""}${cls ? " " + cls : ""}" ${id ? `data-wid="${esc(id)}" id="w-${esc(id)}"` : ""} ${title ? `aria-label="${esc(title.replace(/<[^>]+>/g, ""))}"` : ""}>
    ${title || actions || edit ? `<header class="w-head">${edit ? `<span class="w-grip" draggable="true" aria-label="Drag to reorder" data-tip="Drag to reorder">${icon("grip")}</span>` : ""}<h2 class="w-title">${title}</h2><div class="w-actions">${actions}</div>${edit ? `<div class="w-edit">${edit}</div>` : ""}</header>` : ""}
    <div class="w-body" ${bodyId || id ? `id="${esc(bodyId || "wb-" + id)}"` : ""}>${body}</div>
    ${footer ? `<footer class="w-foot">${footer}</footer>` : ""}
  </section>`;

/** KPI: label, big value, sub line, optional trend ({dir: up|down|flat, text}). */
export const Stat = ({ label, value, sub = "", trend, accent } = {}) =>
  `<div class="stat">
    <div class="stat-label">${accent ? `<i class="dot" style="--d:6px;background:${accent}"></i>` : ""}${label}</div>
    <div class="stat-value">${value}</div>
    <div class="stat-sub">${trend ? `<span class="trend ${trend.dir || "flat"}">${icon(trend.dir === "down" ? "chev" : "chev", trend.dir === "up" ? "flip" : "")}${trend.text}</span>` : ""}${sub}</div>
  </div>`;

/** A labelled usage bar. Overage is stated in text with an icon, never just colour or stripes. */
export function Meter({ label, used, cap, color = "var(--accent)", unit = hm, compact = false }) {
  const over = cap ? Math.max(0, used - cap) : 0;
  const pct = cap ? Math.min(100, (used / cap) * 100) : used ? 100 : 0;
  return `<div class="meter${over ? " over" : ""}${compact ? " compact" : ""}" style="--k:${color}">
    <div class="m-head"><span class="m-label">${label}</span><span class="m-val"><b>${unit(used)}</b><span class="m-cap"> / ${unit(cap)}</span></span></div>
    <div class="m-bar" role="img" aria-label="${esc(label)} ${unit(used)} of ${unit(cap)}${over ? `, ${unit(over)} over` : ""}"><i style="width:${pct}%"></i></div>
    ${over ? `<div class="m-over">${icon("alert")}${unit(over)} over</div>` : ""}
  </div>`;
}

/** Circular progress. value/max in [0,1]; `center` is HTML drawn in the middle. */
export function ProgressRing({ value = 0, max = 1, size = 56, stroke = 5, color = "var(--accent)", center = "", label = "", id } = {}) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, f = max ? Math.max(0, Math.min(1, value / max)) : 0;
  return `<div class="ring" style="--size:${size}px" ${id ? `id="${id}"` : ""} role="img" aria-label="${esc(label || `${Math.round(f * 100)}%`)}">
    <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}"><circle class="ring-track" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}"/>
      <circle class="ring-fill" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}" stroke="${color}" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - f)}" transform="rotate(-90 ${size / 2} ${size / 2})" data-c="${c}"/></svg>
    ${center ? `<div class="ring-center">${center}</div>` : ""}
  </div>`;
}
/** Update an existing ring in place (no re-render). */
export function setRing(el, value, max) {
  const c = el?.querySelector(".ring-fill");
  if (!c) return;
  const f = max ? Math.max(0, Math.min(1, value / max)) : 0;
  c.setAttribute("stroke-dashoffset", (+c.dataset.c * (1 - f)).toFixed(2));
}

/** Horizontal progress row: label, track, n/total. */
export function HBar(label, n, total, { color, suffix } = {}) {
  const pct = total ? (n / total) * 100 : 0;
  return `<div class="hbar"><span class="hb-label">${label}</span><div class="hb-track" role="img" aria-label="${n} of ${total}"><i style="width:${pct}%${color ? `;background:${color}` : ""}"></i></div><span class="hb-num">${suffix ?? `${n}<span class="faint">/${total}</span>`}</span></div>`;
}

export const EmptyState = ({ icon: ic = "inbox", title, hint = "", action = "", compact = false } = {}) =>
  `<div class="empty-state${compact ? " compact" : ""}"><span class="es-icon">${icon(ic)}</span><div class="es-copy"><div class="es-title">${title}</div>${hint ? `<div class="es-hint">${hint}</div>` : ""}</div>${action ? `<div class="es-action">${action}</div>` : ""}</div>`;

/**
 * Table({columns: [{label, cls, render(row, i)}], rows, empty, sticky, rowAttrs(row)})
 * render returns trusted HTML.
 */
export function Table({ columns, rows, empty = "", sticky = false, rowAttrs, cls = "" }) {
  if (!rows.length && empty) return empty;
  return `<div class="table-wrap${sticky ? " sticky" : ""}"><table class="table ${cls}">
    <thead><tr>${columns.map((c) => `<th class="${c.cls || ""}">${c.label}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((r, i) => `<tr ${rowAttrs ? rowAttrs(r, i) : ""}>${columns.map((c) => `<td class="${c.cls || ""}">${c.render(r, i)}</td>`).join("")}</tr>`).join("")}</tbody>
  </table></div>`;
}

/** Labelled form field wrapper. */
export const Field = (label, control, { hint, cls = "" } = {}) =>
  `<label class="field ${cls}"><span class="f-label">${label}</span>${control}${hint ? `<span class="f-hint">${hint}</span>` : ""}</label>`;
