import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  Announcement,
  CorpAction,
  FlowEdge,
  Fundamentals,
  MultibaggerReport,
  Recommendation,
  ReportResp,
  RiskReport,
  ScanRow,
  ScreenerFinancials,
  Shareholding,
  StrategyScore,
  TimeframesResp,
  api,
} from '../api';
import { Assessment, assess } from '../analysis';
import SymbolInput from '../components/SymbolInput';
import StrategyScores from '../components/StrategyScores';
import { openPdfPreview } from '../pdf';
import { takeSymbol } from '../navIntent';
import { theme } from '../theme';
import { Card, EmptyState, Loading, ScreenTitle, SectionTitle, StatTile } from '../ui';

// ── formatting ───────────────────────────────────────────────────────────────
const num = (v: number | null | undefined, d = 1, suf = '') =>
  v == null || !isFinite(v) ? '—' : v.toFixed(d) + suf;
const pctS = (v: number | null | undefined, d = 1) =>
  v == null || !isFinite(v) ? '—' : (v >= 0 ? '+' : '') + v.toFixed(d) + '%';
const plain = (v: number | null | undefined, d = 1, suf = '') =>
  v == null || !isFinite(v) ? '—' : v.toFixed(d) + suf;
const money = (v: number | null | undefined) =>
  v == null || !isFinite(v) ? '—' : '₹' + v.toLocaleString('en-IN', { maximumFractionDigits: 2 });
const fmtCr = (v: number | null | undefined) =>
  v == null || !isFinite(v)
    ? '—'
    : v >= 1e5 ? '₹' + (v / 1e5).toFixed(2) + 'L cr'
    : v >= 1e3 ? '₹' + (v / 1e3).toFixed(2) + 'k cr'
    : '₹' + v.toFixed(0) + ' cr';
const dirColor = (v: number | null | undefined) =>
  v == null ? theme.muted : v >= 0 ? theme.green : theme.red;
const tierColor = (s: number) =>
  s >= 75 ? theme.green : s >= 60 ? theme.accent : s >= 45 ? '#f5c518' : theme.red;

// Everything the dossier aggregates, each source filled in as its call resolves.
type Dossier = {
  sym: string;
  mb?: MultibaggerReport | null;
  rec?: Recommendation | null;
  fund?: Fundamentals | null;
  tech?: ScanRow | null;
  ann?: Announcement[];
  actions?: CorpAction[];
  hold?: Shareholding | null;
  flows?: FlowEdge[];
  risk?: RiskReport | null;
  rep?: ReportResp | null;
  mc?: Assessment | null;
  strat?: StrategyScore[];
  tf?: TimeframesResp | null;
};

// Announcement subjects that carry management commentary / primary documents.
const DOC_RE = /concall|conference call|transcript|earnings call|investor|presentation|annual report|analyst|meet|outcome|results|financial result|integrated report/i;

// Overall investment call synthesised from the multibagger score + the
// recommendation engine's action.
function verdict(mb?: MultibaggerReport | null, rec?: Recommendation | null): { label: string; color: string; note: string } {
  const s = mb?.score;
  const act = rec?.action;
  if (s == null && !act) return { label: 'Insufficient data', color: theme.muted, note: 'Not enough data to form a view.' };
  const sc = s ?? 50;
  if (sc >= 72 && (act === 'BUY' || act === 'WATCH'))
    return { label: 'High conviction', color: theme.green, note: 'Strong fundamentals and a constructive setup line up — a core long-term candidate.' };
  if (sc >= 60)
    return { label: 'Accumulate', color: theme.green, note: 'Solid quality; build gradually and let the setup confirm.' };
  if (sc >= 45 || act === 'WATCH')
    return { label: 'Watch', color: '#f5c518', note: 'Mixed signals — track for a better entry or improving fundamentals.' };
  return { label: 'Avoid', color: theme.red, note: 'Quality and/or trend are weak — the risk outweighs the setup for now.' };
}

// ── small render helpers ─────────────────────────────────────────────────────
function KV({ k, v, color }: { k: string; v: string; color?: string }) {
  return (
    <View style={styles.kv}>
      <Text style={styles.kvK}>{k}</Text>
      <Text style={[styles.kvV, color ? { color } : null]}>{v}</Text>
    </View>
  );
}
function Bullets({ items, color, glyph }: { items: string[]; color: string; glyph: string }) {
  return (
    <>
      {items.map((s, i) => (
        <Text key={i} style={[styles.bullet, { color }]}>
          {glyph} <Text style={styles.bulletTxt}>{s}</Text>
        </Text>
      ))}
    </>
  );
}

