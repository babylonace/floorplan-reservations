import { validateZone } from "@floorplan-reservations/engine";
import type { FastifyPluginAsync } from "fastify";
import type { Pool } from "../db.js";
import {
  errorResponse,
  issueSchema,
  slugParam,
  TABLE_COLUMNS,
  tableSchema,
  toApiTable,
  type TableRow,
} from "./shared.js";

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
        required: [
          "id",
          "name",
          "sortOrder",
          "width",
          "height",
          "guestSelectable",
          "tables",
          "issues",
        ],
        properties: {
          id: { type: "string", format: "uuid" },
          name: { type: "string" },
          sortOrder: { type: "integer" },
          width: { type: "integer" },
          height: { type: "integer" },
          guestSelectable: { type: "boolean" },
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
  sort_order: number;
  width: number;
  height: number;
  guest_selectable: boolean;
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
          properties: { slug: slugParam },
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
          `select id, name, sort_order, width, height, guest_selectable
             from zones
            where venue_id = $1 and retired_at is null
            order by sort_order, name`,
          [venue.id],
        ),
        pool.query<TableRow>(
          `select ${TABLE_COLUMNS}
             from dining_tables t
            where t.venue_id = $1 and t.retired_at is null
            order by t.label`,
          [venue.id],
        ),
      ]);

      const zones = zoneResult.rows.map((zone) => {
        const tables = tableResult.rows
          .filter((table) => table.zone_id === zone.id)
          .map(toApiTable);
        const plan = { id: zone.id, name: zone.name, width: zone.width, height: zone.height };
        // The engine checks the plan as stored, so staff see problems as soon as they save.
        return {
          ...plan,
          sortOrder: zone.sort_order,
          guestSelectable: zone.guest_selectable,
          tables,
          issues: validateZone({ ...plan, tables }),
        };
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
