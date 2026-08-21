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
    const numbers = slot("house-numbers", 20);
    const names = slot("street-name", 10);
    expect(orderedSlots([numbers, names]).map((s) => s.id)).toEqual([
      "street-name",
      "house-numbers",
    ]);
    expect(orderedSlots([names, numbers]).map((s) => s.id)).toEqual([
      "street-name",
      "house-numbers",
    ]);
  });

  it("breaks an equal rank on id, so the order is still not a race", () => {
    const b = slot("bbb", 10);
    const a = slot("aaa", 10);
    expect(orderedSlots([b, a]).map((s) => s.id)).toEqual(["aaa", "bbb"]);
    expect(orderedSlots([a, b]).map((s) => s.id)).toEqual(["aaa", "bbb"]);
  });

  it("keeps a slot registered twice only once, the later registration winning", () => {
    const first = slot("street-name", 10);
    const second = slot("street-name", 99);
    const ordered = orderedSlots([first, second]);
    expect(ordered).toHaveLength(1);
    expect(ordered[0]?.rank).toBe(99);
  });

  it("returns an empty list for no slots, so the host has nothing to mount", () => {
    expect(orderedSlots([])).toEqual([]);
  });
});

describe("slot context", () => {
  /**
   * Replaces the importer's getElementById("chk-edit-helper") probe: the host knows which
   * slots have something to say, so a feature never has to go looking for another's DOM.
   */
  it("tells each slot which siblings already rendered something", () => {
    const seen: string[][] = [];
    const rendered: string[] = [];
    const slots: EditPanelSlot[] = [
      { id: "house-numbers", rank: 20, render: (ctx) => {
        seen.push([...ctx.siblings]);
        return null;
      } },
      { id: "street-name", rank: 10, render: () => ({}) as HTMLElement },
    ];

    // Mirrors mount(): render in order, and only a non-null result counts as a sibling.
    for (const s of orderedSlots(slots)) {
      const node = s.render({ siblings: [...rendered] });
      if (node) rendered.push(s.id);
    }

    expect(seen).toEqual([["street-name"]]);
  });

  it("does not list a sibling that stayed quiet", () => {
    const seen: string[][] = [];
    const rendered: string[] = [];
    const slots: EditPanelSlot[] = [
      { id: "street-name", rank: 10, render: () => null },
      { id: "house-numbers", rank: 20, render: (ctx) => {
        seen.push([...ctx.siblings]);
        return null;
      } },
    ];

    for (const s of orderedSlots(slots)) {
      const node = s.render({ siblings: [...rendered] });
      if (node) rendered.push(s.id);
    }

    expect(seen).toEqual([[]]);
  });
});
