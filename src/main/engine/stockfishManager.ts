import { spawn } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { EngineLine, PositionEvaluation } from '../../shared/types'

export type SpawnFn = (command: string, args: string[]) => ChildProcessWithoutNullStreams

export class StockfishManager {
  private process: ChildProcessWithoutNullStreams | null = null
  private lineBuffer = ''
  private pendingLineHandlers: Array<(line: string) => void> = []
  private pendingErrorHandlers: Array<(err: Error) => void> = []

  constructor(
    private readonly binaryPath: string,
    private readonly spawnFn: SpawnFn = spawn as SpawnFn
  ) {}

  async start(): Promise<void> {
    const proc = this.spawnFn(this.binaryPath, [])
    this.process = proc
    proc.on('error', (err: Error) => this.handleProcessError(err))
    proc.stdout.on('data', (chunk: Buffer) => this.onData(chunk))
    // Previously silently dropped: without this listener, anything the
    // engine writes to stderr (e.g. a crash message) is lost, making a dead
    // engine indistinguishable from a slow one.
    proc.stderr.on('data', (chunk: Buffer) => this.onStderr(chunk))
    await this.sendAndWaitForLine('uci', (line) => line === 'uciok')
    await this.sendAndWaitForLine('isready', (line) => line === 'readyok')
    this.send('ucinewgame')
  }

  async evaluatePosition(
    fen: string,
    options: { depth: number; multiPv?: number }
  ): Promise<PositionEvaluation> {
    const multiPv = options.multiPv ?? 2
    this.send(`setoption name MultiPV value ${multiPv}`)
    this.send(`position fen ${fen}`)

    const linesByMultiPv = new Map<number, EngineLine>()
    // For a terminal position (checkmate/stalemate) there is no legal move,
    // so Stockfish emits an "info depth 0 score (mate 0|cp 0) ..." line with
    // no " pv " token, followed by "bestmove (none)". parseInfoLine rejects
    // that line (correctly, for the normal case), so linesByMultiPv would
    // otherwise stay empty. Track the most recent no-pv scored info line
    // here so we can synthesize a terminal EngineLine if no PV line ever
    // arrives, instead of returning an empty `lines` array that crashes
    // every downstream consumer of lines[0].
    let terminalLine: EngineLine | null = null

    await new Promise<void>((resolve, reject) => {
      const cleanup = (): void => {
        this.pendingLineHandlers = this.pendingLineHandlers.filter((h) => h !== handler)
        this.pendingErrorHandlers = this.pendingErrorHandlers.filter((h) => h !== errorHandler)
      }
      const handler = (line: string): void => {
        if (line.startsWith('info ')) {
          if (line.includes(' pv ')) {
            const parsed = parseInfoLine(line)
            if (parsed) linesByMultiPv.set(parsed.multiPv, parsed.line)
          } else {
            const parsed = parseTerminalInfoLine(line)
            if (parsed) terminalLine = parsed
          }
        } else if (line.startsWith('bestmove')) {
          cleanup()
          resolve()
        }
      }
      const errorHandler = (err: Error): void => {
        cleanup()
        reject(err)
      }
      this.pendingLineHandlers.push(handler)
      this.pendingErrorHandlers.push(errorHandler)
      this.send(`go depth ${options.depth}`)
    })

    const lines = Array.from(linesByMultiPv.entries())
      .sort(([a], [b]) => a - b)
      .map(([, evalLine]) => evalLine)

    if (lines.length === 0) {
      // Either a scored-but-no-pv terminal line was captured above (the
      // observed real-Stockfish behavior for both checkmate and stalemate),
      // or bestmove (none) arrived with no info line at all -- fall back to
      // a neutral, drawn-looking line rather than leaving `lines` empty.
      lines.push(terminalLine ?? { depth: 0, scoreCp: 0, scoreMate: null, moveUci: '', pv: [] })
    }

    return { lines }
  }

  stop(): void {
    this.process?.kill()
    this.process = null
    const handlers = this.drainPendingHandlers()
    if (handlers.length === 0) return
    const stopError = new Error('StockfishManager: stopped')
    for (const handler of handlers) handler(stopError)
  }

  private onStderr(chunk: Buffer): void {
    const text = chunk.toString().trim()
    if (text.length === 0) return
    console.error('StockfishManager: stderr:', text)
  }

