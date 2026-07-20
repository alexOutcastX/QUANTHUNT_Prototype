import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MbScreenRow, Recommendation, api } from '../api';
import StockDetail from '../components/StockDetail';
import StrategyScores from '../components/StrategyScores';
import SymbolInput from '../components/SymbolInput';
import TradeVerdict from '../components/TradeVerdict';
import { Row } from '../screener';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { navigate, peekNav, subscribeNav, takeSector } from '../navIntent';
import { mergeSectors } from '../sectors';
import { addSymbol, loadWatchlist, normSymbol } from '../watchlist';
import { LocalAlert, addLocalAlert, hasLocalAlert, loadLocalAlerts } from '../localalerts';
import { loadNames } from './ScreenerScreen';
import ShortTermScreen from './ShortTermScreen';
import InstitutionalScreen from './InstitutionalScreen';
import SmcScreen from './SmcScreen';
import { useResponsive } from '../responsive';
import { openPdfPreview } from '../pdf';
import { LONG_STRATEGIES } from '../strategies';
import { Card, Dropdown, EmptyState, FadeSlideIn, InfoButton, RiskBadge, Segmented, Sheet } from '../ui';
import { PaperTrade, addPaperTrade, hasOpenPaper, loadPaperTrades } from '../paperTrades';
import { INSTITUTIONAL_INFO, RECOMMENDATIONS_INFO, SHORT_TERM_INFO, SMC_INFO } from '../tabInfo';
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

// Manual sort for the long-term buy list — orders whatever the active strategy
// returned. All descending (best-first) except time-to-target, which is ascending.
type RecSortKey = 'confidence' | 'upside_pct' | 'rr' | 'momentum_score' | 'fundamental_score' | 'eta_days';
const REC_SORTS: { key: RecSortKey; label: string }[] = [
  { key: 'confidence', label: 'Confidence' },
  { key: 'upside_pct', label: 'Upside' },
  { key: 'rr', label: 'R : R' },
  { key: 'momentum_score', label: 'Momentum' },
  { key: 'fundamental_score', label: 'Fundamentals' },
  { key: 'eta_days', label: 'Time to target' },
];

const money = (v?: number | null) =>
  v == null || !isFinite(v) ? '—' : '₹' + v.toLocaleString('en-IN', { maximumFractionDigits: 2 });
const signPct = (v?: number | null, d = 1) =>
  v == null || !isFinite(v) ? '—' : (v >= 0 ? '+' : '') + v.toFixed(d) + '%';

const actionColor = (a: string) => (a === 'BUY' ? theme.green : a === 'WATCH' ? GOLD : theme.red);

const htmlEsc = (v: unknown): string =>
  v == null ? '' : String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Build a print-ready (black-on-white) buy-recommendations report and hand it to
