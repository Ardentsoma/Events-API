# Sourcing venue data from OpenStreetMap

This guide explains how to build `venues-seed.json` — the file the seed
script reads to populate the `Venue` table with **a few hundred real Abuja
venues**.

Pipeline at a glance:

```
Overpass API (OSM)  →  raw GeoJSON-ish JSON  →  converter script  →  venues-seed.json
        (Step 2)                 (Step 3)              (Step 5)            (Step 6)
```

The JSON the seed expects looks like this (`capacity` and `contactInfo` are
`null` when absent):

```json
[
  {
    "id": "js3ng78spqktgf9jdyf9xrz0",
    "name": "Maitama District Park",
    "address": "Constitution Avenue",
    "area": "Abuja",
    "capacity": null,
    "contactInfo": "+234 800 123 4567"
  }
]
```

- `id` — required, generated with `cuid2`
- `name` — required
- `address` — required (the converter uses `addr:street`, falling back to `"Abuja"`)
- `area` — required (the converter uses `addr:suburb`, falling back to `"Abuja"`)
- `capacity` — number or `null` (OSM rarely has it; the converter parses capacity-ish tags when present)
- `contactInfo` — string or `null` (`phone` / `contact:phone`, else `null`)

The converter script lives at `scripts/convert-osm-venues.mjs` and handles
both export shapes described below.

---

## Step 1 — Why Overpass API

Overpass is OSM's query API. It lets us pull nodes, ways and relations
(collectively `nwr`) matching certain tags inside a polygon, and return them
as JSON. Ways and relations (buildings, event centres, parks) become single
records when we ask for `out center`, which outputs a representative
coordinate for each element.

Alternatives exist (Geofabrik regional extract + `osmium`, or QuickOSM in
QGIS) but the Overpass route requires no tooling beyond `curl` or a browser.

---

## Step 2 — The query

Run this Overpass QL query. Two variants, same idea:

**Variant A — use the whole Federal Capital Territory (recommended).**
This keeps `addr:suburb` values intact, so districts (Wuse, Gwarinpa…)
survive into the "area" field:

```
[out:json][timeout:60];
area["name"="Federal Capital Territory"]->.fct;
( node(area.fct)[amenity~"^(restaurant|cafe|fast_food|food_court|bar|pub|nightclub|cinema|theatre|concert_hall|marketplace|events_venue|conference_centre|community_centre|hotel|place_of_meeting)$"];
  node(area.fct)[tourism~"^(attraction|museum|gallery|stadium|zoo)$"];
  node(area.fct)[leisure~"^(park|garden|sports_centre|stadium|marina)$"];
  node(area.fct)[shop~"^(mall|department_store)$"];
  way(area.fct)[amenity~"^(restaurant|cafe|fast_food|food_court|bar|pub|nightclub|cinema|theatre|concert_hall|marketplace|events_venue|conference_centre|community_centre|hotel)$"];
  way(area.fct)[tourism~"^(attraction|museum|gallery|stadium|zoo)$"];
  way(area.fct)[leisure~"^(park|garden|sports_centre|stadium|marina)$"];
  relation(area.fct)[amenity~"^(cinema|theatre|marketplace|conference_centre|hotel)$"];
);
out tags center;
```

> Tip: `out tags center;` returns the tags **and** a centre coordinate for
> every element (nodes get `lat`/`lon`, ways and relations get a `center`
> object). If `area[...]` with the name fails because the admin level
> differs, widen the match with `area["name"~"Federal Capital Territory"];`.

**Variant B — a raw bounding box** (faster, less complete, no suburbs):

```
[out:json][timeout:60];
(
  nwr[amenity~"^(restaurant|cafe|fast_food|food_court|bar|pub|nightclub|cinema|theatre|marketplace|events_venue|conference_centre|community_centre|hotel)$"](8.45,6.80,9.55,7.90);
  nwr[tourism~"^(attraction|museum|gallery|stadium|zoo)$"](8.45,6.80,9.55,7.90);
  nwr[leisure~"^(park|garden|sports_centre|stadium|marina)$"](8.45,6.80,9.55,7.90);
);
out tags center;
```

---

## Step 3 — Run the query

Choose one:

**Option 1 — curl (headless):**

```bash
curl "https://overpass-api.de/api/interpreter" \
  --data-urlencode 'data=[out:json][timeout:60]; area["name"="Federal Capital Territory"]->.fct; ...; out tags center;' \
  -o raw-abuja.json
```

