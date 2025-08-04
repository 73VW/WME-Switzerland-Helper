import { segmentsCrossingPolygon, haversineDistance } from '../src/utils/geometry';

const square = [[
  [0, 0],
  [4, 0],
  [4, 4],
  [0, 4],
  [0, 0],
]];

interface Segment {
  geometry: { coordinates: number[][] };
  id: number;
}

const segments: Segment[] = [
  {
    geometry: {
      coordinates: [
        [-1, 2],
        [2, 5],
      ]
    }, id: 1
  }, // starts outside, ends outside, crosses polygon twice
  {
    geometry: {
      coordinates: [
        [-1, 4],
        [0, 5],
      ]
    }, id: 2
  }, // starts outside, ends outside, does not cross polygon
  {
    geometry: {
      coordinates: [
        [-1, 1],
        [1, 3],
      ]
    }, id: 3
  }, // starts outside, ends inside
  {
    geometry: {
      coordinates: [
        [0, 1],
        [3, 4],
      ]
    }, id: 4
  }, // starts on the edge, ends on the edge
  {
    geometry: {
      coordinates: [
        [0, 0],
        [2, 2],
      ]
    }, id: 5
  }, // starts on the edge, ends inside
  {
    geometry: {
      coordinates: [
        [1, 0],
        [5, 4],
      ]
    }, id: 6
  }, // starts on the edge, ends outside, crosses polygon
  {
    geometry: {
      coordinates: [
        [4, 2],
        [6, 4],
      ]
    }, id: 7
  }, // starts on the edge, ends outside, does not cross polygon
  {
    geometry: {
      coordinates: [
        [2, 2],
        [3, 3],
      ]
    }, id: 8
  }, // starts inside, ends inside
];

test('segmentsCrossingPolygon filters correctly', () => {
  const res = segmentsCrossingPolygon(square, segments);
  expect(res.map((s) => s.id)).toEqual([1, 3, 4, 5, 6]);
});

test('haversineDistance gives reasonable result', () => {
  const dist = haversineDistance(0, 0, 0, 1);
  expect(Math.round(dist)).toBe(111195);
});
import { segmentPolygonIntersections } from '../src/utils/geometry';

test('segmentPolygonIntersections returns boundary points', () => {
  const ints = segmentPolygonIntersections(square, segments[0].geometry.coordinates);
  expect(ints).toEqual([
    [0, 3],
    [1, 4],
  ]);
  const inside = segmentPolygonIntersections(square, segments[7].geometry.coordinates);
  expect(inside.length).toBe(0);
});
