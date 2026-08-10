import type {
  RunWorkerCommand,
  RunWorkerEvent,
} from "../compiler/internal-protocol";

const ESUCCESS = 0;
const EBADF = 8;
const EINVAL = 28;
const ENOSYS = 52;
const OUTPUT_CHUNK_BYTES = 16_384;

class WasiExit extends Error {
  constructor(readonly code: number) {
    super(`Program exited with code ${code}`);
  }
}

class OutputLimitExceeded extends Error {
  constructor() {
    super("Program output exceeded the 1 MB limit");
  }
}

interface WasmExports {
  memory: WebAssembly.Memory;
  _start?: () => void;
}

class WasiHost {
  private instance: WebAssembly.Instance | null = null;
  private stdinOffset = 0;
  private outputBytes = 0;
  private readonly stdin: Uint8Array;
  private readonly stdoutDecoder = new TextDecoder();
  private readonly stderrDecoder = new TextDecoder();
  private pendingStdout = "";
  private pendingStderr = "";
  private pendingStdoutBytes = 0;
  private pendingStderrBytes = 0;
  private stdoutHasEmitted = false;
  private stderrHasEmitted = false;

  constructor(
    private readonly requestId: string,
    private readonly args: string[],
    stdin: string,
    private readonly outputLimitBytes: number,
    private readonly send: (event: RunWorkerEvent) => void,
  ) {
    this.stdin = new TextEncoder().encode(stdin);
  }

  attach(instance: WebAssembly.Instance): void {
    this.instance = instance;
  }

  flush(): void {
    this.flushStream(1, true);
    this.flushStream(2, true);
  }

  get imports(): Record<string, (...args: never[]) => number | void> {
    return {
      args_get: this.argsGet,
      args_sizes_get: this.argsSizesGet,
      clock_res_get: this.clockResGet,
      clock_time_get: this.clockTimeGet,
      environ_get: () => ESUCCESS,
      environ_sizes_get: this.environSizesGet,
      fd_advise: () => ESUCCESS,
      fd_allocate: () => ENOSYS,
      fd_close: (fd: number) => (fd >= 0 && fd <= 2 ? ESUCCESS : EBADF),
      fd_datasync: () => ESUCCESS,
      fd_fdstat_get: this.fdFdstatGet,
      fd_fdstat_set_flags: () => ESUCCESS,
      fd_filestat_get: () => ENOSYS,
      fd_filestat_set_size: () => ENOSYS,
      fd_filestat_set_times: () => ENOSYS,
      fd_pread: () => ENOSYS,
      fd_prestat_dir_name: () => EBADF,
      fd_prestat_get: () => EBADF,
      fd_pwrite: () => ENOSYS,
      fd_read: this.fdRead,
      fd_readdir: () => ENOSYS,
      fd_renumber: () => ENOSYS,
      fd_seek: () => ENOSYS,
      fd_sync: () => ESUCCESS,
      fd_tell: () => ENOSYS,
      fd_write: this.fdWrite,
      path_create_directory: () => ENOSYS,
      path_filestat_get: () => ENOSYS,
      path_filestat_set_times: () => ENOSYS,
      path_link: () => ENOSYS,
      path_open: () => ENOSYS,
      path_readlink: () => ENOSYS,
      path_remove_directory: () => ENOSYS,
      path_rename: () => ENOSYS,
      path_symlink: () => ENOSYS,
      path_unlink_file: () => ENOSYS,
      poll_oneoff: () => ENOSYS,
      proc_exit: this.procExit,
      proc_raise: () => ENOSYS,
      random_get: this.randomGet,
      sched_yield: () => ESUCCESS,
      sock_accept: () => ENOSYS,
      sock_recv: () => ENOSYS,
      sock_send: () => ENOSYS,
      sock_shutdown: () => ENOSYS,
    } as Record<string, (...args: never[]) => number | void>;
  }

  private get memory(): WebAssembly.Memory {
    if (!this.instance) throw new Error("WASI instance is not attached");
    return (this.instance.exports as unknown as WasmExports).memory;
  }

  private get bytes(): Uint8Array {
    return new Uint8Array(this.memory.buffer);
  }

  private get view(): DataView {
    return new DataView(this.memory.buffer);
  }

  private writeU32(pointer: number, value: number): void {
    this.view.setUint32(pointer, value, true);
  }

