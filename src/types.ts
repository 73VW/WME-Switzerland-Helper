export type SdkFeatureGeometry = import('geojson').Point | import('geojson').LineString | import('geojson').Polygon;

export interface SdkFeature<G extends SdkFeatureGeometry = SdkFeatureGeometry> {
  type: 'Feature';
  id: string | number;
  geometry: G;
  properties?: Record<string, string | number | null | undefined>;
}

export interface SdkFeatureStyleRule {
  predicate?: (properties: Record<string, string | number | null | undefined>) => boolean;
  style: Record<string, unknown>;
}

export type SdkFeatureStyleContext = Record<
  string,
  (context: { feature?: SdkFeature; zoomLevel: number }) => string | number | undefined
>;

