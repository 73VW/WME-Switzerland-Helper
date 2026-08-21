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
   * The checker filters by status, so its pill is a control and needs a pressed state. The
   * importer only ever counts with it, which is why the rule was missing when this module
   * was extracted from the checker's stylesheet.
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

  /**
   * buildSubsection() is a shared builder, so its styling has to be shared too. Leaving
   * these rules behind in the checker's stylesheet would have silently unstyled the four
   * subsections of its Settings panel on the way over.
   */
  it("styles the subsections its own builder produces", () => {
    const css = componentRules("chk");
    expect(css).toContain(".chk-subsection {");
    expect(css).toContain(".chk-subsection-body {");
    expect(css).toContain(".chk-subsection > summary {");
  });

  /**
   * Reported from the field: the tab showed "Act" instead of "Activé". The brand row is a
   * flex line and the switch was the item that gave way when the sidebar ran out of room.
   */
  it("never lets the master switch be the item that shrinks", () => {
    const css = componentRules("chk");
    expect(css).toContain(".chk-brand-switch { margin-left: auto; flex-shrink: 0; }");
    expect(css).toContain(".chk-brand-switch .chk-switch-label { white-space: nowrap; }");
    // The row wraps rather than clipping, for the longer German titles.
    expect(css).toMatch(/\.chk-brand \{[^}]*flex-wrap: wrap/);
  });

  /** Two panels in one document must not share one animation or one class. */
  it("keeps two prefixes from colliding in the same document", () => {
    const both = componentRules("chk") + componentRules("hn");
    expect(both).toContain("@keyframes chk-spin");
    expect(both).toContain("@keyframes hn-spin");
    expect(both).toContain(".chk-pill-active {");
    expect(both).toContain(".hn-pill-active {");
  });
});
