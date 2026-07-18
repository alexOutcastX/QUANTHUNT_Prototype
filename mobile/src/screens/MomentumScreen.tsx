import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MomentumHit, api } from '../api';
import StockDetail from '../components/StockDetail';
import { useResponsive } from '../responsive';
import { Row } from '../screener';
import { addSymbol, loadWatchlist, normSymbol, removeSymbol } from '../watchlist';
import { LocalAlert, addLocalAlert, hasLocalAlert, loadLocalAlerts } from '../localalerts';
import { capBand } from '../marketcap';
import { EmptyState, Loading, ScreenTitle } from '../ui';
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
  const [setupFilter, setSetupFilter] = useState<'all' | SetupKind>('all');
  const [enrich, setEnrich] = useState<Record<string, Enrich>>(momEnrichCache);
  const [sector, setSector] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<Row | null>(null);
  const [watch, setWatch] = useState<string[]>([]);
  const [alerts, setAlerts] = useState<LocalAlert[]>([]);
  const [flash, setFlash] = useState('');
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { isDesktop } = useResponsive();

  useEffect(() => {
    loadWatchlist().then(setWatch);
    loadLocalAlerts().then(setAlerts);
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
        const syms = snap.results.map((h) => h.symbol);
        if (syms.length) {
          try {
            const res = await api.fundamentalsBulk(syms);
            if (!cancelled && res.data) {
              const map: Record<string, Enrich> = {};
              Object.entries(res.data).forEach(([sym, f]) => {
                const rec = f as Record<string, unknown>;
                map[sym] = {
                  sector: (rec.sector as string) ?? null,
                  mcap: typeof rec.market_cap_cr === 'number' ? rec.market_cap_cr : null,
                };
              });
              momEnrichCache = map;
              setEnrich(map);
            }
          } catch {
            /* tags stay blank — non-fatal */
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
  // Distinct sectors present across the enriched hits ('' = all).
  const sectors = useMemo(() => {
    const s = new Set<string>();
    hits.forEach((h) => { const v = enrich[h.symbol]?.sector; if (v) s.add(String(v)); });
    return Array.from(s).sort();
  }, [hits, enrich]);
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
      const na = typeof va === 'number' && isFinite(va) ? va : -Infinity;
      const nb = typeof vb === 'number' && isFinite(vb) ? vb : -Infinity;
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

  return (
    <View style={styles.container}>
      <ScreenTitle
        title="Momentum radar"
        sub="Whole NSE + BSE universe · breakout & pullback-reversal setups · technical score + follow-through probability"
      />
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
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.secScroll} contentContainerStyle={styles.secRow}>
          <TouchableOpacity
            style={[styles.secChip, sector === '' && styles.secChipOn]}
            onPress={() => setSector('')}
            activeOpacity={0.75}
          >
            <Text style={[styles.secChipTxt, sector === '' && styles.secChipTxtOn]}>All sectors</Text>
          </TouchableOpacity>
          {sectors.map((s) => (
            <TouchableOpacity
              key={s}
              style={[styles.secChip, sector === s && styles.secChipOn]}
              onPress={() => setSector((cur) => (cur === s ? '' : s))}
              activeOpacity={0.75}
            >
              <Text style={[styles.secChipTxt, sector === s && styles.secChipTxtOn]}>{s}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
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
                const open = expanded === h.symbol;
                const c = setupColor(h.setup);
                return (
                  <View key={h.symbol}>
                    <TouchableOpacity style={styles.dataRow} onPress={() => setExpanded(open ? null : h.symbol)} activeOpacity={0.8}>
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
                    {open ? <ReadBox h={h} c={c} width={TABLE_W} /> : null}
                  </View>
                );
              })}
            </View>
          </ScrollView>
        ) : null}

        {shown.length && !isDesktop
          ? shown.map((h) => {
              const open = expanded === h.symbol;
              const c = setupColor(h.setup);
              return (
                <View key={h.symbol}>
                  <TouchableOpacity style={styles.card} onPress={() => setExpanded(open ? null : h.symbol)} activeOpacity={0.8}>
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
                      <Text style={styles.cardHint}>{open ? 'tap to collapse' : 'tap for read'}</Text>
                    </View>
                  </TouchableOpacity>
                  {open ? <ReadBox h={h} c={c} /> : null}
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
  chipsRow: { paddingBottom: theme.sp.xs },
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
  secRow: { gap: 6, paddingHorizontal: theme.sp.md, paddingBottom: theme.sp.sm, alignItems: 'center' },
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
});
