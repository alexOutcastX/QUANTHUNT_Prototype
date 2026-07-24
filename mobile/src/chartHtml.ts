// Self-contained lightweight-charts HTML for HtmlView (WebView on native,
// iframe on web). Shared by the Chart screen and the stock-detail modal.
import { API_BASE, Candle } from './api';
import { getPalette } from './theme';

// Chart/graph libraries are self-hosted under /vendor (mobile/public/vendor →
// copied into dist by expo export). The CSP only allows same-origin scripts,
// so a CDN-only load is blocked on web — and self-hosting is faster (immutable
// cache + brotli) and immune to CDN outages anyway. The CDN stays as a
// fallback via document.write for resilience if the local file ever 404s.
export function vendorScript(file: string, cdn: string, globalName: string): string {
  return (
    `<script src="${API_BASE}/vendor/${file}"></script>` +
    `<script>if(typeof ${globalName}==='undefined')` +
    `document.write('<scr'+'ipt src="${cdn}"><\\/scr'+'ipt>');</script>`
  );
}

export const LW_SCRIPT = vendorScript(
  'lightweight-charts-4.1.3.js',
  'https://unpkg.com/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.js',
  'LightweightCharts',
);
export const D3_SCRIPT = vendorScript(
  'd3-7.9.0.min.js',
  'https://unpkg.com/d3@7.9.0/dist/d3.min.js',
  'd3',
);

// Chart candles use the web app's palette (colour is allowed for candles).
export const UP = '#10b981';
export const DOWN = '#f43f5e';

// Simple-moving-average overlays. Distinct but muted so they read as reference
// lines behind the candles, never competing with the up/down colour. The Chart
// screen renders a toggle chip per period; the on/off set is persisted.
export const MA_CONFIG: { period: number; color: string }[] = [
  { period: 20, color: '#5b93c7' }, // muted blue
  { period: 50, color: '#b48ead' }, // muted mauve
  { period: 200, color: '#c9a45b' }, // muted gold
];
export const DEFAULT_MA: number[] = [20, 50, 200];

// A detected chart pattern drawn onto the price chart: the formation span is
// traced in the bias colour, the key level (neckline/breakout) and measured-
// move target become labelled price lines, and start/end markers pin the span.
export type PatternDrawing = {
  label: string;
  bias: 'bullish' | 'bearish' | 'neutral';
  start_ts: number;
  end_ts: number;
  active?: boolean;         // still in play → trace runs to the last bar
  target?: number | null;
  level?: number | null;
};