export default function AnalysisScreen() {
  const [sym, setSym] = useState('RELIANCE');
  const [target, setTarget] = useState('10');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [d, setD] = useState<Dossier | null>(null);
  // On-demand screener.in scrape (real promoter/FII/DII shareholding + borrowings).
  const [scr, setScr] = useState<ScreenerFinancials | null | 'loading'>(null);

  // Merge a partial into the dossier only while it still refers to `s` (guards
  // against a slow response from a previous symbol overwriting a newer one).
  const patch = (s: string, p: Partial<Dossier>) =>
    setD((prev) => (prev && prev.sym === s ? { ...prev, ...p } : prev));

  const run = async (symOverride?: string) => {
    const s = (symOverride ?? sym).trim().toUpperCase().replace(/^(NSE|BSE):/, '');
    const tgt = Math.max(0.1, parseFloat(target) || 10);
    if (!s) { setMsg('Enter a symbol to analyse.'); return; }
    setBusy(true);
    setMsg(null);
    setD({ sym: s });
    setScr(null);
    setSym(s);

    // Fan out every source in parallel; each fills its own section as it lands
    // so the dossier builds progressively and one failure never blanks the rest.
    const jobs: Promise<void>[] = [];
    const add = (p: Promise<void>) => jobs.push(p.catch(() => {}));

    add(api.multibagger(s).then((r) => patch(s, { mb: r && !r.error ? r : null })));
    add(api.recommendation(s).then((r) => patch(s, { rec: r && !r.error ? r : null })));
    add(api.fundamentals(s).then((r) => patch(s, { fund: r && !r.error ? r : null })));
    add(api.scan([s]).then((r) => patch(s, { tech: r.data?.[s] || null })));
    add(api.corpAnnouncements(s).then((r) => patch(s, { ann: r.items || [] })));
    add(api.corpActions(s).then((r) => patch(s, { actions: r.items || [] })));
    add(api.corpShareholding(s).then((r) => patch(s, { hold: r.latest || null })));
    add(api.symbolFlows(s).then((r) => patch(s, { flows: r.flows || [] })));
    add(api.riskPortfolio([{ symbol: s, qty: 1 }]).then((r) => patch(s, { risk: r && r.ok ? r : null })));
    add(api.report(s).then((r) => patch(s, { rep: r && !r.error ? r : null })));
    // Strategy scorecard + multi-timeframe technicals — surfaced on screen and
    // folded into the exported dossier PDF.
    add(api.strategyScores(s).then((r) => patch(s, { strat: r && !r.error ? r.strategies : [] })));
    add(api.timeframes(s).then((r) => patch(s, { tf: r && !r.error ? r : null })));
    // Upside-probability model (Monte-Carlo + historical frequency over 5y).
    add(
      api.history(s, '5y', '1d').then((h) => {
        const candles = Array.isArray(h.candles) ? h.candles : [];
        if (candles.length < 60) return;
        const C = candles.map((c) => Number(c.c)).filter((v) => isFinite(v) && v > 0);
        const last = candles[candles.length - 1];
        const price = Number(last.c);
        const ema200 = last.ema200 != null && isFinite(Number(last.ema200)) ? Number(last.ema200) : null;
        patch(s, { mc: assess(s, C, price, ema200, tgt, null) });
      }),
    );

    await Promise.all(jobs);
    setBusy(false);
    setD((prev) => {
      if (prev && prev.sym === s && prev.mb == null && prev.fund == null && prev.rec == null && prev.tech == null) {
        setMsg(`Couldn't reach market data for ${s} — it may be rate-limited. Try again shortly.`);
        return null;
      }
      return prev;
    });
  };

  useEffect(() => {
    const s = takeSymbol('inst');
    if (s) { setSym(s); run(s); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchScreener = () => {
    if (!d || scr === 'loading') return;
    setScr('loading');
    api.screenerFinancials(d.sym).then((r) => setScr(r)).catch(() => setScr({ symbol: d.sym, ok: false }));
  };

  const exportPdf = () => {
    if (!d) return;
    try {
      const ok = openPdfPreview(dossierHtml(d), {
        docType: 'Institutional dossier',
        fileName: `TaurEye-${d.sym}-dossier`,
      });
      setMsg(ok ? 'Opening the report preview…' : "Couldn't open the report preview on this device.");
    } catch {
      setMsg('Export failed — please try again.');
    }
    setTimeout(() => setMsg(null), 2600);
  };

  const mb = d?.mb;
  const rec = d?.rec;
  const fund = d?.fund;
  const tech = d?.tech;
  const rep = d?.rep;
  const bal = rep?.balance_sheet;
  const cflow = rep?.cash_flow;
  const m = (mb?.metrics || {}) as Record<string, number | null>;
  const name = mb?.name || fund?.longName || fund?.name || d?.sym || '';
  const sector = mb?.sector || fund?.sector || null;
  const industry = mb?.industry || fund?.industry || null;
  const price = mb?.price ?? rec?.price ?? tech?.price ?? null;
  const mcap = m.mcap_cr ?? fund?.market_cap_cr ?? null;
  const about = mb?.about || fund?.description || '';
  const v = verdict(mb, rec);
  const docs = (d?.ann || []).filter((a) => DOC_RE.test(a.subject || ''));

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <ScreenTitle
        title="Institutional dossier"
        sub="A full-stack company report — fundamentals, valuation, in-depth technicals, ownership, relationships, risk, filings & an investment score with multibagging potential."
      />
      <View style={styles.body}>
        <Card style={styles.setupCard}>
          <View style={styles.inputs}>
            <View style={styles.field}>
              <Text style={styles.label}>Symbol</Text>
              <SymbolInput
                inputStyle={styles.input}
                value={sym}
                onChangeText={setSym}
                onSelect={(x) => run(x)}
                onSubmit={() => run()}
                placeholder="RELIANCE"
              />
            </View>
            <View style={styles.fieldSm}>
              <Text style={styles.label}>Target %</Text>
              <TextInput
                style={styles.input}
                value={target}
                onChangeText={setTarget}
                keyboardType="numeric"
                placeholder="10"
                placeholderTextColor={theme.muted}
              />
            </View>
          </View>
          <View style={styles.setupBtns}>
            <TouchableOpacity style={styles.btn} onPress={() => run()} disabled={busy} activeOpacity={0.75}>
              {busy ? <ActivityIndicator color={theme.onAccent} /> : <Text style={styles.btnText}>Build dossier</Text>}
            </TouchableOpacity>
            {d && !busy ? (
              <TouchableOpacity style={styles.btnGhost} onPress={exportPdf} activeOpacity={0.75}>
                <Text style={styles.btnGhostTxt}>⤓ Export PDF</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </Card>

        {busy && !mb && !fund ? <Loading label={`Compiling ${d?.sym} — fundamentals, ownership, filings, technicals…`} /> : null}
        {msg ? <Text style={styles.msg}>{msg}</Text> : null}

        {d && (mb || fund || rec || tech) ? (
          <View style={styles.report}>
            {/* Header */}
            <View style={styles.hdr}>
              <View style={{ flex: 1 }}>
                <Text style={styles.coName}>{name}</Text>
                <Text style={styles.coMeta}>
                  {d.sym}{sector ? ` · ${sector}` : ''}{industry ? ` · ${industry}` : ''}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.coPrice}>{price != null ? money(price) : '—'}</Text>
                <Text style={styles.coMeta}>{fmtCr(mcap)}</Text>
              </View>
            </View>

            {/* Investment verdict */}
            <Card style={styles.verdictCard}>
              <View style={styles.verdictTop}>
                {mb ? (
                  <View style={[styles.scoreBox, { borderColor: tierColor(mb.score) }]}>
                    <Text style={[styles.scoreBig, { color: tierColor(mb.score) }]}>{mb.score}</Text>
                    <Text style={styles.scoreOf}>/100</Text>
                  </View>
                ) : null}
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={[styles.verdictLabel, { color: v.color }]}>{v.label}</Text>
                  {mb ? (
                    <Text style={styles.verdictSub}>
                      {mb.tier} · multibagging potential (5x+ in 5–10y):{' '}
                      <Text style={{ color: tierColor(mb.score), fontWeight: '800' }}>{mb.probability_pct}%</Text>
                    </Text>
                  ) : null}
                  {rec ? (
                    <Text style={styles.verdictSub}>
                      Trade engine: <Text style={{ color: rec.action === 'BUY' ? theme.green : rec.action === 'AVOID' ? theme.red : '#f5c518', fontWeight: '800' }}>{rec.action}</Text>
                      {' '}· confidence {rec.confidence}
                    </Text>
                  ) : null}
                </View>
              </View>
              <Text style={styles.verdictNote}>{v.note}</Text>
            </Card>

            {/* Strategy scorecard — same scoring shown in every popup */}
            <Card><StrategyScores symbol={d.sym} /></Card>

            {/* Business overview */}
            {about ? (
              <>
                <SectionTitle>Business overview</SectionTitle>
                <Card><Text style={styles.para}>{about}</Text></Card>
              </>
            ) : null}

            {/* Fundamentals */}
            {mb || fund ? (
              <>
                <SectionTitle>Fundamentals</SectionTitle>
                <View style={styles.tiles}>
                  <StatTile label="Market cap" value={fmtCr(mcap)} />
                  <StatTile label="Revenue growth" value={num(m.revenue_growth_pct, 1, '%')} color={dirColor(m.revenue_growth_pct)} />
                  <StatTile label="Earnings growth" value={num(m.earnings_growth_pct, 1, '%')} color={dirColor(m.earnings_growth_pct)} />
                  <StatTile label="ROE" value={num(m.roe_pct ?? (fund?.roe != null ? fund.roe : null), 1, '%')} />
                  <StatTile label="Op margin" value={num(m.op_margin_pct, 1, '%')} />
                  <StatTile label="Debt / equity" value={plain(m.debt_equity ?? fund?.debt_equity ?? null, 2)} color={(m.debt_equity ?? fund?.debt_equity ?? 0) > 1.5 ? theme.red : undefined} />
                  <StatTile label="Free cash flow" value={fmtCr(m.fcf_cr)} color={dirColor(m.fcf_cr)} />
                  <StatTile label="3y price CAGR" value={num(m.price_cagr_3y_pct, 1, '%')} color={dirColor(m.price_cagr_3y_pct)} />
                </View>
              </>
            ) : null}

            {/* Valuation */}
            {mb || fund ? (
              <>
                <SectionTitle>Valuation</SectionTitle>
                <Card>
                  <KV k="P/E (trailing)" v={plain(m.pe ?? fund?.pe ?? null, 1)} />
                  <KV k="Forward P/E" v={plain(fund?.forward_pe ?? null, 1)} />
                  <KV k="PEG" v={plain(m.peg ?? null, 2)} />
                  <KV k="Price / book" v={plain(fund?.pb ?? null, 2)} />
                  <KV k="EPS" v={plain(fund?.eps ?? null, 2)} />
                  <KV k="Dividend yield" v={num(fund?.dividend_yield != null ? fund.dividend_yield : null, 2, '%')} />
                  <KV k="ROCE" v={num(fund?.roce != null ? fund.roce : null, 1, '%')} />
                  <KV k="vs 200-DMA" v={pctS(m.vs_200dma_pct)} color={dirColor(m.vs_200dma_pct)} />
                  <KV k="From 52-week high" v={pctS(m.pct_from_high_pct ?? tech?.pct_from_high ?? null)} color={dirColor(m.pct_from_high_pct ?? tech?.pct_from_high ?? null)} />
                </Card>
              </>
            ) : null}

            {/* Profit & loss — annual */}
            {rep?.fin_years && rep.fin_years.length ? (
              <>
                <SectionTitle>Profit &amp; loss · annual</SectionTitle>
                <Card>
                  <View style={styles.finHead}>
                    <Text style={[styles.finHc, styles.finPeriod]}>YEAR</Text>
                    <Text style={[styles.finHc, styles.finNum]}>REVENUE</Text>
                    <Text style={[styles.finHc, styles.finNum]}>PAT</Text>
                    <Text style={[styles.finHc, styles.finNum]}>PAT Δ</Text>
                  </View>
                  {rep.fin_years.map((y, i) => (
                    <View key={i} style={styles.finRow}>
                      <Text style={[styles.finV, styles.finPeriod]}>{y.year}</Text>
                      <Text style={[styles.finV, styles.finNum]}>{fmtCr(y.revenue)}</Text>
                      <Text style={[styles.finV, styles.finNum, { color: dirColor(y.net_income) }]}>{fmtCr(y.net_income)}</Text>
                      <Text style={[styles.finV, styles.finNum, { color: dirColor(y.ni_growth) }]}>{pctS(y.ni_growth)}</Text>
                    </View>
                  ))}
                </Card>
              </>
            ) : null}

            {/* Profit & loss — quarterly */}
            {rep?.fin_quarters && rep.fin_quarters.length ? (
              <>
                <SectionTitle>Profit &amp; loss · quarterly</SectionTitle>
                <Card>
                  <View style={styles.finHead}>
                    <Text style={[styles.finHc, styles.finPeriod]}>QUARTER</Text>
                    <Text style={[styles.finHc, styles.finNum]}>REVENUE</Text>
                    <Text style={[styles.finHc, styles.finNum]}>PAT</Text>
                    <Text style={[styles.finHc, styles.finNum]}>OP INC</Text>
                  </View>
                  {rep.fin_quarters.map((q, i) => (
                    <View key={i} style={styles.finRow}>
                      <Text style={[styles.finV, styles.finPeriod]}>{q.period}</Text>
                      <Text style={[styles.finV, styles.finNum]}>{fmtCr(q.revenue)}</Text>
                      <Text style={[styles.finV, styles.finNum, { color: dirColor(q.net_income) }]}>{fmtCr(q.net_income)}</Text>
                      <Text style={[styles.finV, styles.finNum]}>{fmtCr(q.op_income)}</Text>
                    </View>
                  ))}
                </Card>
              </>
            ) : null}

            {/* Balance sheet */}
            {bal && (bal.total_debt != null || bal.equity != null || bal.total_assets != null) ? (
              <>
                <SectionTitle>Balance sheet</SectionTitle>
                <Card>
                  <KV k="Total debt / borrowings" v={fmtCr(bal.total_debt ?? m.total_debt_cr)} color={(bal.total_debt ?? 0) > 0 ? theme.text : undefined} />
                  {bal.long_term_debt != null ? <KV k="Long-term borrowings" v={fmtCr(bal.long_term_debt)} /> : null}
                  {bal.current_debt != null ? <KV k="Short-term borrowings" v={fmtCr(bal.current_debt)} /> : null}
                  <KV k="Cash & equivalents" v={fmtCr(bal.cash)} color={theme.green} />
                  <KV k="Shareholders' equity / net worth" v={fmtCr(bal.equity)} />
                  <KV k="Total assets" v={fmtCr(bal.total_assets)} />
                  {bal.inventory != null ? <KV k="Inventory" v={fmtCr(bal.inventory)} /> : null}
                  {bal.receivables != null ? <KV k="Receivables" v={fmtCr(bal.receivables)} /> : null}
                </Card>
              </>
            ) : null}

            {/* Cash flow */}
            {cflow && (cflow.fcf != null || cflow.ocf != null) ? (
              <>
                <SectionTitle>Cash flow</SectionTitle>
                <Card>
                  <KV k="Operating cash flow" v={fmtCr(cflow.ocf)} color={dirColor(cflow.ocf)} />
                  <KV k="Free cash flow" v={fmtCr(cflow.fcf ?? m.fcf_cr)} color={dirColor(cflow.fcf ?? m.fcf_cr)} />
                  {cflow.capex != null ? <KV k="Capex" v={fmtCr(cflow.capex)} /> : null}
                </Card>
              </>
            ) : null}

            {/* In-depth technicals */}
            {tech ? (
              <>
                <SectionTitle>In-depth technicals</SectionTitle>
                <Card>
                  <KV k="RSI (14)" v={plain(tech.rsi, 1)} color={tech.rsi == null ? undefined : tech.rsi >= 70 ? theme.red : tech.rsi <= 30 ? theme.green : theme.text} />
                  <KV k="MACD" v={plain(tech.macd, 2)} color={dirColor(tech.macd)} />
                  <KV k="Williams %R" v={plain(tech.willr, 1)} />
                  <KV k="Bollinger %b" v={plain(tech.bollb, 2)} />
                  <KV k="vs 9 / 20 EMA" v={`${pctS(tech.d9)} / ${pctS(tech.d20)}`} />
                  <KV k="vs 50 / 200 DMA" v={`${pctS(tech.d50)} / ${pctS(tech.d200)}`} />
                  <KV k="Beta" v={plain(tech.beta, 2)} />
                  <KV k="52-week range" v={`${money(tech.low52)} — ${money(tech.high52)}`} />
                  <KV k="Pivots S1 / R1" v={`${money(tech.s1)} / ${money(tech.r1)}`} />
                  {tech.golden_cross ? <KV k="Signal" v="Golden cross (50/200) ▲" color={theme.green} /> : null}
                  {tech.death_cross ? <KV k="Signal" v="Death cross (50/200) ▼" color={theme.red} /> : null}
                  {tech.sqzOn ? <KV k="Volatility" v={`Squeeze on${tech.sqzFire ? ' — firing' : ''}`} color="#f5c518" /> : null}
                </Card>
              </>
            ) : null}

            {/* Trade setup */}
            {rec ? (
              <>
                <SectionTitle>Trade setup</SectionTitle>
                <Card>
                  <KV k="Entry" v={money(rec.entry)} />
                  <KV k="Stop" v={`${money(rec.stop)} (${pctS(rec.stop_pct)})`} color={theme.red} />
                  <KV k="Target" v={`${money(rec.target)} (${pctS(rec.upside_pct)})`} color={theme.green} />
                  <KV k="Next target" v={money(rec.target2)} />
                  <KV k="Reward : risk" v={rec.rr != null ? `${rec.rr.toFixed(1)} : 1` : '—'} />
                  <KV k="Support / resistance" v={`${money(rec.support)} / ${money(rec.resistance)}`} />
                  {rec.pattern ? <KV k="Chart pattern" v={rec.pattern} color={rec.pattern_bias === 'bearish' ? theme.red : theme.green} /> : null}
                  {rec.eta ? <KV k="Est. time to target" v={rec.eta} /> : null}
                </Card>
              </>
            ) : null}

            {/* Upside probability (MC) */}
            {d.mc ? (
              <>
                <SectionTitle>Upside probability · +{d.mc.target}% by horizon</SectionTitle>
                <View style={styles.tHead}>
                  <Text style={[styles.thc, styles.cH]}>Horizon</Text>
                  <Text style={[styles.thc, styles.cN]}>MC touch</Text>
                  <Text style={[styles.thc, styles.cN]}>Hist touch</Text>
                  <Text style={[styles.thc, styles.cN]}>MC med ret</Text>
                </View>
                {d.mc.rows.map((r) => (
                  <View style={styles.tRow} key={r.label}>
                    <Text style={[styles.tdc, styles.cH]}>{r.label}</Text>
                    <Text style={[styles.tdc, styles.cN, { fontWeight: '700' }]}>{(r.mc.pReach * 100).toFixed(0)}%</Text>
                    <Text style={[styles.tdc, styles.cN]}>{r.hist.n ? (r.hist.pReach * 100).toFixed(0) + '%' : '—'}</Text>
                    <Text style={[styles.tdc, styles.cN, { color: dirColor(r.mc.medRet) }]}>{pctS(r.mc.medRet * 100)}</Text>
                  </View>
                ))}
                <Text style={styles.small}>Annualised drift {pctS(d.mc.driftAnn * 100)} · volatility {(d.mc.sigmaAnn * 100).toFixed(0)}% (GBM Monte-Carlo + 5y historical frequency).</Text>
              </>
            ) : null}

            {/* Ownership */}
            {d.hold ? (
              <>
                <SectionTitle>Ownership · shareholding {d.hold.date ? `(${d.hold.date})` : ''}</SectionTitle>
                <Card>
                  <KV k="Promoters" v={num(d.hold.promoter, 2, '%')} />
                  <KV k="FII" v={num(d.hold.fii, 2, '%')} />
                  <KV k="DII" v={num(d.hold.dii, 2, '%')} />
                  <KV k="Public" v={num(d.hold.public, 2, '%')} />
                  <KV k="Promoter pledge" v={num(d.hold.pledge, 2, '%')} color={(d.hold.pledge ?? 0) > 0 ? theme.red : undefined} />
                </Card>
              </>
            ) : (mb || rep?.shareholding) ? (
              <>
                <SectionTitle>Ownership</SectionTitle>
                <Card>
                  <KV k="Promoter / insider" v={num(m.insider_pct ?? rep?.shareholding?.insiders_pct ?? null, 1, '%')} />
                  <KV k="Institutions" v={num(m.institution_pct ?? rep?.shareholding?.institutions_pct ?? null, 1, '%')} />
                </Card>
              </>
            ) : null}

            {/* Real shareholding + borrowings — on-demand scrape from screener.in */}
            <SectionTitle>Shareholding & borrowings · screener.in</SectionTitle>
            <Card>
              {scr === null ? (
                <>
                  <Text style={styles.small}>Pull the real promoter / FII / DII split and borrowings from screener.in on demand.</Text>
                  <TouchableOpacity style={styles.scrBtn} onPress={fetchScreener} activeOpacity={0.8}>
                    <Text style={styles.scrBtnTxt}>↻ Fetch from screener.in</Text>
                  </TouchableOpacity>
                </>
              ) : scr === 'loading' ? (
                <ActivityIndicator color={theme.accent} />
              ) : scr && scr.ok && scr.shareholding && Object.keys(scr.shareholding).length ? (
                <>
                  <KV k="Promoters" v={num(scr.shareholding.promoter ?? null, 2, '%')} />
                  <KV k="FII" v={num(scr.shareholding.fii ?? null, 2, '%')} />
                  <KV k="DII" v={num(scr.shareholding.dii ?? null, 2, '%')} />
                  <KV k="Public" v={num(scr.shareholding.public ?? null, 2, '%')} />
                  {scr.shareholding.government != null ? <KV k="Government" v={num(scr.shareholding.government, 2, '%')} /> : null}
                  {scr.balance?.borrowings != null ? <KV k="Borrowings (latest FY)" v={fmtCr(scr.balance.borrowings)} color={(scr.balance.borrowings ?? 0) > 0 ? theme.text : theme.green} /> : null}
                  {scr.balance?.reserves != null ? <KV k="Reserves" v={fmtCr(scr.balance.reserves)} /> : null}
                  <Text style={styles.small}>Source: screener.in</Text>
                </>
              ) : (
                <>
                  <Text style={styles.small}>Couldn't read screener.in for {d.sym} (blocked or no data). Try again.</Text>
                  <TouchableOpacity style={styles.scrBtn} onPress={fetchScreener} activeOpacity={0.8}>
                    <Text style={styles.scrBtnTxt}>↻ Retry</Text>
                  </TouchableOpacity>
                </>
              )}
            </Card>

            {/* Institutional relationships */}
            {d.flows && d.flows.length ? (
              <>
                <SectionTitle>Institutional relationships · NSE bulk/block deals</SectionTitle>
                <Card>
                  {d.flows.slice(0, 8).map((f, i) => (
                    <View key={i} style={styles.flowRow}>
                      <Text style={styles.flowName} numberOfLines={1}>{f.entity_name || f.entity}</Text>
                      <Text style={[styles.flowNet, { color: dirColor(f.net_qty) }]}>
                        {f.net_qty >= 0 ? 'net buy' : 'net sell'} {Math.abs(f.net_qty).toLocaleString('en-IN')}
                      </Text>
                    </View>
                  ))}
                </Card>
              </>
            ) : null}

            {/* Risk */}
            {d.risk || mb || tech ? (
              <>
                <SectionTitle>Risk factors</SectionTitle>
                <Card>
                  {d.risk ? <KV k="Volatility (annual)" v={num(d.risk.volatility_annual != null ? d.risk.volatility_annual * 100 : null, 1, '%')} /> : null}
                  {d.risk ? <KV k="1-day VaR 95%" v={num(d.risk.var_pct != null ? d.risk.var_pct * 100 : null, 2, '%')} color={theme.red} /> : null}
                  {d.risk?.drawdown ? <KV k="Max drawdown" v={num(d.risk.drawdown.mdd != null ? d.risk.drawdown.mdd * 100 : null, 1, '%')} color={theme.red} /> : null}
                  {d.risk?.sharpe != null ? <KV k="Sharpe" v={plain(d.risk.sharpe, 2)} /> : null}
                  <KV k="Beta vs NIFTY" v={plain(d.risk?.beta ?? tech?.beta ?? null, 2)} color={(d.risk?.beta ?? tech?.beta ?? 0) > 1 ? theme.red : undefined} />
                  <KV k="Debt / equity" v={plain(m.debt_equity ?? fund?.debt_equity ?? null, 2)} color={(m.debt_equity ?? fund?.debt_equity ?? 0) > 1.5 ? theme.red : undefined} />
                  <KV k="Total debt / borrowings" v={fmtCr(m.total_debt_cr)} color={(m.total_debt_cr ?? 0) > 0 ? theme.text : undefined} />
                </Card>
                {mb?.red_flags?.length ? (
                  <Card style={{ marginTop: theme.sp.sm }}><Bullets items={mb.red_flags} color={theme.red} glyph="▼" /></Card>
                ) : null}
              </>
            ) : null}

            {/* Corporate filings & management commentary */}
            {docs.length ? (
              <>
                <SectionTitle>Management commentary & primary filings</SectionTitle>
                <Card>
                  <Text style={styles.small}>Concall transcripts, investor presentations, results & annual reports — straight from the exchange. Tap to open the source document.</Text>
                  {docs.slice(0, 8).map((a, i) => (
                    <TouchableOpacity
                      key={i}
                      style={styles.docRow}
                      onPress={() => a.attachment && Linking.openURL(a.attachment).catch(() => {})}
                      activeOpacity={a.attachment ? 0.6 : 1}
                    >
                      <Text style={styles.docSubj} numberOfLines={2}>
                        {a.attachment ? '📄 ' : '• '}{a.subject}
                      </Text>
                      <Text style={styles.docDate}>{a.date}{a.attachment ? '  ›' : ''}</Text>
                    </TouchableOpacity>
                  ))}
                </Card>
              </>
            ) : null}

            {/* Other corporate announcements */}
            {d.ann && d.ann.length && d.ann.length > docs.length ? (
              <>
                <SectionTitle>Recent announcements</SectionTitle>
                <Card>
                  {d.ann.filter((a) => !DOC_RE.test(a.subject || '')).slice(0, 6).map((a, i) => (
                    <TouchableOpacity
                      key={i}
                      style={styles.docRow}
                      onPress={() => a.attachment && Linking.openURL(a.attachment).catch(() => {})}
                      activeOpacity={a.attachment ? 0.6 : 1}
                    >
                      <Text style={styles.docSubj} numberOfLines={2}>{a.attachment ? '📄 ' : '• '}{a.subject}</Text>
                      <Text style={styles.docDate}>{a.date}</Text>
                    </TouchableOpacity>
                  ))}
                </Card>
              </>
            ) : null}

            {/* Corporate actions */}
            {d.actions && d.actions.length ? (
              <>
                <SectionTitle>Corporate actions</SectionTitle>
                <Card>
                  {d.actions.slice(0, 6).map((a, i) => (
                    <View key={i} style={styles.flowRow}>
                      <Text style={styles.flowName} numberOfLines={1}>{a.type}{a.detail ? ` · ${a.detail}` : ''}</Text>
                      <Text style={styles.docDate}>{a.ex_date || a.record_date}</Text>
                    </View>
                  ))}
                </Card>
              </>
            ) : null}

            {/* Thesis */}
            {mb?.strengths?.length ? (
              <>
                <SectionTitle>What works</SectionTitle>
                <Card><Bullets items={mb.strengths} color={theme.green} glyph="▲" /></Card>
              </>
            ) : null}

            {mb?.checklist?.length ? (
              <>
                <SectionTitle>Quality checklist</SectionTitle>
                <Card>
                  <View style={styles.checkWrap}>
                    {mb.checklist.map((c) => (
                      <View key={c.label} style={styles.checkItem}>
                        <Text style={[styles.checkMark, { color: c.state === 'pass' ? theme.green : c.state === 'fail' ? theme.red : theme.muted }]}>
                          {c.state === 'pass' ? '✓' : c.state === 'fail' ? '✗' : '?'}
                        </Text>
                        <Text style={styles.checkLabel}>{c.label}</Text>
                      </View>
                    ))}
                  </View>
                </Card>
              </>
            ) : null}

            <Text style={styles.disclaimer}>
              Aggregated from live market data, exchange filings and quantitative models. Primary documents (transcripts,
              presentations, annual reports) are linked from NSE/BSE, not auto-summarised. Educational only — not investment advice.
            </Text>
          </View>
        ) : !busy && !msg ? (
          <EmptyState icon="◆" title="Build an institutional dossier" hint="Search any NSE symbol for a full company report — fundamentals, valuation, in-depth technicals, ownership, relationships, risk, filings and an investment score with multibagging potential." />
        ) : null}
      </View>
    </ScrollView>
  );
}

// ── printable dossier (black-on-white PDF) ───────────────────────────────────
const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function dossierHtml(d: Dossier): string {
  const mb = d.mb, rec = d.rec, fund = d.fund, tech = d.tech;
  const m = (mb?.metrics || {}) as Record<string, number | null>;
  const name = mb?.name || fund?.longName || fund?.name || d.sym;
  const sector = mb?.sector || fund?.sector || '';
  const price = mb?.price ?? rec?.price ?? tech?.price ?? null;
  const v = verdict(mb, rec);
  const row = (k: string, val: string) => `<tr><td>${esc(k)}</td><td style="text-align:right">${esc(val)}</td></tr>`;
  const docs = (d.ann || []).filter((a) => DOC_RE.test(a.subject || ''));
  const green = '#0ca678', red = '#e03131';
  const tHex = mb ? (mb.score >= 75 ? green : mb.score >= 60 ? '#1d6fb8' : mb.score >= 45 ? '#b7791f' : red) : '#111';
  const fundRows = mb || fund ? [
    ['Market cap', fmtCr(m.mcap_cr ?? fund?.market_cap_cr ?? null)],
    ['Revenue growth', num(m.revenue_growth_pct, 1, '%')],
    ['Earnings growth', num(m.earnings_growth_pct, 1, '%')],
    ['ROE', num(m.roe_pct, 1, '%')],
    ['Op margin', num(m.op_margin_pct, 1, '%')],
    ['Debt/equity', plain(m.debt_equity ?? fund?.debt_equity ?? null, 2)],
    ['Total debt / borrowings', fmtCr(m.total_debt_cr)],
    ['Free cash flow', fmtCr(m.fcf_cr)],
    ['P/E', plain(m.pe ?? fund?.pe ?? null, 1)],
    ['PEG', plain(m.peg ?? null, 2)],
    ['3y price CAGR', num(m.price_cagr_3y_pct, 1, '%')],
  ].map(([k, val]) => row(k, val)).join('') : '';
  const techRows = tech ? [
    ['RSI (14)', plain(tech.rsi, 1)], ['MACD', plain(tech.macd, 2)],
    ['vs 50/200 DMA', `${pctS(tech.d50)} / ${pctS(tech.d200)}`],
    ['Beta', plain(tech.beta, 2)], ['52w range', `${money(tech.low52)} — ${money(tech.high52)}`],
  ].map(([k, val]) => row(k, val)).join('') : '';
  const setupRows = rec ? [
    ['Entry', money(rec.entry)], ['Stop', `${money(rec.stop)} (${pctS(rec.stop_pct)})`],
    ['Target', `${money(rec.target)} (${pctS(rec.upside_pct)})`],
    ['Reward:risk', rec.rr != null ? `${rec.rr.toFixed(1)}:1` : '—'],
    ['Support/resistance', `${money(rec.support)} / ${money(rec.resistance)}`],
  ].map(([k, val]) => row(k, val)).join('') : '';
  const holdRows = d.hold ? [
    ['Promoters', num(d.hold.promoter, 2, '%')], ['FII', num(d.hold.fii, 2, '%')],
    ['DII', num(d.hold.dii, 2, '%')], ['Public', num(d.hold.public, 2, '%')],
    ['Pledge', num(d.hold.pledge, 2, '%')],
  ].map(([k, val]) => row(k, val)).join('') : '';
  // Report date — also shown in the masthead, but stated in the body so it's
  // unambiguous on every printed page of the dossier.
  const dateStr = (() => {
    try {
      return new Date().toLocaleString('en-IN', { dateStyle: 'long', timeStyle: 'short' });
    } catch {
      return '';
    }
  })();
  // Strategy scorecard — how well the stock fits each screening strategy now.
  const scoreHex = (n: number | null) =>
    n == null ? '#111' : n >= 70 ? green : n >= 50 ? '#f08c00' : red;
  const biasHex = (b: string) => (/bull/i.test(b) ? green : /bear/i.test(b) ? red : '#f08c00');
  const biasCls = (b: string) => (/bull/i.test(b) ? 'g' : /bear/i.test(b) ? 'r' : 'a');
  const stratBlock = d.strat && d.strat.length
    ? `<h2>Strategy scorecard</h2><p style="margin:0 0 4px">How well ${esc(d.sym)} fits each screening strategy right now — 0–100, ✓ qualifies (≥70).</p>` +
      `<table><tr><td><b>Strategy</b></td><td style="text-align:right"><b>Score</b></td><td style="text-align:center"><b>Fit</b></td></tr>` +
      [...d.strat]
        .sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
        .map(
          (s) =>
            `<tr><td>${esc(s.name)}${s.note ? ` <span style="color:#888;font-size:10px">— ${esc(s.note)}</span>` : ''}</td>` +
            `<td style="text-align:right;color:${scoreHex(s.score)};font-weight:700">${s.score != null ? s.score : '—'}</td>` +
            `<td style="text-align:center">${s.pass ? `<span style="color:${green};font-weight:700">✓</span>` : '<span style="color:#bbb">—</span>'}</td></tr>`,
        )
        .join('') +
      `</table>`
    : '';
  // Technical setup — one card per timeframe (5-min → weekly) + horizon roll-ups.
  const tfCard = (t: TimeframesResp['timeframes'][number]) =>
    `<div class="tf-card">` +
    `<div class="tf-top"><span class="tf-tf">${esc(t.label)}</span>` +
    `<span class="pill ${biasCls(t.bias)}">${esc(t.bias)}</span></div>` +
    `<div class="tf-top"><span class="tf-score" style="color:${scoreHex(t.score)}">${t.score != null ? t.score : '—'}` +
    `<span class="tf-of"> /100</span></span></div>` +
    `<div class="tf-row"><span>Price</span><b>${t.price != null ? esc(money(t.price)) : '—'}</b></div>` +
    `<div class="tf-row"><span>RSI</span><b>${t.rsi != null ? t.rsi.toFixed(0) : '—'}</b></div>` +
    `<div class="tf-row"><span>vs EMA20</span><b style="color:${(t.vs_ema20 ?? 0) >= 0 ? green : red}">${t.vs_ema20 != null ? pctS(t.vs_ema20) : '—'}</b></div>` +
    `<div class="tf-row"><span>vs EMA50</span><b style="color:${(t.vs_ema50 ?? 0) >= 0 ? green : red}">${t.vs_ema50 != null ? pctS(t.vs_ema50) : '—'}</b></div>` +
    `</div>`;
  const tfBlock = d.tf && d.tf.timeframes?.length
    ? `<h2>Technical setup · by timeframe</h2>` +
      `<div class="tf-grid">${d.tf.timeframes.map(tfCard).join('')}</div>` +
      (d.tf.horizons?.length
        ? `<p style="margin:8px 0 0"><b>Horizon read</b> &nbsp; ${d.tf.horizons
            .map((h) => `${esc(h.label)} <span class="pill ${biasCls(h.bias)}">${esc(h.bias)}${h.score != null ? ` ${h.score}` : ''}</span>`)
            .join(' &nbsp; ')}</p>`
        : '')
    : '';
  const flags = mb?.red_flags?.length ? `<h2>Red flags</h2><ul>${mb.red_flags.map((x) => `<li style="color:${red}">${esc(x)}</li>`).join('')}</ul>` : '';
  const strengths = mb?.strengths?.length ? `<h2>What works</h2><ul>${mb.strengths.map((x) => `<li style="color:${green}">${esc(x)}</li>`).join('')}</ul>` : '';
  const docLinks = docs.length ? `<h2>Management commentary & filings</h2><ul>${docs.slice(0, 10).map((a) => `<li>${a.attachment ? `<a href="${esc(a.attachment)}">${esc(a.subject)}</a>` : esc(a.subject)} <span style="color:#888">— ${esc(a.date)}</span></li>`).join('')}</ul>` : '';
  const rep = d.rep;
  const plRows = rep?.fin_years?.length
    ? `<h2>Profit & loss (annual)</h2><table><tr><td><b>Year</b></td><td style="text-align:right"><b>Revenue</b></td><td style="text-align:right"><b>PAT</b></td><td style="text-align:right"><b>PAT growth</b></td></tr>${rep.fin_years.map((y) => `<tr><td>${esc(y.year)}</td><td style="text-align:right">${esc(fmtCr(y.revenue))}</td><td style="text-align:right">${esc(fmtCr(y.net_income))}</td><td style="text-align:right">${esc(pctS(y.ni_growth))}</td></tr>`).join('')}</table>`
    : '';
  const qRows = rep?.fin_quarters?.length
    ? `<h2>Profit & loss (quarterly)</h2><table><tr><td><b>Quarter</b></td><td style="text-align:right"><b>Revenue</b></td><td style="text-align:right"><b>PAT</b></td></tr>${rep.fin_quarters.map((q) => `<tr><td>${esc(q.period)}</td><td style="text-align:right">${esc(fmtCr(q.revenue))}</td><td style="text-align:right">${esc(fmtCr(q.net_income))}</td></tr>`).join('')}</table>`
    : '';
  const b2 = rep?.balance_sheet;
  const bsRows = b2 ? `<h2>Balance sheet & cash flow</h2><table>${[
    ['Total debt / borrowings', fmtCr(b2.total_debt)], ['Long-term borrowings', fmtCr(b2.long_term_debt)],
    ['Cash & equivalents', fmtCr(b2.cash)], ["Shareholders' equity", fmtCr(b2.equity)],
    ['Total assets', fmtCr(b2.total_assets)],
    ['Operating cash flow', fmtCr(rep?.cash_flow?.ocf)], ['Free cash flow', fmtCr(rep?.cash_flow?.fcf)],
  ].map(([k, v]) => row(k, v)).join('')}</table>` : '';
  return `<html><head><title>TaurEye — Institutional dossier — ${esc(d.sym)}</title>
<style>body{font-family:Arial,sans-serif;color:#111;background:#fff;max-width:800px;margin:24px auto;padding:0 16px}
h1{font-size:20px;margin-bottom:0}h2{font-size:14px;margin:18px 0 6px}
table{border-collapse:collapse;width:100%}td{border-bottom:1px solid #ddd;padding:5px 4px;font-size:12px}
ul{margin:4px 0;padding-left:18px;font-size:12px;line-height:1.6}p{font-size:12px;color:#444;line-height:1.5}
a{color:#1d6fb8}.big{font-size:34px;font-weight:800}.sub{color:#666;font-size:12px}</style></head><body>
<h1>${esc(name)} <span class="sub">${esc(d.sym)}${sector ? ' · ' + esc(sector) : ''}</span></h1>
${dateStr ? `<div class="sub" style="margin:1px 0 6px">Report generated ${esc(dateStr)}</div>` : ''}
${price != null ? `<div style="font-size:15px;font-weight:700">${esc(money(price))} <span class="sub">${esc(fmtCr(m.mcap_cr ?? fund?.market_cap_cr ?? null))}</span></div>` : ''}
<div class="big" style="color:${v.color === theme.green ? green : v.color === theme.red ? red : '#b7791f'}">${esc(v.label)}${mb ? ` · ${mb.score}/100` : ''}</div>
${mb ? `<div>${esc(mb.tier)} · multibagging potential (5x+ in 5–10y): <b style="color:${tHex}">${mb.probability_pct}%</b>${rec ? ` · trade engine: <b>${esc(rec.action)}</b> (confidence ${rec.confidence})` : ''}</div>` : ''}
<p>${esc(v.note)}</p>
${mb?.about || fund?.description ? `<h2>Business overview</h2><p>${esc(mb?.about || fund?.description)}</p>` : ''}
${stratBlock}
${fundRows ? `<h2>Fundamentals & valuation</h2><table>${fundRows}</table>` : ''}
${plRows}${qRows}${bsRows}
${techRows ? `<h2>In-depth technicals</h2><table>${techRows}</table>` : ''}
${tfBlock}
${setupRows ? `<h2>Trade setup</h2><table>${setupRows}</table>` : ''}
${holdRows ? `<h2>Ownership</h2><table>${holdRows}</table>` : ''}
${strengths}${flags}${docLinks}
<p style="color:#999;font-size:10px;margin-top:14px">Aggregated from live market data, exchange filings and quantitative models. Primary documents are linked from NSE/BSE, not auto-summarised. Educational only — not investment advice.</p>
</body></html>`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  content: { paddingBottom: 48, width: '100%', maxWidth: 820, alignSelf: 'center' },
  body: { paddingHorizontal: theme.sp.lg },
  setupCard: { zIndex: 50 },
  inputs: { flexDirection: 'row', gap: theme.sp.md, zIndex: 50 },
  field: { flex: 1, zIndex: 50 },
  fieldSm: { width: 96 },
  label: { color: theme.muted2, fontSize: theme.fs.sm, marginBottom: theme.sp.xs },
  input: {
    backgroundColor: theme.surface, borderColor: theme.border2, borderWidth: 1,
    borderRadius: theme.radius.sm + 2, color: theme.text, paddingHorizontal: theme.sp.md,
    paddingVertical: 10, fontFamily: theme.mono, fontSize: theme.fs.md,
  },
  setupBtns: { flexDirection: 'row', gap: theme.sp.sm, marginTop: theme.sp.lg },
  btn: { flex: 1, backgroundColor: theme.accent, borderRadius: theme.radius.sm + 2, paddingVertical: 11, alignItems: 'center' },
  btnText: { color: theme.onAccent, fontWeight: '700', fontSize: theme.fs.sm + 1, letterSpacing: 0.3 },
  btnGhost: { backgroundColor: theme.surface2, borderColor: theme.border2, borderWidth: 1, borderRadius: theme.radius.sm + 2, paddingVertical: 11, paddingHorizontal: theme.sp.lg, alignItems: 'center' },
  btnGhostTxt: { color: theme.text, fontWeight: '700', fontSize: theme.fs.sm + 1 },
  msg: { color: theme.muted2, fontSize: theme.fs.sm, marginTop: theme.sp.lg, textAlign: 'center', lineHeight: 18 },
  report: { marginTop: theme.sp.lg, gap: theme.sp.xs },
  hdr: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.sp.md, marginBottom: theme.sp.sm },
  coName: { color: theme.text, fontSize: theme.fs.lg + 1, fontWeight: '800' },
  coMeta: { color: theme.muted, fontSize: theme.fs.sm, marginTop: 2 },
  coPrice: { color: theme.text, fontSize: theme.fs.lg, fontWeight: '700', fontFamily: theme.mono },
  verdictCard: { gap: theme.sp.sm },
  verdictTop: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.md },
  scoreBox: { flexDirection: 'row', alignItems: 'baseline', borderWidth: 1.5, borderRadius: theme.radius.lg, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: theme.surface2 },
  scoreBig: { fontSize: 36, fontWeight: '800', fontFamily: theme.mono, lineHeight: 40 },
  scoreOf: { color: theme.muted, fontSize: theme.fs.sm, marginLeft: 2, fontFamily: theme.mono },
  verdictLabel: { fontSize: theme.fs.lg, fontWeight: '800', letterSpacing: 0.5 },
  verdictSub: { color: theme.muted2, fontSize: theme.fs.sm },
  verdictNote: { color: theme.muted2, fontSize: theme.fs.sm, lineHeight: 19 },
  para: { color: theme.muted2, fontSize: theme.fs.sm, lineHeight: 20 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp.sm },
  kv: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 7, borderBottomColor: theme.border, borderBottomWidth: 1, gap: theme.sp.md },
  kvK: { color: theme.muted2, fontSize: theme.fs.sm, flexShrink: 1 },
  kvV: { color: theme.text, fontFamily: theme.mono, fontSize: theme.fs.sm + 1, fontWeight: '700', textAlign: 'right' },
  bullet: { fontSize: theme.fs.sm, lineHeight: 20, paddingVertical: 2 },
  bulletTxt: { color: theme.text },
  flowRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomColor: theme.border, borderBottomWidth: 1, gap: theme.sp.md },
  flowName: { color: theme.text, fontSize: theme.fs.sm, flex: 1, fontWeight: '600' },
  flowNet: { fontFamily: theme.mono, fontSize: theme.fs.sm, fontWeight: '700' },
  docRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingVertical: 9, borderBottomColor: theme.border, borderBottomWidth: 1, gap: theme.sp.md },
  docSubj: { color: theme.text, fontSize: theme.fs.sm, flex: 1, lineHeight: 18 },
  docDate: { color: theme.muted, fontFamily: theme.mono, fontSize: theme.fs.xs + 1 },
  tHead: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.surface2, borderTopColor: theme.border, borderTopWidth: 1, borderBottomColor: theme.border2, borderBottomWidth: 1, paddingVertical: theme.sp.sm, paddingHorizontal: theme.sp.sm },
  thc: { color: theme.muted2, fontSize: theme.fs.xs + 1, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  tRow: { flexDirection: 'row', alignItems: 'center', minHeight: 40, paddingHorizontal: theme.sp.sm, borderBottomColor: theme.border, borderBottomWidth: 1 },
  tdc: { color: theme.text, fontFamily: theme.mono, fontSize: theme.fs.sm },
  cH: { flex: 1 },
  cN: { width: 84, textAlign: 'right' },
  small: { color: theme.muted, fontSize: theme.fs.xs + 1, lineHeight: 16, marginBottom: theme.sp.xs },
  finHead: { flexDirection: 'row', alignItems: 'center', paddingBottom: theme.sp.sm, borderBottomColor: theme.border2, borderBottomWidth: 1 },
  finHc: { color: theme.muted2, fontSize: theme.fs.xs, fontWeight: '700', letterSpacing: 0.4 },
  finRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7, borderBottomColor: theme.border, borderBottomWidth: 1 },
  finV: { color: theme.text, fontFamily: theme.mono, fontSize: theme.fs.sm },
  finPeriod: { flex: 1.4, textAlign: 'left' },
  finNum: { flex: 1, textAlign: 'right' },
  scrBtn: { marginTop: theme.sp.sm, alignSelf: 'flex-start', backgroundColor: theme.surface2, borderColor: theme.accent, borderWidth: 1, borderRadius: theme.radius.sm + 2, paddingHorizontal: theme.sp.md, paddingVertical: 8 },
  scrBtnTxt: { color: theme.accent, fontSize: theme.fs.sm, fontWeight: '800' },
  checkWrap: { flexDirection: 'row', flexWrap: 'wrap' },
  checkItem: { flexDirection: 'row', alignItems: 'center', gap: 7, width: '50%', minWidth: 220, paddingVertical: 5 },
  checkMark: { fontFamily: theme.mono, fontSize: theme.fs.md, fontWeight: '800', width: 14 },
  checkLabel: { color: theme.muted2, fontSize: theme.fs.sm, flexShrink: 1 },
  disclaimer: { color: theme.muted, fontSize: theme.fs.xs + 1, lineHeight: 16, marginTop: theme.sp.lg, fontStyle: 'italic' },
});
