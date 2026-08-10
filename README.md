# Browser C++ Workspace

A minimal, backend-free C++20 workspace built with Bun, TypeScript, and React.
Clang, LLD, and the compiled program all run inside browser Web Workers. The
production output in `dist/` is a static site.

## Run locally

```sh
bun install --frozen-lockfile
bun start
```

Then open <http://localhost:4173>.

## Verify

```sh
bun run test:acceptance
```

The acceptance suite uses real Chrome for the full behavior and safety matrix,
plus Firefox and WebKit smoke coverage. It verifies compiler diagnostics,
standard-library programs, stdout/stderr isolation, exit codes, traps, timeout
and output limits, warm compiler reuse, and cold browser starts.

## Architecture

```text
React UI
  -> persistent compiler worker
       -> YoWASP Clang 22 + LLD + C++ WASI sysroot
       -> program.wasm
  -> disposable runner worker
       -> minimal WASI Preview 1 host
       -> stdout, stderr, exit code
```

The runner is replaced after every execution. An infinite loop can therefore
be stopped with `Worker.terminate()` without losing the warmed compiler.

## Current limits

- One file: `main.cpp`
- C++20, targeting `wasm32-unknown-wasip1`
- C++ exceptions disabled
- No threads, networking, subprocesses, or persistent program filesystem
- Two-second execution timeout
- 1 MB combined stdout/stderr limit
- 128 MB linked maximum program memory
- Empty stdin in the current UI

## Static hosting

Run `bun run build`, then deploy `dist/` to a static HTTPS host. The host must
serve `.wasm` files as `application/wasm`. Enable Brotli compression: the
toolchain is approximately 105 MB unpacked and about 20 MB with Brotli level 9.
No COOP/COEP headers or backend execution service are required.

The large compiler artifacts are not stored in Git. The build copies them from
the exact `@yowasp/clang` version in `bun.lockb` and verifies every artifact
against `public/toolchain/v1/manifest.json` before producing `dist/`.

The development server treats `/toolchain/v1/` as immutable. If the pinned
toolchain changes, publish it under a new versioned path instead of replacing
those files in place.

## Toolchain notice

The pinned compiler is `@yowasp/clang@22.0.0-git20542-10`. Exact archive and
artifact hashes, source revisions, component notices, and bundled license texts
are under `public/toolchain/v1/`. See its `NOTICE.md`: the npm license metadata
conflicts with the upstream repository and npm provides no provenance
attestation, so production legal clearance may require upstream confirmation.
