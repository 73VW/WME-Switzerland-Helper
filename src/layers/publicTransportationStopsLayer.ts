import { FeatureLayer } from './featureLayer';
import type { Point } from 'geojson';
import type { WmeSDK, Venue, VenueCategoryId } from 'wme-sdk-typings';
import { haversineDistance } from '../utils/geometry';
import { showWmeDialog } from '../utils/dialog';

interface StopRecord {
  number: string;
  geopos_haltestelle: { lon: string; lat: string };
  designation: string;
  designationofficial?: string;
  businessorganisationabbreviationde?: string;
  businessorganisationdescriptionde?: string;
  meansoftransport?: string;
  municipalityname?: string;
}

export class PublicTransportationStopsLayer extends FeatureLayer<StopRecord> {
  baseUrl = 'https://data.sbb.ch/api/explore/v2.1/catalog/datasets/haltestelle-haltekante/records';
  maxRecordsPerPage = 50;
  private venueInnerTypeMapping = new Map<string, string>();
  private defaultVenueInnerType = 'arrêt';

  constructor(args: { name: string; styleContext?: Record<string, unknown>; styleRules?: unknown[] }) {
    super(args);
    this.venueInnerTypeMapping.set('TRAIN', 'gare');
    this.venueInnerTypeMapping.set('BOAT', 'port');
  }

  addRecordToFeatures({ record }: { record: StopRecord }) {
    this.features.set(record.number, record);
  }

  mapRecordToFeature({ record }: { record: StopRecord }): unknown {
    return {
      geometry: { coordinates: [parseFloat(record.geopos_haltestelle.lon), parseFloat(record.geopos_haltestelle.lat)], type: 'Point' } as Point,
      type: 'Feature',
      id: record.number,
      properties: {},
    };
  }

  private meansOfTransport(record: StopRecord): string[] {
    if (!record.meansoftransport) return [];
    return record.meansoftransport.split('|');
  }

  private venueCategories(record: StopRecord): string[] {
    return this.meansOfTransport(record).map((m) => {
      if (m === 'METRO') return 'SUBWAY_STATION';
      if (m === 'BOAT') return 'SEAPORT_MARINA_HARBOR';
      return `${m}_STATION`;
    });
  }

  private recordName(record: StopRecord): {
    name: string;
    aliases: string[];
    shortName: string;
  } {
    const aliases: string[] = [];
    let name = record.designationofficial || record.designation || 'Bus Stop';
    const splitted = name.split(',');
    if (
      splitted.length === 2 &&
      splitted[0].trim() === record.municipalityname
    ) {
      name = splitted[1];
    } else if (
      record.municipalityname &&
      name.includes(record.municipalityname) &&
      name.replace(record.municipalityname, '') !== '' &&
      !name.replace(record.municipalityname, '').startsWith('-')
    ) {
      name = name.replace(record.municipalityname, '');
    }
    name = name.trim();
    name = name.charAt(0).toUpperCase() + name.slice(1);

    const means = this.meansOfTransport(record);
    const venueInnerType = means
      .map((m) => this.venueInnerTypeMapping.get(m) || this.defaultVenueInnerType)
      .join(', ');

    let orgAbbr = record.businessorganisationabbreviationde;
    let orgName = record.businessorganisationdescriptionde;
    if (orgAbbr && orgAbbr.toLowerCase() === 'sbb') {
      aliases.push(`${name} (${venueInnerType} ${orgName})`);
      aliases.push(`${name} (${venueInnerType} ${orgAbbr})`);
      orgAbbr = 'CFF';
      orgName = 'Chemins de fer fédéraux CFF';
    } else if (
      orgAbbr &&
      ['trn/tc', 'trn/autovr', 'trn-tn', 'trn-cmn'].includes(orgAbbr.toLowerCase())
    ) {
      orgAbbr = 'transN';
      orgName = 'Transports Publics Neuchâtelois SA';
    } else if (orgAbbr && orgAbbr.toLowerCase() === 'pag') {
      orgAbbr = undefined;
      orgName = 'CarPostal SA';
    }

    const shortName = name;
    if (orgAbbr) {
      aliases.push(`${name} (${venueInnerType} ${orgName})`);
      name = `${name} (${venueInnerType} ${orgAbbr})`;
    } else {
      name = `${name} (${venueInnerType} ${orgName})`;
    }

    return { name, aliases, shortName };
  }

