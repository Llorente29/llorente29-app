package app.folvy.pos;

import android.os.Bundle;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    // Modo inmersivo (Estación): oculta barra de navegación + barra de estado.
    // Lo activa/desactiva el plugin (EscposPrinter.setImmersive) según device_mode.
    private boolean immersiveEnabled = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(EscposPrinterPlugin.class);
        super.onCreate(savedInstanceState);
    }

    /** Llamado desde EscposPrinterPlugin.setImmersive. */
    public void setImmersive(boolean enabled) {
        immersiveEnabled = enabled;
        runOnUiThread(this::applyImmersive);
    }

    private void applyImmersive() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), !immersiveEnabled);
        WindowInsetsControllerCompat controller =
                WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        if (controller == null) return;
        if (immersiveEnabled) {
            controller.setSystemBarsBehavior(
                    WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            controller.hide(WindowInsetsCompat.Type.systemBars());
        } else {
            controller.show(WindowInsetsCompat.Type.systemBars());
        }
    }

    // Android restaura las barras al recuperar el foco (volver de 2º plano, cambiar
    // de app y volver, diálogos). Reaplicamos el inmersivo si estaba activo.
    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus && immersiveEnabled) applyImmersive();
    }
}
