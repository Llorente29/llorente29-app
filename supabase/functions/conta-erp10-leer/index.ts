// supabase/functions/conta-erp10-leer/index.ts
//
// X10 (19/11) · ERP10 POR LA API, FASE 1: LEER Y COMPARAR. No escribe nada en
// ERP10 (el cliente para cualquier cosa que no sea GET o POST /token).
//
//   · { company_id, accion: 'probar' }: entra en la empresa de la sociedad (lista
//     cerrada + NIF, _shared/erp10Cliente.ts) y cuenta sus líneas desde el
//     01/10/2026. Además, lo que hay en ERP10 por mes (asientos y líneas por tipo,
//     y el resumen de ERP10 sin importes ni nombres), cuántas facturas, si sus PDF
//     se bajan (getfile, solo mirando) y lo que salió de Sumied esos meses, para
//     ver si hay cosas metidas a mano en ERP10. Solo un administrador.
//   · { company_id, accion: 'medir', ejercicio? }: X11 (20/11) · lo que da la API de
//     cada cosa que trae «Traer de ERP10» por fichero (_shared/erp10Medir.ts): rutas,
//     totales, páginas, campos y tiempos. Solo recuentos, sin nombres, NIF ni
//     importes; solo GET. El ejercicio, por defecto el anterior. Solo un administrador.
//   · { company_id, accion: 'traer', que, ejercicio, mes?, pagina? }: X12 (20/11) · UNA página de
//     lo que trae «Traer de ERP10» (_shared/erp10Traer.ts): las subcuentas (y los terceros), los
//     asientos o las facturas de un mes, o el resumen del ejercicio. La pantalla las pide una a una:
//     ninguna llamada pasa de un minuto (si ERP10 tarda más de 55 s, 504 y se vuelve a pedir esa).
//     Solo GET. Solo un administrador.
//   · { company_id, accion: 'intercalados', mes }: X31 · 2 (24/11) · antes de enviar, los asientos del mes en ERP10 que no
//     ha escrito ni enlazado Sumied, por serie (_shared/erp10Intercalados.ts): solo sus números, sin importes ni nombres.
//     Solo GET. Cualquiera que vea la sociedad.
//   · { company_id, accion: 'saldos', desde, hasta }: las líneas de los apuntes
//     entre los dos días, sumadas por cuenta (el sumas y saldos del paso 3, sin
//     Excel). Cualquiera que vea la sociedad.
//
// Contesta 200 con el resultado o { error } en palabras (regla 8): 401 sin
// sesión, 403 sin permiso, 404 sin conexión, 409 si un freno para (la lista, el
// NIF, las claves), 502 si ERP10 falla. En el registro, nada de lo leído.
//
// verify_jwt = true (config.toml).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { cuentaPuedeSalir } from "../_shared/puerta.ts";
import { clienteErp10 } from "../_shared/erp10Despacho.ts";
import { medidaEnTexto, medirParaTraer } from "../_shared/erp10Medir.ts";
import { FalloAlTraer, pedidaDelCuerpo, traerUnaPagina } from "../_shared/erp10Traer.ts";
import { avisoIntercalados, deFuera, type Conocido } from "../_shared/erp10Intercalados.ts";
import { finalDelNif, FrenoErp10, lineas, porTipo, resumenSinDatos, sumarPorCuenta, type ClienteErp10 } from "../_shared/erp10Cliente.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICIO = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
/** Desde cuándo se mira lo que hay en ERP10 (el encargo X10). */
const DESDE_PROBAR = "2026-10-01";
const EN_LA_DEMO = "En la demo no se entra en ERP10.";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const dia = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
const hoyMadrid = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date());
const miles = (n: number) => new Intl.NumberFormat("es-ES").format(n);
const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** Los meses (AAAA-MM) de un día a otro. */
function meses(desde: string, hasta: string): string[] {
  const r: string[] = [];
  let [a, m] = desde.slice(0, 7).split("-").map(Number);
  const [ah, mh] = hasta.slice(0, 7).split("-").map(Number);
  while (a < ah || (a === ah && m <= mh)) { r.push(`${a}-${String(m).padStart(2, "0")}`); m++; if (m > 12) { m = 1; a++; } }
  return r;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "usa POST" }, 405);

  const sb = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } }, auth: { persistSession: false } });
  const { data: u } = await sb.auth.getUser();
  if (!u?.user) return json({ error: "no autenticado" }, 401);

  let b: { company_id?: unknown; accion?: unknown; desde?: unknown; hasta?: unknown; documentos?: unknown; ejercicio?: unknown; que?: unknown; mes?: unknown; pagina?: unknown } = {};
  try { b = await req.json(); } catch { /* vacío */ }
  const companyId = typeof b.company_id === "string" && /^[0-9a-f-]{36}$/i.test(b.company_id) ? b.company_id : "";
  const accion = b.accion === "probar" || b.accion === "saldos" || b.accion === "medir" || b.accion === "traer" || b.accion === "intercalados" ? b.accion : "";
  if (!companyId || !accion) return json({ error: "faltan company_id o accion (probar, medir, traer, intercalados o saldos)" }, 400);
  const pedida = accion === "traer" ? pedidaDelCuerpo(b as Record<string, unknown>) : null;
  if (typeof pedida === "string") return json({ error: pedida }, 400);

  // La sociedad, con los permisos de quien llama: si no es de su cuenta, no está.
  const { data: co, error: e0 } = await sb.from("company").select("id, account_id").eq("id", companyId).maybeSingle();
  if (e0) return json({ error: `no se ha podido leer la sociedad: ${e0.message}` }, 500);
  if (!co) return json({ error: "Esa sociedad no es de tu cuenta." }, 403);
  if (accion === "probar" || accion === "medir" || accion === "traer") {
    const { data: admin } = await sb.rpc("current_user_is_admin_of", { p_account_id: co.account_id });
    if (admin !== true) {
      return json({ error: accion === "probar" ? "Solo un administrador de la cuenta prueba la conexión con ERP10."
        : accion === "medir" ? "Solo un administrador de la cuenta mide lo que se puede traer de ERP10."
        : "Solo un administrador de la cuenta trae de ERP10." }, 403);
    }
  }
  const srv = createClient(SUPABASE_URL, SERVICIO, { auth: { persistSession: false } });
  if (!(await cuentaPuedeSalir(srv, co.account_id))) return json({ error: EN_LA_DEMO, demo: true }, 409);

  try {
    const c = await clienteErp10(srv, co.account_id, companyId);
    if (!c) return json({ error: "Esta sociedad no está conectada con ERP10: pon su código de empresa en Integraciones › ERP10 (despacho)." }, 404);
    if (accion === "probar") return json(await probar(srv, c.cliente, co.account_id, companyId));
    if (accion === "traer" && pedida) {
      // Ninguna llamada pasa de un minuto: si ERP10 no ha contestado en 55 s, se dice y la pantalla vuelve a pedir esa misma página.
      let reloj: ReturnType<typeof setTimeout> | undefined;
      const tope = new Promise<"tarde">((r) => { reloj = setTimeout(() => r("tarde"), 55_000); });
      const pag = await Promise.race([traerUnaPagina((r) => c.cliente.get(r), pedida), tope]).finally(() => clearTimeout(reloj));
      if (pag === "tarde") return json({ error: "ERP10 tarda más de un minuto en contestar: se vuelve a pedir lo mismo.", tarde: true }, 504);
      return json({ ok: true, pagina: pag });
    }
    if (accion === "medir") {
      const ej = typeof b.ejercicio === "string" && /^\d{4}$/.test(b.ejercicio) ? b.ejercicio : String(Number(hoyMadrid().slice(0, 4)) - 1);
      await c.cliente.probar();
      const m = await medirParaTraer({ get: (r) => c.cliente.get(r), ahora: () => Date.now() }, { ejercicio: ej, codEmpresa: c.cliente.codEmpresa });
      return json({ ok: true, medida: m, texto: medidaEnTexto(m) });
    }
    if (accion === "intercalados") {
      const mes = typeof b.mes === "string" && /^\d{4}-\d{2}$/.test(b.mes) ? b.mes : "";
      if (!mes) return json({ error: "falta mes (AAAA-MM)" }, 400);
      const apuntes = await c.cliente.apuntesDelMes(mes);
      const conocidos = await conocidosDeSumied(srv, co.account_id, companyId);
      const xs = deFuera(apuntes, conocidos);
      return json({ ok: true, mes, asientos: apuntes.length, deFuera: xs, aviso: avisoIntercalados(xs, mes) });
    }
    const desde = dia(b.desde), hasta = dia(b.hasta);
    if (!desde || !hasta || desde > hasta) return json({ error: "faltan desde y hasta (AAAA-MM-DD)" }, 400);
    const apuntes = await c.cliente.apuntesEntre(desde, hasta);
    // X10c · Los documentos que se piden (los números que dio ERP10 a lo que salió por la conexión), con sus líneas por cuenta:
    // el paso 3 los casa uno a uno. Solo esos: nada más del ERP10 sale de aquí.
    const pedidos = new Set((Array.isArray(b.documentos) ? b.documentos : []).slice(0, 5000)
      .map((d) => `${String((d as { serie?: unknown })?.serie ?? "")}/${Number((d as { documento?: unknown })?.documento)}`));
    const documentos = apuntes.filter((a) => pedidos.has(`${a.Serie ?? ""}/${Number(a.Documento)}`)).map((a) => ({
      serie: String(a.Serie ?? ""), documento: Number(a.Documento),
      lineas: (a.Detalles ?? []).map((l) => ({ cuenta: String(l.Cuenta ?? "").replace(/\D/g, ""), importe: Math.round(Number(l.Debe ?? 0) * 100) - Math.round(Number(l.Haber ?? 0) * 100) })),
    }));
    return json({ filas: sumarPorCuenta(apuntes), lineas: lineas(apuntes), asientos: apuntes.length, desde, hasta, leidoEn: new Date().toISOString(), documentos });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(JSON.stringify({ accion, fallo: e instanceof FrenoErp10 ? "freno" : "erp10" }));
    return json({ error: msg }, e instanceof FrenoErp10 ? 409 : e instanceof FalloAlTraer && e.status === 400 ? 409 : 502);
  }
});

