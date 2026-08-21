import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installFakeDocument, type FakeNode } from "./fake-dom";
import { buildSection, buildSubsection, button, el, icon, numberInput, toggleSwitch } from "./dom";

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

  it("leaves the class and the text alone when not given", () => {
    const node = asFake(el("span"));
    expect(node.className).toBe("");
    expect(node.textContent).toBe("");
  });

  it("sets an empty text when asked, which is not the same as not asking", () => {
    // render() paths clear a line by passing ""; that must reach textContent.
    expect(asFake(el("span", "", "")).textContent).toBe("");
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

  it("is an <i>, so it carries no text of its own", () => {
    const node = asFake(icon("home"));
    expect(node.tagName).toBe("i");
    expect(node.textContent).toBe("");
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

  it("reflects the initial state onto the checkbox", () => {
    expect(asFake(toggleSwitch("chk", "x", true, () => {})).children[0]?.checked).toBe(true);
    expect(asFake(toggleSwitch("chk", "x", false, () => {})).children[0]?.checked).toBe(false);
  });

  it("reports the checkbox state on change, not the initial value", () => {
    const seen: boolean[] = [];
    const label = asFake(toggleSwitch("chk", "Activé", false, (v) => seen.push(v)));
    const input = label.children[0] as FakeNode;
    input.checked = true;
    input.dispatch("change");
    expect(seen).toEqual([true]);
  });

  it("sets the tooltip only when one is given", () => {
    expect(asFake(toggleSwitch("chk", "x", false, () => {}, "aide")).title).toBe("aide");
    expect(asFake(toggleSwitch("chk", "x", false, () => {})).title).toBe("");
  });
});

describe("numberInput", () => {
  it("clamps into the bounds and reflects the clamp back into the field", () => {
    const seen: number[] = [];
    const input = asFake(numberInput(16, (v) => seen.push(v), { min: 15, max: 22 }));
    input.value = "99";
    input.dispatch("change");
    expect(input.value).toBe("22");
    expect(seen).toEqual([22]);
  });

  it("clamps upward too", () => {
    const seen: number[] = [];
    const input = asFake(numberInput(16, (v) => seen.push(v), { min: 15, max: 22 }));
    input.value = "1";
    input.dispatch("change");
    expect(input.value).toBe("15");
    expect(seen).toEqual([15]);
  });

  it("falls back to the previous value when the field is emptied", () => {
    const seen: number[] = [];
    const input = asFake(numberInput(18, (v) => seen.push(v), { min: 15, max: 22 }));
    input.value = "";
    input.dispatch("change");
    expect(input.value).toBe("18");
    expect(seen).toEqual([18]);
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

  it("titles the summary with an icon and the text", () => {
    const details = asFake(buildSection("chk", "settings", "Réglages", []));
    const summary = details.children.find((c) => c.tagName === "summary");
    expect(summary?.children[0]?.className).toBe("w-icon w-icon-settings chk-section-icon");
    expect(summary?.children[1]?.textContent).toBe("Réglages");
  });
});

describe("buildSubsection", () => {
  it("is a separator rather than a second box, so it carries its own classes", () => {
    const details = asFake(buildSubsection("chk", "filter", "Statuts", [el("div")]));
    expect(details.className).toBe("chk-subsection");
    const body = details.children.find((c) => c.className === "chk-subsection-body");
    expect(body?.children).toHaveLength(1);
  });
});

describe("button", () => {
  it("is type=button, so it never submits a WME form it landed in", () => {
    expect(asFake(button("Corriger", () => {})).type).toBe("button");
  });

  it("calls back on click", () => {
    let clicks = 0;
    const node = asFake(button("Corriger", () => clicks++));
    node.dispatch("click");
    expect(clicks).toBe(1);
  });

  it("takes the caller's class, with no default of its own", () => {
    expect(asFake(button("x", () => {})).className).toBe("");
    expect(asFake(button("x", () => {}, "hn-btn")).className).toBe("hn-btn");
  });
});
