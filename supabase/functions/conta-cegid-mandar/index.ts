// supabase/functions/conta-cegid-mandar/index.ts
//
// Q10 · respuesta 3 (25/11) · MANDAR A CEGID TODO LO COBRADO, como incidencias del mes (API DiezREC). Cegid solo
// factura lo que manda Sumied. Escribe en Cegid SOLO incidencias (el cliente de _shared/diezRec.ts con
// escribe: 'incidencias'): nunca conceptos ni fichas.
//   · { company_id, accion: 'mandar', mes, cliente, cobros }: manda los cobros de UN cliente de Cegid, una incidencia
//     por cobro. Antes, lo comprueba todo otra vez y PARA si algo no cuadra:
//       - cada cobro: de la empresa, cobrado (confirmed o paid_out), del mes, con un concepto de la tabla aprobada
//         (_shared/cegidMandar.ts) y con una base al 21 % que da el cobro al céntimo;
//       - el cliente de Cegid existe y su NIF es el de la ficha atada al cobro (conta_cobro_cliente o el enlace), o esa
//         ficha tiene ese código de cliente en «Clientes y cuotas» (conta_cobro_cliente.codigo_cliente, respuesta 4);
//       - el cobro no está ya mandado (conta_cegid_incidencia: un cobro, una incidencia viva).
//     Cada incidencia se apunta ANTES de mandarla («mandando») y se cierra con su número de Cegid («mandada») o con su
//     porqué («fallo»): nada sale dos veces aunque se pulse dos veces.
//   · Respuesta 4 · { …, serie: '1' | '3' } en «mandar»: una vuelta por serie (la incidencia no lleva serie; la pone la
//     «Facturación automática»). La vuelta 1 es todo menos Contasimple; la 3, Contasimple, y solo cuando todo lo de la
//     vuelta 1 del mes está ya facturado en la serie 1 (leído de Cegid con «leer_mes»).
//   · Respuesta 4 · { company_id, accion: 'leer_mes', mes }: lee de Cegid TODAS las incidencias del mes (las de Sumied y
//     las de cualquiera), para el cuadre cobro por cobro, y apunta como «facturada» (con su factura) lo que mandó Sumied
//     y Cegid ya facturó. No escribe en Cegid.
//   · { company_id, accion: 'deshacer', mes, cliente? }: borra en Cegid las incidencias que mandó Sumied y que aún no
//     están facturadas; las ya facturadas no se tocan (quedan «facturada», con su factura).
// Los conceptos fijos de la ficha NO paran a nadie (añadido a la respuesta 3, 25/11): Julio no los corta ficha a ficha,
// quita «Noviembre» de los meses del periodo 1 (MENSUAL) en Cegid, y la API sigue devolviéndolos en la ficha. Lo avisa
// la pantalla antes de mandar.
// La autónoma (una empresa que factura con retención): no se le manda nada todavía (respuesta 3, punto 6).
// Solo un administrador de la cuenta. En una cuenta de demostración, no se escribe (puerta.ts).
// verify_jwt = true (config.toml).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { cuentaPuedeSalir } from "../_shared/puerta.ts";
import { ClienteDiezRec, FalloDiezRec, rutaCliente } from "../_shared/diezRec.ts";
import { baseDelCobro, COBRADO_GC, conceptoAprobado, conceptoDeCodigo, cuerpoIncidencia, type LineaIncidencia } from "../_shared/cegidMandar.ts";

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

