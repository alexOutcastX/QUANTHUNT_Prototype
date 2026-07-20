// Bridge to the native Android print dialog (PrinterPlugin, registered in
// MainActivity). Android's System WebView doesn't implement web print(), so on
// the device we hand the report HTML to Android's PrintManager, whose dialog
// offers "Save as PDF" (a real vector file) + connected printers. On the web /
// desktop the browser's own print path works, so this reports "not handled" and
// the caller falls back to window.print().
import { Capacitor, registerPlugin } from '@capacitor/core';

type PrinterPlugin = { printHtml(opts: { html: string; name: string }): Promise<void> };

const Printer = registerPlugin<PrinterPlugin>('Printer');

// Returns true when the native print dialog was dispatched; false on web (so the
// caller uses the browser print path) or if the native call failed.
export async function printReportNative(html: string, name: string): Promise<boolean> {
  try {
    if (!Capacitor.isNativePlatform()) return false;
    await Printer.printHtml({ html, name });
    return true;
  } catch {
    return false;
  }
}
