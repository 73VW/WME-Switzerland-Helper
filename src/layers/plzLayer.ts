import { FeatureLayer } from './featureLayer';

export class PLZLayer extends FeatureLayer {
  layer = 'ch.swisstopo-vd.ortschaftenverzeichnis_plz';

  async shouldDrawRecord(): Promise<boolean> {
    return Promise.resolve(true);
  }

  addRecordToFeatures({ record }: { record: any }): void {
    this.features.set(record.id, record);
  }

  mapRecordToFeature({ record }: { record: any }) {
    return record;
  }

  async *fetchData() {
    return [] as any[];
  }
}
