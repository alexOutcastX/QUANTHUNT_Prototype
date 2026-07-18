package com.taureye.app;

import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;

import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    // App surface colour — keep in sync with res/values/colors.xml (app_bg) and
    // the RN theme's `surface`.
    private static final int BAR_COLOR = Color.parseColor("#0E1219");

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Colour the status + navigation bars to match the app so they blend in
        // (no grey system strip). The WebView fits within the bars, so app
        // content never sits under the clock/nav icons.
        getWindow().setStatusBarColor(BAR_COLOR);
        getWindow().setNavigationBarColor(BAR_COLOR);

        // On Android 10+ stop the system from drawing a translucent grey
        // "contrast" scrim behind the bars — that scrim is the grey strip.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            getWindow().setStatusBarContrastEnforced(false);
            getWindow().setNavigationBarContrastEnforced(false);
        }

        // Dark bars → light icons (clock, battery, nav).
        WindowInsetsControllerCompat controller =
                new WindowInsetsControllerCompat(getWindow(), getWindow().getDecorView());
        controller.setAppearanceLightStatusBars(false);
        controller.setAppearanceLightNavigationBars(false);
    }
}
