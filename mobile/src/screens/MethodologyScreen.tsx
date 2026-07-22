// Methodology — how every number in the app is computed, in plain language.
// Institutions diligence the method before the UI; this page is the standing
// answer. Static by design: if a rule changes, this text must change in the
// same pull request.
import React from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { Card } from '../ui';
import { theme } from '../theme';

const SECTIONS: { title: string; body: string }[] = [
  {
    title: 'House view (Symbol page)',
    body:
      'A weighted reconciliation of three independent reads: multi-timeframe technicals (40%), the average of the strategy screens (35%) and the fundamental checklist (25%). Engines with no data are dropped and weights renormalised. The range shown is the spread between the lowest and highest engine — a wide range means the engines disagree and the aggregate deserves less trust.',
  },
  {
    title: 'Multi-timeframe technicals',
    body:
      'Each timeframe (intraday to long-term) is scored 0–100 from trend structure (EMA stack and slope), momentum (RSI regime, MACD state) and location versus support/resistance derived from swing pivots. The overall score is a duration-weighted blend. Support and resistance levels are pivot clusters, not predictions.',
  },
  {
    title: 'Strategy screens',
    body:
      'Rule-based screens (momentum, trend, breakout, mean-reversion, relative value, Minervini trend template, candlestick states) each score a symbol 0–100 on how completely its conditions are met right now. A score is a measure of rule-fit, not a probability of profit.',
  },
  {
    title: 'Fundamental checklist',
    body:
      'A fixed checklist over reported financials — profitability (ROE/ROCE), growth (revenue/PAT), leverage (debt-to-equity), cash generation (FCF), valuation context (PE/PB vs history). Each item is marked good / ok / bad against published thresholds; the score is the weighted pass-rate. Data is as-filed from public sources and can lag corporate events.',
  },
  {
    title: 'Momentum radar',
    body:
      'A universe-wide scan for defined setups: volatility-squeeze breakout watch, fired breakouts, and pullback-in-trend. Levels shown are the measured resistance/support of the pattern. "Room to resistance" is the distance to the pattern-projected level — a geometric measure, not a forecast.',
  },
  {
    title: 'Multibagger screen',
    body:
      'A long-horizon quality-and-growth screen weighted toward free-cash-flow generation, profit growth and low leverage, with technical trend as a gate. The 0–100 score is rule-fit over those factors.',
  },
  {
    title: 'Calibration',
    body:
      'Every logged paper trade records the setup’s entry, stop and target at the moment it was logged, then resolves to won (target first) or lost (stop first) against subsequent prices. Hit-rate = wins over closed trades; average R books the planned reward as a positive multiple and −1R on a stop. Percentages are shown only past 20 closed trades per engine. Paper outcomes exclude slippage and charges.',
  },
  {
    title: 'Costs model',
    body:
      'Backtests and net R:R figures apply the Indian equity charge schedule — brokerage (flat/bps), STT, exchange transaction charges, SEBI turnover fee, stamp duty and GST — plus configurable slippage per side. Defaults approximate a discount broker on delivery trades.',
  },
  {
    title: 'Data sources & limits',
    body:
      'Prices and history come from public NSE endpoints and Yahoo Finance (delayed, adjustments per source policy); fundamentals from Yahoo Finance and screener.in; news from public RSS. None of this is entitled real-time exchange data. Every surface carries an as-of stamp; when your own broker is connected, quotes on the Symbol page upgrade to that entitled feed and are labelled accordingly.',
  },
];

export default function MethodologyScreen() {
  return (
    <ScrollView style={s.wrap} contentContainerStyle={s.pad}>
      <Text style={s.h1}>Methodology</Text>
      <Text style={s.sub}>
        How each number is computed. Every score in TaurEye is the mechanical output of the
        published rules below — measurable, calibratable, and never investment advice.
      </Text>
      {SECTIONS.map((x) => (
        <Card key={x.title} style={s.card}>
          <Text style={s.t}>{x.title}</Text>
          <Text style={s.b}>{x.body}</Text>
        </Card>
      ))}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg },
  pad: { padding: theme.sp.lg, gap: theme.sp.md },
  h1: { color: theme.text, fontSize: theme.fs.xxl, fontWeight: '800' },
  sub: { color: theme.muted, fontSize: theme.fs.sm, lineHeight: 19 },
  card: { padding: theme.sp.lg, gap: 6 },
  t: { color: theme.text, fontSize: theme.fs.md, fontWeight: '700' },
  b: { color: theme.muted2, fontSize: theme.fs.sm, lineHeight: 20 },
});
