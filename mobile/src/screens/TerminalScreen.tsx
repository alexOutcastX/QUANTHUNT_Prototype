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
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE, GraphResp, LtpResp, api } from '../api';
import { resolveIndex } from '../indices';
import HtmlView from '../components/HtmlView';
import SymbolInput from '../components/SymbolInput';
import { getPalette, theme, useThemeMode } from '../theme';

// Self-contained Terminal workspace: d3-force relationship graph + a floating,
// draggable, resizable, closeable multi-tab window (company chart +
// screener.in fundamentals, and a comparison report). All interaction lives
// inside the frame; state persists to localStorage across frame rebuilds.
function graphHtml(data: GraphResp, quotes: LtpResp, centre: string, openIdx: string | null, autoWin: boolean, aiOn: boolean, canBack: boolean): string {
  // Resolved hex for the active mode — this HTML runs in its own iframe/WebView
  // document and can't read the page's CSS custom properties.
  const theme = getPalette();
  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<style>
  html,body{height:100%;margin:0;background:${theme.bg};font-family:ui-monospace,Menlo,Consolas,monospace;overflow:hidden}
  #wrap{display:flex;height:100%}
  #gfx{flex:1;position:relative;overflow:hidden;display:flex}
  #gwrap{flex:1;position:relative;overflow:hidden;min-width:120px;min-height:120px}
  svg{width:100%;height:100%;display:block;touch-action:none}
  #panel{width:330px;border-left:1px solid ${theme.border};overflow-y:auto;padding:16px;box-sizing:border-box}
  .aistat{font-size:11px;font-weight:700;letter-spacing:0.5px;padding:7px 10px;border-radius:6px;margin:0 0 12px;border:1px solid}
  .aistat.ok{color:${theme.green};border-color:${theme.green}55;background:${theme.green}14}
  .aistat.warn{color:#f5c518;border-color:#f5c51855;background:#f5c51814}
  .ph{color:${theme.text};font-size:16px;font-weight:700;margin:0 0 2px}
  .ps{color:${theme.muted};font-size:11px;margin:0 0 12px}
  .sec{color:${theme.muted2};font-size:11px;letter-spacing:1px;text-transform:uppercase;margin:14px 0 6px;border-bottom:1px solid ${theme.border};padding-bottom:4px}
  .edge{padding:9px 10px;border:1px solid ${theme.border};border-radius:6px;margin-bottom:6px;cursor:pointer}
  .edge:hover{border-color:${theme.border2}}
  .et{color:${theme.text};font-size:13px;font-weight:700}
  .en{color:${theme.muted2};font-size:12px;line-height:1.55;margin-top:3px}
  .conf{color:${theme.muted};font-size:10px;float:right}
  .price-up{fill:${theme.green}} .price-dn{fill:${theme.red}}
  #legend{position:absolute;right:10px;bottom:10px;color:${theme.muted};font-size:11px;line-height:1.9;background:${theme.bg}cc;padding:6px 10px;border:1px solid ${theme.border};border-radius:6px;z-index:5}
  .lg-line{display:inline-block;width:26px;height:0;border-top:2px solid ${theme.muted2};vertical-align:middle;margin-right:6px}
  /* Anchored bottom-left so it never sits under the top toolbar bar. */
  #crumb{position:absolute;bottom:10px;left:14px;color:${theme.muted};font-size:12px;z-index:5;background:${theme.bg}cc;padding:4px 9px;border-radius:6px;max-width:60%}
  #crumb b{color:${theme.text}}
  #hl{position:absolute;top:8px;right:10px;left:10px;z-index:5;display:flex;flex-wrap:wrap;gap:6px;justify-content:flex-end}
  .hlb{background:${theme.surface2};border:1px solid ${theme.border2};color:${theme.muted2};font-family:inherit;font-size:11px;letter-spacing:1px;padding:7px 12px;border-radius:999px;cursor:pointer}
  .hlb.on{background:${theme.accent};border-color:${theme.accent};color:${theme.bg};font-weight:700}
  .dim{opacity:0.12}
  #printhead{display:none}
  /* ── PDF / print export: keep the dark terminal look, drop the chrome ── */
  @media print {
    @page { size: A4 landscape; margin: 8mm; }
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    html, body, #wrap, #gfx, #gwrap, #panel { background: ${theme.bg} !important; }
    #news, #win, #hl, #menu, .wbtn, #crumb { display: none !important; }
    #wrap { display: block !important; height: auto !important; }
    #gfx { display: block !important; }
    #gwrap { height: 60vh !important; width: 100% !important; overflow: visible !important; }
    #panel { width: 100% !important; border-left: none !important; border-top: 1px solid ${theme.border} !important; overflow: visible !important; }
    #legend { position: static !important; display: inline-block; margin: 6px 0 }
    #printhead { display: block !important; color: ${theme.text}; font-size: 15px; font-weight: 700; letter-spacing: 1px; padding: 0 0 6px }
    #printhead span { color: ${theme.muted} }
  }
  #menu{position:absolute;z-index:30;background:${theme.surface};border:1px solid ${theme.border2};border-radius:8px;min-width:170px;display:none;box-shadow:0 8px 30px #000a}
  #menu div{padding:11px 15px;color:${theme.text};font-size:13px;cursor:pointer;border-bottom:1px solid ${theme.border}}
  #menu div:last-child{border-bottom:none}
  #menu div:hover{background:${theme.surface2}}
  #menu .mh{color:${theme.muted};font-size:11px;cursor:default;letter-spacing:1px}
  #menu .mh:hover{background:none}
  /* ── news panel ── */
  #news{width:312px;border-right:1px solid ${theme.border};display:none;flex-direction:column;overflow:hidden;flex:none}
  #newshead{display:flex;align-items:center;gap:2px;padding:6px 8px 6px 12px;border-bottom:1px solid ${theme.border};background:${theme.surface2}}
  #newstitle{color:${theme.text};font-size:12px;font-weight:700;letter-spacing:1px;flex:1}
  #newsmeta{color:${theme.muted};font-size:10px;padding:5px 12px;border-bottom:1px solid ${theme.border}}
  #newsbody{flex:1;overflow-y:auto}
  .nitem{padding:11px 14px;border-bottom:1px solid ${theme.border};cursor:pointer}
  .nitem:hover{background:${theme.surface2}}
  .nt{color:${theme.text};font-size:12px;line-height:1.55}
  .nm{color:${theme.muted};font-size:10px;margin-top:5px}
  .ntag{color:${theme.accent};font-weight:700}
  .wfull{position:absolute;top:8px;right:10px;z-index:5;background:${theme.surface2};border:1px solid ${theme.border2};color:${theme.muted2};font-size:10px;letter-spacing:1px;padding:4px 8px;border-radius:4px;cursor:pointer}
  .wfull:hover{color:${theme.text}}
  /* News/Chart tabs — hidden on desktop (chart stays in the window there),
     shown on phones where the chart becomes a tab of the news panel. */
  #newstabs{display:none;flex:1;gap:0}
  .ntab{padding:9px 16px;color:${theme.muted2};font-size:12px;font-weight:700;letter-spacing:1px;cursor:pointer;border-right:1px solid ${theme.border}}
  .ntab.on{color:${theme.text};background:${theme.surface}}
  #newschart{display:none;flex:1;overflow-y:auto}
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
  .wbtn{color:${theme.muted2};padding:8px 7px;cursor:pointer;font-size:13px;line-height:1}
  .wbtn:hover{color:${theme.text}}
  .wbtn.on{color:${theme.accent}}
  #winhead{display:flex;align-items:center;background:${theme.surface2};border-bottom:1px solid ${theme.border};cursor:move;user-select:none;padding:0 6px 0 0}
  #win.dockb #winhead,#win.dockr #winhead{cursor:default}
  #wintabs{display:flex;flex:1;overflow-x:auto;scrollbar-width:none}
  .wtab{padding:10px 12px;color:${theme.muted2};font-size:12px;cursor:pointer;border-right:1px solid ${theme.border};white-space:nowrap;display:flex;gap:7px;align-items:center}
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
  .fk{color:${theme.muted2};font-size:10px;letter-spacing:0.5px}
  .fv{color:${theme.text};font-size:13px;margin-top:2px}
  .fdesc{color:${theme.muted2};font-size:12px;line-height:1.6;padding:2px 12px 12px}
  .wmsg{color:${theme.muted};font-size:12px;padding:24px;text-align:center}
  table.cmp{border-collapse:collapse;width:100%;font-size:12px}
  table.cmp th,table.cmp td{border-bottom:1px solid ${theme.border};padding:6px 10px;text-align:right;color:${theme.text}}
  table.cmp th{color:${theme.muted2};font-size:11px;letter-spacing:0.5px;text-transform:uppercase}
  table.cmp td:first-child,table.cmp th:first-child{text-align:left;color:${theme.muted2}}
  tr.score td{font-weight:700;border-top:2px solid ${theme.border2};font-size:13px}
  .best{color:${theme.green} !important}
  .cmpnote{color:${theme.muted};font-size:10px;padding:8px 10px;line-height:1.5}
  table.idx{border-collapse:collapse;width:100%;font-size:12px}
  table.idx th{position:sticky;top:0;background:${theme.surface2};color:${theme.muted2};font-size:11px;letter-spacing:0.5px;text-transform:uppercase;padding:8px 10px;text-align:right;cursor:pointer;white-space:nowrap}
  table.idx th:first-child{text-align:left}
  table.idx td{border-bottom:1px solid ${theme.border};padding:8px 10px;text-align:right;color:${theme.text};white-space:nowrap}
  table.idx td:first-child{text-align:left}
  .isym{font-weight:700;cursor:pointer}
  .isym:hover{text-decoration:underline}
  .iact span{cursor:pointer;color:${theme.muted2};padding:0 4px}
  .iact span:hover{color:${theme.text}}
  /* ── phone layout: stack graph → chart window → news → details, and let the
     page scroll. The toolbar (with ⛶ FIT) stays overlaid on the graph. ── */
  @media (max-width: 720px) {
    html, body { overflow: auto; }
    #wrap { flex-direction: column; height: auto; min-height: 100%; }
    #gfx { order: 1; flex: none; display: flex; }
    #gwrap { height: 58vh; min-height: 300px; flex: none; width: 100%; }
    #news { order: 2; width: 100% !important; max-height: 45vh;
            border-right: none; border-top: 1px solid ${theme.border}; }
    #panel { order: 3; width: 100% !important; border-left: none;
             border-top: 1px solid ${theme.border}; overflow-y: visible; }
    #legend { display: none; }
    #crumb { display: none; }
    /* Toolbar is a single solid bar pinned across the top of the graph — one
       horizontal-scrolling row instead of pills wrapping over the nodes. */
    #hl { top: 0; left: 0; right: 0; justify-content: flex-start;
          flex-wrap: nowrap; overflow-x: auto; overflow-y: hidden;
          gap: 6px; padding: 7px 8px; -webkit-overflow-scrolling: touch;
          scrollbar-width: none; background: ${theme.surface}f2;
          border-bottom: 1px solid ${theme.border}; }
    #hl::-webkit-scrollbar { display: none; }
    .hlb { flex: none; }
    /* Chart is a tab of the news panel here — expose the tabs, drop the title. */
    #newstabs { display: flex; }
    #newstitle { display: none; }
    /* Floating/dock controls are meaningless on a phone (the window is always
       stacked under the graph) — hide the dock pins, keep ↗ open + ✕ close. */
    #win #dk-float, #win #dk-bottom, #win #dk-right { display: none; }
    /* The graph window is fixed, so the graph owns its touch gestures: one
       finger pans (moves the map), two fingers pinch-zoom. No scroll trap — the
       toolbar (FIT / RESET) and the NEWS/CHART tabs sit outside the graph. */
    svg { touch-action: none; }
  }
