// Overlays that need behaviour: SlideOver (right panel), Menu (dropdown), Toast (with optional undo).
import { $, esc } from "../util.js";
import { icon } from "../icons.js";

/**
 * Right-hand slide-over on a modal <dialog> (Esc closes, focus is trapped, backdrop blurs).
 * Returns {el, body, foot, close, setBody, setFoot, setHead}.
 */
export function SlideOver({ title = "", sub = "", head, body = "", footer = "", width = 480, cls = "", onClose, label } = {}) {
  const dlg = document.createElement("dialog");
  dlg.className = `slideover ${cls}`;
  dlg.setAttribute("aria-label", label || title.replace(/<[^>]+>/g, "") || "Panel");
  dlg.style.setProperty("--so-w", width + "px");
  dlg.innerHTML = `<div class="so-panel">
    <header class="so-head"><div class="so-head-main"></div><button type="button" class="btn btn-ghost btn-md btn-icon so-close" aria-label="Close" data-tip="Close  Esc">${icon("close")}</button></header>
    <div class="so-body"></div><footer class="so-foot"></footer></div>`;
  document.body.appendChild(dlg);
  const api = {
    el: dlg, body: $(".so-body", dlg), foot: $(".so-foot", dlg),
    setHead(html) { $(".so-head-main", dlg).innerHTML = html; },
    setBody(html) { api.body.innerHTML = html; api.body.scrollTop = 0; },
    setFoot(html) { api.foot.innerHTML = html; api.foot.hidden = !html; },
    close() { if (dlg.open) dlg.close(); },
  };
  api.setHead(head ?? `<div class="so-titles"><h2>${title}</h2>${sub ? `<div class="so-sub">${sub}</div>` : ""}</div>`);
  api.setBody(body);
  api.setFoot(footer);
  $(".so-close", dlg).onclick = api.close;
  dlg.addEventListener("mousedown", (e) => { if (e.target === dlg) api.close(); });
  dlg.addEventListener("close", () => { dlg.remove(); onClose?.(); });
  dlg.showModal();
  ($("[autofocus]", dlg) || $(".so-close", dlg)).focus();
  return api;
}

/**
 * Dropdown menu anchored to an element. items: [{label, icon, kbd, hint, onSelect, danger, disabled} | "-" | {heading}].
 * Arrow keys, Enter, Esc. Closes on outside click.
 */
export function openMenu(anchor, items, { align = "end", width } = {}) {
  closeMenu();
  const el = document.createElement("div");
  el.className = "menu";
  el.setAttribute("role", "menu");
  if (width) el.style.minWidth = width + "px";
  el.innerHTML = items.map((it, i) => it === "-" ? `<div class="menu-sep" role="separator"></div>`
    : it.heading ? `<div class="menu-heading">${esc(it.heading)}</div>`
    : `<button type="button" role="menuitem" class="menu-item${it.danger ? " danger" : ""}" data-i="${i}" ${it.disabled ? "disabled" : ""}>
        ${it.icon ? icon(it.icon) : ""}<span class="mi-label">${it.label}</span>${it.hint ? `<span class="mi-hint">${it.hint}</span>` : ""}${it.kbd ? `<kbd>${esc(it.kbd)}</kbd>` : ""}</button>`).join("");
  document.body.appendChild(el);
  const r = anchor.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight;
  let left = align === "end" ? r.right - w : r.left;
  left = Math.max(8, Math.min(left, innerWidth - w - 8));
  let top = r.bottom + 6;
  if (top + h > innerHeight - 8) top = Math.max(8, r.top - h - 6);
  el.style.left = left + "px";
  el.style.top = top + "px";
  const btns = [...el.querySelectorAll(".menu-item:not([disabled])")];
  btns[0]?.focus();
  el.addEventListener("click", (e) => {
    const b = e.target.closest(".menu-item");
    if (!b) return;
    closeMenu();
    items[+b.dataset.i].onSelect?.();
  });
  el.addEventListener("keydown", (e) => {
    const i = btns.indexOf(document.activeElement);
    if (e.key === "ArrowDown") { e.preventDefault(); btns[(i + 1) % btns.length]?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); btns[(i - 1 + btns.length) % btns.length]?.focus(); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeMenu(); anchor.focus?.(); }
  });
  const outside = (e) => { if (!el.contains(e.target) && !anchor.contains(e.target)) closeMenu(); };
  setTimeout(() => document.addEventListener("mousedown", outside), 0);
  openMenu.cleanup = () => { document.removeEventListener("mousedown", outside); el.remove(); };
  return el;
}
export function closeMenu() { openMenu.cleanup?.(); openMenu.cleanup = null; }
export const menuOpen = () => !!openMenu.cleanup;

/** Toast with an optional action: toast("Moved", {action: {label: "Undo", run}}). */
let toastTimer;
export function toast(msg, { action, kind = "", ms } = {}) {
  const el = $("#toast");
  if (!el) return;
  el.className = `toast ${kind}`;
  el.innerHTML = `<span class="t-msg">${esc(msg)}</span>${action ? `<button type="button" class="t-act">${icon("undo")}${esc(action.label)}</button>` : ""}`;
  el.hidden = false;
  if (action) $(".t-act", el).onclick = async () => { el.hidden = true; await action.run(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), ms || (action ? 5000 : 2800));
}
