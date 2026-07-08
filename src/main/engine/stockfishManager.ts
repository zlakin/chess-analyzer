import { spawn } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { EngineLine, PositionEvaluation } from '../../shared/types'

export type SpawnFn = (command: string, args: string[]) => ChildProcessWithoutNullStreams

export class StockfishManager {
  private process: ChildProcessWithoutNullStreams | null = null
  private lineBuffer = ''
  private pendingLineHandlers: Array<(line: string) => void> = []

  constructor(
    private readonly binaryPath: string,
    private readonly spawnFn: SpawnFn = spawn as SpawnFn
  ) {}

  async start(): Promise<void> {
    this.process = this.spawnFn(this.binaryPath, [])
    this.process.stdout.on('data', (chunk: Buffer) => this.onData(chunk))
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

    await new Promise<void>((resolve) => {
      const handler = (line: string): void => {
        if (line.startsWith('info ') && line.includes(' pv ')) {
          const parsed = parseInfoLine(line)
          if (parsed) linesByMultiPv.set(parsed.multiPv, parsed.line)
        } else if (line.startsWith('bestmove')) {
          this.pendingLineHandlers = this.pendingLineHandlers.filter((h) => h !== handler)
          resolve()
        }
      }
      this.pendingLineHandlers.push(handler)
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
    return new Promise((resolve) => {
      const handler = (line: string): void => {
        if (matches(line)) {
          this.pendingLineHandlers = this.pendingLineHandlers.filter((h) => h !== handler)
          resolve()
        }
      }
      this.pendingLineHandlers.push(handler)
      this.send(command)
    })
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
