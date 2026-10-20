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
//      C06b R7 (Julio, captura de C0008): el cliente se busca POR SU CUENTA (la
//      subcuenta 430 de la plataforma, «Datos cliente» en Diez), no por NIF ni
//      por nombre comercial: su nombre es la Descripcion de esa subcuenta. Son
//      tickets (facturas simplificadas): el NIF va vacío y no se pide.
//      La intención de escribir se apunta ANTES de escribir: si algo se corta
//      a medias, el siguiente intento la encuentra en Diez y la enlaza.
//   6. El documento se sube y se lee de vuelta: «adjunto» solo si Diez
//      devuelve el mismo PDF (la misma huella). Si no, la factura queda en
//      «No ha llegado a Diez: falta el documento», con Reintentar (que solo
//      sube el documento: la factura ya está).
//   7. Como mucho 3 intentos que escriben en Diez (regla 5 del encargo).
//
// C06b · Respuesta 7 (decisión de Julio, 14/10): a Diez sin esperar a Cegid.
//   · El 2 no cambia: sin el PDF guardado en Folvy no se envía.
//   · El 4 y el 6 solo si la conexión dice que Diez guarda documentos
//     (account_connector.config.adjuntar_documentos = true; hoy, apagado). Si
//     no, la factura va SIN adjunto y queda «PDF pendiente en Diez»
//     (pendiente_diez): la adjunta una persona en Diez y la marca en Folvy, o
//     Folvy sola el día que Cegid active el almacén (el mismo envío, que con
//     la factura ya en Diez solo sube el documento).
//   · El 3 se abre SOLO con lo que Julio autoriza en la base
//     (conta_diez_autorizo: un asiento, o la empresa en esa base). Sin
//     autorización, Diez real sigue cerrado; C0001, nunca.
//   · R8 (tarea 1): la de la empresa puede llevar «desde»: solo vale para los
//     asientos con fecha desde ese día (autorizacionCubre). El contraasiento,
//     con la fecha de lo que anula.

import { BASE_PRUEBAS, BASES_PROHIBIDAS, ErrorDiez, MAX_INTENTOS, type Factura, type FacturaData } from './diezCliente.ts'
import type { Correspondencia } from './diezAnalitica.ts'
import { esDeLaGestoria, facturaDeVentas, facturaQueAnula, PATRONES } from './diezFactura.ts'
import { facturaRecibida, facturaRecibidaQueAnula, type FacturaRecibida } from './diezRecibida.ts'
import { claveNumero } from './lecturaFactura.ts'
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
  document_status: 'pendiente' | 'adjunto' | 'fallo' | 'pendiente_diez' | null
  document_error: string | null
  document_attached_at: string | null
  document_attached_via?: 'diez' | 'a_mano' | null
}

/** adjuntar: ¿guarda Diez documentos? (config.adjuntar_documentos; hoy, no). */
export type ConexionDiez = { id: string; nombreBd: string; adjuntar?: boolean }

/** Lo que el núcleo usa del cliente de Diez (ClienteDiez lo cumple). */
export interface ClienteDiezEnvio {
  facturasDelMes(aaaamm: string): Promise<Factura[]>
  enviarFactura(fd: FacturaData): Promise<Factura>
  adjuntarDocumentoFactura(d: { Ejercicio: string; Serie: string; Documento: number; NombreArchivo: string; Archivo: string }): Promise<{ status: number; json: unknown }>
  documentoDeFactura(ejercicio: string, serie: string, documento: number): Promise<{ status: number; json: unknown }>
  /** La subcuenta por su código (el cliente: su nombre es Descripcion), o null si Diez no la tiene. */
  subcuenta(codigo: string): Promise<Record<string, unknown> | null>
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
  /**
   * ¿Ha autorizado Julio escribir este asiento en esta base real?
   * (conta_diez_autorizo; `fecha`, AAAA-MM-DD, la del asiento: una
   * autorización de empresa con «desde» solo vale desde ese día.)
   */
  autorizado(entryId: string, companyId: string, nombreBd: string, fecha: string, tipo: TipoEnvio): Promise<boolean>
  /** El cliente de Diez de esa conexión (escribir: sí; escribirEnReal: solo con autorización). */
  cliente(c: ConexionDiez, o: { real: boolean }): Promise<ClienteDiezEnvio>
  /** Los bytes del PDF guardado en el bucket. */
  documento(ruta: string): Promise<Uint8Array>
  sha256(b: Uint8Array): Promise<string>
  correspondencia(companyId: string): Correspondencia | null
  ahora(): Date
}

export type ResultadoEnvio =
  | { estado: 'en_diez'; serie: string; documento: number; enlazada: boolean; pdfPendiente: boolean; texto: string }
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

export const PDF_PENDIENTE = 'PDF pendiente en Diez'
/** Una fila de public.conta_diez_autorizo (lo que se mira de ella). */
export type Autorizacion = { alcance: string; entry_id: string | null; desde: string | null; incluye_recibidas?: boolean | null }

/** Qué se escribe en Diez: la factura de ventas (serie 1) o una recibida (serie 2). */
export type TipoEnvio = 'ventas' | 'recibidas'

/**
 * C06b R8 · tarea 1: ¿cubre alguna de estas autorizaciones (de la empresa, en
 * esa base) a este asiento? La de un asiento, por su id; la de la empresa,
 * desde su «desde» (inclusive) o, sin él, siempre. `fecha`: AAAA-MM-DD.
 *
 * Y las RECIBIDAS (Julio, 14/10), solo con `incluye_recibidas` (0740; por
 * defecto, no). Se cerraron porque duplicaban en Diez (A lo midió: buscaba en
 * el mes de la factura y Diez filtra por la fecha del asiento; el número sin
 * normalizar; el proveedor solo por su cuenta). A lo arregló en la #190
 * (esLaMismaRecibida, mesesEntre), pero abrirlas lo decide Julio: hasta que
 * una fila lleve incluye_recibidas, una autorización no abre las recibidas,
 * sea de empresa o de un asiento.
 */
export function autorizacionCubre(xs: readonly Autorizacion[], entryId: string, fecha: string, tipo: TipoEnvio = 'ventas'): boolean {
  return xs.some((a) => (tipo === 'ventas' || a.incluye_recibidas === true)
    && ((a.alcance === 'asiento' && a.entry_id === entryId)
      || (a.alcance === 'empresa' && (a.desde == null || fecha.slice(0, 10) >= String(a.desde).slice(0, 10)))))
}

