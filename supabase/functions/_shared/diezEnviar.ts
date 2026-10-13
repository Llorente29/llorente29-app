// supabase/functions/_shared/diezEnviar.ts
//
// C04b · R15 · ENVIAR A DIEZ UN ASIENTO DE VENTAS VALIDADO, con su documento.
// Núcleo sin red ni base propias: todo lo de fuera entra por el puerto (la
// edge function conta-diez-enviar pone Supabase y el cliente de Diez; las
// pruebas, dobles). Así los frenos se prueban de verdad, uno a uno.
//
// Lo que pidió Julio (R13–R15) y cómo se cumple aquí, en este orden:
//   1. Solo un asiento VALIDADO de ventas de una plataforma, con su factura
//      medida en Diez (hoy, Uber). Lo demás no se envía y se dice por qué.
//   2. «Sin documento no se envía» (R14): sin su PDF guardado en Folvy, no se
//      habla con Diez. Y el PDF que va es el GUARDADO: su huella tiene que ser
//      la registrada.
//   3. «C0001 vetada» y «No escribas nada en C0008» (R15): con la conexión en
//      C0001 o en C0008 se para ANTES de abrir la conexión. escribirEnReal no
//      se pasa nunca desde aquí: aunque esta línea se quitara, el cliente de
//      Diez seguiría negándose a escribir en C0008.
//   4. «Diez todavía no guarda documentos»: antes de dar de alta nada, se mira
//      si Diez sabe devolver el documento de una factura que ya tiene. Si
//      contesta que no existe el contenedor de documentos (R14, Cegid), no se
//      envía: una factura sin su PDF no se deja a medias en Diez.
//   5. «Nunca dos veces»: se busca antes por serie, número de factura y la
//      430. Una → se enlaza, no se envía. Más de una → no se toca nada.
//      La intención de escribir se apunta ANTES de escribir: si algo se corta
//      a medias, el siguiente intento la encuentra en Diez y la enlaza.
//   6. El documento se sube y se lee de vuelta: «adjunto» solo si Diez
//      devuelve el mismo PDF (la misma huella). Si no, la factura queda en
//      «No ha llegado a Diez: falta el documento», con Reintentar (que solo
//      sube el documento: la factura ya está).
//   7. Como mucho 3 intentos que escriben en Diez (regla 5 del encargo).

import { BASE_REAL, BASES_PROHIBIDAS, MAX_INTENTOS, type Factura, type FacturaData } from './diezCliente.ts'
import type { Correspondencia } from './diezAnalitica.ts'
import { facturaDeVentas } from './diezFactura.ts'
import { resumenDeAsiento, type ResumenBD } from './resumenDeAsiento.ts'

/** Una fila de public.external_send (lo que este núcleo lee y escribe). */
export type EnvioFila = {
  id?: string
  entry_id: string
  account_id: string
  company_id: string
  account_connector_id: string | null
  kind: 'factura'
  ext_year: string | null
  ext_series: string | null
  ext_number: number | null
  ext_invoice_number: string | null
  payload_hash: string
  status: 'pendiente' | 'enviado' | 'enlazado' | 'rechazado'
  attempts: number
  last_error: string | null
  sent_at: string | null
  document_id: string | null
  document_status: 'pendiente' | 'adjunto' | 'fallo' | null
  document_error: string | null
  document_attached_at: string | null
}

export type ConexionDiez = { id: string; nombreBd: string }

/** Lo que el núcleo usa del cliente de Diez (ClienteDiez lo cumple). */
export interface ClienteDiezEnvio {
  facturasDelMes(aaaamm: string): Promise<Factura[]>
  enviarFactura(fd: FacturaData): Promise<Factura>
  adjuntarDocumentoFactura(d: { Ejercicio: string; Serie: string; Documento: number; NombreArchivo: string; Archivo: string }): Promise<{ status: number; json: unknown }>
  documentoDeFactura(ejercicio: string, serie: string, documento: number): Promise<{ status: number; json: unknown }>
}

export interface PuertoEnvio {
  /** conta_resumen_ventas, leído con los permisos de quien pide el envío. */
  resumen(entryId: string): Promise<ResumenBD>
  /** El envío que ya hay de ese asiento (el no rechazado), o null. */
  envio(entryId: string): Promise<EnvioFila | null>
  /** Guarda el envío (inserta si no tiene id; si lo tiene, lo actualiza). Devuelve la fila. */
  guardar(f: EnvioFila): Promise<EnvioFila>
  /** La conexión con Diez de la empresa (conectada), o null. */
  conexion(companyId: string): Promise<ConexionDiez | null>
  /** El cliente de Diez de esa conexión (escribir: sí; escribirEnReal: nunca). */
  cliente(c: ConexionDiez): Promise<ClienteDiezEnvio>
  /** Los bytes del PDF guardado en el bucket. */
  documento(ruta: string): Promise<Uint8Array>
  sha256(b: Uint8Array): Promise<string>
  correspondencia(companyId: string): Correspondencia | null
  ahora(): Date
}

