import { FeatureLayer } from './featureLayer';
import type { Point } from 'geojson';
import type { WmeSDK } from 'wme-sdk-typings';

interface StopRecord {
  number: string;
  geopos_haltestelle: { lon: string; lat: string };
  designation: string;
}

export class PublicTransportationStopsLayer extends FeatureLayer<StopRecord> {
  baseUrl = 'https://data.sbb.ch/api/explore/v2.1/catalog/datasets/haltestelle-haltekante/records';
  maxRecordsPerPage = 50;

  addRecordToFeatures({ record }: { record: StopRecord }) {
    this.features.set(record.number, record);
  }

  mapRecordToFeature({ record }: { record: StopRecord }): unknown {
    return {
      geometry: { coordinates: [parseFloat(record.geopos_haltestelle.lon), parseFloat(record.geopos_haltestelle.lat)], type: 'Point' } as Point,
      type: 'Feature',
      id: record.number,
      properties: {},
    };
  }

  async shouldDrawRecord(): Promise<boolean> {
    return Promise.resolve(true);
  }

  async *fetchData({ wmeSDK, offset = 0 }: { wmeSDK: WmeSDK; offset?: number }): AsyncGenerator<StopRecord[]> {
    const [x1, y1, x2, y2] = wmeSDK.Map.getMapExtent();
    const url = `${this.baseUrl}?where=in_bbox(geopos_haltestelle,${y1},${x1},${y2},${x2})&limit=${this.maxRecordsPerPage}&offset=${offset}`;
    const response = await GM.xmlHttpRequest({ method: 'GET', url, responseType: 'json' });
    const batch = response.response?.results || [];
    yield batch;
    if (batch.length === this.maxRecordsPerPage) {
      yield* this.fetchData({ wmeSDK, offset: offset + this.maxRecordsPerPage });
    }
  }

  async featureClicked({ wmeSDK, featureId }: { wmeSDK: WmeSDK; featureId: string }) {
    const stop = this.features.get(featureId);
    if (!stop) return;
    const lat = parseFloat(stop.geopos_haltestelle.lat);
    const lon = parseFloat(stop.geopos_haltestelle.lon);
    const geometry: Point = { type: 'Point', coordinates: [lon, lat] };
    const venueId = wmeSDK.DataModel.Venues.addVenue({ category: 'TRANSPORTATION', geometry });
    wmeSDK.DataModel.Venues.updateVenue({ venueId: venueId.toString(), name: stop.designation });
    wmeSDK.Map.removeFeatureFromLayer({ layerName: this.name, featureId });
  }
}