  private writeU64(pointer: number, value: bigint): void {
    this.view.setBigUint64(pointer, value, true);
  }

  private writeStrings(pointerTable: number, buffer: number, values: string[]): void {
    const encoder = new TextEncoder();
    let table = pointerTable;
    let destination = buffer;

    for (const value of values) {
      const encoded = encoder.encode(value);
      this.writeU32(table, destination);
      table += 4;
      this.bytes.set(encoded, destination);
      destination += encoded.byteLength;
      this.bytes[destination++] = 0;
    }
  }

  private readonly argsSizesGet = (countPointer: number, sizePointer: number): number => {
    const size = this.args.reduce((total, argument) => total + new TextEncoder().encode(argument).byteLength + 1, 0);
    this.writeU32(countPointer, this.args.length);
    this.writeU32(sizePointer, size);
    return ESUCCESS;
  };

  private readonly argsGet = (pointerTable: number, buffer: number): number => {
    this.writeStrings(pointerTable, buffer, this.args);
    return ESUCCESS;
  };

  private readonly environSizesGet = (countPointer: number, sizePointer: number): number => {
    this.writeU32(countPointer, 0);
    this.writeU32(sizePointer, 0);
    return ESUCCESS;
  };

  private readonly fdWrite = (
    fd: number,
    iovsPointer: number,
    iovsLength: number,
    writtenPointer: number,
  ): number => {
    if (fd !== 1 && fd !== 2) return EBADF;

    const bytes = this.bytes;
    const remaining = Math.max(0, this.outputLimitBytes - this.outputBytes);
    const hasEmitted = fd === 1
      ? this.stdoutHasEmitted
      : this.stderrHasEmitted;
    let acceptedTotal = 0;
    let exceeded = false;

    for (let index = 0; index < iovsLength; index += 1) {
      const entry = iovsPointer + index * 8;
      const pointer = this.view.getUint32(entry, true);
      const length = this.view.getUint32(entry + 4, true);
      if (pointer > bytes.byteLength || length > bytes.byteLength - pointer) {
        throw new WebAssembly.RuntimeError("fd_write iovec is out of bounds");
      }

      const accepted = Math.min(length, remaining - acceptedTotal);
      if (accepted > 0) {
        this.appendOutput(fd, bytes.subarray(pointer, pointer + accepted));
        acceptedTotal += accepted;
      }
      if (accepted < length) {
        exceeded = true;
        break;
      }
    }

    this.outputBytes += acceptedTotal;
    if (acceptedTotal > 0 && !hasEmitted) this.flushStream(fd, false);
    if (exceeded) throw new OutputLimitExceeded();

    this.writeU32(writtenPointer, acceptedTotal);
    return ESUCCESS;
  };

  private appendOutput(fd: 1 | 2, bytes: Uint8Array): void {
    let offset = 0;

    while (offset < bytes.byteLength) {
      const pendingBytes = fd === 1
        ? this.pendingStdoutBytes
        : this.pendingStderrBytes;
      const length = Math.min(
        OUTPUT_CHUNK_BYTES - pendingBytes,
        bytes.byteLength - offset,
      );
      const decoder = fd === 1 ? this.stdoutDecoder : this.stderrDecoder;
      const text = decoder.decode(bytes.subarray(offset, offset + length), {
        stream: true,
      });

      if (fd === 1) {
        this.pendingStdout += text;
        this.pendingStdoutBytes += length;
      } else {
        this.pendingStderr += text;
        this.pendingStderrBytes += length;
      }
      offset += length;

      const totalPending = fd === 1
        ? this.pendingStdoutBytes
        : this.pendingStderrBytes;
      if (totalPending === OUTPUT_CHUNK_BYTES) this.flushStream(fd, false);
    }
  }

  private flushStream(fd: 1 | 2, finalize: boolean): void {
    const decoder = fd === 1 ? this.stdoutDecoder : this.stderrDecoder;
    const tail = finalize ? decoder.decode() : "";
    const chunk = fd === 1
      ? this.pendingStdout + tail
      : this.pendingStderr + tail;

    if (chunk) {
      this.send({
        type: fd === 1 ? "stdout" : "stderr",
        requestId: this.requestId,
        chunk,
      });
      if (fd === 1) this.stdoutHasEmitted = true;
      else this.stderrHasEmitted = true;
    }

    if (fd === 1) {
      this.pendingStdout = "";
      this.pendingStdoutBytes = 0;
    } else {
      this.pendingStderr = "";
      this.pendingStderrBytes = 0;
    }
  }

