// Shared UI plumbing: icons, tooltip, dialogs (modal / drawer / popover / confirm). Legacy html helpers re-export components.
import { $, $$, esc } from "./util.js";

import { icon } from "./icons.js";
export { icon };

// ---------- legacy names, now backed by the component layer ----------
import { KindBadge, DiffPill, Segmented, Meter, Stat, HBar, toast } from "./components/index.js";
export { toast };
export const kindChip = KindBadge;
export const diffPill = DiffPill;
export const seg = (name, options, current) => Segmented(name, options, current);
export const meterHtml = (o) => Meter(o);
export const kpi = (label, value, sub = "") => Stat({ label, value, sub });
export const hbar = (label, n, total) => HBar(label, n, total);

// ---------- tooltip ----------
const tip = () => $("#tooltip");
export function showTip(html, x, y) {
  const t = tip();
  t.innerHTML = html;
  t.hidden = false;
  t.style.left = Math.max(8, Math.min(x + 14, innerWidth - t.offsetWidth - 8)) + "px";
  t.style.top = Math.max(8, Math.min(y + 14, innerHeight - t.offsetHeight - 8)) + "px";
}
export const hideTip = () => { tip().hidden = true; };

/** Hover tooltip for chart hit-areas: `html(i)` gets the data-i of the element under the pointer. */
export function bindTips(el, html) {
  $$("[data-i]", el).forEach((h) => {
    h.addEventListener("mousemove", (e) => showTip(html(+h.dataset.i), e.clientX, e.clientY));
    h.addEventListener("mouseleave", hideTip);
  });
}

/** Delegated tooltips for any element with data-tip (hover and keyboard focus). */
export function initTooltips() {
  const at = (e) => e.target.closest?.("[data-tip]");
  document.addEventListener("mouseover", (e) => { const el = at(e); if (el) { const r = el.getBoundingClientRect(); showTip(el.dataset.tip, r.left, r.bottom - 8); } });
  document.addEventListener("mouseout", (e) => { if (at(e)) hideTip(); });
  document.addEventListener("focusin", (e) => { const el = at(e); if (el && el.matches(":focus-visible")) { const r = el.getBoundingClientRect(); showTip(el.dataset.tip, r.left, r.bottom - 8); } });
  document.addEventListener("focusout", (e) => { if (at(e)) hideTip(); });
  document.addEventListener("click", hideTip);
}

// ---------- dialogs ----------
export const overlayOpen = () => !!document.querySelector("dialog[open]");

/**
 * Open a dialog. `html` goes inside a form; a submit button's value is passed to onSubmit(action, data).
 * Buttons with data-act="cancel" close; data-act="<other>" call onSubmit(<other>, data) (e.g. delete).
 * onSubmit returning false keeps it open. Esc closes (native). Returns the <dialog>.
 */
export function openDialog({ cls = "modal", html, onSubmit, anchor }) {
  const dlg = document.createElement("dialog");
  dlg.className = cls;
  dlg.innerHTML = `<form class="dlg" method="dialog">${html}</form>`;
  document.body.appendChild(dlg);
  const form = $("form", dlg);
  const finish = async (action) => {
    const data = Object.fromEntries(new FormData(form));
    if ((await onSubmit?.(action, data)) !== false) dlg.close();
  };
  form.addEventListener("submit", (e) => { e.preventDefault(); finish("save"); });
  form.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    e.preventDefault();
    if (b.dataset.act === "cancel") dlg.close(); else finish(b.dataset.act);
  });
  dlg.addEventListener("close", () => dlg.remove());
  dlg.addEventListener("mousedown", (e) => { if (e.target === dlg && cls.includes("popover")) dlg.close(); });
  dlg.showModal();
  if (anchor && cls.includes("popover")) placePopover(dlg, anchor);
  const first = $("[autofocus]", dlg) || $("input:not([type=radio]):not([type=hidden]), textarea, select", dlg);
  first?.focus();
  return dlg;
}

/** Keep the popover off its card: below, else right, else left, else above; clamped to the viewport. */
function placePopover(dlg, anchor) {
  if (matchMedia("(max-width: 600px)").matches) return; // bottom sheet on phones (CSS)
  const box = anchor.closest?.(".card") || anchor;
  const r = box.getBoundingClientRect(), w = dlg.offsetWidth, h = dlg.offsetHeight, g = 8, m = 8;
  const clampX = (x) => Math.max(m, Math.min(x, innerWidth - w - m));
  const clampY = (y) => Math.max(m, Math.min(y, innerHeight - h - m));
  let left, top;
  if (r.bottom + g + h <= innerHeight - m) { left = clampX(r.left); top = r.bottom + g; }
  else if (r.right + g + w <= innerWidth - m) { left = r.right + g; top = clampY(r.top); }
  else if (r.left - g - w >= m) { left = r.left - g - w; top = clampY(r.top); }
  else { left = clampX(r.left); top = Math.max(m, r.top - g - h); }
  dlg.style.left = left + "px";
  dlg.style.top = top + "px";
}

export const openModal = (html, onSubmit) => openDialog({ cls: "modal", html, onSubmit });
export const openPopover = (anchor, html, onSubmit) => openDialog({ cls: "popover", html, onSubmit, anchor });
/** Right-hand drawer: title, scrolling body, footer buttons. */
export function openDrawer({ title, sub = "", body, submitLabel = "Save", onSubmit }) {
  return openDialog({
    cls: "drawer", onSubmit,
    html: `<div class="d-head"><h2>${title}</h2>${sub ? `<div class="muted small">${sub}</div>` : ""}</div>
      <div class="d-body">${body}</div>
      <div class="btns"><button type="button" class="btn btn-ghost btn-md" data-act="cancel">Cancel <kbd>Esc</kbd></button><button class="btn btn-primary btn-md">${submitLabel}</button></div>`,
  });
}

export function confirmDialog(message, okLabel = "Delete") {
  return new Promise((resolve) => {
    let ok = false;
    const dlg = openDialog({
      html: `<h2>${esc(message)}</h2><div class="btns"><button type="button" class="btn btn-ghost btn-md" data-act="cancel">Cancel</button><button class="btn btn-danger btn-md" autofocus>${esc(okLabel)}</button></div>`,
      onSubmit: () => { ok = true; },
    });
    dlg.addEventListener("close", () => resolve(ok));
  });
}

