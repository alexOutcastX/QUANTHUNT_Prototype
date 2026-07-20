package com.taureye.app;

import android.content.Context;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Local Capacitor plugin: prints an HTML report through Android's native print
// framework. Android's System WebView does NOT implement web `window.print()`,
// so the web layer can't reach the print dialog on its own — this bridges to
// PrintManager, whose dialog offers "Save as PDF" (a real vector PDF written to
// the device) plus any connected printer. Registered in MainActivity.
@CapacitorPlugin(name = "Printer")
public class PrinterPlugin extends Plugin {

    // Hold the offscreen WebView so it isn't garbage-collected before the print
    // adapter has been handed to the framework.
    private WebView printView;

    @PluginMethod
    public void printHtml(final PluginCall call) {
        final String html = call.getString("html", "");
        final String name = call.getString("name", "TaurEye-report");
        getActivity().runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    final WebView webView = new WebView(getContext());
                    webView.setWebViewClient(new WebViewClient() {
                        @Override
                        public void onPageFinished(WebView view, String url) {
                            try {
                                createPrintJob(view, name);
                                call.resolve();
                            } catch (Exception e) {
                                call.reject("print failed: " + e.getMessage());
                            } finally {
                                // The print framework holds its own reference to
                                // the adapter now; drop ours.
                                printView = null;
                            }
                        }
                    });
                    printView = webView;
                    webView.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
                } catch (Exception e) {
                    call.reject("print failed: " + e.getMessage());
                }
            }
        });
    }

    private void createPrintJob(WebView webView, String name) {
        PrintManager printManager = (PrintManager) getContext().getSystemService(Context.PRINT_SERVICE);
        PrintDocumentAdapter adapter = webView.createPrintDocumentAdapter(name);
        PrintAttributes attrs = new PrintAttributes.Builder()
                .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                .build();
        printManager.print(name, adapter, attrs);
    }
}
