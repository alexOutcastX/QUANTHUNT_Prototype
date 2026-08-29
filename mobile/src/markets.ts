// The world's trading sessions, and what time it is inside one.
//
// Times come from Intl with a real IANA zone rather than a stored UTC offset:
// New York, London, Frankfurt and Sydney all shift for daylight saving, on
// four different weekends, and a fixed offset is wrong for weeks of the year
// in each of them — which for a market clock means telling someone the NYSE is
// shut when it has been open for an hour.
//
// HOLIDAYS ARE A DELIBERATE GAP everywhere except India. The NSE calendar is
// published, kept in holidays.py and served by /holidays, so India's status is
// the server's answer. For every other market this knows the weekday and the
// session hours and nothing else, so a foreign market closed for a national
// holiday still reads OPEN here. `holidaysKnown` marks the difference and the
// UI says so rather than implying a certainty it does not have.

export type Market = {
  key: string;
  /** The headline index, which is what the user picks by. */
  index: string;
  place: string;
  tz: string;
  /** Session bounds in minutes from local midnight. */
  open: number;
  close: number;
  /** Midday close, where the market takes one (Tokyo). */
  lunch?: [number, number];
  /**
   * Written abbreviation, for zones where Intl only offers a "GMT+5:30" form.
   * Only set on zones that do NOT observe daylight saving — anywhere that does
   * has two abbreviations a year, and Intl already picks the right one.
   */
  zoneLabel?: string;
  holidaysKnown?: boolean;
};

const hm = (h: number, m = 0) => h * 60 + m;

export const MARKETS: Market[] = [
  { key: 'IN', index: 'NIFTY 50', place: 'India', tz: 'Asia/Kolkata',
    open: hm(9, 15), close: hm(15, 30), zoneLabel: 'IST', holidaysKnown: true },
  { key: 'US', index: 'S&P 500', place: 'New York', tz: 'America/New_York',
    open: hm(9, 30), close: hm(16) },
  { key: 'UK', index: 'FTSE 100', place: 'London', tz: 'Europe/London',
    open: hm(8), close: hm(16, 30) },
  { key: 'DE', index: 'DAX', place: 'Frankfurt', tz: 'Europe/Berlin',
    open: hm(9), close: hm(17, 30) },
  { key: 'JP', index: 'Nikkei 225', place: 'Tokyo', tz: 'Asia/Tokyo',
    open: hm(9), close: hm(15), lunch: [hm(11, 30), hm(12, 30)], zoneLabel: 'JST' },
  { key: 'HK', index: 'Hang Seng', place: 'Hong Kong', tz: 'Asia/Hong_Kong',
    open: hm(9, 30), close: hm(16), lunch: [hm(12), hm(13)], zoneLabel: 'HKT' },
  { key: 'SG', index: 'STI', place: 'Singapore', tz: 'Asia/Singapore',
    open: hm(9), close: hm(17), zoneLabel: 'SGT' },
  { key: 'AU', index: 'ASX 200', place: 'Sydney', tz: 'Australia/Sydney',
    open: hm(10), close: hm(16) },
];

export const DEFAULT_MARKET = 'IN';

export function marketByKey(key: string): Market {
  return MARKETS.find((m) => m.key === key) || MARKETS[0];
}

export type ZonedNow = {
  /** 0 = Sunday. */
  day: number;
  minutes: number;
  time: string;
  date: string;
  /** Short zone name as the locale writes it — "IST", "GMT+8". */
  zone: string;
};

const WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Built once per zone and kept. The selected market's clock re-reads this
// every second; constructing a DateTimeFormat that often is real work for a
// value that only changes at a DST boundary.
const _fmts: Record<string, Intl.DateTimeFormat> = {};

function formatter(tz: string): Intl.DateTimeFormat | null {
  if (!(tz in _fmts)) {
    try {
      _fmts[tz] = new Intl.DateTimeFormat('en-GB', {
        timeZone: tz,
        hour12: false,
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZoneName: 'short',
      });
    } catch {
      return null;
    }
  }
  return _fmts[tz] || null;
}

/** What the clock on the wall says in `tz` right now. */
export function zonedNow(tz: string, now: Date = new Date(), zoneLabel?: string): ZonedNow {
  let parts: Record<string, string> = {};
  try {
    const fmt = formatter(tz);
    if (!fmt) throw new Error('no zone database');
    for (const p of fmt.formatToParts(now)) parts[p.type] = p.value;
  } catch {
    // No zone database (an old JS engine, or a stripped ICU build). The local
    // clock is wrong for every market but one, so say nothing rather than
    // state a time confidently in the wrong zone.
    parts = {};
  }
  if (!parts.hour) {
    return { day: now.getDay(), minutes: now.getHours() * 60 + now.getMinutes(),
      time: '--:--:--', date: '', zone: '' };
  }
  // 24h formatters write midnight as "24" in some locales.
  const hh = Number(parts.hour) % 24;
  const mm = Number(parts.minute);
  const day = Math.max(0, WEEK.indexOf(parts.weekday || ''));
  return {
    day,
    minutes: hh * 60 + mm,
    time: `${String(hh).padStart(2, '0')}:${parts.minute}:${parts.second}`,
    date: `${parts.weekday} ${parts.day} ${parts.month}`,
    // Prefer the written abbreviation where we have one and Intl only offers
    // an offset; keep Intl's answer where it has a real name (EDT vs EST), so
    // a DST switch is never misreported.
    zone: /^GMT/.test(parts.timeZoneName || '') && zoneLabel
      ? zoneLabel
      : parts.timeZoneName || '',
  };
}

export type MarketStatus = { open: boolean; note: string };

/**
 * Is `m` trading at `at`?
 *
 * `override` is the server's answer and wins outright — for India that is the
 * published NSE calendar, which this cannot derive.
 */
export function marketStatus(m: Market, at: ZonedNow, override?: boolean | null): MarketStatus {
  if (at.time === '--:--:--') return { open: false, note: 'clock unavailable' };
  const weekend = at.day === 0 || at.day === 6;
  if (override != null && m.holidaysKnown) {
    return { open: override, note: override ? 'Open' : weekend ? 'Weekend' : 'Closed' };
  }
  if (weekend) return { open: false, note: 'Weekend' };
  if (m.lunch && at.minutes >= m.lunch[0] && at.minutes < m.lunch[1]) {
    return { open: false, note: 'Midday break' };
  }
  if (at.minutes < m.open) return { open: false, note: 'Pre-open' };
  if (at.minutes > m.close) return { open: false, note: 'Closed' };
  return { open: true, note: 'Open' };
}

export function fmtSession(m: Market): string {
  const t = (mins: number) =>
    `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  return `${t(m.open)}–${t(m.close)}`;
}