/** El texto de Diez real cerrado, para cada tipo. */
export const cerradoEn = (bd: string, tipo: TipoEnvio) => tipo === 'recibidas'
  ? `Diez real está cerrado para facturas recibidas (${bd}): no se escribe nada hasta que Julio las autorice`
  : `Diez real (${bd}) está cerrado: no se escribe nada hasta que Julio lo autorice`

const yaEnviado = (e: EnvioFila | null) => !!e && (e.status === 'enviado' || e.status === 'enlazado')

/**
 * 15/10 · Lo que dice un envío que empezó y no terminó. El 1806 y el 1807 se
 * validaron, la función leyó el asiento, el PDF y las credenciales de Diez, y
 * se cortó sin contestar y sin haber escrito nada: ni en Diez ni en Folvy. Un
 * validado nunca puede quedar sin su envío o su motivo, así que la fila se deja
 * ANTES de la primera llamada a Diez, con esto; lo de después la sobrescribe.
 */
export const EN_MARCHA = 'el envío empezó y no terminó: se cortó antes de escribir en Diez (allí no se ha escrito nada). Pulsa «Reintentar»'

/**
 * 17/10 · Lo que contestó Diez, en corto, para el motivo: su mensaje
 * (Message, ExceptionMessage, error_description…) o el cuerpo tal cual, sin
 * saltos de línea y con 300 caracteres como mucho. Solo va a la base
 * (external_send.last_error) y a la pantalla, nunca a un registro público.
 */
export function loQueDijoDiez(cuerpo: unknown): string {
  if (cuerpo == null || cuerpo === '') return 'sin cuerpo'
  const o = typeof cuerpo === 'object' && !Array.isArray(cuerpo) ? cuerpo as Record<string, unknown> : null
  const partes = o
    ? ['Message', 'ExceptionMessage', 'error_description', 'error', 'Mensaje', 'ModelState'].map((k) => o[k]).filter((v) => v != null && v !== '')
    : []
  const t = partes.length ? partes.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join(' · ') : (typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo))
  return t.replace(/\s+/g, ' ').trim().slice(0, 300) || 'sin cuerpo'
}

/** 17/10 · ¿Se cortó la espera (Diez no contestó a tiempo o se cayó la red)? Entonces no se sabe si escribió. */
const sinRespuesta = (x: unknown) => x instanceof Error && (x.name === 'TimeoutError' || x.name === 'AbortError' || x.name === 'TypeError')

/**
 * 17/10 · El motivo de un fallo, con todo lo que se sabe: lo que dijo Diez si
 * contestó (su código y su mensaje), o que no contestó. El 1860 se quedó sin
 * esto: ErrorDiez solo traía «facturas/add → código» y el cuerpo se perdía.
 */
export function motivoDeFallo(x: unknown): string {
  if (x instanceof ErrorDiez) return `${x.message} (${loQueDijoDiez(x.cuerpo)})`
  if (sinRespuesta(x)) return `Diez no ha contestado (${(x as Error).name}: ${(x as Error).message})`
  return x instanceof Error ? x.message : String(x)
}

/**
 * 17/10 · El motivo cuando falla la escritura en Diez. Si Diez contestó, no la
 * ha aceptado y dice por qué. Si no contestó, no se sabe si la ha escrito: el
 * siguiente intento la busca antes de escribir (nunca dos veces).
 */
export function alEscribir(que: string, x: unknown): string {
  return sinRespuesta(x)
    ? `${motivoDeFallo(x)} al escribir ${que}: puede que la tenga; al reintentar se busca antes y no se escribe otra`
    : `Diez no ha aceptado ${que}: ${motivoDeFallo(x)}`
}

/**
 * 17/10 · La red de todo envío: si algo se rompe por el camino (Diez contesta
 * un error al leer, no contesta, o falla la base), el envío NUNCA se queda en
 * «empezó y no terminó» ni con el motivo de antes: se escribe lo que ha pasado
 * y se contesta en palabras. El 1861 se cortó así (500 a los 6 s) y su fila se
 * quedó con «empezó y no terminó», sin su porqué.
 */
async function conRed(entryId: string, p: PuertoEnvio, f: () => Promise<ResultadoEnvio>): Promise<ResultadoEnvio> {
  try { return await f() } catch (x) {
    let motivo = `se cortó: ${motivoDeFallo(x)}`
    const e = await p.envio(entryId).catch(() => null)
    if (e && !yaEnviado(e)) {
      // Cortado escribiendo («enviando»): no se sabe si Diez la tiene; el siguiente intento la busca antes.
      if (e.last_error === 'enviando') motivo += '. Se cortó escribiendo en Diez: al reintentar se busca antes y no se escribe otra'
      // Lo que dijo el intento de antes (dejarRastro lo guardó), tampoco se pierde.
      const antes = e.last_error?.split(`${EN_MARCHA}. El intento anterior: `)[1]
      if (antes) motivo += `. El intento anterior: ${antes}`
      try { await p.guardar({ ...e, last_error: motivo }) } catch (y) { motivo += ` (y no se ha podido apuntar: ${motivoDeFallo(y)})` }
    }
    return noLlega(motivo)
  }
}

