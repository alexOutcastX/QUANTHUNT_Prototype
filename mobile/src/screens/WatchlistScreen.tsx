import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
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
import { Quote, api } from '../api';
import { exportCsvRows, exportExcelRows } from '../csv';
import { theme } from '../theme';
import { Btn, EmptyState, Loading, ScreenTitle } from '../ui';
import {
  Watchlist,
  WatchlistStore,
  addSymbolToWatchlist,
  createWatchlist,
  deleteWatchlist,
  getWatchlistStore,
  removeSymbolFromWatchlist,
  renameWatchlist,
  setActiveWatchlist,
} from '../watchlist';

// ── formatting ────────────────────────────────────────────────────────────────
const money = (v?: number | null) =>
  v == null || !isFinite(v) ? '—' : '₹' + v.toLocaleString('en-IN', { maximumFractionDigits: 2 });
const num = (v?: number | null) =>
  v == null || !isFinite(v) ? '—' : v.toLocaleString('en-IN', { maximumFractionDigits: 2 });
const pct = (v?: number | null) =>
  v == null || !isFinite(v) ? '—' : (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
const numText = (v?: number | null) => (v == null || !isFinite(v) ? '' : String(v));
const colorOf = (v?: number | null) =>
  v == null || !isFinite(v) ? theme.muted : v >= 0 ? theme.green : theme.red;
const fmtVol = (v?: number | null) => {
  if (v == null || !isFinite(v)) return '—';
  if (v >= 1e7) return (v / 1e7).toFixed(1) + 'Cr';
  if (v >= 1e5) return (v / 1e5).toFixed(1) + 'L';
  if (v >= 1e3) return (v / 1e3).toFixed(0) + 'K';
  return String(Math.round(v));
};

// ── columns ───────────────────────────────────────────────────────────────────
type WCol = {
  key: string;
  label: string;
  w: number;
  align?: 'left' | 'right';
  render: (sym: string, q?: Quote) => React.ReactNode;
  text: (sym: string, q?: Quote) => string;
};

const COLS: WCol[] = [
  {
    key: 'sym', label: 'Symbol', w: 108, align: 'left',
    render: (sym) => <Text style={styles.symTxt}>{sym}</Text>,
    text: (sym) => sym,
  },
  {
    key: 'price', label: 'LTP', w: 96, align: 'right',
    render: (_s, q) => <Text style={styles.cell}>{money(q?.price)}</Text>,
    text: (_s, q) => numText(q?.price),
  },
  {
    key: 'chg', label: '% Chg', w: 78, align: 'right',
    render: (_s, q) => <Text style={[styles.cell, { color: colorOf(q?.chg) }]}>{pct(q?.chg)}</Text>,
    text: (_s, q) => numText(q?.chg),
  },
  {
    key: 'absChg', label: 'Chg', w: 78, align: 'right',
    render: (_s, q) => <Text style={[styles.cell, { color: colorOf(q?.absChg) }]}>{num(q?.absChg)}</Text>,
    text: (_s, q) => numText(q?.absChg),
  },
  {
    key: 'prevClose', label: 'Prev', w: 90, align: 'right',
    render: (_s, q) => <Text style={styles.cell}>{num(q?.prevClose)}</Text>,
    text: (_s, q) => numText(q?.prevClose),
  },
  {
    key: 'open', label: 'Open', w: 90, align: 'right',
    render: (_s, q) => <Text style={styles.cell}>{num(q?.open)}</Text>,
    text: (_s, q) => numText(q?.open),
  },
  {
    key: 'high', label: 'High', w: 90, align: 'right',
    render: (_s, q) => <Text style={styles.cell}>{num(q?.high)}</Text>,
    text: (_s, q) => numText(q?.high),
  },
  {
    key: 'low', label: 'Low', w: 90, align: 'right',
    render: (_s, q) => <Text style={styles.cell}>{num(q?.low)}</Text>,
    text: (_s, q) => numText(q?.low),
  },
  {
    key: 'volume', label: 'Vol', w: 82, align: 'right',
    render: (_s, q) => <Text style={styles.cell}>{fmtVol(q?.volume)}</Text>,
    text: (_s, q) => numText(q?.volume),
  },
];
const COL_META = COLS.map((c) => ({ key: c.key, label: c.label }));
const ACTIONS_W = 56; // per-row remove button
const COLS_KEY = 'taureye.watchlist.cols.v1';

export default function WatchlistScreen() {
  const [store, setStore] = useState<WatchlistStore | null>(null);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Column show/hide + order prefs.
  const [colOrder, setColOrder] = useState<string[]>(COLS.map((c) => c.key));
  const [colHidden, setColHidden] = useState<string[]>([]);
  const [colMenu, setColMenu] = useState(false);
  const [prefsRestored, setPrefsRestored] = useState(false);
  // List-management modals.
  const [nameModal, setNameModal] = useState<'create' | 'rename' | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);

  const lists = store?.lists ?? [];
  const active = useMemo<Watchlist | undefined>(
    () => lists.find((l) => l.id === store?.activeId) ?? lists[0],
    [lists, store?.activeId],
  );
  const symbols = active?.symbols ?? [];
  const symbolsKey = symbols.join(',');

  const fetchQuotes = useCallback(async (syms: string[]) => {
    if (!syms.length) {
      setQuotes({});
      return;
    }
    setError(null);
    try {
      setQuotes(await api.ltp(syms));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch quotes');
    }
  }, []);

  // Load the store + column prefs once.
  useEffect(() => {
    (async () => {
      const [s, rawCols] = await Promise.all([
        getWatchlistStore(),
        AsyncStorage.getItem(COLS_KEY),
      ]);
      if (rawCols) {
        try {
          const p = JSON.parse(rawCols);
          if (Array.isArray(p?.order)) setColOrder(p.order.filter((k: unknown) => typeof k === 'string'));
          if (Array.isArray(p?.hidden)) setColHidden(p.hidden.filter((k: unknown) => typeof k === 'string'));
        } catch {
          /* defaults */
        }
      }
      setPrefsRestored(true);
      setStore(s);
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (!prefsRestored) return;
    AsyncStorage.setItem(COLS_KEY, JSON.stringify({ order: colOrder, hidden: colHidden })).catch(() => {});
  }, [colOrder, colHidden, prefsRestored]);

  // Fetch quotes whenever the visible symbol set changes, and keep them live
  // with a periodic poll.
  useEffect(() => {
    if (!store) return;
    const syms = symbolsKey ? symbolsKey.split(',') : [];
    fetchQuotes(syms);
    const id = setInterval(() => fetchQuotes(syms), 30000);
    return () => clearInterval(id);
  }, [symbolsKey, store, fetchQuotes]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchQuotes(symbols);
    setRefreshing(false);
  }, [symbols, fetchQuotes]);

  const onAdd = useCallback(async () => {
    if (!active) return;
    const val = input;
    setInput('');
    setStore(await addSymbolToWatchlist(active.id, val));
  }, [active, input]);

  const onRemove = useCallback(
    async (sym: string) => {
      if (!active) return;
      setStore(await removeSymbolFromWatchlist(active.id, sym));
    },
    [active],
  );

  const onSelectList = useCallback(async (id: string) => {
    setStore(await setActiveWatchlist(id));
  }, []);

  const onSubmitName = useCallback(
    async (name: string) => {
      if (nameModal === 'create') setStore(await createWatchlist(name));
      else if (nameModal === 'rename' && active) setStore(await renameWatchlist(active.id, name));
      setNameModal(null);
    },
    [nameModal, active],
  );

  const onDelete = useCallback(async () => {
    if (!active) return;
    setStore(await deleteWatchlist(active.id));
    setConfirmDel(false);
  }, [active]);

  // Visible/ordered columns from prefs (Symbol always first, hidden dropped).
  const visibleCols = useMemo(() => {
    const byKey = new Map(COLS.map((c) => [c.key, c]));
    const seen = new Set<string>();
    const ordered: WCol[] = [];
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
      const rows = symbols.map((sym) => visibleCols.map((c) => c.text(sym, quotes[sym])));
      const name = `watchlist-${active?.name ?? 'list'}`;
      const fn = kind === 'csv' ? exportCsvRows : exportExcelRows;
      fn(headers, rows, name).catch(() => {});
    },
    [visibleCols, symbols, quotes, active],
  );

  const renderRow = ({ item }: { item: string }) => {
    const q = quotes[item];
    return (
      <View style={styles.dataRow}>
        {visibleCols.map((c) => (
          <View
            key={c.key}
            style={[styles.td, { width: c.w, alignItems: c.align === 'left' ? 'flex-start' : 'flex-end' }]}
          >
            {c.render(item, q)}
          </View>
        ))}
        <View style={styles.actionsCell}>
          <TouchableOpacity onPress={() => onRemove(item)} style={styles.del} hitSlop={8} activeOpacity={0.75}>
            <Text style={styles.delText}>✕</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <Loading label="Loading your watchlists…" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScreenTitle
        title="Watchlist"
        sub={`${active?.name ?? 'List'} · ${symbols.length} symbol${symbols.length === 1 ? '' : 's'} · live quotes`}
      />

      {/* list switcher */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.listChips}>
        {lists.map((l) => {
          const on = l.id === active?.id;
          return (
            <TouchableOpacity
              key={l.id}
              style={[styles.listChip, on && styles.listChipOn]}
              onPress={() => onSelectList(l.id)}
              activeOpacity={0.75}
            >
              <Text style={[styles.listTxt, on && styles.listTxtOn]}>{l.name}</Text>
              <Text style={[styles.listCount, on && styles.listCountOn]}>{l.symbols.length}</Text>
            </TouchableOpacity>
          );
        })}
        <TouchableOpacity style={styles.listAdd} onPress={() => setNameModal('create')} activeOpacity={0.75}>
          <Text style={styles.listAddTxt}>+ New</Text>
        </TouchableOpacity>
      </ScrollView>

      <View style={styles.body}>
        <View style={styles.addRow}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="Add symbol — e.g. TCS"
            placeholderTextColor={theme.muted}
            autoCapitalize="characters"
            returnKeyType="done"
            onSubmitEditing={onAdd}
          />
          <Btn label="Add" onPress={onAdd} />
        </View>

        {/* toolbar */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.toolbar}
        >
          <TouchableOpacity style={styles.toolBtn} onPress={() => setColMenu(true)} activeOpacity={0.75}>
            <Text style={styles.toolTxt}>▤ Columns</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.toolBtn} onPress={() => doExport('csv')} activeOpacity={0.75}>
            <Text style={styles.toolTxt}>⇩ CSV</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.toolBtn} onPress={() => doExport('excel')} activeOpacity={0.75}>
            <Text style={styles.toolTxt}>⇩ Excel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.toolBtn}
            onPress={() => setNameModal('rename')}
            disabled={!active}
            activeOpacity={0.75}
          >
            <Text style={styles.toolTxt}>✎ Rename</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toolBtn, styles.toolBtnDanger]}
            onPress={() => setConfirmDel(true)}
            disabled={!active}
            activeOpacity={0.75}
          >
            <Text style={[styles.toolTxt, styles.toolTxtDanger]}>🗑 Delete</Text>
          </TouchableOpacity>
        </ScrollView>

        {error ? <Text style={styles.error}>{error} — is the backend reachable?</Text> : null}

        <ScrollView horizontal showsHorizontalScrollIndicator>
          <View style={{ width: tableW }}>
            <View style={styles.headerRow}>
              {visibleCols.map((c) => (
                <View
                  key={c.key}
                  style={[styles.th, { width: c.w, alignItems: c.align === 'left' ? 'flex-start' : 'flex-end' }]}
                >
                  <Text style={styles.thTxt}>{c.label}</Text>
                </View>
              ))}
              <View style={styles.actionsCell}>
                <Text style={styles.thTxt} />
              </View>
            </View>
            <FlatList
              data={symbols}
              keyExtractor={(s) => s}
              renderItem={renderRow}
              refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accent} />
              }
              ListEmptyComponent={
                <EmptyState
                  title={`“${active?.name ?? 'This list'}” is empty — add a symbol above.`}
                  hint="Symbols are saved on this device and show live quotes."
                />
              }
            />
          </View>
        </ScrollView>
      </View>

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

      <NameModal
        visible={nameModal != null}
        title={nameModal === 'rename' ? 'Rename watchlist' : 'New watchlist'}
        initial={nameModal === 'rename' ? active?.name ?? '' : ''}
        submitLabel={nameModal === 'rename' ? 'Rename' : 'Create'}
        onClose={() => setNameModal(null)}
        onSubmit={onSubmitName}
      />

      <ConfirmModal
        visible={confirmDel}
        title={`Delete “${active?.name ?? ''}”?`}
        message={
          symbols.length
            ? `Its ${symbols.length} symbol${symbols.length === 1 ? '' : 's'} will be removed.`
            : lists.length <= 1
              ? 'This is the last list — it will be cleared, not removed.'
              : 'This list will be removed.'
        }
        onCancel={() => setConfirmDel(false)}
        onConfirm={onDelete}
      />
    </View>
  );
}

