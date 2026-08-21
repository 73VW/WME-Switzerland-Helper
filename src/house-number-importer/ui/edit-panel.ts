import type { WmeSDK } from "wme-sdk-typings";
import type { Controller, Snapshot } from "../controller";
import { isImportInFlight } from "../import";
import type { SettingsStore } from "../settings";
import { button, el } from "../../ui/dom";
import { refreshEditPanelHost, registerEditPanelSlot } from "../../ui/edit-panel-host";
import { getStreetNameVerdict } from "../../street-check-bridge";
import {
  canBulkImport,
  countByStatus,
  dataWarning,
  formatCounts,
  formatImportButton,
  formatVerdict,
} from "./format";
import { injectStyles } from "./styles";

/**
 * Display rank inside the shared host. The street name comes first: a segment whose name
 * is wrong makes its numbers moot.
 */
const SLOT_RANK = 20;

/**
 * This feature's slot in the shared segment edit-panel host.
 *
 * This is where the bulk-import button has to live: the sidebar switches to WME's own
 * Selection panel the moment a segment is clicked, which is exactly when the editor wants
 * to import.
 *
 * The DOM deviation and its containment now live in `src/ui/edit-panel-host.ts`, which is
 * also the module that owns the mount, the retries and the missing-panel guard. This file
 * only decides what to say and when to stay quiet.
 */
export class EditPanelBox {
  private snapshot: Snapshot | null = null;

  constructor(
    private sdk: WmeSDK,
    private controller: Controller,
    private settings: SettingsStore,
  ) {}

  init(): void {
    injectStyles();
    registerEditPanelSlot({
      id: "house-numbers",
      rank: SLOT_RANK,
      render: (context) => this.render(context.siblings),
    });
    this.controller.onUpdate((snapshot) => {
      this.snapshot = snapshot;
      this.schedule();
    });
    this.sdk.Events.on({
      eventName: "wme-selection-changed",
      eventHandler: () => this.schedule(),
    });
    this.schedule();
  }

  private schedule(): void {
    // Do not rebuild the box (and its button) while a batch is running underneath it.
    if (isImportInFlight()) return;
    refreshEditPanelHost();
  }

  /** Returns null when there is nothing to say; the host then drops the slot entirely. */
  private render(siblings: readonly string[]): HTMLElement | null {
    const snapshot = this.snapshot;
    if (!this.settings.get().enabled || !snapshot || snapshot.segmentId === null) return null;

    // No street name here: WME's own field sits right below and already carries it.
    const children: HTMLElement[] = [
      el("div", "hn-note", formatCounts(countByStatus(snapshot.points))),
    ];

    // The checker's slot sits in this very host and already reports the name verdict, with
    // its fix buttons. Repeating it would be noise, so we only speak up when it stayed
    // quiet. The host tells us, so we no longer go looking through another feature's DOM.
    if (!siblings.includes("street-name")) {
      const verdict = formatVerdict(getStreetNameVerdict(snapshot.segmentId));
      if (verdict) children.push(el("div", `hn-verdict ${verdict.className}`, verdict.text));
    }

    const warning = dataWarning(snapshot);
    if (warning) {
      children.push(el("div", "hn-warn", warning));
    } else if (canBulkImport(snapshot)) {
      children.push(
        button(
          formatImportButton(snapshot.missing.length),
          () => void this.controller.importMissing(),
          "hn-btn hn-btn-primary",
        ),
      );
    }

    const box = el("div", "hn-pane");
    box.replaceChildren(...children);
    return box;
  }
}