/** La fila del envío antes de hablar con Diez (ver EN_MARCHA). No toca lo enviado ni un «enviando» a medias. */
async function dejarRastro(previo: EnvioFila | null, a: { id: string; account_id: string; company_id: string }, conexion: string, p: PuertoEnvio): Promise<EnvioFila> {
  if (previo && (yaEnviado(previo) || previo.last_error === 'enviando')) return previo
  // 17/10: el motivo del intento de antes no se borra (el 1860 perdió el suyo así).
  const antes = previo?.last_error && !previo.last_error.startsWith(EN_MARCHA) ? previo.last_error : null
  return p.guardar({
    ...(previo ?? {
      entry_id: a.id, account_id: a.account_id, company_id: a.company_id, kind: 'factura',
      ext_year: null, ext_series: null, ext_number: null, ext_invoice_number: null, payload_hash: 'sin-enviar', status: 'pendiente', attempts: 0,
      sent_at: null, document_id: null, document_status: null, document_error: null, document_attached_at: null,
    }),
    account_connector_id: conexion, last_error: antes ? `${EN_MARCHA}. El intento anterior: ${antes}` : EN_MARCHA,
  } as EnvioFila)
}

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
  /** Ventas o recibidas: lo que Julio autoriza va por separado (R8, tarea 1). */
  tipo: TipoEnvio
  preparar(): { serie: string; numero: string; cuenta: string; mes: string } | { motivo: string; reintentar: boolean }
  construir(c: { delMes: Factura[]; ya: Factura[]; diez: ClienteDiezEnvio }): Promise<{ fd: FacturaData } | { motivo: string; reintentar: boolean }>
  /**
   * D01 · Dónde buscarla antes de escribir (los meses AAAAMM del listado de
   * Diez, que filtra por la fecha del ASIENTO) y qué es «la misma». Sin ellos,
   * como siempre: el mes de la factura y serie, número y cuenta exactos.
   */
  buscar?(): { meses: string[]; esLaMisma(f: Factura): boolean } | { motivo: string; reintentar: boolean }
  /**
   * 15/10 · Facturas que la gestoría metió con SU forma para lo mismo (Glovo,
   * por tienda): si hay alguna, la de Folvy las duplicaría. No se escribe ni se
   * enlaza (no son la misma factura) y se dice.
   */
  ajena?(f: Factura): boolean
}

