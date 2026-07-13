import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { API_BASE, EntityGraph, EntityNode, FlowEdge, api } from '../api';
import SymbolInput from '../components/SymbolInput';
import { Card, EmptyState, Loading, ScreenTitle, SectionTitle } from '../ui';
import { theme } from '../theme';

type Mode = 'institutions' | 'stock';

const compact = (v: number | null | undefined) => {
  if (v == null) return '—';
  const a = Math.abs(v);
  const s = v < 0 ? '-' : '';
  if (a >= 1e7) return s + (a / 1e7).toFixed(2) + 'Cr';
  if (a >= 1e5) return s + (a / 1e5).toFixed(2) + 'L';
  if (a >= 1e3) return s + (a / 1e3).toFixed(1) + 'k';
  return s + Math.round(a);
};
const price = (v: number | null) => (v == null ? '—' : '₹' + v.toLocaleString('en-IN'));

export default function EntityGraphScreen() {
  const [mode, setMode] = useState<Mode>('institutions');
  const [graph, setGraph] = useState<EntityGraph | null | undefined>(undefined);
  const [openEntity, setOpenEntity] = useState<string | null>(null);
  const [positions, setPositions] = useState<Record<string, FlowEdge[] | 'loading'>>({});

  const [symInput, setSymInput] = useState('TATASTEEL');
  const [sym, setSym] = useState('');
  const [flows, setFlows] = useState<FlowEdge[] | null | undefined>(undefined);

  // Free-text filter for the institutions list (by name or id).
  const [entQuery, setEntQuery] = useState('');
  const entities = graph && graph.nodes ? graph.nodes.entities : [];
  const filteredEntities = useMemo(() => {
    const q = entQuery.trim().toUpperCase();
    if (!q) return entities;
    return entities.filter(
      (e) => (e.name || '').toUpperCase().includes(q) || (e.id || '').toUpperCase().includes(q),
    );
  }, [entities, entQuery]);

  useEffect(() => {
    if (graph === undefined) api.entityGraph().then(setGraph).catch(() => setGraph(null));
  }, [graph]);

  const toggleEntity = useCallback(
    (ent: EntityNode) => {
      if (openEntity === ent.id) {
        setOpenEntity(null);
        return;
      }
      setOpenEntity(ent.id);
      if (!positions[ent.id]) {
        setPositions((p) => ({ ...p, [ent.id]: 'loading' }));
        api
          .entityPositions(ent.id)
          .then((r) => setPositions((p) => ({ ...p, [ent.id]: r.positions })))
          .catch(() => setPositions((p) => ({ ...p, [ent.id]: [] })));
      }
    },
    [openEntity, positions],
  );

  const loadSymbol = (s: string) => {
    const v = s.trim().toUpperCase().replace(/^NSE:/, '');
    if (!v) return;
    setSym(v);
    setFlows(undefined);
    api.symbolFlows(v).then((r) => setFlows(r.flows)).catch(() => setFlows(null));
  };

  return (
    <View style={styles.container}>
      <ScreenTitle title="Entity graph" sub="Institutional link analysis · grounded in NSE deals" />

      <View style={styles.tabRow}>
        <Tab label="Institutions" on={mode === 'institutions'} onPress={() => setMode('institutions')} />
        <Tab label="By stock" on={mode === 'stock'} onPress={() => setMode('stock')} />
      </View>

      {mode === 'stock' ? (
        <View style={styles.searchWrap}>
          <SymbolInput
            value={symInput}
            onChangeText={setSymInput}
            onSelect={loadSymbol}
            onSubmit={() => loadSymbol(symInput)}
            inputStyle={styles.input}
            placeholder="Symbol — who's trading it"
          />
        </View>
      ) : graph && graph.nodes && graph.nodes.entities.length ? (
        <View style={styles.searchWrap}>
          <View style={styles.searchBox}>
            <Text style={styles.searchIcon}>⌕</Text>
            <TextInput
              value={entQuery}
              onChangeText={setEntQuery}
              style={styles.searchInput}
              placeholder="Search institution…"
              placeholderTextColor={theme.muted}
              autoCapitalize="characters"
              autoCorrect={false}
            />
            {entQuery ? (
              <TouchableOpacity onPress={() => setEntQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={styles.searchClear}>✕</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      ) : null}

      <ScrollView contentContainerStyle={styles.body}>
        {mode === 'institutions' ? (
          graph === undefined ? (
            <Loading label="Building entity graph…" />
          ) : !graph || !graph.nodes.entities.length ? (
            <EmptyState
              title="No deal-flow data"
              hint="Built from NSE bulk/block deals — best from an Indian IP, and quiet sessions have few deals."
            />
          ) : (
            <>
              <Text style={styles.asof}>
                {entQuery
                  ? `${filteredEntities.length} of ${graph.nodes.entities.length} institutions`
                  : `${graph.nodes.entities.length} institutions`}{' '}
                · {graph.edges.length} links · {graph.asof.first || '—'} → {graph.asof.last || '—'}
              </Text>
              {entQuery && !filteredEntities.length ? (
                <Text style={styles.none}>No institution matches “{entQuery}”.</Text>
              ) : null}
              {filteredEntities.map((ent) => (
                <View key={ent.id}>
                  <TouchableOpacity style={styles.entRow} onPress={() => toggleEntity(ent)} activeOpacity={0.7}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.entName}>{ent.name}</Text>
                      <Text style={styles.entMeta}>
                        {ent.breadth} stock{ent.breadth === 1 ? '' : 's'} · {ent.deals} deal
                        {ent.deals === 1 ? '' : 's'}
                      </Text>
                    </View>
                    <Text style={styles.chev}>{openEntity === ent.id ? '−' : '+'}</Text>
                  </TouchableOpacity>
                  {openEntity === ent.id ? (
                    positions[ent.id] === 'loading' || !positions[ent.id] ? (
                      <Loading />
                    ) : (positions[ent.id] as FlowEdge[]).length ? (
                      (positions[ent.id] as FlowEdge[]).map((e, i) => <EdgeCard key={i} e={e} show="symbol" />)
                    ) : (
                      <Text style={styles.none}>No positions.</Text>
                    )
                  ) : null}
                </View>
              ))}
              <Text style={styles.note}>{graph.disclaimer}</Text>
            </>
          )
        ) : /* stock pivot */ !sym ? (
          <EmptyState icon="⌕" title="Enter a symbol" hint="See every institution that traded it, net flow, and the cited deals." />
        ) : flows === undefined ? (
          <Loading label={`Finding institutions in ${sym}…`} />
        ) : !flows || !flows.length ? (
          <EmptyState title={`No bulk/block deals for ${sym}`} hint="Recent sessions only; grounded in NSE records." />
        ) : (
          <>
            <SectionTitle>{sym} · institutional flow</SectionTitle>
            {flows.map((e, i) => (
              <EdgeCard key={i} e={e} show="entity" />
            ))}
            <Text style={styles.note}>
              Grounded in NSE bulk/block deal records — each link is cited and dated.
            </Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Tab({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={[styles.tab, on && styles.tabOn]} onPress={onPress} activeOpacity={0.75}>
      <Text style={[styles.tabTxt, on && styles.tabTxtOn]}>{label}</Text>
    </TouchableOpacity>
  );
}

// A grounded edge: net flow + provenance. Tap to reveal the cited deal rows.
function EdgeCard({ e, show }: { e: FlowEdge; show: 'symbol' | 'entity' }) {
  const [open, setOpen] = useState(false);
  const acc = e.net_qty >= 0;
  const title = show === 'symbol' ? e.symbol : e.entity_name;
  // On a stock row, offer a shortcut to that company's profile page.
  const openProfile = () =>
    Linking.openURL(`${API_BASE || ''}/research.html?symbol=${encodeURIComponent(e.symbol)}`).catch(() => {});
  return (
    <Card style={styles.edge}>
      <View style={styles.edgeHead}>
        <Text style={styles.edgeTitle}>{title}</Text>
        {show === 'symbol' ? (
          <TouchableOpacity
            onPress={openProfile}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.openBtn}
          >
            <Text style={styles.openTxt}>↗ PROFILE</Text>
          </TouchableOpacity>
        ) : null}
        <Text style={[styles.edgeNet, { color: acc ? theme.green : theme.red }]}>
          {acc ? '▲ ' : '▼ '}
          {compact(e.net_qty)}
        </Text>
      </View>
      <TouchableOpacity onPress={() => setOpen((o) => !o)} activeOpacity={0.7}>
        <View style={styles.edgeMetaRow}>
          <Text style={styles.edgeMeta}>
            {e.deal_count} deal{e.deal_count === 1 ? '' : 's'} · buy {compact(e.buy_qty)} · sell{' '}
            {compact(e.sell_qty)} · avg {price(e.avg_price)}
          </Text>
        </View>
        <Text style={styles.edgeDates}>
          {e.first_date}
          {e.last_date && e.last_date !== e.first_date ? ` → ${e.last_date}` : ''} · tap for {e.citations.length}{' '}
          citation{e.citations.length === 1 ? '' : 's'}
        </Text>
      </TouchableOpacity>
      {open ? (
        <View style={styles.cites}>
          {e.citations.map((c, i) => (
            <View key={i} style={styles.citeRow}>
              <Text style={[styles.citeSide, { color: /buy/i.test(c.side) ? theme.green : theme.red }]}>
                {(c.side || '?').slice(0, 4).toUpperCase()}
              </Text>
              <Text style={styles.citeDate}>{c.date}</Text>
              <Text style={styles.citeKind}>{c.kind}</Text>
              <Text style={styles.citeNum}>{compact(c.qty)}</Text>
              <Text style={styles.citeNum}>{price(c.price)}</Text>
            </View>
          ))}
          <Text style={styles.citeSrc}>Source: NSE bulk/block deals</Text>
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  tabRow: { flexDirection: 'row', gap: theme.sp.sm, paddingHorizontal: theme.sp.lg, paddingBottom: theme.sp.sm },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: theme.surface2,
    borderColor: theme.border,
    borderWidth: 1,
  },
  tabOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  tabTxt: { color: theme.muted2, fontSize: theme.fs.sm, fontWeight: '700' },
  tabTxtOn: { color: theme.onAccent },
  searchWrap: { paddingHorizontal: theme.sp.lg, paddingBottom: theme.sp.sm, zIndex: 50 },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.sm + 2,
    paddingHorizontal: theme.sp.md,
  },
  searchIcon: { color: theme.muted, fontSize: theme.fs.md, marginRight: theme.sp.sm },
  searchInput: {
    flex: 1,
    color: theme.text,
    fontFamily: theme.mono,
    fontSize: theme.fs.md,
    paddingVertical: theme.sp.sm + 2,
    letterSpacing: 1,
  },
  searchClear: { color: theme.muted2, fontSize: theme.fs.md, paddingHorizontal: 4 },
  input: {
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.sm + 2,
    color: theme.text,
    fontFamily: theme.mono,
    fontSize: theme.fs.md,
    paddingHorizontal: theme.sp.md,
    paddingVertical: theme.sp.sm + 2,
    letterSpacing: 1,
  },
  body: { padding: theme.sp.lg, paddingBottom: 44 },
  asof: { color: theme.muted, fontSize: theme.fs.xs + 1, fontFamily: theme.mono, marginBottom: theme.sp.md },
  entRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: theme.sp.md,
    borderBottomColor: theme.border,
    borderBottomWidth: 1,
  },
  entName: { color: theme.text, fontSize: theme.fs.md, fontWeight: '700' },
  entMeta: { color: theme.muted2, fontSize: theme.fs.sm, marginTop: 2 },
  chev: { color: theme.muted2, fontSize: 22, width: 24, textAlign: 'center' },
  none: { color: theme.muted, fontSize: theme.fs.sm, paddingVertical: theme.sp.md },
  edge: { marginTop: theme.sp.sm, marginBottom: theme.sp.xs },
  edgeHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  edgeTitle: { color: theme.text, fontFamily: theme.mono, fontSize: theme.fs.md, fontWeight: '700', flex: 1 },
  openBtn: {
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: theme.sp.sm,
    paddingVertical: 3,
    marginRight: theme.sp.sm,
  },
  openTxt: { color: theme.muted2, fontFamily: theme.mono, fontSize: theme.fs.xs, letterSpacing: 0.5 },
  edgeNet: { fontFamily: theme.mono, fontSize: theme.fs.md, fontWeight: '700' },
  edgeMetaRow: { marginTop: 4 },
  edgeMeta: { color: theme.muted2, fontSize: theme.fs.sm },
  edgeDates: { color: theme.muted, fontSize: theme.fs.xs + 1, fontFamily: theme.mono, marginTop: 4 },
  cites: { marginTop: theme.sp.md, borderTopColor: theme.border, borderTopWidth: 1, paddingTop: theme.sp.sm },
  citeRow: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.sm, paddingVertical: 5 },
  citeSide: { fontFamily: theme.mono, fontSize: theme.fs.xs + 1, fontWeight: '700', width: 38 },
  citeDate: { color: theme.muted2, fontFamily: theme.mono, fontSize: theme.fs.xs + 1, width: 96 },
  citeKind: { color: theme.muted, fontSize: theme.fs.xs + 1, flex: 1 },
  citeNum: { color: theme.text, fontFamily: theme.mono, fontSize: theme.fs.xs + 1, width: 66, textAlign: 'right' },
  citeSrc: { color: theme.muted, fontSize: theme.fs.xs, marginTop: theme.sp.sm, fontStyle: 'italic' },
  note: { color: theme.muted, fontSize: theme.fs.sm, marginTop: theme.sp.lg, lineHeight: 18 },
});
