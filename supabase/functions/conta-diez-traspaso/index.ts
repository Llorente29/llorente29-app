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
import { clienteDiezDelTraspaso, clienteDiezParaLeer, despacharADiez, EN_LA_DEMO_DIEZ } from "../_shared/diezDespacho.ts";
import { aaaammDelMes, cuadrarAgrupado, ES_EL_QUINIENTOS, ES_SUBCUENTA_QUE_FALTA, lineasDeApuntes, siguientes, type Saldo } from "../_shared/diezTraspaso.ts";
import { claveDelCuadre } from "../_shared/diezExcel.ts";
import { nombreParaDiez } from "../_shared/diezSubcuentas.ts";
import { alEscribir } from "../_shared/diezEnviar.ts";
import { esLaMisma, facturasDelTraspaso, filasDeLosExcel, porExcel, porQueNoCasa, sinEnlaceEnDiez, type FacturaDelTraspaso } from "../_shared/diezTraspasoExcel.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICIO = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
/** Por tanda: Diez tarda unos segundos por asiento. B01r26 (14/11): 8, no 12 (el ensayo de la C0009 dio 504). */
const POR_TANDA = 8;
/** Si se acerca el tope de la función, lo que quede va en la tanda siguiente. B01r26 (14/11): 45 s, lejos del 504. */
const TOPE_MS = 45_000;
/** B01r26 (14/11): lo que va por Excel, por traspaso, 10 minutos (antes se recalculaba en cada tanda, unas 260 consultas). */
/** B01r26 (14/11): el cerrojo de la tanda, en segundos (la tanda para a los 45 s; un 504 corta a los 150 s). */
const CERROJO_S = 90;
const EN_MARCHA_OTRA = "Ya hay una tanda de este traspaso en marcha (otra pestaña u otro clic): espera a que acabe.";
const EXCEL_DEL_TRASPASO = new Map<string, { en: number; ids: Set<string> }>();
async function idsPorExcel(srv: ReturnType<typeof createClient>, t: Traspaso): Promise<Set<string>> {
  const c = EXCEL_DEL_TRASPASO.get(t.id);
  if (c && Date.now() - c.en < 600_000) return c.ids;
  const ids = new Set(porExcel(await facturasDelTraspaso(srv, t, () => "https://excel.invalid/pdf")).map((x) => x.entry_id));
  EXCEL_DEL_TRASPASO.set(t.id, { en: Date.now(), ids });
  return ids;
}

type Fallo = { entry_id: string; numero: number | null; motivo: string };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "usa POST" }, 405);

  const sb = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } }, auth: { persistSession: false } });
  const { data: u } = await sb.auth.getUser();
  if (!u?.user) return json({ error: "no autenticado" }, 401);

  let b: { company_id?: unknown; mes?: unknown; accion?: unknown; entry_ids?: unknown } = {};
  try { b = await req.json(); } catch { /* vacío */ }
  const companyId = typeof b.company_id === "string" && /^[0-9a-f-]{36}$/i.test(b.company_id) ? b.company_id : "";
  const mes = typeof b.mes === "string" && /^\d{4}-\d{2}-01$/.test(b.mes) ? b.mes : "";
  const ACCIONES = ["tanda", "comprobar", "excel", "crear_subcuentas", "importado", "por_la_api"] as const;
  const accion = (ACCIONES as readonly unknown[]).includes(b.accion) ? b.accion as (typeof ACCIONES)[number] : "";
  if (!companyId || !mes || !accion) return json({ error: "faltan company_id, mes (AAAA-MM-01) o accion (tanda, excel, crear_subcuentas, importado o comprobar)" }, 400);

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
  if (accion === "tanda") return tanda(srv, t);
  if (accion === "comprobar") return comprobar(srv, t);
  if (t.estado === "confirmado" && accion !== "excel") return json({ error: "Primero se traspasa lo que va por la API." }, 409);
  const quien = { id: u.user.id, nombre: String(u.user.user_metadata?.full_name ?? u.user.email ?? "administrador") };
  if (accion === "excel") return excel(srv, t);
  if (accion === "crear_subcuentas") return crearSubcuentas(srv, t, quien);
  if (accion === "por_la_api") {
    const ids = Array.isArray(b.entry_ids) ? b.entry_ids.filter((x): x is string => typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x)).slice(0, 500) : [];
    if (!ids.length) return json({ error: "faltan entry_ids: las facturas que se mandan por la API" }, 400);
    return porLaApi(srv, t, ids);
  }
  return importado(srv, t);
});

