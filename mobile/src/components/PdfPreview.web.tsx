// Web / Capacitor-WebView host for the shared PDF preview (Metro resolves this
// over PdfPreview.tsx on web). Shows the professionally-formatted report in a
// visible, sandboxed iframe and prints it on an explicit user tap — the reliable
// path to Android's "Save as PDF" (a real device download) and the desktop
// browser's Save-as-PDF. Built with React.createElement over raw DOM elements
// (like HtmlView.web) so it typechecks under the RN tsconfig, which has no DOM
// lib. No native plugins required.
import React from 'react';
import { closePdfPreview, peekPdf, subscribePdf } from '../pdf';
import { printReportNative } from '../printer';

export default function PdfPreview() {
  const [, force] = React.useReducer((x: number) => x + 1, 0);
  React.useEffect(() => subscribePdf(force), []);
  const iframeRef = React.useRef<{ contentWindow?: { focus?: () => void; print?: () => void } } | null>(null);

  const doc = peekPdf();
  if (!doc) return null;

  const webPrint = () => {
    const ifr = iframeRef.current;
    try {
      ifr?.contentWindow?.focus?.();
      ifr?.contentWindow?.print?.();
    } catch {
      try {
        (globalThis as { print?: () => void }).print?.();
      } catch {
        /* nothing else we can do */
      }
    }
  };
  // On the Android app, route to the native print dialog (web print() is a no-op
  // in the WebView). Fall back to browser print on desktop / if the native
  // bridge isn't present (older APK).
  const print = () => {
    printReportNative(doc.html, doc.fileName).then((handled) => {
      if (!handled) webPrint();
    });
  };

  const btn = (label: string, onClick: () => void, primary?: boolean) =>
    React.createElement(
      'button',
      {
        onClick,
        style: {
          appearance: 'none',
          border: primary ? 'none' : '1px solid rgba(255,255,255,0.28)',
          background: primary ? '#4c6ef5' : 'transparent',
          color: '#fff',
          fontSize: 14,
          fontWeight: 700,
          padding: '9px 16px',
          borderRadius: 8,
          cursor: 'pointer',
        },
      },
      label,
    );

  const iframe = React.createElement('iframe', {
    ref: iframeRef,
    srcDoc: doc.html,
    // allow-modals is essential — without it the sandbox blocks print().
    sandbox: 'allow-same-origin allow-scripts allow-modals allow-popups allow-downloads',
    style: { flex: 1, width: '100%', height: '100%', border: 'none', background: '#fff' },
    title: 'report',
  });

  return React.createElement(
    'div',
    {
      style: {
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        background: 'rgba(6,8,14,0.94)',
      },
    },
    React.createElement(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 14px',
          paddingTop: 'calc(env(safe-area-inset-top, 0px) + 10px)',
          borderBottom: '1px solid rgba(255,255,255,0.12)',
        },
      },
      React.createElement(
        'div',
        { style: { flex: 1, color: '#fff', fontWeight: 700, fontSize: 15, letterSpacing: 0.2 } },
        doc.docType,
      ),
      btn('Print / Save as PDF', print, true),
      btn('✕', closePdfPreview),
    ),
    React.createElement(
      'div',
      { style: { flex: 1, width: '100%', maxWidth: 900, margin: '0 auto', background: '#fff', overflow: 'hidden' } },
      iframe,
    ),
    React.createElement(
      'div',
      {
        style: {
          color: 'rgba(255,255,255,0.7)',
          fontSize: 12,
          textAlign: 'center',
          padding: '8px 14px',
          paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 8px)',
        },
      },
      'Tap “Print / Save as PDF”, then choose “Save as PDF” to store it on your device.',
    ),
  );
}
