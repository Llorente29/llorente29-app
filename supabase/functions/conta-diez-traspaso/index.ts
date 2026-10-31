// supabase/functions/conta-diez-traspaso/index.ts
//
// C12 (Julio, 24/10) · TRASPASAR EL MES A DIEZ. En vez de mandar cada asiento
// al validarlo, al cerrar el mes se traspasa todo de golpe. La llama la pantalla
// Contabilidad › Cierre del mes, con la sesión de quien pulsa, una vez por tanda
// hasta que no queda nada (una función tiene su tope de tiempo):
//
//   · { company_id, mes, accion: 'tanda' }: manda los siguientes del mes
//     (conta_traspaso_lista: lo validado que no está en Diez, y las anulaciones
//     de lo que sí estaba), uno a uno, por el mismo camino de siempre
//     (_shared/diezDespacho.ts, con todos sus frenos). Lo que no llega queda en
//     el traspaso con su motivo y no se reintenta en esta pasada. Contesta
//     cuántos han llegado, cuáles no y cuántos quedan.
//   · { company_id, mes, accion: 'comprobar' }: el cuadre, cuenta a cuenta,
//     de lo que Sumied dice que tiene que estar en Diez ese mes contra lo que
//     Diez tiene (las líneas de sus apuntes del mes), y el cierre del mes en Sumied si llegó todo
//     y cuadra (conta_traspaso_terminar). Se puede repetir.
//
// Quién: un administrador de la cuenta, y solo con el traspaso de ese mes
// CONFIRMADO (conta_traspaso_confirmar, después de ver el resumen). Confirmar
// vale como la autorización escrita de Julio para escribir en Diez real todo el
// mes (24/10): los asientos de la lista se mandan como autorizados. Lo demás,
// con la autorización de siempre.
//
// Contesta 200 con el resultado; 401 sin sesión, 403 sin permiso, 409 sin el
// traspaso confirmado, 500 si algo propio falla (en palabras: regla 8). En el
// registro, solo recuentos y los ids que no llegan (los textos de Diez van a la base).
//
// verify_jwt = true (config.toml).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { cuentaPuedeSalir } from "../_shared/puerta.ts";
import { clienteDiezParaLeer, despacharADiez, EN_LA_DEMO_DIEZ } from "../_shared/diezDespacho.ts";
import { aaaammDelMes, cuadrar, lineasDeApuntes, siguientes, type Saldo } from "../_shared/diezTraspaso.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICIO = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
/** Por tanda: Diez tarda unos segundos por asiento. */
const POR_TANDA = 12;
/** Si se acerca el tope de la función, lo que quede va en la tanda siguiente. */
const TOPE_MS = 100_000;

type Fallo = { entry_id: string; numero: number | null; motivo: string };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "usa POST" }, 405);

  const sb = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } }, auth: { persistSession: false } });
  const { data: u } = await sb.auth.getUser();
  if (!u?.user) return json({ error: "no autenticado" }, 401);

  let b: { company_id?: unknown; mes?: unknown; accion?: unknown } = {};
  try { b = await req.json(); } catch { /* vacío */ }
  const companyId = typeof b.company_id === "string" && /^[0-9a-f-]{36}$/i.test(b.company_id) ? b.company_id : "";
  const mes = typeof b.mes === "string" && /^\d{4}-\d{2}-01$/.test(b.mes) ? b.mes : "";
  const accion = b.accion === "tanda" || b.accion === "comprobar" ? b.accion : "";
  if (!companyId || !mes || !accion) return json({ error: "faltan company_id, mes (AAAA-MM-01) o accion (tanda o comprobar)" }, 400);

  // El traspaso, con los permisos de quien llama: si no es de su cuenta, no está.
  const { data: t, error: e0 } = await sb.from("conta_diez_traspaso").select("id, account_id, company_id, mes, estado, llegaron, no_llegaron, van")
    .eq("company_id", companyId).eq("mes", mes).maybeSingle();
  if (e0) return json({ error: `no se ha podido leer el traspaso: ${e0.message}` }, 500);
  if (!t) return json({ error: "Ese mes no tiene el traspaso confirmado. Primero se revisa y se confirma." }, 409);
  const { data: admin } = await sb.rpc("current_user_is_admin_of", { p_account_id: t.account_id });
  if (admin !== true) return json({ error: "Solo un administrador de la cuenta traspasa el mes a Diez." }, 403);

  const srv = createClient(SUPABASE_URL, SERVICIO, { auth: { persistSession: false } });
  // DM1 · PR 2a · La puerta: una cuenta de demo no habla con Diez, ni para traspasar ni para comprobar.
  if (!(await cuentaPuedeSalir(srv, t.account_id))) return json({ error: EN_LA_DEMO_DIEZ, demo: true }, 409);
  return accion === "tanda" ? tanda(srv, t) : comprobar(srv, t);
});

type Traspaso = { id: string; account_id: string; company_id: string; mes: string; estado: string; llegaron: number; no_llegaron: number; van: number };

