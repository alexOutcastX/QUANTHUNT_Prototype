import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { IndexQuote, ScanRow, SectorLevel, api } from '../api';
import StockDetail from '../components/StockDetail';
import { Row } from '../screener';
import { EmptyState, Loading, ScreenTitle, Sheet } from '../ui';
import { navigate } from '../navIntent';
import { shortSector } from '../sectors';
import { theme } from '../theme';

// Day-change → tile colour. Neutral surface at 0%, saturating to full green /
// red by ±3% so the eye reads relative strength across a grid at a glance.
const NEUTRAL = { r: 0x14, g: 0x16, b: 0x1d };
const UP = { r: 0x22, g: 0xc9, b: 0x93 };
const DOWN = { r: 0xf4, g: 0x58, b: 0x7a };
function heatColor(chg?: number | null): string {
  if (chg == null || !isFinite(chg)) return theme.surface2;
  const t = Math.max(-1, Math.min(1, chg / 3));
  const tgt = t >= 0 ? UP : DOWN;
  const a = Math.abs(t);
  const mix = (x: number, y: number) => Math.round(x + (y - x) * a);
  return `rgb(${mix(NEUTRAL.r, tgt.r)},${mix(NEUTRAL.g, tgt.g)},${mix(NEUTRAL.b, tgt.b)})`;
}
// Readable text over a saturated tile: white on strong moves, muted near zero.
const inkFor = (chg?: number | null) =>
  chg != null && isFinite(chg) && Math.abs(chg) >= 1.2 ? '#ffffff' : theme.text;

const pct = (v?: number | null, d = 2) =>
  v == null || !isFinite(v) ? '—' : (v >= 0 ? '+' : '') + v.toFixed(d) + '%';
const fmtLevel = (v?: number | null) =>
  v == null || !isFinite(v) ? '—' : v.toLocaleString('en-IN', { maximumFractionDigits: 2 });

const CATS: { key: string; label: string }[] = [
  { key: 'sectors', label: 'Sectors' },
  { key: 'domestic', label: 'Indian indices' },
  { key: 'international', label: 'Global' },
  { key: 'depository', label: 'ADRs' },
];

// ── Squarified treemap layout (Bruls, Huizing & van Wijk) ─────────────────────
// Values are laid into `rect` so every tile's area is proportional to its value
// while aspect ratios stay close to 1. Pure geometry — returns pixel rects in
// input order.
type Rect = { x: number; y: number; w: number; h: number };
function squarify(values: number[], W: number, H: number): Rect[] {
  const out: Rect[] = values.map(() => ({ x: 0, y: 0, w: 0, h: 0 }));
  const total = values.reduce((s, v) => s + (v > 0 ? v : 0), 0);
  if (total <= 0 || W <= 0 || H <= 0) return out;
  const scale = (W * H) / total;
  const items = values.map((v, i) => ({ a: (v > 0 ? v : 0) * scale, i }));
  let x = 0, y = 0, w = W, h = H;
  let i = 0;
  const worst = (row: number[], side: number) => {
    const s = row.reduce((p, c) => p + c, 0);
    const mx = Math.max(...row), mn = Math.min(...row);
    const s2 = s * s, side2 = side * side;
    return Math.max((side2 * mx) / s2, s2 / (side2 * mn));
  };
  while (i < items.length) {
    const side = Math.min(w, h);
    const vertical = w >= h; // lay this row as a vertical strip on the left
    const row: number[] = [];
    const idx: number[] = [];
    let j = i;
    while (j < items.length) {
      const cand = [...row, items[j].a];
      if (row.length === 0 || worst(cand, side) <= worst(row, side)) {
        row.push(items[j].a);
        idx.push(items[j].i);
        j++;
      } else break;
    }
    const sum = row.reduce((p, c) => p + c, 0);
    const thick = sum / side || 0;
    if (vertical) {
      let oy = y;
      for (let k = 0; k < row.length; k++) {
        const hh = row[k] / thick || 0;
        out[idx[k]] = { x, y: oy, w: thick, h: hh };
        oy += hh;
      }
      x += thick;
      w -= thick;
    } else {
      let ox = x;
      for (let k = 0; k < row.length; k++) {
        const ww = row[k] / thick || 0;
        out[idx[k]] = { x: ox, y, w: ww, h: thick };
        ox += ww;
      }
      y += thick;
      h -= thick;
    }
    i = j;
  }
  return out;
}

