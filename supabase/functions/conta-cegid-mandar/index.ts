// supabase/functions/conta-cegid-mandar/index.ts
//
// Q10 · respuesta 3 (25/11) · MANDAR A CEGID TODO LO COBRADO, como incidencias del mes (API DiezREC). Cegid solo
// factura lo que manda Sumied. Escribe en Cegid SOLO incidencias (el cliente de _shared/diezRec.ts con
// escribe: 'incidencias'): nunca conceptos ni fichas.
//   · { company_id, accion: 'releer', codigos }: vuelve a leer la ficha de esos clientes de Cegid (hasta 40), guarda
//     sus conceptos fijos (conta_cegid_cliente) y dice cuáles aún los tienen. No escribe en Cegid.
//   · { company_id, accion: 'mandar', mes, cliente, cobros }: manda los cobros de UN cliente de Cegid, una incidencia
//     por cobro. Antes, lo comprueba todo otra vez y PARA si algo no cuadra:
//       - cada cobro: de la empresa, cobrado (confirmed o paid_out), del mes, con un concepto de la tabla aprobada
//         (_shared/cegidMandar.ts) y con una base al 21 % que da el cobro al céntimo;
//       - el cliente de Cegid existe y su NIF es el de la ficha atada al cobro (conta_cobro_cliente o el enlace);
//       - su ficha de Cegid NO tiene conceptos fijos (se lee en ese momento): si los tiene, Cegid le facturaría dos
//         veces;
//       - el cobro no está ya mandado (conta_cegid_incidencia: un cobro, una incidencia viva).
//     Cada incidencia se apunta ANTES de mandarla («mandando») y se cierra con su número de Cegid («mandada») o con su
//     porqué («fallo»): nada sale dos veces aunque se pulse dos veces.
//   · { company_id, accion: 'deshacer', mes, cliente? }: borra en Cegid las incidencias que mandó Sumied y que aún no
//     están facturadas; las ya facturadas no se tocan (quedan «facturada», con su factura).
// La autónoma (una empresa que factura con retención): no se le manda nada todavía (respuesta 3, punto 6).
// Solo un administrador de la cuenta. En una cuenta de demostración, no se escribe (puerta.ts).
// verify_jwt = true (config.toml).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { cuentaPuedeSalir } from "../_shared/puerta.ts";
import { ClienteDiezRec, conceptosFijos, FalloDiezRec, rutaCliente } from "../_shared/diezRec.ts";
import { baseDelCobro, COBRADO_GC, conceptoAprobado, cuerpoIncidencia, type LineaIncidencia } from "../_shared/cegidMandar.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICIO = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Srv = any;
type Fila = Record<string, unknown>;
const nifLimpio = (n: unknown) => String(n ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "").replace(/^ES(?=[0-9A-Z]{9}$)/, "");
const eur = (c: number) => `${new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(c / 100)} €`;

async function conexion(srv: Srv, accountId: string, companyId: string): Promise<{ cliente: ClienteDiezRec } | { error: string; status: number }> {
  const { data: filas, error } = await srv.from("account_connector").select("id, scope, company_id, external_account_id, connector!inner(code)")
    .eq("account_id", accountId).eq("connector.code", "diezrec").in("scope", ["account", "company"]);
  if (error) return { error: `no se ha podido leer la conexión con Cegid: ${error.message}`, status: 500 };
  const xs = (filas ?? []) as Fila[];
  const cuenta = xs.find((x) => x.scope === "account");
  const soc = xs.find((x) => x.scope === "company" && x.company_id === companyId);
  if (!cuenta) return { error: "Esta cuenta no está conectada con la facturación de Cegid: pon las claves en Ajustes › Facturación de Cegid.", status: 404 };
  const empresa = String(soc?.external_account_id ?? "").trim();
  if (!empresa) return { error: "Falta el código de empresa de esta sociedad en Cegid: ponlo en Ajustes › Facturación de Cegid.", status: 409 };
  const { data: s, error: e2 } = await srv.rpc("connector_secret_read", { p_account_connector_id: cuenta.id });
  const sec = ((s as { secrets?: Record<string, string> } | null)?.secrets ?? {}) as Record<string, string>;
  if (e2 || !sec.client_id || !sec.client_secret || !sec.username || !sec.password) {
    return { error: "Faltan las claves de la facturación de Cegid: escríbelas en Ajustes › Facturación de Cegid.", status: 409 };
  }
  return { cliente: new ClienteDiezRec({ claves: { client_id: sec.client_id, client_secret: sec.client_secret, username: sec.username, password: sec.password }, empresa,
    fetch: (url, init) => fetch(url, init), escribe: "incidencias" }) };
}

