// supabase/functions/_shared/justificanteServidor.ts
//
// B01 · Cola 1e · Las piezas del justificante en una edge function (Deno):
// jsPDF, el azar, el almacén (conta-documentos) y el correo con su freno. Lo
// puro está en justificantePago.ts, con sus pruebas. Lo usan la lectura de
// cada hora y el aviso de Revolut, «Pagar» (conta-pagar) y conta-justificante.

import { jsPDF } from "npm:jspdf@4.2.1";
import { justificantePagoPdf, mandarJustificante, nuevaClave, type PiezasJustificante } from "./justificantePago.ts";

export const BUCKET_JUSTIFICANTES = "conta-documentos";

// deno-lint-ignore no-explicit-any
export function piezasJustificante(srv: any): PiezasJustificante {
  return {
    pdf: (d) => justificantePagoPdf(jsPDF, d),
    clave: () => nuevaClave((n) => crypto.getRandomValues(new Uint8Array(n))),
    subir: async (ruta, pdf) => {
      const { error } = await srv.storage.from(BUCKET_JUSTIFICANTES).upload(ruta, new Blob([pdf], { type: "application/pdf" }), { contentType: "application/pdf", upsert: true });
      if (error) throw new Error(`No se ha podido guardar el PDF: ${error.message}`);
    },
    mandar: (para, d, pdf) => mandarJustificante({
      fetch, resendKey: Deno.env.get("RESEND_API_KEY"), abiertos: Deno.env.get("CORREO_MARCA_ABIERTOS"), para, d, pdf,
    }),
  };
}
