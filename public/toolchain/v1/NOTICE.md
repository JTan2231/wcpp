# Browser C++ toolchain notices

This directory redistributes the browser build from
`@yowasp/clang@22.0.0-git20542-10`. It contains Clang/LLD 22.1.0, Clang
resource headers, a WASI Preview 1 C/C++ sysroot, JavaScript runtime code, and
WebAssembly component adapter/glue. The target is `wasm32-unknown-wasip1`.

The exact npm archive URL, digest, integrity value, source revisions, and
individual artifact digests are recorded in `manifest.json`. The npm archive
itself contains no license or notice file. Its registry metadata also supplies
neither a `gitHead` nor a provenance attestation, so the mapping to the release
source revision below is documented but is not cryptographically attested by
npm.

## Components and provenance

- YoWASP Clang release source, revision
  [`409b7dfdbd5ed12545eed706808fd423f1f692c6`](https://codeberg.org/YoWASP/clang/src/commit/409b7dfdbd5ed12545eed706808fd423f1f692c6):
  Apache-2.0 (`LICENSE.txt`). The npm package metadata instead declares ISC;
  because the package omits that text, the matching ISC license supplied by
  the same author's bundled YoWASP runtime is also included
  (`LICENSE-ISC.txt`). This upstream metadata conflict remains unresolved.
- YoWASP LLVM/Clang/LLD, libc++, libc++abi, and compiler-rt, revision
  [`9560ae0f2cc440e4fc891fddbc119da6f56daa59`](https://codeberg.org/YoWASP/llvm-project/src/commit/9560ae0f2cc440e4fc891fddbc119da6f56daa59):
  Apache-2.0 WITH LLVM-exception, including the upstream legacy NCSA terms
  (`LICENSE-LLVM.txt`).
- wasi-libc, revision
  [`2fc32bc81b9f07f8d9525edea59bfbaf760c06d6`](https://github.com/WebAssembly/wasi-libc/tree/2fc32bc81b9f07f8d9525edea59bfbaf760c06d6):
  MIT selected from the upstream multi-license, plus the applicable dlmalloc,
  cloudlibc, musl, and musl-fts notices (`LICENSE-WASI-LIBC.txt`). Installed
  WASI API headers use Apache-2.0 WITH LLVM-exception
  (`LICENSE-LLVM.txt`).
- `@yowasp/runtime@11.0.67`, revision
  [`e90ad435418b20e3ef4a67e2a7de3db83d2f949b`](https://github.com/YoWASP/runtime-js/tree/e90ad435418b20e3ef4a67e2a7de3db83d2f949b):
  ISC (`LICENSE-ISC.txt`).
- `nanotar@0.2.1`, revision
  [`10b6a2abf1195dcc3d61cac987705ae879733abe`](https://github.com/unjs/nanotar/tree/10b6a2abf1195dcc3d61cac987705ae879733abe):
  MIT (`LICENSE-NANOTAR.txt`). Its tar parser is bundled in `bundle.js`.
- `@bytecodealliance/jco@1.15.1`, tag
  [`jco-v1.15.1`](https://github.com/bytecodealliance/jco/tree/jco-v1.15.1)
  (`63e64159ff626ab6b2bc0f936161d5d60500a03c`): Apache-2.0 WITH
  LLVM-exception (`LICENSE-LLVM.txt`). JCO generated the component bindings and
  supplied the embedded WASI Preview 1 command adapter.

WASI SDK 29 was the build toolchain used by the pinned YoWASP release. It is
build provenance, not a separately copied package in this directory.
