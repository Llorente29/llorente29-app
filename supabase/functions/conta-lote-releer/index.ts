// supabase/functions/conta-lote-releer/index.ts
//
// E05 · Volver a leer en el servidor los PDF de una quincena de Catcher y
// volver a cruzar (Julio, 22/10): _shared/catcherReleer.ts, con el mismo código
// que el front. Dos formas de llamarla, y las dos dejan su relectura apuntada
// (conta_lote_relectura):
//   · con la sesión de quien pulsa «Volver a comprobar»: la pide
//     conta_lote_releer_pedir, que mira que sea administrador o encargado;
//   · con la cabecera x-cron-secret (el CRON_SECRET de los vigías), desde la
//     base (conta_lote_releer_lanzar), con la relectura ya apuntada.
// Lo demás lo hace con la clave de servicio, por las funciones de la base que
// lo admiten (0480). verify_jwt = false (config.toml): la sesión la comprueba
// conta_lote_releer_pedir. En el registro, solo recuentos.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// pdfjs para servidor (unpdf, 1,7 MB): con npm:pdfjs-dist el paquete entero
// (35 MB) iba dentro de la función y Supabase la rechazaba (413, 22/10). Saca el
// mismo texto que el pdfjs del front: medido sobre los 15 PDF de tests/.
import { getDocumentProxy } from "npm:unpdf@1.8.1";
import { textoPorPosicion } from "../_shared/catcherPdf.ts";
import { releerLote, textoReleido, type FacturaGuardada, type PuertoReleer } from "../_shared/catcherReleer.ts";
import type { PedidoApp, Tarifa } from "../_shared/catcherCruces.ts";
import type { PedidoExcel } from "../_shared/catcherTipos.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICIO = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const BUCKET = "receipt-uploads";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "usa POST" }, 405);
  const cuerpo = await req.json().catch(() => ({})) as { lote?: string; relectura?: string; quien?: string };
  if (!cuerpo.lote) return json({ error: "falta el lote" }, 400);
  const srv = createClient(SUPABASE_URL, SERVICIO, { auth: { persistSession: false } });

  // ¿Quién la pide?
  let relectura: string;
  const esperado = Deno.env.get("CRON_SECRET") ?? "";
  const secreto = req.headers.get("x-cron-secret") ?? "";
  if (secreto) {
    if (!esperado || secreto !== esperado || !cuerpo.relectura) return json({ error: "no autorizado" }, 401);
    relectura = cuerpo.relectura;
  } else {
    const auth = req.headers.get("authorization") ?? "";
    if (!/^bearer\s+/i.test(auth)) return json({ error: "no autorizado" }, 401);
    const usuario = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false }, global: { headers: { Authorization: auth } } });
    const { data, error } = await usuario.rpc("conta_lote_releer_pedir", { p_lote: cuerpo.lote, p_quien_nombre: cuerpo.quien ?? null });
    if (error) return json({ error: error.message }, error.code === "42501" ? 403 : 400);
    relectura = String(data);
  }
  const { data: emp, error: eEmp } = await srv.rpc("conta_lote_relectura_empezar", { p_relectura: relectura });
  if (eEmp) return json({ error: eEmp.message }, 409);
  const e = emp as { lote: string; cuenta: string; quien: string | null };
  if (e.lote !== cuerpo.lote) return json({ error: "esa relectura es de otro lote" }, 400);
  const cuenta = e.cuenta, lote = e.lote;

  const leer = async <T>(q: PromiseLike<{ data: T | null; error: { message: string } | null }>, que: string): Promise<T> => {
    const { data, error } = await q;
    if (error) throw new Error(`no se ha podido leer ${que}: ${error.message}`);
    return data as T;
  };
  const puerto: PuertoReleer = {
    async lote() {
      const l = await leer<{ id: string; period_from: string; period_to: string; grand_total: number | null; company_id: string }>(
        srv.from("supplier_batch").select("id, period_from, period_to, grand_total, company_id").eq("id", lote).eq("account_id", cuenta).single(), "el lote");
      return { id: l.id, desde: l.period_from, hasta: l.period_to, total: l.grand_total == null ? null : Number(l.grand_total) };
    },
    async facturas() {
      const fs = await leer<{ id: string; invoice_number: string; status: string; raw_document_url: string | null; tax_base_total: number; grand_total: number; reading: unknown }[]>(
        srv.from("supplier_invoice").select("id, invoice_number, status, raw_document_url, tax_base_total, grand_total, reading").eq("batch_id", lote).eq("account_id", cuenta), "las facturas");
      return fs.map((f): FacturaGuardada => ({ id: f.id, numero: f.invoice_number, estado: f.status, ruta: f.raw_document_url, base: Number(f.tax_base_total), total: Number(f.grand_total), lectura: f.reading as FacturaGuardada['lectura'] }));
    },
    async texto(ruta) {
      if (!ruta.startsWith(`${cuenta}/`)) throw new Error("el PDF no es de esta cuenta");
      const { data, error } = await srv.storage.from(BUCKET).download(ruta);
      if (error || !data) throw new Error(`no se ha podido leer el PDF guardado (${error?.message ?? "vacío"})`);
      const bytes = new Uint8Array(await data.arrayBuffer());
      const sha256 = hex(await crypto.subtle.digest("SHA-256", bytes));
      const doc = await getDocumentProxy(bytes.slice(), { verbosity: 0, useSystemFonts: false, disableFontFace: true });
      let texto = "";
      for (let i = 1; i <= doc.numPages; i++) {
        const items = (await (await doc.getPage(i)).getTextContent()).items as { str?: string; transform?: number[] }[];
        texto += textoPorPosicion(items) + "\n";
      }
      await doc.cleanup();
      return { texto, sha256 };
    },
    async guardarLecturas(l) {
      return await leer(srv.rpc("conta_lote_relectura_guardar", { p_relectura: relectura, p_lecturas: l }), "la lectura guardada");
    },
    async pedidos() {
      const ps = await leer<{ invoice_number: string; kind: string; order_code: string; order_status: string; ordered_at: string | null; tax_base: number; tax_amount: number; total: number }[]>(
        srv.from("supplier_batch_order").select("invoice_number, kind, order_code, order_status, ordered_at, tax_base, tax_amount, total").eq("batch_id", lote).eq("account_id", cuenta), "los pedidos");
      return ps.map((p): PedidoExcel => ({ factura: p.invoice_number, tipo: p.kind, codigo: p.order_code, estado: p.order_status,
        momento: p.ordered_at ? new Date(p.ordered_at).toISOString() : null, base: Number(p.tax_base), cuota: Number(p.tax_amount), total: Number(p.total) }));
    },
    async app() {
      const a = await leer<PedidoApp[]>(srv.rpc("conta_lote_pedidos_app", { p_lote: lote }), "los pedidos de la app");
      return (a ?? []).map((x) => ({ ...x, momento: new Date(x.momento).toISOString(), precio: x.precio == null ? null : Number(x.precio) }));
    },
    async tarifas() {
      const l = await leer<{ company_id: string }>(srv.from("supplier_batch").select("company_id").eq("id", lote).single(), "el lote");
      const ts = await leer<{ valid_from: string; params: Omit<Tarifa, "desde"> }[]>(
        srv.from("supplier_rate").select("valid_from, params").eq("account_id", cuenta).eq("company_id", l.company_id).eq("provider", "catcher").order("valid_from"), "la tarifa");
      return ts.map((r) => ({ ...r.params, desde: r.valid_from }));
    },
    async guardarCruce(c) {
      const r = await leer<{ texto?: string }>(srv.rpc("conta_lote_cruce_guardar", { p_lote: lote, p_cruce: c, p_quien_nombre: e.quien }), "el cruce guardado");
      return { texto: String(r?.texto ?? "") };
    },
  };

  try {
    const r = await releerLote(puerto);
    const texto = textoReleido(r);
    await srv.rpc("conta_lote_relectura_hecha", { p_relectura: relectura, p_cruce: { releidas: r.releidas, seguras: r.seguras, sin_tocar: r.sinTocar, sin_pdf: r.sinPdf, fallidas: r.fallidas, texto } });
    console.log(`conta-lote-releer · releídas ${r.releidas} · seguras al leer ${r.seguras} · sin tocar ${r.sinTocar} · sin PDF ${r.sinPdf} · sin poder leer ${r.fallidas.length}`);
    return json({ relectura, releidas: r.releidas, seguras: r.seguras, sin_tocar: r.sinTocar, sin_pdf: r.sinPdf, fallidas: r.fallidas.length, texto });
  } catch (x) {
    const m = x instanceof Error ? x.message : String(x);
    await srv.rpc("conta_lote_relectura_hecha", { p_relectura: relectura, p_cruce: null, p_error: m });
    console.error("conta-lote-releer · la relectura se ha cortado (el motivo, en conta_lote_relectura)");
    return json({ error: `No se ha podido volver a comprobar: ${m}` }, 500);
  }
});
