import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SwingRec, api } from '../api';
import StockDetail from '../components/StockDetail';
import { Row } from '../screener';
import { navigate } from '../navIntent';
import { addSymbol, loadWatchlist, normSymbol } from '../watchlist';
import { LocalAlert, addLocalAlert, hasLocalAlert, loadLocalAlerts } from '../localalerts';
import { loadNames } from './ScreenerScreen';
import { useResponsive } from '../responsive';
import { Card, Dropdown, EmptyState, FadeSlideIn, InfoButton, RiskBadge, Sheet } from '../ui';
import { SHORT_STRATEGIES, SwingLike } from '../strategies';
import { PaperTrade, addPaperTrade, hasOpenPaper, loadPaperTrades } from '../paperTrades';
import { theme } from '../theme';
import {
  DEPTH_OPTIONS,
  getCache,
  getDepth,
  hasCache,
  hydrateSwing,
  isHydrated,
  mergeSwing,
  setDepth as storeSetDepth,
  subscribeSwing,
} from '../swingStore';

const GOLD = '#f5c518';
const UNIVERSE = 'NIFTY 200'; // top-200 by mcap = mid & large caps only
const CONCURRENCY = 3;

const money = (v?: number | null) =>
  v == null || !isFinite(v) ? '—' : '₹' + v.toLocaleString('en-IN', { maximumFractionDigits: 2 });
const signPct = (v?: number | null, d = 1) =>
  v == null || !isFinite(v) ? '—' : (v >= 0 ? '+' : '') + v.toFixed(d) + '%';

const probColor = (p: number) => (p >= 70 ? theme.green : p >= 55 ? GOLD : theme.muted2);
const trendColor = (t: string) => (t === 'up' ? theme.green : t === 'down' ? theme.red : theme.muted2);

