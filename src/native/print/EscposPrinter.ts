// src/native/print/EscposPrinter.ts
// Wrapper JS del plugin nativo EscposPrinter (Java). Abre socket TCP a la
// impresora de red y escribe los bytes ESC/POS (en base64). Además (F4)
// descubre impresoras en la LAN escaneando el puerto 9100 de la subred /24.

import { registerPlugin } from '@capacitor/core';

export interface DiscoveredPrinter {
  ip: string;
  port: number;
}

export interface EscposPrinterPlugin {
  print(options: { host: string; port?: number; data: string }): Promise<{ ok: boolean }>;
  /**
   * Escanea la subred /24 del dispositivo buscando puertos abiertos (9100 por
   * defecto). Sólo funciona en la app nativa (Capacitor Android). En web no
   * existe el plugin → llamarlo rechaza; el llamador debe gatear por plataforma.
   *   · port: puerto a probar (def. 9100)
   *   · timeoutMs: timeout por host (def. 300)
   *   · baseIp: IP base para derivar el prefijo /24 (def. IP local del device)
   */
  discover(options?: { port?: number; timeoutMs?: number; baseIp?: string }): Promise<{ printers: DiscoveredPrinter[] }>;
  /**
   * Escáner de QR nativo (Google Code Scanner de ML Kit). Lanza la UI de Google,
   * sin permiso de cámara ni preview propio. `value` = texto crudo del QR (null
   * si se cancela). Sólo app nativa; en web no existe → llamarlo rechaza.
   */
  scanQr(): Promise<{ value: string | null; cancelled: boolean }>;
}

export const EscposPrinter = registerPlugin<EscposPrinterPlugin>('EscposPrinter');