  private onData(chunk: Buffer): void {
    this.lineBuffer += chunk.toString()
    const lines = this.lineBuffer.split('\n')
    this.lineBuffer = lines.pop() ?? ''
    for (const rawLine of lines) {
      const trimmed = rawLine.trim()
      if (trimmed.length === 0) continue
      for (const handler of [...this.pendingLineHandlers]) {
        handler(trimmed)
      }
    }
  }

  private send(command: string): void {
    if (!this.process) throw new Error('StockfishManager: engine not started')
    this.process.stdin.write(`${command}\n`)
  }

  private sendAndWaitForLine(command: string, matches: (line: string) => boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      const cleanup = (): void => {
        this.pendingLineHandlers = this.pendingLineHandlers.filter((h) => h !== handler)
        this.pendingErrorHandlers = this.pendingErrorHandlers.filter((h) => h !== errorHandler)
      }
      const handler = (line: string): void => {
        if (matches(line)) {
          cleanup()
          resolve()
        }
      }
      const errorHandler = (err: Error): void => {
        cleanup()
        reject(err)
      }
      this.pendingLineHandlers.push(handler)
      this.pendingErrorHandlers.push(errorHandler)
      this.send(command)
    })
  }

  /**
   * Handles the child process's 'error' event (e.g. ENOENT when the Stockfish
   * binary is missing or misconfigured). Without this listener, Node.js would
   * throw the 'error' event as an uncaught exception and crash the Electron
   * main process. Any promise currently awaiting a response from the engine
   * is rejected with the underlying error instead.
   */
  private handleProcessError(err: Error): void {
    this.process = null
    const handlers = this.drainPendingHandlers()
    if (handlers.length === 0) {
      console.error('StockfishManager: engine process error with no pending request', err)
      return
    }
    for (const handler of handlers) handler(err)
  }

  /**
   * Snapshots and clears every in-flight pending handler (both the line
   * handlers and their paired error handlers), so the caller can settle them
   * exactly once. Used by both `handleProcessError()` (unexpected process
   * failure) and `stop()` (deliberate shutdown) so that no `start()` /
   * `evaluatePosition()` promise is ever left hanging when the process goes
   * away, however that happens.
   */
  private drainPendingHandlers(): Array<(err: Error) => void> {
    const handlers = this.pendingErrorHandlers
    this.pendingLineHandlers = []
    this.pendingErrorHandlers = []
    return handlers
  }
}

function parseInfoLine(line: string): { multiPv: number; line: EngineLine } | null {
  const tokens = line.split(' ')
  const get = (key: string): string | null => {
    const idx = tokens.indexOf(key)
    return idx === -1 ? null : tokens[idx + 1]
  }

  const depthStr = get('depth')
  if (!depthStr) return null

  const multiPvStr = get('multipv')
  const multiPv = multiPvStr ? Number(multiPvStr) : 1

  const scoreCpStr = get('cp')
  const scoreMateStr = get('mate')

  const pvIdx = tokens.indexOf('pv')
  const pv = pvIdx === -1 ? [] : tokens.slice(pvIdx + 1)
  if (pv.length === 0) return null

  return {
    multiPv,
    line: {
      depth: Number(depthStr),
      scoreCp: scoreCpStr ? Number(scoreCpStr) : null,
      scoreMate: scoreMateStr ? Number(scoreMateStr) : null,
      moveUci: pv[0],
      pv
    }
  }
}

/**
 * Parses a scored "info" line that has no " pv " token -- the shape
 * Stockfish uses to report a terminal position (checkmate or stalemate),
 * since there is no principal variation to give. Returns null for any other
 * no-pv "info" line (e.g. "info string ..." or a depth/currmove progress
 * line with no score), so it can never misinterpret a normal search-progress
 * line as a terminal result.
 */
function parseTerminalInfoLine(line: string): EngineLine | null {
  const tokens = line.split(' ')
  const get = (key: string): string | null => {
    const idx = tokens.indexOf(key)
    return idx === -1 ? null : tokens[idx + 1]
  }

  const depthStr = get('depth')
  if (!depthStr) return null

  const scoreCpStr = get('cp')
  const scoreMateStr = get('mate')
  if (!scoreCpStr && !scoreMateStr) return null

  return {
    depth: Number(depthStr),
    scoreCp: scoreCpStr ? Number(scoreCpStr) : null,
    scoreMate: scoreMateStr ? Number(scoreMateStr) : null,
    moveUci: '',
    pv: []
  }
}
