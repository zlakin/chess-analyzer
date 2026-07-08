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

    await new Promise<void>((resolve, reject) => {
      const cleanup = (): void => {
        this.pendingLineHandlers = this.pendingLineHandlers.filter((h) => h !== handler)
        this.pendingErrorHandlers = this.pendingErrorHandlers.filter((h) => h !== errorHandler)
      }
      const handler = (line: string): void => {
        if (line.startsWith('info ') && line.includes(' pv ')) {
          const parsed = parseInfoLine(line)
          if (parsed) linesByMultiPv.set(parsed.multiPv, parsed.line)
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

    return { lines }
  }

  stop(): void {
    this.process?.kill()
    this.process = null
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
    const handlers = this.pendingErrorHandlers
    this.pendingLineHandlers = []
    this.pendingErrorHandlers = []
    this.process = null
    if (handlers.length === 0) {
      console.error('StockfishManager: engine process error with no pending request', err)
      return
    }
    for (const handler of handlers) handler(err)
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
