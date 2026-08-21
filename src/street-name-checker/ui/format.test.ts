import { describe, expect, it } from "vitest";
import { STATUS_STYLES } from "../map-layer";
import type { IssueStatus } from "../matching/evaluate";
import { LABEL_KEYS, LEGEND_KEYS, statusLabel } from "./format";
import { setLocale, t, type LocaleCode } from "../i18n";

const STATUSES = Object.keys(STATUS_STYLES) as IssueStatus[];
/** Typed rather than string[], so a locale that stops being supported fails to compile. */
const LOCALES: LocaleCode[] = ["en", "fr", "de", "it"];

describe("statusLabel", () => {
  it("covers every status the map can draw", () => {
    expect(Object.keys(LABEL_KEYS).sort()).toEqual([...STATUSES].sort());
  });

  it.each(LOCALES)("is translated in %s", (locale) => {
    setLocale(locale);
    for (const status of STATUSES) {
      const label = statusLabel(status);
      expect(label, `${status} in ${locale}`).not.toBe("");
      // i18next echoes the key back when it is missing, which would read as "labelNEAR".
      expect(label, `${status} in ${locale}`).not.toBe(LABEL_KEYS[status]);
      // The enum name itself is exactly what this replaces.
      expect(label, `${status} in ${locale}`).not.toBe(status);
    }
    setLocale("en");
  });

  /** It has to fit a pill next to a dot and a counter, in a 310px sidebar. */
  it.each(LOCALES)("stays short enough for a pill in %s", (locale) => {
    setLocale(locale);
    for (const status of STATUSES) {
      expect(statusLabel(status).length, `${status} in ${locale}`).toBeLessThanOrEqual(24);
    }
    setLocale("en");
  });

  /**
   * The short label names the problem; the legend sentence explains it. Keeping both is
   * the whole point: the label goes in the pill, the explanation goes in the group it
   * concerns. If they were the same string one of the two would be pointless.
   */
  it.each(LOCALES)("is not merely the legend sentence in %s", (locale) => {
    setLocale(locale);
    for (const status of STATUSES) {
      expect(LABEL_KEYS[status]).not.toBe(LEGEND_KEYS[status]);
      expect(statusLabel(status).length, status).toBeLessThan(200);
    }
    setLocale("en");
  });
});

/**
 * Flattening the tab moved controls between blocks. The point of these is that nothing was
 * dropped on the way, and that the two features keep the same skeleton.
 *
 * They read the i18n bundle rather than the sources: no @types/node here, and a key that
 * disappears is the failure that actually matters.
 */
describe("flattened tab inventory", () => {
  it.each(LOCALES)("keeps every control's label in %s", (locale) => {
    setLocale(locale);
    for (const key of [
      "toggleEnabled",
      "toggleAutoScan",
      "viewportOnly",
      "detach",
      "rescan",
      "nextIssue",
      "settingsAndHelp",
    ] as const) {
      const text = t(key);
      expect(text, `${key} in ${locale}`).not.toBe(key);
      expect(text, `${key} in ${locale}`).not.toBe("");
    }
    setLocale("en");
  });

  it.each(LOCALES)("still explains every status, now inside its group, in %s", (locale) => {
    setLocale(locale);
    for (const status of STATUSES) {
      const explanation = t(LEGEND_KEYS[status]);
      expect(explanation, `${status} in ${locale}`).not.toBe(LEGEND_KEYS[status]);
      // The long form is what the group now shows; a short one would mean the legend was
      // lost rather than moved.
      expect(explanation.length, `${status} in ${locale}`).toBeGreaterThan(10);
    }
    setLocale("en");
  });
});
