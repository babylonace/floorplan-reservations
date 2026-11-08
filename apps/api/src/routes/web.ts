import { existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import fastifyStatic from "@fastify/static";
import type { FastifyPluginAsync } from "fastify";
import { slugParam } from "./shared.js";

/**
 * Serves the built web app (apps/web/dist) from the same address as the API: the staff editor
 * at /, and each venue's public booking page at /reservar/<venue slug>.
 *
 * Same origin on purpose: the session cookie is SameSite=Strict with the __Host- prefix, and the
 * API turns away requests a browser marks as coming from another site. Served from here, the
 * web app needs no CORS and no relaxed cookie rules.
 */

/**
 * What the pages may load: only files from this address. No inline scripts, no other sites,
 * and no framing by other pages.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

/** The booking page's file inside the built app. One page for every venue. */
const BOOKING_PAGE = "reservar/index.html";

/** Throws when `dir` does not hold a built web app. */
export function checkWebDir(dir: string): void {
  if (!existsSync(join(dir, "index.html"))) {
    throw new Error(`WEB_DIR must be a folder with a built web app, but ${dir} has no index.html`);
  }
}

export const webRoutes: FastifyPluginAsync<{ dir: string }> = async (app, { dir }) => {
  checkWebDir(dir);
  // A relative WEB_DIR counts from the folder the server was started in.
  const root = resolve(dir);
  await app.register(fastifyStatic, {
    root,
    // One route per file found at start-up, so nothing else under / is ever answered from disk.
    wildcard: false,
    index: ["index.html"],
    setHeaders(res, path) {
      res.header("content-security-policy", CONTENT_SECURITY_POLICY);
      res.header("x-content-type-options", "nosniff");
      res.header("referrer-policy", "no-referrer");
      // Vite puts a hash of the content in every file name under assets/, so those never change.
      const hashed = /^assets[\\/]/.test(relative(root, path));
      res.header(
        "cache-control",
        hashed ? "public, max-age=31536000, immutable" : "no-cache, must-revalidate",
      );
    },
  });

  // Older builds have no booking page; then the path is simply not there.
  if (existsSync(join(root, BOOKING_PAGE))) {
    app.get<{ Params: { slug: string } }>(
      "/reservar/:slug",
      {
        schema: {
          hide: true,
          params: { type: "object", required: ["slug"], properties: { slug: slugParam } },
        },
      },
      (_request, reply) => reply.sendFile(BOOKING_PAGE),
    );
  }
};
