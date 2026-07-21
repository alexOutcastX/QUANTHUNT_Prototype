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

export type NavIntent = { page: string; sub?: string; symbol?: string; sector?: string };

let pending: NavIntent | null = null;
const listeners = new Set<() => void>();

export function navigate(page: string, opts: { sub?: string; symbol?: string; sector?: string } = {}): void {
  pending = { page, sub: opts.sub, symbol: opts.symbol, sector: opts.sector };
  listeners.forEach((l) => {
    try {
      l();
    } catch {
      /* a bad listener must not break navigation */
    }
  });
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
