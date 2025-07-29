import { segmentsCrossingPolygon, haversineDistance } from '../src/utils/geometry';

const square = [[[0,0],[4,0],[4,4],[0,4],[0,0]]];

interface Segment {
  geometry: { coordinates: number[][] };
  id: number;
}

const segments: Segment[] = [
  { geometry: { coordinates: [[-1, 2], [5, 2]] }, id: 1 }, // crosses
  { geometry: { coordinates: [[1, 1], [3, 3]] }, id: 2 }, // inside
  { geometry: { coordinates: [[-1, -1], [-2, -2]] }, id: 3 }, // outside
  { geometry: { coordinates: [[1, 1], [5, 5]] }, id: 4 }, // start inside end outside
];

test('segmentsCrossingPolygon filters correctly', () => {
  const res = segmentsCrossingPolygon(square, segments);
  expect(res.map((s) => s.id)).toEqual([1, 2, 4]);
});

test('haversineDistance gives reasonable result', () => {
  const dist = haversineDistance(0, 0, 0, 1);
  expect(Math.round(dist)).toBe(111195);
});
import { segmentPolygonIntersections } from '../src/utils/geometry';

test('segmentPolygonIntersections returns boundary points', () => {
  const ints = segmentPolygonIntersections(square, segments[0].geometry.coordinates);
  expect(ints).toEqual([
    [0, 2],
    [4, 2],
  ]);
  const inside = segmentPolygonIntersections(square, segments[1].geometry.coordinates);
  expect(inside.length).toBe(0);
});
