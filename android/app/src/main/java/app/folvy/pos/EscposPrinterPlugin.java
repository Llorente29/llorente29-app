package app.folvy.pos;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import android.util.Base64;

import java.io.OutputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.Socket;
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