type Traspaso = { id: string; account_id: string; company_id: string; mes: string; estado: string; llegaron: number; no_llegaron: number; van: number };

async function tanda(srv: ReturnType<typeof createClient>, t: Traspaso): Promise<Response> {
  if (t.estado !== "confirmado" && t.estado !== "traspasando") {
    return json({ error: t.estado === "terminado" ? "Ese mes ya está traspasado." : "Ese traspaso terminó con fallos: vuelve a revisarlo y confirmarlo." }, 409);
  }
  // B01r26 (14/11): una tanda a la vez. En el ensayo de la C0009 corrieron dos juntas (dos clics,
  // o una después de un 504) y mandaban lo mismo dos veces. El cerrojo caduca solo (CERROJO_S).
  const { data: tomado, error: eC } = await srv.rpc("conta_traspaso_tomar_tanda", { p_traspaso: t.id, p_segundos: CERROJO_S });
  if (eC) return json({ error: `no se ha podido tomar el traspaso para la tanda: ${eC.message}` }, 500);
  if (tomado !== true) return json({ error: EN_MARCHA_OTRA, en_marcha: true }, 409);
  try {
    return await tandaConCerrojo(srv, t);
  } finally {
    await srv.rpc("conta_traspaso_soltar_tanda", { p_traspaso: t.id });
  }
}

async function tandaConCerrojo(srv: ReturnType<typeof createClient>, t: Traspaso): Promise<Response> {
  const t0 = Date.now();
  const [{ data: lista, error: e1 }, { data: fila, error: e2 }] = await Promise.all([
    srv.rpc("conta_traspaso_lista", { p_company: t.company_id, p_mes: t.mes }),
    srv.from("conta_diez_traspaso").select("detalle").eq("id", t.id).single(),
  ]);
  if (e1 || e2) return json({ error: `no se ha podido leer lo que va: ${(e1 ?? e2)!.message}` }, 500);
  // B01r26: las facturas que van por Excel con su PDF no se mandan aquí (las enlaza «Ya lo he importado»).
  const excelSet = await idsPorExcel(srv, t);
  const todos = ((lista ?? []) as { entry_id: string; orden: number; tipo: string }[]).filter((x) => !excelSet.has(x.entry_id));
  // B01r26 (14/11): lo que se cortó por el 500 de Diez a una subcuenta que no existe se vuelve a
  // intentar: ahora eso es «no está en Diez», con su «Crearlas en Diez» (sinLosDelQuinientos).
  const fallos = sinLosDelQuinientos((Array.isArray(fila?.detalle) ? fila.detalle : []) as Fallo[]);
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
  const quedan = ((despues ?? []) as { entry_id: string }[]).filter((x) => !fallados.has(x.entry_id) && !excelSet.has(x.entry_id)).length;
  console.log(`conta-diez-traspaso · ${t.id} · en Diez ${llegan} · sin llegar ${fallos.length} · quedan ${quedan}`);
  return json({ llegaron: llegan, llegaron_total: t.llegaron + llegan, van: t.van, no_llegaron: fallos.length, fallaron: fallos, quedan, por_excel: excelSet.size });
}

const sinLosDelQuinientos = (xs: Fallo[]) => xs.filter((f) => !ES_EL_QUINIENTOS.test(f.motivo));

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
    // B01r26 (Julio, 13/11): las ventas sumadas (grupo 700) y el resto, cuenta a cuenta.
    const r = cuadrarAgrupado(sumied, lineasDeApuntes(apuntes), claveDelCuadre);
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

// ── B01r26 · Las facturas por Excel, con su PDF ──────────────────────────────

