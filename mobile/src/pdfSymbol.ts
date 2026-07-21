// One-tap research PDF for the Symbol page — the consolidated export the
// per-engine screens used to duplicate. Composes whatever per-symbol reads are
// available (multi-timeframe, strategy scorecard, fundamental checklist) into
// the shared A4 research chrome (openPdfPreview → professionalShell).
import {
  ChecklistResp,
  ScanRow,
  StrategyScoresResp,
  TimeframesResp,
} from './api';
import { openPdfPreview } from './pdf';

const esc = (v: unknown): string =>
  String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const money = (n?: number | null) =>
  n == null || !isFinite(n) ? '—' : '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
const pctS = (n?: number | null) => (n == null || !isFinite(n) ? '—' : (n >= 0 ? '+' : '') + n.toFixed(2) + '%');
const scoreHex = (n?: number | null) => (n == null ? '#111' : n >= 60 ? '#0b7a53' : n <= 40 ? '#c92a2a' : '#b7791f');
const biasCls = (b?: string) => (/bull/i.test(b || '') ? 'g' : /bear/i.test(b || '') ? 'r' : 'a');

export function symbolReportHtml(
  sym: string,
  name: string | null,
  scan: ScanRow | null,
  tf: TimeframesResp | null,
  strat: StrategyScoresResp | null,
  chk: ChecklistResp | null,
): string {
  const row = (k: string, v: string) => `<tr><td>${esc(k)}</td><td style="text-align:right"><b>${v}</b></td></tr>`;
  const snap = scan
    ? `<h2>Snapshot</h2><table>` +
      row('Last price', money(scan.price)) + row('Day change', pctS(scan.chg)) +
      row('RSI (14)', scan.rsi != null ? scan.rsi.toFixed(0) : '—') +
      row('vs 200-DMA', pctS(scan.d200)) + row('From 52-week high', pctS(scan.pct_from_high)) +
      row('1-week return', pctS(scan.ret_1w)) + row('1-month return', pctS(scan.ret_1m)) +
      `</table>`
    : '';
  const ov = tf?.overall;
  const tfBlock = tf?.timeframes?.length
    ? `<h2>Multi-timeframe read</h2>` +
      (ov ? `<p><b style="color:${scoreHex(ov.score)}">${esc(ov.rating || ov.bias)}${ov.score != null ? ` · ${ov.score}/100` : ''}</b> — weighted across every timeframe.</p>` : '') +
      `<div class="tf-grid">` +
      tf.timeframes.map((t) =>
        `<div class="tf-card"><div class="tf-top"><span class="tf-tf">${esc(t.label)}</span>` +
        `<span class="pill ${biasCls(t.bias)}">${esc(t.rating || t.bias)}</span></div>` +
        `<div class="tf-top"><span class="tf-score" style="color:${scoreHex(t.score)}">${t.score ?? '—'}<span class="tf-of"> /100</span></span></div>` +
        `<div class="tf-row"><span>RSI</span><b>${t.rsi != null ? t.rsi.toFixed(0) : '—'}</b></div>` +
        `<div class="tf-row"><span>Support</span><b>${t.supports?.length ? t.supports.map(money).join(' · ') : '—'}</b></div>` +
        `<div class="tf-row"><span>Resistance</span><b>${t.resistances?.length ? t.resistances.map(money).join(' · ') : '—'}</b></div></div>`,
      ).join('') + `</div>`
    : '';
  const stratBlock = strat?.strategies?.length
    ? `<h2>Strategy scorecard</h2><table>` +
      [...strat.strategies].sort((a, b) => (b.score ?? -1) - (a.score ?? -1)).map((s) =>
        `<tr><td>${esc(s.name)}</td><td style="text-align:right;color:${scoreHex(s.score)};font-weight:700">${s.score ?? '—'}</td>` +
        `<td style="text-align:center">${s.pass ? '<span style="color:#0b7a53;font-weight:700">PASS</span>' : '—'}</td></tr>`,
      ).join('') + `</table>`
    : '';
  const chkV = (v: string) => (v === 'good' ? '#0b7a53' : v === 'ok' ? '#b7791f' : v === 'bad' ? '#c92a2a' : '#999');
  const chkBlock = chk?.items?.length
    ? `<h2>Fundamental checklist</h2>` +
      `<p style="margin:0 0 4px">${chk.passed}/${chk.scored} strong${chk.score != null ? ` · overall ${chk.score}/100` : ''}.</p>` +
      `<table>` + chk.items.map((it, i) =>
        `<tr><td>${i + 1}. ${esc(it.label)}</td><td style="text-align:right;color:${chkV(it.verdict)};font-weight:700">${esc(it.value ?? '—')}</td></tr>`,
      ).join('') + `</table>`
    : '';
  return `<html><head><title>TaurEye — Symbol report — ${esc(sym)}</title></head><body>` +
    `<h1>${esc(sym)}${name ? ` <span class="sub">${esc(name)}</span>` : ''}</h1>` +
    snap + tfBlock + stratBlock + chkBlock +
    `<p style="color:#999;font-size:10px;margin-top:14px">Aggregated from live market data and quantitative models. Research, not investment advice.</p>` +
    `</body></html>`;
}

export function exportSymbolPdf(
  sym: string,
  name: string | null,
  scan: ScanRow | null,
  tf: TimeframesResp | null,
  strat: StrategyScoresResp | null,
  chk: ChecklistResp | null,
): boolean {
  return openPdfPreview(symbolReportHtml(sym, name, scan, tf, strat, chk), {
    docType: 'Symbol report',
    fileName: `TaurEye-${sym}`,
  });
}
