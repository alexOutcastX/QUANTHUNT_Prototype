import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Candle, ChartPattern, ChartPatternsResp, PatternScreenHit, PatternScreenResp, api } from '../api';
import { CapChip, Enrich, useEnrich } from '../enrich';
import { chartHtml } from '../chartHtml';
import HtmlView from '../components/HtmlView';
import StockDetail from '../components/StockDetail';
import SymbolInput from '../components/SymbolInput';
import { Row } from '../screener';
import { navigate, takeSymbol } from '../navIntent';
import { addSymbol, loadWatchlist, normSymbol } from '../watchlist';
import { Btn, Card, EmptyState, InfoButton, Loading, SectionTitle, Segmented, Sheet } from '../ui';
import { PATTERN_INFO } from '../tabInfo';
import { describePattern } from '../patternInfo';
import { useResponsive } from '../responsive';
import { theme } from '../theme';

const PORTFOLIO_PREFILL_KEY = 'taureye.portfolio.prefill';

const RECENT_KEY = 'taureye.patterns.recent.v1';
const PERIODS: { key: string; label: string }[] = [
  { key: '1y', label: '1Y' },
  { key: '2y', label: '2Y' },
  { key: '5y', label: '5Y' },
];

const biasColor = (b: string) => (b === 'bullish' ? theme.green : b === 'bearish' ? theme.red : theme.muted2);
const fmtDate = (ts?: number) =>
  ts == null ? '—' : new Date(ts * 1000).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
const signPct = (v?: number | null) =>
  v == null || !isFinite(v) ? '—' : (v >= 0 ? '+' : '') + v.toFixed(1) + '%';

// Desktop/mobile share one horizontally-scrolling table (many columns).
type Col = { key: string; label: string; w: number; align?: 'left' | 'right' };
const COLS: Col[] = [
  { key: 'pattern', label: 'PATTERN', w: 186, align: 'left' },
  { key: 'bias', label: 'BIAS', w: 82, align: 'left' },
  { key: 'started', label: 'STARTED', w: 92, align: 'right' },
  { key: 'ended', label: 'ENDED', w: 96, align: 'right' },
  { key: 'conf', label: 'PROBABILITY', w: 108, align: 'right' },
  { key: 'cont', label: 'CONTINUATION', w: 116, align: 'right' },
  { key: 'exp', label: 'EXPANSION', w: 96, align: 'right' },
];
const TABLE_W = COLS.reduce((a, c) => a + c.w, 0);

function Bar({ pct, color }: { pct: number; color: string }) {
  return (
    <View style={styles.barTrack}>
      <View style={[styles.barFill, { width: `${Math.max(3, Math.min(100, pct))}%`, backgroundColor: color }]} />
    </View>
  );
}

function PatternRow({ p, top }: { p: ChartPattern; top?: boolean }) {
  const c = biasColor(p.bias);
  return (
    <View style={[styles.dataRow, p.current && styles.currentRow, top && { borderTopWidth: 0 }]}>
      <View style={{ width: 186 }}>
        <View style={styles.patName}>
          {p.current ? <Text style={styles.liveDot}>●</Text> : null}
          <Text style={styles.patLabel} numberOfLines={1}>{p.label}</Text>
        </View>
        <Text style={styles.patMeta} numberOfLines={1}>
          {p.category}{p.status === 'confirmed' ? ' · confirmed' : ' · forming'}
        </Text>
      </View>
      <View style={{ width: 82 }}>
        <View style={[styles.biasChip, { borderColor: c }]}>
          <Text style={[styles.biasTxt, { color: c }]}>{p.bias.toUpperCase()}</Text>
        </View>
      </View>
      <Text style={[styles.cell, { width: 92 }]}>{fmtDate(p.start_ts)}</Text>
      <Text style={[styles.cell, { width: 96 }]}>{p.current ? 'active' : fmtDate(p.end_ts)}</Text>
      <View style={{ width: 108, paddingHorizontal: theme.sp.xs, alignItems: 'flex-end' }}>
        <Text style={styles.cellStrong}>{p.confidence}%</Text>
        <Bar pct={p.confidence} color={theme.accent} />
      </View>
      <View style={{ width: 116, paddingHorizontal: theme.sp.xs, alignItems: 'flex-end' }}>
        <Text style={styles.cellStrong}>{p.continuation}%</Text>
        <Bar pct={p.continuation} color={c} />
      </View>
      <Text style={[styles.cell, styles.mono, { width: 96, color: p.expansion_pct >= 0 ? theme.green : theme.red }]}>
        {signPct(p.expansion_pct)}
      </Text>
    </View>
  );
}

// The dedicated "Current Pattern" detail box — bias, dates, probability, the
// continuation odds and the measured % move. Fills the space beside the table
// on desktop, stacks above it on mobile.
type CardActions = {
  onChart: () => void;
  onMultibagger: () => void;
  onInstitutional: () => void;
  onWatch: () => void;
  onPortfolio: () => void;
  watched: boolean;
};

