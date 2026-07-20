package app.folvy.pos;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import com.google.mlkit.vision.barcode.common.Barcode;
import com.google.mlkit.vision.codescanner.GmsBarcodeScanner;
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions;
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Base64;

import androidx.core.content.FileProvider;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.Socket;
import java.net.URL;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Enumeration;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

@CapacitorPlugin(name = "EscposPrinter")
public class EscposPrinterPlugin extends Plugin {

    @PluginMethod
    public void print(PluginCall call) {
        String host = call.getString("host");
        Integer port = call.getInt("port", 9100);
        String dataB64 = call.getString("data");

        if (host == null || dataB64 == null) {
            call.reject("Faltan parametros: host y data (base64) son obligatorios");
            return;
        }

        new Thread(() -> {
            Socket socket = null;
            try {
                byte[] bytes = Base64.decode(dataB64, Base64.DEFAULT);
                socket = new Socket();
                socket.connect(new InetSocketAddress(host, port), 5000);
                OutputStream out = socket.getOutputStream();
                out.write(bytes);
                out.flush();
                out.close();
                socket.close();
                JSObject ret = new JSObject();
                ret.put("ok", true);
                call.resolve(ret);
            } catch (Exception e) {
                if (socket != null) { try { socket.close(); } catch (Exception ignored) {} }
                call.reject("Error socket: " + e.getMessage());
            }
        }).start();
    }

    // F4 — Autodescubrimiento: escanea la subred /24 del dispositivo probando el
    // puerto 9100 (o el indicado). Devuelve las IPs que aceptan conexion TCP.
    // No requiere permisos extra (INTERNET ya lo tiene la app; la IP local se
    // obtiene por NetworkInterface, sin ACCESS_WIFI_STATE ni localizacion).
    @PluginMethod
    public void discover(PluginCall call) {
        final int port = call.getInt("port", 9100);
        final int timeoutMs = call.getInt("timeoutMs", 300);
        final String baseIp = call.getString("baseIp");

        new Thread(() -> {
            try {
                String prefix;
                if (baseIp != null && baseIp.contains(".")) {
                    prefix = baseIp.substring(0, baseIp.lastIndexOf('.') + 1);
                } else {
                    String local = getLocalIpv4();
                    if (local == null) {
                        call.reject("No se pudo determinar la IP local del dispositivo");
                        return;
                    }
                    prefix = local.substring(0, local.lastIndexOf('.') + 1);
                }

                final List<String> found = Collections.synchronizedList(new ArrayList<String>());
                ExecutorService pool = Executors.newFixedThreadPool(64);
                for (int i = 1; i <= 254; i++) {
                    final String host = prefix + i;
                    pool.submit(() -> {
                        Socket s = new Socket();
                        try {
                            s.connect(new InetSocketAddress(host, port), timeoutMs);
                            found.add(host);
                        } catch (Exception ignored) {
                        } finally {
                            try { s.close(); } catch (Exception ignored) {}
                        }
                    });
                }
                pool.shutdown();
                pool.awaitTermination(30, TimeUnit.SECONDS);

                Collections.sort(found, (a, b) -> {
                    try {
                        int ia = Integer.parseInt(a.substring(a.lastIndexOf('.') + 1));
                        int ib = Integer.parseInt(b.substring(b.lastIndexOf('.') + 1));
                        return Integer.compare(ia, ib);
                    } catch (Exception e) {
                        return a.compareTo(b);
                    }
                });

                JSArray arr = new JSArray();
                for (String ip : found) {
                    JSObject o = new JSObject();
                    o.put("ip", ip);
                    o.put("port", port);
                    arr.put(o);
                }
                JSObject ret = new JSObject();
                ret.put("printers", arr);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("discover: " + e.getMessage());
            }
        }).start();
    }

