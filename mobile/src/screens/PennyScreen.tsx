// Penny stocks — the low-priced segment, graded rather than merely listed.
//
// Two columns do the work here: LIQUIDITY (could you sell this?) and RISK (is
// there a business under the price?). A screen that ranked purely by "cheapest
// first" would put the most dangerous scrips on top, so the default sort leads
// with what you can actually trade. Nothing is hidden — an illiquid shell still
// appears, labelled as one.
import React, { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { PennyLiquidity, PennyResp, PennyRiskGrade, PennyRow, api } from '../api';
import { Card, ChipBtn, Dropdown, EmptyState, ErrorState, Loading, SectionTitle, Sheet, StatTile } from '../ui';
import { theme } from '../theme';
import { navigate, openStock } from '../navIntent';
import { addSymbol, loadWatchlist, normSymbol, removeSymbol } from '../watchlist';

const money = (v?: number | null, d = 2) =>
  v == null || !isFinite(v) ? '—' : '₹' + v.toLocaleString('en-IN', { maximumFractionDigits: d });
const pct = (v?: number | null, d = 1) =>
  v == null || !isFinite(v) ? '—' : (v >= 0 ? '+' : '') + v.toFixed(d) + '%';
// Traded value reads in crore above ₹1cr and lakh below it. Keep a decimal in
// the lakh range — the difference between ₹1.4L and ₹9L a day is the difference
// between untradeable and merely bad, and rounding it away hides that.
const cr = (v?: number | null) => {
  if (v == null || !isFinite(v)) return '—';
  if (v >= 1) return `₹${v.toFixed(1)}cr`;
  const lakh = v * 100;
  return `₹${lakh >= 10 ? lakh.toFixed(0) : lakh.toFixed(1)}L`;
};

const RISK_COLOR: Record<PennyRiskGrade, string> = {
  moderate: theme.green,
  elevated: theme.brand,
  high: theme.red,
  extreme: theme.red,
};
const RISK_LABEL: Record<PennyRiskGrade, string> = {
  moderate: 'MODERATE RISK',
  elevated: 'ELEVATED RISK',
  high: 'HIGH RISK',
  extreme: 'EXTREME RISK',
};
const LIQ_COLOR: Record<PennyLiquidity, string> = {
  tradeable: theme.green,
  thin: theme.muted2,
  illiquid: theme.red,
  unknown: theme.muted,
};
const LIQ_LABEL: Record<PennyLiquidity, string> = {
  tradeable: 'TRADEABLE',
  thin: 'THIN',
  illiquid: 'ILLIQUID',
  unknown: 'NO TRADES',
};

const FLOORS: { key: string; label: string; v: number }[] = [
  { key: 'any', label: 'Any volume', v: 0 },
  { key: 'l25', label: '₹25L+/day', v: 25_00_000 },
  { key: 'c1', label: '₹1cr+/day', v: 1_00_00_000 },
  { key: 'c2', label: '₹2cr+/day', v: 2_00_00_000 },
];
const RISKS: { key: string; label: string }[] = [
  { key: 'any', label: 'All risk levels' },
  { key: 'elevated', label: 'Elevated or safer' },
  { key: 'moderate', label: 'Moderate only' },
];

export default function PennyScreen() {
  const [data, setData] = useState<PennyResp | null>(null);
  const [band, setBand] = useState('under10');
  const [floor, setFloor] = useState('any');
  const [risk, setRisk] = useState('any');
  const [open, setOpen] = useState<string | null>(null);
  const [watch, setWatch] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setBusy(true);
    setErr('');
    try {
      setData(
        await api.pennyScreen({
          band,
          minTurnover: FLOORS.find((f) => f.key === floor)?.v || 0,
          maxRisk: risk === 'any' ? undefined : risk,
        }),
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not run the penny screen');
    } finally {
      setBusy(false);
    }
  }, [band, floor, risk]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadWatchlist().then(setWatch).catch(() => {});
  }, []);

  const toggleWatch = useCallback(async (sym: string) => {
    const s = normSymbol(sym);
    setWatch(watch.includes(s) ? await removeSymbol(watch, s) : await addSymbol(watch, sym));
  }, [watch]);

  if (!data && busy) return <Loading label="Screening the low-priced segment" />;
  if (!data && err) return <ErrorState title="Could not run the penny screen" detail={err} onRetry={load} />;

  const rows = data?.rows || [];
  const g = data?.grades || {};
  const risky = (g.high || 0) + (g.extreme || 0);

  return (
    <ScrollView
      contentContainerStyle={styles.body}
      refreshControl={<RefreshControl refreshing={busy} onRefresh={load} tintColor={theme.muted2} />}
    >
      {/* What this segment actually is. Stated once, up front, not buried. */}
      <Card style={styles.warn}>
        <Text style={styles.warnHead}>Read this before you use this screen</Text>
        <Text style={styles.warnTxt}>
          A low share price tells you nothing about value — only about how many shares exist. This is
          the part of the market where most retail money is lost: shells with no revenue, scrips moved
          by operators, and counters you cannot sell once they lock in a circuit. The two columns that
          matter are <Text style={styles.warnB}>liquidity</Text> and <Text style={styles.warnB}>risk</Text>,
          and both are shown on every row. Nothing here is a recommendation.
        </Text>
      </Card>

      <View style={styles.controls}>
        <Dropdown
          label="Price band"
          value={band}
          onChange={setBand}
          options={(data?.bands || []).map((b) => ({ key: b.key, label: b.label }))}
          style={{ flex: 1, minWidth: 150 }}
        />
      </View>
      <View style={styles.filters}>
        {FLOORS.map((f) => (
          <ChipBtn key={f.key} label={f.label} on={floor === f.key} onPress={() => setFloor(f.key)} />
        ))}
      </View>
      <View style={styles.filters}>
        {RISKS.map((r) => (
          <ChipBtn key={r.key} label={r.label} on={risk === r.key} onPress={() => setRisk(r.key)} />
        ))}
      </View>

      {data?.band_note ? <Text style={styles.bandNote}>{data.band_note}</Text> : null}

      <View style={styles.tiles}>
        <StatTile label="Matches" value={String(data?.matches ?? 0)} sub={`of ${data?.in_band ?? 0} in band`} />
        <StatTile
          label="Tradeable"
          value={String(data?.liquidity_mix?.tradeable ?? 0)}
          sub={`${data?.liquidity_mix?.illiquid ?? 0} illiquid`}
          color={theme.green}
        />
        <StatTile
          label="High/extreme risk"
          value={String(risky)}
          sub={`${g.moderate ?? 0} moderate`}
          color={risky ? theme.red : theme.muted2}
        />
        <StatTile
          label="With fundamentals"
          value={String(data?.with_fundamentals ?? 0)}
          sub={`of ${rows.length} shown`}
        />
      </View>

      {err ? <Text style={styles.err}>{err}</Text> : null}
      {data?.warming ? (
        <Text style={styles.notice}>The universe is still loading from the exchange — pull to refresh in a moment.</Text>
      ) : null}
      {data?.truncated ? (
        <Text style={styles.notice}>
          Showing the first {data.count} of {data.matches} matches, most tradeable first. Tighten the
          volume floor or the risk cap to narrow it.
        </Text>
      ) : null}

      {!rows.length ? (
        <EmptyState
          icon="◎"
          title="Nothing matches"
          hint="No scrip in this price band clears the volume floor and risk cap you've set. Loosening the volume floor will show more — and most of what appears will be untradeable."
        />
      ) : (
        <>
          <SectionTitle>{rows.length} stocks</SectionTitle>
          <Text style={styles.tHint}>Tap a column to sort · tap a row for the full card</Text>
          <PennyTable rows={rows} onOpen={setOpen} />
        </>
      )}

      {open && rows.find((x) => x.symbol === open) ? (
        <PennyDetail
          r={rows.find((x) => x.symbol === open) as PennyRow}
          watched={watch.includes(normSymbol(open))}
          onClose={() => setOpen(null)}
          onWatch={() => toggleWatch(open)}
        />
      ) : null}

      {data ? (
        <Text style={styles.note}>
          Price, day change and traded value come from the exchange's own daily bhavcopy; the
          fundamentals are whatever has been cached for that scrip — and where nothing has been
          published, the row says so, because for a stock this cheap that silence is itself the
          finding. Liquidity is graded on traded value: {cr(data.thresholds.tradeable / 1e7)}+ a day
          reads as tradeable, {cr(data.thresholds.thin / 1e7)}+ as thin, below that as illiquid. The
          risk score counts warnings, so a HIGH number means more danger, not more opportunity — the
          reverse of every other score in the app. Research only, not investment advice.
        </Text>
      ) : null}
    </ScrollView>
  );
}