function timeAgo(ms: number | null): string {
  if (!ms) return '';
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// Compact list row — tap to open the full setup popup.
function SwingRow({ r, onOpen }: { r: SwingRec; onOpen: () => void }) {
  return (
    <TouchableOpacity style={styles.row} onPress={onOpen} activeOpacity={0.7}>
      <View style={styles.rowLeft}>
        <View style={styles.rowTop}>
          <Text style={styles.sym}>{r.symbol}</Text>
          <View style={styles.swingPill}>
            <Text style={styles.swingTxt}>SWING</Text>
          </View>
          <Text style={[styles.trend, { color: trendColor(r.trend) }]}>
            {r.trend === 'up' ? '▲ uptrend' : r.trend === 'down' ? '▼ downtrend' : '► sideways'}
          </Text>
        </View>
        {r.name ? <Text style={styles.name} numberOfLines={1}>{r.name}</Text> : null}
        <Text style={styles.setupLine} numberOfLines={1}>
          {r.setup} · RSI {r.rsi} · entry {money(r.entry)} · SL {money(r.stop)} · tgt {money(r.target)} ({signPct(r.upside_pct)}){r.eta ? ` · ⏱ ${r.eta}` : ''}
        </Text>
      </View>
      <View style={styles.rowRight}>
        <View style={styles.probBox}>
          <Text style={[styles.prob, { color: probColor(r.probability) }]}>{r.probability}</Text>
          <Text style={styles.probLbl}>probability</Text>
          <Text style={styles.upsideVal}>▲ {signPct(r.upside_pct)}</Text>
          <Text style={styles.upsideLbl}>upside</Text>
        </View>
        <Text style={styles.chev}>›</Text>
      </View>
    </TouchableOpacity>
  );
}

// The detail popup shown when a scrip is tapped.
function SwingDetail({
  r,
  watched,
  alerted,
  papered,
  onClose,
  onChart,
  onAnalyse,
  onPattern,
  onPaper,
  onWatch,
  onAlert,
}: {
  r: SwingRec;
  watched: boolean;
  alerted: boolean;
  papered: boolean;
  onClose: () => void;
  onChart: () => void;
  onAnalyse: () => void;
  onPattern: () => void;
  onPaper: () => void;
  onWatch: () => void;
  onAlert: () => void;
}) {
  const Cell = ({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) => (
    <View style={styles.cell}>
      <Text style={styles.cellLbl}>{label}</Text>
      <Text style={[styles.cellVal, color ? { color } : null]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
        {value}
      </Text>
      {sub ? <Text style={[styles.cellSub, color ? { color } : null]}>{sub}</Text> : null}
    </View>
  );
  return (
    <Sheet onClose={onClose} maxHeight="90%">
        <ScrollView bounces={false}>
          <View style={styles.sheetHead}>
            <View style={{ flex: 1 }}>
              <View style={styles.rowTop}>
                <Text style={styles.sheetSym}>{r.symbol}</Text>
                <View style={styles.swingPill}><Text style={styles.swingTxt}>{r.action}</Text></View>
              </View>
              {r.name ? <Text style={styles.name}>{r.name}</Text> : null}
              <Text style={styles.setupTag}>{r.setup}</Text>
              <RiskBadge input={{ rr: r.rr, stop_pct: r.stop_pct, max_dd: r.max_dd, score: r.probability }} style={{ marginTop: 6 }} />
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={[styles.prob, { color: probColor(r.probability), fontSize: 28 }]}>{r.probability}</Text>
              <Text style={styles.probLbl}>probability</Text>
            </View>
          </View>

          <View style={styles.chips}>
            <View style={styles.metaChip}><Text style={styles.metaLbl}>TREND</Text><Text style={[styles.metaVal, { color: trendColor(r.trend) }]}>{r.trend}</Text></View>
            <View style={styles.metaChip}><Text style={styles.metaLbl}>MOMENTUM</Text><Text style={styles.metaVal}>{r.momentum}</Text></View>
            <View style={styles.metaChip}><Text style={styles.metaLbl}>RSI</Text><Text style={styles.metaVal}>{r.rsi}</Text></View>
          </View>

          <View style={styles.grid}>
            <Cell label="ENTRY" value={money(r.entry)} />
            <Cell label="STOP LOSS" value={money(r.stop)} sub={signPct(r.stop_pct)} color={theme.red} />
            <Cell label="TARGET" value={money(r.target)} sub={signPct(r.upside_pct)} color={theme.green} />
            <Cell label="R : R" value={r.rr != null ? `${r.rr.toFixed(1)}:1` : '—'} />
            <Cell label="UPSIDE" value={signPct(r.upside_pct)} color={theme.green} />
            <Cell label="MAX DD" value={signPct(r.max_dd)} color={theme.red} />
            <Cell label="SUPPORT" value={money(r.support)} />
            <Cell label="RESISTANCE" value={money(r.resistance)} />
          </View>

          {r.eta ? (
            <View style={styles.etaBar}>
              <Text style={styles.etaLbl}>⏱ Est. time to target</Text>
              <Text style={styles.etaVal}>{r.eta}</Text>
            </View>
          ) : null}

          {r.reasons?.length ? (
            <View style={styles.why}>
              {r.reasons.map((s, i) => (
                <Text key={i} style={styles.whyTxt}>▸ {s}</Text>
              ))}
            </View>
          ) : null}

          {/* Plain-English glossary so the swing-trading terms are readable
              without prior knowledge — matches the depth of the HFT card. */}
          <Text style={styles.secTitle}>WHAT THIS MEANS</Text>
          <View style={styles.glossary}>
            {[
              ['Pullback reversal', 'Price dipped inside an uptrend and is turning back up from support — buying the dip rather than chasing the high.'],
              ['Oversold bounce', 'RSI fell into oversold territory (typically < 30) and momentum is curling up — a snap-back toward the mean.'],
              ['Stop loss', 'The invalidation level: if price closes below it the setup has failed and you exit to cap the loss.'],
              ['R : R', 'Reward-to-risk — target distance ÷ stop distance. Above ~2:1 means the potential gain outweighs the risked amount.'],
              ['Max DD', 'The worst peak-to-trough drawdown similar setups saw — how much heat the trade may take before working.'],
              ['Probability', 'The model’s confidence the target is reached before the stop, from trend, momentum and RSI confluence.'],
            ].map(([t, d]) => (
              <View key={t} style={styles.gloRow}>
                <Text style={styles.gloTerm}>{t}</Text>
                <Text style={styles.gloDef}>{d}</Text>
              </View>
            ))}
          </View>

          <View style={styles.actions}>
            <TouchableOpacity style={styles.aBtn} onPress={onChart} activeOpacity={0.75}>
              <Text style={styles.aTxt}>▤ Chart</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.aBtn} onPress={onAnalyse} activeOpacity={0.75}>
              <Text style={[styles.aTxt, { color: theme.accent }]}>⚡ Analyse</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.aBtn} onPress={onPattern} activeOpacity={0.75}>
              <Text style={styles.aTxt}>📈 Pattern</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.aBtn} onPress={() => navigate('analysis', { sub: 'inst', symbol: r.symbol })} activeOpacity={0.75}>
              <Text style={styles.aTxt}>🏛 Dossier</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.aBtn} onPress={onPaper} activeOpacity={0.75}>
              <Text style={[styles.aTxt, papered && { color: theme.green }]}>{papered ? '✓ Papered' : '✎ Paper trade'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.aBtn} onPress={onWatch} activeOpacity={0.75}>
              <Text style={[styles.aTxt, watched && { color: theme.green }]}>{watched ? '★ Watching' : '☆ Watchlist'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.aBtn} onPress={onAlert} activeOpacity={0.75}>
              <Text style={[styles.aTxt, alerted && { color: GOLD }]}>{alerted ? '🔔 Alerted' : '🔔 Alert'}</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.75}>
            <Text style={styles.closeTxt}>Close</Text>
          </TouchableOpacity>
          <Text style={styles.disc}>
            Swing setup on a mid/large-cap near a pullback reversal or oversold bounce. Indicative and educational only —
            not investment advice; always confirm and manage risk.
          </Text>
        </ScrollView>
    </Sheet>
  );
}

