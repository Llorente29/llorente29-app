// supabase/functions/conta-verifactu/index.ts
//
// V03 · E1 · EL ENVÍO A HACIENDA DE LOS REGISTROS DE VERIFACTU. La despierta el
// cron (con el cron_secret, como conta-diez-cola), coge lo que el control de
// flujo deja enviar y lo manda (_shared/verifactu/enviar.ts). Cada envío queda
// en verifactu_envio con lo que contestó Hacienda; cada registro, con su estado.
//
// LA PUERTA, cerrada si no se dice otra cosa (CONTA_VERIFACTU, lo pone Julio):
//   · sin poner      → no envía nada: contesta «cerrada».
//   · «pruebas»      → solo en staging (nunca con la base de producción), solo
//                      los registros del entorno «pruebas», al entorno de
//                      pruebas de la AEAT (prewww1), con el certificado de
//                      pruebas (AEAT_PRUEBAS_P12_B64 / _CLAVE). El NIF del
//                      certificado tiene que ser el del obligado del envío.
//   · «real»         → solo con la base de producción, solo los registros del
//                      entorno «real» (no hay ninguno hasta que Julio pase una
//                      empresa a real). Con el certificado de cada empresa, solo
//                      si lo ha autorizado para Verifactu (verifactu_cert_abrir,
//                      2341); por la vía de colaborador social (la de partida,
//                      preparada y apagada), vuelve a la cola diciendo por qué.
//
// Sin sesión: verify_jwt = false (config.toml) y x-cron-secret = CRON_SECRET.
// En el registro, solo recuentos y motivos: nunca el XML, el certificado, el
// CSV ni un NIF.

import forge from "npm:node-forge@1.3.1";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { leerP12 } from "../_shared/certificados/leerP12.ts";
import { llamarConCertificado, type MaterialCertificado } from "../_shared/certificados/mtls.ts";
import { encolarAlerta } from "../_shared/alerta.ts";
import { type Entorno, type Lote, type Piezas, unaVuelta } from "../_shared/verifactu/enviar.ts";
import { puerta } from "../_shared/verifactu/puerta.ts";
import { casosPruebas } from "../_shared/verifactu/pruebasAeat.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICIO = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/** Los puntos de acceso del WSDL oficial (docs/conta/v03/aeat/SistemaFacturacion.wsdl). */
const URL: Record<Entorno, string> = {
  pruebas: "https://prewww1.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP",
  real: "https://www1.agenciatributaria.gob.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

class SinCertificado extends Error {
  constructor(m: string) { super(m); this.name = "SinCertificado"; }
}

let certPruebas: { material: MaterialCertificado; nif: string; titular: string } | null = null;
function leerCertPruebas() {
  if (!certPruebas) {
    const b64 = Deno.env.get("AEAT_PRUEBAS_P12_B64"), clave = Deno.env.get("AEAT_PRUEBAS_P12_CLAVE");
    if (!b64 || !clave) throw new SinCertificado("Faltan los secretos del certificado de pruebas (AEAT_PRUEBAS_P12_B64 y AEAT_PRUEBAS_P12_CLAVE).");
    const leido = leerP12(forge, Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), clave);
    if (!leido.ficha.nif) throw new SinCertificado("El certificado de pruebas no dice de qué NIF es.");
    certPruebas = { material: leido.material, nif: leido.ficha.nif.replace(/^ES/i, "").toUpperCase(), titular: leido.ficha.titular };
  }
  return certPruebas;
}
function materialPruebas(lote: Lote): MaterialCertificado {
  leerCertPruebas();
  if (certPruebas!.nif !== lote.nif_emisor) {
    throw new SinCertificado("El certificado de pruebas es de otro NIF que el de la empresa del envío: en pruebas, la empresa tiene que llevar el NIF del certificado.");
  }
  return certPruebas!.material;
}

/**
 * Solo pruebas: la empresa de pruebas (en su propia cuenta de staging, con el NIF
 * y el nombre del titular del certificado) y las 25 facturas de pruebasAeat.ts,
 * registradas por el mismo paso que la emisión. Devuelve solo recuentos.
 */
