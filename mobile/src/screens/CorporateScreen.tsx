import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Announcement, CorpAction, Deal, Shareholding, api } from '../api';
import SymbolInput from '../components/SymbolInput';
import { Card, EmptyState, Loading, ScreenTitle, SectionTitle } from '../ui';
import { theme } from '../theme';

const pct = (v: number | null) => (v == null ? '—' : v.toFixed(1) + '%');
const num = (v: number | null) => (v == null ? '—' : v.toLocaleString('en-IN'));

export default function CorporateScreen() {
  const [sym, setSym] = useState('RELIANCE');
  const [input, setInput] = useState('RELIANCE');
  const [ann, setAnn] = useState<Announcement[] | null>(null);
  const [acts, setActs] = useState<CorpAction[] | null>(null);
  const [shp, setShp] = useState<Shareholding | null | undefined>(undefined);
  const [deals, setDeals] = useState<{ bulk: Deal[]; block: Deal[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback((symbol: string) => {
    setAnn(null);
    setActs(null);
    setShp(undefined);
    setErr(null);
    api.corpAnnouncements(symbol).then((d) => setAnn(d.items)).catch(() => setAnn([]));
    api.corpActions(symbol).then((d) => setActs(d.items)).catch(() => setActs([]));
    api.corpShareholding(symbol).then((d) => setShp(d.latest)).catch(() => setShp(null));
  }, []);

  useEffect(() => {
    load(sym);
    api.corpDeals().then((d) => setDeals({ bulk: d.bulk, block: d.block })).catch(() => setDeals({ bulk: [], block: [] }));
  }, [sym, load]);

  const go = (s: string) => {
    const v = s.trim().toUpperCase().replace(/^NSE:/, '');
    if (v) setSym(v);
  };

  return (
    <View style={styles.container}>
      <ScreenTitle title="Corporate" sub="Announcements · actions · shareholding · deals (NSE)" />
      <View style={styles.searchWrap}>
        <SymbolInput
          value={input}
          onChangeText={setInput}
          onSelect={go}
          onSubmit={() => go(input)}
          inputStyle={styles.input}
          placeholder="Symbol"
        />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <SectionTitle>{sym} · Shareholding pattern</SectionTitle>
        {shp === undefined ? (
          <Loading />
        ) : shp ? (
          <Card style={styles.shpCard}>
            <Text style={styles.shpDate}>{shp.date || 'latest'}</Text>
            <View style={styles.shpRow}>
              <Sh label="Promoter" v={pct(shp.promoter)} />
              <Sh label="FII" v={pct(shp.fii)} />
              <Sh label="DII" v={pct(shp.dii)} />
              <Sh label="Public" v={pct(shp.public)} />
              <Sh label="Pledge" v={pct(shp.pledge)} warn={(shp.pledge || 0) > 0} />
            </View>
          </Card>
        ) : (
          <EmptyState title="No shareholding data" hint="NSE may not expose it for this symbol, or the feed is briefly down." />
        )}

        <SectionTitle>Corporate actions</SectionTitle>
        {acts === null ? (
          <Loading />
        ) : acts.length ? (
          acts.map((a, i) => (
            <View key={i} style={styles.row}>
              <Text style={styles.rowMain}>{a.type}</Text>
              <Text style={styles.rowSub}>
                {a.ex_date ? `Ex: ${a.ex_date}` : ''}{a.record_date ? `  ·  Rec: ${a.record_date}` : ''}
              </Text>
            </View>
          ))
        ) : (
          <EmptyState title="No recent corporate actions" />
        )}

        <SectionTitle>Announcements</SectionTitle>
        {ann === null ? (
          <Loading />
        ) : ann.length ? (
          ann.slice(0, 20).map((a, i) => (
            <View key={i} style={styles.row}>
              <Text style={styles.rowMain}>{a.subject}</Text>
              {a.detail ? <Text style={styles.rowSub}>{a.detail}</Text> : null}
              {a.date ? <Text style={styles.rowDate}>{a.date}</Text> : null}
            </View>
          ))
        ) : (
          <EmptyState title="No recent announcements" hint="Best from an Indian IP — the server fetches these live from NSE." />
        )}

        <SectionTitle>Market bulk / block deals</SectionTitle>
        {deals === null ? (
          <Loading />
        ) : deals.bulk.length || deals.block.length ? (
          [...deals.bulk, ...deals.block].slice(0, 25).map((d, i) => (
            <View key={i} style={styles.dealRow}>
              <Text style={styles.dealSym}>{d.symbol}</Text>
              <Text style={styles.dealClient} numberOfLines={1}>{d.client}</Text>
              <Text style={[styles.dealSide, { color: /buy/i.test(d.side) ? theme.green : theme.red }]}>{d.side}</Text>
              <Text style={styles.dealNum}>{num(d.qty)}</Text>
              <Text style={styles.dealNum}>{num(d.price)}</Text>
            </View>
          ))
        ) : (
          <EmptyState title="No deals for the latest session" />
        )}

        <Text style={styles.note}>
          Sourced live from NSE public feeds; best from an Indian IP. Indicative — verify against
          official filings.
        </Text>
      </ScrollView>
      {err ? <Text style={styles.note}>{err}</Text> : null}
    </View>
  );
}

function Sh({ label, v, warn }: { label: string; v: string; warn?: boolean }) {
  return (
    <View style={styles.sh}>
      <Text style={styles.shLabel}>{label}</Text>
      <Text style={[styles.shVal, warn && { color: theme.red }]}>{v}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  searchWrap: { paddingHorizontal: theme.sp.lg, paddingBottom: theme.sp.sm, zIndex: 50 },
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
  body: { padding: theme.sp.lg, paddingBottom: 40 },
  shpCard: {},
  shpDate: { color: theme.muted, fontSize: theme.fs.sm, marginBottom: theme.sp.md },
  shpRow: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp.lg },
  sh: { minWidth: 72 },
  shLabel: { color: theme.muted2, fontSize: theme.fs.xs + 1, textTransform: 'uppercase', letterSpacing: 0.5 },
  shVal: { color: theme.text, fontFamily: theme.mono, fontSize: theme.fs.lg, fontWeight: '700', marginTop: 3 },
  row: {
    paddingVertical: theme.sp.md,
    borderBottomColor: theme.border,
    borderBottomWidth: 1,
  },
  rowMain: { color: theme.text, fontSize: theme.fs.md, lineHeight: 20 },
  rowSub: { color: theme.muted2, fontSize: theme.fs.sm, marginTop: 3 },
  rowDate: { color: theme.muted, fontSize: theme.fs.xs + 1, marginTop: 3, fontFamily: theme.mono },
  dealRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.sp.sm,
    paddingVertical: theme.sp.md - 2,
    borderBottomColor: theme.border,
    borderBottomWidth: 1,
  },
  dealSym: { color: theme.text, fontFamily: theme.mono, fontSize: theme.fs.sm, fontWeight: '700', width: 90 },
  dealClient: { color: theme.muted2, fontSize: theme.fs.sm, flex: 1 },
  dealSide: { fontFamily: theme.mono, fontSize: theme.fs.sm, width: 44 },
  dealNum: { color: theme.text, fontFamily: theme.mono, fontSize: theme.fs.sm, width: 78, textAlign: 'right' },
  note: { color: theme.muted, fontSize: theme.fs.sm, padding: theme.sp.lg, lineHeight: 18 },
});
