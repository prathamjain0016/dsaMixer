// The one inline-SVG icon set: 24-unit paths drawn at 16px, stroke 1.75, currentColor (styled in base.css).
const ICONS = {
  check: "M5 12.5l4.5 4.5L19 7.5",
  play: "M8 5.5v13l10.5-6.5z",
  pause: "M9 5.5v13M15 5.5v13",
  skip: "M6 5.5l9 6.5-9 6.5zM18 5.5v13",
  ext: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  left: "M15 5l-7 7 7 7",
  right: "M9 5l7 7-7 7",
  arrow: "M5 12h14M13 6l6 6-6 6",
  plus: "M12 5v14M5 12h14",
  close: "M6.5 6.5l11 11M17.5 6.5l-11 11",
  sun: "M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
  moon: "M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z",
  chev: "M6 9l6 6 6-6",
  pull: "M12 4v12M7 11l5 5 5-5M5 20h14",
  carried: "M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6",
  alert: "M12 4.5l8.5 15h-17zM12 10v4M12 17h.01",
  flame: "M12 21c-3.6 0-6-2.4-6-5.6 0-3.4 2.6-5 3.4-8.4 1.9 1.2 2.9 3 2.9 4.6 1-.6 1.6-1.8 1.7-3 2.3 1.6 4 4.2 4 6.8 0 3.2-2.4 5.6-6 5.6z",
  help: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01",
  sparkle: "M12 4l1.8 4.6L18.5 10l-4.7 1.6L12 16l-1.8-4.4L5.5 10l4.7-1.4zM18.5 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z",
  inbox: "M4 13l2.5-7.5h11L20 13M4 13v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5M4 13h4.5l1 2h5l1-2H20",
  calendar: "M5 6h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM4 10h16M8.5 3.5v4M15.5 3.5v4",
  trophy: "M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20h7M10 17h4v3h-4z",
};

export const icon = (name, cls = "") => `<svg class="icon-svg${cls ? " " + cls : ""}" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[name]}"/></svg>`;
