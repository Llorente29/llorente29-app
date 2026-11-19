// supabase/functions/conta-erp10-escribir/index.ts
//
// X10b (19/11) · ERP10 POR LA API, FASE 2: SACAR LAS RECIBIDAS A ERP10. Lo llama la salida a
// ERP10 (Libros › Cierre › Salida a ERP10) con la sesión de un administrador:
//
//   { company_id, mes: 'AAAA-MM-01', recibidas: [{ api, huella, pdf }], cuentas_nuevas, quien }
//
// `api` es la recibida tal como la lee la salida (las cuentas ya en ERP10: las mismas que el
// Excel); `huella`, la de su fila (la misma que apunta el Excel). Por cada una, en orden,
// _shared/erp10Escribir.ts (sacarRecibida): la coge (conta_erp10_envio_tomar), da de alta las
// cuentas que falten, la busca en ERP10 y la enlaza si ya está o la escribe, apunta su número
// en el acto y sube su PDF. Después, lo que ha entrado se apunta en la salida de siempre
// (conta_erp10_lote_apuntar, con la sesión de quien pulsa) y el número de ERP10 va a su
// partida. Así nada sale dos veces, aunque se pulse dos veces o se corte a la mitad.
//
// Las reglas de la respuesta X10 · 2:
//   · solo las sociedades de la lista cerrada, con su NIF comprobado (el cliente de ERP10);
//   · la PRIMERA salida de cada sociedad es UNA factura sola; el mes entero, solo después de
//     comprobarla en el paso 3 (un «Darlo por igualado» posterior a esa primera);
//   · lo que entra no se puede borrar por aquí (no hay DELETE en la API).
// Tope de tiempo: lo que no da tiempo vuelve en «quedan» y se saca en la siguiente llamada.
//
// Contesta 200 con lo que ha pasado a cada una, o { error } en palabras (regla 8): 401 sin
// sesión, 403 sin permiso, 404 sin conexión, 409 si un freno para. En el registro, solo
// recuentos.
//
// verify_jwt = true (config.toml).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { cuentaPuedeSalir } from "../_shared/puerta.ts";
import { clienteErp10 } from "../_shared/erp10Despacho.ts";
import { FrenoErp10 } from "../_shared/erp10Cliente.ts";
import { sacarRecibida, type CuentaNueva, type Envio, type PuertoEscribir, type RecibidaParaApi, type Resultado } from "../_shared/erp10Escribir.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICIO = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TOPE_MS = 40_000;
const EN_LA_DEMO = "En la demo no se escribe en ERP10.";
export const PRIMERA_UNA = "La primera vez que esta sociedad saca a ERP10 sale una factura sola, para probar. Sácala, compruébala en el paso 3 y después saca el mes.";
export const SIN_COMPROBAR = "Antes de sacar el mes, comprueba en el paso 3 la factura de prueba y dala por igualada.";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const hoyMadrid = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date());
const huellaDe = async (t: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)))].map((b) => b.toString(16).padStart(2, "0")).join("");

