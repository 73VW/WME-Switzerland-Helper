import { Layer } from '../layer';
import type { WmeSDK } from 'wme-sdk-typings';


export abstract class FeatureLayer<TRecord> extends Layer {
  styleContext?: Record<string, unknown>;
  styleRules?: unknown[];
  features = new Map<number | string, TRecord>();
  minZoomLevel = 15;

  constructor(args: { name: string; styleContext?: Record<string, unknown>; styleRules?: unknown[] }) {
    super({ name: args.name });
    this.styleContext = args.styleContext;
    this.styleRules = args.styleRules;
  }

  async addToMap(args: { wmeSDK: WmeSDK }) {
    const { wmeSDK } = args;
    wmeSDK.Map.addLayer({
      layerName: this.name,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      styleContext: this.styleContext as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      styleRules: this.styleRules as any,
    });
    if (this.featureClicked !== FeatureLayer.prototype.featureClicked) {
      wmeSDK.Events.trackLayerEvents({ layerName: this.name });
    }
    await this.render({ wmeSDK });
  }

  removeFromMap(args: { wmeSDK: WmeSDK }) {
    super.removeFromMap(args);
    this.features.clear();
  }

  async render(args: { wmeSDK: WmeSDK }) {
    const { wmeSDK } = args;
    const zoomLevel = wmeSDK.Map.getZoomLevel();
    wmeSDK.Map.removeAllFeaturesFromLayer({ layerName: this.name });
    if (zoomLevel < this.minZoomLevel) return;
    for await (const batch of this.fetchData({ wmeSDK })) {
      for (const record of batch) {
        this.addRecordToFeatures({ record });
        if (await this.shouldDrawRecord({ wmeSDK, record })) {
          const features = this.mapRecordToFeature({ record });
          if (!features) continue;
          const wazeFeatures = Array.isArray(features) ? features : [features];
          wmeSDK.Map.addFeaturesToLayer({ features: wazeFeatures, layerName: this.name });
        }
      }
    }
  }

  abstract addRecordToFeatures(args: { record: TRecord }): void;
  abstract mapRecordToFeature(args: { record: TRecord }): unknown | unknown[] | null;
  abstract shouldDrawRecord(args: { wmeSDK: WmeSDK; record: TRecord }): Promise<boolean>;
  abstract fetchData(args: { wmeSDK: WmeSDK }): AsyncGenerator<TRecord[]>;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async featureClicked(_args: { wmeSDK: WmeSDK; featureId: string | number }): Promise<void> {
    // optional hook
  }
}