// the platform print / "Save as PDF" dialog — which downloads a real PDF on
// desktop AND inside the Android WebView (see printHtmlDocument). Only a true
// native RN runtime with no DOM falls back to sharing a text digest.
async function exportRecommendationsPdf(recs: Recommendation[], summary: string): Promise<void> {
  const doc = (globalThis as { document?: any }).document;
  if (!doc?.body) {
    // true native RN (no DOM): share a compact text summary
    const { Share } = await import('react-native');
    const lines = recs.map(
      (r) =>
        `${r.symbol} · BUY · conf ${r.confidence} · entry ${money(r.entry)} · stop ${money(r.stop)} (${signPct(r.stop_pct)}) · target ${money(r.target)} (${signPct(r.upside_pct)}) · R:R ${r.rr != null ? r.rr.toFixed(1) + ':1' : '—'}${r.eta ? ` · ${r.eta} to target` : ''}`,
    );
    await Share.share({ title: 'TaurEye — Buy Recommendations', message: `TaurEye — Buy Recommendations\n${summary}\n\n${lines.join('\n')}` });
    return;
  }
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
  const html =
    `<html><head><title>TaurEye — Buy Recommendations</title>${css}</head><body>` +
    `<h1>TaurEye — Buy Recommendations</h1>` +
    `<p class="meta">${htmlEsc(dateStr)} · ${htmlEsc(summary)}</p>` +
    recs.map(card).join('') +
    `<p class="disc">Confidence blends the Multibagger analyser (fundamentals), a live momentum read and the current chart pattern. Entry/stop/target come from pivot &amp; swing structure with a capped risk band. Indicative and educational only — not investment advice; always confirm and manage risk.</p>` +
    `</body></html>`;
  openPdfPreview(html, { docType: 'Buy recommendations', fileName: 'TaurEye-recommendations' });
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
  papered,
  compact,
  onWatch,
  onAlert,
  onChart,
  onAnalyse,
  onPattern,
  onPaper,
  onBacktest,
  onExport,
  hideHead,
}: {
  r: Recommendation;
  watched: boolean;
  alerted: boolean;
  papered: boolean;
  compact: boolean;
  hideHead?: boolean;
  onWatch: () => void;
  onAlert: () => void;
  onChart: () => void;
  onAnalyse: () => void;
  onPattern: () => void;
  onPaper: () => void;
  onBacktest: () => void;
  onExport?: () => void;
}) {
  const c = actionColor(r.action);
  return (
    <Card style={styles.card}>
      {hideHead ? null : (
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
      )}

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

      <View style={styles.levelGrid}>
        <View style={styles.levelCell}>
          <Text style={styles.levelK}>SUPPORT</Text>
          <Text style={styles.levelV}>{money(r.support)}</Text>
        </View>
        <View style={styles.levelDiv} />
        <View style={styles.levelCell}>
          <Text style={styles.levelK}>RESISTANCE</Text>
          <Text style={styles.levelV}>{money(r.resistance)}</Text>
        </View>
        <View style={styles.levelDiv} />
        <View style={styles.levelCell}>
          <Text style={styles.levelK}>NEXT TGT</Text>
          <Text style={styles.levelV}>{money(r.target2)}</Text>
        </View>
      </View>

      <View style={styles.metaRow}>
        {r.pattern ? (
          <View style={styles.metaPill}>
            <Text style={styles.metaTxt}>
              <Text style={styles.metaK}>Pattern </Text>
              <Text style={{ color: r.pattern_bias === 'bearish' ? theme.red : theme.green }}>{r.pattern}</Text>
            </Text>
          </View>
        ) : null}
        <View style={styles.metaPill}>
          <Text style={styles.metaTxt}><Text style={styles.metaK}>RSI </Text>{r.rsi}</Text>
        </View>
        {r.eta ? (
          <View style={styles.metaPill}>
            <Text style={styles.metaTxt}><Text style={styles.metaK}>⏱ </Text>{r.eta} to target</Text>
          </View>
        ) : null}
        <RiskBadge input={{ rr: r.rr, stop_pct: r.stop_pct, score: r.confidence }} />
      </View>

      {r.rationale?.length ? (
        <View style={styles.why}>
          {r.rationale.slice(0, 5).map((s, i) => (
            <Text key={i} style={styles.whyTxt}>▸ {s}</Text>
          ))}
        </View>
      ) : null}

      {/* Plain-English glossary so the setup terms are readable without prior
          knowledge — matches the depth of the HFT card. */}
      <Text style={styles.secTitle}>WHAT THIS MEANS</Text>
      <View style={styles.glossary}>
        {[
          ['Confidence', 'A 0–100 blend of the fundamental (Multibagger) score, live momentum and the current chart pattern — higher means more of the model lines up.'],
          ['Entry / Stop / Target', 'Where to buy, the invalidation level to exit if wrong, and the first profit objective — drawn from pivot & swing structure.'],
          ['R : R', 'Reward-to-risk — target distance ÷ stop distance. Above ~2:1 means the potential gain outweighs the risked amount.'],
          ['Support / Resistance', 'The nearest floor buyers defended and ceiling sellers capped — context for where the trade can stall or bounce.'],
          ['Pattern', 'The active chart formation (e.g. flag, double-bottom) and whether it leans bullish or bearish.'],
        ].map(([t, d]) => (
          <View key={t} style={styles.gloRow}>
            <Text style={styles.gloTerm}>{t}</Text>
            <Text style={styles.gloDef}>{d}</Text>
          </View>
        ))}
      </View>

      <StrategyScores symbol={r.symbol} />

      <View style={styles.actions}>
        <TouchableOpacity style={styles.aBtn} onPress={onChart} activeOpacity={0.75}>
          <Text style={styles.aTxt}>▤ Chart</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.aBtn} onPress={onAnalyse} activeOpacity={0.75}>
          <Text style={[styles.aTxt, { color: theme.accent }]}>⚡ Analyse</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.aBtn} onPress={() => navigate('analysis', { sub: 'inst', symbol: r.symbol })} activeOpacity={0.75}>
          <Text style={styles.aTxt}>🏛 Dossier</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.aBtn} onPress={onPattern} activeOpacity={0.75}>
          <Text style={styles.aTxt}>📈 Pattern</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.aBtn} onPress={onPaper} activeOpacity={0.75}>
          <Text style={[styles.aTxt, papered && { color: theme.green }]}>{papered ? '✓ Papered' : '✎ Paper trade'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.aBtn} onPress={onWatch} activeOpacity={0.75}>
          <Text style={[styles.aTxt, watched && { color: theme.green }]}>{watched ? '★ Watching' : '☆ Watchlist'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.aBtn} onPress={onAlert} activeOpacity={0.75}>
          <Text style={[styles.aTxt, alerted && { color: GOLD }]}>{alerted ? '🔔 Alerted' : '🔔 Alert'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.aBtn} onPress={onBacktest} activeOpacity={0.75}>
          <Text style={styles.aTxt}>⏱ Backtest</Text>
        </TouchableOpacity>
        {onExport ? (
          <TouchableOpacity style={styles.aBtn} onPress={onExport} activeOpacity={0.75}>
            <Text style={styles.aTxt}>⤓ Export PDF</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </Card>
  );
}

