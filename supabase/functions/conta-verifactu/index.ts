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
//                      empresa a real). Con el certificado de cada empresa: el
//                      uso desatendido de ese certificado está PENDIENTE de la
//                      decisión de Julio (E1_paso2_envio.md): hasta entonces, lo
//                      de real vuelve a la cola diciendo por qué.
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

let certPruebas: { material: MaterialCertificado; nif: string } | null = null;
function materialPruebas(lote: Lote): MaterialCertificado {
  if (!certPruebas) {
    const b64 = Deno.env.get("AEAT_PRUEBAS_P12_B64"), clave = Deno.env.get("AEAT_PRUEBAS_P12_CLAVE");
    if (!b64 || !clave) throw new SinCertificado("Faltan los secretos del certificado de pruebas (AEAT_PRUEBAS_P12_B64 y AEAT_PRUEBAS_P12_CLAVE).");
    const leido = leerP12(forge, Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), clave);
    if (!leido.ficha.nif) throw new SinCertificado("El certificado de pruebas no dice de qué NIF es.");
    certPruebas = { material: leido.material, nif: leido.ficha.nif.replace(/^ES/i, "").toUpperCase() };
  }
  if (certPruebas.nif !== lote.nif_emisor) {
    throw new SinCertificado("El certificado de pruebas es de otro NIF que el de la empresa del envío: en pruebas, la empresa tiene que llevar el NIF del certificado.");
  }
  return certPruebas.material;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "usa POST" }, 405);
  const esperado = Deno.env.get("CRON_SECRET") ?? "";
  if (!esperado || (req.headers.get("x-cron-secret") ?? "") !== esperado) return json({ error: "no autorizado" }, 401);

  const p = puerta(Deno.env.get("CONTA_VERIFACTU"), SUPABASE_URL);
  if ("cerrada" in p) {
    console.log(`conta-verifactu · cerrada · ${p.cerrada}`);
    return json({ cerrada: p.cerrada });
  }
  const entorno = p.entorno;
  const srv = createClient(SUPABASE_URL, SERVICIO, { auth: { persistSession: false } });
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await srv.rpc(fn, args);
    if (error) throw new Error(`${fn}: ${error.message}`);
    return data;
  };

  const piezas: Piezas = {
    tomar: async (e, max) => (await rpc("verifactu_cola_tomar", { p_entorno: e, p_max: max })) as Lote | null,
    responder: (id, x) => rpc("verifactu_cola_respuesta", { p_envio: id, p: x }),
    fallar: (id, err) => rpc("verifactu_cola_fallo", { p_envio: id, p_error: err }),
    material: async (lote) => {
      if (entorno === "pruebas") return materialPruebas(lote);
      throw new SinCertificado("El envío en real con el certificado de la empresa está pendiente de la decisión de Julio (uso desatendido del certificado).");
    },
    llamar: async (url, xml, material) => {
      const r = await llamarConCertificado(material, url, {
        method: "POST", headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: '""' }, body: xml,
      }, { crearCliente: (m) => Deno.createHttpClient({ cert: m.cert, key: m.key }), pedir: (u, init) => fetch(u, init), limiteMs: 60_000 });
      return { status: r.status, cuerpo: r.cuerpo, ms: r.ms };
    },
    sistema: {
      // Respuesta 1 de Julio: código SU, nombre «Sumied». Quién lo produce (nombre
      // y NIF de la declaración responsable) lo dice el entorno; en pruebas, el
      // titular del certificado.
      nombreRazon: Deno.env.get("VERIFACTU_SIF_NOMBRE") ?? "Sumied",
      nif: Deno.env.get("VERIFACTU_SIF_NIF") ?? certPruebas?.nif ?? "",
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
