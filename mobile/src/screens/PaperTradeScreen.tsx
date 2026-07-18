import React, { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { api } from '../api';
import {
  PaperTrade,
  clearPaperTrades,
  loadPaperTrades,
  paperPnlPct,
  reconcilePaper,
  removePaperTrade,
} from '../paperTrades';
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
        <ScrollView contentContainerStyle={styles.body}>
          <Card style={styles.soon}>
            <Text style={styles.soonBadge}>COMING SOON</Text>
            <Text style={styles.soonTitle}>Full paper simulator</Text>
            <Text style={styles.soonTxt}>
              A virtual cash balance with position sizing, a running P&amp;L ledger and an equity curve is
              on the way. For now, the Outcome tracker logs each setup and scores it win/loss against the
              live price.
            </Text>
          </Card>
        </ScrollView>
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
});
