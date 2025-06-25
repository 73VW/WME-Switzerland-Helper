import { Layer } from "./layer";
import { WmeSDK } from "wme-sdk-typings";

class TileLayer extends Layer {
  tileHeight: number;
  tileWidth: number;
  fileName: string;
  servers: string[];
  zIndex: number;
  constructor(args: {
    name: string;
    tileHeight: number;
    tileWidth: number;
    fileName: string;
    servers: string[];
    zIndex?: number; // make zIndex optional
  }) {
    super({ name: args.name }); // call the super class constructor and pass in the name parameter
    this.tileHeight = args.tileHeight;
    this.tileWidth = args.tileWidth;
    this.fileName = args.fileName;
    this.servers = args.servers;
    this.zIndex = args.zIndex ?? 2035; // set default value if not provided
  }
  addToMap(args: { wmeSDK: WmeSDK }) {
    const wmeSDK = args.wmeSDK;

    wmeSDK.Map.addTileLayer({
      layerName: this.name,
      layerOptions: {
        tileHeight: this.tileHeight,
        tileWidth: this.tileWidth,
        url: {
          fileName: this.fileName,
          servers: this.servers,
        },
      },
    });
    // default map zindex are between 2000 and 2065
    // Segments layer has z-index 2060
    // Background layer has z-index 2010
    wmeSDK.Map.setLayerZIndex({
      layerName: this.name,
      zIndex: this.zIndex,
    });
  }
}

export { TileLayer };
