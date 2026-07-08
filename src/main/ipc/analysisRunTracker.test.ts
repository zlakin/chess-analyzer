import { describe, it, expect } from 'vitest'
import { AnalysisRunTracker } from './analysisRunTracker'

describe('AnalysisRunTracker', () => {
  it('is not cancelled by default', () => {
    const tracker = new AnalysisRunTracker()
    const runId = tracker.start()
    expect(tracker.isCancelled(runId)).toBe(false)
  })

  it('marks the current run as cancelled', () => {
    const tracker = new AnalysisRunTracker()
    const runId = tracker.start()
    tracker.cancelCurrent()
    expect(tracker.isCancelled(runId)).toBe(true)
  })

  it('does not undo an earlier run cancellation when a later run starts (renderer starts B after cancelling A)', () => {
    const tracker = new AnalysisRunTracker()

    // Renderer invokes analyzeGame for run A.
    const runA = tracker.start()
    // User clicks Cancel before A reaches its next isCancelled() check.
    tracker.cancelCurrent()
    // Before A settles, renderer starts a second analysis, run B.
    const runB = tracker.start()

    // A's pending cancellation must survive B starting.
    expect(tracker.isCancelled(runA)).toBe(true)
    // B is a fresh run and must not be cancelled.
    expect(tracker.isCancelled(runB)).toBe(false)
  })

  it('cancelCurrent targets whichever run is current at the time it is called', () => {
    const tracker = new AnalysisRunTracker()

    const runA = tracker.start()
    tracker.finish(runA)
    const runB = tracker.start()
    tracker.cancelCurrent()

    expect(tracker.isCancelled(runA)).toBe(false)
    expect(tracker.isCancelled(runB)).toBe(true)
  })

  it('cleans up state on finish so isCancelled falls back to false for unknown runs', () => {
    const tracker = new AnalysisRunTracker()
    const runId = tracker.start()
    tracker.cancelCurrent()
    tracker.finish(runId)

    expect(tracker.isCancelled(runId)).toBe(false)
  })

  it('cancelCurrent is a no-op when no run has ever started', () => {
    const tracker = new AnalysisRunTracker()
    expect(() => tracker.cancelCurrent()).not.toThrow()
  })
})
