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

import { WmeSDK, VenueCategoryId } from "wme-sdk-typings";
import { SBBDataLayer, SBBRecord } from "./sbbDataLayer";
import { showWmeDialog } from "./utils";
import { centroid, distance, point, Units } from "@turf/turf";
import type {
  Geometry,
  MultiPolygon,
  Point as GeoPoint,
  Polygon,
} from "geojson";

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

interface RecordNameResult {
  name: string;
  aliases: string[];
  shortName: string;
}

interface PublicTransportStopsLayerConstructorArgs {
  name: string;
  styleRules?: Array<{
    style: Record<string, unknown>;
  }>;
}

type VenueGeometry =
  | GeoPoint
  | Polygon
  | MultiPolygon
  | {
      type: string;
      coordinates: unknown;
    };

interface VenueLike {
  id: string | number;
  name: string;
  categories: string[];
  geometry: VenueGeometry;
  _updateCoordinates?: boolean;
}

class PublicTransportStopsLayer extends SBBDataLayer {
  venueInnerTypeMapping: Map<string, string>;
  defaultVenueInnerType: string;

  constructor(args: PublicTransportStopsLayerConstructorArgs) {
    super(args);
    this.dataSet = "haltestelle-haltekante";
    this.venueInnerTypeMapping = new Map();
    this.defaultVenueInnerType = "arrêt";
    this.venueInnerTypeMapping.set("TRAIN", "gare");
    this.venueInnerTypeMapping.set("BOAT", "port");
    this.venueInnerTypeMapping.set("CHAIRLIFT", "remontée mécanique");
  }

  meansOfTransport(args: { meansoftransport: string }): string[] {
    return Array.from(args.meansoftransport.split("|"));
  }

