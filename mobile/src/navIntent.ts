// Tiny global navigation-intent store. The app has no router — Shell holds the
// active top-level page and each SubTabs group holds its own active sub-tab in
// local state. This lets a deep screen (e.g. a "Analyse this stock" button)
// request a jump to another page/sub-tab and hand off a symbol, without
// threading callbacks through every layer.
//
// Flow: navigate('analysis', { sub: 'mb', symbol: 'RELIANCE' })
//   → Shell switches the top-level page to 'analysis'
//   → the Analysis SubTabs group switches its active sub-tab to 'mb'
//   → MultibaggerScreen consumes the pending symbol on mount and analyses it.

export type NavIntent = { page: string; sub?: string; symbol?: string; sector?: string; index?: string };

let pending: NavIntent | null = null;
const listeners = new Set<() => void>();

// ── Back ─────────────────────────────────────────────────────────────────────
// The app has no router, so until now nothing ever touched browser history:
// every navigate() swapped a module variable and the URL never changed. Which
// meant the browser's Back button had exactly one entry to go back to — the
// page you were on BEFORE the app — so "back" left the site entirely. Open a
// dossier from the screener and there was no way back to your screen at all.
//
// This keeps a stack of intents alongside real history entries. Going back pops
// ours and replays the previous intent through the same listener path a normal
// navigation uses, so Shell and every SubTabs group restore themselves with no
// changes of their own. `replaying` stops that restore from pushing a new entry
// and walking us forward again.
const stack: NavIntent[] = [];
let replaying = false;
let historyBound = false;

function notify(): void {
  listeners.forEach((l) => {
    try {
      l();
    } catch {
      /* a bad listener must not break navigation */
    }
  });
}

function sameIntent(a: NavIntent | undefined, b: NavIntent): boolean {
  return !!a && a.page === b.page && a.sub === b.sub && a.symbol === b.symbol;
}

/**
 * Bind to the browser's history. Called once by the shell with wherever the
 * app opened, so the first Back lands on that page rather than off the site.
 * Safe to call on native, where there is no history object — the stack still
 * works and drives the in-app and hardware Back buttons.
 */
export function initHistory(page: string, sub?: string): void {
  if (historyBound) return;
  historyBound = true;
  stack.length = 0;
  stack.push({ page, sub });
  const g = globalThis as { addEventListener?: (t: string, f: () => void) => void };
  g.addEventListener?.('popstate', () => {
    // The browser has already moved; bring our stack into line and replay.
    if (stack.length > 1) stack.pop();
    const prev = stack[stack.length - 1];
    if (!prev) return;
    replaying = true;
    pending = { ...prev };
    notify();
    replaying = false;
  });
}

/** How many entries deep we are — drives whether a Back affordance shows. */
export function canGoBack(): boolean {
  return stack.length > 1;
}

/**
 * Step back one entry. On web this defers to history.back() so the URL bar and
 * the app agree; the popstate handler above does the actual work. Elsewhere
 * (native, tests) it pops directly.
 */
export function goBack(): boolean {
  if (stack.length <= 1) return false;
  const g = globalThis as { history?: { back?: () => void; state?: unknown } };
  if (g.history?.back) {
    g.history.back();
    return true;
  }
  stack.pop();
  const prev = stack[stack.length - 1];
  replaying = true;
  pending = { ...prev };
  notify();
  replaying = false;
  return true;
}

export function navigate(
  page: string,
  opts: { sub?: string; symbol?: string; sector?: string; index?: string } = {},
): void {
  const next: NavIntent = {
    page, sub: opts.sub, symbol: opts.symbol, sector: opts.sector, index: opts.index,
  };
  pending = next;
  if (!replaying) {
    // Re-selecting the tab you are already on is not a place to come back to.
    if (!sameIntent(stack[stack.length - 1], next)) {
      stack.push(next);
      const g = globalThis as {
        history?: { pushState?: (s: unknown, t: string, u?: string) => void };
      };
      g.history?.pushState?.({ taureye: stack.length }, '');
    }
  }
  notify();
}

/** Test seam — resets the module between cases. */
export function _resetNav(): void {
  stack.length = 0;
  pending = null;
  historyBound = false;
  replaying = false;
  listeners.clear();
}

// The one gesture for "tell me about this stock": every row, card and palette
// hit routes here. Shell maps page 'stock' to the Symbol tab; StockScreen
// consumes the symbol via takeSymbol('stock').
export function openStock(symbol: string, sector?: string): void {
  navigate('stock', { sub: 'stock', symbol, sector });
}

export function subscribeNav(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

// Non-consuming peek — Shell / SubTabs read the target page/sub to select it.
export function peekNav(): NavIntent | null {
  return pending;
}

// Consume the pending symbol for a given sub-tab (one-shot). The target screen
// calls this on mount; the tab selection stays until a new intent replaces it.
export function takeSymbol(sub: string): string | undefined {
  if (pending && pending.sub === sub && pending.symbol) {
    const s = pending.symbol;
    pending = { ...pending, symbol: undefined };
    return s;
  }
  return undefined;
}

// Consume a pending sector filter for a given sub-tab (one-shot). Used by the
// sectoral heatmap: tap a sector → pick a screening method → route here with the
// sector, and the screen applies it as a filter and auto-runs its scan.
export function takeSector(sub: string): string | undefined {
  if (pending && pending.sub === sub && pending.sector) {
    const s = pending.sector;
    pending = { ...pending, sector: undefined };
    return s;
  }
  return undefined;
}

// Consume a pending universe/index selection (one-shot). Used by the landing
// page's "open in Custom screener" buttons: the screener pre-selects this
// index in its universe dropdown.
export function takeIndex(sub: string): string | undefined {
  if (pending && pending.sub === sub && pending.index) {
    const s = pending.index;
    pending = { ...pending, index: undefined };
    return s;
  }
  return undefined;
}