// `maSet` is the set of SMA periods to draw (default 20/50/200). StockDetail
// calls chartHtml(candles, barSec, undefined, undefined, {panes:true}) for the
// full research view: crosshair OHLCV legend + synced RSI & MACD panes (using
// the per-candle indicator fields /history already computes server-side).
export function chartHtml(
  candles: Candle[],
  barSec: number,
  maSet: number[] = DEFAULT_MA,
  drawing?: PatternDrawing | null,
  opts?: { panes?: boolean },
): string {
  const data = JSON.stringify(candles);
  const mas = JSON.stringify(MA_CONFIG.filter((m) => maSet.includes(m.period)));
  const draw = JSON.stringify(drawing || null);
  const wantPanes = !!opts?.panes;
  const theme = getPalette();
  return `<!DOCTYPE html><html><head>
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
  <style>html,body{height:100%;margin:0;background:${theme.bg}}
  #wrap{display:flex;flex-direction:column;height:100%}
  #c{flex:13;min-height:0}
  #rsi,#macd{display:none;min-height:0;border-top:1px solid ${theme.border}}
  #lg{position:absolute;top:4px;left:8px;z-index:5;color:${theme.muted2};font:11px monospace;pointer-events:none;white-space:nowrap}
  .pl{position:absolute;left:8px;z-index:5;color:${theme.muted2};font:9px monospace;letter-spacing:1px;pointer-events:none}
  #msg{color:#5e6776;font:12px monospace;position:absolute;top:50%;left:0;right:0;text-align:center;transform:translateY(-50%)}</style>
  </head><body>
  <div id="msg">Loading chart library…</div>
  <div id="lg"></div>
  <div id="wrap"><div id="c"></div><div id="rsi"></div><div id="macd"></div></div>
  ${LW_SCRIPT}
  <script>
  (function(){
    var msg=document.getElementById('msg');
    if(typeof LightweightCharts==='undefined'){msg.textContent='⚠ Chart library unavailable (no network).';return;}
    var LW=LightweightCharts, candles=${data}, barSec=${barSec}, wantPanes=${wantPanes};
    if(!candles.length){msg.textContent='No data for this symbol.';return;}
    msg.style.display='none';
    var baseOpts={
      autoSize:true,
      layout:{background:{color:'${theme.bg}'},textColor:'${theme.muted2}',fontFamily:'monospace'},
      grid:{vertLines:{color:'${theme.border}'},horzLines:{color:'${theme.border}'}},
      rightPriceScale:{borderColor:'${theme.border2}',minimumWidth:60},
      timeScale:{borderColor:'${theme.border2}',timeVisible:barSec<86400,secondsVisible:false},
      crosshair:{mode:LW.CrosshairMode.Normal}
    };
    var el=document.getElementById('c');
    var chart=LW.createChart(el,baseOpts);
    var cs=chart.addCandlestickSeries({upColor:'${UP}',downColor:'${DOWN}',borderUpColor:'${UP}',borderDownColor:'${DOWN}',wickUpColor:'${UP}',wickDownColor:'${DOWN}'});
    cs.setData(candles.map(function(c){return{time:c.t,open:c.o,high:c.h,low:c.l,close:c.c};}));
    // Volume panel — green/red histogram pinned to the bottom 20% of the pane.
    var vs=chart.addHistogramSeries({priceFormat:{type:'volume'},priceScaleId:'vol'});
    chart.priceScale('vol').applyOptions({scaleMargins:{top:0.8,bottom:0}});
    vs.setData(candles.map(function(c){return{time:c.t,value:c.v,color:c.c>=c.o?'rgba(16,185,129,0.35)':'rgba(244,63,94,0.35)'};}));
    var gap=barSec*2.5;
    // Draw a line series, splitting into segments across data gaps so the MA
    // never draws a straight line over a market holiday / missing bar.
    function drawSegments(pts,color,w){
      var run=[];
      for(var i=0;i<pts.length;i++){
        if(i>0&&pts[i].time-pts[i-1].time>gap){if(run.length>1){var s=chart.addLineSeries({color:color,lineWidth:w,priceLineVisible:false,lastValueVisible:false,crosshairMarkerVisible:false});s.setData(run);}run=[];}
        run.push(pts[i]);
      }
      if(run.length>1){var s2=chart.addLineSeries({color:color,lineWidth:w,priceLineVisible:false,lastValueVisible:false,crosshairMarkerVisible:false});s2.setData(run);}
    }
    // Compute + draw each enabled SMA over the close series.
    var closes=candles.filter(function(c){return c.c!=null;});
    var mas=${mas};
    mas.forEach(function(m){
      if(closes.length<m.period)return;
      var vals=[],sum=0;
      for(var i=0;i<closes.length;i++){
        sum+=closes[i].c;
        if(i>=m.period)sum-=closes[i-m.period].c;
        if(i>=m.period-1)vals.push({time:closes[i].t,value:+(sum/m.period).toFixed(4)});
      }
      drawSegments(vals,m.color,2);
    });
    // ── Pattern drawing: formation trace + key-level/target lines + markers ──
    var pat=${draw};
    if(pat){
      var pc=pat.bias==='bullish'?'${UP}':pat.bias==='bearish'?'${DOWN}':'#8b93a7';
      var endTs=pat.active?candles[candles.length-1].t:pat.end_ts;
      var span=candles.filter(function(c){return c.t>=pat.start_ts&&c.t<=endTs&&c.c!=null;});
      if(span.length>1){
        var trace=chart.addLineSeries({color:pc,lineWidth:4,priceLineVisible:false,lastValueVisible:false,crosshairMarkerVisible:false});
        trace.setData(span.map(function(c){return{time:c.t,value:c.c};}));
      }
      if(pat.level!=null)cs.createPriceLine({price:pat.level,color:'#c9a45b',lineWidth:1,lineStyle:LW.LineStyle.Solid,axisLabelVisible:true,title:'Key level'});
      if(pat.target!=null)cs.createPriceLine({price:pat.target,color:pc,lineWidth:1,lineStyle:LW.LineStyle.Dashed,axisLabelVisible:true,title:'Target'});
      if(span.length){
        cs.setMarkers([
          {time:span[0].t,position:'belowBar',color:pc,shape:'arrowUp',text:pat.label},
          {time:span[span.length-1].t,position:'aboveBar',color:pc,shape:'arrowDown',text:pat.active?'now':'end'}
        ]);
      }
    }
    // ── Crosshair legend: O H L C · chg% · volume for the hovered/last bar ──
    var lg=document.getElementById('lg');
    var byTime={};
    candles.forEach(function(c){byTime[c.t]=c;});
    function fmtV(v){if(v==null)return'—';if(v>=1e7)return (v/1e7).toFixed(1)+'Cr';if(v>=1e5)return (v/1e5).toFixed(1)+'L';if(v>=1e3)return (v/1e3).toFixed(1)+'K';return String(v);}
    function setLegend(c,prev){
      if(!c){lg.textContent='';return;}
      var chg=prev&&prev.c?((c.c-prev.c)/prev.c*100):null;
      var col=(chg==null?'${theme.muted2}':chg>=0?'${UP}':'${DOWN}');
      lg.innerHTML='O '+c.o+'  H '+c.h+'  L '+c.l+'  C <b style="color:'+col+'">'+c.c+
        (chg==null?'':' ('+(chg>=0?'+':'')+chg.toFixed(2)+'%)')+'</b>'+
        (c.v?'  · V '+fmtV(c.v):'')+
        (c.rsi!=null?'  · RSI '+Math.round(c.rsi):'');
    }
    setLegend(candles[candles.length-1],candles[candles.length-2]);
    chart.subscribeCrosshairMove(function(p){
      var c=p&&p.time!=null?byTime[p.time]:null;
      if(!c){setLegend(candles[candles.length-1],candles[candles.length-2]);return;}
      var i=candles.indexOf(c);
      setLegend(c,i>0?candles[i-1]:null);
    });

    // ── RSI + MACD panes (server-computed fields), time-synced to the price ──
    var haveInd=candles.some(function(c){return c.rsi!=null;});
    var charts=[chart];
    if(wantPanes&&haveInd){
      var rsiEl=document.getElementById('rsi'),macdEl=document.getElementById('macd');
      rsiEl.style.display='block';rsiEl.style.flex='4';
      macdEl.style.display='block';macdEl.style.flex='5';
      var rsiChart=LW.createChart(rsiEl,baseOpts);
      var rs=rsiChart.addLineSeries({color:'#c9a45b',lineWidth:2,priceLineVisible:false,lastValueVisible:true});
      rs.setData(candles.filter(function(c){return c.rsi!=null;}).map(function(c){return{time:c.t,value:+c.rsi.toFixed(1)};}));
      rs.createPriceLine({price:70,color:'${DOWN}',lineWidth:1,lineStyle:LW.LineStyle.Dotted,axisLabelVisible:false,title:''});
      rs.createPriceLine({price:30,color:'${UP}',lineWidth:1,lineStyle:LW.LineStyle.Dotted,axisLabelVisible:false,title:''});
      var rl=document.createElement('div');rl.className='pl';rl.textContent='RSI 14';
      rl.style.top=(el.offsetHeight+6)+'px';document.body.appendChild(rl);
      var macdChart=LW.createChart(macdEl,baseOpts);
      var mh=macdChart.addHistogramSeries({priceLineVisible:false,lastValueVisible:false});
      mh.setData(candles.filter(function(c){return c.macd_hist!=null;}).map(function(c){
        return{time:c.t,value:+c.macd_hist.toFixed(3),color:c.macd_hist>=0?'rgba(16,185,129,0.55)':'rgba(244,63,94,0.55)'};}));
      var ml=macdChart.addLineSeries({color:'#5b93c7',lineWidth:1,priceLineVisible:false,lastValueVisible:false});
      ml.setData(candles.filter(function(c){return c.macd!=null;}).map(function(c){return{time:c.t,value:+c.macd.toFixed(3)};}));
      var sl=macdChart.addLineSeries({color:'#b48ead',lineWidth:1,priceLineVisible:false,lastValueVisible:false});
      sl.setData(candles.filter(function(c){return c.macd_signal!=null;}).map(function(c){return{time:c.t,value:+c.macd_signal.toFixed(3)};}));
      var ml2=document.createElement('div');ml2.className='pl';ml2.textContent='MACD 12·26·9';
      ml2.style.top=(el.offsetHeight+rsiEl.offsetHeight+6)+'px';document.body.appendChild(ml2);
      charts.push(rsiChart,macdChart);
      // Keep every pane on the same visible range, whichever pane is dragged.
      var syncing=false;
      charts.forEach(function(src){
        src.timeScale().subscribeVisibleLogicalRangeChange(function(r){
          if(syncing||!r)return;
          syncing=true;
          charts.forEach(function(dst){if(dst!==src)dst.timeScale().setVisibleLogicalRange(r);});
          syncing=false;
        });
      });
    }
    charts.forEach(function(ch){ch.timeScale().fitContent();});
  })();
  </script>
  </body></html>`;
}
