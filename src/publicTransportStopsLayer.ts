/*
 * Copyright (c) 2025 Maël Pedretti
 *
 * This file is part of WME Switzerland Helper.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { WmeSDK, VenueCategoryId, SdkFeature, SdkFeatureStyleRule } from "wme-sdk-typings";
import { SBBDataFetcher, SBBRecord } from "./sbbDataLayer";
import { FeatureLayer } from "./featureLayer";
import { showWmeDialog, waitForMapIdle } from "./utils";
import { StopGeometry } from "./stopGeometry";
import { StopNameFormatter } from "./stopNameFormatter";
import { VenueMatcher, type VenueLike } from "./venueMatcher";

interface TransportStop extends SBBRecord {
  meansoftransport: string;
  designationofficial?: string;
  designation?: string;
  municipalityname: string;
  businessorganisationabbreviationde: string;
  businessorganisationdescriptionde: string;
  lat?: number;
  lon?: number;
}

interface PublicTransportStopsLayerConstructorArgs {
  name: string;
  styleRules?: SdkFeatureStyleRule[];
}

class PublicTransportStopsLayer extends FeatureLayer {
  private readonly dataFetcher: SBBDataFetcher;
  private readonly stopGeometry: StopGeometry;
  private readonly nameFormatter: StopNameFormatter;
  private readonly venueMatcher: VenueMatcher;

  constructor(
    args: PublicTransportStopsLayerConstructorArgs & { wmeSDK: WmeSDK },
  ) {
    super({ ...args, wmeSDK: args.wmeSDK, minZoomLevel: 14 });
    this.dataFetcher = new SBBDataFetcher({ dataSet: "haltestelle-haltekante" });
    this.stopGeometry = new StopGeometry();
    this.nameFormatter = new StopNameFormatter();
    this.venueMatcher = new VenueMatcher();
  }

  getRecordId(args: { record: unknown }): string {
    const record = args.record as TransportStop;
    return String(record.number);
  }

  mapRecordToFeature(args: { record: unknown }): SdkFeature {
    const record = args.record as TransportStop;
    return {
      geometry: {
        coordinates: [
          record.geopos_haltestelle.lon,
          record.geopos_haltestelle.lat,
        ],
        type: "Point",
      },
      type: "Feature",
      id: String(record.number),
    };
  }

  async *fetchData(args: {
    wmeSDK: WmeSDK;
  }): AsyncGenerator<TransportStop[], void, unknown> {
    const { wmeSDK } = args;
    for await (const batch of this.dataFetcher.fetchRecords({ wmeSDK })) {
      yield batch as TransportStop[];
    }
  }

  meansOfTransport(args: { meansoftransport: string }): string[] {
    return args.meansoftransport.split("|");
  }

  venueCategories(args: { meansoftransport: string }): string[] {
    const meansOfTransport = this.meansOfTransport(args);
    return meansOfTransport.map((mean) => {
      if (mean === "METRO") return "SUBWAY_STATION";
      if (mean === "BOAT") return "SEAPORT_MARINA_HARBOR";
      if (mean === "CHAIRLIFT") return "TRANSPORTATION";
      return `${mean}_STATION`;
    });
  }

  private stopLonLat(
    record: TransportStop,
  ): { lat: number; lon: number } | null {
    const lat = parseFloat(
      String(record.geopos_haltestelle?.lat || record.lat || 0),
    );
    const lon = parseFloat(
      String(record.geopos_haltestelle?.lon || record.lon || 0),
    );

    if (Number.isNaN(lat) || Number.isNaN(lon)) return null;
    return { lat, lon };
  }

  getFilterContext(args: { wmeSDK: WmeSDK }): { venues: VenueLike[] } {
    const { wmeSDK } = args;
    const venues = wmeSDK.DataModel.Venues.getAll() as VenueLike[];
    return { venues };
  }

  shouldDrawRecord(args: {
    wmeSDK: WmeSDK;
    record: unknown;
    context?: { venues: VenueLike[] };
  }): boolean {
    const { record, context } = args;
    const stop = record as TransportStop;

    if (!stop.meansoftransport || stop.meansoftransport === "") {
      return false;
    }

    const stopLonLat = this.stopLonLat(stop);
    if (!stopLonLat) {
      return true;
    }

    const { name } = this.nameFormatter.formatName(stop);
    const venueCategories = this.venueCategories({
      meansoftransport: stop.meansoftransport,
    });
    const venues = context?.venues ?? [];

    return !this.venueMatcher.hasExactMatch({
      venues,
      stopLon: stopLonLat.lon,
      stopLat: stopLonLat.lat,
      stopName: name,
      categories: venueCategories,
    });
  }

  private handleZoomRequired(args: {
    wmeSDK: WmeSDK;
    lat: number;
    lon: number;
  }): void {
    const { wmeSDK, lat, lon } = args;
    this.unregisterEvents();

    wmeSDK.Map.setMapCenter({ lonLat: { lat, lon }, zoomLevel: 17 });

    this.registerEvents({ wmeSDK });

    waitForMapIdle({ wmeSDK, intervalMs: 50, maxTries: 60 }).then(() => {
      this.refilterFeatures({ wmeSDK });
    });
  }

  private async promptUserAction(args: {
    wmeSDK: WmeSDK;
    matchingVenues: VenueLike[];
  }): Promise<{
    action: "merge" | "merge-with-coords" | "save" | "cancel";
    venues: VenueLike[];
  }> {
    const { wmeSDK, matchingVenues } = args;

    wmeSDK.Editing.setSelection({
      selection: {
        ids: matchingVenues.map((venue) => venue.id.toString()),
        objectType: "venue",
      },
    });

    const result = await showWmeDialog({
      message: `Il semble qu'il existe déjà ${matchingVenues.length} arrêt(s) avec ce nom.<br/>Nous les avons sélectionnés pour vous.<br/>Que voulez-vous faire?<br/>Sélectionner <pre style="display: inline;">Fusionner</pre> appliquera les informations aux anciens points sans créer le nouveau.`,
      buttons: [
        { label: "Fusionner", value: "merge" },
        {
          label: "Fusionner et mettre à jour les coordonnées",
          value: "merge-with-coords",
        },
        { label: "Enregistrer le nouveau", value: "save" },
        { label: "Annuler", value: "cancel" },
      ],
    });

    let venuesToUpdate = matchingVenues;

    if (result === "save") {
      venuesToUpdate = [];
    } else if (result === "merge-with-coords") {
      venuesToUpdate = matchingVenues.map((v) => ({
        ...v,
        _updateCoordinates: true,
      }));
    }

    return {
      action: result as "merge" | "merge-with-coords" | "save" | "cancel",
      venues: venuesToUpdate,
    };
  }

  private async createOrUpdateVenue(args: {
    wmeSDK: WmeSDK;
    venuesToUpdate: Array<VenueLike & { _updateCoordinates?: boolean }>;
    lon: number;
    lat: number;
    name: string;
    aliases: string[];
    categories: string[];
  }): Promise<Array<VenueLike & { _updateCoordinates?: boolean }>> {
    const { wmeSDK, venuesToUpdate, lon, lat, name, aliases, categories } =
      args;

    let venues = venuesToUpdate;

    if (venues.length === 0) {
      const geometry = {
        type: "Point" as const,
        coordinates: [lon, lat] as [number, number],
      };
      const venueId = wmeSDK.DataModel.Venues.addVenue({
        category: "TRANSPORTATION" as const,
        geometry,
      });
      const newVenue = wmeSDK.DataModel.Venues.getById({
        venueId: venueId.toString(),
      });
      if (newVenue) {
        venues = [newVenue as VenueLike];
      }
    }

    for (const venue of venues) {
      const updateArgs = {
        venueId: venue.id.toString(),
        name,
        aliases,
        categories: categories as VenueCategoryId[],
        ...(venue._updateCoordinates && {
          geometry: {
            type: "Point" as const,
            coordinates: [lon, lat] as [number, number],
          },
        }),
      };

      wmeSDK.DataModel.Venues.updateVenue(
        updateArgs as Parameters<typeof wmeSDK.DataModel.Venues.updateVenue>[0],
      );
    }

    return venues;
  }

  async featureClicked(args: {
    wmeSDK: WmeSDK;
    featureId: string | number;
  }): Promise<void> {
    const { wmeSDK, featureId } = args;
    const stop = this.features.get(featureId) as TransportStop;

    const stopLonLat = this.stopLonLat(stop);
    if (!stopLonLat) {
      return;
    }

    const { lat, lon } = stopLonLat;
    const zoomLevel = wmeSDK.Map.getZoomLevel();

    if (zoomLevel < 17) {
      this.handleZoomRequired({ wmeSDK, lat, lon });
      return;
    }

    const { name, shortName, aliases } = this.nameFormatter.formatName(stop);
    const venueCategories = this.venueCategories({
      meansoftransport: stop.meansoftransport,
    });
    const allVenues = wmeSDK.DataModel.Venues.getAll() as VenueLike[];
    const categoryFilteredVenues = allVenues.filter((v) =>
      v.categories.some((cat) => venueCategories.includes(cat)),
    );

    let venuesToUpdate: Array<VenueLike & { _updateCoordinates?: boolean }> =
      [];

    if (categoryFilteredVenues.length > 0) {
      const matchingVenues = this.venueMatcher.findMatchingVenues({
        venues: categoryFilteredVenues,
        stopLon: lon,
        stopLat: lat,
        stopName: name,
        stopShortName: shortName,
        categories: venueCategories,
        radiusMeters: 75,
      });

      if (matchingVenues.length > 0) {
        const { action, venues } = await this.promptUserAction({
          wmeSDK,
          matchingVenues,
        });

        if (action === "cancel") {
          return;
        }

        venuesToUpdate = venues as Array<
          VenueLike & { _updateCoordinates?: boolean }
        >;
      }
    }

    const updatedVenues = await this.createOrUpdateVenue({
      wmeSDK,
      venuesToUpdate,
      lon,
      lat,
      name,
      aliases,
      categories: venueCategories,
    });

    wmeSDK.Editing.setSelection({
      selection: {
        ids: updatedVenues.map((venue) => venue.id.toString()),
        objectType: "venue",
      },
    });
    this.removeFeature({ wmeSDK, featureId });
  }
}

export { PublicTransportStopsLayer };
