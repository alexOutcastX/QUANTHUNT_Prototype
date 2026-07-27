import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { ApiKey, API_BASE, FundWarm, api } from '../api';
import OwnerGate from '../components/OwnerGate';
import { Btn, Card, EmptyState, Loading, ScreenTitle, SectionTitle } from '../ui';
import { theme } from '../theme';

export default function DeveloperScreen() {
  return (
    <View style={styles.container}>
      <ScreenTitle title="Developer portal" sub="Fundamentals cache · public data API" />
      <OwnerGate title="Developer portal">
        <DevInner />
      </OwnerGate>
    </View>
  );
}

// ── Fundamentals scrape + cache ──────────────────────────────────────────────
const SCOPES = ['ALL', 'NIFTY 500', 'NIFTY 200', 'NIFTY 50'];

function dur(sec: number | null | undefined): string {
  if (sec == null || !isFinite(sec) || sec < 0) return '—';
  const s = Math.round(sec);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function FundWarmPanel() {
  const [p, setP] = useState<FundWarm | null>(null);
  const [err, setErr] = useState('');
  const [scope, setScope] = useState('ALL');
  const [busy, setBusy] = useState(false);
  // Held in a ref so the poll interval closes over live state without being
  // torn down and rebuilt on every tick.
  const running = useRef(false);

  const poll = useCallback(() => {
    api
      .fundWarmStatus()
      .then((r) => {
        setP(r);
        running.current = r.running;
        setErr('');
      })
      .catch((e) => setErr(String((e as Error)?.message || e)));
  }, []);

  useEffect(() => {
    poll();
    // 2 s while a sweep is live, 15 s when idle — the snapshot is cheap, but
    // there is no reason to hammer it when nothing is moving.
    let fast = 0;
    const id = setInterval(() => {
      fast += 1;
      if (running.current || fast % 8 === 0) poll();
    }, 2000);
    return () => clearInterval(id);
  }, [poll]);

  const start = async () => {
    setBusy(true);
    try {
      const r = await api.fundWarmStart(scope);
      if (!r.started) setErr(r.reason || 'could not start');
      else setErr('');
      if (r.progress) {
        setP(r.progress);
        running.current = r.progress.running;
      }
      poll();
    } catch (e) {
      setErr(String((e as Error)?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    setBusy(true);
    try {
      const r = await api.fundWarmStop();
      if (r.progress) setP(r.progress);
      poll();
    } catch (e) {
      setErr(String((e as Error)?.message || e));
    } finally {
      setBusy(false);
    }
  };

  if (!p) return <Loading />;

  const pct = Math.max(0, Math.min(100, p.pct));
  const stopped = !p.running && p.cancel && p.done < p.total;
  const state = p.running
    ? `Scraping ${p.universe}`
    : stopped
      ? `Stopped at ${p.done}/${p.total}`
      : p.total
        ? `Last sweep of ${p.universe} finished`
        : 'Idle — no sweep run yet';

  return (
    <Card>
      <View style={styles.warmHead}>
        <Text style={styles.warmState}>{state}</Text>
        <View style={{ flex: 1 }} />
        <Text style={[styles.warmPct, { color: p.running ? theme.green : theme.muted2 }]}>
          {p.total ? `${pct.toFixed(1)}%` : ''}
        </Text>
      </View>

      <View style={styles.barTrack}>
        <View
          style={[
            styles.barFill,
            { width: `${pct}%`, backgroundColor: p.running ? theme.green : theme.muted },
          ]}
        />
      </View>

      <Text style={styles.warmCounts}>
        {p.done}/{p.total} processed · {p.ok} scraped · {p.skipped} already fresh
        {p.failed ? ` · ${p.failed} failed` : ''}
      </Text>

      <View style={styles.statGrid}>
        <Stat k="Rate" v={p.running ? `${p.rate_per_min}/min` : '—'} />
        <Stat k="ETA" v={p.running ? dur(p.eta_sec) : '—'} />
        <Stat k="Elapsed" v={dur(p.elapsed_sec)} />
        <Stat k="Workers" v={String(p.workers)} />
        <Stat k="Cached" v={`${p.cache_fresh}/${p.cache_size} fresh`} />
        <Stat k="Schema" v={p.schema} />
      </View>

      <Text style={styles.scopeLabel}>Scope</Text>
      <View style={styles.chipRow}>
        {SCOPES.map((s) => (
          <TouchableOpacity
            key={s}
            onPress={() => setScope(s)}
            disabled={p.running}
            activeOpacity={0.7}
            style={[
              styles.chip,
              scope === s && styles.chipOn,
              p.running && { opacity: 0.45 },
            ]}
          >
            <Text style={[styles.chipTxt, scope === s && styles.chipTxtOn]}>
              {s === 'ALL' ? 'All listed' : s}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.warmBtns}>
        {p.running ? (
          <Btn label={busy ? '…' : 'Stop sweep'} onPress={stop} disabled={busy} />
        ) : (
          <Btn label={busy ? '…' : 'Scrape now'} onPress={start} disabled={busy} />
        )}
      </View>

      {p.last_error ? <Text style={styles.warmErr}>Last failure — {p.last_error}</Text> : null}
      {err ? <Text style={styles.warmErr}>{err}</Text> : null}

      <Text style={styles.note}>
        Fundamentals are scraped from screener.in (with a yfinance gap-fill) and cached for 7 days,
        so the valuation and growth filters answer instantly. A sweep also runs ~45 s after each
        deploy when FUND_WARM is set. Symbols already fresh under the current schema are skipped;
        changing the field list changes the schema hash and re-scrapes everything.
      </Text>
    </Card>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statK}>{k}</Text>
      <Text style={styles.statV}>{v}</Text>
    </View>
  );
}

function DevInner() {
  const [keys, setKeys] = useState<ApiKey[] | null>(null);
  const [label, setLabel] = useState('');
  const [fresh, setFresh] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.apiKeysList().then((r) => setKeys(r.keys)).catch(() => setKeys([]));
  }, []);
  useEffect(load, [load]);

  const issue = async () => {
    setBusy(true);
    try {
      const r = await api.apiKeysIssue(label.trim());
      setFresh(r.key);
      setLabel('');
      load();
    } finally {
      setBusy(false);
    }
  };

  const base = API_BASE || 'https://<your-host>';

  return (
    <ScrollView contentContainerStyle={styles.body}>
      <SectionTitle>Fundamentals cache</SectionTitle>
      <FundWarmPanel />

      <SectionTitle>Issue a key</SectionTitle>
      <Card>
        <View style={styles.issueRow}>
          <TextInput
            value={label}
            onChangeText={setLabel}
            placeholder="Label (e.g. sheets-connector)"
            placeholderTextColor={theme.muted}
            style={[styles.input, { flex: 1 }]}
          />
          <Btn label={busy ? '…' : 'Issue'} onPress={issue} disabled={busy} style={{ minWidth: 84 }} />
        </View>
        {fresh ? (
          <View style={styles.freshBox}>
            <Text style={styles.freshLabel}>Copy this key now — it is shown only once:</Text>
            <Text selectable style={styles.freshKey}>{fresh}</Text>
          </View>
        ) : null}
      </Card>

      <SectionTitle>Your keys</SectionTitle>
      {keys === null ? (
        <Loading />
      ) : !keys.length ? (
        <EmptyState title="No keys issued" hint="Issue one above to call the public API." />
      ) : (
        keys.map((k) => (
          <Card key={k.id} style={styles.keyCard}>
            <View style={styles.keyHead}>
              <Text style={styles.keyLabel}>{k.label || '(unlabelled)'}</Text>
              <View style={{ flex: 1 }} />
              <Text style={[styles.keyState, { color: k.active ? theme.green : theme.red }]}>
                {k.active ? 'active' : 'revoked'}
              </Text>
            </View>
            <Text style={styles.keyMeta}>
              id {k.id} · {k.calls} call{k.calls === 1 ? '' : 's'}
              {k.last_used ? ` · last ${new Date(k.last_used * 1000).toLocaleDateString()}` : ''}
            </Text>
            {k.active ? (
              <TouchableOpacity onPress={() => api.apiKeysRevoke(k.id).then(load)} activeOpacity={0.7}>
                <Text style={styles.revoke}>revoke</Text>
              </TouchableOpacity>
            ) : null}
          </Card>
        ))
      )}

      <SectionTitle>Usage</SectionTitle>
      <Card>
        <Text style={styles.docLine}>Pass your key in the <Text style={styles.mono}>X-API-Key</Text> header.</Text>
        <Text style={styles.code} selectable>
          {`curl -H "X-API-Key: te_..." \\\n  "${base}/api/v1/quote?symbols=RELIANCE,TCS"`}
        </Text>
        <Text style={styles.code} selectable>
          {`curl -H "X-API-Key: te_..." \\\n  "${base}/api/v1/indices"`}
        </Text>
        <Text style={styles.note}>
          Endpoints: /api/v1/quote (live LTP) · /api/v1/indices (index levels). Rate-limited per key.
          Keys are stored hashed — revoke anytime.
        </Text>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  body: { padding: theme.sp.lg, paddingBottom: 44 },
  input: {
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.sm,
    color: theme.text,
    fontSize: theme.fs.md,
    paddingHorizontal: theme.sp.md,
    paddingVertical: theme.sp.sm + 2,
  },
  issueRow: { flexDirection: 'row', gap: theme.sp.sm, alignItems: 'center' },
  freshBox: {
    marginTop: theme.sp.md,
    padding: theme.sp.md,
    backgroundColor: theme.surface2,
    borderRadius: theme.radius.sm,
    borderColor: theme.green,
    borderWidth: 1,
  },
  freshLabel: { color: theme.muted2, fontSize: theme.fs.sm, marginBottom: theme.sp.sm },
  freshKey: { color: theme.green, fontFamily: theme.mono, fontSize: theme.fs.sm },
  keyCard: { marginBottom: theme.sp.sm },
  keyHead: { flexDirection: 'row', alignItems: 'center' },
  keyLabel: { color: theme.text, fontSize: theme.fs.md, fontWeight: '700' },
  keyState: { fontSize: theme.fs.xs + 1, fontWeight: '700' },
  keyMeta: { color: theme.muted2, fontFamily: theme.mono, fontSize: theme.fs.xs + 1, marginTop: 4 },
  revoke: { color: theme.red, fontSize: theme.fs.sm, fontWeight: '700', marginTop: theme.sp.sm },
  docLine: { color: theme.muted2, fontSize: theme.fs.sm, marginBottom: theme.sp.sm },
  mono: { fontFamily: theme.mono, color: theme.text },
  code: {
    color: theme.text,
    fontFamily: theme.mono,
    fontSize: theme.fs.xs + 1,
    backgroundColor: theme.surface2,
    borderRadius: theme.radius.sm,
    padding: theme.sp.md,
    marginBottom: theme.sp.sm,
  },
  note: { color: theme.muted, fontSize: theme.fs.sm, marginTop: theme.sp.sm, lineHeight: 18 },
  warmHead: { flexDirection: 'row', alignItems: 'center', marginBottom: theme.sp.sm },
  warmState: { color: theme.text, fontSize: theme.fs.md, fontWeight: '700' },
  warmPct: { fontFamily: theme.mono, fontSize: theme.fs.md, fontWeight: '700' },
  barTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.surface2,
    overflow: 'hidden',
  },
  barFill: { height: 8, borderRadius: 4 },
  warmCounts: {
    color: theme.muted2,
    fontFamily: theme.mono,
    fontSize: theme.fs.xs + 1,
    marginTop: theme.sp.sm,
  },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.sp.sm,
    marginTop: theme.sp.md,
  },
  stat: {
    backgroundColor: theme.surface2,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.sp.md,
    paddingVertical: theme.sp.sm,
    minWidth: 104,
  },
  statK: { color: theme.muted, fontSize: theme.fs.xs, textTransform: 'uppercase' },
  statV: { color: theme.text, fontFamily: theme.mono, fontSize: theme.fs.sm, marginTop: 2 },
  scopeLabel: {
    color: theme.muted,
    fontSize: theme.fs.xs,
    textTransform: 'uppercase',
    marginTop: theme.sp.lg,
    marginBottom: theme.sp.sm,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp.sm },
  chip: {
    borderWidth: 1,
    borderColor: theme.border2,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.sp.md,
    paddingVertical: theme.sp.sm - 2,
  },
  chipOn: { borderColor: theme.green, backgroundColor: theme.surface2 },
  chipTxt: { color: theme.muted2, fontSize: theme.fs.sm },
  chipTxtOn: { color: theme.green, fontWeight: '700' },
  warmBtns: { flexDirection: 'row', gap: theme.sp.sm, marginTop: theme.sp.md },
  warmErr: { color: theme.red, fontSize: theme.fs.sm, marginTop: theme.sp.sm },
});
