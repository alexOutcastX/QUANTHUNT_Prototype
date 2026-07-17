import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MbScreenRow, Recommendation, api } from '../api';
import StockDetail from '../components/StockDetail';
import { Row } from '../screener';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { navigate } from '../navIntent';
import { addSymbol, loadWatchlist, normSymbol } from '../watchlist';
import { LocalAlert, addLocalAlert, hasLocalAlert, loadLocalAlerts } from '../localalerts';
import { loadNames } from './ScreenerScreen';
import ShortTermScreen from './ShortTermScreen';
import { useResponsive } from '../responsive';
import { Card, EmptyState, ScreenTitle } from '../ui';
import { theme } from '../theme';
import {
  DEPTH_OPTIONS,
  getCache,
  getDepth,
  getIncluded,
  getScanned,
  hasCache,
  hydrateScan,
  isHydrated,
  mergeScan,
  setDepth as storeSetDepth,
  subscribeScan,
} from '../scanStore';

const GOLD = '#f5c518';
const CONCURRENCY = 3;

const money = (v?: number | null) =>
  v == null || !isFinite(v) ? '—' : '₹' + v.toLocaleString('en-IN', { maximumFractionDigits: 2 });
const signPct = (v?: number | null, d = 1) =>
  v == null || !isFinite(v) ? '—' : (v >= 0 ? '+' : '') + v.toFixed(d) + '%';

const actionColor = (a: string) => (a === 'BUY' ? theme.green : a === 'WATCH' ? GOLD : theme.red);

const htmlEsc = (v: unknown): string =>
  v == null ? '' : String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Build a print-ready (black-on-white) buy-recommendations report and hand it to
