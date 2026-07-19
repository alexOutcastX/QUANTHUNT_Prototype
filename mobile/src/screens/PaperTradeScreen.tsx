import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { api } from '../api';
import SymbolInput from '../components/SymbolInput';
import {
  PaperTrade,
  clearPaperTrades,
  loadPaperTrades,
  paperPnlPct,
  reconcilePaper,
  removePaperTrade,
} from '../paperTrades';
import {
  SimState,
  START_CASH,
  buy as simBuy,
  loadSim,
  metrics as simMetrics,
  resetSim,
  sell as simSell,
} from '../paperSim';
import { Card, EmptyState, ScreenTitle, SectionTitle, Segmented, StatTile } from '../ui';
import { theme } from '../theme';

const money = (v?: number | null) => (v == null ? '—' : '₹' + v.toLocaleString('en-IN', { maximumFractionDigits: 2 }));
const pct = (v?: number | null, d = 1) => (v == null || !isFinite(v) ? '—' : (v >= 0 ? '+' : '') + v.toFixed(d) + '%');
const ago = (t: number) => {
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

type Mode = 'tracker' | 'sim';

export default function PaperTradeScreen() {
  const [mode, setMode] = useState<Mode>('tracker');
  const [trades, setTrades] = useState<PaperTrade[]>([]);
  const [live, setLive] = useState<Record<string, number | null>>({});
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    let list = await loadPaperTrades();
    const openSyms = [...new Set(list.filter((t) => t.status === 'open').map((t) => t.symbol))];
    let prices: Record<string, number | null> = {};
    if (openSyms.length) {
      try {
        const q = await api.ltp(openSyms);
        prices = Object.fromEntries(openSyms.map((s) => [s, q[s]?.price ?? null]));
      } catch {
        /* offline — keep last statuses */
      }
      list = await reconcilePaper(list, prices);
    }
    setLive(prices);
    setTrades(list);
    setBusy(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const open = trades.filter((t) => t.status === 'open');
  const won = trades.filter((t) => t.status === 'won').length;
  const lost = trades.filter((t) => t.status === 'lost').length;
  const decided = won + lost;
  const winRate = decided ? Math.round((won / decided) * 100) : null;

  return (
    <View style={styles.container}>
      <ScreenTitle title="Paper trades" sub="Simulated outcomes from your logged setups" />
      <Segmented
        items={[
          { key: 'tracker', label: 'Outcome tracker' },
          { key: 'sim', label: 'Full simulator' },
        ]}
        value={mode}
        onChange={setMode}
      />

      {mode === 'sim' ? (
        <Simulator />
      ) : (
        <ScrollView
          contentContainerStyle={styles.body}
          refreshControl={<RefreshControl refreshing={busy} onRefresh={refresh} tintColor={theme.muted2} />}
        >
          <View style={styles.tiles}>
            <StatTile label="Open" value={String(open.length)} />
            <StatTile label="Won" value={String(won)} color={theme.green} />
            <StatTile label="Lost" value={String(lost)} color={theme.red} />
            <StatTile label="Win rate" value={winRate == null ? '—' : winRate + '%'} color={winRate != null && winRate >= 50 ? theme.green : theme.muted2} />
          </View>

          {!trades.length ? (
            <EmptyState
              icon="✎"
              title="No paper trades yet"
              hint="Open any recommendation and tap “Paper trade” to log it here. Each is scored win/loss against the live price."
            />
          ) : (
            <>
              <SectionTitle>Trades</SectionTitle>
              {trades.map((t) => {
                const px = t.status === 'open' ? live[t.symbol] : t.exit;
                const pl = px != null ? paperPnlPct(t, px) : null;
                const col = t.status === 'won' ? theme.green : t.status === 'lost' ? theme.red : pl != null && pl >= 0 ? theme.green : theme.red;
                const badge = t.status === 'won' ? 'TARGET HIT' : t.status === 'lost' ? 'STOPPED' : 'OPEN';
                return (
                  <Card key={t.id} style={styles.row}>
                    <View style={styles.rowTop}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.sym}>
                          {t.symbol} <Text style={styles.side}>· {t.side.toUpperCase()}</Text>
                        </Text>
                        <Text style={styles.meta}>{t.source} · {ago(t.created)}</Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <View style={[styles.stBadge, { borderColor: col }]}>
                          <Text style={[styles.stTxt, { color: col }]}>{badge}</Text>
                        </View>
                        <Text style={[styles.pl, { color: col }]}>{pct(pl)}</Text>
                      </View>
                    </View>
                    <View style={styles.levels}>
                      <Text style={styles.lvl}>Entry {money(t.entry)}</Text>
                      <Text style={[styles.lvl, { color: theme.red }]}>Stop {money(t.stop)}</Text>
                      <Text style={[styles.lvl, { color: theme.green }]}>Target {money(t.target)}</Text>
                      {t.status === 'open' && live[t.symbol] != null ? <Text style={styles.lvl}>Now {money(live[t.symbol])}</Text> : null}
                    </View>
                    <TouchableOpacity onPress={async () => setTrades(await removePaperTrade(t.id))} hitSlop={8}>
                      <Text style={styles.remove}>Remove</Text>
                    </TouchableOpacity>
                  </Card>
                );
              })}
              <TouchableOpacity style={styles.clearBtn} onPress={async () => setTrades(await clearPaperTrades())} activeOpacity={0.75}>
                <Text style={styles.clearTxt}>Clear all</Text>
              </TouchableOpacity>
            </>
          )}

          <Text style={styles.note}>
            Simulated only — no real orders. A trade is marked a win when the target is reached or a loss when
            the stop is hit (checked against the live price when you open this page). For research/education,
            not investment advice.
          </Text>
        </ScrollView>
      )}
    </View>
  );
}

// ── Full simulator: a virtual cash account you actively trade ──────────────────
function Simulator() {
  const [sim, setSim] = useState<SimState | null>(null);
  const [live, setLive] = useState<Record<string, number | null>>({});
  const [busy, setBusy] = useState(false);
  const [sym, setSym] = useState('');
  const [qty, setQty] = useState('');
  const [flash, setFlash] = useState('');

  const refreshPrices = useCallback(async (s: SimState) => {
    const syms = [...new Set(s.positions.map((p) => p.symbol))];
    if (!syms.length) { setLive({}); return; }
    try {
      const q = await api.ltp(syms);
      setLive(Object.fromEntries(syms.map((x) => [x, q[x]?.price ?? null])));
    } catch {
      /* keep last */
    }
  }, []);

  const reload = useCallback(async () => {
    const s = await loadSim();
    setSim(s);
    refreshPrices(s);
  }, [refreshPrices]);

  useEffect(() => { reload(); }, [reload]);

  const toast = (m: string) => { setFlash(m); setTimeout(() => setFlash(''), 2200); };

  const doBuy = async () => {
    if (!sim || busy) return;
    const s = sym.trim().toUpperCase();
    const n = parseInt(qty, 10);
    if (!s || !(n > 0)) return toast('Enter a symbol and quantity');
    setBusy(true);
    try {
      const q = await api.ltp([s]);
      const px = q[s]?.price;
      if (px == null) return toast(`No live price for ${s}`);
      const r = await simBuy(sim, s, n, px);
      setSim(r.state);
      if (!r.ok) return toast(r.reason || 'Buy failed');
      setSym(''); setQty('');
      setLive((p) => ({ ...p, [s]: px }));
      toast(`Bought ${n} ${s} @ ${money(px)}`);
    } finally {
      setBusy(false);
    }
  };

  const doSell = async (symbol: string, positionQty: number) => {
    if (!sim || busy) return;
    setBusy(true);
    try {
      const q = await api.ltp([symbol]);
      const px = q[symbol]?.price ?? live[symbol];
      if (px == null) return toast(`No live price for ${symbol}`);
      const r = await simSell(sim, symbol, positionQty, px);
      setSim(r.state);
      if (!r.ok) toast(r.reason || 'Sell failed');
      else toast(`Sold ${positionQty} ${symbol} @ ${money(px)}`);
    } finally {
      setBusy(false);
    }
  };

  if (!sim) return <View style={styles.container}><ActivityIndicator style={{ marginTop: 40 }} color={theme.muted2} /></View>;

  const m = simMetrics(sim, live);
  const pnlCol = m.pnl >= 0 ? theme.green : theme.red;

  return (
    <ScrollView
      contentContainerStyle={styles.body}
      refreshControl={<RefreshControl refreshing={busy} onRefresh={reload} tintColor={theme.muted2} />}
    >
      <Card style={styles.equityCard}>
        <Text style={styles.equityLbl}>PORTFOLIO VALUE</Text>
        <Text style={styles.equityVal}>{money(m.equity)}</Text>
        <Text style={[styles.equityPnl, { color: pnlCol }]}>
          {m.pnl >= 0 ? '▲' : '▼'} {money(Math.abs(m.pnl))} ({pct(m.pnlPct)}) all-time
        </Text>
        <View style={styles.equityRow}>
          <View style={styles.eq}><Text style={styles.eqK}>Cash</Text><Text style={styles.eqV}>{money(sim.cash)}</Text></View>
          <View style={styles.eq}><Text style={styles.eqK}>Invested</Text><Text style={styles.eqV}>{money(m.invested)}</Text></View>
          <View style={styles.eq}><Text style={styles.eqK}>Unrealized</Text><Text style={[styles.eqV, { color: m.unrealized >= 0 ? theme.green : theme.red }]}>{money(m.unrealized)}</Text></View>
          <View style={styles.eq}><Text style={styles.eqK}>Realized</Text><Text style={[styles.eqV, { color: m.realized >= 0 ? theme.green : theme.red }]}>{money(m.realized)}</Text></View>
        </View>
      </Card>

      {/* Buy ticket */}
      <Card style={{ gap: theme.sp.sm, marginTop: theme.sp.md, zIndex: 10 }}>
        <SectionTitle>Buy at market</SectionTitle>
        <View style={styles.buyRow}>
          <View style={{ flex: 1.5, zIndex: 20 }}>
            <SymbolInput value={sym} onChangeText={setSym} onSelect={setSym} placeholder="Symbol" inputStyle={styles.buyInput} />
          </View>
          <TextInput value={qty} onChangeText={setQty} placeholder="Qty" placeholderTextColor={theme.muted} keyboardType="number-pad" style={[styles.buyInput, { flex: 0.8 }]} />
          <TouchableOpacity style={[styles.buyBtn, busy && { opacity: 0.5 }]} onPress={doBuy} disabled={busy} activeOpacity={0.8}>
            <Text style={styles.buyBtnTxt}>Buy</Text>
          </TouchableOpacity>
        </View>
      </Card>

      <SectionTitle>Holdings</SectionTitle>
      {sim.positions.length ? (
        sim.positions.map((p) => {
          const px = live[p.symbol];
          const val = p.qty * (px ?? p.avg);
          const upl = p.qty * ((px ?? p.avg) - p.avg);
          const uplPct = p.avg ? (((px ?? p.avg) - p.avg) / p.avg) * 100 : 0;
          const col = upl >= 0 ? theme.green : theme.red;
          return (
            <Card key={p.symbol} style={styles.holding}>
              <View style={{ flex: 1 }}>
                <Text style={styles.hSym}>{p.symbol}</Text>
                <Text style={styles.hMeta}>{p.qty} @ {money(p.avg)} · now {px != null ? money(px) : '—'}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.hVal}>{money(val)}</Text>
                <Text style={[styles.hPnl, { color: col }]}>{money(upl)} ({pct(uplPct)})</Text>
              </View>
              <TouchableOpacity style={styles.sellBtn} onPress={() => doSell(p.symbol, p.qty)} disabled={busy} activeOpacity={0.8}>
                <Text style={styles.sellTxt}>Sell</Text>
              </TouchableOpacity>
            </Card>
          );
        })
      ) : (
        <EmptyState icon="◇" title="No positions" hint="Buy any scrip above to start your virtual portfolio." />
      )}

      {sim.trades.length ? (
        <>
          <SectionTitle>Recent orders</SectionTitle>
          {sim.trades.slice(-8).reverse().map((t) => (
            <View key={t.id} style={styles.orderRow}>
              <Text style={[styles.orderSide, { color: t.side === 'buy' ? theme.green : theme.red }]}>{t.side.toUpperCase()}</Text>
              <Text style={styles.orderSym}>{t.qty} {t.symbol}</Text>
              <Text style={styles.orderPx}>@ {money(t.price)}</Text>
              {t.realized != null ? <Text style={[styles.orderReal, { color: t.realized >= 0 ? theme.green : theme.red }]}>{money(t.realized)}</Text> : <View style={{ flex: 1 }} />}
              <Text style={styles.orderAgo}>{ago(t.ts)}</Text>
            </View>
          ))}
        </>
      ) : null}

      <TouchableOpacity
        style={styles.resetBtn}
        onPress={async () => setSim(await resetSim())}
        activeOpacity={0.75}
      >
        <Text style={styles.resetTxt}>Reset portfolio to {money(START_CASH)}</Text>
      </TouchableOpacity>
      <Text style={styles.note}>
        Virtual money only — no real orders. Buys/sells fill at the live price when you tap. For
        practice and education, not investment advice.
      </Text>

      {flash ? (
        <View style={styles.simToast} pointerEvents="none">
          <Text style={styles.simToastTxt}>{flash}</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  body: { padding: theme.sp.lg, paddingBottom: 44 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp.sm, marginBottom: theme.sp.md },
  row: { marginBottom: theme.sp.sm, gap: theme.sp.sm },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start' },
  sym: { color: theme.text, fontFamily: theme.mono, fontSize: theme.fs.md + 1, fontWeight: '800' },
  side: { color: theme.muted, fontSize: theme.fs.sm, fontWeight: '700' },
  meta: { color: theme.muted2, fontSize: theme.fs.xs + 1, marginTop: 3 },
  stBadge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  stTxt: { fontSize: theme.fs.xs, fontWeight: '800', letterSpacing: 0.4 },
  pl: { fontFamily: theme.mono, fontSize: theme.fs.md, fontWeight: '800', marginTop: 4 },
  levels: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp.md },
  lvl: { color: theme.muted2, fontFamily: theme.mono, fontSize: theme.fs.sm },
  remove: { color: theme.muted, fontSize: theme.fs.sm, textDecorationLine: 'underline', alignSelf: 'flex-start' },
  clearBtn: { alignSelf: 'center', marginTop: theme.sp.md, paddingHorizontal: theme.sp.lg, paddingVertical: 9, borderRadius: 999, borderColor: theme.border2, borderWidth: 1 },
  clearTxt: { color: theme.muted2, fontSize: theme.fs.sm, fontWeight: '700' },
  note: { color: theme.muted, fontSize: theme.fs.sm, marginTop: theme.sp.lg, lineHeight: 18 },
  soon: { alignItems: 'center', gap: theme.sp.sm, padding: theme.sp.xl },
  soonBadge: { color: theme.brand, fontSize: theme.fs.xs + 1, fontWeight: '800', letterSpacing: 1.4, borderColor: theme.brand, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  soonTitle: { color: theme.text, fontSize: theme.fs.lg, fontWeight: '800' },
  soonTxt: { color: theme.muted2, fontSize: theme.fs.sm, textAlign: 'center', lineHeight: 20 },

  // simulator
  equityCard: { alignItems: 'center', gap: 3, paddingVertical: theme.sp.lg },
  equityLbl: { color: theme.muted, fontSize: theme.fs.xs + 1, fontWeight: '800', letterSpacing: 1.2 },
  equityVal: { color: theme.text, fontFamily: theme.mono, fontSize: 32, fontWeight: '800' },
  equityPnl: { fontFamily: theme.mono, fontSize: theme.fs.md, fontWeight: '700', marginTop: 1 },
  equityRow: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp.sm, marginTop: theme.sp.md, justifyContent: 'center' },
  eq: { alignItems: 'center', minWidth: 74, backgroundColor: theme.surface2, borderRadius: theme.radius.sm, paddingVertical: theme.sp.sm, paddingHorizontal: theme.sp.sm, gap: 2 },
  eqK: { color: theme.muted, fontSize: theme.fs.xs },
  eqV: { color: theme.text, fontFamily: theme.mono, fontSize: theme.fs.sm, fontWeight: '700' },
  buyRow: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.sm },
  buyInput: { backgroundColor: theme.surface2, borderColor: theme.border2, borderWidth: 1, borderRadius: theme.radius.sm + 2, color: theme.text, fontFamily: theme.mono, fontSize: theme.fs.md, paddingHorizontal: theme.sp.md, paddingVertical: theme.sp.sm + 2 },
  buyBtn: { backgroundColor: theme.green, borderRadius: theme.radius.sm + 2, paddingHorizontal: theme.sp.lg, paddingVertical: theme.sp.sm + 3 },
  buyBtnTxt: { color: theme.onAccent, fontSize: theme.fs.md, fontWeight: '800' },
  holding: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.md, marginBottom: theme.sp.sm },
  hSym: { color: theme.text, fontFamily: theme.mono, fontSize: theme.fs.md + 1, fontWeight: '800' },
  hMeta: { color: theme.muted2, fontSize: theme.fs.xs + 1, marginTop: 2, fontFamily: theme.mono },
  hVal: { color: theme.text, fontFamily: theme.mono, fontSize: theme.fs.md, fontWeight: '700' },
  hPnl: { fontFamily: theme.mono, fontSize: theme.fs.sm, fontWeight: '700', marginTop: 2 },
  sellBtn: { borderColor: theme.red, borderWidth: 1, borderRadius: theme.radius.sm + 2, paddingHorizontal: theme.sp.md, paddingVertical: theme.sp.sm },
  sellTxt: { color: theme.red, fontSize: theme.fs.sm, fontWeight: '800' },
  orderRow: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.sm, paddingVertical: 6, borderBottomColor: theme.border, borderBottomWidth: 1 },
  orderSide: { fontFamily: theme.mono, fontSize: theme.fs.xs, fontWeight: '800', width: 34 },
  orderSym: { color: theme.text, fontFamily: theme.mono, fontSize: theme.fs.sm, fontWeight: '700' },
  orderPx: { color: theme.muted2, fontFamily: theme.mono, fontSize: theme.fs.xs + 1 },
  orderReal: { flex: 1, textAlign: 'right', fontFamily: theme.mono, fontSize: theme.fs.sm, fontWeight: '700' },
  orderAgo: { color: theme.muted, fontSize: theme.fs.xs, width: 48, textAlign: 'right' },
  resetBtn: { alignSelf: 'center', marginTop: theme.sp.lg, borderColor: theme.border2, borderWidth: 1, borderRadius: 999, paddingHorizontal: theme.sp.lg, paddingVertical: 9 },
  resetTxt: { color: theme.muted2, fontSize: theme.fs.sm, fontWeight: '700' },
  simToast: { position: 'absolute', bottom: 24, left: 0, right: 0, alignItems: 'center' },
  simToastTxt: { backgroundColor: theme.surface3, borderColor: theme.border2, borderWidth: 1, borderRadius: 999, color: theme.text, fontSize: theme.fs.sm, fontWeight: '600', overflow: 'hidden', paddingHorizontal: theme.sp.lg, paddingVertical: theme.sp.sm },
});
