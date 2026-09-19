// Idempotent seed script.
//
//  - Venues are the real Abuja venues from venues-seed.json (transformed from
//    an OpenStreetMap / Overpass export), upserted on the stable unique key
//    (name, area).
//  - Events and Tickets are realistic fakes generated with @faker-js/faker.
//    Faker is seeded with a fixed value so the generated content is
//    deterministic across runs; every fake record gets a deterministic,
//    content-derived id in cuid2 shape (`seedId`) so the upserts are keyed on
//    a stable field and never duplicate rows.
//
// The running API, by contrast, always generates ids with
// @paralleldrive/cuid2 createId().
import { faker } from '@faker-js/faker';
import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import venueSeedData from '../venues-seed.json';

const prisma = new PrismaClient();

// Fixed seed -> deterministic fake content across runs.
faker.seed(2026);

const CATEGORIES = ['concert', 'comedy', 'meetup', 'market'] as const;
const STATUS_POOL = ['reserved', 'confirmed', 'confirmed', 'confirmed', 'cancelled'] as const;
const KOBOS_PER_NAIRA = 100;

const ALPHA = 'abcdefghijklmnopqrstuvwxyz';

function sha36(s: string): string {
  return BigInt('0x' + createHash('sha256').update(s).digest('hex')).toString(36);
}

// Deterministic cuid2-shaped id derived from stable content, so re-running the
// seed upserts rather than duplicates. 24 chars: letter + 23 base36 chars.
function seedId(preimage: string): string {
  const letter =
    ALPHA[Number(BigInt('0x' + createHash('sha256').update('prefix:' + preimage).digest('hex')) % 26n)];
  return letter + sha36(preimage).padStart(23, '0').slice(-23);
}

type SeedEvent = {
  id: string;
  title: string;
  description: string;
  category: string;
  venueKey: string;
  startTime: Date;
  endTime: Date;
  ticketPriceMinor: number;
  currency: string;
  capacity: number;
  status: 'upcoming' | 'ongoing' | 'completed' | 'cancelled';
  tickets: Array<{
    id: string;
    attendeeName: string;
    attendeeEmail: string;
    quantity: number;
    status: 'reserved' | 'confirmed' | 'cancelled';
    purchasedAt: Date;
  }>;
};

function makeTitle(venueName: string, area: string): string {
  const genre = faker.music.genre();
  const category = faker.helpers.arrayElement(CATEGORIES);
  const artist = faker.music.artist();
  const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1);
  const pattern = faker.number.int({ min: 0, max: 5 });
  switch (pattern) {
    case 0:
      return `${artist} — Live in ${area}`;
    case 1:
      return `${genre} Night at ${venueName}`;
    case 2:
      return `${faker.person.firstName()} & Friends — One Night Only`;
    case 3:
      return `${capitalize(category)} ${category === 'market' ? 'Day' : 'Night'} in ${area}`;
    case 4:
      return `${faker.company.name()} presents: ${capitalize(category)}`;
    default:
      return `An Evening with ${artist}`;
  }
}