function CurrentCard({ p, actions }: { p: ChartPattern; actions: CardActions }) {
  const c = biasColor(p.bias);
  const [explain, setExplain] = useState(false);
  const desc = describePattern(p.label);
  const bearish = p.bias === 'bearish';
  // Approximate resolution window: a measured move typically plays out over
  // roughly the pattern's own formation span. For a still-active pattern we
  // project from the last bar; a completed one shows its actual end.
  const spanSec = Math.max(0, p.end_ts - p.start_ts);
  const projTs = p.end_ts + spanSec;
  // Support / resistance zones from the pattern's own geometry: the key level
  // (neckline / breakout) is the pivotal band; the measured-move target is the
  // objective. Roles flip with bias. Render each as a small ±0.6% band.
  const band = (v: number) => {
    const d = v * 0.006;
    return `₹${(v - d).toLocaleString('en-IN', { maximumFractionDigits: 2 })} – ₹${(v + d).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  };
  const zoneRow = (role: string, sub: string, v: number | null | undefined, hot: boolean) =>
    v == null ? null : (
      <View style={styles.zoneRow} key={role}>
        <View style={[styles.zoneDot, { backgroundColor: hot ? theme.red : theme.green }]} />
        <View style={{ flex: 1 }}>
          <Text style={styles.zoneRole}>{role}</Text>
          <Text style={styles.zoneSub}>{sub}</Text>
        </View>
        <Text style={styles.zoneVal}>{band(v)}</Text>
      </View>
    );
  const Stat = ({ label, value, color }: { label: string; value: string; color?: string }) => (
    <View style={styles.cStat}>
      <Text style={styles.cStatLabel}>{label}</Text>
      <Text style={[styles.cStatVal, color ? { color } : null]}>{value}</Text>
    </View>
  );
  return (
    <>{/* fragment so the explain popup can sit beside the card */}
    <Card style={StyleSheet.flatten([styles.curCard, { borderColor: c }])}>
      <View style={styles.curHead}>
        <Text style={styles.curKicker}>CURRENT PATTERN</Text>
        <View style={[styles.statePill, { backgroundColor: p.active ? c : theme.surface3 }]}>
          <Text style={[styles.stateTxt, { color: p.active ? theme.bg : theme.muted2 }]}>
            {p.active ? 'IN PLAY' : 'LATEST'}
          </Text>
        </View>
      </View>
      <Text style={styles.curTitle}>{p.label}</Text>
      <View style={styles.curTags}>
        <View style={[styles.biasChip, { borderColor: c, marginHorizontal: 0 }]}>
          <Text style={[styles.biasTxt, { color: c }]}>{p.bias.toUpperCase()}</Text>
        </View>
        <Text style={styles.curCat}>{p.category} · {p.status}</Text>
      </View>

      <View style={styles.probBlock}>
        <View style={styles.probLine}>
          <Text style={styles.cStatLabel}>Probability</Text>
          <Text style={styles.probPct}>{p.confidence}%</Text>
        </View>
        <Bar pct={p.confidence} color={theme.accent} />
      </View>
      <View style={styles.probBlock}>
        <View style={styles.probLine}>
          <Text style={styles.cStatLabel}>Continuation</Text>
          <Text style={[styles.probPct, { color: c }]}>{p.continuation}%</Text>
        </View>
        <Bar pct={p.continuation} color={c} />
      </View>

      <View style={styles.cGrid}>
        <Stat label="Bias" value={p.bias[0].toUpperCase() + p.bias.slice(1)} color={c} />
        <Stat label="% move" value={signPct(p.expansion_pct)} color={p.expansion_pct >= 0 ? theme.green : theme.red} />
        <Stat label="Started" value={fmtDate(p.start_ts)} />
        <Stat label="Ended" value={p.active ? 'active' : fmtDate(p.end_ts)} />
        {p.target ? <Stat label="Target" value={`₹${p.target.toLocaleString('en-IN')}`} /> : null}
        {p.level ? <Stat label="Key level" value={`₹${p.level.toLocaleString('en-IN')}`} /> : null}
      </View>

      <View style={styles.actionsRow}>
        <TouchableOpacity style={[styles.actBtn, styles.explainBtn]} onPress={() => setExplain(true)} activeOpacity={0.75}>
          <Text style={[styles.actTxt, { color: c }]}>ⓘ Explain pattern</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actBtn} onPress={actions.onChart} activeOpacity={0.75}>
          <Text style={styles.actTxt}>▤ Chart</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actBtn} onPress={actions.onMultibagger} activeOpacity={0.75}>
          <Text style={[styles.actTxt, { color: theme.accent }]}>Multibagger</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actBtn} onPress={actions.onInstitutional} activeOpacity={0.75}>
          <Text style={styles.actTxt}>◪ Institutional</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actBtn} onPress={actions.onWatch} activeOpacity={0.75}>
          <Text style={[styles.actTxt, actions.watched && { color: theme.green }]}>
            {actions.watched ? '★ Watching' : '☆ Watchlist'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actBtn} onPress={actions.onPortfolio} activeOpacity={0.75}>
          <Text style={styles.actTxt}>＋ Portfolio</Text>
        </TouchableOpacity>
      </View>
    </Card>

    {explain ? (
      <Sheet onClose={() => setExplain(false)} maxHeight="88%">
        <ScrollView showsVerticalScrollIndicator={false}>
          <View style={styles.exHead}>
            <View style={{ flex: 1 }}>
              <Text style={styles.exTitle}>{p.label}</Text>
              <View style={[styles.biasChip, { borderColor: c, alignSelf: 'flex-start', marginHorizontal: 0, marginTop: 4 }]}>
                <Text style={[styles.biasTxt, { color: c }]}>{p.bias.toUpperCase()} · {p.category} · {p.status}</Text>
              </View>
            </View>
            <TouchableOpacity onPress={() => setExplain(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={styles.exX}>✕</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.exSecTitle}>WHAT IT IS</Text>
          <Text style={styles.exBody}>{desc.what}</Text>
          <Text style={[styles.exBody, { marginTop: 6 }]}>{desc.implies}</Text>

          <Text style={styles.exSecTitle}>PROBABILITY</Text>
          <Text style={styles.exBody}>
            <Text style={{ color: theme.accent, fontWeight: '800' }}>{p.confidence}% shape match</Text> — how cleanly the
            price action fits an ideal {p.label.toLowerCase()}. Higher means a more textbook, reliable formation.
          </Text>
          <Text style={[styles.exBody, { marginTop: 6 }]}>
            <Text style={{ color: c, fontWeight: '800' }}>{p.continuation}% follow-through</Text> — the indicative
            historical odds the measured move plays out once the pattern confirms (a close beyond the key level).
            {p.expansion_pct ? ` The textbook target is a ${signPct(p.expansion_pct)} move from here.` : ''}
          </Text>

          <Text style={styles.exSecTitle}>TIMING</Text>
          <Text style={styles.exBody}>
            Formed from <Text style={styles.exStrong}>{fmtDate(p.start_ts)}</Text>
            {p.active
              ? <> and is <Text style={{ color: c, fontWeight: '700' }}>still in play</Text> as of the latest bar.</>
              : <> to <Text style={styles.exStrong}>{fmtDate(p.end_ts)}</Text>.</>}
          </Text>
          {p.active ? (
            <Text style={[styles.exBody, { marginTop: 6 }]}>
              A measured move typically resolves over roughly the pattern's own span, so this one would be expected to
              play out by approximately <Text style={styles.exStrong}>{fmtDate(projTs)}</Text> — an estimate, not a
              deadline. It confirms only on a decisive close beyond the key level; until then it can still fail.
            </Text>
          ) : null}

          <Text style={styles.exSecTitle}>SUPPORT & RESISTANCE ZONES</Text>
          {bearish ? (
            <>
              {zoneRow('Resistance / key level', 'Neckline the price must hold below — a break above invalidates the setup', p.level, true)}
              {zoneRow('Support target', 'Measured-move objective on a confirmed breakdown', p.target, false)}
            </>
          ) : (
            <>
              {zoneRow('Resistance target', 'Measured-move objective on a confirmed breakout', p.target, true)}
              {zoneRow('Support / key level', 'Breakout base the price must hold above — a break below invalidates the setup', p.level, false)}
            </>
          )}
          {p.level == null && p.target == null ? (
            <Text style={styles.exBody}>Level data isn't available for this formation yet.</Text>
          ) : null}

          <Text style={styles.exDisc}>
            Chart patterns are probabilistic, not guarantees — confirmation, volume and broader context matter.
            Educational only, not investment advice.
          </Text>
        </ScrollView>
      </Sheet>
    ) : null}
    </>
  );
}

// ── Index-wide pattern screener ──────────────────────────────────────────────
// The inverse question to the single-stock recogniser: "which stocks in this
// index are showing a pattern right now?". The backend sweeps the index in the
// background and streams hits into the snapshot; we poll while it runs.
const SCREEN_INDICES = [
  'NIFTY 50', 'NIFTY 100', 'NIFTY 200', 'NIFTY BANK', 'NIFTY IT',
  'NIFTY MIDCAP 100', 'NIFTY SMALLCAP 100', 'NIFTY AUTO', 'NIFTY PHARMA',
];

// Full recogniser vocabulary for the filter dropdown (mirrors patterns.py
// _META), grouped by bias so the sheet doubles as a bullish/bearish filter.
const PATTERN_GROUPS: { title: string; labels: string[] }[] = [
  {
    title: 'Bullish',
    labels: ['Double Bottom', 'Triple Bottom', 'Inverse Head & Shoulders',
      'Ascending Triangle', 'Falling Wedge', 'Ascending Channel', 'Bull Flag',
      'Bull Pennant', 'Cup and Handle', 'Rounding Bottom', 'V-Bottom'],
  },
  {
    title: 'Bearish',
    labels: ['Double Top', 'Triple Top', 'Head and Shoulders',
      'Descending Triangle', 'Rising Wedge', 'Descending Channel', 'Bear Flag',
      'Bear Pennant', 'Rounding Top', 'V-Top'],
  },
  {
    title: 'Bilateral',
    labels: ['Symmetrical Triangle', 'Rectangle', 'Broadening Formation'],
  },
];

const SCREEN_COLS: Col[] = [
  { key: 'sno', label: '#', w: 36, align: 'right' },
  { key: 'symbol', label: 'SYMBOL', w: 118, align: 'left' },
  { key: 'cap', label: 'MKT CAP', w: 110, align: 'left' },
  { key: 'pattern', label: 'PATTERN', w: 178, align: 'left' },
  { key: 'bias', label: 'BIAS', w: 78, align: 'left' },
  { key: 'status', label: 'STATUS', w: 92, align: 'left' },
  { key: 'conf', label: 'PROBABILITY', w: 104, align: 'right' },
  { key: 'cont', label: 'CONTINUATION', w: 112, align: 'right' },
  { key: 'exp', label: 'TARGET %', w: 88, align: 'right' },
  { key: 'ended', label: 'DETECTED', w: 92, align: 'right' },
];
const SCREEN_TABLE_W = SCREEN_COLS.reduce((a, c) => a + c.w, 0);

function PatternIndexScreener({ onOpenSymbol }: { onOpenSymbol: (sym: string) => void }) {
  const [index, setIndex] = useState('NIFTY 50');
  const [snap, setSnap] = useState<PatternScreenResp | null>(null);
  const [error, setError] = useState('');
  const [patFilter, setPatFilter] = useState('');    // '' = all patterns; 'Bullish'/'Bearish' = bias groups
  const [patOpen, setPatOpen] = useState(false);
  const [sweep, setSweep] = useState(0);             // bump to restart the poll loop

  // Poll the sweep: immediately on index change / rescan, then every 4 s while
  // the backend is still sweeping.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    setError('');
    let misses = 0;
    const tick = async () => {
      try {
        const s = await api.patternsScreen(index);
        if (cancelled) return;
        misses = 0;
        setError('');
        setSnap(s);
        if (s.status === 'running' || s.refreshing) timer = setTimeout(tick, 4000);
      } catch (e) {
        if (cancelled) return;
        // Transient poll failures (mobile network blips, server busy) must not
        // wipe a sweep that's mid-flight — keep the last snapshot and retry.
        misses += 1;
        if (misses <= 5) {
          timer = setTimeout(tick, 6000);
        } else {
          setError(e instanceof Error ? e.message : 'Screen failed');
        }
      }
    };
    setSnap(null);
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [index, sweep]);

  const hits = snap?.results || [];
  const enrich = useEnrich(useMemo(() => hits.map((h) => h.symbol), [hits]));
  const biasGroup = patFilter === 'Bullish' || patFilter === 'Bearish';
  const shown = hits.filter((h) => {
    if (!patFilter) return true;
    if (biasGroup) return h.bias === patFilter.toLowerCase();
    return h.label === patFilter;
  });
  const running = snap?.status === 'running' || snap?.refreshing;

  const pickPat = (l: string) => {
    setPatFilter(l);
    setPatOpen(false);
  };

  return (
    <ScrollView contentContainerStyle={styles.body}>
      {/* one scrolling line of index chips — no wrap clutter */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.idxScroll} contentContainerStyle={styles.idxLine}>
        {SCREEN_INDICES.map((ix) => (
          <TouchableOpacity
            key={ix}
            style={[styles.perChip, index === ix && styles.perChipOn]}
            onPress={() => setIndex(ix)}
            activeOpacity={0.75}
          >
            <Text style={[styles.perTxt, index === ix && styles.perTxtOn]}>{ix.replace('NIFTY ', '')}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* one control line: pattern dropdown (default All) + rescan */}
      <View style={styles.ctlLine}>
        <TouchableOpacity style={[styles.perChip, !!patFilter && styles.perChipOn]} onPress={() => setPatOpen(true)} activeOpacity={0.75}>
          <Text style={[styles.perTxt, !!patFilter && styles.perTxtOn]}>{patFilter || 'All patterns'} ▾</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.perChip}
          onPress={() => {
            // Force a fresh sweep server-side, then restart the poll loop.
            api.patternsScreen(index, true).catch(() => {});
            setSweep((n) => n + 1);
          }}
          activeOpacity={0.75}
        >
          <Text style={styles.perTxt}>⟳ Rescan</Text>
        </TouchableOpacity>
      </View>

      {patOpen ? (
        <Sheet onClose={() => setPatOpen(false)} maxHeight="80%">
          <ScrollView bounces={false}>
            <SectionTitle>Filter by pattern</SectionTitle>
            {['', 'Bullish', 'Bearish'].map((l) => (
              <TouchableOpacity key={l || 'all'} style={styles.patOpt} onPress={() => pickPat(l)} activeOpacity={0.75}>
                <Text style={[styles.patOptTxt, patFilter === l && { color: theme.brand, fontWeight: '700' }]}>
                  {l ? `All ${l.toLowerCase()} patterns` : 'All patterns'}
                </Text>
              </TouchableOpacity>
            ))}
            {PATTERN_GROUPS.map((g) => (
              <View key={g.title}>
                <Text style={styles.patGroup}>{g.title.toUpperCase()}</Text>
                {g.labels.map((l) => (
                  <TouchableOpacity key={l} style={styles.patOpt} onPress={() => pickPat(l)} activeOpacity={0.75}>
                    <Text style={[styles.patOptTxt, patFilter === l && { color: theme.brand, fontWeight: '700' }]}>{l}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ))}
          </ScrollView>
        </Sheet>
      ) : null}

      {error && !snap ? <EmptyState icon="⚠" title="Couldn't screen" hint={`${error} — pull down or tap Rescan to retry.`} /> : null}
      {!error && !snap ? <Loading label={`Loading ${index} pattern screen…`} /> : null}
      {snap ? (
        <>
          <SectionTitle>
            {shown.length} hit{shown.length === 1 ? '' : 's'} · {index}
            {running ? ` · sweeping… ${snap.progress || ''}` : snap.asof ? ` · as of ${fmtDate(snap.asof)}` : ''}
            {snap.capped ? ' · first 260 constituents' : ''}
          </SectionTitle>
          {!running && snap.partial ? (
            <Text style={styles.partialNote}>
              The data feed rate-limited this sweep — only {snap.scanned_ok}/{snap.universe} stocks had price
              history. It retries automatically in a few minutes, or tap Rescan.
            </Text>
          ) : null}
          {snap.status === 'error' && !hits.length ? (
            <EmptyState icon="⚠" title="Sweep failed" hint={snap.error || 'Retry shortly.'} />
          ) : null}
          {shown.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ minWidth: '100%' }}>
              <View style={{ minWidth: SCREEN_TABLE_W }}>
                <View style={styles.headerRow}>
                  {SCREEN_COLS.map((c) => (
                    <Text key={c.key} style={[styles.th, { width: c.w, textAlign: c.align === 'left' ? 'left' : 'right' }]}>
                      {c.label}
                    </Text>
                  ))}
                </View>
                {shown.map((h, i) => (
                  <ScreenHitRow key={`${h.symbol}-${h.type}-${i}`} h={h} enr={enrich[h.symbol]} idx={i} top={i === 0} onPress={() => onOpenSymbol(h.symbol)} />
                ))}
              </View>
            </ScrollView>
          ) : !running ? (
            <EmptyState
              icon="◇"
              title={patFilter && hits.length ? `No ${patFilter} hits` : 'No fresh patterns'}
              hint={
                patFilter && hits.length
                  ? 'Other patterns were found — switch the dropdown back to All patterns to see them.'
                  : snap.partial
                    ? 'Most of this sweep was rate-limited by the data feed — tap Rescan to fill in the gaps.'
                    : 'No constituent shows a confident formation reaching into the last ~3 weeks. Try another index, or Rescan.'
              }
            />
          ) : (
            <Loading label={`Sweeping ${index}… hits appear as they're found`} />
          )}
          <Text style={styles.method}>
            Every constituent's last year of daily bars is scanned with the same geometric recogniser as the
            single-stock tab. Only formations reaching into the last ~2 weeks with probability ≥ 55 count as
            hits. Tap a row for the full chart. Indicative and educational only — not investment advice.
          </Text>
        </>
      ) : null}
    </ScrollView>
  );
}

