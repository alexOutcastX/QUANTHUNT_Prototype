// The guide, as data.
//
// One long document rendered in one place, for the same reason legal.ts exists:
// content that lives in a component is content nobody can test, translate or
// re-render somewhere else. GuideSheet.tsx turns this into a sheet over
// whatever page you were on; tests/test_guide.py checks that every page the app
// actually has is described here, so a new screen cannot ship undocumented.
//
// Written for someone who has never used a screener. The market sections
// assume nothing — not what an index is, not what a moving average is — and
// the app sections say what a page is FOR before they say which button does
// what. Nothing here recommends a trade; where a number is easy to
// misinterpret, the guide says so rather than leaving it flattering.

export type GuideBlock =
  | { kind: 'p'; text: string }
  | { kind: 'li'; text: string }
  | { kind: 'term'; term: string; text: string }
  | { kind: 'note'; text: string };

export type GuideSection = { title: string; blocks: GuideBlock[] };
export type GuideChapter = {
  id: string;
  title: string;
  blurb: string;
  sections: GuideSection[];
};

export const GUIDE_TITLE = 'Guide';
export const GUIDE_INTRO =
  'How TaurEye works, what every page is for, and enough market background to '
  + 'read the numbers on them. Nothing here is advice.';

export const GUIDE_CHAPTERS: GuideChapter[] = [
  // ── 1 ────────────────────────────────────────────────────────────────────
  {
    id: 'start',
    title: 'Start here',
    blurb: 'What this is, what it is not, and a five-minute tour.',
    sections: [
      {
        title: 'What TaurEye is',
        blocks: [
          { kind: 'p', text: 'TaurEye turns the whole listed Indian market — roughly two thousand companies on the NSE and BSE — into something you can ask questions of. Instead of reading about one company at a time, you describe the kind of company you are looking for and the app returns every name that matches, today.' },
          { kind: 'p', text: 'A question might be "companies trading above their 200-day average, with return on equity over 15% and debt under half of equity". That is three conditions. The screener applies them to every symbol in your chosen universe and shows you the survivors, with the numbers that decided it.' },
          { kind: 'p', text: 'Everything else in the app exists to help you act on that list or check it: a page per company, a place to track what you own, paper trades to test an idea without money, alerts for when a price arrives, and a backtester to ask whether a rule would have worked before.' },
        ],
      },
      {
        title: 'What TaurEye is not',
        blocks: [
          { kind: 'p', text: 'It is not an adviser and it does not know your circumstances. Every score, signal and ranking is a calculation over public data, published so you can see how it was reached — not a suggestion to buy anything. The word "BUY" on a row is the output of an arithmetic rule described in this guide, not an opinion.' },
          { kind: 'p', text: 'It is not a broker. You cannot place an order here; nothing you do moves money in a real account.' },
          { kind: 'p', text: 'It is not a source of truth for prices. Data comes from public feeds that can be delayed, incomplete or simply wrong. Before acting on any number, check it against your broker or the exchange.' },
          { kind: 'note', text: 'The full disclaimer is in the DISCLAIMER link beside this one. Read it once.' },
        ],
      },
      {
        title: 'Five minutes, start to finish',
        blocks: [
          { kind: 'li', text: 'Open Screens. The console opens with no filters — the whole universe, nothing hidden.' },
          { kind: 'li', text: 'Pick a universe. UNIVERSE chooses which companies are in play: NIFTY 50 is the largest fifty, NIFTY 500 is a broad cross-section, and the smallcap and microcap lists are progressively smaller and riskier companies.' },
          { kind: 'li', text: 'Add a condition. Press "+ Add filter", choose a metric, an operator and a value. The table narrows as you type — there is no submit step for filters.' },
          { kind: 'li', text: 'Or start from a preset. PRESET SCANS holds ready-made screens with plain-English names; tap one to load its conditions as editable rows, so you can see exactly what it asked for and loosen it.' },
          { kind: 'li', text: 'Read a row. Tap a symbol to open that company: chart, fundamentals, ownership, filings and news in one page.' },
          { kind: 'li', text: 'Keep what is interesting. The star on a row adds it to your Watchlist under Desk.' },
        ],
      },
    ],
  },

  // ── 2 ────────────────────────────────────────────────────────────────────
  {
    id: 'market',
    title: 'Market basics',
    blurb: 'Exchanges, indices, sessions and what the numbers mean.',
    sections: [
      {
        title: 'The exchanges and the session',
        blocks: [
          { kind: 'p', text: 'Indian shares trade on two exchanges: the National Stock Exchange (NSE) and the Bombay Stock Exchange (BSE). Most companies are listed on both and the prices track each other closely. TaurEye uses NSE data unless a symbol only exists on the BSE.' },
          { kind: 'p', text: 'The regular session runs 09:15 to 15:30 IST, Monday to Friday, excluding exchange holidays. There is a pre-open auction from 09:00 to 09:15 that sets the opening price. Nothing trades at weekends.' },
          { kind: 'p', text: 'After the close the exchange publishes the day\'s official record — the bhavcopy — with the settled open, high, low, close and volume for every symbol. That file is what "EOD" (end of day) data means, and it is what most of this app is built on.' },
          { kind: 'note', text: 'Desk ▸ Holidays has the exchange calendar, and the clock in the header tells you whether the market is open right now.' },
        ],
      },
      {
        title: 'Indices, and why the universe matters',
        blocks: [
          { kind: 'p', text: 'An index is a named list of companies with a published rule for membership, plus a single number tracking their combined value. NIFTY 50 is the fifty largest and most traded NSE companies; the number you see quoted on the news is their weighted value.' },
          { kind: 'p', text: 'Indices matter here mainly as universes — the pool a screen runs over. The same filter gives very different answers depending on the pool:' },
          { kind: 'term', term: 'NIFTY 50 / 100 / 200 / 500', text: 'Progressively broader slices of the large and mid-sized market. NIFTY 500 covers most of the tradeable market by value and is the usual starting point.' },
          { kind: 'term', term: 'MIDCAP 100 / SMALLCAP 100 / MICROCAP 250', text: 'Smaller companies. More room to grow, thinner trading, bigger swings, and far more likely to have gaps in their published financials.' },
          { kind: 'term', term: 'Sectoral (BANK, IT, AUTO, PHARMA, FMCG, METAL)', text: 'One industry at a time. Useful when you want to compare like with like — a P/E of 30 means something different in IT than in metals.' },
          { kind: 'term', term: 'SME EMERGE / RECENT IPOS', text: 'Small and newly listed companies. Very thin trading, very little history, and most technical indicators need history to mean anything.' },
        ],
      },
      {
        title: 'Reading a price row',
        blocks: [
          { kind: 'term', term: 'LTP', text: 'Last traded price — what the most recent trade happened at. Outside market hours it is the closing price.' },
          { kind: 'term', term: '% CHG', text: 'Change against the previous session\'s close, in percent. This is what "the stock is up 2%" means.' },
          { kind: 'term', term: 'Volume', text: 'How many shares changed hands. High volume means many people acted; it says nothing about direction on its own.' },
          { kind: 'term', term: 'Relative volume (REL VOL)', text: 'Today\'s volume against this company\'s own recent average. 1.0x is a normal day, 3.0x means three times the usual interest. This is far more useful than raw volume, which mostly tells you how big the company is.' },
          { kind: 'term', term: 'Turnover', text: 'Volume multiplied by price — the rupee value traded. A better measure of liquidity than share count, because a thousand shares of a ₹5,000 stock is not the same as a thousand shares of a ₹5 one.' },
          { kind: 'term', term: '52W high / low', text: 'The highest and lowest price over the past year. "% from 52W high" tells you how far a stock has fallen from its best level, which is a rough measure of how out of favour it is.' },
          { kind: 'term', term: 'Market cap', text: 'Share price multiplied by the number of shares — what the market says the whole company is worth. Shown in crore (1 crore = 10 million).' },
        ],
      },
      {
        title: 'Liquidity, and why it decides what you can use',
        blocks: [
          { kind: 'p', text: 'Liquidity is how easily you can buy or sell without moving the price. A large company trades hundreds of crore a day and your order is invisible in it. A microcap might trade ₹20 lakh a day, where even a modest order pushes the price against you and there may be no buyer when you want out.' },
          { kind: 'p', text: 'This is the single most common way a good-looking screen turns into a bad experience. If a screen returns names you have never heard of at very low prices, check the turnover before anything else.' },
        ],
      },
    ],
  },

  // ── 3 ────────────────────────────────────────────────────────────────────
  {
    id: 'pages',
    title: 'The pages',
    blurb: 'What each destination is for.',
    sections: [
      {
        title: 'Home',
        blocks: [
          { kind: 'p', text: 'The wordmark in the top-left always returns here. Home is the state of the market right now: index levels, a breadth reading of how many stocks are rising against falling, the day\'s biggest movers, a sector heatmap, the news rail, and the session\'s bulk and block deals — large trades that are reported separately because their size is itself information.' },
          { kind: 'p', text: 'The index slider is customisable: add or remove the indices you actually watch and the choice is remembered.' },
        ],
      },
      {
        title: 'Screens',
        blocks: [
          { kind: 'p', text: 'The screening console, and the centre of the app. It answers "which companies match these conditions". The next chapter covers it in full.' },
          { kind: 'p', text: 'The SCREEN dropdown also holds purpose-built screens that are not general filters — Multibagger, Momentum, Penny and Patterns — each with its own ranking method rather than a list of conditions you set. Ranked buy setups used to sit here too; they have their own tab now, Ideas.' },
        ],
      },
      {
        title: 'Ideas',
        blocks: [
          { kind: 'p', text: 'A finished list rather than a tool for making one. Ideas ranks buy setups that the engines have already found — the Screens console asks "which companies match my conditions", Ideas answers "here is what the rules surfaced today, ordered by how strongly".' },
          { kind: 'p', text: 'Each row carries the confidence behind it and the reasoning that produced it, so you can disagree with a specific step rather than with the list. The sub-lists split by horizon: long-term buy candidates drawn from the Multibagger engine, and shorter-term setups from the momentum side.' },
          { kind: 'p', text: 'Tapping a sector in the home page heatmap opens this tab filtered to that sector, which is the quickest route from "banks look strong" to a list of specific names.' },
          { kind: 'p', text: 'The DMA crossovers tab is a different kind of list. It does not rank anything — it reports which moving-average pairs (9/20, 20/50, 50/100, 50/200) are still apart but closing on each other, nearest first, with a rough number of sessions to contact at the rate the gap has been shrinking. A pair that is close but widening has already crossed and is left out. It is a fact about two averages converging, not a signal.' },
          { kind: 'p', text: 'Each row also carries a modelled chance of the pair actually meeting within 5, 10 or 20 sessions, and the list can be sorted by it — or by how soon contact would happen — instead of by the raw gap. The three orders disagree often: a gap can be tiny and barely moving, or wide and closing fast. Tap a row for the two average levels, how the gap has moved over the week, the chance on every horizon, and the same actions as the other cards. The model assumes the gap wanders randomly, which it does not — both sides are smoothed — so read the number as a way of ranking these candidates against each other, not as a forecast for any one of them.' },
          { kind: 'note', text: 'Ranked is not recommended. The order is the output of the scoring rules described in this guide, and every name on the list still needs your own work.' },
        ],
      },
      {
        title: 'Desk',
        blocks: [
          { kind: 'p', text: 'Your own workspace. Everything here is about you rather than about the market. The sections live behind the ☰ menu beside the DESK title.' },
          { kind: 'term', term: 'Home', text: 'Upcoming corporate actions — dividends, bonuses, splits, rights issues, buybacks and IPOs — plus market holidays, the methodology behind the app\'s calculations, the community room, and announcements from the developer.' },
          { kind: 'p', text: 'Every corporate action carries three dates, and the calendar names each one because the difference decides whether you are paid. They happen in this order:' },
          { kind: 'term', term: 'Announced', text: 'The day the company told the exchange. For a dividend this is the filing that sets the record date, made anything from a week to two months ahead. It is shown where NSE publishes it and left blank where it does not — the corporate-actions feed itself carries no announcement date, so it is joined from the filings feed, and small companies that file nothing simply have none.' },
          { kind: 'term', term: 'Ex-date', text: 'The first day the stock trades WITHOUT the entitlement. To receive the dividend you must own the shares before this day — buying on the ex-date is too late. The price typically opens lower by roughly the dividend, which is not a fall to react to. This is the date every row is filed and sorted under.' },
          { kind: 'term', term: 'Record date', text: 'The day the company reads its share register to decide who gets paid. It falls on or just after the ex-date, and the gap between them is settlement: a purchase made before the ex-date is in your name by the record date. It is the ex-date, not this one, that you act on.' },
          { kind: 'term', term: 'Watchlist', text: 'Symbols you starred, with the price when you added them and the move since. This is how you keep an idea without acting on it.' },
          { kind: 'term', term: 'Portfolio', text: 'What you actually hold, with live profit and loss, and a Risk tab measuring the concentration and drawdown of that specific basket.' },
          { kind: 'term', term: 'Paper trades', text: 'A simulator. Log a setup with an entry, target and stop, and the app tracks it as if it were real — including the engines\' own historic track record and how well-calibrated their confidence has been.' },
          { kind: 'term', term: 'Alerts', text: 'Server-side watches on price, percentage move or RSI. They are evaluated even when the app is closed, so you are told when the level arrives rather than having to look.' },
          { kind: 'term', term: 'Reports', text: 'A full company report — valuation against sector medians, cash flow, ownership, filings — printable as one document.' },
          { kind: 'term', term: 'Shareholders', text: 'Who owns a company: promoters, institutions, the public, and the relationships between entities, with every link cited.' },
          { kind: 'term', term: 'Calculator', text: 'Position sizing, SIP and CAGR maths, so you do not have to leave for a spreadsheet.' },
          { kind: 'term', term: 'Account', text: 'One page: credits, the daily bonus, referrals, your plan, sign-in and cloud sync, and account deletion.' },
        ],
      },
      {
        title: 'Terminal',
        blocks: [
          { kind: 'p', text: 'A workspace rather than a page. The Graph section draws a company at the centre of its relationships — suppliers, customers, group companies, investors — and lets you walk outward from one name to the next, with a floating multi-tab window for charts and fundamentals alongside.' },
          { kind: 'p', text: 'The Backtest section, reached by the switch in the terminal\'s header, tests a rule against history. It has its own chapter below.' },
        ],
      },
      {
        title: 'A company page',
        blocks: [
          { kind: 'p', text: 'Tapping any symbol anywhere opens it: chart with drawing tools, the technical readings, fundamentals and their history, ownership, corporate actions, filings and news. Search in the header reaches any company by name or symbol from anywhere in the app.' },
        ],
      },
    ],
  },

  // ── 4 ────────────────────────────────────────────────────────────────────
  {
    id: 'screener',
    title: 'Using the screener',
    blurb: 'Universes, filters, operators, presets and exports.',
    sections: [
      {
        title: 'The three controls at the top',
        blocks: [
          { kind: 'term', term: 'SCREEN', text: 'Which kind of screen. "Custom" is the filter builder — the one you will use most. The others are purpose-built rankings with their own logic.' },
          { kind: 'term', term: 'UNIVERSE', text: 'Which companies are in play. You can select more than one; the results are the union, de-duplicated.' },
          { kind: 'term', term: 'PRESET SCANS', text: 'Ready-made screens. Picking one loads its conditions as ordinary editable rows — nothing is hidden, and you can loosen or delete any of them. Picking it again removes them.' },
        ],
      },
      {
        title: 'Building a filter',
        blocks: [
          { kind: 'p', text: 'Each row is a metric, an operator and a value: "RSI < 30", "Market Cap > 5000". Add as many as you need. The table updates as you type — there is no apply step.' },
          { kind: 'p', text: 'Rows combine left to right, each with its own AND or OR, and there is no bracketing. "A AND B OR C" is read as "(A AND B) OR C" — in the order written, not by precedence. Keep chains simple, or build them in the order you mean.' },
          { kind: 'term', term: 'Operators', text: '> and < are strict comparisons. "between" takes two values and includes both ends. A toggle filter is simply on or off. A select filter matches text, case-insensitively.' },
          { kind: 'p', text: 'You can also describe a screen in plain English in the box at the top — "golden crossover", "rsi below 30 and above 200 dma" — and press Build. It turns what it understood into the same editable rows, so you can check its reading before trusting it.' },
        ],
      },
      {
        title: 'The ·f mark, and empty columns',
        blocks: [
          { kind: 'p', text: 'A metric marked ·f is a fundamental — it comes from company filings rather than from price history, and it is fetched separately. Those arrive a moment after the price data, so a screen with fundamental conditions settles slightly later.' },
          { kind: 'p', text: 'Some companies have no value for some fields. Coverage is honest rather than filled in: ROCE and current ratio reach well under a tenth of the market, while price, P/E, book value and return on equity reach almost all of it. The status line under the toolbar tells you how many rows carry the fields you are filtering on.' },
          { kind: 'note', text: 'A row with no value for a filtered field does not silently pass. It is excluded from that condition rather than counted as a match.' },
        ],
      },
      {
        title: 'Run, and what is live',
        blocks: [
          { kind: 'p', text: 'Filters apply instantly, so "▶ Run screen" does not apply them — it re-fetches. The universe, its prices and the technical readings are rebuilt from the server, which is what you want after leaving the screen open for a while, or when the market has moved.' },
          { kind: 'p', text: 'The status line says where the numbers came from: a settled close with its date, or live quotes. If it says "from the EOD snapshot", the table was filled from the prebuilt end-of-day payload — complete instantly, and as of that close.' },
        ],
      },
      {
        title: 'Columns, sorting, exporting and sharing',
        blocks: [
          { kind: 'li', text: 'Columns chooses which fields the table shows and in what order. Any column you can filter on, you can display.' },
          { kind: 'li', text: 'Tapping a column header sorts by it; tapping again reverses. The signal column sorts BUY, NEUTRAL, SELL.' },
          { kind: 'li', text: 'Export writes the visible columns to CSV, Excel or PDF.' },
          { kind: 'li', text: 'Save screen keeps a screen under a name. Share produces a link that reproduces it exactly, filters and universe included — a link someone sends you overrides everything, including your own default.' },
        ],
      },
    ],
  },

  // ── 5 ────────────────────────────────────────────────────────────────────
  {
    id: 'technicals',
    title: 'The technical readings',
    blurb: 'What each indicator measures, and where it misleads.',
    sections: [
      {
        title: 'How to hold all of this',
        blocks: [
          { kind: 'p', text: 'Every indicator below is arithmetic on past prices. None of them knows anything about the company, its industry or the news. They are useful for describing what a price has been doing in a compact way, and they are not predictions. Any single one, used alone, will be wrong often.' },
        ],
      },
      {
        title: 'Moving averages',
        blocks: [
          { kind: 'p', text: 'A moving average is the mean closing price over the last N days, recalculated daily. The 200-day average is a slow measure of the long trend; the 20-day is a fast one. Price above a rising long average is the common shorthand for "in an uptrend".' },
          { kind: 'note', text: 'In this app the columns d20, d50, d150 and d200 are the DISTANCE of the price from that average, as a percentage — not the average itself. So "price above the 20-day average" is simply "d20 > 0", and −8 means the price sits 8% below it.' },
          { kind: 'term', term: 'Golden cross / death cross', text: 'The 50-day average crossing above (golden) or below (death) the 200-day. Widely watched, and by construction it always arrives well after the move that caused it.' },
        ],
      },
      {
        title: 'Momentum and range',
        blocks: [
          { kind: 'term', term: 'RSI (14)', text: 'Relative Strength Index: a 0–100 measure of how one-sided recent moves have been. Below 30 is conventionally "oversold", above 70 "overbought". A strong trend can hold RSI above 70 for months, so it is a description, not a signal to fade.' },
          { kind: 'term', term: 'MACD histogram', text: 'The gap between two moving averages of price, and a smoothed version of itself. Positive and rising means the short trend is pulling away upward; crossings are what people trade.' },
          { kind: 'term', term: 'Bollinger %B', text: 'Where the price sits inside a band drawn two standard deviations either side of a moving average. 0 is the lower band, 1 the upper, and values outside that range mean an unusually large move relative to this stock\'s own recent volatility.' },
          { kind: 'term', term: 'Williams %R', text: 'Position within the recent high-low range, from 0 (at the top) to −100 (at the bottom). Similar in spirit to RSI, faster to react.' },
          { kind: 'term', term: 'Squeeze (on / fired)', text: 'Volatility compression — the Bollinger bands narrowing inside the Keltner channels. "On" means the range has gone quiet, which often precedes a large move; "fired" means it has just broken out. It says nothing about which direction.' },
          { kind: 'term', term: 'Beta', text: 'How much this stock has moved for a 1% move in the index. Above 1 is more volatile than the market, below 1 less.' },
        ],
      },
      {
        title: 'Candlestick patterns',
        blocks: [
          { kind: 'p', text: 'A candle summarises one day: open, high, low and close. The named patterns — hammer, engulfing, doji, morning and evening star, three white soldiers — are recurring shapes in one to three candles that traders associate with hesitation or reversal.' },
          { kind: 'p', text: 'Treat them as a way to find days worth looking at, not as evidence. They are common, they are frequently meaningless, and their reputation rests on far less testing than their popularity suggests.' },
        ],
      },
      {
        title: 'The BUY / SELL / NEUTRAL signal',
        blocks: [
          { kind: 'p', text: 'The signal column is a tally, not a view. Each reading contributes points: RSI extremes, the price\'s position relative to each moving average, Williams %R, Bollinger %B, the squeeze state, and a volume-surge confirmation. Bullish points and bearish points are summed, and the difference is bucketed — three or more net bullish reads BUY, two or more net bearish reads SELL, anything between reads NEUTRAL.' },
          { kind: 'p', text: 'That is the whole method. It is transparent so you can disagree with it, and it inherits every weakness of the indicators it counts. It is not advice, and the same rule applied to a different day would give a different answer.' },
        ],
      },
    ],
  },

  // ── 6 ────────────────────────────────────────────────────────────────────
  {
    id: 'fundamentals',
    title: 'The fundamentals',
    blurb: 'What the company numbers mean, and their limits.',
    sections: [
      {
        title: 'Valuation',
        blocks: [
          { kind: 'term', term: 'P/E', text: 'Price divided by earnings per share — how many rupees you pay for one rupee of annual profit. Only comparable within an industry, and meaningless when earnings are negative.' },
          { kind: 'term', term: 'Forward P/E', text: 'The same ratio against expected future earnings rather than reported ones. It embeds someone\'s forecast, so it is an opinion wearing a number\'s clothes.' },
          { kind: 'term', term: 'P/B', text: 'Price against book value — the accounting value of what the company owns less what it owes. Meaningful for banks and asset-heavy businesses, much less so for companies whose value is people or brands.' },
          { kind: 'term', term: 'PEG', text: 'P/E divided by the earnings growth rate. The idea is that a fast-growing company deserves a higher P/E; a PEG near or below 1 is the classic "growth at a fair price" test. Where the feed does not supply it, the app computes it from the P/E and growth it does have, and it is left blank when growth is zero or negative, because the ratio has no meaning there.' },
          { kind: 'term', term: 'Dividend yield', text: 'The annual dividend as a percentage of the price. Most Indian large caps pay between nothing and about 3%. A figure far above that is usually a special dividend or a data error, not an income opportunity.' },
        ],
      },
      {
        title: 'Quality and safety',
        blocks: [
          { kind: 'term', term: 'ROE', text: 'Return on equity — profit as a percentage of shareholders\' money. A durable ROE above about 15% is the usual marker of a good business, though heavy borrowing can flatter it.' },
          { kind: 'term', term: 'ROCE', text: 'Return on capital employed — profit against all the capital in the business, debt included, so it is harder to flatter than ROE. This app can only supply it for a small minority of companies, so a screen requiring it will return very few names.' },
          { kind: 'term', term: 'Debt / Equity', text: 'Borrowings against shareholders\' funds, as a ratio: 0.5 means fifty paise of debt per rupee of equity. Below 1 is generally comfortable outside finance; banks are excluded from this reasoning entirely, because borrowing is their business.' },
          { kind: 'term', term: 'Current ratio', text: 'Short-term assets against short-term liabilities — whether the next year\'s bills are covered. Coverage for this field is thin.' },
        ],
      },
      {
        title: 'Growth and cash',
        blocks: [
          { kind: 'term', term: 'Revenue / earnings growth', text: 'The change against the same period a year earlier, in percent. Year-on-year rather than sequential, so seasonal businesses are compared like with like.' },
          { kind: 'term', term: 'Operating cash flow', text: 'Cash actually generated by the business, as opposed to accounting profit. The two can diverge for long stretches, and when they do the cash number is usually the more honest one.' },
          { kind: 'term', term: 'Free cash flow', text: 'Operating cash flow less capital spending — what is left over after keeping the business running. Persistent negative free cash flow means the company depends on outside money.' },
          { kind: 'term', term: 'Cash conversion', text: 'How much of reported profit turns into cash. Consistently low conversion is worth a second look at the accounts.' },
        ],
      },
      {
        title: 'Comparing against the sector',
        blocks: [
          { kind: 'p', text: 'The "vs sector" filters express a company\'s P/E, P/B, ROE or dividend yield as a percentage away from the median for its sector. A P/E of 30 tells you little on its own; a P/E 40% below the median for its industry tells you something. Sector medians are computed across the cached fundamentals universe and refreshed with it.' },
        ],
      },
    ],
  },

  // ── 7 ────────────────────────────────────────────────────────────────────
  {
    id: 'backtest',
    title: 'Backtesting',
    blurb: 'Testing a rule against history, and what that cannot tell you.',
    sections: [
      {
        title: 'What it does',
        blocks: [
          { kind: 'p', text: 'A backtest takes an entry rule, an exit rule and a universe, replays them day by day over historical bars, and reports what the resulting trades would have produced: return, win rate, largest drawdown, and the equity curve.' },
          { kind: 'p', text: 'It is in the Terminal, on the switch beside the terminal\'s own title. Each run is charged to your credit balance, because each one is a real amount of computation.' },
        ],
      },
      {
        title: 'Costs are part of the result',
        blocks: [
          { kind: 'p', text: 'The engine applies the Indian charge schedule — brokerage, STT, exchange transaction charges, the SEBI turnover fee, stamp duty and GST — plus a configurable slippage per side. A backtest that ignores these can turn a losing strategy into a winning one on paper, particularly for anything that trades often.' },
        ],
      },
      {
        title: 'What a backtest cannot tell you',
        blocks: [
          { kind: 'li', text: 'It cannot tell you the rule will work next year. It describes one path history happened to take.' },
          { kind: 'li', text: 'It cannot see the companies that were delisted or went to zero, if they are absent from the universe today. That absence flatters every result.' },
          { kind: 'li', text: 'It cannot model whether your order would actually have filled at that price in a thinly traded name.' },
          { kind: 'li', text: 'It will reward you for testing many variants until one looks good. A rule found that way usually describes the past rather than the market.' },
        ],
      },
    ],
  },

  // ── 8 ────────────────────────────────────────────────────────────────────
  {
    id: 'plans',
    title: 'Plans and credits',
    blurb: 'What each tier includes and what credits are for.',
    sections: [
      {
        title: 'The tiers',
        blocks: [
          { kind: 'term', term: 'Free', text: 'Quotes, charts, news, the sector heatmap and the full stock universe. Enough to follow the market and look up any company.' },
          { kind: 'term', term: 'Pro', text: 'Adds the screeners, chart patterns, recommendations, the watchlist and the portfolio — the tools for finding and tracking names.' },
          { kind: 'term', term: 'Max', text: 'Adds the terminal and its backtests, company reports, alerts and exports.' },
        ],
      },
      {
        title: 'What credits are, and are not',
        blocks: [
          { kind: 'p', text: 'Credits meter how much you use of a feature. They never buy the feature itself: if your plan does not include something, no balance unlocks it, and the app will say so rather than charging you. Your plan decides what you can open; credits decide how much of it you use.' },
          { kind: 'p', text: 'Metered actions are company reports, backtest runs, exports, and price alerts beyond the first five. Everything you look at repeatedly — quotes, charts, news, your watchlist, the screener itself — is never metered.' },
          { kind: 'p', text: 'Credits arrive from the daily check-in, from streaks, from referring someone, and with a paid plan. They are in Desk ▸ Account, along with what each action costs.' },
        ],
      },
    ],
  },

  // ── 9 ────────────────────────────────────────────────────────────────────
  {
    id: 'data',
    title: 'Where the data comes from',
    blurb: 'Sources, freshness, and why a number may be missing.',
    sections: [
      {
        title: 'Sources',
        blocks: [
          { kind: 'p', text: 'Prices, index membership, corporate actions and shareholding come from the exchanges\' own public feeds. Fundamentals come from public financial data providers and filings. News comes from public RSS feeds. Nothing here is proprietary, and everything is subject to the publisher being right.' },
        ],
      },
      {
        title: 'Freshness',
        blocks: [
          { kind: 'p', text: 'The screener is built from a prebuilt end-of-day payload, rebuilt twice daily — at 16:00 IST, once the close has settled, and at 02:00 IST for the overnight pass. That is why the table fills immediately rather than assembling itself in front of you.' },
          { kind: 'p', text: 'During market hours live quotes are fetched behind that and merged over the closes, so prices catch up a moment after the table appears. The status line always says which you are looking at.' },
          { kind: 'p', text: 'Technical readings are computed from daily bars, so they change once a day. Fundamentals change when a company files.' },
        ],
      },
      {
        title: 'Why a cell is empty',
        blocks: [
          { kind: 'li', text: 'The company has not filed that figure, or the provider does not carry it. ROCE and current ratio are the common cases.' },
          { kind: 'li', text: 'The company is too new or too thinly traded for an indicator that needs a year of history.' },
          { kind: 'li', text: 'The figure would be meaningless — a P/E for a loss-making company, a PEG where earnings are shrinking.' },
          { kind: 'p', text: 'An empty cell is shown as a dash rather than a zero, deliberately. Zero is a value; missing is not, and treating one as the other is how a screen quietly returns the wrong companies.' },
        ],
      },
    ],
  },
];

export const GUIDE_NOTE =
  'TaurEye is a research and screening tool. Nothing in this guide or in the app '
  + 'is a recommendation to buy, sell or hold any security. Market data may be '
  + 'delayed, incomplete or wrong — verify against your broker or the exchange '
  + 'before acting. See the DISCLAIMER for the full terms.';
