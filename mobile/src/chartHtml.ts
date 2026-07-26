// Self-contained lightweight-charts HTML for HtmlView (WebView on native,
// iframe on web). Shared by the Chart screen and the stock-detail modal.
import { API_BASE, Candle, SmcLevel, SmcZone } from './api';
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

// ── ICT / SMC geometry ───────────────────────────────────────────────────────
// Zones come from smc.py (shapes defined in api.ts). Drawn on a canvas over the
// chart rather than as chart series, because lightweight-charts 4.1.3 has no
// rectangle primitive and an FVG/order block is fundamentally a rectangle.
export type SmcOverlay = { zones: SmcZone[]; levels?: SmcLevel[] };

// How each zone kind paints: fill, stroke, dash, and whether it takes a label.
// Kept here (not in the screen) so every surface that draws SMC geometry reads
// the same legend.
export const ZONE_STYLE: Record<string,
  { fill: string; line: string; dash?: number[]; label: string }> = {
  liquidity:   { fill: 'rgba(245,197,24,0.00)', line: '#f5c518', dash: [5, 4], label: 'Liquidity' },
  sweep:       { fill: 'rgba(255,112,67,0.28)', line: '#ff7043', label: 'Sweep' },
  fvg:         { fill: 'rgba(245,197,24,0.16)', line: 'rgba(245,197,24,0.75)', label: 'FVG' },
  vi:          { fill: 'rgba(125,211,252,0.18)', line: 'rgba(125,211,252,0.7)', label: 'Volume imbalance' },
  ob:          { fill: 'rgba(199,125,255,0.18)', line: 'rgba(199,125,255,0.75)', label: 'Order block' },
  breaker:     { fill: 'rgba(77,208,225,0.18)', line: '#4dd0e1', label: 'Breaker' },
  structure:   { fill: 'rgba(199,125,255,0.00)', line: '#c77dff', dash: [6, 3], label: 'BOS / CHoCH' },
  displace:    { fill: 'rgba(16,185,129,0.20)', line: '#10b981', label: 'Displacement' },
  range:       { fill: 'rgba(139,147,167,0.00)', line: 'rgba(139,147,167,0.55)', dash: [2, 3], label: 'Dealing range' },
  equilibrium: { fill: 'rgba(139,147,167,0.00)', line: 'rgba(139,147,167,0.8)', dash: [4, 4], label: 'Equilibrium' },
  discount:    { fill: 'rgba(16,185,129,0.07)', line: 'rgba(16,185,129,0.00)', label: 'Discount' },
  premium:     { fill: 'rgba(244,63,94,0.07)', line: 'rgba(244,63,94,0.00)', label: 'Premium' },
  ote:         { fill: 'rgba(245,197,24,0.13)', line: 'rgba(245,197,24,0.45)', label: 'OTE 62–79%' },
  divergence:  { fill: 'rgba(240,98,146,0.00)', line: '#f06292', dash: [4, 3], label: 'Divergence' },
};

const LEVEL_COLOR: Record<string, string> = {
  entry: '#8b93a7', stop: DOWN, target: UP, target2: UP,
};

