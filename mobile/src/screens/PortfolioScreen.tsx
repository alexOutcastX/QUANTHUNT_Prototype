import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking } from 'react-native';
import {
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BrokerStatus, api, Quote } from '../api';
import { exportCsvRows, exportExcelRows } from '../csv';
import { Holding, addHolding, importHoldings, loadPortfolio, removeHolding } from '../portfolio';
import { theme } from '../theme';
import { Btn, Card, EmptyState, Loading, ScreenTitle, SectionTitle, StatTile } from '../ui';

const money = (n: number) =>
  '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: n >= 1000 ? 0 : 2 });
const signedMoney = (n: number) => (n >= 0 ? '+' : '−') + money(Math.abs(n));
const signedPct = (n: number) => (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
const num = (v?: number | null) =>
  v == null || !isFinite(v) ? '—' : v.toLocaleString('en-IN', { maximumFractionDigits: 2 });

// ── holdings table columns (configurable, symbol locked first) ─────────────────
type Row = {
  h: Holding;
  q?: Quote;
  priced: boolean;
  invested: number;
  value: number;
  pnl: number;
  pnlPct: number;
  dayPnl: number;
  weight: number; // 0..1 of total market value
  sector: string;
};

type PCol = {
  key: string;
  label: string;
  w: number;
  align?: 'left' | 'right';
  render: (r: Row) => React.ReactNode;
  text: (r: Row) => string;
};

const pnlColor = (r: Row) => (!r.priced ? theme.muted : r.pnl >= 0 ? theme.green : theme.red);

const COLS: PCol[] = [
  {
    key: 'sym', label: 'Symbol', w: 116, align: 'left',
    render: (r) => (
      <View>
        <Text style={styles.symTxt}>{r.h.symbol}</Text>
        <Text style={styles.symSub} numberOfLines={1}>
          {r.sector !== 'Unknown' ? r.sector : `${r.h.qty} @ ${money(r.h.avg)}`}
        </Text>
      </View>
    ),
    text: (r) => r.h.symbol,
  },
  {
    key: 'qty', label: 'Qty', w: 56, align: 'right',
    render: (r) => <Text style={styles.cell}>{r.h.qty}</Text>,
    text: (r) => String(r.h.qty),
  },
  {
    key: 'avg', label: 'Avg', w: 84, align: 'right',
    render: (r) => <Text style={styles.cell}>{num(r.h.avg)}</Text>,
    text: (r) => String(r.h.avg),
  },
  {
    key: 'ltp', label: 'LTP', w: 90, align: 'right',
    render: (r) => <Text style={styles.cell}>{r.priced ? num(r.q?.price) : '—'}</Text>,
    text: (r) => (r.priced ? String(r.q?.price ?? '') : ''),
  },
  {
    key: 'value', label: 'Value', w: 100, align: 'right',
    render: (r) => <Text style={styles.cell}>{money(r.value)}</Text>,
    text: (r) => String(Math.round(r.value)),
  },
  {
    key: 'weight', label: 'Wt%', w: 60, align: 'right',
    render: (r) => <Text style={styles.cell}>{(r.weight * 100).toFixed(1)}</Text>,
    text: (r) => (r.weight * 100).toFixed(1),
  },
  {
    key: 'dayPnl', label: 'Day P&L', w: 92, align: 'right',
    render: (r) => (
      <Text style={[styles.cell, { color: r.dayPnl >= 0 ? theme.green : theme.red }]}>
        {r.priced ? signedMoney(r.dayPnl) : '—'}
      </Text>
    ),
    text: (r) => (r.priced ? String(Math.round(r.dayPnl)) : ''),
  },
  {
    key: 'pnl', label: 'Total P&L', w: 116, align: 'right',
    render: (r) => (
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={[styles.cell, { color: pnlColor(r) }]}>{r.priced ? signedMoney(r.pnl) : '—'}</Text>
        <Text style={[styles.cellSub, { color: pnlColor(r) }]}>{r.priced ? signedPct(r.pnlPct) : ''}</Text>
      </View>
    ),
    text: (r) => (r.priced ? `${Math.round(r.pnl)} (${r.pnlPct.toFixed(2)}%)` : ''),
  },
];
const COL_META = COLS.map((c) => ({ key: c.key, label: c.label }));
const ACTIONS_W = 44;
const COLS_KEY = 'taureye.portfolio.cols.v1';

// ── concentration (Herfindahl–Hirschman index over market-value weights) ───────
function hhiOf(weights: number[]): number {
  return weights.reduce((s, w) => s + w * w, 0);
}
function concLabel(hhi: number): { label: string; color: string } {
  if (hhi >= 0.25) return { label: 'High', color: theme.red };
  if (hhi >= 0.15) return { label: 'Moderate', color: theme.muted2 };
  return { label: 'Low', color: theme.green };
}

export default function PortfolioScreen() {
  const [list, setList] = useState<Holding[]>([]);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [sectors, setSectors] = useState<Record<string, string>>({});
  const [sym, setSym] = useState('');
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [broker, setBroker] = useState<BrokerStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [ownerAuth, setOwnerAuth] = useState<{ configured: boolean; owner: boolean } | null>(null);
  const [pw, setPw] = useState('');
  const [authMsg, setAuthMsg] = useState<string | null>(null);
  // Column show/hide + order prefs.
  const [colOrder, setColOrder] = useState<string[]>(COLS.map((c) => c.key));
  const [colHidden, setColHidden] = useState<string[]>([]);
  const [colMenu, setColMenu] = useState(false);
  const [prefsRestored, setPrefsRestored] = useState(false);

  // Sectors drive allocation grouping; best-effort from bulk fundamentals.
  const fetchSectors = useCallback(async (holdings: Holding[]) => {
    if (!holdings.length) return;
    try {
      const res = await api.fundamentalsBulk(holdings.map((h) => h.symbol));
      setSectors((prev) => {
        const next = { ...prev };
        for (const [s, f] of Object.entries(res.data || {})) {
          const sec = (f as { sector?: unknown }).sector;
          if (typeof sec === 'string' && sec.trim()) next[s] = sec.trim();
        }
        return next;
      });
    } catch {
      /* sector allocation degrades to per-holding */
    }
  }, []);

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

  const refreshAuth = useCallback(() => {
    api.authStatus().then(setOwnerAuth).catch(() => setOwnerAuth({ configured: false, owner: false }));
  }, []);

  useEffect(() => {
    api.brokerStatus().then(setBroker).catch(() => {});
    refreshAuth();
  }, [refreshAuth]);

  // Load column prefs once.
  useEffect(() => {
    (async () => {
      const raw = await AsyncStorage.getItem(COLS_KEY);
      if (raw) {
        try {
          const p = JSON.parse(raw);
          if (Array.isArray(p?.order)) setColOrder(p.order.filter((k: unknown) => typeof k === 'string'));
          if (Array.isArray(p?.hidden)) setColHidden(p.hidden.filter((k: unknown) => typeof k === 'string'));
        } catch {
          /* defaults */
        }
      }
      setPrefsRestored(true);
    })();
  }, []);

  useEffect(() => {
    if (!prefsRestored) return;
    AsyncStorage.setItem(COLS_KEY, JSON.stringify({ order: colOrder, hidden: colHidden })).catch(() => {});
  }, [colOrder, colHidden, prefsRestored]);

  const ownerLogin = useCallback(async () => {
    setAuthMsg(null);
    try {
      await api.authLogin(pw);
      setPw('');
      refreshAuth();
    } catch {
      setAuthMsg('Incorrect passcode.');
    }
  }, [pw, refreshAuth]);

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
      fetchSectors(next);
      setSyncMsg(`Synced ${holdings.length} holdings from Zerodha (read-only).`);
    } catch {
      setSyncMsg('Sync failed — broker session may have expired. Reconnect and retry.');
      api.brokerStatus().then(setBroker).catch(() => {});
    } finally {
      setSyncing(false);
    }
  }, [list, fetchQuotes, fetchSectors]);

  useEffect(() => {
    (async () => {
      const saved = await loadPortfolio();
      setList(saved);
      await fetchQuotes(saved);
      fetchSectors(saved);
      setLoading(false);
    })();
  }, [fetchQuotes, fetchSectors]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchQuotes(list);
    fetchSectors(list);
    setRefreshing(false);
  }, [list, fetchQuotes, fetchSectors]);

  const onAdd = useCallback(async () => {
    const next = await addHolding(list, sym, parseFloat(qty), parseFloat(price));
    if (next !== list) {
      setSym('');
      setQty('');
      setPrice('');
      setList(next);
      await fetchQuotes(next);
      fetchSectors(next);
    }
  }, [list, sym, qty, price, fetchQuotes, fetchSectors]);

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

  // Per-holding rows with market-value weights, sorted by value.
  const rows = useMemo<Row[]>(() => {
    const totalValue = totals.value || 1;
    return list
      .map((h) => {
        const q = quotes[h.symbol];
        const priced = q?.price != null;
        const invested = h.qty * h.avg;
        const value = priced ? h.qty * (q!.price as number) : invested;
        const pnl = value - invested;
        return {
          h,
          q,
          priced,
          invested,
          value,
          pnl,
          pnlPct: invested > 0 ? (pnl / invested) * 100 : 0,
          dayPnl: priced && q?.absChg != null ? h.qty * q.absChg : 0,
          weight: value / totalValue,
          sector: sectors[h.symbol] || 'Unknown',
        };
      })
      .sort((a, b) => b.value - a.value);
  }, [list, quotes, sectors, totals.value]);

  // Allocation: by sector when any sector is known, else by holding.
  const sectorAvailable = useMemo(() => rows.some((r) => r.sector !== 'Unknown'), [rows]);
  const allocation = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rows) {
      const name = sectorAvailable ? r.sector : r.h.symbol;
      map.set(name, (map.get(name) ?? 0) + r.weight);
    }
    return [...map.entries()].map(([name, w]) => ({ name, w })).sort((a, b) => b.w - a.w);
  }, [rows, sectorAvailable]);

  const concentration = useMemo(() => {
    const ws = rows.map((r) => r.weight);
    const hhi = hhiOf(ws);
    return { hhi, top: ws.length ? Math.max(...ws) : 0, n: rows.length, ...concLabel(hhi) };
  }, [rows]);

  // Visible/ordered columns from prefs (Symbol always first, hidden dropped).
  const visibleCols = useMemo(() => {
    const byKey = new Map(COLS.map((c) => [c.key, c]));
    const seen = new Set<string>();
    const ordered: PCol[] = [];
    colOrder.forEach((k) => {
      const c = byKey.get(k);
      if (c && !seen.has(k)) {
        seen.add(k);
        ordered.push(c);
      }
    });
    COLS.forEach((c) => {
      if (!seen.has(c.key)) ordered.push(c);
    });
    const symIdx = ordered.findIndex((c) => c.key === 'sym');
    if (symIdx > 0) ordered.unshift(ordered.splice(symIdx, 1)[0]);
    const hidden = new Set(colHidden.filter((k) => k !== 'sym'));
    return ordered.filter((c) => !hidden.has(c.key));
  }, [colOrder, colHidden]);

  const tableW = useMemo(
    () => visibleCols.reduce((a, c) => a + c.w, 0) + ACTIONS_W,
    [visibleCols],
  );

  const doExport = useCallback(
    (kind: 'csv' | 'excel') => {
      const headers = visibleCols.map((c) => c.label);
      const out = rows.map((r) => visibleCols.map((c) => c.text(r)));
      const fn = kind === 'csv' ? exportCsvRows : exportExcelRows;
      fn(headers, out, 'portfolio').catch(() => {});
    },
    [visibleCols, rows],
  );

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
      <ScreenTitle
        title="Portfolio"
        sub={
          list.length
            ? `${list.length} holding${list.length === 1 ? '' : 's'} · live valuation${totals.priced < list.length ? ` · ${totals.priced}/${list.length} priced` : ''}`
            : 'Live-valued holdings · saved on this device'
        }
      />
      <ScrollView
        contentContainerStyle={styles.scrollBody}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accent} />
        }
      >
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

        {broker?.configured && ownerAuth && !ownerAuth.owner ? (
          // Owner unlock: broker holdings are private to the instance owner.
          ownerAuth.configured ? (
            <Card style={styles.brokerCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.brokerTitle}>ZERODHA · LOCKED</Text>
                <Text style={styles.brokerSub}>
                  {authMsg || 'Enter the owner passcode to access broker sync (holdings are private).'}
                </Text>
              </View>
              <TextInput
                style={[styles.input, { minWidth: 120 }]}
                value={pw}
                onChangeText={setPw}
                placeholder="Passcode"
                placeholderTextColor={theme.muted}
                secureTextEntry
                onSubmitEditing={ownerLogin}
              />
              <Btn label="UNLOCK" onPress={ownerLogin} />
            </Card>
          ) : null
        ) : broker?.configured ? (
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

        {list.length ? (
          <>
            {/* holdings table toolbar */}
            <View style={styles.toolbar}>
              <TouchableOpacity style={styles.toolBtn} onPress={() => setColMenu(true)} activeOpacity={0.75}>
                <Text style={styles.toolTxt}>▤ Columns</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.toolBtn} onPress={() => doExport('csv')} activeOpacity={0.75}>
                <Text style={styles.toolTxt}>⇩ CSV</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.toolBtn} onPress={() => doExport('excel')} activeOpacity={0.75}>
                <Text style={styles.toolTxt}>⇩ Excel</Text>
              </TouchableOpacity>
            </View>

            {/* holdings table (horizontal scroll, configurable columns) */}
            <ScrollView horizontal showsHorizontalScrollIndicator>
              <View style={{ width: tableW }}>
                <View style={styles.headerRow}>
                  {visibleCols.map((c) => (
                    <View
                      key={c.key}
                      style={[styles.thCell, { width: c.w, alignItems: c.align === 'left' ? 'flex-start' : 'flex-end' }]}
                    >
                      <Text style={styles.thTxt}>{c.label}</Text>
                    </View>
                  ))}
                  <View style={styles.actionsCell} />
                </View>
                {rows.map((r) => (
                  <View key={r.h.symbol} style={styles.dataRow}>
                    {visibleCols.map((c) => (
                      <View
                        key={c.key}
                        style={[styles.tdCell, { width: c.w, alignItems: c.align === 'left' ? 'flex-start' : 'flex-end' }]}
                      >
                        {c.render(r)}
                      </View>
                    ))}
                    <View style={styles.actionsCell}>
                      <TouchableOpacity
                        onPress={() => onRemove(r.h.symbol)}
                        style={styles.del}
                        hitSlop={8}
                        activeOpacity={0.75}
                      >
                        <Text style={styles.delText}>✕</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </View>
            </ScrollView>

            {/* allocation + concentration */}
            <SectionTitle>Allocation {sectorAvailable ? 'by sector' : 'by holding'}</SectionTitle>
            <Card>
              <View style={styles.concRow}>
                <Text style={styles.concItem}>{concentration.n} holdings</Text>
                <Text style={styles.concItem}>Top {(concentration.top * 100).toFixed(1)}%</Text>
                <View style={styles.concBadge}>
                  <Text style={styles.concHhi}>HHI {concentration.hhi.toFixed(2)}</Text>
                  <Text style={[styles.concTag, { color: concentration.color }]}>{concentration.label}</Text>
                </View>
              </View>
              {!sectorAvailable ? (
                <Text style={styles.concNote}>
                  Sector data unavailable — showing allocation per holding.
                </Text>
              ) : null}
              <View style={styles.allocList}>
                {allocation.map((a) => (
                  <View key={a.name} style={styles.allocRow}>
                    <Text style={styles.allocName} numberOfLines={1}>
                      {a.name}
                    </Text>
                    <View style={styles.allocBar}>
                      <View
                        style={[
                          styles.allocFill,
                          { width: `${Math.max(2, Math.min(100, (a.w / (allocation[0]?.w || 1)) * 100))}%` },
                        ]}
                      />
                    </View>
                    <Text style={styles.allocPct}>{(a.w * 100).toFixed(1)}%</Text>
                  </View>
                ))}
              </View>
            </Card>

            {/* risk pointer — heavy analytics live on the Risk screen */}
            <SectionTitle>Portfolio risk</SectionTitle>
            <Card>
              <Text style={styles.riskTitle}>
                VaR · volatility · beta · drawdown · Sharpe · correlation
              </Text>
              <Text style={styles.riskBody}>
                Full risk analytics for these {rows.length} holding{rows.length === 1 ? '' : 's'} live on the
                dedicated Risk screen — open Analysis → Risk to run a value-at-risk report from price history.
              </Text>
            </Card>
          </>
        ) : (
          <EmptyState
            title="No holdings yet"
            hint="Add a symbol with quantity and average buy price — it's saved on this device and valued live."
          />
        )}
      </ScrollView>

      <ColumnMenu
        visible={colMenu}
        order={colOrder}
        hidden={colHidden}
        onClose={() => setColMenu(false)}
        onApply={(order, hidden) => {
          setColOrder(order);
          setColHidden(hidden);
          setColMenu(false);
        }}
        onReset={() => {
          setColOrder(COLS.map((c) => c.key));
          setColHidden([]);
          setColMenu(false);
        }}
      />
    </View>
  );
}

// ── Column show/hide + reorder (mirrors the Watchlist/Screener column menu) ─────
type ColDraft = { key: string; label: string; visible: boolean };

function ColumnMenu({
  visible,
  order,
  hidden,
  onClose,
  onApply,
  onReset,
}: {
  visible: boolean;
  order: string[];
  hidden: string[];
  onClose: () => void;
  onApply: (order: string[], hidden: string[]) => void;
  onReset: () => void;
}) {
  const [draft, setDraft] = useState<ColDraft[]>([]);
  useEffect(() => {
    if (!visible) return;
    const byKey = new Map(COL_META.map((c) => [c.key, c.label]));
    const seen = new Set<string>();
    const listDraft: ColDraft[] = [];
    order.forEach((k) => {
      const label = byKey.get(k);
      if (label != null && !seen.has(k)) {
        seen.add(k);
        listDraft.push({ key: k, label, visible: !hidden.includes(k) });
      }
    });
    COL_META.forEach((c) => {
      if (!seen.has(c.key)) listDraft.push({ key: c.key, label: c.label, visible: !hidden.includes(c.key) });
    });
    const symIdx = listDraft.findIndex((c) => c.key === 'sym');
    if (symIdx > 0) listDraft.unshift(listDraft.splice(symIdx, 1)[0]);
    setDraft(listDraft);
  }, [visible, order, hidden]);

  const move = (i: number, delta: number) => {
    const j = i + delta;
    if (i < 1 || j < 1 || j >= draft.length) return; // Symbol (index 0) locked first
    setDraft((d) => {
      const next = [...d];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };
  const toggle = (key: string) =>
    setDraft((d) => d.map((c) => (c.key === key && key !== 'sym' ? { ...c, visible: !c.visible } : c)));

  const apply = () =>
    onApply(draft.map((c) => c.key), draft.filter((c) => !c.visible).map((c) => c.key));

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.drawer}>
        <View style={styles.drawerHead}>
          <Text style={styles.drawerTitle}>Columns</Text>
          <TouchableOpacity onPress={onReset} activeOpacity={0.75}>
            <Text style={styles.clearAll}>Reset</Text>
          </TouchableOpacity>
        </View>
        <ScrollView>
          {draft.map((c, i) => {
            const locked = c.key === 'sym';
            return (
              <View key={c.key} style={styles.colRow}>
                <TouchableOpacity
                  style={styles.colCheck}
                  onPress={() => toggle(c.key)}
                  disabled={locked}
                  activeOpacity={0.75}
                >
                  <Text style={[styles.colBox, c.visible && styles.colBoxOn]}>{c.visible ? '☑' : '☐'}</Text>
                  <Text style={[styles.colLabel, locked && { color: theme.muted }]}>
                    {c.label}
                    {locked ? ' (locked)' : ''}
                  </Text>
                </TouchableOpacity>
                <View style={styles.colMoves}>
                  <TouchableOpacity
                    style={[styles.moveBtn, (locked || i <= 1) && styles.moveBtnOff]}
                    onPress={() => move(i, -1)}
                    disabled={locked || i <= 1}
                    activeOpacity={0.75}
                  >
                    <Text style={styles.moveTxt}>↑</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.moveBtn, (locked || i >= draft.length - 1) && styles.moveBtnOff]}
                    onPress={() => move(i, 1)}
                    disabled={locked || i >= draft.length - 1}
                    activeOpacity={0.75}
                  >
                    <Text style={styles.moveTxt}>↓</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </ScrollView>
        <View style={styles.drawerFoot}>
          <Btn label="Cancel" kind="ghost" onPress={onClose} style={{ flex: 1 }} />
          <Btn label="Apply" onPress={apply} style={{ flex: 2 }} />
        </View>
      </View>
    </Modal>
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
  container: { flex: 1, backgroundColor: theme.bg },
  scrollBody: { paddingHorizontal: theme.sp.lg, paddingBottom: theme.sp.xl },
  center: { flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' },
  summaryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.sp.sm,
    marginTop: theme.sp.sm,
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
  // toolbar
  toolbar: { flexDirection: 'row', gap: theme.sp.sm, marginTop: theme.sp.md, marginBottom: theme.sp.sm },
  toolBtn: {
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.sm + 2,
    paddingHorizontal: theme.sp.md,
    paddingVertical: theme.sp.sm + 1,
  },
  toolTxt: { color: theme.text, fontSize: theme.fs.sm + 1, fontWeight: '600' },
  // table
  headerRow: {
    flexDirection: 'row',
    borderBottomColor: theme.border2,
    borderBottomWidth: 1,
    backgroundColor: theme.surface2,
    paddingVertical: theme.sp.md,
  },
  thCell: { justifyContent: 'center', paddingHorizontal: theme.sp.xs },
  thTxt: {
    color: theme.muted2,
    fontSize: theme.fs.xs + 1,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  dataRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    borderBottomColor: theme.border,
    borderBottomWidth: 1,
    paddingVertical: theme.sp.md,
  },
  tdCell: { justifyContent: 'center', paddingHorizontal: theme.sp.xs },
  cell: { color: theme.text, fontFamily: theme.mono, fontSize: theme.fs.sm, textAlign: 'right' },
  cellSub: { fontFamily: theme.mono, fontSize: theme.fs.xs + 1, marginTop: 2, textAlign: 'right' },
  symTxt: { color: theme.text, fontFamily: theme.mono, fontWeight: '700', fontSize: theme.fs.md },
  symSub: { color: theme.muted, fontFamily: theme.mono, fontSize: theme.fs.xs + 1, marginTop: 2 },
  actionsCell: { width: ACTIONS_W, alignItems: 'center', justifyContent: 'center' },
  del: { padding: theme.sp.xs },
  delText: { color: theme.muted, fontSize: theme.fs.md + 1 },
  // allocation + concentration
  concRow: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.md, flexWrap: 'wrap' },
  concItem: { color: theme.muted2, fontSize: theme.fs.sm, fontFamily: theme.mono },
  concBadge: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.sm, marginLeft: 'auto' },
  concHhi: { color: theme.muted2, fontSize: theme.fs.sm, fontFamily: theme.mono },
  concTag: { fontSize: theme.fs.sm, fontWeight: '700', letterSpacing: 0.4 },
  concNote: { color: theme.muted, fontSize: theme.fs.xs + 1, marginTop: theme.sp.sm },
  allocList: { marginTop: theme.sp.md, gap: theme.sp.sm },
  allocRow: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.sm },
  allocName: { color: theme.text, fontSize: theme.fs.sm, width: 118 },
  allocBar: {
    flex: 1,
    height: 8,
    backgroundColor: theme.surface2,
    borderRadius: 999,
    overflow: 'hidden',
  },
  allocFill: { height: 8, backgroundColor: theme.accent, borderRadius: 999 },
  allocPct: { color: theme.muted2, fontSize: theme.fs.sm, fontFamily: theme.mono, width: 52, textAlign: 'right' },
  // risk pointer
  riskTitle: { color: theme.text, fontSize: theme.fs.sm, fontWeight: '700', fontFamily: theme.mono },
  riskBody: { color: theme.muted, fontSize: theme.fs.sm, marginTop: theme.sp.sm, lineHeight: 19 },
  // column-menu drawer chrome
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  drawer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    top: 60,
    backgroundColor: theme.surface,
    borderTopLeftRadius: theme.radius.lg + 2,
    borderTopRightRadius: theme.radius.lg + 2,
    overflow: 'hidden',
  },
  drawerHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: theme.sp.lg,
    borderBottomColor: theme.border,
    borderBottomWidth: 1,
  },
  drawerTitle: { color: theme.text, fontSize: theme.fs.lg, fontWeight: '700' },
  clearAll: { color: theme.muted2, fontSize: theme.fs.sm, fontWeight: '600' },
  drawerFoot: {
    flexDirection: 'row',
    gap: theme.sp.md,
    padding: theme.sp.lg,
    borderTopColor: theme.border,
    borderTopWidth: 1,
  },
  colRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.sp.lg,
    paddingVertical: theme.sp.sm + 2,
    borderBottomColor: theme.border,
    borderBottomWidth: 1,
  },
  colCheck: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.md, flex: 1 },
  colBox: { color: theme.muted, fontSize: theme.fs.lg },
  colBoxOn: { color: theme.green },
  colLabel: { color: theme.text, fontSize: theme.fs.md },
  colMoves: { flexDirection: 'row', gap: theme.sp.sm },
  moveBtn: {
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.sp.md,
    paddingVertical: 4,
    minWidth: 38,
    alignItems: 'center',
  },
  moveBtnOff: { opacity: 0.35 },
  moveTxt: { color: theme.text, fontSize: theme.fs.md, fontWeight: '700' },
});
