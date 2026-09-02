// The detail sheet behind a row in Ideas ▸ DMA crossovers.
//
// Its siblings (the SMC and swing cards) open on an entry, a stop and a target,
// because those setups propose a trade. This one does not propose anything: a
// pending crossover is an arithmetic fact about two averages converging, so the
// card's job is to show the arithmetic — where each average actually sits, how
// the gap has moved, what the model makes of it, and what the model assumes.
//
// It carries the same actions as the other cards, because what a reader wants
// to DO from here is the same: open the chart, read the company, keep it, watch
// it, or log a paper trade.
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Row } from '../screener';
import { navigate, openStock } from '../navIntent';
import { theme } from '../theme';
import { Sheet } from '../ui';
import { addSymbol, loadWatchlist, normSymbol } from '../watchlist';
import { LocalAlert, addLocalAlert, hasLocalAlert, loadLocalAlerts } from '../localalerts';
import { PaperTrade, addPaperTrade, hasOpenPaper, loadPaperTrades } from '../paperTrades';
import {
  Approach, HORIZONS, crossName, crossProbability, etaLabel, probabilityLabel,
} from '../dmaCross';

const GOLD = '#f5c518';

/** Where a moving average actually sits, from the price and its distance.
 *
 *  The scan sends how far price is from each average as a percentage, not the
 *  average itself — so `ma = price / (1 + d/100)`. Shown because "the 20-day is
 *  at 1,242" is a level a reader can put on a chart, and "0.3% apart" is not.
 */
function maLevel(price?: number | null, dist?: number | null): number | null {
  if (price == null || dist == null || !isFinite(price) || !isFinite(dist)) return null;
  const denom = 1 + dist / 100;
  if (denom === 0) return null;
  return price / denom;
}

const money = (n?: number | null) =>
  n == null ? '—' : n.toLocaleString('en-IN', { maximumFractionDigits: 2 });

function Line({ label, value, tone, mono = true }: {
  label: string; value: string; tone?: string; mono?: boolean;
}) {
  return (
    <View style={s.line}>
      <Text style={s.lineLabel}>{label}</Text>
      <Text style={[s.lineValue, mono && s.lineMono, tone ? { color: tone } : null]}>{value}</Text>
    </View>
  );
}

