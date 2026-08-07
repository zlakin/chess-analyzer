import { describe, it, expect } from 'vitest'
import { staticExchangeEval } from './see'

describe('staticExchangeEval', () => {
  it('is zero for a quiet move to an unattacked square', () => {
    expect(staticExchangeEval('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1', 'e2', 'e3')).toBe(0)
  })

  it('wins a full pawn when capturing an undefended pawn', () => {
    // White pawn d4 takes the undefended black pawn on e5.
    expect(staticExchangeEval('4k3/8/8/4p3/3P4/8/8/4K3 w - - 0 1', 'd4', 'e5')).toBe(100)
  })

  it('is zero for an even pawn trade', () => {
    // dxe5 is met by fxe5 (the f6 pawn defends e5): a pawn for a pawn.
    expect(staticExchangeEval('4k3/8/5p2/4p3/3P4/8/8/4K3 w - - 0 1', 'd4', 'e5')).toBe(0)
  })

  it('is sharply negative when a queen takes a pawn defended by a pawn', () => {
    // Qxe5 fxe5: wins 100, loses 900.
    expect(staticExchangeEval('4k3/8/5p2/4p3/8/8/3Q4/4K3 w - - 0 1', 'd2', 'e5')).toBe(-800)
  })

  it('does NOT treat a pawn push to a defended square as a sacrifice (the core bug)', () => {
    // 1.e4 e5 2.Nf3 Nc6 3.Bb5 a6 -- a6's destination is attacked by the
    // bishop on b5, which the old heuristic called a potential sacrifice
    // because `capturedValue < movedValue` is `0 < 1` for every pawn move.
    // Nothing is captured and nothing hangs, so SEE is 0.
    const beforeA6 = 'r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3'
    expect(staticExchangeEval(beforeA6, 'a7', 'a6')).toBe(0)
  })

  it('finds the x-ray attacker behind the front rook', () => {
    // Doubled white rooks d1+d2 vs a black pawn d7 defended by a rook on d8.
    // Rxd7 Rxd7 Rxd7 -- the second white rook is only reachable once the
    // first has left d2, which is what re-querying attackers() buys.
    expect(staticExchangeEval('3r3k/3p4/8/8/8/8/3R4/3R1K2 w - - 0 1', 'd2', 'd7')).toBe(100)
  })

  it('loses material in the same position without the x-ray rook', () => {
    // Identical, minus the rook on d1: now Rxd7 Rxd7 just drops the exchange.
    // The contrast with the previous case is what proves the x-ray is found.
    expect(staticExchangeEval('3r3k/3p4/8/8/8/8/3R4/5K2 w - - 0 1', 'd2', 'd7')).toBe(-400)
  })

  it('refuses a king recapture that would be illegal', () => {
    // Doubled white rooks e1+e2 take the pawn on e7. The black king cannot
    // recapture, because the second rook still covers e7.
    expect(staticExchangeEval('4k3/4p3/8/8/8/8/4R3/4RK2 w - - 0 1', 'e2', 'e7')).toBe(100)
  })

  it('allows a king recapture when the square is genuinely undefended', () => {
    // A single rook takes on e7 and the king simply takes it back.
    expect(staticExchangeEval('4k3/4p3/8/8/8/8/8/4RK2 w - - 0 1', 'e1', 'e7')).toBe(-400)
  })

  it('values a promoting capture as the promoted piece', () => {
    // bxa8=Q takes an undefended rook and promotes: 500 + (900 - 100).
    expect(staticExchangeEval('r3k3/1P6/8/8/8/8/8/4K3 w - - 0 1', 'b7', 'a8')).toBe(1300)
  })

  it('values an underpromotion as the piece actually chosen, not as a queen', () => {
    // gxh8=N takes an undefended rook and promotes to a knight:
    // 500 + (320 - 100) = 720. Assuming a queen would report 1300 and turn
    // a deliberate 580cp concession into an apparent gain -- an
    // underpromotion is exactly where the mover takes less material on
    // purpose, so the error always hides a sacrifice.
    const beforeGxh8 = '1nb1q1nr/rppppkPp/p7/6p1/4P3/1P6/P1PP1P1P/RNBQKBNR w KQ - 1 8'
    expect(staticExchangeEval(beforeGxh8, 'g7', 'h8', 'n')).toBe(720)
  })

  it('scores a promoting recapture inside the swap-off as the promoted piece', () => {
    // Rhxg1 takes the queen, and h2xg1=Q takes back as a queen. Pricing the
    // recapture as a plain pawn inverts the sign of the whole exchange:
    // it used to report +400 where the real value is -400.
    const beforeRxg1 = '1rb2r2/3p1k2/1P5p/1Bp5/2P3pb/4P3/2R4p/3K2qR w - - 2 32'
    expect(staticExchangeEval(beforeRxg1, 'h1', 'g1')).toBe(-400)
  })

  it('counts the promoted piece the recapturer leaves behind on the square', () => {
    // Rf8-d8 is a quiet move onto a square the e7 pawn covers: exd8=Q wins
    // the rook (500) and the promotion (800). Scoring the recapture as a
    // pawn reported -500 instead of -1300.
    const beforeRd8 = '1n3r2/p3P1k1/1p1p3n/3q1p1P/P4P1P/1P5N/7R/1N2K3 b - - 0 30'
    expect(staticExchangeEval(beforeRd8, 'f8', 'd8')).toBe(-1300)
  })

  it('handles an en passant capture', () => {
    // The captured pawn stands on d5, not on the destination d6.
    expect(staticExchangeEval('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1', 'e5', 'd6')).toBe(100)
  })

  it('reports a real knight sacrifice as clearly negative', () => {
    // Nxe5 in the Italian: wins a pawn, loses a knight to Nxe5.
    const italian = 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 1'
    expect(staticExchangeEval(italian, 'f3', 'e5')).toBe(-220)
  })
})
