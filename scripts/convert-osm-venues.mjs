// Converts an OpenStreetMap Overpass export into venues-seed.json.
//
// Handles both shapes Overpass produces:
//  - overpass-turbo GeoJSON ("FeatureCollection" with a "features" array,
//    tags under "properties", coordinates under "geometry") — what "Export ▸
//    Download data" and overpass-turbo.eu produce.
//  - raw Overpass JSON (an "elements" array, tags under "tags", nodes feature
//    lat/lon and ways/relations feature a "center" object) — `out center`.
//
// Usage: node scripts/convert-osm-venues.mjs <input.json>
import { createId } from '@paralleldrive/cuid2';
import { readFileSync, writeFileSync } from 'node:fs';

const [, , input = 'abuja-venues-raw.json'] = process.argv;
const OUT_PATH = 'venues-seed.json';

const data = JSON.parse(readFileSync(input, 'utf8'));
const records = data.features ?? data.elements ?? data;

const tagsOf = (el) => el.properties ?? el.tags ?? {};
const isNode = (el) => {
  const at = tagsOf(el)['@id'] ?? '';
  if (/^node\//.test(at)) return true;
  if (/^(way|relation)\//.test(at)) return false;
  return el.type === 'node';
};

// Nodes expose lat/lon directly; ways and relations expose a "center" point.
// In the overpass-turbo GeoJSON export both arrive as geometry.coordinates.
const coordinateOf = (el, node) => {
  if (el.geometry && Array.isArray(el.geometry.coordinates)) {
    const [lon, lat] = el.geometry.coordinates;
    return { lat, lon };
  }
  return node
    ? { lat: el.lat, lon: el.lon }
    : el.center
      ? { lat: el.center.lat, lon: el.center.lon }
      : null;
};

const capacityOf = (t) => {
  for (const k of [
    'capacity',
    'capacity:persons',
    'capacity:people',
    'seats',
    'hall:capacity',
    'max_persons',
  ]) {
    const v = Number.parseInt(t[k], 10);
    if (Number.isInteger(v) && v > 0) return v;
  }
  return null;
};

const venues = [];
const seen = new Set();
let skipped = { noName: 0, noCoords: 0, duplicate: 0 };

for (const el of records) {
  const t = tagsOf(el);
  if (!t.name) {
    skipped.noName += 1;
    continue;
  }
  if (!coordinateOf(el, isNode(el))) {
    skipped.noCoords += 1;
    continue;
  }

  const address = t['addr:street'] || 'Abuja';
  const area = t['addr:suburb'] || 'Abuja';

  // Dedupe on the same stable key the DB enforces (unique [name, area]) so the
  // file can never violate the constraint.
  const key = `${t.name.trim()}::${area.trim()}`.toLowerCase();
  if (seen.has(key)) {
    skipped.duplicate += 1;
    continue;
  }
  seen.add(key);

  venues.push({
    id: createId(),
    name: t.name,
    address,
    area,
    capacity: capacityOf(t),
    contactInfo: t.phone || t['contact:phone'] || null,
  });
}

venues.sort((a, b) => a.area.localeCompare(b.area) || a.name.localeCompare(b.name));
writeFileSync(OUT_PATH, JSON.stringify(venues, null, 2));

console.log(
  `Processed ${venues.length} venues (${skipped.noName} with no name, ` +
    `${skipped.noCoords} with no coordinates, ${skipped.duplicate} duplicates skipped) ` +
    `and wrote them to ${OUT_PATH}`,
);