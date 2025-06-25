import { WmeSDK } from "wme-sdk-typings";
class Layer {
    name: string;
    constructor(name: string) {
        this.name = name
    }
    addCheckBox(wmeSDK: WmeSDK) {
        wmeSDK.LayerSwitcher.addLayerCheckbox({ name: this.name });
    }
    addToMap(wmeSDK: WmeSDK) {
        throw new Error('not implemented');
    }
    removeFromMap(wmeSDK: WmeSDK) {
        wmeSDK.Map.removeLayer({ layerName: this.name });
    }
}

export { Layer };