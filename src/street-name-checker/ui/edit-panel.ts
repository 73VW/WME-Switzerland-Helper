import type { WmeSDK } from "wme-sdk-typings";
import {
  canGroupFix,
  GROUP_FIX_CAP,
  ignoreIssue,
  ignoreIssues,
  isFixInFlight,
  LOCK_STATUSES,
  runFix,
  runFixGroup,
} from "../fix";
import { STATUS_STYLES } from "../map-layer";
import type { Issue } from "../matching/evaluate";
import type { Scanner } from "../scan";
import type { SettingsStore } from "../settings";
import { formatNote, LEGEND_KEYS, STATE_KEYS, statusLabel } from "./format";
import { cantonMapLink } from "./canton-link";
import { mapGeoAdminUrlForGeometry } from "../geoadmin/links";
import { getLocale, t } from "../i18n";
import { icon } from "../../ui/dom";
import {
  refreshEditPanelHost,
  registerEditPanelSlot,
  setEditPanelHostTitle,
} from "../../ui/edit-panel-host";

/**
 * Display rank inside the shared host. The street name comes first: a segment whose name
 * is wrong makes its house numbers moot.
 */
const SLOT_RANK = 10;

/** All issues sharing the reference issue's group (same status, name and suggestion). */
export function issuesInSameGroup(issues: ReadonlyMap<number, Issue>, ref: Issue): Issue[] {
  const key = (i: Issue): string => `${i.status}|${i.currentName ?? ""}|${i.suggestion ?? ""}`;
  const refKey = key(ref);
  return [...issues.values()].filter((i) => key(i) === refKey);
}

/**
 * Compact companion box at the top of the WME segment edit panel: shows the
 * scan verdict for the selected segment and offers Fix / Fix all shortcuts.
 * No search UI by design (removed in 0.4.1 after field feedback).
 */
export class EditPanelBox {

  constructor(
    private sdk: WmeSDK,
    private scanner: Scanner,
    private settings: SettingsStore,
  ) {}

  init(): void {
    // The host holds no i18next instance of its own; the first feature to register names it.
    setEditPanelHostTitle(t("editPanelHostTitle"));
    registerEditPanelSlot({ id: "street-name", rank: SLOT_RANK, render: () => this.render() });
    this.sdk.Events.on({ eventName: "wme-selection-changed", eventHandler: () => this.schedule() });
    this.sdk.Events.on({ eventName: "wme-after-edit", eventHandler: () => this.schedule() });
    this.scanner.onUpdate(() => this.schedule());
  }

  private selectedSegmentId(): number | null {
    try {
      const selection = this.sdk.Editing.getSelection();
      if (selection?.objectType === "segment" && selection.ids.length === 1) {
        return selection.ids[0] as number;
      }
    } catch {
      // no selection
    }
    return null;
  }

  private schedule(): void {
    // wme-after-edit fires per fixed segment; don't rebuild the box (and its
    // progress button) while a fix batch is running.
    if (isFixInFlight()) return;
    refreshEditPanelHost();
  }

