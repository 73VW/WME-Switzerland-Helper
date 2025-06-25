import { WmeSDK } from "wme-sdk-typings";

abstract class Layer {
  name: string;
  constructor(args: { name: string }) {
    this.name = args.name;
  }
  addCheckBox(args: { wmeSDK: WmeSDK }) {
    args.wmeSDK.LayerSwitcher.addLayerCheckbox({ name: this.name });
  }
  abstract addToMap(args: { wmeSDK: WmeSDK }): void;
  removeFromMap(args: { wmeSDK: WmeSDK }) {
    args.wmeSDK.Map.removeLayer({ layerName: this.name });
  }
}

export { Layer };
