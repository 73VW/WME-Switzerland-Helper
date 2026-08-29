/**
 * Element builders shared by every feature panel.
 *
 * They take the feature prefix the same way `componentRules(p)` does, so two panels
 * produce identical markup without sharing a class name. Anything that reads a feature's
 * own data (the house-number status icons, the checker's issue model) stays in that
 * feature: this module knows about markup, never about domain.
 */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * An icon from the Waze icon font.
 *
 * WME loads `waze-web-icons.css` itself, so we load nothing: the class is enough. We also
 * never pin a version — the stylesheet declares its font files with relative URLs, so a
 * `<link>` of our own would resolve them against `waze.com/editor` and render blanks.
 *
 * Always decorative. The icon accompanies text that already carries the meaning, so a
 * missing font degrades to a gap rather than to a loss of information.
 */
export function icon(name: string, className = ""): HTMLElement {
  const node = el("i", `w-icon w-icon-${name}${className ? ` ${className}` : ""}`);
  node.setAttribute("aria-hidden", "true");
  return node;
}

/**
 * The input stays a real checkbox inside the label, so clicking the text, tabbing to it
 * and screen readers all work without a single ARIA attribute. The track must remain the
 * input's next sibling: that is what the CSS selector hangs on.
 */
export function toggleSwitch(
  p: string,
  text: string,
  checked: boolean,
  onChange: (checked: boolean) => void,
  title?: string,
): HTMLElement {
  const label = el("label", `${p}-switch`);
  if (title) label.title = title;
  const input = el("input") as HTMLInputElement;
  input.type = "checkbox";
  input.checked = checked;
  input.addEventListener("change", () => onChange(input.checked));
  const track = el("span", `${p}-switch-track`);
  track.appendChild(el("span", `${p}-switch-knob`));
  label.append(input, track, el("span", `${p}-switch-label`, text));
  return label;
}

export function button(
  text: string,
  onClick: () => void,
  className = "",
): HTMLButtonElement {
  const node = el("button", className, text);
  // WME panels are full of forms; an untyped button would submit the nearest one.
  node.type = "button";
  node.addEventListener("click", onClick);
  return node;
}

export function numberInput(
  value: number,
  onChange: (value: number) => void,
  bounds: { min: number; max: number },
): HTMLInputElement {
  const input = el("input") as HTMLInputElement;
  input.type = "number";
  input.min = String(bounds.min);
  input.max = String(bounds.max);
  input.value = String(value);
  input.style.width = "60px";
  input.addEventListener("change", () => {
    const parsed = Number.parseInt(input.value, 10);
    const clamped = Math.min(bounds.max, Math.max(bounds.min, parsed));
    // Reflect the clamp back, so the field never shows a value the feature ignores.
    input.value = String(Number.isFinite(clamped) ? clamped : value);
    onChange(Number(input.value));
  });
  return input;
}

/**
 * A collapsible box. `open` decides the initial state only: the element is built once and
 * kept, so the editor's own expand/collapse survives every re-render.
 */
export function buildSection(
  p: string,
  iconName: string,
  title: string,
  children: HTMLElement[],
  open = false,
): HTMLDetailsElement {
  const details = el("details", `${p}-section`);
  details.open = open;
  const summary = el("summary");
  summary.append(icon(iconName, `${p}-section-icon`), el("span", "", title));
  details.appendChild(summary);
  const body = el("div", `${p}-section-body`);
  for (const child of children) body.appendChild(child);
  details.appendChild(body);
  return details;
}

/** A section nested inside another: a separator rather than a second box. */
export function buildSubsection(
  p: string,
  iconName: string,
  title: string,
  children: HTMLElement[],
): HTMLDetailsElement {
  const details = el("details", `${p}-subsection`);
  const summary = el("summary");
  summary.append(icon(iconName, `${p}-section-icon`), el("span", "", title));
  details.appendChild(summary);
  const body = el("div", `${p}-subsection-body`);
  for (const child of children) body.appendChild(child);
  details.appendChild(body);
  return details;
}
