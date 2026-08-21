# UI/UX Harmonisation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the street-name checker and the house-number importer one shared visual language, built on one shared foundation, without changing a single behaviour.

**Architecture:** `src/ui/` already holds the design tokens and the generated component CSS, extracted from the checker but adopted only by the importer. This plan finishes that extraction: shared DOM builders, the Waze icon font WME already loads in place of emoji, one flattened block hierarchy per tab, and one shared host for the two segment-edit-panel boxes. Every task is a refactor with a test; none touches the fix/import pipelines.

**Tech Stack:** TypeScript, Rollup, vitest (Node environment, **no jsdom**), i18next, WME SDK.

**Spec:** `docs/superpowers/specs/2026-08-21-ui-ux-harmonisation-design.md`

## Global Constraints

- **No behaviour changes.** Nothing in `fix.ts`, `import.ts`, `status.ts`, `scan.ts`, `matching/`, `gwr/`, `geoadmin/` is touched. If a task seems to require it, stop and report.
- **Safety rails unchanged**: `GROUP_FIX_MIN_RANK`, `LOCK_DEFAULT_MIN_RANK` (both level 3), `IMPORT_CAP` (50), `MAX_SNAP_DISTANCE_M` (150). Gates stay enforced both in the UI and again in the writing layer. Group actions stay **hidden**, never greyed. Nothing is ever saved automatically.
- **No sixth DOM deviation.** The five deviations listed in `CLAUDE.md` stay as they are. Task 10 *reduces* the edit-panel injection from two mount points to one; it does not add a new kind.
- **Icons are decorative only.** Every `<i class="w-icon …">` carries `aria-hidden="true"` and sits next to text that already says the same thing. WME loads the icon font itself; we never load it and never pin a version. If the font vanishes, the panel must stay readable.
- **Colour is never the sole carrier of a status.** Every dot stays next to a label.
- **Four languages, always.** Any new string goes into `locales/en/common.json`, `locales/fr/common.json`, `locales/de/common.json`, `locales/it/common.json` in the same commit.
- **Tests run in Node with no DOM.** Follow the repo's precedent (`src/ui/tab-group.test.ts`, `geoadmin/idb-store.test.ts`): pure logic in pure functions, hand-rolled minimal doubles for the rest. Do **not** add jsdom.
- **Never run Prettier.** `npm run watch` calls `prettier --write .`, but the repo has **no
  Prettier config** and **81 files under `src/` do not satisfy its defaults**. The real house
  style is wider than the default 80 columns. Running `prettier --write` on a file you touch
  reformats every unrelated line in it and buries your change in noise. Match the
  surrounding code by hand instead. (Learned the hard way in Task 2: it rewrapped a
  five-name import that had nothing to do with the change.)
- **Commits:** Conventional Commits, English, imperative subject. **No `Co-Authored-By: Claude` trailer, no "Generated with Claude Code" anywhere.**
- **Never push to `main`.** Work stays on `refactor/ui-ux-improvements`. Do not push or open a PR without the user's explicit go.

**Verification loop, run at the end of every task:**

```bash
npx tsc --noEmit
npx vitest run src/ui src/street-name-checker src/house-number-importer
npx eslint src/ui src/street-name-checker src/house-number-importer
npx rollup -c
```

**Baseline, measured on `refactor/ui-ux-improvements` at `95f1945` before any code changed:**

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | clean |
| `npx vitest run` (whole suite) | 38 files, **547 passed, 1 skipped** |
| `npx eslint src/ui src/street-name-checker src/house-number-importer` | clean |
| `npx rollup -c` | builds |

Two pre-existing conditions, **neither of them yours to fix**:

- `npx eslint src` reports one error, `src/tileLayer.ts:68 'args' is defined but never
  used`. That file belongs to the public-transport layers, outside this plan's scope, which
  is why the loop above lints the touched paths rather than all of `src`. Do not touch it.
- `npx rollup -c` prints circular-dependency warnings from `node_modules/d3-voronoi`. They
  come from a dependency and the build succeeds.

The test count only ever goes up. If it drops, a test was lost — stop and report.

---

## File Structure

**Created**

| File | Responsibility |
| --- | --- |
| `src/ui/fake-dom.ts` | Minimal `document` double for tests. Not bundled: nothing in `main.user.ts` imports it. |
| `src/ui/dom.ts` | Shared element builders, parameterised by feature prefix, mirroring `componentRules(p)`. |
| `src/ui/dom.test.ts` | Markup invariants of the builders. |
| `src/ui/edit-panel-host.ts` | One container in `#edit-panel`, one slot per feature, order declared not raced. |
| `src/ui/edit-panel-host.test.ts` | Ordering and retraction logic (pure core). |

**Deleted**

