/**
 * The shared look of a feature panel: switch, buttons, sections, pills, banner.
 *
 * Rules are generated for a given class prefix, so two features look identical without
 * sharing a class name. They were extracted from the street-name checker's stylesheet, and
 * the checker now generates them from here like everyone else: this file is the single
 * definition, not a copy of one.
 *
 * A feature's own stylesheet is for what only that feature needs. If you find yourself
 * writing a rule a second panel would want, it belongs here instead.
 *
 * Every colour goes through the tokens of `tokens.ts`, so light and dark come for free.
 *
 * Type scale, four sizes and three weights, so hierarchy comes from the scale rather than
 * from a value invented per panel:
 *
 *   14px/700  panel title
 *   13px/600  section title, street name
 *   12px/400  body (the pane's own size, inherited by everything unless stated)
 *   11px/400  secondary: pills, notes, buttons; 600 for a counter inside a pill
 */
/**
 * The shared segment edit-panel host. Unprefixed, because there is exactly one of it in the
 * page, shared by every feature. It reads the checker's tokens, which are declared on
 * `.wmech-edit-host` by that feature's tokenRules scope list.
 */
export const EDIT_PANEL_HOST_CSS = `
.wmech-edit-host { margin: 8px; border: 1px solid var(--chk-border); border-radius: var(--chk-radius); background: var(--chk-surface); color: var(--chk-text); overflow: hidden; font-size: 12px; }
.wmech-edit-host-head { display: flex; align-items: center; gap: 6px; padding: 6px 10px; font-size: 10px; font-weight: 700; letter-spacing: .5px; text-transform: uppercase; color: var(--chk-muted); border-bottom: 1px solid var(--chk-border); }
.wmech-slot { padding: 8px 10px; display: flex; flex-direction: column; gap: 5px; }
.wmech-slot + .wmech-slot { border-top: 1px solid var(--chk-border); }
/* The slots bring their own pane class for typography; the host owns the spacing. */
.wmech-slot > .chk-helper, .wmech-slot > .hn-pane { margin: 0; padding: 0; border: none; background: none; }
`;

