import { Polygon } from "geojson";

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
    const R = 6371000; // radius of Earth in meters
    const toRad = (x: number) => x * Math.PI / 180;

    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);

    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) ** 2;

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // distance in meters
}

function ringArea(coords: number[][]) {
    let area = 0;
    for (let i = 0, len = coords.length - 1; i < len; i++) {
        area += (coords[i][0] * coords[i + 1][1]) - (coords[i + 1][0] * coords[i][1]);
    }
    return area / 2;
}

function fixPolygonWinding(polygonGeom: Polygon): Polygon {
    if (polygonGeom.type !== "Polygon") throw new Error("Only Polygon geometries supported");
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

function removeConsecutiveDuplicates(coords: number[][]): number[][] {
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

function ensureRingClosed(ring: number[][]): number[][] {
    if (ring.length < 2) return ring;
    const first = ring[0], last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
        ring.push([first[0], first[1]]);
    }
    return ring;
}

function cleanPolygonGeometry(polygonGeom: Polygon): Polygon {
    polygonGeom.coordinates = polygonGeom.coordinates.map(ring => {
        let cleaned = removeConsecutiveDuplicates(ring);
        cleaned = ensureRingClosed(cleaned);
        return cleaned;
    });
    return fixPolygonWinding(polygonGeom); // function from previous message
}