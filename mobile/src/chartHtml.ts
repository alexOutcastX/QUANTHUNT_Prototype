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

// `maSet` is the set of SMA periods to draw (default 20/50/200). StockDetail
// calls chartHtml(candles, barSec) and gets the default overlays.
export function chartHtml(candles: Candle[], barSec: number, maSet: number[] = DEFAULT_MA): string {
  const data = JSON.stringify(candles);
  const mas = JSON.stringify(MA_CONFIG.filter((m) => maSet.includes(m.period)));
  const theme = getPalette();
  return `<!DOCTYPE html><html><head>
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
  <style>html,body,#c{height:100%;margin:0;background:${theme.bg}}
  #msg{color:#5e6776;font:12px monospace;position:absolute;top:50%;left:0;right:0;text-align:center;transform:translateY(-50%)}</style>
  </head><body>
  <div id="msg">Loading chart library…</div>
  <div id="c"></div>
  ${LW_SCRIPT}
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
    chart.timeScale().fitContent();
  })();
  </script>
  </body></html>`;
}
