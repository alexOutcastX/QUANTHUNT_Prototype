package com.taureye.app;

import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // TRUE edge-to-edge: let the WebView draw *behind* the status and
        // navigation bars instead of being inset below them. This is the whole
        // fix for the "white status bar" — previously the WebView sat below the
        // status bar and that strip was painted by the window (white by
        // default), so no CSS/JS could ever reach it. With decor-fits-system-
        // windows off + transparent bars, the app's own content sits behind the
        // bars: the RN header (theme surface) fills the status-bar area and the
        // bottom tab bar fills the navigation-bar area. Because those surfaces
        // are theme-aware, the bars are dark in dark mode and white in light
        // mode automatically. The web layer pads for the bars via the safe-area
        // insets (viewport-fit=cover exposes env(safe-area-inset-*)).
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);

        // Stop the system from drawing a translucent "contrast" scrim behind the
        // bars on Android 10+ — that scrim reads as a grey/washed strip.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            getWindow().setStatusBarContrastEnforced(false);
            getWindow().setNavigationBarContrastEnforced(false);
        }

        // Initial icon appearance for the app's default (dark) theme: light
        // glyphs. @capacitor/status-bar (src/systemBars.ts) flips this at runtime
        // when the user toggles to light mode so the glyphs stay legible.
        WindowInsetsControllerCompat controller =
                new WindowInsetsControllerCompat(getWindow(), getWindow().getDecorView());
        controller.setAppearanceLightStatusBars(false);
        controller.setAppearanceLightNavigationBars(false);
    }
}
