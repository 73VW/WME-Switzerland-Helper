import { Layer } from "./layer";
import { WmeSDK } from "wme-sdk-typings";


class TileLayer extends Layer {
    tileHeight: number;
    tileWidth: number;
    fileName: string;
    servers: string[];
    constructor(name: string, tileHeight: number, tileWidth: number, fileName: string, servers: string[]) {
        super(name); // call the super class constructor and pass in the name parameter
        this.tileHeight = tileHeight;
        this.tileWidth = tileWidth;
        this.fileName = fileName;
        this.servers = servers;
    }
    addToMap(wmeSDK: WmeSDK) {
        wmeSDK.Map.addTileLayer({
            layerName: this.name,
            layerOptions: {
                tileHeight: this.tileHeight,
                tileWidth: this.tileWidth,
                url: {
                    fileName: this.fileName,
                    servers: this.servers
                }
            },
        });
    }
}

export { TileLayer };