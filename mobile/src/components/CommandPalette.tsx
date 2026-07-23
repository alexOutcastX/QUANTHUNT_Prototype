// Global command palette — ⌘K / Ctrl+K on desktop web, the search button in
// the header everywhere. One input that resolves to either a stock (→ the
// Symbol page) or a destination (→ navigate). This is the "type the ticker,
// get the answer" gesture the terminal crowd expects.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { UniverseSymbol } from '../api';
import { Icon, IconName } from '../icons';
import { navigate, openStock } from '../navIntent';
import { theme } from '../theme';
import { loadUniverse } from './SymbolInput';

type Dest = { label: string; hint: string; icon: IconName; page: string; sub?: string };

// Every reachable surface, palette-searchable by name. Destinations use the
// same page/sub keys the nav-intent layer already understands.
const DESTS: Dest[] = [
  { label: 'Today', hint: 'Market overview & movers', icon: 'home', page: 'today' },
  { label: 'Screener', hint: 'Filter NSE / BSE — the raw scan', icon: 'screens', page: 'screens', sub: 'screener' },
  { label: 'Recommendations', hint: 'Ranked buy setups', icon: 'screens', page: 'screens', sub: 'reco' },
  { label: 'Multibagger', hint: 'Long-term candidates', icon: 'screens', page: 'screens', sub: 'mb' },
  { label: 'Momentum', hint: 'Trend & thrust radar', icon: 'screens', page: 'screens', sub: 'momentum' },
  { label: 'Patterns', hint: 'Chart-pattern scanner', icon: 'screens', page: 'screens', sub: 'patterns' },
  { label: 'Heatmap', hint: 'Sector map', icon: 'screens', page: 'screens', sub: 'heatmap' },
  { label: 'Universe', hint: 'Market overview — the Today landing page', icon: 'home', page: 'today' },
  { label: 'Watchlist', hint: 'Your tracked symbols', icon: 'desk', page: 'desk', sub: 'watchlist' },
  { label: 'Portfolio', hint: 'Holdings & live P&L', icon: 'desk', page: 'desk', sub: 'portfolio' },
  { label: 'Paper trades', hint: 'Simulated setups & win-rate', icon: 'desk', page: 'desk', sub: 'paper' },
  { label: 'Alerts', hint: 'Price / % / RSI alerts', icon: 'desk', page: 'desk', sub: 'alerts' },
  { label: 'Dossier', hint: 'Institutional company report', icon: 'desk', page: 'desk', sub: 'inst' },
  { label: 'Shareholders', hint: 'Ownership & entity graph', icon: 'desk', page: 'desk', sub: 'shareholders' },
  { label: 'Risk', hint: 'Portfolio VaR & drawdown', icon: 'desk', page: 'desk', sub: 'risk' },
  { label: 'Backtest', hint: 'Test a strategy on history', icon: 'flask', page: 'backtest', sub: 'bt' },
  { label: 'Calculator', hint: 'Position size · SIP · CAGR', icon: 'desk', page: 'desk', sub: 'calc' },
  { label: 'Terminal', hint: 'Workspace, graph & compare', icon: 'terminal', page: 'terminal' },
  { label: 'Symbol', hint: 'One page per stock', icon: 'stock', page: 'stock', sub: 'stock' },
  { label: 'More', hint: 'Charts, community, corporate data & settings', icon: 'desk', page: 'desk', sub: 'more' },
];

const MAX_SYMBOLS = 8;

