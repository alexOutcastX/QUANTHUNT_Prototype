import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SmcRec, StrategyHit, api } from '../api';
import StockDetail from '../components/StockDetail';
import { Row } from '../screener';
import { navigate } from '../navIntent';
import { addSymbol, loadWatchlist, normSymbol } from '../watchlist';
import { LocalAlert, addLocalAlert, hasLocalAlert, loadLocalAlerts } from '../localalerts';
import { loadNames } from './ScreenerScreen';
import { useResponsive } from '../responsive';
import { Card, Dropdown, EmptyState, FadeSlideIn, RiskBadge, Sheet } from '../ui';
import { PaperTrade, addPaperTrade, hasOpenPaper, loadPaperTrades } from '../paperTrades';
import { theme } from '../theme';
import {
  DEPTH_OPTIONS,
  getCache,
  getDepth,
  hasCache,
  hydrateSmc,
  isHydrated,
  mergeSmc,
  setDepth as storeSetDepth,
  subscribeSmc,
} from '../smcStore';

const GOLD = '#f5c518';
const UNIVERSE = 'NIFTY 200';
const CONCURRENCY = 3;

const STRAT_META: Record<string, { color: string }> = {
  sweep: { color: '#ff7043' },
  amd: { color: theme.accent },
  mmxm: { color: '#c77dff' },
  fvg: { color: GOLD },
  breaker: { color: '#4dd0e1' },
  hvi: { color: theme.green },
  divergence: { color: '#f06292' },
};
const stratColor = (k: string | null) => (k && STRAT_META[k] ? STRAT_META[k].color : theme.muted2);

const money = (v?: number | null) =>
  v == null || !isFinite(v) ? '—' : '₹' + v.toLocaleString('en-IN', { maximumFractionDigits: 2 });
const signPct = (v?: number | null, d = 1) =>
  v == null || !isFinite(v) ? '—' : (v >= 0 ? '+' : '') + v.toFixed(d) + '%';
const scoreColor = (s: number) => (s >= 75 ? theme.green : s >= 55 ? GOLD : theme.muted2);
const trendColor = (t: string) => (t === 'up' ? theme.green : t === 'down' ? theme.red : theme.muted2);
const zoneColor = (z: string) => (z === 'discount' ? theme.green : z === 'premium' ? theme.red : theme.muted2);