export function componentRules(p: string): string {
  return `
.${p}-pane { font-family: var(--${p}-font); font-size: 12px; padding: 8px; display: flex; flex-direction: column; gap: 10px; color: var(--${p}-text); }
.${p}-pane button { cursor: pointer; font-family: inherit; }
.${p}-pane :is(button, a, summary):focus-visible { outline: 2px solid var(--${p}-primary); outline-offset: 1px; }
.${p}-pane label { display: flex; align-items: center; gap: 5px; font-weight: normal; cursor: pointer; }
.${p}-pane select, .${p}-pane input[type="number"] { background: var(--${p}-bg); color: var(--${p}-text); border: 1px solid var(--${p}-border); border-radius: 5px; padding: 2px 5px; font-size: 11px; }
.${p}-muted { color: var(--${p}-muted); }
.${p}-note { font-size: 11px; color: var(--${p}-muted); line-height: 1.4; }

/* wrap, so a long title in German pushes the switch onto its own line instead of
   squeezing it: the sidebar is narrow and the script tab bar makes it narrower. */
.${p}-brand { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.${p}-brand-icon { font-size: 16px; line-height: 1; }
.${p}-brand-title { font-weight: 700; font-size: 14px; color: var(--${p}-text); min-width: 0; }
/* The master switch rides on the title line rather than owning a block below it. It never
   shrinks and its label never breaks: it was the flex item giving way, so "Activé"
   rendered as "Act". The title yields first now, and the row wraps before either is
   clipped. */
.${p}-brand-switch { margin-left: auto; flex-shrink: 0; }
.${p}-brand-switch .${p}-switch-label { white-space: nowrap; }

/* Buttons. Neutral is the default; primary carries the one positive action of the panel.
   Hover is a brightness filter rather than a second colour token to maintain. */
.${p}-btn { font-size: 11px; padding: 4px 10px; border: 1px solid var(--${p}-border); border-radius: 6px; background: var(--${p}-surface); color: var(--${p}-text); }
.${p}-btn:hover { border-color: var(--${p}-primary); color: var(--${p}-primary); }
.${p}-btn-primary { border: none; background: var(--${p}-fix); color: #fff; font-weight: 600; padding: 5px 12px; }
.${p}-btn-primary:hover { border: none; filter: brightness(1.08); color: #fff; }
.${p}-btn:disabled { opacity: .6; cursor: default; }

/* WME's design system styles every <button> (fixed height, overflow hidden, uppercase).
   Reset all of it wherever a button stands in for plain text, or labels get clipped. */
.${p}-plain {
  background: none; border: 0; padding: 0; margin: 0;
  font: inherit; line-height: inherit; color: inherit;
  text-align: left; text-transform: none; letter-spacing: normal;
  height: auto; min-height: 0; max-height: none; width: auto;
  overflow: visible; white-space: normal; box-shadow: none; cursor: pointer;
}

/* Status banner: one element, three faces, swapped by class. */
.${p}-banner { display: flex; align-items: center; gap: 8px; padding: 7px 10px; border-radius: var(--${p}-radius); background: var(--${p}-info-bg); color: var(--${p}-text); }
.${p}-banner-ok { background: var(--${p}-ok-bg); color: var(--${p}-ok); font-weight: 600; }
.${p}-banner-error { background: rgba(192, 57, 43, .16); color: var(--${p}-error); font-weight: 600; }
.${p}-banner-text { flex: 1; min-width: 0; }
.${p}-warn { font-size: 11px; padding: 5px 10px; border-radius: var(--${p}-radius); background: var(--${p}-warn-bg); color: var(--${p}-warn); }

.${p}-master { display: flex; gap: 18px; flex-wrap: wrap; padding: 8px 10px; background: var(--${p}-surface); border: 1px solid var(--${p}-border); border-radius: var(--${p}-radius); }

/* Switch: the input stays a real checkbox inside the label, so click-on-text, keyboard
   and screen readers work with no ARIA. opacity:0 rather than display:none, which would
   make it unfocusable. The track must be the input's next sibling for the CSS to work. */
.${p}-switch { display: flex; align-items: center; gap: 8px; cursor: pointer; }
.${p}-switch input { position: absolute; opacity: 0; width: 0; height: 0; }
.${p}-switch-track { position: relative; flex: 0 0 auto; width: 34px; height: 20px; border-radius: 10px; background: var(--${p}-border); transition: background .15s; }
.${p}-switch-knob { position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.35); transition: transform .15s; }
.${p}-switch input:checked + .${p}-switch-track { background: var(--${p}-primary); }
.${p}-switch input:checked + .${p}-switch-track .${p}-switch-knob { transform: translateX(14px); }
.${p}-switch input:focus-visible + .${p}-switch-track { outline: 2px solid var(--${p}-primary); outline-offset: 2px; }
.${p}-switch-label { font-size: 12px; }

/* Pills and dots. A status colour is never carried by the dot alone: it always sits next
   to a label. */
.${p}-pills { display: flex; flex-wrap: wrap; gap: 5px; }
.${p}-pill { display: inline-flex; align-items: center; gap: 4px; border: 1px solid var(--${p}-border); border-radius: 12px; padding: 2px 9px; background: var(--${p}-surface); color: var(--${p}-text); font-size: 11px; }
.${p}-pill:hover { border-color: var(--${p}-primary); }
/* Pressed state, for the panels where the pill is a filter rather than a mere counter. */
.${p}-pill-active { border-color: var(--${p}-primary); background: var(--${p}-info-bg); color: var(--${p}-primary); font-weight: 600; }
.${p}-pill-value { font-weight: 600; font-variant-numeric: tabular-nums; }
.${p}-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }

/* Section = a box; subsection = a mere separator. They nest without a russian-doll look. */
.${p}-section { border: 1px solid var(--${p}-border); border-radius: var(--${p}-radius); background: var(--${p}-surface); overflow: hidden; }
.${p}-section > summary { display: flex; align-items: center; gap: 8px; padding: 8px 10px; font-size: 13px; font-weight: 600; cursor: pointer; list-style: none; color: var(--${p}-text); }
.${p}-section > summary::-webkit-details-marker { display: none; }
/* The icon font carries both directions, so the marker is swapped rather than rotated. */
.${p}-section > summary::after { content: "\\ea37"; font-family: "waze-web-icons"; margin-left: auto; color: var(--${p}-muted); font-size: 11px; }
.${p}-section[open] > summary::after { content: "\\ea35"; }
.${p}-section[open] > summary { border-bottom: 1px solid var(--${p}-border); }
.${p}-section-icon { font-size: 14px; line-height: 1; }
.${p}-section-body { padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; }

/* A subsection separates without boxing, so nesting one in a section stays flat. */
.${p}-subsection { border-top: 1px solid var(--${p}-border); }
.${p}-subsection:first-child { border-top: none; }
.${p}-subsection > summary { display: flex; align-items: center; gap: 6px; padding: 6px 0; font-weight: 600; cursor: pointer; list-style: none; color: var(--${p}-text); }
.${p}-subsection > summary::-webkit-details-marker { display: none; }
/* The icon font carries both directions, so the marker is swapped rather than rotated. */
.${p}-subsection > summary::after { content: "\\ea37"; font-family: "waze-web-icons"; margin-left: auto; color: var(--${p}-muted); font-size: 11px; }
.${p}-subsection[open] > summary::after { content: "\\ea35"; }
.${p}-subsection-body { padding: 4px 0 8px; display: flex; flex-direction: column; gap: 6px; }

.${p}-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.${p}-actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }

/* Busy veil: covers the list in place while it reloads, so the panel does not jump. The
   keyframes are prefixed too, or two features in one document would share one animation. */
.${p}-busy { position: absolute; inset: 0; display: none; flex-direction: column; align-items: center; justify-content: center; gap: 8px; z-index: 5; border-radius: var(--${p}-radius); background: color-mix(in srgb, var(--${p}-bg) 55%, transparent); backdrop-filter: blur(2px); -webkit-backdrop-filter: blur(2px); }
.${p}-busy-active .${p}-busy { display: flex; }
.${p}-busy-text { font-size: 12px; font-weight: 600; color: var(--${p}-text); }
.${p}-spinner { width: 26px; height: 26px; border: 3px solid var(--${p}-border); border-top-color: var(--${p}-primary); border-radius: 50%; animation: ${p}-spin .8s linear infinite; }
@keyframes ${p}-spin { to { transform: rotate(360deg); } }
`;
}
