// ⓘ button + popup card explaining a strategy, filter or valuation model.
//
// One component, one body of copy, used in both places the explanations are
// needed — the screener's filter picker and the dossier's valuation section —
// so the two can't drift into saying different things about the same method.
//
// The copy is deliberately plain and says what each measure CANNOT do as well
// as what it can. A screener filter whose meaning you have to guess is a filter
// that gets used wrongly.
import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { theme } from '../theme';

export type InfoEntry = {
  title: string;
  /** One line: what it measures. */
  what: string;
  /** How to read the number — what high and low actually mean. */
  read: string;
  /** The honest limitation. Every entry has one. */
  limit: string;
};

// Keyed by the screener filter key, or by a valuation method name.
export const INFO: Record<string, InfoEntry> = {
  // ---- valuation models (shared with the dossier) ----
  'Discounted cash flow': {
    title: 'Discounted cash flow (DCF)',
    what: 'Projects free cash flow forward, then discounts it back to what it is worth today.',
    read: 'A value above the price suggests the market is asking less than the cash the business should produce. Below, and you are paying ahead of it.',
    limit: 'Extremely sensitive to the growth and discount rates. Small changes to either move the answer a lot, which is why the assumptions are printed beside it.',
  },
  'Graham number': {
    title: 'Graham number',
    what: 'Benjamin Graham’s ceiling for a defensive buyer: sqrt(22.5 × EPS × book value per share).',
    read: 'A price below it is the classic margin of safety. Most quality businesses trade well above it.',
    limit: 'Assumes no growth and leans on book value, so it systematically undervalues asset-light and fast-growing companies. Treat it as a floor, not a target.',
  },
  'Earnings power value': {
    title: 'Earnings power value (EPV)',
    what: 'Capitalises current earnings at the discount rate, assuming the business never grows again.',
    read: 'What you are paying for today’s earnings alone. The gap between price and EPV is what the market is paying for the future.',
    limit: 'Ignores growth entirely by design. A high-quality compounder should trade above it — that is not a sell signal.',
  },
  'Dividend discount': {
    title: 'Dividend discount model',
    what: 'Values the stock as the current dividend growing forever, discounted back.',
    read: 'Useful for steady, mature payers where the dividend is the main return.',
    limit: 'Meaningless for low or no dividend payers, so it is skipped below a 0.5% yield. Breaks down entirely if assumed growth approaches the discount rate.',
  },

  // ---- valuation filters ----
  earnings_yield: {
    title: 'Earnings yield',
    what: 'Earnings per share divided by price — the inverse of P/E, expressed as a percentage.',
    read: 'Directly comparable to a bond yield. Above the ~7% government bond, the earnings are competitive with risk-free income.',
    limit: 'Uses trailing earnings. A one-off gain flatters it, and a cyclical peak makes an expensive stock look cheap.',
  },
  graham_upside: {
    title: 'Upside vs Graham number',
    what: 'How far the price sits below (positive) or above (negative) the Graham number.',
    read: 'Positive means it trades under a defensive buyer’s ceiling — rare, and worth a look.',
    limit: 'Most good businesses screen negative here. Use it to find deep value, not to reject quality.',
  },
  epv_upside: {
    title: 'Upside vs earnings power',
    what: 'How far the price sits from the value of current earnings with no growth assumed.',
    read: 'Positive means you are paying nothing for future growth. Strongly negative means most of the price is a bet on the future.',
    limit: 'Says nothing about whether that bet is reasonable — pair it with the growth filters.',
  },
  ddm_upside: {
    title: 'Upside vs dividend model',
    what: 'Price against the dividend grown forever and discounted back.',
    read: 'Only meaningful for genuine dividend payers.',
    limit: 'Blank for anything yielding under 0.5%, and highly sensitive to the growth rate assumed.',
  },
  below_graham: {
    title: 'Trading below Graham number',
    what: 'A yes/no version of the Graham screen.',
    read: 'Classic deep-value filter. Expect very few matches in a rising market.',
    limit: 'Cheapness is not quality — check debt and earnings consistency before acting on it.',
  },
  below_epv: {
    title: 'Trading below earnings power',
    what: 'Price is under the no-growth value of current earnings.',
    read: 'The market is pricing decline, or has not noticed the earnings.',
    limit: 'Often correct about the decline. Treat a hit as a question, not an answer.',
  },
  pe_vs_sector: {
    title: 'P/E vs sector median',
    what: 'How far this P/E sits from the median of its sector, in percent.',
    read: 'Negative is cheaper than peers. This is the context a raw P/E lacks — 28× is dear for a bank and ordinary for a consumer brand.',
    limit: 'Medians come from companies scraped into the cache, not the whole index, and need at least 5 in a sector. Blank means too few peers.',
  },
  pb_vs_sector: {
    title: 'P/B vs sector median',
    what: 'Price-to-book against the sector median.',
    read: 'Negative is cheaper on assets than peers.',
    limit: 'Book value means little for asset-light businesses. Same peer-sample caveat as P/E.',
  },
  roe_vs_sector: {
    title: 'ROE vs sector median',
    what: 'Return on equity against the sector median.',
    read: 'Positive means it earns more on shareholder capital than its peers — a quality signal, not a cheapness one.',
    limit: 'Leverage inflates ROE. Read it beside debt/equity.',
  },
  dy_vs_sector: {
    title: 'Dividend yield vs sector',
    what: 'Dividend yield against the sector median.',
    read: 'Positive means it pays out more than peers.',
    limit: 'An unusually high yield often signals a falling price rather than a generous payout.',
  },

  // ---- cash flow ----
  fcf_cr: {
    title: 'Free cash flow',
    what: 'Operating cash flow minus capital expenditure — cash left after keeping the business running.',
    read: 'The money genuinely available to pay down debt, pay dividends or reinvest. Sustained positive FCF is the strongest single sign a business funds itself.',
    limit: 'One year only, from the latest annual filing. A heavy investment year can push a healthy company negative.',
  },
  ocf_cr: {
    title: 'Operating cash flow',
    what: 'Cash generated by the core business before any capital spending.',
    read: 'Should broadly track profit over time. Persistent profit without operating cash is the classic warning sign.',
    limit: 'Says nothing about how much must be reinvested to stay competitive — read it beside capex.',
  },
  capex_cr: {
    title: 'Capital expenditure',
    what: 'Cash spent on property, plant and equipment during the year.',
    read: 'Low capex relative to operating cash flow means the business converts more of what it earns into free cash.',
    limit: 'Underspending flatters free cash flow short-term and can starve the business. Heavy capex may be a good investment, not a problem.',
  },
  fcf_yield_pct: {
    title: 'Free-cash-flow yield',
    what: 'Free cash flow divided by market capitalisation.',
    read: 'What the business throws off in cash, as a percentage of what you pay for it. Directly comparable to a bond yield, and harder to manipulate than earnings yield.',
    limit: 'Based on a single year. A one-off working-capital swing distorts it.',
  },
  cash_conversion_pct: {
    title: 'Cash conversion (OCF / PAT)',
    what: 'Operating cash flow as a percentage of net profit.',
    read: 'Above 100% means the company collects more cash than it books as profit — usually a sign of quality. Well under 100% means profit is not turning into cash.',
    limit: 'Volatile year to year, especially for companies with lumpy receivables. Read a trend, not one figure.',
  },
  dcf_upside: {
    title: 'Upside vs DCF',
    what: 'How far the price sits from a ten-year discounted-cash-flow valuation built on the filed free cash flow.',
    read: 'Positive means the model values the business above its price at the stated growth and discount rates.',
    limit: 'Highly sensitive to those two rates. Treat it as one opinion among four, not the answer.',
  },

  // ---- strategy filters ----
  minervini: {
    title: 'Minervini Trend Template',
    what: 'Mark Minervini’s eight-point check that a stock is in a confirmed stage-2 uptrend — price above rising 50/150/200-day averages, well off its low, near its high.',
    read: 'A pass means the trend structure is intact. It is a filter for what to consider, not a timing signal.',
    limit: 'Purely technical. It knows nothing about valuation or the business, and it lags a new trend by design.',
  },
  dma200_rising: {
    title: '200-DMA rising',
    what: 'The 200-day moving average is sloping upward.',
    read: 'The simplest single test of a long-term uptrend.',
    limit: 'Slow. It turns well after a top and well after a bottom.',
  },
  golden_cross: {
    title: 'Golden cross',
    what: 'The 50-day average has crossed above the 200-day.',
    read: 'A widely watched confirmation that momentum has turned up.',
    limit: 'Well known and therefore often already priced in. Prone to whipsaws in range-bound markets.',
  },
  death_cross: {
    title: 'Death cross',
    what: 'The 50-day average has crossed below the 200-day.',
    read: 'The bearish mirror of the golden cross.',
    limit: 'Frequently marks a low rather than predicting further falls.',
  },
  squeeze: {
    title: 'Volatility squeeze',
    what: 'Bollinger Bands have contracted inside the Keltner channel — volatility has compressed.',
    read: 'Compression tends to precede expansion. "Fired" means the range has broken.',
    limit: 'Tells you a move is likely, not which way it will go.',
  },
};

