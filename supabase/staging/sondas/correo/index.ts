// supabase/staging/sondas/correo/index.ts  (Deno; fuera de supabase/functions a propósito: main no la despliega)
//
// B01 · LA SONDA DEL CORREO, solo en staging-conta y en SOLO LECTURA.
//
// La pregunta (Julio, 01/11): ¿por qué staging no manda correos? El 535 venía
// del SMTP de Supabase Auth, pero send-email va por otro camino: la API de
// Resend con el secreto RESEND_API_KEY, después del freno CORREO_MARCA_ABIERTOS.
// Esta sonda mira, desde dentro de staging, lo que solo se ve desde dentro:
//
//   1. si las funciones de staging tienen RESEND_API_KEY y el freno, y si el
//      freno abre los dos correos de los pagos (solo sí o no: nunca el valor);
//   2. qué dice Resend de esa clave, con una pregunta que no manda nada
//      (GET /domains): vale, vale solo para mandar (restringida), o no vale;
//   3. si los dominios de los remitentes (los de las marcas) están verificados
//      en esa cuenta de Resend.
//
// No manda ningún correo. No escribe la clave ni el freno en ningún sitio:
// devuelve solo códigos y sí/no. El workflow la copia a
// supabase/functions/correo-sonda/ dentro del runner, la llama una vez y la borra.

import { MARCAS } from "../_shared/marcas.ts";

const PRODUCCION_REF = "xzmpnchlguibclvxyynt";
const API = "https://api.resend.com";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Los dominios desde los que manda send-email: el de Folvy de siempre y el de cada marca con remitente. */
function dominiosDeRemitente(): string[] {
  const deUno = (from: string) => (from.match(/@([a-z0-9.-]+)>?\s*$/i)?.[1] ?? "").toLowerCase();
  const xs = ["Folvy <no-reply@folvy.app>", ...Object.values(MARCAS).map((m) => m.remitente).filter((x): x is string => !!x)].map(deUno).filter(Boolean);
  return [...new Set(xs)].sort();
}

Deno.serve(async (req) => {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  if (url.includes(PRODUCCION_REF)) return json({ ok: false, error: "produccion" }, 403);
  const tok = Deno.env.get("CORREO_SONDA_TOKEN") ?? "";
  if (!tok || req.headers.get("x-correo-sonda") !== tok) return json({ ok: false, error: "token" }, 401);

  const clave = Deno.env.get("RESEND_API_KEY") ?? "";
  const freno = (Deno.env.get("CORREO_MARCA_ABIERTOS") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const abre = (plantilla: string) => freno.some((x) => x === plantilla || x.startsWith(`${plantilla}:`)) ? (freno.some((x) => x === plantilla) ? 2 : 1) : 0;
  const out: Record<string, unknown> = {
    ok: true,
    tiene_clave: clave ? 1 : 0,
    clave_empieza_por_re: clave.startsWith("re_") ? 1 : 0,
    freno_entradas: freno.length,
    // 2 = abierta para todos; 1 = solo para algún correo (p. ej. el de prueba); 0 = cerrada.
    freno_codigo_pago_conta: abre("codigo_pago_conta"),
    freno_aviso_pago_conta: abre("aviso_pago_conta"),
    dominios: {} as Record<string, number>,
  };
  if (!clave) return json(out);

  let r: Response;
  try { r = await fetch(`${API}/domains`, { headers: { Authorization: `Bearer ${clave}` } }); }
  catch { return json({ ...out, resend_status: 0, resend_error: "red" }); }
  const cuerpo = await r.json().catch(() => ({})) as { name?: string; data?: { name?: string; status?: string }[] };
  out.resend_status = r.status;
  // El nombre del error de Resend, si lo hay (restricted_api_key, invalid_api_key, missing_api_key…): lo escribe Resend, no es un dato.
  out.resend_error = r.ok ? null : String(cuerpo.name ?? "otro");
  const dominios = out.dominios as Record<string, number>;
  if (r.ok) {
    const lista = cuerpo.data ?? [];
    out.dominios_en_resend = lista.length;
    // 2 = verificado; 1 = está pero sin verificar; 0 = no está en esa cuenta de Resend.
    for (const d of dominiosDeRemitente()) {
      const x = lista.find((y) => (y.name ?? "").toLowerCase() === d);
      dominios[d] = !x ? 0 : x.status === "verified" ? 2 : 1;
    }
  }
  return json(out);
});