  async shouldDrawRecord({ wmeSDK, record }: { wmeSDK: WmeSDK; record: StopRecord }): Promise<boolean> {
    if (!record.meansoftransport || record.meansoftransport === '') return false;
    const { name } = this.recordName(record);
    const venues = wmeSDK.DataModel.Venues.getAll();
    return venues.filter((v) => v.name === name).length === 0;
  }

  async *fetchData({ wmeSDK, offset = 0 }: { wmeSDK: WmeSDK; offset?: number }): AsyncGenerator<StopRecord[]> {
    const [x1, y1, x2, y2] = wmeSDK.Map.getMapExtent();
    const url = `${this.baseUrl}?where=in_bbox(geopos_haltestelle,${y1},${x1},${y2},${x2})&limit=${this.maxRecordsPerPage}&offset=${offset}`;
    const response = await GM.xmlHttpRequest({ method: 'GET', url, responseType: 'json' });
    const batch = response.response?.results || [];
    yield batch;
    if (batch.length === this.maxRecordsPerPage) {
      yield* this.fetchData({ wmeSDK, offset: offset + this.maxRecordsPerPage });
    }
  }

  async featureClicked({ wmeSDK, featureId }: { wmeSDK: WmeSDK; featureId: string }) {
    const stop = this.features.get(featureId);
    if (!stop) return;
    const lat = parseFloat(stop.geopos_haltestelle.lat);
    const lon = parseFloat(stop.geopos_haltestelle.lon);

    if (wmeSDK.Map.getZoomLevel() < 17) {
      wmeSDK.Map.setMapCenter({ lonLat: { lat, lon }, zoomLevel: 17 });
      await this.render({ wmeSDK });
      return;
    }

    const { name, aliases, shortName } = this.recordName(stop);
    const venueCategories = this.venueCategories(stop);

    let venues: Venue[] = wmeSDK.DataModel.Venues.getAll();
    venues = venues.filter((v) =>
      v.categories.some((c) => ['TRANSPORTATION', ...venueCategories].includes(c)),
    );
    venues = venues.filter((v) => v.name.toLowerCase().includes(shortName.toLowerCase()));
    const venuesToUpdate = venues.filter((v) => {
      const point = v.geometry as Point;
      const [vlon, vlat] = point.coordinates;
      return haversineDistance(vlat, vlon, lat, lon) <= 75;
    });

    let selection: Venue[] = [];
    if (venuesToUpdate.length > 0) {
      wmeSDK.Editing.setSelection({
        selection: {
          ids: venuesToUpdate.map((v) => v.id.toString()),
          objectType: 'venue',
        },
      });
      const result = await showWmeDialog({
        message:
          'Existing stop(s) found within 75m.\nSelecting "Merge" will update them with new information.',
        buttons: [
          { label: 'Merge', value: 'merge' },
          { label: 'Save new', value: 'save' },
          { label: 'Cancel', value: 'cancel' },
        ],
      });
      if (result === 'cancel') return;
      if (result === 'merge') {
        selection = venuesToUpdate;
      }
    }

    if (selection.length === 0) {
      const geometry: Point = { type: 'Point', coordinates: [lon, lat] };
      const venueId = wmeSDK.DataModel.Venues.addVenue({ category: 'TRANSPORTATION', geometry });
      const added = wmeSDK.DataModel.Venues.getById({ venueId: venueId.toString() }) as Venue | null;
      if (added) selection = [added];
    }

    for (const venue of selection) {
      wmeSDK.DataModel.Venues.updateVenue({
        venueId: venue.id.toString(),
        name,
        aliases,
        categories: venueCategories as unknown as VenueCategoryId[],
      });
    }

    wmeSDK.Editing.setSelection({
      selection: { ids: selection.map((v) => v.id.toString()), objectType: 'venue' },
    });
    wmeSDK.Map.removeFeatureFromLayer({ layerName: this.name, featureId });
  }
}

