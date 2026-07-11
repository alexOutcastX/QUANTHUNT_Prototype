// Cross-platform embedded-HTML view.
//
// Native (this file): renders the HTML in a react-native-webview.
// Web (HtmlView.web.tsx): renders the same HTML in an <iframe srcDoc>, since
// react-native-webview has no web implementation.
//
// Both take a self-contained HTML string so callers (charts, TradingView) stay
// identical across platforms.
import React from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import { WebView } from 'react-native-webview';

export type HtmlViewProps = {
  html: string;
  style?: StyleProp<ViewStyle>;
};

export default function HtmlView({ html, style }: HtmlViewProps) {
  return (
    <WebView
      originWhitelist={['*']}
      source={{ html }}
      style={style}
      javaScriptEnabled
      domStorageEnabled
    />
  );
}
