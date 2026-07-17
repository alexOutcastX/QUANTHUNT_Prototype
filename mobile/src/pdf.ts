// Print / "Save as PDF" helper that works in a desktop browser AND inside the
// Capacitor Android WebView.
//
// The old approach — window.open('', '_blank') then w.print() — renders the
// report in the WebView but offers no way to save it (Capacitor doesn't give
// programmatic child windows a usable print path), which is why mobile export
// "only opened the PDF" with no download. Printing from a hidden iframe in the
// *current* document instead routes through the platform print dialog: on
// Android's Chromium WebView that dialog's "Save as PDF" writes a real file to
// the device (a genuine download); on desktop it's the browser's Save-as-PDF.
// No native plugins required.
export function printHtmlDocument(html: string, onFail?: () => void): boolean {
  const doc = (globalThis as { document?: any }).document;
  if (!doc?.body) {
    onFail?.();
    return false;
  }
  const iframe = doc.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;';
  doc.body.appendChild(iframe);

  const cleanup = () =>
    setTimeout(() => {
      try {
        doc.body.removeChild(iframe);
      } catch {
        /* already detached */
      }
    }, 2000);

  let fired = false;
  const fire = () => {
    if (fired) return;
    fired = true;
    try {
      const cw = iframe.contentWindow;
      cw.focus();
      cw.print();
    } catch {
      onFail?.();
    }
    cleanup();
  };

  try {
    const cd = iframe.contentWindow.document;
    cd.open();
    cd.write(html);
    cd.close();
  } catch {
    try {
      doc.body.removeChild(iframe);
    } catch {
      /* ignore */
    }
    onFail?.();
    return false;
  }
  // Print once the iframe has laid out. onload is most reliable; the timeout is
  // a fallback for WebViews that don't fire onload for a document.write().
  iframe.onload = fire;
  setTimeout(fire, 500);
  return true;
}
