# Chess.com Account Linking — Design Spec

Date: 2026-07-16

## Purpose

Today the app has no concept of "your" chess.com account. A username typed
into the Analyze tab's import search gets silently remembered as a side
effect (`ImportModal.tsx:59`), with no verification it's actually yours and
no visible indication anywhere else in the app that an account is
"connected." This spec adds an explicit "Connect chess.com account" flow
with lightweight ownership verification — a profile-field code challenge,
not OAuth (see below) — plus a persistent connected-account indicator, so
linking is a deliberate one-time action and the app auto-uses that account
afterward (Insights scans, Analyze search prefill) without asking again.

### Why not real "Sign in with Chess.com"

Chess.com does run an OAuth 2.0 server for third-party developers, but it's
gated behind a manual application (a Google Form collecting an email and a
redirect URI) with client credentials issued by hand by chess.com staff —
no self-serve dashboard, no published turnaround time, thin public
documentation. That external dependency is out of scope here. This design
gets the same practical outcome — link once, auto-connect after, some proof
it's really your account — without depending on chess.com granting
anything.

## Scope

- Replace `AppSettings.chessComUsername` with a `linkedAccount` concept that
  is either unverified (migrated from today's plain saved username) or
  verified (proven via a profile-code challenge).
- A persistent account chip in `NavBar`, and a new `ConnectAccountModal`
  for the link/verify flow.
- Insights and the Analyze import prefill both read from `linkedAccount`
  instead of the old field.
- Ad-hoc "search anyone's games" in the Analyze tab's Chess.com panel stops
  silently overwriting the linked account — only the explicit connect flow
  writes to it.

Out of scope: real chess.com OAuth (see above), multiple linked accounts,
forcing re-verification of already-migrated unverified accounts, any
change to how games/analysis themselves work.

## Architecture

### Data model & migration

`src/shared/types.ts`:

```ts
export interface LinkedAccount {
  username: string
  verifiedAt: number | null // null = linked but not proven
}

export interface AppSettings {
  linkedAccount: LinkedAccount | null
}
```

`chessComUsername` is removed from `AppSettings`. `settingsStore.loadSettings()`
(`src/main/settings/settingsStore.ts:12`) gets a one-time migration: if the
parsed JSON has a legacy `chessComUsername` string but no `linkedAccount`,
it's turned into `{ username: chessComUsername, verifiedAt: null }` and
re-saved. This keeps any existing saved username — including the `zlakin`
test account — working immediately post-upgrade as unverified rather than
silently losing Insights access.

### Verification flow

New module `src/main/chesscom/accountLink.ts`:

- `startLink(username): Promise<{ code: string } | { error: string }>` —
  calls a new `fetchPlayerProfile(username)` in `chessComClient.ts` (hits
  `GET /pub/player/{username}`, reusing the existing `doFetch` /
  `throwForErrorStatus` / `ChessComFetchError` machinery) to confirm the
  profile exists, generates a code via `crypto.randomBytes` (format
  `CHESSANALYZER-XXXXXX`, uppercase base36), and holds
  `{ username, code }` in memory (module-level; cleared on app restart or
  overwritten by a fresh `startLink` call — no persistence, no expiry
  timer, since this is a proof-of-profile-control check, not a security
  boundary).
- `verifyLink(): Promise<{ verified: true } | { error: string }>` —
  re-fetches the profile, checks whether `location` (case-insensitive)
  contains the pending code, and on match calls
  `saveSettings({ linkedAccount: { username, verifiedAt: Date.now() } })`.
- `disconnect(): void` — `saveSettings({ linkedAccount: null })`.

New IPC channels in `src/shared/ipc.ts` alongside the existing `settings:*`
ones: `account:start-link`, `account:verify-link`, `account:disconnect` —
wired in `handlers.ts` and exposed via `preload/index.ts` following the
existing pattern (e.g. `fetchChessComGames`).

### UI

- `NavBar` (`src/renderer/src/components/NavBar.tsx`) gains an account chip
  on the right side of the header, driven by a new
  `linkedAccount: LinkedAccount | null` prop from `App.tsx` (loaded once
  via `getSettings()`, same place `ImportModal` currently loads it). Three
  states: "Connect chess.com account" (nothing linked), "{username} ·
  unverified — Verify" (migrated/legacy state), "✓ {username}" (verified).
  Clicking any state opens `ConnectAccountModal`.
- New `src/renderer/src/components/ConnectAccountModal.tsx`, two steps:
  1. Username entry (prefilled if already linked-but-unverified) →
     `account:start-link` → shows the generated code.
  2. Instructions to paste the code into chess.com's profile Location
     field (a button opens `https://www.chess.com/settings/profile` via
     `shell.openExternal`) plus an "I've pasted it — Verify" button →
     `account:verify-link`. No match yields an inline, retryable message.
- `ImportModal.tsx`: `handleFindGames` (`ImportModal.tsx:44-61`) drops the
  `setChessComUsername` side effect entirely — ad-hoc searches no longer
  touch settings. The prefill `useEffect` (`ImportModal.tsx:19-23`) reads
  `settings.linkedAccount?.username ?? null` instead of
  `settings.chessComUsername`.
- `handlers.ts`'s `scanChessComGames` handler (`handlers.ts:104-108`)
  checks `settings.linkedAccount?.username` instead of
  `settings.chessComUsername`; the error message points at the new connect
  flow instead of "searching for your games in the Analyze tab."

## Error handling

- `startLink` on an unknown username → the same "Chess.com user not found"
  `ChessComFetchError` surfaced today, shown inline in step 1.
- Rate-limited (429) during either step → existing "chess.com is
  rate-limiting requests, try again in a moment" message; no retry
  loop/backoff needed since these are user-initiated clicks, not polling.
- `verifyLink` called with no pending challenge (e.g. modal reopened after
  an app restart) → back to step 1, no crash.
- Code not found in `location` yet → inline "Didn't find it yet — try
  again," Verify button stays active; no auto-expiry.
- Disconnecting never touches `insightsStore.ts`'s cached scan data — that
  stays keyed by username regardless of link state, so relinking the same
  account doesn't lose scan history.

## Testing

- Unit tests: `settingsStore` migration (legacy `chessComUsername` →
  unverified `linkedAccount`, round-trip, missing/corrupt file still
  defaults cleanly), `fetchPlayerProfile` (200/404/429, mirroring the
  existing `fetchRecentGames` tests), the code-match logic in
  `accountLink.ts` (case-insensitivity, code embedded in longer location
  text, missing/empty location), and the IPC handlers (mocked
  `chessComClient` / `settingsStore`).
- The actual "paste code into a real chess.com profile" step can't be
  automated — it needs one manual pass against the `zlakin` test account:
  link, paste the generated code into its Location field on chess.com,
  click Verify, confirm the chip flips to "✓ zlakin," confirm Insights
  still works, confirm disconnect + re-link works.

## Future ideas (explicitly deferred)

- Swapping this for real "Sign in with Chess.com" OAuth if/when chess.com
  approves an application — the `linkedAccount` concept and chip UI are
  designed to make that a backend swap, not a UI rewrite.
- Multiple linked accounts / account switching.
- Automatically reminding the user to revert their Location field after
  verifying.
