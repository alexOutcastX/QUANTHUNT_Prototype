// The disclaimer, as data.
//
// The header's DISCLAIMER control used to hand the browser to /legal.html — a
// separate document, which on the web replaced the app and in a standalone
// install had nowhere to go back to. The text lives here so the app can show
// it over whatever you were doing and give it back when you close it.
//
// /legal.html is still served (it is what a link from outside the app opens),
// and tests/test_legal_sheet.py parses that file and fails if a word of it
// differs from what is below — one wording, two renderings.
export type LegalBlock = { kind: 'p' | 'li'; text: string };
export type LegalSection = { title: string; blocks: LegalBlock[] };

export const LEGAL_TITLE = 'Disclaimer & Privacy';

export const LEGAL_SECTIONS: LegalSection[] = [
  {
    title: 'Not investment advice',
    blocks: [
      { kind: 'p', text: 'TaurEye is a research and screening tool. Everything it shows — signals, scores, backtests, probability models, comparison reports, relationship graphs and news — is a factual or statistical composite of public market data, presented for research and education. Nothing in this app is a recommendation to buy, sell or hold any security. Do your own research and/or consult a SEBI-registered investment adviser before acting.' },
    ],
  },
  {
    title: 'Data accuracy',
    blocks: [
      { kind: 'li', text: 'Market data comes from public sources (NSE, Yahoo Finance, screener.in, niftyindices.com, public RSS feeds) and may be delayed, incomplete or wrong. Always verify against your broker or the exchange.' },
      { kind: 'li', text: 'Relationship graphs labelled AI-generated are produced from an AI model\'s general knowledge, not verified regulatory filings. Treat them as indicative starting points for research.' },
      { kind: 'li', text: 'Backtests are hypothetical, ignore some real-world costs, and past performance does not predict future results.' },
    ],
  },
  {
    title: 'Privacy',
    blocks: [
      { kind: 'li', text: 'Your watchlists, portfolio entries, track list, filters and settings are stored only on your device (browser localStorage / app storage). The server never sees them.' },
      { kind: 'li', text: 'The server keeps short-lived caches of public market data and standard web-server logs (IP, path, timestamp) for reliability and abuse prevention. No accounts, no tracking pixels, no analytics, no ads.' },
      { kind: 'li', text: 'News links open third-party sites governed by their own policies.' },
    ],
  },
  {
    title: 'Trademarks',
    blocks: [
      { kind: 'p', text: 'NSE, BSE, TradingView, screener.in and any company names shown belong to their respective owners. TaurEye is independent and unaffiliated.' },
    ],
  },
];

export const LEGAL_NOTE =
  'TaurEye is open-source, self-hosted software provided "as is", without warranty of any kind. By using it you accept this disclaimer.';
