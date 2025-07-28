import { SwissMapGeoAdminLayer } from './swissMapGeoAdminLayer';

import type { WmeSDK, Segment } from 'wme-sdk-typings';
import { normalizeStreetName, segmentsCrossingPolygon } from '../utils/geometry';

interface StreetRecord {
  id: number;
  geometry?: { rings?: number[][][]; paths?: number[][][] };
  attributes: { stn_label: string; label?: string };
}

export class StreetLayer extends SwissMapGeoAdminLayer<StreetRecord> {
  layer = 'ch.swisstopo.amtliches-strassenverzeichnis';
  ROAD_TYPES_TO_AVOID = [15, 3, 6, 7, 2, 18, 4, 19];

  async shouldDrawRecord({ wmeSDK, record }: { wmeSDK: WmeSDK; record: StreetRecord }): Promise<boolean> {
    if (!record.geometry?.rings) return false;
    const segments: Segment[] = wmeSDK.DataModel.Segments.getAll()
      .filter((s) => s.toNodeId && s.fromNodeId)
      .filter((s) => !this.ROAD_TYPES_TO_AVOID.includes(s.roadType));

    const relevant = segmentsCrossingPolygon(record.geometry.rings, segments);
    if (relevant.length === 0) return false;
    for (const seg of relevant) {
      const addr = wmeSDK.DataModel.Segments.getAddress({ segmentId: seg.id });
      if (!addr || !addr.street) return true;
      if (normalizeStreetName(addr.street.name ?? '') !== normalizeStreetName(record.attributes.stn_label)) {
        return true;
      }
    }
    return false;
  }

  addRecordToFeatures({ record }: { record: StreetRecord }): void {
    this.features.set(record.id, record);
  }

  mapRecordToFeature({ record }: { record: StreetRecord }): unknown {
    if (record.geometry?.paths) {
      return record.geometry.paths.map((p: number[][], idx: number) => ({
        geometry: { coordinates: p, type: 'LineString' },
        type: 'Feature',
        id: `${record.id}-${idx}`,
        properties: { label: record?.attributes?.label },
      }));
    }
    if (record.geometry?.rings) {
      return {
        geometry: { coordinates: record.geometry.rings, type: 'Polygon' },
        type: 'Feature',
        id: `${record.id}-0`,
        properties: { label: record?.attributes?.label },
      };
    }
    return [];
  }

  async featureClicked({ wmeSDK, featureId }: { wmeSDK: WmeSDK; featureId: string | number }) {
    const [baseId] = String(featureId).split('-');
    const feature = this.features.get(parseInt(baseId, 10));
    if (!feature) return;
    if (!feature.geometry?.rings) return;

    const segments: Segment[] = wmeSDK.DataModel.Segments.getAll()
      .filter((s) => s.toNodeId && s.fromNodeId)
      .filter((s) => !this.ROAD_TYPES_TO_AVOID.includes(s.roadType));
    const relevant = segmentsCrossingPolygon(feature.geometry.rings, segments);

    const street = wmeSDK.DataModel.Streets.getAll().find(
      (st) => normalizeStreetName(st.name ?? '') === normalizeStreetName(feature.attributes.stn_label),
    );

    for (const seg of relevant) {
      const addr = wmeSDK.DataModel.Segments.getAddress({ segmentId: seg.id });
      if (!addr) continue;
      let s = street;
      if (!s) {
        if (!addr.city) continue;
        s = wmeSDK.DataModel.Streets.addStreet({ streetName: feature.attributes.stn_label, cityId: addr.city.id });
      }
      if (addr.street?.id !== s.id) {
        wmeSDK.DataModel.Segments.updateAddress({ segmentId: seg.id, primaryStreetId: s.id });
      }
    }
    wmeSDK.Map.removeFeatureFromLayer({ layerName: this.name, featureId });
  }
}