function ScreenHitRow({ h, enr, idx, top, onPress }: { h: PatternScreenHit; enr?: Enrich; idx: number; top?: boolean; onPress: () => void }) {
  const c = biasColor(h.bias);
  return (
    <TouchableOpacity style={[styles.dataRow, top && { borderTopWidth: 0 }]} onPress={onPress} activeOpacity={0.75}>
      <Text style={[styles.cellNum, { width: 36, color: theme.muted }]}>{idx + 1}</Text>
      <View style={{ width: 118 }}>
        <Text style={styles.sym}>{h.symbol}</Text>
        {h.price != null ? <Text style={styles.priceSub}>₹{h.price.toLocaleString('en-IN')}</Text> : null}
      </View>
      <View style={{ width: 110, alignItems: 'flex-start' }}>
        <CapChip mcapCr={enr?.mcap} value />
      </View>
      <Text style={[styles.cellLeft, { width: 178 }]} numberOfLines={2}>{h.label}</Text>
      <Text style={[styles.cellLeft, { width: 78, color: c, fontWeight: '700' }]}>
        {h.bias === 'bullish' ? '▲ Bull' : h.bias === 'bearish' ? '▼ Bear' : '— Neut'}
      </Text>
      <Text style={[styles.cellLeft, { width: 92, color: h.status === 'confirmed' ? theme.green : theme.muted2 }]}>
        {h.status === 'confirmed' ? 'Confirmed' : 'Forming'}
      </Text>
      <View style={{ width: 104, alignItems: 'flex-end' }}>
        <Text style={styles.cellNum}>{h.confidence}%</Text>
        <Bar pct={h.confidence} color={c} />
      </View>
      <Text style={[styles.cellNum, { width: 112 }]}>{h.continuation != null ? `${h.continuation}%` : '—'}</Text>
      <Text style={[styles.cellNum, { width: 88, color: (h.expansion_pct ?? 0) >= 0 ? theme.green : theme.red }]}>
        {signPct(h.expansion_pct)}
      </Text>
      <Text style={[styles.cellNum, { width: 92 }]}>{fmtDate(h.end_ts ?? undefined)}</Text>
    </TouchableOpacity>
  );
}