export type ResultadoEnvio =
  | { estado: 'en_diez'; serie: string; documento: number; enlazada: boolean; texto: string }
  | { estado: 'no_llega'; motivo: string; reintentar: boolean; texto: string }

const iso = (d: Date) => d.toISOString()
const hoyMadrid = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(d)
const base64 = (b: Uint8Array) => {
  let s = ''
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
  return btoa(s)
}
const deBase64 = (s: string) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0))
const corto = (x: unknown) => (x == null ? 'sin respuesta' : (typeof x === 'string' ? x : JSON.stringify(x)).replace(/\s+/g, ' ').slice(0, 240))
/** Diez (R14): «The specified container does not exist.» = no guarda documentos. */
export const sinContenedor = (r: { status: number; json: unknown }) => r.status >= 500 && /container does not exist/i.test(corto(r.json))

export const TEXTO_CONTENEDOR = 'Diez todavía no guarda documentos (falta que Cegid active su almacén): no se envía la factura sin su PDF'

function noLlega(motivo: string, reintentar = true): ResultadoEnvio {
  return { estado: 'no_llega', motivo, reintentar, texto: `No ha llegado a Diez: ${motivo}.` }
}

export async function enviarAsientoADiez(entryId: string, p: PuertoEnvio): Promise<ResultadoEnvio> {
  const r = await p.resumen(entryId)
  if (r.estado !== 'validado') return noLlega(`el asiento está ${r.estado}: solo se envía lo validado`, false)

  let previo = await p.envio(entryId)
  if (previo && (previo.status === 'enviado' || previo.status === 'enlazado') && previo.document_status === 'adjunto') {
    return { estado: 'en_diez', serie: String(previo.ext_series), documento: Number(previo.ext_number), enlazada: previo.status === 'enlazado', texto: `Ya estaba en Diez: ${previo.ext_series}/${previo.ext_number}, con su documento.` }
  }

  // Lo que se apunta cuando no llega, sin haber escrito en Diez (no cuenta como intento).
  const apuntar = async (motivo: string, extra: Partial<EnvioFila> = {}, reintentar = true): Promise<ResultadoEnvio> => {
    previo = await p.guardar({
      ...(previo ?? {
        entry_id: r.id, account_id: r.account_id, company_id: r.company_id, account_connector_id: null, kind: 'factura',
        ext_year: null, ext_series: null, ext_number: null, ext_invoice_number: null, payload_hash: 'sin-enviar', status: 'pendiente', attempts: 0,
        sent_at: null, document_id: null, document_status: null, document_error: null, document_attached_at: null,
      }),
      last_error: motivo, ...extra,
    } as EnvioFila)
    return noLlega(motivo, reintentar)
  }

  // 2 · Sin documento no se envía.
  if (!r.documento) return apuntar('falta el documento', { document_status: 'pendiente', document_error: 'Folvy aún no ha guardado el PDF de este asiento' })

  // 1 · La factura (con su patrón medido).
  const corr = p.correspondencia(r.company_id)
  const listo = resumenDeAsiento(r, { correspondencia: corr, generado: p.ahora(), hoy: hoyMadrid(p.ahora()) })
  if (!listo.factura) return apuntar(listo.sinFactura ?? 'esta factura no se sabe mandar', {}, false)

  // 3 · La conexión: ni C0001 ni C0008.
  const con = await p.conexion(r.company_id)
  if (!con) return apuntar('la conexión con Diez no está configurada para esta empresa')
  const bd = con.nombreBd.trim().toUpperCase()
  if ((BASES_PROHIBIDAS as readonly string[]).includes(bd)) return apuntar(`la base ${bd} de Diez no se toca nunca`, { account_connector_id: con.id }, false)
  if (bd === BASE_REAL) return apuntar(`Diez real (${BASE_REAL}) está cerrado: no se escribe nada hasta que Julio lo autorice`, { account_connector_id: con.id })
  if (previo && previo.attempts >= MAX_INTENTOS) return noLlega(`ya van ${previo.attempts} intentos: lo tiene que mirar una persona`, false)

  // El PDF que va es el guardado, y es el registrado.
  const pdf = await p.documento(r.documento.ruta)
  if ((await p.sha256(pdf)) !== r.documento.sha256) return apuntar('el documento guardado no es el que se registró (otra huella): no se envía', { document_status: 'fallo', document_error: 'otra huella' }, false)

  const diez = await p.cliente(con)
  const ej = r.fecha.slice(0, 4)
  const fd0 = listo.factura.factura
  const delMes = await diez.facturasDelMes(String(fd0.FechaFactura).slice(0, 6))

  // 4 · ¿Guarda Diez documentos? Se pregunta por una factura que ya tiene.
  const muestra = delMes.find((f) => f.Documento != null)
  if (muestra && !(previo && (previo.status === 'enviado' || previo.status === 'enlazado'))) {
    const g = await diez.documentoDeFactura(String(muestra.Ejercicio ?? ej), String(muestra.Serie), Number(muestra.Documento))
    if (sinContenedor(g)) return apuntar(TEXTO_CONTENEDOR, { account_connector_id: con.id })
  }

  // 5 · Nunca dos veces.
  let serie = String(previo?.ext_series ?? '')
  let documento = Number(previo?.ext_number ?? 0)
  let enlazada = previo?.status === 'enlazado'
  if (!(previo && (previo.status === 'enviado' || previo.status === 'enlazado'))) {
    const ya = [...new Map(delMes.filter((f) => String(f.Serie) === fd0.Serie && String(f.NumeroFactura) === fd0.NumeroFactura && String(f.CuentaCliente) === fd0.CuentaCliente)
      .map((f) => [String(f.Documento), f])).values()]
    if (ya.length > 1) return apuntar(`hay ${ya.length} facturas ${fd0.NumeroFactura} en Diez: no se toca nada`, { account_connector_id: con.id }, false)
    const nombres = [...new Set(delMes.filter((f) => String(f.CuentaCliente) === fd0.CuentaCliente).map((f) => String(f.NombreCliente ?? '')).filter(Boolean))]
    if (ya.length === 0 && nombres.length !== 1) return apuntar(`el nombre del cliente de la ${fd0.CuentaCliente} no es uno solo en Diez (${nombres.length}): no se inventa`, { account_connector_id: con.id }, false)
    const fd = facturaDeVentas({ fecha: r.fecha, local: r.local!.nombre, canal: r.canal!.slug, lineas: r.lineas.map((l) => ({ cuenta: l.cuenta, debe: Number(l.debe), haber: Number(l.haber), marca: l.marca, tipoIva: l.tipoIva })) },
      { correspondencia: corr!, nombreCliente: nombres[0] ?? '—', hoy: hoyMadrid(p.ahora()), conAnalitica: true }).factura
    const hash = await p.sha256(new TextEncoder().encode(JSON.stringify(fd)))
    const comun = { entry_id: r.id, account_id: r.account_id, company_id: r.company_id, account_connector_id: con.id, kind: 'factura' as const, ext_invoice_number: String(fd.NumeroFactura), payload_hash: hash, document_id: r.documento.id }
    if (ya.length === 1) {
      documento = Number(ya[0].Documento); serie = String(ya[0].Serie); enlazada = true
      previo = await p.guardar({ ...(previo ?? {} as EnvioFila), ...comun, status: 'enlazado', ext_year: ej, ext_series: serie, ext_number: documento, attempts: previo?.attempts ?? 0, last_error: null, sent_at: iso(p.ahora()), document_status: 'pendiente', document_error: null, document_attached_at: null })
    } else {
      // La intención, antes de escribir: cuenta como intento.
      previo = await p.guardar({ ...(previo ?? {} as EnvioFila), ...comun, status: 'pendiente', ext_year: null, ext_series: null, ext_number: null, attempts: (previo?.attempts ?? 0) + 1, last_error: 'enviando', sent_at: null, document_status: 'pendiente', document_error: null, document_attached_at: null })
      let creada: Factura
      try { creada = await diez.enviarFactura(fd) } catch (x) {
        return apuntar(`Diez no ha aceptado la factura: ${x instanceof Error ? x.message : String(x)}`)
      }
      documento = Number(creada.Documento); serie = String(creada.Serie ?? fd.Serie)
      previo = await p.guardar({ ...previo, status: 'enviado', ext_year: ej, ext_series: serie, ext_number: documento, last_error: null, sent_at: iso(p.ahora()) })
    }
  }

  // 6 · El documento: se sube y se lee de vuelta.
  previo = await p.guardar({ ...previo!, attempts: previo!.attempts + (previo!.document_status === 'fallo' ? 1 : 0) })
  const sub = await diez.adjuntarDocumentoFactura({ Ejercicio: ej, Serie: serie, Documento: documento, NombreArchivo: r.documento.nombre, Archivo: base64(pdf) })
  let fallo: string | null = null
  if (sub.status !== 200) fallo = sinContenedor(sub) ? TEXTO_CONTENEDOR : `Diez no ha guardado el documento (${sub.status}: ${corto(sub.json)})`
  else {
    const v = await diez.documentoDeFactura(ej, serie, documento)
    const vuelta = v.status === 200 && typeof v.json === 'string' && v.json.length > 100 ? deBase64(v.json) : null
    if (!vuelta) fallo = `Diez no devuelve el documento después de subirlo (${v.status})`
    else if ((await p.sha256(vuelta)) !== r.documento.sha256) fallo = 'Diez devuelve otro documento (otra huella)'
  }
  if (fallo) {
    previo = await p.guardar({ ...previo!, document_status: 'fallo', document_error: fallo, last_error: 'falta el documento' })
    return noLlega('falta el documento', true)
  }
  previo = await p.guardar({ ...previo!, document_status: 'adjunto', document_error: null, document_attached_at: iso(p.ahora()), last_error: null })
  return { estado: 'en_diez', serie, documento, enlazada, texto: `En Diez: ${serie}/${documento}${enlazada ? ' (ya estaba: enlazada, no se ha enviado otra)' : ''}, con su documento.` }
}
