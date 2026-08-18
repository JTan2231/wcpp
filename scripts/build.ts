import { cp, mkdir, rm } from "node:fs/promises";

const distDir = new URL("../dist/", import.meta.url);
const assetsDir = new URL("../dist/assets/", import.meta.url);
const workersDir = new URL("../dist/workers/", import.meta.url);
const distToolchainDir = new URL("../dist/toolchain/v1/", import.meta.url);
const toolchainMetadataDir = new URL("../public/toolchain/v1/", import.meta.url);
const toolchainPackageDir = new URL(
  "../node_modules/@yowasp/clang/gen/",
  import.meta.url,
);
const sourcemap = process.env.NODE_ENV === "production" ? "none" : "external";

interface ToolchainManifest {
  artifacts: Record<string, { bytes: number; sha256: string }>;
}

const manifest = (await Bun.file(
  new URL("manifest.json", toolchainMetadataDir),
).json()) as ToolchainManifest;

for (const [name, expected] of Object.entries(manifest.artifacts)) {
  const file = Bun.file(new URL(name, toolchainPackageDir));
  if (!(await file.exists())) {
    throw new Error(`Missing ${name}; run bun install --frozen-lockfile`);
  }
  if (file.size !== expected.bytes) {
    throw new Error(`Toolchain size mismatch for ${name}`);
  }
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(await file.arrayBuffer());
  if (hasher.digest("hex") !== expected.sha256) {
    throw new Error(`Toolchain checksum mismatch for ${name}`);
  }
}

await rm(distDir, { recursive: true, force: true });
await Promise.all([
  mkdir(assetsDir, { recursive: true }),
  mkdir(workersDir, { recursive: true }),
]);

const builds = await Promise.all([
  Bun.build({
    entrypoints: [new URL("../src/main.tsx", import.meta.url).pathname],
    outdir: assetsDir.pathname,
    target: "browser",
    format: "esm",
    minify: true,
    sourcemap,
    naming: {
      entry: "[name].[ext]",
      asset: "[name].[ext]",
    },
  }),
  Bun.build({
    entrypoints: [new URL("../src/workers/compiler.worker.ts", import.meta.url).pathname],
    outdir: workersDir.pathname,
    target: "browser",
    format: "iife",
    minify: true,
    sourcemap,
    naming: "[name].[ext]",
  }),
  Bun.build({
    entrypoints: [new URL("../src/workers/runner.worker.ts", import.meta.url).pathname],
    outdir: workersDir.pathname,
    target: "browser",
    format: "iife",
    minify: true,
    sourcemap,
    naming: "[name].[ext]",
  }),
]);

for (const result of builds) {
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    process.exitCode = 1;
    throw new Error("Browser bundle failed");
  }
}

await Promise.all([
  cp(new URL("../index.html", import.meta.url), new URL("index.html", distDir)),
  cp(new URL("../public/", import.meta.url), distDir, { recursive: true }),
]);
await mkdir(distToolchainDir, { recursive: true });
await Promise.all(
  Object.keys(manifest.artifacts).map((name) =>
    cp(new URL(name, toolchainPackageDir), new URL(name, distToolchainDir)),
  ),
);

console.log(`Built static application in ${distDir.pathname}`);
