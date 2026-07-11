// Natural-language → screener filters. Ported from taureye's rule-based
// translator (deterministic, offline, no LLM): the query is split into clauses
// on "and"/commas, each clause resolves a field + comparator + value into our
// ActiveFilters shape, and the result reports what was understood vs ignored.
//
// Examples it handles:
//   "rsi below 30 and above 200 dma"
//   "pe under 20, roe above 15"
//   "up 3% on 2x volume"       "within 5% of 52 week high"
//   "large cap oversold"        "squeeze fired"
import { ActiveFilters, RangeVal } from './screener';
import { TE_SECTORS } from './screener';

export type ParsedScreen = {
  filters: ActiveFilters;
  recognized: string[];
  unrecognized: string[];
  matchedAny: boolean;
};

const NUM = String.raw`(-?\d[\d,]*(?:\.\d+)?)`;
const toNum = (s: string) => parseFloat(s.replace(/,/g, ''));

function normalize(t: string): string {
  return (' ' + t.toLowerCase() + ' ')
    .replace(/[≥]/g, '>=')
    .replace(/[≤]/g, '<=')
    .replace(/[–—]/g, '-')
    .replace(/\bpercent\b/g, '%')
    .replace(/\bpct\b/g, '%')
    .replace(/\bcrores?\b/g, 'cr')
    .replace(/\b(?:lacs?|lakhs)\b/g, 'lakh')
    .replace(/\brsi\s*\(?\s*14\s*\)?/g, 'rsi')
    .replace(/\bp\s*\/\s*e\b/g, 'pe')
    .replace(/\bp\s*\/\s*b\b/g, 'pb')
    .replace(/\bd\s*\/\s*e\b/g, 'de')
    .replace(/\bd\.?\s?m\.?\s?a\b/g, 'dma')
    // keep "between X and Y" intact through the clause splitter
    .replace(/\bbetween\s+(-?[\d,.]+)\s*%?\s+and\s+/g, 'between $1 to ')
    .replace(/\s+/g, ' ');
}

type Cmp = { min?: number; max?: number };

// "below 30", "between 5 and 20", ">= 2", "100 or more" → a min/max range
function parseCmp(s: string): Cmp | null {
  let m =
    s.match(new RegExp(String.raw`\bbetween\s+${NUM}\s*%?\s+(?:and|to|-)\s*${NUM}`)) ||
    s.match(new RegExp(String.raw`\bfrom\s+${NUM}\s*%?\s*(?:to|-)\s*${NUM}\b`));
  if (m) {
    const a = toNum(m[1]);
    const b = toNum(m[2]);
    return { min: Math.min(a, b), max: Math.max(a, b) };
  }
  m = s.match(new RegExp(NUM + String.raw`\s*%?\s*(?:\+|or (?:more|higher|above|greater))`));
  if (m) return { min: toNum(m[1]) };
  m = s.match(new RegExp(NUM + String.raw`\s*%?\s*or (?:less|lower|below|under|fewer)`));
  if (m) return { max: toNum(m[1]) };
  const OPS: [string, 'min' | 'max'][] = [
    [String.raw`(?:>=|at least|no less than|min(?:imum)?)`, 'min'],
    [String.raw`(?:<=|at most|no more than|max(?:imum)?|up to|within)`, 'max'],
    [String.raw`(?:>|above|over|greater than|more than|higher than|exceeds?|north of)`, 'min'],
    [String.raw`(?:<|below|under|less than|lower than|beneath|south of)`, 'max'],
  ];
  for (const [pat, kind] of OPS) {
    const mm = s.match(new RegExp(pat + String.raw`\s*(?:₹|rs\.?|inr)?\s*` + NUM));
    if (mm) return { [kind]: toNum(mm[1]) } as Cmp;
  }
  return null;
}

const scaleShares = (c: string, v: number) =>
  /\bcr\b/.test(c) ? v * 1e7 : /\blakh\b/.test(c) ? v * 1e5 : /\b(?:m|mn|million)\b/.test(c) ? v * 1e6 : /\b(?:k|thousand)\b/.test(c) ? v * 1e3 : v;
const scaleCap = (c: string, v: number) =>
  /\blakh\s*cr\b/.test(c) ? v * 1e5 : /\bthousand\s*cr\b/.test(c) ? v * 1e3 : v; // base unit ₹cr