// `maSet` is the set of SMA periods to draw (default 20/50/200). StockDetail
// calls chartHtml(candles, barSec, undefined, undefined, {panes:true}) for the
// full research view: crosshair OHLCV legend + synced RSI & MACD panes (using
// the per-candle indicator fields /history already computes server-side).
// `opts.smc` overlays ICT/SMC zones + trade levels (the HFT/ICT/SMC card).
export function chartHtml(
  candles: Candle[],
  barSec: number,
  maSet: number[] = DEFAULT_MA,
  drawing?: PatternDrawing | null,
  opts?: { panes?: boolean; smc?: SmcOverlay | null },
): string {
  const data = JSON.stringify(candles);
  const mas = JSON.stringify(MA_CONFIG.filter((m) => maSet.includes(m.period)));
  const draw = JSON.stringify(drawing || null);
  const wantPanes = !!opts?.panes;
  const smcJson = JSON.stringify(opts?.smc || null);
  const zoneStyle = JSON.stringify(ZONE_STYLE);
  const levelColor = JSON.stringify(LEVEL_COLOR);
  const theme = getPalette();
  return `<!DOCTYPE html><html><head>
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
  <style>html,body{height:100%;margin:0;background:${theme.bg}}
  #wrap{display:flex;flex-direction:column;height:100%}
  #c{flex:13;min-height:0;position:relative}
  #zc{position:absolute;top:0;left:0;pointer-events:none;z-index:4}
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
    // ── ICT / SMC overlay: zones on a canvas, trade plan as native price lines ──
    var smc=${smcJson};
    if(smc&&smc.zones&&smc.zones.length){
      var ZS=${zoneStyle}, LC=${levelColor};
      // Zones arrive keyed by timestamp; the chart positions by logical index.
      // Build ts→index once, and resolve any ts to the nearest bar at or after
      // it so a zone anchored on a holiday still lands on a real candle.
      var tsIdx={},tsList=[];
      for(var ci=0;ci<candles.length;ci++){tsIdx[candles[ci].t]=ci;tsList.push(candles[ci].t);}
      function idxFor(t,dflt){
        if(t==null)return dflt;
        if(tsIdx[t]!=null)return tsIdx[t];
        var lo=0,hi=tsList.length-1;
        if(t<=tsList[0])return 0;
        if(t>=tsList[hi])return hi;
        while(lo<hi){var mid=(lo+hi)>>1;if(tsList[mid]<t)lo=mid+1;else hi=mid;}
        return lo;
      }
      var zc=document.createElement('canvas');zc.id='zc';el.appendChild(zc);
      var zx=zc.getContext('2d');
      var tscale=chart.timeScale();
      function xAt(i){
        var x=tscale.logicalToCoordinate(i);
        return x==null?null:x;
      }
      function drawZones(){
        var w=el.clientWidth,h=el.clientHeight;
        if(!w||!h)return;
        var dpr=window.devicePixelRatio||1;
        if(zc.width!==Math.round(w*dpr)||zc.height!==Math.round(h*dpr)){
          zc.width=Math.round(w*dpr);zc.height=Math.round(h*dpr);
          zc.style.width=w+'px';zc.style.height=h+'px';
        }
        zx.setTransform(dpr,0,0,dpr,0,0);
        zx.clearRect(0,0,w,h);
        zx.font='9px monospace';zx.textBaseline='bottom';
        // Several context bands share a top edge (dealing range / premium /
        // equilibrium all start near the same y), so labels pinned to the left
        // would print on top of each other. Place each one at the first free
        // slot to the right, and drop it entirely if the row is full.
        var placed=[];
        function placeLabel(text,x,y,color){
          var tw=zx.measureText(text).width+4,th=11;
          for(var att=0;att<8;att++){
            var bx=x+att*(tw+8),by=y;
            if(bx+tw>w)break;
            var hit=false;
            for(var p=0;p<placed.length;p++){
              var q=placed[p];
              if(bx<q.x+q.w&&bx+tw>q.x&&by-th<q.y&&by>q.y-q.h){hit=true;break;}
            }
            if(!hit){
              placed.push({x:bx,y:by,w:tw,h:th});
              zx.fillStyle=color;zx.fillText(text,bx,by);
              return;
            }
          }
        }
        // widest-first so thin lines and single-bar marks land on top of the
        // big context bands instead of under them
        var ordered=smc.zones.slice().sort(function(a,b){
          var aw=(a.extend||a.t1==null)?1e9:(a.t1-a.t0), bw=(b.extend||b.t1==null)?1e9:(b.t1-b.t0);
          return bw-aw;
        });
        for(var k=0;k<ordered.length;k++){
          var z=ordered[k],st=ZS[z.kind];
          if(!st||z.lo==null)continue;
          if(z.kind==='divergence'){
            // two-point line: (t0,lo) → (t1,hi)
            var dx0=xAt(idxFor(z.t0,0)),dx1=xAt(idxFor(z.t1,candles.length-1));
            var dy0=cs.priceToCoordinate(z.lo),dy1=cs.priceToCoordinate(z.hi);
            if(dx0==null||dx1==null||dy0==null||dy1==null)continue;
            zx.save();zx.strokeStyle=st.line;zx.lineWidth=1.5;
            if(st.dash)zx.setLineDash(st.dash);
            zx.beginPath();zx.moveTo(dx0,dy0);zx.lineTo(dx1,dy1);zx.stroke();zx.restore();
            placeLabel(z.label,Math.min(dx0,dx1)+3,Math.max(10,Math.min(dy0,dy1)-3),st.line);
            continue;
          }
          var i0=idxFor(z.t0,0);
          var x0=xAt(i0);
          var x1=(z.extend||z.t1==null)?w:xAt(idxFor(z.t1,candles.length-1));
          if(x0==null||x1==null)continue;
          // a single-bar zone still needs width — straddle the bar
          var bw=tscale.options().barSpacing||6;
          if(z.t1!=null&&z.t1===z.t0){x0-=bw*0.42;x1+=bw*0.42;}
          if(x1<x0)continue;
          if(x1<0||x0>w)continue;
          x0=Math.max(x0,-2);x1=Math.min(x1,w);
          var yHi=cs.priceToCoordinate(z.hi!=null?z.hi:z.lo);
          var yLo=cs.priceToCoordinate(z.lo);
          if(yHi==null||yLo==null)continue;
          var top=Math.min(yHi,yLo),bot=Math.max(yHi,yLo);
          if(bot-top<1.5){top-=0.75;bot+=0.75;}
          zx.save();
          if(st.fill&&st.fill.indexOf(',0.00)')<0){
            zx.fillStyle=st.fill;zx.fillRect(x0,top,x1-x0,bot-top);
          }
          // An FVG that price has already rebalanced is hatched off, so a
          // half-filled gap never reads as fresh imbalance.
          if(z.kind==='fvg'&&z.mitigated>0.02){
            var fh=(bot-top)*Math.min(1,z.mitigated);
            zx.fillStyle='rgba(139,147,167,0.22)';
            zx.fillRect(x0,top,x1-x0,fh);
          }
          if(st.line&&st.line.indexOf(',0.00)')<0){
            zx.strokeStyle=st.line;zx.lineWidth=1;
            if(st.dash)zx.setLineDash(st.dash);
            if(bot-top<=1.6){
              zx.beginPath();zx.moveTo(x0,(top+bot)/2);zx.lineTo(x1,(top+bot)/2);zx.stroke();
            } else {
              zx.strokeRect(x0+0.5,top+0.5,Math.max(1,x1-x0-1),Math.max(1,bot-top-1));
            }
          }
          zx.restore();
          if(z.label&&x1-x0>34){
            placeLabel(z.label,Math.max(2,x0)+3,Math.max(10,top-2),
              st.line.indexOf(',0.00)')>=0?'${theme.muted2}':st.line);
          }
        }
      }
      tscale.subscribeVisibleLogicalRangeChange(drawZones);
      if(window.ResizeObserver)new ResizeObserver(drawZones).observe(el);
      window.addEventListener('resize',drawZones);
      setTimeout(drawZones,0);setTimeout(drawZones,250);
      // Trade plan as native price lines — they get axis labels for free.
      (smc.levels||[]).forEach(function(lv){
        if(lv.price==null)return;
        cs.createPriceLine({price:lv.price,color:LC[lv.kind]||'#8b93a7',lineWidth:1,
          lineStyle:lv.kind==='entry'?LW.LineStyle.Solid:LW.LineStyle.Dashed,
          axisLabelVisible:true,title:lv.label});
      });
    }
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
