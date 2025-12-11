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
import { FeatureLayer } from "./featureLayer";

interface SBBRecord {
  number: string;
  geopos_haltestelle: {
    lat: number;
    lon: number;
  };
  [key: string]: unknown;
}

interface SBBDataLayerConstructorArgs {
  name: string;
  styleContext?: Record<string, unknown>;
  styleRules?: Array<{
    style: Record<string, unknown>;
  }>;
}

abstract class SBBDataLayer extends FeatureLayer {
  baseUrl: string;
  minZoomLevel: number;
  dataSet: string;
  maxRecordsPerPage: number;

  constructor(args: SBBDataLayerConstructorArgs) {
    super(args);
    this.baseUrl = "https://data.sbb.ch/api/explore/v2.1/catalog/datasets";
    this.minZoomLevel = 14;
    this.dataSet = "";
    this.maxRecordsPerPage = 50;
  }

  addRecordToFeatures(args: { record: SBBRecord }): void {
    const { record } = args;
    this.features.set(record.number, record);
  }

  mapRecordToFeature(args: { record: SBBRecord }): unknown {
    const { record } = args;
    return {
      geometry: {
        coordinates: [
          record.geopos_haltestelle.lon,
          record.geopos_haltestelle.lat,
        ],
        type: "Point",
      },
      type: "Feature",
      id: record.number,
    };
  }

  async *fetchData(args: {
    wmeSDK: WmeSDK;
    offset?: number;
  }): AsyncGenerator<SBBRecord[], void, unknown> {
    const { wmeSDK, offset = 0 } = args;
    const mapExtent = wmeSDK.Map.getMapExtent();
    const x1 = mapExtent[0];
    const y1 = mapExtent[1];
    const x2 = mapExtent[2];
    const y2 = mapExtent[3];
    const url = `${this.baseUrl}/${this.dataSet}/records?where=in_bbox(geopos_haltestelle,${y1},${x1},${y2},${x2})&limit=50&offset=${offset}`;
    console.log(url);

    const response = await GM.xmlHttpRequest({
      method: "GET",
      url,
      responseType: "json",
    });

    const batch = (response.response?.results as SBBRecord[]) || [];

    yield batch; // Yield the current batch

    if (batch.length === this.maxRecordsPerPage) {
      yield* this.fetchData({
        wmeSDK,
        offset: offset + this.maxRecordsPerPage,
      }); // Yield next batches
    }
  }
}

export { SBBDataLayer };
export type { SBBRecord };