</style></head><body>
<div id="wrap">
  <div id="news">
    <div id="newshead">
      <div id="newstabs">
        <div class="ntab on" id="ntab-news" onclick="setNewsTab('news')">NEWS</div>
        <div class="ntab" id="ntab-chart" onclick="setNewsTab('chart')">CHART</div>
      </div>
      <span id="newstitle">NEWS</span>
      <div class="wbtn" id="news-upd" title="Update now" onclick="loadNews(true)">⟳</div>
      <div class="wbtn" title="Open in browser tab" onclick="openNews()">↗</div>
    </div>
    <div id="newsmeta"></div>
    <div id="newsbody"><div class="wmsg">Loading news…</div></div>
    <div id="newschart"></div>
  </div>
  <div id="gfx">
    <div id="gwrap">
      <div id="crumb"></div>
      <div id="printhead">TaurEye · Relationship Map — <span id="ph-centre"></span></div>
      <div id="hl">
        <button class="hlb" id="hl-back" onclick="goBack()" title="Back to the previous company" style="${canBack ? '' : 'display:none'}">‹ BACK</button>
        <button class="hlb" id="tg-news" onclick="toggleNews()">◧ NEWS</button>
        <button class="hlb" id="tg-win" onclick="toggleWin()">▤ CHART</button>
        <span style="width:8px"></span>
        <button class="hlb" id="hl-in" onclick="setHl('in')">◄ INPUTS</button>
        <button class="hlb" id="hl-out" onclick="setHl('out')">OUTPUTS ►</button>
        <button class="hlb" id="hl-group" onclick="setHl('group')">GROUP</button>
        <button class="hlb" id="hl-comp" onclick="setHl('comp')">RIVALS</button>
        <button class="hlb" id="hl-investors" onclick="setHl('investors')">INVESTORS</button>
        <button class="hlb" id="hl-invested" onclick="setHl('invested')">INVESTED</button>
        <button class="hlb on" id="hl-all" onclick="setHl('all')">ALL</button>
        <span style="width:8px"></span>
        <button class="hlb" id="hl-layout" onclick="setLayout()" title="Switch between web and clustered grid layout">▦ GRID</button>
        <button class="hlb" id="hl-fit" onclick="fitView()" title="Fit the graph to the screen (resets zoom/pan)">⛶ FIT</button>
        <button class="hlb" id="hl-reset" onclick="resetPos()" title="Reset bubble positions">⟲ RESET</button>
        <button class="hlb" id="hl-pdf" onclick="exportPDF()" title="Export this graph to PDF">⤓ PDF</button>
      </div>
      <svg id="svg"></svg>
      <div id="legend">
        <span class="lg-line" style="border-top:2px solid #3fb950"></span>input — supplies in →<br>
        <span class="lg-line" style="border-top:2px solid #f85149"></span>output — supplies out →<br>
        <span class="lg-line" style="border-top:2px dashed #f5c518"></span>group<br>
        <span class="lg-line" style="border-top:2px dashed #4f9dff"></span>invests → (investor→investee)<br>
        <span class="lg-line" style="border-top:2px dotted ${theme.muted}"></span>competitor
        <div style="margin-top:5px;color:${theme.muted2};font-size:10px">◄ inputs · outputs ► · drag to place · ⟲ reset</div>
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
  var OPENIDX = ${JSON.stringify(openIdx)};
  var AUTOWIN = ${JSON.stringify(!!autoWin)};
  var AION = ${JSON.stringify(!!aiOn)};
  var QUOTES = ${JSON.stringify(quotes)};
  var API = ${JSON.stringify(API_BASE)};
  var centre = ${JSON.stringify(centre)};
  var DASH = { supplies: null, group: '7,5', competitor: '2,5', finances: '11,4', invests: '2,3' };
  // Colour encodes flow DIRECTION relative to the centre only: inputs (things
  // that supply/finance the centre) are green, outputs (things the centre
  // supplies/finances) are red. Everything else (group, competitor, or links
  // between two neighbours) stays neutral grey — not colour-coded.
  var CIN = '#3fb950', COUT = '#f85149', CNEUTRAL = '${theme.muted}', CGROUP = '#f5c518', CINVEST = '#4f9dff';
  var svg = d3.select('#svg'), sim = null, hlMode = 'all';
  var linkSel = null, nodeSel = null;
  var histCache = {}, fundCache = {};

  // ── persisted workspace state (survives frame rebuilds) ──
  var W = { open: false, tabs: [], active: null, compare: [], rect: null, dock: 'float', dockH: 300, dockW: 400, newsOn: true, newsTab: 'news' };
  try { var s = localStorage.getItem('te_term_win_v1'); if (s) W = Object.assign(W, JSON.parse(s)); } catch (e) {}
  function saveW(){ try { localStorage.setItem('te_term_win_v1', JSON.stringify(W)); } catch (e) {} }
  // Phones: a floating window is unusable — dock the chart/compare window
  // under the graph so everything stacks vertically.
  var MOBILE = !!(window.matchMedia && window.matchMedia('(max-width: 720px)').matches);
  if (MOBILE && (W.dock || 'float') === 'float') W.dock = 'bottom';

  // Graph layout: 'web' (force-directed bubbles) or 'grid' (Bloomberg-style
  // rectangles clustered by relationship category). Persisted per device.
  var LAYOUT = 'web';
  try { LAYOUT = localStorage.getItem('te_term_layout_v1') || 'web'; } catch (e) {}
  window.setLayout = function(){
    LAYOUT = LAYOUT === 'grid' ? 'web' : 'grid';
    try { localStorage.setItem('te_term_layout_v1', LAYOUT); } catch (e) {}
    render();
  };

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

  var HL_MODES = ['all','in','out','group','comp','investors','invested'];
  window.setHl = function(mode) {
    hlMode = mode;
    HL_MODES.forEach(function(m){
      var b = document.getElementById('hl-' + m);
      if (b) b.className = 'hlb' + (m === mode ? ' on' : '');
    });
    applyHl();
  };
  function edgeIsIn(e){ return e.dst === centre && (e.type === 'supplies' || e.type === 'finances'); }
  function edgeIsOut(e){ return e.src === centre && (e.type === 'supplies' || e.type === 'finances'); }
  // Does an edge belong to the active filter? Type filters only count edges
  // that actually touch the centre.
  function edgeMatch(e){
    switch (hlMode) {
      case 'in': return edgeIsIn(e);
      case 'out': return edgeIsOut(e);
      case 'group': return e.type === 'group' && (e.src === centre || e.dst === centre);
      case 'comp': return e.type === 'competitor' && (e.src === centre || e.dst === centre);
      case 'investors': return e.type === 'invests' && e.dst === centre;   // who holds a stake in the centre
      case 'invested': return e.type === 'invests' && e.src === centre;    // what the centre holds a stake in
      default: return true; // 'all'
    }
  }
  function applyHl() {
    if (!linkSel) return;
    var keepNode = {}; keepNode[centre] = 1;
    linkSel.attr('class', function(d){
      var keep = hlMode === 'all' || edgeMatch(d.e);
      if (keep) { keepNode[d.e.src] = 1; keepNode[d.e.dst] = 1; }
      return keep ? '' : 'dim';
    });
    nodeSel.attr('class', function(d){ return (hlMode === 'all' || keepNode[d.id]) ? 'n' : 'n dim'; });
  }

  function panelHtml(c) {
    var comp = DATA.companies[c] || { name: c };
    var q = fmtPrice(c);
    // AI-key status: green when a key (server or the user's BYOK) is connected,
    // yellow warning when none — AI graphs for off-list companies need one.
    var h = AION
      ? '<div class="aistat ok">● API connected</div>'
      : '<div class="aistat warn">⚠ No API key connected</div>';
    h += '<p class="ph">' + comp.name + '</p><p class="ps">' + c +
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
    var hasEdges = E.some(function(e){ return e.src === c || e.dst === c; });
    if (!hasEdges) {
      var noMapMsg = AION
        ? 'No relationship map could be generated for this thinly-covered company. Its live chart, fundamentals and news are in the CHART tab and news panel.'
        : 'No relationship map for this company yet. Its live chart, fundamentals and news are in the CHART tab and news panel. Add an AI key (⚙ AI KEY) to generate one.';
      h += '<div class="en" style="border:1px solid ${theme.border};border-radius:6px;padding:9px 10px;margin-top:8px">' + noMapMsg + '</div>';
    }
    h += block('Suppliers', E.filter(function(e){ return e.dst === c && e.type === 'supplies'; }), function(e){ return e.src; });
    h += block('Customers / demand', E.filter(function(e){ return e.src === c && e.type === 'supplies'; }), function(e){ return e.dst; });
    h += block('Financiers', E.filter(function(e){ return e.dst === c && e.type === 'finances'; }), function(e){ return e.src; });
    h += block('Finances purchases of', E.filter(function(e){ return e.src === c && e.type === 'finances'; }), function(e){ return e.dst; });
    h += block('Investors', E.filter(function(e){ return e.dst === c && e.type === 'invests'; }), function(e){ return e.src; });
    h += block('Holdings / investments', E.filter(function(e){ return e.src === c && e.type === 'invests'; }), function(e){ return e.dst; });
    h += block('Competitors', E.filter(function(e){ return e.type === 'competitor' && (e.src === c || e.dst === c); }), function(e){ return e.src === c ? e.dst : e.src; });
    h += block('Group', E.filter(function(e){ return e.type === 'group' && (e.src === c || e.dst === c); }), function(e){ return e.src === c ? e.dst : e.src; });
    document.getElementById('panel').innerHTML = h;
  }

  window.recentre = function(id) {
    // Route through the host so it fetches the target's OWN full graph, rather
    // than re-rendering a sparse subgraph from the current (stale) dataset.
    hideMenu();
    toApp('te:graph:' + id);
  };
  // Step back to the previously-centred company (the host keeps the history).
  window.goBack = function(){ hideMenu(); toApp('te:back'); };

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
    m.style.zIndex = 40;
  }
  window.hideMenu = function(){ document.getElementById('menu').style.display = 'none'; };
  document.getElementById('svg').addEventListener('click', function(ev){ if (ev.target.tagName === 'svg') hideMenu(); });

  function render() {
    var g = subgraph(centre);
    document.getElementById('crumb').innerHTML = 'centre: <b>' + centre + '</b> · click a node for options';
    var lb = document.getElementById('hl-layout');
    if (lb) lb.textContent = LAYOUT === 'grid' ? '⦿ WEB' : '▦ GRID';
    panelHtml(centre);
    if (sim) sim.stop();
    svg.selectAll('*').remove();
    var Wd = document.getElementById('gwrap').clientWidth, H = document.getElementById('gwrap').clientHeight;
    var root = svg.append('g');
    // Centre of the graph's bounding box in layout coordinates.
    function bounds(){
      var xs = g.nodes.map(function(n){ return n.x || 0; }), ys = g.nodes.map(function(n){ return n.y || 0; });
      return { cx: (Math.min.apply(null, xs) + Math.max.apply(null, xs)) / 2,
               cy: (Math.min.apply(null, ys) + Math.max.apply(null, ys)) / 2 };
    }
    var zoomB = d3.zoom().scaleExtent([0.35, 2.5])
      // The graph window is fixed, so the graph owns its gestures everywhere:
      // one finger / left-drag pans the map, two fingers / wheel zoom. FIT and
      // RESET stay on the toolbar as the escape hatches. (Node-dragging is
      // desktop-only, so a one-finger pan never fights a bubble drag on mobile.)
      .filter(function(ev){
        if (!MOBILE) return !ev.ctrlKey && !ev.button;
        if (ev.type === 'wheel') return true;
        var t = ev.touches;
        return !!(t && t.length >= 1);
      })
      .on('zoom', function(ev){ root.attr('transform', ev.transform); });
    svg.call(zoomB);
    // Zoom out to fit once forces settle, so no node ends up off-canvas when
    // the news panel / docked window shrink the graph area. Zoom-out only on
    // the automatic pass; force=true (the ⛶ FIT button) always applies, which
    // also rescues a pinch-zoomed view on mobile.
    var fitted = false;
    function fitAll(force) {
      if ((fitted && !force) || !g.nodes.length) return;
      fitted = true;
      var xs = g.nodes.map(function(n){ return n.x; }), ys = g.nodes.map(function(n){ return n.y; });
      var minX = Math.min.apply(null, xs) - 70, maxX = Math.max.apply(null, xs) + 70;
      var minY = Math.min.apply(null, ys) - 60, maxY = Math.max.apply(null, ys) + 70;
      var Wn = document.getElementById('gwrap').clientWidth || Wd;
      var Hn = document.getElementById('gwrap').clientHeight || H;
      var k = Math.min(1, 0.95 * Math.min(Wn / (maxX - minX), Hn / (maxY - minY)));
      if (!isFinite(k) || k <= 0) return;
      if (!force && k >= 1) return;
      k = Math.max(0.35, Math.min(1, k));
      var t = d3.zoomIdentity.translate(Wn / 2 - k * (minX + maxX) / 2, Hn / 2 - k * (minY + maxY) / 2).scale(k);
      svg.transition().duration(250).call(zoomB.transform, t);
    }
    setTimeout(fitAll, 900);
    // Always-available reset of pan/zoom (toolbar stays on screen while the
    // SVG itself is zoomed, so this is the escape hatch on touch devices).
    window.fitView = function(){ fitAll(true); };
    var defs = svg.append('defs');
    // Arrowheads match the flow direction: green in, red out, grey otherwise.
    // Fixed px size (userSpaceOnUse) with the tip at the line end — the line is
    // shortened to the target's edge in the tick handler so arrows never clip
    // behind the bubble regardless of node size or stroke width.
    [['in', CIN], ['out', COUT], ['n', CNEUTRAL], ['inv', CINVEST]].forEach(function(m){
      defs.append('marker').attr('id','arr-'+m[0])
        .attr('viewBox','0 0 10 10').attr('refX', 9).attr('refY', 5)
        .attr('markerWidth', 7).attr('markerHeight', 7)
        .attr('markerUnits','userSpaceOnUse').attr('orient','auto')
        .append('path').attr('d','M0,1L9,5L0,9L2.6,5Z').attr('fill', m[1]);
    });
    function edgeColor(e){
      if (e.type === 'invests') return CINVEST;
      return edgeIsIn(e) ? CIN : edgeIsOut(e) ? COUT : (e.type === 'group' ? CGROUP : CNEUTRAL);
    }
    function nodeR(d){ return d.id === centre ? 29 : 20; }
    // Nodes in the same corporate group as the centre (linked by a group edge).
    var groupSet = {};
    DATA.edges.forEach(function(e){
      if (e.type !== 'group') return;
      if (e.src === centre) groupSet[e.dst] = 1;
      else if (e.dst === centre) groupSet[e.src] = 1;
    });

    // Draw flow edges LAST so a red/green arrow isn't hidden under a gold
    // group dash when the same pair has both relationships.
    g.links.sort(function(a, b){
      function pri(e){ return (edgeIsIn(e) || edgeIsOut(e)) ? 3 : e.type === 'invests' ? 2 : e.type === 'group' ? 1 : 0; }
      return pri(a.e) - pri(b.e);
    });
    linkSel = root.selectAll('line').data(g.links).enter().append('line')
      .attr('stroke', function(d){ return edgeColor(d.e); })
      .attr('stroke-width', function(d){ return d.e.confidence === 'high' ? 2.2 : 1.4; })
      .attr('stroke-opacity', function(d){ return (edgeIsIn(d.e) || edgeIsOut(d.e)) ? 0.9 : (d.e.type === 'group' || d.e.type === 'invests') ? 0.85 : 0.5; })
      .attr('stroke-dasharray', function(d){ return DASH[d.e.type]; })
      .attr('marker-end', function(d){
        if (d.e.type === 'invests') return 'url(#arr-inv)';
        if (edgeIsIn(d.e)) return 'url(#arr-in)';
        if (edgeIsOut(d.e)) return 'url(#arr-out)';
        return (d.e.type === 'supplies' || d.e.type === 'finances') ? 'url(#arr-n)' : null; });

    nodeSel = root.selectAll('g.n').data(g.nodes).enter().append('g').attr('class','n')
      .style('cursor','pointer')
      .on('click', function(ev,d){ ev.stopPropagation(); showMenu(d, ev.offsetX != null ? ev.offsetX : 40, ev.offsetY != null ? ev.offsetY : 40); });
    if (LAYOUT !== 'grid' && !MOBILE) {
      // Free drag only in the force layout on desktop — on phones a finger on
      // a bubble must scroll the page, and grid positions are fixed clusters.
      nodeSel.call(d3.drag()
        .on('start', function(ev,d){ if(!ev.active) sim.alphaTarget(0.15).restart(); d.fx=d.x; d.fy=d.y; })
        .on('drag', function(ev,d){ d.fx=ev.x; d.fy=ev.y; d.pinned=true; })
        // Keep fx/fy after release so a bubble stays exactly where it was dropped.
        .on('end', function(ev,d){ if(!ev.active) sim.alphaTarget(0); }));
    }

    // Fit the ticker inside the bubble: shrink the font for longer symbols and
    // truncate anything that still won't fit (full name is in the side panel).
    function symFont(id, isC){
      var n = (id || '').length;
      if (isC) return n >= 10 ? 9 : n >= 8 ? 10.5 : n >= 6 ? 12.5 : 14.5;
      return n >= 8 ? 6.8 : n >= 7 ? 7.5 : n >= 6 ? 8.4 : n >= 5 ? 9.6 : 11;
    }
    function symText(id, isC){
      var max = isC ? 12 : 9;
      id = id || '';
      return id.length > max ? id.slice(0, max - 1) + '…' : id;
    }
    function nodeStroke(d){ return d.id === centre ? '${theme.accent}' : (groupSet[d.id] ? CGROUP : (d.listed ? '${theme.border2}' : '${theme.border}')); }
    function nodeStrokeW(d){ return d.id === centre ? 2.5 : (groupSet[d.id] ? 2.4 : 1.5); }
    function rectW(d){ return d.id === centre ? 128 : 106; }
    function rectH(d){ return d.id === centre ? 42 : 36; }
    if (LAYOUT === 'grid') {
      // Bloomberg-style rectangle tiles: ticker on top, live price inside.
      nodeSel.append('rect')
        .attr('x', function(d){ return -rectW(d)/2; }).attr('y', function(d){ return -rectH(d)/2; })
        .attr('width', rectW).attr('height', rectH).attr('rx', 6)
        .attr('fill', '${theme.surface2}')
        .attr('stroke', nodeStroke).attr('stroke-width', nodeStrokeW);
      nodeSel.append('text').text(function(d){ var id=d.id||''; return id.length>13 ? id.slice(0,12)+'…' : id; })
        .attr('text-anchor','middle').attr('dy', function(d){ var q = fmtPrice(d.id); return q ? -3 : 4; })
        .attr('fill', function(d){ return d.listed ? '${theme.text}' : '${theme.muted}'; })
        .attr('font-size', function(d){ return d.id === centre ? 11.5 : 10; })
        .attr('font-weight', 700).style('pointer-events','none');
      nodeSel.append('text').text(function(d){ var q = fmtPrice(d.id); return q ? q.txt : ''; })
        .attr('text-anchor','middle').attr('dy', 12)
        .attr('class', function(d){ var q = fmtPrice(d.id); return q && q.up ? 'price-up' : 'price-dn'; })
        .attr('font-size', 9).style('pointer-events','none');
    } else {
    nodeSel.append('circle')
      .attr('r', function(d){ return d.id === centre ? 29 : 20; })
      .attr('fill', '${theme.surface2}')
      .attr('stroke', nodeStroke)
      .attr('stroke-width', nodeStrokeW);
    // Company symbol inside the bubble.
    nodeSel.append('text').text(function(d){ return symText(d.id, d.id === centre); })
      .attr('text-anchor','middle').attr('dy', 4)
      .attr('fill', function(d){ return d.listed ? '${theme.text}' : '${theme.muted}'; })
      .attr('font-size', function(d){ return symFont(d.id, d.id === centre); })
      .attr('font-weight', 700).style('pointer-events','none');
    // Live price under the bubble.
    nodeSel.append('text').text(function(d){ var q = fmtPrice(d.id); return q ? q.txt : ''; })
      .attr('text-anchor','middle').attr('dy', function(d){ return d.id === centre ? 45 : 35; })
      .attr('class', function(d){ var q = fmtPrice(d.id); return q && q.up ? 'price-up' : 'price-dn'; })
      .attr('font-size', 10).style('pointer-events','none');
    }

    // Directional layout: suppliers (INPUTS) settle on the left, customers
    // (OUTPUTS) on the right, with the pinned centre in the middle. Nodes that
    // are neither flow direction (group/competitor only, or both) stay central.
    function sideOf(id){
      if (id === centre) return 0;
      var isIn = false, isOut = false;
      DATA.edges.forEach(function(e){
        // supplies/finances flow, plus investment (investor→investee capital flow)
        if (e.type !== 'supplies' && e.type !== 'finances' && e.type !== 'invests') return;
        if (e.src === id && e.dst === centre) isIn = true;   // id supplies/invests-in centre → left
        if (e.src === centre && e.dst === id) isOut = true;  // centre supplies/invests-in id → right
      });
      return (isIn && !isOut) ? -1 : (isOut && !isIn) ? 1 : 0;
    }
    g.nodes.forEach(function(n){ n.side = sideOf(n.id); });
    var cnode = g.nodes.find(function(n){ return n.id === centre; });

    function applyPos(){
      // End the line just outside the target node so the arrowhead is fully
      // visible; also pull the start off the source node a touch.
      linkSel.attr('x1', function(d){ return trim(d, true).x; })
             .attr('y1', function(d){ return trim(d, true).y; })
             .attr('x2', function(d){ return trim(d, false).x; })
             .attr('y2', function(d){ return trim(d, false).y; });
      nodeSel.attr('transform', function(d){ return 'translate(' + d.x + ',' + d.y + ')'; });
    }
    // Distance from a node's centre to its outline along direction (ux,uy) —
    // circles in web layout, rectangles in grid layout.
    function clearance(d, ux, uy){
      if (LAYOUT !== 'grid') return nodeR(d);
      var hw = rectW(d)/2 + 3, hh = rectH(d)/2 + 3;
      var sx = Math.abs(ux) < 1e-6 ? Infinity : hw / Math.abs(ux);
      var sy = Math.abs(uy) < 1e-6 ? Infinity : hh / Math.abs(uy);
      return Math.min(sx, sy);
    }
    function trim(d, atSource){
      var s = d.source, t = d.target;
      var dx = t.x - s.x, dy = t.y - s.y, len = Math.sqrt(dx*dx + dy*dy) || 1;
      var ux = dx/len, uy = dy/len;
      if (atSource){ var r = clearance(s, ux, uy) + 2; return { x: s.x + ux*r, y: s.y + uy*r }; }
      var gap = clearance(t, ux, uy) + 6;   // leave room for the arrowhead
      return { x: t.x - ux*gap, y: t.y - uy*gap };
    }

    if (LAYOUT === 'grid') {
      // ── Bloomberg-style clustered grid: fixed zones per relationship type —
      // suppliers+investors stacked left, customers+holdings right, group row
      // on top, competitors along the bottom. No physics, no drag.
      // Resolve link endpoints to node objects (forceLink does this in web mode).
      var byId = {};
      g.nodes.forEach(function(n){ byId[n.id] = n; });
      g.links.forEach(function(l){
        if (typeof l.source === 'string') l.source = byId[l.source];
        if (typeof l.target === 'string') l.target = byId[l.target];
      });
      var cats = { sup: [], inv: [], cust: [], hold: [], grp: [], comp: [] };
      function catOf(id){
        var f = {};
        DATA.edges.forEach(function(e){
          var toC = e.dst === centre && e.src === id, fromC = e.src === centre && e.dst === id;
          if (!toC && !fromC) return;
          if (e.type === 'supplies' || e.type === 'finances') f[toC ? 'sup' : 'cust'] = 1;
          else if (e.type === 'invests') f[toC ? 'inv' : 'hold'] = 1;
          else if (e.type === 'group') f.grp = 1;
          else f.comp = 1;
        });
        return f.sup ? 'sup' : f.cust ? 'cust' : f.inv ? 'inv' : f.hold ? 'hold' : f.grp ? 'grp' : 'comp';
      }
      g.nodes.forEach(function(n){ if (n.id !== centre) cats[catOf(n.id)].push(n); });
      var cx = Wd / 2, cy = H / 2, RW = 122, RH = 48, zlabels = [];
      if (cnode) { cnode.x = cnode.fx = cx; cnode.y = cnode.fy = cy; }
      function stack(sections, x0){   // labelled vertical blocks, centred on cy
        var rows = 0;
        sections.forEach(function(S){ if (S.items.length) rows += S.items.length + 1; });
        if (!rows) return;
        var y = cy - (rows - 1) * RH / 2;
        sections.forEach(function(S){
          if (!S.items.length) return;
          zlabels.push({ x: x0, y: y - 8, t: S.label });
          y += RH * 0.55;
          S.items.forEach(function(n){ n.x = n.fx = x0; n.y = n.fy = y; y += RH; });
          y += RH * 0.45;
        });
      }
      var off = Math.max(250, Math.min(Wd * 0.36, 400));
      stack([{ label: 'SUPPLIERS', items: cats.sup }, { label: 'INVESTORS', items: cats.inv }], cx - off);
      stack([{ label: 'CUSTOMERS', items: cats.cust }, { label: 'HOLDINGS', items: cats.hold }], cx + off);
      var half = 0;
      g.nodes.forEach(function(n){ if (n.id !== centre) half = Math.max(half, Math.abs((n.y || cy) - cy)); });
      function hrow(list, y0, label, up){   // labelled horizontal band, wraps
        if (!list.length) return;
        var per = Math.max(2, Math.floor((Wd + 260) / RW));
        zlabels.push({ x: cx, y: y0 - (up ? (Math.ceil(list.length / per) - 1) * RH : 0) - 32, t: label });
        list.forEach(function(n, i){
          var r = Math.floor(i / per), inRow = Math.min(per, list.length - r * per);
          n.x = n.fx = cx - (inRow - 1) * RW / 2 + (i % per) * RW;
          n.y = n.fy = y0 + (up ? -r * RH : r * RH);
        });
      }
      hrow(cats.grp,  cy - half - 120, 'GROUP', true);
      hrow(cats.comp, cy + half + 120, 'COMPETITORS', false);
      zlabels.forEach(function(L){
        root.append('text').text(L.t).attr('x', L.x).attr('y', L.y)
          .attr('text-anchor', 'middle').attr('fill', '${theme.muted}')
          .attr('font-size', 10).attr('letter-spacing', 2);
      });
      applyPos();
      setTimeout(function(){ fitAll(true); }, 60);
    } else {
      if (cnode) { cnode.fx = Wd/2; cnode.fy = H/2; }   // pin the centre
      sim = d3.forceSimulation(g.nodes)
        .force('link', d3.forceLink(g.links).id(function(d){ return d.id; }).distance(150))
        .force('charge', d3.forceManyBody().strength(-620))
        .force('x', d3.forceX(function(d){ return Wd/2 + d.side * Wd * 0.30; })
                      .strength(function(d){ return d.side === 0 ? 0.02 : 0.28; }))
        .force('y', d3.forceY(H/2).strength(0.04))
        .force('collide', d3.forceCollide(46))
        .on('tick', applyPos);
    }
    applyHl();
  }

  // Export the current relationship map to PDF via the browser's print dialog
  // ("Save as PDF"). Print CSS keeps the dark look and drops the toolbar/chart.
  window.exportPDF = function(){
    try {
      var ph = document.getElementById('ph-centre');
      if (ph) ph.textContent = (DATA.companies[centre] || {}).name || centre;
    } catch (e) {}
    window.focus();
    window.print();
  };

  // Clear all manual placements (and re-pin the centre), then re-run the layout.
  window.resetPos = function(){
    if (LAYOUT === 'grid') { render(); return; }   // grid positions are fixed
    if (!sim || !nodeSel) return;
    var Wd = document.getElementById('gwrap').clientWidth || 800;
    var H  = document.getElementById('gwrap').clientHeight || 600;
    nodeSel.each(function(d){
      if (d.id === centre) { d.fx = Wd/2; d.fy = H/2; }
      else { d.fx = null; d.fy = null; d.pinned = false; }
    });
    sim.alpha(0.9).restart();
  };

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
      : (isIdxTab(id)
        ? 'research.html?view=index&name=' + encodeURIComponent(id.slice(4))
        : 'research.html?symbol=' + encodeURIComponent(id));
    var url = (API || '') + '/' + u;
    try { window.open(url, '_blank'); } catch (e) {}
  };
  window.closeWin = function(){ W.open = false; saveW(); layoutWin(); if ((W.dock||'float') !== 'float') render(); };
  // Full chart for a company tab → standalone browser tab.
  window.openFullChart = function(sym) {
    var url = (API || '') + '/research.html?view=chart&symbol=' + encodeURIComponent(sym);
    try { window.open(url, '_blank'); } catch (e) {}
  };

  // ── message channel to the host app (web iframe + native webview) ──
  function toApp(msg) {
    try {
      if (window.ReactNativeWebView) { window.ReactNativeWebView.postMessage(msg); return; }
      if (window.parent && window.parent !== window) window.parent.postMessage(msg, '*');
    } catch (e) {}
  }

  // ════ index browser tabs (the Terminal's market browser) ════
  var idxCache = {};   // name -> { rows: [...], sortK, sortDir }
  function isIdxTab(t){ return t && t.indexOf('idx:') === 0; }
  window.openIdxTab = function(name) {
    var id = 'idx:' + name;
    if (W.tabs.indexOf(id) < 0) W.tabs.push(id);
    var wasOpen = W.open;
    W.active = id; W.open = true; if (!W.rect) W.rect = defaultRect();
    saveW(); layoutWin(); renderTabs(); renderBody();
    if (!wasOpen && (W.dock||'float') !== 'float') render();
  };
  window.idxGraph = function(sym){ toApp('te:graph:' + sym); };
  window.idxSort = function(name, k) {
    var st = idxCache[name];
    if (!st) return;
    if (st.sortK === k) st.sortDir = -st.sortDir; else { st.sortK = k; st.sortDir = k === 'symbol' ? 1 : -1; }
    drawIndex(name);
  };
  function heat(chg) {
    if (chg == null) return '';
    var a = Math.min(0.22, Math.abs(chg) / 6 * 0.22).toFixed(3);
    return 'background:rgba(' + (chg >= 0 ? '34,201,147' : '244,88,122') + ',' + a + ')';
  }
  function drawIndex(name) {
    var st = idxCache[name];
    var body = document.getElementById('winbody');
    if (!st || W.active !== 'idx:' + name) return;
    var rows = st.rows.slice();
    var k = st.sortK, dir = st.sortDir;
    rows.sort(function(a, b) {
      if (k === 'symbol') return a.symbol.localeCompare(b.symbol) * dir;
      var va = a[k] == null ? -Infinity : a[k], vb = b[k] == null ? -Infinity : b[k];
      return (va - vb) * dir;
    });
    var seg = st.seg;
    var cols = [['symbol','SYMBOL'],['price','CMP'],['chg','CHG%'],['ret1y','1Y'],['ret3y','3Y'],['ret5y','5Y']];
    if (seg) cols.splice(1, 0, ['mcap','MCAP CR']);
    var h = '<table class="idx"><tr>';
    cols.forEach(function(c){
      h += '<th onclick="idxSort(\\'' + name + '\\',\\'' + c[0] + '\\')">' + c[1] +
           (st.sortK === c[0] ? (st.sortDir === 1 ? ' ↑' : ' ↓') : '') + '</th>';
    });
    h += '<th></th></tr>';
    var num = function(v, d){ return v == null ? '—' : (+v).toFixed(d == null ? 1 : d); };
    var pcts = function(v){ return v == null ? '—' : (v >= 0 ? '+' : '') + (+v).toFixed(1) + '%'; };
    rows.forEach(function(r) {
      h += '<tr style="' + heat(r.chg) + '">' +
        '<td class="isym" onclick="idxGraph(\\'' + r.symbol + '\\')" title="Open relationship graph">' + r.symbol + '</td>' +
        (seg ? '<td>' + (r.mcap != null ? Math.round(r.mcap).toLocaleString('en-IN') : '—') + '</td>' : '') +
        '<td>' + num(r.price) + '</td>' +
        '<td style="color:' + (r.chg == null ? '${theme.muted}' : r.chg >= 0 ? '${theme.green}' : '${theme.red}') + '">' + pcts(r.chg) + '</td>' +
        '<td>' + pcts(r.ret1y) + '</td><td>' + pcts(r.ret3y) + '</td><td>' + pcts(r.ret5y) + '</td>' +
        '<td class="iact">' +
          '<span title="Open in window" onclick="openTab(\\'' + r.symbol + '\\')">▤</span>' +
          '<span title="Add to compare" onclick="toggleCompare(\\'' + r.symbol + '\\')">⇄</span>' +
        '</td></tr>';
    });
    h += '</table>';
    if (st.note) h += '<div class="cmpnote">' + st.note + '</div>';
    body.innerHTML = h;
  }
  function loadReturns(name, syms) {
    // /returns caps at 50 per call; fetch the first 100 rows in two batches.
    var batches = [syms.slice(0, 50), syms.slice(50, 100)].filter(function(b){ return b.length; });
    var done = 0;
    batches.forEach(function(b) {
      fetch(API + '/returns?symbols=' + encodeURIComponent(b.join(',')))
        .then(function(r){ return r.json(); })
        .then(function(d) {
          var st = idxCache[name];
          if (!st) return;
          st.rows.forEach(function(row) {
            if (d[row.symbol]) { row.ret1y = d[row.symbol].ret1y; row.ret3y = d[row.symbol].ret3y; row.ret5y = d[row.symbol].ret5y; }
          });
          done++;
          if (done === batches.length && syms.length > 100) st.note = 'Returns loaded for the first 100 rows.';
          drawIndex(name);
        })
        .catch(function(){});
    });
  }
  var SEGBANDS = { 'LARGE CAP': [0, 100], 'MID CAP': [100, 250], 'SMALL CAP': [250, 1e9] };
  function renderIndex(name) {
    var body = document.getElementById('winbody');
    if (idxCache[name]) { drawIndex(name); return; }
    var seg = !!SEGBANDS[name];
    body.innerHTML = '<div class="wmsg">Loading ' + name + (seg ? ' — classifying the NIFTY 500 by market cap…' : ' constituents…') + '</div>';
    fetch(API + '/index?name=' + encodeURIComponent(seg ? 'NIFTY 500' : name))
      .then(function(r){ return r.json(); })
      .then(function(d) {
        var rows = (d.data || []).map(function(c){ return { symbol: c.symbol, price: c.price, chg: c.chg }; });
        if (!rows.length) { body.innerHTML = '<div class="wmsg">No constituents right now — sources may be briefly unavailable.</div>'; return; }
        if (!seg) {
          idxCache[name] = { rows: rows, sortK: 'chg', sortDir: -1, seg: false };
          drawIndex(name);
          loadReturns(name, rows.map(function(r){ return r.symbol; }));
          return;
        }
        // segment: need market caps to rank
        var syms = rows.map(function(r){ return r.symbol; });
        function classify(mcaps) {
          var withCap = rows.map(function(r){
            var f = mcaps[r.symbol];
            return Object.assign({}, r, { mcap: f && f.market_cap_cr != null ? f.market_cap_cr : null });
          }).filter(function(r){ return r.mcap != null; })
            .sort(function(a, b){ return b.mcap - a.mcap; });
          var band = SEGBANDS[name];
          var out = withCap.slice(band[0], Math.min(band[1], withCap.length));
          if (!out.length) { body.innerHTML = '<div class="wmsg">Market caps unavailable right now — try again shortly.</div>'; return; }
          idxCache[name] = { rows: out, sortK: 'mcap', sortDir: -1, seg: true };
          drawIndex(name);
          loadReturns(name, out.map(function(r){ return r.symbol; }));
        }
        var mcaps = {};
        function poll(list, round) {
          fetch(API + '/fundamentals/bulk?symbols=' + encodeURIComponent(list.join(',')))
            .then(function(r){ return r.json(); })
            .then(function(d) {
              Object.assign(mcaps, d.data || {});
              if (d.pending && d.pending.length && round < 8) setTimeout(function(){ poll(d.pending, round + 1); }, 3000);
              else classify(mcaps);
            })
            .catch(function(){ classify(mcaps); });
        }
        poll(syms, 0);
      })
      .catch(function(){ body.innerHTML = '<div class="wmsg">Couldn\\'t load ' + name + ' — is the backend reachable?</div>'; });
  }

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
  // ── toolbar toggles: news panel + chart ──
  // On phones NEWS/CHART select the two tabs of the news panel; on desktop they
  // toggle the news panel and the floating chart window respectively.
  function updateToggles() {
    var tn = document.getElementById('tg-news'), tw = document.getElementById('tg-win');
    if (MOBILE) {
      if (tn) tn.className = 'hlb' + (W.newsTab !== 'chart' ? ' on' : '');
      if (tw) tw.className = 'hlb' + (W.newsTab === 'chart' ? ' on' : '');
      return;
    }
    if (tn) tn.className = 'hlb' + (W.newsOn ? ' on' : '');
    if (tw) tw.className = 'hlb' + (W.open ? ' on' : '');
  }
  function scrollNewsIntoView() {
    try { document.getElementById('news').scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) {}
  }
  window.toggleNews = function() {
    if (MOBILE) { window.setNewsTab('news'); scrollNewsIntoView(); return; }
    W.newsOn = !W.newsOn; saveW(); layoutNews(); render();
    if (W.newsOn) loadNews(false);
  };
  window.toggleWin = function() {
    if (MOBILE) { window.setNewsTab('chart'); scrollNewsIntoView(); return; }
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
      var label = t === '__cmp__' ? 'COMPARE (' + W.compare.length + ')' : (isIdxTab(t) ? '∿ ' + t.slice(4) : t);
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

  // ── company view: chart + screener.in fundamentals ──
  // Rendered into any container (the floating window's body on desktop, or the
  // news panel's CHART tab on phones). active() guards async writes so a stale
  // response can't overwrite a view the user has since switched away from.
  function renderCompanyInto(sym, body, active) {
    if (!body) return;
    body.innerHTML = '<div style="position:relative"><div class="wchart"></div>' +
      '<div class="wfull" title="Open full chart in browser tab" onclick="openFullChart(\\'' + sym + '\\')">⛶ FULL CHART</div></div>' +
      '<div class="wf"><div class="wmsg">Loading fundamentals…</div></div>';
    // chart
    var mount = body.querySelector('.wchart'), fnode = body.querySelector('.wf');
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
        .then(function(d){ if (!active()) return; if (d && d.candles && d.candles.length) { histCache[sym] = d.candles; drawChart(d.candles); } else mount.innerHTML = '<div class="wmsg">No chart data</div>'; })
        .catch(function(){ if (active()) mount.innerHTML = '<div class="wmsg">Chart unavailable</div>'; });
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
      fnode.innerHTML = h;
    }
    if (fundCache[sym]) drawFund(fundCache[sym]);
    else fetch(API + '/fundamentals?symbol=' + encodeURIComponent(sym))
      .then(function(r){ return r.json(); })
      .then(function(f){ if (f && !f.error) { fundCache[sym] = f; if (active()) drawFund(f); } else if (active()) fnode.innerHTML = '<div class="wmsg">Fundamentals unavailable</div>'; })
      .catch(function(){ if (active()) fnode.innerHTML = '<div class="wmsg">Fundamentals unavailable</div>'; });
  }
  function renderCompany(sym) {
    renderCompanyInto(sym, document.getElementById('winbody'), function(){ return W.active === sym; });
  }
  // Phones: the CHART tab of the news panel shows the centre company's chart.
  function renderNewsChart() {
    if (!centre) return;
    renderCompanyInto(centre, document.getElementById('newschart'),
      function(){ return W.newsTab === 'chart'; });
  }
  window.setNewsTab = function(t) {
    W.newsTab = t; saveW();
    var isChart = t === 'chart';
    var body = document.getElementById('newsbody'), chart = document.getElementById('newschart'), meta = document.getElementById('newsmeta'), upd = document.getElementById('news-upd');
    if (body) body.style.display = isChart ? 'none' : '';
    if (chart) chart.style.display = isChart ? 'block' : 'none';
    if (meta) meta.style.display = isChart ? 'none' : '';
    if (upd) upd.style.display = isChart ? 'none' : '';
    var tn = document.getElementById('ntab-news'), tc = document.getElementById('ntab-chart');
    if (tn) tn.className = 'ntab' + (isChart ? '' : ' on');
    if (tc) tc.className = 'ntab' + (isChart ? ' on' : '');
    updateToggles();
    if (isChart) renderNewsChart(); else loadNews(false);
  };

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
    if (W.active === '__cmp__') renderCompare();
    else if (isIdxTab(W.active)) renderIndex(W.active.slice(4));
    else renderCompany(W.active);
  }

  // Phones: the news panel is always visible and hosts the chart as a tab —
  // never leave it collapsed.
  if (MOBILE) W.newsOn = true;
  layoutNews();
  render();
  if (AUTOWIN) {
    // Minimal graph (no relationship edges): show the company's workspace so
    // the chart/fundamentals/news are immediately useful. On phones that means
    // the news panel's CHART tab; on desktop, the floating window.
    if (MOBILE) { W.newsTab = 'chart'; }
    else {
      if (W.tabs.indexOf(centre) < 0) W.tabs.push(centre);
      W.active = centre; W.open = true; if (!W.rect) W.rect = defaultRect();
    }
    saveW();
  }
  if (OPENIDX) openIdxTab(OPENIDX);
  layoutWin(); renderTabs(); renderBody();
  if (MOBILE) window.setNewsTab(W.newsTab || 'news'); else loadNews(false);
  setInterval(function(){ if (!MOBILE || W.newsTab !== 'chart') loadNews(false); }, 3600 * 1000); // hourly auto-update
})();
</script></body></html>`;
}

const AI_KEY_STORE = 'taureye.aikey.v2';
const AI_KEY_STORE_V1 = 'taureye.aikey.v1'; // legacy: a bare Anthropic key string

// Bring-your-own-key providers the user can pick from.
type Provider = { id: string; label: string; ph: string; get: string };
const PROVIDERS: Provider[] = [
  { id: 'anthropic', label: 'Claude', ph: 'sk-ant-…', get: 'console.anthropic.com' },
  { id: 'gemini', label: 'Gemini', ph: 'AIza…', get: 'aistudio.google.com/apikey' },
  { id: 'grok', label: 'Grok', ph: 'xai-…', get: 'console.x.ai' },
  { id: 'openai', label: 'OpenAI', ph: 'sk-…', get: 'platform.openai.com/api-keys' },
];
const providerOf = (id: string) => PROVIDERS.find((p) => p.id === id) || PROVIDERS[0];

export default function TerminalScreen() {
  // Rebuild the embedded graph HTML (resolved hex) when the theme toggles.
  const themeMode = useThemeMode();
  const [data, setData] = useState<GraphResp | null>(null);
  const [quotes, setQuotes] = useState<LtpResp>({});
  // Blank until the user picks a stock — no company is centred on load.
  const [centre, setCentre] = useState('');
  // Breadcrumb of previously-centred symbols so the graph can step back.
  const [history, setHistory] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [notFound, setNotFound] = useState<string | null>(null);
  const [aiOn, setAiOn] = useState(false);
  const [generating, setGenerating] = useState<string | null>(null);
  const [genErr, setGenErr] = useState<string | null>(null);
  const [idxCmd, setIdxCmd] = useState<{ name: string; n: number } | null>(null);
  // BYOK: the visitor's own key + chosen provider, kept only in local storage.
  const [aiKey, setAiKey] = useState('');
  const [aiProvider, setAiProvider] = useState('anthropic');
  const [aiModel, setAiModel] = useState('');
  const [keyOpen, setKeyOpen] = useState(false);
  const [keyDraft, setKeyDraft] = useState('');
  const [providerDraft, setProviderDraft] = useState('anthropic');
  const [modelDraft, setModelDraft] = useState('');
  const aiEnabled = aiOn || !!aiKey;
  const activeProvider = providerOf(aiProvider);
  const draftProvider = providerOf(providerDraft);

  const loadQuotes = (g: GraphResp) => {
    const listed = Object.entries(g.companies)
      .filter(([, c]) => c.listed)
      .map(([t]) => t);
    api.ltp(listed).then((q) => setQuotes((prev) => ({ ...prev, ...q }))).catch(() => {});
  };

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(AI_KEY_STORE);
        if (raw) {
          const v = JSON.parse(raw) as { key?: string; provider?: string; model?: string };
          if (v.key) {
            setAiKey(v.key);
            setKeyDraft(v.key);
            const p = v.provider && providerOf(v.provider).id === v.provider ? v.provider : 'anthropic';
            setAiProvider(p);
            setProviderDraft(p);
            setAiModel(v.model || '');
            setModelDraft(v.model || '');
          }
        } else {
          // Migrate the legacy v1 bare Anthropic key, if any.
          const legacy = await AsyncStorage.getItem(AI_KEY_STORE_V1);
          if (legacy) {
            setAiKey(legacy);
            setKeyDraft(legacy);
            AsyncStorage.setItem(AI_KEY_STORE, JSON.stringify({ key: legacy, provider: 'anthropic', model: '' })).catch(() => {});
            AsyncStorage.removeItem(AI_KEY_STORE_V1).catch(() => {});
          }
        }
      } catch {
        /* storage unavailable — key just won't persist */
      }
      try {
        // Load the curated set (for the fallback universe + server AI flag),
        // but stay blank until the user selects a stock.
        const g = await api.graph();
        setData(g);
        setAiOn(!!g.ai);
        loadQuotes(g);
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Failed to load graph');
      }
    })();
  }, []);

  const saveKey = () => {
    const k = keyDraft.trim();
    const p = providerDraft;
    const m = modelDraft.trim();
    setAiKey(k);
    setAiProvider(p);
    setAiModel(m);
    AsyncStorage.setItem(AI_KEY_STORE, JSON.stringify({ key: k, provider: p, model: m })).catch(() => {});
    setKeyOpen(false);
    setGenErr(null);
    setNotFound(null);
  };
  const clearKey = () => {
    setAiKey('');
    setKeyDraft('');
    setAiModel('');
    setModelDraft('');
    AsyncStorage.removeItem(AI_KEY_STORE).catch(() => {});
  };

  // Centre a symbol: in the loaded graph → recentre; known to the backend
  // (curated or AI with a server key) → fetch its graph; else explain.
  // `fromBack` = navigating via the Back button, so don't push onto history.
  const select = (raw: string, fromBack = false) => {
    const sym = raw.trim().toUpperCase().replace(/^NSE:/, '');
    if (!sym || !data || generating) return;
    setNotFound(null);
    setGenErr(null);
    setInput(sym);
    // Index / market-cap segment → open the market browser tab in the window.
    const idx = resolveIndex(sym);
    if (idx) {
      setIdxCmd((prev) => ({ name: idx, n: (prev?.n || 0) + 1 }));
      return;
    }
    if (sym === centre) return; // already centred here
    // Remember where we came from so Back can return to it.
    if (!fromBack && centre) setHistory((h) => [...h, centre]);
    // Always fetch the target's OWN full graph. Re-using the current dataset
    // (because sym happens to be a neighbour node in it) rendered a sparse
    // 1–2 edge graph instead of that company's real relationship map.
    setGenerating(sym);
    api
      .graph(sym, aiKey ? { key: aiKey, provider: aiProvider, model: aiModel } : undefined)
      .then((g) => {
        setData(g);
        setCentre(sym);
        loadQuotes(g);
      })
      .catch((e) => setGenErr(e instanceof Error ? e.message : 'Graph unavailable'))
      .finally(() => setGenerating(null));
  };

  const go = () => select(input);

  // Pop the last symbol off the breadcrumb and re-centre on it.
  const goBack = () => {
    if (!history.length) return;
    const prev = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    select(prev, true);
  };

  const html = useMemo(
    () => (data && centre ? graphHtml(data, quotes, centre, idxCmd?.name || null, data.source === 'minimal', aiEnabled, history.length > 0) : ''),
    [data, quotes, centre, idxCmd, aiEnabled, history.length, themeMode],
  );

  // Messages posted by the embedded workspace (index rows → open a graph;
  // the Back button → step to the previous company).
  const onFrameMessage = (msg: string) => {
    if (msg === 'te:back') goBack();
    else if (msg.startsWith('te:graph:')) select(msg.slice(9));
  };

  return (
    <View style={styles.container}>
      <View style={styles.head}>
        <Text style={styles.title}>
          TAUREYE TERMINAL{' '}
          <Text style={styles.titleDim}>
            · RELATIONSHIP GRAPH ·{' '}
            {!centre
              ? 'SELECT A STOCK'
              : data?.source === 'ai'
                ? 'AI GRAPH'
                : data?.source === 'minimal'
                  ? 'LIVE DATA'
                  : aiEnabled
                    ? 'CURATED + AI'
                    : 'DEMO DATA'}
          </Text>
        </Text>
        <TouchableOpacity
          style={[styles.keyBtn, !!aiKey && styles.keyBtnOn]}
          onPress={() => setKeyOpen((v) => !v)}
          activeOpacity={0.75}
        >
          <Text style={[styles.keyBtnTxt, !!aiKey && styles.keyBtnTxtOn]}>
            {aiKey ? `⚙ ${activeProvider.label.toUpperCase()} ✓` : '⚙ AI KEY'}
          </Text>
        </TouchableOpacity>
      </View>
      {keyOpen ? (
        <View style={styles.keyPanel}>
          <Text style={styles.keyLabel}>
            Bring your own AI key to generate relationship graphs for any listed company. Pick a
            provider and paste your key — stored only on this device, sent per request, never saved
            on the server.
          </Text>
          <View style={styles.provRow}>
            {PROVIDERS.map((p) => (
              <TouchableOpacity
                key={p.id}
                style={[styles.provChip, providerDraft === p.id && styles.provChipOn]}
                onPress={() => setProviderDraft(p.id)}
                activeOpacity={0.75}
              >
                <Text style={[styles.provChipTxt, providerDraft === p.id && styles.provChipTxtOn]}>
                  {p.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.keyRow}>
            <TextInput
              style={styles.keyInput}
              value={keyDraft}
              onChangeText={setKeyDraft}
              placeholder={draftProvider.ph}
              placeholderTextColor={theme.muted}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
            />
            <TextInput
              style={styles.modelInput}
              value={modelDraft}
              onChangeText={setModelDraft}
              placeholder="model (optional)"
              placeholderTextColor={theme.muted}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity style={styles.keySave} onPress={saveKey}>
              <Text style={styles.keySaveTxt}>SAVE</Text>
            </TouchableOpacity>
            {aiKey ? (
              <TouchableOpacity style={styles.keyClear} onPress={clearKey}>
                <Text style={styles.keyClearTxt}>CLEAR</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          <Text style={styles.keyHint}>
            Get a {draftProvider.label} key at {draftProvider.get} · keys stay in your browser
          </Text>
        </View>
      ) : null}
      <View style={styles.cmdRow}>
        <Text style={styles.prompt}>{'>'}</Text>
        <SymbolInput
          containerStyle={{ flex: 1 }}
          inputStyle={styles.cmd}
          value={input}
          onChangeText={setInput}
          onSelect={(s) => select(s)}
          onSubmit={go}
          placeholder="TMCV · NIFTY 50 · LARGE CAP"
        />
        <TouchableOpacity style={styles.goBtn} onPress={go}>
          <Text style={styles.goTxt}>GO</Text>
        </TouchableOpacity>
      </View>
      {notFound ? (
        <Text style={styles.warn}>
          {notFound} isn't in the curated set — add your Anthropic API key (⚙ AI KEY) to unlock
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
              Loading {generating}…{aiEnabled ? ' generating its relationship graph with AI — first time can take 20–40s, then it’s cached.' : ''}
            </Text>
          </View>
        ) : !data ? (
          <View style={styles.center}>
            <ActivityIndicator color={theme.accent} />
          </View>
        ) : !centre ? (
          <View style={styles.center}>
            <Text style={styles.emptyIcon}>⌾</Text>
            <Text style={styles.emptyTitle}>Please select a stock</Text>
            <Text style={styles.emptyHint}>
              Type a symbol above or tap a chip to open its relationship graph, live chart,
              fundamentals and news.
            </Text>
          </View>
        ) : (
          <HtmlView
            key={centre + data.source + Object.keys(quotes).length + ':' + (idxCmd?.n || 0) + ':' + (aiEnabled ? 1 : 0)}
            html={html}
            style={styles.web}
            onMessage={onFrameMessage}
          />
        )}
      </View>
      {data ? <Text style={styles.disclaimer}>{data.disclaimer}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingTop: 12,
    gap: 8,
  },
  title: { color: theme.text, fontFamily: theme.mono, fontSize: 13, fontWeight: '700', letterSpacing: 1, flex: 1 },
  titleDim: { color: theme.muted, fontWeight: '400' },
  keyBtn: {
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
    backgroundColor: theme.surface2,
  },
  keyBtnOn: { borderColor: theme.accent, backgroundColor: theme.accent },
  keyBtnTxt: { color: theme.muted2, fontFamily: theme.mono, fontSize: 11, letterSpacing: 1 },
  keyBtnTxtOn: { color: theme.bg, fontWeight: '700' },
  keyPanel: {
    marginHorizontal: 14,
    marginTop: 8,
    padding: 12,
    backgroundColor: theme.surface,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: 8,
    gap: 8,
  },
  keyLabel: { color: theme.muted2, fontSize: 12, lineHeight: 17 },
  provRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  provChip: {
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
    backgroundColor: theme.surface2,
  },
  provChipOn: { borderColor: theme.accent, backgroundColor: theme.accent },
  provChipTxt: { color: theme.muted2, fontFamily: theme.mono, fontSize: 12, letterSpacing: 0.5 },
  provChipTxtOn: { color: theme.bg, fontWeight: '700' },
  keyRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  modelInput: {
    width: 150,
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: 6,
    color: theme.text,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontFamily: theme.mono,
    fontSize: 12,
  },
  keyInput: {
    flex: 1,
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: 6,
    color: theme.text,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontFamily: theme.mono,
    fontSize: 13,
  },
  keySave: { backgroundColor: theme.accent, borderRadius: 6, paddingHorizontal: 14, paddingVertical: 9 },
  keySaveTxt: { color: theme.bg, fontFamily: theme.mono, fontWeight: '700', fontSize: 12 },
  keyClear: {
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  keyClearTxt: { color: theme.muted2, fontFamily: theme.mono, fontSize: 12 },
  keyHint: { color: theme.muted, fontSize: 11, fontFamily: theme.mono },
  emptyIcon: { color: theme.border2, fontSize: 46, marginBottom: 10 },
  emptyTitle: { color: theme.text, fontSize: 16, fontWeight: '700', marginBottom: 8 },
  emptyHint: { color: theme.muted, fontSize: 12, textAlign: 'center', paddingHorizontal: 40, lineHeight: 18 },
  cmdRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingTop: 10, zIndex: 50 },
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
  idxChip: { borderStyle: 'dashed' },
  chipTxt: { color: theme.muted2, fontFamily: theme.mono, fontSize: 11 },
  chipTxtOn: { color: theme.bg, fontWeight: '700' },
  warn: { color: theme.muted2, fontSize: 13, paddingHorizontal: 14, paddingBottom: 4 },
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
    fontSize: 11,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderTopColor: theme.border,
    borderTopWidth: 1,
  },
});
