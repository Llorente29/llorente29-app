// supabase/staging/sondas/verifactu/index.ts  (Deno; fuera de supabase/functions a propósito: main no la despliega)
//
// V03 · E1 · Paso 1 · LA SONDA DE VERIFACTU, solo en staging-conta.
//
// Responde a la pregunta de riesgo del encargo: ¿una función de Supabase llega
// al entorno de PRUEBAS de la AEAT y le habla con certificado de cliente?
//
//   ?modo=fuentes   Sin certificado. Baja del entorno de pruebas el WSDL de
//                   SistemaFacturacion y la lista oficial de errores
//                   (errores.properties) y los devuelve tal cual, con su md5.
//   ?modo=conexion  Con el certificado de pruebas (los secretos
//                   AEAT_PRUEBAS_P12_B64 y AEAT_PRUEBAS_P12_CLAVE, que pone
//                   Julio). Hace UNA CONSULTA (ConsultaFactuSistemaFacturacion)
//                   de los registros de su NIF en el mes en curso. No da de alta
//                   nada: es solo de lectura.
//
// Lo que no puede hacer, y lo vigila el workflow antes de desplegarla:
//   · Producción: para si SUPABASE_URL es la de producción.
//   · Hablar con un dominio que no sea de PRUEBAS de la AEAT (prewww*.aeat.es).
//   · Escribir en el registro el certificado, la clave o la contraseña: solo
//     registra { sonda, modo, status, ms }.
//
// El workflow la copia a supabase/functions/verifactu-sonda/ dentro del runner,
// la llama y la borra. No vive en main.

import forge from "npm:node-forge@1.3.1";
import { leerP12, CertificadoNoVale } from "../_shared/certificados/leerP12.ts";
import { llamarConCertificado, LlamadaFallida } from "../_shared/certificados/mtls.ts";

const PRODUCCION_REF = "xzmpnchlguibclvxyynt";
const ESTATICOS = "https://prewww2.aeat.es/static_files/common/internet/dep/aplicaciones/es/aeat/tikeV1.0/cont/ws/";
const WSDL = ESTATICOS + "SistemaFacturacion.wsdl";
const ERRORES = ESTATICOS + "errores.properties";
/** Los esquemas que importa el WSDL: con ellos se escribe el alta y la anulación. */
const XSD = ["SuministroLR.xsd", "SuministroInformacion.xsd", "RespuestaSuministro.xsd", "ConsultaLR.xsd", "RespuestaConsultaLR.xsd"];
const SOLO_PRUEBAS = /^https:\/\/prewww\d*\.aeat\.es\//;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function md5ish(texto: string): Promise<string> {
  // SHA-256: crypto.subtle no tiene md5. Basta para comparar dos bajadas.
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function bajar(url: string) {
  if (!SOLO_PRUEBAS.test(url)) throw new Error("Solo dominios de pruebas de la AEAT.");
  const empieza = Date.now();
  const r = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  const bytes = new Uint8Array(await r.arrayBuffer());
  // errores.properties viene en ISO-8859-1 (es un .properties de Java).
  const latin = new TextDecoder("latin1").decode(bytes);
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const texto = utf8.includes("�") ? latin : utf8;
  return { url, status: r.status, ms: Date.now() - empieza, bytes: bytes.length, sha256: await md5ish(texto), texto };
}

/** Los puntos de acceso que declara el WSDL (soap:address). */
function puertos(wsdl: string): { nombre: string; url: string }[] {
  const out: { nombre: string; url: string }[] = [];
  const re = /<wsdl:port[^>]*name="([^"]+)"[\s\S]*?<soap\d*:address[^>]*location="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(wsdl))) out.push({ nombre: m[1], url: m[2] });
  return out;
}

