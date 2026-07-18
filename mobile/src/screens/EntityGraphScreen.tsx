import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import {
  API_BASE,
  EntityGraph,
  EntityNode,
  FlowEdge,
  PoliticalDonor,
  PoliticalGraph,
  PromoterGraph,
  PromoterHolder,
  Shareholding,
  api,
} from '../api';
import SymbolInput from '../components/SymbolInput';
import { Card, EmptyState, Loading, ScreenTitle, SectionTitle, Segmented } from '../ui';
import { SHAREHOLDERS_INFO } from '../tabInfo';
import { theme } from '../theme';

type Mode = 'institutions' | 'stock' | 'promoters' | 'political';

const TABS: { key: Mode; label: string }[] = [
  { key: 'institutions', label: 'Institutional / HNI' },
  { key: 'stock', label: 'By stock' },
  { key: 'promoters', label: 'Promoters' },
  { key: 'political', label: 'Political' },
];

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
const GOLD = '#e0a92e';

export default function EntityGraphScreen() {
  const [mode, setMode] = useState<Mode>('institutions');
  const [graph, setGraph] = useState<EntityGraph | null | undefined>(undefined);
  const [openEntity, setOpenEntity] = useState<string | null>(null);
  const [positions, setPositions] = useState<Record<string, FlowEdge[] | 'loading'>>({});

  const [symInput, setSymInput] = useState('TATASTEEL');
  const [sym, setSym] = useState('');
  const [flows, setFlows] = useState<FlowEdge[] | null | undefined>(undefined);
  const [shp, setShp] = useState<Shareholding | null | undefined>(undefined);

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

  // Promoter graph (seed-grounded) — lazy-loaded on first visit to the tab.
  const [promoterG, setPromoterG] = useState<PromoterGraph | null | undefined>(undefined);
  const [promQuery, setPromQuery] = useState('');
  const [openHolder, setOpenHolder] = useState<string | null>(null);
  const promHolders = promoterG && promoterG.nodes ? promoterG.nodes.holders : [];
  const filteredHolders = useMemo(() => {
    const q = promQuery.trim().toUpperCase();
    if (!q) return promHolders;
    // Match the group name OR any company it holds (symbol / company name), so
    // "AMBANI" finds the Reliance group and "RELIANCE" finds who holds it.
    return promHolders.filter(
      (h) =>
        (h.name || '').toUpperCase().includes(q) ||
        h.edges.some(
          (e) => e.symbol.includes(q) || (e.company_name || '').toUpperCase().includes(q),
        ),
    );
  }, [promHolders, promQuery]);

  // Political funding graph (electoral bonds, donor side).
  const [politicalG, setPoliticalG] = useState<PoliticalGraph | null | undefined>(undefined);
  const [polQuery, setPolQuery] = useState('');
  const polDonors = politicalG && politicalG.nodes ? politicalG.nodes.donors : [];
  const filteredDonors = useMemo(() => {
    const q = polQuery.trim().toUpperCase();
    if (!q) return polDonors;
    return polDonors.filter(
      (d) => (d.name || '').toUpperCase().includes(q) || (d.symbol || '').includes(q),
    );
  }, [polDonors, polQuery]);

  useEffect(() => {
    if (graph === undefined) api.entityGraph().then(setGraph).catch(() => setGraph(null));
  }, [graph]);
  useEffect(() => {
    if (mode === 'promoters' && promoterG === undefined)
      api.promoterGraph().then(setPromoterG).catch(() => setPromoterG(null));
    if (mode === 'political' && politicalG === undefined)
      api.politicalGraph().then(setPoliticalG).catch(() => setPoliticalG(null));
  }, [mode, promoterG, politicalG]);

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
    const v = s.trim().toUpperCase().replace(/^(NSE|BSE):/, '');
    if (!v) return;
    setSym(v);
    setFlows(undefined);
    setShp(undefined);
    api.symbolFlows(v).then((r) => setFlows(r.flows)).catch(() => setFlows(null));
    api.corpShareholding(v).then((r) => setShp(r.latest)).catch(() => setShp(null));
  };

  return (
    <View style={styles.container}>
      <ScreenTitle
        title="Shareholders"
        sub="Institutions, promoters & political funding — every link cited"
        info={SHAREHOLDERS_INFO}
      />

      <Segmented items={TABS} value={mode} onChange={setMode} />

      {mode === 'stock' ? (
        <View style={styles.searchWrap}>
          <SymbolInput
            value={symInput}
            onChangeText={setSymInput}
            onSelect={loadSymbol}
            onSubmit={() => loadSymbol(symInput)}
            inputStyle={styles.input}
            placeholder="Symbol — who holds it"
          />
        </View>
      ) : mode === 'institutions' && graph && graph.nodes && graph.nodes.entities.length ? (
        <SearchBox value={entQuery} onChange={setEntQuery} placeholder="Search shareholder / investor…" />
      ) : mode === 'promoters' && promHolders.length ? (
        <SearchBox value={promQuery} onChange={setPromQuery} placeholder="Promoter or company — e.g. AMBANI, TATA, RELIANCE" />
      ) : mode === 'political' && polDonors.length ? (
        <SearchBox value={polQuery} onChange={setPolQuery} placeholder="Search donor / company…" />
      ) : null}

      <ScrollView contentContainerStyle={styles.body}>
        {mode === 'institutions' ? (
          graph === undefined ? (
            <Loading label="Loading shareholders…" />
          ) : !graph || !graph.nodes.entities.length ? (
            <EmptyState
              title="No shareholder data"
              hint="Built from NSE bulk/block deals — best from an Indian IP, and quiet sessions have few deals."
            />
          ) : (
            <>
              <Text style={styles.asof}>
                {entQuery
                  ? `${filteredEntities.length} of ${graph.nodes.entities.length} shareholders`
                  : `${graph.nodes.entities.length} shareholders`}{' '}
                · {graph.edges.length} links · {graph.asof.first || '—'} → {graph.asof.last || '—'}
              </Text>
              {entQuery && !filteredEntities.length ? (
                <Text style={styles.none}>No shareholder matches “{entQuery}”.</Text>
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
        ) : mode === 'promoters' ? (
          promoterG === undefined ? (
            <Loading label="Loading promoter groups…" />
          ) : !promoterG || !promHolders.length ? (
            <EmptyState title="No promoter data" hint="The promoter dataset failed to load — pull to retry." />
          ) : (
            <>
              <Text style={styles.asof}>
                {promQuery
                  ? `${filteredHolders.length} of ${promHolders.length} promoter groups`
                  : `${promHolders.length} promoter groups`}{' '}
                · {promoterG.edges.length} company links · {promoterG.asof.first || '—'}
              </Text>
              {promQuery && !filteredHolders.length ? (
                <Text style={styles.none}>No promoter or company matches “{promQuery}”.</Text>
              ) : null}
              {filteredHolders.map((h) => (
                <PromoterRow
                  key={h.id}
                  h={h}
                  open={openHolder === h.id}
                  onToggle={() => setOpenHolder(openHolder === h.id ? null : h.id)}
                />
              ))}
              <Text style={styles.note}>{promoterG.disclaimer}</Text>
            </>
          )
        ) : mode === 'political' ? (
          politicalG === undefined ? (
            <Loading label="Loading political funding…" />
          ) : !politicalG || !polDonors.length ? (
            <EmptyState title="No political data" hint="The electoral-bond dataset failed to load — pull to retry." />
          ) : (
            <>
              <Text style={styles.asof}>
                {polQuery
                  ? `${filteredDonors.length} of ${politicalG.count} donors`
                  : `${politicalG.count} donors · ₹${politicalG.total_cr.toLocaleString('en-IN')} Cr disclosed`}{' '}
                · {politicalG.asof.first || '—'}
              </Text>
              {polQuery && !filteredDonors.length ? (
                <Text style={styles.none}>No donor or company matches “{polQuery}”.</Text>
              ) : null}
              {filteredDonors.map((d) => (
                <DonorRow key={d.id} d={d} />
              ))}
              <Text style={styles.note}>{politicalG.disclaimer}</Text>
            </>
          )
        ) : /* stock pivot */ !sym ? (
          <EmptyState icon="⌕" title="Enter a symbol" hint="See the ownership split (promoter / FII / DII / public), plus who traded it and the cited deals." />
        ) : (
          <>
            {/* 1 · Ownership split — the authoritative "who holds it" answer. */}
            <SectionTitle>{sym} · shareholding pattern</SectionTitle>
            {shp === undefined ? (
              <Loading label={`Loading ${sym} ownership…`} />
            ) : !shp || (shp.promoter == null && shp.fii == null && shp.dii == null && shp.public == null) ? (
              <Text style={styles.none}>
                Ownership split unavailable for {sym}. The quarterly pattern is sourced from NSE
                filings — BSE-only scrips and freshly listed names may not be covered yet.
              </Text>
            ) : (
              <SharePattern s={shp} />
            )}

            {/* 2 · Recent large trades — who's been accumulating / distributing. */}
            <SectionTitle>Recent large trades</SectionTitle>
            {flows === undefined ? (
              <Loading label={`Finding shareholders active in ${sym}…`} />
            ) : !flows || !flows.length ? (
              <Text style={styles.none}>
                No bulk/block deals for {sym} in recent sessions — grounded in NSE records.
              </Text>
            ) : (
              flows.map((e, i) => <EdgeCard key={i} e={e} show="entity" />)
            )}
            <Text style={styles.note}>
              Ownership split from NSE quarterly shareholding filings; large-trade flow from NSE
              bulk/block deal records — each link cited and dated.
            </Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

// The quarterly ownership split — promoter / FII / DII / public as labelled bars.
function SharePattern({ s }: { s: Shareholding }) {
  const rows = (
    [
      { k: 'Promoters', v: s.promoter, c: theme.accent },
      { k: 'FII', v: s.fii, c: theme.green },
      { k: 'DII', v: s.dii, c: GOLD },
      { k: 'Public', v: s.public, c: theme.muted2 },
    ] as { k: string; v: number | null; c: string }[]
  ).filter((r) => r.v != null) as { k: string; v: number; c: string }[];
  return (
    <Card style={styles.pat}>
      {s.date ? <Text style={styles.patDate}>As of {s.date}</Text> : null}
      {rows.map((r) => (
        <View key={r.k} style={styles.patRow}>
          <Text style={styles.patLbl}>{r.k}</Text>
          <View style={styles.patTrack}>
            <View style={[styles.patFill, { width: `${Math.max(1, Math.min(100, r.v))}%`, backgroundColor: r.c }]} />
          </View>
          <Text style={styles.patVal}>{r.v.toFixed(2)}%</Text>
        </View>
      ))}
      {s.pledge != null && s.pledge > 0 ? (
        <Text style={styles.patPledge}>⚠ Promoter pledge {s.pledge.toFixed(2)}%</Text>
      ) : null}
    </Card>
  );
}

// Sticky search field shared by the Institutional / Promoter / Political tabs.
function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <View style={styles.searchWrap}>
      <View style={styles.searchBox}>
        <Text style={styles.searchIcon}>⌕</Text>
        <TextInput
          value={value}
          onChangeText={onChange}
          style={styles.searchInput}
          placeholder={placeholder}
          placeholderTextColor={theme.muted}
          autoCapitalize="characters"
          autoCorrect={false}
        />
        {value ? (
          <TouchableOpacity onPress={() => onChange('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.searchClear}>✕</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

// A promoter group — tap to reveal every listed company it controls, with the
// (approximate) disclosed stake and the filing citation.
function PromoterRow({ h, open, onToggle }: { h: PromoterHolder; open: boolean; onToggle: () => void }) {
  return (
    <View>
      <TouchableOpacity style={styles.entRow} onPress={onToggle} activeOpacity={0.7}>
        <View style={{ flex: 1 }}>
          <Text style={styles.entName}>{h.name}</Text>
          <Text style={styles.entMeta}>
            {h.breadth} listed compan{h.breadth === 1 ? 'y' : 'ies'}
          </Text>
        </View>
        <Text style={styles.chev}>{open ? '−' : '+'}</Text>
      </TouchableOpacity>
      {open ? (
        <View style={styles.promBody}>
          {h.edges.map((e) => (
            <TouchableOpacity
              key={e.symbol}
              style={styles.promEdge}
              activeOpacity={0.7}
              onPress={() =>
                Linking.openURL(`${API_BASE || ''}/research.html?symbol=${encodeURIComponent(e.symbol)}`).catch(
                  () => {},
                )
              }
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.promSym}>{e.symbol}</Text>
                <Text style={styles.promCo}>{e.company_name}</Text>
              </View>
              <Text style={styles.promStake}>
                {e.stake_pct != null ? `~${e.stake_pct}%` : '—'}
              </Text>
            </TouchableOpacity>
          ))}
          <Text style={styles.citeSrc}>Source: {h.edges[0]?.citation || 'shareholding pattern'}</Text>
        </View>
      ) : null}
    </View>
  );
}

// A disclosed electoral-bond donor — amount purchased + the disclosure window.
function DonorRow({ d }: { d: PoliticalDonor }) {
  return (
    <Card style={styles.donor}>
      <View style={styles.donorHead}>
        <View style={{ flex: 1 }}>
          <Text style={styles.donorName}>{d.name}</Text>
          <Text style={styles.donorMeta}>
            {d.symbol ? `${d.symbol} · ` : ''}
            {d.first_date}
            {d.last_date && d.last_date !== d.first_date ? ` → ${d.last_date}` : ''}
          </Text>
        </View>
        <Text style={styles.donorAmt}>{d.amount_cr != null ? `₹${d.amount_cr.toLocaleString('en-IN')} Cr` : '—'}</Text>
      </View>
      <Text style={styles.citeSrc}>Bonds purchased · {d.citation}</Text>
    </Card>
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
  none: { color: theme.muted, fontSize: theme.fs.sm, paddingVertical: theme.sp.md, lineHeight: 18 },
  pat: { marginTop: theme.sp.sm, marginBottom: theme.sp.sm, gap: theme.sp.sm },
  patDate: { color: theme.muted, fontFamily: theme.mono, fontSize: theme.fs.xs + 1, marginBottom: 2 },
  patRow: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.sm },
  patLbl: { color: theme.muted2, fontSize: theme.fs.sm, width: 78 },
  patTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: theme.surface2, overflow: 'hidden' },
  patFill: { height: 8, borderRadius: 4 },
  patVal: { color: theme.text, fontFamily: theme.mono, fontSize: theme.fs.sm, fontWeight: '700', width: 62, textAlign: 'right' },
  patPledge: { color: theme.red, fontSize: theme.fs.sm, fontWeight: '700', marginTop: 2 },
  promBody: { paddingLeft: theme.sp.sm, paddingBottom: theme.sp.sm },
  promEdge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: theme.sp.sm + 1,
    borderBottomColor: theme.border,
    borderBottomWidth: 1,
  },
  promSym: { color: theme.text, fontFamily: theme.mono, fontSize: theme.fs.sm + 1, fontWeight: '700', letterSpacing: 0.5 },
  promCo: { color: theme.muted2, fontSize: theme.fs.sm, marginTop: 1 },
  promStake: { color: theme.brand, fontFamily: theme.mono, fontSize: theme.fs.sm + 1, fontWeight: '700' },
  donor: { marginTop: theme.sp.sm, marginBottom: theme.sp.xs },
  donorHead: { flexDirection: 'row', alignItems: 'center' },
  donorName: { color: theme.text, fontSize: theme.fs.md, fontWeight: '700' },
  donorMeta: { color: theme.muted2, fontFamily: theme.mono, fontSize: theme.fs.xs + 1, marginTop: 3 },
  donorAmt: { color: GOLD, fontFamily: theme.mono, fontSize: theme.fs.md, fontWeight: '800' },
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
