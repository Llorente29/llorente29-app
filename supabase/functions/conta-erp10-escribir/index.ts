// supabase/functions/conta-erp10-escribir/index.ts
//
// X10b (19/11) · SACAR A ERP10 POR LA CONEXIÓN. X10c: las emitidas también; X10d, los asientos (lo
// del X07; los días del TPV no, hasta el R07). Y LO QUE SE ESCRIBE
// SE ARMA AQUÍ, DESDE LA BASE. Lo llama la salida a ERP10 (Libros › Cierre › Salida a ERP10) con
// la sesión de un administrador, y solo dice qué:
//
//   { company_id, mes: 'AAAA-MM-01', entradas: [entry_id, …], quien }
//
// Nada más del cuerpo se lee (pedidasDelCuerpo). Con la sesión de quien pulsa se lee lo que sale ese
// mes con las mismas funciones de la base que la pantalla, y se arma con el mismo armarSalida
// (_shared/erp10DesdeLaBase.ts): cada recibida o emitida con las cuentas de ERP10, la huella de
// su fila y su PDF. Por cada una, en orden, _shared/erp10Escribir.ts: la coge
// (conta_erp10_envio_tomar), da de alta las cuentas que falten, la busca en ERP10 y la enlaza si
// ya está o la escribe, apunta su número en el acto y sube su PDF. Lo que ha entrado se apunta
// en la salida de siempre (conta_erp10_lote_apuntar, con la sesión de quien pulsa) y el número de
// ERP10 va a su partida. Así nada sale dos veces, aunque se pulse dos veces o se corte a la mitad.
//
// Las reglas de la respuesta X10 · 2, POR CLASE (recibidas y emitidas, cada una lo suyo):
//   · solo las sociedades de la lista cerrada, con su NIF comprobado (el cliente de ERP10);
//   · la PRIMERA de cada clase en cada sociedad, sola; el resto, solo después de comprobarla en el
//     paso 3 (un «Darlo por igualado» posterior a esa primera);
//   · lo que entra no se puede borrar por aquí (no hay DELETE en la API).
// Tope de tiempo: lo que no da tiempo vuelve en «quedan» y se saca en la siguiente llamada.
//
// Contesta 200 con lo que ha pasado a cada una, o { error } en palabras (regla 8): 401 sin
// sesión, 403 sin permiso, 404 sin conexión, 409 si un freno para. En el registro, solo recuentos.
//
// verify_jwt = true (config.toml).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { MOTIVO_SALIDA_PARADA, SALIDA_ERP10_PARADA } from "../_shared/erp10Parada.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { cuentaPuedeSalir } from "../_shared/puerta.ts";
import { FrenoErp10 } from "../_shared/erp10Cliente.ts";
import { loQueSaleDesdeLaBase, pedidasDelCuerpo } from "../_shared/erp10DesdeLaBase.ts";
import { leerLaBase, puertosDelServidor } from "../_shared/erp10Puerto.ts";
import { sacarYApuntar } from "../_shared/erp10Sacar.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICIO = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TOPE_MS = 40_000;
const EN_LA_DEMO = "En la demo no se escribe en ERP10.";
type Clase = "recibida" | "emitida" | "asiento" | "dia";
const PRIMERA: Record<Clase, string> = {
  recibida: "La primera factura recibida que esta sociedad saca a ERP10 sale sola, para probar. Sácala, compruébala en el paso 3 y después saca las demás.",
  emitida: "La primera factura emitida que esta sociedad saca a ERP10 sale sola, para probar. Sácala, compruébala en el paso 3 y después saca las demás.",
  asiento: "El primer asiento que esta sociedad saca a ERP10 sale solo, para probar. Sácalo, compruébalo en el paso 3 y después saca los demás.",
  dia: "El primer día del TPV que esta sociedad saca a ERP10 sale solo, para probar. Sácalo, compruébalo en el paso 3 y después saca los demás.",
};
const SIN_COMPROBAR: Record<Clase, string> = {
  recibida: "Antes de sacar más facturas recibidas, comprueba en el paso 3 la de prueba y dala por igualada.",
  emitida: "Antes de sacar más facturas emitidas, comprueba en el paso 3 la de prueba y dala por igualada.",
  asiento: "Antes de sacar más asientos, comprueba en el paso 3 el de prueba y dalo por igualado.",
  dia: "Antes de sacar más días del TPV, comprueba en el paso 3 el de prueba y dalo por igualado.",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "usa POST" }, 405);
  const t0 = Date.now();

  const sb = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } }, auth: { persistSession: false } });
  const { data: u } = await sb.auth.getUser();
  if (!u?.user) return json({ error: "no autenticado" }, 401);
  // X31 · 0 · La salida a ERP10, parada en todas las empresas hasta que esté la comprobación de lo que ya hay en ERP10.
  if (SALIDA_ERP10_PARADA) return json({ error: `${MOTIVO_SALIDA_PARADA}: la salida a ERP10 está parada.`, parada: true }, 409);

  let b: { company_id?: unknown; mes?: unknown; quien?: unknown } = {};
  try { b = await req.json(); } catch { /* vacío */ }
  const companyId = typeof b.company_id === "string" && /^[0-9a-f-]{36}$/i.test(b.company_id) ? b.company_id : "";
  const mes = typeof b.mes === "string" && /^\d{4}-\d{2}-01$/.test(b.mes) ? b.mes : "";
  const pedidas = pedidasDelCuerpo(b);
  const quien = typeof b.quien === "string" ? b.quien.slice(0, 120) : null;
  if (!companyId || !mes || !pedidas.length) return json({ error: "faltan company_id, mes (AAAA-MM-01) o los asientos (entradas)" }, 400);

  // La sociedad, con los permisos de quien llama; solo un administrador.
  const { data: co, error: e0 } = await sb.from("company").select("id, account_id").eq("id", companyId).maybeSingle();
  if (e0) return json({ error: `no se ha podido leer la sociedad: ${e0.message}` }, 500);
  if (!co) return json({ error: "Esa sociedad no es de tu cuenta." }, 403);
  const { data: admin } = await sb.rpc("current_user_is_admin_of", { p_account_id: co.account_id });
  if (admin !== true) return json({ error: "Solo un administrador de la cuenta saca a ERP10." }, 403);
  const srv = createClient(SUPABASE_URL, SERVICIO, { auth: { persistSession: false } });
  if (!(await cuentaPuedeSalir(srv, co.account_id))) return json({ error: EN_LA_DEMO, demo: true }, 409);

  // Lo que sale ese mes, DESDE LA BASE, con la sesión de quien pulsa (las mismas funciones que la pantalla).
  let base;
  try {
    base = await loQueSaleDesdeLaBase(await leerLaBase(sb, companyId, mes), pedidas);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }

  // Por clase: la primera, sola; las demás, después de comprobarla. X10e: los días del TPV, su propia clase
  // (sus envíos llevan la marca del día y no cuentan como emitidas ni como asientos).
  for (const clase of ["recibida", "emitida", "asiento", "dia"] as const) {
    const n = base.salen.filter((x) => x.clase === clase).length;
    if (!n) continue;
    const q = srv.from("conta_erp10_envio").select("creado_en").eq("company_id", companyId).eq("account_id", co.account_id).eq("estado", "en_erp10");
    const { data: entradas, error: e1 } = await (clase === "dia" ? q.eq("clase", "emitida").eq("dia", true) : q.eq("clase", clase).or("dia.is.null,dia.eq.false"))
      .order("creado_en", { ascending: true }).limit(1);
    if (e1) return json({ error: `no se ha podido leer lo que ya ha salido a ERP10: ${e1.message}` }, 500);
    const primera = (entradas ?? [])[0]?.creado_en as string | undefined;
    if (n > 1 && !primera) return json({ error: PRIMERA[clase], primera: true, clase }, 409);
    if (n > 1) {
      const { data: ig } = await srv.from("conta_erp10_igualado").select("id").eq("company_id", companyId).eq("account_id", co.account_id).gt("igualado_en", primera).limit(1);
      if (!(ig ?? []).length) return json({ error: SIN_COMPROBAR[clase], sinComprobar: true, clase }, 409);
    }
  }

  try {
    // X10f · La misma pieza que la cola (_shared/erp10Sacar.ts y erp10Puerto.ts): aquí, «a mano» y apuntado con la sesión de quien pulsa.
    const puertos = await puertosDelServidor(srv, { accountId: co.account_id, companyId, quien, como: "a_mano", apuntaCon: sb });
    if (!puertos) return json({ error: "Esta sociedad no está conectada con ERP10: pon su código de empresa en «Conexión con ERP10»." }, 404);
    const { resultados, quedan, sinApuntar: apuntado } = await sacarYApuntar(base, puertos(mes), () => Date.now() - t0 > TOPE_MS);
    console.log(JSON.stringify({ pedidas: pedidas.length, en_erp10: resultados.filter((r) => r.estado === "en_erp10").length, no_pudo: resultados.filter((r) => r.estado === "no_pudo").length, quedan: quedan.length }));
    return json({ ok: true, resultados, quedan, sinApuntar: apuntado });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(JSON.stringify({ fallo: e instanceof FrenoErp10 ? "freno" : "erp10" }));
    return json({ error: msg }, e instanceof FrenoErp10 ? 409 : 502);
  }
});
