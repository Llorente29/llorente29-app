// supabase/functions/conta-cegid-leer/index.ts
//
// Q10 · respuesta 1 · puntos 1 y 2 · LEER LA FACTURACIÓN DE CEGID (API DiezREC), SOLO LEYENDO. Las llamadas a la API
// salen solo de aquí (el servidor): las claves nunca llegan al navegador.
//   · { company_id, accion: 'probar' }: entra (login, con «empresa» o «codigoEmpresa») y dice a qué empresa ha entrado
//     por lo que lee de ella (DiezREC no da su nombre ni su NIF): sus series con su última factura del año y cuántos
//     clientes tiene, y el id del login. No escribe nada ni en Cegid ni en Sumied.
//   · { company_id, accion: 'leer', que, pagina, ejercicio? }: UNA página de lo que se lee y se guarda en Sumied
//     (conta_cegid_*, la 1840): 'clientes', 'conceptos' o 'facturas' (de un ejercicio). La pantalla las pide una a
//     una; ninguna llamada pasa de un minuto. La primera página de cada cosa borra la foto de antes de esa empresa.
//   · { company_id, accion: 'detalle', que: 'clientes' | 'conceptos', desde }: el detalle de 25 clientes (sus
//     conceptos fijos, GetCustomer) o de 25 conceptos (IVA, retención, GetConcept), desde el que se le diga.
// Solo un administrador de la cuenta. En una cuenta de demostración, no se entra (puerta.ts).
// Contesta 200 con el resultado o { error } en palabras (regla 8): 401 sin sesión, 403 sin permiso, 404 sin
// conexión, 409 si faltan claves o el código, 502 si Cegid falla. En el registro, nada de lo leído ni las claves.
//
// verify_jwt = true (config.toml).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { cuentaPuedeSalir } from "../_shared/puerta.ts";
import { ClienteDiezRec, clienteCegid, conceptoCegid, conceptosFijos, facturaCegid, FalloDiezRec, fraseProbado, rutaCliente, rutaConcepto, rutaUltimaFactura, type Probado, type QueLeer } from "../_shared/diezRec.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICIO = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const EN_LA_DEMO = "En la demo no se entra en la facturación de Cegid.";
const POR_DETALLE = 25;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Srv = any;
type Fila = Record<string, unknown>;