const URL_PDF = (llave: string) => `${SUPABASE_URL}/functions/v1/conta-pdf/${llave}`;

/** Los enlaces de los PDF del traspaso (conta-pdf), por asiento. */
async function enlaces(srv: ReturnType<typeof createClient>, t: Traspaso): Promise<Map<string, string>> {
  const { data, error } = await srv.rpc("conta_pdf_llaves_del_traspaso", { p_traspaso: t.id });
  if (error) throw new Error(`no se han podido preparar los enlaces de los PDF: ${error.message}`);
  return new Map(((data ?? []) as { entry_id: string; llave: string }[]).map((x) => [x.entry_id, URL_PDF(x.llave)]));
}

/** Las subcuentas que usan los Excel y no están en Diez, con el nombre que tienen en Sumied. */
async function subcuentasQueFaltan(srv: ReturnType<typeof createClient>, t: Traspaso, xs: FacturaDelTraspaso[], diez: { subcuenta(c: string): Promise<Record<string, unknown> | null> }) {
  // Las de los Excel y, B01r26 (14/11), también las de lo que va por la API (banco, a mano,
  // liquidaciones): sin ellas en Diez, esos asientos no llegan («no está en Diez»).
  const codigos = [...new Set([...porExcel(xs).flatMap((x) => x.subcuentas), ...(await cuentasDeLaApi(srv, t, xs))])].sort();
  const nombres = new Map<string, string>();
  const faltan: { codigo: string; nombre: string }[] = [];
  const { data: ca } = await srv.from("company_account").select("code, name").eq("company_id", t.company_id).eq("account_id", t.account_id).in("code", codigos);
  const enSumied = new Map(((ca ?? []) as { code: string; name: string }[]).map((x) => [x.code, x.name]));
  for (const c of codigos) {
    const sc = await diez.subcuenta(c);
    if (sc && String(sc.Codigo ?? "").trim() === c) nombres.set(c, String(sc.Descripcion ?? "").trim());
    else faltan.push({ codigo: c, nombre: enSumied.get(c) ?? (c === "70000000" ? "Ventas de mercaderías" : "") });
  }
  return { codigos, faltan, nombres };
}

/** Las subcuentas de los asientos del traspaso que van por la API (todo lo de la lista que no va por Excel). */
async function cuentasDeLaApi(srv: ReturnType<typeof createClient>, t: Traspaso, xs: FacturaDelTraspaso[]): Promise<string[]> {
  const { data: lista, error } = await srv.rpc("conta_traspaso_lista", { p_company: t.company_id, p_mes: t.mes });
  if (error) throw new Error(`no se ha podido leer lo que va: ${error.message}`);
  const excel = new Set(porExcel(xs).map((x) => x.entry_id));
  const ids = ((lista ?? []) as { entry_id: string }[]).map((x) => x.entry_id).filter((id) => !excel.has(id));
  const codigos = new Set<string>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error: e2 } = await srv.from("journal_line").select("company_account(code)").eq("account_id", t.account_id).in("entry_id", ids.slice(i, i + 200));
    if (e2) throw new Error(`no se han podido leer las cuentas de lo que va por la API: ${e2.message}`);
    for (const l of (data ?? []) as { company_account: { code: string } | null }[]) if (l.company_account?.code) codigos.add(l.company_account.code);
  }
  return [...codigos];
}