// ── Sortable table ───────────────────────────────────────────────────────────
// The same shape as the Custom / Multibagger / Momentum screens: a header you
// can sort by, a horizontally scrolling body, and a symbol that opens the
// detail sheet. The card list this replaces could not be ordered by anything —
// on a screen whose whole point is "which of these can I actually sell", not
// being able to sort by traded value was the main defect.
//
// Liquidity and risk stay as coloured words rather than becoming bare numbers:
// they are the two columns that matter here, and "TRADEABLE" reads faster than
// a turnover figure the reader has to grade for themselves. They still sort,
// on the underlying order.
type PCol = {
  key: string;
  label: string;
  w: number;
  align?: 'left' | 'right';
  val: (r: PennyRow) => number | string | null;
  render: (r: PennyRow, i: number) => React.ReactNode;
};

const LIQ_ORDER: Record<PennyLiquidity, number> = { tradeable: 3, thin: 2, illiquid: 1, unknown: 0 };
const RISK_ORDER: Record<PennyRiskGrade, number> = { moderate: 3, elevated: 2, high: 1, extreme: 0 };

const numCell = (v: number | null | undefined, fmt: (n: number) => string, color?: string) => (
  <Text style={[styles.tCell, { textAlign: 'right' }, color ? { color } : null]}>
    {v == null || !isFinite(v) ? '\u2014' : fmt(v)}
  </Text>
);

