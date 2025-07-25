import { segmentsCrossingPolygon } from '../src/utils/geometry';

const square = [[[0,0],[4,0],[4,4],[0,4],[0,0]]];

const segments = [
  { geometry: { coordinates: [[-1,2],[5,2]] }, id: 1 }, // crosses
  { geometry: { coordinates: [[1,1],[3,3]] }, id: 2 }, // inside
  { geometry: { coordinates: [[-1,-1],[-2,-2]] }, id:3 } // outside
];

test('segmentsCrossingPolygon filters correctly', () => {
  const res = segmentsCrossingPolygon(square, segments as any);
  expect(res.map((s: any) => s.id)).toEqual([1,2]);
});
