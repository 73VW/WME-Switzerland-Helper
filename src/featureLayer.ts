import { Layer } from "./layer";
import { WmeSDK } from "wme-sdk-typings";

class FeatureLayer extends Layer {
    styleContext: Map<string, CallableFunction>;
    styleRules: Map<string, any>[];
    features: Map<string, any>;
    minZoomLevel: number;
    featureClicked: ((args: { wmeSDK: WmeSDK, featureId: string }) => void) | null = null;
    constructor(name: string, styleContext: Map<string, CallableFunction>, styleRules: Map<string, any>[]) {
        super(name); // call the super class constructor and pass in the name parameter
        this.styleContext = styleContext;
        this.styleRules = styleRules;
        this.features = new Map();
        this.minZoomLevel = 15;
    }
    async addToMap(args: { wmeSDK: WmeSDK }) {
        wmeSDK.Map.addLayer(
            {
                layerName: this.name,
                styleContext: this.styleContext,
                styleRules: this.styleRules
            }
        )
        if (this.featureClicked) {
            wmeSDK.Events.trackLayerEvents({ layerName: this.name });
        }
        await this.render({ wmeSDK: wmeSDK });
    }

    mapRecordToFeature(args: { record: any }) {
        throw new Error('not implemented');
    }

    drawFeatures(args: { wmeSDK: WmeSDK, features: Map<string, any> }) {
        const wazeFeatures: SdkFeature[] = Array.from(args.features.values()).flatMap(r => this.mapRecordToFeature(r));

        const result = {
            features: wazeFeatures,
            layerName: this.name
        };
        args.wmeSDK.Map.addFeaturesToLayer(result);
    }
    async * fetchData({ wmeSDK, offset = 0 }) {
    }
    shouldDrawRecord({ wmeSDK, record }) {
        throw new Error('not implemented');
    }
    addRecordToFeatures({ record }) {
        throw new Error('not implemented');
    }
    async render({ wmeSDK }) {
        let checked = wmeSDK.LayerSwitcher.isLayerCheckboxChecked({ name: this.name });
        if (!checked) {
            return;
        }
        const zoomLevel = wmeSDK.Map.getZoomLevel();
        wmeSDK.Map.removeAllFeaturesFromLayer({ layerName: this.name });
        if (zoomLevel < this.minZoomLevel) {
            return;
        }

        for await (const batch of this.fetchData({ wmeSDK })) {
            console.log(`Fetched batch of ${batch.length} records`);
            for (const record of batch) {
                this.addRecordToFeatures({ record: record })
                try {
                    if (!this.shouldDrawRecord({ wmeSDK: wmeSDK, record: record })) {
                        continue;
                    }
                    this.drawFeatures({ wmeSDK, features: [record] });
                }
                catch (error) {
                    console.error(error);
                    console.log(record);
                    return;
                }
            }
        }
    }
}