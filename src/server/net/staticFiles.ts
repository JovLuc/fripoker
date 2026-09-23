// Static file serving behind an optional reverse-proxy path prefix
// (BASE_PATH, e.g. nginx `location /frp/`).

import { readFile } from "node:fs/promises";
import { normalize, join, extname } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

/** The one accepted prefix (empty → none); nginx proxies e.g. /frp/ → here. */
export function pathPrefixes(basePath: string): string[] {
  return basePath ? [basePath] : [];
}

/** Strip any accepted prefix and decode; "/" stays "/". */
export function stripBase(urlPath: string, basePath: string): string {
  let pathname = urlPath.split("?")[0];
  try {
    pathname = decodeURIComponent(pathname);
  } catch {
    /* keep raw */
  }
  for (const prefix of pathPrefixes(basePath)) {
    if (pathname === prefix || pathname === `${prefix}/`) return "/";
    if (pathname.startsWith(`${prefix}/`)) {
      pathname = pathname.slice(prefix.length);
      break;
    }
  }
  return pathname || "/";
}

/** Resolve a url path inside root; null when it escapes the root. */
function safeJoin(root: string, urlPath: string, basePath: string): string | null {
  const clean = stripBase(urlPath, basePath);
  const rel = clean === "/" ? "/index.html" : clean;
  const full = normalize(join(root, rel));
  if (!full.startsWith(root)) return null;
  return full;
}

export interface StaticHandlerOptions {
  root: string;
  basePath: string;
}

export function createStaticHandler({ root, basePath }: StaticHandlerOptions) {
  return async function handleStatic(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const rawUrl = req.url || "/";
    const pathOnly = rawUrl.split("?")[0];

    // Redirect bare prefix → trailing slash so relative assets and nginx location /fpk/ line up.
    for (const prefix of pathPrefixes(basePath)) {
      if (pathOnly === prefix) {
        res.writeHead(302, { Location: `${prefix}/` });
        res.end();
        return;
      }
    }

    const file = safeJoin(root, rawUrl, basePath);
    if (!file) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    let data: Buffer;
    try {
      data = await readFile(file);
    } catch {
      // SPA fallback — but a bare missing root stays a plain 404.
      const pathname = stripBase(rawUrl, basePath);
      if (pathname === "/" && pathOnly === "/") {
        res.writeHead(404);
        res.end("Not Found");
        return;
      }
      try {
        const html = await readFile(join(root, "index.html"));
        res.writeHead(200, { "Content-Type": MIME[".html"], "Cache-Control": "no-cache" });
        res.end(html);
      } catch {
        res.writeHead(404);
        res.end("Not Found");
      }
      return;
    }

    const ext = extname(file);
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(data);
  };
}
