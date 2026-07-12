import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking } from 'react-native';
import {
  ActivityIndicator,
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
        <TouchableOpacity onPress={() => onRemove(item.symbol)} style={styles.del} hitSlop={10}>
          <Text style={styles.delText}>✕</Text>
        </TouchableOpacity>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  const totalCol = totals.pnl >= 0 ? theme.green : theme.red;

  return (
    <View style={styles.container}>
      {list.length ? (
        <View style={styles.summary}>
          <View style={styles.sumMain}>
            <Text style={styles.sumLabel}>Current value</Text>
            <Text style={styles.sumValue}>{money(totals.value)}</Text>
          </View>
          <View style={styles.sumGrid}>
            <Sum label="Invested" value={money(totals.invested)} />
            <Sum
              label="Total P&L"
              value={signedMoney(totals.pnl)}
              sub={signedPct(totals.pnlPct)}
              color={totalCol}
            />
            <Sum
              label="Day P&L"
              value={totals.priced ? signedMoney(totals.dayChg) : '—'}
              color={totals.dayChg >= 0 ? theme.green : theme.red}
            />
          </View>
        </View>
      ) : null}

      {broker?.configured ? (
        <View style={styles.brokerCard}>
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
            <TouchableOpacity style={styles.brokerBtn} onPress={brokerSync} disabled={syncing}>
              <Text style={styles.brokerBtnTxt}>{syncing ? 'SYNCING…' : '⇊ SYNC HOLDINGS'}</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.brokerBtn} onPress={brokerConnect}>
              <Text style={styles.brokerBtnTxt}>CONNECT</Text>
            </TouchableOpacity>
          )}
        </View>
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
        <TouchableOpacity style={styles.addBtn} onPress={onAdd}>
          <Text style={styles.addBtnText}>Add</Text>
        </TouchableOpacity>
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
          <Text style={styles.empty}>
            No holdings yet. Add a symbol with quantity and average buy price — it's saved on this
            device and valued live.
          </Text>
        }
      />
    </View>
  );
}

function Sum({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <View style={styles.sumCell}>
      <Text style={styles.sumCellLabel}>{label}</Text>
      <Text style={[styles.sumCellValue, color ? { color } : null]}>{value}</Text>
      {sub ? <Text style={[styles.sumCellSub, color ? { color } : null]}>{sub}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  brokerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 12,
    marginTop: 10,
    padding: 12,
    backgroundColor: theme.surface,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: 8,
  },
  brokerTitle: { color: theme.text, fontFamily: theme.mono, fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  brokerSub: { color: theme.muted, fontFamily: theme.mono, fontSize: 9, marginTop: 3 },
  brokerBtn: { backgroundColor: theme.accent, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 8 },
  brokerBtnTxt: { color: theme.bg, fontFamily: theme.mono, fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  container: { flex: 1, backgroundColor: theme.bg, paddingHorizontal: 12 },
  center: { flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' },
  summary: {
    backgroundColor: theme.surface2,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    marginTop: 12,
  },
  sumMain: { marginBottom: 12 },
  sumLabel: { color: theme.muted2, fontSize: 11, fontFamily: theme.mono },
  sumValue: { color: theme.text, fontSize: 24, fontWeight: '700', marginTop: 2 },
  sumGrid: {
    flexDirection: 'row',
    borderTopColor: theme.border,
    borderTopWidth: 1,
    paddingTop: 12,
  },
  sumCell: { flex: 1 },
  sumCellLabel: { color: theme.muted2, fontSize: 10, fontFamily: theme.mono },
  sumCellValue: { color: theme.text, fontSize: 14, fontWeight: '600', marginTop: 3 },
  sumCellSub: { fontSize: 11, fontFamily: theme.mono, marginTop: 1 },
  addBox: { flexDirection: 'row', gap: 6, marginTop: 12, marginBottom: 4 },
  input: {
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: 8,
    color: theme.text,
    paddingHorizontal: 10,
    paddingVertical: 9,
    fontFamily: theme.mono,
    fontSize: 13,
  },
  iSym: { flex: 1 },
  iNum: { width: 66 },
  addBtn: { backgroundColor: theme.accent, borderRadius: 8, paddingHorizontal: 14, justifyContent: 'center' },
  addBtnText: { color: theme.bg, fontWeight: '700', fontSize: 13 },
  error: { color: theme.red, fontFamily: theme.mono, fontSize: 11, marginTop: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomColor: theme.border,
    borderBottomWidth: 1,
  },
  sym: { color: theme.text, fontWeight: '700', fontSize: 14 },
  meta: { color: theme.muted, fontFamily: theme.mono, fontSize: 11, marginTop: 3 },
  pnlWrap: { alignItems: 'flex-end', marginRight: 14 },
  pnl: { fontFamily: theme.mono, fontSize: 13, fontWeight: '700' },
  pnlPct: { fontFamily: theme.mono, fontSize: 11, marginTop: 2 },
  del: { padding: 4 },
  delText: { color: theme.muted2, fontSize: 15 },
  empty: {
    color: theme.muted,
    fontFamily: theme.mono,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 30,
    lineHeight: 18,
    paddingHorizontal: 16,
  },
});
