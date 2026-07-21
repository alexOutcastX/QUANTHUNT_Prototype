import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MomentumHit, api } from '../api';
import StockDetail from '../components/StockDetail';
import { useResponsive } from '../responsive';
import { Row } from '../screener';
import { addSymbol, loadWatchlist, normSymbol, removeSymbol } from '../watchlist';
import { LocalAlert, addLocalAlert, hasLocalAlert, loadLocalAlerts } from '../localalerts';
import { capBand } from '../marketcap';
import { Btn, Dropdown, EmptyState, InfoButton, Loading, Sheet } from '../ui';
import { MOMENTUM_INFO } from '../tabInfo';
import StrategyScores from '../components/StrategyScores';
import TimeframePanel from '../components/TimeframePanel';
import SymbolInput from '../components/SymbolInput';
import { navigate, takeSector, takeSymbol } from '../navIntent';
import { mergeSectors } from '../sectors';
import { theme } from '../theme';

// Per-symbol enrichment (sector + market cap) fetched separately from the
// radar — the momentum scan itself carries neither field.
type Enrich = { sector?: string | null; mcap?: number | null };

const GOLD = '#f5c518';

type SetupKind = MomentumHit['setup'];
const SETUP_LABEL: Record<SetupKind, string> = {
  breakout: 'BREAKOUT WATCH',
  fired: 'BREAKOUT FIRED',
  pullback: 'PULLBACK REVERSAL',
};
const SETUP_FILTERS: { key: 'all' | SetupKind; label: string }[] = [
  { key: 'all', label: 'All setups' },
  { key: 'breakout', label: '⚡ Breakout watch' },
  { key: 'fired', label: '🔥 Breakout fired' },
  { key: 'pullback', label: '↩ Pullback reversal' },
];

const setupColor = (s: SetupKind) =>
  s === 'fired' ? theme.green : s === 'breakout' ? GOLD : theme.accent;

// Desktop table columns (fixed widths → header + rows share one width so they
// stay aligned inside the horizontal scroll). `text` = left aligned.
// 'sector' / 'cap' aren't fields on MomentumHit — they come from the enrichment
// map — but they still get their own sortable columns.
type ColKey = keyof MomentumHit | 'sector' | 'cap';
type ColDef = { key: ColKey; label: string; w: number; text?: boolean };
const COLS: ColDef[] = [
  { key: 'symbol', label: 'SYMBOL', w: 92, text: true },
  { key: 'name', label: 'NAME', w: 190, text: true },
  { key: 'exchange', label: 'EXCH', w: 46, text: true },
  { key: 'sector', label: 'SECTOR', w: 140, text: true },
  { key: 'cap', label: 'CAP', w: 66, text: true },
  { key: 'setup', label: 'SETUP', w: 150, text: true },
  { key: 'score', label: 'SCORE', w: 56 },
  { key: 'probability', label: 'PROB', w: 54 },
  { key: 'price', label: 'LTP', w: 94 },
  { key: 'chg', label: '% CHG', w: 70 },
  { key: 'rsi', label: 'RSI', w: 46 },
  { key: 'relvol', label: 'RVOL', w: 58 },
  { key: 'd200', label: 'VS 200DMA', w: 82 },
  { key: 'pct_from_high', label: '52W HI', w: 68 },
  { key: 'upside_pct', label: 'UPSIDE', w: 72 },
];
const ACTIONS_W = 142;
const TABLE_W = COLS.reduce((a, c) => a + c.w, 0) + ACTIONS_W;

// Mobile sort options (headers are gone on the card layout).
const MOBILE_SORTS: { key: ColKey; label: string }[] = [
  { key: 'score', label: 'Score' },
  { key: 'probability', label: 'Prob' },
  { key: 'chg', label: '% Chg' },
  { key: 'relvol', label: 'RVol' },
  { key: 'rsi', label: 'RSI' },
  { key: 'price', label: 'LTP' },
  { key: 'upside_pct', label: 'Upside' },
  { key: 'cap', label: 'Cap' },
  { key: 'sector', label: 'Sector' },
];

const pct = (v: number | null | undefined, d = 1) =>
  v == null || !isFinite(v) ? '—' : (v >= 0 ? '+' : '') + v.toFixed(d) + '%';
const fmtIN = (v: number | null | undefined) =>
  v == null || !isFinite(v)
    ? '—'
    : v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtAsof = (epoch: number) =>
  new Date(epoch * 1000).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
// Compact market cap (input in ₹ crore): 123456 → "₹1.23L Cr", 12345 → "₹12.3K Cr".
const fmtCap = (cr?: number | null) => {
  if (cr == null || !isFinite(cr)) return null;
  if (cr >= 100000) return '₹' + (cr / 100000).toFixed(2) + 'L Cr';
  if (cr >= 1000) return '₹' + (cr / 1000).toFixed(1) + 'K Cr';
  return '₹' + Math.round(cr).toLocaleString('en-IN') + ' Cr';
};

// Market-cap band chip (LARGE / MID / SMALL / MICRO) — shared by table + cards.
function capTag(mcapCr?: number | null) {
  const b = capBand(mcapCr);
  if (!b) return <Text style={styles.capDash}>—</Text>;
  return (
    <View style={[styles.capChip, { borderColor: b.color }]}>
      <Text style={[styles.capChipTxt, { color: b.color }]}>{b.short}</Text>
    </View>
  );
}

// The expandable technical read — shared by the desktop table and mobile cards.
function ReadBox({ h, c, width }: { h: MomentumHit; c: string; width?: number }) {
  return (
    <View style={[styles.readBox, width ? { width } : { width: '100%' }]}>
      <View style={styles.probTrack}>
        <View style={[styles.probFill, { width: `${h.probability}%`, backgroundColor: c }]} />
      </View>
      <Text style={styles.readMeta}>
        Technical score {h.score}/100 · indicative follow-through probability {h.probability}%
      </Text>
      {h.signals.map((s) => (
        <Text key={s} style={styles.sigTxt}>▲ <Text style={styles.sigBody}>{s}</Text></Text>
      ))}
      {h.cautions.map((s) => (
        <Text key={s} style={styles.cauTxt}>▼ <Text style={styles.sigBody}>{s}</Text></Text>
      ))}
    </View>
  );
}