  venueCategories(args: { meansoftransport: string }): string[] {
    const meansOfTransport = this.meansOfTransport({
      meansoftransport: args.meansoftransport,
    });
    return Array.from(meansOfTransport).map((mean) => {
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

  private venuePointFromGeometry(
    geometry: VenueGeometry,
  ): ReturnType<typeof point> | null {
    if (geometry.type === "Point") {
      const coords = geometry.coordinates as number[];
      if (!Array.isArray(coords) || coords.length < 2) return null;
      const [vLon, vLat] = coords;
      if (typeof vLon !== "number" || typeof vLat !== "number") return null;
      return point([vLon, vLat]);
    }

    if (geometry.type === "Polygon" || geometry.type === "MultiPolygon") {
      return centroid({
        type: "Feature",
        geometry: geometry as Geometry,
        properties: {},
      });
    }

    return null;
  }

  private isVenueWithinRadius(args: {
    venue: VenueLike;
    stopPoint: ReturnType<typeof point>;
    radiusMeters: number;
  }): boolean {
    const { venue, stopPoint, radiusMeters } = args;
    const venuePoint = this.venuePointFromGeometry(venue.geometry);
    if (!venuePoint) return false;
    const options = { units: "meters" as Units };
    const distMeters = distance(stopPoint, venuePoint, options);
    return distMeters <= radiusMeters;
  }

  async shouldDrawRecord(args: {
    wmeSDK: WmeSDK;
    record: unknown;
  }): Promise<boolean> {
    const { wmeSDK, record } = args;
    const stop = record as TransportStop;

    if (!stop.meansoftransport || stop.meansoftransport === "") {
      return false;
    }

    const { name } = this.recordName({ record: stop });
    const venueCategories = this.venueCategories({
      meansoftransport: stop.meansoftransport,
    });
    const venues = wmeSDK.DataModel.Venues.getAll() as VenueLike[];

    const stopLonLat = this.stopLonLat(stop);
    // If coordinates are missing, keep drawing to let the user handle it.
    if (!stopLonLat) {
      return true;
    }

    const stopPoint = point([stopLonLat.lon, stopLonLat.lat]);

    // Only skip drawing if an existing venue has the same name, matching category, and is within 5m.
    const hasSameNameTypeAndNearby = venues.some((v) => {
      if (v.name !== name) return false;
      const hasMatchingCategory = v.categories.some((cat) =>
        venueCategories.includes(cat),
      );
      if (!hasMatchingCategory) return false;

      const hasNearby = this.isVenueWithinRadius({
        venue: v,
        stopPoint,
        radiusMeters: 5,
      });

      if (!hasNearby) return false;
      return true;
    });

    return !hasSameNameTypeAndNearby;
  }

  recordName(args: { record: TransportStop }): RecordNameResult {
    const { record } = args;

    let organizationAbbreviation = record.businessorganisationabbreviationde;
    let organizationName = record.businessorganisationdescriptionde;
    const aliases: string[] = [];
    let name = record.designationofficial || record.designation || "Bus Stop";

    // Remove explicit chairlift marker if present; we will append inner type later
    name = name.replace(/\(télésiège\)/i, "");
    const splittedName = name.split(",");

    if (
      splittedName.length === 2 &&
      splittedName[0].trim() === record.municipalityname
    ) {
      name = splittedName[1];
    }
    // We don't want to remove the municipality name if:
    // 1) There's only the municipality name as name (like in cff stations name)
    // 2) The name of the stop is `municipality name`-something
    else if (
      name.includes(record.municipalityname) &&
      name.replace(record.municipalityname, "") !== "" &&
      !name.replace(record.municipalityname, "").startsWith("-")
    ) {
      name = name.replace(record.municipalityname, "");
    }
    name = name.trim();
    name = String(name).charAt(0).toUpperCase() + String(name).slice(1);

    const meansOfTransport = this.meansOfTransport({
      meansoftransport: record.meansoftransport,
    });
    const venueInnerType = meansOfTransport
      .map(
        (mean) =>
          this.venueInnerTypeMapping.get(mean) || this.defaultVenueInnerType,
      )
      .join(", ");

    if (organizationAbbreviation.toLowerCase() === "sbb") {
      aliases.push(`${name} (${venueInnerType} ${organizationName})`);
      aliases.push(`${name} (${venueInnerType} ${organizationAbbreviation})`);
      organizationAbbreviation = "CFF";
      organizationName = "Chemins de fer fédéraux CFF";
    } else if (
      [
        "trn/tc",
        "trn/autovr",
        "trn/autrvt",
        "trn-tn",
        "trn-cmn",
        "trn-rvt",
      ].indexOf(organizationAbbreviation.toLowerCase()) !== -1
    ) {
      organizationAbbreviation = "transN";
      organizationName = "Transports Publics Neuchâtelois SA";
    } else if (organizationAbbreviation.toLowerCase() === "pag") {
      organizationAbbreviation = "";
      organizationName = "CarPostal SA";
    }

    const shortName = name;

    if (organizationAbbreviation !== "") {
      aliases.push(`${name} (${venueInnerType} ${organizationName})`);
      name = `${name} (${venueInnerType} ${organizationAbbreviation})`;
    } else {
      name = `${name} (${venueInnerType} ${organizationName})`;
    }

    return {
      name,
      aliases,
      shortName,
    };
  }

  async featureClicked(args: {
    wmeSDK: WmeSDK;
    featureId: string | number;
  }): Promise<void> {
    const { wmeSDK, featureId } = args;
    const stop = this.features.get(featureId) as TransportStop;

    const stopLonLat = this.stopLonLat(stop);
    if (!stopLonLat) {
      return; // Cannot place without coordinates
    }
    const { lat, lon } = stopLonLat;
    const zoomLevel = wmeSDK.Map.getZoomLevel();

    // Venues are shown (and available in getAll()) only from zoom level 17
    if (zoomLevel < 17) {
      wmeSDK.Map.setMapCenter({ lonLat: { lat, lon }, zoomLevel: 17 });
      this.render({ wmeSDK });
      return;
    }

    // Try to find if a venue exists with the designation, in a radius of 75 m.
    const { name, shortName, aliases } = this.recordName({ record: stop });
    const venueCategories = this.venueCategories({
      meansoftransport: stop.meansoftransport,
    });
    let venues = wmeSDK.DataModel.Venues.getAll() as VenueLike[];

    // First match by category intersection (train with train, bus with bus, etc.); allow TRANSPORTATION as fallback
    venues = venues.filter((v) =>
      v.categories.some((cat) => venueCategories.includes(cat)),
    );

    let venuesToUpdate: VenueLike[] = [];
    if (venues.length > 0) {
      // Use Turf.js to calculate distance and filter venues within 75m first
      const stopPoint = point([lon, lat]);
      venuesToUpdate = venues.filter((venue) =>
        this.isVenueWithinRadius({
          venue,
          stopPoint,
          radiusMeters: 75,
        }),
      );

      // Then match by name similarity to avoid unrelated points
      venuesToUpdate = venuesToUpdate.filter((r) =>
        r.name.toLowerCase().includes(shortName.toLowerCase()),
      );

      // Only show dialog if there are actually venues nearby
      if (venuesToUpdate.length > 0) {
        wmeSDK.Editing.setSelection({
          selection: {
            ids: venuesToUpdate.map((venue) => venue.id.toString()),
            objectType: "venue",
          },
        });

        const result = await showWmeDialog({
          message: `Il semble qu'il existe déjà ${venuesToUpdate.length} arrêt(s) avec ce nom.<br/>Nous les avons sélectionnés pour vous.<br/>Que voulez-vous faire?<br/>Sélectionner <pre style="display: inline;">Fusionner</pre> appliquera les informations aux anciens points sans créer le nouveau.`,
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

        if (result === "cancel") {
          return;
        } else if (result === "save") {
          venuesToUpdate = [];
        } else if (result === "merge-with-coords") {
          // Mark venues to have coordinates updated
          venuesToUpdate = venuesToUpdate.map((v) => ({
            ...v,
            _updateCoordinates: true,
          }));
        }
      }
    }

    const geometry = {
      type: "Point" as const,
      coordinates: [lon, lat] as [number, number],
    };

    const venue = {
      category: "TRANSPORTATION" as const,
      geometry,
    };

    if (venuesToUpdate.length === 0) {
      const venueId = wmeSDK.DataModel.Venues.addVenue(venue);
      const newVenue = wmeSDK.DataModel.Venues.getById({
        venueId: venueId.toString(),
      });
      if (newVenue) {
        venuesToUpdate = [newVenue];
      }
    }

    for (const venue of venuesToUpdate) {
      const updateArgs = {
        venueId: venue.id.toString(),
        name,
        aliases,
        categories: venueCategories as VenueCategoryId[],
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

    wmeSDK.Editing.setSelection({
      selection: {
        ids: venuesToUpdate.map((venue) => venue.id.toString()),
        objectType: "venue",
      },
    });

    wmeSDK.Map.removeFeatureFromLayer({
      featureId,
      layerName: this.name,
    });
  }
}

export { PublicTransportStopsLayer };