function buildFakeData(venues: typeof venueSeedData): SeedEvent[] {
  const now = new Date();
  const events: SeedEvent[] = [];

  for (let v = 0; v < venues.length; v++) {
    const venue = venues[v];
    const eventCount = faker.number.int({ min: 1, max: 2 });

    for (let i = 0; i < eventCount; i++) {
      const pre = `evt:${venue.name}::${venue.area}::${i}`;
      const eventId = seedId(pre);

      const startOffsetDays = faker.helpers.arrayElement(
        [-90, -60, -30, -14, -7, -3, -1, 0, 1, 3, 7, 14, 30, 60, 90],
      );
      const startTime = new Date(
        now.getTime() + startOffsetDays * 86_400_000 + faker.number.int({ min: 0, max: 20 }) * 3_600_000,
      );
      const durationHours = faker.number.int({ min: 2, max: 8 });
      const endTime = new Date(startTime.getTime() + durationHours * 3_600_000);

      let status: SeedEvent['status'];
      if (startTime > now) status = 'upcoming';
      else if (endTime < now) status = 'completed';
      else status = 'ongoing';
      if (faker.number.float({ min: 0, max: 1 }) < 0.04) status = 'cancelled';

      const eventCapacity =
        venue.capacity != null && venue.capacity > 0
          ? Math.max(
              20,
              faker.number.int({ min: Math.ceil(venue.capacity * 0.3), max: venue.capacity }),
            )
          : faker.number.int({ min: 50, max: 1200 });

      const priceNaira = faker.number.int({ min: 1500, max: 50000 });
      const ticketPriceMinor = Math.round(priceNaira / 100) * 100 * KOBOS_PER_NAIRA;

      const ticketCount = faker.number.int({ min: 0, max: 8 });
      const tickets: SeedEvent['tickets'] = [];
      let sold = 0;

      for (let j = 0; j < ticketCount; j++) {
        const quantity = faker.number.int({ min: 1, max: 4 });
        const ticketStatus = faker.helpers.arrayElement(STATUS_POOL);
        if (ticketStatus !== 'cancelled') {
          if (sold + quantity > eventCapacity) continue; // never exceed event capacity
          sold += quantity;
        }
        const purchasedAtMax = startTime <= now ? now : startTime;
        tickets.push({
          id: seedId(`tkt:${eventId}::${j}`),
          attendeeName: faker.person.fullName(),
          attendeeEmail: faker.internet.email(),
          quantity,
          status: ticketStatus as SeedEvent['tickets'][number]['status'],
          purchasedAt: faker.date.between({
            from: new Date(Math.max(now.getTime() - 90 * 86_400_000, purchasedAtMax.getTime() - 90 * 86_400_000)),
            to: purchasedAtMax,
          }),
        });
      }

      events.push({
        id: eventId,
        title: makeTitle(venue.name, venue.area),
        description: faker.lorem.paragraph({ min: 1, max: 2 }),
        category: faker.helpers.arrayElement(CATEGORIES),
        venueKey: `${venue.name}::${venue.area}`,
        startTime,
        endTime,
        ticketPriceMinor,
        currency: 'NGN',
        capacity: eventCapacity,
        status,
        tickets,
      });
    }
  }

  return events;
}

async function seed() {
  console.log(`Seeding ${venueSeedData.length} venues from venues-seed.json...`);

  // Venues: upsert on the stable (name, area) key. id is written only on
  // insert so re-seeding never churns primary keys.
  const venueIds = new Map<string, string>(); // `${name}::${area}` -> id
  for (const v of venueSeedData) {
    const where = { name_area: { name: v.name, area: v.area } };
    const row = await prisma.venue.upsert({
      where,
      create: v,
      update: {
        name: v.name,
        address: v.address,
        area: v.area,
        capacity: v.capacity,
        contactInfo: v.contactInfo,
      },
    });
    venueIds.set(`${v.name}::${v.area}`, row.id);
  }

  const fakeEvents = buildFakeData(venueSeedData);
  console.log(`Upserting ${fakeEvents.length} events and their tickets...`);

  let ticketCount = 0;
  for (const evt of fakeEvents) {
    const event = await prisma.event.upsert({
      where: { id: evt.id },
      create: {
        id: evt.id,
        title: evt.title,
        description: evt.description,
        category: evt.category,
        venueId: venueIds.get(evt.venueKey) as string,
        startTime: evt.startTime,
        endTime: evt.endTime,
        ticketPriceMinor: evt.ticketPriceMinor,
        currency: evt.currency,
        capacity: evt.capacity,
        status: evt.status,
      },
      update: {
        title: evt.title,
        description: evt.description,
        category: evt.category,
        venueId: venueIds.get(evt.venueKey) as string,
        startTime: evt.startTime,
        endTime: evt.endTime,
        ticketPriceMinor: evt.ticketPriceMinor,
        currency: evt.currency,
        capacity: evt.capacity,
        status: evt.status,
      },
    });

    for (const t of evt.tickets) {
      await prisma.ticket.upsert({
        where: { id: t.id },
        create: {
          id: t.id,
          eventId: event.id,
          attendeeName: t.attendeeName,
          attendeeEmail: t.attendeeEmail,
          quantity: t.quantity,
          status: t.status,
          purchasedAt: t.purchasedAt,
        },
        update: {
          eventId: event.id,
          attendeeName: t.attendeeName,
          attendeeEmail: t.attendeeEmail,
          quantity: t.quantity,
          status: t.status,
          purchasedAt: t.purchasedAt,
        },
      });
      ticketCount += 1;
    }
  }

  console.log(`Done. Venues: ${venueSeedData.length}, Events: ${fakeEvents.length}, Tickets: ${ticketCount}`);
}

seed()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());