// Numeric fields: pattern → our filter key (order = priority within a clause)
const FIELDS: { re: RegExp; key: string; label: string; scale?: (c: string, v: number) => number }[] = [
  { re: /\brsi\b/, key: 'rsi', label: 'RSI' },
  { re: /\b(?:williams|w%r|willr)\b/, key: 'willr', label: 'Williams %R' },
  { re: /\b(?:bollinger|boll|%b)\b/, key: 'bollb', label: 'Bollinger %B' },
  { re: /\bmacd\b/, key: 'macd', label: 'MACD hist' },
  { re: /\b(?:rel(?:ative)?\s*vol(?:ume)?|rvol)\b/, key: 'relvol', label: 'Rel volume' },
  { re: /\b(?:market\s*cap|mcap|m\s*cap|market capitali[sz]ation)\b/, key: 'market_cap_cr', label: 'Mkt cap (cr)', scale: scaleCap },
  { re: /\b(?:volume|vol|traded (?:qty|quantity|volume))\b/, key: 'volume', label: 'Volume', scale: scaleShares },
  { re: /\b(?:price|ltp|cmp|close|last (?:traded )?price)\b/, key: 'price', label: 'Price' },
  { re: /\b(?:change|day(?:'s)? change|daily change|% change|chg)\b/, key: 'chg', label: 'Day %chg' },
  { re: /\bbeta\b/, key: 'beta', label: 'Beta' },
  { re: /\b(?:pe|price to earnings)\b/, key: 'pe', label: 'P/E' },
  { re: /\bforward pe\b/, key: 'forward_pe', label: 'Fwd P/E' },
  { re: /\b(?:pb|price to book)\b/, key: 'pb', label: 'P/B' },
  { re: /\beps\b/, key: 'eps', label: 'EPS' },
  { re: /\b(?:dividend|div)\s*yield\b/, key: 'dividend_yield', label: 'Div yield' },
  { re: /\broce\b/, key: 'roce', label: 'ROCE' },
  { re: /\broe\b/, key: 'roe', label: 'ROE' },
  { re: /\b(?:de|debt.?(?:to.?)?equity|debt)\b/, key: 'debt_equity', label: 'D/E' },
  { re: /\bcurrent ratio\b/, key: 'current_ratio', label: 'Current ratio' },
];

// Spoken sector names → TE_SECTORS entries (matched only near the word "sector").
const SECTOR_ALIASES: [RegExp, string][] = [
  [/\bit\b|\btech\b|\bsoftware\b/, 'Information Technology'],
  [/\bpharma\b/, 'Pharmaceuticals'],
  [/\bbank(?:ing)?\b/, 'Banking'],
  [/\bauto(?:mobile)?s?\b/, 'Automobile'],
  [/\bmetals?\b|\bmining\b/, 'Metals & Mining'],
  [/\bhealth(?:care)?\b/, 'Healthcare'],
  [/\bfinanc(?:e|ial)s?\b|\bnbfc\b/, 'Financial Services'],
  [/\boil\b|\bgas\b/, 'Oil & Gas'],
  [/\binfra(?:structure)?\b/, 'Infrastructure'],
  [/\breal\s*estate\b|\brealty\b/, 'Realty'],
  [/\bchem(?:ical)?s?\b/, 'Chemicals'],
  [/\btextiles?\b/, 'Textiles'],
  [/\btelecom\b/, 'Telecom'],
  [/\bpower\b|\butilit/, 'Power'],
  [/\bfmcg\b|\bconsumer goods\b/, 'FMCG'],
  [/\benergy\b/, 'Energy'],
  [/\bmedia\b/, 'Media'],
  [/\bconstruction\b/, 'Construction'],
];

const fmt = (label: string, c: Cmp): string => {
  if (c.min != null && c.max != null) return `${label} ${c.min}…${c.max}`;
  if (c.min != null) return `${label} ≥ ${c.min}`;
  return `${label} ≤ ${c.max}`;
};

function mergeRange(filters: ActiveFilters, key: string, c: Cmp): void {
  const cur = (filters[key] as RangeVal) || {};
  filters[key] = {
    min: c.min != null ? c.min : cur.min,
    max: c.max != null ? c.max : cur.max,
  };
}

function matchClause(clause: string, filters: ActiveFilters, recognized: string[]): boolean {
  const c = ` ${clause.trim()} `;
  let hit = false;
  const add = (key: string, cmp: Cmp, label: string) => {
    mergeRange(filters, key, cmp);
    recognized.push(label);
    hit = true;
  };

  // toggles / idioms
  if (/\bsqueeze\b.*\b(?:fired?|releas)/.test(c) || /\bfired?\b.*\bsqueeze\b/.test(c)) {
    filters.sqzFire = true;
    recognized.push('Squeeze fired');
    hit = true;
  } else if (/\bsqueeze\b/.test(c)) {
    filters.sqzOn = true;
    recognized.push('Squeeze ON');
    hit = true;
  }
  if (/\bgolden\s*cross(?:over)?\b/.test(c)) {
    add('d50', { min: 0 }, 'Above 50 DMA');
    add('d200', { min: 0 }, 'Above 200 DMA (golden-cross proxy)');
  }
  if (/\boversold\b/.test(c)) add('rsi', { max: 30 }, 'Oversold (RSI < 30)');
  else if (/\boverbought\b/.test(c)) add('rsi', { min: 70 }, 'Overbought (RSI > 70)');

  // market-cap tiers
  if (/\bmega[\s-]*cap\b/.test(c)) add('market_cap_cr', { min: 100000 }, 'Mega cap');
  else if (/\blarge[\s-]*cap\b/.test(c)) add('market_cap_cr', { min: 20000 }, 'Large cap');
  else if (/\bmid[\s-]*cap\b/.test(c)) add('market_cap_cr', { min: 5000, max: 20000 }, 'Mid cap');
  else if (/\bsmall[\s-]*cap\b/.test(c)) add('market_cap_cr', { min: 500, max: 5000 }, 'Small cap');
  else if (/\bmicro[\s-]*cap\b/.test(c)) add('market_cap_cr', { max: 500 }, 'Micro cap');

  // sector — only when the word "sector" appears, so common words ("it",
  // "power") don't false-match; aliases map spoken names to TE_SECTORS.
  if (/\bsector\b/.test(c)) {
    const sec =
      TE_SECTORS.find((s) => c.includes(s.toLowerCase())) ||
      SECTOR_ALIASES.find(([re]) => re.test(c))?.[1];
    if (sec) {
      filters.sector = sec;
      recognized.push('Sector: ' + sec);
      hit = true;
    }
  }

  // up/down N%
  if (!/\bdma\b/.test(c)) {
    let m = c.match(new RegExp(String.raw`\b(?:up|gain(?:ed|ing|ers)?|rose|rising)\b(?:\s+(?:by|more than|over|at least))?\s*${NUM}\s*%?`));
    if (m) add('chg', { min: toNum(m[1]) }, `Up ≥ ${toNum(m[1])}%`);
    else {
      m = c.match(new RegExp(String.raw`\b(?:down|fell|fall(?:ing)?|declin\w+|dropp?\w+|los(?:ers|ing|t))\b(?:\s+(?:by|more than|over|at least))?\s*${NUM}\s*%?`));
      if (m) add('chg', { max: -toNum(m[1]) }, `Down ≥ ${toNum(m[1])}%`);
    }
  }

  // N× volume
  const rv = c.match(new RegExp(NUM + String.raw`\s*(?:x|times)\s*(?:the\s*)?(?:average\s*|avg\s*)?(?:rel(?:ative)?\s*)?vol(?:ume)?`));
  if (rv) add('relvol', { min: toNum(rv[1]) }, `Rel volume ≥ ${toNum(rv[1])}`);

  // 52-week range
  const near = /\b(?:near|close to|approaching|within|from|off)\b/;
  if (/\bhigh\b/.test(c) && /\b52|year\b/.test(c) && !/\bvolume\b/.test(c)) {
    const w = c.match(new RegExp(String.raw`within\s+${NUM}\s*%?`));
    if (w) add('pct_from_high', { min: -Math.abs(toNum(w[1])) }, `Within ${Math.abs(toNum(w[1]))}% of 52w high`);
    else if (near.test(c)) add('pct_from_high', { min: -5 }, 'Near 52w high');
  }
  if (/\blow\b/.test(c) && /\b52|year\b/.test(c)) {
    const w = c.match(new RegExp(String.raw`within\s+${NUM}\s*%?`));
    if (w) add('pct_from_low', { max: Math.abs(toNum(w[1])) }, `Within ${Math.abs(toNum(w[1]))}% of 52w low`);
    else if (near.test(c)) add('pct_from_low', { max: 10 }, 'Near 52w low');
  }

  // price vs a moving average (20 / 50 / 200)
  const sm = c.match(/\b(20|50|200)\s*(?:dma|sma|ema|ma|day (?:moving )?average|moving average)\b/);
  if (sm) {
    const key = 'd' + sm[1];
    const label = sm[1] + ' DMA';
    const pm = c.match(new RegExp(NUM + String.raw`\s*%\s*(above|below|over|under)`));
    if (pm) add(key, /below|under/.test(pm[2]) ? { max: -toNum(pm[1]) } : { min: toNum(pm[1]) }, `${toNum(pm[1])}% ${pm[2]} ${label}`);
    else if (/\b(?:below|under|lower than|beneath)\b/.test(c)) add(key, { max: 0 }, 'Below ' + label);
    else add(key, { min: 0 }, 'Above ' + label);
  }

  // generic: first known field + comparator (one per clause so the comparator
  // can't mis-bind to a second field; runs even after idiom hits so mixed
  // clauses like "banking sector pe below 15" keep the numeric part)
  for (const f of FIELDS) {
    if (!f.re.test(c) || filters[f.key] !== undefined) continue;
    const cmp = parseCmp(c);
    if (!cmp) break;
    const scaled: Cmp = {
      min: cmp.min != null ? (f.scale ? f.scale(c, cmp.min) : cmp.min) : undefined,
      max: cmp.max != null ? (f.scale ? f.scale(c, cmp.max) : cmp.max) : undefined,
    };
    add(f.key, scaled, fmt(f.label, scaled));
    break;
  }
  return hit;
}

export function parseNL(query: string): ParsedScreen {
  const filters: ActiveFilters = {};
  const recognized: string[] = [];
  const unrecognized: string[] = [];
  const text = normalize(query);
  const clauses = text.split(/\s*(?:,|;|\band\b|\bwith\b|\bplus\b)\s*/).filter((s) => s.trim());
  for (const clause of clauses) {
    if (!matchClause(clause, filters, recognized)) unrecognized.push(clause.trim());
  }
  return { filters, recognized, unrecognized, matchedAny: recognized.length > 0 };
}