type Node = { sym: string; chg: number | null; mcap: number | null; price: number | null };

// Session cache so re-opening the tab doesn't refetch the index list.
let idxCache: Record<string, IndexQuote[]> = {};

export default function HeatmapScreen() {
  const [cat, setCat] = useState('domestic');
  const [indices, setIndices] = useState<IndexQuote[]>(idxCache.domestic || []);
  const [loading, setLoading] = useState(!idxCache.domestic);
  const [err, setErr] = useState('');
  const [picked, setPicked] = useState<IndexQuote | null>(null);
  const [detail, setDetail] = useState<Row | null>(null);
  const [gridW, setGridW] = useState(0);

  // Load the index list for the active category (cached per category). The
  // 'sectors' category is a live aggregate (SectorMap), not an /indices list.
  useEffect(() => {
    if (cat === 'sectors') {
      setLoading(false);
      setErr('');
      return;
    }
    if (idxCache[cat]) {
      setIndices(idxCache[cat]);
      setLoading(false);
      setErr('');
      return;
    }
    let cancelled = false;
    setLoading(true);
    setErr('');
    api
      .indices(cat)
      .then((r) => {
        if (cancelled) return;
        const list = r.indices || [];
        idxCache[cat] = list;
        setIndices(list);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setErr(e instanceof Error ? e.message : 'Failed to load indices');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cat]);

  const openIndex = (q: IndexQuote) => setPicked(q);

  if (picked) {
    return (
      <IndexTreemap
        quote={picked}
        onBack={() => setPicked(null)}
        onPickStock={(n) =>
          setDetail({ sym: n.sym, name: n.sym, chg: n.chg, price: n.price } as Row)
        }
        detail={detail}
        clearDetail={() => setDetail(null)}
      />
    );
  }

  // Overview grid: one tile per index, coloured by day change.
  const cols = gridW ? Math.max(2, Math.min(6, Math.floor(gridW / 168))) : 2;
  const gap = 8;
  const tileW = gridW ? (gridW - gap * (cols - 1)) / cols : 0;

  return (
    <View style={styles.container}>
      <ScreenTitle
        title="Heatmap"
        sub="Sector & index day-change map · tap any tile to drill into its constituents"
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.catScroll} contentContainerStyle={styles.catRow}>
        {CATS.map((c) => (
          <TouchableOpacity
            key={c.key}
            style={[styles.catChip, cat === c.key && styles.catChipOn]}
            onPress={() => setCat(c.key)}
            activeOpacity={0.75}
          >
            <Text style={[styles.catTxt, cat === c.key && styles.catTxtOn]}>{c.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {cat === 'sectors' ? (
        <SectorMap />
      ) : (
      <ScrollView contentContainerStyle={styles.scrollPad}>
        {loading ? <Loading label="Loading live index levels…" /> : null}
        {!loading && err ? <EmptyState icon="⚠" title="Couldn't load indices" hint={err} /> : null}
        {!loading && !err && !indices.length ? (
          <EmptyState icon="◇" title="No indices" hint="Nothing to show for this category right now." />
        ) : null}

        {!loading && indices.length ? (
          <View style={styles.grid} onLayout={(e) => setGridW(e.nativeEvent.layout.width)}>
            {gridW
              ? indices.map((q) => (
                  <TouchableOpacity
                    key={q.key}
                    style={[styles.tile, { width: tileW, backgroundColor: heatColor(q.chg) }]}
                    onPress={() => openIndex(q)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.tileName, { color: inkFor(q.chg) }]} numberOfLines={2}>
                      {q.name}
                    </Text>
                    <Text style={[styles.tileChg, { color: inkFor(q.chg) }]}>{pct(q.chg)}</Text>
                    <Text style={[styles.tileLevel, { color: inkFor(q.chg) }]}>
                      {fmtLevel(q.level)} · 1Y {pct(q.y1, 1)}
                    </Text>
                  </TouchableOpacity>
                ))
              : null}
          </View>
        ) : null}

        {!loading && indices.length ? <Legend /> : null}
      </ScrollView>
      )}

      {cat !== 'sectors' && detail ? (
        <StockDetail row={detail} onClose={() => setDetail(null)} />
      ) : null}
    </View>
  );
}

// ── Sectoral heatmap: every constituent of a broad NSE universe mapped to its
// sector, tiles coloured by the (cap-weighted) sector day-change. Tapping a
// sector opens a picker that routes into Recommendations / Momentum / Multibagger
// with that sector pre-filtered and the scan auto-running. Data is the server's
// full NSE+BSE sector aggregate (/sectors) — computed as a by-product of the
// multibagger universe sweep, so the whole listed market is covered.
type SecRow = { sector: string; count: number; mcap: number | null; chg: number | null; parent?: string };
type SecSnap = { rows: SecRow[]; asof: number; universe: number; mapped: number };
// Cache one snapshot per classification level so flipping the toggle back is instant.
const sectorCache: Partial<Record<SectorLevel, SecSnap>> = {};

// The heatmap's classification-depth toggle. Screeners only understand the 22
// macro sectors; the finer levels are for exploration and route via the tile's
// parent macro sector.
const LEVELS: { key: SectorLevel; label: string }[] = [
  { key: 'macro', label: 'Sector' },
  { key: 'industry', label: 'Industry' },
  { key: 'basic', label: 'Sub-industry' },
];

const SCREEN_ROUTES: { sub: string; label: string; icon: string; hint: string }[] = [
  { sub: 'reco', label: 'Recommendations', icon: '◆', hint: 'Long-term buy setups in this sector' },
  { sub: 'momentum', label: 'Momentum', icon: '▲', hint: 'Breakout & trend radar in this sector' },
  { sub: 'mb', label: 'Multibagger', icon: '◈', hint: 'Multibagger candidates in this sector' },
];

function SectorMap() {
  const [level, setLevel] = useState<SectorLevel>('macro');
  const [rows, setRows] = useState<SecRow[]>(sectorCache.macro?.rows || []);
  const [meta, setMeta] = useState<{ asof: number; universe: number; mapped: number }>({
    asof: sectorCache.macro?.asof || 0,
    universe: sectorCache.macro?.universe || 0,
    mapped: sectorCache.macro?.mapped || 0,
  });
  const [loading, setLoading] = useState(!sectorCache.macro);
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [gridW, setGridW] = useState(0);
  const [pick, setPick] = useState<SecRow | null>(null);
  const token = useRef(0);

  useEffect(() => {
    const my = ++token.current;
    let cancelled = false;
    const cached = sectorCache[level];
    // Flip to whatever is cached for this level immediately; still refetch so
    // day-changes stay live.
    setErr('');
    if (cached) {
      setRows(cached.rows);
      setMeta({ asof: cached.asof, universe: cached.universe, mapped: cached.mapped });
      setLoading(false);
    } else {
      setRows([]);
      setLoading(true);
    }
    (async () => {
      try {
        let snap = await api.sectors(level);
        if (cancelled || token.current !== my) return;
        // The aggregate is a by-product of the universe sweep: while it runs,
        // poll so tiles fill in; serve whatever is mapped so far immediately.
        const toRows = (s: typeof snap): SecRow[] =>
          (s.sectors || []).map((x) => ({
            sector: x.sector,
            count: x.count,
            mcap: x.market_cap_cr ?? null,
            chg: x.chg ?? null,
            parent: x.parent,
          }));
        const apply = (s: typeof snap) => {
          const rs = toRows(s);
          setRows(rs);
          setMeta({ asof: s.asof, universe: s.universe, mapped: s.mapped });
          if (rs.length) setLoading(false);
        };
        apply(snap);
        let guard = 0;
        while (!cancelled && snap.status === 'running' && guard < 60) {
          setNote(`Sweeping the market… ${snap.progress || ''}`);
          await new Promise((r) => setTimeout(r, 4000));
          if (cancelled || token.current !== my) return;
          snap = await api.sectors(level);
          apply(snap);
          guard++;
        }
        if (cancelled || token.current !== my) return;
        setNote('');
        setLoading(false);
        if (snap.status === 'error' && !snap.sectors?.length) {
          setErr(snap.error || 'Sector sweep failed — try again shortly.');
        } else {
          sectorCache[level] = {
            rows: toRows(snap),
            asof: snap.asof,
            universe: snap.universe,
            mapped: snap.mapped,
          };
        }
      } catch (e) {
        if (cancelled || token.current !== my) return;
        setErr(e instanceof Error ? e.message : 'Failed to load the sector map');
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      token.current++;
    };
  }, [level]);

  // Biggest count first, always showing whatever buckets the server returned.
  const sectorRows = useMemo(
    () => [...rows].filter((r) => r.count > 0).sort((a, b) => b.count - a.count),
    [rows],
  );

  const cols = gridW ? Math.max(2, Math.min(5, Math.floor(gridW / 150))) : 2;
  const gap = 8;
  const tileW = gridW ? (gridW - gap * (cols - 1)) / cols : 0;

  // At the macro level the label IS the macro sector; at finer levels route via
  // the tile's parent macro sector (the only thing the screeners understand).
  const route = (sub: string) => {
    const p = pick;
    setPick(null);
    const macro = p?.parent || p?.sector;
    if (macro) navigate('analysis', { sub, sector: macro });
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.scrollPad}>
        {loading ? <Loading label="Building the NSE + BSE sector map…" /> : null}
        {!loading && err ? <EmptyState icon="⚠" title="Couldn't build sector map" hint={err} /> : null}
        {!loading && !err ? (
          <>
            <View style={styles.levelRow}>
              {LEVELS.map((l) => (
                <TouchableOpacity
                  key={l.key}
                  style={[styles.levelChip, level === l.key && styles.levelChipOn]}
                  onPress={() => setLevel(l.key)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.levelTxt, level === l.key && styles.levelTxtOn]}>{l.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.drillNote}>
              Full NSE + BSE · {meta.mapped.toLocaleString('en-IN')} stocks across{' '}
              {sectorRows.length} {level === 'macro' ? 'sectors' : level === 'industry' ? 'industries' : 'sub-industries'} ·
              tiles coloured by value-weighted day change{note ? ` · ${note}` : ''}
            </Text>
            <Text style={styles.secHint}>
              {level === 'macro'
                ? 'Tap a sector to screen it — Recommendations, Momentum or Multibagger.'
                : 'Tap any tile to screen its parent sector — Recommendations, Momentum or Multibagger.'}
            </Text>
            <View style={styles.grid} onLayout={(e) => setGridW(e.nativeEvent.layout.width)}>
              {gridW && sectorRows.length
                ? sectorRows.map((r) => (
                    <TouchableOpacity
                      key={r.sector}
                      style={[styles.secTile, { width: tileW, backgroundColor: heatColor(r.chg) }]}
                      onPress={() => setPick(r)}
                      activeOpacity={0.85}
                    >
                      <Text style={[styles.secTileName, { color: inkFor(r.chg) }]} numberOfLines={2}>
                        {level === 'macro' ? shortSector(r.sector) : r.sector}
                      </Text>
                      <Text style={[styles.secTileChg, { color: inkFor(r.chg) }]}>{pct(r.chg)}</Text>
                      <Text style={[styles.secTileMeta, { color: inkFor(r.chg) }]}>{r.count} stocks</Text>
                    </TouchableOpacity>
                  ))
                : !loading && !sectorRows.length ? (
                    <Text style={styles.drillNote}>Mapping sectors…</Text>
                  ) : null}
            </View>
            {sectorRows.length ? <Legend /> : null}
          </>
        ) : null}
      </ScrollView>

      {pick ? (
        <Sheet onClose={() => setPick(null)} maxHeight="70%">
          <View style={styles.pickHead}>
            <View style={{ flex: 1 }}>
              <Text style={styles.pickTitle}>{pick.sector}</Text>
              <Text style={styles.pickSub}>
                {pick.count} stocks · avg {pct(pick.chg)} today
                {level !== 'macro' && pick.parent ? ` · in ${pick.parent}` : ''}
              </Text>
            </View>
            <TouchableOpacity onPress={() => setPick(null)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={styles.pickX}>✕</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.pickLabel}>
            {level === 'macro' ? 'SCREEN THIS SECTOR VIA' : `SCREEN ${(pick.parent || pick.sector).toUpperCase()} VIA`}
          </Text>
          {SCREEN_ROUTES.map((s) => (
            <TouchableOpacity key={s.sub} style={styles.pickAct} activeOpacity={0.8} onPress={() => route(s.sub)}>
              <Text style={styles.pickActTxt}>{s.icon}  {s.label}</Text>
              <Text style={styles.pickActSub}>{s.hint}</Text>
            </TouchableOpacity>
          ))}
          <Text style={styles.pickDisc}>
            Opens the chosen screener with the {pick.parent || pick.sector} sector filter applied and its scan
            auto-running.{level !== 'macro' ? ` Screeners filter by the 22 macro sectors, so "${pick.sector}" screens under ${pick.parent || pick.sector}.` : ''}
            {' '}Educational only — not investment advice.
          </Text>
        </Sheet>
      ) : null}
    </View>
  );
}

// ── Drill-in: constituent treemap sized by market cap, coloured by day change ─
function IndexTreemap({
  quote,
  onBack,
  onPickStock,
  detail,
  clearDetail,
}: {
  quote: IndexQuote;
  onBack: () => void;
  onPickStock: (n: Node) => void;
  detail: Row | null;
  clearDetail: () => void;
}) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [boxW, setBoxW] = useState(0);
  const token = useRef(0);

  useEffect(() => {
    const my = ++token.current;
    setLoading(true);
    setErr('');
    setNodes([]);
    setNote('Fetching constituents…');
    (async () => {
      try {
        const res = await api.indexConstituents(quote.name);
        if (token.current !== my) return;
        const data = res.data || [];
        if (!data.length) {
          setErr(res.error || `No constituent list available for ${quote.name}.`);
          setLoading(false);
          return;
        }
        let rows: Node[] = data.map((d) => ({
          sym: d.symbol,
          chg: d.chg ?? null,
          mcap: null,
          price: d.price ?? null,
        }));
        setNodes(rows);
        setLoading(false);
        const syms = rows.map((r) => r.sym);
        // Size by market cap (needs /fundamentals/bulk) …
        api
          .fundamentalsBulk(syms)
          .then((fb) => {
            if (token.current !== my || !fb.data) return;
            setNodes((prev) =>
              prev.map((r) => {
                const f = fb.data[r.sym] as Record<string, unknown> | undefined;
                const m = f && typeof f.market_cap_cr === 'number' ? (f.market_cap_cr as number) : r.mcap;
                return { ...r, mcap: m };
              }),
            );
          })
          .catch(() => {});
        // … and colour by live day change (the /index feed is often null on
        // cloud IPs, so backfill via the scan stream).
        setNote(`Loading live changes for ${syms.length} constituents…`);
        api
          .scan(syms, {
            onBatch: (sd: Record<string, ScanRow>, done: number, total: number) => {
              if (token.current !== my) return;
              setNodes((prev) =>
                prev.map((r) => {
                  const s = sd[r.sym];
                  return s && typeof s.chg === 'number'
                    ? { ...r, chg: s.chg, price: s.price ?? r.price }
                    : r;
                }),
              );
              setNote(`Live changes ${Math.min(done, total)}/${total}`);
            },
          })
          .then(() => {
            if (token.current === my) setNote('');
          })
          .catch(() => {
            if (token.current === my) setNote('');
          });
      } catch (e) {
        if (token.current !== my) return;
        setErr(e instanceof Error ? e.message : 'Failed to load constituents');
        setLoading(false);
      }
    })();
    return () => {
      token.current++;
    };
  }, [quote.name]);

  // Sort biggest-first so the treemap places large caps top-left. Fall back to
  // equal weighting until market caps arrive.
  const ordered = useMemo(() => {
    const anyMcap = nodes.some((n) => n.mcap && n.mcap > 0);
    return [...nodes].sort((a, b) => (b.mcap || 0) - (a.mcap || 0)).map((n) => ({
      ...n,
      _w: anyMcap ? (n.mcap && n.mcap > 0 ? n.mcap : 1) : 1,
    }));
  }, [nodes]);

  const boxH = 520;
  const rects = useMemo(
    () => (boxW ? squarify(ordered.map((n) => n._w), boxW, boxH) : []),
    [ordered, boxW],
  );

  return (
    <View style={styles.container}>
      <View style={styles.drillHeader}>
        <TouchableOpacity onPress={onBack} hitSlop={10} activeOpacity={0.75}>
          <Text style={styles.back}>‹ Heatmap</Text>
        </TouchableOpacity>
        <View style={styles.drillTitleWrap}>
          <Text style={styles.drillTitle} numberOfLines={1}>{quote.name}</Text>
          <Text style={[styles.drillChg, { color: quote.chg >= 0 ? theme.green : theme.red }]}>
            {fmtLevel(quote.level)} · {pct(quote.chg)}
          </Text>
        </View>
        <View style={{ width: 66 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollPad}>
        {loading ? <Loading label={`Loading ${quote.name} constituents…`} /> : null}
        {!loading && err ? (
          <EmptyState icon="◇" title="No treemap" hint={err} />
        ) : null}

        {!loading && !err && ordered.length ? (
          <>
            <Text style={styles.drillNote}>
              {ordered.length} constituents · tiles sized by market cap, coloured by day change
              {note ? ` · ${note}` : ''}
            </Text>
            <View
              style={[styles.treebox, { height: boxH }]}
              onLayout={(e) => setBoxW(e.nativeEvent.layout.width)}
            >
              {boxW
                ? ordered.map((n, k) => {
                    const r = rects[k];
                    if (!r || r.w <= 0 || r.h <= 0) return null;
                    const showSym = r.w > 40 && r.h > 22;
                    const showChg = r.w > 46 && r.h > 40;
                    return (
                      <TouchableOpacity
                        key={n.sym}
                        onPress={() => onPickStock(n)}
                        activeOpacity={0.85}
                        style={[
                          styles.cell,
                          {
                            left: r.x,
                            top: r.y,
                            width: r.w,
                            height: r.h,
                            backgroundColor: heatColor(n.chg),
                          },
                        ]}
                      >
                        {showSym ? (
                          <Text style={[styles.cellSym, { color: inkFor(n.chg) }]} numberOfLines={1}>
                            {n.sym}
                          </Text>
                        ) : null}
                        {showChg ? (
                          <Text style={[styles.cellChg, { color: inkFor(n.chg) }]} numberOfLines={1}>
                            {pct(n.chg, 1)}
                          </Text>
                        ) : null}
                      </TouchableOpacity>
                    );
                  })
                : null}
            </View>
            <Legend />
          </>
        ) : null}
      </ScrollView>

      {detail ? <StockDetail row={detail} onClose={clearDetail} /> : null}
    </View>
  );
}

function Legend() {
  const stops = [-3, -1.5, 0, 1.5, 3];
  return (
    <View style={styles.legend}>
      <Text style={styles.legendTxt}>−3%</Text>
      {stops.map((s) => (
        <View key={s} style={[styles.legendSwatch, { backgroundColor: heatColor(s) }]} />
      ))}
      <Text style={styles.legendTxt}>+3%</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  catScroll: { flexGrow: 0, flexShrink: 0 },
  catRow: { flexDirection: 'row', gap: theme.sp.sm, paddingHorizontal: theme.sp.lg, paddingBottom: theme.sp.sm, alignItems: 'center' },
  catChip: {
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: theme.sp.md,
    paddingVertical: 5,
    backgroundColor: theme.surface2,
  },
  catChipOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  catTxt: { color: theme.muted2, fontSize: theme.fs.sm },
  catTxtOn: { color: theme.onAccent, fontWeight: '700' },
  scrollPad: { padding: theme.sp.lg, gap: theme.sp.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: {
    borderRadius: theme.radius.sm + 2,
    borderColor: theme.border,
    borderWidth: 1,
    padding: theme.sp.md,
    minHeight: 92,
    justifyContent: 'space-between',
  },
  tileName: { fontSize: theme.fs.sm, fontWeight: '700' },
  tileChg: { fontSize: theme.fs.xl, fontWeight: '800', fontFamily: theme.mono },
  tileLevel: { fontSize: theme.fs.xs + 1, fontFamily: theme.mono, opacity: 0.9 },
  // drill-in
  drillHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.sp.lg,
    paddingVertical: theme.sp.md - 2,
    borderBottomColor: theme.border,
    borderBottomWidth: 1,
  },
  back: { color: theme.text, fontSize: theme.fs.md + 1, width: 66 },
  drillTitleWrap: { flex: 1, alignItems: 'center' },
  drillTitle: { color: theme.text, fontSize: theme.fs.md + 1, fontWeight: '800' },
  drillChg: { fontSize: theme.fs.sm, fontFamily: theme.mono, marginTop: 1 },
  drillNote: { color: theme.muted, fontSize: theme.fs.sm },
  treebox: {
    position: 'relative',
    width: '100%',
    backgroundColor: theme.surface,
    borderRadius: theme.radius.sm,
    overflow: 'hidden',
  },
  cell: {
    position: 'absolute',
    borderColor: theme.bg,
    borderWidth: 1,
    padding: 3,
    justifyContent: 'center',
  },
  cellSym: { fontSize: theme.fs.xs + 1, fontWeight: '800', fontFamily: theme.mono },
  cellChg: { fontSize: theme.fs.xs, fontFamily: theme.mono, marginTop: 1 },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'center', paddingTop: theme.sp.sm },
  legendTxt: { color: theme.muted, fontSize: theme.fs.xs + 1, fontFamily: theme.mono },
  legendSwatch: { width: 22, height: 12, borderRadius: 2 },
  // sectoral heatmap
  levelRow: { flexDirection: 'row', gap: theme.sp.sm, alignSelf: 'flex-start' },
  levelChip: {
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: theme.sp.md,
    paddingVertical: 5,
    backgroundColor: theme.surface2,
  },
  levelChipOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  levelTxt: { color: theme.muted2, fontSize: theme.fs.sm },
  levelTxtOn: { color: theme.onAccent, fontWeight: '700' },
  secHint: { color: theme.muted2, fontSize: theme.fs.sm },
  secTile: {
    borderRadius: theme.radius.sm + 2,
    borderColor: theme.border,
    borderWidth: 1,
    padding: theme.sp.md,
    minHeight: 86,
    justifyContent: 'space-between',
  },
  secTileName: { fontSize: theme.fs.sm, fontWeight: '800' },
  secTileChg: { fontSize: theme.fs.lg, fontWeight: '800', fontFamily: theme.mono },
  secTileMeta: { fontSize: theme.fs.xs + 1, fontFamily: theme.mono, opacity: 0.9 },
  // sector → screen picker
  pickHead: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: theme.sp.sm },
  pickTitle: { color: theme.text, fontSize: theme.fs.lg, fontWeight: '800' },
  pickSub: { color: theme.muted, fontSize: theme.fs.sm, marginTop: 2 },
  pickX: { color: theme.muted, fontSize: 18, paddingHorizontal: 4 },
  pickLabel: { color: theme.muted, fontSize: theme.fs.xs, fontWeight: '700', letterSpacing: 1, marginTop: theme.sp.sm, marginBottom: theme.sp.sm },
  pickAct: {
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.sp.lg,
    paddingVertical: theme.sp.md,
    marginBottom: theme.sp.sm,
    backgroundColor: theme.surface2,
  },
  pickActTxt: { color: theme.text, fontSize: theme.fs.md + 1, fontWeight: '700' },
  pickActSub: { color: theme.muted, fontSize: theme.fs.sm, marginTop: 2 },
  pickDisc: { color: theme.muted, fontSize: theme.fs.xs + 1, lineHeight: 16, marginTop: theme.sp.sm },
});