    // Escáner de QR nativo (Google Code Scanner de ML Kit). Lanza la UI de
    // escaneo de Google (sin permiso de cámara, sin preview propio) y devuelve
    // el texto crudo del QR. Para vincular la Estación desde la pantalla de
    // login/emparejamiento, sin login. Requiere Google Play Services.
    @PluginMethod
    public void scanQr(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                GmsBarcodeScannerOptions options = new GmsBarcodeScannerOptions.Builder()
                        .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
                        .build();
                GmsBarcodeScanner scanner = GmsBarcodeScanning.getClient(getContext(), options);
                scanner.startScan()
                        .addOnSuccessListener(barcode -> {
                            JSObject ret = new JSObject();
                            ret.put("value", barcode.getRawValue());
                            ret.put("cancelled", false);
                            call.resolve(ret);
                        })
                        .addOnCanceledListener(() -> {
                            JSObject ret = new JSObject();
                            ret.put("value", (String) null);
                            ret.put("cancelled", true);
                            call.resolve(ret);
                        })
                        .addOnFailureListener(e -> call.reject("scanQr: " + e.getMessage()));
            } catch (Exception e) {
                call.reject("scanQr: " + e.getMessage());
            }
        });
    }

    // Auto-update: versionCode/versionName instalados (para comparar con version.json).
    @PluginMethod
    public void getVersionCode(PluginCall call) {
        try {
            Context ctx = getContext();
            PackageInfo pi = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0);
            long vc = (Build.VERSION.SDK_INT >= 28) ? pi.getLongVersionCode() : (long) pi.versionCode;
            JSObject ret = new JSObject();
            ret.put("versionCode", vc);
            ret.put("versionName", pi.versionName);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("getVersionCode: " + e.getMessage());
        }
    }

    // Auto-update: descarga el APK indicado y lanza el instalador de Android.
    // En Android 8+ exige el permiso "instalar apps desconocidas"; si falta, abre
    // los ajustes para concederlo. Android muestra siempre un toque de confirmación
    // al instalar (inevitable fuera de Play/MDM).
    @PluginMethod
    public void installApk(PluginCall call) {
        final String url = call.getString("url");
        if (url == null) { call.reject("installApk: falta url"); return; }
        final Context ctx = getContext();

        new Thread(() -> {
            try {
                // Permiso de instalar apps desconocidas (Android O+).
                if (Build.VERSION.SDK_INT >= 26 && !ctx.getPackageManager().canRequestPackageInstalls()) {
                    Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                            Uri.parse("package:" + ctx.getPackageName()));
                    settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    ctx.startActivity(settings);
                    call.reject("Concede 'Instalar apps desconocidas' a Folvy y vuelve a pulsar Actualizar.");
                    return;
                }

                File out = new File(ctx.getCacheDir(), "folvy.apk");
                HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setConnectTimeout(20000);
                conn.setReadTimeout(120000);
                conn.connect();
                if (conn.getResponseCode() != 200) {
                    call.reject("installApk: HTTP " + conn.getResponseCode());
                    return;
                }
                try (InputStream in = conn.getInputStream(); FileOutputStream fos = new FileOutputStream(out)) {
                    byte[] buf = new byte[8192];
                    int n;
                    while ((n = in.read(buf)) != -1) fos.write(buf, 0, n);
                    fos.flush();
                }

                Uri uri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", out);
                Intent intent = new Intent(Intent.ACTION_VIEW);
                intent.setDataAndType(uri, "application/vnd.android.package-archive");
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(intent);

                JSObject ret = new JSObject();
                ret.put("ok", true);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("installApk: " + e.getMessage());
            }
        }).start();
    }

    // Modo inmersivo (Estación): oculta las barras de sistema. Delega en MainActivity,
    // que además lo reaplica al recuperar el foco (Android las restaura).
    @PluginMethod
    public void setImmersive(PluginCall call) {
        final boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        Activity act = getActivity();
        if (act instanceof MainActivity) {
            ((MainActivity) act).setImmersive(enabled);
        }
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    // IPv4 site-local del dispositivo (192.168.x / 10.x / 172.16-31.x).
    private String getLocalIpv4() {
        try {
            Enumeration<NetworkInterface> ifaces = NetworkInterface.getNetworkInterfaces();
            while (ifaces.hasMoreElements()) {
                NetworkInterface ni = ifaces.nextElement();
                if (!ni.isUp() || ni.isLoopback()) continue;
                Enumeration<InetAddress> addrs = ni.getInetAddresses();
                while (addrs.hasMoreElements()) {
                    InetAddress a = addrs.nextElement();
                    if (!a.isLoopbackAddress() && a instanceof Inet4Address && a.isSiteLocalAddress()) {
                        return a.getHostAddress();
                    }
                }
            }
        } catch (Exception ignored) {}
        return null;
    }
}
