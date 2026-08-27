// CSV export for screener rows. On web this triggers a real file download; on
// native it opens the OS share sheet with the CSV text (no extra deps needed).
import { Platform, Share } from 'react-native';
import { Row, calcSignal } from './screener';
import { printHtmlDocument } from './pdf';

// A column spec for exports: header + raw-value getter. `i` is the row's
// 0-based position in the exported set (used by the serial column).
export type ExportCol = { header: string; get: (r: Row, i: number) => unknown };

const FIELDS: ExportCol[] = [
  { header: 'Symbol', get: (r) => r.sym },
  { header: 'Price', get: (r) => r.price },
  { header: 'PrevClose', get: (r) => r.prevClose },
  { header: 'Chg%', get: (r) => r.chg },
  { header: 'AbsChg', get: (r) => r.absChg },
  { header: 'Volume', get: (r) => r.volume },
  { header: 'AvgVol', get: (r) => r.avgvol },
  { header: 'RelVol', get: (r) => r.relvol },
  { header: 'RSI', get: (r) => r.rsi },
  { header: 'MACD', get: (r) => r.macd },
  { header: 'W%R', get: (r) => r.willr },
  { header: 'Boll%B', get: (r) => r.bollb },
  { header: 'vs9DMA%', get: (r) => r.d9 },
  { header: 'vs20DMA%', get: (r) => r.d20 },
  { header: 'vs50DMA%', get: (r) => r.d50 },
  { header: 'vs200DMA%', get: (r) => r.d200 },
  { header: '52wHigh', get: (r) => r.high52 },
  { header: '52wLow', get: (r) => r.low52 },
  { header: 'From52wHigh%', get: (r) => r.pct_from_high },
  { header: 'From52wLow%', get: (r) => r.pct_from_low },
  { header: 'Beta', get: (r) => r.beta },
  { header: 'SqueezeOn', get: (r) => r.sqzOn },
  { header: 'SqueezeFired', get: (r) => r.sqzFire },
  { header: 'SqueezeMom', get: (r) => r.sqzMom },
  { header: 'S1', get: (r) => r.s1 },
  { header: 'S2', get: (r) => r.s2 },
  { header: 'S3', get: (r) => r.s3 },
  { header: 'R1', get: (r) => r.r1 },
  { header: 'R2', get: (r) => r.r2 },
  { header: 'R3', get: (r) => r.r3 },
  { header: 'GoldenCross', get: (r) => r.golden_cross },
  { header: 'DeathCross', get: (r) => r.death_cross },
  { header: 'Cross20/50Up', get: (r) => r.cross_20_50_up },
  { header: 'Cross20/50Down', get: (r) => r.cross_20_50_down },
  { header: 'MACDBullCross', get: (r) => r.macd_bull_cross },
  { header: 'MACDBearCross', get: (r) => r.macd_bear_cross },
  { header: 'GapUp', get: (r) => r.gap_up },
  { header: 'GapDown', get: (r) => r.gap_down },
  { header: 'New52wHigh', get: (r) => r.new_high_52w },
  { header: 'New52wLow', get: (r) => r.new_low_52w },
  { header: 'VolumeSpike', get: (r) => r.volume_spike },
  { header: 'CamH3', get: (r) => r.cam_h3 },
  { header: 'CamH4', get: (r) => r.cam_h4 },
  { header: 'CamL3', get: (r) => r.cam_l3 },
  { header: 'CamL4', get: (r) => r.cam_l4 },
  { header: 'CamBreakUp', get: (r) => r.cam_break_up },
  { header: 'CamBreakDown', get: (r) => r.cam_break_down },
  { header: 'MktCap(cr)', get: (r) => fund(r, 'market_cap_cr') },
  { header: 'P/E', get: (r) => fund(r, 'pe') },
  { header: 'P/B', get: (r) => fund(r, 'pb') },
  { header: 'ROE%', get: (r) => fund(r, 'roe') },
  { header: 'ROCE%', get: (r) => fund(r, 'roce') },
  { header: 'D/E', get: (r) => fund(r, 'debt_equity') },
  { header: 'DivYield%', get: (r) => fund(r, 'dividend_yield') },
  { header: 'Sector', get: (r) => fund(r, 'sector') },
  { header: 'Signal', get: (r) => calcSignal(r).toUpperCase() },
];

