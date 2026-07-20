# Folvy · App nativa (Estación de impresión) — build y distribución del APK

Frente onboarding de impresión (F1–F6). La app web es la misma "Folvy"; el APK
nativo (Capacitor Android) añade lo que el navegador no puede: **socket TCP a la
impresora** (plugin `EscposPrinter.print`) y **autodescubrimiento LAN** (F4,
`EscposPrinter.discover`). Sin el APK, el admin web (F2) gestiona impresoras pero
no imprime ni descubre.

## Cuándo hay que reconstruir el APK

Cada vez que cambie **código nativo** (`android/`, `capacitor.config.ts`) o el
**bundle web** que el APK empaqueta. En particular:

- **F3** (pairing por QR, worker que arranca sin consola, gating por modo).
- **F4** (método nativo `discover` en `EscposPrinterPlugin.java`) → **imprescindible
  reconstruir**: un APK anterior no tiene `discover` y el botón "Buscar
  impresoras en la red" fallará hasta reconstruir.

## Build

Requisitos: Android Studio / SDK, JDK 17, `npx cap` (Capacitor 8).

```bash
# 1) build web (genera dist/)
npm run build

# 2) copiar el bundle web + plugins al proyecto android
npx cap sync android

# 3a) build de release firmado desde Gradle
cd android && ./gradlew assembleRelease
#   → android/app/build/outputs/apk/release/app-release.apk

# 3b) o abrir en Android Studio para firmar/generar bundle
npx cap open android
```

El plugin nativo `EscposPrinter` (socket TCP + discover) se registra en
`android/app/src/main/java/app/folvy/pos/MainActivity.java`
(`registerPlugin(EscposPrinterPlugin.class)`). No usa permisos extra: `INTERNET`
basta; la IP local del descubrimiento se obtiene por `NetworkInterface`.

## Distribución (elegir una)

1. **Tablet entregada lista** (recomendado para arranque): instalas el APK
   firmado en la tablet del cliente, la vinculas por QR una vez (queda como
   Estación) y se la entregas funcionando. Cero pasos para el cliente.
2. **Canal cerrado de Play Store** (internal testing / closed track): subes el
   bundle firmado, invitas la cuenta del cliente, se instala como app normal y
   se autoactualiza. Mejor para flota y actualizaciones.

En ambos casos el **onboarding en la tablet** es el mismo (F3): abrir Folvy →
`/estacion` → escanear el **QR de la estación** (Ajustes de cocina → Dispositivos
→ QR) → la tablet queda vinculada como Estación e imprime sola, **sin consola ni
SQL**.

## Notas de compatibilidad

- **Escaneo QR in-app** (`BarcodeDetector`): puede no existir en WebView antiguo
  (Sunmi T2 / Android 7.1). En ese caso el botón "Escanear QR" se oculta y queda
  el **pegado del token** (fallback que nunca falla) y el deep-link
  `/estacion?token=…` (escanear el QR con la cámara del sistema).
- **IP de la impresora**: reservar IP fija en el router (reserva DHCP por MAC)
  para que no cambie al reiniciar (aviso ya presente en la pantalla de impresoras).
