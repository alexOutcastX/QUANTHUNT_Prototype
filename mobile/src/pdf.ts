// Shared PDF export: a preview modal + "Print / Save as PDF" that works in a
// desktop browser AND inside the Capacitor Android WebView.
//
// Why a preview modal (not a hidden auto-print)? The old approach wrote the
// report into a hidden 0×0 iframe and called print() programmatically. Android's
// System WebView silently ignores print() on a hidden, not-yet-laid-out frame
// fired outside a user gesture — so "Export PDF" did nothing on the phone. The
// reliable path is: show the report in a VISIBLE iframe, and let the user tap a
// Print button (a real gesture, on a loaded frame). That routes through the
// platform print dialog whose "Save as PDF" writes a genuine file to the device.
// The iframe is sandboxed WITH allow-modals so print() isn't blocked.
//
// Output is the browser's native vector print-to-PDF: selectable text, no raster
// images — inherently as compressed as possible with no loss of quality — and we
// force A4 + professional "research report" chrome so every export looks the
// same across the app.

const FORCE_LIGHT =
  '<meta name="color-scheme" content="light">' +
  '<style>:root{color-scheme:light}html,body{background:#fff !important;color:#111 !important}</style>';

function withLightScheme(html: string): string {
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + FORCE_LIGHT);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => m + '<head>' + FORCE_LIGHT + '</head>');
  return FORCE_LIGHT + html;
}

const esc = (v: string): string =>
  String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function nowStr(): string {
  try {
    return new (globalThis as { Date: new () => { toLocaleString: (l: string, o: object) => string } }).Date().toLocaleString(
      'en-IN',
      { dateStyle: 'medium', timeStyle: 'short' } as object,
    );
  } catch {
    return '';
  }
}

// Wrap any report body in professional, A4, black-on-white "equity research"
// chrome: a branded masthead, a confidential print footer, and page rules that
// keep tables/sections from splitting across pages. Injected last so it sets the
// page geometry without fighting each report's own inline styling.
export function professionalShell(html: string, opts: { docType?: string; dateStr?: string } = {}): string {
  html = withLightScheme(html);
  const docType = opts.docType || 'Company report';
  const dateStr = opts.dateStr || nowStr();
  // "New-age fintech" report skin: a gradient hero card, colour-coded section
  // eyebrows, rounded striped tables, pills and metric/timeframe cards. Bold but
  // still A4 and print-clean (print-color-adjust:exact keeps every colour).
  const CHROME =
    '<style>' +
    '@page{size:A4;margin:12mm 12mm 14mm}' +
    '*{-webkit-print-color-adjust:exact;print-color-adjust:exact;box-sizing:border-box}' +
    'html,body{background:#fff}' +
    'body{margin:0;padding:0;font-family:-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#0f172a;font-size:10.5pt;line-height:1.5}' +
    // gradient hero card
    '.rp-hero{display:flex;align-items:center;justify-content:space-between;gap:14px;' +
    'background:linear-gradient(120deg,#4338ca 0%,#6d28d9 58%,#7c3aed 100%);color:#fff;' +
    'border-radius:16px;padding:18px 22px;margin:0 0 18px}' +
    '.rp-brand{font-weight:800;font-size:20px;letter-spacing:.2px}' +
    '.rp-brand i{color:#fbbf24;font-style:normal}' +
    '.rp-brand small{display:block;font-weight:600;font-size:9px;letter-spacing:2px;text-transform:uppercase;color:#ddd6fe;margin-top:3px}' +
    '.rp-meta{text-align:right}' +
    '.rp-doc{font-size:10px;font-weight:800;letter-spacing:1.8px;text-transform:uppercase;color:#f5f3ff}' +
    '.rp-date{font-size:9.5px;color:#d8b4fe;margin-top:3px}' +
    // typography
    'h1{font-size:21px;font-weight:800;letter-spacing:-.3px;color:#0f172a;margin:0 0 2px}' +
    '.sub{color:#64748b;font-size:11px}' +
    '.big{font-size:29px;font-weight:800;letter-spacing:-.5px;margin:4px 0}' +
    'h2{font-size:9.5px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:#6d28d9;' +
    'margin:20px 0 8px;padding:0;border:0;display:flex;align-items:center;gap:8px}' +
    'h2::before{content:"";width:16px;height:3px;border-radius:3px;background:linear-gradient(90deg,#6d28d9,#4c6ef5)}' +
    'p{font-size:10pt;color:#334155;line-height:1.55;margin:6px 0}a{color:#4c6ef5;text-decoration:none}' +
    'ul{margin:5px 0;padding-left:18px;font-size:10pt;line-height:1.65}li{margin:2px 0}' +
    // rounded striped tables
    'table{border-collapse:separate;border-spacing:0;width:100%;font-size:9.5pt;' +
    'border:1px solid #e9e7f5;border-radius:12px;overflow:hidden;margin:2px 0}' +
    'td{padding:7px 12px;border-bottom:1px solid #f1eff9}tr:last-child td{border-bottom:0}' +
    'tr:nth-child(even) td{background:#faf9ff}' +
    // header rows are the ones the builders bold — tint just those (not the first
    // data row of header-less tables). :has() is supported by the print WebView.
    'tr:has(td b:first-child) td{background:#f3f0ff;color:#4c1d95}' +
    // pills
    '.pill{display:inline-block;font-size:9px;font-weight:800;letter-spacing:.4px;text-transform:uppercase;padding:3px 10px;border-radius:999px}' +
    '.pill.g{background:#d3f9d8;color:#0b7a53}.pill.r{background:#ffe3e3;color:#c92a2a}.pill.a{background:#fff3bf;color:#a5680a}' +
    // timeframe technical-setup cards
    '.tf-grid{display:flex;flex-wrap:wrap;gap:9px;margin:4px 0}' +
    '.tf-card{flex:1 1 30%;min-width:150px;border:1px solid #e9e7f5;border-radius:14px;' +
    'padding:11px 13px;background:linear-gradient(180deg,#ffffff,#faf9ff);page-break-inside:avoid}' +
    '.tf-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:4px}' +
    '.tf-tf{font-weight:800;font-size:12px;color:#0f172a}' +
    '.tf-score{font-weight:800;font-size:22px;letter-spacing:-.5px;line-height:1}' +
    '.tf-of{color:#94a3b8;font-size:9px;font-weight:600}' +
    '.tf-row{display:flex;justify-content:space-between;font-size:9px;color:#64748b;padding:1.5px 0}' +
    '.tf-row b{color:#0f172a;font-weight:700}' +
    'table,ul,h2,.rec,.verdictCard{page-break-inside:avoid}' +
    // confidential footer — repeats on every printed page
    '.rp-foot{display:none}' +
    '@media print{.rp-foot{display:block;position:fixed;bottom:0;left:0;right:0;text-align:center;' +
    'font-size:8px;letter-spacing:.4px;color:#94a3b8;padding:3px 0;border-top:1px solid #eee;background:#fff}' +
    '.rp-body{padding-bottom:12mm}}' +
    '</style>';
  const withCss = /<\/head>/i.test(html) ? html.replace(/<\/head>/i, CHROME + '</head>') : CHROME + html;
  const hero =
    '<div class="rp-hero"><div class="rp-brand">Taur<i>Eye</i><small>Intelligence</small></div>' +
    '<div class="rp-meta"><div class="rp-doc">' + esc(docType) + '</div>' +
    (dateStr ? '<div class="rp-date">' + esc(dateStr) + '</div>' : '') + '</div></div>';
  const footer =
    '<div class="rp-foot">TaurEye · ' + esc(docType) +
    ' · Confidential — aggregated from public data &amp; models · educational only, not investment advice</div>';
  // Wrap the report content in a padded body so the hero can sit flush at the top.
  return withCss
    .replace(/<body[^>]*>/i, (m) => m + hero + '<main class="rp-body">')
    .replace(/<\/body>/i, '</main>' + footer + '</body>');
}

