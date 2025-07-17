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
