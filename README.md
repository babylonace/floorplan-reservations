# floorplan-reservations

Table reservations for restaurants, where the venue draws its own floor plan and the booking engine works from that plan.

[Leer en español](README.es.md)

> **Status: early.** The API can take a booking, the database refuses double bookings, and staff can edit the floor plan through the API. There is no login, drawing screen, booking page or staff screen yet. See the [roadmap](#roadmap).

## Why

Many open-source booking tools treat tables as a list: "table 4, seats 4". Real rooms aren't lists. Two small tables next to each other can be pushed together for a group of four, and you lose a seat or two when you do. A table near the door might only be good for walk-ins.

So the idea here is:

- **The plan is the source of truth.** Each venue places its tables (position, size, shape, rotation, zone, look), and the engine reads that same data. If the plan says two tables touch, the engine can join them.
- **No double bookings, enforced by the database.** Not by an "if" in the code that two requests can race past, but by a PostgreSQL constraint, with tests that fire bookings at it concurrently.
- **Several languages from the start.** Guests book in their language and get messages in it. Staff screens default to Spanish, with English available.
- **Self-hosted.** One `docker compose up` and it runs. No per-cover fees.

Out of scope: orders, kitchen screens, point of sale.

## What's in it today

- `packages/engine`: booking rules with no database or network code, so they're quick to test.
  - `validateZone` checks a floor plan for tables that overlap, stick out of the room or have impossible seat counts. It takes rotation into account.
  - `durationFor` says how long a party keeps a table, based on its size.
  - `seatingOptions` lists where a party could sit, best first: the smallest single table that fits, otherwise neighbouring tables pushed together.
  - `canStillSeat` says whether tables a party already holds still give it room after the plan changes.
- `apps/api`: a [Fastify](https://fastify.dev/) API in TypeScript.
  - `GET /venues/:slug/floor-plan` returns the zones and tables, plus any problems the engine finds in the plan.
  - `POST /venues/:slug/reservations` books a table. The engine picks the table (or tables), and how long it is kept depends on the party size. It answers `409` when nothing is free.
  - Floor plan editing: `POST /venues/:slug/zones`, `PATCH` and `DELETE /venues/:slug/zones/:zoneId`, `POST /venues/:slug/zones/:zoneId/tables`, `PATCH` and `DELETE /venues/:slug/tables/:tableId`. See [editing the plan](#editing-the-plan).
  - `GET /health` checks that the API can reach the database.
  - `GET /openapi.json` describes the API (OpenAPI 3.1).
- `db/migrations`: the schema, as plain SQL files. A small runner applies them in order, each in a transaction, behind a lock so two copies of the app can't migrate at the same time.
- `db/seed/sample.sql`: a made-up venue to play with.

## Run it

### With Docker

You need Docker with Compose.

```bash
docker compose up --build
```

Then load the sample venue and ask for its plan:

```bash
docker compose exec api node apps/api/dist/seed-cli.js
curl http://127.0.0.1:3000/venues/sample-bistro/floor-plan
```

### With Node and your own PostgreSQL

You need Node 24 or newer and PostgreSQL. CI tests against PostgreSQL 18; older versions may work but are not tested.

```bash
cp .env.example .env    # then edit the two database URLs
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

## Tests and checks

```bash
npm run check
```

That runs Prettier, ESLint, the TypeScript compiler and the tests. The API tests need a real PostgreSQL database: set `TEST_DATABASE_URL` in `.env`. **The tests wipe that database**, so they refuse to run unless its name ends in `_test`. With Docker Compose, a `floorplan_test` database is created the first time the database volume is made. If your volume is older than that, create it with `docker compose exec db createdb -U floorplan -O floorplan floorplan_test`.

CI runs the same checks on every pull request against PostgreSQL 18, and also builds the Docker image, starts it with Compose and calls the API.

## How the plan is stored

- Units are centimetres.
- A table's `x` and `y` are the position of its **centre** inside its zone, measured from the zone's top-left corner. Rotation is in degrees, clockwise.
- `style` is free-form JSON for the plan editor (colours and the like). The booking engine never reads it.
- One reservation can take several tables (`reservation_tables`), for groups seated at tables pushed together.

## Editing the plan

Zones and tables can be added, changed and removed through the API: position, size, shape, rotation, style, zone and whether the table can be booked online.

- Every change is checked with `validateZone` against what is stored. A change that would make a table overlap another one, stick out of its zone or have impossible seats is refused with `422` and the list of problems. Problems the plan already had don't block unrelated edits.
- Changes never leave an upcoming reservation without room. Taking away seats it needs, moving the tables it holds together apart, making one of them round or moving one of them to another zone is refused with `409`. A table booked on its own can still be moved, even to another zone: the party keeps it.
- Marking a table as not bookable never breaks a booking: bookings already made keep it, new ones go elsewhere.
- A venue can have up to 50 zones and a zone up to 200 tables.
- A table with an upcoming reservation can't be removed. A table that was only booked in the past is **retired** instead of deleted: it leaves the plan and the engine, and old reservations still point at it. Its label is free again. Removing a zone works the same way for all its tables.
- Edits to the same zone take turns (they lock the zone, then the tables). A booking that had to wait for an edit of its tables reads the plan again before it is saved, so it can't land on a table that just lost its seats or stopped being bookable.

> **No login yet.** These routes are open to anyone who can reach the API. Don't put it on the internet until staff login lands.

## How double bookings are stopped

- Each reservation has its time as a range, `[start, end)`. A booking that ends at 21:30 and one that starts at 21:30 don't overlap.
- `reservation_tables` keeps a copy of that range and of whether the reservation still holds its tables (cancelled and no-show ones don't). The copy is part of the foreign key to the reservation with `on update cascade`, so moving or cancelling a reservation updates it in the same statement.
- An exclusion constraint (`btree_gist`) refuses two rows for the same table whose ranges overlap. It holds whatever code writes to the database.
- The API reads the free tables, books the best option and, if another request got there first, rolls back to a savepoint and tries again. Requests that want the same table wait their turn, so they don't stall each other.
- The tests hold back writes until every request in a burst has read the free tables, then release them at once: 25 requests for one table give exactly one booking.

Joining tables: only rectangular tables in the same zone, standing side by side (gap of 5 cm or less) and not turned at an angle. At most three, and every one of them must be needed.

Not checked yet: opening hours. Durations use the sample rules in `durationFor` for every venue for now.

## Roadmap

1. ~~**Booking engine with no double bookings.**~~ Done.
2. **Floor plan editor.** ~~API to edit zones and tables, checked by the engine.~~ Done. The screen to draw them comes with the staff screen.
3. **Public booking page.** Several languages (including right-to-left), suggests nearby times when the one asked for is full, GDPR-friendly.
4. **Staff screen.** Today's service, confirm, cancel, seat, email notices.
5. **Deployment guide.** Backups and running it for a real venue.

## Stack

Node 24, TypeScript, Fastify, PostgreSQL 18, Vitest, ESLint, Prettier, Docker Compose, GitHub Actions.

## License

[MIT](LICENSE)

Built by [babylonace](https://github.com/babylonace). AI-assisted.
