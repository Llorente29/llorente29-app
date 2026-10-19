// supabase/functions/conta-justificante-csv/index.ts
//
// I01c · P1 definitiva · «Ya lo presenté fuera · pegar CSV»: trae de Hacienda
// el justificante ORIGINAL de una declaración por su CSV, como Diez y ERP10.
// El navegador lo lee (lib/justificanteAeat.ts, el lector que ya lee los
// originales), enseña la ficha con el PDF al lado y, al confirmar, lo apunta
// con conta_impuesto_justificante_apuntar, que comprueba que el NIF es el de
// la empresa. Aquí no se guarda nada.
//
// Recibe { company_id, csv } con la sesión de quien lo pide. Por orden, y en
// cuanto uno falla se para SIN llamar a Hacienda:
//   1. el formato del CSV (16 letras y cifras): la AEAT tiene un tope diario
//      de intentos fallidos, y uno mal pegado gastaría uno;
//   2. que esa persona puede gestionar los impuestos de esa empresa;
//   3. que ese CSV no está ya apuntado en esa empresa (no hace falta traerlo).
// Luego, UNA petición a la AEAT, sin certificado y sin reintentos (núcleo:
// _shared/hacienda/justificanteCsv.ts). No pasa por la puerta de conta-hacienda,
// que sigue cerrada y es para presentar.
//
// Devuelve { ok: true, pdf_base64 } o { ok: false, motivo, mensaje }, con
// motivo formato · permiso · ya_estaba · no_encontrado · no_responde.
//
// Fuera de producción, SIEMPRE el doble, sin variable que poner: en vez de la
// AEAT, el PDF inventado que la prueba dejó en <cuenta>/doble-aeat/<CSV>.pdf
// (conta-documentos), leído con la sesión de quien llama; si no está, como
// Hacienda: «no lo tengo». Así staging no puede llamar a Hacienda por descuido,
// y producción no puede usar el doble.
//
// En el registro, nada: ni el CSV, ni el PDF, ni la empresa.
//
// verify_jwt = true (config.toml).

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { enBase64, limpiarCsv, type Respuesta, traerPorCsv, URL_CSV_AEAT, csvValido, MENSAJES } from "../_shared/hacienda/justificanteCsv.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const PRODUCCION_REF = "xzmpnchlguibclvxyynt";
const DOBLE = !SUPABASE_URL.includes(PRODUCCION_REF);
const ESPERA_MS = 25_000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
const uuid = (v: unknown) => (typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) ? v : null);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, mensaje: "Esto solo se pide con POST." }, 405);

  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const persona = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
  const { data: sesion } = await persona.auth.getUser(jwt);
  if (!sesion?.user?.id) return json({ ok: false, motivo: "permiso", mensaje: "Tienes que entrar con tu usuario." }, 401);

  let cuerpo: Record<string, unknown>;
  try { cuerpo = await req.json(); } catch { return json({ ok: false, mensaje: "No se entiende lo que llega." }, 400); }
  const empresa = uuid(cuerpo.company_id);
  if (!empresa) return json({ ok: false, mensaje: "Falta la empresa." }, 400);

  // 1 · El formato, antes que nada.
  const csv = limpiarCsv(cuerpo.csv);
  if (!csvValido(csv)) return json({ ok: false, motivo: "formato", mensaje: MENSAJES.formato });

  // 2 · Quien lo pide puede gestionar los impuestos de esa empresa (la regla de la base, con su JWT).
  const { data: puede, error: ePuede } = await persona.rpc("conta_impuesto_puede_gestionar", { p_company: empresa });
  if (ePuede || puede !== true) {
    return json({ ok: false, motivo: "permiso", mensaje: "Solo un administrador o un encargado de la empresa, o su asesoría con su consentimiento, trae justificantes de Hacienda." });
  }
  const { data: emp } = await persona.from("company").select("account_id").eq("id", empresa).maybeSingle();
  if (!emp?.account_id) return json({ ok: false, motivo: "permiso", mensaje: "No encuentro esa empresa." });

  // 3 · Si ese CSV ya está apuntado en la empresa, no se pregunta a Hacienda.
  const { data: ya } = await persona.from("tax_return").select("id, form_code, fiscal_year, period")
    .eq("company_id", empresa).eq("aeat_csv", csv).limit(1).maybeSingle();
  if (ya) {
    return json({ ok: false, motivo: "ya_estaba", declaracion: ya.id,
      mensaje: `Ese justificante ya está en Presentados: el ${ya.form_code} del ${ya.period}/${ya.fiscal_year}. No hace falta traerlo otra vez.` });
  }

  const pedir = DOBLE
    ? async (c: string): Promise<Respuesta | null> => {
        const { data } = await persona.storage.from("conta-documentos").download(`${emp.account_id}/doble-aeat/${c}.pdf`);
        if (!data) return { status: 200, tipo: "text/html", cuerpo: new TextEncoder().encode("<html>No se ha podido recuperar ningún documento con ese CSV</html>") };
        return { status: 200, tipo: "application/pdf", cuerpo: new Uint8Array(await data.arrayBuffer()) };
      }
    : async (c: string): Promise<Respuesta | null> => {
        try {
          const r = await fetch(URL_CSV_AEAT + encodeURIComponent(c), {
            redirect: "manual", signal: AbortSignal.timeout(ESPERA_MS), headers: { "User-Agent": "Sumied/1.0 (justificante por CSV)" },
          });
          return { status: r.status, tipo: r.headers.get("content-type") ?? "", cuerpo: new Uint8Array(await r.arrayBuffer()) };
        } catch {
          return null;
        }
      };

  const t = await traerPorCsv(csv, pedir);
  console.log(JSON.stringify({ funcion: "conta-justificante-csv", doble: DOBLE, resultado: t.ok ? "pdf" : t.motivo }));
  if (!t.ok) return json({ ok: false, motivo: t.motivo, mensaje: t.mensaje });
  return json({ ok: true, pdf_base64: enBase64(t.pdf), doble: DOBLE });
});
