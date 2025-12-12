/*
 * Copyright (c) 2025 Maël Pedretti
 *
 * This file is part of WME Switzerland Helper.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { WmeSDK } from "wme-sdk-typings";
import { saveLayerState, isLayerEnabled } from "./storage";

abstract class Layer {
  name: string;
  protected eventCleanups: Array<() => void>;
  constructor(args: { name: string; wmeSDK: WmeSDK }) {
    this.name = args.name;
    this.eventCleanups = [];
    // Register checkbox immediately during construction
    args.wmeSDK.LayerSwitcher.addLayerCheckbox({ name: this.name });
    this.registerCheckboxHandler({ wmeSDK: args.wmeSDK });
  }
  abstract addToMap(args: { wmeSDK: WmeSDK }): void;
  removeFromMap(args: { wmeSDK: WmeSDK }) {
    args.wmeSDK.Map.removeLayer({ layerName: this.name });
    this.unregisterEvents();
  }

  // Per-layer event registration; must be implemented by subclasses
  abstract registerEvents(args: { wmeSDK: WmeSDK }): void;

  unregisterEvents(): void {
    for (const cleanup of this.eventCleanups) {
      try {
        cleanup();
      } catch {
        console.warn("Failed to cleanup layer event listener");
        /* ignore cleanup errors */
      }
    }
    this.eventCleanups = [];
  }

  // Each layer handles its own checkbox toggle logic
  protected registerCheckboxHandler(args: { wmeSDK: WmeSDK }): void {
    const { wmeSDK } = args;
    const cleanup = wmeSDK.Events.on({
      eventName: "wme-layer-checkbox-toggled",
      eventHandler: ({ name, checked }) => {
        if (name !== this.name) return;
        saveLayerState(this.name, checked);
        if (checked) {
          this.addToMap({ wmeSDK });
          this.registerEvents({ wmeSDK });
        } else {
          this.removeFromMap({ wmeSDK });
        }
      },
    });
    this.eventCleanups.push(cleanup);
  }

  // Restore persisted state: if enabled, add to map and reflect checkbox
  restoreState(args: { wmeSDK: WmeSDK }): void {
    const { wmeSDK } = args;
    const enabled = isLayerEnabled(this.name);
    if (enabled === true) {
      this.addToMap({ wmeSDK });
      wmeSDK.LayerSwitcher.setLayerCheckboxChecked({
        name: this.name,
        isChecked: true,
      });
    }
  }
}

export { Layer };
