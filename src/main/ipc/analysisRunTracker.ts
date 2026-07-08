/**
 * Tracks cancellation state per analysis run instead of using a single shared
 * module-level flag. Each call to `analyzeGame` gets its own run id via
 * `start()`; `cancelCurrent()` only marks the most recently started run as
 * cancelled, so starting a new run never clobbers an earlier run's pending
 * cancellation.
 */
export class AnalysisRunTracker {
  private nextRunId = 0
  private currentRunId: number | null = null
  private readonly cancelledRuns = new Map<number, boolean>()

  /** Registers a new run and returns its id. Becomes the "current" run that `cancelCurrent` targets. */
  start(): number {
    const runId = ++this.nextRunId
    this.currentRunId = runId
    this.cancelledRuns.set(runId, false)
    return runId
  }

  /** Whether the given run has been cancelled. */
  isCancelled(runId: number): boolean {
    return this.cancelledRuns.get(runId) ?? false
  }

  /** Marks the current (most recently started, not-yet-finished) run as cancelled, if any. */
  cancelCurrent(): void {
    if (this.currentRunId !== null) {
      this.cancelledRuns.set(this.currentRunId, true)
    }
  }

  /** Cleans up bookkeeping for a run once it has settled (completed, errored, or cancelled). */
  finish(runId: number): void {
    this.cancelledRuns.delete(runId)
    if (this.currentRunId === runId) {
      this.currentRunId = null
    }
  }
}