| File | Why |
| --- | --- |
| `src/street-name-checker/ui/dom.ts` | Folded into `src/ui/dom.ts`. |
| `src/house-number-importer/ui/dom.ts` | Folded into `src/ui/dom.ts`; `dot()` moves to `ui/format.ts` (it reads the feature's own `STATUS_ICONS`). |

**Modified** — `src/ui/components.ts`, `src/ui/tokens.ts`, both features' `ui/styles.ts`, `ui/tab.ts`, `ui/edit-panel.ts`, `ui/format.ts`, the checker's `ui/settings-panel.ts` and `ui/floating-window.ts`, the four `locales/*/common.json`, `CLAUDE.md`, `README.md`.

---

## Task 1: Shared DOM builders

**Files:**
- Create: `src/ui/fake-dom.ts`
- Create: `src/ui/dom.ts`
- Test: `src/ui/dom.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  // src/ui/dom.ts
  export function el<K extends keyof HTMLElementTagNameMap>(
    tag: K, className?: string, text?: string): HTMLElementTagNameMap[K]
  export function icon(name: string, className?: string): HTMLElement
  export function toggleSwitch(p: string, text: string, checked: boolean,
    onChange: (checked: boolean) => void, title?: string): HTMLElement
  export function button(text: string, onClick: () => void, className?: string): HTMLButtonElement
  export function numberInput(value: number, onChange: (value: number) => void,
    bounds: { min: number; max: number }): HTMLInputElement
  export function buildSection(p: string, iconName: string, title: string,
    children: HTMLElement[], open?: boolean): HTMLDetailsElement
  export function buildSubsection(p: string, iconName: string, title: string,
    children: HTMLElement[]): HTMLDetailsElement
  // src/ui/fake-dom.ts
  export function installFakeDocument(): () => void
  ```

- [ ] **Step 1: Write the DOM double**

`src/ui/fake-dom.ts`:

```ts
/**
 * Minimal `document` double, in the spirit of the fake in `tab-group.test.ts` and the
 * IndexedDB double in `geoadmin/idb-store.test.ts`: the repo runs its tests in Node with
 * no document, and jsdom would be a dependency for the handful of operations the DOM
 * builders actually perform.
 *
 * Test-only. Nothing reachable from `main.user.ts` imports it, so Rollup never bundles it.
 */
interface FakeNode {
  tagName: string;
  className: string;
  textContent: string;
  type: string;
  checked: boolean;
  open: boolean;
  children: FakeNode[];
  attributes: Record<string, string>;
  listeners: Record<string, Array<() => void>>;
  style: Record<string, string>;
  append(...nodes: Array<FakeNode | string>): void;
  appendChild(node: FakeNode): FakeNode;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  addEventListener(type: string, handler: () => void): void;
  querySelector(selector: string): FakeNode | null;
  /** Test-only: fire a listener without a real event object. */
  dispatch(type: string): void;
}

function createNode(tagName: string): FakeNode {
  const node: FakeNode = {
    tagName,
    className: "",
    textContent: "",
    type: "",
    checked: false,
    open: false,
    children: [],
    attributes: {},
    listeners: {},
    style: {},
    append(...nodes) {
      for (const child of nodes) {
        if (typeof child === "string") node.textContent += child;
        else node.children.push(child);
      }
    },
    appendChild(child) {
      node.children.push(child);
      return child;
    },
    setAttribute(name, value) {
      node.attributes[name] = value;
    },
    getAttribute(name) {
      return node.attributes[name] ?? null;
    },
    addEventListener(type, handler) {
      (node.listeners[type] ??= []).push(handler);
    },
    querySelector(selector) {
      // Only tag selectors are used by the builders under test.
      for (const child of node.children) {
        if (child.tagName === selector) return child;
        const found = child.querySelector(selector);
        if (found) return found;
      }
      return null;
    },
    dispatch(type) {
      for (const handler of node.listeners[type] ?? []) handler();
    },
  };
  return node;
}

/** Installs the double on globalThis and returns the function that removes it. */
export function installFakeDocument(): () => void {
  const previous = (globalThis as Record<string, unknown>).document;
  (globalThis as Record<string, unknown>).document = {
    createElement: (tag: string) => createNode(tag),
  };
  return () => {
    (globalThis as Record<string, unknown>).document = previous;
  };
}

export type { FakeNode };
```

- [ ] **Step 2: Write the failing test**

`src/ui/dom.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installFakeDocument, type FakeNode } from "./fake-dom";
import { buildSection, button, el, icon, numberInput, toggleSwitch } from "./dom";

let restore: () => void;
beforeEach(() => {
  restore = installFakeDocument();
});
afterEach(() => restore());

/** The builders are typed against the real DOM; the double stands in at runtime. */
const asFake = (node: unknown): FakeNode => node as FakeNode;

describe("el", () => {
  it("sets the class and the text when given", () => {
    const node = asFake(el("div", "chk-pane", "bonjour"));
    expect(node.tagName).toBe("div");
    expect(node.className).toBe("chk-pane");
    expect(node.textContent).toBe("bonjour");
  });
});

describe("icon", () => {
  it("is decorative: hidden from assistive technology", () => {
    const node = asFake(icon("road"));
    expect(node.className).toBe("w-icon w-icon-road");
    expect(node.getAttribute("aria-hidden")).toBe("true");
  });

  it("appends the caller's class after the icon classes", () => {
    expect(asFake(icon("settings", "chk-section-icon")).className).toBe(
      "w-icon w-icon-settings chk-section-icon",
    );
  });
});

describe("toggleSwitch", () => {
  /**
   * The CSS hangs on this exact shape: `input:checked + .track`. If the checkbox stops
   * being the track's previous sibling the switch silently stops reflecting its state,
   * and no type error catches it.
   */
  it("keeps the checkbox as the track's previous sibling", () => {
    const label = asFake(toggleSwitch("chk", "Activé", true, () => {}));
    expect(label.children.map((c) => c.tagName)).toEqual(["input", "span", "span"]);
    expect(label.children[0]?.type).toBe("checkbox");
    expect(label.children[1]?.className).toBe("chk-switch-track");
  });

  it("carries the feature prefix into every class", () => {
    const label = asFake(toggleSwitch("hn", "Activé", false, () => {}));
    expect(label.className).toBe("hn-switch");
    expect(label.children[1]?.className).toBe("hn-switch-track");
    expect(label.children[2]?.className).toBe("hn-switch-label");
  });

  it("reports the checkbox state on change, not the initial value", () => {
    const seen: boolean[] = [];
    const label = asFake(toggleSwitch("chk", "Activé", false, (v) => seen.push(v)));
    const input = label.children[0] as FakeNode;
    input.checked = true;
    input.dispatch("change");
    expect(seen).toEqual([true]);
  });
});

describe("numberInput", () => {
  it("clamps into the bounds and reflects the clamp back into the field", () => {
    const seen: number[] = [];
    const input = asFake(numberInput(16, (v) => seen.push(v), { min: 15, max: 22 }));
    (input as unknown as { value: string }).value = "99";
    input.dispatch("change");
    expect((input as unknown as { value: string }).value).toBe("22");
    expect(seen).toEqual([22]);
  });
});

describe("buildSection", () => {
  it("starts closed by default and open when asked", () => {
    expect(asFake(buildSection("hn", "layers", "Légende", [])).open).toBe(false);
    expect(asFake(buildSection("hn", "layers", "Légende", [], true)).open).toBe(true);
  });

  it("puts the children in the body, not in the summary", () => {
    const child = el("div", "row");
    const details = asFake(buildSection("chk", "settings", "Réglages", [child]));
    const body = details.children.find((c) => c.className === "chk-section-body");
    expect(body?.children).toHaveLength(1);
  });
});

describe("button", () => {
  it("is type=button, so it never submits a WME form it landed in", () => {
    expect(asFake(button("Corriger", () => {})).type).toBe("button");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/ui/dom.test.ts`
Expected: FAIL — `Failed to resolve import "./dom"`.

- [ ] **Step 4: Write `src/ui/dom.ts`**

```ts
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
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/ui/dom.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 6: Run the full verification loop**

```bash
npx tsc --noEmit && npx vitest run src/ui src/street-name-checker src/house-number-importer && npx eslint src/ui src/street-name-checker src/house-number-importer && npx rollup -c
```

- [ ] **Step 7: Commit**

```bash
git add src/ui/dom.ts src/ui/dom.test.ts src/ui/fake-dom.ts
git commit -m "feat(ui): shared DOM builders for every feature panel" \
  -m "el() and toggleSwitch() were duplicated byte for byte between the two features,
button() and numberInput() existed only in the importer, and buildSection() had
already drifted. They now take the feature prefix the way componentRules(p) does.

icon() is new: WME loads the Waze icon font itself, so a class is all it takes.
The version is deliberately not pinned, because the stylesheet declares its font
files with relative URLs.

Tested with a hand-rolled document double, following the precedent set by
tab-group.test.ts rather than adding jsdom."
```

---

## Task 2: Move the house-number importer onto the shared builders

**Files:**
- Delete: `src/house-number-importer/ui/dom.ts`
- Modify: `src/house-number-importer/ui/tab.ts` (receives `dot`), `src/house-number-importer/ui/edit-panel.ts`

**Interfaces:**
- Consumes: `el`, `button`, `numberInput`, `toggleSwitch`, `buildSection` from `src/ui/dom.ts` (Task 1).
- Produces: `dot(status: PointStatus): HTMLElement` becomes a module-private function of `src/house-number-importer/ui/tab.ts`.

> **Correction made during execution.** The plan first sent `dot()` to `ui/format.ts`. That
> file opens with an explicit contract — *"Presentation logic with no DOM, so it can be
> tested in the repo's Node environment. Anything touching elements stays in tab.ts"* — and
> `dot()` builds an `<img>`. `tab.ts` is its only caller (twice, one of which Task 9
> deletes), so it goes there and the contract holds. No test is added: the function is three
> lines over `STATUS_ICONS`, and testing it would mean installing the DOM double to assert
> a lookup that `map-layer.ts` already owns.

The importer is migrated first: it is the smaller of the two and already uses `componentRules("hn")`, so a break shows up immediately.

- [ ] **Step 1: Move `dot` into `tab.ts`**

Cut the `dot()` function and its doc comment from `src/house-number-importer/ui/dom.ts` and
paste it into `src/house-number-importer/ui/tab.ts`, above the `TabUI` class, without the
`export` keyword. Add `STATUS_ICONS` to the imports there:

```ts
import { STATUS_ICONS } from "../map-layer";
```

- [ ] **Step 2: Delete the feature's `dom.ts` and repoint its importers**

```bash
rm src/house-number-importer/ui/dom.ts
```

In `src/house-number-importer/ui/tab.ts`, replace the import line

```ts
import { buildSection, button, dot, el, numberInput, toggleSwitch } from "./dom";
```

with

```ts
import { buildSection, button, el, numberInput, toggleSwitch } from "../../ui/dom";
```

and add `dot` to the existing `./format` import block.

In `src/house-number-importer/ui/edit-panel.ts`, replace

```ts
import { button, el } from "./dom";
```

with

```ts
import { button, el } from "../../ui/dom";
```

- [ ] **Step 3: Adapt every call site to the new signatures**

`toggleSwitch`, `buildSection` and `buildSubsection` now take the prefix first, and `buildSection` takes an icon **name** rather than an emoji. In `tab.ts`:

| Before | After |
| --- | --- |
| `toggleSwitch(t("enable"), settings.enabled, cb)` | `toggleSwitch("hn", t("enable"), settings.enabled, cb)` |
| `buildSection("⚙️", t("settingsTitle"), [...])` | `buildSection("hn", "settings", t("settingsTitle"), [...])` |
| `buildSection("🎨", t("legendTitle"), [legend], true)` | `buildSection("hn", "layers", t("legendTitle"), [legend], true)` |

`button()` no longer defaults to `"hn-btn"`. Every bare `button(text, cb)` becomes `button(text, cb, "hn-btn")`; the calls that already pass `"hn-btn hn-btn-primary"` are unchanged.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/house-number-importer`
Expected: PASS, at the count it had before this task. Nothing is added here: this task moves
code, it does not introduce behaviour.

- [ ] **Step 5: Run the full verification loop**

```bash
npx tsc --noEmit && npx vitest run src/ui src/street-name-checker src/house-number-importer && npx eslint src/ui src/street-name-checker src/house-number-importer && npx rollup -c
```

- [ ] **Step 6: Commit**

```bash
git add -A src/house-number-importer
git commit -m "refactor(house-number-importer): use the shared DOM builders" \
  -m "dot() moves into tab.ts, its only caller: it reads the feature's own
STATUS_ICONS, so it was the one builder with no business in a shared module, and
ui/format.ts states it holds no DOM. Everything else comes from src/ui/dom.ts."
```

---

## Task 3: Move the street-name checker onto the shared builders

**Files:**
- Delete: `src/street-name-checker/ui/dom.ts`
- Modify: `src/street-name-checker/ui/tab.ts`, `ui/settings-panel.ts`, `ui/edit-panel.ts`, `ui/floating-window.ts`, `ui/canton-link.ts`

**Interfaces:**
- Consumes: `src/ui/dom.ts` (Task 1).
- Produces: nothing new.

- [ ] **Step 1: Find every importer**

```bash
grep -rn 'from "./dom"\|from "../ui/dom"\|from "./ui/dom"' src/street-name-checker
```

Expected: `ui/tab.ts`, `ui/settings-panel.ts`, `ui/edit-panel.ts`, `ui/floating-window.ts`, `ui/canton-link.ts` (confirm against the actual output; repoint every hit).

- [ ] **Step 2: Delete the file and repoint the imports**

```bash
rm src/street-name-checker/ui/dom.ts
```

In each file, change `from "./dom"` to `from "../../ui/dom"`.

- [ ] **Step 3: Adapt the call sites**

Every `toggleSwitch(text, checked, cb, title)` becomes `toggleSwitch("chk", text, checked, cb, title)`. There are three construction points: `buildMasterToggles`, `viewportOnlyToggle` (`tab.ts`) and the toggles inside `buildSettingsPanel` (`settings-panel.ts`).

The four `buildSubsection` calls in `settings-panel.ts` pass an emoji today, and the new
signature takes an icon **name**. They therefore convert here rather than in Task 6 — the
signature forces it, there is no intermediate state:

| Subsection | Emoji today | Icon |
| --- | --- | --- |
| `roadTypesLabel` | 🛣️ | `road` |
| `statusesLabel` | 🏷️ | `filter` |
| `optionsLabel` | 🎛️ | `list` |
| `scopeDisplayLabel` | 📍 | `location` |

> **Correction made during execution.** The plan listed five importers of the checker's
> `dom.ts`. There are three: `ui/tab.ts`, `ui/settings-panel.ts`, `ui/floating-window.ts`.
> `ui/edit-panel.ts` and `ui/canton-link.ts` call `document.createElement` directly and are
> untouched by this task.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/street-name-checker`
Expected: PASS, unchanged count.

- [ ] **Step 5: Confirm both features now share one builder module**

```bash
test ! -e src/street-name-checker/ui/dom.ts && test ! -e src/house-number-importer/ui/dom.ts && echo "one builder module"
```

- [ ] **Step 6: Run the full verification loop**

```bash
npx tsc --noEmit && npx vitest run src/ui src/street-name-checker src/house-number-importer && npx eslint src/ui src/street-name-checker src/house-number-importer && npx rollup -c
```

- [ ] **Step 7: Commit**

```bash
git add -A src/street-name-checker
git commit -m "refactor(street-name-checker): use the shared DOM builders" \
  -m "Both features now build their markup from src/ui/dom.ts. The two per-feature
dom.ts files are gone."
```

---

## Task 4: Put the checker on `componentRules`

**Files:**
- Modify: `src/ui/components.ts` (two additions)
- Modify: `src/street-name-checker/ui/styles.ts` (218 lines down to what is genuinely its own)
- Modify: `src/street-name-checker/ui/tab.ts`, `ui/edit-panel.ts` (five class renames)
- Test: `src/ui/components.test.ts` (new)

**Interfaces:**
- Consumes: `componentRules(p)` from `src/ui/components.ts`.
- Produces: `.chk-pill`, `.chk-pill-active`, `.chk-dot`, `.chk-plain`, `.chk-banner-error` replace the checker's old names.

This is the task the whole "harmonisation" word rests on: `components.ts` was extracted **from** this stylesheet and the checker never adopted it.

- [ ] **Step 1: Write the failing test**

`src/ui/components.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { componentRules } from "./components";

describe("componentRules", () => {
  it("generates every rule under the caller's prefix", () => {
    const css = componentRules("chk");
    expect(css).toContain(".chk-pane {");
    expect(css).toContain(".chk-switch-track {");
    expect(css).not.toContain(".hn-");
  });

  /**
   * The checker filters by status; the pill is the control, so it needs a pressed state.
   * The importer only ever counts, which is why this rule was missing.
   */
  it("gives the pill an active state, for the panels that filter with it", () => {
    expect(componentRules("chk")).toContain(".chk-pill-active {");
  });

  it("carries the busy veil, so a panel can cover its list while it reloads", () => {
    const css = componentRules("chk");
    expect(css).toContain(".chk-busy {");
    expect(css).toContain(".chk-spinner {");
    expect(css).toContain("@keyframes chk-spin");
  });

  it("keeps two prefixes from colliding in the same document", () => {
    const both = componentRules("chk") + componentRules("hn");
    expect(both).toContain("@keyframes chk-spin");
    expect(both).toContain("@keyframes hn-spin");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/ui/components.test.ts`
Expected: FAIL — `.chk-pill-active` and `.chk-busy` are not in the generated CSS.

- [ ] **Step 3: Add the two missing blocks to `components.ts`**

Append inside the template literal returned by `componentRules(p)`, after the pills block:

```
.${p}-pill-active { border-color: var(--${p}-primary); background: var(--${p}-info-bg); color: var(--${p}-primary); font-weight: 600; }
.${p}-pill:hover { border-color: var(--${p}-primary); }

/* Busy veil: covers the list in place while it reloads, so the panel does not jump. The
   keyframes are prefixed too, or two features in one document would share one animation. */
.${p}-busy { position: absolute; inset: 0; display: none; flex-direction: column; align-items: center; justify-content: center; gap: 8px; z-index: 5; border-radius: var(--${p}-radius); background: color-mix(in srgb, var(--${p}-bg) 55%, transparent); backdrop-filter: blur(2px); -webkit-backdrop-filter: blur(2px); }
.${p}-busy-active .${p}-busy { display: flex; }
.${p}-busy-text { font-size: 12px; font-weight: 600; color: var(--${p}-text); }
.${p}-spinner { width: 26px; height: 26px; border: 3px solid var(--${p}-border); border-top-color: var(--${p}-primary); border-radius: 50%; animation: ${p}-spin .8s linear infinite; }
@keyframes ${p}-spin { to { transform: rotate(360deg); } }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/ui/components.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Rewrite the checker's `styles.ts` on top of `componentRules`**

```ts
import { componentRules } from "../../ui/components";
import { injectStyleOnce } from "../../ui/inject";
import { tokenRules } from "../../ui/tokens";
import { STATUS_STYLES } from "../map-layer";
import type { IssueStatus } from "../matching/evaluate";

const statusDotRules = (Object.keys(STATUS_STYLES) as IssueStatus[])
  .map((status) => `.chk-dot-${status} { background: ${STATUS_STYLES[status].strokeColor}; }`)
  .join("\n");

/**
 * Everything generic now comes from src/ui, so this panel and the house-number one are the
 * same panel with two prefixes. What stays below is what only a list of street-name issues
 * needs: the groups and rows, the floating window, the canton badge, the geo links.
 */
const CSS = `
${tokenRules("chk", [".chk-pane", ".chk-helper", ".chk-window"])}
${componentRules("chk")}
${statusDotRules}

/* The checker-specific rules go here, copied from the current file byte for byte.
   The two lists below say exactly which ones move and which ones go. */
`;

export function injectStyles(): void {
  injectStyleOnce("street-name-checker", CSS);
}
```

Move across **unchanged**, from the current file: `.chk-toolbar`, `.chk-unsaved`, `.chk-list`, `.chk-groups`, `.chk-group*`, `.chk-rows`, `.chk-row*`, `.chk-arrow`, `.chk-suggestion`, `.chk-note`, `.chk-canton-*`, `.chk-count`, `.chk-fix-all`, `.chk-ignore`, `.chk-locate`, `.chk-geolink`, `.chk-empty`, `.chk-error`, `.chk-footer`, `.chk-helper*`, `.chk-window*`, `.chk-settings-grid`, `.chk-settings-row`, `.chk-status`, `.chk-status-code`.

Delete outright, now provided by `componentRules("chk")`: `.chk-pane`, `.chk-pane button`, focus-visible, `.chk-pane label`, `.chk-pane select/input`, `.chk-brand*`, `.chk-btn`, `.chk-banner*`, `.chk-warn`, `.chk-master`, `.chk-switch*`, `.chk-section*`, `.chk-subsection*`, `.chk-muted`, `.chk-busy*`, `.chk-spinner`, `@keyframes chk-spin`.

- [ ] **Step 6: Apply the five renames in the TypeScript**

| Old | New | Where |
| --- | --- | --- |
| `chk-chips` | `chk-pills` | `tab.ts` `buildSkeleton` |
| `chk-chip`, `chk-chip-active` | `chk-pill`, `chk-pill-active` | `tab.ts` `renderChips` |
| `chk-badge`, `chk-badge-<status>` | `chk-dot`, `chk-dot-<status>` | `tab.ts` `renderGroup` |
| `chk-group-toggle`, `chk-row-select` | `chk-plain` | `tab.ts` `renderGroup`, `renderRow` |
| `chk-banner chk-error` | `chk-banner chk-banner-error` | `tab.ts` `render` |

Then confirm nothing was missed:

```bash
grep -rn "chk-chip\|chk-badge\|chk-group-toggle\|chk-row-select" src/ && echo "MISSED" || echo "clean"
```

Expected: `clean`.

- [ ] **Step 7: Confirm the stylesheet actually shrank**

```bash
wc -l src/street-name-checker/ui/styles.ts
```

Expected: well under the 218 lines it started at (the generic half is gone).

- [ ] **Step 8: Run the full verification loop**

```bash
npx tsc --noEmit && npx vitest run src/ui src/street-name-checker src/house-number-importer && npx eslint src/ui src/street-name-checker src/house-number-importer && npx rollup -c
```

- [ ] **Step 9: Manual smoke test in WME**

Load the built userscript, open the checker tab, and check in **both the light and the dark skin**: the switch animates, a pill highlights when used as a filter, the sections fold, the busy veil appears on a rescan, the floating window still detaches and docks.

- [ ] **Step 10: Commit**

```bash
git add src/ui/components.ts src/ui/components.test.ts src/street-name-checker/ui
git commit -m "refactor(street-name-checker): adopt the shared component stylesheet" \
  -m "components.ts was extracted from this very stylesheet and then only the
house-number importer adopted it, so the two panels had been drifting apart ever
since. The checker now generates its generic half from componentRules('chk') and
keeps only what a list of street-name issues actually needs.

Five class names align on the shared vocabulary: chips become pills, badge becomes
dot, the two ad-hoc button resets become plain, and the error banner takes the
banner-error name the importer already used.

componentRules gains the pill's active state and the busy veil; the spinner
keyframes are prefixed, or two panels in one document would share one animation."
```

---

## Task 5: Typography

**Files:**
- Modify: `src/ui/tokens.ts`
- Modify: `src/ui/components.ts`
- Test: `src/ui/tokens.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `--<p>-font` token, declared on every panel scope.

- [ ] **Step 1: Write the failing test**

Add to `src/ui/tokens.test.ts`, inside the existing `describe("tokenRules")`:

```ts
/**
 * WME's own font is `Rubik, Waze Boing, sans-serif`, loaded by WME from Google Fonts.
 * Inheriting rather than naming it keeps the panels aligned with the editor even if Waze
 * changes it, and costs no request. Declaring the token makes that inheritance a decision
 * rather than an accident.
 */
it("inherits the editor's font instead of naming one", () => {
  expect(css).toContain("  --chk-font: inherit;");
});

it("does not load a font of its own", () => {
  expect(css).not.toContain("@import");
  expect(css).not.toContain("fonts.googleapis.com");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/ui/tokens.test.ts`
Expected: FAIL — `--chk-font` is absent.

- [ ] **Step 3: Add the token**

In `src/ui/tokens.ts`, add to `LIGHT` (and **not** to `DARK`, which only overrides what differs):

```ts
  font: "inherit",
```

- [ ] **Step 4: Apply it and set the scale**

In `src/ui/components.ts`, the pane rule becomes:

```
.${p}-pane { font-family: var(--${p}-font); font-size: 12px; padding: 8px; display: flex; flex-direction: column; gap: 10px; color: var(--${p}-text); }
```

Align the type scale on four sizes and three weights, replacing the ad-hoc values:

| Role | Rule | Value |
| --- | --- | --- |
| Panel title | `.${p}-brand-title` | `14px / 700` |
| Section title, street name | `.${p}-section > summary`, `.hn-street` | `13px / 600` |
| Body | `.${p}-pane` | `12px / 400` |
| Secondary, counters, notes | `.${p}-pill`, `.${p}-warn`, `.${p}-btn` | `11px / 400`, counters `600` |

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/ui`
Expected: PASS.

- [ ] **Step 6: Run the full verification loop**

```bash
npx tsc --noEmit && npx vitest run src/ui src/street-name-checker src/house-number-importer && npx eslint src/ui src/street-name-checker src/house-number-importer && npx rollup -c
```

- [ ] **Step 7: Commit**

```bash
git add src/ui
git commit -m "style(ui): inherit the editor's typeface, discipline the type scale" \
  -m "WME declares 'Rubik, Waze Boing, sans-serif' and loads Rubik itself. Inheriting
keeps our panels aligned with the editor for free and follows Waze if they change
it. WME's CSP would in fact allow us to load a font of our own; not doing so is a
design decision, recorded here so it is not reopened by accident.

Four sizes and three weights replace the values that had accumulated per panel."
```

---

## Task 6: Waze icons in place of emoji

**Files:**
- Modify: `src/street-name-checker/ui/tab.ts`, `ui/settings-panel.ts`, `ui/edit-panel.ts`, `ui/floating-window.ts`, `ui/format.ts`
- Modify: `src/house-number-importer/ui/tab.ts`, `ui/edit-panel.ts`
- Modify: `src/street-name-checker/ui/styles.ts` (the `::after` chevrons)

**Interfaces:**
- Consumes: `icon()` from `src/ui/dom.ts` (Task 1).
- Produces: `statusEmoji()` is deleted from the checker's `ui/format.ts`; nothing replaces it — the status dot and the label already carry the meaning.

Icon names, all verified present in the live font (v19.2.6, a strict superset of v16.11.1):

| Today | Icon | Where |
| --- | --- | --- |
| `🛣️` | `road` | checker brand, edit-panel head, floating-window title |
| `🏠` | `home` | importer brand, edit-panel head, import button |
| `⚙️` | `settings` | both Settings sections |
| `🎨` | `layers` | legend sections (until Tasks 8 and 9 remove them) |
| `⚠️` | `warning` | data warnings |
| `✓` | `checkmark` | the importer's name verdict |
| `📍` | `location` | the checker's locate control, edit-panel host header |
| `↗` | `external-link` | the geo.admin.ch link |
| `▸` in CSS | `chevron-right` / `chevron-down` | section markers |

- [ ] **Step 1: Ban emoji with a lint rule, not a test**

> **Correction made during execution.** The plan asked for a vitest case reading each source
> file with `node:fs`. The repo has no `@types/node`, so `tsc --noEmit` rejects the import
> even though vitest runs it happily — the failure only shows up in the verification loop.
> Adding `@types/node` is a dependency decision, and a hardcoded list of files to scan rots.
> An ESLint rule is the right tool: it covers every file in the two directories, including
> ones nobody has written yet, and it already runs in the loop.

Append to `eslint.config.mjs`, after `tseslint.configs.recommended`, a config block scoped
to `src/street-name-checker/**/*.ts` and `src/house-number-importer/**/*.ts` (tests
excluded) that sets `no-restricted-syntax` against two selectors:

```js
"Literal[value=/[\\u{1F300}-\\u{1FAFF}\\u{2600}-\\u{27BF}]/u]"
"TemplateElement[value.raw=/[\\u{1F300}-\\u{1FAFF}\\u{2600}-\\u{27BF}]/u]"
```

with the message `No emoji in the interface: use icon("name") from src/ui/dom.ts (Waze icon
font).` Do not put `\u{FE0F}` in the class: it is a combining variation selector and
`no-misleading-character-class` rejects it. Banning the base pictographs is enough.

- [ ] **Step 2: Prove the rule fires**

Plant `const CANARY = "🏠 test";` in `src/house-number-importer/ui/tab.ts`, run
`npx eslint src/house-number-importer/ui/tab.ts`, confirm the error, then remove it. A lint
rule that never fires is worse than none: it reads as protection that is not there.

- [ ] **Step 3: Replace the emoji**

Pattern, in `tab.ts`:

```ts
// before
brand.append(el("span", "chk-brand-icon", "🛣️"), el("span", "chk-brand-title", t("appName")));
// after
brand.append(icon("road", "chk-brand-icon"), el("span", "chk-brand-title", t("appName")));
```

In the checker's `ui/edit-panel.ts`, the head builds its title with a template string:

```ts
// before
title.textContent = `🛣️ ${t("appName")}`;
// after
title.textContent = t("appName");
head.prepend(icon("road", "chk-section-icon"));
```

In `ui/floating-window.ts`:

```ts
// before
const title = el("span", "chk-window-title", `🛣️ ${t("appName")}`);
// after
const title = el("span", "chk-window-title");
title.append(icon("road"), el("span", "", t("appName")));
```

The **"Ancrer" button keeps its spelled-out label** — the code says why, and the reason still holds: it is the only control the window carries and the way back to the sidebar. Add an icon beside it, never instead of it:

```ts
const dockBtn = button(t("dock"), () => this.callbacks.onDock(), "chk-window-btn");
dockBtn.prepend(icon("undo"));
dockBtn.title = t("dockTitle");
```

- [ ] **Step 4: Delete `statusEmoji`**

Remove `statusEmoji` from `src/street-name-checker/ui/format.ts` and its use in `ui/edit-panel.ts`:

```ts
// before
const emoji = statusEmoji(issue.status);
statusText.textContent = emoji ? `${emoji} ${issue.status}` : issue.status;
// after — the dot beside it is already the status; Task 7 replaces the enum with a label
statusText.textContent = issue.status;
```

- [ ] **Step 5: Replace the CSS chevrons**

In `src/ui/components.ts`, the section marker currently uses `content: "▸"` rotated by 90°. Swap it for the font, which has both directions:

```
.${p}-section > summary::after { content: "\\ea37"; font-family: "waze-web-icons"; margin-left: auto; color: var(--${p}-muted); font-size: 11px; }
.${p}-section[open] > summary::after { content: "\\ea35"; }
```

`\ea37` is `chevron-right`, `\ea35` is `chevron-down`. Apply the same to `.${p}-subsection`. Drop the `transition: transform` that rotated the old glyph.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run src/street-name-checker src/house-number-importer`
Expected: PASS.

- [ ] **Step 7: Run the full verification loop**

```bash
npx tsc --noEmit && npx vitest run src/ui src/street-name-checker src/house-number-importer && npx eslint src/ui src/street-name-checker src/house-number-importer && npx rollup -c
```

- [ ] **Step 8: Manual smoke test in WME**

Every icon draws. Check the dark skin especially: this is what emoji could not follow. Then, in the browser devtools, disable the `waze-web-icons` stylesheet and reload — every label must stay readable, with a gap where the icon was. That is the degradation contract.

- [ ] **Step 9: Commit**

```bash
git add -A src
git commit -m "style(ui): use the Waze icon font instead of emoji" \
  -m "Emoji render at a size and weight the OS decides, ignore the dark skin, and
differ between platforms. WME already loads waze-web-icons.css, so a class is all
it takes — reloadButton.ts and sidebar.ts have been doing this for a while.

The version is deliberately not pinned: the stylesheet declares its font files with
relative URLs, so a link of our own would resolve them against waze.com/editor.
Every icon is decorative and aria-hidden, beside text that already says it, so a
missing font degrades to a gap.

The floating window's Ancrer button keeps its spelled-out label; the icon only
accompanies it."
```

---

## Task 7: Readable status labels

**Files:**
- Modify: `src/street-name-checker/ui/format.ts`
- Modify: `locales/{en,fr,de,it}/common.json`
- Modify: `src/street-name-checker/ui/tab.ts`, `ui/edit-panel.ts`
- Test: `src/street-name-checker/ui/format.test.ts` (new file)

**Interfaces:**
- Consumes: `LEGEND_KEYS` (existing).
- Produces: `export const LABEL_KEYS: Record<IssueStatus, StringKey>` and `export function statusLabel(status: IssueStatus): string` in `src/street-name-checker/ui/format.ts`.

Today `renderChips` builds `chip.append(dot, \`${status} ${count}\`)`, which puts `WRONG_STREET 3` in front of a first-day editor. The enum leaves the interface for good.

- [ ] **Step 1: Write the failing test**

`src/street-name-checker/ui/format.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { STATUS_STYLES } from "../map-layer";
import type { IssueStatus } from "../matching/evaluate";
import { LABEL_KEYS, statusLabel } from "./format";
import { setLocale } from "../i18n";

const STATUSES = Object.keys(STATUS_STYLES) as IssueStatus[];

describe("statusLabel", () => {
  it("covers every status the map can draw", () => {
    expect(Object.keys(LABEL_KEYS).sort()).toEqual([...STATUSES].sort());
  });

  it.each(["en", "fr", "de", "it"])("is translated in %s", (locale) => {
    setLocale(locale);
    for (const status of STATUSES) {
      const label = statusLabel(status);
      expect(label, `${status} in ${locale}`).not.toBe("");
      // A missing key makes i18next echo the key back.
      expect(label, `${status} in ${locale}`).not.toContain("label");
      expect(label, `${status} in ${locale}`).not.toBe(status);
    }
    setLocale("en");
  });

  it("stays short enough for a pill", () => {
    setLocale("fr");
    for (const status of STATUSES) {
      expect(statusLabel(status).length, status).toBeLessThanOrEqual(24);
    }
    setLocale("en");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/street-name-checker/ui/format.test.ts`
Expected: FAIL — `LABEL_KEYS` is not exported.

- [ ] **Step 3: Add the map and the accessor**

In `src/street-name-checker/ui/format.ts`, beside `LEGEND_KEYS`:

```ts
/**
 * Short label per status, for the filter pills and the group headers.
 *
 * The enum name used to be shown directly, which read as debug output. LEGEND_KEYS keeps
 * the long explanation; it is now shown inside the group it concerns, where it is read at
 * the moment it is useful, instead of in a legend block nobody opens.
 */
export const LABEL_KEYS: Record<IssueStatus, StringKey> = {
  COSMETIC: "labelCOSMETIC",
  VARIANT: "labelVARIANT",
  NEAR: "labelNEAR",
  WRONG_TYPE: "labelWRONG_TYPE",
  BILINGUAL: "labelBILINGUAL",
  WRONG_STREET: "labelWRONG_STREET",
  WRONG_CITY: "labelWRONG_CITY",
  NOT_FOUND: "labelNOT_FOUND",
  UNNAMED: "labelUNNAMED",
  UNNAMED_NO_MATCH: "labelUNNAMED_NO_MATCH",
  UNDER_LOCK: "labelUNDER_LOCK",
  OVER_LOCK: "labelOVER_LOCK",
  MICRO_SEGMENT: "labelMICRO_SEGMENT",
  LOOP: "labelLOOP",
  NARROW_MISUSE: "labelNARROW_MISUSE",
};

export function statusLabel(status: IssueStatus): string {
  return t(LABEL_KEYS[status]);
}
```

- [ ] **Step 4: Add the strings, four languages**

Under `streetCheck` in each `locales/<lang>/common.json`:

| key | en | fr | de | it |
| --- | --- | --- | --- | --- |
| `labelCOSMETIC` | Typography | Typographie | Typografie | Tipografia |
| `labelVARIANT` | Spelling | Orthographe | Schreibweise | Ortografia |
| `labelNEAR` | Likely typo | Faute probable | Vermutl. Tippfehler | Probabile refuso |
| `labelWRONG_TYPE` | Road type | Type de voie | Strassentyp | Tipo di strada |
| `labelBILINGUAL` | Bilingual | Bilingue | Zweisprachig | Bilingue |
| `labelWRONG_STREET` | Other street | Autre rue | Andere Strasse | Altra via |
| `labelWRONG_CITY` | Other locality | Autre localité | Anderer Ort | Altra località |
| `labelNOT_FOUND` | Not found | Introuvable | Nicht gefunden | Non trovata |
| `labelUNNAMED` | Unnamed | Sans nom | Ohne Namen | Senza nome |
| `labelUNNAMED_NO_MATCH` | Unnamed, no match | Sans nom, sans corr. | Ohne Namen, kein Treffer | Senza nome, nessuna corr. |
| `labelUNDER_LOCK` | Lock too low | Verrou trop bas | Sperre zu niedrig | Blocco troppo basso |
| `labelOVER_LOCK` | Lock too high | Verrou trop haut | Sperre zu hoch | Blocco troppo alto |
| `labelMICRO_SEGMENT` | Micro-segment | Micro-segment | Mikrosegment | Micro-segmento |
| `labelLOOP` | Loop | Boucle | Schleife | Anello |
| `labelNARROW_MISUSE` | Narrow street | Rue étroite | Enge Strasse | Via stretta |

German uses `ss` rather than `ß`, matching the Swiss convention already used in the existing German strings — check one before writing and follow what is there.

- [ ] **Step 5: Replace the enum at all three call sites**

`tab.ts`, `renderChips`:

```ts
// before
chip.append(dot, `${status} ${count}`);
// after
chip.append(dot, el("span", "", statusLabel(status)), el("span", "chk-pill-value", String(count)));
```

`tab.ts`, `renderGroup`: the `.chk-status-code` span takes `statusLabel(group.status)` in place of `group.status`.

`edit-panel.ts`: `statusText.textContent = statusLabel(issue.status);`

Then confirm the enum is gone from the interface:

```bash
grep -rn 'textContent = issue.status\|`${status} \|${group.status}`' src/street-name-checker/ui/ && echo "MISSED" || echo "clean"
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/street-name-checker`
Expected: PASS, including the 6 new label tests.

- [ ] **Step 7: Extract the keys**

```bash
npm run makemessages
git diff --stat locales/
```

Expected: no key removed. If `makemessages` prunes something, stop and report rather than committing the loss.

- [ ] **Step 8: Run the full verification loop**

```bash
npx tsc --noEmit && npx vitest run src/ui src/street-name-checker src/house-number-importer && npx eslint src/ui src/street-name-checker src/house-number-importer && npx rollup -c
```

- [ ] **Step 9: Commit**

```bash
git add src/street-name-checker/ui locales
git commit -m "feat(street-name-checker): name the statuses in the interface" \
  -m "The filter pills showed the raw enum — WRONG_STREET 3 — and so did the group
headers and the edit-panel box. The legend block existed largely to translate
those names back into something an editor could read.

LABEL_KEYS adds a short label per status in the four languages. LEGEND_KEYS keeps
the long explanation, which the next commit moves into the group it concerns."
```

---

## Task 8: Flatten the checker's tab

**Files:**
- Modify: `src/street-name-checker/ui/tab.ts` (`buildSkeleton`, `buildMasterToggles`, `renderGroup`, `buildLegend` removed, `buildFooter` folded)
- Modify: `src/street-name-checker/ui/settings-panel.ts`
- Modify: `locales/{en,fr,de,it}/common.json`

**Interfaces:**
- Consumes: `statusLabel`, `LEGEND_KEYS` (Task 7); `buildSection` (Task 1).
- Produces: nothing consumed by later tasks.

Nine top-level blocks become six. **No setting is removed** — only the level at which it sits changes.

- [ ] **Step 1: Redistribute the master-toggle row**

`buildMasterToggles` currently holds four things. They move:

| Content | Destination |
| --- | --- |
| "Enabled" | the brand line, pushed right with `margin-left: auto` |
| "Auto scan" | inside the merged Settings section |
| "Viewport only" | **removed here**; the identical instance in Settings stays |
| "Detach" button | the toolbar, beside Rescan and Next issue |

`buildMasterToggles` disappears. Keep assigning `this.enabledInput` where the toggle is now built, or `syncEnabledToggle` silently stops working — the layer checkbox and the keyboard shortcut both depend on it.

Removing the duplicate leaves exactly one viewport-only instance, which makes the `viewportInputs` mirror moot. Delete `viewportInputs` and the loop inside `viewportOnlyToggle`, keeping the `settings.update` and the re-render.

> **Correction made during execution.** The plan turned `warnLine` into a face of the status
> line. It cannot be one: it carries data-quality caveats (truncated tiles, failed tiles,
> lookup cap) that appear **alongside** the "done" state, not instead of it, so merging the
> two would drop one of the two messages. It stays its own element, `hidden` while empty,
> which costs no height in the common case. The house-number tab already works this way,
> so keeping it also keeps the two panels identical.

- [ ] **Step 2: Turn the banner into a status line**

The banner keeps its element and its action button, but its default face is now quiet. In `render`, it takes `chk-banner-ok` on a complete pass and `chk-banner-error` on an error; otherwise it stays neutral. Fold `warnLine` in as a third face rather than a block of its own, matching what the importer already does.

- [ ] **Step 3: Move the explanation into the group**

In `renderGroup`, under the names line:

```ts
const detail = el("div", "chk-note", t(LEGEND_KEYS[group.status]));
header.appendChild(detail);
```

Then delete `buildLegend` entirely.

- [ ] **Step 4: Merge the footer into the settings section**

`buildFooter` returns its content as the last child of the merged section instead of a top-level block. Retitle the section with a new key `streetCheck.settingsAndHelp`:

| en | fr | de | it |
| --- | --- | --- | --- |
| Settings and help | Réglages et aide | Einstellungen und Hilfe | Impostazioni e aiuto |

- [ ] **Step 5: Rewrite `buildSkeleton` to six blocks**

Docked order: brand+switch, toolbar, status line, pills, list, settings section.
Detached order is unchanged in principle: the window takes toolbar, status line, pills and list; the sidebar keeps the settings section. Keep the comment explaining why the brand block is absent from the window.

- [ ] **Step 6: Write the guard test**

Add to `src/street-name-checker/ui/tab.test.ts`:

```ts
/**
 * The point of the flattening is that no setting was dropped on the way. This asserts the
 * inventory of controls, not their position.
 */
describe("tab inventory", () => {
  const source = readFileSync("src/street-name-checker/ui/tab.ts", "utf8");
  const settings = readFileSync("src/street-name-checker/ui/settings-panel.ts", "utf8");
  const both = source + settings;

  it.each([
    "toggleEnabled",
    "toggleAutoScan",
    "viewportOnly",
    "detach",
    "rescan",
    "nextIssue",
  ])("still offers %s somewhere in the tab", (key) => {
    expect(both).toContain(`"${key}"`);
  });

  it("no longer builds a legend block: the explanation sits in the group", () => {
    expect(source).not.toContain("buildLegend");
    expect(source).toContain("LEGEND_KEYS[group.status]");
  });

  it("builds the viewport-only toggle exactly once", () => {
    expect(both.match(/t\("viewportOnly"\)/g)).toHaveLength(1);
  });
});
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run src/street-name-checker`
Expected: PASS.

- [ ] **Step 8: Run the full verification loop**

```bash
npx tsc --noEmit && npx vitest run src/ui src/street-name-checker src/house-number-importer && npx eslint src/ui src/street-name-checker src/house-number-importer && npx rollup -c
```

- [ ] **Step 9: Manual smoke test in WME**

Toggle Enabled from the brand line **and** from the layer checkbox, and check the two stay in step — that is `syncEnabledToggle`, the thing most at risk in this task. Then: auto-scan still triggers, viewport-only still filters, Detach still detaches, the group now shows its explanation, and no setting has gone missing.

- [ ] **Step 10: Commit**

```bash
git add src/street-name-checker/ui locales
git commit -m "refactor(street-name-checker): flatten the tab to six blocks" \
  -m "Nine top-level blocks competed for the top of the panel and pushed the issue
list below the fold. The master switch joins the title line, the status banner
becomes a quiet line that only takes colour when it means something, Detach moves
to the toolbar where the other actions are, and legend, settings and footer merge
into one collapsible.

The legend block is gone: each group now carries its own explanation, read at the
moment it is useful. No setting was removed.

Viewport-only was built twice and mirrored by hand through viewportInputs; with a
single instance left the mirror goes too."
```

---

## Task 9: Flatten the importer's tab

**Files:**
- Modify: `src/house-number-importer/ui/tab.ts`
- Modify: `locales/{en,fr,de,it}/common.json`

**Interfaces:**
- Consumes: `buildSection` (Task 1).
- Produces: nothing.

Ten top-level blocks become five, in the same order as the checker's, so the two tabs read as one product.

- [ ] **Step 1: Redistribute**

| Today | Destination |
| --- | --- |
| brand | keeps the line, gains the master switch on the right |
| `tabNote` | folded into the status line, which always has something to say |
| banner | becomes the status line |
| master | merged into the brand line |
| warning | a face of the status line, not a block |
| selection | unchanged — it is the work |
| action | unchanged |
| secondary actions | inside the merged section |
| settings | the merged section |
| legend | **deleted** |

- [ ] **Step 2: Delete the legend section**

`legendSection()` renders `dot + t(LEGEND_KEYS[status])` for each status; the pills in `renderSelection` render `dot + count + t(LEGEND_KEYS[status])` for the counted ones. It is the same information plus a counter. Delete `legendSection` and add one line inside the merged section explaining the statuses that are absent from the current selection, under a new key `houseNumbers.legendNote`:

| en | fr | de | it |
| --- | --- | --- | --- |
| Statuses absent from the selection are not listed above. | Les statuts absents de la sélection ne sont pas listés ci-dessus. | Nicht in der Auswahl vorhandene Status werden oben nicht aufgeführt. | Gli stati assenti dalla selezione non sono elencati sopra. |

Retitle the settings section with `houseNumbers.settingsAndHelp`, same four translations as Task 8's key.

- [ ] **Step 3: Write the guard test**

`src/house-number-importer/ui/tab.test.ts` (new file):

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/house-number-importer/ui/tab.ts", "utf8");

describe("tab inventory", () => {
  it.each([
    "settingsMinZoom",
    "settingsShowLabels",
    "settingsStrictMatch",
    "settingsExistingOnly",
    "settingsConfirmSingle",
    "settingsLanguage",
    "btnRefreshExisting",
    "btnClearCache",
    "enable",
  ])("still offers %s", (key) => {
    expect(source).toContain(`"${key}"`);
  });

  it("no longer builds a legend section: the pills already carry it", () => {
    expect(source).not.toContain("legendSection");
  });

  /** Mirrors the checker's tab, so the two panels read as one product. */
  it("keeps the master switch on the brand line", () => {
    expect(source).toMatch(/hn-brand[\s\S]{0,400}toggleSwitch\("hn", t\("enable"\)/);
  });
});
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/house-number-importer`
Expected: PASS.

- [ ] **Step 5: Run the full verification loop**

```bash
npx tsc --noEmit && npx vitest run src/ui src/street-name-checker src/house-number-importer && npx eslint src/ui src/street-name-checker src/house-number-importer && npx rollup -c
```

- [ ] **Step 6: Manual smoke test in WME**

Select a segment: the street, the verdict and the pills appear. Toggle Enabled from the brand line and from the layer checkbox — `syncEnabledToggle` again. Change the language: the tab rebuilds fully, which is the one case that does a full rebuild. Every setting is still reachable.

- [ ] **Step 7: Commit**

```bash
git add src/house-number-importer/ui locales
git commit -m "refactor(house-number-importer): flatten the tab to five blocks" \
  -m "Same treatment as the checker's tab, block for block, so the two panels read
as one product: master switch on the title line, one status line carrying the
hint and the data warning, secondary actions and settings in one collapsible.

The legend section is gone. It rendered dot plus label for each status while the
pills already render dot plus count plus the same label, from the same
LEGEND_KEYS. A line in the collapsible covers the statuses absent from the
selection."
```

---

## Task 10: One host for the segment edit panel

**Files:**
- Create: `src/ui/edit-panel-host.ts`
- Test: `src/ui/edit-panel-host.test.ts`
- Modify: `src/street-name-checker/ui/edit-panel.ts`, `src/house-number-importer/ui/edit-panel.ts`
- Modify: `src/street-name-checker/ui/styles.ts`, `src/house-number-importer/ui/styles.ts`
- Modify: `CLAUDE.md`
- Modify: `locales/{en,fr,de,it}/common.json`

**Interfaces:**
- Consumes: `el`, `icon` from `src/ui/dom.ts` (Task 1).
- Produces:
  ```ts
  export interface EditPanelSlot {
    id: string;
    rank: number;
    render: (context: { siblings: readonly string[] }) => HTMLElement | null;
  }
  export function orderedSlots(slots: readonly EditPanelSlot[]): EditPanelSlot[]
  export function registerEditPanelSlot(slot: EditPanelSlot): void
  export function refreshEditPanelHost(): void
  ```

Today both features call `panel.prepend()` with their own retry schedules — `[0, 250, 750]` ms and `[0, 120, 400, 900]` ms — so **the order of the two boxes depends on which one wins the race** and can flip between selections. The importer also asks `getElementById("chk-edit-helper")` to decide whether to show its name verdict: a negotiation between two features through the DOM.

- [ ] **Step 1: Write the failing test**

`src/ui/edit-panel-host.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { orderedSlots, type EditPanelSlot } from "./edit-panel-host";

function slot(id: string, rank: number): EditPanelSlot {
  return { id, rank, render: () => null };
}

describe("orderedSlots", () => {
  /**
   * The bug this module exists for: both features used prepend() with different retry
   * schedules, so the two boxes could swap places between one selection and the next.
   */
  it("orders by rank, whatever the registration order", () => {
    const a = slot("house-numbers", 20);
    const b = slot("street-name", 10);
    expect(orderedSlots([a, b]).map((s) => s.id)).toEqual(["street-name", "house-numbers"]);
    expect(orderedSlots([b, a]).map((s) => s.id)).toEqual(["street-name", "house-numbers"]);
  });

  it("breaks an equal rank on id, so the order is still not a race", () => {
    const a = slot("bbb", 10);
    const b = slot("aaa", 10);
    expect(orderedSlots([a, b]).map((s) => s.id)).toEqual(["aaa", "bbb"]);
    expect(orderedSlots([b, a]).map((s) => s.id)).toEqual(["aaa", "bbb"]);
  });

  it("keeps a slot registered twice only once, the later registration winning", () => {
    const first = { ...slot("street-name", 10) };
    const second = { ...slot("street-name", 99) };
    const ordered = orderedSlots([first, second]);
    expect(ordered).toHaveLength(1);
    expect(ordered[0]?.rank).toBe(99);
  });
});

describe("slot context", () => {
  /**
   * Replaces the importer's getElementById("chk-edit-helper") probe: the host knows which
   * slots have something to say, so a feature never has to look for another's DOM.
   */
  it("tells each slot which siblings rendered something", () => {
    const seen: string[][] = [];
    const slots: EditPanelSlot[] = [
      { id: "street-name", rank: 10, render: () => ({}) as HTMLElement },
      {
        id: "house-numbers",
        rank: 20,
        render: (ctx) => {
          seen.push([...ctx.siblings]);
          return null;
        },
      },
    ];
    orderedSlots(slots).forEach((s) => s.render({ siblings: ["street-name"] }));
    expect(seen).toEqual([["street-name"]]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/ui/edit-panel-host.test.ts`
Expected: FAIL — `Failed to resolve import "./edit-panel-host"`.

- [ ] **Step 3: Write the module**

`src/ui/edit-panel-host.ts`. Keep the ordering pure and the mounting thin — that split is what makes it testable without a DOM:

```ts
import { el, icon } from "./dom";

/**
 * One box in WME's segment edit panel, shared by every feature that has something to say
 * about the selected segment.
 *
 * DELIBERATE deviation from CLAUDE.md's "no direct DOM hacks that bypass SDK events" — the
 * same one the checker already documented, not a new one. The SDK exposes no extension
 * point for the segment edit panel. This module *reduces* the deviation: two features used
 * to prepend a container each, with their own retry schedules, so their order depended on
 * which one won the race. There is now one mount point, one retry schedule, one guard.
 *
 * Containment is unchanged: the DOM is only a mount point. Selection, data and edits still
 * go through SDK events.
 */
export interface EditPanelSlot {
  /** Stable identity; a second registration under the same id replaces the first. */
  id: string;
  /** Display order. Lower comes first. Ties break on id, never on timing. */
  rank: number;
  /** Return null when there is nothing to say: the slot then leaves no trace. */
  render: (context: { siblings: readonly string[] }) => HTMLElement | null;
}

const CONTAINER_ID = "wmech-edit-panel-host";
const INJECT_RETRY_DELAYS_MS = [0, 120, 250, 400, 750, 900];

/** Pure: the ordering rule, which is the whole point of the module. */
export function orderedSlots(slots: readonly EditPanelSlot[]): EditPanelSlot[] {
  const byId = new Map<string, EditPanelSlot>();
  for (const slot of slots) byId.set(slot.id, slot);
  return [...byId.values()].sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id));
}

const registry: EditPanelSlot[] = [];
let retryTimers: Array<ReturnType<typeof setTimeout>> = [];
let warnedMissingPanel = false;

export function registerEditPanelSlot(slot: EditPanelSlot): void {
  registry.push(slot);
}

/**
 * Rebuild the host. Safe to call on every SDK event: WME rebuilds the edit panel
 * asynchronously after a selection, so the mount is retried over a window rather than
 * attempted once. One schedule for every feature, which is what makes the order stable.
 */
export function refreshEditPanelHost(): void {
  for (const timer of retryTimers) clearTimeout(timer);
  retryTimers = [];
  for (const delay of INJECT_RETRY_DELAYS_MS) {
    retryTimers.push(setTimeout(mount, delay));
  }
}

function mount(): void {
  const slots = orderedSlots(registry);

  // Render in order, telling each slot which of its siblings already had something to say.
  // This replaces the DOM probe a feature used to run to find another feature's box.
  const rendered: Array<{ id: string; node: HTMLElement }> = [];
  for (const slot of slots) {
    const node = slot.render({ siblings: rendered.map((r) => r.id) });
    if (node) rendered.push({ id: slot.id, node });
  }

  const existing = document.getElementById(CONTAINER_ID);
  if (rendered.length === 0) {
    existing?.remove();
    return;
  }

  const panel = document.querySelector("#edit-panel");
  if (!panel) {
    // Warned once: WME renaming the panel is a silent loss of the box, never a crash.
    if (!warnedMissingPanel) {
      warnedMissingPanel = true;
      console.warn(
        "[wme-ch] #edit-panel not found; the edit-panel box is unavailable in this WME version",
      );
    }
    return;
  }

  const host = existing ?? el("div", "wmech-edit-host");
  host.id = CONTAINER_ID;

  const head = el("div", "wmech-edit-host-head");
  head.append(icon("location"), el("span", "", hostTitle()));

  const body: HTMLElement[] = [head];
  for (const { node } of rendered) {
    const wrapper = el("div", "wmech-slot");
    wrapper.appendChild(node);
    body.push(wrapper);
  }
  host.replaceChildren(...body);

  if (!existing) panel.prepend(host);
}
```

Two details in that code deserve their reason spelled out.

**The title is injected, not imported.** Each feature owns a separate i18next instance —
that is one of the five deviations in `CLAUDE.md`, and importing a feature's `t` here would
quietly undo it. The host takes the resolved string instead:

```ts
let hostTitleText = "Switzerland";

/**
 * The header text, resolved by whichever feature registers first. The host has no i18next
 * instance of its own: the two features keep separate ones on purpose, because the
 * checker's language is a per-feature preference.
 */
export function setEditPanelHostTitle(title: string): void {
  hostTitleText = title;
}

function hostTitle(): string {
  return hostTitleText;
}
```

Add `setEditPanelHostTitle(title: string): void` to the Interfaces block above. The checker
calls it from `init()` with `t("editPanelHostTitle")`.

**`console.warn` rather than a `log`.** Both features have their own `log.ts`; a shared
module importing either would couple them. The `[wme-ch]` prefix keeps the message findable
in the console, which is all this one-shot warning needs.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/ui/edit-panel-host.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Add the header string**

`common:editPanelHostTitle` — en `Switzerland`, fr `Suisse`, de `Schweiz`, it `Svizzera`.

- [ ] **Step 6: Move both features onto the host**

Ranks: `street-name` = 10, `house-numbers` = 20 — the name comes before the numbers because a wrong name makes the numbers moot.

In each feature's `edit-panel.ts`: drop `CONTAINER_ID`, `INJECT_RETRY_DELAYS_MS`, `retryTimers`, `warnedMissingPanel`, the `#edit-panel` lookup and the `prepend`. `init()` registers a slot; what was `render(container, …)` becomes the slot's `render()`, returning a fragment or `null`.

In the importer, replace the DOM probe:

```ts
// before
if (!document.getElementById(CHECKER_BOX_ID) && snapshot.segmentId !== null) {
// after
if (!context.siblings.includes("street-name") && snapshot.segmentId !== null) {
```

Keep `isImportInFlight()` guarding the rebuild: rebuilding the box under a running batch is what that check prevents.

Both features drop the street name from their slot header — the WME field right below already carries it.

- [ ] **Step 7: Style the host**

Add to `src/ui/components.ts`, unprefixed since the host is shared:

```
.wmech-edit-host { margin: 8px; border: 1px solid var(--chk-border); border-radius: var(--chk-radius); background: var(--chk-surface); overflow: hidden; font-size: 12px; }
.wmech-edit-host-head { display: flex; align-items: center; gap: 6px; padding: 6px 10px; font-size: 10px; font-weight: 700; letter-spacing: .5px; text-transform: uppercase; color: var(--chk-muted); border-bottom: 1px solid var(--chk-border); }
.wmech-slot { padding: 8px 10px; display: flex; flex-direction: column; gap: 5px; }
.wmech-slot + .wmech-slot { border-top: 1px solid var(--chk-border); }
```

The host reads `--chk-*` because the checker's tokens are declared on `.chk-helper`; add `.wmech-edit-host` to the checker's `tokenRules` scope list so the tokens resolve there.

- [ ] **Step 8: Update `CLAUDE.md`**

In the deviations table, the two edit-panel rows become one:

> | DOM injection into the segment edit panel (`src/ui/edit-panel-host.ts`) | The SDK exposes no extension point there. **One** container is mounted, and each feature registers a slot with a declared rank; previously each feature prepended its own box, so their order depended on which retry won. The containment rule is unchanged, the DOM is only a mount point |

Adjust the surrounding prose in the checker and house-number sections that referred to two boxes.

- [ ] **Step 9: Run the full verification loop**

```bash
npx tsc --noEmit && npx vitest run src/ui src/street-name-checker src/house-number-importer && npx eslint src/ui src/street-name-checker src/house-number-importer && npx rollup -c
```

- [ ] **Step 10: Manual smoke test in WME**

The one that matters: select a segment that has **both** a name issue and missing numbers, then select ten different segments in a row. The name slot must come first **every single time** — that is the race this task exists to kill. Then check a segment with only a name issue (one slot, no separator), one with only numbers, and one with neither (the host disappears entirely). Fix and Import still work from inside the host.

- [ ] **Step 11: Commit**

```bash
git add src/ui CLAUDE.md src/street-name-checker/ui src/house-number-importer/ui locales
git commit -m "refactor(ui): one shared host for the segment edit panel" \
  -m "Both features prepended their own container into #edit-panel with different
retry schedules — [0, 250, 750] and [0, 120, 400, 900] ms — so which box came out
on top depended on which retry won, and could flip between selections. The
importer also probed for getElementById('chk-edit-helper') to decide whether to
show its name verdict: two features negotiating through the DOM.

There is now one container, one retry schedule, one missing-panel guard, and a
declared rank per slot. A slot that returns null leaves no trace, and the host
removes itself when every slot does.

This narrows the documented deviation rather than widening it: two mount points
become one. CLAUDE.md updated accordingly."
```

---

## Task 11: Changelog and delivery

**Files:**
- Modify: `README.md`
- Modify: `header.js` — **only if the user asks for a version bump.** Releasing is the maintainer's job.

- [ ] **Step 1: Add the changelog entry**

Only `README.md` is edited; the three other language READMEs are generated by `translate-readme.js`. Under a new `## [Unreleased]`, in `### Changed`:

```markdown
### Changed

- Street-name checker and house-number importer now share one visual language: the same
  panel structure, the same components, and the Waze editor's own icons and typeface.
- Both sidebar tabs were flattened, so the working area is visible without scrolling.
- Issue statuses are named in the interface instead of showing their internal code.
- The two boxes in the segment edit panel merged into one, in a stable order.
```

- [ ] **Step 2: Full verification**

```bash
npx tsc --noEmit
npx vitest run
npx eslint src/ui src/street-name-checker src/house-number-importer
npm run build
```

All four must pass. `npx vitest run` with no path, this time: the whole suite.

- [ ] **Step 3: Full manual smoke test**

Per `CLAUDE.md`'s pre-PR checklist, in **both the light and the dark skin**: load the built script, toggle every layer, verify the tiles draw. Then both tabs, the floating window detached and re-docked, the edit-panel host with one slot / two slots / none, a fix applied, an import run.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: changelog for the UI/UX harmonisation"
```

- [ ] **Step 5: Stop and hand back**

Report the branch, the commit list and the smoke-test results. **Do not push and do not open a PR** without the user's explicit go. When they give it:

```bash
git push -u origin refactor/ui-ux-improvements
gh pr create --repo Waze-Dev-CH/WME-Switzerland-Helper --base main \
  --title "refactor(ui): harmonise the checker and the house-number importer" \
  --body-file <file>
gh api --method POST repos/Waze-Dev-CH/WME-Switzerland-Helper/pulls/<n>/requested_reviewers \
  -f "reviewers[]=73VW"
```

No Claude reference anywhere in the PR body.

---

## Task dependency map

```
Task 1 (shared builders)
  ├── Task 2 (importer onto builders)
  └── Task 3 (checker onto builders)
        └── Task 4 (checker onto componentRules)
              ├── Task 5 (typography)
              └── Task 6 (icons)
                    └── Task 7 (status labels)
                          ├── Task 8 (checker tab)
                          └── Task 9 (importer tab)
                                └── Task 10 (edit-panel host)
                                      └── Task 11 (changelog, delivery)
```

Tasks 2 and 3 are independent of each other. Tasks 8 and 9 are independent of each other. Everything else is a chain.
