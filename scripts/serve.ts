import { extname, join, normalize } from "node:path";

const port = Number(process.env.PORT ?? 4173);
const distRoot = normalize(new URL("../dist/", import.meta.url).pathname);

const mimeTypes: Record<string, string> = {
  ".br": "application/octet-stream",
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".tar": "application/x-tar",
  ".wasm": "application/wasm",
};

const server = Bun.serve({
  port,
  async fetch(request) {
    const url = new URL(request.url);
    const requested = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
    const candidate = normalize(join(distRoot, requested));

    if (!candidate.startsWith(distRoot)) {
      return new Response("Not found", { status: 404 });
    }

    const file = Bun.file(candidate);
    if (!(await file.exists())) {
      return new Response("Not found", { status: 404 });
    }

    const headers = new Headers({
      "Content-Type": mimeTypes[extname(candidate)] ?? "application/octet-stream",
    });
    if (candidate.includes("/toolchain/")) {
      headers.set("Cache-Control", "public, max-age=31536000, immutable");
    }
    return new Response(file, { headers });
  },
});

console.log(`Static site available at ${server.url}`);