function consulta(nif: string, nombre: string, ahora: Date): string {
  const ejercicio = String(ahora.getUTCFullYear());
  const periodo = String(ahora.getUTCMonth() + 1).padStart(2, "0");
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
 xmlns:con="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/ConsultaLR.xsd"
 xmlns:sum="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd">
 <soapenv:Header/>
 <soapenv:Body>
  <con:ConsultaFactuSistemaFacturacion>
   <con:Cabecera>
    <sum:IDVersion>1.0</sum:IDVersion>
    <sum:ObligadoEmision><sum:NombreRazon>${esc(nombre)}</sum:NombreRazon><sum:NIF>${esc(nif)}</sum:NIF></sum:ObligadoEmision>
   </con:Cabecera>
   <con:FiltroConsulta>
    <con:PeriodoImputacion><sum:Ejercicio>${ejercicio}</sum:Ejercicio><sum:Periodo>${periodo}</sum:Periodo></con:PeriodoImputacion>
   </con:FiltroConsulta>
  </con:ConsultaFactuSistemaFacturacion>
 </soapenv:Body>
</soapenv:Envelope>`;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const modo = url.searchParams.get("modo") ?? "";
  const token = Deno.env.get("VERIFACTU_SONDA_TOKEN");
  if (!token || req.headers.get("x-verifactu-sonda") !== token) return json({ ok: false, error: "token" }, 401);
  if ((Deno.env.get("SUPABASE_URL") ?? "").includes(PRODUCCION_REF)) return json({ ok: false, error: "produccion" }, 403);

  if (modo === "fuentes") {
    const salida: Record<string, unknown> = { ok: true, modo };
    for (const [clave, u] of [["wsdl", WSDL], ["errores", ERRORES]] as const) {
      try { salida[clave] = await bajar(u); } catch (e) { salida.ok = false; salida[clave] = { url: u, error: String((e as Error).message ?? e).slice(0, 300) }; }
    }
    const xsd: Record<string, unknown> = {};
    for (const n of XSD) {
      try { xsd[n] = await bajar(ESTATICOS + n); } catch (e) { salida.ok = false; xsd[n] = { url: ESTATICOS + n, error: String((e as Error).message ?? e).slice(0, 300) }; }
    }
    salida.xsd = xsd;
    const w = salida.wsdl as { texto?: string } | undefined;
    if (w?.texto) salida.puertos = puertos(w.texto);
    console.log(JSON.stringify({ sonda: "verifactu", modo, ok: salida.ok }));
    return json(salida);
  }

  if (modo === "conexion") {
    const b64 = Deno.env.get("AEAT_PRUEBAS_P12_B64");
    const clave = Deno.env.get("AEAT_PRUEBAS_P12_CLAVE");
    if (!b64 || !clave) return json({ ok: false, modo, error: "sin_certificado", mensaje: "Faltan los secretos AEAT_PRUEBAS_P12_B64 y AEAT_PRUEBAS_P12_CLAVE en staging." });
    let leido;
    try {
      const p12 = Uint8Array.from(atob(b64.replace(/\s+/g, "")), (c) => c.charCodeAt(0));
      leido = leerP12(forge, p12, clave);
    } catch (e) {
      const motivo = e instanceof CertificadoNoVale ? e.motivo : "ilegible";
      console.log(JSON.stringify({ sonda: "verifactu", modo, resultado: "certificado", motivo }));
      return json({ ok: false, modo, error: "certificado", motivo, mensaje: e instanceof CertificadoNoVale ? e.message : "No se ha podido abrir el certificado." });
    }
    const destino = url.searchParams.get("destino") ?? "";
    if (!SOLO_PRUEBAS.test(destino)) return json({ ok: false, modo, error: "destino", mensaje: "El destino tiene que ser de pruebas de la AEAT (prewww*.aeat.es)." }, 400);
    const nif = leido.ficha.nif ?? "";
    const cuerpo = consulta(nif, leido.ficha.titular ?? "Prueba", new Date());
    try {
      const r = await llamarConCertificado(leido.material, destino, {
        method: "POST",
        headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: "" },
        body: cuerpo,
      }, {
        crearCliente: (m) => Deno.createHttpClient({ cert: m.cert, key: m.key }),
        pedir: (u, init) => fetch(u, init as RequestInit),
        limiteMs: 30_000,
      });
      const enmascarado = nif ? r.cuerpo.split(nif).join("«NIF»") : r.cuerpo;
      console.log(JSON.stringify({ sonda: "verifactu", modo, status: r.status, ms: r.ms }));
      return json({
        ok: r.status < 500,
        modo,
        destino,
        status: r.status,
        tipo: r.tipo,
        ms: r.ms,
        certificado: { titular_nif_ultimos: nif.slice(-3), valido_hasta: leido.ficha.validoHasta, tipo: leido.ficha.tipo },
        respuesta: enmascarado.slice(0, 4000),
      });
    } catch (e) {
      const motivo = e instanceof LlamadaFallida ? e.motivo : "conexion";
      console.log(JSON.stringify({ sonda: "verifactu", modo, resultado: "fallo", motivo }));
      return json({ ok: false, modo, destino, error: motivo, mensaje: e instanceof Error ? e.message.slice(0, 300) : "fallo" });
    }
  }

  return json({ ok: false, error: "modo", mensaje: "modo=fuentes o modo=conexion" }, 400);
});
