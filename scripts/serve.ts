import { extname, join, normalize } from "node:path";

const port = Number(process.env.PORT ?? 4173);
const distRoot = normalize(new URL("../dist/", import.meta.url).pathname);
const mountPath = "/wcpp";

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
    if (url.pathname === mountPath) {
      return Response.redirect(`${url.origin}${mountPath}/${url.search}`, 308);
    }
    if (!url.pathname.startsWith(`${mountPath}/`)) {
      return new Response("Not found", { status: 404 });
    }

    const mountedPath = url.pathname.slice(mountPath.length);
    const requested = decodeURIComponent(mountedPath === "/" ? "/index.html" : mountedPath);
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

console.log(`Static site available at ${new URL(`${mountPath}/`, server.url)}`);
