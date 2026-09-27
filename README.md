# wcpp

`wcpp` is a minimal, backend-free C++20 workspace built with Bun, TypeScript, and React.
Clang, LLD, and the compiled program all run inside browser Web Workers. The
production output in `dist/` is a static site.

## Run locally

```sh
bun install --frozen-lockfile
bun start
```

Then open <http://localhost:4173/wcpp/>.

Write your program in the source editor, paste its input into the input editor, and
click **Run** or press **Ctrl+'** to compile and execute it. The source starts with
the `main.cpp` template from the local `cf` command. This mirrors the default `cf` / `r`
workflow of running the compiled program with `< test.txt`: the input is supplied
as UTF-8 text, followed by EOF. Empty input gives immediate EOF. Each click uses
the current source and input, and standard output appears below the editors.
Compiler failures and execution status appear beside the button. Ctrl+' also
cancels an active run, just like the button.
The browser workspace uses the C++20 toolchain described below.

## Text editing

Both editors start in **Normal** mode, with a block cursor in the focused editor.
Press `i` to type in **Insert** mode and `Esc` to return to Normal. Expand
**Keyboard shortcuts** below the editors for a quick reference.

| Keys | Behavior |
| --- | --- |
| `i`, `a`, `o` | Insert before the cursor, after it, or on a new line below |
| `h j k l`, arrow keys | Move left, down, up, right |
| `w`, `b` | Move forward/backward by word |
| `0`, `$` | Move to the start/end of the line |
| `gg`, `G` | Move to the first/last line |
| `x`, `dd` | Delete a character or a whole line |
| `yy`, `p` | Copy a line, then paste it below the current line |
| `u`, `Ctrl+r` | Undo/redo |
| `Ctrl+Left/Right` | Move by word, in either mode |
| `Ctrl+Up/Down` | Jump between blocks separated by blank lines, in either mode |
| `Ctrl+w` | Delete back to the Ctrl+Left word boundary, or delete the selection, in either mode |
| `Tab` | Insert 4 spaces, replacing any selection, in either mode |
| `Enter` in Insert mode, `o` in Normal mode | Start a new line with the current line's indentation |
| `Shift+Tab` | Move focus to the previous control |

The operating system may reserve some Ctrl+arrow shortcuts. Mouse selection,
clipboard shortcuts, and Shift+Tab navigation remain available. Each editor keeps its
own cursor, mode, and undo history; `yy`, `dd`, and `x` use a shared register so
`p` can paste between the two editors. This register is separate from the system
clipboard. A completed Insert session or a Normal-mode edit is one undo step;
Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z also undo and redo. History is limited to 100 undo
steps per editor and lasts for the current page session.

This is a small custom Vim-like editor. Counts, Visual mode, macros, colon
commands, and operator/motion combinations such as `dw` are not implemented.

## Verify

```sh
bun run test:acceptance
```

The acceptance suite uses real Chrome for the full behavior and safety matrix,
plus Firefox and WebKit smoke coverage. It verifies compiler errors,
standard-library programs, stdout display, exit codes, traps, timeout
and output limits, warm compiler reuse, and cold browser starts.
Editor behavior is covered in Chrome, Firefox, and WebKit. To run only those checks:

```sh
bun run test:editor
```

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
- Stdin is supplied before each run; no interactive input while running

## Static hosting

The production site is <https://joeytan.dev/wcpp/>. Pushes to `main` deploy
`dist/` through the GitHub Pages workflow; the workflow can also be run
manually from GitHub Actions. The `wcpp` repository does not need its own
`CNAME` because it inherits the custom domain from the account site.

For another static HTTPS host, run `bun run build` and deploy `dist/`. The host
must serve `.wasm` files as `application/wasm`. Enable Brotli compression: the
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
