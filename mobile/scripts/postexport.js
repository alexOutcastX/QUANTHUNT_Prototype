// Post-processes the expo web export (dist/index.html): injects the PWA
// manifest link, SEO/OG meta, apple-touch-icon, theme colour, and service
// worker registration. Run automatically via `npm run export:web`.
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'dist', 'index.html');
let html = fs.readFileSync(file, 'utf8');
if (html.includes('rel="manifest"')) {
  console.log('postexport: already injected');
  process.exit(0);
}

const META = `
<title>TaurEye — live NSE/BSE terminal & screener</title>
<meta name="description" content="Live Indian-equity terminal: technical + fundamental screener, company relationship graph, backtesting, charts, portfolio — free and self-hosted."/>
<meta property="og:title" content="TaurEye — live NSE/BSE terminal"/>
<meta property="og:description" content="Screener, relationship graph, backtesting and charts for Indian markets."/>
<meta property="og:type" content="website"/>
<meta property="og:image" content="/icons/icon-512.png"/>
<meta name="theme-color" content="#0a0c0f"/>
<link rel="manifest" href="/manifest.json"/>
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png"/>
<meta name="apple-mobile-web-app-capable" content="yes"/>
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"/>
<meta name="apple-mobile-web-app-title" content="TaurEye"/>`;

const SW = `<script>if('serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('/sw.js').catch(function(){})})}</script>`;

// Drop expo's default <title> so ours wins, then inject.
html = html.replace(/<title>[^<]*<\/title>/, '');
html = html.replace('</head>', META + '\n</head>');
html = html.replace('</body>', SW + '</body>');
fs.writeFileSync(file, html);
console.log('postexport: PWA meta + SW registration injected');