/** La ficha de Cegid de un cliente, leída ahora: sus conceptos fijos y su NIF; y se guardan los conceptos en Sumied. */
async function fichaAhora(srv: Srv, api: ClienteDiezRec, companyId: string, codigo: number): Promise<{ existe: boolean; nif: string | null; fijos: ReturnType<typeof conceptosFijos> }> {
  const r = await api.get(rutaCliente(codigo));
  if (r.status === 204) return { existe: false, nif: null, fijos: [] };
  if (r.status !== 200) throw new FalloDiezRec(`Cegid contesta ${r.status} al leer el cliente ${codigo}`, r.status);
  const j = (r.json ?? {}) as Fila;
  const fijos = conceptosFijos(j).filter((x) => (x.codigoConcepto ?? "").trim());
  await srv.from("conta_cegid_cliente").update({ conceptos: fijos, leido_at: new Date().toISOString() }).eq("company_id", companyId).eq("codigo", codigo);
  return { existe: true, nif: (j.nif as string | null) ?? null, fijos };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "usa POST" }, 405);
  const sb = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } }, auth: { persistSession: false } });
  const { data: u } = await sb.auth.getUser();
  if (!u?.user) return json({ error: "no autenticado" }, 401);

  let b: Fila = {};
  try { b = await req.json(); } catch { /* vacío */ }
  const companyId = typeof b.company_id === "string" && /^[0-9a-f-]{36}$/i.test(b.company_id) ? b.company_id : "";
  const accion = b.accion === "releer" || b.accion === "mandar" || b.accion === "deshacer" ? b.accion : "";
  if (!companyId || !accion) return json({ error: "faltan company_id o accion (releer, mandar o deshacer)" }, 400);
  const mes = typeof b.mes === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(b.mes) ? b.mes : "";
  if ((accion === "mandar" || accion === "deshacer") && !mes) return json({ error: "falta el mes (AAAA-MM)" }, 400);

  const { data: co } = await sb.from("company").select("id, account_id, tax_id").eq("id", companyId).maybeSingle();
  if (!co) return json({ error: "Esa sociedad no es de tu cuenta." }, 403);
  const { data: admin } = await sb.rpc("current_user_is_admin_of", { p_account_id: co.account_id });
  if (admin !== true) return json({ error: "Solo un administrador de la cuenta manda a la facturación de Cegid." }, 403);
  const srv = createClient(SUPABASE_URL, SERVICIO, { auth: { persistSession: false } });
  if (!(await cuentaPuedeSalir(srv, co.account_id))) return json({ error: "En la demo no se manda nada a Cegid.", demo: true }, 409);
  // La autónoma (persona física: factura con retención): nada hasta leer su Cegid y el sí de Julio (respuesta 3, punto 6).
  if (accion === "mandar" && /^[0-9XYZKLM]/.test(nifLimpio(co.tax_id))) {
    return json({ error: "A esta empresa aún no se le manda nada a Cegid: falta leer su facturación y el sí de Julio (lleva retención)." }, 409);
  }
  const c = await conexion(srv, co.account_id, companyId);
  if ("error" in c) return json({ error: c.error }, c.status);
  const api = c.cliente;
  const quien = String((u.user.user_metadata as Fila | undefined)?.full_name ?? u.user.email ?? "alguien");

  try {
    if (accion === "releer") {
      const codigos = (Array.isArray(b.codigos) ? b.codigos : []).map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 40);
      const parados: { codigo: number; conceptos: unknown[] }[] = [];
      for (const cod of codigos) {
        const f = await fichaAhora(srv, api, companyId, cod);
        if (f.fijos.length) parados.push({ codigo: cod, conceptos: f.fijos });
      }
      return json({ ok: true, leidos: codigos.length, parados });
    }

    if (accion === "mandar") {
      const cliente = Number(b.cliente);
      const ids = (Array.isArray(b.cobros) ? b.cobros : []).map(String).slice(0, 60);
      if (!Number.isInteger(cliente) || cliente <= 0 || !ids.length) return json({ error: "mandar necesita el cliente de Cegid y sus cobros" }, 400);
      // Los cobros, de la base: cobrados, del mes, con concepto aprobado y base que cuadra.
      const { data: cs, error: e1 } = await srv.from("conta_gc_cobro").select("gc_id, estado, fecha, importe, suscripcion_gc_id, mandato_gc_id").eq("company_id", companyId).in("gc_id", ids);
      if (e1) return json({ error: `no se han podido leer los cobros: ${e1.message}` }, 500);
      const cobros = (cs ?? []) as Fila[];
      const subsIds = cobros.map((x) => x.suscripcion_gc_id).filter(Boolean);
      const { data: ss } = subsIds.length ? await srv.from("conta_gc_suscripcion").select("gc_id, nombre, gc_cliente_id").eq("company_id", companyId).in("gc_id", subsIds) : { data: [] };
      const sus = new Map(((ss ?? []) as Fila[]).map((x) => [String(x.gc_id), x]));
      const lineas: LineaIncidencia[] = [], malos: string[] = [];
      const gcClientes = new Set<string>();
      for (const id of ids) {
        const x = cobros.find((y) => y.gc_id === id);
        if (!x) { malos.push(`${id}: no es de esta empresa`); continue; }
        if (!(COBRADO_GC as readonly string[]).includes(String(x.estado))) { malos.push(`${id}: no está cobrado («${x.estado}»)`); continue; }
        if (String(x.fecha).slice(0, 7) !== mes) { malos.push(`${id}: no es de ${mes}`); continue; }
        const s = sus.get(String(x.suscripcion_gc_id ?? ""));
        const concepto = conceptoAprobado((s?.nombre as string | null) ?? null);
        if (!concepto) { malos.push(`${id}: su concepto no está en la tabla aprobada`); continue; }
        const totalCent = Math.round(Number(x.importe) * 100), baseCent = baseDelCobro(totalCent);
        if (baseCent === null) { malos.push(`${id}: ninguna base al 21 % da ${eur(totalCent)}`); continue; }
        if (s?.gc_cliente_id) gcClientes.add(String(s.gc_cliente_id));
        lineas.push({ gcId: id, concepto, texto: String(s?.nombre ?? "").replace(/\s+/g, " ").trim(), fecha: String(x.fecha), baseCent, totalCent });
      }
      if (malos.length) return json({ error: `No se manda nada de este cliente: ${malos.join("; ")}.` }, 409);
      // La ficha de Cegid, ahora: existe, mismo NIF que la ficha atada y sin conceptos fijos.
      const f = await fichaAhora(srv, api, companyId, cliente);
      if (!f.existe) return json({ error: `El cliente ${cliente} no existe en la facturación de Cegid.` }, 409);
      const { data: cc } = await srv.from("conta_cobro_cliente").select("party_id").eq("company_id", companyId).in("gc_cliente_id", [...gcClientes]);
      const { data: en } = await srv.from("conta_gc_enlace").select("party_id").eq("company_id", companyId).eq("estado", "atado").in("gc_cliente_id", [...gcClientes]);
      const partes = [...new Set([...(cc ?? []), ...(en ?? [])].map((x: Fila) => String(x.party_id ?? "")).filter(Boolean))];
      const { data: ps } = partes.length ? await srv.from("party").select("tax_id").eq("account_id", co.account_id).in("id", partes) : { data: [] };
      const nifs = new Set(((ps ?? []) as Fila[]).map((x) => nifLimpio(x.tax_id)).filter(Boolean));
      if (!nifs.has(nifLimpio(f.nif))) return json({ error: `El cliente ${cliente} de Cegid tiene otro NIF que la ficha de estos cobros: no se manda.` }, 409);
      if (f.fijos.length) {
        return json({ error: `El cliente ${cliente} aún tiene conceptos fijos en Cegid (${f.fijos.map((x) => x.codigoConcepto).join(", ")}): quítalos antes, o se le facturaría dos veces.`, parado: true }, 409);
      }
      // Una a una: se apunta antes de mandarla y se cierra con su número o con su porqué.
      let hechas = 0, totalCent = 0;
      for (const l of lineas) {
        const { data: fila, error: e3 } = await srv.from("conta_cegid_incidencia").insert({
          company_id: companyId, account_id: co.account_id, gc_cobro_id: l.gcId, mes, cliente, concepto: l.concepto.codigo, serie: l.concepto.serie, texto: l.texto,
          base: l.baseCent / 100, total: l.totalCent / 100, estado: "mandando", mandada_por: quien,
        }).select("id").single();
        if (e3) {
          if (String(e3.code) === "23505") continue; // ya mandado: nada sale dos veces.
          return json({ error: `no se ha podido apuntar la incidencia: ${e3.message}` }, 500);
        }
        try {
          const r = await api.crearIncidencia(cuerpoIncidencia(cliente, l, mes));
          await srv.from("conta_cegid_incidencia").update({ incidencia: r.incidencia, estado: "mandada" }).eq("id", fila.id);
          hechas++; totalCent += l.totalCent;
        } catch (e) {
          const m = e instanceof Error ? e.message : String(e);
          await srv.from("conta_cegid_incidencia").update({ estado: "fallo", motivo: m.slice(0, 300) }).eq("id", fila.id);
          return json({ error: `Mandadas ${hechas} de ${lineas.length} del cliente ${cliente}; paró: ${m}`, hechas }, 502);
        }
      }
      const ya = lineas.length - hechas;
      return json({ ok: true, hechas, frase: `Mandado a Cegid el cliente ${cliente}: ${hechas} ${hechas === 1 ? "cobro" : "cobros"}, ${eur(totalCent)}${ya ? ` (${ya} ya estaban mandados)` : ""}.` });
    }

    // deshacer: las mandadas y aún no facturadas, fuera de Cegid.
    let q = srv.from("conta_cegid_incidencia").select("id, cliente, incidencia").eq("company_id", companyId).eq("mes", mes).eq("estado", "mandada");
    if (b.cliente != null) q = q.eq("cliente", Number(b.cliente));
    const { data: vivas, error: e4 } = await q;
    if (e4) return json({ error: `no se ha podido leer lo mandado: ${e4.message}` }, 500);
    let borradas = 0, facturadas = 0;
    for (const v of (vivas ?? []) as Fila[]) {
      const inc = await api.leerIncidencia(Number(v.cliente), Number(v.incidencia));
      if (inc && inc.estaFacturado === true) {
        await srv.from("conta_cegid_incidencia").update({ estado: "facturada", ano_factura: inc.anoFactura ?? null, serie_factura: inc.serieFactura ?? null, numero_factura: inc.numeroFactura ?? null }).eq("id", v.id);
        facturadas++; continue;
      }
      if (inc) await api.borrarIncidencia(Number(v.cliente), Number(v.incidencia));
      await srv.from("conta_cegid_incidencia").update({ estado: "deshecha", deshecha_at: new Date().toISOString(), deshecha_por: quien }).eq("id", v.id);
      borradas++;
    }
    return json({ ok: true, borradas, facturadas, frase: `Deshecho: ${borradas} ${borradas === 1 ? "incidencia borrada" : "incidencias borradas"} en Cegid${facturadas ? `; ${facturadas} ya estaban facturadas y no se tocan` : ""}.` });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return json({ error: m }, e instanceof FalloDiezRec ? 502 : 500);
  }
});
