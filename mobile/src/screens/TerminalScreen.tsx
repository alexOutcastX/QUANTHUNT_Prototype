import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { API_BASE, GraphResp, LtpResp, api } from '../api';
import HtmlView from '../components/HtmlView';
import { theme } from '../theme';

// Self-contained Terminal workspace: d3-force relationship graph + a floating,
// draggable, resizable, closeable multi-tab window (company chart +
// screener.in fundamentals, and a comparison report). All interaction lives
// inside the frame; state persists to localStorage across frame rebuilds.
function graphHtml(data: GraphResp, quotes: LtpResp, centre: string): string {
  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<style>
  html,body{height:100%;margin:0;background:${theme.bg};font-family:ui-monospace,Menlo,Consolas,monospace;overflow:hidden}
  #wrap{display:flex;height:100%}
  #gfx{flex:1;position:relative;overflow:hidden;display:flex}
  #gwrap{flex:1;position:relative;overflow:hidden;min-width:120px;min-height:120px}
  svg{width:100%;height:100%;display:block}
  #panel{width:310px;border-left:1px solid ${theme.border};overflow-y:auto;padding:14px;box-sizing:border-box}
  .ph{color:${theme.text};font-size:15px;font-weight:700;margin:0 0 2px}
  .ps{color:${theme.muted};font-size:10px;margin:0 0 12px}
  .sec{color:${theme.muted2};font-size:10px;letter-spacing:1px;text-transform:uppercase;margin:14px 0 6px;border-bottom:1px solid ${theme.border};padding-bottom:4px}
  .edge{padding:7px 8px;border:1px solid ${theme.border};border-radius:6px;margin-bottom:6px;cursor:pointer}
  .edge:hover{border-color:${theme.border2}}
  .et{color:${theme.text};font-size:12px;font-weight:700}
  .en{color:${theme.muted2};font-size:11px;line-height:1.45;margin-top:3px}
  .conf{color:${theme.muted};font-size:9px;float:right}
  .price-up{fill:${theme.green}} .price-dn{fill:${theme.red}}
  #legend{position:absolute;left:10px;bottom:10px;color:${theme.muted};font-size:10px;line-height:1.9;background:${theme.bg}cc;padding:6px 10px;border:1px solid ${theme.border};border-radius:6px;z-index:5}
  .lg-line{display:inline-block;width:26px;height:0;border-top:2px solid ${theme.muted2};vertical-align:middle;margin-right:6px}
  #crumb{position:absolute;top:10px;left:12px;color:${theme.muted};font-size:11px;z-index:5}
  #crumb b{color:${theme.text}}
  #hl{position:absolute;top:8px;right:10px;z-index:5;display:flex;gap:6px}
  .hlb{background:${theme.surface2};border:1px solid ${theme.border2};color:${theme.muted2};font-family:inherit;font-size:10px;letter-spacing:1px;padding:5px 10px;border-radius:5px;cursor:pointer}
  .hlb.on{background:${theme.accent};border-color:${theme.accent};color:${theme.bg};font-weight:700}
  .dim{opacity:0.12}
  #menu{position:absolute;z-index:30;background:${theme.surface};border:1px solid ${theme.border2};border-radius:8px;min-width:170px;display:none;box-shadow:0 8px 30px #000a}
  #menu div{padding:9px 13px;color:${theme.text};font-size:12px;cursor:pointer;border-bottom:1px solid ${theme.border}}
  #menu div:last-child{border-bottom:none}
  #menu div:hover{background:${theme.surface2}}
  #menu .mh{color:${theme.muted};font-size:10px;cursor:default;letter-spacing:1px}
  #menu .mh:hover{background:none}
  /* ── news panel ── */
  #news{width:290px;border-right:1px solid ${theme.border};display:none;flex-direction:column;overflow:hidden;flex:none}
  #newshead{display:flex;align-items:center;gap:2px;padding:6px 8px 6px 12px;border-bottom:1px solid ${theme.border};background:${theme.surface2}}
  #newstitle{color:${theme.text};font-size:11px;font-weight:700;letter-spacing:1px;flex:1}
  #newsmeta{color:${theme.muted};font-size:9px;padding:5px 12px;border-bottom:1px solid ${theme.border}}
  #newsbody{flex:1;overflow-y:auto}
  .nitem{padding:9px 12px;border-bottom:1px solid ${theme.border};cursor:pointer}
  .nitem:hover{background:${theme.surface2}}
  .nt{color:${theme.text};font-size:11px;line-height:1.45}
  .nm{color:${theme.muted};font-size:9px;margin-top:4px}
  .ntag{color:${theme.accent};font-weight:700}
  .wfull{position:absolute;top:6px;right:8px;z-index:5;background:${theme.surface2};border:1px solid ${theme.border2};color:${theme.muted2};font-size:9px;letter-spacing:1px;padding:4px 8px;border-radius:4px;cursor:pointer}
  .wfull:hover{color:${theme.text}}
  /* ── floating window ── */
  #win{z-index:20;background:${theme.surface};border:1px solid ${theme.border2};display:none;flex-direction:column;overflow:hidden;min-width:250px;min-height:170px}
  #win.float{position:absolute;border-radius:10px;box-shadow:0 12px 40px #000c;min-width:340px;min-height:220px}
  #win.dockb{position:relative;border-left:none;border-right:none;border-bottom:none}
  #win.dockr{position:relative;border-top:none;border-bottom:none;border-right:none}
  #windiv{display:none;background:${theme.border};flex:none}
  #win.dockb #windiv{display:block;height:5px;cursor:ns-resize;width:100%}
  #win.dockr #windiv{display:block;position:absolute;left:0;top:0;bottom:0;width:5px;cursor:ew-resize;z-index:23}
  #win.dockr #winhead,#win.dockr #winbody{margin-left:5px}
  #winbtns{display:flex;align-items:center;flex:none}
  .wbtn{color:${theme.muted2};padding:6px 6px;cursor:pointer;font-size:12px;line-height:1}
  .wbtn:hover{color:${theme.text}}
  .wbtn.on{color:${theme.accent}}
  #winhead{display:flex;align-items:center;background:${theme.surface2};border-bottom:1px solid ${theme.border};cursor:move;user-select:none;padding:0 6px 0 0}
  #win.dockb #winhead,#win.dockr #winhead{cursor:default}
  #wintabs{display:flex;flex:1;overflow-x:auto;scrollbar-width:none}
  .wtab{padding:8px 10px;color:${theme.muted2};font-size:11px;cursor:pointer;border-right:1px solid ${theme.border};white-space:nowrap;display:flex;gap:7px;align-items:center}
  .wtab.on{color:${theme.text};background:${theme.surface};font-weight:700}
  .wtab .x{color:${theme.muted};font-size:10px;padding:1px 3px}
  .wtab .x:hover{color:${theme.text}}
  #winclose{color:${theme.muted2};padding:6px 8px;cursor:pointer;font-size:13px}
  #winclose:hover{color:${theme.text}}
  #winbody{flex:1;overflow-y:auto;position:relative}
  #winresize{position:absolute;right:0;bottom:0;width:18px;height:18px;cursor:nwse-resize;z-index:22;border-right:3px solid ${theme.border2};border-bottom:3px solid ${theme.border2};border-radius:0 0 8px 0}
  .wchart{height:200px;border-bottom:1px solid ${theme.border}}
  .fgrid{display:flex;flex-wrap:wrap;padding:10px 12px}
  .fc{width:25%;min-width:100px;margin-bottom:10px}
  .fk{color:${theme.muted2};font-size:9px;letter-spacing:0.5px}
  .fv{color:${theme.text};font-size:12px;margin-top:2px}
  .fdesc{color:${theme.muted2};font-size:10px;line-height:1.5;padding:2px 12px 12px}
  .wmsg{color:${theme.muted};font-size:11px;padding:24px;text-align:center}
  table.cmp{border-collapse:collapse;width:100%;font-size:11px}
  table.cmp th,table.cmp td{border-bottom:1px solid ${theme.border};padding:6px 10px;text-align:right;color:${theme.text}}
  table.cmp th{color:${theme.muted2};font-size:10px;letter-spacing:0.5px;text-transform:uppercase}
  table.cmp td:first-child,table.cmp th:first-child{text-align:left;color:${theme.muted2}}
  tr.score td{font-weight:700;border-top:2px solid ${theme.border2};font-size:13px}
  .best{color:${theme.green} !important}
  .cmpnote{color:${theme.muted};font-size:9px;padding:8px 10px;line-height:1.5}
</style></head><body>
<div id="wrap">
  <div id="news">
    <div id="newshead">
      <span id="newstitle">NEWS</span>
      <div class="wbtn" id="news-upd" title="Update now" onclick="loadNews(true)">⟳</div>
      <div class="wbtn" title="Open in browser tab" onclick="openNews()">↗</div>
    </div>
    <div id="newsmeta"></div>
    <div id="newsbody"><div class="wmsg">Loading news…</div></div>
  </div>
  <div id="gfx">
    <div id="gwrap">
      <div id="crumb"></div>
      <div id="hl">
        <button class="hlb" id="tg-news" onclick="toggleNews()">◧ NEWS</button>
        <button class="hlb" id="tg-win" onclick="toggleWin()">▤ CHART</button>
        <span style="width:8px"></span>
        <button class="hlb" id="hl-in" onclick="setHl('in')">INPUTS</button>
        <button class="hlb" id="hl-out" onclick="setHl('out')">OUTPUTS</button>
        <button class="hlb on" id="hl-all" onclick="setHl('all')">ALL</button>
      </div>
      <svg id="svg"></svg>
      <div id="legend">
        <span class="lg-line" style="border-top-style:solid"></span>supplies →<br>
        <span class="lg-line" style="border-top-style:dashed"></span>group<br>
        <span class="lg-line" style="border-top-style:dotted"></span>competitor<br>
        <span class="lg-line" style="border-top:2px double ${theme.muted2};height:4px"></span>finances
      </div>
      <div id="menu"></div>
    </div>
    <div id="win">
      <div id="windiv"></div>
      <div id="winhead">
        <div id="wintabs"></div>
        <div id="winbtns">
          <div class="wbtn" id="dk-float" title="Float" onclick="setDock('float')">❐</div>
          <div class="wbtn" id="dk-bottom" title="Dock to bottom" onclick="setDock('bottom')">⬓</div>
          <div class="wbtn" id="dk-right" title="Dock to right" onclick="setDock('right')">◨</div>
          <div class="wbtn" title="Open in browser tab" onclick="openExt(null)">↗</div>
          <div class="wbtn" id="winclose" onclick="closeWin()">✕</div>
        </div>
      </div>
      <div id="winbody"></div>
      <div id="winresize"></div>
    </div>
  </div>
  <div id="panel"><div class="wmsg">Loading…</div></div>
</div>
<script src="https://unpkg.com/d3@7.9.0/dist/d3.min.js"></script>
<script src="https://unpkg.com/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.js"></script>
<script>
(function(){
  if (typeof d3 === 'undefined') { document.getElementById('panel').innerHTML = '<div class="wmsg">⚠ Graph library unavailable (no network).</div>'; return; }
  var DATA = ${JSON.stringify({ companies: data.companies, edges: data.edges })};
  var QUOTES = ${JSON.stringify(quotes)};
  var API = ${JSON.stringify(API_BASE)};
  var centre = ${JSON.stringify(centre)};
  var DASH = { supplies: null, group: '7,5', competitor: '2,5', finances: '12,3,2,3' };
  var svg = d3.select('#svg'), sim = null, hlMode = 'all';
  var linkSel = null, nodeSel = null;
  var histCache = {}, fundCache = {};

  // ── persisted workspace state (survives frame rebuilds) ──
  var W = { open: false, tabs: [], active: null, compare: [], rect: null, dock: 'float', dockH: 300, dockW: 400, newsOn: true };
  try { var s = localStorage.getItem('te_term_win_v1'); if (s) W = Object.assign(W, JSON.parse(s)); } catch (e) {}
  function saveW(){ try { localStorage.setItem('te_term_win_v1', JSON.stringify(W)); } catch (e) {} }

  function num(v, d){ return (v == null || !isFinite(v)) ? '—' : (+v).toFixed(d == null ? 1 : d); }
  function fmtPrice(t) {
    var q = QUOTES[t];
    if (!q || q.price == null) return null;
    var chg = q.chg == null ? '' : ' ' + (q.chg >= 0 ? '+' : '') + q.chg.toFixed(1) + '%';
    return { txt: '₹' + Math.round(q.price).toLocaleString('en-IN') + chg, up: (q.chg || 0) >= 0 };
  }

  // ════ graph ════
  function subgraph(c) {
    var edges = DATA.edges.filter(function(e){ return e.src === c || e.dst === c; });
    var ids = {}; ids[c] = 1;
    edges.forEach(function(e){ ids[e.src] = 1; ids[e.dst] = 1; });
    var nodes = Object.keys(ids).map(function(id){
      var deg = DATA.edges.filter(function(e){ return e.src === id || e.dst === id; }).length;
      return { id: id, name: (DATA.companies[id]||{}).name || id, listed: !!(DATA.companies[id]||{}).listed, deg: deg };
    });
    return { nodes: nodes, links: edges.map(function(e){ return { source: e.src, target: e.dst, e: e }; }) };
  }

  window.setHl = function(mode) {
    hlMode = mode;
    ['in','out','all'].forEach(function(m){ document.getElementById('hl-' + m).className = 'hlb' + (m === mode ? ' on' : ''); });
    applyHl();
  };
  function edgeIsIn(e){ return e.dst === centre && (e.type === 'supplies' || e.type === 'finances'); }
  function edgeIsOut(e){ return e.src === centre && (e.type === 'supplies' || e.type === 'finances'); }
  function applyHl() {
    if (!linkSel) return;
    var keepNode = {}; keepNode[centre] = 1;
    linkSel.attr('class', function(d){
      var keep = hlMode === 'all' || (hlMode === 'in' ? edgeIsIn(d.e) : edgeIsOut(d.e));
      if (keep) { keepNode[d.e.src] = 1; keepNode[d.e.dst] = 1; }
      return keep ? '' : 'dim';
    });
    nodeSel.attr('class', function(d){ return (hlMode === 'all' || keepNode[d.id]) ? 'n' : 'n dim'; });
  }

  function panelHtml(c) {
    var comp = DATA.companies[c] || { name: c };
    var q = fmtPrice(c);
    var h = '<p class="ph">' + comp.name + '</p><p class="ps">' + c +
      (q ? ' · <span style="color:' + (q.up ? '${theme.green}' : '${theme.red}') + '">' + q.txt + '</span>' : '') +
      (comp.listed === false ? ' · unlisted' : '') + '</p>';
    function block(title, list, who) {
      if (!list.length) return '';
      var s = '<div class="sec">' + title + '</div>';
      list.forEach(function(e){
        s += '<div class="edge" onclick="window.recentre(\\'' + who(e) + '\\')"><span class="conf">' + e.confidence + '</span>' +
             '<div class="et">' + who(e) + '</div><div class="en">' + e.note + '</div></div>';
      });
      return s;
    }
    var E = DATA.edges;
    h += block('Suppliers', E.filter(function(e){ return e.dst === c && e.type === 'supplies'; }), function(e){ return e.src; });
    h += block('Customers / demand', E.filter(function(e){ return e.src === c && e.type === 'supplies'; }), function(e){ return e.dst; });
    h += block('Financiers', E.filter(function(e){ return e.dst === c && e.type === 'finances'; }), function(e){ return e.src; });
    h += block('Finances purchases of', E.filter(function(e){ return e.src === c && e.type === 'finances'; }), function(e){ return e.dst; });
    h += block('Competitors', E.filter(function(e){ return e.type === 'competitor' && (e.src === c || e.dst === c); }), function(e){ return e.src === c ? e.dst : e.src; });
    h += block('Group', E.filter(function(e){ return e.type === 'group' && (e.src === c || e.dst === c); }), function(e){ return e.src === c ? e.dst : e.src; });
    document.getElementById('panel').innerHTML = h;
  }

  window.recentre = function(id) {
    if (!DATA.companies[id]) return;
    centre = id; hideMenu(); render();
  };

  // ── node context menu ──
  function showMenu(d, x, y) {
    var m = document.getElementById('menu');
    var inCmp = W.compare.indexOf(d.id) >= 0;
    var h = '<div class="mh">' + d.id + '</div>';
    if (d.id !== centre) h += '<div onclick="window.recentre(\\'' + d.id + '\\')">⌾ Open graph</div>';
    h += '<div onclick="window.openTab(\\'' + d.id + '\\')">▤ Open in window</div>';
    h += '<div onclick="window.toggleCompare(\\'' + d.id + '\\')">' + (inCmp ? '✓ In compare — remove' : '⇄ Add to compare') + '</div>';
    h += '<div onclick="window.hideMenu()" style="color:${theme.muted}">✕ Cancel</div>';
    m.innerHTML = h;
    m.style.display = 'block';
    var g = document.getElementById('gwrap');
    m.style.left = Math.min(x, g.clientWidth - 190) + 'px';
    m.style.top = Math.min(y, g.clientHeight - 170) + 'px';
  }
  window.hideMenu = function(){ document.getElementById('menu').style.display = 'none'; };
  document.getElementById('svg').addEventListener('click', function(ev){ if (ev.target.tagName === 'svg') hideMenu(); });

  function render() {
    var g = subgraph(centre);
    document.getElementById('crumb').innerHTML = 'centre: <b>' + centre + '</b> · click a node for options';
    panelHtml(centre);
    if (sim) sim.stop();
    svg.selectAll('*').remove();
    var Wd = document.getElementById('gwrap').clientWidth, H = document.getElementById('gwrap').clientHeight;
    var root = svg.append('g');
    var zoomB = d3.zoom().scaleExtent([0.35, 2.5]).on('zoom', function(ev){ root.attr('transform', ev.transform); });
    svg.call(zoomB);
    // Zoom out to fit once forces settle, so no node ends up off-canvas when
    // the news panel / docked window shrink the graph area. Zoom-out only.
    var fitted = false;
    function fitAll() {
      if (fitted || !g.nodes.length) return;
      fitted = true;
      var xs = g.nodes.map(function(n){ return n.x; }), ys = g.nodes.map(function(n){ return n.y; });
      var minX = Math.min.apply(null, xs) - 70, maxX = Math.max.apply(null, xs) + 70;
      var minY = Math.min.apply(null, ys) - 60, maxY = Math.max.apply(null, ys) + 70;
      var k = Math.min(1, 0.95 * Math.min(Wd / (maxX - minX), H / (maxY - minY)));
      if (!isFinite(k) || k <= 0 || k >= 1) return;
      k = Math.max(0.35, k);
      var t = d3.zoomIdentity.translate(Wd / 2 - k * (minX + maxX) / 2, H / 2 - k * (minY + maxY) / 2).scale(k);
      svg.transition().duration(250).call(zoomB.transform, t);
    }
    setTimeout(fitAll, 900);
    svg.append('defs').append('marker').attr('id','arr').attr('viewBox','0 -4 8 8')
      .attr('refX', 26).attr('markerWidth', 7).attr('markerHeight', 7).attr('orient','auto')
      .append('path').attr('d','M0,-4L8,0L0,4').attr('fill','${theme.muted}');

    linkSel = root.selectAll('line').data(g.links).enter().append('line')
      .attr('stroke', '${theme.muted}').attr('stroke-width', function(d){ return d.e.confidence === 'high' ? 2 : 1.2; })
      .attr('stroke-dasharray', function(d){ return DASH[d.e.type]; })
      .attr('marker-end', function(d){ return (d.e.type === 'supplies' || d.e.type === 'finances') ? 'url(#arr)' : null; });

    nodeSel = root.selectAll('g.n').data(g.nodes).enter().append('g').attr('class','n')
      .style('cursor','pointer')
      .call(d3.drag()
        .on('start', function(ev,d){ if(!ev.active) sim.alphaTarget(0.25).restart(); d.fx=d.x; d.fy=d.y; })
        .on('drag', function(ev,d){ d.fx=ev.x; d.fy=ev.y; })
        .on('end', function(ev,d){ if(!ev.active) sim.alphaTarget(0); d.fx=null; d.fy=null; }))
      .on('click', function(ev,d){ ev.stopPropagation(); showMenu(d, ev.offsetX != null ? ev.offsetX : 40, ev.offsetY != null ? ev.offsetY : 40); });

    nodeSel.append('circle')
      .attr('r', function(d){ return d.id === centre ? 26 : 17; })
      .attr('fill', '${theme.surface2}')
      .attr('stroke', function(d){ return d.id === centre ? '${theme.accent}' : (d.listed ? '${theme.border2}' : '${theme.border}'); })
      .attr('stroke-width', function(d){ return d.id === centre ? 2.5 : 1.5; });
    nodeSel.append('text').text(function(d){ return d.id; })
      .attr('text-anchor','middle').attr('dy', function(d){ return d.id === centre ? 40 : 30; })
      .attr('fill', function(d){ return d.listed ? '${theme.text}' : '${theme.muted}'; })
      .attr('font-size', function(d){ return d.id === centre ? 13 : 11; }).attr('font-weight', 700);
    nodeSel.append('text').text(function(d){ var q = fmtPrice(d.id); return q ? q.txt : ''; })
      .attr('text-anchor','middle').attr('dy', function(d){ return d.id === centre ? 54 : 43; })
      .attr('class', function(d){ var q = fmtPrice(d.id); return q && q.up ? 'price-up' : 'price-dn'; })
      .attr('font-size', 10);
    nodeSel.append('text').text(function(d){ return d.id === centre ? '' : d.deg; })
      .attr('text-anchor','middle').attr('dy', 4).attr('fill','${theme.muted2}').attr('font-size', 10);

    sim = d3.forceSimulation(g.nodes)
      .force('link', d3.forceLink(g.links).id(function(d){ return d.id; }).distance(150))
      .force('charge', d3.forceManyBody().strength(-600))
      .force('center', d3.forceCenter(Wd/2, H/2))
      .force('collide', d3.forceCollide(46))
      .on('tick', function(){
        linkSel.attr('x1', function(d){ return d.source.x; }).attr('y1', function(d){ return d.source.y; })
               .attr('x2', function(d){ return d.target.x; }).attr('y2', function(d){ return d.target.y; });
        nodeSel.attr('transform', function(d){ return 'translate(' + d.x + ',' + d.y + ')'; });
      });
    applyHl();
  }

  // ════ floating window ════
  function winEl(){ return document.getElementById('win'); }
  function defaultRect() {
    var g = document.getElementById('gfx');
    return { x: 16, y: Math.max(60, g.clientHeight - 400), w: Math.min(560, g.clientWidth - 40), h: 360 };
  }
  function layoutWin() {
    var el = winEl(), gfx = document.getElementById('gfx');
    var dock = W.dock || 'float';
    updateToggles();
    ['float','bottom','right'].forEach(function(m){
      var b = document.getElementById('dk-' + m);
      if (b) b.className = 'wbtn' + (m === dock ? ' on' : '');
    });
    if (!W.open) { el.style.display = 'none'; gfx.style.flexDirection = 'row'; return; }
    el.style.display = 'flex';
    el.className = dock === 'bottom' ? 'dockb' : dock === 'right' ? 'dockr' : 'float';
    document.getElementById('winresize').style.display = dock === 'float' ? 'block' : 'none';
    if (dock === 'float') {
      gfx.style.flexDirection = 'row';
      var r = W.rect || defaultRect();
      r.x = Math.max(0, Math.min(r.x, gfx.clientWidth - 120));
      r.y = Math.max(0, Math.min(r.y, gfx.clientHeight - 60));
      el.style.left = r.x + 'px'; el.style.top = r.y + 'px';
      el.style.width = r.w + 'px'; el.style.height = r.h + 'px';
    } else if (dock === 'bottom') {
      gfx.style.flexDirection = 'column';
      el.style.left = ''; el.style.top = '';
      el.style.width = 'auto';
      el.style.height = Math.min(W.dockH || 300, gfx.clientHeight - 130) + 'px';
    } else {
      gfx.style.flexDirection = 'row';
      el.style.left = ''; el.style.top = '';
      el.style.height = 'auto';
      el.style.width = Math.min(W.dockW || 400, gfx.clientWidth - 140) + 'px';
    }
  }
  window.setDock = function(mode) {
    W.dock = mode; saveW(); layoutWin(); render(); renderBody();
  };
  // Pop the active tab (or a given id) out to a standalone browser tab.
  window.openExt = function(id) {
    id = id || W.active;
    if (!id) return;
    var u = id === '__cmp__'
      ? 'research.html?symbols=' + encodeURIComponent(W.compare.join(','))
      : 'research.html?symbol=' + encodeURIComponent(id);
    var url = (API || '') + '/' + u;
    try { window.open(url, '_blank'); } catch (e) {}
  };
  window.closeWin = function(){ W.open = false; saveW(); layoutWin(); if ((W.dock||'float') !== 'float') render(); };
  // Full chart for a company tab → standalone browser tab.
  window.openFullChart = function(sym) {
    var url = (API || '') + '/research.html?view=chart&symbol=' + encodeURIComponent(sym);
    try { window.open(url, '_blank'); } catch (e) {}
  };

  // ════ news panel ════
  function esc(s){ return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
  function centreName(){ return (DATA.companies[centre] || {}).name || centre; }
  function timeAgo(ts) {
    if (!ts) return '';
    var m = Math.max(0, Math.round(Date.now() / 1000 / 60 - ts / 60));
    if (m < 60) return m + 'm ago';
    var h = Math.round(m / 60);
    return h < 48 ? h + 'h ago' : Math.round(h / 24) + 'd ago';
  }
  window.openLink = function(u){ try { window.open(u, '_blank'); } catch (e) {} };
  window.loadNews = function(force) {
    if (!W.newsOn) return;
    var meta = document.getElementById('newsmeta');
    meta.textContent = 'updating…';
    fetch(API + '/news?symbol=' + encodeURIComponent(centre) + '&q=' + encodeURIComponent(centreName()) + (force ? '&force=1' : ''))
      .then(function(r){ return r.json(); })
      .then(function(d) {
        var items = (d && d.items) || [];
        var h = '';
        items.forEach(function(it) {
          h += '<div class="nitem" onclick="openLink(\\'' + String(it.link || '').replace(/['"\\\\]/g, '') + '\\')">' +
               '<div class="nt">' + esc(it.title) + '</div>' +
               '<div class="nm">' + (it.sym ? '<span class="ntag">' + esc(centre) + '</span> · ' : '') +
               esc(it.source || '') + (it.ts ? ' · ' + timeAgo(it.ts) : '') + '</div></div>';
        });
        document.getElementById('newsbody').innerHTML = h || '<div class="wmsg">No news available.</div>';
        var dt = new Date((d.fetched || 0) * 1000);
        meta.textContent = 'updated ' + ('0' + dt.getHours()).slice(-2) + ':' + ('0' + dt.getMinutes()).slice(-2) +
          (d.cached ? ' (cached)' : '') + ' · auto-refresh hourly';
      })
      .catch(function() {
        meta.textContent = 'news unavailable';
        document.getElementById('newsbody').innerHTML = '<div class="wmsg">News unavailable.</div>';
      });
  };
  window.openNews = function() {
    var url = (API || '') + '/research.html?view=news&symbol=' + encodeURIComponent(centre) + '&q=' + encodeURIComponent(centreName());
    try { window.open(url, '_blank'); } catch (e) {}
  };
  function layoutNews() {
    document.getElementById('news').style.display = W.newsOn ? 'flex' : 'none';
    document.getElementById('newstitle').textContent = 'NEWS · ' + centre;
    updateToggles();
  }
  // ── toolbar toggles: news panel + chart window ──
  function updateToggles() {
    var tn = document.getElementById('tg-news'), tw = document.getElementById('tg-win');
    if (tn) tn.className = 'hlb' + (W.newsOn ? ' on' : '');
    if (tw) tw.className = 'hlb' + (W.open ? ' on' : '');
  }
  window.toggleNews = function() {
    W.newsOn = !W.newsOn; saveW(); layoutNews(); render();
    if (W.newsOn) loadNews(false);
  };
  window.toggleWin = function() {
    if (W.open) { W.open = false; }
    else if (!W.tabs.length) { window.openTab(centre); return; }
    else { W.open = true; }
    saveW(); layoutWin(); renderTabs(); renderBody(); render();
  };
  window.openTab = function(sym) {
    hideMenu();
    if (W.tabs.indexOf(sym) < 0) W.tabs.push(sym);
    var wasOpen = W.open;
    W.active = sym; W.open = true; if (!W.rect) W.rect = defaultRect();
    saveW(); layoutWin(); renderTabs(); renderBody();
    if (!wasOpen && (W.dock||'float') !== 'float') render();
  };
  window.closeTab = function(ev, id) {
    ev.stopPropagation();
    W.tabs = W.tabs.filter(function(t){ return t !== id; });
    if (id === '__cmp__') W.compare = [];
    if (W.active === id) W.active = W.tabs[W.tabs.length - 1] || null;
    if (!W.tabs.length) W.open = false;
    saveW(); layoutWin(); renderTabs(); renderBody();
  };
  window.selTab = function(id){ W.active = id; saveW(); renderTabs(); renderBody(); };
  window.toggleCompare = function(sym) {
    hideMenu();
    var i = W.compare.indexOf(sym);
    if (i >= 0) W.compare.splice(i, 1); else W.compare.push(sym);
    if (W.compare.length) {
      if (W.tabs.indexOf('__cmp__') < 0) W.tabs.push('__cmp__');
      W.active = '__cmp__'; W.open = true; if (!W.rect) W.rect = defaultRect();
    } else {
      W.tabs = W.tabs.filter(function(t){ return t !== '__cmp__'; });
      if (W.active === '__cmp__') W.active = W.tabs[W.tabs.length - 1] || null;
      if (!W.tabs.length) W.open = false;
    }
    saveW(); layoutWin(); renderTabs(); renderBody();
  };
  function renderTabs() {
    var h = '';
    W.tabs.forEach(function(t){
      var label = t === '__cmp__' ? 'COMPARE (' + W.compare.length + ')' : t;
      h += '<div class="wtab' + (t === W.active ? ' on' : '') + '" onclick="selTab(\\'' + t + '\\')">' + label +
           '<span class="x" title="Open in browser tab" onclick="event.stopPropagation();openExt(\\'' + t + '\\')">↗</span>' +
           '<span class="x" onclick="closeTab(event, \\'' + t + '\\')">✕</span></div>';
    });
    document.getElementById('wintabs').innerHTML = h;
  }

  // drag + resize (float) and divider resize (docked)
  (function(){
    var head = document.getElementById('winhead'), grip = document.getElementById('winresize'),
        divd = document.getElementById('windiv');
    var drag = null;
    head.addEventListener('pointerdown', function(ev){
      if ((W.dock || 'float') !== 'float') return;
      if (ev.target.classList.contains('wbtn') || ev.target.classList.contains('wtab') || ev.target.classList.contains('x')) return;
      var r = W.rect || defaultRect();
      drag = { mode: 'move', sx: ev.clientX, sy: ev.clientY, r: { x: r.x, y: r.y, w: r.w, h: r.h } };
      head.setPointerCapture(ev.pointerId);
    });
    grip.addEventListener('pointerdown', function(ev){
      var r = W.rect || defaultRect();
      drag = { mode: 'size', sx: ev.clientX, sy: ev.clientY, r: { x: r.x, y: r.y, w: r.w, h: r.h } };
      grip.setPointerCapture(ev.pointerId);
      ev.preventDefault();
    });
    divd.addEventListener('pointerdown', function(ev){
      drag = { mode: 'dock', sx: ev.clientX, sy: ev.clientY, h: W.dockH || 300, w: W.dockW || 400 };
      divd.setPointerCapture(ev.pointerId);
      ev.preventDefault();
    });
    function move(ev){
      if (!drag) return;
      var dx = ev.clientX - drag.sx, dy = ev.clientY - drag.sy;
      if (drag.mode === 'move') { W.rect = { x: drag.r.x + dx, y: drag.r.y + dy, w: drag.r.w, h: drag.r.h }; layoutWin(); }
      else if (drag.mode === 'size') { W.rect = { x: drag.r.x, y: drag.r.y, w: Math.max(340, drag.r.w + dx), h: Math.max(220, drag.r.h + dy) }; layoutWin(); }
      else {
        if (W.dock === 'bottom') W.dockH = Math.max(170, drag.h - dy);
        else W.dockW = Math.max(280, drag.w - dx);
        layoutWin();
      }
    }
    function up(){
      if (!drag) return;
      var wasDock = drag.mode === 'dock';
      drag = null; saveW();
      if (wasDock) render(); // re-centre forces for the resized graph area
    }
    head.addEventListener('pointermove', move); grip.addEventListener('pointermove', move); divd.addEventListener('pointermove', move);
    head.addEventListener('pointerup', up); grip.addEventListener('pointerup', up); divd.addEventListener('pointerup', up);
  })();

  // ── company tab: chart + screener.in fundamentals ──
  function renderCompany(sym) {
    var body = document.getElementById('winbody');
    body.innerHTML = '<div style="position:relative"><div class="wchart" id="wc"></div>' +
      '<div class="wfull" title="Open full chart in browser tab" onclick="openFullChart(\\'' + sym + '\\')">⛶ FULL CHART</div></div>' +
      '<div id="wf"><div class="wmsg">Loading fundamentals…</div></div>';
    // chart
    var mount = document.getElementById('wc');
    function drawChart(candles) {
      if (typeof LightweightCharts === 'undefined') { mount.innerHTML = '<div class="wmsg">chart lib unavailable</div>'; return; }
      mount.innerHTML = '';
      var ch = LightweightCharts.createChart(mount, { autoSize: true,
        layout: { background: { color: '${theme.surface}' }, textColor: '${theme.muted2}', fontFamily: 'inherit' },
        grid: { vertLines: { color: '${theme.border}' }, horzLines: { color: '${theme.border}' } },
        rightPriceScale: { borderColor: '${theme.border2}' },
        timeScale: { borderColor: '${theme.border2}' } });
      var cs = ch.addCandlestickSeries({ upColor: '#10b981', downColor: '#f43f5e', borderUpColor: '#10b981', borderDownColor: '#f43f5e', wickUpColor: '#10b981', wickDownColor: '#f43f5e' });
      cs.setData(candles.map(function(c){ return { time: c.t, open: c.o, high: c.h, low: c.l, close: c.c }; }));
      ch.timeScale().fitContent();
    }
    if (histCache[sym]) drawChart(histCache[sym]);
    else {
      mount.innerHTML = '<div class="wmsg">Loading chart…</div>';
      fetch(API + '/history?symbol=' + encodeURIComponent(sym) + '&interval=1d&period=6mo')
        .then(function(r){ return r.json(); })
        .then(function(d){ if (W.active !== sym) return; if (d && d.candles && d.candles.length) { histCache[sym] = d.candles; drawChart(d.candles); } else mount.innerHTML = '<div class="wmsg">No chart data</div>'; })
        .catch(function(){ if (W.active === sym) mount.innerHTML = '<div class="wmsg">Chart unavailable</div>'; });
    }
    // fundamentals (screener.in chain server-side)
    function drawFund(f) {
      var cells = [
        ['MKT CAP (CR)', f.market_cap_cr != null ? (+f.market_cap_cr).toLocaleString('en-IN') : '—'],
        ['P/E', num(f.pe)], ['FWD P/E', num(f.forward_pe)], ['P/B', num(f.pb)],
        ['EPS', num(f.eps)], ['ROE %', num(f.roe)], ['ROCE %', num(f.roce)],
        ['D/E', num(f.debt_equity, 2)], ['CURR RATIO', num(f.current_ratio, 2)],
        ['DIV YIELD %', num(f.dividend_yield)], ['BETA', num(f.beta, 2)],
        ['52W HIGH', f.week52_high != null ? '₹' + (+f.week52_high).toLocaleString('en-IN') : '—'],
        ['52W LOW', f.week52_low != null ? '₹' + (+f.week52_low).toLocaleString('en-IN') : '—'],
        ['SECTOR', f.sector || '—'],
      ];
      var h = '<div class="fgrid">';
      cells.forEach(function(c){ h += '<div class="fc"><div class="fk">' + c[0] + '</div><div class="fv">' + c[1] + '</div></div>'; });
      h += '</div>';
      if (f.description) h += '<div class="fdesc">' + f.description + '</div>';
      h += '<div class="cmpnote">source: ' + (f.fund_source || 'yfinance') + '</div>';
      document.getElementById('wf').innerHTML = h;
    }
    if (fundCache[sym]) drawFund(fundCache[sym]);
    else fetch(API + '/fundamentals?symbol=' + encodeURIComponent(sym))
      .then(function(r){ return r.json(); })
      .then(function(f){ if (f && !f.error) { fundCache[sym] = f; if (W.active === sym) drawFund(f); } else if (W.active === sym) document.getElementById('wf').innerHTML = '<div class="wmsg">Fundamentals unavailable</div>'; })
      .catch(function(){ if (W.active === sym) document.getElementById('wf').innerHTML = '<div class="wmsg">Fundamentals unavailable</div>'; });
  }

  // ── compare tab: table + final score ──
  var clamp = function(x){ return Math.max(0, Math.min(100, x)); };
  function scoreOf(f, s) {
    var parts = [];
    if (f) {
      if (f.roe != null) parts.push(clamp(f.roe / 25 * 100));
      if (f.roce != null) parts.push(clamp(f.roce / 25 * 100));
      if (f.debt_equity != null) parts.push(clamp((2 - f.debt_equity) / 2 * 100));
      if (f.pe != null) parts.push(f.pe <= 0 ? 10 : clamp(100 - Math.abs(f.pe - 20) * 3));
    }
    var qual = parts.length ? parts.reduce(function(a,b){ return a + b; }, 0) / parts.length : 50;
    var trend = (s && s.d200 != null) ? clamp(50 + s.d200 * 2.5) : 50;
    var mom = (s && s.rsi != null) ? clamp(s.rsi) : 50;
    return { qual: qual, trend: trend, mom: mom, final: Math.round(qual * 0.5 + trend * 0.3 + mom * 0.2) };
  }
  function renderCompare() {
    var body = document.getElementById('winbody');
    var syms = W.compare.slice();
    if (syms.length < 2) { body.innerHTML = '<div class="wmsg">Add at least two companies to compare (click nodes → Add to compare). Currently: ' + (syms.join(', ') || 'none') + '</div>'; return; }
    body.innerHTML = '<div class="wmsg">Building comparison — fetching fundamentals + technicals…</div>';
    var qs = encodeURIComponent(syms.join(','));
    Promise.all([
      fetch(API + '/fundamentals/bulk?symbols=' + qs).then(function(r){ return r.json(); }).catch(function(){ return { data: {} }; }),
      fetch(API + '/scan?symbols=' + qs).then(function(r){ return r.json(); }).catch(function(){ return { data: {} }; })
    ]).then(function(res){
      if (W.active !== '__cmp__') return;
      var F = res[0].data || {}, S = res[1].data || {};
      var rows = [
        ['Price', function(sym){ var s = S[sym] || {}; return s.price != null ? '₹' + (+s.price).toLocaleString('en-IN') : '—'; }],
        ['Day %', function(sym){ var s = S[sym] || {}; return s.chg != null ? ((s.chg >= 0 ? '+' : '') + s.chg.toFixed(1) + '%') : '—'; }],
        ['Mkt cap (cr)', function(sym){ var f = F[sym] || {}; return f.market_cap_cr != null ? (+f.market_cap_cr).toLocaleString('en-IN') : '—'; }],
        ['P/E', function(sym){ return num((F[sym] || {}).pe); }],
        ['P/B', function(sym){ return num((F[sym] || {}).pb); }],
        ['ROE %', function(sym){ return num((F[sym] || {}).roe); }],
        ['ROCE %', function(sym){ return num((F[sym] || {}).roce); }],
        ['D/E', function(sym){ return num((F[sym] || {}).debt_equity, 2); }],
        ['Div yield %', function(sym){ return num((F[sym] || {}).dividend_yield); }],
        ['RSI (14)', function(sym){ return num((S[sym] || {}).rsi, 0); }],
        ['vs 200-DMA %', function(sym){ var s = S[sym] || {}; return s.d200 != null ? ((s.d200 >= 0 ? '+' : '') + s.d200.toFixed(1)) : '—'; }],
      ];
      var scores = {}; syms.forEach(function(sym){ scores[sym] = scoreOf(F[sym], S[sym]); });
      var best = syms.slice().sort(function(a,b){ return scores[b].final - scores[a].final; })[0];
      var h = '<table class="cmp"><tr><th>Metric</th>';
      syms.forEach(function(sym){ h += '<th>' + sym + (sym === best ? ' ★' : '') + '</th>'; });
      h += '</tr>';
      rows.forEach(function(r){
        h += '<tr><td>' + r[0] + '</td>';
        syms.forEach(function(sym){ h += '<td>' + r[1](sym) + '</td>'; });
        h += '</tr>';
      });
      [['Quality score', 'qual'], ['Trend score', 'trend'], ['Momentum score', 'mom']].forEach(function(sr){
        h += '<tr><td>' + sr[0] + '</td>';
        syms.forEach(function(sym){ h += '<td>' + Math.round(scores[sym][sr[1]]) + '</td>'; });
        h += '</tr>';
      });
      h += '<tr class="score"><td>FINAL SCORE</td>';
      syms.forEach(function(sym){ h += '<td class="' + (sym === best ? 'best' : '') + '">' + scores[sym].final + (sym === best ? ' ★' : '') + '</td>'; });
      h += '</tr></table>';
      h += '<div class="cmpnote">Final = 50% quality (ROE/ROCE/D-E/P-E) + 30% trend (vs 200-DMA) + 20% momentum (RSI). Factual composite of the metrics above — not investment advice.</div>';
      body.innerHTML = h;
    });
  }

  function renderBody() {
    if (!W.open || !W.active) return;
    if (W.active === '__cmp__') renderCompare(); else renderCompany(W.active);
  }

  layoutNews();
  render();
  layoutWin(); renderTabs(); renderBody();
  loadNews(false);
  setInterval(function(){ loadNews(false); }, 3600 * 1000); // hourly auto-update
})();
</script></body></html>`;
}

export default function TerminalScreen() {
  const [data, setData] = useState<GraphResp | null>(null);
  const [quotes, setQuotes] = useState<LtpResp>({});
  const [centre, setCentre] = useState('TMCV');
  const [input, setInput] = useState('TMCV');
  const [err, setErr] = useState<string | null>(null);
  const [notFound, setNotFound] = useState<string | null>(null);
  const [chips, setChips] = useState<string[]>([]);
  const [aiOn, setAiOn] = useState(false);
  const [generating, setGenerating] = useState<string | null>(null);
  const [genErr, setGenErr] = useState<string | null>(null);

  const loadQuotes = (g: GraphResp) => {
    const listed = Object.entries(g.companies)
      .filter(([, c]) => c.listed)
      .map(([t]) => t);
    api.ltp(listed).then((q) => setQuotes((prev) => ({ ...prev, ...q }))).catch(() => {});
  };

  useEffect(() => {
    (async () => {
      try {
        const g = await api.graph();
        setData(g);
        setChips(g.available);
        setAiOn(!!g.ai);
        loadQuotes(g);
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Failed to load graph');
      }
    })();
  }, []);

  // Centre a symbol: in the loaded graph → recentre; known to the backend
  // (curated or AI with a server key) → fetch its graph; else explain.
  const select = (raw: string) => {
    const sym = raw.trim().toUpperCase().replace(/^NSE:/, '');
    if (!sym || !data || generating) return;
    setNotFound(null);
    setGenErr(null);
    setInput(sym);
    if (data.companies[sym]) {
      setCentre(sym);
      return;
    }
    if (!aiOn && !chips.includes(sym)) {
      setNotFound(sym);
      return;
    }
    setGenerating(sym);
    api
      .graph(sym)
      .then((g) => {
        setData(g);
        setCentre(sym);
        loadQuotes(g);
      })
      .catch((e) => setGenErr(e instanceof Error ? e.message : 'Graph unavailable'))
      .finally(() => setGenerating(null));
  };

  const go = () => select(input);

  const html = useMemo(
    () => (data ? graphHtml(data, quotes, centre) : ''),
    [data, quotes, centre],
  );

  return (
    <View style={styles.container}>
      <View style={styles.head}>
        <Text style={styles.title}>
          TAUREYE TERMINAL{' '}
          <Text style={styles.titleDim}>
            · RELATIONSHIP GRAPH ·{' '}
            {data?.source === 'ai' ? 'AI GRAPH' : aiOn ? 'CURATED + AI' : 'DEMO DATA'}
          </Text>
        </Text>
      </View>
      <View style={styles.cmdRow}>
        <Text style={styles.prompt}>{'>'}</Text>
        <TextInput
          style={styles.cmd}
          value={input}
          onChangeText={setInput}
          onSubmitEditing={go}
          autoCapitalize="characters"
          autoCorrect={false}
          placeholder="TMCV"
          placeholderTextColor={theme.muted}
          returnKeyType="go"
        />
        <TouchableOpacity style={styles.goBtn} onPress={go}>
          <Text style={styles.goTxt}>GO</Text>
        </TouchableOpacity>
      </View>
      {data ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll} contentContainerStyle={styles.chips}>
          {chips.map((t) => (
            <TouchableOpacity
              key={t}
              style={[styles.chip, t === centre && styles.chipOn]}
              onPress={() => select(t)}
            >
              <Text style={[styles.chipTxt, t === centre && styles.chipTxtOn]}>{t}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      ) : null}
      {notFound ? (
        <Text style={styles.warn}>
          {notFound} isn't in the curated demo set — set ANTHROPIC_API_KEY on the server to unlock
          AI graphs for any company.
        </Text>
      ) : null}
      {genErr ? <Text style={styles.warn}>⚠ {genErr}</Text> : null}

      <View style={styles.graphWrap}>
        {err ? (
          <View style={styles.center}>
            <Text style={styles.dim}>{err} — is the backend reachable?</Text>
          </View>
        ) : generating ? (
          <View style={styles.center}>
            <ActivityIndicator color={theme.accent} />
            <Text style={styles.genTxt}>
              Generating relationship graph for {generating} — first time takes ~15s, then it's
              cached.
            </Text>
          </View>
        ) : !data ? (
          <View style={styles.center}>
            <ActivityIndicator color={theme.accent} />
          </View>
        ) : (
          <HtmlView
            key={centre + data.source + Object.keys(quotes).length}
            html={html}
            style={styles.web}
          />
        )}
      </View>
      {data ? <Text style={styles.disclaimer}>{data.disclaimer}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  head: { paddingHorizontal: 14, paddingTop: 12 },
  title: { color: theme.text, fontFamily: theme.mono, fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  titleDim: { color: theme.muted, fontWeight: '400' },
  cmdRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingTop: 10 },
  prompt: { color: theme.accent, fontFamily: theme.mono, fontSize: 16, fontWeight: '700' },
  cmd: {
    flex: 1,
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: 6,
    color: theme.text,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontFamily: theme.mono,
    fontSize: 14,
    letterSpacing: 1,
  },
  goBtn: { backgroundColor: theme.accent, borderRadius: 6, paddingHorizontal: 16, paddingVertical: 9 },
  goTxt: { color: theme.bg, fontFamily: theme.mono, fontWeight: '700', fontSize: 13 },
  chipScroll: { flexGrow: 0 },
  chips: { paddingHorizontal: 14, paddingVertical: 8, gap: 6 },
  chip: { borderColor: theme.border, borderWidth: 1, borderRadius: 4, paddingHorizontal: 8, paddingVertical: 3 },
  chipOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  chipTxt: { color: theme.muted2, fontFamily: theme.mono, fontSize: 10 },
  chipTxtOn: { color: theme.bg, fontWeight: '700' },
  warn: { color: theme.muted2, fontFamily: theme.mono, fontSize: 11, paddingHorizontal: 14, paddingBottom: 4 },
  graphWrap: { flex: 1, borderTopColor: theme.border, borderTopWidth: 1, marginTop: 4 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  dim: { color: theme.muted, fontFamily: theme.mono, fontSize: 12 },
  genTxt: {
    color: theme.muted2,
    fontFamily: theme.mono,
    fontSize: 11,
    marginTop: 12,
    paddingHorizontal: 30,
    textAlign: 'center',
  },
  web: { flex: 1, backgroundColor: theme.bg },
  disclaimer: {
    color: theme.muted,
    fontFamily: theme.mono,
    fontSize: 9,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderTopColor: theme.border,
    borderTopWidth: 1,
  },
});