export default function ShortTermScreen() {
  const [recs, setRecs] = useState<SwingRec[]>(() => getCache()?.recs || []);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [depth, setDepthState] = useState(getDepth());
  const [asof, setAsof] = useState<number | null>(getCache()?.asof ?? null);
  const [ready, setReady] = useState(isHydrated());
  const [watch, setWatch] = useState<string[]>([]);
  const [alerts, setAlerts] = useState<LocalAlert[]>([]);
  const [paper, setPaper] = useState<PaperTrade[]>([]);
  const [sortKey, setSortKey] = useState<'prob' | 'upside' | 'rsi' | 'rr' | 'time'>('prob');
  const [strat, setStrat] = useState('balanced');
  const [open, setOpen] = useState<SwingRec | null>(null);
  const [detail, setDetail] = useState<Row | null>(null);
  const [flash, setFlash] = useState('');
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelRef = useRef<{ cancelled: boolean } | null>(null);
  const scanningRef = useRef(false);
  const { isDesktop } = useResponsive();

  const toast = (m: string) => {
    setFlash(m);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(''), 2200);
  };

  useEffect(() => {
    loadWatchlist().then(setWatch);
    loadLocalAlerts().then(setAlerts);
    loadPaperTrades().then(setPaper);
  }, []);

  const runScan = useCallback(async () => {
    if (scanningRef.current) return;
    if (cancelRef.current) cancelRef.current.cancelled = true;
    const token = { cancelled: false };
    cancelRef.current = token;
    scanningRef.current = true;
    setScanning(true);
    setError('');
    setProgress({ done: 0, total: 0 });
    setStatus(`Loading ${UNIVERSE} constituents…`);
    try {
      const idx = await api.indexConstituents(UNIVERSE);
      if (token.cancelled) return;
      const d = getDepth();
      const syms = (idx.data || []).map((c) => c.symbol).filter(Boolean).slice(0, d);
      if (!syms.length) {
        setError(idx.error || `Couldn't load ${UNIVERSE} constituents — try again shortly.`);
        return;
      }
      const names = await loadNames().catch(() => ({} as Record<string, { name: string; exchange: string }>));
      const analysed: SwingRec[] = [];
      const live = new Map((getCache()?.recs || []).map((r) => [r.symbol.toUpperCase(), r] as const));
      let done = 0;
      const total = syms.length;
      setProgress({ done: 0, total });
      const run = async (sym: string) => {
        try {
          const rec = await api.swing(sym, names[sym.toUpperCase()]?.name);
          if (token.cancelled) return;
          if (rec && !rec.error) {
            analysed.push(rec);
            if (rec.qualifies) live.set(rec.symbol.toUpperCase(), rec);
            else live.delete(rec.symbol.toUpperCase());
            setRecs([...live.values()].sort((a, b) => b.probability - a.probability));
          }
        } catch {
          /* skip a failed candidate */
        } finally {
          if (!token.cancelled) {
            done++;
            setProgress({ done, total });
            setStatus(`Scanning ${done}/${total} · ${live.size} swing setup${live.size === 1 ? '' : 's'}`);
          }
        }
      };
      let i = 0;
      const worker = async () => {
        while (i < syms.length && !token.cancelled) {
          const my = i++;
          await run(syms[my]);
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, syms.length) }, worker));
      if (token.cancelled) return;
      const now = Date.now();
      await mergeSwing(analysed, d, now);
      const list = getCache()?.recs || [];
      setRecs(list);
      setAsof(now);
      setStatus(`${list.length} swing setup${list.length === 1 ? '' : 's'} · scanned ${total} mid/large caps`);
    } catch (e) {
      if (!token.cancelled) setError(e instanceof Error ? e.message : 'Failed to build swing list');
    } finally {
      if (!token.cancelled) {
        scanningRef.current = false;
        setScanning(false);
      }
    }
  }, []);

  useEffect(() => {
    let alive = true;
    hydrateSwing().then(() => {
      if (!alive) return;
      setReady(true);
      const c = getCache();
      setRecs(c?.recs || []);
      setDepthState(getDepth());
      setAsof(c?.asof ?? null);
      if (!hasCache()) runScan();
    });
    const unsub = subscribeSwing(() => {
      const c = getCache();
      setRecs(c?.recs || []);
      setAsof(c?.asof ?? null);
      setDepthState(getDepth());
    });
    return () => {
      alive = false;
      unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onDepth = (n: number) => {
    storeSetDepth(n);
    setDepthState(n);
  };

  const sorted = useMemo(() => {
    const xs = [...recs];
    if (sortKey === 'upside') xs.sort((a, b) => (b.upside_pct ?? -999) - (a.upside_pct ?? -999));
    else if (sortKey === 'rsi') xs.sort((a, b) => (a.rsi ?? 999) - (b.rsi ?? 999)); // most oversold first
    else if (sortKey === 'rr') xs.sort((a, b) => (b.rr ?? -1) - (a.rr ?? -1));
    else if (sortKey === 'time') xs.sort((a, b) => (a.eta_days ?? 1e9) - (b.eta_days ?? 1e9)); // fastest to target first
    else xs.sort((a, b) => b.probability - a.probability);
    return xs;
  }, [recs, sortKey]);
  const SORTS: { key: typeof sortKey; label: string }[] = [
    { key: 'prob', label: 'Probability' },
    { key: 'upside', label: 'Upside' },
    { key: 'rsi', label: 'RSI (oversold)' },
    { key: 'rr', label: 'R:R' },
    { key: 'time', label: 'Time to target' },
  ];
  // Strategy re-ranks / filters the pool; 'balanced' keeps the manual Sort.
  const stratDef = SHORT_STRATEGIES.find((s) => s.id === strat) || SHORT_STRATEGIES[0];
  const shown = useMemo(
    () => (strat === 'balanced' ? sorted : (stratDef.apply(recs as SwingLike[]) as typeof recs)),
    [sorted, recs, stratDef, strat],
  );

  const isWatched = (s: string) => watch.includes(normSymbol(s));
  const onWatch = async (r: SwingRec) => {
    setWatch(await addSymbol(watch, r.symbol));
    toast(`${r.symbol} added to watchlist`);
  };
  const onAlert = async (r: SwingRec) => {
    setAlerts(await addLocalAlert(alerts, r.symbol, r.target, r.price, r.name || undefined));
    toast(`Alert set for ${r.symbol} → ${money(r.target)} (${signPct(r.upside_pct)} upside)`);
  };
  const onChart = (r: SwingRec) => {
    setOpen(null);
    setDetail({ sym: r.symbol, price: r.price } as Row);
  };
  const onAnalyse = (r: SwingRec) => {
    setOpen(null);
    navigate('analysis', { sub: 'mb', symbol: r.symbol });
  };
  const onPattern = (r: SwingRec) => {
    setOpen(null);
    navigate('analysis', { sub: 'patterns', symbol: r.symbol });
  };
  const onPaper = async (r: SwingRec) => {
    setPaper(
      await addPaperTrade({
        symbol: r.symbol,
        name: r.name || undefined,
        side: 'long',
        source: 'Short-term',
        entry: r.entry,
        stop: r.stop,
        target: r.target,
      }),
    );
    toast(`Paper trade logged for ${r.symbol} → see Paper tab`);
  };

  return (
    <View style={styles.container}>
      <View style={styles.controlBar}>
        <View style={styles.stratWrap}>
          <Dropdown
            label="Strategy"
            value={strat}
            options={SHORT_STRATEGIES.map((s) => ({ key: s.id, label: s.name }))}
            onChange={setStrat}
          />
          <InfoButton
            title={stratDef.name}
            content={stratDef.info}
            style={strat !== 'balanced' ? styles.stratInfoOn : styles.stratInfoOff}
          />
        </View>
        <Dropdown
          label="Depth"
          value={depth}
          options={DEPTH_OPTIONS.map((n) => ({ key: n, label: String(n) }))}
          onChange={onDepth}
        />
        {!scanning && recs.length > 1 && strat === 'balanced' ? (
          <Dropdown label="Sort" value={sortKey} options={SORTS} onChange={setSortKey} />
        ) : null}
        <TouchableOpacity style={[styles.updBtn, scanning && { opacity: 0.5 }]} onPress={runScan} disabled={scanning} activeOpacity={0.75}>
          <Text style={styles.updTxt}>{scanning ? '… Scanning' : '⟳ Update'}</Text>
        </TouchableOpacity>
        {asof && !scanning ? <Text style={styles.asofInline}>updated {timeAgo(asof)}</Text> : null}
      </View>

      {scanning ? (
        <View style={styles.progWrap}>
          <View style={styles.progTrack}>
            <View style={[styles.progFill, { width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 6}%` }]} />
          </View>
          <Text style={styles.progTxt}>{status || 'Preparing…'}</Text>
        </View>
      ) : status ? (
        <Text style={styles.note}>{status}</Text>
      ) : null}

      <ScrollView contentContainerStyle={styles.body}>
        {!scanning && error ? <EmptyState icon="⚠" title="Couldn't build swing list" hint={error} /> : null}
        {ready && !scanning && !error && !recs.length ? (
          <EmptyState
            icon="◇"
            title="No swing setups yet"
            hint="No cached setups. Hit ⟳ Update List to scan mid/large caps for pullback-reversal & oversold-bounce trades."
          />
        ) : null}

        {recs.length && !shown.length ? (
          <Text style={styles.note}>No setups match “{stratDef.name}” right now — try another strategy or ⟳ Update.</Text>
        ) : null}
        <View style={isDesktop ? styles.grid2 : undefined}>
          {shown.map((r, i) => (
            <View key={r.symbol} style={isDesktop ? styles.gridCell : undefined}>
              <FadeSlideIn index={i}>
                <Card style={{ padding: 0 }}>
                  <SwingRow r={r} onOpen={() => setOpen(r)} />
                </Card>
              </FadeSlideIn>
            </View>
          ))}
        </View>
      </ScrollView>

      {open ? (
        <SwingDetail
          r={open}
          watched={isWatched(open.symbol)}
          alerted={hasLocalAlert(alerts, open.symbol)}
          papered={hasOpenPaper(paper, open.symbol)}
          onClose={() => setOpen(null)}
          onChart={() => onChart(open)}
          onAnalyse={() => onAnalyse(open)}
          onPattern={() => onPattern(open)}
          onPaper={() => onPaper(open)}
          onWatch={() => onWatch(open)}
          onAlert={() => onAlert(open)}
        />
      ) : null}
      {detail ? <StockDetail row={detail} onClose={() => setDetail(null)} /> : null}
      {flash ? (
        <View style={styles.toast} pointerEvents="none">
          <Text style={styles.toastTxt}>{flash}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  note: { color: theme.muted, fontSize: theme.fs.sm, paddingHorizontal: theme.sp.lg, paddingBottom: theme.sp.sm },
  actionRow: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: theme.sp.lg, paddingTop: theme.sp.sm, paddingBottom: theme.sp.sm },
  controlBar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.sp.sm, paddingHorizontal: theme.sp.lg, paddingTop: theme.sp.sm, paddingBottom: theme.sp.sm },
  stratWrap: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  stratInfoOn: { borderColor: theme.accent, borderWidth: 1.5, backgroundColor: theme.brandSoft },
  stratInfoOff: { opacity: 0.4 },
  asofInline: { color: theme.muted, fontSize: theme.fs.xs + 1, fontFamily: theme.mono, marginLeft: 'auto' },
  updBtn: {
    backgroundColor: theme.accent,
    borderColor: theme.accent,
    borderWidth: 1,
    borderRadius: theme.radius.sm + 2,
    paddingHorizontal: theme.sp.md,
    paddingVertical: 6,
  },
  updTxt: { color: theme.onAccent, fontSize: theme.fs.sm, fontWeight: '700' },
  depthRow: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.sm, paddingHorizontal: theme.sp.lg, paddingBottom: theme.sp.sm, flexWrap: 'wrap' },
  depthLbl: { color: theme.muted, fontSize: theme.fs.sm, marginRight: 2 },
  depthChip: { minWidth: 40, alignItems: 'center', backgroundColor: theme.surface2, borderColor: theme.border2, borderWidth: 1, borderRadius: 999, paddingHorizontal: theme.sp.md, paddingVertical: 5 },
  depthChipOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  depthTxt: { color: theme.muted2, fontSize: theme.fs.sm, fontWeight: '700' },
  depthTxtOn: { color: theme.onAccent },
  asof: { color: theme.muted, fontSize: theme.fs.xs + 1, marginLeft: 'auto' },
  sortRow: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.sm, paddingHorizontal: theme.sp.lg, paddingBottom: theme.sp.sm, flexWrap: 'wrap' },
  sortChip: { backgroundColor: theme.surface2, borderColor: theme.border2, borderWidth: 1, borderRadius: 999, paddingHorizontal: theme.sp.md, paddingVertical: 4 },
  sortChipOn: { backgroundColor: theme.surface3, borderColor: theme.accent },
  sortTxt: { color: theme.muted2, fontSize: theme.fs.xs + 1, fontWeight: '700' },
  sortTxtOn: { color: theme.text },
  progWrap: { paddingHorizontal: theme.sp.lg, paddingBottom: theme.sp.md, gap: 6 },
  progTrack: { height: 6, borderRadius: 999, backgroundColor: theme.surface3, overflow: 'hidden' },
  progFill: { height: 6, borderRadius: 999, backgroundColor: theme.green },
  progTxt: { color: theme.muted2, fontSize: theme.fs.sm },
  body: { paddingHorizontal: theme.sp.lg, paddingBottom: theme.sp.xl, gap: theme.sp.sm },
  grid2: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp.sm },
  gridCell: { width: '48.5%', minWidth: 360, flexGrow: 1 },

  row: { flexDirection: 'row', alignItems: 'center', padding: theme.sp.md, gap: theme.sp.md },
  rowLeft: { flex: 1, gap: 2 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.sm },
  sym: { color: theme.text, fontFamily: theme.mono, fontWeight: '800', fontSize: theme.fs.md + 1 },
  swingPill: { backgroundColor: theme.green, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1 },
  swingTxt: { color: theme.onAccent, fontSize: 9, fontWeight: '800', letterSpacing: 0.5, fontFamily: theme.mono },
  trend: { fontSize: theme.fs.xs + 1, fontWeight: '700' },
  name: { color: theme.muted2, fontSize: theme.fs.sm },
  setupLine: { color: theme.muted, fontSize: theme.fs.xs + 1, fontFamily: theme.mono },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.sm },
  probBox: { alignItems: 'flex-end', minWidth: 78 },
  prob: { fontFamily: theme.mono, fontWeight: '800', fontSize: 22, lineHeight: 24 },
  probLbl: { color: theme.muted, fontSize: theme.fs.xs, marginTop: -1 },
  upsideVal: { color: theme.green, fontFamily: theme.mono, fontWeight: '700', fontSize: theme.fs.sm, marginTop: 3 },
  upsideLbl: { color: theme.muted, fontSize: theme.fs.xs, marginTop: -1 },
  chev: { color: theme.muted2, fontSize: 22 },

  // modal
  modalWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'flex-end' },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000a' },
  sheet: { maxHeight: '90%', backgroundColor: theme.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16, borderColor: theme.border2, borderWidth: 1, padding: theme.sp.lg, alignSelf: 'center', width: '100%', maxWidth: 620 },
  sheetHead: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.sp.md, marginBottom: theme.sp.md },
  sheetSym: { color: theme.text, fontFamily: theme.mono, fontWeight: '800', fontSize: theme.fs.xl },
  setupTag: { color: theme.green, fontSize: theme.fs.sm, fontWeight: '700', marginTop: 3 },
  chips: { flexDirection: 'row', gap: theme.sp.sm, marginBottom: theme.sp.md },
  metaChip: { flex: 1, backgroundColor: theme.surface2, borderRadius: theme.radius.sm, paddingVertical: theme.sp.sm, alignItems: 'center' },
  metaLbl: { color: theme.muted, fontSize: theme.fs.xs, letterSpacing: 0.5 },
  metaVal: { color: theme.text, fontFamily: theme.mono, fontWeight: '700', fontSize: theme.fs.md, textTransform: 'capitalize' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: '25%', alignItems: 'center', gap: 1, paddingVertical: theme.sp.sm, backgroundColor: theme.surface2, borderColor: theme.bg, borderWidth: 1 },
  cellLbl: { color: theme.muted, fontSize: theme.fs.xs, letterSpacing: 0.3 },
  cellVal: { color: theme.text, fontFamily: theme.mono, fontWeight: '700', fontSize: theme.fs.md, paddingHorizontal: 2 },
  cellSub: { fontFamily: theme.mono, fontSize: theme.fs.xs },
  etaBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: theme.sp.md,
    backgroundColor: theme.surface2,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.sp.md,
    paddingVertical: theme.sp.sm,
  },
  etaLbl: { color: theme.muted2, fontSize: theme.fs.sm },
  etaVal: { color: theme.text, fontFamily: theme.mono, fontWeight: '700', fontSize: theme.fs.md },
  why: { gap: 3, marginTop: theme.sp.md },
  whyTxt: { color: theme.muted2, fontSize: theme.fs.sm, lineHeight: 18 },
  secTitle: { color: theme.muted, fontSize: theme.fs.xs + 1, fontWeight: '800', letterSpacing: 1, marginBottom: theme.sp.sm, marginTop: theme.sp.md },
  glossary: { gap: theme.sp.sm, marginBottom: theme.sp.sm },
  gloRow: { gap: 1 },
  gloTerm: { color: theme.brand, fontSize: theme.fs.sm + 1, fontWeight: '800' },
  gloDef: { color: theme.muted2, fontSize: theme.fs.sm, lineHeight: 18 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp.sm, marginTop: theme.sp.md },
  aBtn: { backgroundColor: theme.surface2, borderColor: theme.border2, borderWidth: 1, borderRadius: theme.radius.sm + 2, paddingHorizontal: theme.sp.md, paddingVertical: theme.sp.sm },
  aTxt: { color: theme.text, fontSize: theme.fs.sm, fontWeight: '700' },
  closeBtn: { marginTop: theme.sp.md, alignItems: 'center', paddingVertical: theme.sp.sm, borderRadius: theme.radius.sm + 2, borderColor: theme.border2, borderWidth: 1 },
  closeTxt: { color: theme.muted2, fontSize: theme.fs.md, fontWeight: '700' },
  disc: { color: theme.muted, fontSize: theme.fs.xs + 1, lineHeight: 15, marginTop: theme.sp.md },

  toast: { position: 'absolute', bottom: 24, alignSelf: 'center', backgroundColor: theme.surface3, borderColor: theme.border2, borderWidth: 1, borderRadius: 999, paddingHorizontal: theme.sp.lg, paddingVertical: theme.sp.sm },
  toastTxt: { color: theme.text, fontSize: theme.fs.sm, fontWeight: '600' },
});
