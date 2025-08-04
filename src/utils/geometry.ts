import { lineString, polygon, point } from '@turf/helpers';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import booleanPointOnLine from '@turf/boolean-point-on-line';
import lineIntersect from '@turf/line-intersect';
import bbox from '@turf/bbox';
import booleanDisjoint from '@turf/boolean-disjoint';

export function normalizeStreetName(str: string): string {
  return str.toLowerCase().replace(/-/g, ' ').trim();
}

export function segmentsCrossingOrInsidePolygon<T extends { geometry: { coordinates: number[][] } }>(
  polyCoords: number[][][],
  segments: T[],
): T[] {
  // TODO: Implement logic to determine which segments need to be updated based on the polygon coordinates.
  return []
}

export function segmentsCrossingPolygon<T extends { geometry: { coordinates: number[][] } }>(
  polyCoords: number[][][],
  segments: T[],
): T[] {
  const poly = polygon(polyCoords);
  const polyBbox = bbox(poly);
  const edge = lineString(poly.geometry.coordinates[0]);
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
    const startOnEdge = booleanPointOnLine(start, edge);
    const endOnEdge = booleanPointOnLine(end, edge);
    const intersects = lineIntersect(line, poly).features.length > 0;

    return startInside || endInside || startOnEdge || endOnEdge || intersects;
  });
}

export function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371000; // radius of Earth in meters
  const toRad = (x: number) => (x * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}


export function segmentPolygonIntersections(
  polyCoords: number[][][],
  lineCoords: number[][],
): number[][] {
  const poly = polygon(polyCoords);
  const line = lineString(lineCoords);
  return lineIntersect(line, poly).features.map((f) => {
    const coords = f.geometry.coordinates as number[];
    return [coords[0], coords[1]];
  });
}

export function pointsAreClose(a: number[], b: number[], tol = 1e-6): boolean {
  return Math.abs(a[0] - b[0]) < tol && Math.abs(a[1] - b[1]) < tol;
}
