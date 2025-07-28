import { FeatureLayer } from './featureLayer';
import type { WmeSDK } from 'wme-sdk-typings';

export abstract class SwissMapGeoAdminLayer<TRecord> extends FeatureLayer<TRecord> {
  maxRecordsPerPage = 201;
  baseUrl = 'https://api3.geo.admin.ch/rest/services/api/MapServer/identify?geometryType=esriGeometryEnvelope&imageDisplay=0,0,0&mapExtent=0,0,0,0&tolerance=0&sr=4326';
  layer = '';

  async *fetchData({ wmeSDK, offset = 0 }: { wmeSDK: WmeSDK; offset?: number }): AsyncGenerator<TRecord[]> {
    const mapExtent = wmeSDK.Map.getMapExtent();
    const url = `${this.baseUrl}&layers=all:${this.layer}&offset=${offset}&geometry=${mapExtent.join(',')}`;
    const response = await GM.xmlHttpRequest({ method: 'GET', url, responseType: 'json' });
    const batch = response.response?.results || [];
    yield batch;
    if (batch.length === this.maxRecordsPerPage) {
      yield* this.fetchData({ wmeSDK, offset: offset + this.maxRecordsPerPage });
    }
  }
}