// the browser's print / "Save as PDF" dialog. Web only; native shares a text
// digest instead. No extra deps — mirrors the app's other PDF exports.
async function exportRecommendationsPdf(recs: Recommendation[], summary: string): Promise<void> {
  const win = (globalThis as { window?: any }).window;
  if (!win?.open) {
    // native: share a compact text summary
    const { Share } = await import('react-native');
    const lines = recs.map(
      (r) =>
        `${r.symbol} · BUY · conf ${r.confidence} · entry ${money(r.entry)} · stop ${money(r.stop)} (${signPct(r.stop_pct)}) · target ${money(r.target)} (${signPct(r.upside_pct)}) · R:R ${r.rr != null ? r.rr.toFixed(1) + ':1' : '—'}${r.eta ? ` · ${r.eta} to target` : ''}`,
    );
    await Share.share({ title: 'TaurEye — Buy Recommendations', message: `TaurEye — Buy Recommendations\n${summary}\n\n${lines.join('\n')}` });
    return;
  }
  const w = win.open('', '_blank');
  if (!w) return; // popup blocked
  const dateStr = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  const card = (r: Recommendation) => {
    const rr = r.rr != null ? `${r.rr.toFixed(1)}:1` : '—';
    const cell = (lbl: string, val: string, color = '#111') =>
      `<div class="cell"><div class="cl">${lbl}</div><div class="cv" style="color:${color}">${htmlEsc(val)}</div></div>`;
    const rationale = (r.rationale || [])
      .map((s) => `<li>${htmlEsc(s)}</li>`)
      .join('');
    return (
      `<div class="rec">` +
      `<div class="rh"><span class="sym">${htmlEsc(r.symbol)}</span>` +
      `<span class="pill">BUY</span>` +
      (r.name ? `<span class="nm">${htmlEsc(r.name)}</span>` : '') +
      `<span class="conf">${r.confidence}<small>conf</small></span></div>` +
      `<div class="scores">${cell('Fundamental', r.fundamental_score == null ? '—' : String(r.fundamental_score))}${cell('Momentum', String(r.momentum_score))}${cell('Pattern', String(r.pattern_score))}</div>` +
      `<div class="setup">${cell('Entry', money(r.entry))}${cell('Stop', `${money(r.stop)} (${signPct(r.stop_pct)})`, '#c0392b')}${cell('Target', `${money(r.target)} (${signPct(r.upside_pct)})`, '#1e8449')}${cell('R:R', rr)}</div>` +
      `<div class="levels">Support ${htmlEsc(money(r.support))} · Resistance ${htmlEsc(money(r.resistance))} · Next target ${htmlEsc(money(r.target2))}${r.pattern ? ` · Pattern ${htmlEsc(r.pattern)}` : ''} · RSI ${htmlEsc(String(r.rsi))}${r.eta ? ` · ⏱ ${htmlEsc(r.eta)} to target` : ''}</div>` +
      (rationale ? `<ul class="why">${rationale}</ul>` : '') +
      `</div>`
    );
  };
  const css =
    `<style>` +
    `*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:24px;max-width:900px}` +
    `h1{font-size:20px;margin:0 0 2px}.meta{color:#666;font-size:12px;margin:0 0 16px}` +
    `.rec{border:1px solid #ccc;border-radius:8px;padding:12px 14px;margin-bottom:12px;page-break-inside:avoid}` +
    `.rh{display:flex;align-items:baseline;gap:8px;margin-bottom:8px}` +
    `.sym{font-weight:700;font-size:16px;font-family:monospace}` +
    `.pill{background:#1e8449;color:#fff;font-size:10px;font-weight:700;padding:1px 6px;border-radius:4px}` +
    `.nm{color:#666;font-size:12px}.conf{margin-left:auto;font-weight:700;font-size:18px;color:#1e8449}.conf small{font-weight:400;color:#999;font-size:9px;margin-left:3px}` +
    `.scores,.setup{display:flex;gap:8px;margin-bottom:8px}` +
    `.cell{flex:1;border:1px solid #eee;border-radius:5px;padding:5px 8px;background:#fafafa}` +
    `.cl{color:#888;font-size:9px;text-transform:uppercase;letter-spacing:.5px}.cv{font-weight:700;font-size:13px;font-family:monospace}` +
    `.levels{color:#444;font-size:11px;font-family:monospace;margin-bottom:6px}` +
    `.why{margin:0;padding-left:18px;color:#333;font-size:11px}.why li{margin:1px 0}` +
    `.disc{color:#999;font-size:10px;margin-top:14px;border-top:1px solid #eee;padding-top:8px}` +
    `</style>`;
  w.document.write(
    `<html><head><title>TaurEye — Buy Recommendations</title>${css}</head><body>` +
      `<h1>TaurEye — Buy Recommendations</h1>` +
      `<p class="meta">${htmlEsc(dateStr)} · ${htmlEsc(summary)}</p>` +
      recs.map(card).join('') +
      `<p class="disc">Confidence blends the Multibagger analyser (fundamentals), a live momentum read and the current chart pattern. Entry/stop/target come from pivot &amp; swing structure with a capped risk band. Indicative and educational only — not investment advice; always confirm and manage risk.</p>` +
      `</body></html>`,
  );
  w.document.close();
  w.focus();
  setTimeout(() => {
    try {
      w.print();
    } catch {
      /* user can print manually */
    }
  }, 300);
}


function Score({ label, value }: { label: string; value: number | null }) {
  const v = value ?? 0;
  const col = v >= 70 ? theme.green : v >= 50 ? GOLD : theme.muted2;
  return (
    <View style={styles.scoreCol}>
      <Text style={styles.scoreLabel}>{label}</Text>
      <Text style={[styles.scoreVal, { color: value == null ? theme.muted : col }]}>
        {value == null ? '—' : value}
      </Text>
      <View style={styles.scoreTrack}>
        <View style={[styles.scoreFill, { width: `${Math.max(3, Math.min(100, v))}%`, backgroundColor: col }]} />
      </View>
    </View>
  );
}

