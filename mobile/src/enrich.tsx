// Shared per-symbol enrichment (market cap + sector) for every card/list that
// shows a stock. One module-level cache means a symbol tagged on the Momentum
// radar is instantly tagged on the Swing/Institutional/Recommendation cards
// too, and vice-versa.
//
// The server warms fundamentals in the background (pool of 6 workers), so a
// large universe takes minutes — the poll budget scales with how many symbols
// are still missing instead of giving up on a fixed short clock (the bug that
// left "—" cap tags on big radars).
import React, { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';

import { api } from './api';
import { capBand } from './marketcap';
import { theme } from './theme';

export type Enrich = { sector?: string | null; mcap?: number | null };

let cache: Record<string, Enrich> = {};
const listeners = new Set<() => void>();

function publish() {
  listeners.forEach((fn) => fn());
}

export function enrichOf(sym: string): Enrich | undefined {
  return cache[sym];
}

// ₹-crore market cap, compact: ₹4.2L Cr / ₹18.5K Cr / ₹950 Cr.
export const fmtCap = (cr?: number | null) => {
  if (cr == null || !isFinite(cr)) return null;
  if (cr >= 100000) return '₹' + (cr / 100000).toFixed(2) + 'L Cr';
  if (cr >= 1000) return '₹' + (cr / 1000).toFixed(1) + 'K Cr';
  return '₹' + Math.round(cr).toLocaleString('en-IN') + ' Cr';
};

/** Poll fundamentals for `symbols` until market caps arrive; returns the
 *  progressively-filling {symbol -> {sector, mcap}} map. */
export function useEnrich(symbols: string[]): Record<string, Enrich> {
  const key = useMemo(() => Array.from(new Set(symbols.filter(Boolean))).sort().join(','), [symbols]);
  const [enr, setEnr] = useState<Record<string, Enrich>>(cache);

  // Any fetch (from any screen) that lands new data re-renders every consumer.
  useEffect(() => {
    const fn = () => setEnr({ ...cache });
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);

  useEffect(() => {
    const syms = key ? key.split(',') : [];
    if (!syms.length) return;
    const missing = syms.filter((s) => cache[s]?.mcap == null);
    if (!missing.length) return;
    let cancelled = false;
    (async () => {
      // Big universes warm server-side over minutes — scale the budget.
      const maxRounds = Math.min(90, 25 + Math.ceil(missing.length / 8));
      let errs = 0;
      for (let round = 0; round < maxRounds && !cancelled; round++) {
        try {
          const res = await api.fundamentalsBulk(syms);
          errs = 0;
          if (cancelled) return;
          if (res.data) {
            const merged = { ...cache };
            Object.entries(res.data).forEach(([sym, f]) => {
              const rec = f as Record<string, unknown>;
              merged[sym] = {
                sector: (rec.sector as string) ?? merged[sym]?.sector ?? null,
                mcap: typeof rec.market_cap_cr === 'number' ? rec.market_cap_cr : (merged[sym]?.mcap ?? null),
              };
            });
            cache = merged;
            publish();
          }
          if (!res.pending || !res.pending.length) break;
        } catch {
          // transient network blip — a few misses are fine, a wall of them isn't
          if (++errs > 3) break;
        }
        await new Promise((r) => setTimeout(r, 3000));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key]);

  return enr;
}

/** LARGE/MID/SMALL/MICRO band chip, optionally with the ₹-crore value beside
 *  it. Renders a muted em-dash while the cap is still warming. */
export function CapChip({ mcapCr, value }: { mcapCr?: number | null; value?: boolean }) {
  const b = capBand(mcapCr);
  if (!b) return <Text style={{ color: theme.muted, fontFamily: theme.mono, fontSize: theme.fs.xs }}>—</Text>;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <View style={{ borderColor: b.color, borderWidth: 1, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}>
        <Text style={{ color: b.color, fontFamily: theme.mono, fontSize: 9, fontWeight: '700', letterSpacing: 0.5 }}>{b.short}</Text>
      </View>
      {value ? (
        <Text style={{ color: theme.muted2, fontFamily: theme.mono, fontSize: theme.fs.xs }}>{fmtCap(mcapCr)}</Text>
      ) : null}
    </View>
  );
}
