// CSV export for screener rows. On web this triggers a real file download; on
// native it opens the OS share sheet with the CSV text (no extra deps needed).
import { Platform, Share } from 'react-native';
import { Row, calcSignal } from './screener';

const FIELDS: { header: string; get: (r: Row) => unknown }[] = [
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

export function buildCsv(rows: Row[]): string {
  const head = FIELDS.map((f) => f.header).join(',');
  const body = rows.map((r) => FIELDS.map((f) => cell(f.get(r))).join(',')).join('\n');
  return head + '\n' + body + '\n';
}

export async function exportCsv(rows: Row[], name: string): Promise<void> {
  const csv = buildCsv(rows);
  const filename = `taureye-${name.toLowerCase().replace(/\s+/g, '-')}.csv`;
  if (Platform.OS === 'web') {
    // No DOM lib in this tsconfig — reach document via globalThis.
    const doc = (globalThis as { document?: any }).document;
    const url = (globalThis as { URL?: any }).URL;
    if (!doc || !url) return;
    const blob = new (globalThis as { Blob?: any }).Blob([csv], { type: 'text/csv' });
    const a = doc.createElement('a');
    a.href = url.createObjectURL(blob);
    a.download = filename;
    doc.body.appendChild(a);
    a.click();
    doc.body.removeChild(a);
    url.revokeObjectURL(a.href);
  } else {
    await Share.share({ title: filename, message: csv });
  }
}
