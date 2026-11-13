// supabase/functions/conta-pdf/index.ts
//
// B01r·26 (13/11) · EL ENLACE PERMANENTE DE UN PDF, CON LLAVE POR DOCUMENTO
// (decisión de Julio del 24/10, docs/conta/c12/traspaso-completo.md).
//
//   GET /functions/v1/conta-pdf/<llave>   (llave: 32 hex, 128 bits)
//
// Quien llama es el servidor de Diez, al importar el Excel del traspaso con la
// columna «Url documento»: no tiene sesión, de ahí verify_jwt = false. La
// frontera es la llave: aleatoria, una por documento, solo para lo que ha ido en
// un traspaso confirmado, retirable, con tope por hora, y cada acceso apuntado
// (conta_pdf_servir, migración 20261113T1805).
//
// Contesta:
//   · 200 con el PDF (Cache-Control: private, no-store; X-Robots-Tag: noindex);
//   · 404 «No existe» para una llave que no existe, retirada o de un asiento
//     anulado (la misma respuesta: no se dice cuál de las tres);
//   · 429 si la llave pasa del tope de la hora;
//   · 500 si algo propio falla (sin detalles: el registro, solo el código).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decidir } from "../_shared/contaPdf.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICIO = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET = "conta-documentos";

async function hashIp(ip: string): Promise<string | null> {
  if (!ip) return null;
  const dia = new Date().toISOString().slice(0, 10);
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${dia}|${ip}`));
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

Deno.serve(async (req) => {
  const llave = new URL(req.url).pathname.split("/").filter(Boolean).pop() ?? "";
  const metodo = req.method === "GET" || req.method === "HEAD" ? req.method : null;
  const previo = decidir({ metodo: req.method, llave });
  if (previo) return previo;

  const srv = createClient(SUPABASE_URL, SERVICIO, { auth: { persistSession: false } });
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  const { data, error } = await srv.rpc("conta_pdf_servir", { p_llave: llave, p_ip_hash: await hashIp(ip) });
  if (error) { console.error(`conta-pdf · servir · ${error.code ?? "error"}`); return decidir({ metodo: "GET", llave, fallo: true })!; }
  const fila = (Array.isArray(data) ? data[0] : data) as { resultado: string; storage_path: string | null; file_name: string | null; sha256: string | null } | null;
  const tras = decidir({ metodo: "GET", llave, resultado: fila?.resultado ?? "no_existe" });
  if (tras) return tras;

  const { data: blob, error: e2 } = await srv.storage.from(BUCKET).download(fila!.storage_path!);
  if (e2 || !blob) { console.error("conta-pdf · el documento no se ha podido leer"); return decidir({ metodo: "GET", llave, fallo: true })!; }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return new Response(metodo === "HEAD" ? null : bytes, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(bytes.length),
      "Content-Disposition": `inline; filename="${fila!.file_name}"`,
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