async function excel(srv: ReturnType<typeof createClient>, t: Traspaso): Promise<Response> {
  try {
    const urls = await enlaces(srv, t);
    const xs = await facturasDelTraspaso(srv, t, (id) => urls.get(id) ?? null);
    const c = await clienteDiezParaLeer(srv, t.account_id, t.company_id);
    if (!c) return json({ error: "la empresa no tiene la conexión con Diez" }, 409);
    // Antes de nada, las subcuentas: si falta alguna, no se genera ningún Excel (Julio, 24/10).
    // B01r26 (14/11): con la lista de Diez leída ahora, no la de hace un rato.
    c.cliente.olvidarSubcuentas();
    const s = await subcuentasQueFaltan(srv, t, xs, c.cliente);
    const porLaApi = xs.filter((x) => x.porLaApi).map((x) => ({ entry_id: x.entry_id, numero: x.numero, motivo: x.porLaApi }));
    if (s.faltan.length) return json({ base: c.nombreBd, faltan: s.faltan, comprobadas: s.codigos.length, por_la_api: porLaApi });
    const { emitidas, recibidas } = filasDeLosExcel(xs, (sc) => s.nombres.get(sc) ?? "");
    console.log(`conta-diez-traspaso · ${t.id} · excel · emitidas ${emitidas.length} · recibidas ${recibidas.length} · por la API ${porLaApi.length}`);
    return json({ base: c.nombreBd, faltan: [], comprobadas: s.codigos.length, emitidas, recibidas, por_la_api: porLaApi });
  } catch (x) {
    console.error(`conta-diez-traspaso · ${t.id} · excel · no se ha podido preparar`);
    return json({ error: x instanceof Error ? x.message : String(x) }, 500);
  }
}

async function crearSubcuentas(srv: ReturnType<typeof createClient>, t: Traspaso, quien: { id: string; nombre: string }): Promise<Response> {
  try {
    const xs = await facturasDelTraspaso(srv, t, () => "https://excel.invalid/pdf");
    const c = await clienteDiezDelTraspaso(srv, t.account_id, t.company_id);
    if (!c) return json({ error: "la empresa no tiene la conexión con Diez" }, 409);
    // B01r26 (14/11): solo las que faltan DE VERDAD, con la lista de Diez leída ahora (en el ensayo,
    // la segunda vez se intentó otra vez una ya creada, Diez dio 400 y paró todo).
    c.cliente.olvidarSubcuentas();
    const s = await subcuentasQueFaltan(srv, t, xs, c.cliente);
    const creadas: { codigo: string; nombre: string; recortado?: boolean }[] = [];
    const noCreadas: { codigo: string; nombre: string; porque: string }[] = [];
    // Una a una: la que falla no para a las demás, y se dice por qué.
    for (const f of s.faltan) {
      if (!f.nombre.trim()) { noCreadas.push({ codigo: f.codigo, nombre: "", porque: "no tiene nombre en Sumied" }); continue; }
      const { nombre, recortado } = nombreParaDiez(f.nombre);
      try {
        await c.cliente.crearSubcuenta({ Codigo: f.codigo, Descripcion: nombre });
      } catch (x) {
        noCreadas.push({ codigo: f.codigo, nombre, porque: alEscribir("la subcuenta", x) });
        continue;
      }
      const { error } = await srv.from("conta_diez_subcuenta_creada").insert({ account_id: t.account_id, company_id: t.company_id, traspaso_id: t.id, base: c.nombreBd, codigo: f.codigo, nombre, creada_por: quien.id, creada_por_nombre: quien.nombre });
      if (error) noCreadas.push({ codigo: f.codigo, nombre, porque: `creada en Diez, pero no se ha podido apuntar en Sumied: ${error.message}` });
      creadas.push({ codigo: f.codigo, nombre, ...(recortado ? { recortado } : {}) });
    }
    // Y se vuelve a comprobar, con la lista de Diez otra vez leída.
    c.cliente.olvidarSubcuentas();
    const despues = await subcuentasQueFaltan(srv, t, xs, c.cliente);
    // B01r26 (14/11): lo que no llegó porque le faltaba una subcuenta (o se cortó por el 500 de Diez)
    // vuelve a la cola del traspaso: «Seguir traspasando» lo manda.
    const { data: fila } = await srv.from("conta_diez_traspaso").select("detalle").eq("id", t.id).single();
    const antes = (Array.isArray(fila?.detalle) ? fila.detalle : []) as Fallo[];
    const quedan = antes.filter((f) => !ES_EL_QUINIENTOS.test(f.motivo) && !ES_SUBCUENTA_QUE_FALTA.test(f.motivo));
    if (quedan.length !== antes.length) {
      const { error: e4 } = await srv.rpc("conta_traspaso_apuntar", { p_traspaso: t.id, p_llegaron: 0, p_no_llegaron: quedan.length, p_detalle: quedan });
      if (e4) return json({ error: `creadas, pero no se han podido volver a poner en el traspaso los que esperaban: ${e4.message}`, creadas, no_creadas: noCreadas }, 500);
    }
    console.log(`conta-diez-traspaso · ${t.id} · subcuentas: faltaban ${s.faltan.length} · creadas ${creadas.length} · no ${noCreadas.length} · faltan ${despues.faltan.length}`);
    return json({ base: c.nombreBd, intentadas: s.faltan.length, creadas, no_creadas: noCreadas, faltan: despues.faltan, otra_vez: antes.length - quedan.length });
  } catch (x) {
    return json({ error: x instanceof Error ? x.message : String(x) }, 500);
  }
}

