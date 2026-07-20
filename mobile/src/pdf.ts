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
  const CHROME =
    '<style>' +
    '@page{size:A4;margin:16mm 14mm 18mm}' +
    '*{-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
    'html,body{background:#fff}' +
    'body{margin:0 auto;padding:0 20px;max-width:820px;font-family:Georgia,"Times New Roman",serif;color:#1a1a1a}' +
    // masthead
    '.rp-head{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;' +
    'border-bottom:2.5px solid #0d2b4e;padding:6px 0 8px;margin:0 0 16px}' +
    '.rp-firm{font-family:"Helvetica Neue",Arial,sans-serif;font-weight:800;letter-spacing:.4px;font-size:16px;color:#0d2b4e}' +
    '.rp-firm i{color:#c8a24a;font-style:normal}' +
    '.rp-meta{text-align:right;font-family:"Helvetica Neue",Arial,sans-serif}' +
    '.rp-doc{font-size:9.5px;letter-spacing:1.6px;text-transform:uppercase;color:#64748b}' +
    '.rp-date{font-size:9.5px;color:#94a3b8;margin-top:2px}' +
    // section headers styled like a research note
    'h1{font-family:"Helvetica Neue",Arial,sans-serif;font-size:19px;color:#0d2b4e;margin:0 0 2px}' +
    'h2{font-family:"Helvetica Neue",Arial,sans-serif;font-size:12.5px;color:#0d2b4e;text-transform:uppercase;' +
    'letter-spacing:.6px;border-bottom:1px solid #d5dbe3;padding-bottom:3px;margin:16px 0 7px}' +
    'table,ul,h2,.rec,.verdictCard{page-break-inside:avoid}' +
    'thead{display:table-header-group}' +
    // confidential footer — repeats on every printed page
    '.rp-foot{display:none}' +
    '@media print{.rp-foot{display:block;position:fixed;bottom:0;left:0;right:0;text-align:center;' +
    'font-family:"Helvetica Neue",Arial,sans-serif;font-size:8px;letter-spacing:.5px;color:#94a3b8;' +
    'padding:3px 0;border-top:1px solid #e5e7eb;background:#fff}body{padding-bottom:14mm}}' +
    '</style>';
  const withCss = /<\/head>/i.test(html) ? html.replace(/<\/head>/i, CHROME + '</head>') : CHROME + html;
  const header =
    '<div class="rp-head"><div class="rp-firm">Taur<i>Eye</i></div>' +
    '<div class="rp-meta"><div class="rp-doc">' + esc(docType) + '</div>' +
    (dateStr ? '<div class="rp-date">' + esc(dateStr) + '</div>' : '') + '</div></div>';
  const footer =
    '<div class="rp-foot">TaurEye · ' + esc(docType) +
    ' · Confidential — aggregated from public data &amp; models · educational only, not investment advice</div>';
  return withCss
    .replace(/<body[^>]*>/i, (m) => m + header)
    .replace(/<\/body>/i, footer + '</body>');
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