/** Las claves de la cuenta y el código de empresa de la sociedad, del conector «diezrec». */
async function conexion(srv: Srv, accountId: string, companyId: string): Promise<{ cliente: ClienteDiezRec; empresa: string } | { error: string; status: number }> {
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
  const cliente = new ClienteDiezRec({ claves: { client_id: sec.client_id, client_secret: sec.client_secret, username: sec.username, password: sec.password }, empresa,
    fetch: (url, init) => fetch(url, init) });
  return { cliente, empresa };
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
  const accion = b.accion === "probar" || b.accion === "leer" || b.accion === "detalle" ? b.accion : "";
  if (!companyId || !accion) return json({ error: "faltan company_id o accion (probar, leer o detalle)" }, 400);
  const que = (["clientes", "conceptos", "facturas"] as const).find((x) => x === b.que) ?? null;
  const pagina = Number(b.pagina ?? 0), ejercicio = Number(b.ejercicio ?? 0), desde = Number(b.desde ?? 0);
  if (accion === "leer" && (!que || !Number.isInteger(pagina) || pagina < 0 || pagina > 999)) return json({ error: "leer necesita que (clientes, conceptos o facturas) y la página" }, 400);
  if (accion === "leer" && que === "facturas" && !(ejercicio >= 2000 && ejercicio <= 2100)) return json({ error: "las facturas se leen por ejercicio (AAAA)" }, 400);
  if (accion === "detalle" && (que === "facturas" || !que || !Number.isInteger(desde) || desde < 0)) return json({ error: "detalle necesita que (clientes o conceptos) y desde" }, 400);

  // La sociedad, con los permisos de quien llama; y solo un administrador.
  const { data: co } = await sb.from("company").select("id, account_id").eq("id", companyId).maybeSingle();
  if (!co) return json({ error: "Esa sociedad no es de tu cuenta." }, 403);
  const { data: admin } = await sb.rpc("current_user_is_admin_of", { p_account_id: co.account_id });
  if (admin !== true) return json({ error: "Solo un administrador de la cuenta lee la facturación de Cegid." }, 403);
  const srv = createClient(SUPABASE_URL, SERVICIO, { auth: { persistSession: false } });
  if (!(await cuentaPuedeSalir(srv, co.account_id))) return json({ error: EN_LA_DEMO, demo: true }, 409);

  const c = await conexion(srv, co.account_id, companyId);
  if ("error" in c) return json({ error: c.error }, c.status);
  const api = c.cliente;
  const base = { company_id: companyId, account_id: co.account_id, leido_at: new Date().toISOString() };

  try {
    if (accion === "probar") {
      // A qué empresa ha entrado, por lo que se lee de ella: sus series con su última factura del año y cuántos clientes.
      const ejercicioHoy = Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date()).slice(0, 4));
      const s = await api.pagina("series", 0);
      const series: Probado["series"] = [];
      for (const x of s.filas.slice(0, 20)) {
        const codigo = String(x.codigo ?? "").trim();
        if (!codigo) continue;
        const r = await api.get(rutaUltimaFactura(ejercicioHoy, codigo));
        const f = r.status === 200 ? ((r.json as Fila | null)?.datos as Fila[] | undefined)?.[0] : undefined;
        series.push({ codigo, descripcion: String(x.descripcion ?? "").trim() || null, ultima: f ? { ejercicio: Number(f.ejercicio), codigo: Number(f.codigo) } : null });
      }
      const cl = await api.get("/api/Customers?$orderby=codigo&$top=1&$skip=0");
      const clientes = cl.status === 200 ? Number((cl.json as Fila | null)?.resultadosTotales ?? NaN) : NaN;
      const p: Probado = { campo: api.campoEmpresa, empresa: c.empresa, idCliente: api.idCliente, clientes: Number.isFinite(clientes) ? clientes : null, series, ejercicio: ejercicioHoy };
      return json({ ok: true, ...p, frase: fraseProbado(p) });
    }

    if (accion === "leer") {
      const pag = await api.pagina(que as QueLeer, pagina, ejercicio);
      const tabla = que === "clientes" ? "conta_cegid_cliente" : que === "conceptos" ? "conta_cegid_concepto" : "conta_cegid_factura";
      if (pagina === 0) {
        let borrar = srv.from(tabla).delete().eq("company_id", companyId);
        if (que === "facturas") borrar = borrar.eq("ejercicio", ejercicio);
        const { error } = await borrar;
        if (error) return json({ error: `no se ha podido renovar lo leído: ${error.message}` }, 500);
      }
      const filas = que === "clientes" ? pag.filas.map(clienteCegid).filter(Boolean).map((x) => ({ ...base, ...x, conceptos: null }))
        : que === "conceptos" ? pag.filas.map(conceptoCegid).filter(Boolean).map((x) => ({ ...base, ...x }))
        : pag.filas.map(facturaCegid).filter(Boolean).map((x) => ({ ...base, ...x }));
      if (filas.length) {
        const { error } = await srv.from(tabla).upsert(filas);
        if (error) return json({ error: `no se ha podido guardar lo leído: ${error.message}` }, 500);
      }
      return json({ ok: true, que, pagina, leidas: filas.length, total: pag.total, ultima: pag.ultima });
    }

    // detalle: los conceptos fijos de 25 clientes, o el IVA y la retención de 25 conceptos, desde «desde».
    const tabla = que === "clientes" ? "conta_cegid_cliente" : "conta_cegid_concepto";
    const { data: xs, error } = await srv.from(tabla).select("codigo").eq("company_id", companyId).order("codigo").range(desde, desde + POR_DETALLE - 1);
    if (error) return json({ error: `no se ha podido leer lo guardado: ${error.message}` }, 500);
    const codigos = ((xs ?? []) as Fila[]).map((x) => x.codigo);
    let hechos = 0;
    for (const cod of codigos) {
      const r = await api.get(que === "clientes" ? rutaCliente(Number(cod)) : rutaConcepto(String(cod)));
      if (r.status === 204) continue;
      if (r.status !== 200) throw new FalloDiezRec(`Cegid contesta ${r.status} al leer ${que === "clientes" ? "el cliente" : "el concepto"} ${cod}`, r.status);
      const j = (r.json ?? {}) as Fila;
      const cambio = que === "clientes" ? { conceptos: conceptosFijos(j) } : (() => { const k = conceptoCegid(j); return k ? { por_iva: k.por_iva, con_retencion: k.con_retencion, iva_incluido: k.iva_incluido } : {}; })();
      const { error: e3 } = await srv.from(tabla).update({ ...cambio, leido_at: base.leido_at }).eq("company_id", companyId).eq("codigo", cod);
      if (e3) return json({ error: `no se ha podido guardar el detalle: ${e3.message}` }, 500);
      hechos++;
    }
    return json({ ok: true, que, desde, hechos, ultima: codigos.length < POR_DETALLE });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return json({ error: m }, e instanceof FalloDiezRec ? 502 : 500);
  }
});
