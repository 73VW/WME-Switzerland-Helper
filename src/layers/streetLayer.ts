import { SwissMapGeoAdminLayer } from './swissMapGeoAdminLayer';

import type { WmeSDK, Segment } from 'wme-sdk-typings';
import {
  normalizeStreetName,
  segmentsCrossingPolygon,
  segmentPolygonIntersections,
  pointsAreClose,
} from '../utils/geometry';

interface StreetRecord {
  id: number;
  geometry?: { rings?: number[][][]; paths?: number[][][] };
  attributes: { stn_label: string; label?: string };
}

export class StreetLayer extends SwissMapGeoAdminLayer<StreetRecord> {
  layer = 'ch.swisstopo.amtliches-strassenverzeichnis';
  ROAD_TYPES_TO_AVOID = [15, 3, 6, 7, 2, 18, 4, 19];

  async shouldDrawRecord({ wmeSDK, record }: { wmeSDK: WmeSDK; record: StreetRecord }): Promise<boolean> {
    // If the feature contains paths (lines), always draw them to allow creating segments.
    if (record.geometry?.paths) return true;

    // For polygon features, only draw when at least one existing segment within
    // the polygon has a different street name or when no segment exists.
    if (!record.geometry?.rings) return false;

    const segments: Segment[] = wmeSDK.DataModel.Segments.getAll()
      .filter((s) => s.toNodeId && s.fromNodeId)
      .filter((s) => !this.ROAD_TYPES_TO_AVOID.includes(s.roadType));

    const relevant = segmentsCrossingPolygon(record.geometry.rings, segments);
    if (relevant.length === 0) return false;

    for (const seg of relevant) {
      const addr = wmeSDK.DataModel.Segments.getAddress({ segmentId: seg.id });
      if (!addr || !addr.street) return true;
      if (
        normalizeStreetName(addr.street.name ?? '') !==
        normalizeStreetName(record.attributes.stn_label)
      ) {
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

  private splitSegmentsByPolygon(wmeSDK: WmeSDK, poly: number[][][]) {
    const seen = new Set<number>();
    let changed = true;
    while (changed) {
      changed = false;
      const segments: Segment[] = wmeSDK.DataModel.Segments.getAll()
        .filter((s) => s.toNodeId && s.fromNodeId)
        .filter((s) => !this.ROAD_TYPES_TO_AVOID.includes(s.roadType));
      console.log(segments);
      console.log(poly);
      debugger;

      const relevant = segmentsCrossingPolygon(poly, segments);

      for (const seg of relevant) {
        if (seen.has(seg.id)) continue;
        const coords = seg.geometry.coordinates as number[][];
        const inters = segmentPolygonIntersections(poly, coords).filter(
          (pt) =>
            !pointsAreClose(pt, coords[0]) &&
            !pointsAreClose(pt, coords[coords.length - 1])
        );
        if (inters.length > 0) {
          wmeSDK.DataModel.Segments.splitSegment({
            segmentId: seg.id,
            splitPoint: { coordinates: inters[0], type: 'Point' },
          });
          changed = true;
          break;
        }
        seen.add(seg.id);
      }
    }
  }

  async featureClicked({ wmeSDK, featureId }: { wmeSDK: WmeSDK; featureId: string | number }) {
    const [baseId] = String(featureId).split('-');
    const feature = this.features.get(parseInt(baseId, 10));
    if (!feature) return;
    if (!feature.geometry?.rings) return;

    this.splitSegmentsByPolygon(wmeSDK, feature.geometry.rings);

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

export function streetStyleContext() {
  return {
    getStrokeColor: ({ feature }: { feature?: unknown; zoomLevel: number }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const f: any = feature;
      return f?.geometry?.type === 'LineString' ? 'red' : 'blue';
    },
    getLabel: ({ feature }: { feature?: unknown; zoomLevel: number }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const f: any = feature;
      return f?.properties?.label;
    },
  };
}

export const streetStyleRules = [
  {
    style: {
      strokeColor: '${getStrokeColor}',
      strokeWidth: 3,
      title: '${getLabel}',
      pointerEvents: 'all',
      label: '${getLabel}',
      cursor: 'pointer',
      labelSelect: true,
      labelAlign: 'cm',
      strokeDashstyle: 'dash',
    },
  },
];


