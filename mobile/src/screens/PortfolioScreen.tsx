import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking } from 'react-native';
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { BrokerStatus, api, Quote } from '../api';
import { Holding, addHolding, importHoldings, loadPortfolio, removeHolding } from '../portfolio';
import { theme } from '../theme';
import { Btn, Card, EmptyState, Loading, StatTile } from '../ui';

const money = (n: number) =>
  '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: n >= 1000 ? 0 : 2 });
const signedMoney = (n: number) => (n >= 0 ? '+' : '−') + money(Math.abs(n));
const signedPct = (n: number) => (n >= 0 ? '+' : '') + n.toFixed(2) + '%';

export default function PortfolioScreen() {
  const [list, setList] = useState<Holding[]>([]);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [sym, setSym] = useState('');
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [broker, setBroker] = useState<BrokerStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const fetchQuotes = useCallback(async (holdings: Holding[]) => {
    if (!holdings.length) {
      setQuotes({});
      return;
    }
    setError(null);
    try {
      setQuotes(await api.ltp(holdings.map((h) => h.symbol)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch quotes');
    }
  }, []);

  useEffect(() => {
    api.brokerStatus().then(setBroker).catch(() => {});
  }, []);

  const brokerConnect = useCallback(() => {
    if (broker?.login_url) Linking.openURL(broker.login_url).catch(() => {});
  }, [broker]);

  const brokerSync = useCallback(async () => {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const { holdings } = await api.brokerHoldings();
      const next = await importHoldings(list, holdings);
      setList(next);
      await fetchQuotes(next);
      setSyncMsg(`Synced ${holdings.length} holdings from Zerodha (read-only).`);
    } catch {
      setSyncMsg('Sync failed — broker session may have expired. Reconnect and retry.');
      api.brokerStatus().then(setBroker).catch(() => {});
    } finally {
      setSyncing(false);
    }
  }, [list, fetchQuotes]);

  useEffect(() => {
    (async () => {
      const saved = await loadPortfolio();
      setList(saved);
      await fetchQuotes(saved);
      setLoading(false);
    })();
  }, [fetchQuotes]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchQuotes(list);
    setRefreshing(false);
  }, [list, fetchQuotes]);

  const onAdd = useCallback(async () => {
    const next = await addHolding(list, sym, parseFloat(qty), parseFloat(price));
    if (next !== list) {
      setSym('');
      setQty('');
      setPrice('');
      setList(next);
      await fetchQuotes(next);
    }
  }, [list, sym, qty, price, fetchQuotes]);

  const onRemove = useCallback(
    async (s: string) => setList(await removeHolding(list, s)),
    [list],
  );

  const totals = useMemo(() => {
    let invested = 0;
    let value = 0;
    let dayChg = 0;
    let priced = 0;
    for (const h of list) {
      invested += h.qty * h.avg;
      const q = quotes[h.symbol];
      if (q?.price != null) {
        value += h.qty * q.price;
        priced++;
        if (q.absChg != null) dayChg += h.qty * q.absChg;
      } else {
        value += h.qty * h.avg; // fall back to cost basis when unpriced
      }
    }
    const pnl = value - invested;
    const pnlPct = invested > 0 ? (pnl / invested) * 100 : 0;
    return { invested, value, pnl, pnlPct, dayChg, priced };
  }, [list, quotes]);

  const renderRow = ({ item }: { item: Holding }) => {
    const q = quotes[item.symbol];
    const invested = item.qty * item.avg;
    const priced = q?.price != null;
    const value = priced ? item.qty * (q.price as number) : invested;
    const pnl = value - invested;
    const pnlPct = invested > 0 ? (pnl / invested) * 100 : 0;
    const col = !priced ? theme.muted : pnl >= 0 ? theme.green : theme.red;
    return (
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={styles.sym}>{item.symbol}</Text>
          <Text style={styles.meta}>
            {item.qty} @ {money(item.avg)}
            {priced ? `  ·  LTP ${money(q.price as number)}` : '  ·  no quote'}
          </Text>
        </View>
        <View style={styles.pnlWrap}>
          <Text style={[styles.pnl, { color: col }]}>{priced ? signedMoney(pnl) : '—'}</Text>
          <Text style={[styles.pnlPct, { color: col }]}>{priced ? signedPct(pnlPct) : ''}</Text>
        </View>
        <TouchableOpacity
          onPress={() => onRemove(item.symbol)}
          style={styles.del}
          hitSlop={10}
          activeOpacity={0.75}
        >
          <Text style={styles.delText}>✕</Text>
        </TouchableOpacity>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <Loading label="Loading your portfolio…" />
      </View>
    );
  }

  const totalCol = totals.pnl >= 0 ? theme.green : theme.red;

  return (
    <View style={styles.container}>
      {list.length ? (
        <View style={styles.summaryRow}>
          <StatTile label="Current value" value={money(totals.value)} />
          <StatTile label="Invested" value={money(totals.invested)} />
          <StatTile
            label="Total P&L"
            value={signedMoney(totals.pnl)}
            sub={signedPct(totals.pnlPct)}
            color={totalCol}
          />
          <StatTile
            label="Day P&L"
            value={totals.priced ? signedMoney(totals.dayChg) : '—'}
            color={totals.dayChg >= 0 ? theme.green : theme.red}
          />
        </View>
      ) : null}

      {broker?.configured ? (
        <Card style={styles.brokerCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.brokerTitle}>
              ZERODHA {broker.connected ? `· ${broker.user || 'connected'}` : '· not connected'}
            </Text>
            <Text style={styles.brokerSub}>
              {syncMsg ||
                (broker.connected
                  ? 'Read-only — TaurEye never places orders.'
                  : 'Daily Kite login required to sync holdings.')}
            </Text>
          </View>
          {broker.connected ? (
            <Btn
              label={syncing ? 'SYNCING…' : '⇊ SYNC HOLDINGS'}
              onPress={brokerSync}
              disabled={syncing}
            />
          ) : (
            <Btn label="CONNECT" onPress={brokerConnect} />
          )}
        </Card>
      ) : null}

      <View style={styles.addBox}>
        <TextInput
          style={[styles.input, styles.iSym]}
          value={sym}
          onChangeText={setSym}
          placeholder="Symbol"
          placeholderTextColor={theme.muted}
          autoCapitalize="characters"
        />
        <TextInput
          style={[styles.input, styles.iNum]}
          value={qty}
          onChangeText={setQty}
          placeholder="Qty"
          placeholderTextColor={theme.muted}
          keyboardType="numeric"
        />
        <TextInput
          style={[styles.input, styles.iNum]}
          value={price}
          onChangeText={setPrice}
          placeholder="Buy ₹"
          placeholderTextColor={theme.muted}
          keyboardType="numeric"
        />
        <Btn label="Add" onPress={onAdd} />
      </View>

      {error ? <Text style={styles.error}>{error} — is the backend reachable?</Text> : null}

      <FlatList
        data={list}
        keyExtractor={(h) => h.symbol}
        renderItem={renderRow}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accent} />
        }
        ListEmptyComponent={
          <EmptyState
            title="No holdings yet"
            hint="Add a symbol with quantity and average buy price — it's saved on this device and valued live."
          />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  brokerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.sp.md,
    marginTop: theme.sp.md,
  },
  brokerTitle: { color: theme.text, fontSize: theme.fs.sm, fontWeight: '700', letterSpacing: 0.8 },
  brokerSub: { color: theme.muted, fontSize: theme.fs.sm, marginTop: 3 },
  container: { flex: 1, backgroundColor: theme.bg, paddingHorizontal: theme.sp.lg },
  center: { flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' },
  summaryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.sp.sm,
    marginTop: theme.sp.lg,
  },
  addBox: { flexDirection: 'row', gap: theme.sp.sm, marginTop: theme.sp.md, marginBottom: theme.sp.xs },
  input: {
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.sm + 2,
    color: theme.text,
    paddingHorizontal: theme.sp.md,
    paddingVertical: 10,
    fontFamily: theme.mono,
    fontSize: theme.fs.sm + 1,
  },
  iSym: { flex: 1 },
  iNum: { width: 66 },
  error: { color: theme.red, fontSize: theme.fs.sm, marginTop: theme.sp.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    paddingVertical: theme.sp.md,
    borderBottomColor: theme.border,
    borderBottomWidth: 1,
  },
  sym: { color: theme.text, fontWeight: '700', fontSize: theme.fs.md, fontFamily: theme.mono },
  meta: { color: theme.muted, fontFamily: theme.mono, fontSize: theme.fs.sm, marginTop: 3 },
  pnlWrap: { alignItems: 'flex-end', marginRight: theme.sp.lg },
  pnl: { fontFamily: theme.mono, fontSize: theme.fs.sm + 1, fontWeight: '700', textAlign: 'right' },
  pnlPct: { fontFamily: theme.mono, fontSize: theme.fs.sm, marginTop: 2, textAlign: 'right' },
  del: { padding: theme.sp.xs },
  delText: { color: theme.muted, fontSize: theme.fs.md + 1 },
});