function fund(r: Row, k: string): unknown {
  const f = r._fund as Record<string, unknown> | null | undefined;
  return f ? f[k] : null;
}

const cell = (v: unknown): string => {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

export function buildCsv(rows: Row[], cols: ExportCol[] = FIELDS): string {
  const head = cols.map((f) => f.header).join(',');
  const body = rows.map((r, i) => cols.map((f) => cell(f.get(r, i))).join(',')).join('\n');
  return head + '\n' + body + '\n';
}

const slug = (name: string) => name.toLowerCase().replace(/\s+/g, '-');

// Trigger a real file download on web via a Blob + anchor (no DOM lib in this
// tsconfig, so everything is reached through globalThis).
function webDownload(data: string, filename: string, mime: string): boolean {
  const doc = (globalThis as { document?: any }).document;
  const url = (globalThis as { URL?: any }).URL;
  if (!doc || !url) return false;
  const blob = new (globalThis as { Blob?: any }).Blob([data], { type: mime });
  const a = doc.createElement('a');
  a.href = url.createObjectURL(blob);
  a.download = filename;
  doc.body.appendChild(a);
  a.click();
  doc.body.removeChild(a);
  url.revokeObjectURL(a.href);
  return true;
}

// ── native-shell downloads ───────────────────────────────────────────────────
// Inside the Capacitor APK the bundle still reports Platform.OS === 'web', so
// the anchor-download path above runs — and Android's System WebView ignores
// `<a download>` on a blob: URL, which made every export a silent no-op on the
// phone. There the file is written to app storage and handed to the Android
// share sheet instead (same pattern as printer.ts's native print bridge).
const isNativeShell = (): boolean => {
  try {
    const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    return !!cap?.isNativePlatform?.();
  } catch {
    return false;
  }
};

async function nativeSave(data: string, filename: string, mime: string): Promise<boolean> {
  try {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
    const { Share } = await import('@capacitor/share');
    await Filesystem.writeFile({
      path: filename,
      data,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
    });
    const { uri } = await Filesystem.getUri({ path: filename, directory: Directory.Cache });
    await Share.share({ title: filename, url: uri, dialogTitle: `Save ${filename}` });
    return true;
  } catch {
    // Older APK without the plugins, or the user dismissed the sheet.
    return false;
  }
}

/** Deliver an exported file on whichever platform is running. Returns false
 *  when the native shell could not save it, so callers can say so. */
export async function deliverFile(data: string, filename: string, mime: string): Promise<boolean> {
  if (isNativeShell()) return nativeSave(data, filename, mime);
  if (Platform.OS === 'web') return webDownload(data, filename, mime);
  await Share.share({ title: filename, message: data });
  return true;
}

export async function exportCsv(rows: Row[], name: string, cols?: ExportCol[]): Promise<void> {
  const csv = buildCsv(rows, cols);
  const filename = `taureye-${slug(name)}.csv`;
  await deliverFile(csv, filename, 'text/csv');
}

const htmlEsc = (v: unknown): string => {
  if (v == null) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
};

function buildHtmlTable(rows: Row[], styled: boolean, cols: ExportCol[] = FIELDS): string {
  const th = cols.map((f) => `<th>${htmlEsc(f.header)}</th>`).join('');
  const body = rows
    .map((r, i) => '<tr>' + cols.map((f) => `<td>${htmlEsc(f.get(r, i))}</td>`).join('') + '</tr>')
    .join('');
  const css = styled
    ? '<style>@page{size:A4 landscape;margin:12mm}' +
      'body{font-family:Arial,Helvetica,sans-serif;color:#111}' +
      'table{border-collapse:collapse;width:100%;font-size:10px}' +
      'th,td{border:1px solid #ccc;padding:3px 5px;text-align:right;white-space:nowrap}' +
      'th{background:#f0f2f5;text-align:center}' +
      'td:first-child,th:first-child{text-align:left}</style>'
    : '';
  return `${css}<table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table>`;
}

// Excel: no xlsx dep — emit an HTML table Excel can open, saved as .xls. The
// same file goes to the browser download on web and to the Android share sheet
// in the app shell (see deliverFile).
export async function exportExcel(rows: Row[], name: string, cols?: ExportCol[]): Promise<void> {
  const filename = `taureye-${slug(name)}.xls`;
  const html =
    '<html><head><meta charset="utf-8"></head><body>' +
    buildHtmlTable(rows, false, cols) +
    '</body></html>';
  await deliverFile(html, filename, 'application/vnd.ms-excel');
}

// ── Generic, column-config-driven export ──────────────────────────────────────
// The Watchlist has its own row shape (symbol + live quote), not screener Rows,
// so it drives these header/row exporters instead of the Row-typed ones above.
// Reuses the same cell-escaping, web download and native share plumbing.
export function buildCsvRows(headers: string[], rows: string[][]): string {
  const head = headers.map(cell).join(',');
  const body = rows.map((r) => r.map(cell).join(',')).join('\n');
  return head + '\n' + body + '\n';
}

function buildHtmlTableRows(headers: string[], rows: string[][]): string {
  const th = headers.map((h) => `<th>${htmlEsc(h)}</th>`).join('');
  const body = rows
    .map((r) => '<tr>' + r.map((c) => `<td>${htmlEsc(c)}</td>`).join('') + '</tr>')
    .join('');
  return `<table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table>`;
}


/**
 * Charge for an export, once, at the only two doors every export goes through.
 *
 * There are eight export call sites across the app. Metering each of them would
 * mean eight chances to forget, and one forgotten site makes the price list a
 * lie. Both public helpers funnel through here instead.
 *
 * Returns false when the charge failed, and the caller must then NOT deliver a
 * file — an export that was refused but downloaded anyway is worse than no
 * metering at all.
 */
async function chargeExport(name: string): Promise<boolean> {
  const { chargeFor } = await import('./credits');
  // The ref is the export's name plus the day: re-exporting the same table
  // twice in one session is one charge, which is what a user would expect.
  const day = new Date().toISOString().slice(0, 10);
  const r = await chargeFor('export', `export:${slug(name)}:${day}`, { feature: 'exports' });
  return r.ok || (!r.ok && r.reason === 'covered-by-plan');
}

export async function exportCsvRows(headers: string[], rows: string[][], name: string): Promise<void> {
  if (!(await chargeExport(name))) return;
  const csv = buildCsvRows(headers, rows);
  const filename = `taureye-${slug(name)}.csv`;
  await deliverFile(csv, filename, 'text/csv');
}

export async function exportExcelRows(headers: string[], rows: string[][], name: string): Promise<void> {
  if (!(await chargeExport(name))) return;
  const filename = `taureye-${slug(name)}.xls`;
  const html =
    '<html><head><meta charset="utf-8"></head><body>' +
    buildHtmlTableRows(headers, rows) +
    '</body></html>';
  await deliverFile(html, filename, 'application/vnd.ms-excel');
}

// PDF: no jspdf dep — render a styled table and invoke the platform print /
// "Save as PDF" dialog, which downloads a real PDF on desktop AND inside the
// Android WebView (see printHtmlDocument). A true native RN runtime with no DOM
// shares the CSV text instead.
export async function exportPdf(rows: Row[], name: string, cols?: ExportCol[]): Promise<void> {
  const doc = (globalThis as { document?: any }).document;
  if (!doc?.body) {
    await Share.share({ title: `taureye-${slug(name)}.csv`, message: buildCsv(rows, cols) });
    return;
  }
  const title = `TaurEye — ${name}`;
  printHtmlDocument(
    `<html><head><title>${htmlEsc(title)}</title></head><body>` +
      `<h3 style="font-family:Arial,sans-serif">${htmlEsc(title)}</h3>` +
      buildHtmlTable(rows, true, cols) +
      '</body></html>',
  );
}