export default function CrossoverCard({ a, row, onClose }: {
  a: Approach;
  /** The snapshot row, for the moving-average levels and the technicals. */
  row?: Row | null;
  onClose: () => void;
}) {
  const [watch, setWatch] = useState<string[]>([]);
  const [alerts, setAlerts] = useState<LocalAlert[]>([]);
  const [paper, setPaper] = useState<PaperTrade[]>([]);
  const [flash, setFlash] = useState('');

  useEffect(() => {
    loadWatchlist().then(setWatch);
    loadLocalAlerts().then(setAlerts);
    loadPaperTrades().then(setPaper);
  }, []);

  const toast = (m: string) => {
    setFlash(m);
    setTimeout(() => setFlash(''), 2200);
  };

  const up = a.direction === 'up';
  const tone = up ? theme.green : theme.red;
  const dist = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;

  // The two levels this is all about.
  const dKey = (n: number) => (`d${n}` as 'd9' | 'd20' | 'd50' | 'd100' | 'd200');
  let fastMa = maLevel(a.price, row ? (row[dKey(a.pair.fast)] as number | null) : null);
  let slowMa = maLevel(a.price, row ? (row[dKey(a.pair.slow)] as number | null) : null);
  // The gap IS fast/slow − 1, so either level implies the other. Deriving the
  // missing one covers a feed carrying one distance but not the other, and —
  // more usefully — guarantees the two levels printed here reconcile with the
  // gap printed under them, instead of being two independent roundings that
  // can disagree in the last digit.
  const ratio = 1 + a.gap / 100;
  if (fastMa == null && slowMa != null) fastMa = slowMa * ratio;
  else if (slowMa == null && fastMa != null && ratio !== 0) slowMa = fastMa / ratio;
  else if (fastMa != null && slowMa != null) fastMa = slowMa * ratio;

  const watched = watch.includes(normSymbol(a.symbol));
  const alerted = hasLocalAlert(alerts, a.symbol);
  const papered = hasOpenPaper(paper, a.symbol);

  const onWatch = async () => {
    setWatch(await addSymbol(watch, a.symbol));
    toast(`${a.symbol} added to watchlist`);
  };
  // The level worth being told about is the SLOW average: that is the line the
  // fast one is travelling towards, so price reaching it is the event.
  const onAlert = async () => {
    const level = slowMa ?? a.price ?? 0;
    setAlerts(await addLocalAlert(alerts, a.symbol, level, a.price ?? level, a.name));
    toast(`Alert set for ${a.symbol} at ${money(level)} — the ${a.pair.slow}-day average`);
  };
  const onPaper = async () => {
    // No target and no stop are proposed: this list does not have a view on
    // either. The trade is logged at the current price so the reader can track
    // what a cross was worth, and they set their own levels in the Paper tab.
    setPaper(await addPaperTrade({
      symbol: a.symbol,
      name: a.name || undefined,
      side: up ? 'long' : 'short',
      source: `DMA ${a.pair.label}`,
      entry: a.price ?? 0,
      stop: 0,
      target: 0,
    }));
    toast(`Paper trade logged for ${a.symbol} — set your own levels in Paper`);
  };

  return (
    <Sheet onClose={onClose} maxHeight="94%">
      <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
        <View style={s.head}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={s.symLine}>
              <Text style={s.sym}>{a.symbol}</Text>
              <Text style={[s.tag, { color: tone, borderColor: tone }]}>{a.pair.label}</Text>
            </View>
            {a.name ? <Text style={s.name} numberOfLines={2}>{a.name}</Text> : null}
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={s.price}>{money(a.price)}</Text>
            {a.chg == null ? null : (
              <Text style={[s.chg, { color: a.chg >= 0 ? theme.green : theme.red }]}>
                {a.chg >= 0 ? '+' : ''}{a.chg.toFixed(2)}%
              </Text>
            )}
          </View>
        </View>

        <View style={[s.verdict, { borderColor: tone }]}>
          <Text style={[s.verdictTop, { color: tone }]}>
            {up ? '▲' : '▼'} {crossName(a)} pending
          </Text>
          <Text style={s.verdictSub}>
            The {a.pair.fast}-day average is {a.distance.toFixed(2)}% {up ? 'below' : 'above'} the
            {' '}{a.pair.slow}-day and closing. {a.pair.blurb}
          </Text>
        </View>

        <Text style={s.section}>THE TWO AVERAGES</Text>
        <Line label={`${a.pair.fast}-day average`} value={money(fastMa)} />
        <Line label={`${a.pair.slow}-day average`} value={money(slowMa)} />
        <Line label="Gap between them" value={dist(a.gap)} tone={tone} />
        <Line label="Last close" value={money(a.price)} />

        <Text style={s.section}>HOW THE GAP IS MOVING</Text>
        <Line label="A week ago" value={a.was == null ? '—' : dist(a.was)} />
        <Line
          label="Closing at"
          value={a.speed == null ? '—' : `${a.speed.toFixed(3)} pts a session`}
        />
        <Line
          label="Moves in a session"
          value={a.sigma == null ? '—' : `± ${a.sigma.toFixed(3)} pts`}
        />
        <Line label="Sessions to contact" value={etaLabel(a) || '—'} tone={a.eta != null ? tone : undefined} />

        <Text style={s.section}>CHANCE OF COMPLETING</Text>
        <View style={s.probRow}>
          {HORIZONS.map((h) => {
            const p = crossProbability(a.distance, a.speed, a.sigma, h);
            return (
              <View key={h} style={s.probCell}>
                <Text style={[s.probV, p != null && p >= 0.5 ? { color: tone } : null]}>
                  {p == null ? '—' : `${Math.round(p * 100)}%`}
                </Text>
                <Text style={s.probL}>within {h}</Text>
                <Text style={s.probL}>sessions</Text>
              </View>
            );
          })}
        </View>
        <Text style={s.model}>
          The gap is modelled as a random walk: {a.distance.toFixed(2)} points from zero, closing at
          {' '}{a.speed == null ? 'an unmeasured rate' : `${a.speed.toFixed(3)} points a session`}, moving
          {' '}{a.sigma == null ? 'by an unmeasured amount' : `± ${a.sigma.toFixed(3)} points`} in a typical one.
        </Text>
        <View style={s.caveat}>
          <Text style={s.caveatHead}>What this number is not</Text>
          <Text style={s.caveatTxt}>
            A gap between two moving averages is not a random walk — both sides are smoothed, so the
            gap is steadier and more persistent than the model assumes, and it reads high on a pair
            drifting evenly. Use it to rank these candidates against each other, not as a forecast
            for any one of them.
          </Text>
          <Text style={s.caveatTxt}>
            And a crossover is a lagging construction either way: it describes where price has
            already been. Nothing here is a recommendation to trade.
          </Text>
        </View>

        {row ? (
          <>
            <Text style={s.section}>WHERE THE STOCK IS</Text>
            <Line label="RSI (14)" value={row.rsi == null ? '—' : String(row.rsi)} />
            <Line label="vs 200-day" value={row.d200 == null ? '—' : dist(row.d200)} />
            <Line label="Relative volume" value={row.relvol == null ? '—' : `${row.relvol}x`} />
            <Line
              label="From the 52-week high"
              value={row.pct_from_high == null ? '—' : dist(row.pct_from_high)}
            />
          </>
        ) : null}

        <View style={s.actions}>
          <TouchableOpacity style={s.aBtn} onPress={() => { onClose(); openStock(a.symbol); }} activeOpacity={0.75}>
            <Text style={[s.aTxt, { color: theme.accent }]}>▤ Chart</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={s.aBtn}
            onPress={() => { onClose(); navigate('analysis', { sub: 'patterns', symbol: a.symbol }); }}
            activeOpacity={0.75}
          >
            <Text style={s.aTxt}>Pattern</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={s.aBtn}
            onPress={() => { onClose(); navigate('analysis', { sub: 'inst', symbol: a.symbol }); }}
            activeOpacity={0.75}
          >
            <Text style={s.aTxt}>Report</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.aBtn} onPress={onPaper} activeOpacity={0.75}>
            <Text style={[s.aTxt, papered && { color: theme.green }]}>
              {papered ? '✓ Papered' : '✎ Paper trade'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.aBtn} onPress={onWatch} activeOpacity={0.75}>
            <Text style={[s.aTxt, watched && { color: theme.green }]}>
              {watched ? '★ Watching' : '☆ Watchlist'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.aBtn} onPress={onAlert} activeOpacity={0.75}>
            <Text style={[s.aTxt, alerted && { color: GOLD }]}>{alerted ? 'Alerted' : 'Alert'}</Text>
          </TouchableOpacity>
        </View>

        {flash ? <Text style={s.flash}>{flash}</Text> : null}

        <TouchableOpacity style={s.closeBtn} onPress={onClose} activeOpacity={0.75}>
          <Text style={s.closeTxt}>Close</Text>
        </TouchableOpacity>
        <Text style={s.disc}>
          Moving-average crossovers computed from the end-of-day close. For research and education
          only — not investment advice.
        </Text>
      </ScrollView>
    </Sheet>
  );
}

