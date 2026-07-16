// Web implementation of HtmlView — renders the HTML in an <iframe srcDoc>.
// Metro resolves this file for the web platform in place of HtmlView.tsx.
//
// Uses React.createElement('iframe', …) rather than JSX so the file typechecks
// under the React Native tsconfig (which has no DOM lib).
import React from 'react';
import { View } from 'react-native';
import { getPalette, useThemeMode } from '../theme';
import { HtmlViewProps } from './HtmlView';

export default function HtmlView({ html, style, onMessage }: HtmlViewProps) {
  // Match the iframe backing colour to the active theme so there's no dark flash
  // behind embedded charts/graphs in light mode.
  useThemeMode();
  const frameBg = getPalette().bg;
  React.useEffect(() => {
    if (!onMessage) return undefined;
    const g = globalThis as unknown as {
      addEventListener: (t: string, h: (e: { data?: unknown }) => void) => void;
      removeEventListener: (t: string, h: (e: { data?: unknown }) => void) => void;
    };
    const handler = (e: { data?: unknown }) => {
      if (typeof e.data === 'string' && e.data.startsWith('te:')) onMessage(e.data);
    };
    g.addEventListener('message', handler);
    return () => g.removeEventListener('message', handler);
  }, [onMessage]);
  const iframe = React.createElement('iframe', {
    srcDoc: html,
    style: { border: 'none', width: '100%', height: '100%', background: frameBg },
    sandbox: 'allow-scripts allow-same-origin allow-popups',
    title: 'chart',
  });
  return <View style={[{ flex: 1 }, style]}>{iframe}</View>;
}
