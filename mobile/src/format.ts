// One formatter for every number the app shows. Ends the drift between
// '₹1.83k cr', '₹34 Cr', '1,83,000' and bare floats: Indian digit grouping,
// explicit signs on changes, fixed decimal rules, and IST-aware timestamps.
// (See DESIGN.md — numbers are data: mono face + tabular figures via
// theme.numCell, values via these helpers.)

const NBSP = ' ';

function finite(v: unknown): v is number {
  return typeof v === 'number' && isFinite(v);
}

// Indian-grouped plain number. dp fixed when given, else up to 2.
export function num(v: number | null | undefined, dp?: number): string {
  if (!finite(v)) return '—';
  return v.toLocaleString('en-IN', {
    minimumFractionDigits: dp ?? 0,
    maximumFractionDigits: dp ?? 2,
  });
}

// A traded price in rupees: ₹ + Indian grouping, 2dp.
export function price(v: number | null | undefined): string {
  if (!finite(v)) return '—';
  return '₹' + v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// A crore-denominated figure (market cap, revenue, PAT, debt…): ₹X Cr, rolling
// up to lakh-crore for the giants. One rule everywhere.
export function crore(v: number | null | undefined): string {
  if (!finite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 100000) return '₹' + (v / 100000).toLocaleString('en-IN', { maximumFractionDigits: 2 }) + NBSP + 'L Cr';
  const dp = a >= 100 ? 0 : a >= 1 ? 1 : 2;
  return '₹' + v.toLocaleString('en-IN', { maximumFractionDigits: dp }) + NBSP + 'Cr';
}

// A percentage change: explicit sign, 1–2dp.
export function pct(v: number | null | undefined, dp = 2, sign = true): string {
  if (!finite(v)) return '—';
  const s = sign && v > 0 ? '+' : '';
  return s + v.toFixed(dp) + '%';
}

// Relative "as of" for data-freshness chips. <90s → 'now'.
export function asofRel(epochSec: number | null | undefined): string {
  if (!finite(epochSec) || epochSec <= 0) return '—';
  const d = Date.now() / 1000 - epochSec;
  if (d < 90) return 'now';
  if (d < 3600) return Math.round(d / 60) + 'm ago';
  if (d < 86400) return Math.round(d / 3600) + 'h ago';
  return Math.round(d / 86400) + 'd ago';
}

// Freshness tier for AsOfChip colouring.
export function asofTier(epochSec: number | null | undefined): 'fresh' | 'stale' | 'old' {
  if (!finite(epochSec) || epochSec <= 0) return 'old';
  const d = Date.now() / 1000 - epochSec;
  if (d < 24 * 3600) return 'fresh';
  if (d < 7 * 86400) return 'stale';
  return 'old';
}

// ── IST market clock ─────────────────────────────────────────────────────────
// NSE/BSE regular session: Mon–Fri 09:15–15:30 IST. Holiday-accurate state
// comes from the /holidays feed when a caller supplies it; without it this is
// weekday+time only (clearly labelled IST either way).
const IST_OFFSET_MIN = 330;

export function istNow(): { hh: number; mm: number; day: number; label: string } {
  // Shift the UTC epoch by the IST offset and read it back with the UTC
  // getters — timezone-independent on every device.
  const t = new Date(Date.now() + IST_OFFSET_MIN * 60000);
  const hh = t.getUTCHours();
  const mm = t.getUTCMinutes();
  return {
    hh,
    mm,
    day: t.getUTCDay(),
    label: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} IST`,
  };
}

export function marketState(isHoliday = false): { open: boolean; label: string } {
  const { hh, mm, day, label } = istNow();
  const mins = hh * 60 + mm;
  const weekday = day >= 1 && day <= 5;
  const inSession = mins >= 9 * 60 + 15 && mins <= 15 * 60 + 30;
  const open = weekday && inSession && !isHoliday;
  if (open) return { open, label: `LIVE · ${label}` };
  return { open, label: `CLOSED · ${label}` };
}