export default function PatternScreen() {
  const [mode, setMode] = useState<'stock' | 'screen'>('stock');
  const [symbol, setSymbol] = useState('');
  const [period, setPeriod] = useState('2y');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState<ChartPatternsResp | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const [detail, setDetail] = useState<Row | null>(null);
  const [watch, setWatch] = useState<string[]>([]);
  const [flash, setFlash] = useState('');
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastQuery = useRef<{ sym: string; period: string } | null>(null);
  const { isDesktop } = useResponsive();

  const toast = useCallback((m: string) => {
    setFlash(m);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(''), 2200);
  }, []);

  useEffect(() => {
    loadWatchlist().then(setWatch).catch(() => {});
  }, []);

  useEffect(() => {
    AsyncStorage.getItem(RECENT_KEY)
      .then((v) => {
        const p = v ? JSON.parse(v) : null;
        if (Array.isArray(p)) setRecent(p.filter((s) => typeof s === 'string'));
      })
      .catch(() => {});
  }, []);
  const pushRecent = (sym: string) => {
    setRecent((prev) => {
      const next = [sym, ...prev.filter((s) => s !== sym)].slice(0, 8);
      AsyncStorage.setItem(RECENT_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  };

  const scan = useCallback((symOverride?: string, periodOverride?: string) => {
    const sym = (symOverride ?? symbol).trim().toUpperCase().replace(/^[A-Z]+:/, '');
    const per = periodOverride ?? period;
    if (!sym || busy) return;
    setSymbol(sym);
    setPeriod(per);
    setBusy(true);
    setError('');
    setData(null);
    pushRecent(sym);
    lastQuery.current = { sym, period: per };
    api
      .chartPatterns(sym, per)
      .then((r) => {
        if (r && !r.error) setData(r);
        else setError(r?.error || `No price history for ${sym}`);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Pattern scan failed'))
      .finally(() => setBusy(false));
  }, [symbol, period, busy]);

  // Auto-scan a symbol handed off from another screen (e.g. the Recommendations
  // "Pattern" button).
  useEffect(() => {
    const s = takeSymbol('patterns');
    if (s) scan(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chartCandles: Candle[] = (data?.candles || []).map((c) => ({
    t: c.t, o: c.o, h: c.h, l: c.l, c: c.c, v: 0,
  }));

  const cur = data?.current || null;
  const activeSym = (data?.symbol || symbol).trim().toUpperCase();

  const actions: CardActions = {
    watched: watch.includes(normSymbol(activeSym)),
    onChart: () => activeSym && setDetail({ sym: activeSym } as Row),
    onMultibagger: () => activeSym && navigate('analysis', { sub: 'mb', symbol: activeSym }),
    onInstitutional: () => activeSym && navigate('analysis', { sub: 'inst', symbol: activeSym }),
    onWatch: async () => {
      if (!activeSym) return;
      setWatch(await addSymbol(watch, activeSym));
      toast(`${activeSym} added to watchlist`);
    },
    onPortfolio: async () => {
      if (!activeSym) return;
      await AsyncStorage.setItem(PORTFOLIO_PREFILL_KEY, activeSym).catch(() => {});
      toast(`${activeSym} queued — open Lists ▸ Portfolio`);
    },
  };

  return (
    <View style={styles.container}>
      <View style={styles.modeRow}>
        <Segmented
          items={[
            { key: 'stock', label: 'One stock' },
            { key: 'screen', label: 'Index screener' },
          ]}
          value={mode}
          onChange={(k) => setMode(k as 'stock' | 'screen')}
        />
      </View>

      {mode === 'screen' ? (
        <PatternIndexScreener onOpenSymbol={(s) => setDetail({ sym: s } as Row)} />
      ) : (
      <>
      <View style={styles.inputRow}>
        <SymbolInput
          value={symbol}
          onChangeText={setSymbol}
          onSelect={(s) => scan(s)}
          onSubmit={() => scan()}
          placeholder="NSE symbol — e.g. RELIANCE, TCS, HDFCBANK…"
          inputStyle={styles.input}
          containerStyle={{ flex: 1 }}
        />
        <Btn label={busy ? 'Scanning…' : '⚏ Scan'} onPress={() => scan()} disabled={busy || !symbol.trim()} />
        <InfoButton title="Pattern Recogniser" content={PATTERN_INFO} style={styles.infoInline} />
      </View>

      <View style={styles.periodRow}>
        {PERIODS.map((p) => (
          <TouchableOpacity
            key={p.key}
            style={[styles.perChip, period === p.key && styles.perChipOn]}
            onPress={() => {
              setPeriod(p.key);
              if (lastQuery.current) scan(lastQuery.current.sym, p.key);
            }}
            activeOpacity={0.75}
          >
            <Text style={[styles.perTxt, period === p.key && styles.perTxtOn]}>{p.label}</Text>
          </TouchableOpacity>
        ))}
        {recent.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={styles.recentInner}>
            <Text style={styles.recentLabel}>RECENT</Text>
            {recent.map((s) => (
              <TouchableOpacity key={s} style={styles.recentChip} onPress={() => scan(s)} activeOpacity={0.75}>
                <Text style={styles.recentTxt}>{s}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        ) : null}
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {busy ? <Loading label={`Scanning ${symbol.toUpperCase()} for chart patterns…`} /> : null}
        {!busy && error ? <EmptyState icon="⚠" title="Couldn't scan" hint={error} /> : null}
        {!busy && !error && !data ? (
          <EmptyState
            icon="⚏"
            title="Pick a stock to scan"
            hint="Type any NSE symbol — the recogniser walks the whole history and lists every chart pattern it finds (double tops, head-and-shoulders, triangles, wedges, flags, cup-and-handle and more)."
          />
        ) : null}

        {data && !busy ? (
          <>
            {chartCandles.length ? (
              <Card style={styles.chartCard}>
                <HtmlView html={chartHtml(chartCandles, 86400)} style={styles.chart} />
              </Card>
            ) : null}

            {/* On desktop the table and the Current Pattern card sit side by
                side (the card fills the space that was blank); on mobile the
                card stacks above the table. */}
            <View style={isDesktop ? styles.split : undefined}>
              {!isDesktop && cur ? (
                <View style={{ marginBottom: theme.sp.md }}>
                  <CurrentCard p={cur} actions={actions} />
                </View>
              ) : null}
              <View style={isDesktop ? styles.splitMain : undefined}>
                <SectionTitle>
                  {data.count} pattern{data.count === 1 ? '' : 's'} found{data.bars ? ` · ${data.bars} bars` : ''}
                </SectionTitle>

                {data.patterns.length ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ minWidth: '100%' }}>
                    <View style={{ minWidth: TABLE_W }}>
                      <View style={styles.headerRow}>
                        {COLS.map((c) => (
                          <Text
                            key={c.key}
                            style={[styles.th, { width: c.w, textAlign: c.align === 'left' ? 'left' : 'right' }]}
                          >
                            {c.label}
                          </Text>
                        ))}
                      </View>
                      {data.patterns.map((p, i) => (
                        <PatternRow key={`${p.type}-${p.start_ts}-${i}`} p={p} top={i === 0} />
                      ))}
                    </View>
                  </ScrollView>
                ) : (
                  <EmptyState
                    icon="◇"
                    title="No clear chart patterns"
                    hint={data.note || 'The recogniser found no textbook formations in this window. Try a longer period.'}
                  />
                )}
              </View>

              {isDesktop && cur ? (
                <View style={styles.splitSide}>
                  <CurrentCard p={cur} actions={actions} />
                </View>
              ) : null}
            </View>

            <Text style={styles.method}>
              Patterns are detected geometrically from swing pivots and trend-line fits. “Probability” is how
              closely the price action matches the ideal shape; “continuation” is an indicative base-rate that
              price follows the pattern's implied direction; “expansion” is the measured-move target as a % of
              price. Indicative and educational only — not investment advice.
            </Text>
          </>
        ) : null}
      </ScrollView>
      </>
      )}

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
  modeRow: { paddingHorizontal: theme.sp.lg, paddingTop: theme.sp.sm, paddingBottom: theme.sp.xs },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.sm, paddingHorizontal: theme.sp.lg, paddingTop: theme.sp.sm, paddingBottom: theme.sp.sm, zIndex: 50 },
  infoInline: { alignSelf: 'center' },
  input: {
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.sm + 2,
    color: theme.text,
    paddingHorizontal: theme.sp.md,
    paddingVertical: 10,
    fontSize: theme.fs.md,
    fontFamily: theme.mono,
  },
  periodRow: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.sm, paddingHorizontal: theme.sp.lg, paddingBottom: theme.sp.sm },
  perChip: {
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: theme.sp.md,
    paddingVertical: 4,
    backgroundColor: theme.surface2,
  },
  perChipOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  perTxt: { color: theme.muted2, fontSize: theme.fs.sm, fontFamily: theme.mono },
  perTxtOn: { color: theme.onAccent, fontWeight: '700' },
  recentInner: { gap: theme.sp.sm, alignItems: 'center', paddingLeft: theme.sp.sm },
  recentLabel: { color: theme.muted, fontSize: theme.fs.xs + 1, fontWeight: '700', letterSpacing: 1 },
  recentChip: {
    backgroundColor: theme.surface2,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: theme.sp.md,
    paddingVertical: 4,
  },
  recentTxt: { color: theme.muted2, fontSize: theme.fs.sm, fontFamily: theme.mono, fontWeight: '700' },
  body: { paddingHorizontal: theme.sp.lg, paddingBottom: theme.sp.xl, gap: theme.sp.md },
  // index screener
  idxScroll: { flexGrow: 0 },
  idxLine: { flexDirection: 'row', gap: theme.sp.sm, alignItems: 'center', paddingRight: theme.sp.lg },
  ctlLine: { flexDirection: 'row', gap: theme.sp.sm, alignItems: 'center' },
  patOpt: { paddingVertical: theme.sp.sm },
  patOptTxt: { color: theme.text, fontSize: theme.fs.md },
  patGroup: { color: theme.muted, fontSize: theme.fs.xs, fontWeight: '800', letterSpacing: 1, marginTop: theme.sp.md, marginBottom: 2 },
  partialNote: { color: '#c9a45b', fontSize: theme.fs.sm, lineHeight: 18 },
  sym: { color: theme.text, fontSize: theme.fs.md, fontWeight: '800', fontFamily: theme.mono },
  priceSub: { color: theme.muted2, fontSize: theme.fs.xs + 1, fontFamily: theme.mono },
  cellLeft: { color: theme.muted2, fontSize: theme.fs.sm },
  cellNum: { color: theme.text, fontSize: theme.fs.sm, fontFamily: theme.mono, textAlign: 'right' },
  chartCard: { height: 240, padding: 0, overflow: 'hidden', marginTop: theme.sp.sm },
  chart: { flex: 1 },
  // desktop two-column split (table | current-pattern card)
  split: { flexDirection: 'row', gap: theme.sp.lg, alignItems: 'flex-start' },
  splitMain: { flex: 1, minWidth: 0 },
  splitSide: { width: 360 },
  // current-pattern detail card
  curCard: { borderWidth: 1, gap: theme.sp.sm },
  curHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  curKicker: { color: theme.muted, fontSize: theme.fs.xs + 1, fontWeight: '700', letterSpacing: 1 },
  curTitle: { color: theme.text, fontSize: theme.fs.xl, fontWeight: '800' },
  curTags: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.sm },
  curCat: { color: theme.muted, fontSize: theme.fs.sm },
  statePill: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  stateTxt: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5, fontFamily: theme.mono },
  probBlock: { gap: 4 },
  probLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  probPct: { color: theme.text, fontSize: theme.fs.md, fontWeight: '800', fontFamily: theme.mono },
  cGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: theme.sp.md, marginTop: 2 },
  cStat: { width: '50%', gap: 2 },
  cStatLabel: { color: theme.muted, fontSize: theme.fs.xs + 1 },
  cStatVal: { color: theme.text, fontSize: theme.fs.md, fontWeight: '700', fontFamily: theme.mono },
  // action buttons on the card
  actionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp.sm, marginTop: theme.sp.sm, borderTopColor: theme.border, borderTopWidth: 1, paddingTop: theme.sp.md },
  actBtn: {
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.sm + 2,
    paddingHorizontal: theme.sp.md,
    paddingVertical: theme.sp.sm,
  },
  actTxt: { color: theme.text, fontSize: theme.fs.sm, fontWeight: '700' },
  explainBtn: { borderColor: theme.border2 },
  // explain-pattern popup
  exHead: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: theme.sp.sm },
  exTitle: { color: theme.text, fontSize: theme.fs.xl, fontWeight: '800' },
  exX: { color: theme.muted, fontSize: 18, paddingHorizontal: 4 },
  exSecTitle: { color: theme.muted, fontSize: theme.fs.xs, fontWeight: '800', letterSpacing: 1.2, marginTop: theme.sp.lg, marginBottom: theme.sp.xs },
  exBody: { color: theme.text, fontSize: theme.fs.sm + 1, lineHeight: 20 },
  exStrong: { color: theme.text, fontWeight: '700', fontFamily: theme.mono },
  exDisc: { color: theme.muted, fontSize: theme.fs.xs + 1, lineHeight: 16, marginTop: theme.sp.lg, marginBottom: theme.sp.md },
  zoneRow: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.sm, paddingVertical: theme.sp.sm, borderBottomColor: theme.border, borderBottomWidth: 1 },
  zoneDot: { width: 8, height: 8, borderRadius: 4 },
  zoneRole: { color: theme.text, fontSize: theme.fs.sm + 1, fontWeight: '700' },
  zoneSub: { color: theme.muted, fontSize: theme.fs.xs + 1, lineHeight: 15, marginTop: 1 },
  zoneVal: { color: theme.text, fontSize: theme.fs.sm, fontWeight: '700', fontFamily: theme.mono, marginLeft: theme.sp.sm },
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
  },
  toastTxt: { color: theme.text, fontSize: theme.fs.sm + 1, fontWeight: '600' },
  // table
  headerRow: {
    flexDirection: 'row',
    borderBottomColor: theme.border2,
    borderBottomWidth: 1,
    backgroundColor: theme.surface2,
    paddingVertical: theme.sp.sm,
    paddingHorizontal: theme.sp.xs,
  },
  th: { color: theme.muted2, fontSize: theme.fs.xs + 1, fontWeight: '600', letterSpacing: 0.5, paddingHorizontal: theme.sp.xs },
  dataRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopColor: theme.border,
    borderTopWidth: 1,
    paddingVertical: theme.sp.sm,
    paddingHorizontal: theme.sp.xs,
    minHeight: 46,
  },
  currentRow: { backgroundColor: theme.surface },
  patName: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: theme.sp.xs },
  liveDot: { color: theme.green, fontSize: 9 },
  patLabel: { color: theme.text, fontSize: theme.fs.sm + 1, fontWeight: '700' },
  patMeta: { color: theme.muted, fontSize: theme.fs.xs + 1, paddingHorizontal: theme.sp.xs, marginTop: 1 },
  biasChip: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1, alignSelf: 'flex-start', marginHorizontal: theme.sp.xs },
  biasTxt: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5, fontFamily: theme.mono },
  cell: { color: theme.text, fontSize: theme.fs.sm, paddingHorizontal: theme.sp.xs, textAlign: 'right' },
  cellStrong: { color: theme.text, fontSize: theme.fs.sm, fontFamily: theme.mono, fontWeight: '700' },
  mono: { fontFamily: theme.mono },
  barTrack: { height: 4, width: '86%', borderRadius: 2, backgroundColor: theme.surface3, overflow: 'hidden', marginTop: 3 },
  barFill: { height: '100%', borderRadius: 2 },
  method: { color: theme.muted, fontSize: theme.fs.xs + 1, lineHeight: 16, marginTop: theme.sp.sm },
});
