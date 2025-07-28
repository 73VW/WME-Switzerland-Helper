import { FeatureLayer } from './featureLayer';
import type { Geometry } from 'geojson';

interface PlzRecord {
  id: number;
  geometry?: Geometry;
  [key: string]: unknown;
}

export class PLZLayer extends FeatureLayer<PlzRecord> {
  layer = 'ch.swisstopo-vd.ortschaftenverzeichnis_plz';

  async shouldDrawRecord(): Promise<boolean> {
    return Promise.resolve(true);
  }

  addRecordToFeatures({ record }: { record: PlzRecord }): void {
    this.features.set(record.id, record);
  }

  mapRecordToFeature({ record }: { record: PlzRecord }): unknown {
    return record;
  }

  async *fetchData(): AsyncGenerator<PlzRecord[]> {
    yield [] as PlzRecord[];
  }
}


