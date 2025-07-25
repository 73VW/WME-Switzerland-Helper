import { lineString, polygon, point, Feature, LineString, Polygon } from '@turf/helpers';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import booleanPointOnLine from '@turf/boolean-point-on-line';
import lineIntersect from '@turf/line-intersect';
import bbox from '@turf/bbox';
import booleanDisjoint from '@turf/boolean-disjoint';

export function normalizeStreetName(str: string): string {
  return str.toLowerCase().replace(/-/g, ' ').trim();
}

export function segmentsCrossingPolygon(
  polyCoords: number[][][],
  segments: { geometry: { coordinates: number[][] } }[],
) {
  const poly = polygon(polyCoords);
  const polyBbox = bbox(poly);
  return segments.filter((seg) => {
    const coords = seg.geometry.coordinates;
    const line = lineString(coords);
    const segBbox = bbox(line);
    // quick bbox check
    const bbPoly = polygon([
      [
        [polyBbox[0], polyBbox[1]],
        [polyBbox[2], polyBbox[1]],
        [polyBbox[2], polyBbox[3]],
        [polyBbox[0], polyBbox[3]],
        [polyBbox[0], polyBbox[1]],
      ],
    ]);
    const bbLine = polygon([
      [
        [segBbox[0], segBbox[1]],
        [segBbox[2], segBbox[1]],
        [segBbox[2], segBbox[3]],
        [segBbox[0], segBbox[3]],
        [segBbox[0], segBbox[1]],
      ],
    ]);
    if (booleanDisjoint(bbPoly, bbLine)) return false;

    const start = point(coords[0]);
    const end = point(coords[coords.length - 1]);
    const startInside = booleanPointInPolygon(start, poly);
    const endInside = booleanPointInPolygon(end, poly);
    const linePoly = lineString(poly.geometry.coordinates[0]);
    const startOnEdge = booleanPointOnLine(start, linePoly);
    const endOnEdge = booleanPointOnLine(end, linePoly);
    const intersections = lineIntersect(line, poly).features.length > 0;

    if (!startInside && !endInside) return intersections;
    if (startOnEdge && !endInside) return intersections;
    if (!startInside && endInside) return true;
    if (startOnEdge && endInside) return true;
    if (startInside && endInside) return true;
    return false;
  });
}
