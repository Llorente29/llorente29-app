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

import { BASE_PRUEBAS, BASES_PROHIBIDAS, MAX_INTENTOS, type Factura, type FacturaData } from './diezCliente.ts'
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
  /** ¿Ha autorizado Julio escribir este asiento en esta base real? (conta_diez_autorizo) */
  autorizado(entryId: string, companyId: string, nombreBd: string): Promise<boolean>
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
const yaEnviado = (e: EnvioFila | null) => !!e && (e.status === 'enviado' || e.status === 'enlazado')

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
  construir(c: { delMes: Factura[]; ya: Factura[]; diez: ClienteDiezEnvio }): Promise<{ fd: FacturaData } | { motivo: string; reintentar: boolean }>
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
    construir: async () => (hecha ? { fd: hecha.factura } : { motivo: porque ?? 'esta factura no se sabe mandar', reintentar: false }),
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
  if (real && !(await p.autorizado(r.id, r.company_id, bd))) return apuntar(`Diez real (${bd}) está cerrado: no se escribe nada hasta que Julio lo autorice`, { account_connector_id: con.id })
  const adjuntar = con.adjuntar === true
  // Ya en Diez sin su PDF, y Diez sigue sin guardar documentos: nada que hacer (nunca dos veces).
  if (yaEnviado(previo) && previo!.document_status === 'pendiente_diez' && !adjuntar) {
    return { estado: 'en_diez', serie: String(previo!.ext_series), documento: Number(previo!.ext_number), enlazada: previo!.status === 'enlazado', pdfPendiente: true, texto: `Ya estaba en Diez: ${previo!.ext_series}/${previo!.ext_number}. ${PDF_PENDIENTE}.` }
  }
  if (previo && previo.attempts >= MAX_INTENTOS) return noLlega(`ya van ${previo.attempts} intentos: lo tiene que mirar una persona`, false)

  // El PDF que va es el guardado, y es el registrado.
  const pdf = await p.documento(r.documento.ruta)
  if ((await p.sha256(pdf)) !== r.documento.sha256) return apuntar('el documento guardado no es el que se registró (otra huella): no se envía', { document_status: 'fallo', document_error: 'otra huella' }, false)

  const diez = await p.cliente(con, { real })
  const ej = r.fecha.slice(0, 4)
  const delMes = await diez.facturasDelMes(plano.mes)

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
  if (!(previo && (previo.status === 'enviado' || previo.status === 'enlazado'))) {
    const ya = [...new Map(delMes.filter((f) => String(f.Serie) === plano.serie && String(f.NumeroFactura) === plano.numero && String(f.CuentaCliente) === plano.cuenta)
      .map((f) => [String(f.Documento), f])).values()]
    if (ya.length > 1) return apuntar(`hay ${ya.length} facturas ${plano.numero} en Diez: no se toca nada`, { account_connector_id: con.id }, false)
    const hecha = await plan.construir({ delMes, ya, diez })
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

  // 6 · El documento. Sin almacén en Diez: «PDF pendiente en Diez», y en Diez está.
  if (!adjuntar) {
    previo = await p.guardar({ ...previo!, document_status: 'pendiente_diez', document_error: null, last_error: null })
    return { estado: 'en_diez', serie, documento, enlazada, pdfPendiente: true, texto: `En Diez: ${serie}/${documento}${enlazada ? ' (ya estaba: enlazada, no se ha enviado otra)' : ''}. ${PDF_PENDIENTE}: adjúntalo allí y márcalo en Libros › Pendientes de adjuntar en Diez.` }
  }
  // Con almacén: se sube y se lee de vuelta.
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
  previo = await p.guardar({ ...previo!, document_status: 'adjunto', document_error: null, document_attached_at: iso(p.ahora()), document_attached_via: 'diez', last_error: null })
  return { estado: 'en_diez', serie, documento, enlazada, pdfPendiente: false, texto: `En Diez: ${serie}/${documento}${enlazada ? ' (ya estaba: enlazada, no se ha enviado otra)' : ''}, con su documento.` }
}