function SetupCell({ label, value, sub, color, compact }: { label: string; value: string; sub?: string; color?: string; compact: boolean }) {
  return (
    <View style={[styles.setupCell, compact && styles.setupCellCompact]}>
      <Text style={styles.setupLbl}>{label}</Text>
      <Text style={[styles.setupVal, color ? { color } : null]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
        {value}
      </Text>
      {sub ? <Text style={[styles.setupSub, color ? { color } : null]}>{sub}</Text> : null}
    </View>
  );
}

function RecCard({
  r,
  watched,
  alerted,
  compact,
  onWatch,
  onAlert,
  onChart,
  onAnalyse,
  onPattern,
  onBacktest,
}: {
  r: Recommendation;
  watched: boolean;
  alerted: boolean;
  compact: boolean;
  onWatch: () => void;
  onAlert: () => void;
  onChart: () => void;
  onAnalyse: () => void;
  onPattern: () => void;
  onBacktest: () => void;
}) {
  const c = actionColor(r.action);
  return (
    <Card style={styles.card}>
      <View style={styles.cardHead}>
        <View style={{ flex: 1 }}>
          <View style={styles.symRow}>
            <Text style={styles.sym}>{r.symbol}</Text>
            <View style={[styles.actionPill, { backgroundColor: c }]}>
              <Text style={styles.actionTxt}>{r.action}</Text>
            </View>
          </View>
          {r.name ? <Text style={styles.name} numberOfLines={1}>{r.name}</Text> : null}
        </View>
        <View style={styles.confBox}>
          <Text style={[styles.confVal, compact && styles.confValCompact, { color: c }]}>{r.confidence}</Text>
          <Text style={styles.confLbl}>confidence</Text>
        </View>
      </View>

      <View style={styles.scores}>
        <Score label="FUNDAMENTAL" value={r.fundamental_score} />
        <Score label="MOMENTUM" value={r.momentum_score} />
        <Score label="PATTERN" value={r.pattern_score} />
      </View>

      {/* trade setup — 4-across on desktop, 2×2 grid on mobile */}
      <View style={[styles.setup, compact && styles.setupCompact]}>
        <SetupCell label="ENTRY" value={money(r.entry)} compact={compact} />
        <SetupCell label="STOP" value={money(r.stop)} sub={signPct(r.stop_pct)} color={theme.red} compact={compact} />
        <SetupCell label="TARGET" value={money(r.target)} sub={signPct(r.upside_pct)} color={theme.green} compact={compact} />
        <SetupCell label="R : R" value={r.rr != null ? `${r.rr.toFixed(1)}:1` : '—'} compact={compact} />
      </View>

      <View style={styles.levels}>
        <Text style={styles.levelTxt}>
          <Text style={styles.levelLbl}>Support </Text>{money(r.support)}
          <Text style={styles.levelLbl}>   ·   Resistance </Text>{money(r.resistance)}
          <Text style={styles.levelLbl}>   ·   Next target </Text>{money(r.target2)}
        </Text>
        <Text style={styles.levelTxt}>
          {r.pattern ? (
            <>
              <Text style={styles.levelLbl}>Pattern </Text>
              <Text style={{ color: r.pattern_bias === 'bearish' ? theme.red : theme.green }}>{r.pattern}</Text>
            </>
          ) : null}
          <Text style={styles.levelLbl}>{r.pattern ? '   ·   ' : ''}RSI </Text>{r.rsi}
        </Text>
        {r.eta ? (
          <Text style={styles.eta}>
            <Text style={styles.levelLbl}>⏱ Est. time to target </Text>
            <Text style={{ color: theme.text }}>{r.eta}</Text>
          </Text>
        ) : null}
      </View>

      {r.rationale?.length ? (
        <View style={styles.why}>
          {r.rationale.slice(0, 5).map((s, i) => (
            <Text key={i} style={styles.whyTxt}>▸ {s}</Text>
          ))}
        </View>
      ) : null}

      <View style={styles.actions}>
        <TouchableOpacity style={styles.aBtn} onPress={onChart} activeOpacity={0.75}>
          <Text style={styles.aTxt}>▤ Chart</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.aBtn} onPress={onAnalyse} activeOpacity={0.75}>
          <Text style={[styles.aTxt, { color: theme.accent }]}>⚡ Analyse</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.aBtn} onPress={onWatch} activeOpacity={0.75}>
          <Text style={[styles.aTxt, watched && { color: theme.green }]}>{watched ? '★ Watching' : '☆ Watchlist'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.aBtn} onPress={onAlert} activeOpacity={0.75}>
          <Text style={[styles.aTxt, alerted && { color: GOLD }]}>{alerted ? '🔔 Alerted' : '🔔 Alert'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.aBtn} onPress={onPattern} activeOpacity={0.75}>
          <Text style={styles.aTxt}>◫ Pattern</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.aBtn} onPress={onBacktest} activeOpacity={0.75}>
          <Text style={styles.aTxt}>⏱ Backtest</Text>
        </TouchableOpacity>
      </View>
    </Card>
  );
}

