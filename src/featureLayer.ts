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
import { Layer } from "./layer";

interface FeatureLayerConstructorArgs {
  name: string;
  styleContext?: Record<string, unknown>;
  styleRules?: Array<{
    style: Record<string, unknown>;
  }>;
}

abstract class FeatureLayer extends Layer {
  styleContext?: Record<string, unknown>;
  styleRules?: Array<{ style: Record<string, unknown> }>;
  features: Map<string | number, unknown>;
  minZoomLevel: number;
  visibleFeatureIds: Set<string | number>;

  constructor(args: FeatureLayerConstructorArgs) {
    super({ name: args.name });
    this.styleContext = args.styleContext;
    this.styleRules = args.styleRules;
    this.features = new Map();
    this.visibleFeatureIds = new Set();
    this.minZoomLevel = 15;
  }

  async addToMap(args: { wmeSDK: WmeSDK }): Promise<void> {
    const { wmeSDK } = args;
    wmeSDK.Map.addLayer({
      layerName: this.name,
      styleContext: this.styleContext as any,
      styleRules: this.styleRules as any,
    });

    wmeSDK.Events.trackLayerEvents({ layerName: this.name });

    await this.render({ wmeSDK });
  }

  removeFromMap(args: { wmeSDK: WmeSDK }): void {
    super.removeFromMap(args);
    // Clear the tracking set when layer is removed
    this.visibleFeatureIds.clear();
  }

  abstract featureClicked(args: {
    wmeSDK: WmeSDK;
    featureId: string | number;
  }): Promise<void>;

  abstract mapRecordToFeature(args: { record: unknown }): unknown;

  drawFeatures(args: { wmeSDK: WmeSDK; features: unknown[] }): void {
    const { wmeSDK, features } = args;
    const wazeFeatures = features.flatMap((r) =>
      this.mapRecordToFeature({ record: r }),
    );

    wmeSDK.Map.addFeaturesToLayer({
      features: wazeFeatures as any,
      layerName: this.name,
    });
  }

  abstract fetchData(args: {
    wmeSDK: WmeSDK;
    offset?: number;
  }): AsyncGenerator<unknown[], void, unknown>;

  abstract shouldDrawRecord(args: {
    wmeSDK: WmeSDK;
    record: unknown;
  }): Promise<boolean>;

  abstract addRecordToFeatures(args: { record: unknown }): void;

  async render(args: { wmeSDK: WmeSDK }): Promise<void> {
    const { wmeSDK } = args;
    const checked = wmeSDK.LayerSwitcher.isLayerCheckboxChecked({
      name: this.name,
    });
    if (!checked) {
      return;
    }

    const zoomLevel = wmeSDK.Map.getZoomLevel();
    if (zoomLevel < this.minZoomLevel) {
      return;
    }

    // Track new features in this render pass
    const newFeatureIds = new Set<string | number>();

    for await (const batch of this.fetchData({ wmeSDK })) {
      console.log(`Fetched batch of ${batch.length} records`);
      for (const record of batch) {
        this.addRecordToFeatures({ record });
        try {
          if (!(await this.shouldDrawRecord({ wmeSDK, record }))) {
            continue;
          }

          // Get the feature ID from the record (assumes it has an 'id' property)
          const recordId = (record as { id?: string | number }).id;
          if (recordId !== undefined) {
            newFeatureIds.add(recordId);

            // Only draw if not already visible
            if (!this.visibleFeatureIds.has(recordId)) {
              this.drawFeatures({ wmeSDK, features: [record] });
              this.visibleFeatureIds.add(recordId);
            }
          } else {
            // Fallback: draw if ID is not available
            this.drawFeatures({ wmeSDK, features: [record] });
          }
        } catch (error) {
          console.error(error);
          console.log(record);
          return;
        }
      }
    }

    // Remove features that are no longer in the response
    const featuresToRemove = Array.from(this.visibleFeatureIds).filter(
      (id) => !newFeatureIds.has(id),
    );

    for (const featureId of featuresToRemove) {
      wmeSDK.Map.removeFeatureFromLayer({
        featureId,
        layerName: this.name,
      });
      this.visibleFeatureIds.delete(featureId);
    }
  }
}

export { FeatureLayer };