const PCOLS: PCol[] = [
  { key: 'sno', label: '#', w: 38, align: 'right', val: () => null,
    render: (_r, i) => <Text style={[styles.tCell, styles.tMuted, { textAlign: 'right' }]}>{i + 1}</Text> },
  { key: 'symbol', label: 'Symbol', w: 116, val: (r) => r.symbol,
    render: (r) => <Text style={styles.tSym} numberOfLines={1}>{r.symbol}</Text> },
  { key: 'name', label: 'Name', w: 190, val: (r) => r.name,
    render: (r) => <Text style={[styles.tCell, styles.tMuted]} numberOfLines={1}>{r.name}</Text> },
  { key: 'price', label: 'LTP', w: 84, align: 'right', val: (r) => r.price,
    render: (r) => numCell(r.price, (n) => money(n)) },
  { key: 'chg', label: '%Chg', w: 74, align: 'right', val: (r) => r.chg ?? null,
    render: (r) => numCell(r.chg ?? null, (n) => pct(n), (r.chg ?? 0) >= 0 ? theme.green : theme.red) },
  { key: 'turnover', label: 'Traded/day', w: 100, align: 'right', val: (r) => r.turnover_cr,
    render: (r) => numCell(r.turnover_cr, (n) => cr(n)) },
  { key: 'liquidity', label: 'Liquidity', w: 96, val: (r) => LIQ_ORDER[r.liquidity],
    render: (r) => (
      <Text style={[styles.tCell, styles.tBold, { color: LIQ_COLOR[r.liquidity] }]}>
        {LIQ_LABEL[r.liquidity]}
      </Text>
    ) },
  { key: 'risk', label: 'Risk', w: 100, val: (r) => RISK_ORDER[r.risk_grade],
    render: (r) => (
      <Text style={[styles.tCell, styles.tBold, { color: RISK_COLOR[r.risk_grade] }]}>
        {RISK_LABEL[r.risk_grade].replace(' RISK', '')}
      </Text>
    ) },
  { key: 'flags', label: 'Flags', w: 58, align: 'right', val: (r) => r.flags.length,
    render: (r) => (
      <Text style={[styles.tCell, { textAlign: 'right', color: r.flags.length ? theme.red : theme.muted }]}>
        {r.flags.length || '\u2014'}
      </Text>
    ) },
  { key: 'mcap', label: 'Mkt Cap', w: 98, align: 'right', val: (r) => r.market_cap_cr ?? null,
    render: (r) => numCell(r.market_cap_cr ?? null, (n) => `\u20b9${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}cr`) },
  { key: 'eps', label: 'EPS', w: 72, align: 'right', val: (r) => r.eps ?? null,
    render: (r) => numCell(r.eps ?? null, (n) => money(n)) },
  { key: 'pe', label: 'P/E', w: 66, align: 'right', val: (r) => r.pe ?? null,
    render: (r) => numCell(r.pe ?? null, (n) => n.toFixed(1) + '\u00d7') },
  { key: 'pb', label: 'P/B', w: 66, align: 'right', val: (r) => r.pb ?? null,
    render: (r) => numCell(r.pb ?? null, (n) => n.toFixed(2) + '\u00d7') },
  { key: 'roe', label: 'ROE', w: 68, align: 'right', val: (r) => r.roe ?? null,
    render: (r) => numCell(r.roe ?? null, (n) => n.toFixed(1) + '%') },
  { key: 'de', label: 'D/E', w: 62, align: 'right', val: (r) => r.debt_equity ?? null,
    render: (r) => numCell(r.debt_equity ?? null, (n) => n.toFixed(2)) },
  { key: 'ocf', label: 'OCF', w: 84, align: 'right', val: (r) => r.ocf_cr ?? null,
    render: (r) => numCell(r.ocf_cr ?? null, (n) => `\u20b9${n.toFixed(0)}cr`, (r.ocf_cr ?? 0) >= 0 ? theme.green : theme.red) },
  { key: 'sector', label: 'Sector', w: 150, val: (r) => r.sector || '',
    render: (r) => <Text style={[styles.tCell, styles.tMuted]} numberOfLines={1}>{r.sector || '\u2014'}</Text> },
];