/**
 * B01r26 (14/11) · Plan B: mandar por la API las facturas que fueron en el Excel y Diez no
 * tiene (las que «Ya lo he importado» lista). Solo las de la lista del traspaso que van
 * por Excel y no están enlazadas; con el cerrojo de la tanda y como mucho POR_TANDA por
 * llamada (la pantalla repite hasta que no quedan). El envío busca antes en Diez por
 * número y NIF: si ya está, la enlaza y no escribe otra.
 */
async function porLaApi(srv: ReturnType<typeof createClient>, t: Traspaso, ids: string[]): Promise<Response> {
  const { data: tomado, error: eC } = await srv.rpc("conta_traspaso_tomar_tanda", { p_traspaso: t.id, p_segundos: CERROJO_S });
  if (eC) return json({ error: `no se ha podido tomar el traspaso: ${eC.message}` }, 500);
  if (tomado !== true) return json({ error: EN_MARCHA_OTRA, en_marcha: true }, 409);
  try {
    const t0 = Date.now();
    const { data: lista, error: e1 } = await srv.rpc("conta_traspaso_lista", { p_company: t.company_id, p_mes: t.mes });
    if (e1) return json({ error: `no se ha podido leer lo que va: ${e1.message}` }, 500);
    const enLista = new Set(((lista ?? []) as { entry_id: string }[]).map((x) => x.entry_id));
    const excel = await idsPorExcel(srv, t);
    // Solo lo que sigue en la lista (lo enviado o enlazado ya no sale) y fue en el Excel.
    const validos = ids.filter((id) => enLista.has(id) && excel.has(id));
    const fuera = ids.length - validos.length;
    let llegan = 0; const fallos: Fallo[] = []; let hechos = 0;
    for (const id of validos) {
      if (hechos >= POR_TANDA || Date.now() - t0 > TOPE_MS) break;
      hechos++;
      const r = await despacharADiez({ lector: srv, srv, entryId: id, traspaso: enLista });
      if (r.estado === "en_diez") llegan++;
      else fallos.push({ entry_id: id, numero: r.cabecera?.number ?? null, motivo: r.motivo ?? "no ha llegado" });
    }
    const quedan = validos.length - hechos;
    console.log(`conta-diez-traspaso · ${t.id} · por la API · en Diez ${llegan} · no ${fallos.length} · quedan ${quedan} · fuera de la lista ${fuera}`);
    return json({ llegaron: llegan, fallaron: fallos, quedan, fuera_de_la_lista: fuera });
  } finally {
    await srv.rpc("conta_traspaso_soltar_tanda", { p_traspaso: t.id });
  }
}

