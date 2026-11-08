# floorplan-reservations

Table reservations for restaurants, where the venue draws its own floor plan and the booking engine works from that plan.

[Leer en español](README.es.md)

> **Status: early.** This is phase 0: the project skeleton, the first database schema, a small engine and CI. You can't take a booking yet. See the [roadmap](#roadmap).

## Why

Many open-source booking tools treat tables as a list: "table 4, seats 4". Real rooms aren't lists. Two small tables next to each other can be pushed together for a group of four, and you lose a seat or two when you do. A table near the door might only be good for walk-ins.

So the idea here is:

- **The plan is the source of truth.** Each venue places its tables (position, size, shape, rotation, zone, look), and the engine reads that same data. If the plan says two tables touch, the engine can join them.
- **No double bookings, enforced by the database.** Not by an "if" in the code that two requests can race past, but by a PostgreSQL constraint, with tests that fire bookings at it concurrently. (Coming in phase 1.)
- **Several languages from the start.** Guests book in their language and get messages in it. Staff screens default to Spanish, with English available.
- **Self-hosted.** One `docker compose up` and it runs. No per-cover fees.

Out of scope: orders, kitchen screens, point of sale.

## What's in it today

- `packages/engine`: booking rules with no database or network code, so they're quick to test.
  - `validateZone` checks a floor plan for tables that overlap, stick out of the room or have impossible seat counts. It takes rotation into account.
  - `durationFor` says how long a party keeps a table, based on its size.
- `apps/api`: a [Fastify](https://fastify.dev/) API in TypeScript.
  - `GET /venues/:slug/floor-plan` returns the zones and tables, plus any problems the engine finds in the plan.
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

## Roadmap

1. **Booking engine with no double bookings.** A PostgreSQL exclusion constraint on table and time range, plus concurrency tests.
2. **Floor plan editor.** Draw zones and tables; tables that touch can be joined.
3. **Public booking page.** Several languages (including right-to-left), suggests nearby times when the one asked for is full, GDPR-friendly.
4. **Staff screen.** Today's service, confirm, cancel, seat, email notices.
5. **Deployment guide.** Backups and running it for a real venue.

## Stack

Node 24, TypeScript, Fastify, PostgreSQL 18, Vitest, ESLint, Prettier, Docker Compose, GitHub Actions.

## License

[MIT](LICENSE)