/** Los meses AAAAMM de `desde` (AAAAMM) a `hasta` (AAAAMM), los dos incluidos. */
export function mesesEntre(desde: string, hasta: string): string[] {
  const out: string[] = []
  let a = Number(desde.slice(0, 4)), m = Number(desde.slice(4, 6))
  const fin = Number(hasta.slice(0, 4)) * 12 + Number(hasta.slice(4, 6))
  while (a * 12 + m <= fin && out.length < 240) { out.push(`${a}${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; a++ } }
  return out
}
/** El NIF para comparar: mayúsculas, solo letras y cifras, sin el «ES» de delante. */
export const nifParaComparar = (x: unknown): string | null => {
  const k = String(x ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^ES(?=[A-Z0-9]{9}$)/, '')
  return k || null
}
/**
 * Hasta cuántos meses atrás se busca una recibida antes de escribirla. Una
 * factura más vieja no se manda sola: se mira a mano (que no se cuele otra).
 */
export const MESES_BUSQUEDA_RECIBIDA = 13
/**
 * ¿Es esta factura de Diez la recibida que se va a mandar? Serie 2, el número
 * con la clave de conta_clave_numero y el proveedor por su cuenta O por su NIF.
 * Sin clave de número no hay con qué buscar: null.
 */
export function esLaMismaRecibida(q: { numero: unknown; cuenta: unknown; nif: unknown }): ((f: Factura) => boolean) | null {
  const clave = claveNumero(String(q.numero ?? ''))
  if (!clave) return null
  const cuenta = String(q.cuenta ?? '')
  const nif = nifParaComparar(q.nif)
  return (f) => String(f.Serie) === '2' && claveNumero(String(f.NumeroFactura ?? '')) === clave
    && ((cuenta !== '' && String(f.CuentaCliente ?? '') === cuenta) || (nif !== null && nifParaComparar(f.CifCliente) === nif))
}

export async function enviarAsientoADiez(entryId: string, p: PuertoEnvio): Promise<ResultadoEnvio> {
  return conRed(entryId, p, () => enviarAsiento(entryId, p))
}

async function enviarAsiento(entryId: string, p: PuertoEnvio): Promise<ResultadoEnvio> {
  const r = await p.resumen(entryId)
  const corr = p.correspondencia(r.company_id)
  const plan: Plan = {
    tipo: 'ventas',
    preparar: () => {
      const listo = resumenDeAsiento(r, { correspondencia: corr, generado: p.ahora(), hoy: hoyMadrid(p.ahora()) })
      if (!listo.factura) return { motivo: listo.sinFactura ?? 'esta factura no se sabe mandar', reintentar: false }
      const f = listo.factura.factura
      return { serie: f.Serie, numero: String(f.NumeroFactura), cuenta: f.CuentaCliente, mes: String(f.FechaFactura).slice(0, 6) }
    },
    construir: async ({ ya, diez }) => {
      const f0 = (plan.preparar() as { serie: string; numero: string; cuenta: string })
      // El cliente, por su cuenta: la subcuenta de Diez y su nombre (no el NIF ni el nombre comercial).
      let nombreCliente = ya.length === 1 ? String(ya[0].NombreCliente ?? '').trim() : ''
      if (ya.length === 0) {
        const sc = await diez.subcuenta(f0.cuenta)
        if (!sc || String(sc.Codigo ?? '').trim() !== f0.cuenta) return { motivo: `la subcuenta ${f0.cuenta} del cliente no está en Diez: no se inventa`, reintentar: false }
        nombreCliente = String(sc.Descripcion ?? '').trim()
        if (!nombreCliente) return { motivo: `la subcuenta ${f0.cuenta} de Diez no tiene nombre: no se inventa`, reintentar: false }
      }
      return { fd: facturaDeVentas({ fecha: r.fecha, local: r.local!.nombre, canal: r.canal!.slug, lineas: r.lineas.map((l) => ({ cuenta: l.cuenta, debe: Number(l.debe), haber: Number(l.haber), marca: l.marca, tipoIva: l.tipoIva })) },
        { correspondencia: corr!, nombreCliente: nombreCliente || '—', hoy: hoyMadrid(p.ahora()), conAnalitica: true }).factura }
    },
  }
  // 15/10 · Glovo: la gestoría hacía una factura por tienda y día. Si mete una
  // tarde, se reconoce por local y fecha, también en los meses de después (Diez
  // lista por la fecha del asiento), y no se manda la de Folvy.
  const grupo = r.local && r.canal ? corr?.localAlEnviar[r.local.nombre] : undefined
  const ajena = grupo && r.canal ? esDeLaGestoria(r.canal.slug, grupo, r.fecha) : null
  if (ajena) {
    plan.ajena = ajena
    plan.buscar = () => {
      const plano = plan.preparar()
      if ('motivo' in plano) return plano
      const meses = mesesEntre(plano.mes, hoyMadrid(p.ahora()).replace(/-/g, '').slice(0, 6))
      return { meses: meses.slice(0, MESES_BUSQUEDA_RECIBIDA), esLaMisma: (f: Factura) => String(f.Serie) === plano.serie && String(f.NumeroFactura) === plano.numero && String(f.CuentaCliente) === plano.cuenta }
    }
  }
  return enviar(r, plan, p)
}

/**
 * D01 · Tarea 5 · Una FACTURA RECIBIDA validada, a la serie 2 de Diez, con su
 * PDF. Los mismos frenos que las ventas, en el mismo orden (enviar(), abajo):
 * solo lo validado, sin documento no se envía, ni C0001 ni C0008, «Diez no
 * guarda documentos todavía», nunca dos veces y el documento leído de vuelta.
 * La factura, la de _shared/diezRecibida.ts (medida en la C0009); lo que no se
 * ha medido (retención, recargo, abonos) no se manda y dice por qué. I01f: las
 * autoliquidadas (intracomunitaria e inversión del sujeto pasivo de fuera de
 * la UE) sí, con su TipoFactura (7 y 6).
 */
export async function enviarRecibidaADiez(entryId: string, p: PuertoEnvio & { recibida(entryId: string): Promise<RecibidaBD> }): Promise<ResultadoEnvio> {
  return conRed(entryId, p, () => enviarRecibida(entryId, p))
}

async function enviarRecibida(entryId: string, p: PuertoEnvio & { recibida(entryId: string): Promise<RecibidaBD> }): Promise<ResultadoEnvio> {
  const r = await p.recibida(entryId)
  let hecha: FacturaRecibida | null = null
  let porque: string | null = null
  try {
    hecha = facturaRecibida({ fecha: r.fecha, fechaFactura: r.factura.fecha, numero: r.factura.numero ?? '', proveedor: r.proveedor, lineas: r.lineas }, { hoy: hoyMadrid(p.ahora()) })
  } catch (x) { porque = x instanceof Error ? x.message : String(x) }
  const plan: Plan = {
    tipo: 'recibidas',
    preparar: () => hecha
      ? { serie: '2', numero: String(hecha.factura.NumeroFactura), cuenta: hecha.factura.CuentaCliente, mes: String(hecha.factura.FechaFactura).slice(0, 6) }
      : { motivo: porque ?? 'esta factura no se sabe mandar', reintentar: false },
    construir: async () => (hecha ? { fd: hecha.factura } : { motivo: porque ?? 'esta factura no se sabe mandar', reintentar: false }),
    // Julio puede haberla metido a mano: se busca desde el mes de la factura
    // hasta hoy (Diez lista por la fecha del ASIENTO, que en 599 de 1.432 es
    // posterior), con el número normalizado (la clave de conta_clave_numero) y
    // el proveedor por su cuenta O por su NIF.
    buscar: () => {
      if (!hecha) return { motivo: porque ?? 'esta factura no se sabe mandar', reintentar: false }
      const esLaMisma = esLaMismaRecibida({ numero: hecha.factura.NumeroFactura, cuenta: hecha.factura.CuentaCliente, nif: r.proveedor.nif })
      if (!esLaMisma) return { motivo: 'sin un número que sirva para buscarla en Diez no se manda', reintentar: false }
      const meses = mesesEntre(String(hecha.factura.FechaFactura).slice(0, 6), hoyMadrid(p.ahora()).replace(/-/g, '').slice(0, 6))
      if (meses.length > MESES_BUSQUEDA_RECIBIDA) return { motivo: `la factura es de hace más de ${MESES_BUSQUEDA_RECIBIDA - 1} meses: no se manda sola, mírala a mano en Diez`, reintentar: false }
      return { meses, esLaMisma }
    },
  }
  return enviar(r, plan, p)
}

/** Lo que conta_recibida_envio devuelve de un asiento de factura recibida. */
export type RecibidaBD = Base & {
  factura: { numero: string | null; fecha: string }
  proveedor: { nombre: string; nif: string | null; pais?: string | null }
  lineas: { cuenta: string; debe: number; haber: number; tipoIva: number | null; baseIva: number | null; tratamiento?: string | null }[]
}

async function enviar(r: Base, plan: Plan, p: PuertoEnvio): Promise<ResultadoEnvio> {
  if (r.estado !== 'validado') return noLlega(`el asiento está ${r.estado}: solo se envía lo validado`, false)

  let previo = await p.envio(r.id)
  if (yaEnviado(previo) && previo!.document_status === 'adjunto') {
    return { estado: 'en_diez', serie: String(previo!.ext_series), documento: Number(previo!.ext_number), enlazada: previo!.status === 'enlazado', pdfPendiente: false, texto: `Ya estaba en Diez: ${previo!.ext_series}/${previo!.ext_number}, con su documento.` }
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

  // 3 · La conexión: ni C0001 ni ninguna base real. C0008 como hasta hoy, y
  // (C06) la base registrada de otra empresa también es real: cerrada igual.
  const con = await p.conexion(r.company_id)
  if (!con) return apuntar('la conexión con Diez no está configurada para esta empresa')
  const bd = con.nombreBd.trim().toUpperCase()
  if ((BASES_PROHIBIDAS as readonly string[]).includes(bd)) return apuntar(`la base ${bd} de Diez no se toca nunca`, { account_connector_id: con.id }, false)
  const real = bd !== BASE_PRUEBAS
  if (real && !(await p.autorizado(r.id, r.company_id, bd, r.fecha, plan.tipo))) return apuntar(cerradoEn(bd, plan.tipo), { account_connector_id: con.id })
  const adjuntar = con.adjuntar === true
  // Ya en Diez sin su PDF, y Diez sigue sin guardar documentos: nada que hacer (nunca dos veces).
  if (yaEnviado(previo) && previo!.document_status === 'pendiente_diez' && !adjuntar) {
    return { estado: 'en_diez', serie: String(previo!.ext_series), documento: Number(previo!.ext_number), enlazada: previo!.status === 'enlazado', pdfPendiente: true, texto: `Ya estaba en Diez: ${previo!.ext_series}/${previo!.ext_number}. ${PDF_PENDIENTE}.` }
  }
  if (previo && previo.attempts >= MAX_INTENTOS) return noLlega(`ya van ${previo.attempts} intentos: lo tiene que mirar una persona`, false)

  // El PDF que va es el guardado, y es el registrado.
  const pdf = await p.documento(r.documento.ruta)
  if ((await p.sha256(pdf)) !== r.documento.sha256) return apuntar('el documento guardado no es el que se registró (otra huella): no se envía', { document_status: 'fallo', document_error: 'otra huella' }, false)

  const busca = plan.buscar?.() ?? { meses: [plano.mes], esLaMisma: (f: Factura) => String(f.Serie) === plano.serie && String(f.NumeroFactura) === plano.numero && String(f.CuentaCliente) === plano.cuenta }
  if ('motivo' in busca) return apuntar(busca.motivo, { account_connector_id: con.id }, busca.reintentar)

  // 15/10: antes de hablar con Diez, el envío deja su fila: si se corta aquí (la página se cierra, Diez no contesta), queda con su motivo.
  previo = await dejarRastro(previo, r, con.id, p)
  const diez = await p.cliente(con, { real })
  const ej = r.fecha.slice(0, 4)
  const delMes: Factura[] = []
  for (const m of busca.meses) delMes.push(...await diez.facturasDelMes(m))

  // 4 · ¿Guarda Diez documentos? Se pregunta por una factura que ya tiene
  // (solo si se va a adjuntar: sin adjunto, la factura va igual).
  const muestra = delMes.find((f) => f.Documento != null)
  if (adjuntar && muestra && !yaEnviado(previo)) {
    const g = await diez.documentoDeFactura(String(muestra.Ejercicio ?? ej), String(muestra.Serie), Number(muestra.Documento))
    if (sinContenedor(g)) return apuntar(TEXTO_CONTENEDOR, { account_connector_id: con.id })
  }

  // 5 · Nunca dos veces.
  let serie = String(previo?.ext_series ?? '')
  let documento = Number(previo?.ext_number ?? 0)
  let enlazada = previo?.status === 'enlazado'
  // El ejercicio de la factura EN DIEZ: si se enlaza una que ya estaba, el suyo (puede ser otro año).
  let ejDiez = String(previo?.ext_year ?? ej)
  if (!(previo && (previo.status === 'enviado' || previo.status === 'enlazado'))) {
    // El listado de Diez repite filas: una por ejercicio, serie y documento.
    const ya = [...new Map(delMes.filter(busca.esLaMisma)
      .map((f) => [`${f.Ejercicio ?? ''}|${f.Serie}|${f.Documento}`, f])).values()]
    if (ya.length > 1) return apuntar(`hay ${ya.length} facturas ${plano.numero} en Diez: no se toca nada`, { account_connector_id: con.id }, false)
    if (ya.length === 0 && plan.ajena) {
      const ajenas = [...new Map(delMes.filter(plan.ajena).map((f) => [`${f.Ejercicio ?? ''}|${f.Serie}|${f.Documento}`, f])).values()]
      if (ajenas.length) return apuntar(`la gestoría ya ha metido en Diez ${ajenas.length === 1 ? 'una factura' : `${ajenas.length} facturas`} de este local y día con su forma (${ajenas.map((f) => `${f.Serie}/${f.Documento}`).join(', ')}): no se envía la de este asiento, que las duplicaría. Míralo con la gestoría`, { account_connector_id: con.id }, false)
    }
    const hecha = await plan.construir({ delMes, ya, diez })
    if ('motivo' in hecha) return apuntar(hecha.motivo, { account_connector_id: con.id }, hecha.reintentar)
    const fd = hecha.fd
    const hash = await p.sha256(new TextEncoder().encode(JSON.stringify(fd)))
    const comun = { entry_id: r.id, account_id: r.account_id, company_id: r.company_id, account_connector_id: con.id, kind: 'factura' as const, ext_invoice_number: String(fd.NumeroFactura), payload_hash: hash, document_id: r.documento.id }
    if (ya.length === 1) {
      documento = Number(ya[0].Documento); serie = String(ya[0].Serie); enlazada = true; ejDiez = String(ya[0].Ejercicio ?? ej)
      previo = await p.guardar({ ...(previo ?? {} as EnvioFila), ...comun, status: 'enlazado', ext_year: ejDiez, ext_series: serie, ext_number: documento, attempts: previo?.attempts ?? 0, last_error: null, sent_at: iso(p.ahora()), document_status: 'pendiente', document_error: null, document_attached_at: null })
    } else {
      // La intención, antes de escribir: cuenta como intento.
      previo = await p.guardar({ ...(previo ?? {} as EnvioFila), ...comun, status: 'pendiente', ext_year: null, ext_series: null, ext_number: null, attempts: (previo?.attempts ?? 0) + 1, last_error: 'enviando', sent_at: null, document_status: 'pendiente', document_error: null, document_attached_at: null })
      let creada: Factura
      try { creada = await diez.enviarFactura(fd) } catch (x) {
        return apuntar(alEscribir('la factura', x))
      }
      documento = Number(creada.Documento); serie = String(creada.Serie ?? fd.Serie)
      previo = await p.guardar({ ...previo, status: 'enviado', ext_year: ej, ext_series: serie, ext_number: documento, last_error: null, sent_at: iso(p.ahora()) })
    }
  }

  // 6 · El documento. Sin almacén en Diez: «PDF pendiente en Diez», y en Diez está.
  if (!adjuntar) {
    previo = await p.guardar({ ...previo!, document_status: 'pendiente_diez', document_error: null, last_error: null })
    return { estado: 'en_diez', serie, documento, enlazada, pdfPendiente: true, texto: `En Diez: ${serie}/${documento}${enlazada ? ' (ya estaba: enlazada, no se ha enviado otra)' : ''}. ${PDF_PENDIENTE}: adjúntalo allí y márcalo en Libros › Pendientes de adjuntar en Diez.` }
  }
  // Con almacén: se sube y se lee de vuelta.
  previo = await p.guardar({ ...previo!, attempts: previo!.attempts + (previo!.document_status === 'fallo' ? 1 : 0) })
  const sub = await diez.adjuntarDocumentoFactura({ Ejercicio: ejDiez, Serie: serie, Documento: documento, NombreArchivo: r.documento.nombre, Archivo: base64(pdf) })
  let fallo: string | null = null
  if (sub.status !== 200) fallo = sinContenedor(sub) ? TEXTO_CONTENEDOR : `Diez no ha guardado el documento (${sub.status}: ${corto(sub.json)})`
  else {
    const v = await diez.documentoDeFactura(ejDiez, serie, documento)
    const vuelta = v.status === 200 && typeof v.json === 'string' && v.json.length > 100 ? deBase64(v.json) : null
    if (!vuelta) fallo = `Diez no devuelve el documento después de subirlo (${v.status})`
    else if ((await p.sha256(vuelta)) !== r.documento.sha256) fallo = 'Diez devuelve otro documento (otra huella)'
  }
  if (fallo) {
    previo = await p.guardar({ ...previo!, document_status: 'fallo', document_error: fallo, last_error: 'falta el documento' })
    return noLlega('falta el documento', true)
  }
  previo = await p.guardar({ ...previo!, document_status: 'adjunto', document_error: null, document_attached_at: iso(p.ahora()), document_attached_via: 'diez', last_error: null })
  return { estado: 'en_diez', serie, documento, enlazada, pdfPendiente: false, texto: `En Diez: ${serie}/${documento}${enlazada ? ' (ya estaba: enlazada, no se ha enviado otra)' : ''}, con su documento.` }
}

// ── C06b · Respuesta 8, pregunta 2: el contraasiento de lo anulado, a Diez ──────
//
// Julio (14/10): «al anular un asiento ya enviado, Folvy manda el
// contraasiento a Diez solo, con el mismo control de "nunca dos veces"».
//
// En Diez la venta es una factura emitida; su contraasiento es la factura que
// la anula (facturaQueAnula, diezFactura.ts), con su propio envío en
// external_send (el del contraasiento de Folvy: un envío por asiento, el
// índice único de R15). Los mismos frenos que la factura, en el mismo orden:
//   1. Solo el contraasiento VALIDADO de una anulación, y solo si lo anulado
//      está en Diez (enviado o enlazado). Si no, no hay nada que anular allí:
//      no se escribe nada.
//   3. C0001 nunca; Diez real solo con lo que Julio autoriza (la empresa, el
//      contraasiento o el asiento que anula: autorizar escribir una factura
//      en Diez es autorizar también anularla).
//   5. Nunca dos veces: se busca antes en Diez por su número; una → se
//      enlaza; más de una → no se toca. La intención se apunta antes de escribir.
//   7. Como mucho 3 intentos que escriben.
// Sin PDF: el contraasiento no es un resumen de ventas (no tiene documento
// propio) y el freno 2 no aplica; su envío queda sin document_status.

/** Lo que se lee del contraasiento (journal_entry), con los permisos de quien pide. */
export type ContraasientoBD = {
  id: string; account_id: string; company_id: string; estado: string
  /** AAAA-MM-DD, la fecha del contraasiento. */
  fecha: string; origen: string; anula: string | null; numero: number | null
}

export async function enviarContraasientoADiez(c: ContraasientoBD, p: PuertoEnvio): Promise<ResultadoEnvio> {
  return conRed(c.id, p, () => enviarContraasiento(c, p))
}

async function enviarContraasiento(c: ContraasientoBD, p: PuertoEnvio): Promise<ResultadoEnvio> {
  if (c.origen !== 'reversal' || !c.anula) return noLlega('ese asiento no es el contraasiento de una anulación', false)
  if (c.estado !== 'validado') return noLlega(`el contraasiento está ${c.estado}: solo se envía lo validado`, false)

  const orig = await p.envio(c.anula)
  if (!yaEnviado(orig)) return noLlega('lo que anula no llegó a Diez: allí no hay nada que anular', false)
  let previo = await p.envio(c.id)
  if (yaEnviado(previo)) {
    return { estado: 'en_diez', serie: String(previo!.ext_series), documento: Number(previo!.ext_number), enlazada: previo!.status === 'enlazado', pdfPendiente: false,
      texto: `Ya estaba anulada en Diez: ${orig!.ext_series}/${orig!.ext_number}, con ${previo!.ext_series}/${previo!.ext_number}.` }
  }
  const apuntar = async (motivo: string, extra: Partial<EnvioFila> = {}, reintentar = true): Promise<ResultadoEnvio> => {
    previo = await p.guardar({
      ...(previo ?? {
        entry_id: c.id, account_id: c.account_id, company_id: c.company_id, account_connector_id: null, kind: 'factura',
        ext_year: null, ext_series: null, ext_number: null, ext_invoice_number: null, payload_hash: 'sin-enviar', status: 'pendiente', attempts: 0,
        sent_at: null, document_id: null, document_status: null, document_error: null, document_attached_at: null,
      }),
      last_error: motivo, ...extra,
    } as EnvioFila)
    return noLlega(motivo, reintentar)
  }

  // La factura que se anula, rehecha de lo anulado (las mismas líneas que se enviaron).
  const r = await p.resumen(c.anula)
  const corr = p.correspondencia(r.company_id)
  if (!corr || !r.local || !r.canal) return apuntar('lo anulado no tiene su factura de Diez (sin local, plataforma o correspondencia)', {}, false)

  const con = await p.conexion(c.company_id)
  if (!con) return apuntar('la conexión con Diez no está configurada para esta empresa')
  const bd = con.nombreBd.trim().toUpperCase()
  if ((BASES_PROHIBIDAS as readonly string[]).includes(bd)) return apuntar(`la base ${bd} de Diez no se toca nunca`, { account_connector_id: con.id }, false)
  const real = bd !== BASE_PRUEBAS
  // La fecha que cuenta es la de lo que anula (r.fecha), no la del contraasiento.
  if (real && !(await p.autorizado(c.id, c.company_id, bd, r.fecha, 'ventas')) && !(await p.autorizado(c.anula, c.company_id, bd, r.fecha, 'ventas'))) {
    return apuntar(cerradoEn(bd, 'ventas'), { account_connector_id: con.id })
  }
  if (previo && previo.attempts >= MAX_INTENTOS) return noLlega(`ya van ${previo.attempts} intentos: lo tiene que mirar una persona`, false)

  // 15/10: antes de hablar con Diez, el envío deja su fila: si se corta aquí (la página se cierra, Diez no contesta), queda con su motivo.
  previo = await dejarRastro(previo, c, con.id, p)
  const diez = await p.cliente(con, { real })
  const hoy = hoyMadrid(p.ahora())
  const asiento = { fecha: r.fecha, local: r.local.nombre, canal: r.canal.slug, lineas: r.lineas.map((l) => ({ cuenta: l.cuenta, debe: Number(l.debe), haber: Number(l.haber), marca: l.marca, tipoIva: l.tipoIva })) }
  const sc = await diez.subcuenta(PATRONES[r.canal.slug.toLowerCase()]?.cuentaCliente ?? '')
  const nombreCliente = String(sc?.Descripcion ?? '').trim()
  let fd: FacturaData
  try {
    const original = facturaDeVentas(asiento, { correspondencia: corr, nombreCliente: nombreCliente || '—', hoy, conAnalitica: true }).factura
    if (String(original.NumeroFactura) !== String(orig!.ext_invoice_number)) {
      return apuntar(`la factura rehecha (${original.NumeroFactura}) no es la que está en Diez (${orig!.ext_invoice_number}): no se anula a ciegas`, { account_connector_id: con.id }, false)
    }
    fd = facturaQueAnula(original, { fecha: c.fecha, hoy })
  } catch (x) { return apuntar(x instanceof Error ? x.message : String(x), {}, false) }
  if (!sc || !nombreCliente) return apuntar(`la subcuenta ${fd.CuentaCliente} del cliente no está en Diez o no tiene nombre: no se inventa`, { account_connector_id: con.id }, false)

  // 5 · Nunca dos veces: ¿ya está en Diez la que anula?
  const ej = c.fecha.slice(0, 4)
  const delMes = await diez.facturasDelMes(String(fd.FechaFactura).slice(0, 6))
  const ya = [...new Map(delMes.filter((f) => String(f.Serie) === fd.Serie && String(f.NumeroFactura) === fd.NumeroFactura && String(f.CuentaCliente) === fd.CuentaCliente)
    .map((f) => [String(f.Documento), f])).values()]
  if (ya.length > 1) return apuntar(`hay ${ya.length} facturas ${fd.NumeroFactura} en Diez: no se toca nada`, { account_connector_id: con.id }, false)
  const hash = await p.sha256(new TextEncoder().encode(JSON.stringify(fd)))
  const comun = { entry_id: c.id, account_id: c.account_id, company_id: c.company_id, account_connector_id: con.id, kind: 'factura' as const, ext_invoice_number: String(fd.NumeroFactura), payload_hash: hash, document_id: null, document_status: null, document_error: null, document_attached_at: null }
  let serie: string, documento: number, enlazada: boolean
  if (ya.length === 1) {
    serie = String(ya[0].Serie); documento = Number(ya[0].Documento); enlazada = true
    previo = await p.guardar({ ...(previo ?? {} as EnvioFila), ...comun, status: 'enlazado', ext_year: ej, ext_series: serie, ext_number: documento, attempts: previo?.attempts ?? 0, last_error: null, sent_at: iso(p.ahora()) })
  } else {
    previo = await p.guardar({ ...(previo ?? {} as EnvioFila), ...comun, status: 'pendiente', ext_year: null, ext_series: null, ext_number: null, attempts: (previo?.attempts ?? 0) + 1, last_error: 'enviando', sent_at: null })
    let creada: Factura
    try { creada = await diez.enviarFactura(fd) } catch (x) {
      return apuntar(alEscribir('el contraasiento', x))
    }
    serie = String(creada.Serie ?? fd.Serie); documento = Number(creada.Documento); enlazada = false
    previo = await p.guardar({ ...previo, status: 'enviado', ext_year: ej, ext_series: serie, ext_number: documento, last_error: null, sent_at: iso(p.ahora()) })
  }
  return { estado: 'en_diez', serie, documento, enlazada, pdfPendiente: false,
    texto: `Anulada también en Diez: ${orig!.ext_series}/${orig!.ext_number} (${orig!.ext_invoice_number}) con ${serie}/${documento} (${fd.NumeroFactura})${enlazada ? ', que ya estaba: enlazada, no se ha enviado otra' : ''}.` }
}

// ── D01 · El contraasiento de una RECIBIDA ya enviada, a Diez (su «-ANUL») ──────
//
// Julio (15/10): «anular una recibida ya enviada a Diez con su "-ANUL", igual
// que las ventas, con los mismos frenos». La factura que la anula es
// facturaRecibidaQueAnula (diezRecibida.ts): la recibida rehecha de lo anulado,
// con el número y los importes al revés. Los frenos, en el orden de las ventas:
//   1. Solo el contraasiento VALIDADO de una anulación, y solo si la recibida
//      está en Diez (enviada o enlazada, en la serie 2). Si no, allí no hay
//      nada que anular: no se escribe nada.
//   3. C0001 nunca; Diez real solo con lo que Julio autoriza (la empresa, el
//      contraasiento o la recibida que anula) Y que incluye las recibidas
//      (incluye_recibidas, 0740); la de empresa, desde su «desde», con la
//      fecha de la recibida que anula.
//   5. Nunca dos veces: se busca antes como una recibida (del mes del
//      contraasiento a hoy, el número normalizado, el proveedor por su cuenta
//      o su NIF); una → se enlaza; más de una → no se toca. La intención se
//      apunta antes de escribir.
//   7. Como mucho 3 intentos que escriben.
// Sin PDF, como el contraasiento de ventas: su envío queda sin document_status.

export async function enviarContraasientoRecibidaADiez(c: ContraasientoBD, p: PuertoEnvio & { recibida(entryId: string): Promise<RecibidaBD> }): Promise<ResultadoEnvio> {
  return conRed(c.id, p, () => enviarContraasientoRecibida(c, p))
}

async function enviarContraasientoRecibida(c: ContraasientoBD, p: PuertoEnvio & { recibida(entryId: string): Promise<RecibidaBD> }): Promise<ResultadoEnvio> {
  if (c.origen !== 'reversal' || !c.anula) return noLlega('ese asiento no es el contraasiento de una anulación', false)
  if (c.estado !== 'validado') return noLlega(`el contraasiento está ${c.estado}: solo se envía lo validado`, false)

  const orig = await p.envio(c.anula)
  if (!yaEnviado(orig)) return noLlega('la factura recibida que anula no llegó a Diez: allí no hay nada que anular', false)
  if (String(orig!.ext_series) !== '2') return noLlega(`lo que anula está en la serie ${orig!.ext_series} de Diez, no en la de recibidas: no se anula a ciegas`, false)
  let previo = await p.envio(c.id)
  if (yaEnviado(previo)) {
    return { estado: 'en_diez', serie: String(previo!.ext_series), documento: Number(previo!.ext_number), enlazada: previo!.status === 'enlazado', pdfPendiente: false,
      texto: `Ya estaba anulada en Diez: ${orig!.ext_series}/${orig!.ext_number}, con ${previo!.ext_series}/${previo!.ext_number}.` }
  }
  const apuntar = async (motivo: string, extra: Partial<EnvioFila> = {}, reintentar = true): Promise<ResultadoEnvio> => {
    previo = await p.guardar({
      ...(previo ?? {
        entry_id: c.id, account_id: c.account_id, company_id: c.company_id, account_connector_id: null, kind: 'factura',
        ext_year: null, ext_series: null, ext_number: null, ext_invoice_number: null, payload_hash: 'sin-enviar', status: 'pendiente', attempts: 0,
        sent_at: null, document_id: null, document_status: null, document_error: null, document_attached_at: null,
      }),
      last_error: motivo, ...extra,
    } as EnvioFila)
    return noLlega(motivo, reintentar)
  }

  // La recibida que se anula, rehecha de lo anulado (las mismas líneas que se enviaron).
  const r = await p.recibida(c.anula)
  const hoy = hoyMadrid(p.ahora())
  let fd: FacturaData
  try {
    const original = facturaRecibida({ fecha: r.fecha, fechaFactura: r.factura.fecha, numero: r.factura.numero ?? '', proveedor: r.proveedor, lineas: r.lineas }, { hoy }).factura
    if (String(original.NumeroFactura) !== String(orig!.ext_invoice_number)) {
      return apuntar(`la recibida rehecha (${original.NumeroFactura}) no es la que está en Diez (${orig!.ext_invoice_number}): no se anula a ciegas`, {}, false)
    }
    fd = facturaRecibidaQueAnula(original, { fecha: c.fecha, hoy })
  } catch (x) { return apuntar(x instanceof Error ? x.message : String(x), {}, false) }

  const con = await p.conexion(c.company_id)
  if (!con) return apuntar('la conexión con Diez no está configurada para esta empresa')
  const bd = con.nombreBd.trim().toUpperCase()
  if ((BASES_PROHIBIDAS as readonly string[]).includes(bd)) return apuntar(`la base ${bd} de Diez no se toca nunca`, { account_connector_id: con.id }, false)
  const real = bd !== BASE_PRUEBAS
  // Una RECIBIDA: solo con incluye_recibidas (0740), y la fecha que cuenta es la
  // de la recibida que anula (r.fecha), como en el contraasiento de ventas.
  if (real && !(await p.autorizado(c.id, c.company_id, bd, r.fecha, 'recibidas')) && !(await p.autorizado(c.anula, c.company_id, bd, r.fecha, 'recibidas'))) {
    return apuntar(cerradoEn(bd, 'recibidas'), { account_connector_id: con.id })
  }
  if (previo && previo.attempts >= MAX_INTENTOS) return noLlega(`ya van ${previo.attempts} intentos: lo tiene que mirar una persona`, false)

  // 5 · Nunca dos veces: ¿ya está en Diez la que anula? Se busca como una recibida.
  const esLaMisma = esLaMismaRecibida({ numero: fd.NumeroFactura, cuenta: fd.CuentaCliente, nif: r.proveedor.nif })
  if (!esLaMisma) return apuntar('sin un número que sirva para buscarla en Diez no se manda', { account_connector_id: con.id }, false)
  const meses = mesesEntre(String(fd.FechaFactura).slice(0, 6), hoy.replace(/-/g, '').slice(0, 6))
  if (!meses.length) return apuntar('el contraasiento es de una fecha posterior a hoy: no se manda', { account_connector_id: con.id }, false)
  if (meses.length > MESES_BUSQUEDA_RECIBIDA) return apuntar(`el contraasiento es de hace más de ${MESES_BUSQUEDA_RECIBIDA - 1} meses: no se manda solo, míralo a mano en Diez`, { account_connector_id: con.id }, false)
  // 15/10: antes de hablar con Diez, el envío deja su fila: si se corta aquí (la página se cierra, Diez no contesta), queda con su motivo.
  previo = await dejarRastro(previo, c, con.id, p)
  const diez = await p.cliente(con, { real })
  const delMes: Factura[] = []
  for (const m of meses) delMes.push(...await diez.facturasDelMes(m))
  const ya = [...new Map(delMes.filter(esLaMisma).map((f) => [`${f.Ejercicio ?? ''}|${f.Serie}|${f.Documento}`, f])).values()]
  if (ya.length > 1) return apuntar(`hay ${ya.length} facturas ${fd.NumeroFactura} en Diez: no se toca nada`, { account_connector_id: con.id }, false)
  const ej = c.fecha.slice(0, 4)
  const hash = await p.sha256(new TextEncoder().encode(JSON.stringify(fd)))
  const comun = { entry_id: c.id, account_id: c.account_id, company_id: c.company_id, account_connector_id: con.id, kind: 'factura' as const, ext_invoice_number: String(fd.NumeroFactura), payload_hash: hash, document_id: null, document_status: null, document_error: null, document_attached_at: null }
  let serie: string, documento: number, enlazada: boolean
  if (ya.length === 1) {
    serie = String(ya[0].Serie); documento = Number(ya[0].Documento); enlazada = true
    previo = await p.guardar({ ...(previo ?? {} as EnvioFila), ...comun, status: 'enlazado', ext_year: String(ya[0].Ejercicio ?? ej), ext_series: serie, ext_number: documento, attempts: previo?.attempts ?? 0, last_error: null, sent_at: iso(p.ahora()) })
  } else {
    // La intención, antes de escribir: cuenta como intento.
    previo = await p.guardar({ ...(previo ?? {} as EnvioFila), ...comun, status: 'pendiente', ext_year: null, ext_series: null, ext_number: null, attempts: (previo?.attempts ?? 0) + 1, last_error: 'enviando', sent_at: null })
    let creada: Factura
    try { creada = await diez.enviarFactura(fd) } catch (x) {
      return apuntar(alEscribir('el contraasiento', x))
    }
    serie = String(creada.Serie ?? fd.Serie); documento = Number(creada.Documento); enlazada = false
    previo = await p.guardar({ ...previo, status: 'enviado', ext_year: ej, ext_series: serie, ext_number: documento, last_error: null, sent_at: iso(p.ahora()) })
  }
  return { estado: 'en_diez', serie, documento, enlazada, pdfPendiente: false,
    texto: `Anulada también en Diez: ${orig!.ext_series}/${orig!.ext_number} (${orig!.ext_invoice_number}) con ${serie}/${documento} (${fd.NumeroFactura})${enlazada ? ', que ya estaba: enlazada, no se ha enviado otra' : ''}.` }
}
