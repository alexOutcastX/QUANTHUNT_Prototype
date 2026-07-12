import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import HtmlView from '../components/HtmlView';
import SymbolInput from '../components/SymbolInput';
import { theme } from '../theme';

function normSymbol(s: string): string {
  const v = (s || '').trim().toUpperCase();
  if (!v) return 'NSE:RELIANCE';
  return v.includes(':') ? v : `NSE:${v}`;
}

function widgetHtml(symbol: string): string {
  return `<!DOCTYPE html><html><head>
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
    <style>html,body,#tv{height:100%;margin:0;background:#0a0c0f}</style>
  </head><body>
    <div id="tv"></div>
    <script src="https://s3.tradingview.com/tv.js"></script>
    <script>
      new TradingView.widget({
        container_id: 'tv', autosize: true, symbol: ${JSON.stringify(symbol)},
        interval: 'D', timezone: 'Asia/Kolkata', theme: 'dark', style: '1',
        locale: 'in', toolbar_bg: '#0a0c0f', hide_side_toolbar: false,
        allow_symbol_change: true, withdateranges: true, details: true
      });
    </script>
  </body></html>`;
}

// Full TradingView charting widget — the "TradingView area". Advanced tooling,
// symbol search, and drawing come from TradingView itself.
export default function TradingViewScreen() {
  const [input, setInput] = useState('NSE:RELIANCE');
  const [symbol, setSymbol] = useState('NSE:RELIANCE');
  const html = useMemo(() => widgetHtml(symbol), [symbol]);

  return (
    <View style={styles.container}>
      <SymbolInput
        containerStyle={styles.searchWrap}
        inputStyle={styles.search}
        value={input}
        onChangeText={setInput}
        onSelect={(s) => setSymbol(normSymbol(s))}
        onSubmit={() => setSymbol(normSymbol(input))}
        placeholder="Symbol — e.g. NSE:RELIANCE"
      />
      <HtmlView html={html} style={styles.web} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  searchWrap: { margin: 12 },
  search: {
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: 8,
    color: theme.text,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontFamily: theme.mono,
    fontSize: 13,
  },
  web: { flex: 1, backgroundColor: theme.bg },
});
