import { Layer } from '../layer';
import { WmeSDK } from 'wme-sdk-typings';

export abstract class FeatureLayer extends Layer {
  styleContext?: Record<string, unknown>;
  styleRules?: unknown[];
  features = new Map<number | string, any>();
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
      styleContext: this.styleContext,
      styleRules: this.styleRules,
    });
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
          const wazeFeatures = Array.isArray(features) ? features : [features];
          wmeSDK.Map.addFeaturesToLayer({ features: wazeFeatures, layerName: this.name });
        }
      }
    }
  }

  abstract addRecordToFeatures(args: { record: any }): void;
  abstract mapRecordToFeature(args: { record: any }): any | any[];
  abstract shouldDrawRecord(args: { wmeSDK: WmeSDK; record: any }): Promise<boolean>;
  abstract fetchData(args: { wmeSDK: WmeSDK }): AsyncGenerator<any[]>;
  abstract featureClicked?(args: { wmeSDK: WmeSDK; featureId: string }): Promise<void>;
}
