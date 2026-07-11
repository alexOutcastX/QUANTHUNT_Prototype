// Web implementation of HtmlView — renders the HTML in an <iframe srcDoc>.
// Metro resolves this file for the web platform in place of HtmlView.tsx.
//
// Uses React.createElement('iframe', …) rather than JSX so the file typechecks
// under the React Native tsconfig (which has no DOM lib).
import React from 'react';
import { View } from 'react-native';
import { HtmlViewProps } from './HtmlView';

export default function HtmlView({ html, style }: HtmlViewProps) {
  const iframe = React.createElement('iframe', {
    srcDoc: html,
    style: { border: 'none', width: '100%', height: '100%', background: '#0a0c0f' },
    sandbox: 'allow-scripts allow-same-origin allow-popups',
    title: 'chart',
  });
  return <View style={[{ flex: 1 }, style]}>{iframe}</View>;
}
