import { SwissMapGeoAdminLayer } from './swissMapGeoAdminLayer';
import { WmeSDK } from 'wme-sdk-typings';
import { createAutoScalingSvg, svgToBase64, getNaturalBoxSize } from '../utils/graphics';

export class HouseNumberLayer extends SwissMapGeoAdminLayer {
  layer = 'ch.swisstopo.amtliches-gebaeudeadressverzeichnis';
  minZoomLevel = 18;

  shouldDrawRecord(): Promise<boolean> {
    return Promise.resolve(true); // always draw due to SDK bug
  }

  addRecordToFeatures({ record }: { record: any }): void {
    this.features.set(record.id, record);
  }

  mapRecordToFeature({ record }: { record: any }) {
    if (!record.geometry?.x || !record.geometry?.y) return null;
    return {
      geometry: { coordinates: [record.geometry.x, record.geometry.y], type: 'Point' },
      type: 'Feature',
      id: record.id,
      properties: record.attributes,
    };
  }

  async featureClicked({ wmeSDK, featureId }: { wmeSDK: WmeSDK; featureId: string }) {
    const feature = this.features.get(parseInt(featureId, 10));
    if (!feature) return;
    wmeSDK.DataModel.HouseNumbers.addHouseNumber({
      number: feature.attributes.adr_number,
      point: { coordinates: [feature.geometry.x, feature.geometry.y], type: 'Point' },
    });
    wmeSDK.Map.removeFeatureFromLayer({ layerName: this.name, featureId });
  }
}

export function houseNumberStyleContext() {
  return {
    getExternalGraphic: ({ feature }: any) => {
      const label = feature?.properties?.stn_label || '';
      const value = feature?.properties?.adr_number || '';
      const city = feature?.properties?.zip_label || '';
      return svgToBase64(createAutoScalingSvg(label, value, city));
    },
    getPointRadius: ({ feature }: any) => {
      const label = feature?.properties?.stn_label || '';
      const value = feature?.properties?.adr_number || '';
      const city = feature?.properties?.zip_label || '';
      const { width } = getNaturalBoxSize(label, value, city);
      return width / 2;
    },
  };
}

export const houseNumberStyleRules = [
  {
    style: {
      fillOpacity: 1,
      cursor: 'pointer',
      pointRadius: '${getPointRadius}',
      externalGraphic: '${getExternalGraphic}',
    },
  },
];