function timeAgo(ms: number | null): string {
  if (!ms) return '';
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function LongTermRecs() {
  const [recs, setRecs] = useState<Recommendation[]>(() => getCache()?.recs || []);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [depth, setDepthState] = useState(getDepth());
  const [asof, setAsof] = useState<number | null>(getCache()?.asof ?? null);
  const [ready, setReady] = useState(isHydrated());
  const [watch, setWatch] = useState<string[]>([]);
  const [alerts, setAlerts] = useState<LocalAlert[]>([]);
  const [detail, setDetail] = useState<Row | null>(null);
  const [flash, setFlash] = useState('');
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelRef = useRef<{ cancelled: boolean } | null>(null);
  const scanningRef = useRef(false);
  const { isDesktop } = useResponsive();

  const toast = (m: string) => {
    setFlash(m);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(''), 2200);
  };

  useEffect(() => {
    loadWatchlist().then(setWatch);
    loadLocalAlerts().then(setAlerts);
  }, []);

  // The scan: pull Multibagger candidates → deep-analyse each (bounded
  // concurrency) → merge into the persistent cache. A rebuild is incremental —
  // symbols already in `scanned` are skipped unless the user toggled them in.
  const runScan = useCallback(async () => {
    if (scanningRef.current) return;
    if (cancelRef.current) cancelRef.current.cancelled = true;
    const token = { cancelled: false };
    cancelRef.current = token;
    scanningRef.current = true;
    setScanning(true);
    setError('');
    setProgress({ done: 0, total: 0 });
    setStatus('Loading Multibagger candidates…');
    try {
      let snap = await api.mbScreen(true);
      let tries = 0;
      while (!token.cancelled && snap.status === 'running' && !snap.results.length && tries < 15) {
        await new Promise((r) => setTimeout(r, 3000));
        snap = await api.mbScreen();
        tries++;
      }
      if (token.cancelled) return;
      const d = getDepth();
      const candidates = [...(snap.results || [])]
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
        .slice(0, d);
      if (!candidates.length) {
        setError(snap.error || 'No Multibagger candidates to analyse yet — try again shortly.');
        return;
      }
      // Incremental: skip already-scanned scrips unless the user re-included them.
      const scanned = getScanned();
      const included = getIncluded();
      const toAnalyse = candidates.filter(
        (c) => !scanned.has(c.symbol.toUpperCase()) || included.has(c.symbol.toUpperCase()),
      );
      if (!toAnalyse.length) {
        setStatus(`All top ${candidates.length} candidates already scanned — toggle "Include in scan" on a Multibagger row to re-scan.`);
        return;
      }
      const names = await loadNames().catch(() => ({} as Record<string, { name: string; exchange: string }>));
      const analysed: Recommendation[] = [];
      const live = new Map((getCache()?.recs || []).map((r) => [r.symbol.toUpperCase(), r] as const));
      let done = 0;
      const total = toAnalyse.length;
      setProgress({ done: 0, total });
      const run = async (row: MbScreenRow) => {
        try {
          const rec = await api.recommendation(row.symbol, row.score, names[row.symbol.toUpperCase()]?.name);
          if (token.cancelled) return;
          if (rec && !rec.error) {
            analysed.push(rec);
            if (rec.action === 'BUY') live.set(rec.symbol.toUpperCase(), rec);
            else live.delete(rec.symbol.toUpperCase());
            setRecs([...live.values()].sort((a, b) => b.confidence - a.confidence));
          }
        } catch {
          /* skip a failed candidate */
        } finally {
          if (!token.cancelled) {
            done++;
            const buys = live.size;
            setProgress({ done, total });
            setStatus(`Analysing ${done}/${total} · ${buys} buy${buys === 1 ? '' : 's'}`);
          }
        }
      };
      let idx = 0;
      const worker = async () => {
        while (idx < toAnalyse.length && !token.cancelled) {
          const my = idx++;
          await run(toAnalyse[my]);
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, toAnalyse.length) }, worker));
      if (token.cancelled) return;
      const now = Date.now();
      await mergeScan(analysed, d, now);
      const buys = getCache()?.recs || [];
      setRecs(buys);
      setAsof(now);
      setStatus(`${buys.length} buy recommendation${buys.length === 1 ? '' : 's'} · scanned ${getScanned().size} scrips`);
    } catch (e) {
      if (!token.cancelled) setError(e instanceof Error ? e.message : 'Failed to build recommendations');
    } finally {
      if (!token.cancelled) {
        scanningRef.current = false;
        setScanning(false);
      }
    }
  }, []);

  // Hydrate the persistent cache once. Auto-scan ONLY on the very first launch
  // after install (no cache yet); otherwise serve the cache — no re-scan on
  // navigation or reload.
  useEffect(() => {
    let alive = true;
    hydrateScan().then(() => {
      if (!alive) return;
      setReady(true);
      const c = getCache();
      setRecs(c?.recs || []);
      setDepthState(getDepth());
      setAsof(c?.asof ?? null);
      if (!hasCache()) runScan();
    });
    const unsub = subscribeScan(() => {
      const c = getCache();
      setRecs(c?.recs || []);
      setAsof(c?.asof ?? null);
      setDepthState(getDepth());
    });
    return () => {
      alive = false;
      unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onDepth = (n: number) => {
    storeSetDepth(n);
    setDepthState(n);
  };

  const isWatched = (s: string) => watch.includes(normSymbol(s));
  const onWatch = useCallback(async (r: Recommendation) => {
    setWatch(await addSymbol(watch, r.symbol));
    toast(`${r.symbol} added to watchlist`);
  }, [watch]);
  const onAlert = useCallback(async (r: Recommendation) => {
    setAlerts(await addLocalAlert(alerts, r.symbol, r.target, r.price, r.name || undefined));
    toast(`Alert set for ${r.symbol} → ${money(r.target)} (${signPct(r.upside_pct)} upside)`);
  }, [alerts]);
  const onChart = (r: Recommendation) => setDetail({ sym: r.symbol, price: r.price } as Row);
  const onAnalyse = (r: Recommendation) => navigate('analysis', { sub: 'mb', symbol: r.symbol });
  const onPattern = (r: Recommendation) => navigate('analysis', { sub: 'patterns', symbol: r.symbol });
  const onBacktest = async (r: Recommendation) => {
    // Prefill the backtest symbol before switching tabs (Backtest reads it on mount).
    await AsyncStorage.setItem('taureye.backtest.prefill', r.symbol).catch(() => {});
    navigate('analysis', { sub: 'bt' });
  };

  return (
    <View style={styles.container}>
      <ScreenTitle
        title="Recommendations"
        sub="Multibagger candidates screened through fundamentals, momentum & chart patterns into actionable buy setups"
        right={
          <View style={styles.headBtns}>
            <TouchableOpacity
              style={[styles.updBtn, (scanning || !recs.length) && { opacity: 0.5 }]}
              onPress={() => {
                if (!recs.length) return;
                exportRecommendationsPdf(recs, status || `${recs.length} buy recommendation${recs.length === 1 ? '' : 's'}`).catch(() => {});
              }}
              disabled={scanning || !recs.length}
              activeOpacity={0.75}
            >
              <Text style={styles.updTxt}>⤓ PDF</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.updBtn, styles.updBtnPrimary, scanning && { opacity: 0.5 }]} onPress={runScan} disabled={scanning} activeOpacity={0.75}>
              <Text style={[styles.updTxt, { color: theme.onAccent }]}>{scanning ? '… Scanning' : '⟳ Update List'}</Text>
            </TouchableOpacity>
          </View>
        }
      />

      {/* scan-depth selector */}
      <View style={styles.depthRow}>
        <Text style={styles.depthLbl}>Scan depth</Text>
        {DEPTH_OPTIONS.map((n) => (
          <TouchableOpacity
            key={n}
            style={[styles.depthChip, depth === n && styles.depthChipOn]}
            onPress={() => onDepth(n)}
            disabled={scanning}
            activeOpacity={0.75}
          >
            <Text style={[styles.depthTxt, depth === n && styles.depthTxtOn]}>{n}</Text>
          </TouchableOpacity>
        ))}
        {asof && !scanning ? <Text style={styles.asof}>updated {timeAgo(asof)}</Text> : null}
      </View>

      {/* progress bar + live status while scanning */}
      {scanning ? (
        <View style={styles.progWrap}>
          <View style={styles.progTrack}>
            <View
              style={[
                styles.progFill,
                { width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 6}%` },
              ]}
            />
          </View>
          <Text style={styles.progTxt}>{status || 'Preparing…'}</Text>
        </View>
      ) : status ? (
        <Text style={styles.note}>{status}</Text>
      ) : null}

      <ScrollView contentContainerStyle={styles.body}>
        {!scanning && error ? <EmptyState icon="⚠" title="Couldn't build recommendations" hint={error} /> : null}
        {ready && !scanning && !error && !recs.length ? (
          <EmptyState
            icon="◇"
            title="No buy setups yet"
            hint="No cached buy setups. Hit ⟳ Update List to scan the top Multibagger candidates."
          />
        ) : null}

        <View style={isDesktop ? styles.grid : undefined}>
          {recs.map((r) => (
            <View key={r.symbol} style={isDesktop ? styles.gridCell : undefined}>
              <RecCard
                r={r}
                compact={!isDesktop}
                watched={isWatched(r.symbol)}
                alerted={hasLocalAlert(alerts, r.symbol)}
                onWatch={() => onWatch(r)}
                onAlert={() => onAlert(r)}
                onChart={() => onChart(r)}
                onAnalyse={() => onAnalyse(r)}
                onPattern={() => onPattern(r)}
                onBacktest={() => onBacktest(r)}
              />
            </View>
          ))}
        </View>

        {recs.length ? (
          <Text style={styles.method}>
            Confidence blends the Multibagger analyser (fundamentals), a live momentum read (trend vs 20/50/200-DMA,
            RSI, volume) and the current chart pattern. Entry/stop/target come from pivot & swing structure with a
            capped risk band. Indicative and educational only — not investment advice; always confirm and manage risk.
          </Text>
        ) : null}
      </ScrollView>

      {detail ? <StockDetail row={detail} onClose={() => setDetail(null)} /> : null}
      {flash ? (
        <View style={styles.toast} pointerEvents="none">
          <Text style={styles.toastTxt}>{flash}</Text>
        </View>
      ) : null}
    </View>
  );
}

// The Recommendations page hosts two lists: the long-term multibagger buy setups
// and a short-term swing tab (mid & large caps near a pullback reversal). A
// segmented toggle switches between them; each keeps its own persistent cache.
export default function RecommendationsScreen() {
  const [mode, setMode] = useState<'long' | 'short'>('long');
  const TABS: { key: 'long' | 'short'; label: string }[] = [
    { key: 'long', label: 'Long term' },
    { key: 'short', label: 'Short term' },
  ];
  return (
    <View style={styles.container}>
      <View style={styles.modeBarWrap}>
        <View style={styles.modeBar}>
          {TABS.map((t) => (
            <TouchableOpacity
              key={t.key}
              style={[styles.modeBtn, mode === t.key && styles.modeBtnOn]}
              onPress={() => setMode(t.key)}
              activeOpacity={0.75}
            >
              <Text style={[styles.modeTxt, mode === t.key && styles.modeTxtOn]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
      <View style={{ flex: 1 }}>{mode === 'short' ? <ShortTermScreen /> : <LongTermRecs />}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  modeBarWrap: { paddingHorizontal: theme.sp.lg, paddingTop: theme.sp.md, paddingBottom: theme.sp.xs },
  modeBar: { flexDirection: 'row', backgroundColor: theme.surface2, borderRadius: 999, padding: 3, alignSelf: 'flex-start' },
  modeBtn: { borderRadius: 999, paddingVertical: 6, paddingHorizontal: theme.sp.lg },
  modeBtnOn: { backgroundColor: theme.accent },
  modeTxt: { color: theme.muted2, fontSize: theme.fs.sm, fontWeight: '700' },
  modeTxtOn: { color: theme.onAccent },
  note: { color: theme.muted, fontSize: theme.fs.sm, paddingHorizontal: theme.sp.lg, paddingBottom: theme.sp.sm },
  headBtns: { flexDirection: 'row', gap: theme.sp.sm },
  depthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.sp.sm,
    paddingHorizontal: theme.sp.lg,
    paddingBottom: theme.sp.sm,
    flexWrap: 'wrap',
  },
  depthLbl: { color: theme.muted, fontSize: theme.fs.sm, marginRight: 2 },
  depthChip: {
    minWidth: 40,
    alignItems: 'center',
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: theme.sp.md,
    paddingVertical: 5,
  },
  depthChipOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  depthTxt: { color: theme.muted2, fontSize: theme.fs.sm, fontWeight: '700' },
  depthTxtOn: { color: theme.onAccent },
  asof: { color: theme.muted, fontSize: theme.fs.xs + 1, marginLeft: 'auto' },
  progWrap: { paddingHorizontal: theme.sp.lg, paddingBottom: theme.sp.md, gap: 6 },
  progTrack: { height: 6, borderRadius: 999, backgroundColor: theme.surface3, overflow: 'hidden' },
  progFill: { height: 6, borderRadius: 999, backgroundColor: theme.green },
  progTxt: { color: theme.muted2, fontSize: theme.fs.sm },
  updBtnPrimary: { backgroundColor: theme.accent, borderColor: theme.accent },
  updBtn: {
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.sm + 2,
    paddingHorizontal: theme.sp.md,
    paddingVertical: 6,
  },
  updTxt: { color: theme.text, fontSize: theme.fs.sm, fontWeight: '700' },
  body: { paddingHorizontal: theme.sp.lg, paddingBottom: theme.sp.xl, gap: theme.sp.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp.md },
  gridCell: { width: '48.5%', minWidth: 440, flexGrow: 1 },
  card: { gap: theme.sp.md },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.sp.md },
  symRow: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.sm },
  sym: { color: theme.text, fontFamily: theme.mono, fontWeight: '800', fontSize: theme.fs.lg },
  actionPill: { borderRadius: 4, paddingHorizontal: 7, paddingVertical: 2 },
  actionTxt: { color: theme.onAccent, fontSize: 10, fontWeight: '800', letterSpacing: 0.5, fontFamily: theme.mono },
  name: { color: theme.muted2, fontSize: theme.fs.sm, marginTop: 3 },
  confBox: { alignItems: 'flex-end' },
  confVal: { fontFamily: theme.mono, fontWeight: '800', fontSize: 30, lineHeight: 32 },
  confValCompact: { fontSize: 24, lineHeight: 26 },
  confLbl: { color: theme.muted, fontSize: theme.fs.xs },
  scores: { flexDirection: 'row', gap: theme.sp.md },
  scoreCol: { flex: 1, gap: 3 },
  scoreLabel: { color: theme.muted, fontSize: theme.fs.xs, letterSpacing: 0.5 },
  scoreVal: { fontFamily: theme.mono, fontWeight: '700', fontSize: theme.fs.md },
  scoreTrack: { height: 4, borderRadius: 2, backgroundColor: theme.surface3, overflow: 'hidden' },
  scoreFill: { height: '100%', borderRadius: 2 },
  setup: {
    flexDirection: 'row',
    backgroundColor: theme.surface2,
    borderRadius: theme.radius.sm + 2,
    paddingVertical: theme.sp.sm,
  },
  setupCompact: { flexWrap: 'wrap', rowGap: theme.sp.sm, paddingHorizontal: 4 },
  setupCell: { flex: 1, alignItems: 'center', gap: 1 },
  setupCellCompact: { flexBasis: '50%', flexGrow: 0, flexShrink: 0 },
  setupLbl: { color: theme.muted, fontSize: theme.fs.xs, letterSpacing: 0.5 },
  setupVal: { color: theme.text, fontFamily: theme.mono, fontWeight: '700', fontSize: theme.fs.md },
  setupSub: { fontFamily: theme.mono, fontSize: theme.fs.xs },
  levels: { gap: 3 },
  levelTxt: { color: theme.text, fontFamily: theme.mono, fontSize: theme.fs.sm },
  eta: { fontFamily: theme.mono, fontSize: theme.fs.sm, marginTop: 2 },
  levelLbl: { color: theme.muted },
  why: { gap: 3 },
  whyTxt: { color: theme.muted2, fontSize: theme.fs.sm, lineHeight: 18 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp.sm, borderTopColor: theme.border, borderTopWidth: 1, paddingTop: theme.sp.md },
  aBtn: {
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.sm + 2,
    paddingHorizontal: theme.sp.md,
    paddingVertical: theme.sp.sm,
  },
  aTxt: { color: theme.text, fontSize: theme.fs.sm, fontWeight: '700' },
  method: { color: theme.muted, fontSize: theme.fs.xs + 1, lineHeight: 16, marginTop: theme.sp.sm },
  toast: {
    position: 'absolute',
    bottom: theme.sp.xl,
    alignSelf: 'center',
    backgroundColor: theme.surface3,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.sp.lg,
    paddingVertical: theme.sp.sm + 2,
    maxWidth: '92%',
  },
  toastTxt: { color: theme.text, fontSize: theme.fs.sm + 1, fontWeight: '600' },
});
