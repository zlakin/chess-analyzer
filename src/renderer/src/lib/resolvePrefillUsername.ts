/**
 * Decides what the chess.com username field should show once saved settings
 * have loaded. If the user has already started typing (current is non-empty)
 * by the time settings resolve, their input wins — this avoids clobbering
 * in-progress input with a race between the async settings load and the
 * user's own keystrokes.
 */
export function resolvePrefillUsername(current: string, saved: string | null): string {
  if (!saved) return current
  return current === '' ? saved : current
}