function timeAgo(ms: number | null): string {
  if (!ms) return '';
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function ModelTag({ s, small }: { s: StrategyHit; small?: boolean }) {
  const c = stratColor(s.key);
  return (
    <View style={[styles.tag, { borderColor: c }, small && styles.tagSm]}>
      <Text style={[styles.tagTxt, { color: c }, small && styles.tagTxtSm]}>{s.label}</Text>
    </View>
  );
}

function SmcRow({ r, onOpen }: { r: SmcRec; onOpen: () => void }) {
  const extra = r.strategies.length - 1;
  return (
    <TouchableOpacity style={styles.row} onPress={onOpen} activeOpacity={0.7}>
      <View style={styles.rowLeft}>
        <View style={styles.rowTop}>
          <Text style={styles.sym}>{r.symbol}</Text>
          {r.strategies[0] ? <ModelTag s={r.strategies[0]} small /> : null}
          {extra > 0 ? <Text style={styles.more}>+{extra}</Text> : null}
          <View style={[styles.zoneBadge, { borderColor: zoneColor(r.zone) }]}>
            <Text style={[styles.zoneTxt, { color: zoneColor(r.zone) }]}>{r.zone}</Text>
          </View>
        </View>
        {r.name ? <Text style={styles.name} numberOfLines={1}>{r.name}</Text> : null}
        <Text style={styles.setupLine} numberOfLines={1}>
          {r.conf_count} confl · entry {money(r.entry)} · SL {money(r.stop)} · TP1 {money(r.target)} ({signPct(r.upside_pct)})
          {r.rr != null ? ` · ${r.rr.toFixed(1)}:1` : ''}
        </Text>
      </View>
      <View style={styles.rowRight}>
        <View style={styles.scoreBox}>
          <Text style={[styles.score, { color: scoreColor(r.score) }]}>{r.score}</Text>
          <Text style={styles.scoreLbl}>confluence</Text>
          <Text style={styles.upsideVal}>▲ {signPct(r.upside_pct)}</Text>
        </View>
        <Text style={styles.chev}>›</Text>
      </View>
    </TouchableOpacity>
  );
}

function SmcDetail({
  r, watched, alerted, papered, onClose, onChart, onAnalyse, onPattern, onPaper, onWatch, onAlert,
}: {
  r: SmcRec;
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
    <Sheet onClose={onClose} maxHeight="94%">
        <ScrollView bounces={false}>
          <View style={styles.sheetHead}>
            <View style={{ flex: 1 }}>
              <View style={styles.rowTop}>
                <Text style={styles.sheetSym}>{r.symbol}</Text>
                <View style={[styles.actionPill, { backgroundColor: r.action === 'LONG' ? theme.green : GOLD }]}>
                  <Text style={styles.actionTxt}>{r.action}</Text>
                </View>
                <View style={[styles.zoneBadge, { borderColor: zoneColor(r.zone) }]}>
                  <Text style={[styles.zoneTxt, { color: zoneColor(r.zone) }]}>{r.zone}</Text>
                </View>
              </View>
              {r.name ? <Text style={styles.name}>{r.name}</Text> : null}
              <Text style={[styles.primaryTag, { color: stratColor(r.primary_key) }]}>{r.primary}</Text>
              <RiskBadge input={{ rr: r.rr, stop_pct: r.stop_pct, max_dd: r.max_dd, score: r.score }} style={{ marginTop: 6 }} />
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={[styles.score, { color: scoreColor(r.score), fontSize: 28 }]}>{r.score}</Text>
              <Text style={styles.scoreLbl}>confluence</Text>
            </View>
          </View>

          {/* Which SMC models flagged the name, and why. */}
          <Text style={styles.secTitle}>MODELS MATCHED</Text>
          <View style={styles.stratList}>
            {r.strategies.map((s) => {
              const c = stratColor(s.key);
              return (
                <View key={s.key} style={styles.stratRow}>
                  <View style={styles.stratHead}>
                    <ModelTag s={s} />
                    <Text style={[styles.stratScore, { color: c }]}>{s.score}</Text>
                  </View>
                  <Text style={styles.stratNote}>{s.note}</Text>
                  <View style={styles.stratTrack}>
                    <View style={[styles.stratFill, { width: `${Math.max(4, Math.min(100, s.score))}%`, backgroundColor: c }]} />
                  </View>
                </View>
              );
            })}
          </View>

          {r.confluences?.length ? (
            <>
              <Text style={styles.secTitle}>CONFLUENCES ({r.conf_count})</Text>
              <View style={styles.conflWrap}>
                {r.confluences.map((c, i) => (
                  <View key={i} style={styles.conflChip}><Text style={styles.conflTxt}>✓ {c}</Text></View>
                ))}
              </View>
            </>
          ) : null}

          <View style={styles.chips}>
            <View style={styles.metaChip}><Text style={styles.metaLbl}>TREND</Text><Text style={[styles.metaVal, { color: trendColor(r.trend) }]}>{r.trend}</Text></View>
            <View style={styles.metaChip}><Text style={styles.metaLbl}>ZONE</Text><Text style={[styles.metaVal, { color: zoneColor(r.zone) }]}>{r.zone}</Text></View>
            <View style={styles.metaChip}><Text style={styles.metaLbl}>RSI</Text><Text style={styles.metaVal}>{r.rsi}</Text></View>
          </View>

          <View style={styles.grid}>
            <Cell label="ENTRY" value={money(r.entry)} />
            <Cell label="STOP (wick)" value={money(r.stop)} sub={signPct(r.stop_pct)} color={theme.red} />
            <Cell label="TP1 weak-high" value={money(r.target)} sub={signPct(r.upside_pct)} color={theme.green} />
            <Cell label="TP2 external" value={money(r.target2)} color={theme.green} />
            <Cell label="R : R" value={r.rr != null ? `${r.rr.toFixed(1)}:1` : '—'} sub="reward ÷ risk" />
            <Cell label="MAX DD" value={signPct(r.max_dd)} color={theme.red} sub="worst dip risk" />
            <Cell label="RANGE LOW" value={money(r.support)} sub="range base" />
            <Cell label="WEAK HIGH" value={money(r.resistance)} sub="liquidity draw" />
          </View>

          {r.eta ? (
            <View style={styles.etaBar}>
              <Text style={styles.etaLbl}>⏱ Est. time to TP1</Text>
              <Text style={styles.etaVal}>{r.eta}</Text>
            </View>
          ) : null}

          {r.reasons?.length ? (
            <View style={styles.why}>
              {r.reasons.map((s, i) => <Text key={i} style={styles.whyTxt}>▸ {s}</Text>)}
            </View>
          ) : null}

          {/* Plain-English glossary so the ICT/SMC jargon in the reasons is
              readable without prior knowledge. */}
          <Text style={styles.secTitle}>WHAT THIS MEANS</Text>
          <View style={styles.glossary}>
            {[
              ['Weak high', 'A recent high with unprotected sell-stops just above it — price tends to run up and grab that liquidity. It’s the TP1 target (not a typo for “week”).'],
              ['Liquidity sweep', 'Price briefly pushed past a prior low/high to trip stop orders, then snapped back — the “stop hunt” that kicks off the move.'],
              ['Discount / OTE', 'Entry sits in the lower part of the dealing range (optimal-trade-entry) — buying cheap within the structure rather than chasing.'],
              ['Fair-value gap (FVG)', 'An imbalance left by a fast candle that price tends to return to and “fill” before continuing.'],
              ['Breaker', 'A broken level that flips role — old resistance now acting as support on the retest.'],
              ['Stop (wick)', 'Protective stop placed beyond the sweep wick / order block, so only a true invalidation takes you out.'],
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

          {r.not_automated?.length ? (
            <View style={styles.caveat}>
              <Text style={styles.caveatHead}>Not automated here (needs intraday / session data):</Text>
              {r.not_automated.map((n, i) => <Text key={i} style={styles.caveatTxt}>· {n}</Text>)}
            </View>
          ) : null}

          <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.75}>
            <Text style={styles.closeTxt}>Close</Text>
          </TouchableOpacity>
          <Text style={styles.disc}>
            ICT / Smart-Money-Concepts models adapted to daily NSE structure (liquidity sweeps, AMD, FVG,
            breakers, HVI). Stops sit beyond the sweep wick / HVI; TP1 = nearest weak high, TP2 = external
            liquidity. This is a discretionary framework with no published, verified edge — backtest each
            model before risking capital. Educational only, not investment advice.
          </Text>
        </ScrollView>
    </Sheet>
  );
}

export default function SmcScreen() {
  const [recs, setRecs] = useState<SmcRec[]>(() => getCache()?.recs || []);
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
  const [sortKey, setSortKey] = useState<'score' | 'upside' | 'rr' | 'time'>('score');
  const [filter, setFilter] = useState<string>('all');
  const [open, setOpen] = useState<SmcRec | null>(null);
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
      const analysed: SmcRec[] = [];
      const live = new Map((getCache()?.recs || []).map((r) => [r.symbol.toUpperCase(), r] as const));
      let done = 0;
      const total = syms.length;
      setProgress({ done: 0, total });
      const run = async (sym: string) => {
        try {
          const rec = await api.smc(sym, names[sym.toUpperCase()]?.name);
          if (token.cancelled) return;
          if (rec && !rec.error) {
            analysed.push(rec);
            if (rec.qualifies) live.set(rec.symbol.toUpperCase(), rec);
            else live.delete(rec.symbol.toUpperCase());
            setRecs([...live.values()].sort((a, b) => b.score - a.score));
          }
        } catch {
          /* skip a failed candidate */
        } finally {
          if (!token.cancelled) {
            done++;
            setProgress({ done, total });
            setStatus(`Scanning ${done}/${total} · ${live.size} SMC setup${live.size === 1 ? '' : 's'}`);
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
      await mergeSmc(analysed, d, now);
      const list = getCache()?.recs || [];
      setRecs(list);
      setAsof(now);
      setStatus(`${list.length} SMC setup${list.length === 1 ? '' : 's'} · scanned ${total} mid/large caps`);
    } catch (e) {
      if (!token.cancelled) setError(e instanceof Error ? e.message : 'Failed to build SMC list');
    } finally {
      if (!token.cancelled) {
        scanningRef.current = false;
        setScanning(false);
      }
    }
  }, []);

  useEffect(() => {
    let alive = true;
    hydrateSmc().then(() => {
      if (!alive) return;
      setReady(true);
      const c = getCache();
      setRecs(c?.recs || []);
      setDepthState(getDepth());
      setAsof(c?.asof ?? null);
      if (!hasCache()) runScan();
    });
    const unsub = subscribeSmc(() => {
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

  const availModels = useMemo(() => {
    const seen = new Map<string, string>();
    recs.forEach((r) => r.strategies.forEach((s) => seen.set(s.key, s.label)));
    return [...seen.entries()].map(([key, label]) => ({ key, label }));
  }, [recs]);

  const sorted = useMemo(() => {
    let xs = [...recs];
    if (filter !== 'all') xs = xs.filter((r) => r.strategies.some((s) => s.key === filter));
    if (sortKey === 'upside') xs.sort((a, b) => (b.upside_pct ?? -999) - (a.upside_pct ?? -999));
    else if (sortKey === 'rr') xs.sort((a, b) => (b.rr ?? -1) - (a.rr ?? -1));
    else if (sortKey === 'time') xs.sort((a, b) => (a.eta_days ?? 1e9) - (b.eta_days ?? 1e9));
    else xs.sort((a, b) => b.score - a.score);
    return xs;
  }, [recs, sortKey, filter]);

  const SORTS: { key: typeof sortKey; label: string }[] = [
    { key: 'score', label: 'Confluence' },
    { key: 'upside', label: 'Upside' },
    { key: 'rr', label: 'R:R' },
    { key: 'time', label: 'Time to target' },
  ];

  const isWatched = (s: string) => watch.includes(normSymbol(s));
  const onWatch = async (r: SmcRec) => {
    setWatch(await addSymbol(watch, r.symbol));
    toast(`${r.symbol} added to watchlist`);
  };
  const onAlert = async (r: SmcRec) => {
    setAlerts(await addLocalAlert(alerts, r.symbol, r.target, r.price, r.name || undefined));
    toast(`Alert set for ${r.symbol} → ${money(r.target)} (${signPct(r.upside_pct)} upside)`);
  };
  const onChart = (r: SmcRec) => {
    setOpen(null);
    setDetail({ sym: r.symbol, price: r.price } as Row);
  };
  const onAnalyse = (r: SmcRec) => {
    setOpen(null);
    navigate('analysis', { sub: 'mb', symbol: r.symbol });
  };
  const onPattern = (r: SmcRec) => {
    setOpen(null);
    navigate('analysis', { sub: 'patterns', symbol: r.symbol });
  };
  const onPaper = async (r: SmcRec) => {
    setPaper(
      await addPaperTrade({
        symbol: r.symbol,
        name: r.name || undefined,
        side: 'long',
        source: 'HFT/ICT/SMC',
        entry: r.entry,
        stop: r.stop,
        target: r.target,
      }),
    );
    toast(`Paper trade logged for ${r.symbol} → see Paper tab`);
  };

  return (
    <View style={styles.container}>
      {/* Compact control row: depth / model / sort as dropdowns, Update beside them. */}
      <View style={styles.controlBar}>
        <Dropdown
          label="Depth"
          value={depth}
          options={DEPTH_OPTIONS.map((n) => ({ key: n, label: String(n) }))}
          onChange={onDepth}
        />
        {!scanning && availModels.length ? (
          <Dropdown
            label="Model"
            value={filter as string}
            options={[{ key: 'all', label: 'All' }, ...availModels.map((s) => ({ key: s.key as string, label: s.label }))]}
            onChange={(k) => setFilter(k as typeof filter)}
          />
        ) : null}
        {!scanning && recs.length > 1 ? (
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
        {!scanning && error ? <EmptyState icon="⚠" title="Couldn't build SMC list" hint={error} /> : null}
        {ready && !scanning && !error && !recs.length ? (
          <EmptyState
            icon="◈"
            title="No SMC setups yet"
            hint="Hit ⟳ Update List to screen mid/large caps for liquidity sweeps, AMD, FVG, breakers and HVI in discount. Note: NY-Open, 1-min ping-pong and 90-min cycle models need intraday data and aren't screened here."
          />
        ) : null}

        <View style={isDesktop ? styles.grid2 : undefined}>
          {sorted.map((r, i) => (
            <View key={r.symbol} style={isDesktop ? styles.gridCell : undefined}>
              <FadeSlideIn index={i}>
                <Card style={{ padding: 0 }}>
                  <SmcRow r={r} onOpen={() => setOpen(r)} />
                </Card>
              </FadeSlideIn>
            </View>
          ))}
        </View>
      </ScrollView>

      {open ? (
        <SmcDetail
          r={open}
          watched={isWatched(open.symbol)}
          alerted={hasLocalAlert(alerts, open.symbol)}
          onClose={() => setOpen(null)}
          papered={hasOpenPaper(paper, open.symbol)}
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
  actionRow: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: theme.sp.lg, paddingTop: theme.sp.sm, paddingBottom: theme.sp.sm },
  controlBar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.sp.sm, paddingHorizontal: theme.sp.lg, paddingTop: theme.sp.sm, paddingBottom: theme.sp.sm },
  asofInline: { color: theme.muted, fontSize: theme.fs.xs + 1, fontFamily: theme.mono, marginLeft: 'auto' },
  note: { color: theme.muted, fontSize: theme.fs.sm, paddingHorizontal: theme.sp.lg, paddingBottom: theme.sp.sm },
  updBtn: { backgroundColor: theme.accent, borderColor: theme.accent, borderWidth: 1, borderRadius: theme.radius.sm + 2, paddingHorizontal: theme.sp.md, paddingVertical: 6 },
  updTxt: { color: theme.onAccent, fontSize: theme.fs.sm, fontWeight: '700' },
  depthRow: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.sm, paddingHorizontal: theme.sp.lg, paddingBottom: theme.sp.sm, flexWrap: 'wrap' },
  depthLbl: { color: theme.muted, fontSize: theme.fs.sm, marginRight: 2 },
  depthChip: { minWidth: 40, alignItems: 'center', backgroundColor: theme.surface2, borderColor: theme.border2, borderWidth: 1, borderRadius: 999, paddingHorizontal: theme.sp.md, paddingVertical: 5 },
  depthChipOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  depthTxt: { color: theme.muted2, fontSize: theme.fs.sm, fontWeight: '700' },
  depthTxtOn: { color: theme.onAccent },
  asof: { color: theme.muted, fontSize: theme.fs.xs + 1, marginLeft: 'auto' },
  sortRow: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.sm, paddingHorizontal: theme.sp.lg, paddingBottom: theme.sp.sm, flexWrap: 'wrap' },
  // Compact single-row filters — label pinned, chips scroll horizontally so
  // Model + Sort take one row each (not three) and the scrips get the space.
  filterBar: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.sm, paddingLeft: theme.sp.lg, paddingBottom: theme.sp.xs },
  filterLbl: { color: theme.muted, fontSize: theme.fs.xs + 1, fontWeight: '700', letterSpacing: 0.5, width: 44 },
  filterScroll: { flexGrow: 0, flexShrink: 1 },
  filterScrollRow: { flexDirection: 'row', gap: theme.sp.sm, paddingRight: theme.sp.lg, alignItems: 'center' },
  sortChip: { backgroundColor: theme.surface2, borderColor: theme.border2, borderWidth: 1, borderRadius: 999, paddingHorizontal: theme.sp.md, paddingVertical: 4 },
  sortChipOn: { backgroundColor: theme.surface3, borderColor: theme.accent },
  filterChip: { backgroundColor: theme.surface2, borderColor: theme.border2, borderWidth: 1, borderRadius: 999, paddingHorizontal: theme.sp.md, paddingVertical: 4 },
  filterChipOn: { backgroundColor: theme.surface3, borderColor: theme.accent },
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
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.sm, flexWrap: 'wrap' },
  sym: { color: theme.text, fontFamily: theme.mono, fontWeight: '800', fontSize: theme.fs.md + 1 },
  more: { color: theme.muted, fontSize: theme.fs.xs + 1, fontWeight: '700' },
  tag: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1 },
  tagSm: { paddingHorizontal: 5 },
  tagTxt: { fontSize: 10, fontWeight: '800', letterSpacing: 0.3, fontFamily: theme.mono },
  tagTxtSm: { fontSize: 9 },
  zoneBadge: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
  zoneTxt: { fontSize: 9, fontWeight: '800', letterSpacing: 0.3, fontFamily: theme.mono, textTransform: 'uppercase' },
  name: { color: theme.muted2, fontSize: theme.fs.sm },
  setupLine: { color: theme.muted, fontSize: theme.fs.xs + 1, fontFamily: theme.mono },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.sm },
  scoreBox: { alignItems: 'flex-end', minWidth: 84 },
  score: { fontFamily: theme.mono, fontWeight: '800', fontSize: 22, lineHeight: 24 },
  scoreLbl: { color: theme.muted, fontSize: theme.fs.xs, marginTop: -1 },
  upsideVal: { color: theme.green, fontFamily: theme.mono, fontWeight: '700', fontSize: theme.fs.sm, marginTop: 3 },
  chev: { color: theme.muted2, fontSize: 22 },

  modalWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'flex-end' },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000a' },
  sheet: { maxHeight: '94%', backgroundColor: theme.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16, borderColor: theme.border2, borderWidth: 1, padding: theme.sp.lg, alignSelf: 'center', width: '100%', maxWidth: 620 },
  sheetHead: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.sp.md, marginBottom: theme.sp.md },
  sheetSym: { color: theme.text, fontFamily: theme.mono, fontWeight: '800', fontSize: theme.fs.xl },
  actionPill: { borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1 },
  actionTxt: { color: theme.onAccent, fontSize: 9, fontWeight: '800', letterSpacing: 0.5, fontFamily: theme.mono },
  primaryTag: { fontSize: theme.fs.sm, fontWeight: '700', marginTop: 3 },
  secTitle: { color: theme.muted, fontSize: theme.fs.xs + 1, fontWeight: '800', letterSpacing: 1, marginBottom: theme.sp.sm, marginTop: theme.sp.xs },
  stratList: { gap: theme.sp.sm, marginBottom: theme.sp.md },
  stratRow: { backgroundColor: theme.surface2, borderRadius: theme.radius.sm, padding: theme.sp.md, gap: 5 },
  stratHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stratScore: { fontFamily: theme.mono, fontWeight: '800', fontSize: theme.fs.md },
  stratNote: { color: theme.muted2, fontSize: theme.fs.sm, lineHeight: 17 },
  stratTrack: { height: 5, borderRadius: 4, backgroundColor: theme.bg, overflow: 'hidden' },
  stratFill: { height: 5, borderRadius: 4 },
  conflWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: theme.sp.md },
  conflChip: { backgroundColor: theme.surface2, borderColor: theme.border2, borderWidth: 1, borderRadius: 999, paddingHorizontal: theme.sp.sm + 2, paddingVertical: 3 },
  conflTxt: { color: theme.muted2, fontSize: theme.fs.xs + 1 },
  chips: { flexDirection: 'row', gap: theme.sp.sm, marginBottom: theme.sp.md },
  metaChip: { flex: 1, backgroundColor: theme.surface2, borderRadius: theme.radius.sm, paddingVertical: theme.sp.sm, alignItems: 'center' },
  metaLbl: { color: theme.muted, fontSize: theme.fs.xs, letterSpacing: 0.5 },
  metaVal: { color: theme.text, fontFamily: theme.mono, fontWeight: '700', fontSize: theme.fs.md, textTransform: 'capitalize' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: '25%', alignItems: 'center', gap: 1, paddingVertical: theme.sp.sm, backgroundColor: theme.surface2, borderColor: theme.bg, borderWidth: 1 },
  cellLbl: { color: theme.muted, fontSize: theme.fs.xs, letterSpacing: 0.3, textAlign: 'center' },
  cellVal: { color: theme.text, fontFamily: theme.mono, fontWeight: '700', fontSize: theme.fs.md, paddingHorizontal: 2 },
  cellSub: { fontFamily: theme.mono, fontSize: theme.fs.xs },
  etaBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: theme.sp.md, backgroundColor: theme.surface2, borderRadius: theme.radius.sm, paddingHorizontal: theme.sp.md, paddingVertical: theme.sp.sm },
  etaLbl: { color: theme.muted2, fontSize: theme.fs.sm },
  etaVal: { color: theme.text, fontFamily: theme.mono, fontWeight: '700', fontSize: theme.fs.md },
  why: { gap: 3, marginTop: theme.sp.md },
  whyTxt: { color: theme.muted2, fontSize: theme.fs.sm, lineHeight: 18 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp.sm, marginTop: theme.sp.md },
  glossary: { gap: theme.sp.sm, marginBottom: theme.sp.sm },
  gloRow: { gap: 1 },
  gloTerm: { color: theme.brand, fontSize: theme.fs.sm + 1, fontWeight: '800' },
  gloDef: { color: theme.muted2, fontSize: theme.fs.sm, lineHeight: 18 },
  aBtn: { backgroundColor: theme.surface2, borderColor: theme.border2, borderWidth: 1, borderRadius: theme.radius.sm + 2, paddingHorizontal: theme.sp.md, paddingVertical: theme.sp.sm },
  aTxt: { color: theme.text, fontSize: theme.fs.sm, fontWeight: '700' },
  caveat: { marginTop: theme.sp.md, backgroundColor: theme.surface2, borderRadius: theme.radius.sm, padding: theme.sp.md, gap: 2 },
  caveatHead: { color: theme.muted2, fontSize: theme.fs.xs + 1, fontWeight: '700', marginBottom: 2 },
  caveatTxt: { color: theme.muted, fontSize: theme.fs.xs + 1, lineHeight: 15 },
  closeBtn: { marginTop: theme.sp.md, alignItems: 'center', paddingVertical: theme.sp.sm, borderRadius: theme.radius.sm + 2, borderColor: theme.border2, borderWidth: 1 },
  closeTxt: { color: theme.muted2, fontSize: theme.fs.md, fontWeight: '700' },
  disc: { color: theme.muted, fontSize: theme.fs.xs + 1, lineHeight: 15, marginTop: theme.sp.md },
  toast: { position: 'absolute', bottom: 24, alignSelf: 'center', backgroundColor: theme.surface3, borderColor: theme.border2, borderWidth: 1, borderRadius: 999, paddingHorizontal: theme.sp.lg, paddingVertical: theme.sp.sm },
  toastTxt: { color: theme.text, fontSize: theme.fs.sm, fontWeight: '600' },
});
