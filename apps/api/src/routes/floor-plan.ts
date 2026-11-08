import { validateZone, type TableShape } from "@floorplan-reservations/engine";
import type { FastifyPluginAsync } from "fastify";
import type { Pool } from "../db.js";

const SLUG_PATTERN = "^[a-z0-9]+(-[a-z0-9]+)*$";

const tableSchema = {
  type: "object",
  required: [
    "id",
    "label",
    "minSeats",
    "maxSeats",
    "shape",
    "x",
    "y",
    "width",
    "height",
    "rotation",
    "style",
    "bookable",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    label: { type: "string" },
    minSeats: { type: "integer" },
    maxSeats: { type: "integer" },
    shape: { type: "string", enum: ["rect", "round"] },
    x: { type: "integer", description: "Centre of the table, in cm from the zone's left edge." },
    y: { type: "integer", description: "Centre of the table, in cm from the zone's top edge." },
    width: { type: "integer" },
    height: { type: "integer" },
    rotation: { type: "integer", description: "Degrees, clockwise." },
    style: { type: "object", additionalProperties: true },
    bookable: { type: "boolean" },
  },
} as const;

const issueSchema = {
  type: "object",
  required: ["code", "tableId"],
  properties: {
    code: { type: "string", enum: ["seats_invalid", "outside_zone", "overlap"] },
    tableId: { type: "string" },
    otherTableId: { type: "string" },
  },
} as const;

const floorPlanResponse = {
  type: "object",
  required: ["venue", "zones"],
  properties: {
    venue: {
      type: "object",
      required: ["slug", "name", "timeZone", "defaultLocale", "locales"],
      properties: {
        slug: { type: "string" },
        name: { type: "string" },
        timeZone: { type: "string" },
        defaultLocale: { type: "string" },
        locales: { type: "array", items: { type: "string" } },
      },
    },
    zones: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "name", "width", "height", "tables", "issues"],
        properties: {
          id: { type: "string", format: "uuid" },
          name: { type: "string" },
          width: { type: "integer" },
          height: { type: "integer" },
          tables: { type: "array", items: tableSchema },
          issues: {
            type: "array",
            description: "Problems in the plan that the booking engine would trip over.",
            items: issueSchema,
          },
        },
      },
    },
  },
} as const;

const errorResponse = {
  type: "object",
  required: ["error"],
  properties: { error: { type: "string" } },
} as const;

interface VenueRow {
  id: string;
  slug: string;
  name: string;
  time_zone: string;
  default_locale: string;
  locales: string[];
}

interface ZoneRow {
  id: string;
  name: string;
  width: number;
  height: number;
}

interface TableRow {
  id: string;
  zone_id: string;
  label: string;
  min_seats: number;
  max_seats: number;
  shape: TableShape;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  style: Record<string, unknown>;
  bookable: boolean;
}

export const floorPlanRoutes: FastifyPluginAsync<{ pool: Pool }> = (app, { pool }) => {
  app.get<{ Params: { slug: string } }>(
    "/venues/:slug/floor-plan",
    {
      schema: {
        summary: "A venue's floor plan: zones, tables and any problems in the plan.",
        tags: ["floor plan"],
        params: {
          type: "object",
          required: ["slug"],
          properties: { slug: { type: "string", pattern: SLUG_PATTERN, maxLength: 80 } },
        },
        response: { 200: floorPlanResponse, 404: errorResponse },
      },
    },
    async (request, reply) => {
      const venueResult = await pool.query<VenueRow>(
        `select id, slug, name, time_zone, default_locale, locales
           from venues
          where slug = $1`,
        [request.params.slug],
      );
      const venue = venueResult.rows[0];
      if (!venue) {
        return reply.code(404).send({ error: "Venue not found" });
      }

      const [zoneResult, tableResult] = await Promise.all([
        pool.query<ZoneRow>(
          `select id, name, width, height
             from zones
            where venue_id = $1
            order by sort_order, name`,
          [venue.id],
        ),
        pool.query<TableRow>(
          `select t.id, t.zone_id, t.label, t.min_seats, t.max_seats, t.shape,
                  t.x, t.y, t.width, t.height, t.rotation, t.style, t.bookable
             from dining_tables t
             join zones z on z.id = t.zone_id
            where z.venue_id = $1
            order by t.label`,
          [venue.id],
        ),
      ]);

      const zones = zoneResult.rows.map((zone) => {
        const tables = tableResult.rows
          .filter((table) => table.zone_id === zone.id)
          .map((table) => ({
            id: table.id,
            label: table.label,
            minSeats: table.min_seats,
            maxSeats: table.max_seats,
            shape: table.shape,
            x: table.x,
            y: table.y,
            width: table.width,
            height: table.height,
            rotation: table.rotation,
            style: table.style,
            bookable: table.bookable,
          }));
        // The engine checks the plan as stored, so staff see problems as soon as they save.
        return { ...zone, tables, issues: validateZone({ ...zone, tables }) };
      });

      return {
        venue: {
          slug: venue.slug,
          name: venue.name,
          timeZone: venue.time_zone,
          defaultLocale: venue.default_locale,
          locales: venue.locales,
        },
        zones,
      };
    },
  );
  return Promise.resolve();
};
