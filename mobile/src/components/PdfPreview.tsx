// Native (react-native-webview) placeholder for the PDF preview host. On web /
// Capacitor, Metro resolves PdfPreview.web.tsx instead, which renders the real
// iframe-backed preview. A true native RN build has no DOM to print from, so
// callers fall back to a text share and this host renders nothing.
export default function PdfPreview(): null {
  return null;
}
