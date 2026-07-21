// TaurEye icon system — a single stroke icon set replacing the emoji glyphs
// that previously served as icons (🚀 🏛 ⚡ …). Emoji render differently on every
// OS, carry uncontrollable colour, and read consumer-casual; these are 24×24
// stroke paths (1.75px, round caps) that inherit `color` like text, align to
// the pixel grid, and look identical on the website and inside the Android
// shell (the app always renders as react-native-web, so inline SVG is safe).
//
// Usage:  <Icon name="watch" size={16} color={theme.muted2} />
// Filled variants exist where an "active" state needs weight (watchFilled…).
import React from 'react';
import { unstable_createElement as h } from 'react-native-web';

export type IconName =
  | 'search' | 'close' | 'back' | 'chevronDown' | 'chevronRight' | 'check'
  | 'info' | 'warning' | 'external' | 'refresh' | 'filter' | 'sort'
  | 'settings' | 'plus' | 'clock'
  | 'home' | 'screens' | 'stock' | 'desk' | 'terminal' | 'grid' | 'doc'
  | 'chart' | 'candles' | 'watch' | 'watchFilled' | 'alert' | 'alertFilled'
  | 'export' | 'bolt' | 'trendUp' | 'rocket' | 'landmark' | 'calc' | 'paper'
  | 'target' | 'flask';

type Def = { d: string; fill?: boolean };

const P: Record<IconName, Def> = {
  search: { d: 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM20.5 20.5L16 16' },
  close: { d: 'M6 6l12 12M18 6L6 18' },
  back: { d: 'M15 5l-7 7 7 7' },
  chevronDown: { d: 'M6 9.5l6 6 6-6' },
  chevronRight: { d: 'M9.5 6l6 6-6 6' },
  check: { d: 'M5 12.5l4.5 4.5L19 7' },
  info: { d: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 11v5M12 7.5v.6' },
  warning: { d: 'M12 3.5l9.5 16.5h-19L12 3.5zM12 10v4.2M12 16.8v.6' },
  external: { d: 'M14 4h6v6M20 4l-9.5 9.5M20 13.5V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5.5' },
  refresh: { d: 'M20 12a8 8 0 1 1-2.34-5.66M20 3.5V9h-5.5' },
  filter: { d: 'M4 5h16l-6.2 7.2V18l-3.6 2v-7.8L4 5z' },
  sort: { d: 'M8 20V6M8 6L5 9M8 6l3 3M16 4v14M16 18l-3-3M16 18l3-3' },
  settings: { d: 'M12 9.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5 5l2.1 2.1M16.9 16.9L19 19M19 5l-2.1 2.1M7.1 16.9L5 19' },
  plus: { d: 'M12 5v14M5 12h14' },
  clock: { d: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 7.5V12l3 2' },

  home: { d: 'M3.5 10.5L12 3.5l8.5 7M5.5 9.5V20h4.5v-5.5h4V20h4.5V9.5' },
  screens: { d: 'M4 5h16v14H4zM4 10h16M10 10v9' },
  stock: { d: 'M4 4.5V19.5h16M7 15l3.5-4.5 3 2.5 4-6' },
  desk: { d: 'M4 8h16v11H4zM9 8V6.5A2 2 0 0 1 11 4.5h2a2 2 0 0 1 2 2V8M4 13h16' },
  terminal: { d: 'M4 5h16v14H4zM7.5 9.5l3 2.8-3 2.8M12.5 15.5h4' },
  grid: { d: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z' },
  doc: { d: 'M6 3h9l4 4v14H6zM15 3v4h4M9 12.5h6M9 16h6' },

  chart: { d: 'M4 20h16M6.5 16.5v-4M11 16.5V8M15.5 16.5v-6.5M20 16.5V5.5' },
  candles: { d: 'M7 3.5v3M7 15v5.5M5 6.5h4V15H5zM17 3.5v5M17 18v2.5M15 8.5h4V18h-4z' },
  watch: { d: 'M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1.1 5.9-5.3-2.9-5.3 2.9 1.1-5.9L3.5 9.7l5.9-.8L12 3.5z' },
  watchFilled: { d: 'M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1.1 5.9-5.3-2.9-5.3 2.9 1.1-5.9L3.5 9.7l5.9-.8L12 3.5z', fill: true },
  alert: { d: 'M6 9.5a6 6 0 0 1 12 0c0 4.8 2 6 2 6H4s2-1.2 2-6M10.3 19.5a2 2 0 0 0 3.4 0' },
  alertFilled: { d: 'M6 9.5a6 6 0 0 1 12 0c0 4.8 2 6 2 6H4s2-1.2 2-6zM10.3 19.5a2 2 0 0 0 3.4 0z', fill: true },
  export: { d: 'M12 4v10.5M7.5 10.5L12 15l4.5-4.5M4.5 19.5h15' },
  bolt: { d: 'M13 2.5L4.5 14H10l-1 7.5L17.5 10H12l1-7.5z' },
  trendUp: { d: 'M3.5 17l5.5-5.5 3.5 3.5 7-8M14.5 6.5h5v5' },
  rocket: { d: 'M12 2.5c3.2 2.2 5 6 5 9.8l1.8 3.9-3.8-1c-.9.8-1.9 1.3-3 1.3s-2.1-.5-3-1.3l-3.8 1L7 12.3c0-3.8 1.8-7.6 5-9.8zM12 8a1.4 1.4 0 1 1 0 2.8A1.4 1.4 0 0 1 12 8zM9 18.5L8 21.5M15 18.5l1 3M12 19v3' },
  landmark: { d: 'M3.5 21.5h17M5.5 18v-7M9.75 18v-7M14.25 18v-7M18.5 18v-7M4 11h16M12 2.5L20 8H4l8-5.5z' },
  calc: { d: 'M6 3h12v18H6zM9 7h6M9 11.5h.4M11.8 11.5h.4M14.6 11.5h.4M9 15h.4M11.8 15h.4M14.6 15h.4M9 18.2h.4M11.8 18.2h.4M14.6 18.2h.4' },
  paper: { d: 'M5 4h14v16H5zM8.5 8.5h7M8.5 12h7M8.5 15.5h4' },
  target: { d: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 7.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9zM12 11.2a.8.8 0 1 1 0 1.6.8.8 0 0 1 0-1.6z' },
  flask: { d: 'M9.5 3h5M10.5 3v6l-5.3 8.8A1.6 1.6 0 0 0 6.6 20.5h10.8a1.6 1.6 0 0 0 1.4-2.7L13.5 9V3M8 15h8' },
};

export function Icon({
  name,
  size = 18,
  color = 'currentColor',
  strokeWidth = 1.75,
  style,
}: {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
  style?: Record<string, unknown>;
}) {
  const def = P[name];
  return h(
    'svg',
    {
      viewBox: '0 0 24 24',
      width: size,
      height: size,
      'aria-hidden': true,
      style: { display: 'block', flexShrink: 0, color, ...style },
    },
    h('path', {
      d: def.d,
      fill: def.fill ? 'currentColor' : 'none',
      stroke: def.fill ? 'none' : 'currentColor',
      strokeWidth,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    }),
  );
}