// ── Preview-modal intent store ───────────────────────────────────────────────
// A single <PdfPreview/> host (mounted in Shell) renders whatever document is
// pending. Any screen's Export button calls openPdfPreview(); the host shows the
// report and its Print / Save-as-PDF controls.
export type PdfDoc = { html: string; docType: string; fileName: string };

let pending: PdfDoc | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((l) => {
    try {
      l();
    } catch {
      /* a bad listener must not break the preview */
    }
  });
}

// Open the shared PDF preview for a report HTML document. Returns false only when
// there's no DOM (true native RN) so callers can fall back to a text share.
export function openPdfPreview(
  html: string,
  opts: { docType?: string; fileName?: string; dateStr?: string } = {},
): boolean {
  const doc = (globalThis as { document?: { body?: unknown } }).document;
  if (!doc?.body) return false;
  const docType = opts.docType || inferDocType(html);
  pending = {
    html: professionalShell(html, { docType, dateStr: opts.dateStr }),
    docType,
    fileName: opts.fileName || 'TaurEye-report',
  };
  emit();
  return true;
}

export function subscribePdf(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
export function peekPdf(): PdfDoc | null {
  return pending;
}
export function closePdfPreview(): void {
  pending = null;
  emit();
}

// Reports title themselves "TaurEye — <doc type> — <symbol>"; pull the doc type
// for the masthead when a caller doesn't pass one.
function inferDocType(html: string): string {
  const m = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
  if (!m) return 'Company report';
  const parts = m[1].split('—').map((s) => s.trim()).filter(Boolean);
  // ["TaurEye", "Institutional dossier", "SYM"] → "Institutional dossier"
  return parts.length >= 2 ? parts[1] : parts[0] || 'Company report';
}

// Back-compat entry point: existing callers keep calling printHtmlDocument; it
// now opens the shared preview. Returns true when the preview opened.
export function printHtmlDocument(html: string, onFail?: () => void): boolean {
  const ok = openPdfPreview(html);
  if (!ok) onFail?.();
  return ok;
}