// Compact list row for the Long-term tab — mirrors the Institutional/HFT list
// UX: a tight card you tap to open the full report in a popup.
function LongRow({ r, onOpen }: { r: Recommendation; onOpen: () => void }) {
  const c = actionColor(r.action);
  return (
    <TouchableOpacity style={styles.lrow} onPress={onOpen} activeOpacity={0.7}>
      <View style={styles.lrowLeft}>
        <View style={styles.lrowTop}>
          <Text style={styles.lrowSym}>{r.symbol}</Text>
          <View style={[styles.actionPill, { backgroundColor: c }]}>
            <Text style={styles.actionTxt}>{r.action}</Text>
          </View>
        </View>
        {r.name ? <Text style={styles.name} numberOfLines={1}>{r.name}</Text> : null}
        <Text style={styles.lrowSetup} numberOfLines={1}>
          entry {money(r.entry)} · SL {money(r.stop)} · tgt {money(r.target)} ({signPct(r.upside_pct)})
          {r.rr != null ? ` · ${r.rr.toFixed(1)}:1` : ''}{r.eta ? ` · ⏱ ${r.eta}` : ''}
        </Text>
      </View>
      <View style={styles.lrowRight}>
        <Text style={[styles.lrowConf, { color: c }]}>{r.confidence}</Text>
        <Text style={styles.lrowConfLbl}>confidence</Text>
        <Text style={styles.lrowUpside}>▲ {signPct(r.upside_pct)}</Text>
      </View>
      <Text style={styles.lrowChev}>›</Text>
    </TouchableOpacity>
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
  const [paper, setPaper] = useState<PaperTrade[]>([]);
  const [detail, setDetail] = useState<Row | null>(null);
  const [open, setOpen] = useState<Recommendation | null>(null);
  const [strat, setStrat] = useState('balanced');
  const [sortKey, setSortKey] = useState<RecSortKey>('confidence');
  const [sector, setSector] = useState('');
  const [secMap, setSecMap] = useState<Record<string, string | null>>({});
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
    loadPaperTrades().then(setPaper);
    const s = takeSector('reco');
    if (s) setSector(s);
  }, []);

  // Enrich the buy list with each stock's sector (the recommendation payload
  // doesn't carry one) so the sector filter — and heatmap routing — can work.
  useEffect(() => {
    const missing = recs.map((r) => r.symbol).filter((s) => !(s in secMap));
    if (!missing.length) return;
    let cancelled = false;
    api
      .fundamentalsBulk(missing)
      .then((res) => {
        if (cancelled || !res.data) return;
        setSecMap((prev) => {
          const next = { ...prev };
          missing.forEach((s) => {
            const f = res.data[s] as Record<string, unknown> | undefined;
            next[s] = f && typeof f.sector === 'string' ? (f.sector as string) : null;
          });
          return next;
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [recs, secMap]);

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
  const onPaper = useCallback(async (r: Recommendation) => {
    setPaper(
      await addPaperTrade({
        symbol: r.symbol,
        name: r.name || undefined,
        side: 'long',
        source: 'Long-term',
        entry: r.entry,
        stop: r.stop,
        target: r.target,
      }),
    );
    toast(`Paper trade logged for ${r.symbol} → see Paper tab`);
  }, []);
  const onBacktest = async (r: Recommendation) => {
    // Prefill the backtest symbol before switching tabs (Backtest reads it on mount).
    await AsyncStorage.setItem('taureye.backtest.prefill', r.symbol).catch(() => {});
    navigate('analysis', { sub: 'bt' });
  };
  const onExport = (r: Recommendation) =>
    exportRecommendationsPdf([r], `${r.symbol} · ${r.action} · confidence ${r.confidence}`).catch(() => {});

  // Selected strategy re-ranks / filters the candidate pool (default = balanced);
  // the Sort dropdown then orders whatever the strategy returned.
  const stratDef = LONG_STRATEGIES.find((s) => s.id === strat) || LONG_STRATEGIES[0];
  // Exhaustive sector list (canonical ∪ sectors present in the enriched recs).
  const sectors = React.useMemo(
    () => mergeSectors(recs.map((r) => secMap[r.symbol])),
    [recs, secMap],
  );
  const shown = React.useMemo(() => {
    let base = [...stratDef.apply(recs)];
    if (sector) base = base.filter((r) => secMap[r.symbol] === sector);
    const asc = sortKey === 'eta_days';
    base.sort((a, b) => {
      const va = (a[sortKey] ?? (asc ? Infinity : -Infinity)) as number;
      const vb = (b[sortKey] ?? (asc ? Infinity : -Infinity)) as number;
      return asc ? va - vb : vb - va;
    });
    return base;
  }, [recs, stratDef, sortKey, sector, secMap]);

  return (
    <View style={styles.container}>
      {/* Compact control row: strategy + depth dropdowns + PDF + Update. */}
      <View style={styles.controlBar}>
        <View style={styles.stratWrap}>
          <Dropdown
            label="Strategy"
            value={strat}
            options={LONG_STRATEGIES.map((s) => ({ key: s.id, label: s.name }))}
            onChange={setStrat}
          />
          {/* ⓘ highlights only once a specific strategy is selected. */}
          <InfoButton
            title={stratDef.name}
            content={stratDef.info}
            style={strat !== 'balanced' ? styles.stratInfoOn : styles.stratInfoOff}
          />
        </View>
        <Dropdown
          label="Sort"
          value={sortKey}
          options={REC_SORTS.map((s) => ({ key: s.key, label: s.label }))}
          onChange={(k) => setSortKey(k as RecSortKey)}
        />
        <Dropdown
          label="Depth"
          value={depth}
          options={DEPTH_OPTIONS.map((n) => ({ key: n, label: String(n) }))}
          onChange={onDepth}
        />
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
          <Text style={[styles.updTxt, { color: theme.onAccent }]}>{scanning ? '… Scanning' : '⟳ Update'}</Text>
        </TouchableOpacity>
        {asof && !scanning ? <Text style={styles.asofInline}>updated {timeAgo(asof)}</Text> : null}
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

      {recs.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.secScroll} contentContainerStyle={styles.secRow}>
          <TouchableOpacity
            style={[styles.secChip, sector === '' && styles.secChipOn]}
            onPress={() => setSector('')}
            activeOpacity={0.75}
          >
            <Text style={[styles.secChipTxt, sector === '' && styles.secChipTxtOn]}>All sectors</Text>
          </TouchableOpacity>
          {sectors.map((s) => (
            <TouchableOpacity
              key={s}
              style={[styles.secChip, sector === s && styles.secChipOn]}
              onPress={() => setSector((cur) => (cur === s ? '' : s))}
              activeOpacity={0.75}
            >
              <Text style={[styles.secChipTxt, sector === s && styles.secChipTxtOn]}>{s}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
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

        {recs.length && !shown.length ? (
          <Text style={styles.note}>
            {sector ? `No ${sector} candidates in this list right now — clear the sector or ⟳ Update.` : `No candidates match “${stratDef.name}” right now — try another strategy or ⟳ Update.`}
          </Text>
        ) : null}
        <View style={isDesktop ? styles.grid : undefined}>
          {shown.map((r, i) => (
            <View key={r.symbol} style={isDesktop ? styles.gridCell : undefined}>
              <FadeSlideIn index={i}>
                <Card style={{ padding: 0 }}>
                  <LongRow r={r} onOpen={() => setOpen(r)} />
                </Card>
              </FadeSlideIn>
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

      {open ? (
        <Sheet onClose={() => setOpen(null)} maxHeight="94%">
          {/* Pinned header (sticky): the symbol, name and ✕ close stay visible
              while the card body scrolls. */}
          <ScrollView bounces={false} stickyHeaderIndices={[0]} showsVerticalScrollIndicator={false}>
            <View style={styles.sheetHead}>
              <View style={{ flex: 1 }}>
                <View style={styles.symRow}>
                  <Text style={styles.sym}>{open.symbol}</Text>
                  <View style={[styles.actionPill, { backgroundColor: actionColor(open.action) }]}>
                    <Text style={styles.actionTxt}>{open.action}</Text>
                  </View>
                </View>
                {open.name ? <Text style={styles.name} numberOfLines={2}>{open.name}</Text> : null}
              </View>
              <View style={styles.confBox}>
                <Text style={[styles.confVal, styles.confValCompact, { color: actionColor(open.action) }]}>{open.confidence}</Text>
                <Text style={styles.confLbl}>confidence</Text>
              </View>
              <TouchableOpacity onPress={() => setOpen(null)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} style={styles.sheetX}>
                <Text style={styles.sheetXTxt}>✕</Text>
              </TouchableOpacity>
            </View>
            <View style={{ padding: theme.sp.md }}>
            <RecCard
              r={open}
              hideHead
              compact={!isDesktop}
              watched={isWatched(open.symbol)}
              alerted={hasLocalAlert(alerts, open.symbol)}
              papered={hasOpenPaper(paper, open.symbol)}
              onWatch={() => onWatch(open)}
              onAlert={() => onAlert(open)}
              onChart={() => { const r = open; setOpen(null); onChart(r); }}
              onAnalyse={() => { const r = open; setOpen(null); onAnalyse(r); }}
              onPattern={() => { const r = open; setOpen(null); onPattern(r); }}
              onPaper={() => onPaper(open)}
              onBacktest={() => { const r = open; setOpen(null); onBacktest(r); }}
              onExport={() => onExport(open)}
            />
            </View>
          </ScrollView>
        </Sheet>
      ) : null}
      {detail ? <StockDetail row={detail} onClose={() => setDetail(null)} /> : null}
      {flash ? (
        <View style={styles.toast} pointerEvents="none">
          <Text style={styles.toastTxt}>{flash}</Text>
        </View>
      ) : null}
    </View>
  );
}

// The Recommendations page hosts three lists: the long-term multibagger buy
// setups, a short-term swing tab (pullback reversals), and an Institutional tab
// that screens by algorithmic strategy. A segmented toggle switches between
// them; each keeps its own persistent cache.
type RecMode = 'long' | 'short' | 'inst' | 'smc';
const REC_MODES: RecMode[] = ['long', 'short', 'inst', 'smc'];
export default function RecommendationsScreen() {
  const [mode, setMode] = useState<RecMode>('long');
  const [modeHydrated, setModeHydrated] = useState(false);
  // Remember which sub-list was open so returning to the app doesn't snap back
  // to Long term. Exception: a sector routed in from the heatmap targets the
  // Long-term buy list, so force that mode when such an intent is pending.
  useEffect(() => {
    const p = peekNav();
    if (p?.sub === 'reco' && p?.sector) {
      setMode('long');
      setModeHydrated(true);
      return;
    }
    AsyncStorage.getItem('taureye.reco.mode')
      .then((v) => {
        if (v && (REC_MODES as string[]).includes(v)) setMode(v as RecMode);
      })
      .finally(() => setModeHydrated(true));
  }, []);
  useEffect(
    () =>
      subscribeNav(() => {
        const p = peekNav();
        if (p?.sub === 'reco' && p?.sector) setMode('long');
      }),
    [],
  );
  useEffect(() => {
    if (modeHydrated) AsyncStorage.setItem('taureye.reco.mode', mode).catch(() => {});
  }, [mode, modeHydrated]);
  const TABS: { key: RecMode; label: string }[] = [
    { key: 'long', label: 'Long term' },
    { key: 'short', label: 'Short term' },
    { key: 'inst', label: 'Institutional' },
    { key: 'smc', label: 'HFT/ICT/SMC' },
  ];
  // The ⓘ beside the tabs is mode-aware: it opens the detail for whichever
  // sub-list is active, so each sub-screen can drop its own title block.
  const modeInfo = {
    long: { title: 'Recommendations', info: RECOMMENDATIONS_INFO },
    short: { title: 'Short-term swing', info: SHORT_TERM_INFO },
    inst: { title: 'Institutional', info: INSTITUTIONAL_INFO },
    smc: { title: 'HFT / ICT / SMC', info: SMC_INFO },
  }[mode];
  const [q, setQ] = useState('');
  const [verdictSym, setVerdictSym] = useState<string | null>(null);
  const analyse = (s?: string) => {
    const v = (s ?? q).trim().toUpperCase().replace(/^(NSE|BSE):/, '');
    if (v) setVerdictSym(v);
  };
  return (
    <View style={styles.container}>
      <View style={styles.searchRow}>
        <SymbolInput
          value={q}
          onChangeText={setQ}
          onSelect={(s) => analyse(s)}
          onSubmit={() => analyse()}
          placeholder="Analyse any scrip — take or skip?"
          inputStyle={styles.searchInput}
          containerStyle={{ flex: 1 }}
        />
        <TouchableOpacity
          style={[styles.analyseBtn, !q.trim() && { opacity: 0.5 }]}
          onPress={() => analyse()}
          disabled={!q.trim()}
          activeOpacity={0.75}
        >
          <Text style={styles.analyseTxt}>⚡ Analyse</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.modeBarWrap}>
        <Segmented items={TABS} value={mode} onChange={setMode} info={modeInfo.info} infoTitle={modeInfo.title} />
      </View>
      <View style={{ flex: 1 }}>
        {mode === 'short' ? <ShortTermScreen /> : mode === 'inst' ? <InstitutionalScreen /> : mode === 'smc' ? <SmcScreen /> : <LongTermRecs />}
      </View>
      {verdictSym ? <TradeVerdict symbol={verdictSym} onClose={() => setVerdictSym(null)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.sm, paddingHorizontal: theme.sp.lg, paddingTop: theme.sp.md, zIndex: 50 },
  searchInput: {
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
  analyseBtn: { backgroundColor: theme.accent, borderRadius: theme.radius.sm + 2, paddingHorizontal: theme.sp.md, paddingVertical: 10 },
  analyseTxt: { color: theme.onAccent, fontSize: theme.fs.sm + 1, fontWeight: '800' },
  modeBarWrap: { paddingTop: theme.sp.md },
  modeBar: { flexDirection: 'row', flexWrap: 'wrap', gap: 3, backgroundColor: theme.surface2, borderRadius: theme.radius.sm + 6, padding: 3, alignSelf: 'flex-start' },
  modeBtn: { borderRadius: 999, paddingVertical: 6, paddingHorizontal: theme.sp.md },
  modeBtnOn: { backgroundColor: theme.accent },
  modeTxt: { color: theme.muted2, fontSize: theme.fs.sm, fontWeight: '700' },
  modeTxtOn: { color: theme.onAccent },
  note: { color: theme.muted, fontSize: theme.fs.sm, paddingHorizontal: theme.sp.lg, paddingBottom: theme.sp.sm },
  // sector filter chips (exhaustive list)
  secScroll: { flexGrow: 0, flexShrink: 0 },
  secRow: { gap: 6, paddingHorizontal: theme.sp.md, paddingBottom: theme.sp.sm, alignItems: 'center' },
  secChip: {
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 4,
    backgroundColor: theme.surface2,
  },
  secChipOn: { backgroundColor: theme.brandSoft, borderColor: theme.brand },
  secChipTxt: { color: theme.muted2, fontFamily: theme.mono, fontSize: theme.fs.sm },
  secChipTxtOn: { color: theme.brand, fontWeight: '800' },
  headBtns: { flexDirection: 'row', gap: theme.sp.sm },
  // Compact action row (no title) — buttons sit right where the heading used to.
  actionRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: theme.sp.sm, paddingHorizontal: theme.sp.lg, paddingTop: theme.sp.sm, paddingBottom: theme.sp.sm },
  controlBar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.sp.sm, paddingHorizontal: theme.sp.lg, paddingTop: theme.sp.sm, paddingBottom: theme.sp.sm },
  stratWrap: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  stratInfoOn: { borderColor: theme.accent, borderWidth: 1.5, backgroundColor: theme.brandSoft },
  stratInfoOff: { opacity: 0.4 },
  asofInline: { color: theme.muted, fontSize: theme.fs.xs + 1, fontFamily: theme.mono, marginLeft: 'auto' },
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
  // Compact Long-term list row (tap → detail popup).
  lrow: { flexDirection: 'row', alignItems: 'center', padding: theme.sp.md, gap: theme.sp.md },
  lrowLeft: { flex: 1, gap: 2 },
  lrowTop: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.sm, flexWrap: 'wrap' },
  lrowSym: { color: theme.text, fontFamily: theme.mono, fontWeight: '800', fontSize: theme.fs.md + 1 },
  lrowSetup: { color: theme.muted, fontSize: theme.fs.xs + 1, fontFamily: theme.mono },
  lrowRight: { alignItems: 'flex-end', minWidth: 84 },
  lrowConf: { fontFamily: theme.mono, fontWeight: '800', fontSize: 22, lineHeight: 24 },
  lrowConfLbl: { color: theme.muted, fontSize: theme.fs.xs, marginTop: -1 },
  lrowUpside: { color: theme.green, fontFamily: theme.mono, fontWeight: '700', fontSize: theme.fs.sm, marginTop: 3 },
  lrowChev: { color: theme.muted2, fontSize: 22 },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.sp.md },
  // Sticky sheet header — solid background + divider so it sits over the
  // scrolling card body; keeps the symbol/name and ✕ close always visible.
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.sp.md,
    backgroundColor: theme.surface,
    paddingHorizontal: theme.sp.md,
    paddingTop: theme.sp.md,
    paddingBottom: theme.sp.sm,
    borderBottomColor: theme.border,
    borderBottomWidth: 1,
  },
  sheetX: { paddingHorizontal: 4, paddingTop: 2 },
  sheetXTxt: { color: theme.muted, fontSize: 18 },
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
  levelGrid: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.surface2,
    borderRadius: theme.radius.sm + 2,
    paddingVertical: theme.sp.sm + 2,
  },
  levelCell: { flex: 1, alignItems: 'center', gap: 3 },
  levelK: { color: theme.muted, fontSize: theme.fs.xs, letterSpacing: 0.6 },
  levelV: { color: theme.text, fontFamily: theme.mono, fontWeight: '700', fontSize: theme.fs.sm + 1 },
  levelDiv: { width: 1, alignSelf: 'stretch', marginVertical: 6, backgroundColor: theme.border },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp.sm },
  metaPill: {
    backgroundColor: theme.surface2,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: theme.radius.pill,
    paddingHorizontal: 11,
    paddingVertical: 4,
  },
  metaTxt: { color: theme.text, fontFamily: theme.mono, fontSize: theme.fs.xs + 1 },
  metaK: { color: theme.muted },
  levelLbl: { color: theme.muted },
  why: { gap: 3 },
  whyTxt: { color: theme.muted2, fontSize: theme.fs.sm, lineHeight: 18 },
  secTitle: { color: theme.muted, fontSize: theme.fs.xs + 1, fontWeight: '800', letterSpacing: 1, marginBottom: theme.sp.xs },
  glossary: { gap: theme.sp.sm },
  gloRow: { gap: 1 },
  gloTerm: { color: theme.brand, fontSize: theme.fs.sm + 1, fontWeight: '800' },
  gloDef: { color: theme.muted2, fontSize: theme.fs.sm, lineHeight: 18 },
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
