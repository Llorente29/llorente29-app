// supabase/functions/conta-recibida-pdf/index.ts
//
// D02 · Toda factura recibida tiene su PDF desde que entra (Julio, 22/10). La
// despierta, cada minuto y solo si hay algo, conta_recibida_pdf_despertar
// (cron conta-recibida-pdf-despertar, con el cron_secret del Vault). Hace los
// dos pasos de _shared/recibidaPdf.ts: las fotos que han entrado, a PDF; y el
// PDF de cada recibida validada, enlazado a su asiento (lo que espera el envío
// a Diez). Cada fallo queda apuntado en su fila con su motivo y su reintento.
//
// Sin sesión: verify_jwt = false (config.toml) y la cabecera x-cron-secret
// tiene que ser CRON_SECRET, como conta-diez-cola. Contesta recuentos; en el
// registro, solo recuentos (ni nombres, ni números, ni rutas).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { pasada, type PorEnlazar, type PorHacer, type PuertoPdf } from "../_shared/recibidaPdf.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICIO = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DOCUMENTOS = "conta-documentos";
/** Por paso y pasada: una foto de móvil son unos cientos de KB. */
const POR_PASADA = 20;
/** Si se acerca el tope de la función, lo que quede lo coge la pasada siguiente. */
const TOPE_MS = 100_000;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "usa POST" }, 405);
  const esperado = Deno.env.get("CRON_SECRET") ?? "";
  const dado = req.headers.get("x-cron-secret") ?? "";
  if (!esperado || dado !== esperado) return json({ error: "no autorizado" }, 401);

  const t0 = Date.now();
  const srv = createClient(SUPABASE_URL, SERVICIO, { auth: { persistSession: false } });
  const rpc = async <T>(fn: string, args: Record<string, unknown>): Promise<T> => {
    const { data, error } = await srv.rpc(fn, args);
    if (error) throw new Error(error.message);
    return data as T;
  };

  const puerto: PuertoPdf = {
    async reclamar(limite) {
      const filas = await rpc<{ invoice_id: string; account_id: string; ficheros: { bucket: string; ruta: string }[] }[]>("conta_recibida_pdf_reclamar", { p_limite: limite });
      return (filas ?? []).map((f): PorHacer => ({ factura: f.invoice_id, cuenta: f.account_id, ficheros: f.ficheros ?? [] }));
    },
    async bajar(f) {
      const { data, error } = await srv.storage.from(f.bucket).download(f.ruta);
      if (error || !data) throw new Error(`no se ha podido leer el fichero guardado (${error?.message ?? "vacío"})`);
      return new Uint8Array(await data.arrayBuffer());
    },
    async subir(ruta, pdf) {
      const { error } = await srv.storage.from(DOCUMENTOS).upload(ruta, new Blob([pdf], { type: "application/pdf" }), { contentType: "application/pdf", upsert: false });
      if (error && !/exists|duplicate/i.test(error.message)) throw new Error(`no se ha podido guardar el PDF (${error.message})`);
    },
    async hecho(factura, ruta, sha256, bytes, paginas) {
      await rpc("conta_recibida_pdf_hecho", { p_invoice: factura, p_ruta: ruta, p_sha256: sha256, p_bytes: bytes, p_paginas: paginas });
    },
    async fallo(factura, motivo, enlace) {
      await rpc("conta_recibida_pdf_fallo", { p_invoice: factura, p_motivo: motivo, p_enlace: enlace });
    },
    async porEnlazar(limite) {
      const filas = await rpc<{ entry_id: string; account_id: string; invoice_id: string; bucket: string; ruta: string; nombre: string }[]>("conta_recibida_pdf_por_enlazar", { p_limite: limite });
      return (filas ?? []).map((f): PorEnlazar => ({ asiento: f.entry_id, cuenta: f.account_id, factura: f.invoice_id, fuente: { bucket: f.bucket, ruta: f.ruta }, nombre: f.nombre }));
    },
    async enlazar(asiento, ruta, nombre, sha256, bytes) {
      await rpc("conta_recibida_pdf_enlazar", { p_entry: asiento, p_ruta: ruta, p_nombre: nombre, p_sha256: sha256, p_bytes: bytes });
    },
    async sha256(b) {
      const h = new Uint8Array(await crypto.subtle.digest("SHA-256", b));
      return Array.from(h, (x) => x.toString(16).padStart(2, "0")).join("");
    },
  };

  try {
    const r = await pasada(puerto, { limite: POR_PASADA, seguir: () => Date.now() - t0 < TOPE_MS });
    console.log(`conta-recibida-pdf · PDF hechos ${r.hechos} · sin hacer ${r.fallos} · enlazados ${r.enlazados} · sin enlazar ${r.sinEnlazar} · para la siguiente ${r.sinTiempo}`);
    return json({ hechos: r.hechos, sin_hacer: r.fallos, enlazados: r.enlazados, sin_enlazar: r.sinEnlazar, para_la_siguiente: r.sinTiempo });
  } catch (e) {
    console.error(`conta-recibida-pdf · la pasada se ha cortado: ${e instanceof Error ? e.message : String(e)}`);
    return json({ error: "la pasada se ha cortado" }, 500);
  }
});
