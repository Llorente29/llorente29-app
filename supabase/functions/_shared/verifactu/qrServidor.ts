// supabase/functions/_shared/verifactu/qrServidor.ts
//
// G05 · T4 · La matriz del QR de Verifactu en el servidor (el PDF de una
// factura de un recibo se hace al emitir, sin navegador). La misma que la del
// navegador (src/modules/conta/lib/verifactu/qr.ts · modulosQr): la librería
// qrcode, con la corrección «M».

import QRCode from "npm:qrcode@1.5.4";

export function modulosQr(url: string): boolean[][] {
  const m = QRCode.create(url, { errorCorrectionLevel: "M" }).modules;
  return Array.from({ length: m.size }, (_, i) => Array.from({ length: m.size }, (_, j) => Boolean(m.get(i, j))));
}