async function importado(srv: ReturnType<typeof createClient>, t: Traspaso): Promise<Response> {
  try {
    const xs = porExcel(await facturasDelTraspaso(srv, t, () => "https://excel.invalid/pdf"));
    const c = await clienteDiezParaLeer(srv, t.account_id, t.company_id);
    if (!c) return json({ error: "la empresa no tiene la conexión con Diez" }, 409);
    // Diez lista por la fecha del asiento: el mes del traspaso y el siguiente (por si alguna entra con otra fecha).
    const m = aaaammDelMes(t.mes);
    const sig = m.slice(4) === "12" ? `${Number(m.slice(0, 4)) + 1}01` : `${m.slice(0, 4)}${String(Number(m.slice(4)) + 1).padStart(2, "0")}`;
    // B01r26 (ensayo del 14/11): «GET /api/facturas» del mes dio 500 en la C0009 después de importar con PDF.
    // Como se pueda: el mes, en páginas más cortas o día a día; los días que Diez no deja leer se dicen.
    const leidos = [await c.cliente.facturasDelMesComoSePueda(m), await c.cliente.facturasDelMesComoSePueda(sig)];
    const enDiez = leidos.flatMap((l) => l.facturas);
    const diasSinLeer = leidos.flatMap((l) => l.diasSinLeer);
    let enlazadas = 0; const faltan: { entry_id: string; numero: string; porque?: string; en_diez?: string | null }[] = []; const dobles: string[] = [];
    const faltanX: FacturaDelTraspaso[] = [];
    for (const x of xs) {
      const iguales = [...new Map(enDiez.filter((f) => esLaMisma(x, f)).map((f) => [`${f.Ejercicio}/${f.Serie}/${f.Documento}`, f])).values()];
      if (iguales.length === 0) { faltanX.push(x); continue; }
      if (iguales.length > 1) { dobles.push(x.numero); continue; }
      const f = iguales[0];
      const fila = { account_id: t.account_id, company_id: t.company_id, entry_id: x.entry_id, kind: "factura", ext_year: String(f.Ejercicio), ext_series: String(f.Serie), ext_number: Number(f.Documento),
        ext_invoice_number: String(f.NumeroFactura), payload_hash: "excel-b01r26", status: "enlazado", attempts: 0, sent_at: new Date().toISOString(), last_error: null,
        document_status: "adjunto", document_attached_via: "diez", document_attached_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      const { data: previo } = await srv.from("external_send").select("id, status").eq("entry_id", x.entry_id).eq("account_id", t.account_id).neq("status", "rechazado").maybeSingle();
      const p = previo as { id: string; status: string } | null;
      if (p && (p.status === "enviado" || p.status === "enlazado")) continue;
      const { error } = p ? await srv.from("external_send").update(fila).eq("id", p.id) : await srv.from("external_send").insert(fila);
      if (error) return json({ error: `no se ha podido enlazar ${x.numero}: ${error.message}`, enlazadas }, 500);
      enlazadas++;
    }
    // B01r26 (14/11) · Plan B: las que no casan, con su porqué, y lo que Diez tiene sin enlace (de las series 1 y 2).
    const { data: ya, error: eYa } = await srv.from("external_send").select("ext_series, ext_number").eq("company_id", t.company_id).eq("account_id", t.account_id)
      .in("status", ["enviado", "enlazado"]).in("ext_series", ["1", "2"]).not("ext_number", "is", null);
    if (eYa) return json({ error: `no se han podido leer los enlaces de Sumied: ${eYa.message}`, enlazadas }, 500);
    const enlazados = new Set(((ya ?? []) as { ext_series: string; ext_number: number }[]).map((x) => `${x.ext_series}/${x.ext_number}`));
    const sinEnlace = sinEnlaceEnDiez(enDiez, enlazados);
    for (const x of faltanX) faltan.push({ entry_id: x.entry_id, numero: x.numero, ...porQueNoCasa(x, enDiez, sinEnlace.map((f) => enDiez.find((d) => `${d.Serie}/${d.Documento}` === `${f.serie}/${f.documento}`)!)) });
    console.log(`conta-diez-traspaso · ${t.id} · importado · sin enlace en Diez ${sinEnlace.length}`);
    console.log(`conta-diez-traspaso · ${t.id} · importado · leído ${leidos.map((l) => l.como).join("+")} · enlazadas ${enlazadas} · faltan ${faltan.length} · dobles ${dobles.length} · días sin leer ${diasSinLeer.length}`);
    return json({ van_por_excel: xs.length, enlazadas, faltan, dobles, dias_sin_leer: diasSinLeer, sin_enlace_en_diez: sinEnlace });
  } catch (x) {
    return json({ error: x instanceof Error ? x.message : String(x) }, 500);
  }
}