// Full tap-to-open detail card — mirrors the depth of the long/short/institutional
// popups: setup verdict, live stats, technical read, glossary, strategy scorecard
// and the same analyse/export action row.
function MomDetail({
  h,
  enr,
  watched,
  alerted,
  onClose,
  onChart,
  onAlert,
  onWatch,
  onAnalyse,
  onPattern,
  onDossier,
}: {
  h: MomentumHit;
  enr?: Enrich;
  watched: boolean;
  alerted: boolean;
  onClose: () => void;
  onChart: () => void;
  onAlert: () => void;
  onWatch: () => void;
  onAnalyse: () => void;
  onPattern: () => void;
  onDossier: () => void;
}) {
  const c = setupColor(h.setup);
  const stat = (label: string, value: React.ReactNode) => (
    <View style={styles.dCell}>
      <Text style={styles.dCellLbl}>{label}</Text>
      <Text style={styles.dCellVal}>{value}</Text>
    </View>
  );
  return (
    <Sheet onClose={onClose} maxHeight="97%">
      {/* Sticky header (index 0): the company name + close button stay pinned
          while the body scrolls, so they're always visible. */}
      <ScrollView showsVerticalScrollIndicator={false} stickyHeaderIndices={[0]}>
        <View style={styles.dHead}>
          <View style={{ flex: 1 }}>
            <View style={styles.cardSymRow}>
              <Text style={styles.dSym}>{h.symbol}</Text>
              <Text style={styles.cardExch}>{h.exchange}</Text>
              {capTag(enr?.mcap)}
            </View>
            <Text style={styles.dName} numberOfLines={2}>
              {h.name || '—'}
              {enr?.sector ? <Text style={styles.cardSector}> · {enr.sector}</Text> : null}
            </Text>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={styles.dX}>✕</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.dVerdict}>
          <Text style={[styles.setupBadge, { color: c, borderColor: c, fontSize: theme.fs.sm }]}>{SETUP_LABEL[h.setup]}</Text>
          <View style={styles.dScoreBox}>
            <Text style={[styles.dScore, { color: c }]}>{h.score}</Text>
            <Text style={styles.dScoreSub}>/100 · {h.probability}% prob</Text>
          </View>
        </View>

        <View style={styles.dGrid}>
          {stat('LTP', `₹${fmtIN(h.price)}`)}
          {stat('% CHG', <Text style={{ color: (h.chg ?? 0) >= 0 ? theme.green : theme.red }}>{pct(h.chg, 2)}</Text>)}
          {stat('RSI', h.rsi != null ? h.rsi.toFixed(0) : '—')}
          {stat('REL VOL', h.relvol != null ? h.relvol.toFixed(2) + 'x' : '—')}
          {stat('VS 200DMA', <Text style={{ color: (h.d200 ?? 0) >= 0 ? theme.green : theme.red }}>{pct(h.d200)}</Text>)}
          {stat('52W HIGH', <Text style={{ color: theme.red }}>{pct(h.pct_from_high)}</Text>)}
          {stat('UPSIDE', <Text style={{ color: (h.upside_pct ?? 0) > 0 ? theme.green : theme.muted }}>{h.upside_pct != null ? '+' + h.upside_pct.toFixed(1) + '%' : '—'}</Text>)}
          {h.target != null ? stat('TARGET', `₹${fmtIN(h.target)}`) : null}
        </View>

        <Text style={styles.dSecTitle}>TECHNICAL READ</Text>
        <ReadBox h={h} c={c} />

        <Text style={styles.dSecTitle}>MULTI-TIMEFRAME · S/R · FIBONACCI</Text>
        <TimeframePanel symbol={h.symbol} />

        <StrategyScores symbol={h.symbol} />

        <View style={styles.dActions}>
          <TouchableOpacity style={styles.dActBtn} onPress={onChart} activeOpacity={0.75}>
            <Text style={styles.dActTxt}>▤ Chart</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.dActBtn} onPress={onAnalyse} activeOpacity={0.75}>
            <Text style={[styles.dActTxt, { color: theme.accent }]}>🚀 Multibagger</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.dActBtn} onPress={onPattern} activeOpacity={0.75}>
            <Text style={styles.dActTxt}>📈 Pattern</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.dActBtn} onPress={onDossier} activeOpacity={0.75}>
            <Text style={styles.dActTxt}>🏛 Dossier</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.dActBtn} onPress={onWatch} activeOpacity={0.75}>
            <Text style={[styles.dActTxt, watched && { color: theme.green }]}>{watched ? '★ Watching' : '☆ Watchlist'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.dActBtn} onPress={onAlert} activeOpacity={0.75}>
            <Text style={[styles.dActTxt, alerted && { color: GOLD }]}>{alerted ? '🔔 Alerted' : '🔔 Alert'}</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.dClose} onPress={onClose} activeOpacity={0.75}>
          <Text style={styles.dCloseTxt}>Close</Text>
        </TouchableOpacity>
        <Text style={styles.dDisc}>
          Momentum setup on a live NSE/BSE scan. Probability is an indicative base-rate heuristic, not a forecast —
          for information only, not investment advice. Always confirm and manage risk.
        </Text>
      </ScrollView>
    </Sheet>
  );
}