/** La ficha de Cegid de un cliente, leída ahora: si existe y su NIF. */
async function fichaAhora(api: ClienteDiezRec, codigo: number): Promise<{ existe: boolean; nif: string | null }> {
  const r = await api.get(rutaCliente(codigo));
  if (r.status === 204) return { existe: false, nif: null };
  if (r.status !== 200) throw new FalloDiezRec(`Cegid contesta ${r.status} al leer el cliente ${codigo}`, r.status);
  const j = (r.json ?? {}) as Fila;
  return { existe: true, nif: (j.nif as string | null) ?? null };
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
  const accion = b.accion === "mandar" || b.accion === "deshacer" || b.accion === "leer_mes" ? b.accion : "";
  if (!companyId || !accion) return json({ error: "faltan company_id o accion (mandar, leer_mes o deshacer)" }, 400);
  const mes = typeof b.mes === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(b.mes) ? b.mes : "";
  if (!mes) return json({ error: "falta el mes (AAAA-MM)" }, 400);

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
    if (accion === "leer_mes") {
      const [ano, m] = mes.split("-").map(Number);
      const filas: Fila[] = [];
      for (let pagina = 0; pagina < 100; pagina++) {
        const p = await api.pagina("incidencias", pagina, ano, m);
        filas.push(...p.filas);
        if (p.ultima) break;
      }
      // Lo que mandó Sumied y Cegid ya facturó: «facturada», con su factura.
      const { data: vivas } = await srv.from("conta_cegid_incidencia").select("id, cliente, incidencia").eq("company_id", companyId).eq("mes", mes).eq("estado", "mandada");
      const porClave = new Map(filas.map((x) => [`${x.cliente}/${x.incidencia}`, x]));
      let facturadas = 0;
      for (const v of (vivas ?? []) as Fila[]) {
        const x = porClave.get(`${v.cliente}/${v.incidencia}`);
        if (x && x.estaFacturado === true) {
          await srv.from("conta_cegid_incidencia").update({ estado: "facturada", ano_factura: x.anoFactura ?? null, serie_factura: x.serieFactura ?? null, numero_factura: x.numeroFactura ?? null }).eq("id", v.id);
          facturadas++;
        }
      }
      const incidencias = filas.map((x) => ({ cliente: Number(x.cliente), incidencia: Number(x.incidencia), concepto: (x.concepto as string | null) ?? null, titulo: (x.titulo as string | null) ?? null,
        texto: (x.textoConcepto as string | null) ?? null, importe: x.importe == null ? null : Number(x.importe), total: x.total == null ? null : Number(x.total),
        facturada: x.estaFacturado === true, serieFactura: (x.serieFactura as string | null) ?? null, numeroFactura: x.numeroFactura == null ? null : Number(x.numeroFactura) }));
      return json({ ok: true, incidencias, facturadas, frase: `Leídas de Cegid ${incidencias.length} ${incidencias.length === 1 ? "incidencia" : "incidencias"} de ${mes}${facturadas ? `; ${facturadas} de las de Sumied ya están facturadas` : ""}. No se ha escrito nada en Cegid.` });
    }

    if (accion === "mandar") {
      const serie = b.serie === "3" ? "3" : b.serie === "1" ? "1" : "";
      if (!serie) return json({ error: "mandar necesita la serie de la vuelta (1 o 3)" }, 400);
      // La vuelta 3 (Contasimple), solo con todo lo de la vuelta 1 del mes ya facturado en la serie 1.
      if (serie === "3") {
        const { data: s1 } = await srv.from("conta_cegid_incidencia").select("estado, serie_factura").eq("company_id", companyId).eq("mes", mes).eq("serie", "1").in("estado", ["mandando", "mandada", "facturada"]);
        const xs = (s1 ?? []) as Fila[];
        const sinFacturar = xs.filter((x) => x.estado !== "facturada").length, otraSerie = xs.filter((x) => x.estado === "facturada" && String(x.serie_factura ?? "").trim() !== "1").length;
        if (!xs.length || sinFacturar || otraSerie) {
          return json({ error: !xs.length ? "Contasimple va después: primero se manda y se factura con la serie 1 todo lo demás."
            : sinFacturar ? `Contasimple va después: aún hay ${sinFacturar} líneas de la vuelta 1 sin facturar en Cegid (lee de Cegid después de facturar con la serie 1).`
            : `${otraSerie} líneas de la vuelta 1 se facturaron en otra serie que la 1: míralo en Cegid antes de mandar Contasimple.` }, 409);
        }
      }
      const cliente = Number(b.cliente);
      const ids = (Array.isArray(b.cobros) ? b.cobros : []).map(String).slice(0, 60);
      if (!Number.isInteger(cliente) || cliente <= 0 || !ids.length) return json({ error: "mandar necesita el cliente de Cegid y sus cobros" }, 400);
      // Los cobros, de la base: cobrados, del mes, con concepto aprobado y base que cuadra.
      const { data: cs, error: e1 } = await srv.from("conta_gc_cobro").select("gc_id, estado, fecha, importe, suscripcion_gc_id, mandato_gc_id, descripcion").eq("company_id", companyId).in("gc_id", ids);
      if (e1) return json({ error: `no se han podido leer los cobros: ${e1.message}` }, 500);
      const cobros = (cs ?? []) as Fila[];
      const subsIds = cobros.map((x) => x.suscripcion_gc_id).filter(Boolean);
      const { data: ss } = subsIds.length ? await srv.from("conta_gc_suscripcion").select("gc_id, nombre, gc_cliente_id").eq("company_id", companyId).in("gc_id", subsIds) : { data: [] };
      const sus = new Map(((ss ?? []) as Fila[]).map((x) => [String(x.gc_id), x]));
      // Respuesta 4 · Lo elegido por una persona (cobro suelto o suscripción fuera de la tabla) manda sobre la tabla.
      const { data: el } = await srv.from("conta_cegid_concepto_elegido").select("que, gc_id, concepto").eq("company_id", companyId)
        .in("gc_id", [...ids, ...subsIds.map(String)]);
      const elegido = new Map(((el ?? []) as Fila[]).map((x) => [`${x.que}:${x.gc_id}`, String(x.concepto)]));
      // Un cobro suelto no tiene suscripción: su cliente sale de su mandato.
      const mandIds = cobros.filter((x) => !x.suscripcion_gc_id && x.mandato_gc_id).map((x) => String(x.mandato_gc_id));
      const { data: mm } = mandIds.length ? await srv.from("conta_gc_mandato").select("gc_id, gc_cliente_id").eq("company_id", companyId).in("gc_id", mandIds) : { data: [] };
      const clienteDeMandato = new Map(((mm ?? []) as Fila[]).map((x) => [String(x.gc_id), String(x.gc_cliente_id ?? "")]));
      const lineas: LineaIncidencia[] = [], malos: string[] = [];
      const gcClientes = new Set<string>();
      for (const id of ids) {
        const x = cobros.find((y) => y.gc_id === id);
        if (!x) { malos.push(`${id}: no es de esta empresa`); continue; }
        if (!(COBRADO_GC as readonly string[]).includes(String(x.estado))) { malos.push(`${id}: no está cobrado («${x.estado}»)`); continue; }
        if (String(x.fecha).slice(0, 7) !== mes) { malos.push(`${id}: no es de ${mes}`); continue; }
        const s = sus.get(String(x.suscripcion_gc_id ?? ""));
        const elegidoAqui = s ? elegido.get(`suscripcion:${s.gc_id}`) : elegido.get(`cobro:${id}`);
        const concepto = elegidoAqui ? conceptoDeCodigo(elegidoAqui) : conceptoAprobado((s?.nombre as string | null) ?? null);
        if (!concepto) { malos.push(`${id}: su concepto no está en la tabla aprobada ni elegido`); continue; }
        const texto = String((s ? s.nombre : x.descripcion) ?? "").replace(/\s+/g, " ").trim();
        if (!texto) { malos.push(`${id}: falta el texto del cobro (vuelve a leer GoCardless)`); continue; }
        const totalCent = Math.round(Number(x.importe) * 100), baseCent = baseDelCobro(totalCent);
        if (baseCent === null) { malos.push(`${id}: ninguna base al 21 % da ${eur(totalCent)}`); continue; }
        if (concepto.serie !== serie) { malos.push(`${id}: es de la serie ${concepto.serie} y esta vuelta es la ${serie}`); continue; }
        const gcCliente = s?.gc_cliente_id ? String(s.gc_cliente_id) : clienteDeMandato.get(String(x.mandato_gc_id ?? "")) ?? "";
        if (gcCliente) gcClientes.add(gcCliente);
        lineas.push({ gcId: id, concepto, texto, fecha: String(x.fecha), baseCent, totalCent });
      }
      if (malos.length) return json({ error: `No se manda nada de este cliente: ${malos.join("; ")}.` }, 409);
      // La ficha de Cegid, ahora: existe y tiene el mismo NIF que la ficha atada.
      const f = await fichaAhora(api, cliente);
      if (!f.existe) return json({ error: `El cliente ${cliente} no existe en la facturación de Cegid.` }, 409);
      const { data: cc } = await srv.from("conta_cobro_cliente").select("party_id, codigo_cliente").eq("company_id", companyId).in("gc_cliente_id", [...gcClientes]);
      const atadaAMano = ((cc ?? []) as Fila[]).some((x) => Number(x.codigo_cliente) === cliente);
      const { data: en } = await srv.from("conta_gc_enlace").select("party_id").eq("company_id", companyId).eq("estado", "atado").in("gc_cliente_id", [...gcClientes]);
      const partes = [...new Set([...(cc ?? []), ...(en ?? [])].map((x: Fila) => String(x.party_id ?? "")).filter(Boolean))];
      const { data: ps } = partes.length ? await srv.from("party").select("tax_id").eq("account_id", co.account_id).in("id", partes) : { data: [] };
      const nifs = new Set(((ps ?? []) as Fila[]).map((x) => nifLimpio(x.tax_id)).filter(Boolean));
      if (!atadaAMano && !nifs.has(nifLimpio(f.nif))) return json({ error: `El cliente ${cliente} de Cegid tiene otro NIF que la ficha de estos cobros: no se manda.` }, 409);
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
