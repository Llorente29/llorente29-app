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
import { facturaRecibida, type FacturaRecibida } from './diezRecibida.ts'
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

/** Lo que todo envío necesita del asiento, sea de ventas o de una factura recibida. */
type Base = { id: string; account_id: string; company_id: string; estado: string; fecha: string; documento: { id: string; ruta: string; nombre: string; sha256: string } | null }
/**
 * Cómo se hace la factura de Diez de un asiento:
 *   · preparar(): sin hablar con Diez, la serie, el número y la cuenta (para
 *     no enviarla dos veces) y el mes donde buscarla; o por qué no se sabe;
 *   · construir(delMes): la factura que se manda, con lo que haga falta de
 *     Diez (el nombre del cliente de la 430, en ventas); o por qué no.
 */
type Plan = {
  preparar(): { serie: string; numero: string; cuenta: string; mes: string } | { motivo: string; reintentar: boolean }
  construir(delMes: Factura[]): { fd: FacturaData } | { motivo: string; reintentar: boolean }
}

export async function enviarAsientoADiez(entryId: string, p: PuertoEnvio): Promise<ResultadoEnvio> {
  const r = await p.resumen(entryId)
  const corr = p.correspondencia(r.company_id)
  const plan: Plan = {
    preparar: () => {
      const listo = resumenDeAsiento(r, { correspondencia: corr, generado: p.ahora(), hoy: hoyMadrid(p.ahora()) })
      if (!listo.factura) return { motivo: listo.sinFactura ?? 'esta factura no se sabe mandar', reintentar: false }
      const f = listo.factura.factura
      return { serie: f.Serie, numero: String(f.NumeroFactura), cuenta: f.CuentaCliente, mes: String(f.FechaFactura).slice(0, 6) }
    },
    construir: (delMes) => {
      const f0 = (plan.preparar() as { serie: string; numero: string; cuenta: string })
      const nombres = [...new Set(delMes.filter((f) => String(f.CuentaCliente) === f0.cuenta).map((f) => String(f.NombreCliente ?? '')).filter(Boolean))]
      const ya = delMes.some((f) => String(f.Serie) === f0.serie && String(f.NumeroFactura) === f0.numero && String(f.CuentaCliente) === f0.cuenta)
      if (!ya && nombres.length !== 1) return { motivo: `el nombre del cliente de la ${f0.cuenta} no es uno solo en Diez (${nombres.length}): no se inventa`, reintentar: false }
      return { fd: facturaDeVentas({ fecha: r.fecha, local: r.local!.nombre, canal: r.canal!.slug, lineas: r.lineas.map((l) => ({ cuenta: l.cuenta, debe: Number(l.debe), haber: Number(l.haber), marca: l.marca, tipoIva: l.tipoIva })) },
        { correspondencia: corr!, nombreCliente: nombres[0] ?? '—', hoy: hoyMadrid(p.ahora()), conAnalitica: true }).factura }
    },
  }
  return enviar(r, plan, p)
}

/**
 * D01 · Tarea 5 · Una FACTURA RECIBIDA validada, a la serie 2 de Diez, con su
 * PDF. Los mismos frenos que las ventas, en el mismo orden (enviar(), abajo):
 * solo lo validado, sin documento no se envía, ni C0001 ni C0008, «Diez no
 * guarda documentos todavía», nunca dos veces y el documento leído de vuelta.
 * La factura, la de _shared/diezRecibida.ts (medida en la C0009); lo que no se
 * ha medido (retención, recargo, abonos) no se manda y dice por qué.
 */
export async function enviarRecibidaADiez(entryId: string, p: PuertoEnvio & { recibida(entryId: string): Promise<RecibidaBD> }): Promise<ResultadoEnvio> {
  const r = await p.recibida(entryId)
  let hecha: FacturaRecibida | null = null
  let porque: string | null = null
  try {
    hecha = facturaRecibida({ fecha: r.fecha, fechaFactura: r.factura.fecha, numero: r.factura.numero ?? '', proveedor: r.proveedor, lineas: r.lineas }, { hoy: hoyMadrid(p.ahora()) })
  } catch (x) { porque = x instanceof Error ? x.message : String(x) }
  const plan: Plan = {
    preparar: () => hecha
      ? { serie: '2', numero: String(hecha.factura.NumeroFactura), cuenta: hecha.factura.CuentaCliente, mes: String(hecha.factura.FechaFactura).slice(0, 6) }
      : { motivo: porque ?? 'esta factura no se sabe mandar', reintentar: false },
    construir: () => (hecha ? { fd: hecha.factura } : { motivo: porque ?? 'esta factura no se sabe mandar', reintentar: false }),
  }
  return enviar(r, plan, p)
}

/** Lo que conta_recibida_envio devuelve de un asiento de factura recibida. */
export type RecibidaBD = Base & {
  factura: { numero: string | null; fecha: string }
  proveedor: { nombre: string; nif: string | null }
  lineas: { cuenta: string; debe: number; haber: number; tipoIva: number | null; baseIva: number | null }[]
}

async function enviar(r: Base, plan: Plan, p: PuertoEnvio): Promise<ResultadoEnvio> {
  if (r.estado !== 'validado') return noLlega(`el asiento está ${r.estado}: solo se envía lo validado`, false)

  let previo = await p.envio(r.id)
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
  const plano = plan.preparar()
  if ('motivo' in plano) return apuntar(plano.motivo, {}, plano.reintentar)

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
  const delMes = await diez.facturasDelMes(plano.mes)

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
    const ya = [...new Map(delMes.filter((f) => String(f.Serie) === plano.serie && String(f.NumeroFactura) === plano.numero && String(f.CuentaCliente) === plano.cuenta)
      .map((f) => [String(f.Documento), f])).values()]
    if (ya.length > 1) return apuntar(`hay ${ya.length} facturas ${plano.numero} en Diez: no se toca nada`, { account_connector_id: con.id }, false)
    const hecha = plan.construir(delMes)
    if ('motivo' in hecha) return apuntar(hecha.motivo, { account_connector_id: con.id }, hecha.reintentar)
    const fd = hecha.fd
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
