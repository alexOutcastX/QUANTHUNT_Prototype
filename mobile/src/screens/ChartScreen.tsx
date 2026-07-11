import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { api, Candle } from '../api';
import HtmlView from '../components/HtmlView';
import { theme } from '../theme';

// Chart candles use the web app's palette (colour is allowed for candles).
const UP = '#10b981';
const DOWN = '#f43f5e';

const PERIODS: { label: string; period: string; interval: string; barSec: number }[] = [
  { label: '5D', period: '5d', interval: '15m', barSec: 900 },
  { label: '1M', period: '1mo', interval: '1d', barSec: 86400 },
  { label: '6M', period: '6mo', interval: '1d', barSec: 86400 },
  { label: '1Y', period: '1y', interval: '1d', barSec: 86400 },
  { label: '5Y', period: '5y', interval: '1wk', barSec: 604800 },
];

function chartHtml(candles: Candle[], barSec: number): string {
  const data = JSON.stringify(candles);
  return `<!DOCTYPE html><html><head>
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
  <style>html,body,#c{height:100%;margin:0;background:${theme.bg}}
  #msg{color:#5e6776;font:12px monospace;position:absolute;top:50%;left:0;right:0;text-align:center;transform:translateY(-50%)}</style>
  </head><body>
  <div id="msg">Loading chart library…</div>
  <div id="c"></div>
  <script src="https://unpkg.com/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.js"></script>
  <script>
  (function(){
    var msg=document.getElementById('msg');
    if(typeof LightweightCharts==='undefined'){msg.textContent='⚠ Chart library unavailable (no network).';return;}
    var LW=LightweightCharts, candles=${data}, barSec=${barSec};
    if(!candles.length){msg.textContent='No data for this symbol.';return;}
    msg.style.display='none';
    var el=document.getElementById('c');
    var chart=LW.createChart(el,{
      autoSize:true,
      layout:{background:{color:'${theme.bg}'},textColor:'${theme.muted2}',fontFamily:'monospace'},
      grid:{vertLines:{color:'${theme.border}'},horzLines:{color:'${theme.border}'}},
      rightPriceScale:{borderColor:'${theme.border2}',minimumWidth:60},
      timeScale:{borderColor:'${theme.border2}',timeVisible:barSec<86400,secondsVisible:false},
      crosshair:{mode:LW.CrosshairMode.Normal}
    });
    var cs=chart.addCandlestickSeries({upColor:'${UP}',downColor:'${DOWN}',borderUpColor:'${UP}',borderDownColor:'${DOWN}',wickUpColor:'${UP}',wickDownColor:'${DOWN}'});
    cs.setData(candles.map(function(c){return{time:c.t,open:c.o,high:c.h,low:c.l,close:c.c};}));
    var vs=chart.addHistogramSeries({priceFormat:{type:'volume'},priceScaleId:'vol'});
    chart.priceScale('vol').applyOptions({scaleMargins:{top:0.8,bottom:0}});
    vs.setData(candles.map(function(c){return{time:c.t,value:c.v,color:c.c>=c.o?'rgba(16,185,129,0.3)':'rgba(244,63,94,0.3)'};}));
    var gap=barSec*2.5;
    function seg(key,color,w){
      var pts=candles.filter(function(c){return c[key]!=null;}).map(function(c){return{time:c.t,value:c[key]};});
      var run=[];
      for(var i=0;i<pts.length;i++){
        if(i>0&&pts[i].time-pts[i-1].time>gap){if(run.length>1){var s=chart.addLineSeries({color:color,lineWidth:w,priceLineVisible:false,lastValueVisible:false,crosshairMarkerVisible:false});s.setData(run);}run=[];}
        run.push(pts[i]);
      }
      if(run.length>1){var s2=chart.addLineSeries({color:color,lineWidth:w,priceLineVisible:false,lastValueVisible:false,crosshairMarkerVisible:false});s2.setData(run);}
    }
    seg('ema20','${theme.muted2}',1);
    seg('ema50','${theme.muted}',2);
    seg('ema200','${DOWN}',2);
    chart.timeScale().fitContent();
  })();
  </script>
  </body></html>`;
}

// Normal charting — native lightweight-charts fed by the Flask /history API.
export default function ChartScreen() {
  const [input, setInput] = useState('RELIANCE');
  const [symbol, setSymbol] = useState('RELIANCE');
  const [pIdx, setPIdx] = useState(3); // 1Y
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const p = PERIODS[pIdx];

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.history(symbol, p.period, p.interval);
      setCandles(Array.isArray(res.candles) ? res.candles : []);
      if (res.error) setError(res.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load history');
      setCandles([]);
    } finally {
      setLoading(false);
    }
  }, [symbol, p.period, p.interval]);

  useEffect(() => {
    load();
  }, [load]);

  const html = useMemo(() => chartHtml(candles, p.barSec), [candles, p.barSec]);

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.search}
        value={input}
        onChangeText={setInput}
        onSubmitEditing={() => setSymbol(input.trim().toUpperCase().replace(/^NSE:/, ''))}
        placeholder="Symbol — e.g. RELIANCE"
        placeholderTextColor={theme.muted}
        autoCapitalize="characters"
        returnKeyType="go"
      />
      <View style={styles.chips}>
        {PERIODS.map((pp, i) => (
          <TouchableOpacity
            key={pp.label}
            style={[styles.chip, i === pIdx && styles.chipActive]}
            onPress={() => setPIdx(i)}
          >
            <Text style={[styles.chipText, i === pIdx && styles.chipTextActive]}>{pp.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {error ? <Text style={styles.error}>{error} — is the backend reachable?</Text> : null}

      <View style={styles.chartWrap}>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={theme.accent} />
            <Text style={styles.dim}>Loading {symbol}…</Text>
          </View>
        ) : (
          <HtmlView key={html.length + symbol + p.label} html={html} style={styles.web} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  search: {
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: 8,
    color: theme.text,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginHorizontal: 12,
    marginTop: 12,
    fontFamily: theme.mono,
    fontSize: 13,
  },
  chips: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingVertical: 10 },
  chip: {
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipActive: { backgroundColor: theme.accent, borderColor: theme.accent },
  chipText: { color: theme.muted2, fontFamily: theme.mono, fontSize: 12 },
  chipTextActive: { color: theme.bg, fontWeight: '700' },
  error: {
    color: theme.red,
    fontFamily: theme.mono,
    fontSize: 11,
    paddingHorizontal: 12,
    paddingBottom: 6,
  },
  chartWrap: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  dim: { color: theme.muted, fontFamily: theme.mono, fontSize: 12 },
  web: { flex: 1, backgroundColor: theme.bg },
});
