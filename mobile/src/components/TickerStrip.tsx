// Ticker strip — user-configurable instruments (Indian/global indices,
// currencies, commodities, individual stocks) in scrolling or static mode.
//
// The marquee is a CSS keyframes animation on a raw DOM track, NOT RN
// Animated: the JS animation driver dies when the browser throttles
// requestAnimationFrame (background tabs, long sessions), which is exactly the
// "ticker stops" bug. A compositor-driven CSS animation never stops while the
// element exists. The app always renders through react-dom, so raw DOM here is
// safe (same approach as icons.tsx).
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { api } from '../api';
import { getPalette, useThemeMode } from '../theme';
import { theme } from '../theme';
import {
  KIND_CATEGORY,
  TickerConfig,
  TickerItem,
  loadTickerConfig,
  subscribeTicker,
} from '../tickerPrefs';

type Quote = { label: string; value: number | null; chg: number | null };

const h = React.createElement;
const WEB = typeof document !== 'undefined';

// One keyframes rule for every ticker instance.
if (WEB && !document.getElementById('te-ticker-kf')) {
  const st = document.createElement('style');
  st.id = 'te-ticker-kf';
  st.textContent =
    '@keyframes te-ticker-scroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }';
  document.head.appendChild(st);
}

export default function TickerStrip() {
  const [cfg, setCfg] = useState<TickerConfig | null>(null);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const mode = useThemeMode(); // re-render marquee colours on theme flip
  const alive = useRef(true);
  // Copies of the item list per track half. The -50% keyframe wraps seamlessly
  // only if each half is at least as wide as the strip; with a short list one
  // copy can be narrower, which showed as a blank gap every loop. Measure and
  // repeat the list until a half fills the viewport.
  const [reps, setReps] = useState(1);
  const [durS, setDurS] = useState(0); // 0 = not measured yet, use fallback
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const halfRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    alive.current = true;
    loadTickerConfig().then((c) => alive.current && setCfg(c));
    const un = subscribeTicker(() => loadTickerConfig().then((c) => alive.current && setCfg(c)));
    return () => {
      alive.current = false;
      un();
    };
  }, []);

  const refresh = useCallback(async (c: TickerConfig) => {
    const out: Record<string, Quote> = {};
    // indices/currencies/commodities: one /indices call per category present
    const cats = new Map<string, TickerItem[]>();
    for (const it of c.items) {
      if (it.kind === 'stock') continue;
      const cat = KIND_CATEGORY[it.kind];
      cats.set(cat, [...(cats.get(cat) || []), it]);
    }
    await Promise.all(
      [...cats.entries()].map(async ([cat, items]) => {
        try {
          const d = await api.indices(cat);
          const byKey = new Map(d.indices.map((r) => [r.key, r]));
          for (const it of items) {
            const r = byKey.get(it.key);
            out[it.kind + ':' + it.key] = {
              label: it.label,
              value: r?.level ?? null,
              chg: r?.chg ?? null,
            };
          }
        } catch {
          /* keep previous values for this category */
        }
      }),
    );
    const stocks = c.items.filter((i) => i.kind === 'stock');
    if (stocks.length) {
      try {
        const q = await api.ltp(stocks.map((s) => s.key));
        for (const s of stocks) {
          const r = q[s.key];
          out['stock:' + s.key] = { label: s.label, value: r?.price ?? null, chg: r?.chg ?? null };
        }
      } catch {
        /* keep previous */
      }
    }
    if (!alive.current) return;
    setQuotes((prev) => {
      const prevBy = new Map(prev.map((p) => [p.label, p]));
      return c.items.map((it) => {
        const fresh = out[it.kind + ':' + it.key];
        if (fresh && fresh.value != null) return fresh;
        return prevBy.get(it.label) ?? { label: it.label, value: null, chg: null };
      });
    });
  }, []);

  useEffect(() => {
    if (!cfg) return;
    refresh(cfg);
    const t = setInterval(() => refresh(cfg), 3 * 60 * 1000);
    // refetch immediately when the tab comes back to the foreground
    const onVis = () => {
      if (WEB && document.visibilityState === 'visible') refresh(cfg);
    };
    if (WEB) document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(t);
      if (WEB) document.removeEventListener('visibilitychange', onVis);
    };
  }, [cfg, refresh]);

  // Measure after every content/size change: repeat the list until one track
  // half covers the strip, and keep the scroll speed constant in px/s so short
  // lists don't crawl and long ones don't blur.
  useLayoutEffect(() => {
    if (!WEB) return;
    const measure = () => {
      const wrap = wrapRef.current;
      const half = halfRef.current;
      if (!wrap || !half || !half.offsetWidth || !wrap.offsetWidth) return;
      const base = half.offsetWidth / Math.max(1, reps); // width of ONE copy
      const need = Math.max(1, Math.ceil(wrap.offsetWidth / base));
      if (need !== reps) {
        setReps(need);
        return; // re-measure on the next layout with the new width
      }
      setDurS(Math.max(18, Math.round(half.offsetWidth / 55))); // ~55 px/s
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  });

  if (!cfg || !quotes.length) return null;
  const shown = quotes.filter((q) => q.value != null);
  if (!shown.length) return null;

  const pal = getPalette();
  const cell = (q: Quote, i: number, keyPrefix: string) =>
    h(
      'span',
      { key: keyPrefix + q.label + i, style: { whiteSpace: 'nowrap', padding: '0 14px' } },
      h('span', { style: { color: pal.muted2, fontWeight: 700 } }, q.label + ' '),
      h('span', { style: { color: pal.text } },
        q.value!.toLocaleString('en-IN', { maximumFractionDigits: 1 })),
      q.chg != null
        ? h('span', { style: { color: q.chg >= 0 ? pal.green : pal.red } },
            ' ' + (q.chg >= 0 ? '▲' : '▼') + Math.abs(q.chg).toFixed(2) + '%')
        : null,
    );

  if (cfg.mode === 'static' || !WEB) {
    // Fixed row, no motion — instrument count is capped in settings so it fits.
    return (
      <View style={styles.staticStrip}>
        {shown.map((q) => (
          <Text key={q.label} style={styles.staticItem} numberOfLines={1}>
            <Text style={styles.sym}>{q.label}</Text>{' '}
            <Text style={styles.lvl}>
              {q.value!.toLocaleString('en-IN', { maximumFractionDigits: 1 })}
            </Text>
            {q.chg != null ? (
              <Text style={q.chg >= 0 ? styles.up : styles.dn}>
                {' ' + (q.chg >= 0 ? '▲' : '▼') + Math.abs(q.chg).toFixed(2) + '%'}
              </Text>
            ) : null}
          </Text>
        ))}
      </View>
    );
  }

  // Scrolling: two identical halves back-to-back, compositor-driven, endless.
  // Each half repeats the list `reps` times so it always spans the strip and
  // the -50% wrap point lands on identical pixels — no gap, no jump.
  const copies = (prefix: string) => {
    const out: React.ReactNode[] = [];
    for (let r = 0; r < reps; r++) out.push(...shown.map((q, i) => cell(q, i, prefix + r + ':')));
    return out;
  };
  const dur = durS || Math.max(24, shown.length * reps * 4);
  const track = h(
    'div',
    {
      style: {
        display: 'inline-flex',
        animation: `te-ticker-scroll ${dur}s linear infinite`,
        willChange: 'transform',
      },
    },
    h('div', { ref: halfRef, style: { display: 'inline-flex' } }, copies('a')),
    h('div', { style: { display: 'inline-flex' } }, copies('b')),
  );
  return (
    <View style={styles.strip} key={mode /* rebuild DOM colours on theme flip */}>
      {h(
        'div',
        {
          ref: wrapRef,
          style: {
            overflow: 'hidden',
            whiteSpace: 'nowrap',
            fontFamily: theme.mono,
            fontSize: 10,
            lineHeight: '26px',
            height: 26,
          },
        },
        track,
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    height: 26,
    overflow: 'hidden',
    backgroundColor: theme.surface,
    borderBottomColor: theme.border,
    borderBottomWidth: 1,
    justifyContent: 'center',
  },
  staticStrip: {
    height: 26,
    overflow: 'hidden',
    backgroundColor: theme.surface,
    borderBottomColor: theme.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
  },
  staticItem: { fontFamily: theme.mono, fontSize: 10, lineHeight: 26, paddingHorizontal: 6 },
  sym: { color: theme.muted2, fontWeight: '700' },
  lvl: { color: theme.text },
  up: { color: theme.green },
  dn: { color: theme.red },
});