const s = StyleSheet.create({
  body: { padding: theme.sp.md, paddingBottom: theme.sp.xl },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  symLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sym: { color: theme.text, fontSize: theme.fs.lg, fontWeight: '800' },
  tag: {
    fontSize: 10, fontFamily: theme.mono, fontWeight: '700',
    borderWidth: 1, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2,
  },
  name: { color: theme.muted, fontSize: theme.fs.xs, marginTop: 3 },
  price: { color: theme.text, fontSize: theme.fs.md, fontFamily: theme.mono, fontWeight: '700' },
  chg: { fontSize: theme.fs.xs, fontFamily: theme.mono, marginTop: 2 },

  verdict: {
    borderWidth: 1, borderRadius: 10, padding: theme.sp.md, marginTop: theme.sp.md,
    backgroundColor: theme.surface2,
  },
  verdictTop: { fontSize: theme.fs.sm, fontWeight: '800' },
  verdictSub: { color: theme.muted2, fontSize: theme.fs.xs, lineHeight: 17, marginTop: 5 },

  section: {
    color: theme.muted, fontSize: 9, fontFamily: theme.mono, letterSpacing: 1.2,
    fontWeight: '700', marginTop: theme.sp.lg, marginBottom: 4,
  },
  line: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline',
    paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: theme.border,
  },
  lineLabel: { color: theme.muted, fontSize: theme.fs.xs, flex: 1 },
  lineValue: { color: theme.text, fontSize: theme.fs.sm, fontWeight: '700' },
  lineMono: { fontFamily: theme.mono },

  probRow: { flexDirection: 'row', gap: 10, marginTop: 6 },
  probCell: {
    flex: 1, borderWidth: 1, borderColor: theme.border2, borderRadius: 9,
    backgroundColor: theme.surface2, paddingVertical: 12, alignItems: 'center',
  },
  probV: { color: theme.text, fontSize: 22, fontFamily: theme.mono, fontWeight: '700' },
  probL: { color: theme.muted, fontSize: 9, marginTop: 2 },
  model: { color: theme.muted, fontSize: theme.fs.xs, lineHeight: 16, marginTop: 10 },

  caveat: {
    borderWidth: 1, borderColor: theme.border2, borderRadius: 9,
    padding: theme.sp.md, marginTop: theme.sp.md, backgroundColor: theme.surface2,
  },
  caveatHead: { color: theme.text, fontSize: theme.fs.xs, fontWeight: '800', marginBottom: 5 },
  caveatTxt: { color: theme.muted, fontSize: theme.fs.xs, lineHeight: 16, marginBottom: 5 },

  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: theme.sp.lg },
  aBtn: {
    borderWidth: 1, borderColor: theme.border2, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 8, backgroundColor: theme.surface2,
  },
  aTxt: { color: theme.text, fontSize: theme.fs.xs, fontWeight: '700' },
  flash: { color: theme.green, fontSize: theme.fs.xs, marginTop: 10 },

  closeBtn: {
    marginTop: theme.sp.lg, borderWidth: 1, borderColor: theme.border2,
    borderRadius: 9, paddingVertical: 11, alignItems: 'center',
  },
  closeTxt: { color: theme.text, fontSize: theme.fs.sm, fontWeight: '700' },
  disc: { color: theme.muted, fontSize: 10, lineHeight: 15, marginTop: theme.sp.md },
});