const T_WIDTH = PCOLS.reduce((a, c) => a + c.w, 0);

function PennyTable({ rows, onOpen }: { rows: PennyRow[]; onOpen: (s: string) => void }) {
  // Default order is the server's — most tradeable first, the only sensible
  // landing state on a screen full of things you may not be able to sell.
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  // Rows scroll INSIDE the table, not by growing the page. 300 rows made the
  // document ~11,000px tall, which pushed the footer note out of reach and —
  // before the Sheet was made viewport-fixed — opened the detail card at the
  // very bottom of the content. Bounding it to the window keeps the header,
  // the filters and the tiles on screen while you read the rows, which is how
  // the other screeners already behave.
  const { height } = useWindowDimensions();
  const bodyMax = Math.max(280, height - 200);

  const sorted = React.useMemo(() => {
    const col = sort && PCOLS.find((c) => c.key === sort.key);
    if (!sort || !col) return rows;
    return [...rows].sort((a, b) => {
      const x = col.val(a);
      const y = col.val(b);
      // Missing data sorts last in BOTH directions — a blank is not a low
      // number, and ranking it as one buries the rows that do have data.
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      if (typeof x === 'string' || typeof y === 'string') {
        return String(x).localeCompare(String(y)) * sort.dir;
      }
      return (x - y) * sort.dir;
    });
  }, [rows, sort]);

  const toggle = (k: string) =>
    setSort((s) => (s && s.key === k ? (s.dir === -1 ? { key: k, dir: 1 } : null) : { key: k, dir: -1 }));

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ minWidth: T_WIDTH }}>
      <View style={{ width: T_WIDTH }}>
        <View style={styles.tHead}>
          {PCOLS.map((c) => (
            <TouchableOpacity
              key={c.key}
              style={{ width: c.w, paddingHorizontal: 6 }}
              onPress={() => toggle(c.key)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={`Sort by ${c.label}`}
            >
              <Text
                style={[
                  styles.tHeadTxt,
                  c.align === 'right' ? { textAlign: 'right' } : null,
                  sort?.key === c.key ? { color: theme.accent } : null,
                ]}
                numberOfLines={1}
              >
                {c.label}
                {sort?.key === c.key ? (sort.dir === -1 ? ' \u2193' : ' \u2191') : ''}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <ScrollView style={{ maxHeight: bodyMax }} nestedScrollEnabled>
          {sorted.map((r, i) => (
            <TouchableOpacity
              key={r.symbol}
              style={styles.tRow}
              onPress={() => onOpen(r.symbol)}
              activeOpacity={0.7}
            >
              {PCOLS.map((c) => (
                <View key={c.key} style={{ width: c.w, paddingHorizontal: 6 }}>
                  {c.render(r, i)}
                </View>
              ))}
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    </ScrollView>
  );
}

// Tapping a symbol opens the same kind of card every other screen uses —
// green flags, red flags, the numbers behind them, and the actions you'd
// reach for next. It used to expand in place, which buried the detail inside
// a scrolling list and gave the row none of the actions (watchlist, chart,
// analyse) that the momentum and multibagger cards have had all along.
function PennyDetail({
  r, watched, onClose, onWatch,
}: {
  r: PennyRow;
  watched: boolean;
  onClose: () => void;
  onWatch: () => void;
}) {
  const rc = RISK_COLOR[r.risk_grade];
  const lc = LIQ_COLOR[r.liquidity];
  const chgCol = (r.chg ?? 0) >= 0 ? theme.green : theme.red;
  const go = (fn: () => void) => () => {
    onClose();
    fn();
  };
  return (
    <Sheet onClose={onClose} maxHeight="92%">
      <View style={styles.dHead}>
        <View style={{ flex: 1 }}>
          <Text style={styles.dSym}>{r.symbol}</Text>
          <Text style={styles.dName} numberOfLines={2}>{r.name}</Text>
          <Text style={styles.meta}>
            {r.exchange}
            {r.sector ? ` · ${r.sector}` : ''}
            {r.market_cap_cr != null
              ? ` · ₹${r.market_cap_cr.toLocaleString('en-IN', { maximumFractionDigits: 0 })}cr mcap`
              : ''}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={styles.dPrice}>{money(r.price)}</Text>
          <Text style={[styles.chg, { color: chgCol }]}>{pct(r.chg)}</Text>
        </View>
      </View>

      <View style={styles.badges}>
        <View style={[styles.badge, { borderColor: lc }]}>
          <Text style={[styles.badgeTxt, { color: lc }]}>{LIQ_LABEL[r.liquidity]}</Text>
        </View>
        <View style={[styles.badge, { borderColor: rc }]}>
          <Text style={[styles.badgeTxt, { color: rc }]}>{RISK_LABEL[r.risk_grade]}</Text>
        </View>
        <Text style={styles.turn}>{cr(r.turnover_cr)}/day</Text>
      </View>
      <Text style={styles.dLiq}>{r.liquidity_note}</Text>

      <ScrollView style={{ marginTop: theme.sp.sm }} contentContainerStyle={{ paddingBottom: theme.sp.md }}>
        {r.flags.length ? (
          <>
            <Text style={[styles.detailHead, { color: theme.red }]}>Red flags</Text>
            {r.flags.map((f, i) => (
              <Text key={i} style={styles.flag}>• {f}</Text>
            ))}
          </>
        ) : null}
        {r.positives.length ? (
          <>
            <Text style={[styles.detailHead, { color: theme.green, marginTop: theme.sp.sm }]}>
              Green flags
            </Text>
            {r.positives.map((p, i) => (
              <Text key={i} style={styles.pos}>• {p}</Text>
            ))}
          </>
        ) : null}
        {!r.flags.length && !r.positives.length ? (
          <Text style={styles.dNone}>
            Nothing published either way — this scrip has no financials on file, which is itself
            the finding.
          </Text>
        ) : null}
        <View style={styles.nums}>
          <Num k="EPS" v={r.eps == null ? '—' : money(r.eps)} />
          <Num k="P/E" v={r.pe == null ? '—' : r.pe.toFixed(1) + '×'} />
          <Num k="P/B" v={r.pb == null ? '—' : r.pb.toFixed(2) + '×'} />
          <Num k="ROE" v={r.roe == null ? '—' : r.roe.toFixed(1) + '%'} />
          <Num k="D/E" v={r.debt_equity == null ? '—' : r.debt_equity.toFixed(2)} />
          <Num k="OCF" v={r.ocf_cr == null ? '—' : `₹${r.ocf_cr.toFixed(0)}cr`} />
          <Num k="Rev growth" v={r.revenue_growth_pct == null ? '—' : pct(r.revenue_growth_pct)} />
          <Num k="Turnover" v={cr(r.turnover_cr)} />
        </View>
      </ScrollView>

      <View style={styles.dActs}>
        <TouchableOpacity style={styles.dAct} onPress={onWatch} activeOpacity={0.75}>
          <Text style={[styles.dActTxt, watched && { color: theme.green }]}>
            {watched ? '★ Watching' : '☆ Watchlist'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.dAct}
          onPress={go(() => openStock(r.symbol, r.sector || undefined))}
          activeOpacity={0.75}
        >
          <Text style={styles.dActTxt}>Chart</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.dAct}
          onPress={go(() => navigate('screens', { sub: 'mb', symbol: r.symbol }))}
          activeOpacity={0.75}
        >
          <Text style={styles.dActTxt}>Analyse</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.dAct, styles.dActPrimary]}
          onPress={go(() => navigate('desk', { sub: 'inst', symbol: r.symbol }))}
          activeOpacity={0.8}
        >
          <Text style={[styles.dActTxt, styles.dActPrimaryTxt]}>Dossier</Text>
        </TouchableOpacity>
      </View>
    </Sheet>
  );
}

function Num({ k, v }: { k: string; v: string }) {
  return (
    <View style={styles.num}>
      <Text style={styles.numK}>{k}</Text>
      <Text style={styles.numV}>{v}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { padding: theme.sp.lg, paddingBottom: 44 },
  warn: { gap: 6, borderColor: theme.red, borderWidth: 1 },
  warnHead: { color: theme.red, fontSize: theme.fs.xs + 1, fontWeight: '800', letterSpacing: 1 },
  warnTxt: { color: theme.muted2, fontSize: theme.fs.sm, lineHeight: 19 },
  warnB: { color: theme.text, fontWeight: '800' },
  controls: { flexDirection: 'row', gap: theme.sp.sm, marginTop: theme.sp.md, zIndex: 20 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp.sm, marginTop: theme.sp.sm },
  bandNote: { color: theme.muted, fontSize: theme.fs.xs + 1, marginTop: theme.sp.sm, lineHeight: 17 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp.sm, marginTop: theme.sp.md },
  err: { color: theme.red, fontSize: theme.fs.sm, marginTop: theme.sp.md },
  notice: { color: theme.muted2, fontSize: theme.fs.sm, marginTop: theme.sp.md, lineHeight: 18 },
  row: { marginBottom: theme.sp.sm, gap: theme.sp.sm },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.sp.sm },
  sym: { color: theme.text, fontFamily: theme.mono, fontSize: theme.fs.md + 1, fontWeight: '800' },
  name: { color: theme.muted2, fontSize: theme.fs.sm, fontWeight: '600' },
  meta: { color: theme.muted2, fontSize: theme.fs.xs + 1, marginTop: 3 },
  price: { color: theme.text, fontFamily: theme.mono, fontSize: theme.fs.md + 1, fontWeight: '800' },
  chg: { fontFamily: theme.mono, fontSize: theme.fs.sm, fontWeight: '700' },
  badges: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  badge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  badgeTxt: { fontSize: theme.fs.xs, fontWeight: '800', letterSpacing: 0.4 },
  turn: { color: theme.muted2, fontFamily: theme.mono, fontSize: theme.fs.xs + 1 },
  noFund: { color: theme.muted, fontSize: theme.fs.xs },
  tapHint: { color: theme.muted, fontSize: theme.fs.xs, marginTop: 2 },
  detail: { borderTopColor: theme.border, borderTopWidth: 1, paddingTop: theme.sp.sm, gap: 3 },
  detailHead: { fontSize: theme.fs.xs + 1, fontWeight: '800', letterSpacing: 1 },
  flag: { color: theme.muted2, fontSize: theme.fs.sm, lineHeight: 19 },
  pos: { color: theme.muted2, fontSize: theme.fs.sm, lineHeight: 19 },
  nums: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp.md, marginTop: theme.sp.md },
  num: { minWidth: 54, gap: 1 },
  numK: { color: theme.muted, fontSize: theme.fs.xs },
  numV: { color: theme.text, fontFamily: theme.mono, fontSize: theme.fs.sm, fontWeight: '700' },
  dossierBtn: {
    alignSelf: 'flex-start', marginTop: theme.sp.md, borderColor: theme.border2, borderWidth: 1,
    borderRadius: 999, paddingHorizontal: theme.sp.lg, paddingVertical: 7,
  },
  dossierTxt: { color: theme.text, fontSize: theme.fs.sm, fontWeight: '700' },
  // Detail sheet — the same card shape the momentum and multibagger screens use.
  dHead: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.sp.md },
  dSym: { color: theme.text, fontSize: 18, fontWeight: '800', letterSpacing: 0.3 },
  dName: { color: theme.muted2, fontSize: theme.fs.sm, marginTop: 1 },
  dPrice: { color: theme.text, fontSize: 20, fontWeight: '800' },
  dLiq: { color: theme.muted, fontSize: theme.fs.xs, marginTop: 4 },
  dNone: { color: theme.muted, fontSize: theme.fs.sm, lineHeight: 19 },
  dActs: {
    flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp.sm, marginTop: theme.sp.sm,
    paddingTop: theme.sp.sm, borderTopWidth: 1, borderTopColor: theme.border,
  },
  dAct: {
    flexGrow: 1, minWidth: 84, paddingVertical: 10, paddingHorizontal: theme.sp.md,
    borderRadius: 10, borderWidth: 1, borderColor: theme.border2,
    backgroundColor: theme.surface2, alignItems: 'center',
  },
  dActPrimary: { backgroundColor: theme.accent, borderColor: theme.accent },
  dActTxt: { color: theme.text, fontSize: theme.fs.sm, fontWeight: '700' },
  dActPrimaryTxt: { color: theme.onAccent },
  // Table
  tHint: { color: theme.muted, fontSize: theme.fs.xs, marginBottom: 6 },
  tHead: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: theme.border2, backgroundColor: theme.surface2,
    borderTopLeftRadius: 10, borderTopRightRadius: 10,
  },
  tHeadTxt: { color: theme.muted2, fontSize: theme.fs.xs, fontWeight: '700', letterSpacing: 0.3 },
  tRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 9,
    borderBottomWidth: 1, borderBottomColor: theme.border,
  },
  tCell: { color: theme.text, fontSize: theme.fs.sm },
  tMuted: { color: theme.muted2 },
  tBold: { fontWeight: '700', fontSize: theme.fs.xs, letterSpacing: 0.2 },
  tSym: { color: theme.text, fontSize: theme.fs.sm, fontWeight: '800', letterSpacing: 0.2 },
  note: { color: theme.muted, fontSize: theme.fs.sm, marginTop: theme.sp.lg, lineHeight: 18 },
});