export default function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [symbols, setSymbols] = useState<UniverseSymbol[] | null>(null);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (!open) return;
    setQ('');
    loadUniverse().then(setSymbols).catch(() => {});
    // RN's autoFocus fires before the Modal finishes mounting on web.
    const t = setTimeout(() => inputRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, [open]);

  const query = q.trim().toUpperCase();
  const dests = useMemo(
    () => (query ? DESTS.filter((d) => d.label.toUpperCase().includes(query)) : DESTS).slice(0, query ? 4 : 20),
    [query],
  );
  const stocks = useMemo(() => {
    if (!query || !symbols?.length) return [];
    let exact: UniverseSymbol | null = null;
    const prefix: UniverseSymbol[] = [];
    const substr: UniverseSymbol[] = [];
    const byName: UniverseSymbol[] = [];
    for (const s of symbols) {
      const sym = (s.symbol || '').toUpperCase();
      if (!sym) continue;
      if (sym === query) exact = s;
      else if (sym.startsWith(query)) prefix.push(s);
      else if (substr.length + byName.length < MAX_SYMBOLS) {
        if (sym.includes(query)) substr.push(s);
        else if ((s.name || '').toUpperCase().includes(query)) byName.push(s);
      }
    }
    return [...(exact ? [exact] : []), ...prefix, ...substr, ...byName].slice(0, MAX_SYMBOLS);
  }, [query, symbols]);

  const pickStock = (sym: string) => {
    onClose();
    openStock(sym);
  };
  const pickDest = (d: Dest) => {
    onClose();
    navigate(d.page, d.sub ? { sub: d.sub } : {});
  };

  if (!open) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} />
      <View style={styles.panel}>
        <View style={styles.inputRow}>
          <Icon name="search" size={16} color={theme.muted} />
          <TextInput
            ref={inputRef}
            style={styles.input}
            value={q}
            onChangeText={setQ}
            placeholder="Search a stock or jump to a page…"
            placeholderTextColor={theme.muted}
            autoCapitalize="characters"
            autoCorrect={false}
            autoFocus
            onSubmitEditing={() => {
              if (stocks[0]) pickStock(stocks[0].symbol);
              else if (dests[0]) pickDest(dests[0]);
            }}
          />
          <TouchableOpacity onPress={onClose} hitSlop={10} accessibilityLabel="Close">
            <Icon name="close" size={16} color={theme.muted2} />
          </TouchableOpacity>
        </View>
        <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
          {stocks.length ? <Text style={styles.section}>STOCKS</Text> : null}
          {stocks.map((s) => (
            <TouchableOpacity key={s.symbol} style={styles.row} onPress={() => pickStock(s.symbol)} activeOpacity={0.75}>
              <Icon name="stock" size={15} color={theme.brand} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowSym}>{s.symbol}</Text>
                {s.name ? <Text style={styles.rowHint} numberOfLines={1}>{s.name}</Text> : null}
              </View>
              {s.exchange ? <Text style={styles.rowExch}>{s.exchange}</Text> : null}
            </TouchableOpacity>
          ))}
          {dests.length ? <Text style={styles.section}>GO TO</Text> : null}
          {dests.map((d) => (
            <TouchableOpacity key={d.label} style={styles.row} onPress={() => pickDest(d)} activeOpacity={0.75}>
              <Icon name={d.icon} size={15} color={theme.muted2} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowLabel}>{d.label}</Text>
                <Text style={styles.rowHint} numberOfLines={1}>{d.hint}</Text>
              </View>
            </TouchableOpacity>
          ))}
          {query && !stocks.length && !dests.length ? (
            <Text style={styles.empty}>Nothing matches “{q.trim()}”.</Text>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000a' },
  panel: {
    position: 'absolute',
    top: '10%',
    alignSelf: 'center',
    width: '92%',
    maxWidth: 560,
    maxHeight: '70%',
    backgroundColor: theme.surface,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.lg,
    overflow: 'hidden',
    ...theme.shadow.card,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.sp.md,
    paddingHorizontal: theme.sp.lg,
    borderBottomColor: theme.border,
    borderBottomWidth: 1,
  },
  input: {
    flex: 1,
    color: theme.text,
    fontSize: theme.fs.md,
    fontFamily: theme.mono,
    paddingVertical: theme.sp.md + 2,
  },
  list: { flexGrow: 0 },
  section: {
    color: theme.muted,
    fontSize: theme.fs.xs,
    letterSpacing: 1,
    fontWeight: '700',
    paddingHorizontal: theme.sp.lg,
    paddingTop: theme.sp.md,
    paddingBottom: theme.sp.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.sp.md,
    paddingHorizontal: theme.sp.lg,
    paddingVertical: theme.sp.sm + 2,
  },
  rowSym: { color: theme.text, fontFamily: theme.mono, fontWeight: '700', fontSize: theme.fs.sm + 1 },
  rowLabel: { color: theme.text, fontWeight: '600', fontSize: theme.fs.sm + 1 },
  rowHint: { color: theme.muted, fontSize: theme.fs.xs + 1, marginTop: 1 },
  rowExch: { color: theme.muted2, fontFamily: theme.mono, fontSize: theme.fs.xs, letterSpacing: 0.5 },
  empty: { color: theme.muted, fontSize: theme.fs.sm, padding: theme.sp.lg },
});