export function InfoDot({ id, size = 16 }: { id: string; size?: number }) {
  const [open, setOpen] = useState(false);
  const e = INFO[id];
  if (!e) return null;
  return (
    <>
      <TouchableOpacity
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`What is ${e.title}?`}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        style={[styles.dot, { width: size, height: size, borderRadius: size / 2 }]}
        activeOpacity={0.7}
      >
        <Text style={[styles.dotTxt, { fontSize: size * 0.68 }]}>i</Text>
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          {/* Stop the press from closing when it lands inside the card. */}
          <Pressable style={styles.card} onPress={() => {}}>
            <Text style={styles.title}>{e.title}</Text>
            <ScrollView style={{ maxHeight: 340 }}>
              <Text style={styles.h}>What it measures</Text>
              <Text style={styles.p}>{e.what}</Text>
              <Text style={styles.h}>How to read it</Text>
              <Text style={styles.p}>{e.read}</Text>
              <Text style={styles.h}>What it can&apos;t tell you</Text>
              <Text style={[styles.p, { color: theme.muted }]}>{e.limit}</Text>
            </ScrollView>
            <TouchableOpacity style={styles.close} onPress={() => setOpen(false)} activeOpacity={0.8}>
              <Text style={styles.closeTxt}>CLOSE</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  dot: {
    borderWidth: 1,
    borderColor: theme.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotTxt: { color: theme.muted, fontWeight: '700', lineHeight: undefined },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.sp.lg,
  },
  card: {
    backgroundColor: theme.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.border2,
    padding: theme.sp.lg,
    width: '100%',
    maxWidth: 460,
  },
  title: { color: theme.text, fontSize: theme.fs.lg, fontWeight: '800', marginBottom: theme.sp.md },
  h: {
    color: theme.muted,
    fontSize: theme.fs.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: theme.sp.md,
  },
  p: { color: theme.text, fontSize: theme.fs.sm, lineHeight: 20, marginTop: 4 },
  close: {
    marginTop: theme.sp.lg,
    alignSelf: 'flex-end',
    paddingHorizontal: theme.sp.lg,
    paddingVertical: theme.sp.sm,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.surface2,
  },
  closeTxt: { color: theme.text, fontSize: theme.fs.sm, fontWeight: '700' },
});