`--data-urlencode 'data=...'` is important — Overpass needs the query sent as
a `data` POST form field, URL-encoded.

**Option 2 — overpass-turbo (browser):**

1. Open https://overpass-turbo.eu/
2. Paste the query in the left panel, replacing the default query.
3. Click **Run**. When it renders on the map, click **Export ▸ Download data**
   and save the file (it is already GeoJSON/JSON).
4. Save it as `raw-abuja.json`.

**(Optional) Bump the count.** If the result is far beyond a few hundred
venues, add `; out center;` count handling or narrow the regexes. For this
assessment, if you get a few hundred, you're done. If you get fewer than 100,
drop a few filter classes or raise `timeout` to 120.

---

## Step 4 — Inspect the raw file (sanity check)

The overpass-turbo export is a GeoJSON `FeatureCollection`: a `features`
array where each feature has `properties` (the OSM tags, including `@id` and
`@geometry`) and a `geometry` with `coordinates`. For ways and relations the
exported point is the element's center. Quick check:

```bash
node -e "const d=require('./raw-abuja.json'); console.log('features:', d.features.length); console.log(d.features.filter(f=>f.properties.name).slice(0,5).map(f=>f.properties['@id']+' '+f.properties.name));"
```

---

## Step 5 — Run the converter

The repo already ships `scripts/convert-osm-venues.mjs` (plain Node + the
project's `cuid2` dependency). It understands both the overpass-turbo
`FeatureCollection` shape and raw Overpass `elements` JSON. Its behaviour,
per record in the input:

- **Skip** any feature with no `name`.
- **Skip** anything with no usable coordinate.
- **`address`** → `addr:street`, falling back to `"Abuja"`.
- **`area`** → `addr:suburb`, falling back to `"Abuja"`.
- **`contactInfo`** → `phone` or `contact:phone`, else `null`.
- **`capacity`** → parsed from `capacity`/`capacity:persons`/`seats`/
  `hall:capacity` et al., else `null`.
- **`id`** → a fresh `cuid2`.
- Nodes use their `lat`/`lon`; ways and relations use their `center` point
  (in the GeoJSON export that arrives as `geometry.coordinates`).
- **Dedupe** on `name + area` — the same stable key the database enforces
  (`@@unique([name, area])`) — so the file can never violate the constraint.

---

## Step 6 — Generate the JSON

```bash
node scripts/convert-osm-venues.mjs raw-abuja.json
```

Verify:

```bash
node -e "const v=require('./venues-seed.json'); console.log('venues:', v.length); console.log(Object.groupBy(v, x=>x.area) ?? '')"
```

If the count is in the low-to-mid hundreds, you're set. Then run the seed:

```bash
npm run seed
```

> Note on areas: a bbox query (Variant B) drops `addr:suburb`, so most venues
> get area `"Abuja"`. Running the named-area query (Variant A) preserves
> districts (Wuse, Gwarinpa…) where OSM has them.

---

## Step 7 — Re-running / keeping it fresh

- The seed script `prisma/seed.ts` reads `venues-seed.json` and **upserts**
  keyed on `[name, area]`, so re-running Step 6 + `npm run seed` after a fresh
  OSM pull only adds/updates venues; it never duplicates them. The `id` is only
  written on insert, so re-seeding doesn't churn primary keys.
- Overpass results change as the community edits OSM, so numbers in this guide
  are indicative only — rerun whenever you want the venue list refreshed.

---

## Tag → field cheat sheet (why the query looks like it does)

| Platform field    | OSM tags used                                                        |
| ----------------- | -------------------------------------------------------------------- |
| `id`              | generated with `cuid2`                                               |
| `name`            | `name`                                                               |
| `address`         | `addr:street`, else `"Abuja"`                                        |
| `area`            | `addr:suburb`, else `"Abuja"`                                        |
| `capacity`        | `capacity`, `capacity:persons`, `capacity:people`, `seats`, `hall:capacity`, `max_persons` |
| `contactInfo`     | `phone` or `contact:phone`, else `null`                              |

Filter classes that produce event-able venues: restaurants, cafes, bars and
nightclubs, cinemas and theatres, concert halls and conference centres,
event/community centres, hotels, museums and galleries, parks, gardens,
stadiums and sports centres, malls and markets.