/** X31 · Los números de ERP10 que Sumied conoce de la sociedad: lo que salió por la conexión (con su cobro) y con el Excel. */
// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function conocidosDeSumied(srv: any, accountId: string, companyId: string): Promise<Conocido[]> {
  const r: Conocido[] = [];
  for (let i = 0; ; i += 1000) {
    const { data, error } = await srv.from("conta_erp10_envio").select("erp10_serie, erp10_documento, cobro_serie, cobro_documento")
      .eq("account_id", accountId).eq("company_id", companyId).eq("estado", "en_erp10").order("id").range(i, i + 999);
    if (error) throw new Error(`No se ha podido leer lo que salió de Sumied: ${error.message}`);
    const xs = (data ?? []) as { erp10_serie: string | null; erp10_documento: number | null; cobro_serie: string | null; cobro_documento: number | null }[];
    for (const x of xs) { r.push({ serie: x.erp10_serie, documento: x.erp10_documento }); if (x.cobro_documento != null) r.push({ serie: x.cobro_serie, documento: x.cobro_documento }); }
    if (xs.length < 1000) break;
  }
  for (let i = 0; ; i += 1000) {
    const { data, error } = await srv.from("conta_erp10_salida_partida").select("erp10_serie, erp10_documento")
      .eq("account_id", accountId).eq("company_id", companyId).not("erp10_documento", "is", null).order("id").range(i, i + 999);
    if (error) throw new Error(`No se ha podido leer lo que salió con el Excel: ${error.message}`);
    const xs = (data ?? []) as { erp10_serie: string | null; erp10_documento: number | null }[];
    r.push(...xs.map((x) => ({ serie: x.erp10_serie, documento: x.erp10_documento })));
    if (xs.length < 1000) break;
  }
  return r;
}

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function probar(srv: any, cliente: ClienteErp10, accountId: string, companyId: string) {
  const nif = await cliente.probar();
  const hoy = hoyMadrid();
  const apuntes = await cliente.apuntesEntre(DESDE_PROBAR, hoy);
  const n = lineas(apuntes);
  const frase = `Conectada con ERP10: empresa con NIF terminado en ${finalDelNif(nif)}, ${miles(n)} ${n === 1 ? "línea" : "líneas"} desde el ${dmy(DESDE_PROBAR)}.`;

  // Lo que hay en ERP10, por mes (solo recuentos).
  const porMes = [];
  for (const m of meses(DESDE_PROBAR, hoy)) {
    const delMes = apuntes.filter((a) => String(a.Fecha ?? "").startsWith(m.replace("-", "")));
    const r = await cliente.resumenDelMes(m).catch((e) => ({ status: 0, json: String(e instanceof Error ? e.message : e).slice(0, 120) }));
    const f = await cliente.facturasDelMes(m).catch(() => null);
    porMes.push({
      mes: m, asientos: delMes.length, lineas: lineas(delMes), tipos: porTipo(delMes),
      resumen: r.status === 200 ? resumenSinDatos(r.json) : { status: r.status, motivo: typeof r.json === "string" ? r.json : null },
      facturas: f ? f.length : null,
      _facturas: f,
    });
  }

  // Los PDF: getfile de las primeras facturas, solo para ver si se bajan (estado y tamaño).
  const pdf: { status: number; bytes: number; motivo: string | null }[] = [];
  for (const m of porMes) for (const x of (m._facturas ?? [])) {
    if (pdf.length >= 3) break;
    const ej = String(x.Ejercicio ?? ""), se = String(x.Serie ?? ""), doc = Number(x.Documento);
    if (!ej || !se || !Number.isFinite(doc)) continue;
    pdf.push(await cliente.documento(ej, se, doc).catch((e) => ({ status: 0, bytes: 0, motivo: String(e instanceof Error ? e.message : e).slice(0, 120) })));
  }

  // X10b · El último mes con apuntes en ERP10 y sus líneas: que se vea que la lectura funciona aunque los meses de ahora estén vacíos.
  const ultimo = await cliente.ultimoMesConApuntes(hoy.slice(0, 7)).catch(() => null);

  // Lo que salió de Sumied esos meses, para ver si en ERP10 hay cosas metidas a mano.
  const enErp = new Set(apuntes.map((a) => `${a.Serie ?? ""}/${a.Documento ?? ""}`));
  const { data: ps } = await srv.from("conta_erp10_salida_partida").select("entry_id, clase, estado, erp10_serie, erp10_documento").eq("account_id", accountId).eq("company_id", companyId);
  const partidas = (ps ?? []) as { entry_id: string; clase: string; estado: string; erp10_serie: string | null; erp10_documento: number | null }[];
  const fechas = new Map<string, string>();
  for (let i = 0; i < partidas.length; i += 200) {
    const { data: js } = await srv.from("journal_entry").select("id, entry_date").eq("account_id", accountId).in("id", partidas.slice(i, i + 200).map((p) => p.entry_id));
    for (const j of (js ?? []) as { id: string; entry_date: string }[]) fechas.set(j.id, j.entry_date);
  }
  const deSumied = meses(DESDE_PROBAR, hoy).map((m) => {
    const del = partidas.filter((p) => (fechas.get(p.entry_id) ?? "").startsWith(m));
    const clases: Record<string, number> = {};
    for (const p of del) clases[p.clase] = (clases[p.clase] ?? 0) + 1;
    return { mes: m, partidas: del.length, clases, conDocumentoErp10: del.filter((p) => p.erp10_documento != null).length };
  });
  const conDoc = new Set(partidas.filter((p) => p.erp10_documento != null).map((p) => `${p.erp10_serie ?? ""}/${p.erp10_documento}`));
  const sinSumied = conDoc.size ? [...enErp].filter((k) => !conDoc.has(k)).length : null;

  return {
    ok: true, frase, nifFinal: finalDelNif(nif), lineas: n, desde: DESDE_PROBAR,
    enErp10: porMes.map((m) => ({ mes: m.mes, asientos: m.asientos, lineas: m.lineas, tipos: m.tipos, resumen: m.resumen, facturas: m.facturas })), pdf, deSumied,
    asientosSinSumied: sinSumied, ultimoConApuntes: ultimo,
  };
}
