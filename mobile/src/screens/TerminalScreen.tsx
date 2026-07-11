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
import { GraphResp, LtpResp, api } from '../api';
import HtmlView from '../components/HtmlView';
import { theme } from '../theme';

// Self-contained interactive relationship graph: d3-force + full dataset +
// live quotes embedded, so re-centring on node clicks happens inside the
// frame with no native<->frame messaging.
function graphHtml(data: GraphResp, quotes: LtpResp, centre: string): string {
  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<style>
  html,body{height:100%;margin:0;background:${theme.bg};font-family:ui-monospace,Menlo,Consolas,monospace;overflow:hidden}
  #wrap{display:flex;height:100%}
  #gfx{flex:1;position:relative}
  svg{width:100%;height:100%;display:block}
  #panel{width:330px;border-left:1px solid ${theme.border};overflow-y:auto;padding:14px;box-sizing:border-box}
  .ph{color:${theme.text};font-size:15px;font-weight:700;margin:0 0 2px}
  .ps{color:${theme.muted};font-size:10px;margin:0 0 12px}
  .sec{color:${theme.muted2};font-size:10px;letter-spacing:1px;text-transform:uppercase;margin:14px 0 6px;border-bottom:1px solid ${theme.border};padding-bottom:4px}
  .edge{padding:7px 8px;border:1px solid ${theme.border};border-radius:6px;margin-bottom:6px;cursor:pointer}
  .edge:hover{border-color:${theme.border2}}
  .et{color:${theme.text};font-size:12px;font-weight:700}
  .en{color:${theme.muted2};font-size:11px;line-height:1.45;margin-top:3px}
  .conf{color:${theme.muted};font-size:9px;float:right}
  .price-up{fill:${theme.green}} .price-dn{fill:${theme.red}}
  #legend{position:absolute;left:10px;bottom:10px;color:${theme.muted};font-size:10px;line-height:1.9;background:${theme.bg}cc;padding:6px 10px;border:1px solid ${theme.border};border-radius:6px}
  .lg-line{display:inline-block;width:26px;height:0;border-top:2px solid ${theme.muted2};vertical-align:middle;margin-right:6px}
  #crumb{position:absolute;top:10px;left:12px;color:${theme.muted};font-size:11px}
  #crumb b{color:${theme.text}}
  #msg{color:${theme.muted};font-size:12px;text-align:center;padding-top:60px}
</style></head><body>
<div id="wrap">
  <div id="gfx">
    <div id="crumb"></div>
    <svg id="svg"></svg>
    <div id="legend">
      <span class="lg-line" style="border-top-style:solid"></span>supplies →<br>
      <span class="lg-line" style="border-top-style:dashed"></span>group<br>
      <span class="lg-line" style="border-top-style:dotted"></span>competitor<br>
      <span class="lg-line" style="border-top:2px double ${theme.muted2};height:4px"></span>finances
    </div>
  </div>
  <div id="panel"><div id="msg">Loading…</div></div>
</div>
<script src="https://unpkg.com/d3@7.9.0/dist/d3.min.js"></script>
<script>
(function(){
  if (typeof d3 === 'undefined') { document.getElementById('msg').textContent = '⚠ Graph library unavailable (no network).'; return; }
  var DATA = ${JSON.stringify({ companies: data.companies, edges: data.edges })};
  var QUOTES = ${JSON.stringify(quotes)};
  var centre = ${JSON.stringify(centre)};
  var DASH = { supplies: null, group: '7,5', competitor: '2,5', finances: '12,3,2,3' };
  var svg = d3.select('#svg'), sim = null;

  function fmtPrice(t) {
    var q = QUOTES[t];
    if (!q || q.price == null) return null;
    var chg = q.chg == null ? '' : ' ' + (q.chg >= 0 ? '+' : '') + q.chg.toFixed(1) + '%';
    return { txt: '₹' + Math.round(q.price).toLocaleString('en-IN') + chg, up: (q.chg || 0) >= 0 };
  }

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

  function panelHtml(c) {
    var comp = DATA.companies[c] || { name: c };
    var q = fmtPrice(c);
    var h = '<p class="ph">' + comp.name + '</p><p class="ps">' + c +
      (q ? ' · <span style="color:' + (q.up ? '${theme.green}' : '${theme.red}') + '">' + q.txt + '</span>' : '') +
      (comp.listed === false ? ' · unlisted' : '') + '</p>';
    function block(title, list, fmt) {
      if (!list.length) return '';
      var s = '<div class="sec">' + title + '</div>';
      list.forEach(function(e){
        s += '<div class="edge" onclick="window.recentre(\\'' + fmt(e) + '\\')"><span class="conf">' + e.confidence + '</span>' +
             '<div class="et">' + fmt(e) + '</div><div class="en">' + e.note + '</div></div>';
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
    centre = id;
    render();
  };

  function render() {
    var g = subgraph(centre);
    document.getElementById('crumb').innerHTML = 'centre: <b>' + centre + '</b> · click a node to walk the graph';
    panelHtml(centre);
    if (sim) sim.stop();
    svg.selectAll('*').remove();
    var W = document.getElementById('gfx').clientWidth, H = document.getElementById('gfx').clientHeight;
    var root = svg.append('g');
    svg.call(d3.zoom().scaleExtent([0.4, 2.5]).on('zoom', function(ev){ root.attr('transform', ev.transform); }));

    svg.append('defs').append('marker').attr('id','arr').attr('viewBox','0 -4 8 8')
      .attr('refX', 26).attr('markerWidth', 7).attr('markerHeight', 7).attr('orient','auto')
      .append('path').attr('d','M0,-4L8,0L0,4').attr('fill','${theme.muted}');

    var link = root.selectAll('line').data(g.links).enter().append('line')
      .attr('stroke', '${theme.muted}').attr('stroke-width', function(d){ return d.e.confidence === 'high' ? 2 : 1.2; })
      .attr('stroke-dasharray', function(d){ return DASH[d.e.type]; })
      .attr('marker-end', function(d){ return (d.e.type === 'supplies' || d.e.type === 'finances') ? 'url(#arr)' : null; });

    var node = root.selectAll('g.n').data(g.nodes).enter().append('g').attr('class','n')
      .style('cursor','pointer')
      .call(d3.drag()
        .on('start', function(ev,d){ if(!ev.active) sim.alphaTarget(0.25).restart(); d.fx=d.x; d.fy=d.y; })
        .on('drag', function(ev,d){ d.fx=ev.x; d.fy=ev.y; })
        .on('end', function(ev,d){ if(!ev.active) sim.alphaTarget(0); d.fx=null; d.fy=null; }))
      .on('click', function(ev,d){ if (d.id !== centre) window.recentre(d.id); });

    node.append('circle')
      .attr('r', function(d){ return d.id === centre ? 26 : 17; })
      .attr('fill', '${theme.surface2}')
      .attr('stroke', function(d){ return d.id === centre ? '${theme.accent}' : (d.listed ? '${theme.border2}' : '${theme.border}'); })
      .attr('stroke-width', function(d){ return d.id === centre ? 2.5 : 1.5; });

    node.append('text').text(function(d){ return d.id; })
      .attr('text-anchor','middle').attr('dy', function(d){ return d.id === centre ? 40 : 30; })
      .attr('fill', function(d){ return d.listed ? '${theme.text}' : '${theme.muted}'; })
      .attr('font-size', function(d){ return d.id === centre ? 13 : 11; }).attr('font-weight', 700);

    node.append('text').text(function(d){ var q = fmtPrice(d.id); return q ? q.txt : ''; })
      .attr('text-anchor','middle').attr('dy', function(d){ return d.id === centre ? 54 : 43; })
      .attr('class', function(d){ var q = fmtPrice(d.id); return q && q.up ? 'price-up' : 'price-dn'; })
      .attr('font-size', 10);

    node.append('text').text(function(d){ return d.id === centre ? '' : d.deg; })
      .attr('text-anchor','middle').attr('dy', 4)
      .attr('fill','${theme.muted2}').attr('font-size', 10);

    sim = d3.forceSimulation(g.nodes)
      .force('link', d3.forceLink(g.links).id(function(d){ return d.id; }).distance(150))
      .force('charge', d3.forceManyBody().strength(-600))
      .force('center', d3.forceCenter(W/2, H/2))
      .force('collide', d3.forceCollide(46))
      .on('tick', function(){
        link.attr('x1', function(d){ return d.source.x; }).attr('y1', function(d){ return d.source.y; })
            .attr('x2', function(d){ return d.target.x; }).attr('y2', function(d){ return d.target.y; });
        node.attr('transform', function(d){ return 'translate(' + d.x + ',' + d.y + ')'; });
      });
  }
  render();
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

  useEffect(() => {
    (async () => {
      try {
        const g = await api.graph();
        setData(g);
        const listed = Object.entries(g.companies)
          .filter(([, c]) => c.listed)
          .map(([t]) => t);
        api.ltp(listed).then(setQuotes).catch(() => {});
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Failed to load graph');
      }
    })();
  }, []);

  const go = () => {
    const sym = input.trim().toUpperCase().replace(/^NSE:/, '');
    if (!data) return;
    if (data.companies[sym]) {
      setNotFound(null);
      setCentre(sym);
    } else {
      setNotFound(sym);
    }
  };

  const html = useMemo(
    () => (data ? graphHtml(data, quotes, centre) : ''),
    [data, quotes, centre],
  );

  return (
    <View style={styles.container}>
      <View style={styles.head}>
        <Text style={styles.title}>
          TAUREYE TERMINAL <Text style={styles.titleDim}>· RELATIONSHIP GRAPH · DEMO DATA</Text>
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
          {data.available.map((t) => (
            <TouchableOpacity
              key={t}
              style={[styles.chip, t === centre && styles.chipOn]}
              onPress={() => {
                setInput(t);
                setNotFound(null);
                setCentre(t);
              }}
            >
              <Text style={[styles.chipTxt, t === centre && styles.chipTxtOn]}>{t}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      ) : null}
      {notFound ? (
        <Text style={styles.warn}>
          {notFound} isn't in the curated demo set — AI mode will cover any company once an API key
          is configured.
        </Text>
      ) : null}

      <View style={styles.graphWrap}>
        {err ? (
          <View style={styles.center}>
            <Text style={styles.dim}>{err} — is the backend reachable?</Text>
          </View>
        ) : !data ? (
          <View style={styles.center}>
            <ActivityIndicator color={theme.accent} />
          </View>
        ) : (
          <HtmlView key={centre + Object.keys(quotes).length} html={html} style={styles.web} />
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