// ── Column show/hide + reorder ────────────────────────────────────────────────
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
    const list: ColDraft[] = [];
    order.forEach((k) => {
      const label = byKey.get(k);
      if (label != null && !seen.has(k)) {
        seen.add(k);
        list.push({ key: k, label, visible: !hidden.includes(k) });
      }
    });
    COL_META.forEach((c) => {
      if (!seen.has(c.key)) list.push({ key: c.key, label: c.label, visible: !hidden.includes(c.key) });
    });
    const symIdx = list.findIndex((c) => c.key === 'sym');
    if (symIdx > 0) list.unshift(list.splice(symIdx, 1)[0]);
    setDraft(list);
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

// ── Name (create / rename) prompt ─────────────────────────────────────────────
function NameModal({
  visible,
  title,
  initial,
  submitLabel,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  title: string;
  initial: string;
  submitLabel: string;
  onClose: () => void;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState(initial);
  // Re-seed the field each time the modal opens.
  const wasVisible = useRef(false);
  useEffect(() => {
    if (visible && !wasVisible.current) setName(initial);
    wasVisible.current = visible;
  }, [visible, initial]);

  const submit = () => {
    if (name.trim()) onSubmit(name.trim());
  };

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.centerModalWrap} pointerEvents="box-none">
        <View style={styles.centerModal}>
          <Text style={styles.drawerTitle}>{title}</Text>
          <TextInput
            style={styles.nameInput}
            value={name}
            onChangeText={setName}
            placeholder="List name…"
            placeholderTextColor={theme.muted}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={submit}
          />
          <View style={styles.modalFoot}>
            <Btn label="Cancel" kind="ghost" onPress={onClose} style={{ flex: 1 }} />
            <Btn label={submitLabel} onPress={submit} disabled={!name.trim()} style={{ flex: 1 }} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ── Delete confirmation ───────────────────────────────────────────────────────
function ConfirmModal({
  visible,
  title,
  message,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  title: string;
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel} />
      <View style={styles.centerModalWrap} pointerEvents="box-none">
        <View style={styles.centerModal}>
          <Text style={styles.drawerTitle}>{title}</Text>
          <Text style={styles.confirmMsg}>{message}</Text>
          <View style={styles.modalFoot}>
            <Btn label="Cancel" kind="ghost" onPress={onCancel} style={{ flex: 1 }} />
            <Btn label="Delete" kind="danger" onPress={onConfirm} style={{ flex: 1 }} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  body: { flex: 1, paddingHorizontal: theme.sp.lg },
  center: { flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' },
  // list switcher
  listChips: { paddingHorizontal: theme.sp.lg, paddingBottom: theme.sp.md, gap: theme.sp.sm, alignItems: 'center' },
  listChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.sp.sm,
    backgroundColor: theme.surface2,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 13,
    paddingVertical: 7,
  },
  listChipOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  listTxt: { color: theme.muted2, fontSize: theme.fs.sm },
  listTxtOn: { color: theme.onAccent, fontWeight: '700' },
  listCount: {
    color: theme.muted,
    fontSize: theme.fs.xs,
    fontFamily: theme.mono,
    backgroundColor: theme.surface3,
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 1,
    overflow: 'hidden',
  },
  listCountOn: { color: theme.onAccent, backgroundColor: 'rgba(0,0,0,0.15)' },
  listAdd: {
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 13,
    paddingVertical: 7,
  },
  listAddTxt: { color: theme.muted2, fontSize: theme.fs.sm, fontWeight: '700' },
  // add row
  addRow: { flexDirection: 'row', gap: theme.sp.sm, marginBottom: theme.sp.sm },
  input: {
    flex: 1,
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
  // toolbar
  toolbar: { gap: theme.sp.sm, paddingBottom: theme.sp.sm },
  toolBtn: {
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.sm + 2,
    paddingHorizontal: theme.sp.md,
    paddingVertical: theme.sp.sm + 1,
  },
  toolBtnDanger: { borderColor: theme.red },
  toolTxt: { color: theme.text, fontSize: theme.fs.sm + 1, fontWeight: '600' },
  toolTxtDanger: { color: theme.red },
  error: { color: theme.red, fontSize: theme.fs.sm, marginBottom: theme.sp.sm },
  // table
  headerRow: {
    flexDirection: 'row',
    borderBottomColor: theme.border2,
    borderBottomWidth: 1,
    backgroundColor: theme.surface2,
    paddingVertical: theme.sp.md,
  },
  th: { justifyContent: 'center', paddingHorizontal: theme.sp.xs },
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
  td: { justifyContent: 'center', paddingHorizontal: theme.sp.xs },
  cell: { color: theme.text, fontFamily: theme.mono, fontSize: theme.fs.sm },
  symTxt: { color: theme.text, fontFamily: theme.mono, fontWeight: '700', fontSize: theme.fs.md },
  actionsCell: { width: ACTIONS_W, alignItems: 'center', justifyContent: 'center' },
  del: { padding: theme.sp.xs },
  delText: { color: theme.muted, fontSize: theme.fs.md + 1 },
  // shared modal chrome
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
  // column menu rows
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
  // centered modals (name / confirm)
  centerModalWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.sp.xl,
  },
  centerModal: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: theme.surface,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.lg,
    padding: theme.sp.lg,
    gap: theme.sp.md,
  },
  nameInput: {
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.sm + 2,
    color: theme.text,
    paddingHorizontal: theme.sp.md,
    paddingVertical: 10,
    fontSize: theme.fs.md,
  },
  confirmMsg: { color: theme.muted2, fontSize: theme.fs.sm, lineHeight: 19 },
  modalFoot: { flexDirection: 'row', gap: theme.sp.md },
});
