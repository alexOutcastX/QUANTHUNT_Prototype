// Self-contained lightweight-charts HTML for HtmlView (WebView on native,
// iframe on web). Shared by the Chart screen and the stock-detail modal.
import { Candle } from './api';
import { theme } from './theme';

// Chart candles use the web app's palette (colour is allowed for candles).
export const UP = '#10b981';
export const DOWN = '#f43f5e';

export function chartHtml(candles: Candle[], barSec: number): string {
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