type Pedida = { api: RecibidaParaApi; huella: string; pdf: { ruta: string; nombre: string } | null };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "usa POST" }, 405);
  const t0 = Date.now();

  const sb = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } }, auth: { persistSession: false } });
  const { data: u } = await sb.auth.getUser();
  if (!u?.user) return json({ error: "no autenticado" }, 401);

  let b: { company_id?: unknown; mes?: unknown; recibidas?: unknown; cuentas_nuevas?: unknown; quien?: unknown } = {};
  try { b = await req.json(); } catch { /* vacío */ }
  const companyId = typeof b.company_id === "string" && /^[0-9a-f-]{36}$/i.test(b.company_id) ? b.company_id : "";
  const mes = typeof b.mes === "string" && /^\d{4}-\d{2}-01$/.test(b.mes) ? b.mes : "";
  const pedidas = (Array.isArray(b.recibidas) ? b.recibidas : []) as Pedida[];
  const cuentasNuevas = (Array.isArray(b.cuentas_nuevas) ? b.cuentas_nuevas : []) as CuentaNueva[];
  const quien = typeof b.quien === "string" ? b.quien.slice(0, 120) : null;
  if (!companyId || !mes || !pedidas.length) return json({ error: "faltan company_id, mes (AAAA-MM-01) o las recibidas" }, 400);
  if (pedidas.some((x) => !x?.api?.entryId || !/^[0-9a-f-]{36}$/i.test(x.api.entryId) || typeof x.huella !== "string" || !x.huella.trim())) {
    return json({ error: "cada recibida lleva su asiento y su huella" }, 400);
  }
  if (new Set(pedidas.map((x) => x.api.entryId)).size !== pedidas.length) return json({ error: "una recibida viene dos veces: no se saca nada" }, 400);

  // La sociedad, con los permisos de quien llama; solo un administrador.
  const { data: co, error: e0 } = await sb.from("company").select("id, account_id").eq("id", companyId).maybeSingle();
  if (e0) return json({ error: `no se ha podido leer la sociedad: ${e0.message}` }, 500);
  if (!co) return json({ error: "Esa sociedad no es de tu cuenta." }, 403);
  const { data: admin } = await sb.rpc("current_user_is_admin_of", { p_account_id: co.account_id });
  if (admin !== true) return json({ error: "Solo un administrador de la cuenta saca a ERP10." }, 403);
  const srv = createClient(SUPABASE_URL, SERVICIO, { auth: { persistSession: false } });
  if (!(await cuentaPuedeSalir(srv, co.account_id))) return json({ error: EN_LA_DEMO, demo: true }, 409);

  // La primera, sola; el mes, después de comprobarla.
  const { data: entradas, error: e1 } = await srv.from("conta_erp10_envio").select("creado_en").eq("company_id", companyId).eq("account_id", co.account_id)
    .eq("estado", "en_erp10").order("creado_en", { ascending: true }).limit(1);
  if (e1) return json({ error: `no se ha podido leer lo que ya ha salido a ERP10: ${e1.message}` }, 500);
  const primera = (entradas ?? [])[0]?.creado_en as string | undefined;
  if (pedidas.length > 1) {
    if (!primera) return json({ error: PRIMERA_UNA, primera: true }, 409);
    const { data: ig } = await srv.from("conta_erp10_igualado").select("id").eq("company_id", companyId).eq("account_id", co.account_id).gt("igualado_en", primera).limit(1);
    if (!(ig ?? []).length) return json({ error: SIN_COMPROBAR, sinComprobar: true }, 409);
  }

  try {
    const c = await clienteErp10(srv, co.account_id, companyId, { escribir: true });
    if (!c) return json({ error: "Esta sociedad no está conectada con ERP10: pon su código de empresa en «Conexión con ERP10»." }, 404);
    const hoy = hoyMadrid();
    const puerto: PuertoEscribir = {
      hoy,
      tomar: async (entryId) => {
        const { data, error } = await srv.rpc("conta_erp10_envio_tomar", { p_company: companyId, p_entry: entryId, p_clase: "recibida", p_quien_nombre: quien });
        if (error) throw new Error(`no se ha podido coger el asiento: ${error.message}`);
        return data as { tomado: boolean; envio: Envio };
      },
      poner: async (id, cambios) => {
        const { error } = await srv.from("conta_erp10_envio").update({ ...cambios, cambiado_en: new Date().toISOString() }).eq("id", id).eq("account_id", co.account_id);
        if (error) throw new Error(`no se ha podido apuntar lo que ha pasado: ${error.message}`);
      },
      pdf: async (ruta) => {
        const { data, error } = await srv.storage.from("conta-documentos").download(ruta);
        if (error || !data) throw new Error(`no se ha podido leer el PDF guardado: ${error?.message ?? "vacío"}`);
        return new Uint8Array(await data.arrayBuffer());
      },
      erp10: {
        tieneSubcuenta: (k) => c.cliente.tieneSubcuenta(k),
        crearSubcuenta: (sc) => c.cliente.crearSubcuenta(sc),
        facturasDelMes: (m) => c.cliente.facturasDelMes(m),
        altaFactura: (fd) => c.cliente.altaFactura(fd),
        subirDocumento: (d) => c.cliente.subirDocumento(d),
      },
    };

    const resultados: Resultado[] = [];
    const quedan: string[] = [];
    for (const x of pedidas) {
      if (Date.now() - t0 > TOPE_MS) { quedan.push(x.api.entryId); continue; }
      resultados.push(await sacarRecibida(x.api, cuentasNuevas, x.pdf, puerto));
    }

    // Lo que ha entrado (o ya estaba) y no está apuntado en la salida de Sumied: un lote.
    const porApuntar = resultados.filter((r) => (r.estado === "en_erp10" || r.estado === "ya_estaba") && r.sinApuntar);
    let apuntado: string | null = null;
    if (porApuntar.length) {
      const huellas = new Map(pedidas.map((x) => [x.api.entryId, x.huella.trim()]));
      const partidas = porApuntar.map((r) => ({ entry_id: r.entryId, clase: "recibida", huella: huellas.get(r.entryId)! }));
      const { data: lote, error: eL } = await sb.rpc("conta_erp10_lote_apuntar", {
        p_company: companyId, p_mes: mes, p_partidas: partidas, p_quien_nombre: quien,
        p_ficheros: [{ nombre: "ERP10 (por la conexión)", filas: partidas.length, huella: await huellaDe(partidas.map((x) => x.huella).join("|")) }],
      });
      if (eL) {
        apuntado = `Están en ERP10, pero no se han apuntado en la salida de Sumied (${eL.message}). Vuelve a pulsar: no se meten otra vez, solo se apuntan.`;
      } else {
        const loteId = String((lote as { lote: string }).lote);
        for (const r of porApuntar) {
          await srv.from("conta_erp10_salida_partida").update({ erp10_serie: r.serie ?? null, erp10_documento: r.documento ?? null })
            .eq("lote_id", loteId).eq("entry_id", r.entryId).eq("account_id", co.account_id);
          await srv.from("conta_erp10_envio").update({ lote_id: loteId, cambiado_en: new Date().toISOString() }).eq("entry_id", r.entryId).eq("account_id", co.account_id);
          r.sinApuntar = false;
        }
      }
    }
    console.log(JSON.stringify({ pedidas: pedidas.length, en_erp10: resultados.filter((r) => r.estado === "en_erp10").length, no_pudo: resultados.filter((r) => r.estado === "no_pudo").length, quedan: quedan.length }));
    return json({ ok: true, resultados, quedan, sinApuntar: apuntado, primera: !primera });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(JSON.stringify({ fallo: e instanceof FrenoErp10 ? "freno" : "erp10" }));
    return json({ error: msg }, e instanceof FrenoErp10 ? 409 : 502);
  }
});
