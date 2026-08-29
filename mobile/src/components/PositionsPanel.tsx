// Portfolio and watchlist on the home page — the actual holdings and symbols,
// not just a total.
//
// They used to be two summary buttons: a value, an average, and a chevron. To
// see WHICH position was down you had to leave the page, which is the one
// thing a home page should not make you do — and the summary itself hid the
// answer, since a flat total is as often two big opposite moves as it is a
// quiet day.
//
// The change column reads as a percentage or as rupees, and clicking any of
// them swaps every one on the page. Both readings matter and neither is a
// setting worth burying: a percentage compares positions to each other, rupees
// tell you what the day actually cost. The choice is remembered.
import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Card, EmptyState, Loading, SectionTitle } from '../ui';
import { Icon } from '../icons';
import { theme } from '../theme';
import { navigate, openStock } from '../navIntent';

const MODE_KEY = 'taureye.home.chgmode.v1';

const inr = (v: number) => '\u20b9' + Math.round(v).toLocaleString('en-IN');

export type ChgMode = 'pct' | 'abs';

/** One shared choice for the whole page: someone who thinks in rupees thinks
 *  in rupees in both lists. */
export function useChgMode(): [ChgMode, () => void] {
  const [mode, setMode] = useState<ChgMode>('pct');
  useEffect(() => {
    AsyncStorage.getItem(MODE_KEY)
      .then((v) => {
        if (v === 'abs' || v === 'pct') setMode(v);
      })
      .catch(() => {});
  }, []);
  const toggle = useCallback(() => {
    setMode((m) => {
      const next: ChgMode = m === 'pct' ? 'abs' : 'pct';
      AsyncStorage.setItem(MODE_KEY, next).catch(() => {});
      return next;
    });
  }, []);
  return [mode, toggle];
}

export type PosRow = {
  symbol: string;
  price?: number | null;
  chg?: number | null;
  /** Rupee change for this row — per share on a watchlist, for the whole
   *  holding in a portfolio, which is why the caller supplies it. */
  abs?: number | null;
  /** Secondary line: "12 @ 1,204" for a holding. */
  sub?: string;
};

const fmtPct = (v?: number | null) =>
  v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
const fmtAbs = (v?: number | null) =>
  v == null ? '—' : (v >= 0 ? '+' : '−') + inr(Math.abs(v)).slice(1);
const colorOf = (v?: number | null) =>
  v == null ? theme.muted : v >= 0 ? theme.green : theme.red;

function Rows({ rows, mode, onToggle }: { rows: PosRow[]; mode: ChgMode; onToggle: () => void }) {
  return (
    <>
      {rows.map((r, i) => (
        <View key={r.symbol + i} style={[s.row, i === 0 && { borderTopWidth: 0 }]}>
          <TouchableOpacity
            style={s.rowMain}
            onPress={() => openStock(r.symbol)}
            activeOpacity={0.7}
            accessibilityRole="link"
            accessibilityLabel={`Open ${r.symbol}`}
          >
            <Text style={s.sym} numberOfLines={1}>{r.symbol}</Text>
            {r.sub ? <Text style={s.sub} numberOfLines={1}>{r.sub}</Text> : null}
          </TouchableOpacity>
          <Text style={s.price}>{r.price != null ? r.price.toFixed(1) : '—'}</Text>
          <TouchableOpacity
            onPress={onToggle}
            activeOpacity={0.6}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 6 }}
            accessibilityRole="button"
            accessibilityLabel={
              mode === 'pct'
                ? `${r.symbol} ${fmtPct(r.chg)}. Show the change in rupees`
                : `${r.symbol} ${fmtAbs(r.abs)}. Show the change as a percentage`
            }
          >
            <Text style={[s.chg, { color: colorOf(mode === 'pct' ? r.chg : r.abs) }]}>
              {mode === 'pct' ? fmtPct(r.chg) : fmtAbs(r.abs)}
            </Text>
          </TouchableOpacity>
        </View>
      ))}
    </>
  );
}

/** The card's title plus the arrow through to the full page. */
function Head({ title, note, to, sub }: { title: string; note?: string; to: string; sub: string }) {
  return (
    <View style={s.head}>
      <View style={s.headL}>
        <SectionTitle>{title}</SectionTitle>
        {note ? <Text style={s.note}>{note}</Text> : null}
      </View>
      <TouchableOpacity
        style={s.arrow}
        onPress={() => navigate(to, { sub })}
        activeOpacity={0.7}
        accessibilityRole="link"
        accessibilityLabel={`Open the full ${title.toLowerCase()} page`}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Icon name="chevronRight" size={16} color={theme.brand} />
      </TouchableOpacity>
    </View>
  );
}

export function PortfolioPanel({
  rows,
  total,
  mode,
  onToggle,
}: {
  rows: PosRow[] | null;
  total: { value: number; dayChg: number; dayPct: number } | null;
  mode: ChgMode;
  onToggle: () => void;
}) {
  return (
    <Card style={s.card}>
      <Head
        title="Portfolio"
        to="desk"
        sub="portfolio"
        note={
          total && rows && rows.length
            ? `${inr(total.value)} · ${mode === 'pct' ? fmtPct(total.dayPct) : fmtAbs(total.dayChg)}`
            : undefined
        }
      />
      {rows == null ? (
        <Loading />
      ) : rows.length ? (
        <Rows rows={rows} mode={mode} onToggle={onToggle} />
      ) : (
        <EmptyState
          title="No holdings yet"
          hint="Add what you own and the day's move shows up here."
          action={{ label: 'Add a holding', onPress: () => navigate('desk', { sub: 'portfolio' }) }}
        />
      )}
    </Card>
  );
}

export function WatchlistPanel({
  rows,
  mode,
  onToggle,
}: {
  rows: PosRow[] | null;
  mode: ChgMode;
  onToggle: () => void;
}) {
  return (
    <Card style={s.card}>
      <Head
        title="Watchlist"
        to="desk"
        sub="watchlist"
        note={rows && rows.length ? `${rows.length} symbols` : undefined}
      />
      {rows == null ? (
        <Loading />
      ) : rows.length ? (
        <Rows rows={rows} mode={mode} onToggle={onToggle} />
      ) : (
        <EmptyState
          title="Watchlist is empty"
          hint="Add symbols from any screen's ☆ and they appear here with live quotes."
          action={{ label: 'Find symbols', onPress: () => navigate('screens', { sub: 'screener' }) }}
        />
      )}
    </Card>
  );
}

const s = StyleSheet.create({
  card: { marginBottom: theme.sp.md },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headL: { flex: 1 },
  note: { color: theme.muted2, fontSize: theme.fs.xs, fontFamily: theme.mono, marginTop: -2 },
  arrow: {
    width: 28, height: 28, borderRadius: 999, alignItems: 'center', justifyContent: 'center',
    backgroundColor: theme.surface2, borderWidth: 1, borderColor: theme.border,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 7, borderTopWidth: 1, borderTopColor: theme.border,
  },
  rowMain: { flex: 1 },
  sym: { color: theme.text, fontSize: theme.fs.sm, fontWeight: '700' },
  sub: { color: theme.muted, fontSize: theme.fs.xs, fontFamily: theme.mono },
  price: { color: theme.muted2, fontSize: theme.fs.sm, fontFamily: theme.mono },
  chg: { fontSize: theme.fs.sm, fontFamily: theme.mono, fontWeight: '700', minWidth: 74, textAlign: 'right' },
});
