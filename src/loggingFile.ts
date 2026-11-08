import type {
  FilehandleOptions,
  GenericFilehandle,
  ReadFileOptions,
  ReadFileTextOptions,
} from 'generic-filehandle2'

export interface ReadLogEntry {
  position: number
  length: number
  received: number
  startMs: number
  ms: number
}

export class LoggingFile implements GenericFilehandle {
  log: ReadLogEntry[] = []
  private epoch = performance.now()
  private inner: GenericFilehandle
  private listeners = new Set<() => void>()

  constructor(inner: GenericFilehandle) {
    this.inner = inner
  }

  get source() {
    return this.inner.source
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  clear() {
    this.log = []
    this.epoch = performance.now()
    this.notify()
  }

  private notify() {
    for (const listener of this.listeners) {
      listener()
    }
  }

  async read(length: number, position: number, opts?: FilehandleOptions) {
    const t0 = performance.now()
    const bytes = await this.inner.read(length, position, opts)
    this.log = [
      ...this.log,
      {
        position,
        length,
        received: bytes.length,
        startMs: t0 - this.epoch,
        ms: performance.now() - t0,
      },
    ]
    this.notify()
    return bytes
  }

  readFile(options?: ReadFileOptions): Promise<Uint8Array<ArrayBuffer>>
  readFile(options: ReadFileTextOptions): Promise<string>
  readFile(options?: ReadFileOptions | ReadFileTextOptions) {
    return typeof options === 'string' ||
      (options !== undefined && 'encoding' in options)
      ? this.inner.readFile(options)
      : this.inner.readFile(options)
  }

  stat() {
    return this.inner.stat()
  }

  close() {
    return this.inner.close()
  }
}
