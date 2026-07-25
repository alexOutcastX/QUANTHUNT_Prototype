// One vocabulary for the whole app.
//
// The QA pass found five verbs for "refresh" (Update list / Rescan / Update
// news / Update / pull-to-refresh), four labels for the watchlist toggle, and
// six wordings of the same disclaimer. Same action, same words — every screen
// imports from here rather than inventing its own.

// ── actions ──────────────────────────────────────────────────────────────────
/** Re-run whatever this screen computes (a scan, a list, a feed). */
export const REFRESH = '⟳ Refresh';
/** Refresh, in progress. */
export const REFRESHING = '⟳ Refreshing…';
/** Open the show/hide column chooser. */
export const COLUMNS = '▤ Columns';
/** Open the export menu. */
export const EXPORT = '⇩ Export ▾';

// ── watchlist toggle ─────────────────────────────────────────────────────────
// Icon-only in dense table rows; labelled everywhere there is room.
export const watchIcon = (on: boolean) => (on ? '★' : '☆');
export const watchLabel = (on: boolean) => (on ? '★ Watching' : '☆ Watchlist');

// ── disclaimers ──────────────────────────────────────────────────────────────
/** The short form, for card and list footers. */
export const DISCLAIMER = 'Educational only — not investment advice.';
/** The long form, where a screen shows levels a reader might act on. */
export const DISCLAIMER_LEVELS =
  'Educational only — not investment advice. Always confirm and manage risk.';

// ── loading ──────────────────────────────────────────────────────────────────
/** "Loading <what>…" — one shape for every waiting state. */
export const loading = (what: string) => `Loading ${what}…`;
/** A long sweep across the universe, where progress is streamed. */
export const scanning = (what: string) => `Scanning ${what}…`;
