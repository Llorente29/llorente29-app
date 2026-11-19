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

  let b: { company_id?: unknown; accion?: unknown; desde?: unknown; hasta?: unknown } = {};
  try { b = await req.json(); } catch { /* vacío */ }
  const companyId = typeof b.company_id === "string" && /^[0-9a-f-]{36}$/i.test(b.company_id) ? b.company_id : "";
  const accion = b.accion === "probar" || b.accion === "saldos" ? b.accion : "";
  if (!companyId || !accion) return json({ error: "faltan company_id o accion (probar o saldos)" }, 400);

  // La sociedad, con los permisos de quien llama: si no es de su cuenta, no está.
  const { data: co, error: e0 } = await sb.from("company").select("id, account_id").eq("id", companyId).maybeSingle();
  if (e0) return json({ error: `no se ha podido leer la sociedad: ${e0.message}` }, 500);
  if (!co) return json({ error: "Esa sociedad no es de tu cuenta." }, 403);
  if (accion === "probar") {
    const { data: admin } = await sb.rpc("current_user_is_admin_of", { p_account_id: co.account_id });
    if (admin !== true) return json({ error: "Solo un administrador de la cuenta prueba la conexión con ERP10." }, 403);
  }
  const srv = createClient(SUPABASE_URL, SERVICIO, { auth: { persistSession: false } });
  if (!(await cuentaPuedeSalir(srv, co.account_id))) return json({ error: EN_LA_DEMO, demo: true }, 409);

  try {
    const c = await clienteErp10(srv, co.account_id, companyId);
    if (!c) return json({ error: "Esta sociedad no está conectada con ERP10: pon su código de empresa en Integraciones › ERP10 (despacho)." }, 404);
    if (accion === "probar") return json(await probar(srv, c.cliente, co.account_id, companyId));
    const desde = dia(b.desde), hasta = dia(b.hasta);
    if (!desde || !hasta || desde > hasta) return json({ error: "faltan desde y hasta (AAAA-MM-DD)" }, 400);
    const apuntes = await c.cliente.apuntesEntre(desde, hasta);
    return json({ filas: sumarPorCuenta(apuntes), lineas: lineas(apuntes), asientos: apuntes.length, desde, hasta, leidoEn: new Date().toISOString() });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(JSON.stringify({ accion, fallo: e instanceof FrenoErp10 ? "freno" : "erp10" }));
    return json({ error: msg }, e instanceof FrenoErp10 ? 409 : 502);
  }
});

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