// Analyser sub-tab: type/search any symbol and read its momentum across every
// timeframe (5-min → weekly) — trade rating, S/R and Fibonacci levels per
// timeframe + an overall score. Same predictive search as the other pages.
function MomAnalyser({
  initialSymbol,
  watch,
  onToggleWatch,
  onChartSym,
}: {
  initialSymbol: string;
  watch: string[];
  onToggleWatch: (sym: string) => void;
  onChartSym: (sym: string) => void;
}) {
  const [sym, setSym] = useState('');
  const [active, setActive] = useState(initialSymbol);
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => {
    if (initialSymbol) setActive(initialSymbol);
  }, [initialSymbol]);
  const run = (s?: string) => {
    const q = (s ?? sym).trim().toUpperCase().replace(/^[A-Z]+:/, '');
    if (!q) return;
    setActive(q);
    setSym(q);
    setRecent((prev) => [q, ...prev.filter((x) => x !== q)].slice(0, 8));
  };
  const isWatched = (s: string) => watch.includes(normSymbol(s));
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: theme.sp.xl }}>
      <View style={styles.anaInputRow}>
        <SymbolInput
          value={sym}
          onChangeText={setSym}
          onSelect={(s) => run(s)}
          onSubmit={() => run()}
          placeholder="Any NSE/BSE symbol — momentum on every timeframe…"
          inputStyle={styles.anaInput}
          containerStyle={{ flex: 1 }}
        />
        <Btn label="⚡ Analyse" onPress={() => run()} disabled={!sym.trim()} />
      </View>
      {recent.length ? (
        <View style={styles.recentRow}>
          <Text style={styles.recentLabel}>RECENT</Text>
          {recent.map((s) => (
            <TouchableOpacity key={s} style={styles.recentChip} onPress={() => run(s)} activeOpacity={0.75}>
              <Text style={styles.recentTxt}>{s}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
      {!active ? (
        <EmptyState
          icon="⚡"
          title="Analyse any stock's momentum"
          hint="Search a symbol to see its trade rating, support/resistance and Fibonacci levels on every timeframe from 5-minute to weekly, plus an overall score."
        />
      ) : (
        <View style={styles.anaBody}>
          <View style={styles.anaHead}>
            <Text style={styles.anaSym}>{active}</Text>
            <View style={styles.anaHeadActions}>
              <TouchableOpacity style={styles.aBtn} onPress={() => onChartSym(active)} activeOpacity={0.75}>
                <Text style={styles.aTxt}>▤ Chart</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.aBtn} onPress={() => onToggleWatch(active)} activeOpacity={0.75}>
                <Text style={[styles.aTxt, isWatched(active) && { color: theme.green }]}>{isWatched(active) ? '★' : '☆'}</Text>
              </TouchableOpacity>
            </View>
          </View>
          <TimeframePanel symbol={active} />
          <StrategyScores symbol={active} />
          <View style={styles.dActions}>
            <TouchableOpacity style={styles.dActBtn} onPress={() => navigate('analysis', { sub: 'mb', symbol: active })} activeOpacity={0.75}>
              <Text style={[styles.dActTxt, { color: theme.accent }]}>🚀 Multibagger</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.dActBtn} onPress={() => navigate('analysis', { sub: 'patterns', symbol: active })} activeOpacity={0.75}>
              <Text style={styles.dActTxt}>📈 Pattern</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.dActBtn} onPress={() => navigate('analysis', { sub: 'inst', symbol: active })} activeOpacity={0.75}>
              <Text style={styles.dActTxt}>🏛 Dossier</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </ScrollView>
  );
}

// Session caches — switching tabs doesn't refetch.
let momCache: MomentumHit[] | null = null;
let momNote = '';
let momAsof = 0;
let momEnrichCache: Record<string, Enrich> = {};

export default function MomentumScreen() {
  const [hits, setHits] = useState<MomentumHit[]>(momCache || []);
  const [note, setNote] = useState(momNote);
  const [loading, setLoading] = useState(!momCache);
  const [asof, setAsof] = useState(momAsof);
  const [tick, setTick] = useState(0);
  const [view, setView] = useState<'radar' | 'analyse'>('radar');
  const [setupFilter, setSetupFilter] = useState<'all' | SetupKind>('all');
  const [enrich, setEnrich] = useState<Record<string, Enrich>>(momEnrichCache);
  const [sector, setSector] = useState('');
  const [sel, setSel] = useState<MomentumHit | null>(null);
  const [detail, setDetail] = useState<Row | null>(null);
  const [watch, setWatch] = useState<string[]>([]);
  const [alerts, setAlerts] = useState<LocalAlert[]>([]);
  const [flash, setFlash] = useState('');
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { isDesktop } = useResponsive();

  const [anaInitial, setAnaInitial] = useState('');
  useEffect(() => {
    loadWatchlist().then(setWatch);
    loadLocalAlerts().then(setAlerts);
    const s = takeSector('momentum');
    if (s) setSector(s);
    // A symbol handed off from another screen opens the analyser directly.
    const sym = takeSymbol('momentum');
    if (sym) {
      setAnaInitial(sym);
      setView('analyse');
    }
  }, []);

  const toast = (m: string) => {
    setFlash(m);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(''), 2200);
  };
  const isAlerted = (sym: string) => hasLocalAlert(alerts, sym);
  const onAlert = async (h: MomentumHit) => {
    const tgt = h.target ?? (h.price != null ? h.price * 1.1 : null);
    if (tgt == null || h.price == null) return;
    setAlerts(await addLocalAlert(alerts, h.symbol, tgt, h.price, h.name));
    const up = h.upside_pct != null ? ` · ${h.upside_pct >= 0 ? '+' : ''}${h.upside_pct.toFixed(1)}% upside` : '';
    toast(`Alert set for ${h.symbol} → ₹${tgt.toLocaleString('en-IN')}${up}`);
  };

  const forceRefresh = () => {
    if (loading) return;
    momCache = null;
    momNote = '';
    momEnrichCache = {};
    setEnrich({});
    setSector('');
    setHits([]);
    setLoading(true);
    setNote('Restarting the universe radar…');
    setTick((t) => t + 1);
  };

  // Poll the server-side full NSE+BSE radar; setups stream in live.
  useEffect(() => {
    if (momCache && tick === 0) return;
    let cancelled = false;
    (async () => {
      try {
        let snap = await api.momentumScreen(tick > 0);
        while (!cancelled && snap.status === 'running') {
          if (snap.results.length) {
            setHits(snap.results);
            setLoading(false);
          }
          setNote(`Scanning the whole NSE + BSE universe server-side… ${snap.progress || ''}`);
          await new Promise((r) => setTimeout(r, 4000));
          snap = await api.momentumScreen();
        }
        if (cancelled) return;
        if (snap.status === 'error' && !snap.results.length) {
          setNote(snap.error || 'Radar failed — retry shortly.');
          setLoading(false);
          return;
        }
        const meta = `${snap.universe_nse.toLocaleString('en-IN')} NSE${snap.universe_bse ? ` + ${snap.universe_bse.toLocaleString('en-IN')} BSE` : ''} scanned${snap.refreshing ? ' · refreshing…' : ''}`;
        setHits(snap.results);
        setLoading(false);
        setNote(meta);
        setAsof(snap.asof);
        momCache = snap.results;
        momNote = meta;
        momAsof = snap.asof;
        // Enrich each hit with sector + market cap (the radar carries neither).
        // Best-effort: a failed/partial fetch just leaves those tags blank.
        // Market cap + sector warm in the background server-side, so poll a few
        // rounds until `pending` drains — otherwise most caps are null and Cap
        // sorting has nothing to sort on. Merge progressively so tags fill in.
        const syms = snap.results.map((h) => h.symbol);
        if (syms.length) {
          const merged: Record<string, Enrich> = {};
          for (let round = 0; round < 8 && !cancelled; round++) {
            let res: Awaited<ReturnType<typeof api.fundamentalsBulk>>;
            try {
              res = await api.fundamentalsBulk(syms);
            } catch {
              break;
            }
            if (cancelled) return;
            if (res.data) {
              Object.entries(res.data).forEach(([sym, f]) => {
                const rec = f as Record<string, unknown>;
                merged[sym] = {
                  sector: (rec.sector as string) ?? merged[sym]?.sector ?? null,
                  mcap: typeof rec.market_cap_cr === 'number' ? rec.market_cap_cr : (merged[sym]?.mcap ?? null),
                };
              });
              momEnrichCache = { ...merged };
              setEnrich({ ...merged });
            }
            if (!res.pending || !res.pending.length) break;
            await new Promise((r) => setTimeout(r, 3000));
          }
        }
      } catch (e) {
        if (!cancelled) {
          setNote(e instanceof Error ? e.message : 'Failed to load the radar');
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tick]);

  // Tap-to-sort columns (default: score, best first). Numeric columns sort
  // desc first; text columns (symbol/name/exch/setup) asc first.
  const [sortCol, setSortCol] = useState<ColKey>('score');
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  const TEXT_COLS: ColKey[] = ['symbol', 'name', 'exchange', 'setup', 'sector'];
  const onSort = (col: ColKey) => {
    if (col === sortCol) setSortDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortCol(col);
      setSortDir(TEXT_COLS.includes(col) ? 1 : -1);
    }
  };
  // Column value for sorting — 'sector'/'cap' come from the enrichment map.
  const sortVal = (h: MomentumHit, col: ColKey): string | number | null | undefined => {
    if (col === 'sector') return enrich[h.symbol]?.sector ?? '';
    if (col === 'cap') return enrich[h.symbol]?.mcap ?? null;
    return h[col as keyof MomentumHit] as string | number | null | undefined;
  };
  // Exhaustive canonical sector list (unioned with any present in the enriched
  // hits) so every sector is selectable, including one routed from the heatmap.
  const sectors = useMemo(
    () => mergeSectors(hits.map((h) => enrich[h.symbol]?.sector)),
    [hits, enrich],
  );
  const shown = useMemo(() => {
    const filtered = hits.filter(
      (h) =>
        (setupFilter === 'all' || h.setup === setupFilter) &&
        (sector === '' || enrich[h.symbol]?.sector === sector),
    );
    return [...filtered].sort((a, b) => {
      const va = sortVal(a, sortCol);
      const vb = sortVal(b, sortCol);
      if (typeof va === 'string' || typeof vb === 'string') {
        return String(va ?? '').localeCompare(String(vb ?? '')) * sortDir;
      }
      // Unknown values (e.g. a market cap that hasn't loaded) always sort last,
      // regardless of direction — so Cap sorting surfaces real caps, not blanks.
      const na = typeof va === 'number' && isFinite(va) ? va : null;
      const nb = typeof vb === 'number' && isFinite(vb) ? vb : null;
      if (na === null && nb === null) return 0;
      if (na === null) return 1;
      if (nb === null) return -1;
      return (na - nb) * sortDir;
    });
  }, [hits, enrich, setupFilter, sector, sortCol, sortDir]);
  const arrow = (col: ColKey) => (sortCol === col ? (sortDir === 1 ? ' ↑' : ' ↓') : '');
  const counts = useMemo(() => {
    const c: Record<string, number> = { breakout: 0, fired: 0, pullback: 0 };
    hits.forEach((h) => c[h.setup]++);
    return c;
  }, [hits]);

  const isWatched = (sym: string) => watch.includes(normSymbol(sym));
  const toggleWatch = async (sym: string) => {
    if (isWatched(sym)) setWatch(await removeSymbol(watch, normSymbol(sym)));
    else setWatch(await addSymbol(watch, sym));
  };
  const openChart = (h: MomentumHit) =>
    setDetail({ sym: h.symbol, name: h.name, exchange: h.exchange, price: h.price, chg: h.chg });
  const openChartSym = (sym: string) =>
    setDetail({ sym, name: sym, exchange: 'NSE', price: null });

  return (
    <View style={styles.container}>
      <View style={styles.segRow}>
        <View style={styles.seg}>
          {(['radar', 'analyse'] as const).map((v) => (
            <TouchableOpacity
              key={v}
              style={[styles.segBtn, view === v && styles.segBtnOn]}
              onPress={() => setView(v)}
              activeOpacity={0.75}
            >
              <Text style={[styles.segTxt, view === v && styles.segTxtOn]}>{v === 'radar' ? '◎ Radar' : '⚡ Analyser'}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <InfoButton title="Momentum radar" content={MOMENTUM_INFO} />
      </View>

      {view === 'radar' ? (
        <>
      <View style={styles.chipsRow}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsInner}>
          {SETUP_FILTERS.map((f) => {
            const count =
              f.key === 'all' ? counts.breakout + counts.fired + counts.pullback : counts[f.key] || 0;
            return (
              <TouchableOpacity
                key={f.key}
                style={[styles.chip, setupFilter === f.key && styles.chipOn]}
                onPress={() => setSetupFilter(f.key)}
                activeOpacity={0.75}
              >
                <Text style={[styles.chipTxt, setupFilter === f.key && styles.chipTxtOn]}>
                  {f.label} ({count})
                </Text>
              </TouchableOpacity>
            );
          })}
          <TouchableOpacity
            style={[styles.updBtn, loading && { opacity: 0.5 }]}
            onPress={forceRefresh}
            disabled={loading}
            activeOpacity={0.75}
          >
            <Text style={styles.updTxt}>⟳ Update list</Text>
          </TouchableOpacity>
          <Text style={styles.note} numberOfLines={1}>{note} · tap a row for the technical read</Text>
        </ScrollView>
      </View>
      {asof ? <Text style={styles.lastUpd}>Setups last updated {fmtAsof(asof)}</Text> : null}

      {!loading && sectors.length ? (
        <View style={styles.secRow}>
          <Dropdown
            label="Sector"
            value={sector}
            options={[{ key: '', label: 'All sectors' }, ...sectors.map((sn) => ({ key: sn, label: sn }))]}
            onChange={setSector}
          />
        </View>
      ) : null}

      <ScrollView style={{ flex: 1 }}>
        {loading ? <Loading label="Scanning the universe — setups stream in as they're found…" /> : null}
        {!loading && !shown.length ? (
          <EmptyState
            icon="◇"
            title="No qualifying setups right now"
            hint="Compression and pullback windows come and go — hit ⟳ Update list or check back later."
          />
        ) : null}

        {shown.length && !isDesktop ? (
          <View style={styles.mSortRow}>
            <Text style={styles.mSortLabel}>SORT</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.mSortInner}>
              {MOBILE_SORTS.map((s) => {
                const on = sortCol === s.key;
                return (
                  <TouchableOpacity
                    key={s.key}
                    style={[styles.mSortChip, on && styles.mSortChipOn]}
                    onPress={() => onSort(s.key)}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.mSortTxt, on && styles.mSortTxtOn]}>
                      {s.label}{on ? (sortDir === 1 ? ' ↑' : ' ↓') : ''}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        ) : null}

        {shown.length && isDesktop ? (
          <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ minWidth: '100%' }}>
            <View style={{ minWidth: TABLE_W }}>
              <View style={styles.headerRow}>
                {COLS.map((col) => (
                  <TouchableOpacity key={col.key} style={{ width: col.w }} onPress={() => onSort(col.key)} activeOpacity={0.7}>
                    <Text style={col.text ? styles.th : styles.thR}>{col.label}{arrow(col.key)}</Text>
                  </TouchableOpacity>
                ))}
                <Text style={[styles.th, { width: ACTIONS_W, textAlign: 'center' }]}>ACTIONS</Text>
              </View>
              {shown.map((h) => {
                const c = setupColor(h.setup);
                return (
                  <View key={h.symbol}>
                    <TouchableOpacity style={styles.dataRow} onPress={() => setSel(h)} activeOpacity={0.8}>
                      <Text style={[styles.sym, { width: 92 }]} numberOfLines={1}>{h.symbol}</Text>
                      <Text style={[styles.name, { width: 190 }]} numberOfLines={1}>{h.name || '—'}</Text>
                      <Text style={[styles.exch, { width: 46 }]}>{h.exchange}</Text>
                      <Text style={[styles.sector, { width: 140 }]} numberOfLines={1}>{enrich[h.symbol]?.sector || '—'}</Text>
                      <View style={{ width: 66, paddingHorizontal: theme.sp.xs }}>{capTag(enrich[h.symbol]?.mcap)}</View>
                      <View style={{ width: 150 }}>
                        <Text style={[styles.setupBadge, { color: c, borderColor: c }]}>{SETUP_LABEL[h.setup]}</Text>
                      </View>
                      <Text style={[styles.cellR, { width: 56, color: c, fontWeight: '700' }]}>{h.score}</Text>
                      <Text style={[styles.cellR, { width: 54 }]}>{h.probability}%</Text>
                      <Text style={[styles.cellR, { width: 94, fontWeight: '700' }]}>{fmtIN(h.price)}</Text>
                      <Text style={[styles.cellR, { width: 70, color: (h.chg ?? 0) >= 0 ? theme.green : theme.red }]}>{pct(h.chg, 2)}</Text>
                      <Text style={[styles.cellR, { width: 46 }]}>{h.rsi != null ? h.rsi.toFixed(0) : '—'}</Text>
                      <Text style={[styles.cellR, { width: 58 }]}>{h.relvol != null ? h.relvol.toFixed(2) + 'x' : '—'}</Text>
                      <Text style={[styles.cellR, { width: 82, color: (h.d200 ?? 0) >= 0 ? theme.green : theme.red }]}>{pct(h.d200)}</Text>
                      <Text style={[styles.cellR, { width: 68, color: theme.red }]}>{pct(h.pct_from_high)}</Text>
                      <Text style={[styles.cellR, { width: 72, color: (h.upside_pct ?? 0) > 0 ? theme.green : theme.muted }]}>
                        {h.upside_pct != null ? '+' + h.upside_pct.toFixed(1) + '%' : '—'}
                      </Text>
                      <View style={[styles.actions, { width: ACTIONS_W }]}>
                        <TouchableOpacity style={styles.aBtn} onPress={() => openChart(h)} activeOpacity={0.75}>
                          <Text style={styles.aTxt}>Chart</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.aBtn} onPress={() => onAlert(h)} activeOpacity={0.75}>
                          <Text style={[styles.aTxt, isAlerted(h.symbol) && { color: GOLD }]}>{isAlerted(h.symbol) ? '🔔' : 'Alert'}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.aBtn} onPress={() => toggleWatch(h.symbol)} activeOpacity={0.75}>
                          <Text style={[styles.aTxt, isWatched(h.symbol) && { color: theme.green }]}>{isWatched(h.symbol) ? '★' : '☆'}</Text>
                        </TouchableOpacity>
                      </View>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          </ScrollView>
        ) : null}

        {shown.length && !isDesktop
          ? shown.map((h) => {
              const c = setupColor(h.setup);
              return (
                <View key={h.symbol}>
                  <TouchableOpacity style={styles.card} onPress={() => setSel(h)} activeOpacity={0.8}>
                    <View style={styles.cardTop}>
                      <View style={{ flex: 1 }}>
                        <View style={styles.cardSymRow}>
                          <Text style={styles.cardSym}>{h.symbol}</Text>
                          <Text style={styles.cardExch}>{h.exchange}</Text>
                          {capTag(enrich[h.symbol]?.mcap)}
                          <Text style={[styles.setupBadge, { color: c, borderColor: c }]}>{SETUP_LABEL[h.setup]}</Text>
                        </View>
                        <Text style={styles.cardName} numberOfLines={1}>
                          {h.name || '—'}
                          {enrich[h.symbol]?.sector ? <Text style={styles.cardSector}> · {enrich[h.symbol]?.sector}</Text> : null}
                        </Text>
                      </View>
                      <View style={styles.cardScoreBox}>
                        <Text style={[styles.cardScore, { color: c }]}>{h.score}</Text>
                        <Text style={styles.cardProb}>{h.probability}% prob</Text>
                      </View>
                    </View>
                    <View style={styles.cardStats}>
                      <Text style={styles.cardStat}>₹{fmtIN(h.price)}</Text>
                      <Text style={[styles.cardStat, { color: (h.chg ?? 0) >= 0 ? theme.green : theme.red }]}>{pct(h.chg, 2)}</Text>
                      {fmtCap(enrich[h.symbol]?.mcap) ? (
                        <Text style={[styles.cardStat, { color: theme.muted2 }]}>{fmtCap(enrich[h.symbol]?.mcap)}</Text>
                      ) : null}
                      <Text style={styles.cardStat}>RSI {h.rsi != null ? h.rsi.toFixed(0) : '—'}</Text>
                      <Text style={styles.cardStat}>{h.relvol != null ? h.relvol.toFixed(2) + 'x' : '—'}</Text>
                      <Text style={[styles.cardStat, { color: (h.d200 ?? 0) >= 0 ? theme.green : theme.red }]}>200DMA {pct(h.d200)}</Text>
                      {h.upside_pct != null ? (
                        <Text style={[styles.cardStat, { color: h.upside_pct > 0 ? theme.green : theme.muted }]}>
                          ▲ {h.upside_pct > 0 ? '+' + h.upside_pct.toFixed(1) + '%' : 'extended'} upside
                        </Text>
                      ) : null}
                    </View>
                    <View style={styles.cardActions}>
                      <TouchableOpacity style={styles.aBtn} onPress={() => openChart(h)} activeOpacity={0.75}>
                        <Text style={styles.aTxt}>Chart</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.aBtn} onPress={() => onAlert(h)} activeOpacity={0.75}>
                        <Text style={[styles.aTxt, isAlerted(h.symbol) && { color: GOLD }]}>
                          {isAlerted(h.symbol) ? '🔔 Alerted' : '🔔 Alert'}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.aBtn} onPress={() => toggleWatch(h.symbol)} activeOpacity={0.75}>
                        <Text style={[styles.aTxt, isWatched(h.symbol) && { color: theme.green }]}>
                          {isWatched(h.symbol) ? '★ Watching' : '☆ Watch'}
                        </Text>
                      </TouchableOpacity>
                      <Text style={styles.cardHint}>tap for full read</Text>
                    </View>
                  </TouchableOpacity>
                </View>
              );
            })
          : null}

        {shown.length ? (
          <Text style={styles.method}>
            Setups: BREAKOUT WATCH — TTM squeeze compression near the 52-week high with volume building;
            BREAKOUT FIRED — squeeze release / fresh high / Camarilla break on the latest bar;
            PULLBACK REVERSAL — orderly dip to support inside an intact uptrend with washed-out oscillators.
            Probability is an indicative base-rate heuristic, not a forecast. For information only — not investment advice.
          </Text>
        ) : null}
      </ScrollView>
        </>
      ) : (
        <MomAnalyser
          initialSymbol={anaInitial}
          watch={watch}
          onToggleWatch={(s) => toggleWatch(s)}
          onChartSym={openChartSym}
        />
      )}

      {sel ? (
        <MomDetail
          h={sel}
          enr={enrich[sel.symbol]}
          watched={isWatched(sel.symbol)}
          alerted={isAlerted(sel.symbol)}
          onClose={() => setSel(null)}
          onChart={() => { const h = sel; setSel(null); openChart(h); }}
          onAlert={() => onAlert(sel)}
          onWatch={() => toggleWatch(sel.symbol)}
          onAnalyse={() => { const s = sel.symbol; setSel(null); navigate('analysis', { sub: 'mb', symbol: s }); }}
          onPattern={() => { const s = sel.symbol; setSel(null); navigate('analysis', { sub: 'patterns', symbol: s }); }}
          onDossier={() => { const s = sel.symbol; setSel(null); navigate('analysis', { sub: 'inst', symbol: s }); }}
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
  // Radar ⇄ Analyser segmented toggle.
  segRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.sp.lg,
    paddingTop: theme.sp.md,
    paddingBottom: theme.sp.sm,
  },
  seg: { flexDirection: 'row', gap: theme.sp.xs },
  segBtn: {
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: theme.sp.md,
    paddingVertical: 7,
  },
  segBtnOn: { backgroundColor: theme.brandSoft, borderColor: theme.brand },
  segTxt: { color: theme.muted2, fontSize: theme.fs.sm, fontWeight: '700' },
  segTxtOn: { color: theme.brand, fontWeight: '800' },
  // analyser sub-tab
  anaInputRow: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.sm, paddingHorizontal: theme.sp.lg, paddingTop: theme.sp.sm },
  anaInput: {
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    color: theme.text,
    paddingHorizontal: theme.sp.md,
    paddingVertical: theme.sp.sm + 2,
    fontSize: theme.fs.md,
  },
  recentRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.sp.sm, paddingHorizontal: theme.sp.lg, paddingTop: theme.sp.sm },
  recentLabel: { color: theme.muted, fontSize: theme.fs.xs, fontWeight: '700', letterSpacing: 1 },
  recentChip: {
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: theme.sp.md,
    paddingVertical: 4,
  },
  recentTxt: { color: theme.muted2, fontFamily: theme.mono, fontSize: theme.fs.sm },
  anaBody: { paddingHorizontal: theme.sp.lg, paddingTop: theme.sp.md, gap: theme.sp.sm },
  anaHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: theme.sp.xs },
  anaSym: { color: theme.accent, fontFamily: theme.mono, fontWeight: '800', fontSize: theme.fs.xl },
  anaHeadActions: { flexDirection: 'row', gap: theme.sp.sm },
  chipsRow: { paddingBottom: theme.sp.xs, paddingTop: theme.sp.sm },
  infoInline: { alignSelf: 'center', marginRight: theme.sp.sm },
  chipsInner: { paddingHorizontal: theme.sp.lg, gap: theme.sp.sm, alignItems: 'center' },
  chip: {
    backgroundColor: theme.surface2,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 13,
    paddingVertical: 6,
  },
  chipOn: { backgroundColor: theme.brandSoft, borderColor: theme.brand },
  chipTxt: { color: theme.muted2, fontSize: theme.fs.sm },
  chipTxtOn: { color: theme.brand, fontWeight: '800' },
  updBtn: {
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.sm + 2,
    paddingHorizontal: theme.sp.md,
    paddingVertical: 5,
  },
  updTxt: { color: theme.text, fontSize: theme.fs.sm, fontWeight: '700' },
  note: { color: theme.muted, fontSize: theme.fs.sm, marginLeft: theme.sp.sm },
  lastUpd: { color: theme.muted, fontSize: theme.fs.xs + 1, paddingHorizontal: theme.sp.lg, paddingBottom: theme.sp.sm },
  // sector filter chips
  // flexGrow:0 so this horizontal filter strip sizes to its content instead of
  // greedily filling the column (which left a large blank gap and vertically-
  // centred the chips).
  secScroll: { flexGrow: 0, flexShrink: 0 },
  secRow: { flexDirection: 'row', paddingHorizontal: theme.sp.md, paddingBottom: theme.sp.sm, alignItems: 'center' },
  secChip: {
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 4,
    backgroundColor: theme.surface2,
  },
  secChipOn: { backgroundColor: theme.brandSoft, borderColor: theme.brand },
  secChipTxt: { color: theme.muted2, fontFamily: theme.mono, fontSize: theme.fs.sm },
  secChipTxtOn: { color: theme.brand, fontWeight: '800' },
  // sector + market-cap columns
  sector: { color: theme.muted2, fontSize: theme.fs.sm, paddingHorizontal: theme.sp.xs },
  capChip: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1, alignSelf: 'flex-start' },
  capChipTxt: { fontFamily: theme.mono, fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
  capDash: { color: theme.muted, fontFamily: theme.mono, fontSize: theme.fs.sm },
  cardSector: { color: theme.muted, fontSize: theme.fs.sm },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.surface2,
    borderBottomColor: theme.border2,
    borderBottomWidth: 1,
    paddingVertical: theme.sp.sm,
    paddingHorizontal: theme.sp.xs,
  },
  th: { color: theme.muted2, fontSize: theme.fs.xs + 1, fontWeight: '600', letterSpacing: 0.5, paddingHorizontal: theme.sp.xs },
  thR: { color: theme.muted2, fontSize: theme.fs.xs + 1, fontWeight: '600', letterSpacing: 0.5, paddingHorizontal: theme.sp.xs, textAlign: 'right' },
  dataRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomColor: theme.border,
    borderBottomWidth: 1,
    paddingVertical: 5,
    paddingHorizontal: theme.sp.xs,
    minHeight: 34,
  },
  // mobile sort chips
  mSortRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.sp.md, paddingBottom: theme.sp.sm, gap: theme.sp.sm },
  mSortLabel: { color: theme.muted, fontSize: theme.fs.xs, fontWeight: '700', letterSpacing: 1 },
  mSortInner: { gap: theme.sp.sm, alignItems: 'center' },
  mSortChip: {
    backgroundColor: theme.surface2,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  mSortChipOn: { backgroundColor: theme.brandSoft, borderColor: theme.brand },
  mSortTxt: { color: theme.muted2, fontSize: theme.fs.sm },
  mSortTxtOn: { color: theme.brand, fontWeight: '800' },
  // mobile card
  card: {
    backgroundColor: theme.surface,
    borderBottomColor: theme.border,
    borderBottomWidth: 1,
    paddingHorizontal: theme.sp.lg,
    paddingVertical: theme.sp.md,
    gap: theme.sp.sm,
  },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.sp.md },
  cardSymRow: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.sm, flexWrap: 'wrap' },
  cardSym: { color: theme.accent, fontFamily: theme.mono, fontWeight: '700', fontSize: theme.fs.md },
  cardExch: { color: theme.muted, fontSize: theme.fs.xs + 1, fontFamily: theme.mono },
  cardName: { color: theme.muted2, fontSize: theme.fs.sm, marginTop: 2 },
  cardScoreBox: { alignItems: 'flex-end' },
  cardScore: { fontFamily: theme.mono, fontWeight: '800', fontSize: theme.fs.xl },
  cardProb: { color: theme.muted, fontSize: theme.fs.xs + 1 },
  cardStats: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp.md },
  cardStat: { color: theme.text, fontFamily: theme.mono, fontSize: theme.fs.sm },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.sm },
  cardHint: { color: theme.muted, fontSize: theme.fs.xs + 1, marginLeft: 'auto' },
  sym: { color: theme.accent, fontFamily: theme.mono, fontWeight: '700', fontSize: theme.fs.sm + 1, paddingHorizontal: theme.sp.xs },
  name: { color: theme.muted2, fontSize: theme.fs.sm, paddingHorizontal: theme.sp.xs },
  exch: { color: theme.muted, fontSize: theme.fs.xs + 1, fontFamily: theme.mono, paddingHorizontal: theme.sp.xs },
  setupBadge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: theme.sp.sm,
    paddingVertical: 2,
    fontSize: theme.fs.xs,
    fontWeight: '800',
    letterSpacing: 0.5,
    alignSelf: 'flex-start',
    overflow: 'hidden',
  },
  cellR: { color: theme.text, fontFamily: theme.mono, fontSize: theme.fs.sm, textAlign: 'right', paddingHorizontal: theme.sp.xs },
  actions: { width: 110, flexDirection: 'row', gap: 5, justifyContent: 'center' },
  aBtn: {
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.sp.sm,
    paddingVertical: 3,
  },
  aTxt: { color: theme.muted2, fontSize: theme.fs.xs + 1, fontWeight: '700' },
  readBox: {
    backgroundColor: theme.surface,
    borderBottomColor: theme.border2,
    borderBottomWidth: 1,
    paddingHorizontal: theme.sp.lg,
    paddingVertical: theme.sp.md,
    gap: 4,
  },
  probTrack: { height: 8, borderRadius: 4, backgroundColor: theme.surface3, overflow: 'hidden', marginBottom: 4 },
  probFill: { height: '100%', borderRadius: 4 },
  readMeta: { color: theme.muted, fontSize: theme.fs.sm, marginBottom: 4 },
  sigTxt: { color: theme.green, fontSize: theme.fs.sm, lineHeight: 19 },
  cauTxt: { color: GOLD, fontSize: theme.fs.sm, lineHeight: 19 },
  sigBody: { color: theme.text },
  method: { color: theme.muted, fontSize: theme.fs.xs + 1, lineHeight: 16, padding: theme.sp.lg },
  toast: {
    position: 'absolute',
    bottom: theme.sp.xl,
    alignSelf: 'center',
    backgroundColor: theme.surface3,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.sp.lg,
    paddingVertical: theme.sp.sm + 2,
    maxWidth: '92%',
  },
  toastTxt: { color: theme.text, fontSize: theme.fs.sm + 1, fontWeight: '600' },
  // detail popup — dHead is a sticky header, so it needs a solid background and
  // a divider to sit cleanly over the scrolling body.
  dHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.sp.md,
    backgroundColor: theme.surface,
    paddingBottom: theme.sp.md,
    marginBottom: theme.sp.sm,
    borderBottomColor: theme.border,
    borderBottomWidth: 1,
  },
  dSym: { color: theme.accent, fontFamily: theme.mono, fontWeight: '700', fontSize: theme.fs.lg },
  dName: { color: theme.muted2, fontSize: theme.fs.sm, marginTop: 3 },
  dX: { color: theme.muted, fontSize: 18, paddingHorizontal: 4 },
  dVerdict: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.sp.lg,
    paddingVertical: theme.sp.md,
    marginBottom: theme.sp.md,
  },
  dScoreBox: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  dScore: { fontFamily: theme.mono, fontWeight: '800', fontSize: theme.fs.xxl },
  dScoreSub: { color: theme.muted, fontSize: theme.fs.xs + 1 },
  dGrid: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: theme.sp.sm },
  dCell: { width: '25%', paddingVertical: theme.sp.sm },
  dCellLbl: { color: theme.muted, fontSize: theme.fs.xs, letterSpacing: 0.5, marginBottom: 2 },
  dCellVal: { color: theme.text, fontFamily: theme.mono, fontSize: theme.fs.md, fontWeight: '700' },
  dSecTitle: { color: theme.muted2, fontSize: theme.fs.xs + 1, fontWeight: '800', letterSpacing: 1, marginTop: theme.sp.md, marginBottom: theme.sp.sm },
  dActions: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp.sm, marginTop: theme.sp.md },
  dActBtn: {
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.sm + 2,
    paddingHorizontal: theme.sp.md,
    paddingVertical: theme.sp.sm,
    backgroundColor: theme.surface2,
  },
  dActTxt: { color: theme.text, fontSize: theme.fs.sm, fontWeight: '700' },
  dClose: {
    marginTop: theme.sp.lg,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    paddingVertical: theme.sp.md,
    alignItems: 'center',
  },
  dCloseTxt: { color: theme.muted2, fontSize: theme.fs.md, fontWeight: '700' },
  dDisc: { color: theme.muted, fontSize: theme.fs.xs + 1, lineHeight: 16, marginTop: theme.sp.md, marginBottom: theme.sp.md },
});