  private readonly fdRead = (
    fd: number,
    iovsPointer: number,
    iovsLength: number,
    readPointer: number,
  ): number => {
    if (fd !== 0) return EBADF;

    let total = 0;
    for (let index = 0; index < iovsLength && this.stdinOffset < this.stdin.length; index += 1) {
      const entry = iovsPointer + index * 8;
      const pointer = this.view.getUint32(entry, true);
      const capacity = this.view.getUint32(entry + 4, true);
      const length = Math.min(capacity, this.stdin.length - this.stdinOffset);
      this.bytes.set(this.stdin.subarray(this.stdinOffset, this.stdinOffset + length), pointer);
      this.stdinOffset += length;
      total += length;
    }

    this.writeU32(readPointer, total);
    return ESUCCESS;
  };

  private readonly fdFdstatGet = (fd: number, pointer: number): number => {
    if (fd < 0 || fd > 2) return EBADF;
    const view = this.view;
    view.setUint8(pointer, 2);
    view.setUint16(pointer + 2, 0, true);
    view.setBigUint64(pointer + 8, 0xffffffffffffffffn, true);
    view.setBigUint64(pointer + 16, 0xffffffffffffffffn, true);
    return ESUCCESS;
  };

  private readonly randomGet = (pointer: number, length: number): number => {
    let offset = 0;
    while (offset < length) {
      const size = Math.min(65_536, length - offset);
      crypto.getRandomValues(this.bytes.subarray(pointer + offset, pointer + offset + size));
      offset += size;
    }
    return ESUCCESS;
  };

  private readonly clockResGet = (clockId: number, pointer: number): number => {
    if (clockId !== 0 && clockId !== 1) return EINVAL;
    this.writeU64(pointer, 1_000_000n);
    return ESUCCESS;
  };

  private readonly clockTimeGet = (
    clockId: number,
    _precision: bigint,
    pointer: number,
  ): number => {
    if (clockId !== 0 && clockId !== 1) return EINVAL;
    const milliseconds = clockId === 0 ? Date.now() : performance.now();
    this.writeU64(pointer, BigInt(Math.floor(milliseconds * 1_000_000)));
    return ESUCCESS;
  };

  private readonly procExit = (code: number): never => {
    throw new WasiExit(code);
  };
}

const worker = self as unknown as DedicatedWorkerGlobalScope;

function send(event: RunWorkerEvent): void {
  worker.postMessage(event);
}

worker.onmessage = async (event: MessageEvent<RunWorkerCommand>) => {
  if (event.data.type !== "run") return;

  const { requestId, wasm, stdin, outputLimitBytes } = event.data;
  const args = ["program.wasm", ...event.data.args];
  const host = new WasiHost(requestId, args, stdin, outputLimitBytes, send);

  try {
    const module = await WebAssembly.compile(wasm);
    const wasi = host.imports;
    const imports: WebAssembly.Imports = {};

    for (const entry of WebAssembly.Module.imports(module)) {
      const namespace = (imports[entry.module] ??= {});
      if (entry.kind !== "function") {
        throw new Error(`Unsupported ${entry.kind} import: ${entry.module}.${entry.name}`);
      }

      if (entry.module === "wasi_snapshot_preview1") {
        namespace[entry.name] = wasi[entry.name] ?? (() => ENOSYS);
      } else {
        namespace[entry.name] = () => {
          throw new Error(`Unsupported program import: ${entry.module}.${entry.name}`);
        };
      }
    }

    const instance = await WebAssembly.instantiate(module, imports);
    host.attach(instance);
    const start = (instance.exports as unknown as WasmExports)._start;
    if (typeof start !== "function") throw new Error("Program does not export _start");

    send({ type: "started", requestId });
    try {
      start();
      host.flush();
      send({ type: "exited", requestId, exitCode: 0 });
    } catch (error) {
      if (error instanceof WasiExit) {
        host.flush();
        send({ type: "exited", requestId, exitCode: error.code });
      } else {
        throw error;
      }
    }
  } catch (error) {
    host.flush();
    send({
      type: "run-failed",
      requestId,
      message: error instanceof Error ? error.message : "Program execution failed",
    });
  }
};