async function tanda(srv: ReturnType<typeof createClient>, t: Traspaso): Promise<Response> {
  if (t.estado !== "confirmado" && t.estado !== "traspasando") {
    return json({ error: t.estado === "terminado" ? "Ese mes ya está traspasado." : "Ese traspaso terminó con fallos: vuelve a revisarlo y confirmarlo." }, 409);
  }
  const t0 = Date.now();
  const [{ data: lista, error: e1 }, { data: fila, error: e2 }] = await Promise.all([
    srv.rpc("conta_traspaso_lista", { p_company: t.company_id, p_mes: t.mes }),
    srv.from("conta_diez_traspaso").select("detalle").eq("id", t.id).single(),
  ]);
  if (e1 || e2) return json({ error: `no se ha podido leer lo que va: ${(e1 ?? e2)!.message}` }, 500);
  const todos = (lista ?? []) as { entry_id: string; orden: number; tipo: string }[];
  const fallos = (Array.isArray(fila?.detalle) ? fila.detalle : []) as Fallo[];
  const fallados = new Set(fallos.map((f) => f.entry_id));
  // La autorización del traspaso: lo que está en la lista del mes confirmado.
  const autorizados = new Set(todos.map((x) => x.entry_id));
  const { tanda: estos } = siguientes(todos, fallados, POR_TANDA);

  let llegan = 0;
  for (const x of estos) {
    if (fallados.has(x.entry_id)) continue;
    if (Date.now() - t0 > TOPE_MS) break;
    const r = await despacharADiez({ lector: srv, srv, entryId: x.entry_id, traspaso: autorizados });
    if (r.estado === "en_diez") llegan++;
    else {
      fallos.push({ entry_id: x.entry_id, numero: r.cabecera?.number ?? null, motivo: r.motivo ?? "no ha llegado" });
      fallados.add(x.entry_id);
      console.error(`conta-diez-traspaso · ${x.entry_id} · no ha llegado (apuntado en el traspaso)`);
    }
  }
  const { error: e3 } = await srv.rpc("conta_traspaso_apuntar", { p_traspaso: t.id, p_llegaron: llegan, p_no_llegaron: fallos.length, p_detalle: fallos });
  if (e3) return json({ error: `han llegado ${llegan}, pero no se ha podido apuntar en el traspaso: ${e3.message}` }, 500);
  // Lo que queda: lo de la lista que ni ha llegado ni ha fallado (la lista se vuelve a leer: lo que llegó ya no sale).
  const { data: despues } = await srv.rpc("conta_traspaso_lista", { p_company: t.company_id, p_mes: t.mes });
  const quedan = ((despues ?? []) as { entry_id: string }[]).filter((x) => !fallados.has(x.entry_id)).length;
  console.log(`conta-diez-traspaso · ${t.id} · en Diez ${llegan} · sin llegar ${fallos.length} · quedan ${quedan}`);
  return json({ llegaron: llegan, llegaron_total: t.llegaron + llegan, van: t.van, no_llegaron: fallos.length, fallaron: fallos, quedan });
}

async function comprobar(srv: ReturnType<typeof createClient>, t: Traspaso): Promise<Response> {
  if (t.estado === "confirmado") return json({ error: "Aún no se ha traspasado nada de ese mes." }, 409);
  const { data: saldos, error: e1 } = await srv.rpc("conta_traspaso_saldos", { p_company: t.company_id, p_mes: t.mes });
  if (e1) return json({ error: `no se han podido leer los saldos de Sumied: ${e1.message}` }, 500);
  const sumied = ((saldos ?? []) as { cuenta: string; nombre: string | null; debe: number | string; haber: number | string }[])
    .map((s): Saldo => ({ cuenta: s.cuenta, nombre: s.nombre, debe: Number(s.debe), haber: Number(s.haber) }));

  let cuadre: Record<string, unknown>; let cuadra: boolean | null;
  try {
    const c = await clienteDiezParaLeer(srv, t.account_id, t.company_id);
    if (!c) throw new Error("la empresa no tiene la conexión con Diez");
    const apuntes = await c.cliente.apuntesDelMes(aaaammDelMes(t.mes));
    const r = cuadrar(sumied, lineasDeApuntes(apuntes));
    cuadre = { ...r, base: c.nombreBd, comprobado_en: new Date().toISOString() };
    cuadra = r.cuadra;
  } catch (x) {
    cuadre = { error: x instanceof Error ? x.message : String(x), comprobado_en: new Date().toISOString() };
    cuadra = null;
    console.error(`conta-diez-traspaso · ${t.id} · no se ha podido comprobar con Diez`);
  }
  const { data: fin, error: e2 } = await srv.rpc("conta_traspaso_terminar", { p_traspaso: t.id, p_cuadre: cuadre, p_cuadra: cuadra });
  if (e2) return json({ error: `comprobado, pero no se ha podido apuntar: ${e2.message}` }, 500);
  const f = fin as { mes_cerrado: boolean; motivo: string | null };
  console.log(`conta-diez-traspaso · ${t.id} · cuadra ${cuadra} · mes cerrado ${f.mes_cerrado}`);
  return json({ cuadra, cuadre, mes_cerrado: f.mes_cerrado, motivo: f.motivo });
}