async function prepararPruebas(srv: ReturnType<typeof createClient>): Promise<Record<string, unknown>> {
  const c = leerCertPruebas();
  const uno = async <T>(q: PromiseLike<{ data: T | null; error: { message: string } | null }>, que: string): Promise<T | null> => {
    const { data, error } = await q;
    if (error) throw new Error(`${que}: ${error.message}`);
    return data;
  };
  let cuenta = await uno(srv.from("accounts").select("id").eq("slug", "v03-pruebas-aeat").maybeSingle(), "la cuenta de pruebas") as { id: string } | null;
  if (!cuenta) cuenta = await uno(srv.from("accounts").insert({ name: "Pruebas Verifactu (V03)", slug: "v03-pruebas-aeat", is_internal: true }).select("id").single(), "crear la cuenta de pruebas") as { id: string };
  let empresa = await uno(srv.from("company").select("id").eq("account_id", cuenta.id).eq("tax_id", c.nif).maybeSingle(), "la empresa de pruebas") as { id: string } | null;
  if (!empresa) empresa = await uno(srv.from("company").insert({ account_id: cuenta.id, tax_id: c.nif, legal_name: c.titular, trade_name: "Pruebas Verifactu (V03)" }).select("id").single(), "crear la empresa de pruebas") as { id: string };
  await uno(srv.from("verifactu_empresa").upsert({ company_id: empresa.id, account_id: cuenta.id, modo: "pruebas", pruebas_desde: new Date().toISOString(), updated_by_name: "Pruebas V03" }), "poner la empresa en pruebas");
  const ahora = new Date();
  const madrid = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(ahora);
  const prefijo = "PR" + madrid.replace(/\D/g, "").slice(2, 12);
  const { altas, anular } = casosPruebas({ account_id: cuenta.id, company_id: empresa.id, nif_emisor: c.nif, nombre_emisor: c.titular, prefijo, fecha: madrid.slice(0, 10) });
  const ids: string[] = [];
  for (const a of altas) {
    const r = await uno(srv.rpc("_verifactu_registrar", { p: a.p }), `registrar ${a.que}`) as { id: string };
    ids.push(r.id);
  }
  await uno(srv.rpc("_verifactu_anular", { p_alta: ids[anular], p_quien: "Pruebas V03" }), "registrar la anulación");
  return { preparadas: altas.length + 1, altas: altas.length, anulaciones: 1, prefijo };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "usa POST" }, 405);
  const p = puerta(Deno.env.get("CONTA_VERIFACTU"), SUPABASE_URL);
  // Quién puede despertarla: el cron (CRON_SECRET) o, solo en pruebas, el
  // workflow de las pruebas con su llave de un solo run (VERIFACTU_PRUEBAS_TOKEN).
  const cron = Deno.env.get("CRON_SECRET") ?? "", llave = Deno.env.get("VERIFACTU_PRUEBAS_TOKEN") ?? "";
  const porCron = !!cron && (req.headers.get("x-cron-secret") ?? "") === cron;
  const porPruebas = "entorno" in p && p.entorno === "pruebas" && !!llave && (req.headers.get("x-verifactu-pruebas") ?? "") === llave;
  if (!porCron && !porPruebas) return json({ error: "no autorizado" }, 401);
  if ("cerrada" in p) {
    console.log(`conta-verifactu · cerrada · ${p.cerrada}`);
    return json({ cerrada: p.cerrada });
  }
  const entorno = p.entorno;
  const srv = createClient(SUPABASE_URL, SERVICIO, { auth: { persistSession: false } });
  const accion = (await req.json().catch(() => ({})) as { accion?: string }).accion ?? "enviar";
  if (accion === "preparar_pruebas") {
    if (entorno !== "pruebas") return json({ error: "preparar_pruebas solo en pruebas" }, 400);
    try {
      const r = await prepararPruebas(srv);
      console.log(`conta-verifactu · pruebas · preparadas ${r.preparadas}`);
      return json(r);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      console.error(`conta-verifactu · pruebas · no se han podido preparar`);
      return json({ error: "preparar", mensaje: m.slice(0, 300) }, 500);
    }
  }
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await srv.rpc(fn, args);
    if (error) throw new Error(`${fn}: ${error.message}`);
    return data;
  };

  // En pruebas, el certificado de pruebas se lee antes: da el productor si no
  // está puesto. Si faltan sus secretos, cada envío lo dirá al pedir el material.
  if (entorno === "pruebas") { try { leerCertPruebas(); } catch { /* lo dice material() */ } }
  const sifNombre = Deno.env.get("VERIFACTU_SIF_NOMBRE") ?? (entorno === "pruebas" ? certPruebas?.titular ?? "" : "");
  const sifNif = Deno.env.get("VERIFACTU_SIF_NIF") ?? (entorno === "pruebas" ? certPruebas?.nif ?? "" : "");

  const piezas: Piezas = {
    tomar: async (e, max) => (await rpc("verifactu_cola_tomar", { p_entorno: e, p_max: max })) as Lote | null,
    responder: (id, x) => rpc("verifactu_cola_respuesta", { p_envio: id, p: x }),
    fallar: (id, err) => rpc("verifactu_cola_fallo", { p_envio: id, p_error: err }),
    material: async (lote) => {
      const sinProductor = () => new SinCertificado("Falta quién produce el sistema (nombre y NIF de la declaración responsable: VERIFACTU_SIF_NOMBRE y VERIFACTU_SIF_NIF). Se rellena antes de pasar a real.");
      if (entorno === "pruebas") {
        const m = materialPruebas(lote);
        if (!sifNombre || !sifNif) throw sinProductor();
        return m;
      }
      if (!sifNombre || !sifNif) throw sinProductor();
      // Real: el certificado de la empresa, solo si lo ha autorizado para
      // Verifactu (respuesta 2 de Julio, b). La base lo comprueba y apunta la
      // autorización en el envío; aquí no se decide nada.
      const { data, error } = await srv.rpc("verifactu_cert_abrir", { p_envio: lote.envio_id });
      if (error) throw new Error(`verifactu_cert_abrir: ${error.message}`);
      const r = data as { ok: boolean; mensaje?: string; material?: string };
      if (!r.ok || !r.material) throw new SinCertificado(r.mensaje ?? "No se puede usar el certificado de la empresa.");
      const m = JSON.parse(r.material) as MaterialCertificado;
      return { cert: m.cert, key: m.key };
    },
    llamar: async (url, xml, material) => {
      const r = await llamarConCertificado(material, url, {
        method: "POST", headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: '""' }, body: xml,
      }, { crearCliente: (m) => Deno.createHttpClient({ cert: m.cert, key: m.key }), pedir: (u, init) => fetch(u, init), limiteMs: 60_000 });
      return { status: r.status, cuerpo: r.cuerpo, ms: r.ms };
    },
    sistema: {
      // Respuesta 1 de Julio: código SU, nombre «Sumied».
      // Quién produce el sistema (la declaración responsable): un dato que se
      // rellena antes de pasar a real (respuesta 2 de Julio, c), sin nombres
      // aquí. En pruebas, si no está, el titular del certificado de pruebas.
      nombreRazon: sifNombre,
      nif: sifNif,
      nombre: "Sumied", id: "SU",
      version: Deno.env.get("VERIFACTU_SIF_VERSION") ?? "1.0.0",
      numeroInstalacion: entorno === "pruebas" ? "staging" : "produccion",
    },
    url: URL[entorno],
  };

  const r = await unaVuelta(piezas, entorno);

  // Lo que lleva más de una hora sin llegar a Hacienda: un aviso por empresa, con antirruido.
  const { data: atascados } = await srv.from("verifactu_atascados").select("account_id, company_id, entorno, registros").eq("entorno", entorno);
  for (const a of (atascados ?? []) as { account_id: string; company_id: string; registros: number }[]) {
    await encolarAlerta(srv, {
      kind: "verifactu_atascados", severity: entorno === "real" ? "alto" : "aviso", accountId: a.account_id,
      subject: `Verifactu: ${a.registros} registros llevan más de una hora sin llegar a Hacienda`,
      message: `Hay ${a.registros} registros de facturación (${entorno}) en la cola desde hace más de una hora. Mira el último envío de la empresa en Ventas › Facturas.`,
      debounceKind: `verifactu_atascados:${a.company_id}:${entorno}`, debounceWindow: "6 hours",
    });
  }

  console.log(`conta-verifactu · ${entorno} · envíos ${r.envios} · registros ${r.registros} · correctos ${r.correctos} · con errores ${r.con_errores} · incorrectos ${r.incorrectos} · vuelven ${r.vuelven} · fallos ${r.fallos.map((f) => f.motivo).join(",") || "0"} · atascados ${(atascados ?? []).length}`);
  return json({ entorno, ...r, atascados: (atascados ?? []).length });
});
