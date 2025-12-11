// ==UserScript==
// @name         WME Swiss helper
// @namespace    73vw
// @version      1.0
// @description  WME Swiss helper
// @author       Maël Pedretti
// @include     https://www.waze.com/editor*
// @include     https://www.waze.com/*/editor*
// @include     https://beta.waze.com/editor*
// @include     https://beta.waze.com/*/editor*
// @exclude     https://www.waze.com/user/*
// @exclude     https://www.waze.com/*/user/*
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      api3.geo.admin.ch
// @connect      data.sbb.ch
// ==/UserScript==

(function () {
  "use strict";

  function computeToleranceFromPoint([lon, lat], meters = 10) {
    const metersPerDegreeLat = 111320; // constant
    const metersPerDegreeLon = 111320 * Math.cos((lat * Math.PI) / 180);

    const degLat = meters / metersPerDegreeLat;
    const degLon = meters / metersPerDegreeLon;

    return Math.min(degLat, degLon);
  }

  function normalizeStreetNames(str) {
    return str.toLowerCase().replace(/-/g, " ").trim();
  }

  function getSegmentIntersection([A, B], [C, D], tolerance = 1e-12) {
    const [x1, y1] = A;
    const [x2, y2] = B;
    const [x3, y3] = C;
    const [x4, y4] = D;

    const denominator = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);

    if (Math.abs(denominator) < tolerance) return null; // Parallel or coincident

    const px =
      ((x1 * y2 - y1 * x2) * (x3 - x4) - (x1 - x2) * (x3 * y4 - y3 * x4)) /
      denominator;
    const py =
      ((x1 * y2 - y1 * x2) * (y3 - y4) - (y1 - y2) * (x3 * y4 - y3 * x4)) /
      denominator;

    const isBetween = (a, b, val) =>
      val >= Math.min(a, b) - tolerance && val <= Math.max(a, b) + tolerance;
    const isOnSegment = (P, Q, R) =>
      isBetween(P[0], Q[0], R[0]) && isBetween(P[1], Q[1], R[1]);

    const intersection = [px, py];

    // Check if intersection is on both segments
    if (isOnSegment(A, B, intersection) && isOnSegment(C, D, intersection)) {
      return intersection;
    }

    return null;
  }

  function isClose(p1, p2, tolerance = null) {
    if (tolerance == null) tolerance = computeToleranceFromPoint(p1);
    return (
      Math.abs(p1[0] - p2[0]) < tolerance && Math.abs(p1[1] - p2[1]) < tolerance
    );
  }

  function findEntryPoint(line, polygon, tolerance = 1e-9) {
    // there are several cases here.
    // 1) Segment starts outside and ends inside. We want to detect the intersection
    // 2) Segment starts on the edge and finished outside -> We want to detect if it has more than one intersections.
    // If it has only one (the point on the edge), we don't want to split. That means that this might be the result of a precedent split.
    let [A, B] = line;
    const ring = polygon[0];

    const startsOnEdge = isPointOnEdge(polygon, A, tolerance);
    const startsInside = isPointInPolygon(A, polygon, tolerance);
    const endsOnEdge = isPointOnEdge(polygon, B, tolerance);
    const endsInside = isPointInPolygon(B, polygon, tolerance);
    if (
      (!(startsOnEdge || startsInside) && !(endsOnEdge || endsInside)) ||
      (startsInside && endsInside)
    )
      return null;

    for (let i = 0; i < ring.length - 1; i++) {
      const C = ring[i];
      const D = ring[i + 1];

      let intersection = getSegmentIntersection([A, B], [C, D]);
      if (intersection) return intersection;
    }

    return null;
  }

  function isPointInPolygon(point, polygon, tolerance = 1e-9) {
    const [px, py] = point;
    let inside = false;

    const ring = polygon[0];
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];

      const intersect =
        yi > py !== yj > py &&
        px < ((xj - xi) * (py - yi)) / (yj - yi + Number.EPSILON) + xi;
      if (intersect) inside = !inside;
    }

    return inside;
  }

  function isPointOnEdge(polygon, point, tolerance = 1e-9) {
    const ring = polygon[0]; // Use outer ring

    for (let i = 0; i < ring.length - 1; i++) {
      const A = ring[i];
      const B = ring[i + 1];

      // Cross product == 0 means point is colinear with segment AB
      const cross =
        (B[1] - A[1]) * (point[0] - A[0]) - (B[0] - A[0]) * (point[1] - A[1]);
      if (Math.abs(cross) > tolerance) continue; // Not colinear

      // Dot product range test: ensure point is between A and B
      const dot =
        (point[0] - A[0]) * (B[0] - A[0]) + (point[1] - A[1]) * (B[1] - A[1]);
      if (dot < -tolerance) continue; // Behind segment

      const lenSq = (B[0] - A[0]) ** 2 + (B[1] - A[1]) ** 2;
      if (dot <= lenSq + tolerance) return true; // Within segment bounds
    }

    return false;
  }

  function filterSegmentsInOrEntering(polygon, segments) {
    return segments.filter((segment) => {
      const [A, B] = segment.geometry.coordinates;
      const startsOnEdge = isPointOnEdge(polygon, A);
      const endsInside = isPointInPolygon(B, polygon);
      const fullInside =
        isPointInPolygon(A, polygon) && isPointInPolygon(B, polygon);
      return (startsOnEdge && endsInside) || fullInside;
    });
  }

  function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // radius of Earth in meters
    const toRad = (x) => (x * Math.PI) / 180;

    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);

    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // distance in meters
  }

  function measureTextWidth(
    text,
    font = '14px "Rubik", "Waze Boing", "Waze Boing HB light", sans-serif',
  ) {
    const canvas =
      measureTextWidth.canvas ||
      (measureTextWidth.canvas = document.createElement("canvas"));
    const ctx = canvas.getContext("2d");
    ctx.font = font;
    return ctx.measureText(text).width;
  }

  function getNaturalBoxSize(label, value, extra = "") {
    const paddingX = 5;
    const paddingY = 5;
    const fontSize = 14;
    const lineHeight = 18;
    const font = `${fontSize}px "Rubik", "Waze Boing", "Waze Boing HB light", sans-serif`;

    const labelWidth = measureTextWidth(label, font);
    const valueWidth = measureTextWidth(value, font);
    const extraWidth = measureTextWidth(extra, font);
    const textWidth = Math.max(labelWidth, valueWidth, extraWidth);

    const width = Math.ceil(textWidth + 2 * paddingX);
    const height = 3 * lineHeight + 2 * paddingY;

    return { width, height, paddingY };
  }

  function createAutoScalingSvg(label, value, extra = "") {
    const {
      width: boxWidth,
      height: boxHeight,
      paddingY,
    } = getNaturalBoxSize(label, value, extra);

    const fontSize = 14;
    const lineHeight = 18;
    const textX = boxWidth / 2;

    const labelY = paddingY + lineHeight - 2;
    const valueY = paddingY + 2 * lineHeight - 2;
    const extraY = paddingY + 3 * lineHeight - 2;

    return `
<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" viewBox="0 0 ${boxWidth} ${boxHeight}">
  <defs>
    <filter id="wmeShadow" x="-50%" y="-50%" width="200%" height="200%">
      <feDropShadow dx="0" dy="1" stdDeviation="1" flood-color="#000" flood-opacity="0.2" />
    </filter>
  </defs>

  <rect x="0" y="0" rx="6" ry="6" width="${boxWidth}" height="${boxHeight}"
        fill="#f0f3f5" stroke="#ccc" filter="url(#wmeShadow)" />

  <text x="${textX}" y="${labelY}"
        font-size="${fontSize}" font-family="Segoe UI, sans-serif"
        fill="#333" text-anchor="middle">
    ${label}
  </text>
  <text x="${textX}" y="${valueY}"
        font-size="${fontSize}" font-family="Segoe UI, sans-serif"
        fill="#666" text-anchor="middle">
    ${value}
  </text>
  <text x="${textX}" y="${extraY}"
        font-size="${fontSize}" font-family="Segoe UI, sans-serif"
        fill="#999" text-anchor="middle">
    ${extra}
  </text>
</svg>
`.trim();
  }

  function svgToBase64(svgString) {
    const utf8Bytes = new TextEncoder().encode(svgString);
    const binary = Array.from(utf8Bytes, (b) => String.fromCharCode(b)).join(
      "",
    );
    return `data:image/svg+xml;base64,${btoa(binary)}`;
  }

  function ringArea(coords) {
    let area = 0;
    for (let i = 0, len = coords.length - 1; i < len; i++) {
      area += coords[i][0] * coords[i + 1][1] - coords[i + 1][0] * coords[i][1];
    }
    return area / 2;
  }

  function fixPolygonWinding(polygonGeom) {
    if (polygonGeom.type !== "Polygon")
      throw new Error("Only Polygon geometries supported");
    // Outer ring should be CCW
    if (ringArea(polygonGeom.coordinates[0]) < 0) {
      polygonGeom.coordinates[0].reverse();
    }
    // Holes should be CW
    for (let i = 1; i < polygonGeom.coordinates.length; i++) {
      if (ringArea(polygonGeom.coordinates[i]) > 0) {
        polygonGeom.coordinates[i].reverse();
      }
    }
    return polygonGeom;
  }

  function removeConsecutiveDuplicates(coords) {
    if (!coords.length) return coords;
    const deduped = [coords[0]];
    for (let i = 1; i < coords.length; i++) {
      const prev = coords[i - 1];
      const curr = coords[i];
      // Compare as numbers (lng, lat)
      if (prev[0] !== curr[0] || prev[1] !== curr[1]) {
        deduped.push(curr);
      }
    }
    return deduped;
  }

  function ensureRingClosed(ring) {
    if (ring.length < 2) return ring;
    const first = ring[0],
      last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      ring.push([first[0], first[1]]);
    }
    return ring;
  }

  function cleanPolygonGeometry(polygonGeom) {
    polygonGeom.coordinates = polygonGeom.coordinates.map((ring) => {
      let cleaned = removeConsecutiveDuplicates(ring);
      cleaned = ensureRingClosed(cleaned);
      return cleaned;
    });
    return fixPolygonWinding(polygonGeom); // function from previous message
  }

  function showWmeDialog({ message, buttons }) {
    return new Promise((resolve) => {
      // Try to reuse WME styles if possible, fallback otherwise
      const modal = document.createElement("div");
      modal.style.position = "fixed";
      modal.style.top = "50%";
      modal.style.left = "50%";
      modal.style.transform = "translate(-50%, -50%)";
      modal.style.background = "#fff";
      modal.style.padding = "20px";
      modal.style.boxShadow = "0 2px 10px rgba(0,0,0,0.5)";
      modal.style.zIndex = 10000;
      modal.style.borderRadius = "6px";
      modal.style.textAlign = "center";
      modal.style.minWidth = "200px";

      // Build HTML
      const msg = document.createElement("p");
      msg.innerHTML = message;
      modal.appendChild(msg);

      buttons.forEach(({ label, value }) => {
        const btn = document.createElement("button");
        btn.textContent = label;

        // If WME button CSS class exists, use it:
        btn.className = "btn btn-default"; // You can check what CSS WME uses on buttons

        btn.style.margin = "5px";
        btn.onclick = () => {
          modal.remove();
          resolve(value);
        };
        modal.appendChild(btn);
      });

      // Add modal to page
      document.body.appendChild(modal);
    });
  }

  const scriptName = "WME Swiss Helper";

  class Layer {
    constructor({ name }) {
      this.name = name;
    }
    addCheckBox({ wmeSDK }) {
      wmeSDK.LayerSwitcher.addLayerCheckbox({ name: this.name });
    }
    addToMap({ wmeSDK }) {
      throw new Error("not implemented");
    }
    removeFromMap({ wmeSDK }) {
      wmeSDK.Map.removeLayer({ layerName: this.name });
    }
  }

  class TileLayer extends Layer {
    constructor({ name, tileHeight, tileWidth, fileName, servers }) {
      super({ name: name }); // call the super class constructor and pass in the name parameter
      this.tileHeight = tileHeight;
      this.tileWidth = tileWidth;
      this.fileName = fileName;
      this.servers = servers;
    }
    addToMap({ wmeSDK }) {
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
    }
  }

  class FeatureLayer extends Layer {
    constructor({ name, styleContext, styleRules }) {
      super({ name: name }); // call the super class constructor and pass in the name parameter
      this.styleContext = styleContext;
      this.styleRules = styleRules;
      this.features = new Map();
      this.minZoomLevel = 15;
    }
    async addToMap({ wmeSDK }) {
      wmeSDK.Map.addLayer({
        layerName: this.name,
        styleContext: this.styleContext,
        styleRules: this.styleRules,
      });
      if (this.featureClicked) {
        wmeSDK.Events.trackLayerEvents({ layerName: this.name });
      }
      await this.render({ wmeSDK: wmeSDK });
    }

    async featureClicked({ wmeSDK, featureId }) {
      throw new Error("not implemented");
    }
    mapRecordToFeature({ wmeSDK, featureId }) {
      throw new Error("not implemented");
    }

    drawFeatures({ wmeSDK, features }) {
      const wazeFeatures = Array.from(features.values()).flatMap((r) =>
        this.mapRecordToFeature({ record: r }),
      );

      const result = {
        features: wazeFeatures,
        layerName: this.name,
      };
      wmeSDK.Map.addFeaturesToLayer(result);
    }
    async *fetchData({ wmeSDK, offset = 0 }) {}
    shouldDrawRecord({ wmeSDK, record }) {
      throw new Error("not implemented");
    }
    addRecordToFeatures({ record }) {
      throw new Error("not implemented");
    }
    async render({ wmeSDK }) {
      let checked = wmeSDK.LayerSwitcher.isLayerCheckboxChecked({
        name: this.name,
      });
      if (!checked) {
        return;
      }
      const zoomLevel = wmeSDK.Map.getZoomLevel();
      wmeSDK.Map.removeAllFeaturesFromLayer({ layerName: this.name });
      if (zoomLevel < this.minZoomLevel) {
        return;
      }

      for await (const batch of this.fetchData({ wmeSDK })) {
        console.log(`Fetched batch of ${batch.length} records`);
        for (const record of batch) {
          this.addRecordToFeatures({ record: record });
          try {
            if (
              !(await this.shouldDrawRecord({ wmeSDK: wmeSDK, record: record }))
            ) {
              continue;
            }
            this.drawFeatures({ wmeSDK, features: [record] });
          } catch (error) {
            console.error(error);
            console.log(record);
            return;
          }
        }
      }
    }
  }

  class SwissMapGeoAdminLayer extends FeatureLayer {
    constructor(params) {
      super(params); // call the super class constructor and pass in the name parameter
      this.maxRecordsPerPage = 201;
      this.baseUrl = `https://api3.geo.admin.ch/rest/services/api/MapServer/identify?geometryType=esriGeometryEnvelope&imageDisplay=0,0,0&mapExtent=0,0,0,0&tolerance=0&sr=4326`;
      this.layer = "";
    }

    addRecordToFeatures({ record }) {
      this.features.set(record.id, record);
    }

    mapRecordToFeature({ record }) {
      let records = [];
      if (record.geometry.paths) {
        records.push(
          ...record.geometry.paths.map((path, index) => ({
            geometry: {
              coordinates: path,
              type: "LineString",
            },
            type: "Feature",
            id: `${record.id}-${index}`,
            properties: {
              label: record?.attributes?.label,
            },
          })),
        );
      }
      if (record.geometry.rings) {
        let rec = {
          geometry: {
            coordinates: record.geometry.rings,
            type: "Polygon",
          },
          type: "Feature",
          id: `${record.id}-0`,
          properties: {
            label: record?.attributes?.label,
          },
        };
        cleanPolygonGeometry(rec.geometry);
        records.push(rec);
      }
      if (record.geometry.x && record.geometry.y) {
        let rec = {
          geometry: {
            coordinates: [record.geometry.x, record.geometry.y],
            type: "Point",
          },
          type: "Feature",
          id: record.id,
          properties: record?.attributes,
        };
        records.push(rec);
      }
      return records;
    }

    async *fetchData({ wmeSDK, offset = 0 }) {
      const mapExtent = wmeSDK.Map.getMapExtent();
      const url = `${this.baseUrl}&layers=all:${this.layer}&offset=${offset}&geometry=${mapExtent.join(",")}`;
      console.log(url);

      const response = await GM.xmlHttpRequest({
        method: "GET",
        url,
        responseType: "json",
      });

      const batch = response.response?.results || [];

      yield batch; // Yield the current batch

      if (batch.length === this.maxRecordsPerPage) {
        yield* this.fetchData({
          wmeSDK,
          offset: offset + this.maxRecordsPerPage,
        }); // Yield next batches
      }
    }
  }

  class StreetLayer extends SwissMapGeoAdminLayer {
    constructor(params) {
      super(params);
      this.layer = "ch.swisstopo.amtliches-strassenverzeichnis";
      // https://web-assets.waze.com/wme_sdk_docs/production/latest/variables/index.SDK.ROAD_TYPE.html
      this.ROAD_TYPES_TO_AVOID = [15, 3, 6, 7, 2, 18, 4, 19];
    }
    async shouldDrawRecord({ wmeSDK, record }) {
      return true;
    }
    async featureClicked({ wmeSDK, featureId }) {
      let subFeatureId = featureId.split("-");
      let swissFeatureId = parseInt(subFeatureId[0]);
      let pathNumber = subFeatureId.length > 1 ? subFeatureId[1] : 0;
      let feature = this.features.get(swissFeatureId);
      let street = wmeSDK.DataModel.Streets.getStreet({
        streetName: feature.attributes.label,
      });
      console.log(feature);

      if (feature.geometry.paths) {
        let path = feature.geometry.paths[pathNumber];
        let newSegmentId = wmeSDK.DataModel.Segments.addSegment({
          geometry: {
            coordinates: path,
            type: "LineString",
          },
          roadType: 1,
        });
        try {
          let street = wmeSDK.DataModel.Streets.addStreet({
            streetName: feature.attributes.label,
          });
          let segment = wmeSDK.DataModel.Segments.getById({
            segmentId: newSegmentId,
          });
          wmeSDK.DataModel.Segments.updateAddress({
            segmentId: newSegmentId,
            primaryStreetId: street.id,
          });
          wmeSDK.DataModel.Segments.updateSegment({
            segmentId: newSegmentId,
            revSpeedLimit: 50,
            fwdSpeedLimit: 50,
          });
          wmeSDK.Editing.setSelection({
            selection: {
              ids: [newSegmentId],
              objectType: "segment",
              direction: "A_TO_B",
            },
          });
          wmeSDK.Map.removeFeatureFromLayer({
            layerName: this.name,
            featureId: featureId,
          });
          console.log("Removed");
        } catch (error) {
          console.error(error);
          return;
        }
      } else {
        this.splitSegments({
          wmeSDK: wmeSDK,
          feature: feature,
          featureId: featureId,
        });

        // Segments splitted but not saved are still returned but without toNodeId and fromNodeId
        let segments = wmeSDK.DataModel.Segments.getAll()
          .filter((s) => s.toNodeId && s.fromNodeId)
          .filter((s) => !this.ROAD_TYPES_TO_AVOID.includes(s.roadType));
        const filtered = filterSegmentsInOrEntering(
          feature.geometry.rings,
          segments,
        );
        let street = wmeSDK.DataModel.Streets.getAll().find((street) =>
          this.compareStreetNames({
            compareFrom: street.name,
            compareTo: feature.attributes.stn_label,
          }),
        );
        for (let segment of filtered) {
          if (!street) {
            const segmentAddress = wmeSDK.DataModel.Segments.getAddress({
              segmentId: segment.id,
            });
            street = wmeSDK.DataModel.Streets.addStreet({
              streetName: feature.attributes.stn_label,
              cityId: segmentAddress.city.id,
            });
          }
          if (segment.primaryStreetId == street.id) {
            continue;
          }
          wmeSDK.DataModel.Segments.updateAddress({
            primaryStreetId: street.id,
            segmentId: segment.id,
          });
        }
        wmeSDK.Map.removeFeatureFromLayer({
          layerName: this.name,
          featureId: featureId,
        });
      }
    }

    compareStreetNames({ compareFrom, compareTo }) {
      return (
        normalizeStreetNames(compareFrom) === normalizeStreetNames(compareTo)
      );
    }

    splitSegment({ wmeSDK, feature, segment }) {
      let entry = null;
      const coordinates = segment.geometry.coordinates;
      const A = coordinates[0];
      const B = coordinates.at(-1);
      for (let i = 0; i < coordinates.length - 1; i++) {
        const C = coordinates[i];
        const D = coordinates[i + 1];
        entry = findEntryPoint([C, D], feature.geometry.rings);
        if (!entry) continue;
        const entryCloseToStart = isClose(entry, A);
        const entryCloseToEnd = isClose(entry, B);
        if (entry && !entryCloseToStart && !entryCloseToEnd) {
          const segmentAddress = wmeSDK.DataModel.Segments.getAddress({
            segmentId: segment.id,
          });
          if (
            this.compareStreetNames({
              compareFrom: segmentAddress.street.name,
              compareTo: feature.attributes.stn_label,
            })
          ) {
            entry = null;
            continue;
          }
          wmeSDK.DataModel.Segments.splitSegment({
            segmentId: segment.id,
            splitPoint: {
              coordinates: entry,
              type: "Point",
            },
          });

          // the segment with the id of segment.id does not exist anymore, return
          break;
        }
      }

      return entry;
    }
    splitSegments({ wmeSDK, feature, featureId }) {
      let entry = null;
      // When we split a segment, it generates two new ones with a different id. In case any of those still cuts the polygon, we must restart the process.
      do {
        // Segments splitted but not saved are still returned but without toNodeId and fromNodeId
        let segments = wmeSDK.DataModel.Segments.getAll()
          .filter((s) => s.toNodeId && s.fromNodeId)
          .filter((s) => !this.ROAD_TYPES_TO_AVOID.includes(s.roadType));
        entry = null;
        for (let segment of segments) {
          entry = this.splitSegment({
            wmeSDK: wmeSDK,
            feature: feature,
            segment: segment,
          });
          if (entry) break;
        }
      } while (entry != null);
    }
  }
  class HouseNumberLayer extends SwissMapGeoAdminLayer {
    constructor(params) {
      super(params);
      this.layer = "ch.swisstopo.amtliches-gebaeudeadressverzeichnis";
      this.minZoomLevel = 18;
    }
    async shouldDrawRecord({ wmeSDK, record }) {
      // let segments = wmeSDK.DataModel.Segments.getAll();
      // for (let segment of segments) {
      //     segment.address = wmeSDK.DataModel.Segments.getAddress({ segmentId: segment.id });
      // }
      // segments = segments.filter((s) => s.address?.street?.name?.toLowerCase() == record.attributes?.stn_label?.toLowerCase());
      // let houseNumbers = await wmeSDK.DataModel.HouseNumbers.fetchHouseNumbers({ segmentIds: segments.map((s) => s.id) });
      // debugger;
      return (
        Boolean(record.geometry.x) &&
        Boolean(record.geometry.y) &&
        !record.attributes.adr_number.includes(".")
      );
    }
    async featureClicked({ wmeSDK, featureId }) {
      let feature = this.features.get(featureId);
      wmeSDK.DataModel.HouseNumbers.addHouseNumber({
        number: feature.attributes.adr_number,
        point: {
          coordinates: [feature.geometry.x, feature.geometry.y],
          type: "Point",
        },
      });

      const result = {
        featureId: featureId,
        layerName: this.name,
      };
      wmeSDK.Map.removeFeatureFromLayer(result);
    }
  }
  class PLZLayer extends FeatureLayer {
    constructor(params) {
      super(params);
      this.layer = "ch.swisstopo-vd.ortschaftenverzeichnis_plz";
      this.featureClicked = null;
      this.minZoomLevel = 12;
    }
    async shouldDrawRecord({ wmeSDK, record }) {
      return true;
    }
  }
  class SBBDataLayer extends FeatureLayer {
    constructor(params) {
      super(params);
      this.baseUrl = "https://data.sbb.ch/api/explore/v2.1/catalog/datasets";
      this.minZoomLevel = 14;
      this.dataSet = "";
      this.maxRecordsPerPage = 50;
    }

    addRecordToFeatures({ record }) {
      this.features.set(record.number, record);
    }

    mapRecordToFeature({ record }) {
      return {
        geometry: {
          coordinates: [
            record.geopos_haltestelle.lon,
            record.geopos_haltestelle.lat,
          ],
          type: "Point",
        },
        type: "Feature",
        id: record.number,
      };
    }

    async *fetchData({ wmeSDK, offset = 0 }) {
      const mapExtent = wmeSDK.Map.getMapExtent();
      const x1 = mapExtent[0];
      const y1 = mapExtent[1];
      const x2 = mapExtent[2];
      const y2 = mapExtent[3];
      const url = `${this.baseUrl}/${this.dataSet}/records?where=in_bbox(geopos_haltestelle,${y1},${x1},${y2},${x2})&limit=50&offset=${offset}`;
      console.log(url);

      const response = await GM.xmlHttpRequest({
        method: "GET",
        url,
        responseType: "json",
      });

      const batch = response.response?.results || [];

      yield batch; // Yield the current batch

      if (batch.length === this.maxRecordsPerPage) {
        yield* this.fetchData({
          wmeSDK,
          offset: offset + this.maxRecordsPerPage,
        }); // Yield next batches
      }
    }
  }

  class BusStopsLayer extends SBBDataLayer {
    constructor(params) {
      super(params);
      this.dataSet = "haltestelle-haltekante";
      this.venueInnerTypeMapping = new Map();
      this.defaultVenueInnerType = "arrêt";
      this.venueInnerTypeMapping.set("TRAIN", "gare");
      this.venueInnerTypeMapping.set("BOAT", "port");
    }
    meansOfTransport({ meansoftransport }) {
      return Array.from(meansoftransport.split("|"));
    }
    venueCategories({ meansoftransport }) {
      let meansOfTransport = this.meansOfTransport({
        meansoftransport: meansoftransport,
      });
      return Array.from(meansOfTransport).map((mean) => {
        if (mean == "METRO") mean = "SUBWAY";
        else if (mean == "BOAT") return "SEAPORT_MARINA_HARBOR";
        return `${mean}_STATION`;
      });
    }
    async shouldDrawRecord({ wmeSDK, record }) {
      if (record.meansoftransport == null || record.meansoftransport == "") {
        return false;
      }
      let { name, alias } = this.recordName({ record: record });
      let venues = wmeSDK.DataModel.Venues.getAll();
      return venues.filter((r) => r.name == name).length == 0;
    }
    recordName({ record }) {
      // We try to split by coma so that we can check if the name of the city is correctly set or if it's been shortened.
      // For example: La Chaux-de-F, Blaise-Cendrars in https://data.sbb.ch/api/explore/v2.1/catalog/datasets/haltestelle-haltekante/records?where=in_bbox(geopos_haltestelle,47.08500521704954,6.798952417221242,47.0920106342034,6.806655721512059)

      let organizationAbbreviation = record.businessorganisationabbreviationde;
      let organizationName = record.businessorganisationdescriptionde;
      let aliases = [];
      let name = record.designationofficial || record.designation || "Bus Stop";
      let splittedName = name.split(",");

      if (
        splittedName.length == 2 &&
        splittedName[0].trim() == record.municipalityname
      ) {
        name = splittedName[1];
      }
      // We don't want to remove the municipality name if:
      // 1) There's only the municipality name as name (like in cff stations name)
      // 2) The name of the stop is `municipality name`-something
      else if (
        name.includes(record.municipalityname) &&
        name.replace(record.municipalityname, "") != "" &&
        !name.replace(record.municipalityname, "").startsWith("-")
      ) {
        name = name.replace(record.municipalityname, "");
      }
      name = name.trim();
      name = String(name).charAt(0).toUpperCase() + String(name).slice(1);

      let meansOfTransport = this.meansOfTransport({
        meansoftransport: record.meansoftransport,
      });
      let venueInnerType = meansOfTransport
        .map(
          (mean) =>
            this.venueInnerTypeMapping.get(mean) || this.defaultVenueInnerType,
        )
        .join(", ");
      if (organizationAbbreviation.toLowerCase() == "sbb") {
        aliases.push(`${name} (${venueInnerType} ${organizationName})`);
        aliases.push(`${name} (${venueInnerType} ${organizationAbbreviation})`);
        organizationAbbreviation = "CFF";
        organizationName = "Chemins de fer fédéraux CFF";
      } else if (
        ["trn/tc", "trn/autovr", "trn-tn", "trn-cmn"].indexOf(
          organizationAbbreviation.toLowerCase(),
        ) != -1
      ) {
        organizationAbbreviation = "transN";
        organizationName = "Transports Publics Neuchâtelois SA";
      } else if (organizationAbbreviation.toLowerCase() == "pag") {
        organizationAbbreviation = null;
        organizationName = "CarPostal SA";
      }

      let shortName = name;

      if (organizationAbbreviation != null) {
        aliases.push(`${name} (${venueInnerType} ${organizationName})`);
        name = `${name} (${venueInnerType} ${organizationAbbreviation})`;
      } else {
        name = `${name} (${venueInnerType} ${organizationName})`;
      }
      return {
        name: name,
        aliases: aliases,
        shortName: shortName,
      };
    }
    async featureClicked({ wmeSDK, featureId }) {
      let stop = this.features.get(featureId);

      const lat = parseFloat(stop.geopos_haltestelle?.lat || stop.lat);
      const lon = parseFloat(stop.geopos_haltestelle?.lon || stop.lon);
      const zoomLevel = wmeSDK.Map.getZoomLevel();
      // Venues are shown (and available in getAll()) only from zoom level 17
      if (zoomLevel < 17) {
        wmeSDK.Map.setMapCenter({
          lonLat: { lat: lat, lon: lon },
          zoomLevel: 17,
        });
        this.render({ wmeSDK: wmeSDK });
        return;
      }

      // Try to find if a venu exists with the designation, in a radius of 50 m.

      const { name, shortName, aliases } = this.recordName({ record: stop });
      let venueCategories = this.venueCategories({
        meansoftransport: stop.meansoftransport,
      });
      let venueCategoriesToSearch = [...venueCategories];
      venueCategoriesToSearch.push("TRANSPORTATION");
      let venues = wmeSDK.DataModel.Venues.getAll();
      venues = venues.filter((v) =>
        v.categories.some((cat) => venueCategoriesToSearch.includes(cat)),
      );
      venues = venues.filter((r) =>
        r.name.toLowerCase().includes(shortName.toLowerCase()),
      );
      let venuesToUpdate = [];

      if (venues.length > 0) {
        venuesToUpdate = venues.filter((venue) => {
          const coordinates = [...venue.geometry.coordinates].reverse();
          const distance = haversineDistance(...coordinates, lat, lon);
          return distance <= 75; // 75 meters
        });
        let venue = venues[0];
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
            { label: "Enregistrer le nouveau", value: "save" },
            { label: "Annuler", value: "cancel" },
          ],
        });
        if (result == "cancel") {
          return;
        } else if (result == "save") {
          venuesToUpdate = [];
        }
      }

      const geometry = {
        type: "Point",
        coordinates: [lon, lat],
      };

      const venue = {
        category: "TRANSPORTATION",
        geometry: geometry,
      };
      if (venuesToUpdate.length == 0) {
        let venueId = wmeSDK.DataModel.Venues.addVenue(venue);
        venuesToUpdate = [
          wmeSDK.DataModel.Venues.getById({ venueId: venueId.toString() }),
        ];
      }
      for (let venue of venuesToUpdate) {
        wmeSDK.DataModel.Venues.updateVenue({
          venueId: venue.id.toString(),
          name: name,
          aliases: aliases,
          categories: venueCategories,
        });
      }
      wmeSDK.Editing.setSelection({
        selection: {
          ids: venuesToUpdate.map((venue) => venue.id.toString()),
          objectType: "venue",
        },
      });
      const result = {
        featureId: featureId,
        layerName: this.name,
      };
      wmeSDK.Map.removeFeatureFromLayer(result);
    }
  }

  let layer_list = [
    new TileLayer({
      name: "Swiss municipalities boundaries",
      tileHeight: 256,
      tileWidth: 256,
      fileName: "${z}/${x}/${y}.png",
      servers: [
        "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissboundaries3d-gemeinde-flaeche.fill/default/current/3857",
      ],
    }),
    new TileLayer({
      name: "Swiss states boundaries",
      tileHeight: 256,
      tileWidth: 256,
      fileName: "${z}/${x}/${y}.png",
      servers: [
        "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissboundaries3d-kanton-flaeche.fill/default/current/3857",
      ],
    }),
    new TileLayer({
      name: "Geographical Names swissNAMES3D",
      tileHeight: 256,
      tileWidth: 256,
      fileName: "${z}/${x}/${y}.png",
      servers: [
        "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissnames3d/default/current/3857",
      ],
    }),
    new TileLayer({
      name: "Cartes nationales (couleur)",
      tileHeight: 256,
      tileWidth: 256,
      fileName: "${z}/${x}/${y}.jpeg",
      servers: [
        "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857",
      ],
    }),
    new StreetLayer({
      name: "Swiss streets layer",
      styleContext: {
        getStrokeColor: ({ feature, zoomLevel }) =>
          feature?.geometry.type == "LineString" ? "red" : "blue",
        getLabel: ({ feature, zoomLevel }) => feature?.properties?.label,
      },
      styleRules: [
        {
          style: {
            // Default style
            strokeColor: "${getStrokeColor}",
            strokeWidth: 3,
            title: "${getLabel}",
            pointerEvents: "all",
            label: "${getLabel}",
            cursor: "pointer",
            labelSelect: true,
            labelAlign: "cm",
            strokeDashstyle: "dash",
          },
        },
      ],
    }),
    new HouseNumberLayer({
      name: "Swiss house numbers",
      styleContext: {
        getExternalGraphic: ({ feature, zoomLevel }) => {
          const label = feature?.properties?.stn_label || "";
          const value = feature?.properties?.adr_number || "";
          const city = feature?.properties?.zip_label || "";
          return svgToBase64(createAutoScalingSvg(label, value, city));
        },

        getPointRadius: ({ feature }) => {
          const label = feature?.properties?.stn_label || "";
          const value = feature?.properties?.adr_number || "";
          const city = feature?.properties?.zip_label || "";
          const { width } = getNaturalBoxSize(label, value, city);
          return width / 2;
        },
      },
      styleRules: [
        {
          style: {
            // Default style
            fillOpacity: 1,
            cursor: "pointer",
            pointRadius: "${getPointRadius}",
            externalGraphic: "${getExternalGraphic}",
          },
        },
      ],
    }),
    new PLZLayer({ name: "Swiss PLZ" }),
    new BusStopsLayer({
      name: "SBB Bus stops",
      styleRules: [
        {
          style: {
            // Default style
            fillOpacity: 1,
            cursor: "pointer",
            pointRadius: 13,
            externalGraphic:
              "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0OSIgaGVpZ2h0PSI0OCIgZmlsbD0iYmxhY2siPjxjaXJjbGUgY3g9IjI0LjcyNiIgY3k9IjI0IiByPSIyMyIgZmlsbD0iI2U2N2UyMiIgc3Ryb2tlPSIjZmZmIiBzdHJva2Utd2lkdGg9IjIiLz48cGF0aCBmaWxsPSIjZmZmIiBkPSJNMjkuNzI2IDE0YTMgMyAwIDAgMSAyLjk5NSAyLjgyNGwuMDA1LjE3NnYxaDEuMDE3bC4xNS4wMDVjLjkzOC4wNiAxLjc2LjY4NCAxLjg0MyAxLjU5MWwuMDA3LjE1NFYyMmwtLjAwNy4xMTdhMSAxIDAgMCAxLS44NzYuODc2bC0uMTE3LjAwNy0uMTE3LS4wMDdhMSAxIDAgMCAxLS44NzYtLjg3NkwzMy43NDMgMjJ2LTJoLTEuMDE3djEwYTEgMSAwIDAgMS0uODgzLjk5M2wtLjExNy4wMDdoLTF2MS41YTEuNSAxLjUgMCAwIDEtMyAwVjMxaC02djEuNWExLjUgMS41IDAgMCAxLTMgMFYzMWgtMWExIDEgMCAwIDEtLjk5My0uODgzTDE2LjcyNiAzMFYyMGgtMXYyYTEgMSAwIDAgMS0uODgzLjk5M2wtLjExNy4wMDdhMSAxIDAgMCAxLS45OTMtLjg4M0wxMy43MjYgMjJ2LTIuMjVjMC0uOTkuODYtMS42ODIgMS44NS0xLjc0NWwuMTUtLjAwNWgxdi0xYTMgMyAwIDAgMSAyLjgyNC0yLjk5NWwuMTc2LS4wMDV6bS0xIDEzaC0xYTEgMSAwIDEgMCAwIDJoMWExIDEgMCAxIDAgMC0ybS03IDBoLTFhMSAxIDAgMSAwIDAgMmgxYTEgMSAwIDEgMCAwLTJtLS40MjktMTFoLTEuNTdsLS4xMTcuMDA3YTEgMSAwIDAgMC0uODc3Ljg3NmwtLjAwNy4xMTd2OGgxMnYtOGwtLjAwNy0uMTE3YTEgMSAwIDAgMC0uNzY0LS44NTdsLS4xMTItLjAyLS4xMTctLjAwNmgtMS41NzJsLS44NTQgMS40OTYtLjA2NS4xYTEgMSAwIDAgMS0uODAzLjQwNEgyMy4wMmwtLjExOS0uMDA3YTEgMSAwIDAgMS0uNzUtLjQ5N3oiLz48c2NyaXB0IHhtbG5zPSIiLz48L3N2Zz4=",
          }, // Same icon than https://web-assets.waze.com/webapps/wme/v2.299-6-g73f94eb0a-production/font/c2058522141903a7/transportation.svg but in orange
        },
      ],
    }),
  ];
  let layers = new Map();
  for (let layer of layer_list) {
    layers.set(layer.name, layer);
  }

  // Wait for the WME SDK to initialize
  unsafeWindow.SDK_INITIALIZED.then(initScript);

  function initLayers({ wmeSDK }) {
    for (let layer of layers.values()) {
      layer.addCheckBox({ wmeSDK: wmeSDK });
    }
    wmeSDK.Events.on({
      eventName: "wme-layer-checkbox-toggled",
      eventHandler: ({ name, checked }) => {
        const layerName = name;
        let layer = layers.get(layerName);
        if (!layer) {
          return;
        }
        if (checked) {
          layer.addToMap({ wmeSDK: wmeSDK });
        } else {
          layer.removeFromMap({ wmeSDK: wmeSDK });
        }
      },
    });
    wmeSDK.Events.on({
      eventName: "wme-layer-feature-clicked",
      eventHandler: async ({ featureId, layerName }) => {
        let layer = layers.get(layerName);
        if (layer && layer instanceof FeatureLayer) {
          await layer.featureClicked({ wmeSDK: wmeSDK, featureId: featureId });
        }
      },
    });
    wmeSDK.Events.on({
      eventName: "wme-map-move-end",
      eventHandler: (e) => {
        for (let layer of layers.values()) {
          if (layer instanceof FeatureLayer) {
            layer.render({ wmeSDK: wmeSDK });
          }
        }
      },
    });
  }

  function initTab({ wmeSDK, tabLabel, tabPane }) {
    tabLabel.innerText = scriptName;
    initLayers({ wmeSDK: wmeSDK });
  }

  function initScript() {
    const wmeSDK = getWmeSdk({
      scriptId: "wme-swiss-helper",
      scriptName: scriptName,
    });

    // Register a new script tab
    wmeSDK.Sidebar.registerScriptTab().then(({ tabLabel, tabPane }) =>
      initTab({ wmeSDK: wmeSDK, tabLabel: tabLabel, tabPane: tabPane }),
    );
  }
})();
