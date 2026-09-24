# Abuja Events & Ticketing API

A REST API that acts as an **information layer** for an events and ticketing
platform based in Abuja, Nigeria. It is not a checkout or ticket-selling
platform — it exposes Venue, Event and Ticket data for other tools to consume
(for example, an events aggregator doing discovery, or a door check-in tool
pulling a guest list).

**Live API:** https://events-api-a9et.onrender.com/api/v1

- **Runtime:** Node.js + TypeScript, Express
- **Database:** PostgreSQL (hosted on Neon in production)
- **ORM:** Prisma
- **Validation:** Zod
- **Rate limiting:** express-rate-limit (in-memory)
- **IDs:** cuid2 (`@paralleldrive/cuid2`)

Local base URL: `http://localhost:3000/api/v1`
Live base URL: `https://events-api-a9et.onrender.com/api/v1`

---

## Contents

- [Getting started](#getting-started)
- [Deployment](#deployment)
- [Project structure](#project-structure)
- [Data model](#data-model)
- [Conventions](#conventions)
- [Endpoints](#endpoints)
  - [Venues](#venues)
  - [Events](#events)
  - [Tickets](#tickets)
- [Errors and status codes](#errors-and-status-codes)
- [Rate limiting](#rate-limiting)
- [Validation](#validation)
- [Seeding and OSM venue data](#seeding-and-osm-venue-data)
- [Consumer apps](#consumer-apps)
- [Design decisions](#design-decisions)

---

## Getting started

Use this section for running the API locally. See [Deployment](#deployment)
for how the live version is actually hosted.

### Prerequisites

- Node.js 18+ (developed on Node 24)
- PostgreSQL running locally, or a connection string to a hosted instance (Neon, Render, etc.)

### 1. Install dependencies

```bash
npm install
```

### 2. Configure `.env`

For local Postgres:

```bash
createdb event_api
```

```env
DATABASE_URL="postgresql://mac@localhost:5432/event_api"
PORT=3000
# Optional: override the rate limit (default 100)
# RATE_LIMIT_MAX=100
```

To point at the same Neon database the live API uses instead of a local one,
replace `DATABASE_URL` with the Neon connection string (see [Deployment](#deployment)).

### 3. Apply migrations and generate the Prisma client

```bash
npx prisma migrate dev
```

### 4. Seed the database

The seed reads `venues-seed.json` (real Abuja venues transformed from
OpenStreetMap — see [`docs/venue-data-from-osm.md`](docs/venue-data-from-osm.md))
and generates fake events and tickets with faker:

```bash
npm run seed
```

The seed is **idempotent** — running it twice does not create duplicate rows
(venues upsert on the stable `(name, area)` key; fake records use deterministic
ids so they upsert too).

### 5. Run

```bash
npm run dev     # tsx watch
# or
npm run build && npm start
```

Server: `http://localhost:3000/api/v1`

---

## Deployment

The API is deployed as a Render **Web Service**, backed by a **Neon**
Postgres database rather than Render's own managed Postgres, to avoid the
30-day expiry on Render's free database tier.

- **Build command:** `npm install && npx prisma generate && npm run build && npx prisma migrate deploy`
- **Start command:** `npm start` (runs `node dist/src/index.js`)
- **Environment variables:** `DATABASE_URL` set to the Neon connection string, plus any values from `.env.example`
- **Database:** provisioned on Neon, migrated and seeded against production using the same `prisma migrate deploy` / `npm run seed` commands as local, pointed at the Neon connection string

Because the web service and the database are hosted separately, the API's
public URL is unaffected by anything happening on the database side (plan
changes, migrations to a different provider, etc.).

---

## Project structure

```
src/
  config.ts                 # port + rate limit config
  app.ts                    # express app + middleware + route mounting
  index.ts                  # server entrypoint
  lib/
    db.ts                   # Prisma client singleton
    id.ts                   # cuid2 id generator
  middleware/
    asyncHandler.ts
    errorHandler.ts         # ApiError + centralized error envelopes
    rateLimiter.ts          # 100 req/min/IP, in-memory
  schemas/                  # Zod schemas (bodies + query params)
    pagination.ts
    venueSchemas.ts
    eventSchemas.ts
    ticketSchemas.ts
  services/                 # business logic (no Express types)
    pagination.ts
    venueService.ts
    eventService.ts
    ticketService.ts
  routes/
    venueRoutes.ts
    eventRoutes.ts
    ticketRoutes.ts
  utils/
    envelope.ts
prisma/
  schema.prisma
  seed.ts
  migrations/
scripts/
  convert-osm-venues.mjs    # OSM export -> venues-seed.json
venues-seed.json            # generated venue data consumed by the seed
docs/
  venue-data-from-osm.md    # how to pull venue data from OSM
```

---

## Data model

- **Venue** — `id`, `name`, `address`, `area`, `capacity?`, `contactInfo?`,
  `createdAt`, `updatedAt`. Stable unique key: `(name, area)`.
- **Event** — `id`, `title`, `description?`, `category`, `venueId` (FK),
  `startTime`, `endTime`, `ticketPriceMinor`, `currency` (default `NGN`),
  `capacity`, `status` (`upcoming | ongoing | completed | cancelled`, default
  `upcoming`), timestamps.
- **Ticket** — `id`, `eventId` (FK), `attendeeName`, `attendeeEmail`,
  `quantity`, `status` (`reserved | confirmed | cancelled`, default `reserved`),
  `purchasedAt`, timestamps.

Relationships: a Venue has many Events; an Event has many Tickets; a Ticket
belongs to exactly one Event. Attendee details live directly on the Ticket —
there is no separate Customer resource.

**Money** is stored and returned in **minor units (kobo)**, e.g. `250000` =
₦2,500.00. The `minPrice` / `maxPrice` filters are in the same unit.

---

## Conventions

### Response envelope

Every successful response:

```json
{ "data": ... }
```

List endpoints add `meta`:

```json
{
  "data": [ ... ],
  "meta": { "total": 113, "limit": 20, "offset": 0, "hasMore": true }
}
```

Every error response:

```json
{ "error": { "code": "STRING_CODE", "message": "human readable message" } }
```

### Pagination, sorting and filtering

All list endpoints accept:

| Param    | Default      | Rules                                                                 |
| -------- | ------------ | --------------------------------------------------------------------- |
| `limit`  | `20`         | max `100` — values above 100 are **clamped**, not rejected            |
| `offset` | `0`          | negative values rejected with `400`                                   |
| `sort`   | per resource | must be one of the resource's allowed fields, else `400`              |
| `order`  | `asc`        | `asc` or `desc`                                                       |

Allowed sort fields:

| Resource                | `sort` fields                              | default      |
| ----------------------- | ------------------------------------------ | ------------ |
| Venues                  | `name`, `createdAt`                        | `createdAt`  |
| Events                  | `startTime`, `ticketPriceMinor`, `createdAt` | `startTime`  |
| Tickets (nested)        | `purchasedAt`, `createdAt`                 | `purchasedAt`|

---

## Endpoints

All example commands below use the **live** URL. Swap in
`http://localhost:3000/api/v1` to test against a local instance instead.

### Venues

#### `GET /venues`

List venues. Paginated; filterable by `area` and capacity range; sortable by
`name` or `createdAt`.

**Query parameters**

| Name          | Type    | Description                                  |
| ------------- | ------- | -------------------------------------------- |
| `limit`       | integer | page size (1–100, clamped; default 20)       |
| `offset`      | integer | rows to skip (default 0; negative → 400)     |
| `sort`        | string  | `name` or `createdAt` (default `createdAt`)  |
| `order`       | string  | `asc` or `desc` (default `asc`)              |
| `area`        | string  | exact area match, e.g. `Wuse`, `Garki`       |
| `minCapacity` | integer | venues with capacity ≥ value                 |
| `maxCapacity` | integer | venues with capacity ≤ value                 |

**Example**

```bash
curl "https://events-api-a9et.onrender.com/api/v1/venues?area=Abuja&limit=2&sort=name"
```

**Example response**

```json
{
  "data": [
    {
      "id": "js3ng78spqktgf9jdyf9xrz0",
      "name": "35 On 4th",
      "address": "4th Avenue",
      "area": "Abuja",
      "capacity": null,
      "contactInfo": null,
      "createdAt": "2026-09-18T17:48:56.264Z",
      "updatedAt": "2026-09-18T17:49:04.891Z"
    },
    {
      "id": "mmpjuknpfgbu6h6o299yhfej",
      "name": "A.O Laundry Services & Business Centre",
      "address": "Abuja",
      "area": "Abuja",
      "capacity": null,
      "contactInfo": "+234 818 536 0681",
      "createdAt": "2026-09-18T17:48:56.268Z",
      "updatedAt": "2026-09-18T17:49:04.895Z"
    }
  ],
  "meta": { "total": 113, "limit": 2, "offset": 0, "hasMore": true }
}
```

#### `GET /venues/:id`

Fetch a single venue. `404 VENUE_NOT_FOUND` if it does not exist.

```bash
curl "https://events-api-a9et.onrender.com/api/v1/venues/js3ng78spqktgf9jdyf9xrz0"
```

```json
{
  "data": {
    "id": "js3ng78spqktgf9jdyf9xrz0",
    "name": "35 On 4th",
    "address": "4th Avenue",
    "area": "Abuja",
    "capacity": null,
    "contactInfo": null,
    "createdAt": "2026-09-18T17:48:56.264Z",
    "updatedAt": "2026-09-18T17:49:04.891Z"
  }
}
```

#### `GET /venues/:id/events`

All events at a venue. Paginated and sortable (`startTime`,
`ticketPriceMinor`, `createdAt`); returns `404` if the venue does not exist.

```bash
curl "https://events-api-a9et.onrender.com/api/v1/venues/vpwga6oseqef93w0l8bhkn94/events?limit=1&sort=ticketPriceMinor&order=desc"
```

```json
{
  "data": [
    {
      "id": "xrpw9kg9wj0sns9y6fktdq0v",
      "title": "Lavinia & Friends — One Night Only",
      "description": "Accusator theca aestas tendo accommodo cetera.",
      "category": "comedy",
      "venueId": "vpwga6oseqef93w0l8bhkn94",
      "startTime": "2026-09-26T07:49:04.987Z",
      "endTime": "2026-09-26T12:49:04.987Z",
      "ticketPriceMinor": 4750000,
      "currency": "NGN",
      "capacity": 675,
      "status": "upcoming",
      "createdAt": "2026-09-18T17:48:56.878Z",
      "updatedAt": "2026-09-18T17:49:05.482Z"
    }
  ],
  "meta": { "total": 2, "limit": 1, "offset": 0, "hasMore": true }
}
```

---

### Events

#### `GET /events`

List events. Paginated; filterable by `category`, `venueId`, `status`,
date range and price range; sortable by `startTime`, `ticketPriceMinor` or
`createdAt`.

**Query parameters**

| Name            | Type     | Description                                             |
| --------------- | -------- | ------------------------------------------------------- |
| `limit`         | integer  | page size (1–100, clamped; default 20)                  |
| `offset`        | integer  | rows to skip (default 0; negative → 400)                |
| `sort`          | string   | `startTime`, `ticketPriceMinor`, `createdAt`            |
| `order`         | string   | `asc` or `desc` (default `asc`)                         |
| `category`      | string   | exact match, e.g. `concert`, `comedy`, `meetup`, `market` |
| `venueId`       | string   | events at a specific venue                              |
| `status`        | string   | `upcoming`, `ongoing`, `completed`, `cancelled`         |
| `startDateFrom` | ISO date | `startTime >= value`                                    |
| `startDateTo`   | ISO date | `startTime <= value`                                    |
| `minPrice`      | integer  | `ticketPriceMinor >= value` (kobo)                      |
| `maxPrice`      | integer  | `ticketPriceMinor <= value` (kobo)                      |

**Example**

```bash
curl "https://events-api-a9et.onrender.com/api/v1/events?status=upcoming&sort=startTime&order=asc&limit=1"
```

**Example response**

```json
{
  "data": [
    {
      "id": "t3htjtumc053h1misung4ia8",
      "title": "Clark & Friends — One Night Only",
      "description": "Voveo condico turbo antiquus.",
      "category": "comedy",
      "venueId": "fdkvpzcpuv5fb93kf32x654y",
      "startTime": "2026-09-18T18:49:04.987Z",
      "endTime": "2026-09-18T22:49:04.987Z",
      "ticketPriceMinor": 4010000,
      "currency": "NGN",
      "capacity": 473,
      "status": "upcoming",
      "createdAt": "2026-09-18T17:48:56.899Z",
      "updatedAt": "2026-09-18T17:49:05.503Z"
    }
  ],
  "meta": { "total": 92, "limit": 1, "offset": 0, "hasMore": true }
}
```

#### `GET /events/:id`

Fetch a single event. `404 EVENT_NOT_FOUND` if missing.

```bash
curl "https://events-api-a9et.onrender.com/api/v1/events/t3htjtumc053h1misung4ia8"
```

Returns the same event object as above under `data`.

#### `GET /events/:id/tickets`

All tickets for an event (guest list). Paginated; sortable by `purchasedAt`
or `createdAt`. `404 EVENT_NOT_FOUND` if the event does not exist.

```bash
curl "https://events-api-a9et.onrender.com/api/v1/events/i6vpqctx0deok1fm7ne6peza/tickets?limit=1"
```

```json
{
  "data": [
    {
      "id": "f3bw82ye9b9m5hw2286aknww",
      "eventId": "i6vpqctx0deok1fm7ne6peza",
      "attendeeName": "Minnie Hudson",
      "attendeeEmail": "Maximo53@yahoo.com",
      "quantity": 3,
      "status": "reserved",
      "purchasedAt": "2026-07-02T21:36:36.591Z",
      "createdAt": "2026-09-18T17:48:56.431Z",
      "updatedAt": "2026-09-18T17:49:05.056Z"
    }
  ],
  "meta": { "total": 8, "limit": 1, "offset": 0, "hasMore": true }
}
```

#### `POST /events`

Create an event. Returns `201`. `404 VENUE_NOT_FOUND` if `venueId` doesn't
exist. `422` if `endTime` is not after `startTime`.

**Body**

| Field              | Type    | Required | Notes                                    |
| ------------------ | ------- | -------- | ---------------------------------------- |
| `title`            | string  | yes      |                                          |
| `description`      | string  | no       |                                          |
| `category`         | string  | yes      | e.g. `concert`, `comedy`                 |
| `venueId`          | string  | yes      | must reference an existing venue         |
| `startTime`        | ISO date| yes      |                                          |
| `endTime`          | ISO date| yes      | must be after `startTime`                |
| `ticketPriceMinor` | integer | yes      | ≥ 0, in kobo                             |
| `currency`         | string  | no       | default `NGN`                            |
| `capacity`         | integer | yes      | ≥ 1                                      |
| `status`           | string  | no       | default `upcoming`                       |

```bash
curl -X POST "https://events-api-a9et.onrender.com/api/v1/events" \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "Abuja Jazz Night",
    "description": "An evening of live jazz.",
    "category": "concert",
    "venueId": "vpwga6oseqef93w0l8bhkn94",
    "startTime": "2026-12-01T18:00:00.000Z",
    "endTime": "2026-12-01T21:00:00.000Z",
    "ticketPriceMinor": 250000,
    "capacity": 300
  }'
```

**Example response** (`201 Created`)

```json
{
  "data": {
    "id": "dvpq5r0n6s7c8x9w2y3z4a5b",
    "title": "Abuja Jazz Night",
    "description": "An evening of live jazz.",
    "category": "concert",
    "venueId": "vpwga6oseqef93w0l8bhkn94",
    "startTime": "2026-12-01T18:00:00.000Z",
    "endTime": "2026-12-01T21:00:00.000Z",
    "ticketPriceMinor": 250000,
    "currency": "NGN",
    "capacity": 300,
    "status": "upcoming",
    "createdAt": "2026-09-18T18:00:00.000Z",
    "updatedAt": "2026-09-18T18:00:00.000Z"
  }
}
```

#### `PATCH /events/:id`

Partial update. Any subset of the event fields; `404` if missing. If both
`startTime` and `endTime` are supplied/relevant, `endTime` must be after
`startTime`. Returns the updated event.

```bash
curl -X PATCH "https://events-api-a9et.onrender.com/api/v1/events/dvpq5r0n6s7c8x9w2y3z4a5b" \
  -H 'Content-Type: application/json' \
  -d '{ "capacity": 350, "endTime": "2026-12-01T22:00:00.000Z" }'
```

**Example response**

```json
{
  "data": {
    "id": "dvpq5r0n6s7c8x9w2y3z4a5b",
    "title": "Abuja Jazz Night",
    "capacity": 350,
    "status": "upcoming",
    "endTime": "2026-12-01T22:00:00.000Z"
  }
}
```

> (the full event object is returned; abbreviated here for brevity)

#### `DELETE /events/:id`

Remove an event. Its tickets are deleted first inside a transaction
(Prisma's FK would otherwise block the delete). `404` if missing.

```bash
curl -X DELETE "https://events-api-a9et.onrender.com/api/v1/events/dvpq5r0n6s7c8x9w2y3z4a5b"
```

```json
{ "data": null }
```

---

### Tickets

#### `POST /tickets`

Create a ticket. Returns `201`.

**Body**

| Field           | Type    | Required | Notes                                        |
| --------------- | ------- | -------- | --------------------------------------------- |
| `eventId`       | string  | yes      | must reference an existing event             |
| `attendeeName`  | string  | yes      |                                              |
| `attendeeEmail` | string  | yes      | must be a valid email address                |
| `quantity`      | integer | yes      | ≥ 1                                          |
| `status`        | string  | no       | `reserved` (default), `confirmed`, `cancelled` |

**Business rule:** the sum of `quantity` across all **non-cancelled** tickets
for the event may not exceed the event's `capacity`. If it would, the request
is rejected with `422 CAPACITY_EXCEEDED`. `404 EVENT_NOT_FOUND` if the event
doesn't exist.

```bash
curl -X POST "https://events-api-a9et.onrender.com/api/v1/tickets" \
  -H 'Content-Type: application/json' \
  -d '{
    "eventId": "t3htjtumc053h1misung4ia8",
    "attendeeName": "Amaka Obi",
    "attendeeEmail": "amaka.obi@example.com",
    "quantity": 2
  }'
```

**Example response** (`201 Created`)

```json
{
  "data": {
    "id": "a1b2c3d4e5f6g7h8i9j0k1l2",
    "eventId": "t3htjtumc053h1misung4ia8",
    "attendeeName": "Amaka Obi",
    "attendeeEmail": "amaka.obi@example.com",
    "quantity": 2,
    "status": "reserved",
    "purchasedAt": "2026-09-18T18:05:00.000Z",
    "createdAt": "2026-09-18T18:05:00.000Z",
    "updatedAt": "2026-09-18T18:05:00.000Z"
  }
}
```

**Example capacity error** (`422`)

```json
{
  "error": {
    "code": "CAPACITY_EXCEEDED",
    "message": "Event 't3htjtumc053h1misung4ia8' has capacity 3 and 0 ticket(s) still available; cannot add 1"
  }
}
```

#### `GET /tickets/:id`

Fetch a single ticket. `404 TICKET_NOT_FOUND` if missing.

```bash
curl "https://events-api-a9et.onrender.com/api/v1/tickets/a1b2c3d4e5f6g7h8i9j0k1l2"
```

```json
{
  "data": {
    "id": "a1b2c3d4e5f6g7h8i9j0k1l2",
    "eventId": "t3htjtumc053h1misung4ia8",
    "attendeeName": "Amaka Obi",
    "attendeeEmail": "amaka.obi@example.com",
    "quantity": 2,
    "status": "reserved",
    "purchasedAt": "2026-09-18T18:05:00.000Z",
    "createdAt": "2026-09-18T18:05:00.000Z",
    "updatedAt": "2026-09-18T18:05:00.000Z"
  }
}
```

#### `PATCH /tickets/:id`

Update **status only** (e.g. cancel a ticket). The body accepts only `status`;
any other field is rejected with `422` naming that field.

```bash
curl -X PATCH "https://events-api-a9et.onrender.com/api/v1/tickets/a1b2c3d4e5f6g7h8i9j0k1l2" \
  -H 'Content-Type: application/json' \
  -d '{ "status": "cancelled" }'
```

**Example response**

```json
{
  "data": {
    "id": "a1b2c3d4e5f6g7h8i9j0k1l2",
    "eventId": "t3htjtumc053h1misung4ia8",
    "attendeeName": "Amaka Obi",
    "attendeeEmail": "amaka.obi@example.com",
    "quantity": 2,
    "status": "cancelled",
    "purchasedAt": "2026-09-18T18:05:00.000Z",
    "createdAt": "2026-09-18T18:05:00.000Z",
    "updatedAt": "2026-09-18T18:06:00.000Z"
  }
}
```

---

## Errors and status codes

```json
{ "error": { "code": "STRING_CODE", "message": "human readable message" } }
```

| Status | When                                                                    | Example `code` values |
| ------ | ----------------------------------------------------------------------- | --------------------- |
| `400`  | Bad input (invalid query params, malformed JSON)                        | `INVALID_QUERY_PARAMS`, `INVALID_JSON` |
| `404`  | Resource not found / unknown endpoint                                   | `VENUE_NOT_FOUND`, `EVENT_NOT_FOUND`, `TICKET_NOT_FOUND`, `NOT_FOUND` |
| `422`  | Valid input that fails a rule (missing/invalid body field, exceeds capacity, missing related record) | `VALIDATION_ERROR`, `CAPACITY_EXCEEDED`, `RELATED_RECORD_MISSING`, `CONFLICT` |
| `429`  | Rate limit exceeded                                                     | `RATE_LIMITED`        |
| `500`  | Unexpected server error                                                 | `INTERNAL_ERROR`      |

Examples:

```json
{ "error": { "code": "INVALID_QUERY_PARAMS", "message": "Invalid query field 'offset': offset must be zero or a positive integer" } }
{ "error": { "code": "VALIDATION_ERROR", "message": "Invalid body field 'attendeeEmail': attendeeEmail must be a valid email address" } }
{ "error": { "code": "VENUE_NOT_FOUND", "message": "Venue 'doesnotexist' does not exist" } }
```

---

## Rate limiting

- **100 requests per minute per IP**, in-memory (express-rate-limit's default
  `MemoryStore`, no Redis).
- The numbers live in `src/config.ts` (`windowMs`, `max`); `RATE_LIMIT_MAX`
  can override the max via env.
- On exceed: `429` with the error envelope, plus `Retry-After`,
  `RateLimit` and `RateLimit-Policy` headers.

```
HTTP/1.1 429 Too Many Requests
RateLimit: limit=100, remaining=0, reset=58
Retry-After: 58

{"error":{"code":"RATE_LIMITED","message":"Too many requests, please try again later"}}
```

> In-memory means the counter is per-process and resets on restart, and is not
> shared across multiple instances. That is intentional for this assessment;
> a production deployment behind several instances would use a shared store.
> Since this API runs as a single Render instance, this limitation doesn't
> currently apply in practice.

---

## Validation

Every request body and query parameter is validated with **Zod**:

- Invalid **query parameters** → `400` (`INVALID_QUERY_PARAMS`)
- Invalid **request bodies** → `422` (`VALIDATION_ERROR`)
- The offending field is always named in the message, e.g.
  `Invalid body field 'quantity': Expected number, received string`.

Schemas live in `src/schemas/` and are applied in the route handlers; business
logic lives separately in `src/services/`.

---

## Seeding and OSM venue data

- `docs/venue-data-from-osm.md` documents how to pull real Abuja venues from
  OpenStreetMap's Overpass API and turn them into `venues-seed.json`.
- `scripts/convert-osm-venues.mjs` performs that transform (run it with
  `node scripts/convert-osm-venues.mjs abuja-venues-raw.json`).
- `prisma/seed.ts` upserts those venues keyed on the stable `(name, area)`
  pair, then generates realistic fake Events and Tickets with
  `@faker-js/faker`.
- The seed is idempotent: faker is fixed-seeded, fake records get deterministic
  ids, and everything is written with `upsert` rather than `create`. Running
  `npm run seed` repeatedly yields the same rows.
- Seeded events never exceed their own capacity (the capacity rule is respected
  at generation time too).
- Against production, the seed is run against the Neon connection string
  directly (see [Deployment](#deployment)).

---

## Consumer app

An event ticket & attendee checker, It is used to check people who bought tickets for all events happening in Abuja (regardless of
sector) or for a single event, using live data from the **API**
(`https://events-api-a9et.onrender.com/api/v1`). Features attendee verification,
ticket quantities, check-in stats, CSV export, and cross-event attendee lookup.

---

## Design decisions

### ID choice: cuid2, generated in the application

Every primary key is a **cuid2** string generated with
`@paralleldrive/cuid2` (`createId()`), not a database auto-increment.

- cuid2 is **non-sequential**, so IDs leak neither record counts nor
  insertion order and are safe to expose in URLs — useful when an API is
  consumed by third-party aggregators.
- cuid2 is **collision-resistant** without coordination, which keeps the door
  open to generating IDs in more than one service later.
- IDs are generated in the service layer (`src/lib/id.ts`), so the database
  schema never relies on a sequence.

The seed script is a special case: to make re-running idempotent, its fake
events/tickets use **deterministic, content-derived IDs in cuid2 format**
rather than random ones. The running API always uses real `createId()`.

### Pagination choice: limit/offset with clamping

List endpoints use **limit/offset** pagination with a `meta` block
(`total`, `limit`, `offset`, `hasMore`).

- It is simple and predictable, which matters when the consumers are
  third-party aggregators that need to page through discovery results.
- `limit` is clamped to a hard maximum of **100** rather than rejected, so a
  consumer that asks for too much still gets a useful response.
- A negative `offset` or an unknown `sort` field is rejected with `400`,
  because silently doing something else would hide client bugs.
- `sort` is a whitelist per resource, which also prevents ordering by
  arbitrary/unindexed columns.

Offset pagination can drift if rows are inserted while paging, and gets
slower at large offsets. For the dataset sizes here that is an acceptable
trade-off; a cursor-based scheme would be the next step if the dataset grew
into the millions.

### Envelope shape

All responses share one shape so clients can write a single parser:

- Success: `{ "data": ... }`, with `{ "meta": { total, limit, offset, hasMore } }`
  added **only** on list endpoints.
- Error: `{ "error": { "code", "message" } }` with an honest HTTP status code.

`code` is a stable, machine-readable string (`CAPACITY_EXCEEDED`,
`EVENT_NOT_FOUND`, …) while `message` is human-readable. Keeping `meta`
list-only avoids meaningless metadata on single-resource responses.

### Ticket privacy tradeoff (deliberate scope decision)

For this assessment, `Ticket.attendeeName` and `Ticket.attendeeEmail` are
intentionally returned **without authentication** from
`GET /events/:id/tickets` and `GET /tickets/:id`. Attendee contact details are
personal data, and in a real deployment exposing them unauthenticated would be
a privacy leak.

This is a **deliberate scope decision, not an oversight**: the brief
explicitly excludes authentication, and the intended consumer of the guest
list, the Event Ticket Checker, genuinely needs attendee names to manage
entry. A production version would:

1. require authentication, and
2. restrict `GET /events/:id/tickets` to the **organizer who owns the event**
   (an ownership/authorization check), returning only the fields the
   check-in flow needs.

Until then, treat this API as an internal/information layer rather than a
public endpoint.

## Picture Evidence
### 1. Curl hitting the live URL without adding limit
<img width="1440" height="900" alt="Screenshot 2026-09-23 at 16 14 04" src="https://github.com/user-attachments/assets/f9e39812-c714-4758-8b73-d41a839b0df3" />
<img width="1440" height="900" alt="Screenshot 2026-09-23 at 16 14 17" src="https://github.com/user-attachments/assets/0b97e54d-8f86-47a3-9027-d35cc0e59b5b" />
<img width="1440" height="900" alt="Screenshot 2026-09-23 at 16 14 27" src="https://github.com/user-attachments/assets/1d0a1ae9-baf6-48d8-8c78-193cd81faadb" />
<img width="1440" height="900" alt="Screenshot 2026-09-23 at 16 14 37" src="https://github.com/user-attachments/assets/f045a863-079e-41d4-a1cf-5ed01ab51489" />
<img width="1440" height="900" alt="Screenshot 2026-09-23 at 16 14 49" src="https://github.com/user-attachments/assets/7ab3888f-0876-42c9-9356-f4b9e8b4c288" />
<img width="1440" height="900" alt="Screenshot 2026-09-23 at 16 14 57" src="https://github.com/user-attachments/assets/1a2e3bce-c544-4f7d-ad19-d5ea1857cd84" />

### 2. Curl hitting the live URL  limit and Offset
<img width="1440" height="900" alt="Screenshot 2026-09-23 at 16 21 42" src="https://github.com/user-attachments/assets/7a009997-c2b1-4412-995c-e897e1470c8c" />
<img width="1440" height="900" alt="Screenshot 2026-09-23 at 16 22 10" src="https://github.com/user-attachments/assets/1dcb60d4-a5d8-4a94-a90f-d45aec44c9d3" />
<img width="2880" height="1013" alt="F44F936C-3BBD-4A92-A922-6B4B274573FF_1_201_a" src="https://github.com/user-attachments/assets/820c2631-a3cf-492f-baa1-8ff347231af2" />

### 3. Rate limiting test
<img width="1440" height="900" alt="Screenshot 2026-09-19 at 03 26 15" src="https://github.com/user-attachments/assets/cf671fe8-18e8-40c3-a142-ba8aa6e4d0b9" />
<img width="1440" height="900" alt="Screenshot 2026-09-19 at 03 26 10" src="https://github.com/user-attachments/assets/409db339-5559-48eb-8552-c03b3a9ef7e2" />
<img width="1440" height="900" alt="Screenshot 2026-09-19 at 03 26 02" src="https://github.com/user-attachments/assets/cbd57b38-c9ec-498f-bf10-5a27ecafbb31" />



### 4. A consumer using the API
<img width="1440" height="900" alt="Screenshot 2026-09-23 at 16 46 09" src="https://github.com/user-attachments/assets/46339e36-8268-4161-8f4c-d70f6322667d" />
<img width="1440" height="900" alt="Screenshot 2026-09-23 at 16 46 16" src="https://github.com/user-attachments/assets/a90fbc39-21da-4f47-8d13-2d53a3c3820e" />