  /** Returns null when there is nothing to say; the host then drops the slot entirely. */
  private render(): HTMLElement | null {
    const settings = this.settings.get();
    const segmentId = this.selectedSegmentId();
    if (!settings.editPanelHelper || !settings.enabled || this.scanner.paused) return null;
    if (segmentId === null) return null;

    const container = document.createElement("div");
    container.className = "chk-helper";
    const snapshot = this.scanner.getSnapshot();
    const issue = snapshot.issues.get(segmentId);

    const head = document.createElement("div");
    head.className = "chk-helper-head";
    const title = document.createElement("b");
    title.textContent = t("appName");
    const dot = document.createElement("span");
    dot.className = "chk-dot";
    const statusText = document.createElement("span");
    head.append(icon("road", "chk-section-icon"), title, dot, statusText);
    container.appendChild(head);

    if (!issue) {
      if (snapshot.state !== "done") {
        dot.style.background = "var(--chk-muted)";
        statusText.textContent = t(STATE_KEYS[snapshot.state]);
        statusText.className = "chk-muted";
      } else if (this.isCheckedAndNamed(segmentId)) {
        dot.style.background = "var(--chk-ok)";
        statusText.textContent = t("helperOk");
      } else {
        // Nothing meaningful to say (skipped type, uncovered area): stay out of the host.
        return null;
      }
      return container;
    }

    dot.style.background = STATUS_STYLES[issue.status].strokeColor;
    statusText.textContent = statusLabel(issue.status);
    const geoLink = document.createElement("a");
    geoLink.textContent = "↗";
    geoLink.className = "chk-geolink";
    geoLink.href = mapGeoAdminUrlForGeometry(issue.geometry, getLocale());
    geoLink.target = "_blank";
    geoLink.rel = "noopener";
    geoLink.title = t("geoAdminLinkTitle");
    geoLink.setAttribute("aria-label", t("geoAdminLinkTitle"));
    head.appendChild(geoLink);
    const cantonLink = cantonMapLink(issue.geometry, issue.cantonName);
    if (cantonLink) head.appendChild(cantonLink);

    const detail = document.createElement("div");
    detail.className = "chk-muted";
    detail.textContent = t(LEGEND_KEYS[issue.status]);
    container.appendChild(detail);

    if (issue.suggestion && issue.suggestion !== issue.currentName) {
      const line = document.createElement("div");
      line.className = "chk-helper-sug";
      const name = document.createElement("b");
      name.textContent = `→ ${issue.suggestion}`;
      line.appendChild(name);
      const noteText = formatNote(issue.note);
      if (noteText) {
        const note = document.createElement("span");
        note.className = "chk-note";
        note.textContent = ` (${noteText})`;
        line.appendChild(note);
      }
      container.appendChild(line);
    }

    const buttons = document.createElement("div");
    buttons.className = "chk-helper-sug";
    if (issue.fixable) {
      const fixBtn = document.createElement("button");
      fixBtn.className = "chk-fix-all";
      fixBtn.textContent = t("fix");
      fixBtn.title = LOCK_STATUSES.has(issue.status)
        ? t("fixLockTitle", { n: issue.note?.expectedLock ?? "" })
        : t("fixTitle", { name: issue.suggestion ?? "" });
      fixBtn.addEventListener("click", () => this.onFixOne(issue, fixBtn));
      buttons.appendChild(fixBtn);

      // Group actions are hidden below editor level 3, the same rule as the sidebar
      // list. Per-segment Fix above stays available to everyone.
      const group = issuesInSameGroup(snapshot.issues, issue);
      if (group.length > 1 && canGroupFix(this.sdk)) {
        const fixAllBtn = document.createElement("button");
        fixAllBtn.className = "chk-fix-all";
        fixAllBtn.textContent = t("fixAll", { n: Math.min(group.length, GROUP_FIX_CAP) });
        fixAllBtn.addEventListener("click", () => this.onFixGroup(issue, group, fixAllBtn));
        buttons.appendChild(fixAllBtn);
      }
    }
    // Dismiss a false positive (any status, fixable or not).
    const ignoreBtn = document.createElement("button");
    ignoreBtn.className = "chk-ignore";
    ignoreBtn.textContent = t("ignore");
    ignoreBtn.title = t("ignoreTitle");
    ignoreBtn.addEventListener("click", () => this.onIgnore(issue));
    buttons.appendChild(ignoreBtn);

    const ignoreGroup = issuesInSameGroup(snapshot.issues, issue);
    if (ignoreGroup.length > 1 && canGroupFix(this.sdk)) {
      const ignoreAllBtn = document.createElement("button");
      ignoreAllBtn.className = "chk-ignore";
      ignoreAllBtn.textContent = t("ignoreAll", { n: ignoreGroup.length });
      ignoreAllBtn.addEventListener("click", () => this.onIgnoreGroup(ignoreGroup));
      buttons.appendChild(ignoreAllBtn);
    }
    container.appendChild(buttons);
    return container;
  }

  private onIgnore(issue: Issue): void {
    ignoreIssue(this.settings, issue, () => {
      this.scanner.reevaluate();
      this.schedule();
    });
  }

  private onIgnoreGroup(group: Issue[]): void {
    void ignoreIssues(this.settings, group, () => {
      this.scanner.reevaluate();
      this.schedule();
    });
  }

  private isCheckedAndNamed(segmentId: number): boolean {
    try {
      const segment = this.sdk.DataModel.Segments.getById({ segmentId });
      if (!segment || !this.settings.get().checkedRoadTypes.includes(segment.roadType)) {
        return false;
      }
      const address = this.sdk.DataModel.Segments.getAddress({ segmentId });
      return Boolean(address.street?.name?.trim());
    } catch {
      return false;
    }
  }

  private onFixOne(issue: Issue, button?: HTMLButtonElement): void {
    void runFix(this.sdk, issue, this.settings.get(), {
      button,
      onComplete: () => {
        this.scanner.reevaluate();
        this.schedule();
      },
    });
  }

  private onFixGroup(issue: Issue, group: Issue[], button?: HTMLButtonElement): void {
    void runFixGroup(
      this.sdk,
      group,
      {
        status: issue.status,
        expectedLock: issue.note?.expectedLock,
        suggestion: issue.suggestion,
        currentName: issue.currentName,
      },
      this.settings.get(),
      {
        button,
        onComplete: () => {
          this.scanner.reevaluate();
          this.schedule();
        },
      },
    );
  }
}
