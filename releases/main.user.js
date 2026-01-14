// ==UserScript==
// @name        WME Switzerland Helper
// @namespace   wme-sdk-scripts
// @version     1.2.4
// @description WME Switzerland Helper is a userscript that provides various tools and enhancements for Waze Map Editor (WME) users in Switzerland.
// @updateURL	  https://raw.githubusercontent.com/73VW/WME-Switzerland-Helper/releases/releases/main.user.js
// @downloadURL https://raw.githubusercontent.com/73VW/WME-Switzerland-Helper/releases/releases/main.user.js
// @author      Maël Pedretti (Marelitaw)
// @match       https://www.waze.com/editor*
// @match       https://beta.waze.com/editor*
// @match       https://www.waze.com/*/editor*
// @match       https://beta.waze.com/*/editor*
// @exclude     https://www.waze.com/user/editor*
// @exclude     https://beta.waze.com/user/editor*
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      api3.geo.admin.ch
// @connect      data.sbb.ch
// ==/UserScript==

(function () {
    'use strict';

    const STORAGE_KEY = "wme-switzerland-helper-layer-state";
    function getLayerStates() {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            return stored ? JSON.parse(stored) : {};
        }
        catch {
            return {};
        }
    }
    function saveLayerState(layerName, checked) {
        try {
            const states = getLayerStates();
            states[layerName] = checked;
            localStorage.setItem(STORAGE_KEY, JSON.stringify(states));
        }
        catch {
            console.warn("Failed to save layer state to localStorage");
        }
    }
    function isLayerEnabled(layerName) {
        const states = getLayerStates();
        return layerName in states ? states[layerName] : null;
    }

    class Layer {
        constructor(args) {
            this.name = args.name;
            this.eventCleanups = [];
            args.wmeSDK.LayerSwitcher.addLayerCheckbox({ name: this.name });
            this.registerCheckboxHandler({ wmeSDK: args.wmeSDK });
        }
        removeFromMap(args) {
            args.wmeSDK.Map.removeLayer({ layerName: this.name });
            this.unregisterEvents();
        }
        unregisterEvents() {
            for (const cleanup of this.eventCleanups) {
                try {
                    cleanup();
                }
                catch {
                    console.warn("Failed to cleanup layer event listener");
                }
            }
            this.eventCleanups = [];
        }
        registerCheckboxHandler(args) {
            const { wmeSDK } = args;
            const cleanup = wmeSDK.Events.on({
                eventName: "wme-layer-checkbox-toggled",
                eventHandler: ({ name, checked }) => {
                    if (name !== this.name)
                        return;
                    saveLayerState(this.name, checked);
                    if (checked) {
                        this.addToMap({ wmeSDK });
                        this.registerEvents({ wmeSDK });
                    }
                    else {
                        this.removeFromMap({ wmeSDK });
                    }
                },
            });
            this.eventCleanups.push(cleanup);
        }
        restoreState(args) {
            const { wmeSDK } = args;
            const enabled = isLayerEnabled(this.name);
            if (enabled === true) {
                this.addToMap({ wmeSDK });
                wmeSDK.LayerSwitcher.setLayerCheckboxChecked({
                    name: this.name,
                    isChecked: true,
                });
            }
        }
    }

    class TileLayer extends Layer {
        constructor(args) {
            super({ name: args.name, wmeSDK: args.wmeSDK });
            this.tileHeight = args.tileHeight;
            this.tileWidth = args.tileWidth;
            this.fileName = args.fileName;
            this.servers = args.servers;
            this.zIndex = args.zIndex ?? 2035;
        }
        addToMap(args) {
            const wmeSDK = args.wmeSDK;
            wmeSDK.Map.addTileLayer({
                layerName: this.name,
                layerOptions: {
                    tileHeight: this.tileHeight,
                    tileWidth: this.tileWidth,
                    url: {
                        fileName: this.fileName,
                        servers: this.servers,
                    },
                },
            });
            wmeSDK.Map.setLayerZIndex({
                layerName: this.name,
                zIndex: this.zIndex,
            });
        }
        registerEvents(args) {
        }
    }

    class SBBDataFetcher {
        constructor(args) {
            this.baseUrl = "https://data.sbb.ch/api/explore/v2.1/catalog/datasets";
            this.dataSet = args.dataSet;
            this.maxRecordsPerPage = 50;
        }
        async *fetchRecords(args) {
            const { wmeSDK, offset = 0 } = args;
            const mapExtent = wmeSDK.Map.getMapExtent();
            const x1 = mapExtent[0];
            const y1 = mapExtent[1];
            const x2 = mapExtent[2];
            const y2 = mapExtent[3];
            const url = `${this.baseUrl}/${this.dataSet}/records?where=in_bbox(geopos_haltestelle,${y1},${x1},${y2},${x2})&limit=50&offset=${offset}`;
            const response = await GM.xmlHttpRequest({
                method: "GET",
                url,
                responseType: "json",
            });
            const batch = response.response?.results || [];
            yield batch;
            if (batch.length === this.maxRecordsPerPage) {
                yield* this.fetchRecords({
                    wmeSDK,
                    offset: offset + this.maxRecordsPerPage,
                });
            }
        }
    }

    function showWmeDialog(options) {
        const { message, buttons } = options;
        return new Promise((resolve) => {
            const modal = document.createElement("div");
            modal.style.position = "fixed";
            modal.style.top = "50%";
            modal.style.left = "50%";
            modal.style.transform = "translate(-50%, -50%)";
            modal.style.background = "#fff";
            modal.style.padding = "20px";
            modal.style.boxShadow = "0 2px 10px rgba(0,0,0,0.5)";
            modal.style.zIndex = "10000";
            modal.style.borderRadius = "6px";
            modal.style.textAlign = "center";
            modal.style.minWidth = "200px";
            const msg = document.createElement("p");
            msg.innerHTML = message;
            modal.appendChild(msg);
            buttons.forEach(({ label, value }) => {
                const btn = document.createElement("button");
                btn.textContent = label;
                btn.className = "btn btn-default";
                btn.style.margin = "5px";
                btn.onclick = () => {
                    modal.remove();
                    resolve(value);
                };
                modal.appendChild(btn);
            });
            document.body.appendChild(modal);
        });
    }
    async function waitForMapIdle(args) {
        const { wmeSDK, intervalMs = 50, maxTries = 60 } = args;
        for (let i = 0; i < maxTries; i += 1) {
            if (!wmeSDK.State.isMapLoading()) {
                await new Promise((resolve) => setTimeout(resolve, 100));
                return;
            }
            await new Promise((resolve) => setTimeout(resolve, intervalMs));
        }
    }

    class FeatureLayer extends Layer {
        constructor(args) {
            super({ name: args.name, wmeSDK: args.wmeSDK });
            this.styleContext = args.styleContext;
            this.styleRules = args.styleRules;
            this.features = new Map();
            this.visibleFeatureIds = new Set();
            this.minZoomLevel = args.minZoomLevel ?? 15;
        }
        async addToMap(args) {
            const { wmeSDK } = args;
            wmeSDK.Map.addLayer({
                layerName: this.name,
                styleContext: this.styleContext,
                styleRules: this.styleRules,
            });
            wmeSDK.Events.trackLayerEvents({ layerName: this.name });
            await this.render({ wmeSDK });
        }
        removeFromMap(args) {
            super.removeFromMap(args);
            this.visibleFeatureIds.clear();
        }
        drawFeaturesBatch(args) {
            const { wmeSDK, records } = args;
            const wazeFeatures = records.map((r) => this.mapRecordToFeature({ record: r }));
            wmeSDK.Map.addFeaturesToLayer({
                features: wazeFeatures,
                layerName: this.name,
            });
        }
        removeFeature(args) {
            const { wmeSDK, featureId } = args;
            const featureIdStr = String(featureId);
            wmeSDK.Map.removeFeatureFromLayer({
                featureId: featureIdStr,
                layerName: this.name,
            });
            this.visibleFeatureIds.delete(featureIdStr);
        }
        refilterFeatures(args) {
            const { wmeSDK } = args;
            const checked = wmeSDK.LayerSwitcher.isLayerCheckboxChecked({
                name: this.name,
            });
            if (!checked) {
                return;
            }
            const context = this.getFilterContext?.({ wmeSDK });
            const toHide = Array.from(this.visibleFeatureIds).filter((featureId) => {
                const record = this.features.get(featureId);
                return record && !this.shouldDrawRecord({ wmeSDK, record, context });
            });
            if (toHide.length > 0) {
                wmeSDK.Map.removeFeaturesFromLayer({
                    featureIds: toHide,
                    layerName: this.name,
                });
                for (const featureId of toHide) {
                    this.visibleFeatureIds.delete(featureId);
                }
            }
        }
        async render(args) {
            const { wmeSDK } = args;
            const checked = wmeSDK.LayerSwitcher.isLayerCheckboxChecked({
                name: this.name,
            });
            if (!checked) {
                return;
            }
            const zoomLevel = wmeSDK.Map.getZoomLevel();
            if (zoomLevel < this.minZoomLevel) {
                return;
            }
            const allRecords = [];
            for await (const batch of this.fetchData({ wmeSDK })) {
                allRecords.push(...batch);
            }
            const newRecordsById = new Map();
            for (const record of allRecords) {
                const recordId = this.getRecordId({ record });
                newRecordsById.set(recordId, record);
                this.features.set(recordId, record);
            }
            const notYetDrawn = Array.from(newRecordsById.keys()).filter((id) => !this.visibleFeatureIds.has(id));
            const context = this.getFilterContext?.({ wmeSDK });
            const recordsToDraw = notYetDrawn
                .map((id) => newRecordsById.get(id))
                .filter((record) => this.shouldDrawRecord({ wmeSDK, record, context }));
            if (recordsToDraw.length > 0) {
                this.drawFeaturesBatch({ wmeSDK, records: recordsToDraw });
                for (const record of recordsToDraw) {
                    this.visibleFeatureIds.add(this.getRecordId({ record }));
                }
            }
            const obsoleteIds = Array.from(this.visibleFeatureIds).filter((id) => !newRecordsById.has(id) ||
                !this.shouldDrawRecord({
                    wmeSDK,
                    record: this.features.get(id),
                    context,
                }));
            for (const featureId of obsoleteIds) {
                wmeSDK.Map.removeFeatureFromLayer({
                    featureId,
                    layerName: this.name,
                });
                this.visibleFeatureIds.delete(featureId);
                this.features.delete(featureId);
            }
        }
        registerEvents(args) {
            const { wmeSDK } = args;
            const cleanupMove = wmeSDK.Events.on({
                eventName: "wme-map-move-end",
                eventHandler: () => {
                    waitForMapIdle({ wmeSDK, intervalMs: 50, maxTries: 60 }).then(() => {
                        this.render({ wmeSDK });
                    });
                },
            });
            this.eventCleanups.push(cleanupMove);
            const cleanupClick = wmeSDK.Events.on({
                eventName: "wme-layer-feature-clicked",
                eventHandler: async ({ featureId, layerName }) => {
                    if (layerName !== this.name)
                        return;
                    await this.featureClicked({ wmeSDK, featureId });
                },
            });
            this.eventCleanups.push(cleanupClick);
        }
        restoreState(args) {
            super.restoreState(args);
            const { wmeSDK } = args;
            const checked = wmeSDK.LayerSwitcher.isLayerCheckboxChecked({
                name: this.name,
            });
            if (checked) {
                this.render({ wmeSDK });
                this.registerEvents({ wmeSDK });
            }
        }
    }

    // index.ts
    var earthRadius = 63710088e-1;
    var factors = {
      centimeters: earthRadius * 100,
      centimetres: earthRadius * 100,
      degrees: 360 / (2 * Math.PI),
      feet: earthRadius * 3.28084,
      inches: earthRadius * 39.37,
      kilometers: earthRadius / 1e3,
      kilometres: earthRadius / 1e3,
      meters: earthRadius,
      metres: earthRadius,
      miles: earthRadius / 1609.344,
      millimeters: earthRadius * 1e3,
      millimetres: earthRadius * 1e3,
      nauticalmiles: earthRadius / 1852,
      radians: 1,
      yards: earthRadius * 1.0936
    };
    function feature(geom, properties, options = {}) {
      const feat = { type: "Feature" };
      if (options.id === 0 || options.id) {
        feat.id = options.id;
      }
      if (options.bbox) {
        feat.bbox = options.bbox;
      }
      feat.properties = {};
      feat.geometry = geom;
      return feat;
    }
    function point(coordinates, properties, options = {}) {
      if (!coordinates) {
        throw new Error("coordinates is required");
      }
      if (!Array.isArray(coordinates)) {
        throw new Error("coordinates must be an Array");
      }
      if (coordinates.length < 2) {
        throw new Error("coordinates must be at least 2 numbers long");
      }
      if (!isNumber(coordinates[0]) || !isNumber(coordinates[1])) {
        throw new Error("coordinates must contain numbers");
      }
      const geom = {
        type: "Point",
        coordinates
      };
      return feature(geom, properties, options);
    }
    function radiansToLength(radians, units = "kilometers") {
      const factor = factors[units];
      if (!factor) {
        throw new Error(units + " units is invalid");
      }
      return radians * factor;
    }
    function degreesToRadians(degrees) {
      const normalisedDegrees = degrees % 360;
      return normalisedDegrees * Math.PI / 180;
    }
    function isNumber(num) {
      return !isNaN(num) && num !== null && !Array.isArray(num);
    }

    // index.ts
    function getCoord(coord) {
      if (!coord) {
        throw new Error("coord is required");
      }
      if (!Array.isArray(coord)) {
        if (coord.type === "Feature" && coord.geometry !== null && coord.geometry.type === "Point") {
          return [...coord.geometry.coordinates];
        }
        if (coord.type === "Point") {
          return [...coord.coordinates];
        }
      }
      if (Array.isArray(coord) && coord.length >= 2 && !Array.isArray(coord[0]) && !Array.isArray(coord[1])) {
        return [...coord];
      }
      throw new Error("coord must be GeoJSON Point or an Array of numbers");
    }

    // index.ts
    function distance(from, to, options = {}) {
      var coordinates1 = getCoord(from);
      var coordinates2 = getCoord(to);
      var dLat = degreesToRadians(coordinates2[1] - coordinates1[1]);
      var dLon = degreesToRadians(coordinates2[0] - coordinates1[0]);
      var lat1 = degreesToRadians(coordinates1[1]);
      var lat2 = degreesToRadians(coordinates2[1]);
      var a = Math.pow(Math.sin(dLat / 2), 2) + Math.pow(Math.sin(dLon / 2), 2) * Math.cos(lat1) * Math.cos(lat2);
      return radiansToLength(
        2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)),
        options.units
      );
    }

    class StopGeometry {
        pointToLineSegmentDistance(args) {
            const { point: p, lineStart, lineEnd } = args;
            const [px, py] = p.geometry.coordinates;
            const [x1, y1] = lineStart;
            const [x2, y2] = lineEnd;
            const A = px - x1;
            const B = py - y1;
            const C = x2 - x1;
            const D = y2 - y1;
            const dot = A * C + B * D;
            const lenSq = C * C + D * D;
            let param = -1;
            if (lenSq !== 0) {
                param = dot / lenSq;
            }
            let xx;
            let yy;
            if (param < 0) {
                xx = x1;
                yy = y1;
            }
            else if (param > 1) {
                xx = x2;
                yy = y2;
            }
            else {
                xx = x1 + param * C;
                yy = y1 + param * D;
            }
            const closestPoint = point([xx, yy]);
            return distance(p, closestPoint, { units: "meters" });
        }
        distanceToVenueGeometry(args) {
            const { stopPoint, geometry } = args;
            if (geometry.type === "Point") {
                const coords = geometry.coordinates;
                if (!Array.isArray(coords) || coords.length < 2)
                    return null;
                const [vLon, vLat] = coords;
                if (typeof vLon !== "number" || typeof vLat !== "number")
                    return null;
                const venuePoint = point([vLon, vLat]);
                return distance(stopPoint, venuePoint, { units: "meters" });
            }
            if (geometry.type === "Polygon") {
                const polygon = geometry;
                let minDistance = Infinity;
                for (const ring of polygon.coordinates) {
                    for (let i = 0; i < ring.length - 1; i++) {
                        const dist = this.pointToLineSegmentDistance({
                            point: stopPoint,
                            lineStart: ring[i],
                            lineEnd: ring[i + 1],
                        });
                        minDistance = Math.min(minDistance, dist);
                    }
                }
                return minDistance;
            }
            if (geometry.type === "MultiPolygon") {
                const multiPolygon = geometry;
                let minDistance = Infinity;
                for (const polygon of multiPolygon.coordinates) {
                    for (const ring of polygon) {
                        for (let i = 0; i < ring.length - 1; i++) {
                            const dist = this.pointToLineSegmentDistance({
                                point: stopPoint,
                                lineStart: ring[i],
                                lineEnd: ring[i + 1],
                            });
                            minDistance = Math.min(minDistance, dist);
                        }
                    }
                }
                return minDistance;
            }
            return null;
        }
        isWithinRadius(args) {
            const { stopPoint, venueGeometry, radiusMeters } = args;
            const distMeters = this.distanceToVenueGeometry({
                stopPoint,
                geometry: venueGeometry,
            });
            if (distMeters === null)
                return false;
            return distMeters <= radiusMeters;
        }
    }

    class StopNameFormatter {
        constructor() {
            this.venueInnerTypeMapping = new Map();
            this.defaultVenueInnerType = "arrêt";
            this.venueInnerTypeMapping.set("TRAIN", "gare");
            this.venueInnerTypeMapping.set("BOAT", "port");
            this.venueInnerTypeMapping.set("CHAIRLIFT", "remontée mécanique");
        }
        meansOfTransport(meansoftransport) {
            return meansoftransport.split("|");
        }
        getVenueInnerType(meansoftransport) {
            const means = this.meansOfTransport(meansoftransport);
            return means
                .map((mean) => this.venueInnerTypeMapping.get(mean) || this.defaultVenueInnerType)
                .join(", ");
        }
        cleanStopName(name, municipalityname) {
            let cleaned = name.replace(/\(télésiège\)/i, "").trim();
            const splitted = cleaned.split(",");
            if (splitted.length === 2 && splitted[0].trim() === municipalityname) {
                cleaned = splitted[1];
            }
            else if (cleaned.includes(municipalityname) &&
                cleaned.replace(municipalityname, "") !== "" &&
                !cleaned.replace(municipalityname, "").startsWith("-")) {
                cleaned = cleaned.replace(municipalityname, "");
            }
            cleaned = cleaned.trim();
            return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
        }
        normalizeOrganization(abbreviation, fullName) {
            const abbrevLower = abbreviation.toLowerCase();
            if (abbrevLower === "sbb") {
                return {
                    abbreviation: "CFF",
                    fullName: "Chemins de fer fédéraux CFF",
                };
            }
            if ([
                "trn/tc",
                "trn/autovr",
                "trn/autrvt",
                "trn-tn",
                "trn-cmn",
                "trn-rvt",
            ].includes(abbrevLower)) {
                return {
                    abbreviation: "transN",
                    fullName: "Transports Publics Neuchâtelois SA",
                };
            }
            if (abbrevLower === "pag") {
                return {
                    abbreviation: "",
                    fullName: "CarPostal SA",
                };
            }
            return { abbreviation, fullName };
        }
        formatName(stop) {
            const rawName = stop.designationofficial || stop.designation || "Bus Stop";
            const cleanedName = this.cleanStopName(rawName, stop.municipalityname);
            const venueInnerType = this.getVenueInnerType(stop.meansoftransport);
            const { abbreviation, fullName } = this.normalizeOrganization(stop.businessorganisationabbreviationde, stop.businessorganisationdescriptionde);
            const aliases = [];
            const shortName = cleanedName;
            if (stop.businessorganisationabbreviationde.toLowerCase() === "sbb") {
                aliases.push(`${cleanedName} (${venueInnerType} ${stop.businessorganisationdescriptionde})`);
                aliases.push(`${cleanedName} (${venueInnerType} ${stop.businessorganisationabbreviationde})`);
            }
            if (abbreviation !== "") {
                aliases.push(`${cleanedName} (${venueInnerType} ${fullName})`);
                return {
                    name: `${cleanedName} (${venueInnerType} ${abbreviation})`,
                    aliases,
                    shortName,
                };
            }
            return {
                name: `${cleanedName} (${venueInnerType} ${fullName})`,
                aliases,
                shortName,
            };
        }
    }

    class VenueMatcher {
        constructor() {
            this.stopGeometry = new StopGeometry();
        }
        findMatchingVenues(args) {
            const { venues, stopLon, stopLat, stopName, stopShortName, categories, radiusMeters, } = args;
            const stopPoint = point([stopLon, stopLat]);
            const matchingVenues = venues.filter((venue) => {
                const hasMatchingCategory = venue.categories.some((cat) => categories.includes(cat));
                if (!hasMatchingCategory)
                    return false;
                const isWithinRadius = this.stopGeometry.isWithinRadius({
                    stopPoint,
                    venueGeometry: venue.geometry,
                    radiusMeters,
                });
                if (!isWithinRadius)
                    return false;
                return venue.name.toLowerCase().includes(stopShortName.toLowerCase());
            });
            return matchingVenues;
        }
        hasExactMatch(args) {
            const { venues, stopLon, stopLat, stopName, categories } = args;
            const stopPoint = point([stopLon, stopLat]);
            return venues.some((v) => {
                if (v.name !== stopName)
                    return false;
                const hasMatchingCategory = v.categories.some((cat) => categories.includes(cat));
                if (!hasMatchingCategory)
                    return false;
                return this.stopGeometry.isWithinRadius({
                    stopPoint,
                    venueGeometry: v.geometry,
                    radiusMeters: 5,
                });
            });
        }
    }

    class PublicTransportStopsLayer extends FeatureLayer {
        constructor(args) {
            super({ ...args, wmeSDK: args.wmeSDK, minZoomLevel: 14 });
            this.dataFetcher = new SBBDataFetcher({
                dataSet: "haltestelle-haltekante",
            });
            this.stopGeometry = new StopGeometry();
            this.nameFormatter = new StopNameFormatter();
            this.venueMatcher = new VenueMatcher();
        }
        getRecordId(args) {
            const record = args.record;
            return String(record.number);
        }
        mapRecordToFeature(args) {
            const record = args.record;
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
        async *fetchData(args) {
            const { wmeSDK } = args;
            for await (const batch of this.dataFetcher.fetchRecords({ wmeSDK })) {
                yield batch;
            }
        }
        meansOfTransport(args) {
            return args.meansoftransport.split("|");
        }
        venueCategories(args) {
            const meansOfTransport = this.meansOfTransport(args);
            return meansOfTransport.map((mean) => {
                if (mean === "METRO")
                    return "SUBWAY_STATION";
                if (mean === "BOAT")
                    return "SEAPORT_MARINA_HARBOR";
                if (mean === "CHAIRLIFT")
                    return "TRANSPORTATION";
                return `${mean}_STATION`;
            });
        }
        stopLonLat(record) {
            const lat = parseFloat(String(record.geopos_haltestelle?.lat || record.lat || 0));
            const lon = parseFloat(String(record.geopos_haltestelle?.lon || record.lon || 0));
            if (Number.isNaN(lat) || Number.isNaN(lon))
                return null;
            return { lat, lon };
        }
        getFilterContext(args) {
            const { wmeSDK } = args;
            const venues = wmeSDK.DataModel.Venues.getAll();
            return { venues };
        }
        shouldDrawRecord(args) {
            const { record, context } = args;
            const stop = record;
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
        handleZoomRequired(args) {
            const { wmeSDK, lat, lon } = args;
            this.unregisterEvents();
            wmeSDK.Map.setMapCenter({ lonLat: { lat, lon }, zoomLevel: 17 });
            this.registerEvents({ wmeSDK });
            waitForMapIdle({ wmeSDK, intervalMs: 50, maxTries: 60 }).then(() => {
                this.refilterFeatures({ wmeSDK });
            });
        }
        async promptUserAction(args) {
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
            }
            else if (result === "merge-with-coords") {
                venuesToUpdate = matchingVenues.map((v) => ({
                    ...v,
                    _updateCoordinates: true,
                }));
            }
            return {
                action: result,
                venues: venuesToUpdate,
            };
        }
        async createOrUpdateVenue(args) {
            const { wmeSDK, venuesToUpdate, lon, lat, name, aliases, categories } = args;
            let venues = venuesToUpdate;
            if (venues.length === 0) {
                const geometry = {
                    type: "Point",
                    coordinates: [lon, lat],
                };
                const venueId = wmeSDK.DataModel.Venues.addVenue({
                    category: "TRANSPORTATION",
                    geometry,
                });
                const newVenue = wmeSDK.DataModel.Venues.getById({
                    venueId: venueId.toString(),
                });
                if (newVenue) {
                    venues = [newVenue];
                }
            }
            for (const venue of venues) {
                const updateArgs = {
                    venueId: venue.id.toString(),
                    name,
                    aliases,
                    categories: categories,
                    ...(venue._updateCoordinates && {
                        geometry: {
                            type: "Point",
                            coordinates: [lon, lat],
                        },
                    }),
                };
                wmeSDK.DataModel.Venues.updateVenue(updateArgs);
            }
            return venues;
        }
        async featureClicked(args) {
            const { wmeSDK, featureId } = args;
            const stop = this.features.get(featureId);
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
            const allVenues = wmeSDK.DataModel.Venues.getAll();
            const categoryFilteredVenues = allVenues.filter((v) => v.categories.some((cat) => venueCategories.includes(cat)));
            let venuesToUpdate = [];
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
                    venuesToUpdate = venues;
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

    const isString = obj => typeof obj === 'string';
    const defer = () => {
      let res;
      let rej;
      const promise = new Promise((resolve, reject) => {
        res = resolve;
        rej = reject;
      });
      promise.resolve = res;
      promise.reject = rej;
      return promise;
    };
    const makeString = object => {
      if (object == null) return '';
      return '' + object;
    };
    const copy = (a, s, t) => {
      a.forEach(m => {
        if (s[m]) t[m] = s[m];
      });
    };
    const lastOfPathSeparatorRegExp = /###/g;
    const cleanKey = key => key && key.indexOf('###') > -1 ? key.replace(lastOfPathSeparatorRegExp, '.') : key;
    const canNotTraverseDeeper = object => !object || isString(object);
    const getLastOfPath = (object, path, Empty) => {
      const stack = !isString(path) ? path : path.split('.');
      let stackIndex = 0;
      while (stackIndex < stack.length - 1) {
        if (canNotTraverseDeeper(object)) return {};
        const key = cleanKey(stack[stackIndex]);
        if (!object[key] && Empty) object[key] = new Empty();
        if (Object.prototype.hasOwnProperty.call(object, key)) {
          object = object[key];
        } else {
          object = {};
        }
        ++stackIndex;
      }
      if (canNotTraverseDeeper(object)) return {};
      return {
        obj: object,
        k: cleanKey(stack[stackIndex])
      };
    };
    const setPath = (object, path, newValue) => {
      const {
        obj,
        k
      } = getLastOfPath(object, path, Object);
      if (obj !== undefined || path.length === 1) {
        obj[k] = newValue;
        return;
      }
      let e = path[path.length - 1];
      let p = path.slice(0, path.length - 1);
      let last = getLastOfPath(object, p, Object);
      while (last.obj === undefined && p.length) {
        e = `${p[p.length - 1]}.${e}`;
        p = p.slice(0, p.length - 1);
        last = getLastOfPath(object, p, Object);
        if (last?.obj && typeof last.obj[`${last.k}.${e}`] !== 'undefined') {
          last.obj = undefined;
        }
      }
      last.obj[`${last.k}.${e}`] = newValue;
    };
    const pushPath = (object, path, newValue, concat) => {
      const {
        obj,
        k
      } = getLastOfPath(object, path, Object);
      obj[k] = obj[k] || [];
      obj[k].push(newValue);
    };
    const getPath = (object, path) => {
      const {
        obj,
        k
      } = getLastOfPath(object, path);
      if (!obj) return undefined;
      if (!Object.prototype.hasOwnProperty.call(obj, k)) return undefined;
      return obj[k];
    };
    const getPathWithDefaults = (data, defaultData, key) => {
      const value = getPath(data, key);
      if (value !== undefined) {
        return value;
      }
      return getPath(defaultData, key);
    };
    const deepExtend = (target, source, overwrite) => {
      for (const prop in source) {
        if (prop !== '__proto__' && prop !== 'constructor') {
          if (prop in target) {
            if (isString(target[prop]) || target[prop] instanceof String || isString(source[prop]) || source[prop] instanceof String) {
              if (overwrite) target[prop] = source[prop];
            } else {
              deepExtend(target[prop], source[prop], overwrite);
            }
          } else {
            target[prop] = source[prop];
          }
        }
      }
      return target;
    };
    const regexEscape = str => str.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, '\\$&');
    var _entityMap = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
      '/': '&#x2F;'
    };
    const escape = data => {
      if (isString(data)) {
        return data.replace(/[&<>"'\/]/g, s => _entityMap[s]);
      }
      return data;
    };
    class RegExpCache {
      constructor(capacity) {
        this.capacity = capacity;
        this.regExpMap = new Map();
        this.regExpQueue = [];
      }
      getRegExp(pattern) {
        const regExpFromCache = this.regExpMap.get(pattern);
        if (regExpFromCache !== undefined) {
          return regExpFromCache;
        }
        const regExpNew = new RegExp(pattern);
        if (this.regExpQueue.length === this.capacity) {
          this.regExpMap.delete(this.regExpQueue.shift());
        }
        this.regExpMap.set(pattern, regExpNew);
        this.regExpQueue.push(pattern);
        return regExpNew;
      }
    }
    const chars = [' ', ',', '?', '!', ';'];
    const looksLikeObjectPathRegExpCache = new RegExpCache(20);
    const looksLikeObjectPath = (key, nsSeparator, keySeparator) => {
      nsSeparator = nsSeparator || '';
      keySeparator = keySeparator || '';
      const possibleChars = chars.filter(c => nsSeparator.indexOf(c) < 0 && keySeparator.indexOf(c) < 0);
      if (possibleChars.length === 0) return true;
      const r = looksLikeObjectPathRegExpCache.getRegExp(`(${possibleChars.map(c => c === '?' ? '\\?' : c).join('|')})`);
      let matched = !r.test(key);
      if (!matched) {
        const ki = key.indexOf(keySeparator);
        if (ki > 0 && !r.test(key.substring(0, ki))) {
          matched = true;
        }
      }
      return matched;
    };
    const deepFind = (obj, path, keySeparator = '.') => {
      if (!obj) return undefined;
      if (obj[path]) {
        if (!Object.prototype.hasOwnProperty.call(obj, path)) return undefined;
        return obj[path];
      }
      const tokens = path.split(keySeparator);
      let current = obj;
      for (let i = 0; i < tokens.length;) {
        if (!current || typeof current !== 'object') {
          return undefined;
        }
        let next;
        let nextPath = '';
        for (let j = i; j < tokens.length; ++j) {
          if (j !== i) {
            nextPath += keySeparator;
          }
          nextPath += tokens[j];
          next = current[nextPath];
          if (next !== undefined) {
            if (['string', 'number', 'boolean'].indexOf(typeof next) > -1 && j < tokens.length - 1) {
              continue;
            }
            i += j - i + 1;
            break;
          }
        }
        current = next;
      }
      return current;
    };
    const getCleanedCode = code => code?.replace('_', '-');

    const consoleLogger = {
      type: 'logger',
      log(args) {
        this.output('log', args);
      },
      warn(args) {
        this.output('warn', args);
      },
      error(args) {
        this.output('error', args);
      },
      output(type, args) {
        console?.[type]?.apply?.(console, args);
      }
    };
    class Logger {
      constructor(concreteLogger, options = {}) {
        this.init(concreteLogger, options);
      }
      init(concreteLogger, options = {}) {
        this.prefix = options.prefix || 'i18next:';
        this.logger = concreteLogger || consoleLogger;
        this.options = options;
        this.debug = options.debug;
      }
      log(...args) {
        return this.forward(args, 'log', '', true);
      }
      warn(...args) {
        return this.forward(args, 'warn', '', true);
      }
      error(...args) {
        return this.forward(args, 'error', '');
      }
      deprecate(...args) {
        return this.forward(args, 'warn', 'WARNING DEPRECATED: ', true);
      }
      forward(args, lvl, prefix, debugOnly) {
        if (debugOnly && !this.debug) return null;
        if (isString(args[0])) args[0] = `${prefix}${this.prefix} ${args[0]}`;
        return this.logger[lvl](args);
      }
      create(moduleName) {
        return new Logger(this.logger, {
          ...{
            prefix: `${this.prefix}:${moduleName}:`
          },
          ...this.options
        });
      }
      clone(options) {
        options = options || this.options;
        options.prefix = options.prefix || this.prefix;
        return new Logger(this.logger, options);
      }
    }
    var baseLogger = new Logger();

    class EventEmitter {
      constructor() {
        this.observers = {};
      }
      on(events, listener) {
        events.split(' ').forEach(event => {
          if (!this.observers[event]) this.observers[event] = new Map();
          const numListeners = this.observers[event].get(listener) || 0;
          this.observers[event].set(listener, numListeners + 1);
        });
        return this;
      }
      off(event, listener) {
        if (!this.observers[event]) return;
        if (!listener) {
          delete this.observers[event];
          return;
        }
        this.observers[event].delete(listener);
      }
      emit(event, ...args) {
        if (this.observers[event]) {
          const cloned = Array.from(this.observers[event].entries());
          cloned.forEach(([observer, numTimesAdded]) => {
            for (let i = 0; i < numTimesAdded; i++) {
              observer(...args);
            }
          });
        }
        if (this.observers['*']) {
          const cloned = Array.from(this.observers['*'].entries());
          cloned.forEach(([observer, numTimesAdded]) => {
            for (let i = 0; i < numTimesAdded; i++) {
              observer.apply(observer, [event, ...args]);
            }
          });
        }
      }
    }

    class ResourceStore extends EventEmitter {
      constructor(data, options = {
        ns: ['translation'],
        defaultNS: 'translation'
      }) {
        super();
        this.data = data || {};
        this.options = options;
        if (this.options.keySeparator === undefined) {
          this.options.keySeparator = '.';
        }
        if (this.options.ignoreJSONStructure === undefined) {
          this.options.ignoreJSONStructure = true;
        }
      }
      addNamespaces(ns) {
        if (this.options.ns.indexOf(ns) < 0) {
          this.options.ns.push(ns);
        }
      }
      removeNamespaces(ns) {
        const index = this.options.ns.indexOf(ns);
        if (index > -1) {
          this.options.ns.splice(index, 1);
        }
      }
      getResource(lng, ns, key, options = {}) {
        const keySeparator = options.keySeparator !== undefined ? options.keySeparator : this.options.keySeparator;
        const ignoreJSONStructure = options.ignoreJSONStructure !== undefined ? options.ignoreJSONStructure : this.options.ignoreJSONStructure;
        let path;
        if (lng.indexOf('.') > -1) {
          path = lng.split('.');
        } else {
          path = [lng, ns];
          if (key) {
            if (Array.isArray(key)) {
              path.push(...key);
            } else if (isString(key) && keySeparator) {
              path.push(...key.split(keySeparator));
            } else {
              path.push(key);
            }
          }
        }
        const result = getPath(this.data, path);
        if (!result && !ns && !key && lng.indexOf('.') > -1) {
          lng = path[0];
          ns = path[1];
          key = path.slice(2).join('.');
        }
        if (result || !ignoreJSONStructure || !isString(key)) return result;
        return deepFind(this.data?.[lng]?.[ns], key, keySeparator);
      }
      addResource(lng, ns, key, value, options = {
        silent: false
      }) {
        const keySeparator = options.keySeparator !== undefined ? options.keySeparator : this.options.keySeparator;
        let path = [lng, ns];
        if (key) path = path.concat(keySeparator ? key.split(keySeparator) : key);
        if (lng.indexOf('.') > -1) {
          path = lng.split('.');
          value = ns;
          ns = path[1];
        }
        this.addNamespaces(ns);
        setPath(this.data, path, value);
        if (!options.silent) this.emit('added', lng, ns, key, value);
      }
      addResources(lng, ns, resources, options = {
        silent: false
      }) {
        for (const m in resources) {
          if (isString(resources[m]) || Array.isArray(resources[m])) this.addResource(lng, ns, m, resources[m], {
            silent: true
          });
        }
        if (!options.silent) this.emit('added', lng, ns, resources);
      }
      addResourceBundle(lng, ns, resources, deep, overwrite, options = {
        silent: false,
        skipCopy: false
      }) {
        let path = [lng, ns];
        if (lng.indexOf('.') > -1) {
          path = lng.split('.');
          deep = resources;
          resources = ns;
          ns = path[1];
        }
        this.addNamespaces(ns);
        let pack = getPath(this.data, path) || {};
        if (!options.skipCopy) resources = JSON.parse(JSON.stringify(resources));
        if (deep) {
          deepExtend(pack, resources, overwrite);
        } else {
          pack = {
            ...pack,
            ...resources
          };
        }
        setPath(this.data, path, pack);
        if (!options.silent) this.emit('added', lng, ns, resources);
      }
      removeResourceBundle(lng, ns) {
        if (this.hasResourceBundle(lng, ns)) {
          delete this.data[lng][ns];
        }
        this.removeNamespaces(ns);
        this.emit('removed', lng, ns);
      }
      hasResourceBundle(lng, ns) {
        return this.getResource(lng, ns) !== undefined;
      }
      getResourceBundle(lng, ns) {
        if (!ns) ns = this.options.defaultNS;
        return this.getResource(lng, ns);
      }
      getDataByLanguage(lng) {
        return this.data[lng];
      }
      hasLanguageSomeTranslations(lng) {
        const data = this.getDataByLanguage(lng);
        const n = data && Object.keys(data) || [];
        return !!n.find(v => data[v] && Object.keys(data[v]).length > 0);
      }
      toJSON() {
        return this.data;
      }
    }

    var postProcessor = {
      processors: {},
      addPostProcessor(module) {
        this.processors[module.name] = module;
      },
      handle(processors, value, key, options, translator) {
        processors.forEach(processor => {
          value = this.processors[processor]?.process(value, key, options, translator) ?? value;
        });
        return value;
      }
    };

    const checkedLoadedFor = {};
    const shouldHandleAsObject = res => !isString(res) && typeof res !== 'boolean' && typeof res !== 'number';
    class Translator extends EventEmitter {
      constructor(services, options = {}) {
        super();
        copy(['resourceStore', 'languageUtils', 'pluralResolver', 'interpolator', 'backendConnector', 'i18nFormat', 'utils'], services, this);
        this.options = options;
        if (this.options.keySeparator === undefined) {
          this.options.keySeparator = '.';
        }
        this.logger = baseLogger.create('translator');
      }
      changeLanguage(lng) {
        if (lng) this.language = lng;
      }
      exists(key, o = {
        interpolation: {}
      }) {
        const opt = {
          ...o
        };
        if (key == null) return false;
        const resolved = this.resolve(key, opt);
        return resolved?.res !== undefined;
      }
      extractFromKey(key, opt) {
        let nsSeparator = opt.nsSeparator !== undefined ? opt.nsSeparator : this.options.nsSeparator;
        if (nsSeparator === undefined) nsSeparator = ':';
        const keySeparator = opt.keySeparator !== undefined ? opt.keySeparator : this.options.keySeparator;
        let namespaces = opt.ns || this.options.defaultNS || [];
        const wouldCheckForNsInKey = nsSeparator && key.indexOf(nsSeparator) > -1;
        const seemsNaturalLanguage = !this.options.userDefinedKeySeparator && !opt.keySeparator && !this.options.userDefinedNsSeparator && !opt.nsSeparator && !looksLikeObjectPath(key, nsSeparator, keySeparator);
        if (wouldCheckForNsInKey && !seemsNaturalLanguage) {
          const m = key.match(this.interpolator.nestingRegexp);
          if (m && m.length > 0) {
            return {
              key,
              namespaces: isString(namespaces) ? [namespaces] : namespaces
            };
          }
          const parts = key.split(nsSeparator);
          if (nsSeparator !== keySeparator || nsSeparator === keySeparator && this.options.ns.indexOf(parts[0]) > -1) namespaces = parts.shift();
          key = parts.join(keySeparator);
        }
        return {
          key,
          namespaces: isString(namespaces) ? [namespaces] : namespaces
        };
      }
      translate(keys, o, lastKey) {
        let opt = typeof o === 'object' ? {
          ...o
        } : o;
        if (typeof opt !== 'object' && this.options.overloadTranslationOptionHandler) {
          opt = this.options.overloadTranslationOptionHandler(arguments);
        }
        if (typeof options === 'object') opt = {
          ...opt
        };
        if (!opt) opt = {};
        if (keys == null) return '';
        if (!Array.isArray(keys)) keys = [String(keys)];
        const returnDetails = opt.returnDetails !== undefined ? opt.returnDetails : this.options.returnDetails;
        const keySeparator = opt.keySeparator !== undefined ? opt.keySeparator : this.options.keySeparator;
        const {
          key,
          namespaces
        } = this.extractFromKey(keys[keys.length - 1], opt);
        const namespace = namespaces[namespaces.length - 1];
        let nsSeparator = opt.nsSeparator !== undefined ? opt.nsSeparator : this.options.nsSeparator;
        if (nsSeparator === undefined) nsSeparator = ':';
        const lng = opt.lng || this.language;
        const appendNamespaceToCIMode = opt.appendNamespaceToCIMode || this.options.appendNamespaceToCIMode;
        if (lng?.toLowerCase() === 'cimode') {
          if (appendNamespaceToCIMode) {
            if (returnDetails) {
              return {
                res: `${namespace}${nsSeparator}${key}`,
                usedKey: key,
                exactUsedKey: key,
                usedLng: lng,
                usedNS: namespace,
                usedParams: this.getUsedParamsDetails(opt)
              };
            }
            return `${namespace}${nsSeparator}${key}`;
          }
          if (returnDetails) {
            return {
              res: key,
              usedKey: key,
              exactUsedKey: key,
              usedLng: lng,
              usedNS: namespace,
              usedParams: this.getUsedParamsDetails(opt)
            };
          }
          return key;
        }
        const resolved = this.resolve(keys, opt);
        let res = resolved?.res;
        const resUsedKey = resolved?.usedKey || key;
        const resExactUsedKey = resolved?.exactUsedKey || key;
        const noObject = ['[object Number]', '[object Function]', '[object RegExp]'];
        const joinArrays = opt.joinArrays !== undefined ? opt.joinArrays : this.options.joinArrays;
        const handleAsObjectInI18nFormat = !this.i18nFormat || this.i18nFormat.handleAsObject;
        const needsPluralHandling = opt.count !== undefined && !isString(opt.count);
        const hasDefaultValue = Translator.hasDefaultValue(opt);
        const defaultValueSuffix = needsPluralHandling ? this.pluralResolver.getSuffix(lng, opt.count, opt) : '';
        const defaultValueSuffixOrdinalFallback = opt.ordinal && needsPluralHandling ? this.pluralResolver.getSuffix(lng, opt.count, {
          ordinal: false
        }) : '';
        const needsZeroSuffixLookup = needsPluralHandling && !opt.ordinal && opt.count === 0;
        const defaultValue = needsZeroSuffixLookup && opt[`defaultValue${this.options.pluralSeparator}zero`] || opt[`defaultValue${defaultValueSuffix}`] || opt[`defaultValue${defaultValueSuffixOrdinalFallback}`] || opt.defaultValue;
        let resForObjHndl = res;
        if (handleAsObjectInI18nFormat && !res && hasDefaultValue) {
          resForObjHndl = defaultValue;
        }
        const handleAsObject = shouldHandleAsObject(resForObjHndl);
        const resType = Object.prototype.toString.apply(resForObjHndl);
        if (handleAsObjectInI18nFormat && resForObjHndl && handleAsObject && noObject.indexOf(resType) < 0 && !(isString(joinArrays) && Array.isArray(resForObjHndl))) {
          if (!opt.returnObjects && !this.options.returnObjects) {
            if (!this.options.returnedObjectHandler) {
              this.logger.warn('accessing an object - but returnObjects options is not enabled!');
            }
            const r = this.options.returnedObjectHandler ? this.options.returnedObjectHandler(resUsedKey, resForObjHndl, {
              ...opt,
              ns: namespaces
            }) : `key '${key} (${this.language})' returned an object instead of string.`;
            if (returnDetails) {
              resolved.res = r;
              resolved.usedParams = this.getUsedParamsDetails(opt);
              return resolved;
            }
            return r;
          }
          if (keySeparator) {
            const resTypeIsArray = Array.isArray(resForObjHndl);
            const copy = resTypeIsArray ? [] : {};
            const newKeyToUse = resTypeIsArray ? resExactUsedKey : resUsedKey;
            for (const m in resForObjHndl) {
              if (Object.prototype.hasOwnProperty.call(resForObjHndl, m)) {
                const deepKey = `${newKeyToUse}${keySeparator}${m}`;
                if (hasDefaultValue && !res) {
                  copy[m] = this.translate(deepKey, {
                    ...opt,
                    defaultValue: shouldHandleAsObject(defaultValue) ? defaultValue[m] : undefined,
                    ...{
                      joinArrays: false,
                      ns: namespaces
                    }
                  });
                } else {
                  copy[m] = this.translate(deepKey, {
                    ...opt,
                    ...{
                      joinArrays: false,
                      ns: namespaces
                    }
                  });
                }
                if (copy[m] === deepKey) copy[m] = resForObjHndl[m];
              }
            }
            res = copy;
          }
        } else if (handleAsObjectInI18nFormat && isString(joinArrays) && Array.isArray(res)) {
          res = res.join(joinArrays);
          if (res) res = this.extendTranslation(res, keys, opt, lastKey);
        } else {
          let usedDefault = false;
          let usedKey = false;
          if (!this.isValidLookup(res) && hasDefaultValue) {
            usedDefault = true;
            res = defaultValue;
          }
          if (!this.isValidLookup(res)) {
            usedKey = true;
            res = key;
          }
          const missingKeyNoValueFallbackToKey = opt.missingKeyNoValueFallbackToKey || this.options.missingKeyNoValueFallbackToKey;
          const resForMissing = missingKeyNoValueFallbackToKey && usedKey ? undefined : res;
          const updateMissing = hasDefaultValue && defaultValue !== res && this.options.updateMissing;
          if (usedKey || usedDefault || updateMissing) {
            this.logger.log(updateMissing ? 'updateKey' : 'missingKey', lng, namespace, key, updateMissing ? defaultValue : res);
            if (keySeparator) {
              const fk = this.resolve(key, {
                ...opt,
                keySeparator: false
              });
              if (fk && fk.res) this.logger.warn('Seems the loaded translations were in flat JSON format instead of nested. Either set keySeparator: false on init or make sure your translations are published in nested format.');
            }
            let lngs = [];
            const fallbackLngs = this.languageUtils.getFallbackCodes(this.options.fallbackLng, opt.lng || this.language);
            if (this.options.saveMissingTo === 'fallback' && fallbackLngs && fallbackLngs[0]) {
              for (let i = 0; i < fallbackLngs.length; i++) {
                lngs.push(fallbackLngs[i]);
              }
            } else if (this.options.saveMissingTo === 'all') {
              lngs = this.languageUtils.toResolveHierarchy(opt.lng || this.language);
            } else {
              lngs.push(opt.lng || this.language);
            }
            const send = (l, k, specificDefaultValue) => {
              const defaultForMissing = hasDefaultValue && specificDefaultValue !== res ? specificDefaultValue : resForMissing;
              if (this.options.missingKeyHandler) {
                this.options.missingKeyHandler(l, namespace, k, defaultForMissing, updateMissing, opt);
              } else if (this.backendConnector?.saveMissing) {
                this.backendConnector.saveMissing(l, namespace, k, defaultForMissing, updateMissing, opt);
              }
              this.emit('missingKey', l, namespace, k, res);
            };
            if (this.options.saveMissing) {
              if (this.options.saveMissingPlurals && needsPluralHandling) {
                lngs.forEach(language => {
                  const suffixes = this.pluralResolver.getSuffixes(language, opt);
                  if (needsZeroSuffixLookup && opt[`defaultValue${this.options.pluralSeparator}zero`] && suffixes.indexOf(`${this.options.pluralSeparator}zero`) < 0) {
                    suffixes.push(`${this.options.pluralSeparator}zero`);
                  }
                  suffixes.forEach(suffix => {
                    send([language], key + suffix, opt[`defaultValue${suffix}`] || defaultValue);
                  });
                });
              } else {
                send(lngs, key, defaultValue);
              }
            }
          }
          res = this.extendTranslation(res, keys, opt, resolved, lastKey);
          if (usedKey && res === key && this.options.appendNamespaceToMissingKey) {
            res = `${namespace}${nsSeparator}${key}`;
          }
          if ((usedKey || usedDefault) && this.options.parseMissingKeyHandler) {
            res = this.options.parseMissingKeyHandler(this.options.appendNamespaceToMissingKey ? `${namespace}${nsSeparator}${key}` : key, usedDefault ? res : undefined, opt);
          }
        }
        if (returnDetails) {
          resolved.res = res;
          resolved.usedParams = this.getUsedParamsDetails(opt);
          return resolved;
        }
        return res;
      }
      extendTranslation(res, key, opt, resolved, lastKey) {
        if (this.i18nFormat?.parse) {
          res = this.i18nFormat.parse(res, {
            ...this.options.interpolation.defaultVariables,
            ...opt
          }, opt.lng || this.language || resolved.usedLng, resolved.usedNS, resolved.usedKey, {
            resolved
          });
        } else if (!opt.skipInterpolation) {
          if (opt.interpolation) this.interpolator.init({
            ...opt,
            ...{
              interpolation: {
                ...this.options.interpolation,
                ...opt.interpolation
              }
            }
          });
          const skipOnVariables = isString(res) && (opt?.interpolation?.skipOnVariables !== undefined ? opt.interpolation.skipOnVariables : this.options.interpolation.skipOnVariables);
          let nestBef;
          if (skipOnVariables) {
            const nb = res.match(this.interpolator.nestingRegexp);
            nestBef = nb && nb.length;
          }
          let data = opt.replace && !isString(opt.replace) ? opt.replace : opt;
          if (this.options.interpolation.defaultVariables) data = {
            ...this.options.interpolation.defaultVariables,
            ...data
          };
          res = this.interpolator.interpolate(res, data, opt.lng || this.language || resolved.usedLng, opt);
          if (skipOnVariables) {
            const na = res.match(this.interpolator.nestingRegexp);
            const nestAft = na && na.length;
            if (nestBef < nestAft) opt.nest = false;
          }
          if (!opt.lng && resolved && resolved.res) opt.lng = this.language || resolved.usedLng;
          if (opt.nest !== false) res = this.interpolator.nest(res, (...args) => {
            if (lastKey?.[0] === args[0] && !opt.context) {
              this.logger.warn(`It seems you are nesting recursively key: ${args[0]} in key: ${key[0]}`);
              return null;
            }
            return this.translate(...args, key);
          }, opt);
          if (opt.interpolation) this.interpolator.reset();
        }
        const postProcess = opt.postProcess || this.options.postProcess;
        const postProcessorNames = isString(postProcess) ? [postProcess] : postProcess;
        if (res != null && postProcessorNames?.length && opt.applyPostProcessor !== false) {
          res = postProcessor.handle(postProcessorNames, res, key, this.options && this.options.postProcessPassResolved ? {
            i18nResolved: {
              ...resolved,
              usedParams: this.getUsedParamsDetails(opt)
            },
            ...opt
          } : opt, this);
        }
        return res;
      }
      resolve(keys, opt = {}) {
        let found;
        let usedKey;
        let exactUsedKey;
        let usedLng;
        let usedNS;
        if (isString(keys)) keys = [keys];
        keys.forEach(k => {
          if (this.isValidLookup(found)) return;
          const extracted = this.extractFromKey(k, opt);
          const key = extracted.key;
          usedKey = key;
          let namespaces = extracted.namespaces;
          if (this.options.fallbackNS) namespaces = namespaces.concat(this.options.fallbackNS);
          const needsPluralHandling = opt.count !== undefined && !isString(opt.count);
          const needsZeroSuffixLookup = needsPluralHandling && !opt.ordinal && opt.count === 0;
          const needsContextHandling = opt.context !== undefined && (isString(opt.context) || typeof opt.context === 'number') && opt.context !== '';
          const codes = opt.lngs ? opt.lngs : this.languageUtils.toResolveHierarchy(opt.lng || this.language, opt.fallbackLng);
          namespaces.forEach(ns => {
            if (this.isValidLookup(found)) return;
            usedNS = ns;
            if (!checkedLoadedFor[`${codes[0]}-${ns}`] && this.utils?.hasLoadedNamespace && !this.utils?.hasLoadedNamespace(usedNS)) {
              checkedLoadedFor[`${codes[0]}-${ns}`] = true;
              this.logger.warn(`key "${usedKey}" for languages "${codes.join(', ')}" won't get resolved as namespace "${usedNS}" was not yet loaded`, 'This means something IS WRONG in your setup. You access the t function before i18next.init / i18next.loadNamespace / i18next.changeLanguage was done. Wait for the callback or Promise to resolve before accessing it!!!');
            }
            codes.forEach(code => {
              if (this.isValidLookup(found)) return;
              usedLng = code;
              const finalKeys = [key];
              if (this.i18nFormat?.addLookupKeys) {
                this.i18nFormat.addLookupKeys(finalKeys, key, code, ns, opt);
              } else {
                let pluralSuffix;
                if (needsPluralHandling) pluralSuffix = this.pluralResolver.getSuffix(code, opt.count, opt);
                const zeroSuffix = `${this.options.pluralSeparator}zero`;
                const ordinalPrefix = `${this.options.pluralSeparator}ordinal${this.options.pluralSeparator}`;
                if (needsPluralHandling) {
                  finalKeys.push(key + pluralSuffix);
                  if (opt.ordinal && pluralSuffix.indexOf(ordinalPrefix) === 0) {
                    finalKeys.push(key + pluralSuffix.replace(ordinalPrefix, this.options.pluralSeparator));
                  }
                  if (needsZeroSuffixLookup) {
                    finalKeys.push(key + zeroSuffix);
                  }
                }
                if (needsContextHandling) {
                  const contextKey = `${key}${this.options.contextSeparator}${opt.context}`;
                  finalKeys.push(contextKey);
                  if (needsPluralHandling) {
                    finalKeys.push(contextKey + pluralSuffix);
                    if (opt.ordinal && pluralSuffix.indexOf(ordinalPrefix) === 0) {
                      finalKeys.push(contextKey + pluralSuffix.replace(ordinalPrefix, this.options.pluralSeparator));
                    }
                    if (needsZeroSuffixLookup) {
                      finalKeys.push(contextKey + zeroSuffix);
                    }
                  }
                }
              }
              let possibleKey;
              while (possibleKey = finalKeys.pop()) {
                if (!this.isValidLookup(found)) {
                  exactUsedKey = possibleKey;
                  found = this.getResource(code, ns, possibleKey, opt);
                }
              }
            });
          });
        });
        return {
          res: found,
          usedKey,
          exactUsedKey,
          usedLng,
          usedNS
        };
      }
      isValidLookup(res) {
        return res !== undefined && !(!this.options.returnNull && res === null) && !(!this.options.returnEmptyString && res === '');
      }
      getResource(code, ns, key, options = {}) {
        if (this.i18nFormat?.getResource) return this.i18nFormat.getResource(code, ns, key, options);
        return this.resourceStore.getResource(code, ns, key, options);
      }
      getUsedParamsDetails(options = {}) {
        const optionsKeys = ['defaultValue', 'ordinal', 'context', 'replace', 'lng', 'lngs', 'fallbackLng', 'ns', 'keySeparator', 'nsSeparator', 'returnObjects', 'returnDetails', 'joinArrays', 'postProcess', 'interpolation'];
        const useOptionsReplaceForData = options.replace && !isString(options.replace);
        let data = useOptionsReplaceForData ? options.replace : options;
        if (useOptionsReplaceForData && typeof options.count !== 'undefined') {
          data.count = options.count;
        }
        if (this.options.interpolation.defaultVariables) {
          data = {
            ...this.options.interpolation.defaultVariables,
            ...data
          };
        }
        if (!useOptionsReplaceForData) {
          data = {
            ...data
          };
          for (const key of optionsKeys) {
            delete data[key];
          }
        }
        return data;
      }
      static hasDefaultValue(options) {
        const prefix = 'defaultValue';
        for (const option in options) {
          if (Object.prototype.hasOwnProperty.call(options, option) && prefix === option.substring(0, prefix.length) && undefined !== options[option]) {
            return true;
          }
        }
        return false;
      }
    }

    class LanguageUtil {
      constructor(options) {
        this.options = options;
        this.supportedLngs = this.options.supportedLngs || false;
        this.logger = baseLogger.create('languageUtils');
      }
      getScriptPartFromCode(code) {
        code = getCleanedCode(code);
        if (!code || code.indexOf('-') < 0) return null;
        const p = code.split('-');
        if (p.length === 2) return null;
        p.pop();
        if (p[p.length - 1].toLowerCase() === 'x') return null;
        return this.formatLanguageCode(p.join('-'));
      }
      getLanguagePartFromCode(code) {
        code = getCleanedCode(code);
        if (!code || code.indexOf('-') < 0) return code;
        const p = code.split('-');
        return this.formatLanguageCode(p[0]);
      }
      formatLanguageCode(code) {
        if (isString(code) && code.indexOf('-') > -1) {
          let formattedCode;
          try {
            formattedCode = Intl.getCanonicalLocales(code)[0];
          } catch (e) {}
          if (formattedCode && this.options.lowerCaseLng) {
            formattedCode = formattedCode.toLowerCase();
          }
          if (formattedCode) return formattedCode;
          if (this.options.lowerCaseLng) {
            return code.toLowerCase();
          }
          return code;
        }
        return this.options.cleanCode || this.options.lowerCaseLng ? code.toLowerCase() : code;
      }
      isSupportedCode(code) {
        if (this.options.load === 'languageOnly' || this.options.nonExplicitSupportedLngs) {
          code = this.getLanguagePartFromCode(code);
        }
        return !this.supportedLngs || !this.supportedLngs.length || this.supportedLngs.indexOf(code) > -1;
      }
      getBestMatchFromCodes(codes) {
        if (!codes) return null;
        let found;
        codes.forEach(code => {
          if (found) return;
          const cleanedLng = this.formatLanguageCode(code);
          if (!this.options.supportedLngs || this.isSupportedCode(cleanedLng)) found = cleanedLng;
        });
        if (!found && this.options.supportedLngs) {
          codes.forEach(code => {
            if (found) return;
            const lngScOnly = this.getScriptPartFromCode(code);
            if (this.isSupportedCode(lngScOnly)) return found = lngScOnly;
            const lngOnly = this.getLanguagePartFromCode(code);
            if (this.isSupportedCode(lngOnly)) return found = lngOnly;
            found = this.options.supportedLngs.find(supportedLng => {
              if (supportedLng === lngOnly) return supportedLng;
              if (supportedLng.indexOf('-') < 0 && lngOnly.indexOf('-') < 0) return;
              if (supportedLng.indexOf('-') > 0 && lngOnly.indexOf('-') < 0 && supportedLng.substring(0, supportedLng.indexOf('-')) === lngOnly) return supportedLng;
              if (supportedLng.indexOf(lngOnly) === 0 && lngOnly.length > 1) return supportedLng;
            });
          });
        }
        if (!found) found = this.getFallbackCodes(this.options.fallbackLng)[0];
        return found;
      }
      getFallbackCodes(fallbacks, code) {
        if (!fallbacks) return [];
        if (typeof fallbacks === 'function') fallbacks = fallbacks(code);
        if (isString(fallbacks)) fallbacks = [fallbacks];
        if (Array.isArray(fallbacks)) return fallbacks;
        if (!code) return fallbacks.default || [];
        let found = fallbacks[code];
        if (!found) found = fallbacks[this.getScriptPartFromCode(code)];
        if (!found) found = fallbacks[this.formatLanguageCode(code)];
        if (!found) found = fallbacks[this.getLanguagePartFromCode(code)];
        if (!found) found = fallbacks.default;
        return found || [];
      }
      toResolveHierarchy(code, fallbackCode) {
        const fallbackCodes = this.getFallbackCodes((fallbackCode === false ? [] : fallbackCode) || this.options.fallbackLng || [], code);
        const codes = [];
        const addCode = c => {
          if (!c) return;
          if (this.isSupportedCode(c)) {
            codes.push(c);
          } else {
            this.logger.warn(`rejecting language code not found in supportedLngs: ${c}`);
          }
        };
        if (isString(code) && (code.indexOf('-') > -1 || code.indexOf('_') > -1)) {
          if (this.options.load !== 'languageOnly') addCode(this.formatLanguageCode(code));
          if (this.options.load !== 'languageOnly' && this.options.load !== 'currentOnly') addCode(this.getScriptPartFromCode(code));
          if (this.options.load !== 'currentOnly') addCode(this.getLanguagePartFromCode(code));
        } else if (isString(code)) {
          addCode(this.formatLanguageCode(code));
        }
        fallbackCodes.forEach(fc => {
          if (codes.indexOf(fc) < 0) addCode(this.formatLanguageCode(fc));
        });
        return codes;
      }
    }

    const suffixesOrder = {
      zero: 0,
      one: 1,
      two: 2,
      few: 3,
      many: 4,
      other: 5
    };
    const dummyRule = {
      select: count => count === 1 ? 'one' : 'other',
      resolvedOptions: () => ({
        pluralCategories: ['one', 'other']
      })
    };
    class PluralResolver {
      constructor(languageUtils, options = {}) {
        this.languageUtils = languageUtils;
        this.options = options;
        this.logger = baseLogger.create('pluralResolver');
        this.pluralRulesCache = {};
      }
      addRule(lng, obj) {
        this.rules[lng] = obj;
      }
      clearCache() {
        this.pluralRulesCache = {};
      }
      getRule(code, options = {}) {
        const cleanedCode = getCleanedCode(code === 'dev' ? 'en' : code);
        const type = options.ordinal ? 'ordinal' : 'cardinal';
        const cacheKey = JSON.stringify({
          cleanedCode,
          type
        });
        if (cacheKey in this.pluralRulesCache) {
          return this.pluralRulesCache[cacheKey];
        }
        let rule;
        try {
          rule = new Intl.PluralRules(cleanedCode, {
            type
          });
        } catch (err) {
          if (!Intl) {
            this.logger.error('No Intl support, please use an Intl polyfill!');
            return dummyRule;
          }
          if (!code.match(/-|_/)) return dummyRule;
          const lngPart = this.languageUtils.getLanguagePartFromCode(code);
          rule = this.getRule(lngPart, options);
        }
        this.pluralRulesCache[cacheKey] = rule;
        return rule;
      }
      needsPlural(code, options = {}) {
        let rule = this.getRule(code, options);
        if (!rule) rule = this.getRule('dev', options);
        return rule?.resolvedOptions().pluralCategories.length > 1;
      }
      getPluralFormsOfKey(code, key, options = {}) {
        return this.getSuffixes(code, options).map(suffix => `${key}${suffix}`);
      }
      getSuffixes(code, options = {}) {
        let rule = this.getRule(code, options);
        if (!rule) rule = this.getRule('dev', options);
        if (!rule) return [];
        return rule.resolvedOptions().pluralCategories.sort((pluralCategory1, pluralCategory2) => suffixesOrder[pluralCategory1] - suffixesOrder[pluralCategory2]).map(pluralCategory => `${this.options.prepend}${options.ordinal ? `ordinal${this.options.prepend}` : ''}${pluralCategory}`);
      }
      getSuffix(code, count, options = {}) {
        const rule = this.getRule(code, options);
        if (rule) {
          return `${this.options.prepend}${options.ordinal ? `ordinal${this.options.prepend}` : ''}${rule.select(count)}`;
        }
        this.logger.warn(`no plural rule found for: ${code}`);
        return this.getSuffix('dev', count, options);
      }
    }

    const deepFindWithDefaults = (data, defaultData, key, keySeparator = '.', ignoreJSONStructure = true) => {
      let path = getPathWithDefaults(data, defaultData, key);
      if (!path && ignoreJSONStructure && isString(key)) {
        path = deepFind(data, key, keySeparator);
        if (path === undefined) path = deepFind(defaultData, key, keySeparator);
      }
      return path;
    };
    const regexSafe = val => val.replace(/\$/g, '$$$$');
    class Interpolator {
      constructor(options = {}) {
        this.logger = baseLogger.create('interpolator');
        this.options = options;
        this.format = options?.interpolation?.format || (value => value);
        this.init(options);
      }
      init(options = {}) {
        if (!options.interpolation) options.interpolation = {
          escapeValue: true
        };
        const {
          escape: escape$1,
          escapeValue,
          useRawValueToEscape,
          prefix,
          prefixEscaped,
          suffix,
          suffixEscaped,
          formatSeparator,
          unescapeSuffix,
          unescapePrefix,
          nestingPrefix,
          nestingPrefixEscaped,
          nestingSuffix,
          nestingSuffixEscaped,
          nestingOptionsSeparator,
          maxReplaces,
          alwaysFormat
        } = options.interpolation;
        this.escape = escape$1 !== undefined ? escape$1 : escape;
        this.escapeValue = escapeValue !== undefined ? escapeValue : true;
        this.useRawValueToEscape = useRawValueToEscape !== undefined ? useRawValueToEscape : false;
        this.prefix = prefix ? regexEscape(prefix) : prefixEscaped || '{{';
        this.suffix = suffix ? regexEscape(suffix) : suffixEscaped || '}}';
        this.formatSeparator = formatSeparator || ',';
        this.unescapePrefix = unescapeSuffix ? '' : unescapePrefix || '-';
        this.unescapeSuffix = this.unescapePrefix ? '' : unescapeSuffix || '';
        this.nestingPrefix = nestingPrefix ? regexEscape(nestingPrefix) : nestingPrefixEscaped || regexEscape('$t(');
        this.nestingSuffix = nestingSuffix ? regexEscape(nestingSuffix) : nestingSuffixEscaped || regexEscape(')');
        this.nestingOptionsSeparator = nestingOptionsSeparator || ',';
        this.maxReplaces = maxReplaces || 1000;
        this.alwaysFormat = alwaysFormat !== undefined ? alwaysFormat : false;
        this.resetRegExp();
      }
      reset() {
        if (this.options) this.init(this.options);
      }
      resetRegExp() {
        const getOrResetRegExp = (existingRegExp, pattern) => {
          if (existingRegExp?.source === pattern) {
            existingRegExp.lastIndex = 0;
            return existingRegExp;
          }
          return new RegExp(pattern, 'g');
        };
        this.regexp = getOrResetRegExp(this.regexp, `${this.prefix}(.+?)${this.suffix}`);
        this.regexpUnescape = getOrResetRegExp(this.regexpUnescape, `${this.prefix}${this.unescapePrefix}(.+?)${this.unescapeSuffix}${this.suffix}`);
        this.nestingRegexp = getOrResetRegExp(this.nestingRegexp, `${this.nestingPrefix}(.+?)${this.nestingSuffix}`);
      }
      interpolate(str, data, lng, options) {
        let match;
        let value;
        let replaces;
        const defaultData = this.options && this.options.interpolation && this.options.interpolation.defaultVariables || {};
        const handleFormat = key => {
          if (key.indexOf(this.formatSeparator) < 0) {
            const path = deepFindWithDefaults(data, defaultData, key, this.options.keySeparator, this.options.ignoreJSONStructure);
            return this.alwaysFormat ? this.format(path, undefined, lng, {
              ...options,
              ...data,
              interpolationkey: key
            }) : path;
          }
          const p = key.split(this.formatSeparator);
          const k = p.shift().trim();
          const f = p.join(this.formatSeparator).trim();
          return this.format(deepFindWithDefaults(data, defaultData, k, this.options.keySeparator, this.options.ignoreJSONStructure), f, lng, {
            ...options,
            ...data,
            interpolationkey: k
          });
        };
        this.resetRegExp();
        const missingInterpolationHandler = options?.missingInterpolationHandler || this.options.missingInterpolationHandler;
        const skipOnVariables = options?.interpolation?.skipOnVariables !== undefined ? options.interpolation.skipOnVariables : this.options.interpolation.skipOnVariables;
        const todos = [{
          regex: this.regexpUnescape,
          safeValue: val => regexSafe(val)
        }, {
          regex: this.regexp,
          safeValue: val => this.escapeValue ? regexSafe(this.escape(val)) : regexSafe(val)
        }];
        todos.forEach(todo => {
          replaces = 0;
          while (match = todo.regex.exec(str)) {
            const matchedVar = match[1].trim();
            value = handleFormat(matchedVar);
            if (value === undefined) {
              if (typeof missingInterpolationHandler === 'function') {
                const temp = missingInterpolationHandler(str, match, options);
                value = isString(temp) ? temp : '';
              } else if (options && Object.prototype.hasOwnProperty.call(options, matchedVar)) {
                value = '';
              } else if (skipOnVariables) {
                value = match[0];
                continue;
              } else {
                this.logger.warn(`missed to pass in variable ${matchedVar} for interpolating ${str}`);
                value = '';
              }
            } else if (!isString(value) && !this.useRawValueToEscape) {
              value = makeString(value);
            }
            const safeValue = todo.safeValue(value);
            str = str.replace(match[0], safeValue);
            if (skipOnVariables) {
              todo.regex.lastIndex += value.length;
              todo.regex.lastIndex -= match[0].length;
            } else {
              todo.regex.lastIndex = 0;
            }
            replaces++;
            if (replaces >= this.maxReplaces) {
              break;
            }
          }
        });
        return str;
      }
      nest(str, fc, options = {}) {
        let match;
        let value;
        let clonedOptions;
        const handleHasOptions = (key, inheritedOptions) => {
          const sep = this.nestingOptionsSeparator;
          if (key.indexOf(sep) < 0) return key;
          const c = key.split(new RegExp(`${sep}[ ]*{`));
          let optionsString = `{${c[1]}`;
          key = c[0];
          optionsString = this.interpolate(optionsString, clonedOptions);
          const matchedSingleQuotes = optionsString.match(/'/g);
          const matchedDoubleQuotes = optionsString.match(/"/g);
          if ((matchedSingleQuotes?.length ?? 0) % 2 === 0 && !matchedDoubleQuotes || matchedDoubleQuotes.length % 2 !== 0) {
            optionsString = optionsString.replace(/'/g, '"');
          }
          try {
            clonedOptions = JSON.parse(optionsString);
            if (inheritedOptions) clonedOptions = {
              ...inheritedOptions,
              ...clonedOptions
            };
          } catch (e) {
            this.logger.warn(`failed parsing options string in nesting for key ${key}`, e);
            return `${key}${sep}${optionsString}`;
          }
          if (clonedOptions.defaultValue && clonedOptions.defaultValue.indexOf(this.prefix) > -1) delete clonedOptions.defaultValue;
          return key;
        };
        while (match = this.nestingRegexp.exec(str)) {
          let formatters = [];
          clonedOptions = {
            ...options
          };
          clonedOptions = clonedOptions.replace && !isString(clonedOptions.replace) ? clonedOptions.replace : clonedOptions;
          clonedOptions.applyPostProcessor = false;
          delete clonedOptions.defaultValue;
          const keyEndIndex = /{.*}/.test(match[1]) ? match[1].lastIndexOf('}') + 1 : match[1].indexOf(this.formatSeparator);
          if (keyEndIndex !== -1) {
            formatters = match[1].slice(keyEndIndex).split(this.formatSeparator).map(elem => elem.trim()).filter(Boolean);
            match[1] = match[1].slice(0, keyEndIndex);
          }
          value = fc(handleHasOptions.call(this, match[1].trim(), clonedOptions), clonedOptions);
          if (value && match[0] === str && !isString(value)) return value;
          if (!isString(value)) value = makeString(value);
          if (!value) {
            this.logger.warn(`missed to resolve ${match[1]} for nesting ${str}`);
            value = '';
          }
          if (formatters.length) {
            value = formatters.reduce((v, f) => this.format(v, f, options.lng, {
              ...options,
              interpolationkey: match[1].trim()
            }), value.trim());
          }
          str = str.replace(match[0], value);
          this.regexp.lastIndex = 0;
        }
        return str;
      }
    }

    const parseFormatStr = formatStr => {
      let formatName = formatStr.toLowerCase().trim();
      const formatOptions = {};
      if (formatStr.indexOf('(') > -1) {
        const p = formatStr.split('(');
        formatName = p[0].toLowerCase().trim();
        const optStr = p[1].substring(0, p[1].length - 1);
        if (formatName === 'currency' && optStr.indexOf(':') < 0) {
          if (!formatOptions.currency) formatOptions.currency = optStr.trim();
        } else if (formatName === 'relativetime' && optStr.indexOf(':') < 0) {
          if (!formatOptions.range) formatOptions.range = optStr.trim();
        } else {
          const opts = optStr.split(';');
          opts.forEach(opt => {
            if (opt) {
              const [key, ...rest] = opt.split(':');
              const val = rest.join(':').trim().replace(/^'+|'+$/g, '');
              const trimmedKey = key.trim();
              if (!formatOptions[trimmedKey]) formatOptions[trimmedKey] = val;
              if (val === 'false') formatOptions[trimmedKey] = false;
              if (val === 'true') formatOptions[trimmedKey] = true;
              if (!isNaN(val)) formatOptions[trimmedKey] = parseInt(val, 10);
            }
          });
        }
      }
      return {
        formatName,
        formatOptions
      };
    };
    const createCachedFormatter = fn => {
      const cache = {};
      return (v, l, o) => {
        let optForCache = o;
        if (o && o.interpolationkey && o.formatParams && o.formatParams[o.interpolationkey] && o[o.interpolationkey]) {
          optForCache = {
            ...optForCache,
            [o.interpolationkey]: undefined
          };
        }
        const key = l + JSON.stringify(optForCache);
        let frm = cache[key];
        if (!frm) {
          frm = fn(getCleanedCode(l), o);
          cache[key] = frm;
        }
        return frm(v);
      };
    };
    const createNonCachedFormatter = fn => (v, l, o) => fn(getCleanedCode(l), o)(v);
    class Formatter {
      constructor(options = {}) {
        this.logger = baseLogger.create('formatter');
        this.options = options;
        this.init(options);
      }
      init(services, options = {
        interpolation: {}
      }) {
        this.formatSeparator = options.interpolation.formatSeparator || ',';
        const cf = options.cacheInBuiltFormats ? createCachedFormatter : createNonCachedFormatter;
        this.formats = {
          number: cf((lng, opt) => {
            const formatter = new Intl.NumberFormat(lng, {
              ...opt
            });
            return val => formatter.format(val);
          }),
          currency: cf((lng, opt) => {
            const formatter = new Intl.NumberFormat(lng, {
              ...opt,
              style: 'currency'
            });
            return val => formatter.format(val);
          }),
          datetime: cf((lng, opt) => {
            const formatter = new Intl.DateTimeFormat(lng, {
              ...opt
            });
            return val => formatter.format(val);
          }),
          relativetime: cf((lng, opt) => {
            const formatter = new Intl.RelativeTimeFormat(lng, {
              ...opt
            });
            return val => formatter.format(val, opt.range || 'day');
          }),
          list: cf((lng, opt) => {
            const formatter = new Intl.ListFormat(lng, {
              ...opt
            });
            return val => formatter.format(val);
          })
        };
      }
      add(name, fc) {
        this.formats[name.toLowerCase().trim()] = fc;
      }
      addCached(name, fc) {
        this.formats[name.toLowerCase().trim()] = createCachedFormatter(fc);
      }
      format(value, format, lng, options = {}) {
        const formats = format.split(this.formatSeparator);
        if (formats.length > 1 && formats[0].indexOf('(') > 1 && formats[0].indexOf(')') < 0 && formats.find(f => f.indexOf(')') > -1)) {
          const lastIndex = formats.findIndex(f => f.indexOf(')') > -1);
          formats[0] = [formats[0], ...formats.splice(1, lastIndex)].join(this.formatSeparator);
        }
        const result = formats.reduce((mem, f) => {
          const {
            formatName,
            formatOptions
          } = parseFormatStr(f);
          if (this.formats[formatName]) {
            let formatted = mem;
            try {
              const valOptions = options?.formatParams?.[options.interpolationkey] || {};
              const l = valOptions.locale || valOptions.lng || options.locale || options.lng || lng;
              formatted = this.formats[formatName](mem, l, {
                ...formatOptions,
                ...options,
                ...valOptions
              });
            } catch (error) {
              this.logger.warn(error);
            }
            return formatted;
          } else {
            this.logger.warn(`there was no format function for ${formatName}`);
          }
          return mem;
        }, value);
        return result;
      }
    }

    const removePending = (q, name) => {
      if (q.pending[name] !== undefined) {
        delete q.pending[name];
        q.pendingCount--;
      }
    };
    class Connector extends EventEmitter {
      constructor(backend, store, services, options = {}) {
        super();
        this.backend = backend;
        this.store = store;
        this.services = services;
        this.languageUtils = services.languageUtils;
        this.options = options;
        this.logger = baseLogger.create('backendConnector');
        this.waitingReads = [];
        this.maxParallelReads = options.maxParallelReads || 10;
        this.readingCalls = 0;
        this.maxRetries = options.maxRetries >= 0 ? options.maxRetries : 5;
        this.retryTimeout = options.retryTimeout >= 1 ? options.retryTimeout : 350;
        this.state = {};
        this.queue = [];
        this.backend?.init?.(services, options.backend, options);
      }
      queueLoad(languages, namespaces, options, callback) {
        const toLoad = {};
        const pending = {};
        const toLoadLanguages = {};
        const toLoadNamespaces = {};
        languages.forEach(lng => {
          let hasAllNamespaces = true;
          namespaces.forEach(ns => {
            const name = `${lng}|${ns}`;
            if (!options.reload && this.store.hasResourceBundle(lng, ns)) {
              this.state[name] = 2;
            } else if (this.state[name] < 0) ; else if (this.state[name] === 1) {
              if (pending[name] === undefined) pending[name] = true;
            } else {
              this.state[name] = 1;
              hasAllNamespaces = false;
              if (pending[name] === undefined) pending[name] = true;
              if (toLoad[name] === undefined) toLoad[name] = true;
              if (toLoadNamespaces[ns] === undefined) toLoadNamespaces[ns] = true;
            }
          });
          if (!hasAllNamespaces) toLoadLanguages[lng] = true;
        });
        if (Object.keys(toLoad).length || Object.keys(pending).length) {
          this.queue.push({
            pending,
            pendingCount: Object.keys(pending).length,
            loaded: {},
            errors: [],
            callback
          });
        }
        return {
          toLoad: Object.keys(toLoad),
          pending: Object.keys(pending),
          toLoadLanguages: Object.keys(toLoadLanguages),
          toLoadNamespaces: Object.keys(toLoadNamespaces)
        };
      }
      loaded(name, err, data) {
        const s = name.split('|');
        const lng = s[0];
        const ns = s[1];
        if (err) this.emit('failedLoading', lng, ns, err);
        if (!err && data) {
          this.store.addResourceBundle(lng, ns, data, undefined, undefined, {
            skipCopy: true
          });
        }
        this.state[name] = err ? -1 : 2;
        if (err && data) this.state[name] = 0;
        const loaded = {};
        this.queue.forEach(q => {
          pushPath(q.loaded, [lng], ns);
          removePending(q, name);
          if (err) q.errors.push(err);
          if (q.pendingCount === 0 && !q.done) {
            Object.keys(q.loaded).forEach(l => {
              if (!loaded[l]) loaded[l] = {};
              const loadedKeys = q.loaded[l];
              if (loadedKeys.length) {
                loadedKeys.forEach(n => {
                  if (loaded[l][n] === undefined) loaded[l][n] = true;
                });
              }
            });
            q.done = true;
            if (q.errors.length) {
              q.callback(q.errors);
            } else {
              q.callback();
            }
          }
        });
        this.emit('loaded', loaded);
        this.queue = this.queue.filter(q => !q.done);
      }
      read(lng, ns, fcName, tried = 0, wait = this.retryTimeout, callback) {
        if (!lng.length) return callback(null, {});
        if (this.readingCalls >= this.maxParallelReads) {
          this.waitingReads.push({
            lng,
            ns,
            fcName,
            tried,
            wait,
            callback
          });
          return;
        }
        this.readingCalls++;
        const resolver = (err, data) => {
          this.readingCalls--;
          if (this.waitingReads.length > 0) {
            const next = this.waitingReads.shift();
            this.read(next.lng, next.ns, next.fcName, next.tried, next.wait, next.callback);
          }
          if (err && data && tried < this.maxRetries) {
            setTimeout(() => {
              this.read.call(this, lng, ns, fcName, tried + 1, wait * 2, callback);
            }, wait);
            return;
          }
          callback(err, data);
        };
        const fc = this.backend[fcName].bind(this.backend);
        if (fc.length === 2) {
          try {
            const r = fc(lng, ns);
            if (r && typeof r.then === 'function') {
              r.then(data => resolver(null, data)).catch(resolver);
            } else {
              resolver(null, r);
            }
          } catch (err) {
            resolver(err);
          }
          return;
        }
        return fc(lng, ns, resolver);
      }
      prepareLoading(languages, namespaces, options = {}, callback) {
        if (!this.backend) {
          this.logger.warn('No backend was added via i18next.use. Will not load resources.');
          return callback && callback();
        }
        if (isString(languages)) languages = this.languageUtils.toResolveHierarchy(languages);
        if (isString(namespaces)) namespaces = [namespaces];
        const toLoad = this.queueLoad(languages, namespaces, options, callback);
        if (!toLoad.toLoad.length) {
          if (!toLoad.pending.length) callback();
          return null;
        }
        toLoad.toLoad.forEach(name => {
          this.loadOne(name);
        });
      }
      load(languages, namespaces, callback) {
        this.prepareLoading(languages, namespaces, {}, callback);
      }
      reload(languages, namespaces, callback) {
        this.prepareLoading(languages, namespaces, {
          reload: true
        }, callback);
      }
      loadOne(name, prefix = '') {
        const s = name.split('|');
        const lng = s[0];
        const ns = s[1];
        this.read(lng, ns, 'read', undefined, undefined, (err, data) => {
          if (err) this.logger.warn(`${prefix}loading namespace ${ns} for language ${lng} failed`, err);
          if (!err && data) this.logger.log(`${prefix}loaded namespace ${ns} for language ${lng}`, data);
          this.loaded(name, err, data);
        });
      }
      saveMissing(languages, namespace, key, fallbackValue, isUpdate, options = {}, clb = () => {}) {
        if (this.services?.utils?.hasLoadedNamespace && !this.services?.utils?.hasLoadedNamespace(namespace)) {
          this.logger.warn(`did not save key "${key}" as the namespace "${namespace}" was not yet loaded`, 'This means something IS WRONG in your setup. You access the t function before i18next.init / i18next.loadNamespace / i18next.changeLanguage was done. Wait for the callback or Promise to resolve before accessing it!!!');
          return;
        }
        if (key === undefined || key === null || key === '') return;
        if (this.backend?.create) {
          const opts = {
            ...options,
            isUpdate
          };
          const fc = this.backend.create.bind(this.backend);
          if (fc.length < 6) {
            try {
              let r;
              if (fc.length === 5) {
                r = fc(languages, namespace, key, fallbackValue, opts);
              } else {
                r = fc(languages, namespace, key, fallbackValue);
              }
              if (r && typeof r.then === 'function') {
                r.then(data => clb(null, data)).catch(clb);
              } else {
                clb(null, r);
              }
            } catch (err) {
              clb(err);
            }
          } else {
            fc(languages, namespace, key, fallbackValue, clb, opts);
          }
        }
        if (!languages || !languages[0]) return;
        this.store.addResource(languages[0], namespace, key, fallbackValue);
      }
    }

    const get = () => ({
      debug: false,
      initAsync: true,
      ns: ['translation'],
      defaultNS: ['translation'],
      fallbackLng: ['dev'],
      fallbackNS: false,
      supportedLngs: false,
      nonExplicitSupportedLngs: false,
      load: 'all',
      preload: false,
      simplifyPluralSuffix: true,
      keySeparator: '.',
      nsSeparator: ':',
      pluralSeparator: '_',
      contextSeparator: '_',
      partialBundledLanguages: false,
      saveMissing: false,
      updateMissing: false,
      saveMissingTo: 'fallback',
      saveMissingPlurals: true,
      missingKeyHandler: false,
      missingInterpolationHandler: false,
      postProcess: false,
      postProcessPassResolved: false,
      returnNull: false,
      returnEmptyString: true,
      returnObjects: false,
      joinArrays: false,
      returnedObjectHandler: false,
      parseMissingKeyHandler: false,
      appendNamespaceToMissingKey: false,
      appendNamespaceToCIMode: false,
      overloadTranslationOptionHandler: args => {
        let ret = {};
        if (typeof args[1] === 'object') ret = args[1];
        if (isString(args[1])) ret.defaultValue = args[1];
        if (isString(args[2])) ret.tDescription = args[2];
        if (typeof args[2] === 'object' || typeof args[3] === 'object') {
          const options = args[3] || args[2];
          Object.keys(options).forEach(key => {
            ret[key] = options[key];
          });
        }
        return ret;
      },
      interpolation: {
        escapeValue: true,
        format: value => value,
        prefix: '{{',
        suffix: '}}',
        formatSeparator: ',',
        unescapePrefix: '-',
        nestingPrefix: '$t(',
        nestingSuffix: ')',
        nestingOptionsSeparator: ',',
        maxReplaces: 1000,
        skipOnVariables: true
      },
      cacheInBuiltFormats: true
    });
    const transformOptions = options => {
      if (isString(options.ns)) options.ns = [options.ns];
      if (isString(options.fallbackLng)) options.fallbackLng = [options.fallbackLng];
      if (isString(options.fallbackNS)) options.fallbackNS = [options.fallbackNS];
      if (options.supportedLngs?.indexOf?.('cimode') < 0) {
        options.supportedLngs = options.supportedLngs.concat(['cimode']);
      }
      if (typeof options.initImmediate === 'boolean') options.initAsync = options.initImmediate;
      return options;
    };

    const noop = () => {};
    const bindMemberFunctions = inst => {
      const mems = Object.getOwnPropertyNames(Object.getPrototypeOf(inst));
      mems.forEach(mem => {
        if (typeof inst[mem] === 'function') {
          inst[mem] = inst[mem].bind(inst);
        }
      });
    };
    class I18n extends EventEmitter {
      constructor(options = {}, callback) {
        super();
        this.options = transformOptions(options);
        this.services = {};
        this.logger = baseLogger;
        this.modules = {
          external: []
        };
        bindMemberFunctions(this);
        if (callback && !this.isInitialized && !options.isClone) {
          if (!this.options.initAsync) {
            this.init(options, callback);
            return this;
          }
          setTimeout(() => {
            this.init(options, callback);
          }, 0);
        }
      }
      init(options = {}, callback) {
        this.isInitializing = true;
        if (typeof options === 'function') {
          callback = options;
          options = {};
        }
        if (options.defaultNS == null && options.ns) {
          if (isString(options.ns)) {
            options.defaultNS = options.ns;
          } else if (options.ns.indexOf('translation') < 0) {
            options.defaultNS = options.ns[0];
          }
        }
        const defOpts = get();
        this.options = {
          ...defOpts,
          ...this.options,
          ...transformOptions(options)
        };
        this.options.interpolation = {
          ...defOpts.interpolation,
          ...this.options.interpolation
        };
        if (options.keySeparator !== undefined) {
          this.options.userDefinedKeySeparator = options.keySeparator;
        }
        if (options.nsSeparator !== undefined) {
          this.options.userDefinedNsSeparator = options.nsSeparator;
        }
        const createClassOnDemand = ClassOrObject => {
          if (!ClassOrObject) return null;
          if (typeof ClassOrObject === 'function') return new ClassOrObject();
          return ClassOrObject;
        };
        if (!this.options.isClone) {
          if (this.modules.logger) {
            baseLogger.init(createClassOnDemand(this.modules.logger), this.options);
          } else {
            baseLogger.init(null, this.options);
          }
          let formatter;
          if (this.modules.formatter) {
            formatter = this.modules.formatter;
          } else {
            formatter = Formatter;
          }
          const lu = new LanguageUtil(this.options);
          this.store = new ResourceStore(this.options.resources, this.options);
          const s = this.services;
          s.logger = baseLogger;
          s.resourceStore = this.store;
          s.languageUtils = lu;
          s.pluralResolver = new PluralResolver(lu, {
            prepend: this.options.pluralSeparator,
            simplifyPluralSuffix: this.options.simplifyPluralSuffix
          });
          const usingLegacyFormatFunction = this.options.interpolation.format && this.options.interpolation.format !== defOpts.interpolation.format;
          if (usingLegacyFormatFunction) {
            this.logger.warn(`init: you are still using the legacy format function, please use the new approach: https://www.i18next.com/translation-function/formatting`);
          }
          if (formatter && (!this.options.interpolation.format || this.options.interpolation.format === defOpts.interpolation.format)) {
            s.formatter = createClassOnDemand(formatter);
            if (s.formatter.init) s.formatter.init(s, this.options);
            this.options.interpolation.format = s.formatter.format.bind(s.formatter);
          }
          s.interpolator = new Interpolator(this.options);
          s.utils = {
            hasLoadedNamespace: this.hasLoadedNamespace.bind(this)
          };
          s.backendConnector = new Connector(createClassOnDemand(this.modules.backend), s.resourceStore, s, this.options);
          s.backendConnector.on('*', (event, ...args) => {
            this.emit(event, ...args);
          });
          if (this.modules.languageDetector) {
            s.languageDetector = createClassOnDemand(this.modules.languageDetector);
            if (s.languageDetector.init) s.languageDetector.init(s, this.options.detection, this.options);
          }
          if (this.modules.i18nFormat) {
            s.i18nFormat = createClassOnDemand(this.modules.i18nFormat);
            if (s.i18nFormat.init) s.i18nFormat.init(this);
          }
          this.translator = new Translator(this.services, this.options);
          this.translator.on('*', (event, ...args) => {
            this.emit(event, ...args);
          });
          this.modules.external.forEach(m => {
            if (m.init) m.init(this);
          });
        }
        this.format = this.options.interpolation.format;
        if (!callback) callback = noop;
        if (this.options.fallbackLng && !this.services.languageDetector && !this.options.lng) {
          const codes = this.services.languageUtils.getFallbackCodes(this.options.fallbackLng);
          if (codes.length > 0 && codes[0] !== 'dev') this.options.lng = codes[0];
        }
        if (!this.services.languageDetector && !this.options.lng) {
          this.logger.warn('init: no languageDetector is used and no lng is defined');
        }
        const storeApi = ['getResource', 'hasResourceBundle', 'getResourceBundle', 'getDataByLanguage'];
        storeApi.forEach(fcName => {
          this[fcName] = (...args) => this.store[fcName](...args);
        });
        const storeApiChained = ['addResource', 'addResources', 'addResourceBundle', 'removeResourceBundle'];
        storeApiChained.forEach(fcName => {
          this[fcName] = (...args) => {
            this.store[fcName](...args);
            return this;
          };
        });
        const deferred = defer();
        const load = () => {
          const finish = (err, t) => {
            this.isInitializing = false;
            if (this.isInitialized && !this.initializedStoreOnce) this.logger.warn('init: i18next is already initialized. You should call init just once!');
            this.isInitialized = true;
            if (!this.options.isClone) this.logger.log('initialized', this.options);
            this.emit('initialized', this.options);
            deferred.resolve(t);
            callback(err, t);
          };
          if (this.languages && !this.isInitialized) return finish(null, this.t.bind(this));
          this.changeLanguage(this.options.lng, finish);
        };
        if (this.options.resources || !this.options.initAsync) {
          load();
        } else {
          setTimeout(load, 0);
        }
        return deferred;
      }
      loadResources(language, callback = noop) {
        let usedCallback = callback;
        const usedLng = isString(language) ? language : this.language;
        if (typeof language === 'function') usedCallback = language;
        if (!this.options.resources || this.options.partialBundledLanguages) {
          if (usedLng?.toLowerCase() === 'cimode' && (!this.options.preload || this.options.preload.length === 0)) return usedCallback();
          const toLoad = [];
          const append = lng => {
            if (!lng) return;
            if (lng === 'cimode') return;
            const lngs = this.services.languageUtils.toResolveHierarchy(lng);
            lngs.forEach(l => {
              if (l === 'cimode') return;
              if (toLoad.indexOf(l) < 0) toLoad.push(l);
            });
          };
          if (!usedLng) {
            const fallbacks = this.services.languageUtils.getFallbackCodes(this.options.fallbackLng);
            fallbacks.forEach(l => append(l));
          } else {
            append(usedLng);
          }
          this.options.preload?.forEach?.(l => append(l));
          this.services.backendConnector.load(toLoad, this.options.ns, e => {
            if (!e && !this.resolvedLanguage && this.language) this.setResolvedLanguage(this.language);
            usedCallback(e);
          });
        } else {
          usedCallback(null);
        }
      }
      reloadResources(lngs, ns, callback) {
        const deferred = defer();
        if (typeof lngs === 'function') {
          callback = lngs;
          lngs = undefined;
        }
        if (typeof ns === 'function') {
          callback = ns;
          ns = undefined;
        }
        if (!lngs) lngs = this.languages;
        if (!ns) ns = this.options.ns;
        if (!callback) callback = noop;
        this.services.backendConnector.reload(lngs, ns, err => {
          deferred.resolve();
          callback(err);
        });
        return deferred;
      }
      use(module) {
        if (!module) throw new Error('You are passing an undefined module! Please check the object you are passing to i18next.use()');
        if (!module.type) throw new Error('You are passing a wrong module! Please check the object you are passing to i18next.use()');
        if (module.type === 'backend') {
          this.modules.backend = module;
        }
        if (module.type === 'logger' || module.log && module.warn && module.error) {
          this.modules.logger = module;
        }
        if (module.type === 'languageDetector') {
          this.modules.languageDetector = module;
        }
        if (module.type === 'i18nFormat') {
          this.modules.i18nFormat = module;
        }
        if (module.type === 'postProcessor') {
          postProcessor.addPostProcessor(module);
        }
        if (module.type === 'formatter') {
          this.modules.formatter = module;
        }
        if (module.type === '3rdParty') {
          this.modules.external.push(module);
        }
        return this;
      }
      setResolvedLanguage(l) {
        if (!l || !this.languages) return;
        if (['cimode', 'dev'].indexOf(l) > -1) return;
        for (let li = 0; li < this.languages.length; li++) {
          const lngInLngs = this.languages[li];
          if (['cimode', 'dev'].indexOf(lngInLngs) > -1) continue;
          if (this.store.hasLanguageSomeTranslations(lngInLngs)) {
            this.resolvedLanguage = lngInLngs;
            break;
          }
        }
        if (!this.resolvedLanguage && this.languages.indexOf(l) < 0 && this.store.hasLanguageSomeTranslations(l)) {
          this.resolvedLanguage = l;
          this.languages.unshift(l);
        }
      }
      changeLanguage(lng, callback) {
        this.isLanguageChangingTo = lng;
        const deferred = defer();
        this.emit('languageChanging', lng);
        const setLngProps = l => {
          this.language = l;
          this.languages = this.services.languageUtils.toResolveHierarchy(l);
          this.resolvedLanguage = undefined;
          this.setResolvedLanguage(l);
        };
        const done = (err, l) => {
          if (l) {
            if (this.isLanguageChangingTo === lng) {
              setLngProps(l);
              this.translator.changeLanguage(l);
              this.isLanguageChangingTo = undefined;
              this.emit('languageChanged', l);
              this.logger.log('languageChanged', l);
            }
          } else {
            this.isLanguageChangingTo = undefined;
          }
          deferred.resolve((...args) => this.t(...args));
          if (callback) callback(err, (...args) => this.t(...args));
        };
        const setLng = lngs => {
          if (!lng && !lngs && this.services.languageDetector) lngs = [];
          const fl = isString(lngs) ? lngs : lngs && lngs[0];
          const l = this.store.hasLanguageSomeTranslations(fl) ? fl : this.services.languageUtils.getBestMatchFromCodes(isString(lngs) ? [lngs] : lngs);
          if (l) {
            if (!this.language) {
              setLngProps(l);
            }
            if (!this.translator.language) this.translator.changeLanguage(l);
            this.services.languageDetector?.cacheUserLanguage?.(l);
          }
          this.loadResources(l, err => {
            done(err, l);
          });
        };
        if (!lng && this.services.languageDetector && !this.services.languageDetector.async) {
          setLng(this.services.languageDetector.detect());
        } else if (!lng && this.services.languageDetector && this.services.languageDetector.async) {
          if (this.services.languageDetector.detect.length === 0) {
            this.services.languageDetector.detect().then(setLng);
          } else {
            this.services.languageDetector.detect(setLng);
          }
        } else {
          setLng(lng);
        }
        return deferred;
      }
      getFixedT(lng, ns, keyPrefix) {
        const fixedT = (key, opts, ...rest) => {
          let o;
          if (typeof opts !== 'object') {
            o = this.options.overloadTranslationOptionHandler([key, opts].concat(rest));
          } else {
            o = {
              ...opts
            };
          }
          o.lng = o.lng || fixedT.lng;
          o.lngs = o.lngs || fixedT.lngs;
          o.ns = o.ns || fixedT.ns;
          if (o.keyPrefix !== '') o.keyPrefix = o.keyPrefix || keyPrefix || fixedT.keyPrefix;
          const keySeparator = this.options.keySeparator || '.';
          let resultKey;
          if (o.keyPrefix && Array.isArray(key)) {
            resultKey = key.map(k => `${o.keyPrefix}${keySeparator}${k}`);
          } else {
            resultKey = o.keyPrefix ? `${o.keyPrefix}${keySeparator}${key}` : key;
          }
          return this.t(resultKey, o);
        };
        if (isString(lng)) {
          fixedT.lng = lng;
        } else {
          fixedT.lngs = lng;
        }
        fixedT.ns = ns;
        fixedT.keyPrefix = keyPrefix;
        return fixedT;
      }
      t(...args) {
        return this.translator?.translate(...args);
      }
      exists(...args) {
        return this.translator?.exists(...args);
      }
      setDefaultNamespace(ns) {
        this.options.defaultNS = ns;
      }
      hasLoadedNamespace(ns, options = {}) {
        if (!this.isInitialized) {
          this.logger.warn('hasLoadedNamespace: i18next was not initialized', this.languages);
          return false;
        }
        if (!this.languages || !this.languages.length) {
          this.logger.warn('hasLoadedNamespace: i18n.languages were undefined or empty', this.languages);
          return false;
        }
        const lng = options.lng || this.resolvedLanguage || this.languages[0];
        const fallbackLng = this.options ? this.options.fallbackLng : false;
        const lastLng = this.languages[this.languages.length - 1];
        if (lng.toLowerCase() === 'cimode') return true;
        const loadNotPending = (l, n) => {
          const loadState = this.services.backendConnector.state[`${l}|${n}`];
          return loadState === -1 || loadState === 0 || loadState === 2;
        };
        if (options.precheck) {
          const preResult = options.precheck(this, loadNotPending);
          if (preResult !== undefined) return preResult;
        }
        if (this.hasResourceBundle(lng, ns)) return true;
        if (!this.services.backendConnector.backend || this.options.resources && !this.options.partialBundledLanguages) return true;
        if (loadNotPending(lng, ns) && (!fallbackLng || loadNotPending(lastLng, ns))) return true;
        return false;
      }
      loadNamespaces(ns, callback) {
        const deferred = defer();
        if (!this.options.ns) {
          if (callback) callback();
          return Promise.resolve();
        }
        if (isString(ns)) ns = [ns];
        ns.forEach(n => {
          if (this.options.ns.indexOf(n) < 0) this.options.ns.push(n);
        });
        this.loadResources(err => {
          deferred.resolve();
          if (callback) callback(err);
        });
        return deferred;
      }
      loadLanguages(lngs, callback) {
        const deferred = defer();
        if (isString(lngs)) lngs = [lngs];
        const preloaded = this.options.preload || [];
        const newLngs = lngs.filter(lng => preloaded.indexOf(lng) < 0 && this.services.languageUtils.isSupportedCode(lng));
        if (!newLngs.length) {
          if (callback) callback();
          return Promise.resolve();
        }
        this.options.preload = preloaded.concat(newLngs);
        this.loadResources(err => {
          deferred.resolve();
          if (callback) callback(err);
        });
        return deferred;
      }
      dir(lng) {
        if (!lng) lng = this.resolvedLanguage || (this.languages?.length > 0 ? this.languages[0] : this.language);
        if (!lng) return 'rtl';
        try {
          const l = new Intl.Locale(lng);
          if (l && l.getTextInfo) {
            const ti = l.getTextInfo();
            if (ti && ti.direction) return ti.direction;
          }
        } catch (e) {}
        const rtlLngs = ['ar', 'shu', 'sqr', 'ssh', 'xaa', 'yhd', 'yud', 'aao', 'abh', 'abv', 'acm', 'acq', 'acw', 'acx', 'acy', 'adf', 'ads', 'aeb', 'aec', 'afb', 'ajp', 'apc', 'apd', 'arb', 'arq', 'ars', 'ary', 'arz', 'auz', 'avl', 'ayh', 'ayl', 'ayn', 'ayp', 'bbz', 'pga', 'he', 'iw', 'ps', 'pbt', 'pbu', 'pst', 'prp', 'prd', 'ug', 'ur', 'ydd', 'yds', 'yih', 'ji', 'yi', 'hbo', 'men', 'xmn', 'fa', 'jpr', 'peo', 'pes', 'prs', 'dv', 'sam', 'ckb'];
        const languageUtils = this.services?.languageUtils || new LanguageUtil(get());
        if (lng.toLowerCase().indexOf('-latn') > 1) return 'ltr';
        return rtlLngs.indexOf(languageUtils.getLanguagePartFromCode(lng)) > -1 || lng.toLowerCase().indexOf('-arab') > 1 ? 'rtl' : 'ltr';
      }
      static createInstance(options = {}, callback) {
        return new I18n(options, callback);
      }
      cloneInstance(options = {}, callback = noop) {
        const forkResourceStore = options.forkResourceStore;
        if (forkResourceStore) delete options.forkResourceStore;
        const mergedOptions = {
          ...this.options,
          ...options,
          ...{
            isClone: true
          }
        };
        const clone = new I18n(mergedOptions);
        if (options.debug !== undefined || options.prefix !== undefined) {
          clone.logger = clone.logger.clone(options);
        }
        const membersToCopy = ['store', 'services', 'language'];
        membersToCopy.forEach(m => {
          clone[m] = this[m];
        });
        clone.services = {
          ...this.services
        };
        clone.services.utils = {
          hasLoadedNamespace: clone.hasLoadedNamespace.bind(clone)
        };
        if (forkResourceStore) {
          const clonedData = Object.keys(this.store.data).reduce((prev, l) => {
            prev[l] = {
              ...this.store.data[l]
            };
            prev[l] = Object.keys(prev[l]).reduce((acc, n) => {
              acc[n] = {
                ...prev[l][n]
              };
              return acc;
            }, prev[l]);
            return prev;
          }, {});
          clone.store = new ResourceStore(clonedData, mergedOptions);
          clone.services.resourceStore = clone.store;
        }
        clone.translator = new Translator(clone.services, mergedOptions);
        clone.translator.on('*', (event, ...args) => {
          clone.emit(event, ...args);
        });
        clone.init(mergedOptions, callback);
        clone.translator.options = mergedOptions;
        clone.translator.backendConnector.services.utils = {
          hasLoadedNamespace: clone.hasLoadedNamespace.bind(clone)
        };
        return clone;
      }
      toJSON() {
        return {
          options: this.options,
          store: this.store,
          language: this.language,
          languages: this.languages,
          resolvedLanguage: this.resolvedLanguage
        };
      }
    }
    const instance = I18n.createInstance();
    instance.createInstance = I18n.createInstance;

    instance.createInstance;
    instance.dir;
    instance.init;
    instance.loadResources;
    instance.reloadResources;
    instance.use;
    instance.changeLanguage;
    instance.getFixedT;
    instance.t;
    instance.exists;
    instance.setDefaultNamespace;
    instance.hasLoadedNamespace;
    instance.loadNamespaces;
    instance.loadLanguages;

    var scriptName$4 = "WME Switzerland Helper";
    var layers$3 = {
    	boundaries: {
    		municipality: "Municipal boundaries",
    		state: "Cantonal boundaries"
    	},
    	"3d": "Geographical Names swissNAMES3D",
    	topo: {
    		national_colors: "National Maps (color)"
    	},
    	background: {
    		swissimage: "SWISSIMAGE Background"
    	},
    	public_transport_stops: "Public Transport Stops"
    };
    var introduction$3 = "This script adds map layers that can be enabled via the right navigation bar at the very bottom.";
    var readmeLink$3 = "For more information, see the <a href=\"https://github.com/73VW/WME-Switzerland-Helper/blob/public-transport-stops-layer/README.md\" target=\"_blank\" rel=\"noopener noreferrer\">full documentation</a>.";
    var note$3 = {
    	layers: {
    		background: {
    			swissimage: "Notes"
    		}
    	}
    };
    var swissimageUpdateText$3 = "This <a href=\"https://map.geo.admin.ch/#/map?lang=fr&center=2638909.25,1198316.5&z=1.967&topic=swisstopo&layers=ch.swisstopo.images-swissimage-dop10.metadata&bgLayer=ch.swisstopo.pixelkarte-farbe&featureInfo=default&catalogNodes=swisstopo\" target=\"_blank\" rel=\"noopener noreferrer\">map</a> shows when the <b>{{layer}}</b> map was updated for each region.";
    var publicTransportStopsNote$3 = "Public transport stops appear as <strong>orange circular icons</strong> <img src=\"data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0OSIgaGVpZ2h0PSI0OCIgZmlsbD0iYmxhY2siPjxjaXJjbGUgY3g9IjI0LjcyNiIgY3k9IjI0IiByPSIyMyIgZmlsbD0iI2U2N2UyMiIgc3Ryb2tlPSIjZmZmIiBzdHJva2Utd2lkdGg9IjIiLz48cGF0aCBmaWxsPSIjZmZmIiBkPSJNMjkuNzI2IDE0YTMgMyAwIDAgMSAyLjk5NSAyLjgyNGwuMDA1LjE3NnYxaDEuMDE3bC4xNS4wMDVjLjkzOC4wNiAxLjc2LjY4NCAxLjg0MyAxLjU5MWwuMDA3LjE1NFYyMmwtLjAwNy4xMTdhMSAxIDAgMCAxLS44NzYuODc2bC0uMTE3LjAwNy0uMTE3LS4wMDdhMSAxIDAgMCAxLS44NzYtLjg3NkwzMy43NDMgMjJ2LTJoLTEuMDE3djEwYTEgMSAwIDAgMS0uODgzLjk5M2wtLjExNy4wMDdoLTF2MS41YTEuNSAxLjUgMCAwIDEtMyAwVjMxaC02djEuNWExLjUgMS41IDAgMCAxLTMgMFYzMWgtMWExIDEgMCAwIDEtLjk5My0uODgzTDE2LjcyNiAzMFYyMGgtMXYyYTEgMSAwIDAgMS0uODgzLjk5M2wtLjExNy4wMDdhMSAxIDAgMCAxLS45OTMtLjg4M0wxMy43MjYgMjJ2LTIuMjVjMC0uOTkuODYtMS42ODIgMS44NS0xLjc0NWwuMTUtLjAwNWgxdi0xYTMgMyAwIDAgMSAyLjgyNC0yLjk5NWwuMTc2LS4wMDV6bS0xIDEzaC0xYTEgMSAwIDEgMCAwIDJoMWExIDEgMCAxIDAgMC0ybS03IDBoLTFhMSAxIDAgMSAwIDAgMmgxYTEgMSAwIDEgMCAwLTJtLS40MjktMTFoLTEuNTdsLS4xMTcuMDA3YTEgMSAwIDAgMC0uODc3Ljg3NmwtLjAwNy4xMTd2OGgxMnYtOGwtLjAwNy0uMTE3YTEgMSAwIDAgMC0uNzY0LS44NTdsLS4xMTItLjAyLS4xMTctLjAwNmgtMS41NzJsLS44NTQgMS40OTYtLjA2NS4xYTEgMSAwIDAgMS0uODAzLjQwNEgyMy4wMmwtLjExOS0uMDA3YTEgMSAwIDAgMS0uNzUtLjQ5N3oiLz48c2NyaXB0IHhtbG5zPSIiLz48L3N2Zz4=\" style=\"height: 20px; width: 20px; vertical-align: middle;\"> on the map. Click on them to create or update venues. The script avoids duplicates by checking within a <strong>75-meter radius</strong> and doesn't draw stops already present within <strong>5 meters</strong>.";
    var common$3 = {
    	scriptName: scriptName$4,
    	layers: layers$3,
    	introduction: introduction$3,
    	readmeLink: readmeLink$3,
    	note: note$3,
    	swissimageUpdateText: swissimageUpdateText$3,
    	publicTransportStopsNote: publicTransportStopsNote$3
    };

    var enCommon = /*#__PURE__*/Object.freeze({
        __proto__: null,
        default: common$3,
        introduction: introduction$3,
        layers: layers$3,
        note: note$3,
        publicTransportStopsNote: publicTransportStopsNote$3,
        readmeLink: readmeLink$3,
        scriptName: scriptName$4,
        swissimageUpdateText: swissimageUpdateText$3
    });

    var scriptName$3 = "WME Suisse Helper";
    var layers$2 = {
    	boundaries: {
    		municipality: "Limites communales",
    		state: "Limites cantonales"
    	},
    	"3d": "Noms géographiques swissNAMES3D",
    	topo: {
    		national_colors: "Cartes nationales (couleur)"
    	},
    	background: {
    		swissimage: "Fond SWISSIMAGE"
    	},
    	public_transport_stops: "Arrêts de transports publics"
    };
    var introduction$2 = "Ce script ajoute des couches cartographiques qui peuvent être activées via la barre de navigation de droite tout en bas.";
    var readmeLink$2 = "Pour plus d'informations, consultez la <a href=\"https://github.com/73VW/WME-Switzerland-Helper/blob/public-transport-stops-layer/README.fr.md\" target=\"_blank\" rel=\"noopener noreferrer\">documentation complète</a>.";
    var note$2 = {
    	layers: {
    		background: {
    			swissimage: "Notes"
    		}
    	}
    };
    var swissimageUpdateText$2 = "Cette <a href=\"https://map.geo.admin.ch/#/map?lang=fr&center=2638909.25,1198316.5&z=1.967&topic=swisstopo&layers=ch.swisstopo.images-swissimage-dop10.metadata&bgLayer=ch.swisstopo.pixelkarte-farbe&featureInfo=default&catalogNodes=swisstopo\" target=\"_blank\" rel=\"noopener noreferrer\">carte</a> indique quand la couche <b>{{layer}}</b> a été mise à jour pour chaque région.";
    var publicTransportStopsNote$2 = "Les arrêts de transports publics apparaissent sous forme d'<strong>icônes circulaires orange</strong> <img src=\"data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0OSIgaGVpZ2h0PSI0OCIgZmlsbD0iYmxhY2siPjxjaXJjbGUgY3g9IjI0LjcyNiIgY3k9IjI0IiByPSIyMyIgZmlsbD0iI2U2N2UyMiIgc3Ryb2tlPSIjZmZmIiBzdHJva2Utd2lkdGg9IjIiLz48cGF0aCBmaWxsPSIjZmZmIiBkPSJNMjkuNzI2IDE0YTMgMyAwIDAgMSAyLjk5NSAyLjgyNGwuMDA1LjE3NnYxaDEuMDE3bC4xNS4wMDVjLjkzOC4wNiAxLjc2LjY4NCAxLjg0MyAxLjU5MWwuMDA3LjE1NFYyMmwtLjAwNy4xMTdhMSAxIDAgMCAxLS44NzYuODc2bC0uMTE3LjAwNy0uMTE3LS4wMDdhMSAxIDAgMCAxLS44NzYtLjg3NkwzMy43NDMgMjJ2LTJoLTEuMDE3djEwYTEgMSAwIDAgMS0uODgzLjk5M2wtLjExNy4wMDdoLTF2MS41YTEuNSAxLjUgMCAwIDEtMyAwVjMxaC02djEuNWExLjUgMS41IDAgMCAxLTMgMFYzMWgtMWExIDEgMCAwIDEtLjk5My0uODgzTDE2LjcyNiAzMFYyMGgtMXYyYTEgMSAwIDAgMS0uODgzLjk5M2wtLjExNy4wMDdhMSAxIDAgMCAxLS45OTMtLjg4M0wxMy43MjYgMjJ2LTIuMjVjMC0uOTkuODYtMS42ODIgMS44NS0xLjc0NWwuMTUtLjAwNWgxdi0xYTMgMyAwIDAgMSAyLjgyNC0yLjk5NWwuMTc2LS4wMDV6bS0xIDEzaC0xYTEgMSAwIDEgMCAwIDJoMWExIDEgMCAxIDAgMC0ybS03IDBoLTFhMSAxIDAgMSAwIDAgMmgxYTEgMSAwIDEgMCAwLTJtLS40MjktMTFoLTEuNTdsLS4xMTcuMDA3YTEgMSAwIDAgMC0uODc3Ljg3NmwtLjAwNy4xMTd2OGgxMnYtOGwtLjAwNy0uMTE3YTEgMSAwIDAgMC0uNzY0LS44NTdsLS4xMTItLjAyLS4xMTctLjAwNmgtMS41NzJsLS44NTQgMS40OTYtLjA2NS4xYTEgMSAwIDAgMS0uODAzLjQwNEgyMy4wMmwtLjExOS0uMDA3YTEgMSAwIDAgMS0uNzUtLjQ5N3oiLz48c2NyaXB0IHhtbG5zPSIiLz48L3N2Zz4=\" style=\"height: 20px; width: 20px; vertical-align: middle;\"> sur la carte. Cliquez dessus pour créer ou mettre à jour des lieux. Le script évite les doublons en vérifiant dans un rayon de <strong>75 mètres</strong> et ne dessine pas les arrêts déjà présents dans un rayon de <strong>5 mètres</strong>.";
    var common$2 = {
    	scriptName: scriptName$3,
    	layers: layers$2,
    	introduction: introduction$2,
    	readmeLink: readmeLink$2,
    	note: note$2,
    	swissimageUpdateText: swissimageUpdateText$2,
    	publicTransportStopsNote: publicTransportStopsNote$2
    };

    var frCommon = /*#__PURE__*/Object.freeze({
        __proto__: null,
        default: common$2,
        introduction: introduction$2,
        layers: layers$2,
        note: note$2,
        publicTransportStopsNote: publicTransportStopsNote$2,
        readmeLink: readmeLink$2,
        scriptName: scriptName$3,
        swissimageUpdateText: swissimageUpdateText$2
    });

    var scriptName$2 = "WME Svizzera Helper";
    var layers$1 = {
    	boundaries: {
    		municipality: "Limiti comunali",
    		state: "Frontiere cantonali"
    	},
    	"3d": "Nomi geografici swissNAMES3D",
    	topo: {
    		national_colors: "Carte nazionali (colori)"
    	},
    	background: {
    		swissimage: "SWISSIMAGE Sfondo"
    	},
    	public_transport_stops: "Fermate dei trasporti pubblici"
    };
    var introduction$1 = "Questo script aggiunge livelli di mappa che possono essere attivati tramite la barra di navigazione a destra in basso.";
    var readmeLink$1 = "Per ulteriori informazioni, consultare la <a href=\"https://github.com/73VW/WME-Switzerland-Helper/blob/public-transport-stops-layer/README.it.md\" target=\"_blank\" rel=\"noopener noreferrer\">documentazione completa</a>.";
    var note$1 = {
    	layers: {
    		background: {
    			swissimage: "Note"
    		}
    	}
    };
    var swissimageUpdateText$1 = "Questa <a href=\"https://map.geo.admin.ch/#/map?lang=fr&center=2638909.25,1198316.5&z=1.967&topic=swisstopo&layers=ch.swisstopo.images-swissimage-dop10.metadata&bgLayer=ch.swisstopo.pixelkarte-farbe&featureInfo=default&catalogNodes=swisstopo\" target=\"_blank\" rel=\"noopener noreferrer\">mappa</a> mostra quando il layer <b>{{layer}}</b> è stato aggiornato per ogni regione.";
    var publicTransportStopsNote$1 = "Le fermate dei trasporti pubblici appaiono come <strong>icone circolari arancioni</strong> <img src=\"data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0OSIgaGVpZ2h0PSI0OCIgZmlsbD0iYmxhY2siPjxjaXJjbGUgY3g9IjI0LjcyNiIgY3k9IjI0IiByPSIyMyIgZmlsbD0iI2U2N2UyMiIgc3Ryb2tlPSIjZmZmIiBzdHJva2Utd2lkdGg9IjIiLz48cGF0aCBmaWxsPSIjZmZmIiBkPSJNMjkuNzI2IDE0YTMgMyAwIDAgMSAyLjk5NSAyLjgyNGwuMDA1LjE3NnYxaDEuMDE3bC4xNS4wMDVjLjkzOC4wNiAxLjc2LjY4NCAxLjg0MyAxLjU5MWwuMDA3LjE1NFYyMmwtLjAwNy4xMTdhMSAxIDAgMCAxLS44NzYuODc2bC0uMTE3LjAwNy0uMTE3LS4wMDdhMSAxIDAgMCAxLS44NzYtLjg3NkwzMy43NDMgMjJ2LTJoLTEuMDE3djEwYTEgMSAwIDAgMS0uODgzLjk5M2wtLjExNy4wMDdoLTF2MS41YTEuNSAxLjUgMCAwIDEtMyAwVjMxaC02djEuNWExLjUgMS41IDAgMCAxLTMgMFYzMWgtMWExIDEgMCAwIDEtLjk5My0uODgzTDE2LjcyNiAzMFYyMGgtMXYyYTEgMSAwIDAgMS0uODgzLjk5M2wtLjExNy4wMDdhMSAxIDAgMCAxLS45OTMtLjg4M0wxMy43MjYgMjJ2LTIuMjVjMC0uOTkuODYtMS42ODIgMS44NS0xLjc0NWwuMTUtLjAwNWgxdi0xYTMgMyAwIDAgMSAyLjgyNC0yLjk5NWwuMTc2LS4wMDV6bS0xIDEzaC0xYTEgMSAwIDEgMCAwIDJoMWExIDEgMCAxIDAgMC0ybS03IDBoLTFhMSAxIDAgMSAwIDAgMmgxYTEgMSAwIDEgMCAwLTJtLS40MjktMTFoLTEuNTdsLS4xMTcuMDA3YTEgMSAwIDAgMC0uODc3Ljg3NmwtLjAwNy4xMTd2OGgxMnYtOGwtLjAwNy0uMTE3YTEgMSAwIDAgMC0uNzY0LS44NTdsLS4xMTItLjAyLS4xMTctLjAwNmgtMS41NzJsLS44NTQgMS40OTYtLjA2NS4xYTEgMSAwIDAgMS0uODAzLjQwNEgyMy4wMmwtLjExOS0uMDA3YTEgMSAwIDAgMS0uNzUtLjQ5N3oiLz48c2NyaXB0IHhtbG5zPSIiLz48L3N2Zz4=\" style=\"height: 20px; width: 20px; vertical-align: middle;\"> sulla mappa. Cliccate su di esse per creare o aggiornare le location. Lo script evita i duplicati controllando entro un raggio di <strong>75 metri</strong> e non disegna le fermate già presenti entro <strong>5 metri</strong>.";
    var common$1 = {
    	scriptName: scriptName$2,
    	layers: layers$1,
    	introduction: introduction$1,
    	readmeLink: readmeLink$1,
    	note: note$1,
    	swissimageUpdateText: swissimageUpdateText$1,
    	publicTransportStopsNote: publicTransportStopsNote$1
    };

    var itCommon = /*#__PURE__*/Object.freeze({
        __proto__: null,
        default: common$1,
        introduction: introduction$1,
        layers: layers$1,
        note: note$1,
        publicTransportStopsNote: publicTransportStopsNote$1,
        readmeLink: readmeLink$1,
        scriptName: scriptName$2,
        swissimageUpdateText: swissimageUpdateText$1
    });

    var scriptName$1 = "WME Schweiz Helfer";
    var layers = {
    	boundaries: {
    		municipality: "Gemeindegrenzen",
    		state: "Kantonsgrenzen"
    	},
    	"3d": "Geografische Namen swissNAMES3D",
    	topo: {
    		national_colors: "Landeskarten (Farbe)"
    	},
    	background: {
    		swissimage: "SWISSIMAGE Hintergrund"
    	},
    	public_transport_stops: "Haltestellen des öffentlichen Verkehrs"
    };
    var introduction = "Dieses Skript fügt Kartenebenen hinzu, die über die rechte Navigationsleiste ganz unten aktiviert werden können.";
    var readmeLink = "Weitere Informationen finden Sie in der <a href=\"https://github.com/73VW/WME-Switzerland-Helper/blob/public-transport-stops-layer/README.de.md\" target=\"_blank\" rel=\"noopener noreferrer\">vollständigen Dokumentation</a>.";
    var note = {
    	layers: {
    		background: {
    			swissimage: "Hinweise"
    		}
    	}
    };
    var swissimageUpdateText = "Diese <a href=\"https://map.geo.admin.ch/#/map?lang=fr&center=2638909.25,1198316.5&z=1.967&topic=swisstopo&layers=ch.swisstopo.images-swissimage-dop10.metadata&bgLayer=ch.swisstopo.pixelkarte-farbe&featureInfo=default&catalogNodes=swisstopo\" target=\"_blank\" rel=\"noopener noreferrer\">Karte</a> zeigt, wann die <b>{{layer}}</b>-Ebene für jede Region aktualisiert wurde.";
    var publicTransportStopsNote = "Haltestellen des öffentlichen Nahverkehrs werden als <strong>orangefarbene Kreissymbole</strong> <img src=\"data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0OSIgaGVpZ2h0PSI0OCIgZmlsbD0iYmxhY2siPjxjaXJjbGUgY3g9IjI0LjcyNiIgY3k9IjI0IiByPSIyMyIgZmlsbD0iI2U2N2UyMiIgc3Ryb2tlPSIjZmZmIiBzdHJva2Utd2lkdGg9IjIiLz48cGF0aCBmaWxsPSIjZmZmIiBkPSJNMjkuNzI2IDE0YTMgMyAwIDAgMSAyLjk5NSAyLjgyNGwuMDA1LjE3NnYxaDEuMDE3bC4xNS4wMDVjLjkzOC4wNiAxLjc2LjY4NCAxLjg0MyAxLjU5MWwuMDA3LjE1NFYyMmwtLjAwNy4xMTdhMSAxIDAgMCAxLS44NzYuODc2bC0uMTE3LjAwNy0uMTE3LS4wMDdhMSAxIDAgMCAxLS44NzYtLjg3NkwzMy43NDMgMjJ2LTJoLTEuMDE3djEwYTEgMSAwIDAgMS0uODgzLjk5M2wtLjExNy4wMDdoLTF2MS41YTEuNSAxLjUgMCAwIDEtMyAwVjMxaC02djEuNWExLjUgMS41IDAgMCAxLTMgMFYzMWgtMWExIDEgMCAwIDEtLjk5My0uODgzTDE2LjcyNiAzMFYyMGgtMXYyYTEgMSAwIDAgMS0uODgzLjk5M2wtLjExNy4wMDdhMSAxIDAgMCAxLS45OTMtLjg4M0wxMy43MjYgMjJ2LTIuMjVjMC0uOTkuODYtMS42ODIgMS44NS0xLjc0NWwuMTUtLjAwNWgxdi0xYTMgMyAwIDAgMSAyLjgyNC0yLjk5NWwuMTc2LS4wMDV6bS0xIDEzaC0xYTEgMSAwIDEgMCAwIDJoMWExIDEgMCAxIDAgMC0ybS03IDBoLTFhMSAxIDAgMSAwIDAgMmgxYTEgMSAwIDEgMCAwLTJtLS40MjktMTFoLTEuNTdsLS4xMTcuMDA3YTEgMSAwIDAgMC0uODc3Ljg3NmwtLjAwNy4xMTd2OGgxMnYtOGwtLjAwNy0uMTE3YTEgMSAwIDAgMC0uNzY0LS44NTdsLS4xMTItLjAyLS4xMTctLjAwNmgtMS41NzJsLS44NTQgMS40OTYtLjA2NS4xYTEgMSAwIDAgMS0uODAzLjQwNEgyMy4wMmwtLjExOS0uMDA3YTEgMSAwIDAgMS0uNzUtLjQ5N3oiLz48c2NyaXB0IHhtbG5zPSIiLz48L3N2Zz4=\" style=\"height: 20px; width: 20px; vertical-align: middle;\"> auf der Karte angezeigt. Klicken Sie darauf, um Venues zu erstellen oder zu aktualisieren. Das Skript vermeidet Duplikate, indem es innerhalb eines Radius von <strong>75 Metern</strong> prüft und keine Haltestellen zeichnet, die bereits innerhalb von <strong>5 Metern</strong> vorhanden sind.";
    var common = {
    	scriptName: scriptName$1,
    	layers: layers,
    	introduction: introduction,
    	readmeLink: readmeLink,
    	note: note,
    	swissimageUpdateText: swissimageUpdateText,
    	publicTransportStopsNote: publicTransportStopsNote
    };

    var deCommon = /*#__PURE__*/Object.freeze({
        __proto__: null,
        default: common,
        introduction: introduction,
        layers: layers,
        note: note,
        publicTransportStopsNote: publicTransportStopsNote,
        readmeLink: readmeLink,
        scriptName: scriptName$1,
        swissimageUpdateText: swissimageUpdateText
    });

    instance.init({
        lng: "en",
        fallbackLng: "en",
        resources: {
            en: {
                common: enCommon,
            },
            fr: {
                common: frCommon,
            },
            it: {
                common: itCommon,
            },
            de: {
                common: deCommon,
            },
        },
    });

    class LayoutElement {
        constructor(args) {
            this.name = args.name;
        }
    }
    class Paragraph extends LayoutElement {
        constructor(args) {
            super({ name: args.name || "" });
            this.content = args.content;
            this.cssClass = args.cssClass;
        }
        render() {
            const classAttr = this.cssClass ? ` class="${this.cssClass}"` : "";
            return `<p${classAttr}>${this.content}</p>`;
        }
    }
    class SidebarItem extends LayoutElement {
        constructor(args) {
            super({ name: args.name });
            this.icon = args.icon;
            this.content = args.content;
        }
        render() {
            const iconHTML = this.icon
                ? `<i class="w-icon ${this.icon} ev-charger-item-icon"></i>`
                : "";
            return `<wz-card class="ev-charger-item" size="sm" elevation="0"><div class="ev-charger-item-header">${iconHTML}<wz-subhead5 class="ev-charger-item-title">${this.name}</wz-subhead5></div><div class="ev-charger-item-content"><p>${this.content}</p></div></wz-card>`;
        }
    }
    class SidebarSection extends LayoutElement {
        constructor(args) {
            super({ name: args.name });
            this.children = args.children || [];
            this.cssClass = args.cssClass;
        }
        addChild(child) {
            this.children.push(child);
            return this;
        }
        render() {
            const childrenHTML = this.children.map((child) => child.render()).join("");
            const classAttr = this.cssClass ? ` ${this.cssClass}` : "";
            return `<div class="section${classAttr}"><div><wz-subhead4 class="title--gltyL">${this.name}</wz-subhead4><div class="content--CrePr">${childrenHTML}</div></div></div>`;
        }
    }
    class SidebarTab {
        constructor(args) {
            this.scriptName = args.scriptName;
            this.children = args.children || [];
        }
        addChild(child) {
            this.children.push(child);
            return this;
        }
        render() {
            const childrenHTML = this.children.map((child) => child.render()).join("");
            return `<div class="sidebar-tab-pane-body">${childrenHTML}</div>`;
        }
    }

    const englishScriptName = "WME Switzerland helper";
    let scriptName = englishScriptName;
    unsafeWindow.SDK_INITIALIZED.then(initScript);
    function initScript() {
        if (!unsafeWindow.getWmeSdk) {
            throw new Error("SDK not available");
        }
        const wmeSDK = unsafeWindow.getWmeSdk({
            scriptId: "wme-switzerland-helper",
            scriptName: englishScriptName,
        });
        console.debug(`SDK v. ${wmeSDK.getSDKVersion()} on ${wmeSDK.getWMEVersion()} initialized`);
        const layers = new Map();
        function activateLanguage() {
            const { localeCode } = wmeSDK.Settings.getLocale();
            instance.changeLanguage(localeCode);
            scriptName = instance.t("common:scriptName", englishScriptName);
        }
        function createLayers() {
            const layerList = [
                new TileLayer({
                    wmeSDK: wmeSDK,
                    name: instance.t("common:layers.boundaries.municipality", "Municipal boundaries"),
                    tileHeight: 256,
                    tileWidth: 256,
                    fileName: "${z}/${x}/${y}.png",
                    servers: [
                        "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissboundaries3d-gemeinde-flaeche.fill/default/current/3857",
                    ],
                    zIndex: 2039,
                }),
                new TileLayer({
                    wmeSDK: wmeSDK,
                    name: instance.t("common:layers.boundaries.state", "Cantonal boundaries"),
                    tileHeight: 256,
                    tileWidth: 256,
                    fileName: "${z}/${x}/${y}.png",
                    servers: [
                        "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissboundaries3d-kanton-flaeche.fill/default/current/3857",
                    ],
                    zIndex: 2038,
                }),
                new TileLayer({
                    wmeSDK: wmeSDK,
                    name: instance.t("common:layers.3d", "Geographical Names swissNAMES3D"),
                    tileHeight: 256,
                    tileWidth: 256,
                    fileName: "${z}/${x}/${y}.png",
                    servers: [
                        "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissnames3d/default/current/3857",
                    ],
                    zIndex: 2037,
                }),
                new TileLayer({
                    wmeSDK: wmeSDK,
                    name: instance.t("common:layers.topo.national_colors", "National Maps (color)"),
                    tileHeight: 256,
                    tileWidth: 256,
                    fileName: "${z}/${x}/${y}.jpeg",
                    servers: [
                        "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857",
                    ],
                    zIndex: 2036,
                }),
                new TileLayer({
                    wmeSDK: wmeSDK,
                    name: instance.t("common:layers.background.swissimage", "SWISSIMAGE Background"),
                    tileHeight: 256,
                    tileWidth: 256,
                    fileName: "${z}/${x}/${y}.jpeg",
                    servers: [
                        "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857",
                    ],
                }),
                new PublicTransportStopsLayer({
                    wmeSDK: wmeSDK,
                    name: instance.t("common:layers.public_transport_stops", "Public Transport Stops"),
                    styleRules: [
                        {
                            style: {
                                fillOpacity: 1,
                                cursor: "pointer",
                                pointRadius: 13,
                                externalGraphic: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0OSIgaGVpZ2h0PSI0OCIgZmlsbD0iYmxhY2siPjxjaXJjbGUgY3g9IjI0LjcyNiIgY3k9IjI0IiByPSIyMyIgZmlsbD0iI2U2N2UyMiIgc3Ryb2tlPSIjZmZmIiBzdHJva2Utd2lkdGg9IjIiLz48cGF0aCBmaWxsPSIjZmZmIiBkPSJNMjkuNzI2IDE0YTMgMyAwIDAgMSAyLjk5NSAyLjgyNGwuMDA1LjE3NnYxaDEuMDE3bC4xNS4wMDVjLjkzOC4wNiAxLjc2LjY4NCAxLjg0MyAxLjU5MWwuMDA3LjE1NFYyMmwtLjAwNy4xMTdhMSAxIDAgMCAxLS44NzYuODc2bC0uMTE3LjAwNy0uMTE3LS4wMDdhMSAxIDAgMCAxLS44NzYtLjg3NkwzMy43NDMgMjJ2LTJoLTEuMDE3djEwYTEgMSAwIDAgMS0uODgzLjk5M2wtLjExNy4wMDdoLTF2MS41YTEuNSAxLjUgMCAwIDEtMyAwVjMxaC02djEuNWExLjUgMS41IDAgMCAxLTMgMFYzMWgtMWExIDEgMCAwIDEtLjk5My0uODgzTDE2LjcyNiAzMFYyMGgtMXYyYTEgMSAwIDAgMS0uODgzLjk5M2wtLjExNy4wMDdhMSAxIDAgMCAxLS45OTMtLjg4M0wxMy43MjYgMjJ2LTIuMjVjMC0uOTkuODYtMS42ODIgMS44NS0xLjc0NWwuMTUtLjAwNWgxdi0xYTMgMyAwIDAgMSAyLjgyNC0yLjk5NWwuMTc2LS4wMDV6bS0xIDEzaC0xYTEgMSAwIDEgMCAwIDJoMWExIDEgMCAxIDAgMC0ybS03IDBoLTFhMSAxIDAgMSAwIDAgMmgxYTEgMSAwIDEgMCAwLTJtLS40MjktMTFoLTEuNTdsLS4xMTcuMDA3YTEgMSAwIDAgMC0uODc3Ljg3NmwtLjAwNy4xMTd2OGgxMnYtOGwtLjAwNy0uMTE3YTEgMSAwIDAgMC0uNzY0LS44NTdsLS4xMTItLjAyLS4xMTctLjAwNmgtMS41NzJsLS44NTQgMS40OTYtLjA2NS4xYTEgMSAwIDAgMS0uODAzLjQwNEgyMy4wMmwtLjExOS0uMDA3YTEgMSAwIDAgMS0uNzUtLjQ5N3oiLz48c2NyaXB0IHhtbG5zPSIiLz48L3N2Zz4=",
                            },
                        },
                    ],
                }),
            ];
            for (const layer of layerList) {
                layers.set(layer.name, layer);
            }
        }
        async function addScriptTab() {
            const { tabLabel, tabPane } = await wmeSDK.Sidebar.registerScriptTab();
            tabLabel.innerText = scriptName;
            const sidebarTab = new SidebarTab({ scriptName });
            sidebarTab.addChild(new Paragraph({
                content: instance.t("common:introduction", "This script adds map layers that can be activated from the right navigation bar, at the very bottom."),
            }));
            sidebarTab.addChild(new Paragraph({
                content: instance.t("common:readmeLink", "For more information, see the full documentation."),
                cssClass: "toto",
            }));
            const notesSection = new SidebarSection({
                name: instance.t("common:note.layers.background.swissimage", "Notes"),
            });
            notesSection.addChild(new SidebarItem({
                name: instance.t("common:layers.background.swissimage", "SWISSIMAGE Background"),
                icon: "w-icon-map",
                content: instance.t("common:swissimageUpdateText", 'This <a href ="https://map.geo.admin.ch/#/map?lang=fr&center=2638909.25,1198316.5&z=1.967&topic=swisstopo&layers=ch.swisstopo.images-swissimage-dop10.metadata&bgLayer=ch.swisstopo.pixelkarte-farbe&featureInfo=default&catalogNodes=swisstopo" target="_blank" rel="noopener noreferrer">map</a> shows when the <b>{{layer}}</b> map was updated for each region.', { layer: instance.t("common:layers.background.swissimage") }),
            }));
            notesSection.addChild(new SidebarItem({
                name: instance.t("common:layers.public_transport_stops", "Public Transport Stops"),
                icon: "w-icon-bus",
                content: instance.t("common:publicTransportStopsNote", "Public transport stops appear as orange circular icons on the map."),
            }));
            sidebarTab.addChild(notesSection);
            tabPane.innerHTML = sidebarTab.render();
        }
        async function init() {
            activateLanguage();
            createLayers();
            await addScriptTab();
            wmeSDK.Events.once({ eventName: "wme-ready" }).then(() => {
                for (const layer of layers.values()) {
                    layer.restoreState({ wmeSDK });
                }
            });
        }
        init();
    }

})();
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWFpbi51c2VyLmpzIiwic291cmNlcyI6WyIuLi8uLi9zcmMvc3RvcmFnZS50cyIsIi4uLy4uL3NyYy9sYXllci50cyIsIi4uLy4uL3NyYy90aWxlTGF5ZXIudHMiLCIuLi8uLi9zcmMvc2JiRGF0YUxheWVyLnRzIiwiLi4vLi4vc3JjL3V0aWxzLnRzIiwiLi4vLi4vc3JjL2ZlYXR1cmVMYXllci50cyIsIi4uL25vZGVfbW9kdWxlcy9AdHVyZi9oZWxwZXJzL2Rpc3QvZXNtL2luZGV4LmpzIiwiLi4vbm9kZV9tb2R1bGVzL0B0dXJmL2ludmFyaWFudC9kaXN0L2VzbS9pbmRleC5qcyIsIi4uL25vZGVfbW9kdWxlcy9AdHVyZi9kaXN0YW5jZS9kaXN0L2VzbS9pbmRleC5qcyIsIi4uLy4uL3NyYy9zdG9wR2VvbWV0cnkudHMiLCIuLi8uLi9zcmMvc3RvcE5hbWVGb3JtYXR0ZXIudHMiLCIuLi8uLi9zcmMvdmVudWVNYXRjaGVyLnRzIiwiLi4vLi4vc3JjL3B1YmxpY1RyYW5zcG9ydFN0b3BzTGF5ZXIudHMiLCIuLi9ub2RlX21vZHVsZXMvaTE4bmV4dC9kaXN0L2VzbS9pMThuZXh0LmpzIiwiLi4vLi4vbG9jYWxlcy9pMThuLnRzIiwiLi4vLi4vc3JjL3NpZGViYXIudHMiLCIuLi8uLi9tYWluLnVzZXIudHMiXSwic291cmNlc0NvbnRlbnQiOlsiLypcbiAqIENvcHlyaWdodCAoYykgMjAyNSBNYcOrbCBQZWRyZXR0aVxuICpcbiAqIFRoaXMgZmlsZSBpcyBwYXJ0IG9mIFdNRSBTd2l0emVybGFuZCBIZWxwZXIuXG4gKlxuICogVGhpcyBwcm9ncmFtIGlzIGZyZWUgc29mdHdhcmU6IHlvdSBjYW4gcmVkaXN0cmlidXRlIGl0IGFuZC9vciBtb2RpZnlcbiAqIGl0IHVuZGVyIHRoZSB0ZXJtcyBvZiB0aGUgR05VIEFmZmVybyBHZW5lcmFsIFB1YmxpYyBMaWNlbnNlIGFzIHB1Ymxpc2hlZCBieVxuICogdGhlIEZyZWUgU29mdHdhcmUgRm91bmRhdGlvbiwgZWl0aGVyIHZlcnNpb24gMyBvZiB0aGUgTGljZW5zZSwgb3JcbiAqIChhdCB5b3VyIG9wdGlvbikgYW55IGxhdGVyIHZlcnNpb24uXG4gKlxuICogVGhpcyBwcm9ncmFtIGlzIGRpc3RyaWJ1dGVkIGluIHRoZSBob3BlIHRoYXQgaXQgd2lsbCBiZSB1c2VmdWwsXG4gKiBidXQgV0lUSE9VVCBBTlkgV0FSUkFOVFk7IHdpdGhvdXQgZXZlbiB0aGUgaW1wbGllZCB3YXJyYW50eSBvZlxuICogTUVSQ0hBTlRBQklMSVRZIG9yIEZJVE5FU1MgRk9SIEEgUEFSVElDVUxBUiBQVVJQT1NFLiAgU2VlIHRoZVxuICogR05VIEFmZmVybyBHZW5lcmFsIFB1YmxpYyBMaWNlbnNlIGZvciBtb3JlIGRldGFpbHMuXG4gKlxuICogWW91IHNob3VsZCBoYXZlIHJlY2VpdmVkIGEgY29weSBvZiB0aGUgR05VIEFmZmVybyBHZW5lcmFsIFB1YmxpYyBMaWNlbnNlXG4gKiBhbG9uZyB3aXRoIHRoaXMgcHJvZ3JhbS4gIElmIG5vdCwgc2VlIDxodHRwczovL3d3dy5nbnUub3JnL2xpY2Vuc2VzLz4uXG4gKi9cblxuY29uc3QgU1RPUkFHRV9LRVkgPSBcIndtZS1zd2l0emVybGFuZC1oZWxwZXItbGF5ZXItc3RhdGVcIjtcblxuaW50ZXJmYWNlIExheWVyU3RhdGUge1xuICBbbGF5ZXJOYW1lOiBzdHJpbmddOiBib29sZWFuO1xufVxuXG5mdW5jdGlvbiBnZXRMYXllclN0YXRlcygpOiBMYXllclN0YXRlIHtcbiAgdHJ5IHtcbiAgICBjb25zdCBzdG9yZWQgPSBsb2NhbFN0b3JhZ2UuZ2V0SXRlbShTVE9SQUdFX0tFWSk7XG4gICAgcmV0dXJuIHN0b3JlZCA/IEpTT04ucGFyc2Uoc3RvcmVkKSA6IHt9O1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4ge307XG4gIH1cbn1cblxuZnVuY3Rpb24gc2F2ZUxheWVyU3RhdGUobGF5ZXJOYW1lOiBzdHJpbmcsIGNoZWNrZWQ6IGJvb2xlYW4pOiB2b2lkIHtcbiAgdHJ5IHtcbiAgICBjb25zdCBzdGF0ZXMgPSBnZXRMYXllclN0YXRlcygpO1xuICAgIHN0YXRlc1tsYXllck5hbWVdID0gY2hlY2tlZDtcbiAgICBsb2NhbFN0b3JhZ2Uuc2V0SXRlbShTVE9SQUdFX0tFWSwgSlNPTi5zdHJpbmdpZnkoc3RhdGVzKSk7XG4gIH0gY2F0Y2gge1xuICAgIGNvbnNvbGUud2FybihcIkZhaWxlZCB0byBzYXZlIGxheWVyIHN0YXRlIHRvIGxvY2FsU3RvcmFnZVwiKTtcbiAgfVxufVxuXG5mdW5jdGlvbiBpc0xheWVyRW5hYmxlZChsYXllck5hbWU6IHN0cmluZyk6IGJvb2xlYW4gfCBudWxsIHtcbiAgY29uc3Qgc3RhdGVzID0gZ2V0TGF5ZXJTdGF0ZXMoKTtcbiAgcmV0dXJuIGxheWVyTmFtZSBpbiBzdGF0ZXMgPyBzdGF0ZXNbbGF5ZXJOYW1lXSA6IG51bGw7XG59XG5cbmV4cG9ydCB7IGdldExheWVyU3RhdGVzLCBzYXZlTGF5ZXJTdGF0ZSwgaXNMYXllckVuYWJsZWQgfTtcbiIsIi8qXG4gKiBDb3B5cmlnaHQgKGMpIDIwMjUgTWHDq2wgUGVkcmV0dGlcbiAqXG4gKiBUaGlzIGZpbGUgaXMgcGFydCBvZiBXTUUgU3dpdHplcmxhbmQgSGVscGVyLlxuICpcbiAqIFRoaXMgcHJvZ3JhbSBpcyBmcmVlIHNvZnR3YXJlOiB5b3UgY2FuIHJlZGlzdHJpYnV0ZSBpdCBhbmQvb3IgbW9kaWZ5XG4gKiBpdCB1bmRlciB0aGUgdGVybXMgb2YgdGhlIEdOVSBBZmZlcm8gR2VuZXJhbCBQdWJsaWMgTGljZW5zZSBhcyBwdWJsaXNoZWQgYnlcbiAqIHRoZSBGcmVlIFNvZnR3YXJlIEZvdW5kYXRpb24sIGVpdGhlciB2ZXJzaW9uIDMgb2YgdGhlIExpY2Vuc2UsIG9yXG4gKiAoYXQgeW91ciBvcHRpb24pIGFueSBsYXRlciB2ZXJzaW9uLlxuICpcbiAqIFRoaXMgcHJvZ3JhbSBpcyBkaXN0cmlidXRlZCBpbiB0aGUgaG9wZSB0aGF0IGl0IHdpbGwgYmUgdXNlZnVsLFxuICogYnV0IFdJVEhPVVQgQU5ZIFdBUlJBTlRZOyB3aXRob3V0IGV2ZW4gdGhlIGltcGxpZWQgd2FycmFudHkgb2ZcbiAqIE1FUkNIQU5UQUJJTElUWSBvciBGSVRORVNTIEZPUiBBIFBBUlRJQ1VMQVIgUFVSUE9TRS4gIFNlZSB0aGVcbiAqIEdOVSBBZmZlcm8gR2VuZXJhbCBQdWJsaWMgTGljZW5zZSBmb3IgbW9yZSBkZXRhaWxzLlxuICpcbiAqIFlvdSBzaG91bGQgaGF2ZSByZWNlaXZlZCBhIGNvcHkgb2YgdGhlIEdOVSBBZmZlcm8gR2VuZXJhbCBQdWJsaWMgTGljZW5zZVxuICogYWxvbmcgd2l0aCB0aGlzIHByb2dyYW0uICBJZiBub3QsIHNlZSA8aHR0cHM6Ly93d3cuZ251Lm9yZy9saWNlbnNlcy8+LlxuICovXG5cbmltcG9ydCB7IFdtZVNESyB9IGZyb20gXCJ3bWUtc2RrLXR5cGluZ3NcIjtcbmltcG9ydCB7IHNhdmVMYXllclN0YXRlLCBpc0xheWVyRW5hYmxlZCB9IGZyb20gXCIuL3N0b3JhZ2VcIjtcblxuYWJzdHJhY3QgY2xhc3MgTGF5ZXIge1xuICBuYW1lOiBzdHJpbmc7XG4gIHByb3RlY3RlZCBldmVudENsZWFudXBzOiBBcnJheTwoKSA9PiB2b2lkPjtcbiAgY29uc3RydWN0b3IoYXJnczogeyBuYW1lOiBzdHJpbmc7IHdtZVNESzogV21lU0RLIH0pIHtcbiAgICB0aGlzLm5hbWUgPSBhcmdzLm5hbWU7XG4gICAgdGhpcy5ldmVudENsZWFudXBzID0gW107XG4gICAgLy8gUmVnaXN0ZXIgY2hlY2tib3ggaW1tZWRpYXRlbHkgZHVyaW5nIGNvbnN0cnVjdGlvblxuICAgIGFyZ3Mud21lU0RLLkxheWVyU3dpdGNoZXIuYWRkTGF5ZXJDaGVja2JveCh7IG5hbWU6IHRoaXMubmFtZSB9KTtcbiAgICB0aGlzLnJlZ2lzdGVyQ2hlY2tib3hIYW5kbGVyKHsgd21lU0RLOiBhcmdzLndtZVNESyB9KTtcbiAgfVxuICBhYnN0cmFjdCBhZGRUb01hcChhcmdzOiB7IHdtZVNESzogV21lU0RLIH0pOiB2b2lkO1xuICByZW1vdmVGcm9tTWFwKGFyZ3M6IHsgd21lU0RLOiBXbWVTREsgfSkge1xuICAgIGFyZ3Mud21lU0RLLk1hcC5yZW1vdmVMYXllcih7IGxheWVyTmFtZTogdGhpcy5uYW1lIH0pO1xuICAgIHRoaXMudW5yZWdpc3RlckV2ZW50cygpO1xuICB9XG5cbiAgLy8gUGVyLWxheWVyIGV2ZW50IHJlZ2lzdHJhdGlvbjsgbXVzdCBiZSBpbXBsZW1lbnRlZCBieSBzdWJjbGFzc2VzXG4gIGFic3RyYWN0IHJlZ2lzdGVyRXZlbnRzKGFyZ3M6IHsgd21lU0RLOiBXbWVTREsgfSk6IHZvaWQ7XG5cbiAgdW5yZWdpc3RlckV2ZW50cygpOiB2b2lkIHtcbiAgICBmb3IgKGNvbnN0IGNsZWFudXAgb2YgdGhpcy5ldmVudENsZWFudXBzKSB7XG4gICAgICB0cnkge1xuICAgICAgICBjbGVhbnVwKCk7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgY29uc29sZS53YXJuKFwiRmFpbGVkIHRvIGNsZWFudXAgbGF5ZXIgZXZlbnQgbGlzdGVuZXJcIik7XG4gICAgICAgIC8qIGlnbm9yZSBjbGVhbnVwIGVycm9ycyAqL1xuICAgICAgfVxuICAgIH1cbiAgICB0aGlzLmV2ZW50Q2xlYW51cHMgPSBbXTtcbiAgfVxuXG4gIC8vIEVhY2ggbGF5ZXIgaGFuZGxlcyBpdHMgb3duIGNoZWNrYm94IHRvZ2dsZSBsb2dpY1xuICBwcm90ZWN0ZWQgcmVnaXN0ZXJDaGVja2JveEhhbmRsZXIoYXJnczogeyB3bWVTREs6IFdtZVNESyB9KTogdm9pZCB7XG4gICAgY29uc3QgeyB3bWVTREsgfSA9IGFyZ3M7XG4gICAgY29uc3QgY2xlYW51cCA9IHdtZVNESy5FdmVudHMub24oe1xuICAgICAgZXZlbnROYW1lOiBcIndtZS1sYXllci1jaGVja2JveC10b2dnbGVkXCIsXG4gICAgICBldmVudEhhbmRsZXI6ICh7IG5hbWUsIGNoZWNrZWQgfSkgPT4ge1xuICAgICAgICBpZiAobmFtZSAhPT0gdGhpcy5uYW1lKSByZXR1cm47XG4gICAgICAgIHNhdmVMYXllclN0YXRlKHRoaXMubmFtZSwgY2hlY2tlZCk7XG4gICAgICAgIGlmIChjaGVja2VkKSB7XG4gICAgICAgICAgdGhpcy5hZGRUb01hcCh7IHdtZVNESyB9KTtcbiAgICAgICAgICB0aGlzLnJlZ2lzdGVyRXZlbnRzKHsgd21lU0RLIH0pO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRoaXMucmVtb3ZlRnJvbU1hcCh7IHdtZVNESyB9KTtcbiAgICAgICAgfVxuICAgICAgfSxcbiAgICB9KTtcbiAgICB0aGlzLmV2ZW50Q2xlYW51cHMucHVzaChjbGVhbnVwKTtcbiAgfVxuXG4gIC8vIFJlc3RvcmUgcGVyc2lzdGVkIHN0YXRlOiBpZiBlbmFibGVkLCBhZGQgdG8gbWFwIGFuZCByZWZsZWN0IGNoZWNrYm94XG4gIHJlc3RvcmVTdGF0ZShhcmdzOiB7IHdtZVNESzogV21lU0RLIH0pOiB2b2lkIHtcbiAgICBjb25zdCB7IHdtZVNESyB9ID0gYXJncztcbiAgICBjb25zdCBlbmFibGVkID0gaXNMYXllckVuYWJsZWQodGhpcy5uYW1lKTtcbiAgICBpZiAoZW5hYmxlZCA9PT0gdHJ1ZSkge1xuICAgICAgdGhpcy5hZGRUb01hcCh7IHdtZVNESyB9KTtcbiAgICAgIHdtZVNESy5MYXllclN3aXRjaGVyLnNldExheWVyQ2hlY2tib3hDaGVja2VkKHtcbiAgICAgICAgbmFtZTogdGhpcy5uYW1lLFxuICAgICAgICBpc0NoZWNrZWQ6IHRydWUsXG4gICAgICB9KTtcbiAgICB9XG4gIH1cbn1cblxuZXhwb3J0IHsgTGF5ZXIgfTtcbiIsIi8qXG4gKiBDb3B5cmlnaHQgKGMpIDIwMjUgTWHDq2wgUGVkcmV0dGlcbiAqXG4gKiBUaGlzIGZpbGUgaXMgcGFydCBvZiBXTUUgU3dpdHplcmxhbmQgSGVscGVyLlxuICpcbiAqIFRoaXMgcHJvZ3JhbSBpcyBmcmVlIHNvZnR3YXJlOiB5b3UgY2FuIHJlZGlzdHJpYnV0ZSBpdCBhbmQvb3IgbW9kaWZ5XG4gKiBpdCB1bmRlciB0aGUgdGVybXMgb2YgdGhlIEdOVSBBZmZlcm8gR2VuZXJhbCBQdWJsaWMgTGljZW5zZSBhcyBwdWJsaXNoZWQgYnlcbiAqIHRoZSBGcmVlIFNvZnR3YXJlIEZvdW5kYXRpb24sIGVpdGhlciB2ZXJzaW9uIDMgb2YgdGhlIExpY2Vuc2UsIG9yXG4gKiAoYXQgeW91ciBvcHRpb24pIGFueSBsYXRlciB2ZXJzaW9uLlxuICpcbiAqIFRoaXMgcHJvZ3JhbSBpcyBkaXN0cmlidXRlZCBpbiB0aGUgaG9wZSB0aGF0IGl0IHdpbGwgYmUgdXNlZnVsLFxuICogYnV0IFdJVEhPVVQgQU5ZIFdBUlJBTlRZOyB3aXRob3V0IGV2ZW4gdGhlIGltcGxpZWQgd2FycmFudHkgb2ZcbiAqIE1FUkNIQU5UQUJJTElUWSBvciBGSVRORVNTIEZPUiBBIFBBUlRJQ1VMQVIgUFVSUE9TRS4gIFNlZSB0aGVcbiAqIEdOVSBBZmZlcm8gR2VuZXJhbCBQdWJsaWMgTGljZW5zZSBmb3IgbW9yZSBkZXRhaWxzLlxuICpcbiAqIFlvdSBzaG91bGQgaGF2ZSByZWNlaXZlZCBhIGNvcHkgb2YgdGhlIEdOVSBBZmZlcm8gR2VuZXJhbCBQdWJsaWMgTGljZW5zZVxuICogYWxvbmcgd2l0aCB0aGlzIHByb2dyYW0uICBJZiBub3QsIHNlZSA8aHR0cHM6Ly93d3cuZ251Lm9yZy9saWNlbnNlcy8+LlxuICovXG5cbmltcG9ydCB7IExheWVyIH0gZnJvbSBcIi4vbGF5ZXJcIjtcbmltcG9ydCB7IFdtZVNESyB9IGZyb20gXCJ3bWUtc2RrLXR5cGluZ3NcIjtcblxuY2xhc3MgVGlsZUxheWVyIGV4dGVuZHMgTGF5ZXIge1xuICB0aWxlSGVpZ2h0OiBudW1iZXI7XG4gIHRpbGVXaWR0aDogbnVtYmVyO1xuICBmaWxlTmFtZTogc3RyaW5nO1xuICBzZXJ2ZXJzOiBzdHJpbmdbXTtcbiAgekluZGV4OiBudW1iZXI7XG4gIGNvbnN0cnVjdG9yKGFyZ3M6IHtcbiAgICBuYW1lOiBzdHJpbmc7XG4gICAgd21lU0RLOiBXbWVTREs7XG4gICAgdGlsZUhlaWdodDogbnVtYmVyO1xuICAgIHRpbGVXaWR0aDogbnVtYmVyO1xuICAgIGZpbGVOYW1lOiBzdHJpbmc7XG4gICAgc2VydmVyczogc3RyaW5nW107XG4gICAgekluZGV4PzogbnVtYmVyOyAvLyBtYWtlIHpJbmRleCBvcHRpb25hbFxuICB9KSB7XG4gICAgc3VwZXIoeyBuYW1lOiBhcmdzLm5hbWUsIHdtZVNESzogYXJncy53bWVTREsgfSk7XG4gICAgdGhpcy50aWxlSGVpZ2h0ID0gYXJncy50aWxlSGVpZ2h0O1xuICAgIHRoaXMudGlsZVdpZHRoID0gYXJncy50aWxlV2lkdGg7XG4gICAgdGhpcy5maWxlTmFtZSA9IGFyZ3MuZmlsZU5hbWU7XG4gICAgdGhpcy5zZXJ2ZXJzID0gYXJncy5zZXJ2ZXJzO1xuICAgIHRoaXMuekluZGV4ID0gYXJncy56SW5kZXggPz8gMjAzNTsgLy8gc2V0IGRlZmF1bHQgdmFsdWUgaWYgbm90IHByb3ZpZGVkXG4gIH1cbiAgYWRkVG9NYXAoYXJnczogeyB3bWVTREs6IFdtZVNESyB9KSB7XG4gICAgY29uc3Qgd21lU0RLID0gYXJncy53bWVTREs7XG5cbiAgICB3bWVTREsuTWFwLmFkZFRpbGVMYXllcih7XG4gICAgICBsYXllck5hbWU6IHRoaXMubmFtZSxcbiAgICAgIGxheWVyT3B0aW9uczoge1xuICAgICAgICB0aWxlSGVpZ2h0OiB0aGlzLnRpbGVIZWlnaHQsXG4gICAgICAgIHRpbGVXaWR0aDogdGhpcy50aWxlV2lkdGgsXG4gICAgICAgIHVybDoge1xuICAgICAgICAgIGZpbGVOYW1lOiB0aGlzLmZpbGVOYW1lLFxuICAgICAgICAgIHNlcnZlcnM6IHRoaXMuc2VydmVycyxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgfSk7XG4gICAgLy8gZGVmYXVsdCBtYXAgemluZGV4IGFyZSBiZXR3ZWVuIDIwMDAgYW5kIDIwNjVcbiAgICAvLyBTZWdtZW50cyBsYXllciBoYXMgei1pbmRleCAyMDYwXG4gICAgLy8gQmFja2dyb3VuZCBsYXllciBoYXMgei1pbmRleCAyMDEwXG4gICAgd21lU0RLLk1hcC5zZXRMYXllclpJbmRleCh7XG4gICAgICBsYXllck5hbWU6IHRoaXMubmFtZSxcbiAgICAgIHpJbmRleDogdGhpcy56SW5kZXgsXG4gICAgfSk7XG4gIH1cblxuICByZWdpc3RlckV2ZW50cyhhcmdzOiB7IHdtZVNESzogV21lU0RLIH0pOiB2b2lkIHtcbiAgICAvLyBQYXMgZCfDqXbDqW5lbWVudHMgZHluYW1pcXVlcyBwb3VyIGxlcyBjb3VjaGVzIGRlIHR1aWxlcy5cbiAgfVxufVxuXG5leHBvcnQgeyBUaWxlTGF5ZXIgfTtcbiIsIi8qXG4gKiBDb3B5cmlnaHQgKGMpIDIwMjUgTWHDq2wgUGVkcmV0dGlcbiAqXG4gKiBUaGlzIGZpbGUgaXMgcGFydCBvZiBXTUUgU3dpdHplcmxhbmQgSGVscGVyLlxuICpcbiAqIFRoaXMgcHJvZ3JhbSBpcyBmcmVlIHNvZnR3YXJlOiB5b3UgY2FuIHJlZGlzdHJpYnV0ZSBpdCBhbmQvb3IgbW9kaWZ5XG4gKiBpdCB1bmRlciB0aGUgdGVybXMgb2YgdGhlIEdOVSBBZmZlcm8gR2VuZXJhbCBQdWJsaWMgTGljZW5zZSBhcyBwdWJsaXNoZWQgYnlcbiAqIHRoZSBGcmVlIFNvZnR3YXJlIEZvdW5kYXRpb24sIGVpdGhlciB2ZXJzaW9uIDMgb2YgdGhlIExpY2Vuc2UsIG9yXG4gKiAoYXQgeW91ciBvcHRpb24pIGFueSBsYXRlciB2ZXJzaW9uLlxuICpcbiAqIFRoaXMgcHJvZ3JhbSBpcyBkaXN0cmlidXRlZCBpbiB0aGUgaG9wZSB0aGF0IGl0IHdpbGwgYmUgdXNlZnVsLFxuICogYnV0IFdJVEhPVVQgQU5ZIFdBUlJBTlRZOyB3aXRob3V0IGV2ZW4gdGhlIGltcGxpZWQgd2FycmFudHkgb2ZcbiAqIE1FUkNIQU5UQUJJTElUWSBvciBGSVRORVNTIEZPUiBBIFBBUlRJQ1VMQVIgUFVSUE9TRS4gIFNlZSB0aGVcbiAqIEdOVSBBZmZlcm8gR2VuZXJhbCBQdWJsaWMgTGljZW5zZSBmb3IgbW9yZSBkZXRhaWxzLlxuICpcbiAqIFlvdSBzaG91bGQgaGF2ZSByZWNlaXZlZCBhIGNvcHkgb2YgdGhlIEdOVSBBZmZlcm8gR2VuZXJhbCBQdWJsaWMgTGljZW5zZVxuICogYWxvbmcgd2l0aCB0aGlzIHByb2dyYW0uICBJZiBub3QsIHNlZSA8aHR0cHM6Ly93d3cuZ251Lm9yZy9saWNlbnNlcy8+LlxuICovXG5cbmltcG9ydCB7IFdtZVNESyB9IGZyb20gXCJ3bWUtc2RrLXR5cGluZ3NcIjtcblxuaW50ZXJmYWNlIFNCQlJlY29yZCB7XG4gIG51bWJlcjogc3RyaW5nO1xuICBnZW9wb3NfaGFsdGVzdGVsbGU6IHtcbiAgICBsYXQ6IG51bWJlcjtcbiAgICBsb246IG51bWJlcjtcbiAgfTtcbiAgW2tleTogc3RyaW5nXTogdW5rbm93bjtcbn1cblxuY2xhc3MgU0JCRGF0YUZldGNoZXIge1xuICBwcml2YXRlIHJlYWRvbmx5IGJhc2VVcmw6IHN0cmluZztcbiAgcHJpdmF0ZSByZWFkb25seSBkYXRhU2V0OiBzdHJpbmc7XG4gIHByaXZhdGUgcmVhZG9ubHkgbWF4UmVjb3Jkc1BlclBhZ2U6IG51bWJlcjtcblxuICBjb25zdHJ1Y3RvcihhcmdzOiB7IGRhdGFTZXQ6IHN0cmluZyB9KSB7XG4gICAgdGhpcy5iYXNlVXJsID0gXCJodHRwczovL2RhdGEuc2JiLmNoL2FwaS9leHBsb3JlL3YyLjEvY2F0YWxvZy9kYXRhc2V0c1wiO1xuICAgIHRoaXMuZGF0YVNldCA9IGFyZ3MuZGF0YVNldDtcbiAgICB0aGlzLm1heFJlY29yZHNQZXJQYWdlID0gNTA7XG4gIH1cblxuICBhc3luYyAqZmV0Y2hSZWNvcmRzKGFyZ3M6IHtcbiAgICB3bWVTREs6IFdtZVNESztcbiAgICBvZmZzZXQ/OiBudW1iZXI7XG4gIH0pOiBBc3luY0dlbmVyYXRvcjxTQkJSZWNvcmRbXSwgdm9pZCwgdW5rbm93bj4ge1xuICAgIGNvbnN0IHsgd21lU0RLLCBvZmZzZXQgPSAwIH0gPSBhcmdzO1xuICAgIGNvbnN0IG1hcEV4dGVudCA9IHdtZVNESy5NYXAuZ2V0TWFwRXh0ZW50KCk7XG4gICAgY29uc3QgeDEgPSBtYXBFeHRlbnRbMF07XG4gICAgY29uc3QgeTEgPSBtYXBFeHRlbnRbMV07XG4gICAgY29uc3QgeDIgPSBtYXBFeHRlbnRbMl07XG4gICAgY29uc3QgeTIgPSBtYXBFeHRlbnRbM107XG4gICAgY29uc3QgdXJsID0gYCR7dGhpcy5iYXNlVXJsfS8ke3RoaXMuZGF0YVNldH0vcmVjb3Jkcz93aGVyZT1pbl9iYm94KGdlb3Bvc19oYWx0ZXN0ZWxsZSwke3kxfSwke3gxfSwke3kyfSwke3gyfSkmbGltaXQ9NTAmb2Zmc2V0PSR7b2Zmc2V0fWA7XG5cbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IEdNLnhtbEh0dHBSZXF1ZXN0KHtcbiAgICAgIG1ldGhvZDogXCJHRVRcIixcbiAgICAgIHVybCxcbiAgICAgIHJlc3BvbnNlVHlwZTogXCJqc29uXCIsXG4gICAgfSk7XG5cbiAgICBjb25zdCBiYXRjaCA9IChyZXNwb25zZS5yZXNwb25zZT8ucmVzdWx0cyBhcyBTQkJSZWNvcmRbXSkgfHwgW107XG4gICAgeWllbGQgYmF0Y2g7XG5cbiAgICBpZiAoYmF0Y2gubGVuZ3RoID09PSB0aGlzLm1heFJlY29yZHNQZXJQYWdlKSB7XG4gICAgICB5aWVsZCogdGhpcy5mZXRjaFJlY29yZHMoe1xuICAgICAgICB3bWVTREssXG4gICAgICAgIG9mZnNldDogb2Zmc2V0ICsgdGhpcy5tYXhSZWNvcmRzUGVyUGFnZSxcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxufVxuXG5leHBvcnQgeyBTQkJEYXRhRmV0Y2hlciB9O1xuZXhwb3J0IHR5cGUgeyBTQkJSZWNvcmQgfTtcbiIsIi8qXG4gKiBDb3B5cmlnaHQgKGMpIDIwMjUgTWHDq2wgUGVkcmV0dGlcbiAqXG4gKiBUaGlzIGZpbGUgaXMgcGFydCBvZiBXTUUgU3dpdHplcmxhbmQgSGVscGVyLlxuICpcbiAqIFRoaXMgcHJvZ3JhbSBpcyBmcmVlIHNvZnR3YXJlOiB5b3UgY2FuIHJlZGlzdHJpYnV0ZSBpdCBhbmQvb3IgbW9kaWZ5XG4gKiBpdCB1bmRlciB0aGUgdGVybXMgb2YgdGhlIEdOVSBBZmZlcm8gR2VuZXJhbCBQdWJsaWMgTGljZW5zZSBhcyBwdWJsaXNoZWQgYnlcbiAqIHRoZSBGcmVlIFNvZnR3YXJlIEZvdW5kYXRpb24sIGVpdGhlciB2ZXJzaW9uIDMgb2YgdGhlIExpY2Vuc2UsIG9yXG4gKiAoYXQgeW91ciBvcHRpb24pIGFueSBsYXRlciB2ZXJzaW9uLlxuICpcbiAqIFRoaXMgcHJvZ3JhbSBpcyBkaXN0cmlidXRlZCBpbiB0aGUgaG9wZSB0aGF0IGl0IHdpbGwgYmUgdXNlZnVsLFxuICogYnV0IFdJVEhPVVQgQU5ZIFdBUlJBTlRZOyB3aXRob3V0IGV2ZW4gdGhlIGltcGxpZWQgd2FycmFudHkgb2ZcbiAqIE1FUkNIQU5UQUJJTElUWSBvciBGSVRORVNTIEZPUiBBIFBBUlRJQ1VMQVIgUFVSUE9TRS4gIFNlZSB0aGVcbiAqIEdOVSBBZmZlcm8gR2VuZXJhbCBQdWJsaWMgTGljZW5zZSBmb3IgbW9yZSBkZXRhaWxzLlxuICpcbiAqIFlvdSBzaG91bGQgaGF2ZSByZWNlaXZlZCBhIGNvcHkgb2YgdGhlIEdOVSBBZmZlcm8gR2VuZXJhbCBQdWJsaWMgTGljZW5zZVxuICogYWxvbmcgd2l0aCB0aGlzIHByb2dyYW0uICBJZiBub3QsIHNlZSA8aHR0cHM6Ly93d3cuZ251Lm9yZy9saWNlbnNlcy8+LlxuICovXG5cbi8qKlxuICogQ2FsY3VsYXRlIHRoZSBkaXN0YW5jZSBiZXR3ZWVuIHR3byBHUFMgY29vcmRpbmF0ZXMgdXNpbmcgdGhlIEhhdmVyc2luZSBmb3JtdWxhXG4gKiBAcGFyYW0gbGF0MSBMYXRpdHVkZSBvZiBmaXJzdCBwb2ludFxuICogQHBhcmFtIGxvbjEgTG9uZ2l0dWRlIG9mIGZpcnN0IHBvaW50XG4gKiBAcGFyYW0gbGF0MiBMYXRpdHVkZSBvZiBzZWNvbmQgcG9pbnRcbiAqIEBwYXJhbSBsb24yIExvbmdpdHVkZSBvZiBzZWNvbmQgcG9pbnRcbiAqIEByZXR1cm5zIERpc3RhbmNlIGluIG1ldGVyc1xuICovXG5mdW5jdGlvbiBoYXZlcnNpbmVEaXN0YW5jZShcbiAgbGF0MTogbnVtYmVyLFxuICBsb24xOiBudW1iZXIsXG4gIGxhdDI6IG51bWJlcixcbiAgbG9uMjogbnVtYmVyLFxuKTogbnVtYmVyIHtcbiAgY29uc3QgUiA9IDYzNzEwMDA7IC8vIHJhZGl1cyBvZiBFYXJ0aCBpbiBtZXRlcnNcbiAgY29uc3QgdG9SYWQgPSAoeDogbnVtYmVyKSA9PiAoeCAqIE1hdGguUEkpIC8gMTgwO1xuXG4gIGNvbnN0IGRMYXQgPSB0b1JhZChsYXQyIC0gbGF0MSk7XG4gIGNvbnN0IGRMb24gPSB0b1JhZChsb24yIC0gbG9uMSk7XG5cbiAgY29uc3QgYSA9XG4gICAgTWF0aC5zaW4oZExhdCAvIDIpICoqIDIgK1xuICAgIE1hdGguY29zKHRvUmFkKGxhdDEpKSAqIE1hdGguY29zKHRvUmFkKGxhdDIpKSAqIE1hdGguc2luKGRMb24gLyAyKSAqKiAyO1xuXG4gIGNvbnN0IGMgPSAyICogTWF0aC5hdGFuMihNYXRoLnNxcnQoYSksIE1hdGguc3FydCgxIC0gYSkpO1xuXG4gIHJldHVybiBSICogYzsgLy8gZGlzdGFuY2UgaW4gbWV0ZXJzXG59XG5cbmludGVyZmFjZSBEaWFsb2dCdXR0b24ge1xuICBsYWJlbDogc3RyaW5nO1xuICB2YWx1ZTogc3RyaW5nO1xufVxuXG5pbnRlcmZhY2UgRGlhbG9nT3B0aW9ucyB7XG4gIG1lc3NhZ2U6IHN0cmluZztcbiAgYnV0dG9uczogRGlhbG9nQnV0dG9uW107XG59XG5cbi8qKlxuICogU2hvdyBhIG1vZGFsIGRpYWxvZyB0byB0aGUgdXNlciB3aXRoIGN1c3RvbSBidXR0b25zXG4gKiBAcGFyYW0gb3B0aW9ucyBEaWFsb2cgb3B0aW9ucyBpbmNsdWRpbmcgbWVzc2FnZSBhbmQgYnV0dG9uc1xuICogQHJldHVybnMgUHJvbWlzZSB0aGF0IHJlc29sdmVzIHdpdGggdGhlIHZhbHVlIG9mIHRoZSBjbGlja2VkIGJ1dHRvblxuICovXG5mdW5jdGlvbiBzaG93V21lRGlhbG9nKG9wdGlvbnM6IERpYWxvZ09wdGlvbnMpOiBQcm9taXNlPHN0cmluZz4ge1xuICBjb25zdCB7IG1lc3NhZ2UsIGJ1dHRvbnMgfSA9IG9wdGlvbnM7XG4gIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xuICAgIGNvbnN0IG1vZGFsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICBtb2RhbC5zdHlsZS5wb3NpdGlvbiA9IFwiZml4ZWRcIjtcbiAgICBtb2RhbC5zdHlsZS50b3AgPSBcIjUwJVwiO1xuICAgIG1vZGFsLnN0eWxlLmxlZnQgPSBcIjUwJVwiO1xuICAgIG1vZGFsLnN0eWxlLnRyYW5zZm9ybSA9IFwidHJhbnNsYXRlKC01MCUsIC01MCUpXCI7XG4gICAgbW9kYWwuc3R5bGUuYmFja2dyb3VuZCA9IFwiI2ZmZlwiO1xuICAgIG1vZGFsLnN0eWxlLnBhZGRpbmcgPSBcIjIwcHhcIjtcbiAgICBtb2RhbC5zdHlsZS5ib3hTaGFkb3cgPSBcIjAgMnB4IDEwcHggcmdiYSgwLDAsMCwwLjUpXCI7XG4gICAgbW9kYWwuc3R5bGUuekluZGV4ID0gXCIxMDAwMFwiO1xuICAgIG1vZGFsLnN0eWxlLmJvcmRlclJhZGl1cyA9IFwiNnB4XCI7XG4gICAgbW9kYWwuc3R5bGUudGV4dEFsaWduID0gXCJjZW50ZXJcIjtcbiAgICBtb2RhbC5zdHlsZS5taW5XaWR0aCA9IFwiMjAwcHhcIjtcblxuICAgIC8vIEJ1aWxkIEhUTUxcbiAgICBjb25zdCBtc2cgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwicFwiKTtcbiAgICBtc2cuaW5uZXJIVE1MID0gbWVzc2FnZTtcbiAgICBtb2RhbC5hcHBlbmRDaGlsZChtc2cpO1xuXG4gICAgYnV0dG9ucy5mb3JFYWNoKCh7IGxhYmVsLCB2YWx1ZSB9KSA9PiB7XG4gICAgICBjb25zdCBidG4gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiYnV0dG9uXCIpO1xuICAgICAgYnRuLnRleHRDb250ZW50ID0gbGFiZWw7XG4gICAgICBidG4uY2xhc3NOYW1lID0gXCJidG4gYnRuLWRlZmF1bHRcIjtcbiAgICAgIGJ0bi5zdHlsZS5tYXJnaW4gPSBcIjVweFwiO1xuICAgICAgYnRuLm9uY2xpY2sgPSAoKSA9PiB7XG4gICAgICAgIG1vZGFsLnJlbW92ZSgpO1xuICAgICAgICByZXNvbHZlKHZhbHVlKTtcbiAgICAgIH07XG4gICAgICBtb2RhbC5hcHBlbmRDaGlsZChidG4pO1xuICAgIH0pO1xuXG4gICAgLy8gQWRkIG1vZGFsIHRvIHBhZ2VcbiAgICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKG1vZGFsKTtcbiAgfSk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHdhaXRGb3JNYXBJZGxlKGFyZ3M6IHtcbiAgd21lU0RLOiBpbXBvcnQoXCJ3bWUtc2RrLXR5cGluZ3NcIikuV21lU0RLO1xuICBpbnRlcnZhbE1zPzogbnVtYmVyO1xuICBtYXhUcmllcz86IG51bWJlcjtcbn0pOiBQcm9taXNlPHZvaWQ+IHtcbiAgY29uc3QgeyB3bWVTREssIGludGVydmFsTXMgPSA1MCwgbWF4VHJpZXMgPSA2MCB9ID0gYXJncztcblxuICBmb3IgKGxldCBpID0gMDsgaSA8IG1heFRyaWVzOyBpICs9IDEpIHtcbiAgICBpZiAoIXdtZVNESy5TdGF0ZS5pc01hcExvYWRpbmcoKSkge1xuICAgICAgYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgMTAwKSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiBzZXRUaW1lb3V0KHJlc29sdmUsIGludGVydmFsTXMpKTtcbiAgfVxufVxuXG5leHBvcnQgeyBoYXZlcnNpbmVEaXN0YW5jZSwgc2hvd1dtZURpYWxvZywgd2FpdEZvck1hcElkbGUgfTtcbiIsIi8qXG4gKiBDb3B5cmlnaHQgKGMpIDIwMjUgTWHDq2wgUGVkcmV0dGlcbiAqXG4gKiBUaGlzIGZpbGUgaXMgcGFydCBvZiBXTUUgU3dpdHplcmxhbmQgSGVscGVyLlxuICpcbiAqIFRoaXMgcHJvZ3JhbSBpcyBmcmVlIHNvZnR3YXJlOiB5b3UgY2FuIHJlZGlzdHJpYnV0ZSBpdCBhbmQvb3IgbW9kaWZ5XG4gKiBpdCB1bmRlciB0aGUgdGVybXMgb2YgdGhlIEdOVSBBZmZlcm8gR2VuZXJhbCBQdWJsaWMgTGljZW5zZSBhcyBwdWJsaXNoZWQgYnlcbiAqIHRoZSBGcmVlIFNvZnR3YXJlIEZvdW5kYXRpb24sIGVpdGhlciB2ZXJzaW9uIDMgb2YgdGhlIExpY2Vuc2UsIG9yXG4gKiAoYXQgeW91ciBvcHRpb24pIGFueSBsYXRlciB2ZXJzaW9uLlxuICpcbiAqIFRoaXMgcHJvZ3JhbSBpcyBkaXN0cmlidXRlZCBpbiB0aGUgaG9wZSB0aGF0IGl0IHdpbGwgYmUgdXNlZnVsLFxuICogYnV0IFdJVEhPVVQgQU5ZIFdBUlJBTlRZOyB3aXRob3V0IGV2ZW4gdGhlIGltcGxpZWQgd2FycmFudHkgb2ZcbiAqIE1FUkNIQU5UQUJJTElUWSBvciBGSVRORVNTIEZPUiBBIFBBUlRJQ1VMQVIgUFVSUE9TRS4gIFNlZSB0aGVcbiAqIEdOVSBBZmZlcm8gR2VuZXJhbCBQdWJsaWMgTGljZW5zZSBmb3IgbW9yZSBkZXRhaWxzLlxuICpcbiAqIFlvdSBzaG91bGQgaGF2ZSByZWNlaXZlZCBhIGNvcHkgb2YgdGhlIEdOVSBBZmZlcm8gR2VuZXJhbCBQdWJsaWMgTGljZW5zZVxuICogYWxvbmcgd2l0aCB0aGlzIHByb2dyYW0uICBJZiBub3QsIHNlZSA8aHR0cHM6Ly93d3cuZ251Lm9yZy9saWNlbnNlcy8+LlxuICovXG5cbmltcG9ydCB7XG4gIFdtZVNESyxcbiAgU2RrRmVhdHVyZSxcbiAgU2RrRmVhdHVyZVN0eWxlQ29udGV4dCxcbiAgU2RrRmVhdHVyZVN0eWxlUnVsZSxcbn0gZnJvbSBcIndtZS1zZGstdHlwaW5nc1wiO1xuaW1wb3J0IHsgTGF5ZXIgfSBmcm9tIFwiLi9sYXllclwiO1xuaW1wb3J0IHsgd2FpdEZvck1hcElkbGUgfSBmcm9tIFwiLi91dGlsc1wiO1xuXG5pbnRlcmZhY2UgRmVhdHVyZUxheWVyQ29uc3RydWN0b3JBcmdzIHtcbiAgbmFtZTogc3RyaW5nO1xuICBzdHlsZUNvbnRleHQ/OiBTZGtGZWF0dXJlU3R5bGVDb250ZXh0O1xuICBzdHlsZVJ1bGVzPzogU2RrRmVhdHVyZVN0eWxlUnVsZVtdO1xuICBtaW5ab29tTGV2ZWw/OiBudW1iZXI7XG59XG5cbmFic3RyYWN0IGNsYXNzIEZlYXR1cmVMYXllciBleHRlbmRzIExheWVyIHtcbiAgc3R5bGVDb250ZXh0PzogU2RrRmVhdHVyZVN0eWxlQ29udGV4dDtcbiAgc3R5bGVSdWxlcz86IFNka0ZlYXR1cmVTdHlsZVJ1bGVbXTtcbiAgZmVhdHVyZXM6IE1hcDxzdHJpbmcgfCBudW1iZXIsIHVua25vd24+O1xuICBtaW5ab29tTGV2ZWw6IG51bWJlcjtcbiAgcHJvdGVjdGVkIHZpc2libGVGZWF0dXJlSWRzOiBTZXQ8c3RyaW5nPjtcblxuICBjb25zdHJ1Y3RvcihhcmdzOiBGZWF0dXJlTGF5ZXJDb25zdHJ1Y3RvckFyZ3MgJiB7IHdtZVNESzogV21lU0RLIH0pIHtcbiAgICBzdXBlcih7IG5hbWU6IGFyZ3MubmFtZSwgd21lU0RLOiBhcmdzLndtZVNESyB9KTtcbiAgICB0aGlzLnN0eWxlQ29udGV4dCA9IGFyZ3Muc3R5bGVDb250ZXh0O1xuICAgIHRoaXMuc3R5bGVSdWxlcyA9IGFyZ3Muc3R5bGVSdWxlcztcbiAgICB0aGlzLmZlYXR1cmVzID0gbmV3IE1hcCgpO1xuICAgIHRoaXMudmlzaWJsZUZlYXR1cmVJZHMgPSBuZXcgU2V0KCk7XG4gICAgdGhpcy5taW5ab29tTGV2ZWwgPSBhcmdzLm1pblpvb21MZXZlbCA/PyAxNTtcbiAgfVxuXG4gIGFzeW5jIGFkZFRvTWFwKGFyZ3M6IHsgd21lU0RLOiBXbWVTREsgfSk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHsgd21lU0RLIH0gPSBhcmdzO1xuICAgIHdtZVNESy5NYXAuYWRkTGF5ZXIoe1xuICAgICAgbGF5ZXJOYW1lOiB0aGlzLm5hbWUsXG4gICAgICBzdHlsZUNvbnRleHQ6IHRoaXMuc3R5bGVDb250ZXh0LFxuICAgICAgc3R5bGVSdWxlczogdGhpcy5zdHlsZVJ1bGVzLFxuICAgIH0pO1xuXG4gICAgd21lU0RLLkV2ZW50cy50cmFja0xheWVyRXZlbnRzKHsgbGF5ZXJOYW1lOiB0aGlzLm5hbWUgfSk7XG5cbiAgICBhd2FpdCB0aGlzLnJlbmRlcih7IHdtZVNESyB9KTtcbiAgfVxuXG4gIHJlbW92ZUZyb21NYXAoYXJnczogeyB3bWVTREs6IFdtZVNESyB9KTogdm9pZCB7XG4gICAgc3VwZXIucmVtb3ZlRnJvbU1hcChhcmdzKTtcbiAgICB0aGlzLnZpc2libGVGZWF0dXJlSWRzLmNsZWFyKCk7XG4gIH1cblxuICBhYnN0cmFjdCBmZWF0dXJlQ2xpY2tlZChhcmdzOiB7XG4gICAgd21lU0RLOiBXbWVTREs7XG4gICAgZmVhdHVyZUlkOiBzdHJpbmcgfCBudW1iZXI7XG4gIH0pOiBQcm9taXNlPHZvaWQ+O1xuXG4gIGFic3RyYWN0IGdldFJlY29yZElkKGFyZ3M6IHsgcmVjb3JkOiB1bmtub3duIH0pOiBzdHJpbmc7XG5cbiAgYWJzdHJhY3QgbWFwUmVjb3JkVG9GZWF0dXJlKGFyZ3M6IHsgcmVjb3JkOiB1bmtub3duIH0pOiBTZGtGZWF0dXJlO1xuXG4gIGFic3RyYWN0IGZldGNoRGF0YShhcmdzOiB7XG4gICAgd21lU0RLOiBXbWVTREs7XG4gIH0pOiBBc3luY0dlbmVyYXRvcjx1bmtub3duW10sIHZvaWQsIHVua25vd24+O1xuXG4gIC8vIE9wdGlvbmFsIGhvb2sgdG8gcHJlcGFyZSBjb250ZXh0IHVzZWQgYnkgZmlsdGVyaW5nXG4gIGdldEZpbHRlckNvbnRleHQ/KGFyZ3M6IHsgd21lU0RLOiBXbWVTREsgfSk6IHVua25vd247XG5cbiAgYWJzdHJhY3Qgc2hvdWxkRHJhd1JlY29yZChhcmdzOiB7XG4gICAgd21lU0RLOiBXbWVTREs7XG4gICAgcmVjb3JkOiB1bmtub3duO1xuICAgIGNvbnRleHQ/OiB1bmtub3duO1xuICB9KTogYm9vbGVhbjtcblxuICBwcml2YXRlIGRyYXdGZWF0dXJlc0JhdGNoKGFyZ3M6IHtcbiAgICB3bWVTREs6IFdtZVNESztcbiAgICByZWNvcmRzOiB1bmtub3duW107XG4gIH0pOiB2b2lkIHtcbiAgICBjb25zdCB7IHdtZVNESywgcmVjb3JkcyB9ID0gYXJncztcbiAgICBjb25zdCB3YXplRmVhdHVyZXMgPSByZWNvcmRzLm1hcCgocikgPT5cbiAgICAgIHRoaXMubWFwUmVjb3JkVG9GZWF0dXJlKHsgcmVjb3JkOiByIH0pLFxuICAgICk7XG4gICAgd21lU0RLLk1hcC5hZGRGZWF0dXJlc1RvTGF5ZXIoe1xuICAgICAgZmVhdHVyZXM6IHdhemVGZWF0dXJlcyxcbiAgICAgIGxheWVyTmFtZTogdGhpcy5uYW1lLFxuICAgIH0pO1xuICB9XG5cbiAgcmVtb3ZlRmVhdHVyZShhcmdzOiB7IHdtZVNESzogV21lU0RLOyBmZWF0dXJlSWQ6IHN0cmluZyB8IG51bWJlciB9KTogdm9pZCB7XG4gICAgY29uc3QgeyB3bWVTREssIGZlYXR1cmVJZCB9ID0gYXJncztcbiAgICBjb25zdCBmZWF0dXJlSWRTdHIgPSBTdHJpbmcoZmVhdHVyZUlkKTtcbiAgICB3bWVTREsuTWFwLnJlbW92ZUZlYXR1cmVGcm9tTGF5ZXIoe1xuICAgICAgZmVhdHVyZUlkOiBmZWF0dXJlSWRTdHIsXG4gICAgICBsYXllck5hbWU6IHRoaXMubmFtZSxcbiAgICB9KTtcblxuICAgIHRoaXMudmlzaWJsZUZlYXR1cmVJZHMuZGVsZXRlKGZlYXR1cmVJZFN0cik7XG4gIH1cblxuICByZWZpbHRlckZlYXR1cmVzKGFyZ3M6IHsgd21lU0RLOiBXbWVTREsgfSk6IHZvaWQge1xuICAgIGNvbnN0IHsgd21lU0RLIH0gPSBhcmdzO1xuXG4gICAgY29uc3QgY2hlY2tlZCA9IHdtZVNESy5MYXllclN3aXRjaGVyLmlzTGF5ZXJDaGVja2JveENoZWNrZWQoe1xuICAgICAgbmFtZTogdGhpcy5uYW1lLFxuICAgIH0pO1xuICAgIGlmICghY2hlY2tlZCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCBjb250ZXh0ID0gdGhpcy5nZXRGaWx0ZXJDb250ZXh0Py4oeyB3bWVTREsgfSk7XG4gICAgY29uc3QgdG9IaWRlID0gQXJyYXkuZnJvbSh0aGlzLnZpc2libGVGZWF0dXJlSWRzKS5maWx0ZXIoKGZlYXR1cmVJZCkgPT4ge1xuICAgICAgY29uc3QgcmVjb3JkID0gdGhpcy5mZWF0dXJlcy5nZXQoZmVhdHVyZUlkKTtcbiAgICAgIHJldHVybiByZWNvcmQgJiYgIXRoaXMuc2hvdWxkRHJhd1JlY29yZCh7IHdtZVNESywgcmVjb3JkLCBjb250ZXh0IH0pO1xuICAgIH0pO1xuXG4gICAgaWYgKHRvSGlkZS5sZW5ndGggPiAwKSB7XG4gICAgICB3bWVTREsuTWFwLnJlbW92ZUZlYXR1cmVzRnJvbUxheWVyKHtcbiAgICAgICAgZmVhdHVyZUlkczogdG9IaWRlLFxuICAgICAgICBsYXllck5hbWU6IHRoaXMubmFtZSxcbiAgICAgIH0pO1xuXG4gICAgICBmb3IgKGNvbnN0IGZlYXR1cmVJZCBvZiB0b0hpZGUpIHtcbiAgICAgICAgdGhpcy52aXNpYmxlRmVhdHVyZUlkcy5kZWxldGUoZmVhdHVyZUlkKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBhc3luYyByZW5kZXIoYXJnczogeyB3bWVTREs6IFdtZVNESyB9KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgeyB3bWVTREsgfSA9IGFyZ3M7XG5cbiAgICBjb25zdCBjaGVja2VkID0gd21lU0RLLkxheWVyU3dpdGNoZXIuaXNMYXllckNoZWNrYm94Q2hlY2tlZCh7XG4gICAgICBuYW1lOiB0aGlzLm5hbWUsXG4gICAgfSk7XG4gICAgaWYgKCFjaGVja2VkKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3Qgem9vbUxldmVsID0gd21lU0RLLk1hcC5nZXRab29tTGV2ZWwoKTtcbiAgICBpZiAoem9vbUxldmVsIDwgdGhpcy5taW5ab29tTGV2ZWwpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBhbGxSZWNvcmRzOiB1bmtub3duW10gPSBbXTtcbiAgICBmb3IgYXdhaXQgKGNvbnN0IGJhdGNoIG9mIHRoaXMuZmV0Y2hEYXRhKHsgd21lU0RLIH0pKSB7XG4gICAgICBhbGxSZWNvcmRzLnB1c2goLi4uYmF0Y2gpO1xuICAgIH1cblxuICAgIGNvbnN0IG5ld1JlY29yZHNCeUlkID0gbmV3IE1hcDxzdHJpbmcsIHVua25vd24+KCk7XG4gICAgZm9yIChjb25zdCByZWNvcmQgb2YgYWxsUmVjb3Jkcykge1xuICAgICAgY29uc3QgcmVjb3JkSWQgPSB0aGlzLmdldFJlY29yZElkKHsgcmVjb3JkIH0pO1xuICAgICAgbmV3UmVjb3Jkc0J5SWQuc2V0KHJlY29yZElkLCByZWNvcmQpO1xuICAgICAgdGhpcy5mZWF0dXJlcy5zZXQocmVjb3JkSWQsIHJlY29yZCk7XG4gICAgfVxuXG4gICAgY29uc3Qgbm90WWV0RHJhd24gPSBBcnJheS5mcm9tKG5ld1JlY29yZHNCeUlkLmtleXMoKSkuZmlsdGVyKFxuICAgICAgKGlkKSA9PiAhdGhpcy52aXNpYmxlRmVhdHVyZUlkcy5oYXMoaWQpLFxuICAgICk7XG5cbiAgICBjb25zdCBjb250ZXh0ID0gdGhpcy5nZXRGaWx0ZXJDb250ZXh0Py4oeyB3bWVTREsgfSk7XG4gICAgY29uc3QgcmVjb3Jkc1RvRHJhdyA9IG5vdFlldERyYXduXG4gICAgICAubWFwKChpZCkgPT4gbmV3UmVjb3Jkc0J5SWQuZ2V0KGlkKSEpXG4gICAgICAuZmlsdGVyKChyZWNvcmQpID0+IHRoaXMuc2hvdWxkRHJhd1JlY29yZCh7IHdtZVNESywgcmVjb3JkLCBjb250ZXh0IH0pKTtcblxuICAgIGlmIChyZWNvcmRzVG9EcmF3Lmxlbmd0aCA+IDApIHtcbiAgICAgIHRoaXMuZHJhd0ZlYXR1cmVzQmF0Y2goeyB3bWVTREssIHJlY29yZHM6IHJlY29yZHNUb0RyYXcgfSk7XG4gICAgICBmb3IgKGNvbnN0IHJlY29yZCBvZiByZWNvcmRzVG9EcmF3KSB7XG4gICAgICAgIHRoaXMudmlzaWJsZUZlYXR1cmVJZHMuYWRkKHRoaXMuZ2V0UmVjb3JkSWQoeyByZWNvcmQgfSkpO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIFJlbW92ZSBvYnNvbGV0ZSBmZWF0dXJlc1xuICAgIC8vIFdlIHNob3VsZCBjaGVjayBpZiB3ZSBuZWVkIHRvIGZpbHRlciBleGlzdGluZyBmZWF0dXJlcyBvdXQgYXMgd2VsbFxuICAgIC8vIGJlY2F1c2Ugd2UgbWlnaHQgaGF2ZSBjaGFuZ2VkIGZpbHRlcmluZyBjb250ZXh0IChlLmcuIG1hcCB2ZW51ZXMpIGJ5IHpvb21pbmcvcGFubmluZ1xuICAgIGNvbnN0IG9ic29sZXRlSWRzID0gQXJyYXkuZnJvbSh0aGlzLnZpc2libGVGZWF0dXJlSWRzKS5maWx0ZXIoXG4gICAgICAoaWQpID0+XG4gICAgICAgICFuZXdSZWNvcmRzQnlJZC5oYXMoaWQpIHx8XG4gICAgICAgICF0aGlzLnNob3VsZERyYXdSZWNvcmQoe1xuICAgICAgICAgIHdtZVNESyxcbiAgICAgICAgICByZWNvcmQ6IHRoaXMuZmVhdHVyZXMuZ2V0KGlkKSEsXG4gICAgICAgICAgY29udGV4dCxcbiAgICAgICAgfSksXG4gICAgKTtcblxuICAgIGZvciAoY29uc3QgZmVhdHVyZUlkIG9mIG9ic29sZXRlSWRzKSB7XG4gICAgICB3bWVTREsuTWFwLnJlbW92ZUZlYXR1cmVGcm9tTGF5ZXIoe1xuICAgICAgICBmZWF0dXJlSWQsXG4gICAgICAgIGxheWVyTmFtZTogdGhpcy5uYW1lLFxuICAgICAgfSk7XG4gICAgICB0aGlzLnZpc2libGVGZWF0dXJlSWRzLmRlbGV0ZShmZWF0dXJlSWQpO1xuICAgICAgdGhpcy5mZWF0dXJlcy5kZWxldGUoZmVhdHVyZUlkKTtcbiAgICB9XG4gIH1cblxuICAvLyBSZWdpc3RlciBwZXItbGF5ZXIgbWFwIGV2ZW50cyAobW92ZS1lbmQgdHJpZ2dlcnMgcmUtcmVuZGVyKVxuICByZWdpc3RlckV2ZW50cyhhcmdzOiB7IHdtZVNESzogV21lU0RLIH0pOiB2b2lkIHtcbiAgICBjb25zdCB7IHdtZVNESyB9ID0gYXJncztcbiAgICBjb25zdCBjbGVhbnVwTW92ZSA9IHdtZVNESy5FdmVudHMub24oe1xuICAgICAgZXZlbnROYW1lOiBcIndtZS1tYXAtbW92ZS1lbmRcIixcbiAgICAgIGV2ZW50SGFuZGxlcjogKCkgPT4ge1xuICAgICAgICB3YWl0Rm9yTWFwSWRsZSh7IHdtZVNESywgaW50ZXJ2YWxNczogNTAsIG1heFRyaWVzOiA2MCB9KS50aGVuKCgpID0+IHtcbiAgICAgICAgICB0aGlzLnJlbmRlcih7IHdtZVNESyB9KTtcbiAgICAgICAgfSk7XG4gICAgICB9LFxuICAgIH0pO1xuICAgIHRoaXMuZXZlbnRDbGVhbnVwcy5wdXNoKGNsZWFudXBNb3ZlKTtcblxuICAgIGNvbnN0IGNsZWFudXBDbGljayA9IHdtZVNESy5FdmVudHMub24oe1xuICAgICAgZXZlbnROYW1lOiBcIndtZS1sYXllci1mZWF0dXJlLWNsaWNrZWRcIixcbiAgICAgIGV2ZW50SGFuZGxlcjogYXN5bmMgKHsgZmVhdHVyZUlkLCBsYXllck5hbWUgfSkgPT4ge1xuICAgICAgICBpZiAobGF5ZXJOYW1lICE9PSB0aGlzLm5hbWUpIHJldHVybjtcbiAgICAgICAgYXdhaXQgdGhpcy5mZWF0dXJlQ2xpY2tlZCh7IHdtZVNESywgZmVhdHVyZUlkIH0pO1xuICAgICAgfSxcbiAgICB9KTtcbiAgICB0aGlzLmV2ZW50Q2xlYW51cHMucHVzaChjbGVhbnVwQ2xpY2spO1xuICB9XG5cbiAgLy8gUmVzdG9yZSBwZXJzaXN0ZWQgc3RhdGUgYW5kIGVuc3VyZSBldmVudHMgKyBpbml0aWFsIHJlbmRlclxuICByZXN0b3JlU3RhdGUoYXJnczogeyB3bWVTREs6IFdtZVNESyB9KTogdm9pZCB7XG4gICAgc3VwZXIucmVzdG9yZVN0YXRlKGFyZ3MpO1xuICAgIGNvbnN0IHsgd21lU0RLIH0gPSBhcmdzO1xuICAgIGNvbnN0IGNoZWNrZWQgPSB3bWVTREsuTGF5ZXJTd2l0Y2hlci5pc0xheWVyQ2hlY2tib3hDaGVja2VkKHtcbiAgICAgIG5hbWU6IHRoaXMubmFtZSxcbiAgICB9KTtcbiAgICBpZiAoY2hlY2tlZCkge1xuICAgICAgLy8gUmVuZGVyIGFuZCByZWdpc3RlciBldmVudHMgd2hlbiByZXN0b3JlZCBhcyBlbmFibGVkXG4gICAgICB0aGlzLnJlbmRlcih7IHdtZVNESyB9KTtcbiAgICAgIHRoaXMucmVnaXN0ZXJFdmVudHMoeyB3bWVTREsgfSk7XG4gICAgfVxuICB9XG59XG5cbmV4cG9ydCB7IEZlYXR1cmVMYXllciB9O1xuIiwiLy8gaW5kZXgudHNcbnZhciBlYXJ0aFJhZGl1cyA9IDYzNzEwMDg4ZS0xO1xudmFyIGZhY3RvcnMgPSB7XG4gIGNlbnRpbWV0ZXJzOiBlYXJ0aFJhZGl1cyAqIDEwMCxcbiAgY2VudGltZXRyZXM6IGVhcnRoUmFkaXVzICogMTAwLFxuICBkZWdyZWVzOiAzNjAgLyAoMiAqIE1hdGguUEkpLFxuICBmZWV0OiBlYXJ0aFJhZGl1cyAqIDMuMjgwODQsXG4gIGluY2hlczogZWFydGhSYWRpdXMgKiAzOS4zNyxcbiAga2lsb21ldGVyczogZWFydGhSYWRpdXMgLyAxZTMsXG4gIGtpbG9tZXRyZXM6IGVhcnRoUmFkaXVzIC8gMWUzLFxuICBtZXRlcnM6IGVhcnRoUmFkaXVzLFxuICBtZXRyZXM6IGVhcnRoUmFkaXVzLFxuICBtaWxlczogZWFydGhSYWRpdXMgLyAxNjA5LjM0NCxcbiAgbWlsbGltZXRlcnM6IGVhcnRoUmFkaXVzICogMWUzLFxuICBtaWxsaW1ldHJlczogZWFydGhSYWRpdXMgKiAxZTMsXG4gIG5hdXRpY2FsbWlsZXM6IGVhcnRoUmFkaXVzIC8gMTg1MixcbiAgcmFkaWFuczogMSxcbiAgeWFyZHM6IGVhcnRoUmFkaXVzICogMS4wOTM2XG59O1xudmFyIGFyZWFGYWN0b3JzID0ge1xuICBhY3JlczogMjQ3MTA1ZS05LFxuICBjZW50aW1ldGVyczogMWU0LFxuICBjZW50aW1ldHJlczogMWU0LFxuICBmZWV0OiAxMC43NjM5MTA0MTcsXG4gIGhlY3RhcmVzOiAxZS00LFxuICBpbmNoZXM6IDE1NTAuMDAzMTAwMDA2LFxuICBraWxvbWV0ZXJzOiAxZS02LFxuICBraWxvbWV0cmVzOiAxZS02LFxuICBtZXRlcnM6IDEsXG4gIG1ldHJlczogMSxcbiAgbWlsZXM6IDM4NmUtOSxcbiAgbmF1dGljYWxtaWxlczogMjkxNTUzMzQ5NTk4MTIyODVlLTIzLFxuICBtaWxsaW1ldGVyczogMWU2LFxuICBtaWxsaW1ldHJlczogMWU2LFxuICB5YXJkczogMS4xOTU5OTAwNDZcbn07XG5mdW5jdGlvbiBmZWF0dXJlKGdlb20sIHByb3BlcnRpZXMsIG9wdGlvbnMgPSB7fSkge1xuICBjb25zdCBmZWF0ID0geyB0eXBlOiBcIkZlYXR1cmVcIiB9O1xuICBpZiAob3B0aW9ucy5pZCA9PT0gMCB8fCBvcHRpb25zLmlkKSB7XG4gICAgZmVhdC5pZCA9IG9wdGlvbnMuaWQ7XG4gIH1cbiAgaWYgKG9wdGlvbnMuYmJveCkge1xuICAgIGZlYXQuYmJveCA9IG9wdGlvbnMuYmJveDtcbiAgfVxuICBmZWF0LnByb3BlcnRpZXMgPSBwcm9wZXJ0aWVzIHx8IHt9O1xuICBmZWF0Lmdlb21ldHJ5ID0gZ2VvbTtcbiAgcmV0dXJuIGZlYXQ7XG59XG5mdW5jdGlvbiBnZW9tZXRyeSh0eXBlLCBjb29yZGluYXRlcywgX29wdGlvbnMgPSB7fSkge1xuICBzd2l0Y2ggKHR5cGUpIHtcbiAgICBjYXNlIFwiUG9pbnRcIjpcbiAgICAgIHJldHVybiBwb2ludChjb29yZGluYXRlcykuZ2VvbWV0cnk7XG4gICAgY2FzZSBcIkxpbmVTdHJpbmdcIjpcbiAgICAgIHJldHVybiBsaW5lU3RyaW5nKGNvb3JkaW5hdGVzKS5nZW9tZXRyeTtcbiAgICBjYXNlIFwiUG9seWdvblwiOlxuICAgICAgcmV0dXJuIHBvbHlnb24oY29vcmRpbmF0ZXMpLmdlb21ldHJ5O1xuICAgIGNhc2UgXCJNdWx0aVBvaW50XCI6XG4gICAgICByZXR1cm4gbXVsdGlQb2ludChjb29yZGluYXRlcykuZ2VvbWV0cnk7XG4gICAgY2FzZSBcIk11bHRpTGluZVN0cmluZ1wiOlxuICAgICAgcmV0dXJuIG11bHRpTGluZVN0cmluZyhjb29yZGluYXRlcykuZ2VvbWV0cnk7XG4gICAgY2FzZSBcIk11bHRpUG9seWdvblwiOlxuICAgICAgcmV0dXJuIG11bHRpUG9seWdvbihjb29yZGluYXRlcykuZ2VvbWV0cnk7XG4gICAgZGVmYXVsdDpcbiAgICAgIHRocm93IG5ldyBFcnJvcih0eXBlICsgXCIgaXMgaW52YWxpZFwiKTtcbiAgfVxufVxuZnVuY3Rpb24gcG9pbnQoY29vcmRpbmF0ZXMsIHByb3BlcnRpZXMsIG9wdGlvbnMgPSB7fSkge1xuICBpZiAoIWNvb3JkaW5hdGVzKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiY29vcmRpbmF0ZXMgaXMgcmVxdWlyZWRcIik7XG4gIH1cbiAgaWYgKCFBcnJheS5pc0FycmF5KGNvb3JkaW5hdGVzKSkge1xuICAgIHRocm93IG5ldyBFcnJvcihcImNvb3JkaW5hdGVzIG11c3QgYmUgYW4gQXJyYXlcIik7XG4gIH1cbiAgaWYgKGNvb3JkaW5hdGVzLmxlbmd0aCA8IDIpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJjb29yZGluYXRlcyBtdXN0IGJlIGF0IGxlYXN0IDIgbnVtYmVycyBsb25nXCIpO1xuICB9XG4gIGlmICghaXNOdW1iZXIoY29vcmRpbmF0ZXNbMF0pIHx8ICFpc051bWJlcihjb29yZGluYXRlc1sxXSkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJjb29yZGluYXRlcyBtdXN0IGNvbnRhaW4gbnVtYmVyc1wiKTtcbiAgfVxuICBjb25zdCBnZW9tID0ge1xuICAgIHR5cGU6IFwiUG9pbnRcIixcbiAgICBjb29yZGluYXRlc1xuICB9O1xuICByZXR1cm4gZmVhdHVyZShnZW9tLCBwcm9wZXJ0aWVzLCBvcHRpb25zKTtcbn1cbmZ1bmN0aW9uIHBvaW50cyhjb29yZGluYXRlcywgcHJvcGVydGllcywgb3B0aW9ucyA9IHt9KSB7XG4gIHJldHVybiBmZWF0dXJlQ29sbGVjdGlvbihcbiAgICBjb29yZGluYXRlcy5tYXAoKGNvb3JkcykgPT4ge1xuICAgICAgcmV0dXJuIHBvaW50KGNvb3JkcywgcHJvcGVydGllcyk7XG4gICAgfSksXG4gICAgb3B0aW9uc1xuICApO1xufVxuZnVuY3Rpb24gcG9seWdvbihjb29yZGluYXRlcywgcHJvcGVydGllcywgb3B0aW9ucyA9IHt9KSB7XG4gIGZvciAoY29uc3QgcmluZyBvZiBjb29yZGluYXRlcykge1xuICAgIGlmIChyaW5nLmxlbmd0aCA8IDQpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgXCJFYWNoIExpbmVhclJpbmcgb2YgYSBQb2x5Z29uIG11c3QgaGF2ZSA0IG9yIG1vcmUgUG9zaXRpb25zLlwiXG4gICAgICApO1xuICAgIH1cbiAgICBpZiAocmluZ1tyaW5nLmxlbmd0aCAtIDFdLmxlbmd0aCAhPT0gcmluZ1swXS5sZW5ndGgpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkZpcnN0IGFuZCBsYXN0IFBvc2l0aW9uIGFyZSBub3QgZXF1aXZhbGVudC5cIik7XG4gICAgfVxuICAgIGZvciAobGV0IGogPSAwOyBqIDwgcmluZ1tyaW5nLmxlbmd0aCAtIDFdLmxlbmd0aDsgaisrKSB7XG4gICAgICBpZiAocmluZ1tyaW5nLmxlbmd0aCAtIDFdW2pdICE9PSByaW5nWzBdW2pdKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIkZpcnN0IGFuZCBsYXN0IFBvc2l0aW9uIGFyZSBub3QgZXF1aXZhbGVudC5cIik7XG4gICAgICB9XG4gICAgfVxuICB9XG4gIGNvbnN0IGdlb20gPSB7XG4gICAgdHlwZTogXCJQb2x5Z29uXCIsXG4gICAgY29vcmRpbmF0ZXNcbiAgfTtcbiAgcmV0dXJuIGZlYXR1cmUoZ2VvbSwgcHJvcGVydGllcywgb3B0aW9ucyk7XG59XG5mdW5jdGlvbiBwb2x5Z29ucyhjb29yZGluYXRlcywgcHJvcGVydGllcywgb3B0aW9ucyA9IHt9KSB7XG4gIHJldHVybiBmZWF0dXJlQ29sbGVjdGlvbihcbiAgICBjb29yZGluYXRlcy5tYXAoKGNvb3JkcykgPT4ge1xuICAgICAgcmV0dXJuIHBvbHlnb24oY29vcmRzLCBwcm9wZXJ0aWVzKTtcbiAgICB9KSxcbiAgICBvcHRpb25zXG4gICk7XG59XG5mdW5jdGlvbiBsaW5lU3RyaW5nKGNvb3JkaW5hdGVzLCBwcm9wZXJ0aWVzLCBvcHRpb25zID0ge30pIHtcbiAgaWYgKGNvb3JkaW5hdGVzLmxlbmd0aCA8IDIpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJjb29yZGluYXRlcyBtdXN0IGJlIGFuIGFycmF5IG9mIHR3byBvciBtb3JlIHBvc2l0aW9uc1wiKTtcbiAgfVxuICBjb25zdCBnZW9tID0ge1xuICAgIHR5cGU6IFwiTGluZVN0cmluZ1wiLFxuICAgIGNvb3JkaW5hdGVzXG4gIH07XG4gIHJldHVybiBmZWF0dXJlKGdlb20sIHByb3BlcnRpZXMsIG9wdGlvbnMpO1xufVxuZnVuY3Rpb24gbGluZVN0cmluZ3MoY29vcmRpbmF0ZXMsIHByb3BlcnRpZXMsIG9wdGlvbnMgPSB7fSkge1xuICByZXR1cm4gZmVhdHVyZUNvbGxlY3Rpb24oXG4gICAgY29vcmRpbmF0ZXMubWFwKChjb29yZHMpID0+IHtcbiAgICAgIHJldHVybiBsaW5lU3RyaW5nKGNvb3JkcywgcHJvcGVydGllcyk7XG4gICAgfSksXG4gICAgb3B0aW9uc1xuICApO1xufVxuZnVuY3Rpb24gZmVhdHVyZUNvbGxlY3Rpb24oZmVhdHVyZXMsIG9wdGlvbnMgPSB7fSkge1xuICBjb25zdCBmYyA9IHsgdHlwZTogXCJGZWF0dXJlQ29sbGVjdGlvblwiIH07XG4gIGlmIChvcHRpb25zLmlkKSB7XG4gICAgZmMuaWQgPSBvcHRpb25zLmlkO1xuICB9XG4gIGlmIChvcHRpb25zLmJib3gpIHtcbiAgICBmYy5iYm94ID0gb3B0aW9ucy5iYm94O1xuICB9XG4gIGZjLmZlYXR1cmVzID0gZmVhdHVyZXM7XG4gIHJldHVybiBmYztcbn1cbmZ1bmN0aW9uIG11bHRpTGluZVN0cmluZyhjb29yZGluYXRlcywgcHJvcGVydGllcywgb3B0aW9ucyA9IHt9KSB7XG4gIGNvbnN0IGdlb20gPSB7XG4gICAgdHlwZTogXCJNdWx0aUxpbmVTdHJpbmdcIixcbiAgICBjb29yZGluYXRlc1xuICB9O1xuICByZXR1cm4gZmVhdHVyZShnZW9tLCBwcm9wZXJ0aWVzLCBvcHRpb25zKTtcbn1cbmZ1bmN0aW9uIG11bHRpUG9pbnQoY29vcmRpbmF0ZXMsIHByb3BlcnRpZXMsIG9wdGlvbnMgPSB7fSkge1xuICBjb25zdCBnZW9tID0ge1xuICAgIHR5cGU6IFwiTXVsdGlQb2ludFwiLFxuICAgIGNvb3JkaW5hdGVzXG4gIH07XG4gIHJldHVybiBmZWF0dXJlKGdlb20sIHByb3BlcnRpZXMsIG9wdGlvbnMpO1xufVxuZnVuY3Rpb24gbXVsdGlQb2x5Z29uKGNvb3JkaW5hdGVzLCBwcm9wZXJ0aWVzLCBvcHRpb25zID0ge30pIHtcbiAgY29uc3QgZ2VvbSA9IHtcbiAgICB0eXBlOiBcIk11bHRpUG9seWdvblwiLFxuICAgIGNvb3JkaW5hdGVzXG4gIH07XG4gIHJldHVybiBmZWF0dXJlKGdlb20sIHByb3BlcnRpZXMsIG9wdGlvbnMpO1xufVxuZnVuY3Rpb24gZ2VvbWV0cnlDb2xsZWN0aW9uKGdlb21ldHJpZXMsIHByb3BlcnRpZXMsIG9wdGlvbnMgPSB7fSkge1xuICBjb25zdCBnZW9tID0ge1xuICAgIHR5cGU6IFwiR2VvbWV0cnlDb2xsZWN0aW9uXCIsXG4gICAgZ2VvbWV0cmllc1xuICB9O1xuICByZXR1cm4gZmVhdHVyZShnZW9tLCBwcm9wZXJ0aWVzLCBvcHRpb25zKTtcbn1cbmZ1bmN0aW9uIHJvdW5kKG51bSwgcHJlY2lzaW9uID0gMCkge1xuICBpZiAocHJlY2lzaW9uICYmICEocHJlY2lzaW9uID49IDApKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwicHJlY2lzaW9uIG11c3QgYmUgYSBwb3NpdGl2ZSBudW1iZXJcIik7XG4gIH1cbiAgY29uc3QgbXVsdGlwbGllciA9IE1hdGgucG93KDEwLCBwcmVjaXNpb24gfHwgMCk7XG4gIHJldHVybiBNYXRoLnJvdW5kKG51bSAqIG11bHRpcGxpZXIpIC8gbXVsdGlwbGllcjtcbn1cbmZ1bmN0aW9uIHJhZGlhbnNUb0xlbmd0aChyYWRpYW5zLCB1bml0cyA9IFwia2lsb21ldGVyc1wiKSB7XG4gIGNvbnN0IGZhY3RvciA9IGZhY3RvcnNbdW5pdHNdO1xuICBpZiAoIWZhY3Rvcikge1xuICAgIHRocm93IG5ldyBFcnJvcih1bml0cyArIFwiIHVuaXRzIGlzIGludmFsaWRcIik7XG4gIH1cbiAgcmV0dXJuIHJhZGlhbnMgKiBmYWN0b3I7XG59XG5mdW5jdGlvbiBsZW5ndGhUb1JhZGlhbnMoZGlzdGFuY2UsIHVuaXRzID0gXCJraWxvbWV0ZXJzXCIpIHtcbiAgY29uc3QgZmFjdG9yID0gZmFjdG9yc1t1bml0c107XG4gIGlmICghZmFjdG9yKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKHVuaXRzICsgXCIgdW5pdHMgaXMgaW52YWxpZFwiKTtcbiAgfVxuICByZXR1cm4gZGlzdGFuY2UgLyBmYWN0b3I7XG59XG5mdW5jdGlvbiBsZW5ndGhUb0RlZ3JlZXMoZGlzdGFuY2UsIHVuaXRzKSB7XG4gIHJldHVybiByYWRpYW5zVG9EZWdyZWVzKGxlbmd0aFRvUmFkaWFucyhkaXN0YW5jZSwgdW5pdHMpKTtcbn1cbmZ1bmN0aW9uIGJlYXJpbmdUb0F6aW11dGgoYmVhcmluZykge1xuICBsZXQgYW5nbGUgPSBiZWFyaW5nICUgMzYwO1xuICBpZiAoYW5nbGUgPCAwKSB7XG4gICAgYW5nbGUgKz0gMzYwO1xuICB9XG4gIHJldHVybiBhbmdsZTtcbn1cbmZ1bmN0aW9uIGF6aW11dGhUb0JlYXJpbmcoYW5nbGUpIHtcbiAgYW5nbGUgPSBhbmdsZSAlIDM2MDtcbiAgaWYgKGFuZ2xlID4gMTgwKSB7XG4gICAgcmV0dXJuIGFuZ2xlIC0gMzYwO1xuICB9IGVsc2UgaWYgKGFuZ2xlIDwgLTE4MCkge1xuICAgIHJldHVybiBhbmdsZSArIDM2MDtcbiAgfVxuICByZXR1cm4gYW5nbGU7XG59XG5mdW5jdGlvbiByYWRpYW5zVG9EZWdyZWVzKHJhZGlhbnMpIHtcbiAgY29uc3Qgbm9ybWFsaXNlZFJhZGlhbnMgPSByYWRpYW5zICUgKDIgKiBNYXRoLlBJKTtcbiAgcmV0dXJuIG5vcm1hbGlzZWRSYWRpYW5zICogMTgwIC8gTWF0aC5QSTtcbn1cbmZ1bmN0aW9uIGRlZ3JlZXNUb1JhZGlhbnMoZGVncmVlcykge1xuICBjb25zdCBub3JtYWxpc2VkRGVncmVlcyA9IGRlZ3JlZXMgJSAzNjA7XG4gIHJldHVybiBub3JtYWxpc2VkRGVncmVlcyAqIE1hdGguUEkgLyAxODA7XG59XG5mdW5jdGlvbiBjb252ZXJ0TGVuZ3RoKGxlbmd0aCwgb3JpZ2luYWxVbml0ID0gXCJraWxvbWV0ZXJzXCIsIGZpbmFsVW5pdCA9IFwia2lsb21ldGVyc1wiKSB7XG4gIGlmICghKGxlbmd0aCA+PSAwKSkge1xuICAgIHRocm93IG5ldyBFcnJvcihcImxlbmd0aCBtdXN0IGJlIGEgcG9zaXRpdmUgbnVtYmVyXCIpO1xuICB9XG4gIHJldHVybiByYWRpYW5zVG9MZW5ndGgobGVuZ3RoVG9SYWRpYW5zKGxlbmd0aCwgb3JpZ2luYWxVbml0KSwgZmluYWxVbml0KTtcbn1cbmZ1bmN0aW9uIGNvbnZlcnRBcmVhKGFyZWEsIG9yaWdpbmFsVW5pdCA9IFwibWV0ZXJzXCIsIGZpbmFsVW5pdCA9IFwia2lsb21ldGVyc1wiKSB7XG4gIGlmICghKGFyZWEgPj0gMCkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJhcmVhIG11c3QgYmUgYSBwb3NpdGl2ZSBudW1iZXJcIik7XG4gIH1cbiAgY29uc3Qgc3RhcnRGYWN0b3IgPSBhcmVhRmFjdG9yc1tvcmlnaW5hbFVuaXRdO1xuICBpZiAoIXN0YXJ0RmFjdG9yKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiaW52YWxpZCBvcmlnaW5hbCB1bml0c1wiKTtcbiAgfVxuICBjb25zdCBmaW5hbEZhY3RvciA9IGFyZWFGYWN0b3JzW2ZpbmFsVW5pdF07XG4gIGlmICghZmluYWxGYWN0b3IpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJpbnZhbGlkIGZpbmFsIHVuaXRzXCIpO1xuICB9XG4gIHJldHVybiBhcmVhIC8gc3RhcnRGYWN0b3IgKiBmaW5hbEZhY3Rvcjtcbn1cbmZ1bmN0aW9uIGlzTnVtYmVyKG51bSkge1xuICByZXR1cm4gIWlzTmFOKG51bSkgJiYgbnVtICE9PSBudWxsICYmICFBcnJheS5pc0FycmF5KG51bSk7XG59XG5mdW5jdGlvbiBpc09iamVjdChpbnB1dCkge1xuICByZXR1cm4gaW5wdXQgIT09IG51bGwgJiYgdHlwZW9mIGlucHV0ID09PSBcIm9iamVjdFwiICYmICFBcnJheS5pc0FycmF5KGlucHV0KTtcbn1cbmZ1bmN0aW9uIHZhbGlkYXRlQkJveChiYm94KSB7XG4gIGlmICghYmJveCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcImJib3ggaXMgcmVxdWlyZWRcIik7XG4gIH1cbiAgaWYgKCFBcnJheS5pc0FycmF5KGJib3gpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiYmJveCBtdXN0IGJlIGFuIEFycmF5XCIpO1xuICB9XG4gIGlmIChiYm94Lmxlbmd0aCAhPT0gNCAmJiBiYm94Lmxlbmd0aCAhPT0gNikge1xuICAgIHRocm93IG5ldyBFcnJvcihcImJib3ggbXVzdCBiZSBhbiBBcnJheSBvZiA0IG9yIDYgbnVtYmVyc1wiKTtcbiAgfVxuICBiYm94LmZvckVhY2goKG51bSkgPT4ge1xuICAgIGlmICghaXNOdW1iZXIobnVtKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiYmJveCBtdXN0IG9ubHkgY29udGFpbiBudW1iZXJzXCIpO1xuICAgIH1cbiAgfSk7XG59XG5mdW5jdGlvbiB2YWxpZGF0ZUlkKGlkKSB7XG4gIGlmICghaWQpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJpZCBpcyByZXF1aXJlZFwiKTtcbiAgfVxuICBpZiAoW1wic3RyaW5nXCIsIFwibnVtYmVyXCJdLmluZGV4T2YodHlwZW9mIGlkKSA9PT0gLTEpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJpZCBtdXN0IGJlIGEgbnVtYmVyIG9yIGEgc3RyaW5nXCIpO1xuICB9XG59XG5leHBvcnQge1xuICBhcmVhRmFjdG9ycyxcbiAgYXppbXV0aFRvQmVhcmluZyxcbiAgYmVhcmluZ1RvQXppbXV0aCxcbiAgY29udmVydEFyZWEsXG4gIGNvbnZlcnRMZW5ndGgsXG4gIGRlZ3JlZXNUb1JhZGlhbnMsXG4gIGVhcnRoUmFkaXVzLFxuICBmYWN0b3JzLFxuICBmZWF0dXJlLFxuICBmZWF0dXJlQ29sbGVjdGlvbixcbiAgZ2VvbWV0cnksXG4gIGdlb21ldHJ5Q29sbGVjdGlvbixcbiAgaXNOdW1iZXIsXG4gIGlzT2JqZWN0LFxuICBsZW5ndGhUb0RlZ3JlZXMsXG4gIGxlbmd0aFRvUmFkaWFucyxcbiAgbGluZVN0cmluZyxcbiAgbGluZVN0cmluZ3MsXG4gIG11bHRpTGluZVN0cmluZyxcbiAgbXVsdGlQb2ludCxcbiAgbXVsdGlQb2x5Z29uLFxuICBwb2ludCxcbiAgcG9pbnRzLFxuICBwb2x5Z29uLFxuICBwb2x5Z29ucyxcbiAgcmFkaWFuc1RvRGVncmVlcyxcbiAgcmFkaWFuc1RvTGVuZ3RoLFxuICByb3VuZCxcbiAgdmFsaWRhdGVCQm94LFxuICB2YWxpZGF0ZUlkXG59O1xuLy8jIHNvdXJjZU1hcHBpbmdVUkw9aW5kZXguanMubWFwIiwiLy8gaW5kZXgudHNcbmltcG9ydCB7IGlzTnVtYmVyIH0gZnJvbSBcIkB0dXJmL2hlbHBlcnNcIjtcbmZ1bmN0aW9uIGdldENvb3JkKGNvb3JkKSB7XG4gIGlmICghY29vcmQpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJjb29yZCBpcyByZXF1aXJlZFwiKTtcbiAgfVxuICBpZiAoIUFycmF5LmlzQXJyYXkoY29vcmQpKSB7XG4gICAgaWYgKGNvb3JkLnR5cGUgPT09IFwiRmVhdHVyZVwiICYmIGNvb3JkLmdlb21ldHJ5ICE9PSBudWxsICYmIGNvb3JkLmdlb21ldHJ5LnR5cGUgPT09IFwiUG9pbnRcIikge1xuICAgICAgcmV0dXJuIFsuLi5jb29yZC5nZW9tZXRyeS5jb29yZGluYXRlc107XG4gICAgfVxuICAgIGlmIChjb29yZC50eXBlID09PSBcIlBvaW50XCIpIHtcbiAgICAgIHJldHVybiBbLi4uY29vcmQuY29vcmRpbmF0ZXNdO1xuICAgIH1cbiAgfVxuICBpZiAoQXJyYXkuaXNBcnJheShjb29yZCkgJiYgY29vcmQubGVuZ3RoID49IDIgJiYgIUFycmF5LmlzQXJyYXkoY29vcmRbMF0pICYmICFBcnJheS5pc0FycmF5KGNvb3JkWzFdKSkge1xuICAgIHJldHVybiBbLi4uY29vcmRdO1xuICB9XG4gIHRocm93IG5ldyBFcnJvcihcImNvb3JkIG11c3QgYmUgR2VvSlNPTiBQb2ludCBvciBhbiBBcnJheSBvZiBudW1iZXJzXCIpO1xufVxuZnVuY3Rpb24gZ2V0Q29vcmRzKGNvb3Jkcykge1xuICBpZiAoQXJyYXkuaXNBcnJheShjb29yZHMpKSB7XG4gICAgcmV0dXJuIGNvb3JkcztcbiAgfVxuICBpZiAoY29vcmRzLnR5cGUgPT09IFwiRmVhdHVyZVwiKSB7XG4gICAgaWYgKGNvb3Jkcy5nZW9tZXRyeSAhPT0gbnVsbCkge1xuICAgICAgcmV0dXJuIGNvb3Jkcy5nZW9tZXRyeS5jb29yZGluYXRlcztcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgaWYgKGNvb3Jkcy5jb29yZGluYXRlcykge1xuICAgICAgcmV0dXJuIGNvb3Jkcy5jb29yZGluYXRlcztcbiAgICB9XG4gIH1cbiAgdGhyb3cgbmV3IEVycm9yKFxuICAgIFwiY29vcmRzIG11c3QgYmUgR2VvSlNPTiBGZWF0dXJlLCBHZW9tZXRyeSBPYmplY3Qgb3IgYW4gQXJyYXlcIlxuICApO1xufVxuZnVuY3Rpb24gY29udGFpbnNOdW1iZXIoY29vcmRpbmF0ZXMpIHtcbiAgaWYgKGNvb3JkaW5hdGVzLmxlbmd0aCA+IDEgJiYgaXNOdW1iZXIoY29vcmRpbmF0ZXNbMF0pICYmIGlzTnVtYmVyKGNvb3JkaW5hdGVzWzFdKSkge1xuICAgIHJldHVybiB0cnVlO1xuICB9XG4gIGlmIChBcnJheS5pc0FycmF5KGNvb3JkaW5hdGVzWzBdKSAmJiBjb29yZGluYXRlc1swXS5sZW5ndGgpIHtcbiAgICByZXR1cm4gY29udGFpbnNOdW1iZXIoY29vcmRpbmF0ZXNbMF0pO1xuICB9XG4gIHRocm93IG5ldyBFcnJvcihcImNvb3JkaW5hdGVzIG11c3Qgb25seSBjb250YWluIG51bWJlcnNcIik7XG59XG5mdW5jdGlvbiBnZW9qc29uVHlwZSh2YWx1ZSwgdHlwZSwgbmFtZSkge1xuICBpZiAoIXR5cGUgfHwgIW5hbWUpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJ0eXBlIGFuZCBuYW1lIHJlcXVpcmVkXCIpO1xuICB9XG4gIGlmICghdmFsdWUgfHwgdmFsdWUudHlwZSAhPT0gdHlwZSkge1xuICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgIFwiSW52YWxpZCBpbnB1dCB0byBcIiArIG5hbWUgKyBcIjogbXVzdCBiZSBhIFwiICsgdHlwZSArIFwiLCBnaXZlbiBcIiArIHZhbHVlLnR5cGVcbiAgICApO1xuICB9XG59XG5mdW5jdGlvbiBmZWF0dXJlT2YoZmVhdHVyZSwgdHlwZSwgbmFtZSkge1xuICBpZiAoIWZlYXR1cmUpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJObyBmZWF0dXJlIHBhc3NlZFwiKTtcbiAgfVxuICBpZiAoIW5hbWUpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCIuZmVhdHVyZU9mKCkgcmVxdWlyZXMgYSBuYW1lXCIpO1xuICB9XG4gIGlmICghZmVhdHVyZSB8fCBmZWF0dXJlLnR5cGUgIT09IFwiRmVhdHVyZVwiIHx8ICFmZWF0dXJlLmdlb21ldHJ5KSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgXCJJbnZhbGlkIGlucHV0IHRvIFwiICsgbmFtZSArIFwiLCBGZWF0dXJlIHdpdGggZ2VvbWV0cnkgcmVxdWlyZWRcIlxuICAgICk7XG4gIH1cbiAgaWYgKCFmZWF0dXJlLmdlb21ldHJ5IHx8IGZlYXR1cmUuZ2VvbWV0cnkudHlwZSAhPT0gdHlwZSkge1xuICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgIFwiSW52YWxpZCBpbnB1dCB0byBcIiArIG5hbWUgKyBcIjogbXVzdCBiZSBhIFwiICsgdHlwZSArIFwiLCBnaXZlbiBcIiArIGZlYXR1cmUuZ2VvbWV0cnkudHlwZVxuICAgICk7XG4gIH1cbn1cbmZ1bmN0aW9uIGNvbGxlY3Rpb25PZihmZWF0dXJlQ29sbGVjdGlvbiwgdHlwZSwgbmFtZSkge1xuICBpZiAoIWZlYXR1cmVDb2xsZWN0aW9uKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiTm8gZmVhdHVyZUNvbGxlY3Rpb24gcGFzc2VkXCIpO1xuICB9XG4gIGlmICghbmFtZSkge1xuICAgIHRocm93IG5ldyBFcnJvcihcIi5jb2xsZWN0aW9uT2YoKSByZXF1aXJlcyBhIG5hbWVcIik7XG4gIH1cbiAgaWYgKCFmZWF0dXJlQ29sbGVjdGlvbiB8fCBmZWF0dXJlQ29sbGVjdGlvbi50eXBlICE9PSBcIkZlYXR1cmVDb2xsZWN0aW9uXCIpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICBcIkludmFsaWQgaW5wdXQgdG8gXCIgKyBuYW1lICsgXCIsIEZlYXR1cmVDb2xsZWN0aW9uIHJlcXVpcmVkXCJcbiAgICApO1xuICB9XG4gIGZvciAoY29uc3QgZmVhdHVyZSBvZiBmZWF0dXJlQ29sbGVjdGlvbi5mZWF0dXJlcykge1xuICAgIGlmICghZmVhdHVyZSB8fCBmZWF0dXJlLnR5cGUgIT09IFwiRmVhdHVyZVwiIHx8ICFmZWF0dXJlLmdlb21ldHJ5KSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgIFwiSW52YWxpZCBpbnB1dCB0byBcIiArIG5hbWUgKyBcIiwgRmVhdHVyZSB3aXRoIGdlb21ldHJ5IHJlcXVpcmVkXCJcbiAgICAgICk7XG4gICAgfVxuICAgIGlmICghZmVhdHVyZS5nZW9tZXRyeSB8fCBmZWF0dXJlLmdlb21ldHJ5LnR5cGUgIT09IHR5cGUpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgXCJJbnZhbGlkIGlucHV0IHRvIFwiICsgbmFtZSArIFwiOiBtdXN0IGJlIGEgXCIgKyB0eXBlICsgXCIsIGdpdmVuIFwiICsgZmVhdHVyZS5nZW9tZXRyeS50eXBlXG4gICAgICApO1xuICAgIH1cbiAgfVxufVxuZnVuY3Rpb24gZ2V0R2VvbShnZW9qc29uKSB7XG4gIGlmIChnZW9qc29uLnR5cGUgPT09IFwiRmVhdHVyZVwiKSB7XG4gICAgcmV0dXJuIGdlb2pzb24uZ2VvbWV0cnk7XG4gIH1cbiAgcmV0dXJuIGdlb2pzb247XG59XG5mdW5jdGlvbiBnZXRUeXBlKGdlb2pzb24sIF9uYW1lKSB7XG4gIGlmIChnZW9qc29uLnR5cGUgPT09IFwiRmVhdHVyZUNvbGxlY3Rpb25cIikge1xuICAgIHJldHVybiBcIkZlYXR1cmVDb2xsZWN0aW9uXCI7XG4gIH1cbiAgaWYgKGdlb2pzb24udHlwZSA9PT0gXCJHZW9tZXRyeUNvbGxlY3Rpb25cIikge1xuICAgIHJldHVybiBcIkdlb21ldHJ5Q29sbGVjdGlvblwiO1xuICB9XG4gIGlmIChnZW9qc29uLnR5cGUgPT09IFwiRmVhdHVyZVwiICYmIGdlb2pzb24uZ2VvbWV0cnkgIT09IG51bGwpIHtcbiAgICByZXR1cm4gZ2VvanNvbi5nZW9tZXRyeS50eXBlO1xuICB9XG4gIHJldHVybiBnZW9qc29uLnR5cGU7XG59XG5leHBvcnQge1xuICBjb2xsZWN0aW9uT2YsXG4gIGNvbnRhaW5zTnVtYmVyLFxuICBmZWF0dXJlT2YsXG4gIGdlb2pzb25UeXBlLFxuICBnZXRDb29yZCxcbiAgZ2V0Q29vcmRzLFxuICBnZXRHZW9tLFxuICBnZXRUeXBlXG59O1xuLy8jIHNvdXJjZU1hcHBpbmdVUkw9aW5kZXguanMubWFwIiwiLy8gaW5kZXgudHNcbmltcG9ydCB7IGdldENvb3JkIH0gZnJvbSBcIkB0dXJmL2ludmFyaWFudFwiO1xuaW1wb3J0IHsgcmFkaWFuc1RvTGVuZ3RoLCBkZWdyZWVzVG9SYWRpYW5zIH0gZnJvbSBcIkB0dXJmL2hlbHBlcnNcIjtcbmZ1bmN0aW9uIGRpc3RhbmNlKGZyb20sIHRvLCBvcHRpb25zID0ge30pIHtcbiAgdmFyIGNvb3JkaW5hdGVzMSA9IGdldENvb3JkKGZyb20pO1xuICB2YXIgY29vcmRpbmF0ZXMyID0gZ2V0Q29vcmQodG8pO1xuICB2YXIgZExhdCA9IGRlZ3JlZXNUb1JhZGlhbnMoY29vcmRpbmF0ZXMyWzFdIC0gY29vcmRpbmF0ZXMxWzFdKTtcbiAgdmFyIGRMb24gPSBkZWdyZWVzVG9SYWRpYW5zKGNvb3JkaW5hdGVzMlswXSAtIGNvb3JkaW5hdGVzMVswXSk7XG4gIHZhciBsYXQxID0gZGVncmVlc1RvUmFkaWFucyhjb29yZGluYXRlczFbMV0pO1xuICB2YXIgbGF0MiA9IGRlZ3JlZXNUb1JhZGlhbnMoY29vcmRpbmF0ZXMyWzFdKTtcbiAgdmFyIGEgPSBNYXRoLnBvdyhNYXRoLnNpbihkTGF0IC8gMiksIDIpICsgTWF0aC5wb3coTWF0aC5zaW4oZExvbiAvIDIpLCAyKSAqIE1hdGguY29zKGxhdDEpICogTWF0aC5jb3MobGF0Mik7XG4gIHJldHVybiByYWRpYW5zVG9MZW5ndGgoXG4gICAgMiAqIE1hdGguYXRhbjIoTWF0aC5zcXJ0KGEpLCBNYXRoLnNxcnQoMSAtIGEpKSxcbiAgICBvcHRpb25zLnVuaXRzXG4gICk7XG59XG52YXIgaW5kZXhfZGVmYXVsdCA9IGRpc3RhbmNlO1xuZXhwb3J0IHtcbiAgaW5kZXhfZGVmYXVsdCBhcyBkZWZhdWx0LFxuICBkaXN0YW5jZVxufTtcbi8vIyBzb3VyY2VNYXBwaW5nVVJMPWluZGV4LmpzLm1hcCIsIi8qXG4gKiBDb3B5cmlnaHQgKGMpIDIwMjUgTWHDq2wgUGVkcmV0dGlcbiAqXG4gKiBUaGlzIGZpbGUgaXMgcGFydCBvZiBXTUUgU3dpdHplcmxhbmQgSGVscGVyLlxuICpcbiAqIFRoaXMgcHJvZ3JhbSBpcyBmcmVlIHNvZnR3YXJlOiB5b3UgY2FuIHJlZGlzdHJpYnV0ZSBpdCBhbmQvb3IgbW9kaWZ5XG4gKiBpdCB1bmRlciB0aGUgdGVybXMgb2YgdGhlIEdOVSBBZmZlcm8gR2VuZXJhbCBQdWJsaWMgTGljZW5zZSBhcyBwdWJsaXNoZWQgYnlcbiAqIHRoZSBGcmVlIFNvZnR3YXJlIEZvdW5kYXRpb24sIGVpdGhlciB2ZXJzaW9uIDMgb2YgdGhlIExpY2Vuc2UsIG9yXG4gKiAoYXQgeW91ciBvcHRpb24pIGFueSBsYXRlciB2ZXJzaW9uLlxuICpcbiAqIFRoaXMgcHJvZ3JhbSBpcyBkaXN0cmlidXRlZCBpbiB0aGUgaG9wZSB0aGF0IGl0IHdpbGwgYmUgdXNlZnVsLFxuICogYnV0IFdJVEhPVVQgQU5ZIFdBUlJBTlRZOyB3aXRob3V0IGV2ZW4gdGhlIGltcGxpZWQgd2FycmFudHkgb2ZcbiAqIE1FUkNIQU5UQUJJTElUWSBvciBGSVRORVNTIEZPUiBBIFBBUlRJQ1VMQVIgUFVSUE9TRS4gIFNlZSB0aGVcbiAqIEdOVSBBZmZlcm8gR2VuZXJhbCBQdWJsaWMgTGljZW5zZSBmb3IgbW9yZSBkZXRhaWxzLlxuICpcbiAqIFlvdSBzaG91bGQgaGF2ZSByZWNlaXZlZCBhIGNvcHkgb2YgdGhlIEdOVSBBZmZlcm8gR2VuZXJhbCBQdWJsaWMgTGljZW5zZVxuICogYWxvbmcgd2l0aCB0aGlzIHByb2dyYW0uICBJZiBub3QsIHNlZSA8aHR0cHM6Ly93d3cuZ251Lm9yZy9saWNlbnNlcy8+LlxuICovXG5cbmltcG9ydCB7IGRpc3RhbmNlLCBwb2ludCB9IGZyb20gXCJAdHVyZi90dXJmXCI7XG5pbXBvcnQgdHlwZSB7IE11bHRpUG9seWdvbiwgUG9pbnQgYXMgR2VvUG9pbnQsIFBvbHlnb24gfSBmcm9tIFwiZ2VvanNvblwiO1xuXG50eXBlIFZlbnVlR2VvbWV0cnkgPVxuICB8IEdlb1BvaW50XG4gIHwgUG9seWdvblxuICB8IE11bHRpUG9seWdvblxuICB8IHtcbiAgICAgIHR5cGU6IHN0cmluZztcbiAgICAgIGNvb3JkaW5hdGVzOiB1bmtub3duO1xuICAgIH07XG5cbmNsYXNzIFN0b3BHZW9tZXRyeSB7XG4gIHByaXZhdGUgcG9pbnRUb0xpbmVTZWdtZW50RGlzdGFuY2UoYXJnczoge1xuICAgIHBvaW50OiBSZXR1cm5UeXBlPHR5cGVvZiBwb2ludD47XG4gICAgbGluZVN0YXJ0OiBbbnVtYmVyLCBudW1iZXJdO1xuICAgIGxpbmVFbmQ6IFtudW1iZXIsIG51bWJlcl07XG4gIH0pOiBudW1iZXIge1xuICAgIGNvbnN0IHsgcG9pbnQ6IHAsIGxpbmVTdGFydCwgbGluZUVuZCB9ID0gYXJncztcbiAgICBjb25zdCBbcHgsIHB5XSA9IHAuZ2VvbWV0cnkuY29vcmRpbmF0ZXM7XG4gICAgY29uc3QgW3gxLCB5MV0gPSBsaW5lU3RhcnQ7XG4gICAgY29uc3QgW3gyLCB5Ml0gPSBsaW5lRW5kO1xuXG4gICAgY29uc3QgQSA9IHB4IC0geDE7XG4gICAgY29uc3QgQiA9IHB5IC0geTE7XG4gICAgY29uc3QgQyA9IHgyIC0geDE7XG4gICAgY29uc3QgRCA9IHkyIC0geTE7XG5cbiAgICBjb25zdCBkb3QgPSBBICogQyArIEIgKiBEO1xuICAgIGNvbnN0IGxlblNxID0gQyAqIEMgKyBEICogRDtcbiAgICBsZXQgcGFyYW0gPSAtMTtcblxuICAgIGlmIChsZW5TcSAhPT0gMCkge1xuICAgICAgcGFyYW0gPSBkb3QgLyBsZW5TcTtcbiAgICB9XG5cbiAgICBsZXQgeHg6IG51bWJlcjtcbiAgICBsZXQgeXk6IG51bWJlcjtcblxuICAgIGlmIChwYXJhbSA8IDApIHtcbiAgICAgIHh4ID0geDE7XG4gICAgICB5eSA9IHkxO1xuICAgIH0gZWxzZSBpZiAocGFyYW0gPiAxKSB7XG4gICAgICB4eCA9IHgyO1xuICAgICAgeXkgPSB5MjtcbiAgICB9IGVsc2Uge1xuICAgICAgeHggPSB4MSArIHBhcmFtICogQztcbiAgICAgIHl5ID0geTEgKyBwYXJhbSAqIEQ7XG4gICAgfVxuXG4gICAgY29uc3QgY2xvc2VzdFBvaW50ID0gcG9pbnQoW3h4LCB5eV0pO1xuICAgIHJldHVybiBkaXN0YW5jZShwLCBjbG9zZXN0UG9pbnQsIHsgdW5pdHM6IFwibWV0ZXJzXCIgfSk7XG4gIH1cblxuICBkaXN0YW5jZVRvVmVudWVHZW9tZXRyeShhcmdzOiB7XG4gICAgc3RvcFBvaW50OiBSZXR1cm5UeXBlPHR5cGVvZiBwb2ludD47XG4gICAgZ2VvbWV0cnk6IFZlbnVlR2VvbWV0cnk7XG4gIH0pOiBudW1iZXIgfCBudWxsIHtcbiAgICBjb25zdCB7IHN0b3BQb2ludCwgZ2VvbWV0cnkgfSA9IGFyZ3M7XG5cbiAgICBpZiAoZ2VvbWV0cnkudHlwZSA9PT0gXCJQb2ludFwiKSB7XG4gICAgICBjb25zdCBjb29yZHMgPSBnZW9tZXRyeS5jb29yZGluYXRlcyBhcyBudW1iZXJbXTtcbiAgICAgIGlmICghQXJyYXkuaXNBcnJheShjb29yZHMpIHx8IGNvb3Jkcy5sZW5ndGggPCAyKSByZXR1cm4gbnVsbDtcbiAgICAgIGNvbnN0IFt2TG9uLCB2TGF0XSA9IGNvb3JkcztcbiAgICAgIGlmICh0eXBlb2YgdkxvbiAhPT0gXCJudW1iZXJcIiB8fCB0eXBlb2YgdkxhdCAhPT0gXCJudW1iZXJcIikgcmV0dXJuIG51bGw7XG4gICAgICBjb25zdCB2ZW51ZVBvaW50ID0gcG9pbnQoW3ZMb24sIHZMYXRdKTtcbiAgICAgIHJldHVybiBkaXN0YW5jZShzdG9wUG9pbnQsIHZlbnVlUG9pbnQsIHsgdW5pdHM6IFwibWV0ZXJzXCIgfSk7XG4gICAgfVxuXG4gICAgaWYgKGdlb21ldHJ5LnR5cGUgPT09IFwiUG9seWdvblwiKSB7XG4gICAgICBjb25zdCBwb2x5Z29uID0gZ2VvbWV0cnkgYXMgUG9seWdvbjtcbiAgICAgIGxldCBtaW5EaXN0YW5jZSA9IEluZmluaXR5O1xuXG4gICAgICBmb3IgKGNvbnN0IHJpbmcgb2YgcG9seWdvbi5jb29yZGluYXRlcykge1xuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHJpbmcubGVuZ3RoIC0gMTsgaSsrKSB7XG4gICAgICAgICAgY29uc3QgZGlzdCA9IHRoaXMucG9pbnRUb0xpbmVTZWdtZW50RGlzdGFuY2Uoe1xuICAgICAgICAgICAgcG9pbnQ6IHN0b3BQb2ludCxcbiAgICAgICAgICAgIGxpbmVTdGFydDogcmluZ1tpXSBhcyBbbnVtYmVyLCBudW1iZXJdLFxuICAgICAgICAgICAgbGluZUVuZDogcmluZ1tpICsgMV0gYXMgW251bWJlciwgbnVtYmVyXSxcbiAgICAgICAgICB9KTtcbiAgICAgICAgICBtaW5EaXN0YW5jZSA9IE1hdGgubWluKG1pbkRpc3RhbmNlLCBkaXN0KTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gbWluRGlzdGFuY2U7XG4gICAgfVxuXG4gICAgaWYgKGdlb21ldHJ5LnR5cGUgPT09IFwiTXVsdGlQb2x5Z29uXCIpIHtcbiAgICAgIGNvbnN0IG11bHRpUG9seWdvbiA9IGdlb21ldHJ5IGFzIE11bHRpUG9seWdvbjtcbiAgICAgIGxldCBtaW5EaXN0YW5jZSA9IEluZmluaXR5O1xuXG4gICAgICBmb3IgKGNvbnN0IHBvbHlnb24gb2YgbXVsdGlQb2x5Z29uLmNvb3JkaW5hdGVzKSB7XG4gICAgICAgIGZvciAoY29uc3QgcmluZyBvZiBwb2x5Z29uKSB7XG4gICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCByaW5nLmxlbmd0aCAtIDE7IGkrKykge1xuICAgICAgICAgICAgY29uc3QgZGlzdCA9IHRoaXMucG9pbnRUb0xpbmVTZWdtZW50RGlzdGFuY2Uoe1xuICAgICAgICAgICAgICBwb2ludDogc3RvcFBvaW50LFxuICAgICAgICAgICAgICBsaW5lU3RhcnQ6IHJpbmdbaV0gYXMgW251bWJlciwgbnVtYmVyXSxcbiAgICAgICAgICAgICAgbGluZUVuZDogcmluZ1tpICsgMV0gYXMgW251bWJlciwgbnVtYmVyXSxcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgbWluRGlzdGFuY2UgPSBNYXRoLm1pbihtaW5EaXN0YW5jZSwgZGlzdCk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIHJldHVybiBtaW5EaXN0YW5jZTtcbiAgICB9XG5cbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIGlzV2l0aGluUmFkaXVzKGFyZ3M6IHtcbiAgICBzdG9wUG9pbnQ6IFJldHVyblR5cGU8dHlwZW9mIHBvaW50PjtcbiAgICB2ZW51ZUdlb21ldHJ5OiBWZW51ZUdlb21ldHJ5O1xuICAgIHJhZGl1c01ldGVyczogbnVtYmVyO1xuICB9KTogYm9vbGVhbiB7XG4gICAgY29uc3QgeyBzdG9wUG9pbnQsIHZlbnVlR2VvbWV0cnksIHJhZGl1c01ldGVycyB9ID0gYXJncztcbiAgICBjb25zdCBkaXN0TWV0ZXJzID0gdGhpcy5kaXN0YW5jZVRvVmVudWVHZW9tZXRyeSh7XG4gICAgICBzdG9wUG9pbnQsXG4gICAgICBnZW9tZXRyeTogdmVudWVHZW9tZXRyeSxcbiAgICB9KTtcbiAgICBpZiAoZGlzdE1ldGVycyA9PT0gbnVsbCkgcmV0dXJuIGZhbHNlO1xuICAgIHJldHVybiBkaXN0TWV0ZXJzIDw9IHJhZGl1c01ldGVycztcbiAgfVxufVxuXG5leHBvcnQgeyBTdG9wR2VvbWV0cnkgfTtcbmV4cG9ydCB0eXBlIHsgVmVudWVHZW9tZXRyeSB9O1xuIiwiLypcbiAqIENvcHlyaWdodCAoYykgMjAyNSBNYcOrbCBQZWRyZXR0aVxuICpcbiAqIFRoaXMgZmlsZSBpcyBwYXJ0IG9mIFdNRSBTd2l0emVybGFuZCBIZWxwZXIuXG4gKlxuICogVGhpcyBwcm9ncmFtIGlzIGZyZWUgc29mdHdhcmU6IHlvdSBjYW4gcmVkaXN0cmlidXRlIGl0IGFuZC9vciBtb2RpZnlcbiAqIGl0IHVuZGVyIHRoZSB0ZXJtcyBvZiB0aGUgR05VIEFmZmVybyBHZW5lcmFsIFB1YmxpYyBMaWNlbnNlIGFzIHB1Ymxpc2hlZCBieVxuICogdGhlIEZyZWUgU29mdHdhcmUgRm91bmRhdGlvbiwgZWl0aGVyIHZlcnNpb24gMyBvZiB0aGUgTGljZW5zZSwgb3JcbiAqIChhdCB5b3VyIG9wdGlvbikgYW55IGxhdGVyIHZlcnNpb24uXG4gKlxuICogVGhpcyBwcm9ncmFtIGlzIGRpc3RyaWJ1dGVkIGluIHRoZSBob3BlIHRoYXQgaXQgd2lsbCBiZSB1c2VmdWwsXG4gKiBidXQgV0lUSE9VVCBBTlkgV0FSUkFOVFk7IHdpdGhvdXQgZXZlbiB0aGUgaW1wbGllZCB3YXJyYW50eSBvZlxuICogTUVSQ0hBTlRBQklMSVRZIG9yIEZJVE5FU1MgRk9SIEEgUEFSVElDVUxBUiBQVVJQT1NFLiAgU2VlIHRoZVxuICogR05VIEFmZmVybyBHZW5lcmFsIFB1YmxpYyBMaWNlbnNlIGZvciBtb3JlIGRldGFpbHMuXG4gKlxuICogWW91IHNob3VsZCBoYXZlIHJlY2VpdmVkIGEgY29weSBvZiB0aGUgR05VIEFmZmVybyBHZW5lcmFsIFB1YmxpYyBMaWNlbnNlXG4gKiBhbG9uZyB3aXRoIHRoaXMgcHJvZ3JhbS4gIElmIG5vdCwgc2VlIDxodHRwczovL3d3dy5nbnUub3JnL2xpY2Vuc2VzLz4uXG4gKi9cblxuaW50ZXJmYWNlIFRyYW5zcG9ydFN0b3Age1xuICBkZXNpZ25hdGlvbm9mZmljaWFsPzogc3RyaW5nO1xuICBkZXNpZ25hdGlvbj86IHN0cmluZztcbiAgbXVuaWNpcGFsaXR5bmFtZTogc3RyaW5nO1xuICBidXNpbmVzc29yZ2FuaXNhdGlvbmFiYnJldmlhdGlvbmRlOiBzdHJpbmc7XG4gIGJ1c2luZXNzb3JnYW5pc2F0aW9uZGVzY3JpcHRpb25kZTogc3RyaW5nO1xuICBtZWFuc29mdHJhbnNwb3J0OiBzdHJpbmc7XG59XG5cbmludGVyZmFjZSBOYW1lUmVzdWx0IHtcbiAgbmFtZTogc3RyaW5nO1xuICBhbGlhc2VzOiBzdHJpbmdbXTtcbiAgc2hvcnROYW1lOiBzdHJpbmc7XG59XG5cbmNsYXNzIFN0b3BOYW1lRm9ybWF0dGVyIHtcbiAgcHJpdmF0ZSByZWFkb25seSB2ZW51ZUlubmVyVHlwZU1hcHBpbmc6IE1hcDxzdHJpbmcsIHN0cmluZz47XG4gIHByaXZhdGUgcmVhZG9ubHkgZGVmYXVsdFZlbnVlSW5uZXJUeXBlOiBzdHJpbmc7XG5cbiAgY29uc3RydWN0b3IoKSB7XG4gICAgdGhpcy52ZW51ZUlubmVyVHlwZU1hcHBpbmcgPSBuZXcgTWFwKCk7XG4gICAgdGhpcy5kZWZhdWx0VmVudWVJbm5lclR5cGUgPSBcImFycsOqdFwiO1xuICAgIHRoaXMudmVudWVJbm5lclR5cGVNYXBwaW5nLnNldChcIlRSQUlOXCIsIFwiZ2FyZVwiKTtcbiAgICB0aGlzLnZlbnVlSW5uZXJUeXBlTWFwcGluZy5zZXQoXCJCT0FUXCIsIFwicG9ydFwiKTtcbiAgICB0aGlzLnZlbnVlSW5uZXJUeXBlTWFwcGluZy5zZXQoXCJDSEFJUkxJRlRcIiwgXCJyZW1vbnTDqWUgbcOpY2FuaXF1ZVwiKTtcbiAgfVxuXG4gIHByaXZhdGUgbWVhbnNPZlRyYW5zcG9ydChtZWFuc29mdHJhbnNwb3J0OiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gICAgcmV0dXJuIG1lYW5zb2Z0cmFuc3BvcnQuc3BsaXQoXCJ8XCIpO1xuICB9XG5cbiAgcHJpdmF0ZSBnZXRWZW51ZUlubmVyVHlwZShtZWFuc29mdHJhbnNwb3J0OiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIGNvbnN0IG1lYW5zID0gdGhpcy5tZWFuc09mVHJhbnNwb3J0KG1lYW5zb2Z0cmFuc3BvcnQpO1xuICAgIHJldHVybiBtZWFuc1xuICAgICAgLm1hcChcbiAgICAgICAgKG1lYW4pID0+XG4gICAgICAgICAgdGhpcy52ZW51ZUlubmVyVHlwZU1hcHBpbmcuZ2V0KG1lYW4pIHx8IHRoaXMuZGVmYXVsdFZlbnVlSW5uZXJUeXBlLFxuICAgICAgKVxuICAgICAgLmpvaW4oXCIsIFwiKTtcbiAgfVxuXG4gIHByaXZhdGUgY2xlYW5TdG9wTmFtZShuYW1lOiBzdHJpbmcsIG11bmljaXBhbGl0eW5hbWU6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgbGV0IGNsZWFuZWQgPSBuYW1lLnJlcGxhY2UoL1xcKHTDqWzDqXNpw6hnZVxcKS9pLCBcIlwiKS50cmltKCk7XG4gICAgY29uc3Qgc3BsaXR0ZWQgPSBjbGVhbmVkLnNwbGl0KFwiLFwiKTtcblxuICAgIGlmIChzcGxpdHRlZC5sZW5ndGggPT09IDIgJiYgc3BsaXR0ZWRbMF0udHJpbSgpID09PSBtdW5pY2lwYWxpdHluYW1lKSB7XG4gICAgICBjbGVhbmVkID0gc3BsaXR0ZWRbMV07XG4gICAgfSBlbHNlIGlmIChcbiAgICAgIGNsZWFuZWQuaW5jbHVkZXMobXVuaWNpcGFsaXR5bmFtZSkgJiZcbiAgICAgIGNsZWFuZWQucmVwbGFjZShtdW5pY2lwYWxpdHluYW1lLCBcIlwiKSAhPT0gXCJcIiAmJlxuICAgICAgIWNsZWFuZWQucmVwbGFjZShtdW5pY2lwYWxpdHluYW1lLCBcIlwiKS5zdGFydHNXaXRoKFwiLVwiKVxuICAgICkge1xuICAgICAgY2xlYW5lZCA9IGNsZWFuZWQucmVwbGFjZShtdW5pY2lwYWxpdHluYW1lLCBcIlwiKTtcbiAgICB9XG5cbiAgICBjbGVhbmVkID0gY2xlYW5lZC50cmltKCk7XG4gICAgcmV0dXJuIGNsZWFuZWQuY2hhckF0KDApLnRvVXBwZXJDYXNlKCkgKyBjbGVhbmVkLnNsaWNlKDEpO1xuICB9XG5cbiAgcHJpdmF0ZSBub3JtYWxpemVPcmdhbml6YXRpb24oXG4gICAgYWJicmV2aWF0aW9uOiBzdHJpbmcsXG4gICAgZnVsbE5hbWU6IHN0cmluZyxcbiAgKTogeyBhYmJyZXZpYXRpb246IHN0cmluZzsgZnVsbE5hbWU6IHN0cmluZyB9IHtcbiAgICBjb25zdCBhYmJyZXZMb3dlciA9IGFiYnJldmlhdGlvbi50b0xvd2VyQ2FzZSgpO1xuXG4gICAgaWYgKGFiYnJldkxvd2VyID09PSBcInNiYlwiKSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBhYmJyZXZpYXRpb246IFwiQ0ZGXCIsXG4gICAgICAgIGZ1bGxOYW1lOiBcIkNoZW1pbnMgZGUgZmVyIGbDqWTDqXJhdXggQ0ZGXCIsXG4gICAgICB9O1xuICAgIH1cblxuICAgIGlmIChcbiAgICAgIFtcbiAgICAgICAgXCJ0cm4vdGNcIixcbiAgICAgICAgXCJ0cm4vYXV0b3ZyXCIsXG4gICAgICAgIFwidHJuL2F1dHJ2dFwiLFxuICAgICAgICBcInRybi10blwiLFxuICAgICAgICBcInRybi1jbW5cIixcbiAgICAgICAgXCJ0cm4tcnZ0XCIsXG4gICAgICBdLmluY2x1ZGVzKGFiYnJldkxvd2VyKVxuICAgICkge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgYWJicmV2aWF0aW9uOiBcInRyYW5zTlwiLFxuICAgICAgICBmdWxsTmFtZTogXCJUcmFuc3BvcnRzIFB1YmxpY3MgTmV1Y2jDonRlbG9pcyBTQVwiLFxuICAgICAgfTtcbiAgICB9XG5cbiAgICBpZiAoYWJicmV2TG93ZXIgPT09IFwicGFnXCIpIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIGFiYnJldmlhdGlvbjogXCJcIixcbiAgICAgICAgZnVsbE5hbWU6IFwiQ2FyUG9zdGFsIFNBXCIsXG4gICAgICB9O1xuICAgIH1cblxuICAgIHJldHVybiB7IGFiYnJldmlhdGlvbiwgZnVsbE5hbWUgfTtcbiAgfVxuXG4gIGZvcm1hdE5hbWUoc3RvcDogVHJhbnNwb3J0U3RvcCk6IE5hbWVSZXN1bHQge1xuICAgIGNvbnN0IHJhd05hbWUgPSBzdG9wLmRlc2lnbmF0aW9ub2ZmaWNpYWwgfHwgc3RvcC5kZXNpZ25hdGlvbiB8fCBcIkJ1cyBTdG9wXCI7XG4gICAgY29uc3QgY2xlYW5lZE5hbWUgPSB0aGlzLmNsZWFuU3RvcE5hbWUocmF3TmFtZSwgc3RvcC5tdW5pY2lwYWxpdHluYW1lKTtcbiAgICBjb25zdCB2ZW51ZUlubmVyVHlwZSA9IHRoaXMuZ2V0VmVudWVJbm5lclR5cGUoc3RvcC5tZWFuc29mdHJhbnNwb3J0KTtcblxuICAgIGNvbnN0IHsgYWJicmV2aWF0aW9uLCBmdWxsTmFtZSB9ID0gdGhpcy5ub3JtYWxpemVPcmdhbml6YXRpb24oXG4gICAgICBzdG9wLmJ1c2luZXNzb3JnYW5pc2F0aW9uYWJicmV2aWF0aW9uZGUsXG4gICAgICBzdG9wLmJ1c2luZXNzb3JnYW5pc2F0aW9uZGVzY3JpcHRpb25kZSxcbiAgICApO1xuXG4gICAgY29uc3QgYWxpYXNlczogc3RyaW5nW10gPSBbXTtcbiAgICBjb25zdCBzaG9ydE5hbWUgPSBjbGVhbmVkTmFtZTtcblxuICAgIGlmIChzdG9wLmJ1c2luZXNzb3JnYW5pc2F0aW9uYWJicmV2aWF0aW9uZGUudG9Mb3dlckNhc2UoKSA9PT0gXCJzYmJcIikge1xuICAgICAgYWxpYXNlcy5wdXNoKFxuICAgICAgICBgJHtjbGVhbmVkTmFtZX0gKCR7dmVudWVJbm5lclR5cGV9ICR7c3RvcC5idXNpbmVzc29yZ2FuaXNhdGlvbmRlc2NyaXB0aW9uZGV9KWAsXG4gICAgICApO1xuICAgICAgYWxpYXNlcy5wdXNoKFxuICAgICAgICBgJHtjbGVhbmVkTmFtZX0gKCR7dmVudWVJbm5lclR5cGV9ICR7c3RvcC5idXNpbmVzc29yZ2FuaXNhdGlvbmFiYnJldmlhdGlvbmRlfSlgLFxuICAgICAgKTtcbiAgICB9XG5cbiAgICBpZiAoYWJicmV2aWF0aW9uICE9PSBcIlwiKSB7XG4gICAgICBhbGlhc2VzLnB1c2goYCR7Y2xlYW5lZE5hbWV9ICgke3ZlbnVlSW5uZXJUeXBlfSAke2Z1bGxOYW1lfSlgKTtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIG5hbWU6IGAke2NsZWFuZWROYW1lfSAoJHt2ZW51ZUlubmVyVHlwZX0gJHthYmJyZXZpYXRpb259KWAsXG4gICAgICAgIGFsaWFzZXMsXG4gICAgICAgIHNob3J0TmFtZSxcbiAgICAgIH07XG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIG5hbWU6IGAke2NsZWFuZWROYW1lfSAoJHt2ZW51ZUlubmVyVHlwZX0gJHtmdWxsTmFtZX0pYCxcbiAgICAgIGFsaWFzZXMsXG4gICAgICBzaG9ydE5hbWUsXG4gICAgfTtcbiAgfVxufVxuXG5leHBvcnQgeyBTdG9wTmFtZUZvcm1hdHRlciB9O1xuZXhwb3J0IHR5cGUgeyBOYW1lUmVzdWx0IH07XG4iLCIvKlxuICogQ29weXJpZ2h0IChjKSAyMDI1IE1hw6tsIFBlZHJldHRpXG4gKlxuICogVGhpcyBmaWxlIGlzIHBhcnQgb2YgV01FIFN3aXR6ZXJsYW5kIEhlbHBlci5cbiAqXG4gKiBUaGlzIHByb2dyYW0gaXMgZnJlZSBzb2Z0d2FyZTogeW91IGNhbiByZWRpc3RyaWJ1dGUgaXQgYW5kL29yIG1vZGlmeVxuICogaXQgdW5kZXIgdGhlIHRlcm1zIG9mIHRoZSBHTlUgQWZmZXJvIEdlbmVyYWwgUHVibGljIExpY2Vuc2UgYXMgcHVibGlzaGVkIGJ5XG4gKiB0aGUgRnJlZSBTb2Z0d2FyZSBGb3VuZGF0aW9uLCBlaXRoZXIgdmVyc2lvbiAzIG9mIHRoZSBMaWNlbnNlLCBvclxuICogKGF0IHlvdXIgb3B0aW9uKSBhbnkgbGF0ZXIgdmVyc2lvbi5cbiAqXG4gKiBUaGlzIHByb2dyYW0gaXMgZGlzdHJpYnV0ZWQgaW4gdGhlIGhvcGUgdGhhdCBpdCB3aWxsIGJlIHVzZWZ1bCxcbiAqIGJ1dCBXSVRIT1VUIEFOWSBXQVJSQU5UWTsgd2l0aG91dCBldmVuIHRoZSBpbXBsaWVkIHdhcnJhbnR5IG9mXG4gKiBNRVJDSEFOVEFCSUxJVFkgb3IgRklUTkVTUyBGT1IgQSBQQVJUSUNVTEFSIFBVUlBPU0UuICBTZWUgdGhlXG4gKiBHTlUgQWZmZXJvIEdlbmVyYWwgUHVibGljIExpY2Vuc2UgZm9yIG1vcmUgZGV0YWlscy5cbiAqXG4gKiBZb3Ugc2hvdWxkIGhhdmUgcmVjZWl2ZWQgYSBjb3B5IG9mIHRoZSBHTlUgQWZmZXJvIEdlbmVyYWwgUHVibGljIExpY2Vuc2VcbiAqIGFsb25nIHdpdGggdGhpcyBwcm9ncmFtLiAgSWYgbm90LCBzZWUgPGh0dHBzOi8vd3d3LmdudS5vcmcvbGljZW5zZXMvPi5cbiAqL1xuXG5pbXBvcnQgeyBwb2ludCB9IGZyb20gXCJAdHVyZi90dXJmXCI7XG5pbXBvcnQgeyBTdG9wR2VvbWV0cnksIHR5cGUgVmVudWVHZW9tZXRyeSB9IGZyb20gXCIuL3N0b3BHZW9tZXRyeVwiO1xuXG5pbnRlcmZhY2UgVmVudWVMaWtlIHtcbiAgaWQ6IHN0cmluZyB8IG51bWJlcjtcbiAgbmFtZTogc3RyaW5nO1xuICBjYXRlZ29yaWVzOiBzdHJpbmdbXTtcbiAgZ2VvbWV0cnk6IFZlbnVlR2VvbWV0cnk7XG59XG5cbmNsYXNzIFZlbnVlTWF0Y2hlciB7XG4gIHByaXZhdGUgcmVhZG9ubHkgc3RvcEdlb21ldHJ5OiBTdG9wR2VvbWV0cnk7XG5cbiAgY29uc3RydWN0b3IoKSB7XG4gICAgdGhpcy5zdG9wR2VvbWV0cnkgPSBuZXcgU3RvcEdlb21ldHJ5KCk7XG4gIH1cblxuICBmaW5kTWF0Y2hpbmdWZW51ZXMoYXJnczoge1xuICAgIHZlbnVlczogVmVudWVMaWtlW107XG4gICAgc3RvcExvbjogbnVtYmVyO1xuICAgIHN0b3BMYXQ6IG51bWJlcjtcbiAgICBzdG9wTmFtZTogc3RyaW5nO1xuICAgIHN0b3BTaG9ydE5hbWU6IHN0cmluZztcbiAgICBjYXRlZ29yaWVzOiBzdHJpbmdbXTtcbiAgICByYWRpdXNNZXRlcnM6IG51bWJlcjtcbiAgfSk6IFZlbnVlTGlrZVtdIHtcbiAgICBjb25zdCB7XG4gICAgICB2ZW51ZXMsXG4gICAgICBzdG9wTG9uLFxuICAgICAgc3RvcExhdCxcbiAgICAgIHN0b3BOYW1lLFxuICAgICAgc3RvcFNob3J0TmFtZSxcbiAgICAgIGNhdGVnb3JpZXMsXG4gICAgICByYWRpdXNNZXRlcnMsXG4gICAgfSA9IGFyZ3M7XG5cbiAgICBjb25zdCBzdG9wUG9pbnQgPSBwb2ludChbc3RvcExvbiwgc3RvcExhdF0pO1xuXG4gICAgY29uc3QgbWF0Y2hpbmdWZW51ZXMgPSB2ZW51ZXMuZmlsdGVyKCh2ZW51ZSkgPT4ge1xuICAgICAgY29uc3QgaGFzTWF0Y2hpbmdDYXRlZ29yeSA9IHZlbnVlLmNhdGVnb3JpZXMuc29tZSgoY2F0KSA9PlxuICAgICAgICBjYXRlZ29yaWVzLmluY2x1ZGVzKGNhdCksXG4gICAgICApO1xuICAgICAgaWYgKCFoYXNNYXRjaGluZ0NhdGVnb3J5KSByZXR1cm4gZmFsc2U7XG5cbiAgICAgIGNvbnN0IGlzV2l0aGluUmFkaXVzID0gdGhpcy5zdG9wR2VvbWV0cnkuaXNXaXRoaW5SYWRpdXMoe1xuICAgICAgICBzdG9wUG9pbnQsXG4gICAgICAgIHZlbnVlR2VvbWV0cnk6IHZlbnVlLmdlb21ldHJ5LFxuICAgICAgICByYWRpdXNNZXRlcnMsXG4gICAgICB9KTtcbiAgICAgIGlmICghaXNXaXRoaW5SYWRpdXMpIHJldHVybiBmYWxzZTtcblxuICAgICAgcmV0dXJuIHZlbnVlLm5hbWUudG9Mb3dlckNhc2UoKS5pbmNsdWRlcyhzdG9wU2hvcnROYW1lLnRvTG93ZXJDYXNlKCkpO1xuICAgIH0pO1xuXG4gICAgcmV0dXJuIG1hdGNoaW5nVmVudWVzO1xuICB9XG5cbiAgaGFzRXhhY3RNYXRjaChhcmdzOiB7XG4gICAgdmVudWVzOiBWZW51ZUxpa2VbXTtcbiAgICBzdG9wTG9uOiBudW1iZXI7XG4gICAgc3RvcExhdDogbnVtYmVyO1xuICAgIHN0b3BOYW1lOiBzdHJpbmc7XG4gICAgY2F0ZWdvcmllczogc3RyaW5nW107XG4gIH0pOiBib29sZWFuIHtcbiAgICBjb25zdCB7IHZlbnVlcywgc3RvcExvbiwgc3RvcExhdCwgc3RvcE5hbWUsIGNhdGVnb3JpZXMgfSA9IGFyZ3M7XG4gICAgY29uc3Qgc3RvcFBvaW50ID0gcG9pbnQoW3N0b3BMb24sIHN0b3BMYXRdKTtcblxuICAgIHJldHVybiB2ZW51ZXMuc29tZSgodikgPT4ge1xuICAgICAgaWYgKHYubmFtZSAhPT0gc3RvcE5hbWUpIHJldHVybiBmYWxzZTtcblxuICAgICAgY29uc3QgaGFzTWF0Y2hpbmdDYXRlZ29yeSA9IHYuY2F0ZWdvcmllcy5zb21lKChjYXQpID0+XG4gICAgICAgIGNhdGVnb3JpZXMuaW5jbHVkZXMoY2F0KSxcbiAgICAgICk7XG4gICAgICBpZiAoIWhhc01hdGNoaW5nQ2F0ZWdvcnkpIHJldHVybiBmYWxzZTtcblxuICAgICAgcmV0dXJuIHRoaXMuc3RvcEdlb21ldHJ5LmlzV2l0aGluUmFkaXVzKHtcbiAgICAgICAgc3RvcFBvaW50LFxuICAgICAgICB2ZW51ZUdlb21ldHJ5OiB2Lmdlb21ldHJ5LFxuICAgICAgICByYWRpdXNNZXRlcnM6IDUsXG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxufVxuXG5leHBvcnQgeyBWZW51ZU1hdGNoZXIgfTtcbmV4cG9ydCB0eXBlIHsgVmVudWVMaWtlIH07XG4iLCIvKlxuICogQ29weXJpZ2h0IChjKSAyMDI1IE1hw6tsIFBlZHJldHRpXG4gKlxuICogVGhpcyBmaWxlIGlzIHBhcnQgb2YgV01FIFN3aXR6ZXJsYW5kIEhlbHBlci5cbiAqXG4gKiBUaGlzIHByb2dyYW0gaXMgZnJlZSBzb2Z0d2FyZTogeW91IGNhbiByZWRpc3RyaWJ1dGUgaXQgYW5kL29yIG1vZGlmeVxuICogaXQgdW5kZXIgdGhlIHRlcm1zIG9mIHRoZSBHTlUgQWZmZXJvIEdlbmVyYWwgUHVibGljIExpY2Vuc2UgYXMgcHVibGlzaGVkIGJ5XG4gKiB0aGUgRnJlZSBTb2Z0d2FyZSBGb3VuZGF0aW9uLCBlaXRoZXIgdmVyc2lvbiAzIG9mIHRoZSBMaWNlbnNlLCBvclxuICogKGF0IHlvdXIgb3B0aW9uKSBhbnkgbGF0ZXIgdmVyc2lvbi5cbiAqXG4gKiBUaGlzIHByb2dyYW0gaXMgZGlzdHJpYnV0ZWQgaW4gdGhlIGhvcGUgdGhhdCBpdCB3aWxsIGJlIHVzZWZ1bCxcbiAqIGJ1dCBXSVRIT1VUIEFOWSBXQVJSQU5UWTsgd2l0aG91dCBldmVuIHRoZSBpbXBsaWVkIHdhcnJhbnR5IG9mXG4gKiBNRVJDSEFOVEFCSUxJVFkgb3IgRklUTkVTUyBGT1IgQSBQQVJUSUNVTEFSIFBVUlBPU0UuICBTZWUgdGhlXG4gKiBHTlUgQWZmZXJvIEdlbmVyYWwgUHVibGljIExpY2Vuc2UgZm9yIG1vcmUgZGV0YWlscy5cbiAqXG4gKiBZb3Ugc2hvdWxkIGhhdmUgcmVjZWl2ZWQgYSBjb3B5IG9mIHRoZSBHTlUgQWZmZXJvIEdlbmVyYWwgUHVibGljIExpY2Vuc2VcbiAqIGFsb25nIHdpdGggdGhpcyBwcm9ncmFtLiAgSWYgbm90LCBzZWUgPGh0dHBzOi8vd3d3LmdudS5vcmcvbGljZW5zZXMvPi5cbiAqL1xuXG5pbXBvcnQge1xuICBXbWVTREssXG4gIFZlbnVlQ2F0ZWdvcnlJZCxcbiAgU2RrRmVhdHVyZSxcbiAgU2RrRmVhdHVyZVN0eWxlUnVsZSxcbn0gZnJvbSBcIndtZS1zZGstdHlwaW5nc1wiO1xuaW1wb3J0IHsgU0JCRGF0YUZldGNoZXIsIFNCQlJlY29yZCB9IGZyb20gXCIuL3NiYkRhdGFMYXllclwiO1xuaW1wb3J0IHsgRmVhdHVyZUxheWVyIH0gZnJvbSBcIi4vZmVhdHVyZUxheWVyXCI7XG5pbXBvcnQgeyBzaG93V21lRGlhbG9nLCB3YWl0Rm9yTWFwSWRsZSB9IGZyb20gXCIuL3V0aWxzXCI7XG5pbXBvcnQgeyBTdG9wR2VvbWV0cnkgfSBmcm9tIFwiLi9zdG9wR2VvbWV0cnlcIjtcbmltcG9ydCB7IFN0b3BOYW1lRm9ybWF0dGVyIH0gZnJvbSBcIi4vc3RvcE5hbWVGb3JtYXR0ZXJcIjtcbmltcG9ydCB7IFZlbnVlTWF0Y2hlciwgdHlwZSBWZW51ZUxpa2UgfSBmcm9tIFwiLi92ZW51ZU1hdGNoZXJcIjtcblxuaW50ZXJmYWNlIFRyYW5zcG9ydFN0b3AgZXh0ZW5kcyBTQkJSZWNvcmQge1xuICBtZWFuc29mdHJhbnNwb3J0OiBzdHJpbmc7XG4gIGRlc2lnbmF0aW9ub2ZmaWNpYWw/OiBzdHJpbmc7XG4gIGRlc2lnbmF0aW9uPzogc3RyaW5nO1xuICBtdW5pY2lwYWxpdHluYW1lOiBzdHJpbmc7XG4gIGJ1c2luZXNzb3JnYW5pc2F0aW9uYWJicmV2aWF0aW9uZGU6IHN0cmluZztcbiAgYnVzaW5lc3NvcmdhbmlzYXRpb25kZXNjcmlwdGlvbmRlOiBzdHJpbmc7XG4gIGxhdD86IG51bWJlcjtcbiAgbG9uPzogbnVtYmVyO1xufVxuXG5pbnRlcmZhY2UgUHVibGljVHJhbnNwb3J0U3RvcHNMYXllckNvbnN0cnVjdG9yQXJncyB7XG4gIG5hbWU6IHN0cmluZztcbiAgc3R5bGVSdWxlcz86IFNka0ZlYXR1cmVTdHlsZVJ1bGVbXTtcbn1cblxuY2xhc3MgUHVibGljVHJhbnNwb3J0U3RvcHNMYXllciBleHRlbmRzIEZlYXR1cmVMYXllciB7XG4gIHByaXZhdGUgcmVhZG9ubHkgZGF0YUZldGNoZXI6IFNCQkRhdGFGZXRjaGVyO1xuICBwcml2YXRlIHJlYWRvbmx5IHN0b3BHZW9tZXRyeTogU3RvcEdlb21ldHJ5O1xuICBwcml2YXRlIHJlYWRvbmx5IG5hbWVGb3JtYXR0ZXI6IFN0b3BOYW1lRm9ybWF0dGVyO1xuICBwcml2YXRlIHJlYWRvbmx5IHZlbnVlTWF0Y2hlcjogVmVudWVNYXRjaGVyO1xuXG4gIGNvbnN0cnVjdG9yKFxuICAgIGFyZ3M6IFB1YmxpY1RyYW5zcG9ydFN0b3BzTGF5ZXJDb25zdHJ1Y3RvckFyZ3MgJiB7IHdtZVNESzogV21lU0RLIH0sXG4gICkge1xuICAgIHN1cGVyKHsgLi4uYXJncywgd21lU0RLOiBhcmdzLndtZVNESywgbWluWm9vbUxldmVsOiAxNCB9KTtcbiAgICB0aGlzLmRhdGFGZXRjaGVyID0gbmV3IFNCQkRhdGFGZXRjaGVyKHtcbiAgICAgIGRhdGFTZXQ6IFwiaGFsdGVzdGVsbGUtaGFsdGVrYW50ZVwiLFxuICAgIH0pO1xuICAgIHRoaXMuc3RvcEdlb21ldHJ5ID0gbmV3IFN0b3BHZW9tZXRyeSgpO1xuICAgIHRoaXMubmFtZUZvcm1hdHRlciA9IG5ldyBTdG9wTmFtZUZvcm1hdHRlcigpO1xuICAgIHRoaXMudmVudWVNYXRjaGVyID0gbmV3IFZlbnVlTWF0Y2hlcigpO1xuICB9XG5cbiAgZ2V0UmVjb3JkSWQoYXJnczogeyByZWNvcmQ6IHVua25vd24gfSk6IHN0cmluZyB7XG4gICAgY29uc3QgcmVjb3JkID0gYXJncy5yZWNvcmQgYXMgVHJhbnNwb3J0U3RvcDtcbiAgICByZXR1cm4gU3RyaW5nKHJlY29yZC5udW1iZXIpO1xuICB9XG5cbiAgbWFwUmVjb3JkVG9GZWF0dXJlKGFyZ3M6IHsgcmVjb3JkOiB1bmtub3duIH0pOiBTZGtGZWF0dXJlIHtcbiAgICBjb25zdCByZWNvcmQgPSBhcmdzLnJlY29yZCBhcyBUcmFuc3BvcnRTdG9wO1xuICAgIHJldHVybiB7XG4gICAgICBnZW9tZXRyeToge1xuICAgICAgICBjb29yZGluYXRlczogW1xuICAgICAgICAgIHJlY29yZC5nZW9wb3NfaGFsdGVzdGVsbGUubG9uLFxuICAgICAgICAgIHJlY29yZC5nZW9wb3NfaGFsdGVzdGVsbGUubGF0LFxuICAgICAgICBdLFxuICAgICAgICB0eXBlOiBcIlBvaW50XCIsXG4gICAgICB9LFxuICAgICAgdHlwZTogXCJGZWF0dXJlXCIsXG4gICAgICBpZDogU3RyaW5nKHJlY29yZC5udW1iZXIpLFxuICAgIH07XG4gIH1cblxuICBhc3luYyAqZmV0Y2hEYXRhKGFyZ3M6IHtcbiAgICB3bWVTREs6IFdtZVNESztcbiAgfSk6IEFzeW5jR2VuZXJhdG9yPFRyYW5zcG9ydFN0b3BbXSwgdm9pZCwgdW5rbm93bj4ge1xuICAgIGNvbnN0IHsgd21lU0RLIH0gPSBhcmdzO1xuICAgIGZvciBhd2FpdCAoY29uc3QgYmF0Y2ggb2YgdGhpcy5kYXRhRmV0Y2hlci5mZXRjaFJlY29yZHMoeyB3bWVTREsgfSkpIHtcbiAgICAgIHlpZWxkIGJhdGNoIGFzIFRyYW5zcG9ydFN0b3BbXTtcbiAgICB9XG4gIH1cblxuICBtZWFuc09mVHJhbnNwb3J0KGFyZ3M6IHsgbWVhbnNvZnRyYW5zcG9ydDogc3RyaW5nIH0pOiBzdHJpbmdbXSB7XG4gICAgcmV0dXJuIGFyZ3MubWVhbnNvZnRyYW5zcG9ydC5zcGxpdChcInxcIik7XG4gIH1cblxuICB2ZW51ZUNhdGVnb3JpZXMoYXJnczogeyBtZWFuc29mdHJhbnNwb3J0OiBzdHJpbmcgfSk6IHN0cmluZ1tdIHtcbiAgICBjb25zdCBtZWFuc09mVHJhbnNwb3J0ID0gdGhpcy5tZWFuc09mVHJhbnNwb3J0KGFyZ3MpO1xuICAgIHJldHVybiBtZWFuc09mVHJhbnNwb3J0Lm1hcCgobWVhbikgPT4ge1xuICAgICAgaWYgKG1lYW4gPT09IFwiTUVUUk9cIikgcmV0dXJuIFwiU1VCV0FZX1NUQVRJT05cIjtcbiAgICAgIGlmIChtZWFuID09PSBcIkJPQVRcIikgcmV0dXJuIFwiU0VBUE9SVF9NQVJJTkFfSEFSQk9SXCI7XG4gICAgICBpZiAobWVhbiA9PT0gXCJDSEFJUkxJRlRcIikgcmV0dXJuIFwiVFJBTlNQT1JUQVRJT05cIjtcbiAgICAgIHJldHVybiBgJHttZWFufV9TVEFUSU9OYDtcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgc3RvcExvbkxhdChcbiAgICByZWNvcmQ6IFRyYW5zcG9ydFN0b3AsXG4gICk6IHsgbGF0OiBudW1iZXI7IGxvbjogbnVtYmVyIH0gfCBudWxsIHtcbiAgICBjb25zdCBsYXQgPSBwYXJzZUZsb2F0KFxuICAgICAgU3RyaW5nKHJlY29yZC5nZW9wb3NfaGFsdGVzdGVsbGU/LmxhdCB8fCByZWNvcmQubGF0IHx8IDApLFxuICAgICk7XG4gICAgY29uc3QgbG9uID0gcGFyc2VGbG9hdChcbiAgICAgIFN0cmluZyhyZWNvcmQuZ2VvcG9zX2hhbHRlc3RlbGxlPy5sb24gfHwgcmVjb3JkLmxvbiB8fCAwKSxcbiAgICApO1xuXG4gICAgaWYgKE51bWJlci5pc05hTihsYXQpIHx8IE51bWJlci5pc05hTihsb24pKSByZXR1cm4gbnVsbDtcbiAgICByZXR1cm4geyBsYXQsIGxvbiB9O1xuICB9XG5cbiAgZ2V0RmlsdGVyQ29udGV4dChhcmdzOiB7IHdtZVNESzogV21lU0RLIH0pOiB7IHZlbnVlczogVmVudWVMaWtlW10gfSB7XG4gICAgY29uc3QgeyB3bWVTREsgfSA9IGFyZ3M7XG4gICAgY29uc3QgdmVudWVzID0gd21lU0RLLkRhdGFNb2RlbC5WZW51ZXMuZ2V0QWxsKCkgYXMgVmVudWVMaWtlW107XG4gICAgcmV0dXJuIHsgdmVudWVzIH07XG4gIH1cblxuICBzaG91bGREcmF3UmVjb3JkKGFyZ3M6IHtcbiAgICB3bWVTREs6IFdtZVNESztcbiAgICByZWNvcmQ6IHVua25vd247XG4gICAgY29udGV4dD86IHsgdmVudWVzOiBWZW51ZUxpa2VbXSB9O1xuICB9KTogYm9vbGVhbiB7XG4gICAgY29uc3QgeyByZWNvcmQsIGNvbnRleHQgfSA9IGFyZ3M7XG4gICAgY29uc3Qgc3RvcCA9IHJlY29yZCBhcyBUcmFuc3BvcnRTdG9wO1xuXG4gICAgaWYgKCFzdG9wLm1lYW5zb2Z0cmFuc3BvcnQgfHwgc3RvcC5tZWFuc29mdHJhbnNwb3J0ID09PSBcIlwiKSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuXG4gICAgY29uc3Qgc3RvcExvbkxhdCA9IHRoaXMuc3RvcExvbkxhdChzdG9wKTtcbiAgICBpZiAoIXN0b3BMb25MYXQpIHtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cblxuICAgIGNvbnN0IHsgbmFtZSB9ID0gdGhpcy5uYW1lRm9ybWF0dGVyLmZvcm1hdE5hbWUoc3RvcCk7XG4gICAgY29uc3QgdmVudWVDYXRlZ29yaWVzID0gdGhpcy52ZW51ZUNhdGVnb3JpZXMoe1xuICAgICAgbWVhbnNvZnRyYW5zcG9ydDogc3RvcC5tZWFuc29mdHJhbnNwb3J0LFxuICAgIH0pO1xuICAgIGNvbnN0IHZlbnVlcyA9IGNvbnRleHQ/LnZlbnVlcyA/PyBbXTtcblxuICAgIHJldHVybiAhdGhpcy52ZW51ZU1hdGNoZXIuaGFzRXhhY3RNYXRjaCh7XG4gICAgICB2ZW51ZXMsXG4gICAgICBzdG9wTG9uOiBzdG9wTG9uTGF0LmxvbixcbiAgICAgIHN0b3BMYXQ6IHN0b3BMb25MYXQubGF0LFxuICAgICAgc3RvcE5hbWU6IG5hbWUsXG4gICAgICBjYXRlZ29yaWVzOiB2ZW51ZUNhdGVnb3JpZXMsXG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGhhbmRsZVpvb21SZXF1aXJlZChhcmdzOiB7XG4gICAgd21lU0RLOiBXbWVTREs7XG4gICAgbGF0OiBudW1iZXI7XG4gICAgbG9uOiBudW1iZXI7XG4gIH0pOiB2b2lkIHtcbiAgICBjb25zdCB7IHdtZVNESywgbGF0LCBsb24gfSA9IGFyZ3M7XG4gICAgdGhpcy51bnJlZ2lzdGVyRXZlbnRzKCk7XG5cbiAgICB3bWVTREsuTWFwLnNldE1hcENlbnRlcih7IGxvbkxhdDogeyBsYXQsIGxvbiB9LCB6b29tTGV2ZWw6IDE3IH0pO1xuXG4gICAgdGhpcy5yZWdpc3RlckV2ZW50cyh7IHdtZVNESyB9KTtcblxuICAgIHdhaXRGb3JNYXBJZGxlKHsgd21lU0RLLCBpbnRlcnZhbE1zOiA1MCwgbWF4VHJpZXM6IDYwIH0pLnRoZW4oKCkgPT4ge1xuICAgICAgdGhpcy5yZWZpbHRlckZlYXR1cmVzKHsgd21lU0RLIH0pO1xuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBwcm9tcHRVc2VyQWN0aW9uKGFyZ3M6IHtcbiAgICB3bWVTREs6IFdtZVNESztcbiAgICBtYXRjaGluZ1ZlbnVlczogVmVudWVMaWtlW107XG4gIH0pOiBQcm9taXNlPHtcbiAgICBhY3Rpb246IFwibWVyZ2VcIiB8IFwibWVyZ2Utd2l0aC1jb29yZHNcIiB8IFwic2F2ZVwiIHwgXCJjYW5jZWxcIjtcbiAgICB2ZW51ZXM6IFZlbnVlTGlrZVtdO1xuICB9PiB7XG4gICAgY29uc3QgeyB3bWVTREssIG1hdGNoaW5nVmVudWVzIH0gPSBhcmdzO1xuXG4gICAgd21lU0RLLkVkaXRpbmcuc2V0U2VsZWN0aW9uKHtcbiAgICAgIHNlbGVjdGlvbjoge1xuICAgICAgICBpZHM6IG1hdGNoaW5nVmVudWVzLm1hcCgodmVudWUpID0+IHZlbnVlLmlkLnRvU3RyaW5nKCkpLFxuICAgICAgICBvYmplY3RUeXBlOiBcInZlbnVlXCIsXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgc2hvd1dtZURpYWxvZyh7XG4gICAgICBtZXNzYWdlOiBgSWwgc2VtYmxlIHF1J2lsIGV4aXN0ZSBkw6lqw6AgJHttYXRjaGluZ1ZlbnVlcy5sZW5ndGh9IGFycsOqdChzKSBhdmVjIGNlIG5vbS48YnIvPk5vdXMgbGVzIGF2b25zIHPDqWxlY3Rpb25uw6lzIHBvdXIgdm91cy48YnIvPlF1ZSB2b3VsZXotdm91cyBmYWlyZT88YnIvPlPDqWxlY3Rpb25uZXIgPHByZSBzdHlsZT1cImRpc3BsYXk6IGlubGluZTtcIj5GdXNpb25uZXI8L3ByZT4gYXBwbGlxdWVyYSBsZXMgaW5mb3JtYXRpb25zIGF1eCBhbmNpZW5zIHBvaW50cyBzYW5zIGNyw6llciBsZSBub3V2ZWF1LmAsXG4gICAgICBidXR0b25zOiBbXG4gICAgICAgIHsgbGFiZWw6IFwiRnVzaW9ubmVyXCIsIHZhbHVlOiBcIm1lcmdlXCIgfSxcbiAgICAgICAge1xuICAgICAgICAgIGxhYmVsOiBcIkZ1c2lvbm5lciBldCBtZXR0cmUgw6Agam91ciBsZXMgY29vcmRvbm7DqWVzXCIsXG4gICAgICAgICAgdmFsdWU6IFwibWVyZ2Utd2l0aC1jb29yZHNcIixcbiAgICAgICAgfSxcbiAgICAgICAgeyBsYWJlbDogXCJFbnJlZ2lzdHJlciBsZSBub3V2ZWF1XCIsIHZhbHVlOiBcInNhdmVcIiB9LFxuICAgICAgICB7IGxhYmVsOiBcIkFubnVsZXJcIiwgdmFsdWU6IFwiY2FuY2VsXCIgfSxcbiAgICAgIF0sXG4gICAgfSk7XG5cbiAgICBsZXQgdmVudWVzVG9VcGRhdGUgPSBtYXRjaGluZ1ZlbnVlcztcblxuICAgIGlmIChyZXN1bHQgPT09IFwic2F2ZVwiKSB7XG4gICAgICB2ZW51ZXNUb1VwZGF0ZSA9IFtdO1xuICAgIH0gZWxzZSBpZiAocmVzdWx0ID09PSBcIm1lcmdlLXdpdGgtY29vcmRzXCIpIHtcbiAgICAgIHZlbnVlc1RvVXBkYXRlID0gbWF0Y2hpbmdWZW51ZXMubWFwKCh2KSA9PiAoe1xuICAgICAgICAuLi52LFxuICAgICAgICBfdXBkYXRlQ29vcmRpbmF0ZXM6IHRydWUsXG4gICAgICB9KSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGFjdGlvbjogcmVzdWx0IGFzIFwibWVyZ2VcIiB8IFwibWVyZ2Utd2l0aC1jb29yZHNcIiB8IFwic2F2ZVwiIHwgXCJjYW5jZWxcIixcbiAgICAgIHZlbnVlczogdmVudWVzVG9VcGRhdGUsXG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgY3JlYXRlT3JVcGRhdGVWZW51ZShhcmdzOiB7XG4gICAgd21lU0RLOiBXbWVTREs7XG4gICAgdmVudWVzVG9VcGRhdGU6IEFycmF5PFZlbnVlTGlrZSAmIHsgX3VwZGF0ZUNvb3JkaW5hdGVzPzogYm9vbGVhbiB9PjtcbiAgICBsb246IG51bWJlcjtcbiAgICBsYXQ6IG51bWJlcjtcbiAgICBuYW1lOiBzdHJpbmc7XG4gICAgYWxpYXNlczogc3RyaW5nW107XG4gICAgY2F0ZWdvcmllczogc3RyaW5nW107XG4gIH0pOiBQcm9taXNlPEFycmF5PFZlbnVlTGlrZSAmIHsgX3VwZGF0ZUNvb3JkaW5hdGVzPzogYm9vbGVhbiB9Pj4ge1xuICAgIGNvbnN0IHsgd21lU0RLLCB2ZW51ZXNUb1VwZGF0ZSwgbG9uLCBsYXQsIG5hbWUsIGFsaWFzZXMsIGNhdGVnb3JpZXMgfSA9XG4gICAgICBhcmdzO1xuXG4gICAgbGV0IHZlbnVlcyA9IHZlbnVlc1RvVXBkYXRlO1xuXG4gICAgaWYgKHZlbnVlcy5sZW5ndGggPT09IDApIHtcbiAgICAgIGNvbnN0IGdlb21ldHJ5ID0ge1xuICAgICAgICB0eXBlOiBcIlBvaW50XCIgYXMgY29uc3QsXG4gICAgICAgIGNvb3JkaW5hdGVzOiBbbG9uLCBsYXRdIGFzIFtudW1iZXIsIG51bWJlcl0sXG4gICAgICB9O1xuICAgICAgY29uc3QgdmVudWVJZCA9IHdtZVNESy5EYXRhTW9kZWwuVmVudWVzLmFkZFZlbnVlKHtcbiAgICAgICAgY2F0ZWdvcnk6IFwiVFJBTlNQT1JUQVRJT05cIiBhcyBjb25zdCxcbiAgICAgICAgZ2VvbWV0cnksXG4gICAgICB9KTtcbiAgICAgIGNvbnN0IG5ld1ZlbnVlID0gd21lU0RLLkRhdGFNb2RlbC5WZW51ZXMuZ2V0QnlJZCh7XG4gICAgICAgIHZlbnVlSWQ6IHZlbnVlSWQudG9TdHJpbmcoKSxcbiAgICAgIH0pO1xuICAgICAgaWYgKG5ld1ZlbnVlKSB7XG4gICAgICAgIHZlbnVlcyA9IFtuZXdWZW51ZSBhcyBWZW51ZUxpa2VdO1xuICAgICAgfVxuICAgIH1cblxuICAgIGZvciAoY29uc3QgdmVudWUgb2YgdmVudWVzKSB7XG4gICAgICBjb25zdCB1cGRhdGVBcmdzID0ge1xuICAgICAgICB2ZW51ZUlkOiB2ZW51ZS5pZC50b1N0cmluZygpLFxuICAgICAgICBuYW1lLFxuICAgICAgICBhbGlhc2VzLFxuICAgICAgICBjYXRlZ29yaWVzOiBjYXRlZ29yaWVzIGFzIFZlbnVlQ2F0ZWdvcnlJZFtdLFxuICAgICAgICAuLi4odmVudWUuX3VwZGF0ZUNvb3JkaW5hdGVzICYmIHtcbiAgICAgICAgICBnZW9tZXRyeToge1xuICAgICAgICAgICAgdHlwZTogXCJQb2ludFwiIGFzIGNvbnN0LFxuICAgICAgICAgICAgY29vcmRpbmF0ZXM6IFtsb24sIGxhdF0gYXMgW251bWJlciwgbnVtYmVyXSxcbiAgICAgICAgICB9LFxuICAgICAgICB9KSxcbiAgICAgIH07XG5cbiAgICAgIHdtZVNESy5EYXRhTW9kZWwuVmVudWVzLnVwZGF0ZVZlbnVlKFxuICAgICAgICB1cGRhdGVBcmdzIGFzIFBhcmFtZXRlcnM8dHlwZW9mIHdtZVNESy5EYXRhTW9kZWwuVmVudWVzLnVwZGF0ZVZlbnVlPlswXSxcbiAgICAgICk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHZlbnVlcztcbiAgfVxuXG4gIGFzeW5jIGZlYXR1cmVDbGlja2VkKGFyZ3M6IHtcbiAgICB3bWVTREs6IFdtZVNESztcbiAgICBmZWF0dXJlSWQ6IHN0cmluZyB8IG51bWJlcjtcbiAgfSk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHsgd21lU0RLLCBmZWF0dXJlSWQgfSA9IGFyZ3M7XG4gICAgY29uc3Qgc3RvcCA9IHRoaXMuZmVhdHVyZXMuZ2V0KGZlYXR1cmVJZCkgYXMgVHJhbnNwb3J0U3RvcDtcblxuICAgIGNvbnN0IHN0b3BMb25MYXQgPSB0aGlzLnN0b3BMb25MYXQoc3RvcCk7XG4gICAgaWYgKCFzdG9wTG9uTGF0KSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgeyBsYXQsIGxvbiB9ID0gc3RvcExvbkxhdDtcbiAgICBjb25zdCB6b29tTGV2ZWwgPSB3bWVTREsuTWFwLmdldFpvb21MZXZlbCgpO1xuXG4gICAgaWYgKHpvb21MZXZlbCA8IDE3KSB7XG4gICAgICB0aGlzLmhhbmRsZVpvb21SZXF1aXJlZCh7IHdtZVNESywgbGF0LCBsb24gfSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgeyBuYW1lLCBzaG9ydE5hbWUsIGFsaWFzZXMgfSA9IHRoaXMubmFtZUZvcm1hdHRlci5mb3JtYXROYW1lKHN0b3ApO1xuICAgIGNvbnN0IHZlbnVlQ2F0ZWdvcmllcyA9IHRoaXMudmVudWVDYXRlZ29yaWVzKHtcbiAgICAgIG1lYW5zb2Z0cmFuc3BvcnQ6IHN0b3AubWVhbnNvZnRyYW5zcG9ydCxcbiAgICB9KTtcbiAgICBjb25zdCBhbGxWZW51ZXMgPSB3bWVTREsuRGF0YU1vZGVsLlZlbnVlcy5nZXRBbGwoKSBhcyBWZW51ZUxpa2VbXTtcbiAgICBjb25zdCBjYXRlZ29yeUZpbHRlcmVkVmVudWVzID0gYWxsVmVudWVzLmZpbHRlcigodikgPT5cbiAgICAgIHYuY2F0ZWdvcmllcy5zb21lKChjYXQpID0+IHZlbnVlQ2F0ZWdvcmllcy5pbmNsdWRlcyhjYXQpKSxcbiAgICApO1xuXG4gICAgbGV0IHZlbnVlc1RvVXBkYXRlOiBBcnJheTxWZW51ZUxpa2UgJiB7IF91cGRhdGVDb29yZGluYXRlcz86IGJvb2xlYW4gfT4gPVxuICAgICAgW107XG5cbiAgICBpZiAoY2F0ZWdvcnlGaWx0ZXJlZFZlbnVlcy5sZW5ndGggPiAwKSB7XG4gICAgICBjb25zdCBtYXRjaGluZ1ZlbnVlcyA9IHRoaXMudmVudWVNYXRjaGVyLmZpbmRNYXRjaGluZ1ZlbnVlcyh7XG4gICAgICAgIHZlbnVlczogY2F0ZWdvcnlGaWx0ZXJlZFZlbnVlcyxcbiAgICAgICAgc3RvcExvbjogbG9uLFxuICAgICAgICBzdG9wTGF0OiBsYXQsXG4gICAgICAgIHN0b3BOYW1lOiBuYW1lLFxuICAgICAgICBzdG9wU2hvcnROYW1lOiBzaG9ydE5hbWUsXG4gICAgICAgIGNhdGVnb3JpZXM6IHZlbnVlQ2F0ZWdvcmllcyxcbiAgICAgICAgcmFkaXVzTWV0ZXJzOiA3NSxcbiAgICAgIH0pO1xuXG4gICAgICBpZiAobWF0Y2hpbmdWZW51ZXMubGVuZ3RoID4gMCkge1xuICAgICAgICBjb25zdCB7IGFjdGlvbiwgdmVudWVzIH0gPSBhd2FpdCB0aGlzLnByb21wdFVzZXJBY3Rpb24oe1xuICAgICAgICAgIHdtZVNESyxcbiAgICAgICAgICBtYXRjaGluZ1ZlbnVlcyxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaWYgKGFjdGlvbiA9PT0gXCJjYW5jZWxcIikge1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIHZlbnVlc1RvVXBkYXRlID0gdmVudWVzIGFzIEFycmF5PFxuICAgICAgICAgIFZlbnVlTGlrZSAmIHsgX3VwZGF0ZUNvb3JkaW5hdGVzPzogYm9vbGVhbiB9XG4gICAgICAgID47XG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgdXBkYXRlZFZlbnVlcyA9IGF3YWl0IHRoaXMuY3JlYXRlT3JVcGRhdGVWZW51ZSh7XG4gICAgICB3bWVTREssXG4gICAgICB2ZW51ZXNUb1VwZGF0ZSxcbiAgICAgIGxvbixcbiAgICAgIGxhdCxcbiAgICAgIG5hbWUsXG4gICAgICBhbGlhc2VzLFxuICAgICAgY2F0ZWdvcmllczogdmVudWVDYXRlZ29yaWVzLFxuICAgIH0pO1xuXG4gICAgd21lU0RLLkVkaXRpbmcuc2V0U2VsZWN0aW9uKHtcbiAgICAgIHNlbGVjdGlvbjoge1xuICAgICAgICBpZHM6IHVwZGF0ZWRWZW51ZXMubWFwKCh2ZW51ZSkgPT4gdmVudWUuaWQudG9TdHJpbmcoKSksXG4gICAgICAgIG9iamVjdFR5cGU6IFwidmVudWVcIixcbiAgICAgIH0sXG4gICAgfSk7XG4gICAgdGhpcy5yZW1vdmVGZWF0dXJlKHsgd21lU0RLLCBmZWF0dXJlSWQgfSk7XG4gIH1cbn1cblxuZXhwb3J0IHsgUHVibGljVHJhbnNwb3J0U3RvcHNMYXllciB9O1xuIiwiY29uc3QgaXNTdHJpbmcgPSBvYmogPT4gdHlwZW9mIG9iaiA9PT0gJ3N0cmluZyc7XG5jb25zdCBkZWZlciA9ICgpID0+IHtcbiAgbGV0IHJlcztcbiAgbGV0IHJlajtcbiAgY29uc3QgcHJvbWlzZSA9IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICByZXMgPSByZXNvbHZlO1xuICAgIHJlaiA9IHJlamVjdDtcbiAgfSk7XG4gIHByb21pc2UucmVzb2x2ZSA9IHJlcztcbiAgcHJvbWlzZS5yZWplY3QgPSByZWo7XG4gIHJldHVybiBwcm9taXNlO1xufTtcbmNvbnN0IG1ha2VTdHJpbmcgPSBvYmplY3QgPT4ge1xuICBpZiAob2JqZWN0ID09IG51bGwpIHJldHVybiAnJztcbiAgcmV0dXJuICcnICsgb2JqZWN0O1xufTtcbmNvbnN0IGNvcHkgPSAoYSwgcywgdCkgPT4ge1xuICBhLmZvckVhY2gobSA9PiB7XG4gICAgaWYgKHNbbV0pIHRbbV0gPSBzW21dO1xuICB9KTtcbn07XG5jb25zdCBsYXN0T2ZQYXRoU2VwYXJhdG9yUmVnRXhwID0gLyMjIy9nO1xuY29uc3QgY2xlYW5LZXkgPSBrZXkgPT4ga2V5ICYmIGtleS5pbmRleE9mKCcjIyMnKSA+IC0xID8ga2V5LnJlcGxhY2UobGFzdE9mUGF0aFNlcGFyYXRvclJlZ0V4cCwgJy4nKSA6IGtleTtcbmNvbnN0IGNhbk5vdFRyYXZlcnNlRGVlcGVyID0gb2JqZWN0ID0+ICFvYmplY3QgfHwgaXNTdHJpbmcob2JqZWN0KTtcbmNvbnN0IGdldExhc3RPZlBhdGggPSAob2JqZWN0LCBwYXRoLCBFbXB0eSkgPT4ge1xuICBjb25zdCBzdGFjayA9ICFpc1N0cmluZyhwYXRoKSA/IHBhdGggOiBwYXRoLnNwbGl0KCcuJyk7XG4gIGxldCBzdGFja0luZGV4ID0gMDtcbiAgd2hpbGUgKHN0YWNrSW5kZXggPCBzdGFjay5sZW5ndGggLSAxKSB7XG4gICAgaWYgKGNhbk5vdFRyYXZlcnNlRGVlcGVyKG9iamVjdCkpIHJldHVybiB7fTtcbiAgICBjb25zdCBrZXkgPSBjbGVhbktleShzdGFja1tzdGFja0luZGV4XSk7XG4gICAgaWYgKCFvYmplY3Rba2V5XSAmJiBFbXB0eSkgb2JqZWN0W2tleV0gPSBuZXcgRW1wdHkoKTtcbiAgICBpZiAoT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKG9iamVjdCwga2V5KSkge1xuICAgICAgb2JqZWN0ID0gb2JqZWN0W2tleV07XG4gICAgfSBlbHNlIHtcbiAgICAgIG9iamVjdCA9IHt9O1xuICAgIH1cbiAgICArK3N0YWNrSW5kZXg7XG4gIH1cbiAgaWYgKGNhbk5vdFRyYXZlcnNlRGVlcGVyKG9iamVjdCkpIHJldHVybiB7fTtcbiAgcmV0dXJuIHtcbiAgICBvYmo6IG9iamVjdCxcbiAgICBrOiBjbGVhbktleShzdGFja1tzdGFja0luZGV4XSlcbiAgfTtcbn07XG5jb25zdCBzZXRQYXRoID0gKG9iamVjdCwgcGF0aCwgbmV3VmFsdWUpID0+IHtcbiAgY29uc3Qge1xuICAgIG9iaixcbiAgICBrXG4gIH0gPSBnZXRMYXN0T2ZQYXRoKG9iamVjdCwgcGF0aCwgT2JqZWN0KTtcbiAgaWYgKG9iaiAhPT0gdW5kZWZpbmVkIHx8IHBhdGgubGVuZ3RoID09PSAxKSB7XG4gICAgb2JqW2tdID0gbmV3VmFsdWU7XG4gICAgcmV0dXJuO1xuICB9XG4gIGxldCBlID0gcGF0aFtwYXRoLmxlbmd0aCAtIDFdO1xuICBsZXQgcCA9IHBhdGguc2xpY2UoMCwgcGF0aC5sZW5ndGggLSAxKTtcbiAgbGV0IGxhc3QgPSBnZXRMYXN0T2ZQYXRoKG9iamVjdCwgcCwgT2JqZWN0KTtcbiAgd2hpbGUgKGxhc3Qub2JqID09PSB1bmRlZmluZWQgJiYgcC5sZW5ndGgpIHtcbiAgICBlID0gYCR7cFtwLmxlbmd0aCAtIDFdfS4ke2V9YDtcbiAgICBwID0gcC5zbGljZSgwLCBwLmxlbmd0aCAtIDEpO1xuICAgIGxhc3QgPSBnZXRMYXN0T2ZQYXRoKG9iamVjdCwgcCwgT2JqZWN0KTtcbiAgICBpZiAobGFzdD8ub2JqICYmIHR5cGVvZiBsYXN0Lm9ialtgJHtsYXN0Lmt9LiR7ZX1gXSAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgIGxhc3Qub2JqID0gdW5kZWZpbmVkO1xuICAgIH1cbiAgfVxuICBsYXN0Lm9ialtgJHtsYXN0Lmt9LiR7ZX1gXSA9IG5ld1ZhbHVlO1xufTtcbmNvbnN0IHB1c2hQYXRoID0gKG9iamVjdCwgcGF0aCwgbmV3VmFsdWUsIGNvbmNhdCkgPT4ge1xuICBjb25zdCB7XG4gICAgb2JqLFxuICAgIGtcbiAgfSA9IGdldExhc3RPZlBhdGgob2JqZWN0LCBwYXRoLCBPYmplY3QpO1xuICBvYmpba10gPSBvYmpba10gfHwgW107XG4gIG9ialtrXS5wdXNoKG5ld1ZhbHVlKTtcbn07XG5jb25zdCBnZXRQYXRoID0gKG9iamVjdCwgcGF0aCkgPT4ge1xuICBjb25zdCB7XG4gICAgb2JqLFxuICAgIGtcbiAgfSA9IGdldExhc3RPZlBhdGgob2JqZWN0LCBwYXRoKTtcbiAgaWYgKCFvYmopIHJldHVybiB1bmRlZmluZWQ7XG4gIGlmICghT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKG9iaiwgaykpIHJldHVybiB1bmRlZmluZWQ7XG4gIHJldHVybiBvYmpba107XG59O1xuY29uc3QgZ2V0UGF0aFdpdGhEZWZhdWx0cyA9IChkYXRhLCBkZWZhdWx0RGF0YSwga2V5KSA9PiB7XG4gIGNvbnN0IHZhbHVlID0gZ2V0UGF0aChkYXRhLCBrZXkpO1xuICBpZiAodmFsdWUgIT09IHVuZGVmaW5lZCkge1xuICAgIHJldHVybiB2YWx1ZTtcbiAgfVxuICByZXR1cm4gZ2V0UGF0aChkZWZhdWx0RGF0YSwga2V5KTtcbn07XG5jb25zdCBkZWVwRXh0ZW5kID0gKHRhcmdldCwgc291cmNlLCBvdmVyd3JpdGUpID0+IHtcbiAgZm9yIChjb25zdCBwcm9wIGluIHNvdXJjZSkge1xuICAgIGlmIChwcm9wICE9PSAnX19wcm90b19fJyAmJiBwcm9wICE9PSAnY29uc3RydWN0b3InKSB7XG4gICAgICBpZiAocHJvcCBpbiB0YXJnZXQpIHtcbiAgICAgICAgaWYgKGlzU3RyaW5nKHRhcmdldFtwcm9wXSkgfHwgdGFyZ2V0W3Byb3BdIGluc3RhbmNlb2YgU3RyaW5nIHx8IGlzU3RyaW5nKHNvdXJjZVtwcm9wXSkgfHwgc291cmNlW3Byb3BdIGluc3RhbmNlb2YgU3RyaW5nKSB7XG4gICAgICAgICAgaWYgKG92ZXJ3cml0ZSkgdGFyZ2V0W3Byb3BdID0gc291cmNlW3Byb3BdO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGRlZXBFeHRlbmQodGFyZ2V0W3Byb3BdLCBzb3VyY2VbcHJvcF0sIG92ZXJ3cml0ZSk7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRhcmdldFtwcm9wXSA9IHNvdXJjZVtwcm9wXTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbiAgcmV0dXJuIHRhcmdldDtcbn07XG5jb25zdCByZWdleEVzY2FwZSA9IHN0ciA9PiBzdHIucmVwbGFjZSgvW1xcLVxcW1xcXVxcL1xce1xcfVxcKFxcKVxcKlxcK1xcP1xcLlxcXFxcXF5cXCRcXHxdL2csICdcXFxcJCYnKTtcbnZhciBfZW50aXR5TWFwID0ge1xuICAnJic6ICcmYW1wOycsXG4gICc8JzogJyZsdDsnLFxuICAnPic6ICcmZ3Q7JyxcbiAgJ1wiJzogJyZxdW90OycsXG4gIFwiJ1wiOiAnJiMzOTsnLFxuICAnLyc6ICcmI3gyRjsnXG59O1xuY29uc3QgZXNjYXBlID0gZGF0YSA9PiB7XG4gIGlmIChpc1N0cmluZyhkYXRhKSkge1xuICAgIHJldHVybiBkYXRhLnJlcGxhY2UoL1smPD5cIidcXC9dL2csIHMgPT4gX2VudGl0eU1hcFtzXSk7XG4gIH1cbiAgcmV0dXJuIGRhdGE7XG59O1xuY2xhc3MgUmVnRXhwQ2FjaGUge1xuICBjb25zdHJ1Y3RvcihjYXBhY2l0eSkge1xuICAgIHRoaXMuY2FwYWNpdHkgPSBjYXBhY2l0eTtcbiAgICB0aGlzLnJlZ0V4cE1hcCA9IG5ldyBNYXAoKTtcbiAgICB0aGlzLnJlZ0V4cFF1ZXVlID0gW107XG4gIH1cbiAgZ2V0UmVnRXhwKHBhdHRlcm4pIHtcbiAgICBjb25zdCByZWdFeHBGcm9tQ2FjaGUgPSB0aGlzLnJlZ0V4cE1hcC5nZXQocGF0dGVybik7XG4gICAgaWYgKHJlZ0V4cEZyb21DYWNoZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICByZXR1cm4gcmVnRXhwRnJvbUNhY2hlO1xuICAgIH1cbiAgICBjb25zdCByZWdFeHBOZXcgPSBuZXcgUmVnRXhwKHBhdHRlcm4pO1xuICAgIGlmICh0aGlzLnJlZ0V4cFF1ZXVlLmxlbmd0aCA9PT0gdGhpcy5jYXBhY2l0eSkge1xuICAgICAgdGhpcy5yZWdFeHBNYXAuZGVsZXRlKHRoaXMucmVnRXhwUXVldWUuc2hpZnQoKSk7XG4gICAgfVxuICAgIHRoaXMucmVnRXhwTWFwLnNldChwYXR0ZXJuLCByZWdFeHBOZXcpO1xuICAgIHRoaXMucmVnRXhwUXVldWUucHVzaChwYXR0ZXJuKTtcbiAgICByZXR1cm4gcmVnRXhwTmV3O1xuICB9XG59XG5jb25zdCBjaGFycyA9IFsnICcsICcsJywgJz8nLCAnIScsICc7J107XG5jb25zdCBsb29rc0xpa2VPYmplY3RQYXRoUmVnRXhwQ2FjaGUgPSBuZXcgUmVnRXhwQ2FjaGUoMjApO1xuY29uc3QgbG9va3NMaWtlT2JqZWN0UGF0aCA9IChrZXksIG5zU2VwYXJhdG9yLCBrZXlTZXBhcmF0b3IpID0+IHtcbiAgbnNTZXBhcmF0b3IgPSBuc1NlcGFyYXRvciB8fCAnJztcbiAga2V5U2VwYXJhdG9yID0ga2V5U2VwYXJhdG9yIHx8ICcnO1xuICBjb25zdCBwb3NzaWJsZUNoYXJzID0gY2hhcnMuZmlsdGVyKGMgPT4gbnNTZXBhcmF0b3IuaW5kZXhPZihjKSA8IDAgJiYga2V5U2VwYXJhdG9yLmluZGV4T2YoYykgPCAwKTtcbiAgaWYgKHBvc3NpYmxlQ2hhcnMubGVuZ3RoID09PSAwKSByZXR1cm4gdHJ1ZTtcbiAgY29uc3QgciA9IGxvb2tzTGlrZU9iamVjdFBhdGhSZWdFeHBDYWNoZS5nZXRSZWdFeHAoYCgke3Bvc3NpYmxlQ2hhcnMubWFwKGMgPT4gYyA9PT0gJz8nID8gJ1xcXFw/JyA6IGMpLmpvaW4oJ3wnKX0pYCk7XG4gIGxldCBtYXRjaGVkID0gIXIudGVzdChrZXkpO1xuICBpZiAoIW1hdGNoZWQpIHtcbiAgICBjb25zdCBraSA9IGtleS5pbmRleE9mKGtleVNlcGFyYXRvcik7XG4gICAgaWYgKGtpID4gMCAmJiAhci50ZXN0KGtleS5zdWJzdHJpbmcoMCwga2kpKSkge1xuICAgICAgbWF0Y2hlZCA9IHRydWU7XG4gICAgfVxuICB9XG4gIHJldHVybiBtYXRjaGVkO1xufTtcbmNvbnN0IGRlZXBGaW5kID0gKG9iaiwgcGF0aCwga2V5U2VwYXJhdG9yID0gJy4nKSA9PiB7XG4gIGlmICghb2JqKSByZXR1cm4gdW5kZWZpbmVkO1xuICBpZiAob2JqW3BhdGhdKSB7XG4gICAgaWYgKCFPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwob2JqLCBwYXRoKSkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICByZXR1cm4gb2JqW3BhdGhdO1xuICB9XG4gIGNvbnN0IHRva2VucyA9IHBhdGguc3BsaXQoa2V5U2VwYXJhdG9yKTtcbiAgbGV0IGN1cnJlbnQgPSBvYmo7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgdG9rZW5zLmxlbmd0aDspIHtcbiAgICBpZiAoIWN1cnJlbnQgfHwgdHlwZW9mIGN1cnJlbnQgIT09ICdvYmplY3QnKSB7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cbiAgICBsZXQgbmV4dDtcbiAgICBsZXQgbmV4dFBhdGggPSAnJztcbiAgICBmb3IgKGxldCBqID0gaTsgaiA8IHRva2Vucy5sZW5ndGg7ICsraikge1xuICAgICAgaWYgKGogIT09IGkpIHtcbiAgICAgICAgbmV4dFBhdGggKz0ga2V5U2VwYXJhdG9yO1xuICAgICAgfVxuICAgICAgbmV4dFBhdGggKz0gdG9rZW5zW2pdO1xuICAgICAgbmV4dCA9IGN1cnJlbnRbbmV4dFBhdGhdO1xuICAgICAgaWYgKG5leHQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICBpZiAoWydzdHJpbmcnLCAnbnVtYmVyJywgJ2Jvb2xlYW4nXS5pbmRleE9mKHR5cGVvZiBuZXh0KSA+IC0xICYmIGogPCB0b2tlbnMubGVuZ3RoIC0gMSkge1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIGkgKz0gaiAtIGkgKyAxO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG4gICAgY3VycmVudCA9IG5leHQ7XG4gIH1cbiAgcmV0dXJuIGN1cnJlbnQ7XG59O1xuY29uc3QgZ2V0Q2xlYW5lZENvZGUgPSBjb2RlID0+IGNvZGU/LnJlcGxhY2UoJ18nLCAnLScpO1xuXG5jb25zdCBjb25zb2xlTG9nZ2VyID0ge1xuICB0eXBlOiAnbG9nZ2VyJyxcbiAgbG9nKGFyZ3MpIHtcbiAgICB0aGlzLm91dHB1dCgnbG9nJywgYXJncyk7XG4gIH0sXG4gIHdhcm4oYXJncykge1xuICAgIHRoaXMub3V0cHV0KCd3YXJuJywgYXJncyk7XG4gIH0sXG4gIGVycm9yKGFyZ3MpIHtcbiAgICB0aGlzLm91dHB1dCgnZXJyb3InLCBhcmdzKTtcbiAgfSxcbiAgb3V0cHV0KHR5cGUsIGFyZ3MpIHtcbiAgICBjb25zb2xlPy5bdHlwZV0/LmFwcGx5Py4oY29uc29sZSwgYXJncyk7XG4gIH1cbn07XG5jbGFzcyBMb2dnZXIge1xuICBjb25zdHJ1Y3Rvcihjb25jcmV0ZUxvZ2dlciwgb3B0aW9ucyA9IHt9KSB7XG4gICAgdGhpcy5pbml0KGNvbmNyZXRlTG9nZ2VyLCBvcHRpb25zKTtcbiAgfVxuICBpbml0KGNvbmNyZXRlTG9nZ2VyLCBvcHRpb25zID0ge30pIHtcbiAgICB0aGlzLnByZWZpeCA9IG9wdGlvbnMucHJlZml4IHx8ICdpMThuZXh0Oic7XG4gICAgdGhpcy5sb2dnZXIgPSBjb25jcmV0ZUxvZ2dlciB8fCBjb25zb2xlTG9nZ2VyO1xuICAgIHRoaXMub3B0aW9ucyA9IG9wdGlvbnM7XG4gICAgdGhpcy5kZWJ1ZyA9IG9wdGlvbnMuZGVidWc7XG4gIH1cbiAgbG9nKC4uLmFyZ3MpIHtcbiAgICByZXR1cm4gdGhpcy5mb3J3YXJkKGFyZ3MsICdsb2cnLCAnJywgdHJ1ZSk7XG4gIH1cbiAgd2FybiguLi5hcmdzKSB7XG4gICAgcmV0dXJuIHRoaXMuZm9yd2FyZChhcmdzLCAnd2FybicsICcnLCB0cnVlKTtcbiAgfVxuICBlcnJvciguLi5hcmdzKSB7XG4gICAgcmV0dXJuIHRoaXMuZm9yd2FyZChhcmdzLCAnZXJyb3InLCAnJyk7XG4gIH1cbiAgZGVwcmVjYXRlKC4uLmFyZ3MpIHtcbiAgICByZXR1cm4gdGhpcy5mb3J3YXJkKGFyZ3MsICd3YXJuJywgJ1dBUk5JTkcgREVQUkVDQVRFRDogJywgdHJ1ZSk7XG4gIH1cbiAgZm9yd2FyZChhcmdzLCBsdmwsIHByZWZpeCwgZGVidWdPbmx5KSB7XG4gICAgaWYgKGRlYnVnT25seSAmJiAhdGhpcy5kZWJ1ZykgcmV0dXJuIG51bGw7XG4gICAgaWYgKGlzU3RyaW5nKGFyZ3NbMF0pKSBhcmdzWzBdID0gYCR7cHJlZml4fSR7dGhpcy5wcmVmaXh9ICR7YXJnc1swXX1gO1xuICAgIHJldHVybiB0aGlzLmxvZ2dlcltsdmxdKGFyZ3MpO1xuICB9XG4gIGNyZWF0ZShtb2R1bGVOYW1lKSB7XG4gICAgcmV0dXJuIG5ldyBMb2dnZXIodGhpcy5sb2dnZXIsIHtcbiAgICAgIC4uLntcbiAgICAgICAgcHJlZml4OiBgJHt0aGlzLnByZWZpeH06JHttb2R1bGVOYW1lfTpgXG4gICAgICB9LFxuICAgICAgLi4udGhpcy5vcHRpb25zXG4gICAgfSk7XG4gIH1cbiAgY2xvbmUob3B0aW9ucykge1xuICAgIG9wdGlvbnMgPSBvcHRpb25zIHx8IHRoaXMub3B0aW9ucztcbiAgICBvcHRpb25zLnByZWZpeCA9IG9wdGlvbnMucHJlZml4IHx8IHRoaXMucHJlZml4O1xuICAgIHJldHVybiBuZXcgTG9nZ2VyKHRoaXMubG9nZ2VyLCBvcHRpb25zKTtcbiAgfVxufVxudmFyIGJhc2VMb2dnZXIgPSBuZXcgTG9nZ2VyKCk7XG5cbmNsYXNzIEV2ZW50RW1pdHRlciB7XG4gIGNvbnN0cnVjdG9yKCkge1xuICAgIHRoaXMub2JzZXJ2ZXJzID0ge307XG4gIH1cbiAgb24oZXZlbnRzLCBsaXN0ZW5lcikge1xuICAgIGV2ZW50cy5zcGxpdCgnICcpLmZvckVhY2goZXZlbnQgPT4ge1xuICAgICAgaWYgKCF0aGlzLm9ic2VydmVyc1tldmVudF0pIHRoaXMub2JzZXJ2ZXJzW2V2ZW50XSA9IG5ldyBNYXAoKTtcbiAgICAgIGNvbnN0IG51bUxpc3RlbmVycyA9IHRoaXMub2JzZXJ2ZXJzW2V2ZW50XS5nZXQobGlzdGVuZXIpIHx8IDA7XG4gICAgICB0aGlzLm9ic2VydmVyc1tldmVudF0uc2V0KGxpc3RlbmVyLCBudW1MaXN0ZW5lcnMgKyAxKTtcbiAgICB9KTtcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuICBvZmYoZXZlbnQsIGxpc3RlbmVyKSB7XG4gICAgaWYgKCF0aGlzLm9ic2VydmVyc1tldmVudF0pIHJldHVybjtcbiAgICBpZiAoIWxpc3RlbmVyKSB7XG4gICAgICBkZWxldGUgdGhpcy5vYnNlcnZlcnNbZXZlbnRdO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB0aGlzLm9ic2VydmVyc1tldmVudF0uZGVsZXRlKGxpc3RlbmVyKTtcbiAgfVxuICBlbWl0KGV2ZW50LCAuLi5hcmdzKSB7XG4gICAgaWYgKHRoaXMub2JzZXJ2ZXJzW2V2ZW50XSkge1xuICAgICAgY29uc3QgY2xvbmVkID0gQXJyYXkuZnJvbSh0aGlzLm9ic2VydmVyc1tldmVudF0uZW50cmllcygpKTtcbiAgICAgIGNsb25lZC5mb3JFYWNoKChbb2JzZXJ2ZXIsIG51bVRpbWVzQWRkZWRdKSA9PiB7XG4gICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgbnVtVGltZXNBZGRlZDsgaSsrKSB7XG4gICAgICAgICAgb2JzZXJ2ZXIoLi4uYXJncyk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH1cbiAgICBpZiAodGhpcy5vYnNlcnZlcnNbJyonXSkge1xuICAgICAgY29uc3QgY2xvbmVkID0gQXJyYXkuZnJvbSh0aGlzLm9ic2VydmVyc1snKiddLmVudHJpZXMoKSk7XG4gICAgICBjbG9uZWQuZm9yRWFjaCgoW29ic2VydmVyLCBudW1UaW1lc0FkZGVkXSkgPT4ge1xuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IG51bVRpbWVzQWRkZWQ7IGkrKykge1xuICAgICAgICAgIG9ic2VydmVyLmFwcGx5KG9ic2VydmVyLCBbZXZlbnQsIC4uLmFyZ3NdKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfVxuICB9XG59XG5cbmNsYXNzIFJlc291cmNlU3RvcmUgZXh0ZW5kcyBFdmVudEVtaXR0ZXIge1xuICBjb25zdHJ1Y3RvcihkYXRhLCBvcHRpb25zID0ge1xuICAgIG5zOiBbJ3RyYW5zbGF0aW9uJ10sXG4gICAgZGVmYXVsdE5TOiAndHJhbnNsYXRpb24nXG4gIH0pIHtcbiAgICBzdXBlcigpO1xuICAgIHRoaXMuZGF0YSA9IGRhdGEgfHwge307XG4gICAgdGhpcy5vcHRpb25zID0gb3B0aW9ucztcbiAgICBpZiAodGhpcy5vcHRpb25zLmtleVNlcGFyYXRvciA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aGlzLm9wdGlvbnMua2V5U2VwYXJhdG9yID0gJy4nO1xuICAgIH1cbiAgICBpZiAodGhpcy5vcHRpb25zLmlnbm9yZUpTT05TdHJ1Y3R1cmUgPT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhpcy5vcHRpb25zLmlnbm9yZUpTT05TdHJ1Y3R1cmUgPSB0cnVlO1xuICAgIH1cbiAgfVxuICBhZGROYW1lc3BhY2VzKG5zKSB7XG4gICAgaWYgKHRoaXMub3B0aW9ucy5ucy5pbmRleE9mKG5zKSA8IDApIHtcbiAgICAgIHRoaXMub3B0aW9ucy5ucy5wdXNoKG5zKTtcbiAgICB9XG4gIH1cbiAgcmVtb3ZlTmFtZXNwYWNlcyhucykge1xuICAgIGNvbnN0IGluZGV4ID0gdGhpcy5vcHRpb25zLm5zLmluZGV4T2YobnMpO1xuICAgIGlmIChpbmRleCA+IC0xKSB7XG4gICAgICB0aGlzLm9wdGlvbnMubnMuc3BsaWNlKGluZGV4LCAxKTtcbiAgICB9XG4gIH1cbiAgZ2V0UmVzb3VyY2UobG5nLCBucywga2V5LCBvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBrZXlTZXBhcmF0b3IgPSBvcHRpb25zLmtleVNlcGFyYXRvciAhPT0gdW5kZWZpbmVkID8gb3B0aW9ucy5rZXlTZXBhcmF0b3IgOiB0aGlzLm9wdGlvbnMua2V5U2VwYXJhdG9yO1xuICAgIGNvbnN0IGlnbm9yZUpTT05TdHJ1Y3R1cmUgPSBvcHRpb25zLmlnbm9yZUpTT05TdHJ1Y3R1cmUgIT09IHVuZGVmaW5lZCA/IG9wdGlvbnMuaWdub3JlSlNPTlN0cnVjdHVyZSA6IHRoaXMub3B0aW9ucy5pZ25vcmVKU09OU3RydWN0dXJlO1xuICAgIGxldCBwYXRoO1xuICAgIGlmIChsbmcuaW5kZXhPZignLicpID4gLTEpIHtcbiAgICAgIHBhdGggPSBsbmcuc3BsaXQoJy4nKTtcbiAgICB9IGVsc2Uge1xuICAgICAgcGF0aCA9IFtsbmcsIG5zXTtcbiAgICAgIGlmIChrZXkpIHtcbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkoa2V5KSkge1xuICAgICAgICAgIHBhdGgucHVzaCguLi5rZXkpO1xuICAgICAgICB9IGVsc2UgaWYgKGlzU3RyaW5nKGtleSkgJiYga2V5U2VwYXJhdG9yKSB7XG4gICAgICAgICAgcGF0aC5wdXNoKC4uLmtleS5zcGxpdChrZXlTZXBhcmF0b3IpKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBwYXRoLnB1c2goa2V5KTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgICBjb25zdCByZXN1bHQgPSBnZXRQYXRoKHRoaXMuZGF0YSwgcGF0aCk7XG4gICAgaWYgKCFyZXN1bHQgJiYgIW5zICYmICFrZXkgJiYgbG5nLmluZGV4T2YoJy4nKSA+IC0xKSB7XG4gICAgICBsbmcgPSBwYXRoWzBdO1xuICAgICAgbnMgPSBwYXRoWzFdO1xuICAgICAga2V5ID0gcGF0aC5zbGljZSgyKS5qb2luKCcuJyk7XG4gICAgfVxuICAgIGlmIChyZXN1bHQgfHwgIWlnbm9yZUpTT05TdHJ1Y3R1cmUgfHwgIWlzU3RyaW5nKGtleSkpIHJldHVybiByZXN1bHQ7XG4gICAgcmV0dXJuIGRlZXBGaW5kKHRoaXMuZGF0YT8uW2xuZ10/Lltuc10sIGtleSwga2V5U2VwYXJhdG9yKTtcbiAgfVxuICBhZGRSZXNvdXJjZShsbmcsIG5zLCBrZXksIHZhbHVlLCBvcHRpb25zID0ge1xuICAgIHNpbGVudDogZmFsc2VcbiAgfSkge1xuICAgIGNvbnN0IGtleVNlcGFyYXRvciA9IG9wdGlvbnMua2V5U2VwYXJhdG9yICE9PSB1bmRlZmluZWQgPyBvcHRpb25zLmtleVNlcGFyYXRvciA6IHRoaXMub3B0aW9ucy5rZXlTZXBhcmF0b3I7XG4gICAgbGV0IHBhdGggPSBbbG5nLCBuc107XG4gICAgaWYgKGtleSkgcGF0aCA9IHBhdGguY29uY2F0KGtleVNlcGFyYXRvciA/IGtleS5zcGxpdChrZXlTZXBhcmF0b3IpIDoga2V5KTtcbiAgICBpZiAobG5nLmluZGV4T2YoJy4nKSA+IC0xKSB7XG4gICAgICBwYXRoID0gbG5nLnNwbGl0KCcuJyk7XG4gICAgICB2YWx1ZSA9IG5zO1xuICAgICAgbnMgPSBwYXRoWzFdO1xuICAgIH1cbiAgICB0aGlzLmFkZE5hbWVzcGFjZXMobnMpO1xuICAgIHNldFBhdGgodGhpcy5kYXRhLCBwYXRoLCB2YWx1ZSk7XG4gICAgaWYgKCFvcHRpb25zLnNpbGVudCkgdGhpcy5lbWl0KCdhZGRlZCcsIGxuZywgbnMsIGtleSwgdmFsdWUpO1xuICB9XG4gIGFkZFJlc291cmNlcyhsbmcsIG5zLCByZXNvdXJjZXMsIG9wdGlvbnMgPSB7XG4gICAgc2lsZW50OiBmYWxzZVxuICB9KSB7XG4gICAgZm9yIChjb25zdCBtIGluIHJlc291cmNlcykge1xuICAgICAgaWYgKGlzU3RyaW5nKHJlc291cmNlc1ttXSkgfHwgQXJyYXkuaXNBcnJheShyZXNvdXJjZXNbbV0pKSB0aGlzLmFkZFJlc291cmNlKGxuZywgbnMsIG0sIHJlc291cmNlc1ttXSwge1xuICAgICAgICBzaWxlbnQ6IHRydWVcbiAgICAgIH0pO1xuICAgIH1cbiAgICBpZiAoIW9wdGlvbnMuc2lsZW50KSB0aGlzLmVtaXQoJ2FkZGVkJywgbG5nLCBucywgcmVzb3VyY2VzKTtcbiAgfVxuICBhZGRSZXNvdXJjZUJ1bmRsZShsbmcsIG5zLCByZXNvdXJjZXMsIGRlZXAsIG92ZXJ3cml0ZSwgb3B0aW9ucyA9IHtcbiAgICBzaWxlbnQ6IGZhbHNlLFxuICAgIHNraXBDb3B5OiBmYWxzZVxuICB9KSB7XG4gICAgbGV0IHBhdGggPSBbbG5nLCBuc107XG4gICAgaWYgKGxuZy5pbmRleE9mKCcuJykgPiAtMSkge1xuICAgICAgcGF0aCA9IGxuZy5zcGxpdCgnLicpO1xuICAgICAgZGVlcCA9IHJlc291cmNlcztcbiAgICAgIHJlc291cmNlcyA9IG5zO1xuICAgICAgbnMgPSBwYXRoWzFdO1xuICAgIH1cbiAgICB0aGlzLmFkZE5hbWVzcGFjZXMobnMpO1xuICAgIGxldCBwYWNrID0gZ2V0UGF0aCh0aGlzLmRhdGEsIHBhdGgpIHx8IHt9O1xuICAgIGlmICghb3B0aW9ucy5za2lwQ29weSkgcmVzb3VyY2VzID0gSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeShyZXNvdXJjZXMpKTtcbiAgICBpZiAoZGVlcCkge1xuICAgICAgZGVlcEV4dGVuZChwYWNrLCByZXNvdXJjZXMsIG92ZXJ3cml0ZSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHBhY2sgPSB7XG4gICAgICAgIC4uLnBhY2ssXG4gICAgICAgIC4uLnJlc291cmNlc1xuICAgICAgfTtcbiAgICB9XG4gICAgc2V0UGF0aCh0aGlzLmRhdGEsIHBhdGgsIHBhY2spO1xuICAgIGlmICghb3B0aW9ucy5zaWxlbnQpIHRoaXMuZW1pdCgnYWRkZWQnLCBsbmcsIG5zLCByZXNvdXJjZXMpO1xuICB9XG4gIHJlbW92ZVJlc291cmNlQnVuZGxlKGxuZywgbnMpIHtcbiAgICBpZiAodGhpcy5oYXNSZXNvdXJjZUJ1bmRsZShsbmcsIG5zKSkge1xuICAgICAgZGVsZXRlIHRoaXMuZGF0YVtsbmddW25zXTtcbiAgICB9XG4gICAgdGhpcy5yZW1vdmVOYW1lc3BhY2VzKG5zKTtcbiAgICB0aGlzLmVtaXQoJ3JlbW92ZWQnLCBsbmcsIG5zKTtcbiAgfVxuICBoYXNSZXNvdXJjZUJ1bmRsZShsbmcsIG5zKSB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0UmVzb3VyY2UobG5nLCBucykgIT09IHVuZGVmaW5lZDtcbiAgfVxuICBnZXRSZXNvdXJjZUJ1bmRsZShsbmcsIG5zKSB7XG4gICAgaWYgKCFucykgbnMgPSB0aGlzLm9wdGlvbnMuZGVmYXVsdE5TO1xuICAgIHJldHVybiB0aGlzLmdldFJlc291cmNlKGxuZywgbnMpO1xuICB9XG4gIGdldERhdGFCeUxhbmd1YWdlKGxuZykge1xuICAgIHJldHVybiB0aGlzLmRhdGFbbG5nXTtcbiAgfVxuICBoYXNMYW5ndWFnZVNvbWVUcmFuc2xhdGlvbnMobG5nKSB7XG4gICAgY29uc3QgZGF0YSA9IHRoaXMuZ2V0RGF0YUJ5TGFuZ3VhZ2UobG5nKTtcbiAgICBjb25zdCBuID0gZGF0YSAmJiBPYmplY3Qua2V5cyhkYXRhKSB8fCBbXTtcbiAgICByZXR1cm4gISFuLmZpbmQodiA9PiBkYXRhW3ZdICYmIE9iamVjdC5rZXlzKGRhdGFbdl0pLmxlbmd0aCA+IDApO1xuICB9XG4gIHRvSlNPTigpIHtcbiAgICByZXR1cm4gdGhpcy5kYXRhO1xuICB9XG59XG5cbnZhciBwb3N0UHJvY2Vzc29yID0ge1xuICBwcm9jZXNzb3JzOiB7fSxcbiAgYWRkUG9zdFByb2Nlc3Nvcihtb2R1bGUpIHtcbiAgICB0aGlzLnByb2Nlc3NvcnNbbW9kdWxlLm5hbWVdID0gbW9kdWxlO1xuICB9LFxuICBoYW5kbGUocHJvY2Vzc29ycywgdmFsdWUsIGtleSwgb3B0aW9ucywgdHJhbnNsYXRvcikge1xuICAgIHByb2Nlc3NvcnMuZm9yRWFjaChwcm9jZXNzb3IgPT4ge1xuICAgICAgdmFsdWUgPSB0aGlzLnByb2Nlc3NvcnNbcHJvY2Vzc29yXT8ucHJvY2Vzcyh2YWx1ZSwga2V5LCBvcHRpb25zLCB0cmFuc2xhdG9yKSA/PyB2YWx1ZTtcbiAgICB9KTtcbiAgICByZXR1cm4gdmFsdWU7XG4gIH1cbn07XG5cbmNvbnN0IGNoZWNrZWRMb2FkZWRGb3IgPSB7fTtcbmNvbnN0IHNob3VsZEhhbmRsZUFzT2JqZWN0ID0gcmVzID0+ICFpc1N0cmluZyhyZXMpICYmIHR5cGVvZiByZXMgIT09ICdib29sZWFuJyAmJiB0eXBlb2YgcmVzICE9PSAnbnVtYmVyJztcbmNsYXNzIFRyYW5zbGF0b3IgZXh0ZW5kcyBFdmVudEVtaXR0ZXIge1xuICBjb25zdHJ1Y3RvcihzZXJ2aWNlcywgb3B0aW9ucyA9IHt9KSB7XG4gICAgc3VwZXIoKTtcbiAgICBjb3B5KFsncmVzb3VyY2VTdG9yZScsICdsYW5ndWFnZVV0aWxzJywgJ3BsdXJhbFJlc29sdmVyJywgJ2ludGVycG9sYXRvcicsICdiYWNrZW5kQ29ubmVjdG9yJywgJ2kxOG5Gb3JtYXQnLCAndXRpbHMnXSwgc2VydmljZXMsIHRoaXMpO1xuICAgIHRoaXMub3B0aW9ucyA9IG9wdGlvbnM7XG4gICAgaWYgKHRoaXMub3B0aW9ucy5rZXlTZXBhcmF0b3IgPT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhpcy5vcHRpb25zLmtleVNlcGFyYXRvciA9ICcuJztcbiAgICB9XG4gICAgdGhpcy5sb2dnZXIgPSBiYXNlTG9nZ2VyLmNyZWF0ZSgndHJhbnNsYXRvcicpO1xuICB9XG4gIGNoYW5nZUxhbmd1YWdlKGxuZykge1xuICAgIGlmIChsbmcpIHRoaXMubGFuZ3VhZ2UgPSBsbmc7XG4gIH1cbiAgZXhpc3RzKGtleSwgbyA9IHtcbiAgICBpbnRlcnBvbGF0aW9uOiB7fVxuICB9KSB7XG4gICAgY29uc3Qgb3B0ID0ge1xuICAgICAgLi4ub1xuICAgIH07XG4gICAgaWYgKGtleSA9PSBudWxsKSByZXR1cm4gZmFsc2U7XG4gICAgY29uc3QgcmVzb2x2ZWQgPSB0aGlzLnJlc29sdmUoa2V5LCBvcHQpO1xuICAgIHJldHVybiByZXNvbHZlZD8ucmVzICE9PSB1bmRlZmluZWQ7XG4gIH1cbiAgZXh0cmFjdEZyb21LZXkoa2V5LCBvcHQpIHtcbiAgICBsZXQgbnNTZXBhcmF0b3IgPSBvcHQubnNTZXBhcmF0b3IgIT09IHVuZGVmaW5lZCA/IG9wdC5uc1NlcGFyYXRvciA6IHRoaXMub3B0aW9ucy5uc1NlcGFyYXRvcjtcbiAgICBpZiAobnNTZXBhcmF0b3IgPT09IHVuZGVmaW5lZCkgbnNTZXBhcmF0b3IgPSAnOic7XG4gICAgY29uc3Qga2V5U2VwYXJhdG9yID0gb3B0LmtleVNlcGFyYXRvciAhPT0gdW5kZWZpbmVkID8gb3B0LmtleVNlcGFyYXRvciA6IHRoaXMub3B0aW9ucy5rZXlTZXBhcmF0b3I7XG4gICAgbGV0IG5hbWVzcGFjZXMgPSBvcHQubnMgfHwgdGhpcy5vcHRpb25zLmRlZmF1bHROUyB8fCBbXTtcbiAgICBjb25zdCB3b3VsZENoZWNrRm9yTnNJbktleSA9IG5zU2VwYXJhdG9yICYmIGtleS5pbmRleE9mKG5zU2VwYXJhdG9yKSA+IC0xO1xuICAgIGNvbnN0IHNlZW1zTmF0dXJhbExhbmd1YWdlID0gIXRoaXMub3B0aW9ucy51c2VyRGVmaW5lZEtleVNlcGFyYXRvciAmJiAhb3B0LmtleVNlcGFyYXRvciAmJiAhdGhpcy5vcHRpb25zLnVzZXJEZWZpbmVkTnNTZXBhcmF0b3IgJiYgIW9wdC5uc1NlcGFyYXRvciAmJiAhbG9va3NMaWtlT2JqZWN0UGF0aChrZXksIG5zU2VwYXJhdG9yLCBrZXlTZXBhcmF0b3IpO1xuICAgIGlmICh3b3VsZENoZWNrRm9yTnNJbktleSAmJiAhc2VlbXNOYXR1cmFsTGFuZ3VhZ2UpIHtcbiAgICAgIGNvbnN0IG0gPSBrZXkubWF0Y2godGhpcy5pbnRlcnBvbGF0b3IubmVzdGluZ1JlZ2V4cCk7XG4gICAgICBpZiAobSAmJiBtLmxlbmd0aCA+IDApIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBrZXksXG4gICAgICAgICAgbmFtZXNwYWNlczogaXNTdHJpbmcobmFtZXNwYWNlcykgPyBbbmFtZXNwYWNlc10gOiBuYW1lc3BhY2VzXG4gICAgICAgIH07XG4gICAgICB9XG4gICAgICBjb25zdCBwYXJ0cyA9IGtleS5zcGxpdChuc1NlcGFyYXRvcik7XG4gICAgICBpZiAobnNTZXBhcmF0b3IgIT09IGtleVNlcGFyYXRvciB8fCBuc1NlcGFyYXRvciA9PT0ga2V5U2VwYXJhdG9yICYmIHRoaXMub3B0aW9ucy5ucy5pbmRleE9mKHBhcnRzWzBdKSA+IC0xKSBuYW1lc3BhY2VzID0gcGFydHMuc2hpZnQoKTtcbiAgICAgIGtleSA9IHBhcnRzLmpvaW4oa2V5U2VwYXJhdG9yKTtcbiAgICB9XG4gICAgcmV0dXJuIHtcbiAgICAgIGtleSxcbiAgICAgIG5hbWVzcGFjZXM6IGlzU3RyaW5nKG5hbWVzcGFjZXMpID8gW25hbWVzcGFjZXNdIDogbmFtZXNwYWNlc1xuICAgIH07XG4gIH1cbiAgdHJhbnNsYXRlKGtleXMsIG8sIGxhc3RLZXkpIHtcbiAgICBsZXQgb3B0ID0gdHlwZW9mIG8gPT09ICdvYmplY3QnID8ge1xuICAgICAgLi4ub1xuICAgIH0gOiBvO1xuICAgIGlmICh0eXBlb2Ygb3B0ICE9PSAnb2JqZWN0JyAmJiB0aGlzLm9wdGlvbnMub3ZlcmxvYWRUcmFuc2xhdGlvbk9wdGlvbkhhbmRsZXIpIHtcbiAgICAgIG9wdCA9IHRoaXMub3B0aW9ucy5vdmVybG9hZFRyYW5zbGF0aW9uT3B0aW9uSGFuZGxlcihhcmd1bWVudHMpO1xuICAgIH1cbiAgICBpZiAodHlwZW9mIG9wdGlvbnMgPT09ICdvYmplY3QnKSBvcHQgPSB7XG4gICAgICAuLi5vcHRcbiAgICB9O1xuICAgIGlmICghb3B0KSBvcHQgPSB7fTtcbiAgICBpZiAoa2V5cyA9PSBudWxsKSByZXR1cm4gJyc7XG4gICAgaWYgKCFBcnJheS5pc0FycmF5KGtleXMpKSBrZXlzID0gW1N0cmluZyhrZXlzKV07XG4gICAgY29uc3QgcmV0dXJuRGV0YWlscyA9IG9wdC5yZXR1cm5EZXRhaWxzICE9PSB1bmRlZmluZWQgPyBvcHQucmV0dXJuRGV0YWlscyA6IHRoaXMub3B0aW9ucy5yZXR1cm5EZXRhaWxzO1xuICAgIGNvbnN0IGtleVNlcGFyYXRvciA9IG9wdC5rZXlTZXBhcmF0b3IgIT09IHVuZGVmaW5lZCA/IG9wdC5rZXlTZXBhcmF0b3IgOiB0aGlzLm9wdGlvbnMua2V5U2VwYXJhdG9yO1xuICAgIGNvbnN0IHtcbiAgICAgIGtleSxcbiAgICAgIG5hbWVzcGFjZXNcbiAgICB9ID0gdGhpcy5leHRyYWN0RnJvbUtleShrZXlzW2tleXMubGVuZ3RoIC0gMV0sIG9wdCk7XG4gICAgY29uc3QgbmFtZXNwYWNlID0gbmFtZXNwYWNlc1tuYW1lc3BhY2VzLmxlbmd0aCAtIDFdO1xuICAgIGxldCBuc1NlcGFyYXRvciA9IG9wdC5uc1NlcGFyYXRvciAhPT0gdW5kZWZpbmVkID8gb3B0Lm5zU2VwYXJhdG9yIDogdGhpcy5vcHRpb25zLm5zU2VwYXJhdG9yO1xuICAgIGlmIChuc1NlcGFyYXRvciA9PT0gdW5kZWZpbmVkKSBuc1NlcGFyYXRvciA9ICc6JztcbiAgICBjb25zdCBsbmcgPSBvcHQubG5nIHx8IHRoaXMubGFuZ3VhZ2U7XG4gICAgY29uc3QgYXBwZW5kTmFtZXNwYWNlVG9DSU1vZGUgPSBvcHQuYXBwZW5kTmFtZXNwYWNlVG9DSU1vZGUgfHwgdGhpcy5vcHRpb25zLmFwcGVuZE5hbWVzcGFjZVRvQ0lNb2RlO1xuICAgIGlmIChsbmc/LnRvTG93ZXJDYXNlKCkgPT09ICdjaW1vZGUnKSB7XG4gICAgICBpZiAoYXBwZW5kTmFtZXNwYWNlVG9DSU1vZGUpIHtcbiAgICAgICAgaWYgKHJldHVybkRldGFpbHMpIHtcbiAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgcmVzOiBgJHtuYW1lc3BhY2V9JHtuc1NlcGFyYXRvcn0ke2tleX1gLFxuICAgICAgICAgICAgdXNlZEtleToga2V5LFxuICAgICAgICAgICAgZXhhY3RVc2VkS2V5OiBrZXksXG4gICAgICAgICAgICB1c2VkTG5nOiBsbmcsXG4gICAgICAgICAgICB1c2VkTlM6IG5hbWVzcGFjZSxcbiAgICAgICAgICAgIHVzZWRQYXJhbXM6IHRoaXMuZ2V0VXNlZFBhcmFtc0RldGFpbHMob3B0KVxuICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGAke25hbWVzcGFjZX0ke25zU2VwYXJhdG9yfSR7a2V5fWA7XG4gICAgICB9XG4gICAgICBpZiAocmV0dXJuRGV0YWlscykge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIHJlczoga2V5LFxuICAgICAgICAgIHVzZWRLZXk6IGtleSxcbiAgICAgICAgICBleGFjdFVzZWRLZXk6IGtleSxcbiAgICAgICAgICB1c2VkTG5nOiBsbmcsXG4gICAgICAgICAgdXNlZE5TOiBuYW1lc3BhY2UsXG4gICAgICAgICAgdXNlZFBhcmFtczogdGhpcy5nZXRVc2VkUGFyYW1zRGV0YWlscyhvcHQpXG4gICAgICAgIH07XG4gICAgICB9XG4gICAgICByZXR1cm4ga2V5O1xuICAgIH1cbiAgICBjb25zdCByZXNvbHZlZCA9IHRoaXMucmVzb2x2ZShrZXlzLCBvcHQpO1xuICAgIGxldCByZXMgPSByZXNvbHZlZD8ucmVzO1xuICAgIGNvbnN0IHJlc1VzZWRLZXkgPSByZXNvbHZlZD8udXNlZEtleSB8fCBrZXk7XG4gICAgY29uc3QgcmVzRXhhY3RVc2VkS2V5ID0gcmVzb2x2ZWQ/LmV4YWN0VXNlZEtleSB8fCBrZXk7XG4gICAgY29uc3Qgbm9PYmplY3QgPSBbJ1tvYmplY3QgTnVtYmVyXScsICdbb2JqZWN0IEZ1bmN0aW9uXScsICdbb2JqZWN0IFJlZ0V4cF0nXTtcbiAgICBjb25zdCBqb2luQXJyYXlzID0gb3B0LmpvaW5BcnJheXMgIT09IHVuZGVmaW5lZCA/IG9wdC5qb2luQXJyYXlzIDogdGhpcy5vcHRpb25zLmpvaW5BcnJheXM7XG4gICAgY29uc3QgaGFuZGxlQXNPYmplY3RJbkkxOG5Gb3JtYXQgPSAhdGhpcy5pMThuRm9ybWF0IHx8IHRoaXMuaTE4bkZvcm1hdC5oYW5kbGVBc09iamVjdDtcbiAgICBjb25zdCBuZWVkc1BsdXJhbEhhbmRsaW5nID0gb3B0LmNvdW50ICE9PSB1bmRlZmluZWQgJiYgIWlzU3RyaW5nKG9wdC5jb3VudCk7XG4gICAgY29uc3QgaGFzRGVmYXVsdFZhbHVlID0gVHJhbnNsYXRvci5oYXNEZWZhdWx0VmFsdWUob3B0KTtcbiAgICBjb25zdCBkZWZhdWx0VmFsdWVTdWZmaXggPSBuZWVkc1BsdXJhbEhhbmRsaW5nID8gdGhpcy5wbHVyYWxSZXNvbHZlci5nZXRTdWZmaXgobG5nLCBvcHQuY291bnQsIG9wdCkgOiAnJztcbiAgICBjb25zdCBkZWZhdWx0VmFsdWVTdWZmaXhPcmRpbmFsRmFsbGJhY2sgPSBvcHQub3JkaW5hbCAmJiBuZWVkc1BsdXJhbEhhbmRsaW5nID8gdGhpcy5wbHVyYWxSZXNvbHZlci5nZXRTdWZmaXgobG5nLCBvcHQuY291bnQsIHtcbiAgICAgIG9yZGluYWw6IGZhbHNlXG4gICAgfSkgOiAnJztcbiAgICBjb25zdCBuZWVkc1plcm9TdWZmaXhMb29rdXAgPSBuZWVkc1BsdXJhbEhhbmRsaW5nICYmICFvcHQub3JkaW5hbCAmJiBvcHQuY291bnQgPT09IDA7XG4gICAgY29uc3QgZGVmYXVsdFZhbHVlID0gbmVlZHNaZXJvU3VmZml4TG9va3VwICYmIG9wdFtgZGVmYXVsdFZhbHVlJHt0aGlzLm9wdGlvbnMucGx1cmFsU2VwYXJhdG9yfXplcm9gXSB8fCBvcHRbYGRlZmF1bHRWYWx1ZSR7ZGVmYXVsdFZhbHVlU3VmZml4fWBdIHx8IG9wdFtgZGVmYXVsdFZhbHVlJHtkZWZhdWx0VmFsdWVTdWZmaXhPcmRpbmFsRmFsbGJhY2t9YF0gfHwgb3B0LmRlZmF1bHRWYWx1ZTtcbiAgICBsZXQgcmVzRm9yT2JqSG5kbCA9IHJlcztcbiAgICBpZiAoaGFuZGxlQXNPYmplY3RJbkkxOG5Gb3JtYXQgJiYgIXJlcyAmJiBoYXNEZWZhdWx0VmFsdWUpIHtcbiAgICAgIHJlc0Zvck9iakhuZGwgPSBkZWZhdWx0VmFsdWU7XG4gICAgfVxuICAgIGNvbnN0IGhhbmRsZUFzT2JqZWN0ID0gc2hvdWxkSGFuZGxlQXNPYmplY3QocmVzRm9yT2JqSG5kbCk7XG4gICAgY29uc3QgcmVzVHlwZSA9IE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmcuYXBwbHkocmVzRm9yT2JqSG5kbCk7XG4gICAgaWYgKGhhbmRsZUFzT2JqZWN0SW5JMThuRm9ybWF0ICYmIHJlc0Zvck9iakhuZGwgJiYgaGFuZGxlQXNPYmplY3QgJiYgbm9PYmplY3QuaW5kZXhPZihyZXNUeXBlKSA8IDAgJiYgIShpc1N0cmluZyhqb2luQXJyYXlzKSAmJiBBcnJheS5pc0FycmF5KHJlc0Zvck9iakhuZGwpKSkge1xuICAgICAgaWYgKCFvcHQucmV0dXJuT2JqZWN0cyAmJiAhdGhpcy5vcHRpb25zLnJldHVybk9iamVjdHMpIHtcbiAgICAgICAgaWYgKCF0aGlzLm9wdGlvbnMucmV0dXJuZWRPYmplY3RIYW5kbGVyKSB7XG4gICAgICAgICAgdGhpcy5sb2dnZXIud2FybignYWNjZXNzaW5nIGFuIG9iamVjdCAtIGJ1dCByZXR1cm5PYmplY3RzIG9wdGlvbnMgaXMgbm90IGVuYWJsZWQhJyk7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgciA9IHRoaXMub3B0aW9ucy5yZXR1cm5lZE9iamVjdEhhbmRsZXIgPyB0aGlzLm9wdGlvbnMucmV0dXJuZWRPYmplY3RIYW5kbGVyKHJlc1VzZWRLZXksIHJlc0Zvck9iakhuZGwsIHtcbiAgICAgICAgICAuLi5vcHQsXG4gICAgICAgICAgbnM6IG5hbWVzcGFjZXNcbiAgICAgICAgfSkgOiBga2V5ICcke2tleX0gKCR7dGhpcy5sYW5ndWFnZX0pJyByZXR1cm5lZCBhbiBvYmplY3QgaW5zdGVhZCBvZiBzdHJpbmcuYDtcbiAgICAgICAgaWYgKHJldHVybkRldGFpbHMpIHtcbiAgICAgICAgICByZXNvbHZlZC5yZXMgPSByO1xuICAgICAgICAgIHJlc29sdmVkLnVzZWRQYXJhbXMgPSB0aGlzLmdldFVzZWRQYXJhbXNEZXRhaWxzKG9wdCk7XG4gICAgICAgICAgcmV0dXJuIHJlc29sdmVkO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiByO1xuICAgICAgfVxuICAgICAgaWYgKGtleVNlcGFyYXRvcikge1xuICAgICAgICBjb25zdCByZXNUeXBlSXNBcnJheSA9IEFycmF5LmlzQXJyYXkocmVzRm9yT2JqSG5kbCk7XG4gICAgICAgIGNvbnN0IGNvcHkgPSByZXNUeXBlSXNBcnJheSA/IFtdIDoge307XG4gICAgICAgIGNvbnN0IG5ld0tleVRvVXNlID0gcmVzVHlwZUlzQXJyYXkgPyByZXNFeGFjdFVzZWRLZXkgOiByZXNVc2VkS2V5O1xuICAgICAgICBmb3IgKGNvbnN0IG0gaW4gcmVzRm9yT2JqSG5kbCkge1xuICAgICAgICAgIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwocmVzRm9yT2JqSG5kbCwgbSkpIHtcbiAgICAgICAgICAgIGNvbnN0IGRlZXBLZXkgPSBgJHtuZXdLZXlUb1VzZX0ke2tleVNlcGFyYXRvcn0ke219YDtcbiAgICAgICAgICAgIGlmIChoYXNEZWZhdWx0VmFsdWUgJiYgIXJlcykge1xuICAgICAgICAgICAgICBjb3B5W21dID0gdGhpcy50cmFuc2xhdGUoZGVlcEtleSwge1xuICAgICAgICAgICAgICAgIC4uLm9wdCxcbiAgICAgICAgICAgICAgICBkZWZhdWx0VmFsdWU6IHNob3VsZEhhbmRsZUFzT2JqZWN0KGRlZmF1bHRWYWx1ZSkgPyBkZWZhdWx0VmFsdWVbbV0gOiB1bmRlZmluZWQsXG4gICAgICAgICAgICAgICAgLi4ue1xuICAgICAgICAgICAgICAgICAgam9pbkFycmF5czogZmFsc2UsXG4gICAgICAgICAgICAgICAgICBuczogbmFtZXNwYWNlc1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICBjb3B5W21dID0gdGhpcy50cmFuc2xhdGUoZGVlcEtleSwge1xuICAgICAgICAgICAgICAgIC4uLm9wdCxcbiAgICAgICAgICAgICAgICAuLi57XG4gICAgICAgICAgICAgICAgICBqb2luQXJyYXlzOiBmYWxzZSxcbiAgICAgICAgICAgICAgICAgIG5zOiBuYW1lc3BhY2VzXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChjb3B5W21dID09PSBkZWVwS2V5KSBjb3B5W21dID0gcmVzRm9yT2JqSG5kbFttXTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmVzID0gY29weTtcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKGhhbmRsZUFzT2JqZWN0SW5JMThuRm9ybWF0ICYmIGlzU3RyaW5nKGpvaW5BcnJheXMpICYmIEFycmF5LmlzQXJyYXkocmVzKSkge1xuICAgICAgcmVzID0gcmVzLmpvaW4oam9pbkFycmF5cyk7XG4gICAgICBpZiAocmVzKSByZXMgPSB0aGlzLmV4dGVuZFRyYW5zbGF0aW9uKHJlcywga2V5cywgb3B0LCBsYXN0S2V5KTtcbiAgICB9IGVsc2Uge1xuICAgICAgbGV0IHVzZWREZWZhdWx0ID0gZmFsc2U7XG4gICAgICBsZXQgdXNlZEtleSA9IGZhbHNlO1xuICAgICAgaWYgKCF0aGlzLmlzVmFsaWRMb29rdXAocmVzKSAmJiBoYXNEZWZhdWx0VmFsdWUpIHtcbiAgICAgICAgdXNlZERlZmF1bHQgPSB0cnVlO1xuICAgICAgICByZXMgPSBkZWZhdWx0VmFsdWU7XG4gICAgICB9XG4gICAgICBpZiAoIXRoaXMuaXNWYWxpZExvb2t1cChyZXMpKSB7XG4gICAgICAgIHVzZWRLZXkgPSB0cnVlO1xuICAgICAgICByZXMgPSBrZXk7XG4gICAgICB9XG4gICAgICBjb25zdCBtaXNzaW5nS2V5Tm9WYWx1ZUZhbGxiYWNrVG9LZXkgPSBvcHQubWlzc2luZ0tleU5vVmFsdWVGYWxsYmFja1RvS2V5IHx8IHRoaXMub3B0aW9ucy5taXNzaW5nS2V5Tm9WYWx1ZUZhbGxiYWNrVG9LZXk7XG4gICAgICBjb25zdCByZXNGb3JNaXNzaW5nID0gbWlzc2luZ0tleU5vVmFsdWVGYWxsYmFja1RvS2V5ICYmIHVzZWRLZXkgPyB1bmRlZmluZWQgOiByZXM7XG4gICAgICBjb25zdCB1cGRhdGVNaXNzaW5nID0gaGFzRGVmYXVsdFZhbHVlICYmIGRlZmF1bHRWYWx1ZSAhPT0gcmVzICYmIHRoaXMub3B0aW9ucy51cGRhdGVNaXNzaW5nO1xuICAgICAgaWYgKHVzZWRLZXkgfHwgdXNlZERlZmF1bHQgfHwgdXBkYXRlTWlzc2luZykge1xuICAgICAgICB0aGlzLmxvZ2dlci5sb2codXBkYXRlTWlzc2luZyA/ICd1cGRhdGVLZXknIDogJ21pc3NpbmdLZXknLCBsbmcsIG5hbWVzcGFjZSwga2V5LCB1cGRhdGVNaXNzaW5nID8gZGVmYXVsdFZhbHVlIDogcmVzKTtcbiAgICAgICAgaWYgKGtleVNlcGFyYXRvcikge1xuICAgICAgICAgIGNvbnN0IGZrID0gdGhpcy5yZXNvbHZlKGtleSwge1xuICAgICAgICAgICAgLi4ub3B0LFxuICAgICAgICAgICAga2V5U2VwYXJhdG9yOiBmYWxzZVxuICAgICAgICAgIH0pO1xuICAgICAgICAgIGlmIChmayAmJiBmay5yZXMpIHRoaXMubG9nZ2VyLndhcm4oJ1NlZW1zIHRoZSBsb2FkZWQgdHJhbnNsYXRpb25zIHdlcmUgaW4gZmxhdCBKU09OIGZvcm1hdCBpbnN0ZWFkIG9mIG5lc3RlZC4gRWl0aGVyIHNldCBrZXlTZXBhcmF0b3I6IGZhbHNlIG9uIGluaXQgb3IgbWFrZSBzdXJlIHlvdXIgdHJhbnNsYXRpb25zIGFyZSBwdWJsaXNoZWQgaW4gbmVzdGVkIGZvcm1hdC4nKTtcbiAgICAgICAgfVxuICAgICAgICBsZXQgbG5ncyA9IFtdO1xuICAgICAgICBjb25zdCBmYWxsYmFja0xuZ3MgPSB0aGlzLmxhbmd1YWdlVXRpbHMuZ2V0RmFsbGJhY2tDb2Rlcyh0aGlzLm9wdGlvbnMuZmFsbGJhY2tMbmcsIG9wdC5sbmcgfHwgdGhpcy5sYW5ndWFnZSk7XG4gICAgICAgIGlmICh0aGlzLm9wdGlvbnMuc2F2ZU1pc3NpbmdUbyA9PT0gJ2ZhbGxiYWNrJyAmJiBmYWxsYmFja0xuZ3MgJiYgZmFsbGJhY2tMbmdzWzBdKSB7XG4gICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBmYWxsYmFja0xuZ3MubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIGxuZ3MucHVzaChmYWxsYmFja0xuZ3NbaV0pO1xuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIGlmICh0aGlzLm9wdGlvbnMuc2F2ZU1pc3NpbmdUbyA9PT0gJ2FsbCcpIHtcbiAgICAgICAgICBsbmdzID0gdGhpcy5sYW5ndWFnZVV0aWxzLnRvUmVzb2x2ZUhpZXJhcmNoeShvcHQubG5nIHx8IHRoaXMubGFuZ3VhZ2UpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGxuZ3MucHVzaChvcHQubG5nIHx8IHRoaXMubGFuZ3VhZ2UpO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IHNlbmQgPSAobCwgaywgc3BlY2lmaWNEZWZhdWx0VmFsdWUpID0+IHtcbiAgICAgICAgICBjb25zdCBkZWZhdWx0Rm9yTWlzc2luZyA9IGhhc0RlZmF1bHRWYWx1ZSAmJiBzcGVjaWZpY0RlZmF1bHRWYWx1ZSAhPT0gcmVzID8gc3BlY2lmaWNEZWZhdWx0VmFsdWUgOiByZXNGb3JNaXNzaW5nO1xuICAgICAgICAgIGlmICh0aGlzLm9wdGlvbnMubWlzc2luZ0tleUhhbmRsZXIpIHtcbiAgICAgICAgICAgIHRoaXMub3B0aW9ucy5taXNzaW5nS2V5SGFuZGxlcihsLCBuYW1lc3BhY2UsIGssIGRlZmF1bHRGb3JNaXNzaW5nLCB1cGRhdGVNaXNzaW5nLCBvcHQpO1xuICAgICAgICAgIH0gZWxzZSBpZiAodGhpcy5iYWNrZW5kQ29ubmVjdG9yPy5zYXZlTWlzc2luZykge1xuICAgICAgICAgICAgdGhpcy5iYWNrZW5kQ29ubmVjdG9yLnNhdmVNaXNzaW5nKGwsIG5hbWVzcGFjZSwgaywgZGVmYXVsdEZvck1pc3NpbmcsIHVwZGF0ZU1pc3NpbmcsIG9wdCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHRoaXMuZW1pdCgnbWlzc2luZ0tleScsIGwsIG5hbWVzcGFjZSwgaywgcmVzKTtcbiAgICAgICAgfTtcbiAgICAgICAgaWYgKHRoaXMub3B0aW9ucy5zYXZlTWlzc2luZykge1xuICAgICAgICAgIGlmICh0aGlzLm9wdGlvbnMuc2F2ZU1pc3NpbmdQbHVyYWxzICYmIG5lZWRzUGx1cmFsSGFuZGxpbmcpIHtcbiAgICAgICAgICAgIGxuZ3MuZm9yRWFjaChsYW5ndWFnZSA9PiB7XG4gICAgICAgICAgICAgIGNvbnN0IHN1ZmZpeGVzID0gdGhpcy5wbHVyYWxSZXNvbHZlci5nZXRTdWZmaXhlcyhsYW5ndWFnZSwgb3B0KTtcbiAgICAgICAgICAgICAgaWYgKG5lZWRzWmVyb1N1ZmZpeExvb2t1cCAmJiBvcHRbYGRlZmF1bHRWYWx1ZSR7dGhpcy5vcHRpb25zLnBsdXJhbFNlcGFyYXRvcn16ZXJvYF0gJiYgc3VmZml4ZXMuaW5kZXhPZihgJHt0aGlzLm9wdGlvbnMucGx1cmFsU2VwYXJhdG9yfXplcm9gKSA8IDApIHtcbiAgICAgICAgICAgICAgICBzdWZmaXhlcy5wdXNoKGAke3RoaXMub3B0aW9ucy5wbHVyYWxTZXBhcmF0b3J9emVyb2ApO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIHN1ZmZpeGVzLmZvckVhY2goc3VmZml4ID0+IHtcbiAgICAgICAgICAgICAgICBzZW5kKFtsYW5ndWFnZV0sIGtleSArIHN1ZmZpeCwgb3B0W2BkZWZhdWx0VmFsdWUke3N1ZmZpeH1gXSB8fCBkZWZhdWx0VmFsdWUpO1xuICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBzZW5kKGxuZ3MsIGtleSwgZGVmYXVsdFZhbHVlKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIHJlcyA9IHRoaXMuZXh0ZW5kVHJhbnNsYXRpb24ocmVzLCBrZXlzLCBvcHQsIHJlc29sdmVkLCBsYXN0S2V5KTtcbiAgICAgIGlmICh1c2VkS2V5ICYmIHJlcyA9PT0ga2V5ICYmIHRoaXMub3B0aW9ucy5hcHBlbmROYW1lc3BhY2VUb01pc3NpbmdLZXkpIHtcbiAgICAgICAgcmVzID0gYCR7bmFtZXNwYWNlfSR7bnNTZXBhcmF0b3J9JHtrZXl9YDtcbiAgICAgIH1cbiAgICAgIGlmICgodXNlZEtleSB8fCB1c2VkRGVmYXVsdCkgJiYgdGhpcy5vcHRpb25zLnBhcnNlTWlzc2luZ0tleUhhbmRsZXIpIHtcbiAgICAgICAgcmVzID0gdGhpcy5vcHRpb25zLnBhcnNlTWlzc2luZ0tleUhhbmRsZXIodGhpcy5vcHRpb25zLmFwcGVuZE5hbWVzcGFjZVRvTWlzc2luZ0tleSA/IGAke25hbWVzcGFjZX0ke25zU2VwYXJhdG9yfSR7a2V5fWAgOiBrZXksIHVzZWREZWZhdWx0ID8gcmVzIDogdW5kZWZpbmVkLCBvcHQpO1xuICAgICAgfVxuICAgIH1cbiAgICBpZiAocmV0dXJuRGV0YWlscykge1xuICAgICAgcmVzb2x2ZWQucmVzID0gcmVzO1xuICAgICAgcmVzb2x2ZWQudXNlZFBhcmFtcyA9IHRoaXMuZ2V0VXNlZFBhcmFtc0RldGFpbHMob3B0KTtcbiAgICAgIHJldHVybiByZXNvbHZlZDtcbiAgICB9XG4gICAgcmV0dXJuIHJlcztcbiAgfVxuICBleHRlbmRUcmFuc2xhdGlvbihyZXMsIGtleSwgb3B0LCByZXNvbHZlZCwgbGFzdEtleSkge1xuICAgIGlmICh0aGlzLmkxOG5Gb3JtYXQ/LnBhcnNlKSB7XG4gICAgICByZXMgPSB0aGlzLmkxOG5Gb3JtYXQucGFyc2UocmVzLCB7XG4gICAgICAgIC4uLnRoaXMub3B0aW9ucy5pbnRlcnBvbGF0aW9uLmRlZmF1bHRWYXJpYWJsZXMsXG4gICAgICAgIC4uLm9wdFxuICAgICAgfSwgb3B0LmxuZyB8fCB0aGlzLmxhbmd1YWdlIHx8IHJlc29sdmVkLnVzZWRMbmcsIHJlc29sdmVkLnVzZWROUywgcmVzb2x2ZWQudXNlZEtleSwge1xuICAgICAgICByZXNvbHZlZFxuICAgICAgfSk7XG4gICAgfSBlbHNlIGlmICghb3B0LnNraXBJbnRlcnBvbGF0aW9uKSB7XG4gICAgICBpZiAob3B0LmludGVycG9sYXRpb24pIHRoaXMuaW50ZXJwb2xhdG9yLmluaXQoe1xuICAgICAgICAuLi5vcHQsXG4gICAgICAgIC4uLntcbiAgICAgICAgICBpbnRlcnBvbGF0aW9uOiB7XG4gICAgICAgICAgICAuLi50aGlzLm9wdGlvbnMuaW50ZXJwb2xhdGlvbixcbiAgICAgICAgICAgIC4uLm9wdC5pbnRlcnBvbGF0aW9uXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KTtcbiAgICAgIGNvbnN0IHNraXBPblZhcmlhYmxlcyA9IGlzU3RyaW5nKHJlcykgJiYgKG9wdD8uaW50ZXJwb2xhdGlvbj8uc2tpcE9uVmFyaWFibGVzICE9PSB1bmRlZmluZWQgPyBvcHQuaW50ZXJwb2xhdGlvbi5za2lwT25WYXJpYWJsZXMgOiB0aGlzLm9wdGlvbnMuaW50ZXJwb2xhdGlvbi5za2lwT25WYXJpYWJsZXMpO1xuICAgICAgbGV0IG5lc3RCZWY7XG4gICAgICBpZiAoc2tpcE9uVmFyaWFibGVzKSB7XG4gICAgICAgIGNvbnN0IG5iID0gcmVzLm1hdGNoKHRoaXMuaW50ZXJwb2xhdG9yLm5lc3RpbmdSZWdleHApO1xuICAgICAgICBuZXN0QmVmID0gbmIgJiYgbmIubGVuZ3RoO1xuICAgICAgfVxuICAgICAgbGV0IGRhdGEgPSBvcHQucmVwbGFjZSAmJiAhaXNTdHJpbmcob3B0LnJlcGxhY2UpID8gb3B0LnJlcGxhY2UgOiBvcHQ7XG4gICAgICBpZiAodGhpcy5vcHRpb25zLmludGVycG9sYXRpb24uZGVmYXVsdFZhcmlhYmxlcykgZGF0YSA9IHtcbiAgICAgICAgLi4udGhpcy5vcHRpb25zLmludGVycG9sYXRpb24uZGVmYXVsdFZhcmlhYmxlcyxcbiAgICAgICAgLi4uZGF0YVxuICAgICAgfTtcbiAgICAgIHJlcyA9IHRoaXMuaW50ZXJwb2xhdG9yLmludGVycG9sYXRlKHJlcywgZGF0YSwgb3B0LmxuZyB8fCB0aGlzLmxhbmd1YWdlIHx8IHJlc29sdmVkLnVzZWRMbmcsIG9wdCk7XG4gICAgICBpZiAoc2tpcE9uVmFyaWFibGVzKSB7XG4gICAgICAgIGNvbnN0IG5hID0gcmVzLm1hdGNoKHRoaXMuaW50ZXJwb2xhdG9yLm5lc3RpbmdSZWdleHApO1xuICAgICAgICBjb25zdCBuZXN0QWZ0ID0gbmEgJiYgbmEubGVuZ3RoO1xuICAgICAgICBpZiAobmVzdEJlZiA8IG5lc3RBZnQpIG9wdC5uZXN0ID0gZmFsc2U7XG4gICAgICB9XG4gICAgICBpZiAoIW9wdC5sbmcgJiYgcmVzb2x2ZWQgJiYgcmVzb2x2ZWQucmVzKSBvcHQubG5nID0gdGhpcy5sYW5ndWFnZSB8fCByZXNvbHZlZC51c2VkTG5nO1xuICAgICAgaWYgKG9wdC5uZXN0ICE9PSBmYWxzZSkgcmVzID0gdGhpcy5pbnRlcnBvbGF0b3IubmVzdChyZXMsICguLi5hcmdzKSA9PiB7XG4gICAgICAgIGlmIChsYXN0S2V5Py5bMF0gPT09IGFyZ3NbMF0gJiYgIW9wdC5jb250ZXh0KSB7XG4gICAgICAgICAgdGhpcy5sb2dnZXIud2FybihgSXQgc2VlbXMgeW91IGFyZSBuZXN0aW5nIHJlY3Vyc2l2ZWx5IGtleTogJHthcmdzWzBdfSBpbiBrZXk6ICR7a2V5WzBdfWApO1xuICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzLnRyYW5zbGF0ZSguLi5hcmdzLCBrZXkpO1xuICAgICAgfSwgb3B0KTtcbiAgICAgIGlmIChvcHQuaW50ZXJwb2xhdGlvbikgdGhpcy5pbnRlcnBvbGF0b3IucmVzZXQoKTtcbiAgICB9XG4gICAgY29uc3QgcG9zdFByb2Nlc3MgPSBvcHQucG9zdFByb2Nlc3MgfHwgdGhpcy5vcHRpb25zLnBvc3RQcm9jZXNzO1xuICAgIGNvbnN0IHBvc3RQcm9jZXNzb3JOYW1lcyA9IGlzU3RyaW5nKHBvc3RQcm9jZXNzKSA/IFtwb3N0UHJvY2Vzc10gOiBwb3N0UHJvY2VzcztcbiAgICBpZiAocmVzICE9IG51bGwgJiYgcG9zdFByb2Nlc3Nvck5hbWVzPy5sZW5ndGggJiYgb3B0LmFwcGx5UG9zdFByb2Nlc3NvciAhPT0gZmFsc2UpIHtcbiAgICAgIHJlcyA9IHBvc3RQcm9jZXNzb3IuaGFuZGxlKHBvc3RQcm9jZXNzb3JOYW1lcywgcmVzLCBrZXksIHRoaXMub3B0aW9ucyAmJiB0aGlzLm9wdGlvbnMucG9zdFByb2Nlc3NQYXNzUmVzb2x2ZWQgPyB7XG4gICAgICAgIGkxOG5SZXNvbHZlZDoge1xuICAgICAgICAgIC4uLnJlc29sdmVkLFxuICAgICAgICAgIHVzZWRQYXJhbXM6IHRoaXMuZ2V0VXNlZFBhcmFtc0RldGFpbHMob3B0KVxuICAgICAgICB9LFxuICAgICAgICAuLi5vcHRcbiAgICAgIH0gOiBvcHQsIHRoaXMpO1xuICAgIH1cbiAgICByZXR1cm4gcmVzO1xuICB9XG4gIHJlc29sdmUoa2V5cywgb3B0ID0ge30pIHtcbiAgICBsZXQgZm91bmQ7XG4gICAgbGV0IHVzZWRLZXk7XG4gICAgbGV0IGV4YWN0VXNlZEtleTtcbiAgICBsZXQgdXNlZExuZztcbiAgICBsZXQgdXNlZE5TO1xuICAgIGlmIChpc1N0cmluZyhrZXlzKSkga2V5cyA9IFtrZXlzXTtcbiAgICBrZXlzLmZvckVhY2goayA9PiB7XG4gICAgICBpZiAodGhpcy5pc1ZhbGlkTG9va3VwKGZvdW5kKSkgcmV0dXJuO1xuICAgICAgY29uc3QgZXh0cmFjdGVkID0gdGhpcy5leHRyYWN0RnJvbUtleShrLCBvcHQpO1xuICAgICAgY29uc3Qga2V5ID0gZXh0cmFjdGVkLmtleTtcbiAgICAgIHVzZWRLZXkgPSBrZXk7XG4gICAgICBsZXQgbmFtZXNwYWNlcyA9IGV4dHJhY3RlZC5uYW1lc3BhY2VzO1xuICAgICAgaWYgKHRoaXMub3B0aW9ucy5mYWxsYmFja05TKSBuYW1lc3BhY2VzID0gbmFtZXNwYWNlcy5jb25jYXQodGhpcy5vcHRpb25zLmZhbGxiYWNrTlMpO1xuICAgICAgY29uc3QgbmVlZHNQbHVyYWxIYW5kbGluZyA9IG9wdC5jb3VudCAhPT0gdW5kZWZpbmVkICYmICFpc1N0cmluZyhvcHQuY291bnQpO1xuICAgICAgY29uc3QgbmVlZHNaZXJvU3VmZml4TG9va3VwID0gbmVlZHNQbHVyYWxIYW5kbGluZyAmJiAhb3B0Lm9yZGluYWwgJiYgb3B0LmNvdW50ID09PSAwO1xuICAgICAgY29uc3QgbmVlZHNDb250ZXh0SGFuZGxpbmcgPSBvcHQuY29udGV4dCAhPT0gdW5kZWZpbmVkICYmIChpc1N0cmluZyhvcHQuY29udGV4dCkgfHwgdHlwZW9mIG9wdC5jb250ZXh0ID09PSAnbnVtYmVyJykgJiYgb3B0LmNvbnRleHQgIT09ICcnO1xuICAgICAgY29uc3QgY29kZXMgPSBvcHQubG5ncyA/IG9wdC5sbmdzIDogdGhpcy5sYW5ndWFnZVV0aWxzLnRvUmVzb2x2ZUhpZXJhcmNoeShvcHQubG5nIHx8IHRoaXMubGFuZ3VhZ2UsIG9wdC5mYWxsYmFja0xuZyk7XG4gICAgICBuYW1lc3BhY2VzLmZvckVhY2gobnMgPT4ge1xuICAgICAgICBpZiAodGhpcy5pc1ZhbGlkTG9va3VwKGZvdW5kKSkgcmV0dXJuO1xuICAgICAgICB1c2VkTlMgPSBucztcbiAgICAgICAgaWYgKCFjaGVja2VkTG9hZGVkRm9yW2Ake2NvZGVzWzBdfS0ke25zfWBdICYmIHRoaXMudXRpbHM/Lmhhc0xvYWRlZE5hbWVzcGFjZSAmJiAhdGhpcy51dGlscz8uaGFzTG9hZGVkTmFtZXNwYWNlKHVzZWROUykpIHtcbiAgICAgICAgICBjaGVja2VkTG9hZGVkRm9yW2Ake2NvZGVzWzBdfS0ke25zfWBdID0gdHJ1ZTtcbiAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKGBrZXkgXCIke3VzZWRLZXl9XCIgZm9yIGxhbmd1YWdlcyBcIiR7Y29kZXMuam9pbignLCAnKX1cIiB3b24ndCBnZXQgcmVzb2x2ZWQgYXMgbmFtZXNwYWNlIFwiJHt1c2VkTlN9XCIgd2FzIG5vdCB5ZXQgbG9hZGVkYCwgJ1RoaXMgbWVhbnMgc29tZXRoaW5nIElTIFdST05HIGluIHlvdXIgc2V0dXAuIFlvdSBhY2Nlc3MgdGhlIHQgZnVuY3Rpb24gYmVmb3JlIGkxOG5leHQuaW5pdCAvIGkxOG5leHQubG9hZE5hbWVzcGFjZSAvIGkxOG5leHQuY2hhbmdlTGFuZ3VhZ2Ugd2FzIGRvbmUuIFdhaXQgZm9yIHRoZSBjYWxsYmFjayBvciBQcm9taXNlIHRvIHJlc29sdmUgYmVmb3JlIGFjY2Vzc2luZyBpdCEhIScpO1xuICAgICAgICB9XG4gICAgICAgIGNvZGVzLmZvckVhY2goY29kZSA9PiB7XG4gICAgICAgICAgaWYgKHRoaXMuaXNWYWxpZExvb2t1cChmb3VuZCkpIHJldHVybjtcbiAgICAgICAgICB1c2VkTG5nID0gY29kZTtcbiAgICAgICAgICBjb25zdCBmaW5hbEtleXMgPSBba2V5XTtcbiAgICAgICAgICBpZiAodGhpcy5pMThuRm9ybWF0Py5hZGRMb29rdXBLZXlzKSB7XG4gICAgICAgICAgICB0aGlzLmkxOG5Gb3JtYXQuYWRkTG9va3VwS2V5cyhmaW5hbEtleXMsIGtleSwgY29kZSwgbnMsIG9wdCk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGxldCBwbHVyYWxTdWZmaXg7XG4gICAgICAgICAgICBpZiAobmVlZHNQbHVyYWxIYW5kbGluZykgcGx1cmFsU3VmZml4ID0gdGhpcy5wbHVyYWxSZXNvbHZlci5nZXRTdWZmaXgoY29kZSwgb3B0LmNvdW50LCBvcHQpO1xuICAgICAgICAgICAgY29uc3QgemVyb1N1ZmZpeCA9IGAke3RoaXMub3B0aW9ucy5wbHVyYWxTZXBhcmF0b3J9emVyb2A7XG4gICAgICAgICAgICBjb25zdCBvcmRpbmFsUHJlZml4ID0gYCR7dGhpcy5vcHRpb25zLnBsdXJhbFNlcGFyYXRvcn1vcmRpbmFsJHt0aGlzLm9wdGlvbnMucGx1cmFsU2VwYXJhdG9yfWA7XG4gICAgICAgICAgICBpZiAobmVlZHNQbHVyYWxIYW5kbGluZykge1xuICAgICAgICAgICAgICBmaW5hbEtleXMucHVzaChrZXkgKyBwbHVyYWxTdWZmaXgpO1xuICAgICAgICAgICAgICBpZiAob3B0Lm9yZGluYWwgJiYgcGx1cmFsU3VmZml4LmluZGV4T2Yob3JkaW5hbFByZWZpeCkgPT09IDApIHtcbiAgICAgICAgICAgICAgICBmaW5hbEtleXMucHVzaChrZXkgKyBwbHVyYWxTdWZmaXgucmVwbGFjZShvcmRpbmFsUHJlZml4LCB0aGlzLm9wdGlvbnMucGx1cmFsU2VwYXJhdG9yKSk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgaWYgKG5lZWRzWmVyb1N1ZmZpeExvb2t1cCkge1xuICAgICAgICAgICAgICAgIGZpbmFsS2V5cy5wdXNoKGtleSArIHplcm9TdWZmaXgpO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAobmVlZHNDb250ZXh0SGFuZGxpbmcpIHtcbiAgICAgICAgICAgICAgY29uc3QgY29udGV4dEtleSA9IGAke2tleX0ke3RoaXMub3B0aW9ucy5jb250ZXh0U2VwYXJhdG9yfSR7b3B0LmNvbnRleHR9YDtcbiAgICAgICAgICAgICAgZmluYWxLZXlzLnB1c2goY29udGV4dEtleSk7XG4gICAgICAgICAgICAgIGlmIChuZWVkc1BsdXJhbEhhbmRsaW5nKSB7XG4gICAgICAgICAgICAgICAgZmluYWxLZXlzLnB1c2goY29udGV4dEtleSArIHBsdXJhbFN1ZmZpeCk7XG4gICAgICAgICAgICAgICAgaWYgKG9wdC5vcmRpbmFsICYmIHBsdXJhbFN1ZmZpeC5pbmRleE9mKG9yZGluYWxQcmVmaXgpID09PSAwKSB7XG4gICAgICAgICAgICAgICAgICBmaW5hbEtleXMucHVzaChjb250ZXh0S2V5ICsgcGx1cmFsU3VmZml4LnJlcGxhY2Uob3JkaW5hbFByZWZpeCwgdGhpcy5vcHRpb25zLnBsdXJhbFNlcGFyYXRvcikpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAobmVlZHNaZXJvU3VmZml4TG9va3VwKSB7XG4gICAgICAgICAgICAgICAgICBmaW5hbEtleXMucHVzaChjb250ZXh0S2V5ICsgemVyb1N1ZmZpeCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICAgIGxldCBwb3NzaWJsZUtleTtcbiAgICAgICAgICB3aGlsZSAocG9zc2libGVLZXkgPSBmaW5hbEtleXMucG9wKCkpIHtcbiAgICAgICAgICAgIGlmICghdGhpcy5pc1ZhbGlkTG9va3VwKGZvdW5kKSkge1xuICAgICAgICAgICAgICBleGFjdFVzZWRLZXkgPSBwb3NzaWJsZUtleTtcbiAgICAgICAgICAgICAgZm91bmQgPSB0aGlzLmdldFJlc291cmNlKGNvZGUsIG5zLCBwb3NzaWJsZUtleSwgb3B0KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gICAgfSk7XG4gICAgcmV0dXJuIHtcbiAgICAgIHJlczogZm91bmQsXG4gICAgICB1c2VkS2V5LFxuICAgICAgZXhhY3RVc2VkS2V5LFxuICAgICAgdXNlZExuZyxcbiAgICAgIHVzZWROU1xuICAgIH07XG4gIH1cbiAgaXNWYWxpZExvb2t1cChyZXMpIHtcbiAgICByZXR1cm4gcmVzICE9PSB1bmRlZmluZWQgJiYgISghdGhpcy5vcHRpb25zLnJldHVybk51bGwgJiYgcmVzID09PSBudWxsKSAmJiAhKCF0aGlzLm9wdGlvbnMucmV0dXJuRW1wdHlTdHJpbmcgJiYgcmVzID09PSAnJyk7XG4gIH1cbiAgZ2V0UmVzb3VyY2UoY29kZSwgbnMsIGtleSwgb3B0aW9ucyA9IHt9KSB7XG4gICAgaWYgKHRoaXMuaTE4bkZvcm1hdD8uZ2V0UmVzb3VyY2UpIHJldHVybiB0aGlzLmkxOG5Gb3JtYXQuZ2V0UmVzb3VyY2UoY29kZSwgbnMsIGtleSwgb3B0aW9ucyk7XG4gICAgcmV0dXJuIHRoaXMucmVzb3VyY2VTdG9yZS5nZXRSZXNvdXJjZShjb2RlLCBucywga2V5LCBvcHRpb25zKTtcbiAgfVxuICBnZXRVc2VkUGFyYW1zRGV0YWlscyhvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBvcHRpb25zS2V5cyA9IFsnZGVmYXVsdFZhbHVlJywgJ29yZGluYWwnLCAnY29udGV4dCcsICdyZXBsYWNlJywgJ2xuZycsICdsbmdzJywgJ2ZhbGxiYWNrTG5nJywgJ25zJywgJ2tleVNlcGFyYXRvcicsICduc1NlcGFyYXRvcicsICdyZXR1cm5PYmplY3RzJywgJ3JldHVybkRldGFpbHMnLCAnam9pbkFycmF5cycsICdwb3N0UHJvY2VzcycsICdpbnRlcnBvbGF0aW9uJ107XG4gICAgY29uc3QgdXNlT3B0aW9uc1JlcGxhY2VGb3JEYXRhID0gb3B0aW9ucy5yZXBsYWNlICYmICFpc1N0cmluZyhvcHRpb25zLnJlcGxhY2UpO1xuICAgIGxldCBkYXRhID0gdXNlT3B0aW9uc1JlcGxhY2VGb3JEYXRhID8gb3B0aW9ucy5yZXBsYWNlIDogb3B0aW9ucztcbiAgICBpZiAodXNlT3B0aW9uc1JlcGxhY2VGb3JEYXRhICYmIHR5cGVvZiBvcHRpb25zLmNvdW50ICE9PSAndW5kZWZpbmVkJykge1xuICAgICAgZGF0YS5jb3VudCA9IG9wdGlvbnMuY291bnQ7XG4gICAgfVxuICAgIGlmICh0aGlzLm9wdGlvbnMuaW50ZXJwb2xhdGlvbi5kZWZhdWx0VmFyaWFibGVzKSB7XG4gICAgICBkYXRhID0ge1xuICAgICAgICAuLi50aGlzLm9wdGlvbnMuaW50ZXJwb2xhdGlvbi5kZWZhdWx0VmFyaWFibGVzLFxuICAgICAgICAuLi5kYXRhXG4gICAgICB9O1xuICAgIH1cbiAgICBpZiAoIXVzZU9wdGlvbnNSZXBsYWNlRm9yRGF0YSkge1xuICAgICAgZGF0YSA9IHtcbiAgICAgICAgLi4uZGF0YVxuICAgICAgfTtcbiAgICAgIGZvciAoY29uc3Qga2V5IG9mIG9wdGlvbnNLZXlzKSB7XG4gICAgICAgIGRlbGV0ZSBkYXRhW2tleV07XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBkYXRhO1xuICB9XG4gIHN0YXRpYyBoYXNEZWZhdWx0VmFsdWUob3B0aW9ucykge1xuICAgIGNvbnN0IHByZWZpeCA9ICdkZWZhdWx0VmFsdWUnO1xuICAgIGZvciAoY29uc3Qgb3B0aW9uIGluIG9wdGlvbnMpIHtcbiAgICAgIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwob3B0aW9ucywgb3B0aW9uKSAmJiBwcmVmaXggPT09IG9wdGlvbi5zdWJzdHJpbmcoMCwgcHJlZml4Lmxlbmd0aCkgJiYgdW5kZWZpbmVkICE9PSBvcHRpb25zW29wdGlvbl0pIHtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBmYWxzZTtcbiAgfVxufVxuXG5jbGFzcyBMYW5ndWFnZVV0aWwge1xuICBjb25zdHJ1Y3RvcihvcHRpb25zKSB7XG4gICAgdGhpcy5vcHRpb25zID0gb3B0aW9ucztcbiAgICB0aGlzLnN1cHBvcnRlZExuZ3MgPSB0aGlzLm9wdGlvbnMuc3VwcG9ydGVkTG5ncyB8fCBmYWxzZTtcbiAgICB0aGlzLmxvZ2dlciA9IGJhc2VMb2dnZXIuY3JlYXRlKCdsYW5ndWFnZVV0aWxzJyk7XG4gIH1cbiAgZ2V0U2NyaXB0UGFydEZyb21Db2RlKGNvZGUpIHtcbiAgICBjb2RlID0gZ2V0Q2xlYW5lZENvZGUoY29kZSk7XG4gICAgaWYgKCFjb2RlIHx8IGNvZGUuaW5kZXhPZignLScpIDwgMCkgcmV0dXJuIG51bGw7XG4gICAgY29uc3QgcCA9IGNvZGUuc3BsaXQoJy0nKTtcbiAgICBpZiAocC5sZW5ndGggPT09IDIpIHJldHVybiBudWxsO1xuICAgIHAucG9wKCk7XG4gICAgaWYgKHBbcC5sZW5ndGggLSAxXS50b0xvd2VyQ2FzZSgpID09PSAneCcpIHJldHVybiBudWxsO1xuICAgIHJldHVybiB0aGlzLmZvcm1hdExhbmd1YWdlQ29kZShwLmpvaW4oJy0nKSk7XG4gIH1cbiAgZ2V0TGFuZ3VhZ2VQYXJ0RnJvbUNvZGUoY29kZSkge1xuICAgIGNvZGUgPSBnZXRDbGVhbmVkQ29kZShjb2RlKTtcbiAgICBpZiAoIWNvZGUgfHwgY29kZS5pbmRleE9mKCctJykgPCAwKSByZXR1cm4gY29kZTtcbiAgICBjb25zdCBwID0gY29kZS5zcGxpdCgnLScpO1xuICAgIHJldHVybiB0aGlzLmZvcm1hdExhbmd1YWdlQ29kZShwWzBdKTtcbiAgfVxuICBmb3JtYXRMYW5ndWFnZUNvZGUoY29kZSkge1xuICAgIGlmIChpc1N0cmluZyhjb2RlKSAmJiBjb2RlLmluZGV4T2YoJy0nKSA+IC0xKSB7XG4gICAgICBsZXQgZm9ybWF0dGVkQ29kZTtcbiAgICAgIHRyeSB7XG4gICAgICAgIGZvcm1hdHRlZENvZGUgPSBJbnRsLmdldENhbm9uaWNhbExvY2FsZXMoY29kZSlbMF07XG4gICAgICB9IGNhdGNoIChlKSB7fVxuICAgICAgaWYgKGZvcm1hdHRlZENvZGUgJiYgdGhpcy5vcHRpb25zLmxvd2VyQ2FzZUxuZykge1xuICAgICAgICBmb3JtYXR0ZWRDb2RlID0gZm9ybWF0dGVkQ29kZS50b0xvd2VyQ2FzZSgpO1xuICAgICAgfVxuICAgICAgaWYgKGZvcm1hdHRlZENvZGUpIHJldHVybiBmb3JtYXR0ZWRDb2RlO1xuICAgICAgaWYgKHRoaXMub3B0aW9ucy5sb3dlckNhc2VMbmcpIHtcbiAgICAgICAgcmV0dXJuIGNvZGUudG9Mb3dlckNhc2UoKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBjb2RlO1xuICAgIH1cbiAgICByZXR1cm4gdGhpcy5vcHRpb25zLmNsZWFuQ29kZSB8fCB0aGlzLm9wdGlvbnMubG93ZXJDYXNlTG5nID8gY29kZS50b0xvd2VyQ2FzZSgpIDogY29kZTtcbiAgfVxuICBpc1N1cHBvcnRlZENvZGUoY29kZSkge1xuICAgIGlmICh0aGlzLm9wdGlvbnMubG9hZCA9PT0gJ2xhbmd1YWdlT25seScgfHwgdGhpcy5vcHRpb25zLm5vbkV4cGxpY2l0U3VwcG9ydGVkTG5ncykge1xuICAgICAgY29kZSA9IHRoaXMuZ2V0TGFuZ3VhZ2VQYXJ0RnJvbUNvZGUoY29kZSk7XG4gICAgfVxuICAgIHJldHVybiAhdGhpcy5zdXBwb3J0ZWRMbmdzIHx8ICF0aGlzLnN1cHBvcnRlZExuZ3MubGVuZ3RoIHx8IHRoaXMuc3VwcG9ydGVkTG5ncy5pbmRleE9mKGNvZGUpID4gLTE7XG4gIH1cbiAgZ2V0QmVzdE1hdGNoRnJvbUNvZGVzKGNvZGVzKSB7XG4gICAgaWYgKCFjb2RlcykgcmV0dXJuIG51bGw7XG4gICAgbGV0IGZvdW5kO1xuICAgIGNvZGVzLmZvckVhY2goY29kZSA9PiB7XG4gICAgICBpZiAoZm91bmQpIHJldHVybjtcbiAgICAgIGNvbnN0IGNsZWFuZWRMbmcgPSB0aGlzLmZvcm1hdExhbmd1YWdlQ29kZShjb2RlKTtcbiAgICAgIGlmICghdGhpcy5vcHRpb25zLnN1cHBvcnRlZExuZ3MgfHwgdGhpcy5pc1N1cHBvcnRlZENvZGUoY2xlYW5lZExuZykpIGZvdW5kID0gY2xlYW5lZExuZztcbiAgICB9KTtcbiAgICBpZiAoIWZvdW5kICYmIHRoaXMub3B0aW9ucy5zdXBwb3J0ZWRMbmdzKSB7XG4gICAgICBjb2Rlcy5mb3JFYWNoKGNvZGUgPT4ge1xuICAgICAgICBpZiAoZm91bmQpIHJldHVybjtcbiAgICAgICAgY29uc3QgbG5nU2NPbmx5ID0gdGhpcy5nZXRTY3JpcHRQYXJ0RnJvbUNvZGUoY29kZSk7XG4gICAgICAgIGlmICh0aGlzLmlzU3VwcG9ydGVkQ29kZShsbmdTY09ubHkpKSByZXR1cm4gZm91bmQgPSBsbmdTY09ubHk7XG4gICAgICAgIGNvbnN0IGxuZ09ubHkgPSB0aGlzLmdldExhbmd1YWdlUGFydEZyb21Db2RlKGNvZGUpO1xuICAgICAgICBpZiAodGhpcy5pc1N1cHBvcnRlZENvZGUobG5nT25seSkpIHJldHVybiBmb3VuZCA9IGxuZ09ubHk7XG4gICAgICAgIGZvdW5kID0gdGhpcy5vcHRpb25zLnN1cHBvcnRlZExuZ3MuZmluZChzdXBwb3J0ZWRMbmcgPT4ge1xuICAgICAgICAgIGlmIChzdXBwb3J0ZWRMbmcgPT09IGxuZ09ubHkpIHJldHVybiBzdXBwb3J0ZWRMbmc7XG4gICAgICAgICAgaWYgKHN1cHBvcnRlZExuZy5pbmRleE9mKCctJykgPCAwICYmIGxuZ09ubHkuaW5kZXhPZignLScpIDwgMCkgcmV0dXJuO1xuICAgICAgICAgIGlmIChzdXBwb3J0ZWRMbmcuaW5kZXhPZignLScpID4gMCAmJiBsbmdPbmx5LmluZGV4T2YoJy0nKSA8IDAgJiYgc3VwcG9ydGVkTG5nLnN1YnN0cmluZygwLCBzdXBwb3J0ZWRMbmcuaW5kZXhPZignLScpKSA9PT0gbG5nT25seSkgcmV0dXJuIHN1cHBvcnRlZExuZztcbiAgICAgICAgICBpZiAoc3VwcG9ydGVkTG5nLmluZGV4T2YobG5nT25seSkgPT09IDAgJiYgbG5nT25seS5sZW5ndGggPiAxKSByZXR1cm4gc3VwcG9ydGVkTG5nO1xuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgIH1cbiAgICBpZiAoIWZvdW5kKSBmb3VuZCA9IHRoaXMuZ2V0RmFsbGJhY2tDb2Rlcyh0aGlzLm9wdGlvbnMuZmFsbGJhY2tMbmcpWzBdO1xuICAgIHJldHVybiBmb3VuZDtcbiAgfVxuICBnZXRGYWxsYmFja0NvZGVzKGZhbGxiYWNrcywgY29kZSkge1xuICAgIGlmICghZmFsbGJhY2tzKSByZXR1cm4gW107XG4gICAgaWYgKHR5cGVvZiBmYWxsYmFja3MgPT09ICdmdW5jdGlvbicpIGZhbGxiYWNrcyA9IGZhbGxiYWNrcyhjb2RlKTtcbiAgICBpZiAoaXNTdHJpbmcoZmFsbGJhY2tzKSkgZmFsbGJhY2tzID0gW2ZhbGxiYWNrc107XG4gICAgaWYgKEFycmF5LmlzQXJyYXkoZmFsbGJhY2tzKSkgcmV0dXJuIGZhbGxiYWNrcztcbiAgICBpZiAoIWNvZGUpIHJldHVybiBmYWxsYmFja3MuZGVmYXVsdCB8fCBbXTtcbiAgICBsZXQgZm91bmQgPSBmYWxsYmFja3NbY29kZV07XG4gICAgaWYgKCFmb3VuZCkgZm91bmQgPSBmYWxsYmFja3NbdGhpcy5nZXRTY3JpcHRQYXJ0RnJvbUNvZGUoY29kZSldO1xuICAgIGlmICghZm91bmQpIGZvdW5kID0gZmFsbGJhY2tzW3RoaXMuZm9ybWF0TGFuZ3VhZ2VDb2RlKGNvZGUpXTtcbiAgICBpZiAoIWZvdW5kKSBmb3VuZCA9IGZhbGxiYWNrc1t0aGlzLmdldExhbmd1YWdlUGFydEZyb21Db2RlKGNvZGUpXTtcbiAgICBpZiAoIWZvdW5kKSBmb3VuZCA9IGZhbGxiYWNrcy5kZWZhdWx0O1xuICAgIHJldHVybiBmb3VuZCB8fCBbXTtcbiAgfVxuICB0b1Jlc29sdmVIaWVyYXJjaHkoY29kZSwgZmFsbGJhY2tDb2RlKSB7XG4gICAgY29uc3QgZmFsbGJhY2tDb2RlcyA9IHRoaXMuZ2V0RmFsbGJhY2tDb2RlcygoZmFsbGJhY2tDb2RlID09PSBmYWxzZSA/IFtdIDogZmFsbGJhY2tDb2RlKSB8fCB0aGlzLm9wdGlvbnMuZmFsbGJhY2tMbmcgfHwgW10sIGNvZGUpO1xuICAgIGNvbnN0IGNvZGVzID0gW107XG4gICAgY29uc3QgYWRkQ29kZSA9IGMgPT4ge1xuICAgICAgaWYgKCFjKSByZXR1cm47XG4gICAgICBpZiAodGhpcy5pc1N1cHBvcnRlZENvZGUoYykpIHtcbiAgICAgICAgY29kZXMucHVzaChjKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLndhcm4oYHJlamVjdGluZyBsYW5ndWFnZSBjb2RlIG5vdCBmb3VuZCBpbiBzdXBwb3J0ZWRMbmdzOiAke2N9YCk7XG4gICAgICB9XG4gICAgfTtcbiAgICBpZiAoaXNTdHJpbmcoY29kZSkgJiYgKGNvZGUuaW5kZXhPZignLScpID4gLTEgfHwgY29kZS5pbmRleE9mKCdfJykgPiAtMSkpIHtcbiAgICAgIGlmICh0aGlzLm9wdGlvbnMubG9hZCAhPT0gJ2xhbmd1YWdlT25seScpIGFkZENvZGUodGhpcy5mb3JtYXRMYW5ndWFnZUNvZGUoY29kZSkpO1xuICAgICAgaWYgKHRoaXMub3B0aW9ucy5sb2FkICE9PSAnbGFuZ3VhZ2VPbmx5JyAmJiB0aGlzLm9wdGlvbnMubG9hZCAhPT0gJ2N1cnJlbnRPbmx5JykgYWRkQ29kZSh0aGlzLmdldFNjcmlwdFBhcnRGcm9tQ29kZShjb2RlKSk7XG4gICAgICBpZiAodGhpcy5vcHRpb25zLmxvYWQgIT09ICdjdXJyZW50T25seScpIGFkZENvZGUodGhpcy5nZXRMYW5ndWFnZVBhcnRGcm9tQ29kZShjb2RlKSk7XG4gICAgfSBlbHNlIGlmIChpc1N0cmluZyhjb2RlKSkge1xuICAgICAgYWRkQ29kZSh0aGlzLmZvcm1hdExhbmd1YWdlQ29kZShjb2RlKSk7XG4gICAgfVxuICAgIGZhbGxiYWNrQ29kZXMuZm9yRWFjaChmYyA9PiB7XG4gICAgICBpZiAoY29kZXMuaW5kZXhPZihmYykgPCAwKSBhZGRDb2RlKHRoaXMuZm9ybWF0TGFuZ3VhZ2VDb2RlKGZjKSk7XG4gICAgfSk7XG4gICAgcmV0dXJuIGNvZGVzO1xuICB9XG59XG5cbmNvbnN0IHN1ZmZpeGVzT3JkZXIgPSB7XG4gIHplcm86IDAsXG4gIG9uZTogMSxcbiAgdHdvOiAyLFxuICBmZXc6IDMsXG4gIG1hbnk6IDQsXG4gIG90aGVyOiA1XG59O1xuY29uc3QgZHVtbXlSdWxlID0ge1xuICBzZWxlY3Q6IGNvdW50ID0+IGNvdW50ID09PSAxID8gJ29uZScgOiAnb3RoZXInLFxuICByZXNvbHZlZE9wdGlvbnM6ICgpID0+ICh7XG4gICAgcGx1cmFsQ2F0ZWdvcmllczogWydvbmUnLCAnb3RoZXInXVxuICB9KVxufTtcbmNsYXNzIFBsdXJhbFJlc29sdmVyIHtcbiAgY29uc3RydWN0b3IobGFuZ3VhZ2VVdGlscywgb3B0aW9ucyA9IHt9KSB7XG4gICAgdGhpcy5sYW5ndWFnZVV0aWxzID0gbGFuZ3VhZ2VVdGlscztcbiAgICB0aGlzLm9wdGlvbnMgPSBvcHRpb25zO1xuICAgIHRoaXMubG9nZ2VyID0gYmFzZUxvZ2dlci5jcmVhdGUoJ3BsdXJhbFJlc29sdmVyJyk7XG4gICAgdGhpcy5wbHVyYWxSdWxlc0NhY2hlID0ge307XG4gIH1cbiAgYWRkUnVsZShsbmcsIG9iaikge1xuICAgIHRoaXMucnVsZXNbbG5nXSA9IG9iajtcbiAgfVxuICBjbGVhckNhY2hlKCkge1xuICAgIHRoaXMucGx1cmFsUnVsZXNDYWNoZSA9IHt9O1xuICB9XG4gIGdldFJ1bGUoY29kZSwgb3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3QgY2xlYW5lZENvZGUgPSBnZXRDbGVhbmVkQ29kZShjb2RlID09PSAnZGV2JyA/ICdlbicgOiBjb2RlKTtcbiAgICBjb25zdCB0eXBlID0gb3B0aW9ucy5vcmRpbmFsID8gJ29yZGluYWwnIDogJ2NhcmRpbmFsJztcbiAgICBjb25zdCBjYWNoZUtleSA9IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgIGNsZWFuZWRDb2RlLFxuICAgICAgdHlwZVxuICAgIH0pO1xuICAgIGlmIChjYWNoZUtleSBpbiB0aGlzLnBsdXJhbFJ1bGVzQ2FjaGUpIHtcbiAgICAgIHJldHVybiB0aGlzLnBsdXJhbFJ1bGVzQ2FjaGVbY2FjaGVLZXldO1xuICAgIH1cbiAgICBsZXQgcnVsZTtcbiAgICB0cnkge1xuICAgICAgcnVsZSA9IG5ldyBJbnRsLlBsdXJhbFJ1bGVzKGNsZWFuZWRDb2RlLCB7XG4gICAgICAgIHR5cGVcbiAgICAgIH0pO1xuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgaWYgKCFJbnRsKSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKCdObyBJbnRsIHN1cHBvcnQsIHBsZWFzZSB1c2UgYW4gSW50bCBwb2x5ZmlsbCEnKTtcbiAgICAgICAgcmV0dXJuIGR1bW15UnVsZTtcbiAgICAgIH1cbiAgICAgIGlmICghY29kZS5tYXRjaCgvLXxfLykpIHJldHVybiBkdW1teVJ1bGU7XG4gICAgICBjb25zdCBsbmdQYXJ0ID0gdGhpcy5sYW5ndWFnZVV0aWxzLmdldExhbmd1YWdlUGFydEZyb21Db2RlKGNvZGUpO1xuICAgICAgcnVsZSA9IHRoaXMuZ2V0UnVsZShsbmdQYXJ0LCBvcHRpb25zKTtcbiAgICB9XG4gICAgdGhpcy5wbHVyYWxSdWxlc0NhY2hlW2NhY2hlS2V5XSA9IHJ1bGU7XG4gICAgcmV0dXJuIHJ1bGU7XG4gIH1cbiAgbmVlZHNQbHVyYWwoY29kZSwgb3B0aW9ucyA9IHt9KSB7XG4gICAgbGV0IHJ1bGUgPSB0aGlzLmdldFJ1bGUoY29kZSwgb3B0aW9ucyk7XG4gICAgaWYgKCFydWxlKSBydWxlID0gdGhpcy5nZXRSdWxlKCdkZXYnLCBvcHRpb25zKTtcbiAgICByZXR1cm4gcnVsZT8ucmVzb2x2ZWRPcHRpb25zKCkucGx1cmFsQ2F0ZWdvcmllcy5sZW5ndGggPiAxO1xuICB9XG4gIGdldFBsdXJhbEZvcm1zT2ZLZXkoY29kZSwga2V5LCBvcHRpb25zID0ge30pIHtcbiAgICByZXR1cm4gdGhpcy5nZXRTdWZmaXhlcyhjb2RlLCBvcHRpb25zKS5tYXAoc3VmZml4ID0+IGAke2tleX0ke3N1ZmZpeH1gKTtcbiAgfVxuICBnZXRTdWZmaXhlcyhjb2RlLCBvcHRpb25zID0ge30pIHtcbiAgICBsZXQgcnVsZSA9IHRoaXMuZ2V0UnVsZShjb2RlLCBvcHRpb25zKTtcbiAgICBpZiAoIXJ1bGUpIHJ1bGUgPSB0aGlzLmdldFJ1bGUoJ2RldicsIG9wdGlvbnMpO1xuICAgIGlmICghcnVsZSkgcmV0dXJuIFtdO1xuICAgIHJldHVybiBydWxlLnJlc29sdmVkT3B0aW9ucygpLnBsdXJhbENhdGVnb3JpZXMuc29ydCgocGx1cmFsQ2F0ZWdvcnkxLCBwbHVyYWxDYXRlZ29yeTIpID0+IHN1ZmZpeGVzT3JkZXJbcGx1cmFsQ2F0ZWdvcnkxXSAtIHN1ZmZpeGVzT3JkZXJbcGx1cmFsQ2F0ZWdvcnkyXSkubWFwKHBsdXJhbENhdGVnb3J5ID0+IGAke3RoaXMub3B0aW9ucy5wcmVwZW5kfSR7b3B0aW9ucy5vcmRpbmFsID8gYG9yZGluYWwke3RoaXMub3B0aW9ucy5wcmVwZW5kfWAgOiAnJ30ke3BsdXJhbENhdGVnb3J5fWApO1xuICB9XG4gIGdldFN1ZmZpeChjb2RlLCBjb3VudCwgb3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3QgcnVsZSA9IHRoaXMuZ2V0UnVsZShjb2RlLCBvcHRpb25zKTtcbiAgICBpZiAocnVsZSkge1xuICAgICAgcmV0dXJuIGAke3RoaXMub3B0aW9ucy5wcmVwZW5kfSR7b3B0aW9ucy5vcmRpbmFsID8gYG9yZGluYWwke3RoaXMub3B0aW9ucy5wcmVwZW5kfWAgOiAnJ30ke3J1bGUuc2VsZWN0KGNvdW50KX1gO1xuICAgIH1cbiAgICB0aGlzLmxvZ2dlci53YXJuKGBubyBwbHVyYWwgcnVsZSBmb3VuZCBmb3I6ICR7Y29kZX1gKTtcbiAgICByZXR1cm4gdGhpcy5nZXRTdWZmaXgoJ2RldicsIGNvdW50LCBvcHRpb25zKTtcbiAgfVxufVxuXG5jb25zdCBkZWVwRmluZFdpdGhEZWZhdWx0cyA9IChkYXRhLCBkZWZhdWx0RGF0YSwga2V5LCBrZXlTZXBhcmF0b3IgPSAnLicsIGlnbm9yZUpTT05TdHJ1Y3R1cmUgPSB0cnVlKSA9PiB7XG4gIGxldCBwYXRoID0gZ2V0UGF0aFdpdGhEZWZhdWx0cyhkYXRhLCBkZWZhdWx0RGF0YSwga2V5KTtcbiAgaWYgKCFwYXRoICYmIGlnbm9yZUpTT05TdHJ1Y3R1cmUgJiYgaXNTdHJpbmcoa2V5KSkge1xuICAgIHBhdGggPSBkZWVwRmluZChkYXRhLCBrZXksIGtleVNlcGFyYXRvcik7XG4gICAgaWYgKHBhdGggPT09IHVuZGVmaW5lZCkgcGF0aCA9IGRlZXBGaW5kKGRlZmF1bHREYXRhLCBrZXksIGtleVNlcGFyYXRvcik7XG4gIH1cbiAgcmV0dXJuIHBhdGg7XG59O1xuY29uc3QgcmVnZXhTYWZlID0gdmFsID0+IHZhbC5yZXBsYWNlKC9cXCQvZywgJyQkJCQnKTtcbmNsYXNzIEludGVycG9sYXRvciB7XG4gIGNvbnN0cnVjdG9yKG9wdGlvbnMgPSB7fSkge1xuICAgIHRoaXMubG9nZ2VyID0gYmFzZUxvZ2dlci5jcmVhdGUoJ2ludGVycG9sYXRvcicpO1xuICAgIHRoaXMub3B0aW9ucyA9IG9wdGlvbnM7XG4gICAgdGhpcy5mb3JtYXQgPSBvcHRpb25zPy5pbnRlcnBvbGF0aW9uPy5mb3JtYXQgfHwgKHZhbHVlID0+IHZhbHVlKTtcbiAgICB0aGlzLmluaXQob3B0aW9ucyk7XG4gIH1cbiAgaW5pdChvcHRpb25zID0ge30pIHtcbiAgICBpZiAoIW9wdGlvbnMuaW50ZXJwb2xhdGlvbikgb3B0aW9ucy5pbnRlcnBvbGF0aW9uID0ge1xuICAgICAgZXNjYXBlVmFsdWU6IHRydWVcbiAgICB9O1xuICAgIGNvbnN0IHtcbiAgICAgIGVzY2FwZTogZXNjYXBlJDEsXG4gICAgICBlc2NhcGVWYWx1ZSxcbiAgICAgIHVzZVJhd1ZhbHVlVG9Fc2NhcGUsXG4gICAgICBwcmVmaXgsXG4gICAgICBwcmVmaXhFc2NhcGVkLFxuICAgICAgc3VmZml4LFxuICAgICAgc3VmZml4RXNjYXBlZCxcbiAgICAgIGZvcm1hdFNlcGFyYXRvcixcbiAgICAgIHVuZXNjYXBlU3VmZml4LFxuICAgICAgdW5lc2NhcGVQcmVmaXgsXG4gICAgICBuZXN0aW5nUHJlZml4LFxuICAgICAgbmVzdGluZ1ByZWZpeEVzY2FwZWQsXG4gICAgICBuZXN0aW5nU3VmZml4LFxuICAgICAgbmVzdGluZ1N1ZmZpeEVzY2FwZWQsXG4gICAgICBuZXN0aW5nT3B0aW9uc1NlcGFyYXRvcixcbiAgICAgIG1heFJlcGxhY2VzLFxuICAgICAgYWx3YXlzRm9ybWF0XG4gICAgfSA9IG9wdGlvbnMuaW50ZXJwb2xhdGlvbjtcbiAgICB0aGlzLmVzY2FwZSA9IGVzY2FwZSQxICE9PSB1bmRlZmluZWQgPyBlc2NhcGUkMSA6IGVzY2FwZTtcbiAgICB0aGlzLmVzY2FwZVZhbHVlID0gZXNjYXBlVmFsdWUgIT09IHVuZGVmaW5lZCA/IGVzY2FwZVZhbHVlIDogdHJ1ZTtcbiAgICB0aGlzLnVzZVJhd1ZhbHVlVG9Fc2NhcGUgPSB1c2VSYXdWYWx1ZVRvRXNjYXBlICE9PSB1bmRlZmluZWQgPyB1c2VSYXdWYWx1ZVRvRXNjYXBlIDogZmFsc2U7XG4gICAgdGhpcy5wcmVmaXggPSBwcmVmaXggPyByZWdleEVzY2FwZShwcmVmaXgpIDogcHJlZml4RXNjYXBlZCB8fCAne3snO1xuICAgIHRoaXMuc3VmZml4ID0gc3VmZml4ID8gcmVnZXhFc2NhcGUoc3VmZml4KSA6IHN1ZmZpeEVzY2FwZWQgfHwgJ319JztcbiAgICB0aGlzLmZvcm1hdFNlcGFyYXRvciA9IGZvcm1hdFNlcGFyYXRvciB8fCAnLCc7XG4gICAgdGhpcy51bmVzY2FwZVByZWZpeCA9IHVuZXNjYXBlU3VmZml4ID8gJycgOiB1bmVzY2FwZVByZWZpeCB8fCAnLSc7XG4gICAgdGhpcy51bmVzY2FwZVN1ZmZpeCA9IHRoaXMudW5lc2NhcGVQcmVmaXggPyAnJyA6IHVuZXNjYXBlU3VmZml4IHx8ICcnO1xuICAgIHRoaXMubmVzdGluZ1ByZWZpeCA9IG5lc3RpbmdQcmVmaXggPyByZWdleEVzY2FwZShuZXN0aW5nUHJlZml4KSA6IG5lc3RpbmdQcmVmaXhFc2NhcGVkIHx8IHJlZ2V4RXNjYXBlKCckdCgnKTtcbiAgICB0aGlzLm5lc3RpbmdTdWZmaXggPSBuZXN0aW5nU3VmZml4ID8gcmVnZXhFc2NhcGUobmVzdGluZ1N1ZmZpeCkgOiBuZXN0aW5nU3VmZml4RXNjYXBlZCB8fCByZWdleEVzY2FwZSgnKScpO1xuICAgIHRoaXMubmVzdGluZ09wdGlvbnNTZXBhcmF0b3IgPSBuZXN0aW5nT3B0aW9uc1NlcGFyYXRvciB8fCAnLCc7XG4gICAgdGhpcy5tYXhSZXBsYWNlcyA9IG1heFJlcGxhY2VzIHx8IDEwMDA7XG4gICAgdGhpcy5hbHdheXNGb3JtYXQgPSBhbHdheXNGb3JtYXQgIT09IHVuZGVmaW5lZCA/IGFsd2F5c0Zvcm1hdCA6IGZhbHNlO1xuICAgIHRoaXMucmVzZXRSZWdFeHAoKTtcbiAgfVxuICByZXNldCgpIHtcbiAgICBpZiAodGhpcy5vcHRpb25zKSB0aGlzLmluaXQodGhpcy5vcHRpb25zKTtcbiAgfVxuICByZXNldFJlZ0V4cCgpIHtcbiAgICBjb25zdCBnZXRPclJlc2V0UmVnRXhwID0gKGV4aXN0aW5nUmVnRXhwLCBwYXR0ZXJuKSA9PiB7XG4gICAgICBpZiAoZXhpc3RpbmdSZWdFeHA/LnNvdXJjZSA9PT0gcGF0dGVybikge1xuICAgICAgICBleGlzdGluZ1JlZ0V4cC5sYXN0SW5kZXggPSAwO1xuICAgICAgICByZXR1cm4gZXhpc3RpbmdSZWdFeHA7XG4gICAgICB9XG4gICAgICByZXR1cm4gbmV3IFJlZ0V4cChwYXR0ZXJuLCAnZycpO1xuICAgIH07XG4gICAgdGhpcy5yZWdleHAgPSBnZXRPclJlc2V0UmVnRXhwKHRoaXMucmVnZXhwLCBgJHt0aGlzLnByZWZpeH0oLis/KSR7dGhpcy5zdWZmaXh9YCk7XG4gICAgdGhpcy5yZWdleHBVbmVzY2FwZSA9IGdldE9yUmVzZXRSZWdFeHAodGhpcy5yZWdleHBVbmVzY2FwZSwgYCR7dGhpcy5wcmVmaXh9JHt0aGlzLnVuZXNjYXBlUHJlZml4fSguKz8pJHt0aGlzLnVuZXNjYXBlU3VmZml4fSR7dGhpcy5zdWZmaXh9YCk7XG4gICAgdGhpcy5uZXN0aW5nUmVnZXhwID0gZ2V0T3JSZXNldFJlZ0V4cCh0aGlzLm5lc3RpbmdSZWdleHAsIGAke3RoaXMubmVzdGluZ1ByZWZpeH0oLis/KSR7dGhpcy5uZXN0aW5nU3VmZml4fWApO1xuICB9XG4gIGludGVycG9sYXRlKHN0ciwgZGF0YSwgbG5nLCBvcHRpb25zKSB7XG4gICAgbGV0IG1hdGNoO1xuICAgIGxldCB2YWx1ZTtcbiAgICBsZXQgcmVwbGFjZXM7XG4gICAgY29uc3QgZGVmYXVsdERhdGEgPSB0aGlzLm9wdGlvbnMgJiYgdGhpcy5vcHRpb25zLmludGVycG9sYXRpb24gJiYgdGhpcy5vcHRpb25zLmludGVycG9sYXRpb24uZGVmYXVsdFZhcmlhYmxlcyB8fCB7fTtcbiAgICBjb25zdCBoYW5kbGVGb3JtYXQgPSBrZXkgPT4ge1xuICAgICAgaWYgKGtleS5pbmRleE9mKHRoaXMuZm9ybWF0U2VwYXJhdG9yKSA8IDApIHtcbiAgICAgICAgY29uc3QgcGF0aCA9IGRlZXBGaW5kV2l0aERlZmF1bHRzKGRhdGEsIGRlZmF1bHREYXRhLCBrZXksIHRoaXMub3B0aW9ucy5rZXlTZXBhcmF0b3IsIHRoaXMub3B0aW9ucy5pZ25vcmVKU09OU3RydWN0dXJlKTtcbiAgICAgICAgcmV0dXJuIHRoaXMuYWx3YXlzRm9ybWF0ID8gdGhpcy5mb3JtYXQocGF0aCwgdW5kZWZpbmVkLCBsbmcsIHtcbiAgICAgICAgICAuLi5vcHRpb25zLFxuICAgICAgICAgIC4uLmRhdGEsXG4gICAgICAgICAgaW50ZXJwb2xhdGlvbmtleToga2V5XG4gICAgICAgIH0pIDogcGF0aDtcbiAgICAgIH1cbiAgICAgIGNvbnN0IHAgPSBrZXkuc3BsaXQodGhpcy5mb3JtYXRTZXBhcmF0b3IpO1xuICAgICAgY29uc3QgayA9IHAuc2hpZnQoKS50cmltKCk7XG4gICAgICBjb25zdCBmID0gcC5qb2luKHRoaXMuZm9ybWF0U2VwYXJhdG9yKS50cmltKCk7XG4gICAgICByZXR1cm4gdGhpcy5mb3JtYXQoZGVlcEZpbmRXaXRoRGVmYXVsdHMoZGF0YSwgZGVmYXVsdERhdGEsIGssIHRoaXMub3B0aW9ucy5rZXlTZXBhcmF0b3IsIHRoaXMub3B0aW9ucy5pZ25vcmVKU09OU3RydWN0dXJlKSwgZiwgbG5nLCB7XG4gICAgICAgIC4uLm9wdGlvbnMsXG4gICAgICAgIC4uLmRhdGEsXG4gICAgICAgIGludGVycG9sYXRpb25rZXk6IGtcbiAgICAgIH0pO1xuICAgIH07XG4gICAgdGhpcy5yZXNldFJlZ0V4cCgpO1xuICAgIGNvbnN0IG1pc3NpbmdJbnRlcnBvbGF0aW9uSGFuZGxlciA9IG9wdGlvbnM/Lm1pc3NpbmdJbnRlcnBvbGF0aW9uSGFuZGxlciB8fCB0aGlzLm9wdGlvbnMubWlzc2luZ0ludGVycG9sYXRpb25IYW5kbGVyO1xuICAgIGNvbnN0IHNraXBPblZhcmlhYmxlcyA9IG9wdGlvbnM/LmludGVycG9sYXRpb24/LnNraXBPblZhcmlhYmxlcyAhPT0gdW5kZWZpbmVkID8gb3B0aW9ucy5pbnRlcnBvbGF0aW9uLnNraXBPblZhcmlhYmxlcyA6IHRoaXMub3B0aW9ucy5pbnRlcnBvbGF0aW9uLnNraXBPblZhcmlhYmxlcztcbiAgICBjb25zdCB0b2RvcyA9IFt7XG4gICAgICByZWdleDogdGhpcy5yZWdleHBVbmVzY2FwZSxcbiAgICAgIHNhZmVWYWx1ZTogdmFsID0+IHJlZ2V4U2FmZSh2YWwpXG4gICAgfSwge1xuICAgICAgcmVnZXg6IHRoaXMucmVnZXhwLFxuICAgICAgc2FmZVZhbHVlOiB2YWwgPT4gdGhpcy5lc2NhcGVWYWx1ZSA/IHJlZ2V4U2FmZSh0aGlzLmVzY2FwZSh2YWwpKSA6IHJlZ2V4U2FmZSh2YWwpXG4gICAgfV07XG4gICAgdG9kb3MuZm9yRWFjaCh0b2RvID0+IHtcbiAgICAgIHJlcGxhY2VzID0gMDtcbiAgICAgIHdoaWxlIChtYXRjaCA9IHRvZG8ucmVnZXguZXhlYyhzdHIpKSB7XG4gICAgICAgIGNvbnN0IG1hdGNoZWRWYXIgPSBtYXRjaFsxXS50cmltKCk7XG4gICAgICAgIHZhbHVlID0gaGFuZGxlRm9ybWF0KG1hdGNoZWRWYXIpO1xuICAgICAgICBpZiAodmFsdWUgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgIGlmICh0eXBlb2YgbWlzc2luZ0ludGVycG9sYXRpb25IYW5kbGVyID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgICAgICBjb25zdCB0ZW1wID0gbWlzc2luZ0ludGVycG9sYXRpb25IYW5kbGVyKHN0ciwgbWF0Y2gsIG9wdGlvbnMpO1xuICAgICAgICAgICAgdmFsdWUgPSBpc1N0cmluZyh0ZW1wKSA/IHRlbXAgOiAnJztcbiAgICAgICAgICB9IGVsc2UgaWYgKG9wdGlvbnMgJiYgT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKG9wdGlvbnMsIG1hdGNoZWRWYXIpKSB7XG4gICAgICAgICAgICB2YWx1ZSA9ICcnO1xuICAgICAgICAgIH0gZWxzZSBpZiAoc2tpcE9uVmFyaWFibGVzKSB7XG4gICAgICAgICAgICB2YWx1ZSA9IG1hdGNoWzBdO1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oYG1pc3NlZCB0byBwYXNzIGluIHZhcmlhYmxlICR7bWF0Y2hlZFZhcn0gZm9yIGludGVycG9sYXRpbmcgJHtzdHJ9YCk7XG4gICAgICAgICAgICB2YWx1ZSA9ICcnO1xuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIGlmICghaXNTdHJpbmcodmFsdWUpICYmICF0aGlzLnVzZVJhd1ZhbHVlVG9Fc2NhcGUpIHtcbiAgICAgICAgICB2YWx1ZSA9IG1ha2VTdHJpbmcodmFsdWUpO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IHNhZmVWYWx1ZSA9IHRvZG8uc2FmZVZhbHVlKHZhbHVlKTtcbiAgICAgICAgc3RyID0gc3RyLnJlcGxhY2UobWF0Y2hbMF0sIHNhZmVWYWx1ZSk7XG4gICAgICAgIGlmIChza2lwT25WYXJpYWJsZXMpIHtcbiAgICAgICAgICB0b2RvLnJlZ2V4Lmxhc3RJbmRleCArPSB2YWx1ZS5sZW5ndGg7XG4gICAgICAgICAgdG9kby5yZWdleC5sYXN0SW5kZXggLT0gbWF0Y2hbMF0ubGVuZ3RoO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRvZG8ucmVnZXgubGFzdEluZGV4ID0gMDtcbiAgICAgICAgfVxuICAgICAgICByZXBsYWNlcysrO1xuICAgICAgICBpZiAocmVwbGFjZXMgPj0gdGhpcy5tYXhSZXBsYWNlcykge1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSk7XG4gICAgcmV0dXJuIHN0cjtcbiAgfVxuICBuZXN0KHN0ciwgZmMsIG9wdGlvbnMgPSB7fSkge1xuICAgIGxldCBtYXRjaDtcbiAgICBsZXQgdmFsdWU7XG4gICAgbGV0IGNsb25lZE9wdGlvbnM7XG4gICAgY29uc3QgaGFuZGxlSGFzT3B0aW9ucyA9IChrZXksIGluaGVyaXRlZE9wdGlvbnMpID0+IHtcbiAgICAgIGNvbnN0IHNlcCA9IHRoaXMubmVzdGluZ09wdGlvbnNTZXBhcmF0b3I7XG4gICAgICBpZiAoa2V5LmluZGV4T2Yoc2VwKSA8IDApIHJldHVybiBrZXk7XG4gICAgICBjb25zdCBjID0ga2V5LnNwbGl0KG5ldyBSZWdFeHAoYCR7c2VwfVsgXSp7YCkpO1xuICAgICAgbGV0IG9wdGlvbnNTdHJpbmcgPSBgeyR7Y1sxXX1gO1xuICAgICAga2V5ID0gY1swXTtcbiAgICAgIG9wdGlvbnNTdHJpbmcgPSB0aGlzLmludGVycG9sYXRlKG9wdGlvbnNTdHJpbmcsIGNsb25lZE9wdGlvbnMpO1xuICAgICAgY29uc3QgbWF0Y2hlZFNpbmdsZVF1b3RlcyA9IG9wdGlvbnNTdHJpbmcubWF0Y2goLycvZyk7XG4gICAgICBjb25zdCBtYXRjaGVkRG91YmxlUXVvdGVzID0gb3B0aW9uc1N0cmluZy5tYXRjaCgvXCIvZyk7XG4gICAgICBpZiAoKG1hdGNoZWRTaW5nbGVRdW90ZXM/Lmxlbmd0aCA/PyAwKSAlIDIgPT09IDAgJiYgIW1hdGNoZWREb3VibGVRdW90ZXMgfHwgbWF0Y2hlZERvdWJsZVF1b3Rlcy5sZW5ndGggJSAyICE9PSAwKSB7XG4gICAgICAgIG9wdGlvbnNTdHJpbmcgPSBvcHRpb25zU3RyaW5nLnJlcGxhY2UoLycvZywgJ1wiJyk7XG4gICAgICB9XG4gICAgICB0cnkge1xuICAgICAgICBjbG9uZWRPcHRpb25zID0gSlNPTi5wYXJzZShvcHRpb25zU3RyaW5nKTtcbiAgICAgICAgaWYgKGluaGVyaXRlZE9wdGlvbnMpIGNsb25lZE9wdGlvbnMgPSB7XG4gICAgICAgICAgLi4uaW5oZXJpdGVkT3B0aW9ucyxcbiAgICAgICAgICAuLi5jbG9uZWRPcHRpb25zXG4gICAgICAgIH07XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLndhcm4oYGZhaWxlZCBwYXJzaW5nIG9wdGlvbnMgc3RyaW5nIGluIG5lc3RpbmcgZm9yIGtleSAke2tleX1gLCBlKTtcbiAgICAgICAgcmV0dXJuIGAke2tleX0ke3NlcH0ke29wdGlvbnNTdHJpbmd9YDtcbiAgICAgIH1cbiAgICAgIGlmIChjbG9uZWRPcHRpb25zLmRlZmF1bHRWYWx1ZSAmJiBjbG9uZWRPcHRpb25zLmRlZmF1bHRWYWx1ZS5pbmRleE9mKHRoaXMucHJlZml4KSA+IC0xKSBkZWxldGUgY2xvbmVkT3B0aW9ucy5kZWZhdWx0VmFsdWU7XG4gICAgICByZXR1cm4ga2V5O1xuICAgIH07XG4gICAgd2hpbGUgKG1hdGNoID0gdGhpcy5uZXN0aW5nUmVnZXhwLmV4ZWMoc3RyKSkge1xuICAgICAgbGV0IGZvcm1hdHRlcnMgPSBbXTtcbiAgICAgIGNsb25lZE9wdGlvbnMgPSB7XG4gICAgICAgIC4uLm9wdGlvbnNcbiAgICAgIH07XG4gICAgICBjbG9uZWRPcHRpb25zID0gY2xvbmVkT3B0aW9ucy5yZXBsYWNlICYmICFpc1N0cmluZyhjbG9uZWRPcHRpb25zLnJlcGxhY2UpID8gY2xvbmVkT3B0aW9ucy5yZXBsYWNlIDogY2xvbmVkT3B0aW9ucztcbiAgICAgIGNsb25lZE9wdGlvbnMuYXBwbHlQb3N0UHJvY2Vzc29yID0gZmFsc2U7XG4gICAgICBkZWxldGUgY2xvbmVkT3B0aW9ucy5kZWZhdWx0VmFsdWU7XG4gICAgICBjb25zdCBrZXlFbmRJbmRleCA9IC97Lip9Ly50ZXN0KG1hdGNoWzFdKSA/IG1hdGNoWzFdLmxhc3RJbmRleE9mKCd9JykgKyAxIDogbWF0Y2hbMV0uaW5kZXhPZih0aGlzLmZvcm1hdFNlcGFyYXRvcik7XG4gICAgICBpZiAoa2V5RW5kSW5kZXggIT09IC0xKSB7XG4gICAgICAgIGZvcm1hdHRlcnMgPSBtYXRjaFsxXS5zbGljZShrZXlFbmRJbmRleCkuc3BsaXQodGhpcy5mb3JtYXRTZXBhcmF0b3IpLm1hcChlbGVtID0+IGVsZW0udHJpbSgpKS5maWx0ZXIoQm9vbGVhbik7XG4gICAgICAgIG1hdGNoWzFdID0gbWF0Y2hbMV0uc2xpY2UoMCwga2V5RW5kSW5kZXgpO1xuICAgICAgfVxuICAgICAgdmFsdWUgPSBmYyhoYW5kbGVIYXNPcHRpb25zLmNhbGwodGhpcywgbWF0Y2hbMV0udHJpbSgpLCBjbG9uZWRPcHRpb25zKSwgY2xvbmVkT3B0aW9ucyk7XG4gICAgICBpZiAodmFsdWUgJiYgbWF0Y2hbMF0gPT09IHN0ciAmJiAhaXNTdHJpbmcodmFsdWUpKSByZXR1cm4gdmFsdWU7XG4gICAgICBpZiAoIWlzU3RyaW5nKHZhbHVlKSkgdmFsdWUgPSBtYWtlU3RyaW5nKHZhbHVlKTtcbiAgICAgIGlmICghdmFsdWUpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIud2FybihgbWlzc2VkIHRvIHJlc29sdmUgJHttYXRjaFsxXX0gZm9yIG5lc3RpbmcgJHtzdHJ9YCk7XG4gICAgICAgIHZhbHVlID0gJyc7XG4gICAgICB9XG4gICAgICBpZiAoZm9ybWF0dGVycy5sZW5ndGgpIHtcbiAgICAgICAgdmFsdWUgPSBmb3JtYXR0ZXJzLnJlZHVjZSgodiwgZikgPT4gdGhpcy5mb3JtYXQodiwgZiwgb3B0aW9ucy5sbmcsIHtcbiAgICAgICAgICAuLi5vcHRpb25zLFxuICAgICAgICAgIGludGVycG9sYXRpb25rZXk6IG1hdGNoWzFdLnRyaW0oKVxuICAgICAgICB9KSwgdmFsdWUudHJpbSgpKTtcbiAgICAgIH1cbiAgICAgIHN0ciA9IHN0ci5yZXBsYWNlKG1hdGNoWzBdLCB2YWx1ZSk7XG4gICAgICB0aGlzLnJlZ2V4cC5sYXN0SW5kZXggPSAwO1xuICAgIH1cbiAgICByZXR1cm4gc3RyO1xuICB9XG59XG5cbmNvbnN0IHBhcnNlRm9ybWF0U3RyID0gZm9ybWF0U3RyID0+IHtcbiAgbGV0IGZvcm1hdE5hbWUgPSBmb3JtYXRTdHIudG9Mb3dlckNhc2UoKS50cmltKCk7XG4gIGNvbnN0IGZvcm1hdE9wdGlvbnMgPSB7fTtcbiAgaWYgKGZvcm1hdFN0ci5pbmRleE9mKCcoJykgPiAtMSkge1xuICAgIGNvbnN0IHAgPSBmb3JtYXRTdHIuc3BsaXQoJygnKTtcbiAgICBmb3JtYXROYW1lID0gcFswXS50b0xvd2VyQ2FzZSgpLnRyaW0oKTtcbiAgICBjb25zdCBvcHRTdHIgPSBwWzFdLnN1YnN0cmluZygwLCBwWzFdLmxlbmd0aCAtIDEpO1xuICAgIGlmIChmb3JtYXROYW1lID09PSAnY3VycmVuY3knICYmIG9wdFN0ci5pbmRleE9mKCc6JykgPCAwKSB7XG4gICAgICBpZiAoIWZvcm1hdE9wdGlvbnMuY3VycmVuY3kpIGZvcm1hdE9wdGlvbnMuY3VycmVuY3kgPSBvcHRTdHIudHJpbSgpO1xuICAgIH0gZWxzZSBpZiAoZm9ybWF0TmFtZSA9PT0gJ3JlbGF0aXZldGltZScgJiYgb3B0U3RyLmluZGV4T2YoJzonKSA8IDApIHtcbiAgICAgIGlmICghZm9ybWF0T3B0aW9ucy5yYW5nZSkgZm9ybWF0T3B0aW9ucy5yYW5nZSA9IG9wdFN0ci50cmltKCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnN0IG9wdHMgPSBvcHRTdHIuc3BsaXQoJzsnKTtcbiAgICAgIG9wdHMuZm9yRWFjaChvcHQgPT4ge1xuICAgICAgICBpZiAob3B0KSB7XG4gICAgICAgICAgY29uc3QgW2tleSwgLi4ucmVzdF0gPSBvcHQuc3BsaXQoJzonKTtcbiAgICAgICAgICBjb25zdCB2YWwgPSByZXN0LmpvaW4oJzonKS50cmltKCkucmVwbGFjZSgvXicrfCcrJC9nLCAnJyk7XG4gICAgICAgICAgY29uc3QgdHJpbW1lZEtleSA9IGtleS50cmltKCk7XG4gICAgICAgICAgaWYgKCFmb3JtYXRPcHRpb25zW3RyaW1tZWRLZXldKSBmb3JtYXRPcHRpb25zW3RyaW1tZWRLZXldID0gdmFsO1xuICAgICAgICAgIGlmICh2YWwgPT09ICdmYWxzZScpIGZvcm1hdE9wdGlvbnNbdHJpbW1lZEtleV0gPSBmYWxzZTtcbiAgICAgICAgICBpZiAodmFsID09PSAndHJ1ZScpIGZvcm1hdE9wdGlvbnNbdHJpbW1lZEtleV0gPSB0cnVlO1xuICAgICAgICAgIGlmICghaXNOYU4odmFsKSkgZm9ybWF0T3B0aW9uc1t0cmltbWVkS2V5XSA9IHBhcnNlSW50KHZhbCwgMTApO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHtcbiAgICBmb3JtYXROYW1lLFxuICAgIGZvcm1hdE9wdGlvbnNcbiAgfTtcbn07XG5jb25zdCBjcmVhdGVDYWNoZWRGb3JtYXR0ZXIgPSBmbiA9PiB7XG4gIGNvbnN0IGNhY2hlID0ge307XG4gIHJldHVybiAodiwgbCwgbykgPT4ge1xuICAgIGxldCBvcHRGb3JDYWNoZSA9IG87XG4gICAgaWYgKG8gJiYgby5pbnRlcnBvbGF0aW9ua2V5ICYmIG8uZm9ybWF0UGFyYW1zICYmIG8uZm9ybWF0UGFyYW1zW28uaW50ZXJwb2xhdGlvbmtleV0gJiYgb1tvLmludGVycG9sYXRpb25rZXldKSB7XG4gICAgICBvcHRGb3JDYWNoZSA9IHtcbiAgICAgICAgLi4ub3B0Rm9yQ2FjaGUsXG4gICAgICAgIFtvLmludGVycG9sYXRpb25rZXldOiB1bmRlZmluZWRcbiAgICAgIH07XG4gICAgfVxuICAgIGNvbnN0IGtleSA9IGwgKyBKU09OLnN0cmluZ2lmeShvcHRGb3JDYWNoZSk7XG4gICAgbGV0IGZybSA9IGNhY2hlW2tleV07XG4gICAgaWYgKCFmcm0pIHtcbiAgICAgIGZybSA9IGZuKGdldENsZWFuZWRDb2RlKGwpLCBvKTtcbiAgICAgIGNhY2hlW2tleV0gPSBmcm07XG4gICAgfVxuICAgIHJldHVybiBmcm0odik7XG4gIH07XG59O1xuY29uc3QgY3JlYXRlTm9uQ2FjaGVkRm9ybWF0dGVyID0gZm4gPT4gKHYsIGwsIG8pID0+IGZuKGdldENsZWFuZWRDb2RlKGwpLCBvKSh2KTtcbmNsYXNzIEZvcm1hdHRlciB7XG4gIGNvbnN0cnVjdG9yKG9wdGlvbnMgPSB7fSkge1xuICAgIHRoaXMubG9nZ2VyID0gYmFzZUxvZ2dlci5jcmVhdGUoJ2Zvcm1hdHRlcicpO1xuICAgIHRoaXMub3B0aW9ucyA9IG9wdGlvbnM7XG4gICAgdGhpcy5pbml0KG9wdGlvbnMpO1xuICB9XG4gIGluaXQoc2VydmljZXMsIG9wdGlvbnMgPSB7XG4gICAgaW50ZXJwb2xhdGlvbjoge31cbiAgfSkge1xuICAgIHRoaXMuZm9ybWF0U2VwYXJhdG9yID0gb3B0aW9ucy5pbnRlcnBvbGF0aW9uLmZvcm1hdFNlcGFyYXRvciB8fCAnLCc7XG4gICAgY29uc3QgY2YgPSBvcHRpb25zLmNhY2hlSW5CdWlsdEZvcm1hdHMgPyBjcmVhdGVDYWNoZWRGb3JtYXR0ZXIgOiBjcmVhdGVOb25DYWNoZWRGb3JtYXR0ZXI7XG4gICAgdGhpcy5mb3JtYXRzID0ge1xuICAgICAgbnVtYmVyOiBjZigobG5nLCBvcHQpID0+IHtcbiAgICAgICAgY29uc3QgZm9ybWF0dGVyID0gbmV3IEludGwuTnVtYmVyRm9ybWF0KGxuZywge1xuICAgICAgICAgIC4uLm9wdFxuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIHZhbCA9PiBmb3JtYXR0ZXIuZm9ybWF0KHZhbCk7XG4gICAgICB9KSxcbiAgICAgIGN1cnJlbmN5OiBjZigobG5nLCBvcHQpID0+IHtcbiAgICAgICAgY29uc3QgZm9ybWF0dGVyID0gbmV3IEludGwuTnVtYmVyRm9ybWF0KGxuZywge1xuICAgICAgICAgIC4uLm9wdCxcbiAgICAgICAgICBzdHlsZTogJ2N1cnJlbmN5J1xuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIHZhbCA9PiBmb3JtYXR0ZXIuZm9ybWF0KHZhbCk7XG4gICAgICB9KSxcbiAgICAgIGRhdGV0aW1lOiBjZigobG5nLCBvcHQpID0+IHtcbiAgICAgICAgY29uc3QgZm9ybWF0dGVyID0gbmV3IEludGwuRGF0ZVRpbWVGb3JtYXQobG5nLCB7XG4gICAgICAgICAgLi4ub3B0XG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4gdmFsID0+IGZvcm1hdHRlci5mb3JtYXQodmFsKTtcbiAgICAgIH0pLFxuICAgICAgcmVsYXRpdmV0aW1lOiBjZigobG5nLCBvcHQpID0+IHtcbiAgICAgICAgY29uc3QgZm9ybWF0dGVyID0gbmV3IEludGwuUmVsYXRpdmVUaW1lRm9ybWF0KGxuZywge1xuICAgICAgICAgIC4uLm9wdFxuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIHZhbCA9PiBmb3JtYXR0ZXIuZm9ybWF0KHZhbCwgb3B0LnJhbmdlIHx8ICdkYXknKTtcbiAgICAgIH0pLFxuICAgICAgbGlzdDogY2YoKGxuZywgb3B0KSA9PiB7XG4gICAgICAgIGNvbnN0IGZvcm1hdHRlciA9IG5ldyBJbnRsLkxpc3RGb3JtYXQobG5nLCB7XG4gICAgICAgICAgLi4ub3B0XG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4gdmFsID0+IGZvcm1hdHRlci5mb3JtYXQodmFsKTtcbiAgICAgIH0pXG4gICAgfTtcbiAgfVxuICBhZGQobmFtZSwgZmMpIHtcbiAgICB0aGlzLmZvcm1hdHNbbmFtZS50b0xvd2VyQ2FzZSgpLnRyaW0oKV0gPSBmYztcbiAgfVxuICBhZGRDYWNoZWQobmFtZSwgZmMpIHtcbiAgICB0aGlzLmZvcm1hdHNbbmFtZS50b0xvd2VyQ2FzZSgpLnRyaW0oKV0gPSBjcmVhdGVDYWNoZWRGb3JtYXR0ZXIoZmMpO1xuICB9XG4gIGZvcm1hdCh2YWx1ZSwgZm9ybWF0LCBsbmcsIG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGZvcm1hdHMgPSBmb3JtYXQuc3BsaXQodGhpcy5mb3JtYXRTZXBhcmF0b3IpO1xuICAgIGlmIChmb3JtYXRzLmxlbmd0aCA+IDEgJiYgZm9ybWF0c1swXS5pbmRleE9mKCcoJykgPiAxICYmIGZvcm1hdHNbMF0uaW5kZXhPZignKScpIDwgMCAmJiBmb3JtYXRzLmZpbmQoZiA9PiBmLmluZGV4T2YoJyknKSA+IC0xKSkge1xuICAgICAgY29uc3QgbGFzdEluZGV4ID0gZm9ybWF0cy5maW5kSW5kZXgoZiA9PiBmLmluZGV4T2YoJyknKSA+IC0xKTtcbiAgICAgIGZvcm1hdHNbMF0gPSBbZm9ybWF0c1swXSwgLi4uZm9ybWF0cy5zcGxpY2UoMSwgbGFzdEluZGV4KV0uam9pbih0aGlzLmZvcm1hdFNlcGFyYXRvcik7XG4gICAgfVxuICAgIGNvbnN0IHJlc3VsdCA9IGZvcm1hdHMucmVkdWNlKChtZW0sIGYpID0+IHtcbiAgICAgIGNvbnN0IHtcbiAgICAgICAgZm9ybWF0TmFtZSxcbiAgICAgICAgZm9ybWF0T3B0aW9uc1xuICAgICAgfSA9IHBhcnNlRm9ybWF0U3RyKGYpO1xuICAgICAgaWYgKHRoaXMuZm9ybWF0c1tmb3JtYXROYW1lXSkge1xuICAgICAgICBsZXQgZm9ybWF0dGVkID0gbWVtO1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGNvbnN0IHZhbE9wdGlvbnMgPSBvcHRpb25zPy5mb3JtYXRQYXJhbXM/LltvcHRpb25zLmludGVycG9sYXRpb25rZXldIHx8IHt9O1xuICAgICAgICAgIGNvbnN0IGwgPSB2YWxPcHRpb25zLmxvY2FsZSB8fCB2YWxPcHRpb25zLmxuZyB8fCBvcHRpb25zLmxvY2FsZSB8fCBvcHRpb25zLmxuZyB8fCBsbmc7XG4gICAgICAgICAgZm9ybWF0dGVkID0gdGhpcy5mb3JtYXRzW2Zvcm1hdE5hbWVdKG1lbSwgbCwge1xuICAgICAgICAgICAgLi4uZm9ybWF0T3B0aW9ucyxcbiAgICAgICAgICAgIC4uLm9wdGlvbnMsXG4gICAgICAgICAgICAuLi52YWxPcHRpb25zXG4gICAgICAgICAgfSk7XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgdGhpcy5sb2dnZXIud2FybihlcnJvcik7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGZvcm1hdHRlZDtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLndhcm4oYHRoZXJlIHdhcyBubyBmb3JtYXQgZnVuY3Rpb24gZm9yICR7Zm9ybWF0TmFtZX1gKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBtZW07XG4gICAgfSwgdmFsdWUpO1xuICAgIHJldHVybiByZXN1bHQ7XG4gIH1cbn1cblxuY29uc3QgcmVtb3ZlUGVuZGluZyA9IChxLCBuYW1lKSA9PiB7XG4gIGlmIChxLnBlbmRpbmdbbmFtZV0gIT09IHVuZGVmaW5lZCkge1xuICAgIGRlbGV0ZSBxLnBlbmRpbmdbbmFtZV07XG4gICAgcS5wZW5kaW5nQ291bnQtLTtcbiAgfVxufTtcbmNsYXNzIENvbm5lY3RvciBleHRlbmRzIEV2ZW50RW1pdHRlciB7XG4gIGNvbnN0cnVjdG9yKGJhY2tlbmQsIHN0b3JlLCBzZXJ2aWNlcywgb3B0aW9ucyA9IHt9KSB7XG4gICAgc3VwZXIoKTtcbiAgICB0aGlzLmJhY2tlbmQgPSBiYWNrZW5kO1xuICAgIHRoaXMuc3RvcmUgPSBzdG9yZTtcbiAgICB0aGlzLnNlcnZpY2VzID0gc2VydmljZXM7XG4gICAgdGhpcy5sYW5ndWFnZVV0aWxzID0gc2VydmljZXMubGFuZ3VhZ2VVdGlscztcbiAgICB0aGlzLm9wdGlvbnMgPSBvcHRpb25zO1xuICAgIHRoaXMubG9nZ2VyID0gYmFzZUxvZ2dlci5jcmVhdGUoJ2JhY2tlbmRDb25uZWN0b3InKTtcbiAgICB0aGlzLndhaXRpbmdSZWFkcyA9IFtdO1xuICAgIHRoaXMubWF4UGFyYWxsZWxSZWFkcyA9IG9wdGlvbnMubWF4UGFyYWxsZWxSZWFkcyB8fCAxMDtcbiAgICB0aGlzLnJlYWRpbmdDYWxscyA9IDA7XG4gICAgdGhpcy5tYXhSZXRyaWVzID0gb3B0aW9ucy5tYXhSZXRyaWVzID49IDAgPyBvcHRpb25zLm1heFJldHJpZXMgOiA1O1xuICAgIHRoaXMucmV0cnlUaW1lb3V0ID0gb3B0aW9ucy5yZXRyeVRpbWVvdXQgPj0gMSA/IG9wdGlvbnMucmV0cnlUaW1lb3V0IDogMzUwO1xuICAgIHRoaXMuc3RhdGUgPSB7fTtcbiAgICB0aGlzLnF1ZXVlID0gW107XG4gICAgdGhpcy5iYWNrZW5kPy5pbml0Py4oc2VydmljZXMsIG9wdGlvbnMuYmFja2VuZCwgb3B0aW9ucyk7XG4gIH1cbiAgcXVldWVMb2FkKGxhbmd1YWdlcywgbmFtZXNwYWNlcywgb3B0aW9ucywgY2FsbGJhY2spIHtcbiAgICBjb25zdCB0b0xvYWQgPSB7fTtcbiAgICBjb25zdCBwZW5kaW5nID0ge307XG4gICAgY29uc3QgdG9Mb2FkTGFuZ3VhZ2VzID0ge307XG4gICAgY29uc3QgdG9Mb2FkTmFtZXNwYWNlcyA9IHt9O1xuICAgIGxhbmd1YWdlcy5mb3JFYWNoKGxuZyA9PiB7XG4gICAgICBsZXQgaGFzQWxsTmFtZXNwYWNlcyA9IHRydWU7XG4gICAgICBuYW1lc3BhY2VzLmZvckVhY2gobnMgPT4ge1xuICAgICAgICBjb25zdCBuYW1lID0gYCR7bG5nfXwke25zfWA7XG4gICAgICAgIGlmICghb3B0aW9ucy5yZWxvYWQgJiYgdGhpcy5zdG9yZS5oYXNSZXNvdXJjZUJ1bmRsZShsbmcsIG5zKSkge1xuICAgICAgICAgIHRoaXMuc3RhdGVbbmFtZV0gPSAyO1xuICAgICAgICB9IGVsc2UgaWYgKHRoaXMuc3RhdGVbbmFtZV0gPCAwKSA7IGVsc2UgaWYgKHRoaXMuc3RhdGVbbmFtZV0gPT09IDEpIHtcbiAgICAgICAgICBpZiAocGVuZGluZ1tuYW1lXSA9PT0gdW5kZWZpbmVkKSBwZW5kaW5nW25hbWVdID0gdHJ1ZTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aGlzLnN0YXRlW25hbWVdID0gMTtcbiAgICAgICAgICBoYXNBbGxOYW1lc3BhY2VzID0gZmFsc2U7XG4gICAgICAgICAgaWYgKHBlbmRpbmdbbmFtZV0gPT09IHVuZGVmaW5lZCkgcGVuZGluZ1tuYW1lXSA9IHRydWU7XG4gICAgICAgICAgaWYgKHRvTG9hZFtuYW1lXSA9PT0gdW5kZWZpbmVkKSB0b0xvYWRbbmFtZV0gPSB0cnVlO1xuICAgICAgICAgIGlmICh0b0xvYWROYW1lc3BhY2VzW25zXSA9PT0gdW5kZWZpbmVkKSB0b0xvYWROYW1lc3BhY2VzW25zXSA9IHRydWU7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgICAgaWYgKCFoYXNBbGxOYW1lc3BhY2VzKSB0b0xvYWRMYW5ndWFnZXNbbG5nXSA9IHRydWU7XG4gICAgfSk7XG4gICAgaWYgKE9iamVjdC5rZXlzKHRvTG9hZCkubGVuZ3RoIHx8IE9iamVjdC5rZXlzKHBlbmRpbmcpLmxlbmd0aCkge1xuICAgICAgdGhpcy5xdWV1ZS5wdXNoKHtcbiAgICAgICAgcGVuZGluZyxcbiAgICAgICAgcGVuZGluZ0NvdW50OiBPYmplY3Qua2V5cyhwZW5kaW5nKS5sZW5ndGgsXG4gICAgICAgIGxvYWRlZDoge30sXG4gICAgICAgIGVycm9yczogW10sXG4gICAgICAgIGNhbGxiYWNrXG4gICAgICB9KTtcbiAgICB9XG4gICAgcmV0dXJuIHtcbiAgICAgIHRvTG9hZDogT2JqZWN0LmtleXModG9Mb2FkKSxcbiAgICAgIHBlbmRpbmc6IE9iamVjdC5rZXlzKHBlbmRpbmcpLFxuICAgICAgdG9Mb2FkTGFuZ3VhZ2VzOiBPYmplY3Qua2V5cyh0b0xvYWRMYW5ndWFnZXMpLFxuICAgICAgdG9Mb2FkTmFtZXNwYWNlczogT2JqZWN0LmtleXModG9Mb2FkTmFtZXNwYWNlcylcbiAgICB9O1xuICB9XG4gIGxvYWRlZChuYW1lLCBlcnIsIGRhdGEpIHtcbiAgICBjb25zdCBzID0gbmFtZS5zcGxpdCgnfCcpO1xuICAgIGNvbnN0IGxuZyA9IHNbMF07XG4gICAgY29uc3QgbnMgPSBzWzFdO1xuICAgIGlmIChlcnIpIHRoaXMuZW1pdCgnZmFpbGVkTG9hZGluZycsIGxuZywgbnMsIGVycik7XG4gICAgaWYgKCFlcnIgJiYgZGF0YSkge1xuICAgICAgdGhpcy5zdG9yZS5hZGRSZXNvdXJjZUJ1bmRsZShsbmcsIG5zLCBkYXRhLCB1bmRlZmluZWQsIHVuZGVmaW5lZCwge1xuICAgICAgICBza2lwQ29weTogdHJ1ZVxuICAgICAgfSk7XG4gICAgfVxuICAgIHRoaXMuc3RhdGVbbmFtZV0gPSBlcnIgPyAtMSA6IDI7XG4gICAgaWYgKGVyciAmJiBkYXRhKSB0aGlzLnN0YXRlW25hbWVdID0gMDtcbiAgICBjb25zdCBsb2FkZWQgPSB7fTtcbiAgICB0aGlzLnF1ZXVlLmZvckVhY2gocSA9PiB7XG4gICAgICBwdXNoUGF0aChxLmxvYWRlZCwgW2xuZ10sIG5zKTtcbiAgICAgIHJlbW92ZVBlbmRpbmcocSwgbmFtZSk7XG4gICAgICBpZiAoZXJyKSBxLmVycm9ycy5wdXNoKGVycik7XG4gICAgICBpZiAocS5wZW5kaW5nQ291bnQgPT09IDAgJiYgIXEuZG9uZSkge1xuICAgICAgICBPYmplY3Qua2V5cyhxLmxvYWRlZCkuZm9yRWFjaChsID0+IHtcbiAgICAgICAgICBpZiAoIWxvYWRlZFtsXSkgbG9hZGVkW2xdID0ge307XG4gICAgICAgICAgY29uc3QgbG9hZGVkS2V5cyA9IHEubG9hZGVkW2xdO1xuICAgICAgICAgIGlmIChsb2FkZWRLZXlzLmxlbmd0aCkge1xuICAgICAgICAgICAgbG9hZGVkS2V5cy5mb3JFYWNoKG4gPT4ge1xuICAgICAgICAgICAgICBpZiAobG9hZGVkW2xdW25dID09PSB1bmRlZmluZWQpIGxvYWRlZFtsXVtuXSA9IHRydWU7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICBxLmRvbmUgPSB0cnVlO1xuICAgICAgICBpZiAocS5lcnJvcnMubGVuZ3RoKSB7XG4gICAgICAgICAgcS5jYWxsYmFjayhxLmVycm9ycyk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgcS5jYWxsYmFjaygpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSk7XG4gICAgdGhpcy5lbWl0KCdsb2FkZWQnLCBsb2FkZWQpO1xuICAgIHRoaXMucXVldWUgPSB0aGlzLnF1ZXVlLmZpbHRlcihxID0+ICFxLmRvbmUpO1xuICB9XG4gIHJlYWQobG5nLCBucywgZmNOYW1lLCB0cmllZCA9IDAsIHdhaXQgPSB0aGlzLnJldHJ5VGltZW91dCwgY2FsbGJhY2spIHtcbiAgICBpZiAoIWxuZy5sZW5ndGgpIHJldHVybiBjYWxsYmFjayhudWxsLCB7fSk7XG4gICAgaWYgKHRoaXMucmVhZGluZ0NhbGxzID49IHRoaXMubWF4UGFyYWxsZWxSZWFkcykge1xuICAgICAgdGhpcy53YWl0aW5nUmVhZHMucHVzaCh7XG4gICAgICAgIGxuZyxcbiAgICAgICAgbnMsXG4gICAgICAgIGZjTmFtZSxcbiAgICAgICAgdHJpZWQsXG4gICAgICAgIHdhaXQsXG4gICAgICAgIGNhbGxiYWNrXG4gICAgICB9KTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdGhpcy5yZWFkaW5nQ2FsbHMrKztcbiAgICBjb25zdCByZXNvbHZlciA9IChlcnIsIGRhdGEpID0+IHtcbiAgICAgIHRoaXMucmVhZGluZ0NhbGxzLS07XG4gICAgICBpZiAodGhpcy53YWl0aW5nUmVhZHMubGVuZ3RoID4gMCkge1xuICAgICAgICBjb25zdCBuZXh0ID0gdGhpcy53YWl0aW5nUmVhZHMuc2hpZnQoKTtcbiAgICAgICAgdGhpcy5yZWFkKG5leHQubG5nLCBuZXh0Lm5zLCBuZXh0LmZjTmFtZSwgbmV4dC50cmllZCwgbmV4dC53YWl0LCBuZXh0LmNhbGxiYWNrKTtcbiAgICAgIH1cbiAgICAgIGlmIChlcnIgJiYgZGF0YSAmJiB0cmllZCA8IHRoaXMubWF4UmV0cmllcykge1xuICAgICAgICBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgICB0aGlzLnJlYWQuY2FsbCh0aGlzLCBsbmcsIG5zLCBmY05hbWUsIHRyaWVkICsgMSwgd2FpdCAqIDIsIGNhbGxiYWNrKTtcbiAgICAgICAgfSwgd2FpdCk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIGNhbGxiYWNrKGVyciwgZGF0YSk7XG4gICAgfTtcbiAgICBjb25zdCBmYyA9IHRoaXMuYmFja2VuZFtmY05hbWVdLmJpbmQodGhpcy5iYWNrZW5kKTtcbiAgICBpZiAoZmMubGVuZ3RoID09PSAyKSB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCByID0gZmMobG5nLCBucyk7XG4gICAgICAgIGlmIChyICYmIHR5cGVvZiByLnRoZW4gPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgICByLnRoZW4oZGF0YSA9PiByZXNvbHZlcihudWxsLCBkYXRhKSkuY2F0Y2gocmVzb2x2ZXIpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHJlc29sdmVyKG51bGwsIHIpO1xuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgcmVzb2x2ZXIoZXJyKTtcbiAgICAgIH1cbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgcmV0dXJuIGZjKGxuZywgbnMsIHJlc29sdmVyKTtcbiAgfVxuICBwcmVwYXJlTG9hZGluZyhsYW5ndWFnZXMsIG5hbWVzcGFjZXMsIG9wdGlvbnMgPSB7fSwgY2FsbGJhY2spIHtcbiAgICBpZiAoIXRoaXMuYmFja2VuZCkge1xuICAgICAgdGhpcy5sb2dnZXIud2FybignTm8gYmFja2VuZCB3YXMgYWRkZWQgdmlhIGkxOG5leHQudXNlLiBXaWxsIG5vdCBsb2FkIHJlc291cmNlcy4nKTtcbiAgICAgIHJldHVybiBjYWxsYmFjayAmJiBjYWxsYmFjaygpO1xuICAgIH1cbiAgICBpZiAoaXNTdHJpbmcobGFuZ3VhZ2VzKSkgbGFuZ3VhZ2VzID0gdGhpcy5sYW5ndWFnZVV0aWxzLnRvUmVzb2x2ZUhpZXJhcmNoeShsYW5ndWFnZXMpO1xuICAgIGlmIChpc1N0cmluZyhuYW1lc3BhY2VzKSkgbmFtZXNwYWNlcyA9IFtuYW1lc3BhY2VzXTtcbiAgICBjb25zdCB0b0xvYWQgPSB0aGlzLnF1ZXVlTG9hZChsYW5ndWFnZXMsIG5hbWVzcGFjZXMsIG9wdGlvbnMsIGNhbGxiYWNrKTtcbiAgICBpZiAoIXRvTG9hZC50b0xvYWQubGVuZ3RoKSB7XG4gICAgICBpZiAoIXRvTG9hZC5wZW5kaW5nLmxlbmd0aCkgY2FsbGJhY2soKTtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cbiAgICB0b0xvYWQudG9Mb2FkLmZvckVhY2gobmFtZSA9PiB7XG4gICAgICB0aGlzLmxvYWRPbmUobmFtZSk7XG4gICAgfSk7XG4gIH1cbiAgbG9hZChsYW5ndWFnZXMsIG5hbWVzcGFjZXMsIGNhbGxiYWNrKSB7XG4gICAgdGhpcy5wcmVwYXJlTG9hZGluZyhsYW5ndWFnZXMsIG5hbWVzcGFjZXMsIHt9LCBjYWxsYmFjayk7XG4gIH1cbiAgcmVsb2FkKGxhbmd1YWdlcywgbmFtZXNwYWNlcywgY2FsbGJhY2spIHtcbiAgICB0aGlzLnByZXBhcmVMb2FkaW5nKGxhbmd1YWdlcywgbmFtZXNwYWNlcywge1xuICAgICAgcmVsb2FkOiB0cnVlXG4gICAgfSwgY2FsbGJhY2spO1xuICB9XG4gIGxvYWRPbmUobmFtZSwgcHJlZml4ID0gJycpIHtcbiAgICBjb25zdCBzID0gbmFtZS5zcGxpdCgnfCcpO1xuICAgIGNvbnN0IGxuZyA9IHNbMF07XG4gICAgY29uc3QgbnMgPSBzWzFdO1xuICAgIHRoaXMucmVhZChsbmcsIG5zLCAncmVhZCcsIHVuZGVmaW5lZCwgdW5kZWZpbmVkLCAoZXJyLCBkYXRhKSA9PiB7XG4gICAgICBpZiAoZXJyKSB0aGlzLmxvZ2dlci53YXJuKGAke3ByZWZpeH1sb2FkaW5nIG5hbWVzcGFjZSAke25zfSBmb3IgbGFuZ3VhZ2UgJHtsbmd9IGZhaWxlZGAsIGVycik7XG4gICAgICBpZiAoIWVyciAmJiBkYXRhKSB0aGlzLmxvZ2dlci5sb2coYCR7cHJlZml4fWxvYWRlZCBuYW1lc3BhY2UgJHtuc30gZm9yIGxhbmd1YWdlICR7bG5nfWAsIGRhdGEpO1xuICAgICAgdGhpcy5sb2FkZWQobmFtZSwgZXJyLCBkYXRhKTtcbiAgICB9KTtcbiAgfVxuICBzYXZlTWlzc2luZyhsYW5ndWFnZXMsIG5hbWVzcGFjZSwga2V5LCBmYWxsYmFja1ZhbHVlLCBpc1VwZGF0ZSwgb3B0aW9ucyA9IHt9LCBjbGIgPSAoKSA9PiB7fSkge1xuICAgIGlmICh0aGlzLnNlcnZpY2VzPy51dGlscz8uaGFzTG9hZGVkTmFtZXNwYWNlICYmICF0aGlzLnNlcnZpY2VzPy51dGlscz8uaGFzTG9hZGVkTmFtZXNwYWNlKG5hbWVzcGFjZSkpIHtcbiAgICAgIHRoaXMubG9nZ2VyLndhcm4oYGRpZCBub3Qgc2F2ZSBrZXkgXCIke2tleX1cIiBhcyB0aGUgbmFtZXNwYWNlIFwiJHtuYW1lc3BhY2V9XCIgd2FzIG5vdCB5ZXQgbG9hZGVkYCwgJ1RoaXMgbWVhbnMgc29tZXRoaW5nIElTIFdST05HIGluIHlvdXIgc2V0dXAuIFlvdSBhY2Nlc3MgdGhlIHQgZnVuY3Rpb24gYmVmb3JlIGkxOG5leHQuaW5pdCAvIGkxOG5leHQubG9hZE5hbWVzcGFjZSAvIGkxOG5leHQuY2hhbmdlTGFuZ3VhZ2Ugd2FzIGRvbmUuIFdhaXQgZm9yIHRoZSBjYWxsYmFjayBvciBQcm9taXNlIHRvIHJlc29sdmUgYmVmb3JlIGFjY2Vzc2luZyBpdCEhIScpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAoa2V5ID09PSB1bmRlZmluZWQgfHwga2V5ID09PSBudWxsIHx8IGtleSA9PT0gJycpIHJldHVybjtcbiAgICBpZiAodGhpcy5iYWNrZW5kPy5jcmVhdGUpIHtcbiAgICAgIGNvbnN0IG9wdHMgPSB7XG4gICAgICAgIC4uLm9wdGlvbnMsXG4gICAgICAgIGlzVXBkYXRlXG4gICAgICB9O1xuICAgICAgY29uc3QgZmMgPSB0aGlzLmJhY2tlbmQuY3JlYXRlLmJpbmQodGhpcy5iYWNrZW5kKTtcbiAgICAgIGlmIChmYy5sZW5ndGggPCA2KSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgbGV0IHI7XG4gICAgICAgICAgaWYgKGZjLmxlbmd0aCA9PT0gNSkge1xuICAgICAgICAgICAgciA9IGZjKGxhbmd1YWdlcywgbmFtZXNwYWNlLCBrZXksIGZhbGxiYWNrVmFsdWUsIG9wdHMpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICByID0gZmMobGFuZ3VhZ2VzLCBuYW1lc3BhY2UsIGtleSwgZmFsbGJhY2tWYWx1ZSk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmIChyICYmIHR5cGVvZiByLnRoZW4gPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgICAgIHIudGhlbihkYXRhID0+IGNsYihudWxsLCBkYXRhKSkuY2F0Y2goY2xiKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgY2xiKG51bGwsIHIpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgICAgY2xiKGVycik7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGZjKGxhbmd1YWdlcywgbmFtZXNwYWNlLCBrZXksIGZhbGxiYWNrVmFsdWUsIGNsYiwgb3B0cyk7XG4gICAgICB9XG4gICAgfVxuICAgIGlmICghbGFuZ3VhZ2VzIHx8ICFsYW5ndWFnZXNbMF0pIHJldHVybjtcbiAgICB0aGlzLnN0b3JlLmFkZFJlc291cmNlKGxhbmd1YWdlc1swXSwgbmFtZXNwYWNlLCBrZXksIGZhbGxiYWNrVmFsdWUpO1xuICB9XG59XG5cbmNvbnN0IGdldCA9ICgpID0+ICh7XG4gIGRlYnVnOiBmYWxzZSxcbiAgaW5pdEFzeW5jOiB0cnVlLFxuICBuczogWyd0cmFuc2xhdGlvbiddLFxuICBkZWZhdWx0TlM6IFsndHJhbnNsYXRpb24nXSxcbiAgZmFsbGJhY2tMbmc6IFsnZGV2J10sXG4gIGZhbGxiYWNrTlM6IGZhbHNlLFxuICBzdXBwb3J0ZWRMbmdzOiBmYWxzZSxcbiAgbm9uRXhwbGljaXRTdXBwb3J0ZWRMbmdzOiBmYWxzZSxcbiAgbG9hZDogJ2FsbCcsXG4gIHByZWxvYWQ6IGZhbHNlLFxuICBzaW1wbGlmeVBsdXJhbFN1ZmZpeDogdHJ1ZSxcbiAga2V5U2VwYXJhdG9yOiAnLicsXG4gIG5zU2VwYXJhdG9yOiAnOicsXG4gIHBsdXJhbFNlcGFyYXRvcjogJ18nLFxuICBjb250ZXh0U2VwYXJhdG9yOiAnXycsXG4gIHBhcnRpYWxCdW5kbGVkTGFuZ3VhZ2VzOiBmYWxzZSxcbiAgc2F2ZU1pc3Npbmc6IGZhbHNlLFxuICB1cGRhdGVNaXNzaW5nOiBmYWxzZSxcbiAgc2F2ZU1pc3NpbmdUbzogJ2ZhbGxiYWNrJyxcbiAgc2F2ZU1pc3NpbmdQbHVyYWxzOiB0cnVlLFxuICBtaXNzaW5nS2V5SGFuZGxlcjogZmFsc2UsXG4gIG1pc3NpbmdJbnRlcnBvbGF0aW9uSGFuZGxlcjogZmFsc2UsXG4gIHBvc3RQcm9jZXNzOiBmYWxzZSxcbiAgcG9zdFByb2Nlc3NQYXNzUmVzb2x2ZWQ6IGZhbHNlLFxuICByZXR1cm5OdWxsOiBmYWxzZSxcbiAgcmV0dXJuRW1wdHlTdHJpbmc6IHRydWUsXG4gIHJldHVybk9iamVjdHM6IGZhbHNlLFxuICBqb2luQXJyYXlzOiBmYWxzZSxcbiAgcmV0dXJuZWRPYmplY3RIYW5kbGVyOiBmYWxzZSxcbiAgcGFyc2VNaXNzaW5nS2V5SGFuZGxlcjogZmFsc2UsXG4gIGFwcGVuZE5hbWVzcGFjZVRvTWlzc2luZ0tleTogZmFsc2UsXG4gIGFwcGVuZE5hbWVzcGFjZVRvQ0lNb2RlOiBmYWxzZSxcbiAgb3ZlcmxvYWRUcmFuc2xhdGlvbk9wdGlvbkhhbmRsZXI6IGFyZ3MgPT4ge1xuICAgIGxldCByZXQgPSB7fTtcbiAgICBpZiAodHlwZW9mIGFyZ3NbMV0gPT09ICdvYmplY3QnKSByZXQgPSBhcmdzWzFdO1xuICAgIGlmIChpc1N0cmluZyhhcmdzWzFdKSkgcmV0LmRlZmF1bHRWYWx1ZSA9IGFyZ3NbMV07XG4gICAgaWYgKGlzU3RyaW5nKGFyZ3NbMl0pKSByZXQudERlc2NyaXB0aW9uID0gYXJnc1syXTtcbiAgICBpZiAodHlwZW9mIGFyZ3NbMl0gPT09ICdvYmplY3QnIHx8IHR5cGVvZiBhcmdzWzNdID09PSAnb2JqZWN0Jykge1xuICAgICAgY29uc3Qgb3B0aW9ucyA9IGFyZ3NbM10gfHwgYXJnc1syXTtcbiAgICAgIE9iamVjdC5rZXlzKG9wdGlvbnMpLmZvckVhY2goa2V5ID0+IHtcbiAgICAgICAgcmV0W2tleV0gPSBvcHRpb25zW2tleV07XG4gICAgICB9KTtcbiAgICB9XG4gICAgcmV0dXJuIHJldDtcbiAgfSxcbiAgaW50ZXJwb2xhdGlvbjoge1xuICAgIGVzY2FwZVZhbHVlOiB0cnVlLFxuICAgIGZvcm1hdDogdmFsdWUgPT4gdmFsdWUsXG4gICAgcHJlZml4OiAne3snLFxuICAgIHN1ZmZpeDogJ319JyxcbiAgICBmb3JtYXRTZXBhcmF0b3I6ICcsJyxcbiAgICB1bmVzY2FwZVByZWZpeDogJy0nLFxuICAgIG5lc3RpbmdQcmVmaXg6ICckdCgnLFxuICAgIG5lc3RpbmdTdWZmaXg6ICcpJyxcbiAgICBuZXN0aW5nT3B0aW9uc1NlcGFyYXRvcjogJywnLFxuICAgIG1heFJlcGxhY2VzOiAxMDAwLFxuICAgIHNraXBPblZhcmlhYmxlczogdHJ1ZVxuICB9LFxuICBjYWNoZUluQnVpbHRGb3JtYXRzOiB0cnVlXG59KTtcbmNvbnN0IHRyYW5zZm9ybU9wdGlvbnMgPSBvcHRpb25zID0+IHtcbiAgaWYgKGlzU3RyaW5nKG9wdGlvbnMubnMpKSBvcHRpb25zLm5zID0gW29wdGlvbnMubnNdO1xuICBpZiAoaXNTdHJpbmcob3B0aW9ucy5mYWxsYmFja0xuZykpIG9wdGlvbnMuZmFsbGJhY2tMbmcgPSBbb3B0aW9ucy5mYWxsYmFja0xuZ107XG4gIGlmIChpc1N0cmluZyhvcHRpb25zLmZhbGxiYWNrTlMpKSBvcHRpb25zLmZhbGxiYWNrTlMgPSBbb3B0aW9ucy5mYWxsYmFja05TXTtcbiAgaWYgKG9wdGlvbnMuc3VwcG9ydGVkTG5ncz8uaW5kZXhPZj8uKCdjaW1vZGUnKSA8IDApIHtcbiAgICBvcHRpb25zLnN1cHBvcnRlZExuZ3MgPSBvcHRpb25zLnN1cHBvcnRlZExuZ3MuY29uY2F0KFsnY2ltb2RlJ10pO1xuICB9XG4gIGlmICh0eXBlb2Ygb3B0aW9ucy5pbml0SW1tZWRpYXRlID09PSAnYm9vbGVhbicpIG9wdGlvbnMuaW5pdEFzeW5jID0gb3B0aW9ucy5pbml0SW1tZWRpYXRlO1xuICByZXR1cm4gb3B0aW9ucztcbn07XG5cbmNvbnN0IG5vb3AgPSAoKSA9PiB7fTtcbmNvbnN0IGJpbmRNZW1iZXJGdW5jdGlvbnMgPSBpbnN0ID0+IHtcbiAgY29uc3QgbWVtcyA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eU5hbWVzKE9iamVjdC5nZXRQcm90b3R5cGVPZihpbnN0KSk7XG4gIG1lbXMuZm9yRWFjaChtZW0gPT4ge1xuICAgIGlmICh0eXBlb2YgaW5zdFttZW1dID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICBpbnN0W21lbV0gPSBpbnN0W21lbV0uYmluZChpbnN0KTtcbiAgICB9XG4gIH0pO1xufTtcbmNsYXNzIEkxOG4gZXh0ZW5kcyBFdmVudEVtaXR0ZXIge1xuICBjb25zdHJ1Y3RvcihvcHRpb25zID0ge30sIGNhbGxiYWNrKSB7XG4gICAgc3VwZXIoKTtcbiAgICB0aGlzLm9wdGlvbnMgPSB0cmFuc2Zvcm1PcHRpb25zKG9wdGlvbnMpO1xuICAgIHRoaXMuc2VydmljZXMgPSB7fTtcbiAgICB0aGlzLmxvZ2dlciA9IGJhc2VMb2dnZXI7XG4gICAgdGhpcy5tb2R1bGVzID0ge1xuICAgICAgZXh0ZXJuYWw6IFtdXG4gICAgfTtcbiAgICBiaW5kTWVtYmVyRnVuY3Rpb25zKHRoaXMpO1xuICAgIGlmIChjYWxsYmFjayAmJiAhdGhpcy5pc0luaXRpYWxpemVkICYmICFvcHRpb25zLmlzQ2xvbmUpIHtcbiAgICAgIGlmICghdGhpcy5vcHRpb25zLmluaXRBc3luYykge1xuICAgICAgICB0aGlzLmluaXQob3B0aW9ucywgY2FsbGJhY2spO1xuICAgICAgICByZXR1cm4gdGhpcztcbiAgICAgIH1cbiAgICAgIHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICB0aGlzLmluaXQob3B0aW9ucywgY2FsbGJhY2spO1xuICAgICAgfSwgMCk7XG4gICAgfVxuICB9XG4gIGluaXQob3B0aW9ucyA9IHt9LCBjYWxsYmFjaykge1xuICAgIHRoaXMuaXNJbml0aWFsaXppbmcgPSB0cnVlO1xuICAgIGlmICh0eXBlb2Ygb3B0aW9ucyA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgY2FsbGJhY2sgPSBvcHRpb25zO1xuICAgICAgb3B0aW9ucyA9IHt9O1xuICAgIH1cbiAgICBpZiAob3B0aW9ucy5kZWZhdWx0TlMgPT0gbnVsbCAmJiBvcHRpb25zLm5zKSB7XG4gICAgICBpZiAoaXNTdHJpbmcob3B0aW9ucy5ucykpIHtcbiAgICAgICAgb3B0aW9ucy5kZWZhdWx0TlMgPSBvcHRpb25zLm5zO1xuICAgICAgfSBlbHNlIGlmIChvcHRpb25zLm5zLmluZGV4T2YoJ3RyYW5zbGF0aW9uJykgPCAwKSB7XG4gICAgICAgIG9wdGlvbnMuZGVmYXVsdE5TID0gb3B0aW9ucy5uc1swXTtcbiAgICAgIH1cbiAgICB9XG4gICAgY29uc3QgZGVmT3B0cyA9IGdldCgpO1xuICAgIHRoaXMub3B0aW9ucyA9IHtcbiAgICAgIC4uLmRlZk9wdHMsXG4gICAgICAuLi50aGlzLm9wdGlvbnMsXG4gICAgICAuLi50cmFuc2Zvcm1PcHRpb25zKG9wdGlvbnMpXG4gICAgfTtcbiAgICB0aGlzLm9wdGlvbnMuaW50ZXJwb2xhdGlvbiA9IHtcbiAgICAgIC4uLmRlZk9wdHMuaW50ZXJwb2xhdGlvbixcbiAgICAgIC4uLnRoaXMub3B0aW9ucy5pbnRlcnBvbGF0aW9uXG4gICAgfTtcbiAgICBpZiAob3B0aW9ucy5rZXlTZXBhcmF0b3IgIT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhpcy5vcHRpb25zLnVzZXJEZWZpbmVkS2V5U2VwYXJhdG9yID0gb3B0aW9ucy5rZXlTZXBhcmF0b3I7XG4gICAgfVxuICAgIGlmIChvcHRpb25zLm5zU2VwYXJhdG9yICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHRoaXMub3B0aW9ucy51c2VyRGVmaW5lZE5zU2VwYXJhdG9yID0gb3B0aW9ucy5uc1NlcGFyYXRvcjtcbiAgICB9XG4gICAgY29uc3QgY3JlYXRlQ2xhc3NPbkRlbWFuZCA9IENsYXNzT3JPYmplY3QgPT4ge1xuICAgICAgaWYgKCFDbGFzc09yT2JqZWN0KSByZXR1cm4gbnVsbDtcbiAgICAgIGlmICh0eXBlb2YgQ2xhc3NPck9iamVjdCA9PT0gJ2Z1bmN0aW9uJykgcmV0dXJuIG5ldyBDbGFzc09yT2JqZWN0KCk7XG4gICAgICByZXR1cm4gQ2xhc3NPck9iamVjdDtcbiAgICB9O1xuICAgIGlmICghdGhpcy5vcHRpb25zLmlzQ2xvbmUpIHtcbiAgICAgIGlmICh0aGlzLm1vZHVsZXMubG9nZ2VyKSB7XG4gICAgICAgIGJhc2VMb2dnZXIuaW5pdChjcmVhdGVDbGFzc09uRGVtYW5kKHRoaXMubW9kdWxlcy5sb2dnZXIpLCB0aGlzLm9wdGlvbnMpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgYmFzZUxvZ2dlci5pbml0KG51bGwsIHRoaXMub3B0aW9ucyk7XG4gICAgICB9XG4gICAgICBsZXQgZm9ybWF0dGVyO1xuICAgICAgaWYgKHRoaXMubW9kdWxlcy5mb3JtYXR0ZXIpIHtcbiAgICAgICAgZm9ybWF0dGVyID0gdGhpcy5tb2R1bGVzLmZvcm1hdHRlcjtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGZvcm1hdHRlciA9IEZvcm1hdHRlcjtcbiAgICAgIH1cbiAgICAgIGNvbnN0IGx1ID0gbmV3IExhbmd1YWdlVXRpbCh0aGlzLm9wdGlvbnMpO1xuICAgICAgdGhpcy5zdG9yZSA9IG5ldyBSZXNvdXJjZVN0b3JlKHRoaXMub3B0aW9ucy5yZXNvdXJjZXMsIHRoaXMub3B0aW9ucyk7XG4gICAgICBjb25zdCBzID0gdGhpcy5zZXJ2aWNlcztcbiAgICAgIHMubG9nZ2VyID0gYmFzZUxvZ2dlcjtcbiAgICAgIHMucmVzb3VyY2VTdG9yZSA9IHRoaXMuc3RvcmU7XG4gICAgICBzLmxhbmd1YWdlVXRpbHMgPSBsdTtcbiAgICAgIHMucGx1cmFsUmVzb2x2ZXIgPSBuZXcgUGx1cmFsUmVzb2x2ZXIobHUsIHtcbiAgICAgICAgcHJlcGVuZDogdGhpcy5vcHRpb25zLnBsdXJhbFNlcGFyYXRvcixcbiAgICAgICAgc2ltcGxpZnlQbHVyYWxTdWZmaXg6IHRoaXMub3B0aW9ucy5zaW1wbGlmeVBsdXJhbFN1ZmZpeFxuICAgICAgfSk7XG4gICAgICBjb25zdCB1c2luZ0xlZ2FjeUZvcm1hdEZ1bmN0aW9uID0gdGhpcy5vcHRpb25zLmludGVycG9sYXRpb24uZm9ybWF0ICYmIHRoaXMub3B0aW9ucy5pbnRlcnBvbGF0aW9uLmZvcm1hdCAhPT0gZGVmT3B0cy5pbnRlcnBvbGF0aW9uLmZvcm1hdDtcbiAgICAgIGlmICh1c2luZ0xlZ2FjeUZvcm1hdEZ1bmN0aW9uKSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLndhcm4oYGluaXQ6IHlvdSBhcmUgc3RpbGwgdXNpbmcgdGhlIGxlZ2FjeSBmb3JtYXQgZnVuY3Rpb24sIHBsZWFzZSB1c2UgdGhlIG5ldyBhcHByb2FjaDogaHR0cHM6Ly93d3cuaTE4bmV4dC5jb20vdHJhbnNsYXRpb24tZnVuY3Rpb24vZm9ybWF0dGluZ2ApO1xuICAgICAgfVxuICAgICAgaWYgKGZvcm1hdHRlciAmJiAoIXRoaXMub3B0aW9ucy5pbnRlcnBvbGF0aW9uLmZvcm1hdCB8fCB0aGlzLm9wdGlvbnMuaW50ZXJwb2xhdGlvbi5mb3JtYXQgPT09IGRlZk9wdHMuaW50ZXJwb2xhdGlvbi5mb3JtYXQpKSB7XG4gICAgICAgIHMuZm9ybWF0dGVyID0gY3JlYXRlQ2xhc3NPbkRlbWFuZChmb3JtYXR0ZXIpO1xuICAgICAgICBpZiAocy5mb3JtYXR0ZXIuaW5pdCkgcy5mb3JtYXR0ZXIuaW5pdChzLCB0aGlzLm9wdGlvbnMpO1xuICAgICAgICB0aGlzLm9wdGlvbnMuaW50ZXJwb2xhdGlvbi5mb3JtYXQgPSBzLmZvcm1hdHRlci5mb3JtYXQuYmluZChzLmZvcm1hdHRlcik7XG4gICAgICB9XG4gICAgICBzLmludGVycG9sYXRvciA9IG5ldyBJbnRlcnBvbGF0b3IodGhpcy5vcHRpb25zKTtcbiAgICAgIHMudXRpbHMgPSB7XG4gICAgICAgIGhhc0xvYWRlZE5hbWVzcGFjZTogdGhpcy5oYXNMb2FkZWROYW1lc3BhY2UuYmluZCh0aGlzKVxuICAgICAgfTtcbiAgICAgIHMuYmFja2VuZENvbm5lY3RvciA9IG5ldyBDb25uZWN0b3IoY3JlYXRlQ2xhc3NPbkRlbWFuZCh0aGlzLm1vZHVsZXMuYmFja2VuZCksIHMucmVzb3VyY2VTdG9yZSwgcywgdGhpcy5vcHRpb25zKTtcbiAgICAgIHMuYmFja2VuZENvbm5lY3Rvci5vbignKicsIChldmVudCwgLi4uYXJncykgPT4ge1xuICAgICAgICB0aGlzLmVtaXQoZXZlbnQsIC4uLmFyZ3MpO1xuICAgICAgfSk7XG4gICAgICBpZiAodGhpcy5tb2R1bGVzLmxhbmd1YWdlRGV0ZWN0b3IpIHtcbiAgICAgICAgcy5sYW5ndWFnZURldGVjdG9yID0gY3JlYXRlQ2xhc3NPbkRlbWFuZCh0aGlzLm1vZHVsZXMubGFuZ3VhZ2VEZXRlY3Rvcik7XG4gICAgICAgIGlmIChzLmxhbmd1YWdlRGV0ZWN0b3IuaW5pdCkgcy5sYW5ndWFnZURldGVjdG9yLmluaXQocywgdGhpcy5vcHRpb25zLmRldGVjdGlvbiwgdGhpcy5vcHRpb25zKTtcbiAgICAgIH1cbiAgICAgIGlmICh0aGlzLm1vZHVsZXMuaTE4bkZvcm1hdCkge1xuICAgICAgICBzLmkxOG5Gb3JtYXQgPSBjcmVhdGVDbGFzc09uRGVtYW5kKHRoaXMubW9kdWxlcy5pMThuRm9ybWF0KTtcbiAgICAgICAgaWYgKHMuaTE4bkZvcm1hdC5pbml0KSBzLmkxOG5Gb3JtYXQuaW5pdCh0aGlzKTtcbiAgICAgIH1cbiAgICAgIHRoaXMudHJhbnNsYXRvciA9IG5ldyBUcmFuc2xhdG9yKHRoaXMuc2VydmljZXMsIHRoaXMub3B0aW9ucyk7XG4gICAgICB0aGlzLnRyYW5zbGF0b3Iub24oJyonLCAoZXZlbnQsIC4uLmFyZ3MpID0+IHtcbiAgICAgICAgdGhpcy5lbWl0KGV2ZW50LCAuLi5hcmdzKTtcbiAgICAgIH0pO1xuICAgICAgdGhpcy5tb2R1bGVzLmV4dGVybmFsLmZvckVhY2gobSA9PiB7XG4gICAgICAgIGlmIChtLmluaXQpIG0uaW5pdCh0aGlzKTtcbiAgICAgIH0pO1xuICAgIH1cbiAgICB0aGlzLmZvcm1hdCA9IHRoaXMub3B0aW9ucy5pbnRlcnBvbGF0aW9uLmZvcm1hdDtcbiAgICBpZiAoIWNhbGxiYWNrKSBjYWxsYmFjayA9IG5vb3A7XG4gICAgaWYgKHRoaXMub3B0aW9ucy5mYWxsYmFja0xuZyAmJiAhdGhpcy5zZXJ2aWNlcy5sYW5ndWFnZURldGVjdG9yICYmICF0aGlzLm9wdGlvbnMubG5nKSB7XG4gICAgICBjb25zdCBjb2RlcyA9IHRoaXMuc2VydmljZXMubGFuZ3VhZ2VVdGlscy5nZXRGYWxsYmFja0NvZGVzKHRoaXMub3B0aW9ucy5mYWxsYmFja0xuZyk7XG4gICAgICBpZiAoY29kZXMubGVuZ3RoID4gMCAmJiBjb2Rlc1swXSAhPT0gJ2RldicpIHRoaXMub3B0aW9ucy5sbmcgPSBjb2Rlc1swXTtcbiAgICB9XG4gICAgaWYgKCF0aGlzLnNlcnZpY2VzLmxhbmd1YWdlRGV0ZWN0b3IgJiYgIXRoaXMub3B0aW9ucy5sbmcpIHtcbiAgICAgIHRoaXMubG9nZ2VyLndhcm4oJ2luaXQ6IG5vIGxhbmd1YWdlRGV0ZWN0b3IgaXMgdXNlZCBhbmQgbm8gbG5nIGlzIGRlZmluZWQnKTtcbiAgICB9XG4gICAgY29uc3Qgc3RvcmVBcGkgPSBbJ2dldFJlc291cmNlJywgJ2hhc1Jlc291cmNlQnVuZGxlJywgJ2dldFJlc291cmNlQnVuZGxlJywgJ2dldERhdGFCeUxhbmd1YWdlJ107XG4gICAgc3RvcmVBcGkuZm9yRWFjaChmY05hbWUgPT4ge1xuICAgICAgdGhpc1tmY05hbWVdID0gKC4uLmFyZ3MpID0+IHRoaXMuc3RvcmVbZmNOYW1lXSguLi5hcmdzKTtcbiAgICB9KTtcbiAgICBjb25zdCBzdG9yZUFwaUNoYWluZWQgPSBbJ2FkZFJlc291cmNlJywgJ2FkZFJlc291cmNlcycsICdhZGRSZXNvdXJjZUJ1bmRsZScsICdyZW1vdmVSZXNvdXJjZUJ1bmRsZSddO1xuICAgIHN0b3JlQXBpQ2hhaW5lZC5mb3JFYWNoKGZjTmFtZSA9PiB7XG4gICAgICB0aGlzW2ZjTmFtZV0gPSAoLi4uYXJncykgPT4ge1xuICAgICAgICB0aGlzLnN0b3JlW2ZjTmFtZV0oLi4uYXJncyk7XG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgICAgfTtcbiAgICB9KTtcbiAgICBjb25zdCBkZWZlcnJlZCA9IGRlZmVyKCk7XG4gICAgY29uc3QgbG9hZCA9ICgpID0+IHtcbiAgICAgIGNvbnN0IGZpbmlzaCA9IChlcnIsIHQpID0+IHtcbiAgICAgICAgdGhpcy5pc0luaXRpYWxpemluZyA9IGZhbHNlO1xuICAgICAgICBpZiAodGhpcy5pc0luaXRpYWxpemVkICYmICF0aGlzLmluaXRpYWxpemVkU3RvcmVPbmNlKSB0aGlzLmxvZ2dlci53YXJuKCdpbml0OiBpMThuZXh0IGlzIGFscmVhZHkgaW5pdGlhbGl6ZWQuIFlvdSBzaG91bGQgY2FsbCBpbml0IGp1c3Qgb25jZSEnKTtcbiAgICAgICAgdGhpcy5pc0luaXRpYWxpemVkID0gdHJ1ZTtcbiAgICAgICAgaWYgKCF0aGlzLm9wdGlvbnMuaXNDbG9uZSkgdGhpcy5sb2dnZXIubG9nKCdpbml0aWFsaXplZCcsIHRoaXMub3B0aW9ucyk7XG4gICAgICAgIHRoaXMuZW1pdCgnaW5pdGlhbGl6ZWQnLCB0aGlzLm9wdGlvbnMpO1xuICAgICAgICBkZWZlcnJlZC5yZXNvbHZlKHQpO1xuICAgICAgICBjYWxsYmFjayhlcnIsIHQpO1xuICAgICAgfTtcbiAgICAgIGlmICh0aGlzLmxhbmd1YWdlcyAmJiAhdGhpcy5pc0luaXRpYWxpemVkKSByZXR1cm4gZmluaXNoKG51bGwsIHRoaXMudC5iaW5kKHRoaXMpKTtcbiAgICAgIHRoaXMuY2hhbmdlTGFuZ3VhZ2UodGhpcy5vcHRpb25zLmxuZywgZmluaXNoKTtcbiAgICB9O1xuICAgIGlmICh0aGlzLm9wdGlvbnMucmVzb3VyY2VzIHx8ICF0aGlzLm9wdGlvbnMuaW5pdEFzeW5jKSB7XG4gICAgICBsb2FkKCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHNldFRpbWVvdXQobG9hZCwgMCk7XG4gICAgfVxuICAgIHJldHVybiBkZWZlcnJlZDtcbiAgfVxuICBsb2FkUmVzb3VyY2VzKGxhbmd1YWdlLCBjYWxsYmFjayA9IG5vb3ApIHtcbiAgICBsZXQgdXNlZENhbGxiYWNrID0gY2FsbGJhY2s7XG4gICAgY29uc3QgdXNlZExuZyA9IGlzU3RyaW5nKGxhbmd1YWdlKSA/IGxhbmd1YWdlIDogdGhpcy5sYW5ndWFnZTtcbiAgICBpZiAodHlwZW9mIGxhbmd1YWdlID09PSAnZnVuY3Rpb24nKSB1c2VkQ2FsbGJhY2sgPSBsYW5ndWFnZTtcbiAgICBpZiAoIXRoaXMub3B0aW9ucy5yZXNvdXJjZXMgfHwgdGhpcy5vcHRpb25zLnBhcnRpYWxCdW5kbGVkTGFuZ3VhZ2VzKSB7XG4gICAgICBpZiAodXNlZExuZz8udG9Mb3dlckNhc2UoKSA9PT0gJ2NpbW9kZScgJiYgKCF0aGlzLm9wdGlvbnMucHJlbG9hZCB8fCB0aGlzLm9wdGlvbnMucHJlbG9hZC5sZW5ndGggPT09IDApKSByZXR1cm4gdXNlZENhbGxiYWNrKCk7XG4gICAgICBjb25zdCB0b0xvYWQgPSBbXTtcbiAgICAgIGNvbnN0IGFwcGVuZCA9IGxuZyA9PiB7XG4gICAgICAgIGlmICghbG5nKSByZXR1cm47XG4gICAgICAgIGlmIChsbmcgPT09ICdjaW1vZGUnKSByZXR1cm47XG4gICAgICAgIGNvbnN0IGxuZ3MgPSB0aGlzLnNlcnZpY2VzLmxhbmd1YWdlVXRpbHMudG9SZXNvbHZlSGllcmFyY2h5KGxuZyk7XG4gICAgICAgIGxuZ3MuZm9yRWFjaChsID0+IHtcbiAgICAgICAgICBpZiAobCA9PT0gJ2NpbW9kZScpIHJldHVybjtcbiAgICAgICAgICBpZiAodG9Mb2FkLmluZGV4T2YobCkgPCAwKSB0b0xvYWQucHVzaChsKTtcbiAgICAgICAgfSk7XG4gICAgICB9O1xuICAgICAgaWYgKCF1c2VkTG5nKSB7XG4gICAgICAgIGNvbnN0IGZhbGxiYWNrcyA9IHRoaXMuc2VydmljZXMubGFuZ3VhZ2VVdGlscy5nZXRGYWxsYmFja0NvZGVzKHRoaXMub3B0aW9ucy5mYWxsYmFja0xuZyk7XG4gICAgICAgIGZhbGxiYWNrcy5mb3JFYWNoKGwgPT4gYXBwZW5kKGwpKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGFwcGVuZCh1c2VkTG5nKTtcbiAgICAgIH1cbiAgICAgIHRoaXMub3B0aW9ucy5wcmVsb2FkPy5mb3JFYWNoPy4obCA9PiBhcHBlbmQobCkpO1xuICAgICAgdGhpcy5zZXJ2aWNlcy5iYWNrZW5kQ29ubmVjdG9yLmxvYWQodG9Mb2FkLCB0aGlzLm9wdGlvbnMubnMsIGUgPT4ge1xuICAgICAgICBpZiAoIWUgJiYgIXRoaXMucmVzb2x2ZWRMYW5ndWFnZSAmJiB0aGlzLmxhbmd1YWdlKSB0aGlzLnNldFJlc29sdmVkTGFuZ3VhZ2UodGhpcy5sYW5ndWFnZSk7XG4gICAgICAgIHVzZWRDYWxsYmFjayhlKTtcbiAgICAgIH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICB1c2VkQ2FsbGJhY2sobnVsbCk7XG4gICAgfVxuICB9XG4gIHJlbG9hZFJlc291cmNlcyhsbmdzLCBucywgY2FsbGJhY2spIHtcbiAgICBjb25zdCBkZWZlcnJlZCA9IGRlZmVyKCk7XG4gICAgaWYgKHR5cGVvZiBsbmdzID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICBjYWxsYmFjayA9IGxuZ3M7XG4gICAgICBsbmdzID0gdW5kZWZpbmVkO1xuICAgIH1cbiAgICBpZiAodHlwZW9mIG5zID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICBjYWxsYmFjayA9IG5zO1xuICAgICAgbnMgPSB1bmRlZmluZWQ7XG4gICAgfVxuICAgIGlmICghbG5ncykgbG5ncyA9IHRoaXMubGFuZ3VhZ2VzO1xuICAgIGlmICghbnMpIG5zID0gdGhpcy5vcHRpb25zLm5zO1xuICAgIGlmICghY2FsbGJhY2spIGNhbGxiYWNrID0gbm9vcDtcbiAgICB0aGlzLnNlcnZpY2VzLmJhY2tlbmRDb25uZWN0b3IucmVsb2FkKGxuZ3MsIG5zLCBlcnIgPT4ge1xuICAgICAgZGVmZXJyZWQucmVzb2x2ZSgpO1xuICAgICAgY2FsbGJhY2soZXJyKTtcbiAgICB9KTtcbiAgICByZXR1cm4gZGVmZXJyZWQ7XG4gIH1cbiAgdXNlKG1vZHVsZSkge1xuICAgIGlmICghbW9kdWxlKSB0aHJvdyBuZXcgRXJyb3IoJ1lvdSBhcmUgcGFzc2luZyBhbiB1bmRlZmluZWQgbW9kdWxlISBQbGVhc2UgY2hlY2sgdGhlIG9iamVjdCB5b3UgYXJlIHBhc3NpbmcgdG8gaTE4bmV4dC51c2UoKScpO1xuICAgIGlmICghbW9kdWxlLnR5cGUpIHRocm93IG5ldyBFcnJvcignWW91IGFyZSBwYXNzaW5nIGEgd3JvbmcgbW9kdWxlISBQbGVhc2UgY2hlY2sgdGhlIG9iamVjdCB5b3UgYXJlIHBhc3NpbmcgdG8gaTE4bmV4dC51c2UoKScpO1xuICAgIGlmIChtb2R1bGUudHlwZSA9PT0gJ2JhY2tlbmQnKSB7XG4gICAgICB0aGlzLm1vZHVsZXMuYmFja2VuZCA9IG1vZHVsZTtcbiAgICB9XG4gICAgaWYgKG1vZHVsZS50eXBlID09PSAnbG9nZ2VyJyB8fCBtb2R1bGUubG9nICYmIG1vZHVsZS53YXJuICYmIG1vZHVsZS5lcnJvcikge1xuICAgICAgdGhpcy5tb2R1bGVzLmxvZ2dlciA9IG1vZHVsZTtcbiAgICB9XG4gICAgaWYgKG1vZHVsZS50eXBlID09PSAnbGFuZ3VhZ2VEZXRlY3RvcicpIHtcbiAgICAgIHRoaXMubW9kdWxlcy5sYW5ndWFnZURldGVjdG9yID0gbW9kdWxlO1xuICAgIH1cbiAgICBpZiAobW9kdWxlLnR5cGUgPT09ICdpMThuRm9ybWF0Jykge1xuICAgICAgdGhpcy5tb2R1bGVzLmkxOG5Gb3JtYXQgPSBtb2R1bGU7XG4gICAgfVxuICAgIGlmIChtb2R1bGUudHlwZSA9PT0gJ3Bvc3RQcm9jZXNzb3InKSB7XG4gICAgICBwb3N0UHJvY2Vzc29yLmFkZFBvc3RQcm9jZXNzb3IobW9kdWxlKTtcbiAgICB9XG4gICAgaWYgKG1vZHVsZS50eXBlID09PSAnZm9ybWF0dGVyJykge1xuICAgICAgdGhpcy5tb2R1bGVzLmZvcm1hdHRlciA9IG1vZHVsZTtcbiAgICB9XG4gICAgaWYgKG1vZHVsZS50eXBlID09PSAnM3JkUGFydHknKSB7XG4gICAgICB0aGlzLm1vZHVsZXMuZXh0ZXJuYWwucHVzaChtb2R1bGUpO1xuICAgIH1cbiAgICByZXR1cm4gdGhpcztcbiAgfVxuICBzZXRSZXNvbHZlZExhbmd1YWdlKGwpIHtcbiAgICBpZiAoIWwgfHwgIXRoaXMubGFuZ3VhZ2VzKSByZXR1cm47XG4gICAgaWYgKFsnY2ltb2RlJywgJ2RldiddLmluZGV4T2YobCkgPiAtMSkgcmV0dXJuO1xuICAgIGZvciAobGV0IGxpID0gMDsgbGkgPCB0aGlzLmxhbmd1YWdlcy5sZW5ndGg7IGxpKyspIHtcbiAgICAgIGNvbnN0IGxuZ0luTG5ncyA9IHRoaXMubGFuZ3VhZ2VzW2xpXTtcbiAgICAgIGlmIChbJ2NpbW9kZScsICdkZXYnXS5pbmRleE9mKGxuZ0luTG5ncykgPiAtMSkgY29udGludWU7XG4gICAgICBpZiAodGhpcy5zdG9yZS5oYXNMYW5ndWFnZVNvbWVUcmFuc2xhdGlvbnMobG5nSW5MbmdzKSkge1xuICAgICAgICB0aGlzLnJlc29sdmVkTGFuZ3VhZ2UgPSBsbmdJbkxuZ3M7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH1cbiAgICBpZiAoIXRoaXMucmVzb2x2ZWRMYW5ndWFnZSAmJiB0aGlzLmxhbmd1YWdlcy5pbmRleE9mKGwpIDwgMCAmJiB0aGlzLnN0b3JlLmhhc0xhbmd1YWdlU29tZVRyYW5zbGF0aW9ucyhsKSkge1xuICAgICAgdGhpcy5yZXNvbHZlZExhbmd1YWdlID0gbDtcbiAgICAgIHRoaXMubGFuZ3VhZ2VzLnVuc2hpZnQobCk7XG4gICAgfVxuICB9XG4gIGNoYW5nZUxhbmd1YWdlKGxuZywgY2FsbGJhY2spIHtcbiAgICB0aGlzLmlzTGFuZ3VhZ2VDaGFuZ2luZ1RvID0gbG5nO1xuICAgIGNvbnN0IGRlZmVycmVkID0gZGVmZXIoKTtcbiAgICB0aGlzLmVtaXQoJ2xhbmd1YWdlQ2hhbmdpbmcnLCBsbmcpO1xuICAgIGNvbnN0IHNldExuZ1Byb3BzID0gbCA9PiB7XG4gICAgICB0aGlzLmxhbmd1YWdlID0gbDtcbiAgICAgIHRoaXMubGFuZ3VhZ2VzID0gdGhpcy5zZXJ2aWNlcy5sYW5ndWFnZVV0aWxzLnRvUmVzb2x2ZUhpZXJhcmNoeShsKTtcbiAgICAgIHRoaXMucmVzb2x2ZWRMYW5ndWFnZSA9IHVuZGVmaW5lZDtcbiAgICAgIHRoaXMuc2V0UmVzb2x2ZWRMYW5ndWFnZShsKTtcbiAgICB9O1xuICAgIGNvbnN0IGRvbmUgPSAoZXJyLCBsKSA9PiB7XG4gICAgICBpZiAobCkge1xuICAgICAgICBpZiAodGhpcy5pc0xhbmd1YWdlQ2hhbmdpbmdUbyA9PT0gbG5nKSB7XG4gICAgICAgICAgc2V0TG5nUHJvcHMobCk7XG4gICAgICAgICAgdGhpcy50cmFuc2xhdG9yLmNoYW5nZUxhbmd1YWdlKGwpO1xuICAgICAgICAgIHRoaXMuaXNMYW5ndWFnZUNoYW5naW5nVG8gPSB1bmRlZmluZWQ7XG4gICAgICAgICAgdGhpcy5lbWl0KCdsYW5ndWFnZUNoYW5nZWQnLCBsKTtcbiAgICAgICAgICB0aGlzLmxvZ2dlci5sb2coJ2xhbmd1YWdlQ2hhbmdlZCcsIGwpO1xuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLmlzTGFuZ3VhZ2VDaGFuZ2luZ1RvID0gdW5kZWZpbmVkO1xuICAgICAgfVxuICAgICAgZGVmZXJyZWQucmVzb2x2ZSgoLi4uYXJncykgPT4gdGhpcy50KC4uLmFyZ3MpKTtcbiAgICAgIGlmIChjYWxsYmFjaykgY2FsbGJhY2soZXJyLCAoLi4uYXJncykgPT4gdGhpcy50KC4uLmFyZ3MpKTtcbiAgICB9O1xuICAgIGNvbnN0IHNldExuZyA9IGxuZ3MgPT4ge1xuICAgICAgaWYgKCFsbmcgJiYgIWxuZ3MgJiYgdGhpcy5zZXJ2aWNlcy5sYW5ndWFnZURldGVjdG9yKSBsbmdzID0gW107XG4gICAgICBjb25zdCBmbCA9IGlzU3RyaW5nKGxuZ3MpID8gbG5ncyA6IGxuZ3MgJiYgbG5nc1swXTtcbiAgICAgIGNvbnN0IGwgPSB0aGlzLnN0b3JlLmhhc0xhbmd1YWdlU29tZVRyYW5zbGF0aW9ucyhmbCkgPyBmbCA6IHRoaXMuc2VydmljZXMubGFuZ3VhZ2VVdGlscy5nZXRCZXN0TWF0Y2hGcm9tQ29kZXMoaXNTdHJpbmcobG5ncykgPyBbbG5nc10gOiBsbmdzKTtcbiAgICAgIGlmIChsKSB7XG4gICAgICAgIGlmICghdGhpcy5sYW5ndWFnZSkge1xuICAgICAgICAgIHNldExuZ1Byb3BzKGwpO1xuICAgICAgICB9XG4gICAgICAgIGlmICghdGhpcy50cmFuc2xhdG9yLmxhbmd1YWdlKSB0aGlzLnRyYW5zbGF0b3IuY2hhbmdlTGFuZ3VhZ2UobCk7XG4gICAgICAgIHRoaXMuc2VydmljZXMubGFuZ3VhZ2VEZXRlY3Rvcj8uY2FjaGVVc2VyTGFuZ3VhZ2U/LihsKTtcbiAgICAgIH1cbiAgICAgIHRoaXMubG9hZFJlc291cmNlcyhsLCBlcnIgPT4ge1xuICAgICAgICBkb25lKGVyciwgbCk7XG4gICAgICB9KTtcbiAgICB9O1xuICAgIGlmICghbG5nICYmIHRoaXMuc2VydmljZXMubGFuZ3VhZ2VEZXRlY3RvciAmJiAhdGhpcy5zZXJ2aWNlcy5sYW5ndWFnZURldGVjdG9yLmFzeW5jKSB7XG4gICAgICBzZXRMbmcodGhpcy5zZXJ2aWNlcy5sYW5ndWFnZURldGVjdG9yLmRldGVjdCgpKTtcbiAgICB9IGVsc2UgaWYgKCFsbmcgJiYgdGhpcy5zZXJ2aWNlcy5sYW5ndWFnZURldGVjdG9yICYmIHRoaXMuc2VydmljZXMubGFuZ3VhZ2VEZXRlY3Rvci5hc3luYykge1xuICAgICAgaWYgKHRoaXMuc2VydmljZXMubGFuZ3VhZ2VEZXRlY3Rvci5kZXRlY3QubGVuZ3RoID09PSAwKSB7XG4gICAgICAgIHRoaXMuc2VydmljZXMubGFuZ3VhZ2VEZXRlY3Rvci5kZXRlY3QoKS50aGVuKHNldExuZyk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLnNlcnZpY2VzLmxhbmd1YWdlRGV0ZWN0b3IuZGV0ZWN0KHNldExuZyk7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIHNldExuZyhsbmcpO1xuICAgIH1cbiAgICByZXR1cm4gZGVmZXJyZWQ7XG4gIH1cbiAgZ2V0Rml4ZWRUKGxuZywgbnMsIGtleVByZWZpeCkge1xuICAgIGNvbnN0IGZpeGVkVCA9IChrZXksIG9wdHMsIC4uLnJlc3QpID0+IHtcbiAgICAgIGxldCBvO1xuICAgICAgaWYgKHR5cGVvZiBvcHRzICE9PSAnb2JqZWN0Jykge1xuICAgICAgICBvID0gdGhpcy5vcHRpb25zLm92ZXJsb2FkVHJhbnNsYXRpb25PcHRpb25IYW5kbGVyKFtrZXksIG9wdHNdLmNvbmNhdChyZXN0KSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBvID0ge1xuICAgICAgICAgIC4uLm9wdHNcbiAgICAgICAgfTtcbiAgICAgIH1cbiAgICAgIG8ubG5nID0gby5sbmcgfHwgZml4ZWRULmxuZztcbiAgICAgIG8ubG5ncyA9IG8ubG5ncyB8fCBmaXhlZFQubG5ncztcbiAgICAgIG8ubnMgPSBvLm5zIHx8IGZpeGVkVC5ucztcbiAgICAgIGlmIChvLmtleVByZWZpeCAhPT0gJycpIG8ua2V5UHJlZml4ID0gby5rZXlQcmVmaXggfHwga2V5UHJlZml4IHx8IGZpeGVkVC5rZXlQcmVmaXg7XG4gICAgICBjb25zdCBrZXlTZXBhcmF0b3IgPSB0aGlzLm9wdGlvbnMua2V5U2VwYXJhdG9yIHx8ICcuJztcbiAgICAgIGxldCByZXN1bHRLZXk7XG4gICAgICBpZiAoby5rZXlQcmVmaXggJiYgQXJyYXkuaXNBcnJheShrZXkpKSB7XG4gICAgICAgIHJlc3VsdEtleSA9IGtleS5tYXAoayA9PiBgJHtvLmtleVByZWZpeH0ke2tleVNlcGFyYXRvcn0ke2t9YCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXN1bHRLZXkgPSBvLmtleVByZWZpeCA/IGAke28ua2V5UHJlZml4fSR7a2V5U2VwYXJhdG9yfSR7a2V5fWAgOiBrZXk7XG4gICAgICB9XG4gICAgICByZXR1cm4gdGhpcy50KHJlc3VsdEtleSwgbyk7XG4gICAgfTtcbiAgICBpZiAoaXNTdHJpbmcobG5nKSkge1xuICAgICAgZml4ZWRULmxuZyA9IGxuZztcbiAgICB9IGVsc2Uge1xuICAgICAgZml4ZWRULmxuZ3MgPSBsbmc7XG4gICAgfVxuICAgIGZpeGVkVC5ucyA9IG5zO1xuICAgIGZpeGVkVC5rZXlQcmVmaXggPSBrZXlQcmVmaXg7XG4gICAgcmV0dXJuIGZpeGVkVDtcbiAgfVxuICB0KC4uLmFyZ3MpIHtcbiAgICByZXR1cm4gdGhpcy50cmFuc2xhdG9yPy50cmFuc2xhdGUoLi4uYXJncyk7XG4gIH1cbiAgZXhpc3RzKC4uLmFyZ3MpIHtcbiAgICByZXR1cm4gdGhpcy50cmFuc2xhdG9yPy5leGlzdHMoLi4uYXJncyk7XG4gIH1cbiAgc2V0RGVmYXVsdE5hbWVzcGFjZShucykge1xuICAgIHRoaXMub3B0aW9ucy5kZWZhdWx0TlMgPSBucztcbiAgfVxuICBoYXNMb2FkZWROYW1lc3BhY2UobnMsIG9wdGlvbnMgPSB7fSkge1xuICAgIGlmICghdGhpcy5pc0luaXRpYWxpemVkKSB7XG4gICAgICB0aGlzLmxvZ2dlci53YXJuKCdoYXNMb2FkZWROYW1lc3BhY2U6IGkxOG5leHQgd2FzIG5vdCBpbml0aWFsaXplZCcsIHRoaXMubGFuZ3VhZ2VzKTtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgaWYgKCF0aGlzLmxhbmd1YWdlcyB8fCAhdGhpcy5sYW5ndWFnZXMubGVuZ3RoKSB7XG4gICAgICB0aGlzLmxvZ2dlci53YXJuKCdoYXNMb2FkZWROYW1lc3BhY2U6IGkxOG4ubGFuZ3VhZ2VzIHdlcmUgdW5kZWZpbmVkIG9yIGVtcHR5JywgdGhpcy5sYW5ndWFnZXMpO1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgICBjb25zdCBsbmcgPSBvcHRpb25zLmxuZyB8fCB0aGlzLnJlc29sdmVkTGFuZ3VhZ2UgfHwgdGhpcy5sYW5ndWFnZXNbMF07XG4gICAgY29uc3QgZmFsbGJhY2tMbmcgPSB0aGlzLm9wdGlvbnMgPyB0aGlzLm9wdGlvbnMuZmFsbGJhY2tMbmcgOiBmYWxzZTtcbiAgICBjb25zdCBsYXN0TG5nID0gdGhpcy5sYW5ndWFnZXNbdGhpcy5sYW5ndWFnZXMubGVuZ3RoIC0gMV07XG4gICAgaWYgKGxuZy50b0xvd2VyQ2FzZSgpID09PSAnY2ltb2RlJykgcmV0dXJuIHRydWU7XG4gICAgY29uc3QgbG9hZE5vdFBlbmRpbmcgPSAobCwgbikgPT4ge1xuICAgICAgY29uc3QgbG9hZFN0YXRlID0gdGhpcy5zZXJ2aWNlcy5iYWNrZW5kQ29ubmVjdG9yLnN0YXRlW2Ake2x9fCR7bn1gXTtcbiAgICAgIHJldHVybiBsb2FkU3RhdGUgPT09IC0xIHx8IGxvYWRTdGF0ZSA9PT0gMCB8fCBsb2FkU3RhdGUgPT09IDI7XG4gICAgfTtcbiAgICBpZiAob3B0aW9ucy5wcmVjaGVjaykge1xuICAgICAgY29uc3QgcHJlUmVzdWx0ID0gb3B0aW9ucy5wcmVjaGVjayh0aGlzLCBsb2FkTm90UGVuZGluZyk7XG4gICAgICBpZiAocHJlUmVzdWx0ICE9PSB1bmRlZmluZWQpIHJldHVybiBwcmVSZXN1bHQ7XG4gICAgfVxuICAgIGlmICh0aGlzLmhhc1Jlc291cmNlQnVuZGxlKGxuZywgbnMpKSByZXR1cm4gdHJ1ZTtcbiAgICBpZiAoIXRoaXMuc2VydmljZXMuYmFja2VuZENvbm5lY3Rvci5iYWNrZW5kIHx8IHRoaXMub3B0aW9ucy5yZXNvdXJjZXMgJiYgIXRoaXMub3B0aW9ucy5wYXJ0aWFsQnVuZGxlZExhbmd1YWdlcykgcmV0dXJuIHRydWU7XG4gICAgaWYgKGxvYWROb3RQZW5kaW5nKGxuZywgbnMpICYmICghZmFsbGJhY2tMbmcgfHwgbG9hZE5vdFBlbmRpbmcobGFzdExuZywgbnMpKSkgcmV0dXJuIHRydWU7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG4gIGxvYWROYW1lc3BhY2VzKG5zLCBjYWxsYmFjaykge1xuICAgIGNvbnN0IGRlZmVycmVkID0gZGVmZXIoKTtcbiAgICBpZiAoIXRoaXMub3B0aW9ucy5ucykge1xuICAgICAgaWYgKGNhbGxiYWNrKSBjYWxsYmFjaygpO1xuICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgIH1cbiAgICBpZiAoaXNTdHJpbmcobnMpKSBucyA9IFtuc107XG4gICAgbnMuZm9yRWFjaChuID0+IHtcbiAgICAgIGlmICh0aGlzLm9wdGlvbnMubnMuaW5kZXhPZihuKSA8IDApIHRoaXMub3B0aW9ucy5ucy5wdXNoKG4pO1xuICAgIH0pO1xuICAgIHRoaXMubG9hZFJlc291cmNlcyhlcnIgPT4ge1xuICAgICAgZGVmZXJyZWQucmVzb2x2ZSgpO1xuICAgICAgaWYgKGNhbGxiYWNrKSBjYWxsYmFjayhlcnIpO1xuICAgIH0pO1xuICAgIHJldHVybiBkZWZlcnJlZDtcbiAgfVxuICBsb2FkTGFuZ3VhZ2VzKGxuZ3MsIGNhbGxiYWNrKSB7XG4gICAgY29uc3QgZGVmZXJyZWQgPSBkZWZlcigpO1xuICAgIGlmIChpc1N0cmluZyhsbmdzKSkgbG5ncyA9IFtsbmdzXTtcbiAgICBjb25zdCBwcmVsb2FkZWQgPSB0aGlzLm9wdGlvbnMucHJlbG9hZCB8fCBbXTtcbiAgICBjb25zdCBuZXdMbmdzID0gbG5ncy5maWx0ZXIobG5nID0+IHByZWxvYWRlZC5pbmRleE9mKGxuZykgPCAwICYmIHRoaXMuc2VydmljZXMubGFuZ3VhZ2VVdGlscy5pc1N1cHBvcnRlZENvZGUobG5nKSk7XG4gICAgaWYgKCFuZXdMbmdzLmxlbmd0aCkge1xuICAgICAgaWYgKGNhbGxiYWNrKSBjYWxsYmFjaygpO1xuICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgIH1cbiAgICB0aGlzLm9wdGlvbnMucHJlbG9hZCA9IHByZWxvYWRlZC5jb25jYXQobmV3TG5ncyk7XG4gICAgdGhpcy5sb2FkUmVzb3VyY2VzKGVyciA9PiB7XG4gICAgICBkZWZlcnJlZC5yZXNvbHZlKCk7XG4gICAgICBpZiAoY2FsbGJhY2spIGNhbGxiYWNrKGVycik7XG4gICAgfSk7XG4gICAgcmV0dXJuIGRlZmVycmVkO1xuICB9XG4gIGRpcihsbmcpIHtcbiAgICBpZiAoIWxuZykgbG5nID0gdGhpcy5yZXNvbHZlZExhbmd1YWdlIHx8ICh0aGlzLmxhbmd1YWdlcz8ubGVuZ3RoID4gMCA/IHRoaXMubGFuZ3VhZ2VzWzBdIDogdGhpcy5sYW5ndWFnZSk7XG4gICAgaWYgKCFsbmcpIHJldHVybiAncnRsJztcbiAgICB0cnkge1xuICAgICAgY29uc3QgbCA9IG5ldyBJbnRsLkxvY2FsZShsbmcpO1xuICAgICAgaWYgKGwgJiYgbC5nZXRUZXh0SW5mbykge1xuICAgICAgICBjb25zdCB0aSA9IGwuZ2V0VGV4dEluZm8oKTtcbiAgICAgICAgaWYgKHRpICYmIHRpLmRpcmVjdGlvbikgcmV0dXJuIHRpLmRpcmVjdGlvbjtcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlKSB7fVxuICAgIGNvbnN0IHJ0bExuZ3MgPSBbJ2FyJywgJ3NodScsICdzcXInLCAnc3NoJywgJ3hhYScsICd5aGQnLCAneXVkJywgJ2FhbycsICdhYmgnLCAnYWJ2JywgJ2FjbScsICdhY3EnLCAnYWN3JywgJ2FjeCcsICdhY3knLCAnYWRmJywgJ2FkcycsICdhZWInLCAnYWVjJywgJ2FmYicsICdhanAnLCAnYXBjJywgJ2FwZCcsICdhcmInLCAnYXJxJywgJ2FycycsICdhcnknLCAnYXJ6JywgJ2F1eicsICdhdmwnLCAnYXloJywgJ2F5bCcsICdheW4nLCAnYXlwJywgJ2JieicsICdwZ2EnLCAnaGUnLCAnaXcnLCAncHMnLCAncGJ0JywgJ3BidScsICdwc3QnLCAncHJwJywgJ3ByZCcsICd1ZycsICd1cicsICd5ZGQnLCAneWRzJywgJ3lpaCcsICdqaScsICd5aScsICdoYm8nLCAnbWVuJywgJ3htbicsICdmYScsICdqcHInLCAncGVvJywgJ3BlcycsICdwcnMnLCAnZHYnLCAnc2FtJywgJ2NrYiddO1xuICAgIGNvbnN0IGxhbmd1YWdlVXRpbHMgPSB0aGlzLnNlcnZpY2VzPy5sYW5ndWFnZVV0aWxzIHx8IG5ldyBMYW5ndWFnZVV0aWwoZ2V0KCkpO1xuICAgIGlmIChsbmcudG9Mb3dlckNhc2UoKS5pbmRleE9mKCctbGF0bicpID4gMSkgcmV0dXJuICdsdHInO1xuICAgIHJldHVybiBydGxMbmdzLmluZGV4T2YobGFuZ3VhZ2VVdGlscy5nZXRMYW5ndWFnZVBhcnRGcm9tQ29kZShsbmcpKSA+IC0xIHx8IGxuZy50b0xvd2VyQ2FzZSgpLmluZGV4T2YoJy1hcmFiJykgPiAxID8gJ3J0bCcgOiAnbHRyJztcbiAgfVxuICBzdGF0aWMgY3JlYXRlSW5zdGFuY2Uob3B0aW9ucyA9IHt9LCBjYWxsYmFjaykge1xuICAgIHJldHVybiBuZXcgSTE4bihvcHRpb25zLCBjYWxsYmFjayk7XG4gIH1cbiAgY2xvbmVJbnN0YW5jZShvcHRpb25zID0ge30sIGNhbGxiYWNrID0gbm9vcCkge1xuICAgIGNvbnN0IGZvcmtSZXNvdXJjZVN0b3JlID0gb3B0aW9ucy5mb3JrUmVzb3VyY2VTdG9yZTtcbiAgICBpZiAoZm9ya1Jlc291cmNlU3RvcmUpIGRlbGV0ZSBvcHRpb25zLmZvcmtSZXNvdXJjZVN0b3JlO1xuICAgIGNvbnN0IG1lcmdlZE9wdGlvbnMgPSB7XG4gICAgICAuLi50aGlzLm9wdGlvbnMsXG4gICAgICAuLi5vcHRpb25zLFxuICAgICAgLi4ue1xuICAgICAgICBpc0Nsb25lOiB0cnVlXG4gICAgICB9XG4gICAgfTtcbiAgICBjb25zdCBjbG9uZSA9IG5ldyBJMThuKG1lcmdlZE9wdGlvbnMpO1xuICAgIGlmIChvcHRpb25zLmRlYnVnICE9PSB1bmRlZmluZWQgfHwgb3B0aW9ucy5wcmVmaXggIT09IHVuZGVmaW5lZCkge1xuICAgICAgY2xvbmUubG9nZ2VyID0gY2xvbmUubG9nZ2VyLmNsb25lKG9wdGlvbnMpO1xuICAgIH1cbiAgICBjb25zdCBtZW1iZXJzVG9Db3B5ID0gWydzdG9yZScsICdzZXJ2aWNlcycsICdsYW5ndWFnZSddO1xuICAgIG1lbWJlcnNUb0NvcHkuZm9yRWFjaChtID0+IHtcbiAgICAgIGNsb25lW21dID0gdGhpc1ttXTtcbiAgICB9KTtcbiAgICBjbG9uZS5zZXJ2aWNlcyA9IHtcbiAgICAgIC4uLnRoaXMuc2VydmljZXNcbiAgICB9O1xuICAgIGNsb25lLnNlcnZpY2VzLnV0aWxzID0ge1xuICAgICAgaGFzTG9hZGVkTmFtZXNwYWNlOiBjbG9uZS5oYXNMb2FkZWROYW1lc3BhY2UuYmluZChjbG9uZSlcbiAgICB9O1xuICAgIGlmIChmb3JrUmVzb3VyY2VTdG9yZSkge1xuICAgICAgY29uc3QgY2xvbmVkRGF0YSA9IE9iamVjdC5rZXlzKHRoaXMuc3RvcmUuZGF0YSkucmVkdWNlKChwcmV2LCBsKSA9PiB7XG4gICAgICAgIHByZXZbbF0gPSB7XG4gICAgICAgICAgLi4udGhpcy5zdG9yZS5kYXRhW2xdXG4gICAgICAgIH07XG4gICAgICAgIHByZXZbbF0gPSBPYmplY3Qua2V5cyhwcmV2W2xdKS5yZWR1Y2UoKGFjYywgbikgPT4ge1xuICAgICAgICAgIGFjY1tuXSA9IHtcbiAgICAgICAgICAgIC4uLnByZXZbbF1bbl1cbiAgICAgICAgICB9O1xuICAgICAgICAgIHJldHVybiBhY2M7XG4gICAgICAgIH0sIHByZXZbbF0pO1xuICAgICAgICByZXR1cm4gcHJldjtcbiAgICAgIH0sIHt9KTtcbiAgICAgIGNsb25lLnN0b3JlID0gbmV3IFJlc291cmNlU3RvcmUoY2xvbmVkRGF0YSwgbWVyZ2VkT3B0aW9ucyk7XG4gICAgICBjbG9uZS5zZXJ2aWNlcy5yZXNvdXJjZVN0b3JlID0gY2xvbmUuc3RvcmU7XG4gICAgfVxuICAgIGNsb25lLnRyYW5zbGF0b3IgPSBuZXcgVHJhbnNsYXRvcihjbG9uZS5zZXJ2aWNlcywgbWVyZ2VkT3B0aW9ucyk7XG4gICAgY2xvbmUudHJhbnNsYXRvci5vbignKicsIChldmVudCwgLi4uYXJncykgPT4ge1xuICAgICAgY2xvbmUuZW1pdChldmVudCwgLi4uYXJncyk7XG4gICAgfSk7XG4gICAgY2xvbmUuaW5pdChtZXJnZWRPcHRpb25zLCBjYWxsYmFjayk7XG4gICAgY2xvbmUudHJhbnNsYXRvci5vcHRpb25zID0gbWVyZ2VkT3B0aW9ucztcbiAgICBjbG9uZS50cmFuc2xhdG9yLmJhY2tlbmRDb25uZWN0b3Iuc2VydmljZXMudXRpbHMgPSB7XG4gICAgICBoYXNMb2FkZWROYW1lc3BhY2U6IGNsb25lLmhhc0xvYWRlZE5hbWVzcGFjZS5iaW5kKGNsb25lKVxuICAgIH07XG4gICAgcmV0dXJuIGNsb25lO1xuICB9XG4gIHRvSlNPTigpIHtcbiAgICByZXR1cm4ge1xuICAgICAgb3B0aW9uczogdGhpcy5vcHRpb25zLFxuICAgICAgc3RvcmU6IHRoaXMuc3RvcmUsXG4gICAgICBsYW5ndWFnZTogdGhpcy5sYW5ndWFnZSxcbiAgICAgIGxhbmd1YWdlczogdGhpcy5sYW5ndWFnZXMsXG4gICAgICByZXNvbHZlZExhbmd1YWdlOiB0aGlzLnJlc29sdmVkTGFuZ3VhZ2VcbiAgICB9O1xuICB9XG59XG5jb25zdCBpbnN0YW5jZSA9IEkxOG4uY3JlYXRlSW5zdGFuY2UoKTtcbmluc3RhbmNlLmNyZWF0ZUluc3RhbmNlID0gSTE4bi5jcmVhdGVJbnN0YW5jZTtcblxuY29uc3QgY3JlYXRlSW5zdGFuY2UgPSBpbnN0YW5jZS5jcmVhdGVJbnN0YW5jZTtcbmNvbnN0IGRpciA9IGluc3RhbmNlLmRpcjtcbmNvbnN0IGluaXQgPSBpbnN0YW5jZS5pbml0O1xuY29uc3QgbG9hZFJlc291cmNlcyA9IGluc3RhbmNlLmxvYWRSZXNvdXJjZXM7XG5jb25zdCByZWxvYWRSZXNvdXJjZXMgPSBpbnN0YW5jZS5yZWxvYWRSZXNvdXJjZXM7XG5jb25zdCB1c2UgPSBpbnN0YW5jZS51c2U7XG5jb25zdCBjaGFuZ2VMYW5ndWFnZSA9IGluc3RhbmNlLmNoYW5nZUxhbmd1YWdlO1xuY29uc3QgZ2V0Rml4ZWRUID0gaW5zdGFuY2UuZ2V0Rml4ZWRUO1xuY29uc3QgdCA9IGluc3RhbmNlLnQ7XG5jb25zdCBleGlzdHMgPSBpbnN0YW5jZS5leGlzdHM7XG5jb25zdCBzZXREZWZhdWx0TmFtZXNwYWNlID0gaW5zdGFuY2Uuc2V0RGVmYXVsdE5hbWVzcGFjZTtcbmNvbnN0IGhhc0xvYWRlZE5hbWVzcGFjZSA9IGluc3RhbmNlLmhhc0xvYWRlZE5hbWVzcGFjZTtcbmNvbnN0IGxvYWROYW1lc3BhY2VzID0gaW5zdGFuY2UubG9hZE5hbWVzcGFjZXM7XG5jb25zdCBsb2FkTGFuZ3VhZ2VzID0gaW5zdGFuY2UubG9hZExhbmd1YWdlcztcblxuZXhwb3J0IHsgY2hhbmdlTGFuZ3VhZ2UsIGNyZWF0ZUluc3RhbmNlLCBpbnN0YW5jZSBhcyBkZWZhdWx0LCBkaXIsIGV4aXN0cywgZ2V0Rml4ZWRULCBoYXNMb2FkZWROYW1lc3BhY2UsIGluaXQsIGxvYWRMYW5ndWFnZXMsIGxvYWROYW1lc3BhY2VzLCBsb2FkUmVzb3VyY2VzLCByZWxvYWRSZXNvdXJjZXMsIHNldERlZmF1bHROYW1lc3BhY2UsIHQsIHVzZSB9O1xuIiwiaW1wb3J0IGkxOG5leHQgZnJvbSBcImkxOG5leHRcIjtcbmltcG9ydCAqIGFzIGVuQ29tbW9uIGZyb20gXCIuL2VuL2NvbW1vbi5qc29uXCI7XG5pbXBvcnQgKiBhcyBmckNvbW1vbiBmcm9tIFwiLi9mci9jb21tb24uanNvblwiO1xuaW1wb3J0ICogYXMgaXRDb21tb24gZnJvbSBcIi4vaXQvY29tbW9uLmpzb25cIjtcbmltcG9ydCAqIGFzIGRlQ29tbW9uIGZyb20gXCIuL2RlL2NvbW1vbi5qc29uXCI7XG5cbmV4cG9ydCBjb25zdCBkZWZhdWx0TlMgPSBcImNvbW1vblwiOyAvLyBEZWZhdWx0IG5hbWUgc3BhY2VcblxuaTE4bmV4dC5pbml0KHtcbiAgbG5nOiBcImVuXCIsIC8vIERlZmF1bHQgbGFuZ3VhZ2VcbiAgZmFsbGJhY2tMbmc6IFwiZW5cIiwgLy8gRmFsbGJhY2sgbGFuZ3VhZ2VcbiAgcmVzb3VyY2VzOiB7XG4gICAgZW46IHtcbiAgICAgIGNvbW1vbjogZW5Db21tb24sXG4gICAgfSxcbiAgICBmcjoge1xuICAgICAgY29tbW9uOiBmckNvbW1vbixcbiAgICB9LFxuICAgIGl0OiB7XG4gICAgICBjb21tb246IGl0Q29tbW9uLFxuICAgIH0sXG4gICAgZGU6IHtcbiAgICAgIGNvbW1vbjogZGVDb21tb24sXG4gICAgfSxcbiAgfSxcbn0pO1xuXG5leHBvcnQgZGVmYXVsdCBpMThuZXh0O1xuIiwiZXhwb3J0IGFic3RyYWN0IGNsYXNzIExheW91dEVsZW1lbnQge1xuICBuYW1lOiBzdHJpbmc7XG4gIGNvbnN0cnVjdG9yKGFyZ3M6IHsgbmFtZTogc3RyaW5nIH0pIHtcbiAgICB0aGlzLm5hbWUgPSBhcmdzLm5hbWU7XG4gIH1cbiAgYWJzdHJhY3QgcmVuZGVyKCk6IHN0cmluZztcbn1cblxuZXhwb3J0IGNsYXNzIFRleHRDb250ZW50IGV4dGVuZHMgTGF5b3V0RWxlbWVudCB7XG4gIGNvbnRlbnQ6IHN0cmluZztcblxuICBjb25zdHJ1Y3RvcihhcmdzOiB7IG5hbWU/OiBzdHJpbmc7IGNvbnRlbnQ6IHN0cmluZyB9KSB7XG4gICAgc3VwZXIoeyBuYW1lOiBhcmdzLm5hbWUgfHwgXCJcIiB9KTtcbiAgICB0aGlzLmNvbnRlbnQgPSBhcmdzLmNvbnRlbnQ7XG4gIH1cblxuICByZW5kZXIoKTogc3RyaW5nIHtcbiAgICByZXR1cm4gdGhpcy5jb250ZW50O1xuICB9XG59XG5cbmV4cG9ydCBjbGFzcyBQYXJhZ3JhcGggZXh0ZW5kcyBMYXlvdXRFbGVtZW50IHtcbiAgY29udGVudDogc3RyaW5nO1xuICBjc3NDbGFzcz86IHN0cmluZztcblxuICBjb25zdHJ1Y3RvcihhcmdzOiB7IG5hbWU/OiBzdHJpbmc7IGNvbnRlbnQ6IHN0cmluZzsgY3NzQ2xhc3M/OiBzdHJpbmcgfSkge1xuICAgIHN1cGVyKHsgbmFtZTogYXJncy5uYW1lIHx8IFwiXCIgfSk7XG4gICAgdGhpcy5jb250ZW50ID0gYXJncy5jb250ZW50O1xuICAgIHRoaXMuY3NzQ2xhc3MgPSBhcmdzLmNzc0NsYXNzO1xuICB9XG5cbiAgcmVuZGVyKCk6IHN0cmluZyB7XG4gICAgY29uc3QgY2xhc3NBdHRyID0gdGhpcy5jc3NDbGFzcyA/IGAgY2xhc3M9XCIke3RoaXMuY3NzQ2xhc3N9XCJgIDogXCJcIjtcbiAgICByZXR1cm4gYDxwJHtjbGFzc0F0dHJ9PiR7dGhpcy5jb250ZW50fTwvcD5gO1xuICB9XG59XG5cbmV4cG9ydCBjbGFzcyBTaWRlYmFySXRlbSBleHRlbmRzIExheW91dEVsZW1lbnQge1xuICBpY29uPzogc3RyaW5nO1xuICBjb250ZW50OiBzdHJpbmc7XG5cbiAgY29uc3RydWN0b3IoYXJnczogeyBuYW1lOiBzdHJpbmc7IGNvbnRlbnQ6IHN0cmluZzsgaWNvbj86IHN0cmluZyB9KSB7XG4gICAgc3VwZXIoeyBuYW1lOiBhcmdzLm5hbWUgfSk7XG4gICAgdGhpcy5pY29uID0gYXJncy5pY29uO1xuICAgIHRoaXMuY29udGVudCA9IGFyZ3MuY29udGVudDtcbiAgfVxuXG4gIHJlbmRlcigpOiBzdHJpbmcge1xuICAgIGNvbnN0IGljb25IVE1MID0gdGhpcy5pY29uXG4gICAgICA/IGA8aSBjbGFzcz1cInctaWNvbiAke3RoaXMuaWNvbn0gZXYtY2hhcmdlci1pdGVtLWljb25cIj48L2k+YFxuICAgICAgOiBcIlwiO1xuICAgIHJldHVybiBgPHd6LWNhcmQgY2xhc3M9XCJldi1jaGFyZ2VyLWl0ZW1cIiBzaXplPVwic21cIiBlbGV2YXRpb249XCIwXCI+PGRpdiBjbGFzcz1cImV2LWNoYXJnZXItaXRlbS1oZWFkZXJcIj4ke2ljb25IVE1MfTx3ei1zdWJoZWFkNSBjbGFzcz1cImV2LWNoYXJnZXItaXRlbS10aXRsZVwiPiR7dGhpcy5uYW1lfTwvd3otc3ViaGVhZDU+PC9kaXY+PGRpdiBjbGFzcz1cImV2LWNoYXJnZXItaXRlbS1jb250ZW50XCI+PHA+JHt0aGlzLmNvbnRlbnR9PC9wPjwvZGl2Pjwvd3otY2FyZD5gO1xuICB9XG59XG5cbmV4cG9ydCBjbGFzcyBTaWRlYmFyU2VjdGlvbiBleHRlbmRzIExheW91dEVsZW1lbnQge1xuICBjaGlsZHJlbjogTGF5b3V0RWxlbWVudFtdO1xuICBjc3NDbGFzcz86IHN0cmluZztcblxuICBjb25zdHJ1Y3RvcihhcmdzOiB7XG4gICAgbmFtZTogc3RyaW5nO1xuICAgIGNoaWxkcmVuPzogTGF5b3V0RWxlbWVudFtdO1xuICAgIGNzc0NsYXNzPzogc3RyaW5nO1xuICB9KSB7XG4gICAgc3VwZXIoeyBuYW1lOiBhcmdzLm5hbWUgfSk7XG4gICAgdGhpcy5jaGlsZHJlbiA9IGFyZ3MuY2hpbGRyZW4gfHwgW107XG4gICAgdGhpcy5jc3NDbGFzcyA9IGFyZ3MuY3NzQ2xhc3M7XG4gIH1cblxuICBhZGRDaGlsZChjaGlsZDogTGF5b3V0RWxlbWVudCk6IHRoaXMge1xuICAgIHRoaXMuY2hpbGRyZW4ucHVzaChjaGlsZCk7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICByZW5kZXIoKTogc3RyaW5nIHtcbiAgICBjb25zdCBjaGlsZHJlbkhUTUwgPSB0aGlzLmNoaWxkcmVuLm1hcCgoY2hpbGQpID0+IGNoaWxkLnJlbmRlcigpKS5qb2luKFwiXCIpO1xuICAgIGNvbnN0IGNsYXNzQXR0ciA9IHRoaXMuY3NzQ2xhc3MgPyBgICR7dGhpcy5jc3NDbGFzc31gIDogXCJcIjtcbiAgICByZXR1cm4gYDxkaXYgY2xhc3M9XCJzZWN0aW9uJHtjbGFzc0F0dHJ9XCI+PGRpdj48d3otc3ViaGVhZDQgY2xhc3M9XCJ0aXRsZS0tZ2x0eUxcIj4ke3RoaXMubmFtZX08L3d6LXN1YmhlYWQ0PjxkaXYgY2xhc3M9XCJjb250ZW50LS1DcmVQclwiPiR7Y2hpbGRyZW5IVE1MfTwvZGl2PjwvZGl2PjwvZGl2PmA7XG4gIH1cbn1cblxuZXhwb3J0IGNsYXNzIFNpZGViYXJUYWIge1xuICBzY3JpcHROYW1lOiBzdHJpbmc7XG4gIGNoaWxkcmVuOiBMYXlvdXRFbGVtZW50W107XG5cbiAgY29uc3RydWN0b3IoYXJnczogeyBzY3JpcHROYW1lOiBzdHJpbmc7IGNoaWxkcmVuPzogTGF5b3V0RWxlbWVudFtdIH0pIHtcbiAgICB0aGlzLnNjcmlwdE5hbWUgPSBhcmdzLnNjcmlwdE5hbWU7XG4gICAgdGhpcy5jaGlsZHJlbiA9IGFyZ3MuY2hpbGRyZW4gfHwgW107XG4gIH1cblxuICBhZGRDaGlsZChjaGlsZDogTGF5b3V0RWxlbWVudCk6IHRoaXMge1xuICAgIHRoaXMuY2hpbGRyZW4ucHVzaChjaGlsZCk7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICByZW5kZXIoKTogc3RyaW5nIHtcbiAgICBjb25zdCBjaGlsZHJlbkhUTUwgPSB0aGlzLmNoaWxkcmVuLm1hcCgoY2hpbGQpID0+IGNoaWxkLnJlbmRlcigpKS5qb2luKFwiXCIpO1xuICAgIHJldHVybiBgPGRpdiBjbGFzcz1cInNpZGViYXItdGFiLXBhbmUtYm9keVwiPiR7Y2hpbGRyZW5IVE1MfTwvZGl2PmA7XG4gIH1cbn1cbiIsIi8qKlxuICogUG9ydGlvbnMgY29weXJpZ2h0IChjKSAyMDIwIEZyYW5jZXNjbyBCZWRpbmksIE1JVCBsaWNlbnNlLlxuICogU2VlIExJQ0VOU0Uub3JpZ2luYWwuXG4gKlxuICogU3Vic3RhbnRpYWwgbW9kaWZpY2F0aW9ucyBjb3B5cmlnaHQgKGMpIDIwMjUgTWHDq2wgUGVkcmV0dGkuXG4gKiBUaGVzZSBtb2RpZmljYXRpb25zIGFyZSBkdWFsLWxpY2Vuc2VkIHVuZGVyIHRoZSBHTlUgQUdQTCB2My4wIG9yIGxhdGVyLFxuICogYnV0IHRoZSBmaWxlIGFzIGEgd2hvbGUgcmVtYWlucyBhdmFpbGFibGUgdW5kZXIgdGhlIG9yaWdpbmFsIE1JVCBsaWNlbnNlLlxuICpcbiAqIFNlZSBMSUNFTlNFLm9yaWdpbmFsIGFuZCBMSUNFTlNFIGZvciBtb3JlIGRldGFpbHMuXG4gKi9cblxuaW1wb3J0IHsgV21lU0RLIH0gZnJvbSBcIndtZS1zZGstdHlwaW5nc1wiO1xuaW1wb3J0IHsgVGlsZUxheWVyIH0gZnJvbSBcIi4vc3JjL3RpbGVMYXllclwiO1xuaW1wb3J0IHsgTGF5ZXIgfSBmcm9tIFwiLi9zcmMvbGF5ZXJcIjtcbmltcG9ydCB7IEZlYXR1cmVMYXllciB9IGZyb20gXCIuL3NyYy9mZWF0dXJlTGF5ZXJcIjtcbmltcG9ydCB7IFB1YmxpY1RyYW5zcG9ydFN0b3BzTGF5ZXIgfSBmcm9tIFwiLi9zcmMvcHVibGljVHJhbnNwb3J0U3RvcHNMYXllclwiO1xuaW1wb3J0IGkxOG5leHQgZnJvbSBcIi4vbG9jYWxlcy9pMThuXCI7XG5pbXBvcnQge1xuICBTaWRlYmFyU2VjdGlvbixcbiAgU2lkZWJhclRhYixcbiAgUGFyYWdyYXBoLFxuICBUZXh0Q29udGVudCxcbiAgU2lkZWJhckl0ZW0sXG59IGZyb20gXCIuL3NyYy9zaWRlYmFyXCI7XG5pbXBvcnQgeyBzYXZlTGF5ZXJTdGF0ZSwgaXNMYXllckVuYWJsZWQgfSBmcm9tIFwiLi9zcmMvc3RvcmFnZVwiO1xuXG5jb25zdCBlbmdsaXNoU2NyaXB0TmFtZSA9IFwiV01FIFN3aXR6ZXJsYW5kIGhlbHBlclwiO1xubGV0IHNjcmlwdE5hbWUgPSBlbmdsaXNoU2NyaXB0TmFtZTtcblxuLy8gdGhlIHNkayBpbml0U2NyaXB0IGZ1bmN0aW9uIHdpbGwgYmUgY2FsbGVkIGFmdGVyIHRoZSBTREsgaXMgaW5pdGlhbGl6ZWRcbnVuc2FmZVdpbmRvdy5TREtfSU5JVElBTElaRUQudGhlbihpbml0U2NyaXB0KTtcblxuZnVuY3Rpb24gaW5pdFNjcmlwdCgpIHtcbiAgLy8gaW5pdGlhbGl6ZSB0aGUgc2RrLCB0aGVzZSBzaG91bGQgcmVtYWluIGhlcmUgYXQgdGhlIHRvcCBvZiB0aGUgc2NyaXB0XG4gIGlmICghdW5zYWZlV2luZG93LmdldFdtZVNkaykge1xuICAgIC8vIFRoaXMgYmxvY2sgaXMgcmVxdWlyZWQgZm9yIHR5cGUgY2hlY2tpbmcsIGJ1dCBpdCBpcyBndWFyYW50ZWVkIHRoYXQgdGhlIGZ1bmN0aW9uIGV4aXN0cy5cbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJTREsgbm90IGF2YWlsYWJsZVwiKTtcbiAgfVxuICBjb25zdCB3bWVTREs6IFdtZVNESyA9IHVuc2FmZVdpbmRvdy5nZXRXbWVTZGsoe1xuICAgIHNjcmlwdElkOiBcIndtZS1zd2l0emVybGFuZC1oZWxwZXJcIiwgLy8gVE9ETzogcmVwbGFjZSB3aXRoIHlvdXIgc2NyaXB0IGlkIGFuZCBzY3JpcHQgbmFtZVxuICAgIHNjcmlwdE5hbWU6IGVuZ2xpc2hTY3JpcHROYW1lLCAvLyBUT0RPXG4gIH0pO1xuXG4gIGNvbnNvbGUuZGVidWcoXG4gICAgYFNESyB2LiAke3dtZVNESy5nZXRTREtWZXJzaW9uKCl9IG9uICR7d21lU0RLLmdldFdNRVZlcnNpb24oKX0gaW5pdGlhbGl6ZWRgLFxuICApO1xuICAvLyAtLS0gSW5pdGlhbGlzYXRpb24gYW3DqWxpb3LDqWUgLS0tXG4gIGNvbnN0IGxheWVycyA9IG5ldyBNYXA8c3RyaW5nLCBMYXllcj4oKTtcblxuICBmdW5jdGlvbiBhY3RpdmF0ZUxhbmd1YWdlKCkge1xuICAgIGNvbnN0IHsgbG9jYWxlQ29kZSB9ID0gd21lU0RLLlNldHRpbmdzLmdldExvY2FsZSgpO1xuICAgIGkxOG5leHQuY2hhbmdlTGFuZ3VhZ2UobG9jYWxlQ29kZSk7XG4gICAgc2NyaXB0TmFtZSA9IGkxOG5leHQudChcImNvbW1vbjpzY3JpcHROYW1lXCIsIGVuZ2xpc2hTY3JpcHROYW1lKTtcbiAgfVxuXG4gIGZ1bmN0aW9uIGNyZWF0ZUxheWVycygpIHtcbiAgICBjb25zdCBsYXllckxpc3QgPSBbXG4gICAgICBuZXcgVGlsZUxheWVyKHtcbiAgICAgICAgd21lU0RLOiB3bWVTREssXG4gICAgICAgIG5hbWU6IGkxOG5leHQudChcbiAgICAgICAgICBcImNvbW1vbjpsYXllcnMuYm91bmRhcmllcy5tdW5pY2lwYWxpdHlcIixcbiAgICAgICAgICBcIk11bmljaXBhbCBib3VuZGFyaWVzXCIsXG4gICAgICAgICksXG4gICAgICAgIHRpbGVIZWlnaHQ6IDI1NixcbiAgICAgICAgdGlsZVdpZHRoOiAyNTYsXG4gICAgICAgIGZpbGVOYW1lOiBcIiR7en0vJHt4fS8ke3l9LnBuZ1wiLFxuICAgICAgICBzZXJ2ZXJzOiBbXG4gICAgICAgICAgXCJodHRwczovL3dtdHMuZ2VvLmFkbWluLmNoLzEuMC4wL2NoLnN3aXNzdG9wby5zd2lzc2JvdW5kYXJpZXMzZC1nZW1laW5kZS1mbGFlY2hlLmZpbGwvZGVmYXVsdC9jdXJyZW50LzM4NTdcIixcbiAgICAgICAgXSxcbiAgICAgICAgekluZGV4OiAyMDM5LFxuICAgICAgfSksXG4gICAgICBuZXcgVGlsZUxheWVyKHtcbiAgICAgICAgd21lU0RLOiB3bWVTREssXG4gICAgICAgIG5hbWU6IGkxOG5leHQudChcbiAgICAgICAgICBcImNvbW1vbjpsYXllcnMuYm91bmRhcmllcy5zdGF0ZVwiLFxuICAgICAgICAgIFwiQ2FudG9uYWwgYm91bmRhcmllc1wiLFxuICAgICAgICApLFxuICAgICAgICB0aWxlSGVpZ2h0OiAyNTYsXG4gICAgICAgIHRpbGVXaWR0aDogMjU2LFxuICAgICAgICBmaWxlTmFtZTogXCIke3p9LyR7eH0vJHt5fS5wbmdcIixcbiAgICAgICAgc2VydmVyczogW1xuICAgICAgICAgIFwiaHR0cHM6Ly93bXRzLmdlby5hZG1pbi5jaC8xLjAuMC9jaC5zd2lzc3RvcG8uc3dpc3Nib3VuZGFyaWVzM2Qta2FudG9uLWZsYWVjaGUuZmlsbC9kZWZhdWx0L2N1cnJlbnQvMzg1N1wiLFxuICAgICAgICBdLFxuICAgICAgICB6SW5kZXg6IDIwMzgsXG4gICAgICB9KSxcbiAgICAgIG5ldyBUaWxlTGF5ZXIoe1xuICAgICAgICB3bWVTREs6IHdtZVNESyxcbiAgICAgICAgbmFtZTogaTE4bmV4dC50KFwiY29tbW9uOmxheWVycy4zZFwiLCBcIkdlb2dyYXBoaWNhbCBOYW1lcyBzd2lzc05BTUVTM0RcIiksXG4gICAgICAgIHRpbGVIZWlnaHQ6IDI1NixcbiAgICAgICAgdGlsZVdpZHRoOiAyNTYsXG4gICAgICAgIGZpbGVOYW1lOiBcIiR7en0vJHt4fS8ke3l9LnBuZ1wiLFxuICAgICAgICBzZXJ2ZXJzOiBbXG4gICAgICAgICAgXCJodHRwczovL3dtdHMuZ2VvLmFkbWluLmNoLzEuMC4wL2NoLnN3aXNzdG9wby5zd2lzc25hbWVzM2QvZGVmYXVsdC9jdXJyZW50LzM4NTdcIixcbiAgICAgICAgXSxcbiAgICAgICAgekluZGV4OiAyMDM3LFxuICAgICAgfSksXG4gICAgICBuZXcgVGlsZUxheWVyKHtcbiAgICAgICAgd21lU0RLOiB3bWVTREssXG4gICAgICAgIG5hbWU6IGkxOG5leHQudChcbiAgICAgICAgICBcImNvbW1vbjpsYXllcnMudG9wby5uYXRpb25hbF9jb2xvcnNcIixcbiAgICAgICAgICBcIk5hdGlvbmFsIE1hcHMgKGNvbG9yKVwiLFxuICAgICAgICApLFxuICAgICAgICB0aWxlSGVpZ2h0OiAyNTYsXG4gICAgICAgIHRpbGVXaWR0aDogMjU2LFxuICAgICAgICBmaWxlTmFtZTogXCIke3p9LyR7eH0vJHt5fS5qcGVnXCIsXG4gICAgICAgIHNlcnZlcnM6IFtcbiAgICAgICAgICBcImh0dHBzOi8vd210cy5nZW8uYWRtaW4uY2gvMS4wLjAvY2guc3dpc3N0b3BvLnBpeGVsa2FydGUtZmFyYmUvZGVmYXVsdC9jdXJyZW50LzM4NTdcIixcbiAgICAgICAgXSxcbiAgICAgICAgekluZGV4OiAyMDM2LFxuICAgICAgfSksXG4gICAgICBuZXcgVGlsZUxheWVyKHtcbiAgICAgICAgd21lU0RLOiB3bWVTREssXG4gICAgICAgIG5hbWU6IGkxOG5leHQudChcbiAgICAgICAgICBcImNvbW1vbjpsYXllcnMuYmFja2dyb3VuZC5zd2lzc2ltYWdlXCIsXG4gICAgICAgICAgXCJTV0lTU0lNQUdFIEJhY2tncm91bmRcIixcbiAgICAgICAgKSxcbiAgICAgICAgdGlsZUhlaWdodDogMjU2LFxuICAgICAgICB0aWxlV2lkdGg6IDI1NixcbiAgICAgICAgZmlsZU5hbWU6IFwiJHt6fS8ke3h9LyR7eX0uanBlZ1wiLFxuICAgICAgICBzZXJ2ZXJzOiBbXG4gICAgICAgICAgXCJodHRwczovL3dtdHMuZ2VvLmFkbWluLmNoLzEuMC4wL2NoLnN3aXNzdG9wby5zd2lzc2ltYWdlL2RlZmF1bHQvY3VycmVudC8zODU3XCIsXG4gICAgICAgIF0sXG4gICAgICB9KSxcbiAgICAgIG5ldyBQdWJsaWNUcmFuc3BvcnRTdG9wc0xheWVyKHtcbiAgICAgICAgd21lU0RLOiB3bWVTREssXG4gICAgICAgIG5hbWU6IGkxOG5leHQudChcbiAgICAgICAgICBcImNvbW1vbjpsYXllcnMucHVibGljX3RyYW5zcG9ydF9zdG9wc1wiLFxuICAgICAgICAgIFwiUHVibGljIFRyYW5zcG9ydCBTdG9wc1wiLFxuICAgICAgICApLFxuICAgICAgICBzdHlsZVJ1bGVzOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgc3R5bGU6IHtcbiAgICAgICAgICAgICAgZmlsbE9wYWNpdHk6IDEsXG4gICAgICAgICAgICAgIGN1cnNvcjogXCJwb2ludGVyXCIsXG4gICAgICAgICAgICAgIHBvaW50UmFkaXVzOiAxMyxcbiAgICAgICAgICAgICAgZXh0ZXJuYWxHcmFwaGljOlxuICAgICAgICAgICAgICAgIFwiZGF0YTppbWFnZS9zdmcreG1sO2Jhc2U2NCxQSE4yWnlCNGJXeHVjejBpYUhSMGNEb3ZMM2QzZHk1M015NXZjbWN2TWpBd01DOXpkbWNpSUhkcFpIUm9QU0kwT1NJZ2FHVnBaMmgwUFNJME9DSWdabWxzYkQwaVlteGhZMnNpUGp4amFYSmpiR1VnWTNnOUlqSTBMamN5TmlJZ1kzazlJakkwSWlCeVBTSXlNeUlnWm1sc2JEMGlJMlUyTjJVeU1pSWdjM1J5YjJ0bFBTSWpabVptSWlCemRISnZhMlV0ZDJsa2RHZzlJaklpTHo0OGNHRjBhQ0JtYVd4c1BTSWpabVptSWlCa1BTSk5Namt1TnpJMklERTBZVE1nTXlBd0lEQWdNU0F5TGprNU5TQXlMamd5Tkd3dU1EQTFMakUzTm5ZeGFERXVNREUzYkM0eE5TNHdNRFZqTGprek9DNHdOaUF4TGpjMkxqWTROQ0F4TGpnME15QXhMalU1TVd3dU1EQTNMakUxTkZZeU1td3RMakF3Tnk0eE1UZGhNU0F4SURBZ01DQXhMUzQ0TnpZdU9EYzJiQzB1TVRFM0xqQXdOeTB1TVRFM0xTNHdNRGRoTVNBeElEQWdNQ0F4TFM0NE56WXRMamczTmt3ek15NDNORE1nTWpKMkxUSm9MVEV1TURFM2RqRXdZVEVnTVNBd0lEQWdNUzB1T0RnekxqazVNMnd0TGpFeE55NHdNRGRvTFRGMk1TNDFZVEV1TlNBeExqVWdNQ0F3SURFdE15QXdWak14YUMwMmRqRXVOV0V4TGpVZ01TNDFJREFnTUNBeExUTWdNRll6TVdndE1XRXhJREVnTUNBd0lERXRMams1TXkwdU9EZ3pUREUyTGpjeU5pQXpNRll5TUdndE1YWXlZVEVnTVNBd0lEQWdNUzB1T0RnekxqazVNMnd0TGpFeE55NHdNRGRoTVNBeElEQWdNQ0F4TFM0NU9UTXRMamc0TTB3eE15NDNNallnTWpKMkxUSXVNalZqTUMwdU9Ua3VPRFl0TVM0Mk9ESWdNUzQ0TlMweExqYzBOV3d1TVRVdExqQXdOV2d4ZGkweFlUTWdNeUF3SURBZ01TQXlMamd5TkMweUxqazVOV3d1TVRjMkxTNHdNRFY2YlMweElERXphQzB4WVRFZ01TQXdJREVnTUNBd0lESm9NV0V4SURFZ01DQXhJREFnTUMweWJTMDNJREJvTFRGaE1TQXhJREFnTVNBd0lEQWdNbWd4WVRFZ01TQXdJREVnTUNBd0xUSnRMUzQwTWprdE1URm9MVEV1TlRkc0xTNHhNVGN1TURBM1lURWdNU0F3SURBZ01DMHVPRGMzTGpnM05td3RMakF3Tnk0eE1UZDJPR2d4TW5ZdE9Hd3RMakF3TnkwdU1URTNZVEVnTVNBd0lEQWdNQzB1TnpZMExTNDROVGRzTFM0eE1USXRMakF5TFM0eE1UY3RMakF3Tm1ndE1TNDFOekpzTFM0NE5UUWdNUzQwT1RZdExqQTJOUzR4WVRFZ01TQXdJREFnTVMwdU9EQXpMalF3TkVneU15NHdNbXd0TGpFeE9TMHVNREEzWVRFZ01TQXdJREFnTVMwdU56VXRMalE1TjNvaUx6NDhjMk55YVhCMElIaHRiRzV6UFNJaUx6NDhMM04yWno0PVwiLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICBdLFxuICAgICAgfSksXG4gICAgXTtcbiAgICBmb3IgKGNvbnN0IGxheWVyIG9mIGxheWVyTGlzdCkge1xuICAgICAgbGF5ZXJzLnNldChsYXllci5uYW1lLCBsYXllcik7XG4gICAgfVxuICB9XG5cbiAgLy8gU3RhdGUgcmVzdG9yYXRpb24gZGVsZWdhdGVkIHRvIGVhY2ggbGF5ZXJcblxuICAvLyBQZXItbGF5ZXIgZXZlbnRzIGFyZSByZWdpc3RlcmVkIGluc2lkZSBlYWNoIGxheWVyIGNsYXNzXG5cbiAgYXN5bmMgZnVuY3Rpb24gYWRkU2NyaXB0VGFiKCkge1xuICAgIGNvbnN0IHsgdGFiTGFiZWwsIHRhYlBhbmUgfSA9IGF3YWl0IHdtZVNESy5TaWRlYmFyLnJlZ2lzdGVyU2NyaXB0VGFiKCk7XG4gICAgdGFiTGFiZWwuaW5uZXJUZXh0ID0gc2NyaXB0TmFtZTtcblxuICAgIGNvbnN0IHNpZGViYXJUYWIgPSBuZXcgU2lkZWJhclRhYih7IHNjcmlwdE5hbWUgfSk7XG5cbiAgICAvLyBJbnRyb2R1Y3Rpb24gcGFyYWdyYXBoXG4gICAgc2lkZWJhclRhYi5hZGRDaGlsZChcbiAgICAgIG5ldyBQYXJhZ3JhcGgoe1xuICAgICAgICBjb250ZW50OiBpMThuZXh0LnQoXG4gICAgICAgICAgXCJjb21tb246aW50cm9kdWN0aW9uXCIsXG4gICAgICAgICAgXCJUaGlzIHNjcmlwdCBhZGRzIG1hcCBsYXllcnMgdGhhdCBjYW4gYmUgYWN0aXZhdGVkIGZyb20gdGhlIHJpZ2h0IG5hdmlnYXRpb24gYmFyLCBhdCB0aGUgdmVyeSBib3R0b20uXCIsXG4gICAgICAgICksXG4gICAgICB9KSxcbiAgICApO1xuXG4gICAgLy8gUmVhZG1lIGxpbmsgcGFyYWdyYXBoXG4gICAgc2lkZWJhclRhYi5hZGRDaGlsZChcbiAgICAgIG5ldyBQYXJhZ3JhcGgoe1xuICAgICAgICBjb250ZW50OiBpMThuZXh0LnQoXG4gICAgICAgICAgXCJjb21tb246cmVhZG1lTGlua1wiLFxuICAgICAgICAgIFwiRm9yIG1vcmUgaW5mb3JtYXRpb24sIHNlZSB0aGUgZnVsbCBkb2N1bWVudGF0aW9uLlwiLFxuICAgICAgICApLFxuICAgICAgICBjc3NDbGFzczogXCJ0b3RvXCIsXG4gICAgICB9KSxcbiAgICApO1xuXG4gICAgLy8gTm90ZXMgc2VjdGlvbiB3aXRoIGNoaWxkcmVuXG4gICAgY29uc3Qgbm90ZXNTZWN0aW9uID0gbmV3IFNpZGViYXJTZWN0aW9uKHtcbiAgICAgIG5hbWU6IGkxOG5leHQudChcImNvbW1vbjpub3RlLmxheWVycy5iYWNrZ3JvdW5kLnN3aXNzaW1hZ2VcIiwgXCJOb3Rlc1wiKSxcbiAgICB9KTtcblxuICAgIC8vIFN3aXNzaW1hZ2UgdXBkYXRlIG5vdGUgaXRlbVxuICAgIG5vdGVzU2VjdGlvbi5hZGRDaGlsZChcbiAgICAgIG5ldyBTaWRlYmFySXRlbSh7XG4gICAgICAgIG5hbWU6IGkxOG5leHQudChcbiAgICAgICAgICBcImNvbW1vbjpsYXllcnMuYmFja2dyb3VuZC5zd2lzc2ltYWdlXCIsXG4gICAgICAgICAgXCJTV0lTU0lNQUdFIEJhY2tncm91bmRcIixcbiAgICAgICAgKSxcbiAgICAgICAgaWNvbjogXCJ3LWljb24tbWFwXCIsXG4gICAgICAgIGNvbnRlbnQ6IGkxOG5leHQudChcbiAgICAgICAgICBcImNvbW1vbjpzd2lzc2ltYWdlVXBkYXRlVGV4dFwiLFxuICAgICAgICAgICdUaGlzIDxhIGhyZWYgPVwiaHR0cHM6Ly9tYXAuZ2VvLmFkbWluLmNoLyMvbWFwP2xhbmc9ZnImY2VudGVyPTI2Mzg5MDkuMjUsMTE5ODMxNi41Jno9MS45NjcmdG9waWM9c3dpc3N0b3BvJmxheWVycz1jaC5zd2lzc3RvcG8uaW1hZ2VzLXN3aXNzaW1hZ2UtZG9wMTAubWV0YWRhdGEmYmdMYXllcj1jaC5zd2lzc3RvcG8ucGl4ZWxrYXJ0ZS1mYXJiZSZmZWF0dXJlSW5mbz1kZWZhdWx0JmNhdGFsb2dOb2Rlcz1zd2lzc3RvcG9cIiB0YXJnZXQ9XCJfYmxhbmtcIiByZWw9XCJub29wZW5lciBub3JlZmVycmVyXCI+bWFwPC9hPiBzaG93cyB3aGVuIHRoZSA8Yj57e2xheWVyfX08L2I+IG1hcCB3YXMgdXBkYXRlZCBmb3IgZWFjaCByZWdpb24uJyxcbiAgICAgICAgICB7IGxheWVyOiBpMThuZXh0LnQoXCJjb21tb246bGF5ZXJzLmJhY2tncm91bmQuc3dpc3NpbWFnZVwiKSB9LFxuICAgICAgICApLFxuICAgICAgfSksXG4gICAgKTtcblxuICAgIC8vIFB1YmxpYyB0cmFuc3BvcnQgc3RvcHMgbm90ZSBpdGVtXG4gICAgbm90ZXNTZWN0aW9uLmFkZENoaWxkKFxuICAgICAgbmV3IFNpZGViYXJJdGVtKHtcbiAgICAgICAgbmFtZTogaTE4bmV4dC50KFxuICAgICAgICAgIFwiY29tbW9uOmxheWVycy5wdWJsaWNfdHJhbnNwb3J0X3N0b3BzXCIsXG4gICAgICAgICAgXCJQdWJsaWMgVHJhbnNwb3J0IFN0b3BzXCIsXG4gICAgICAgICksXG4gICAgICAgIGljb246IFwidy1pY29uLWJ1c1wiLFxuICAgICAgICBjb250ZW50OiBpMThuZXh0LnQoXG4gICAgICAgICAgXCJjb21tb246cHVibGljVHJhbnNwb3J0U3RvcHNOb3RlXCIsXG4gICAgICAgICAgXCJQdWJsaWMgdHJhbnNwb3J0IHN0b3BzIGFwcGVhciBhcyBvcmFuZ2UgY2lyY3VsYXIgaWNvbnMgb24gdGhlIG1hcC5cIixcbiAgICAgICAgKSxcbiAgICAgIH0pLFxuICAgICk7XG5cbiAgICBzaWRlYmFyVGFiLmFkZENoaWxkKG5vdGVzU2VjdGlvbik7XG5cbiAgICB0YWJQYW5lLmlubmVySFRNTCA9IHNpZGViYXJUYWIucmVuZGVyKCk7XG4gIH1cblxuICBhc3luYyBmdW5jdGlvbiBpbml0KCkge1xuICAgIGFjdGl2YXRlTGFuZ3VhZ2UoKTtcbiAgICBjcmVhdGVMYXllcnMoKTtcbiAgICAvLyBMZXMgY2FzZXMgc29udCBham91dMOpZXMgbG9ycyBkZSBjcmVhdGVMYXllcnNcbiAgICBhd2FpdCBhZGRTY3JpcHRUYWIoKTtcblxuICAgIC8vIFJlc3RvcmUgbGF5ZXIgc3RhdGUgb25seSBhZnRlciBXTUUgaXMgZnVsbHkgcmVhZHkgKGRhdGEgbG9hZGVkLCB1c2VyIGxvZ2dlZCBpbilcbiAgICB3bWVTREsuRXZlbnRzLm9uY2UoeyBldmVudE5hbWU6IFwid21lLXJlYWR5XCIgfSkudGhlbigoKSA9PiB7XG4gICAgICBmb3IgKGNvbnN0IGxheWVyIG9mIGxheWVycy52YWx1ZXMoKSkge1xuICAgICAgICBsYXllci5yZXN0b3JlU3RhdGUoeyB3bWVTREsgfSk7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICBpbml0KCk7XG59XG4iXSwibmFtZXMiOlsiaTE4bmV4dCJdLCJtYXBwaW5ncyI6Ijs7O0lBbUJBLE1BQU0sV0FBVyxHQUFHLG9DQUFvQztJQU14RCxTQUFTLGNBQWMsR0FBQTtJQUNyQixJQUFBLElBQUk7WUFDRixNQUFNLE1BQU0sR0FBRyxZQUFZLENBQUMsT0FBTyxDQUFDLFdBQVcsQ0FBQztJQUNoRCxRQUFBLE9BQU8sTUFBTSxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLEdBQUcsRUFBRTtRQUN6QztJQUFFLElBQUEsTUFBTTtJQUNOLFFBQUEsT0FBTyxFQUFFO1FBQ1g7SUFDRjtJQUVBLFNBQVMsY0FBYyxDQUFDLFNBQWlCLEVBQUUsT0FBZ0IsRUFBQTtJQUN6RCxJQUFBLElBQUk7SUFDRixRQUFBLE1BQU0sTUFBTSxHQUFHLGNBQWMsRUFBRTtJQUMvQixRQUFBLE1BQU0sQ0FBQyxT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QUUsR0FBRyxDQUFDLENBQUMsV0FBVyxFQUFFO0lBQ2xDLFFBQVEsSUFBSSxFQUFFLElBQUksRUFBRSxDQUFDLFNBQVMsRUFBRSxPQUFPLEVBQUUsQ0FBQyxTQUFTO0lBQ25ELE1BQU07SUFDTixJQUFJLENBQUMsQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDO0lBQ2pCLElBQUksTUFBTSxPQUFPLEdBQUcsQ0FBQyxJQUFJLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxJQUFJLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxLQUFLLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxJQUFJLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLElBQUksRUFBRSxLQUFLLEVBQUUsS0FBSyxDQUFDO0lBQzViLElBQUksTUFBTSxhQUFhLEdBQUcsSUFBSSxDQUFDLFFBQVEsRUFBRSxhQUFhLElBQUksSUFBSSxZQUFZLENBQUMsR0FBRyxFQUFFLENBQUM7SUFDakYsSUFBSSxJQUFJLEdB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
