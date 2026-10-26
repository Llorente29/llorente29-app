// supabase/functions/_shared/verifactu/consulta.ts
//
// V03 · E1 · LA PRUEBA DE CONEXIÓN CON LA AEAT: una consulta
// (ConsultaFactuSistemaFacturacion) de los registros del obligado en el mes en
// curso. No da de alta nada. Si Hacienda contesta una respuesta de consulta, el
// certificado vale y la conexión está bien: eso es lo que abre el candado
// (verifactu_conexion, 2351). El orden es el de ConsultaLR.xsd (una prueba lo
// valida con xmllint).
//
// Núcleo sin Deno.

import { NS_SF } from './xml.ts'

export const NS_CONSULTA = NS_SF.replace('SuministroInformacion.xsd', 'ConsultaLR.xsd')

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** El cuerpo de la consulta (sin el sobre). El período, el mes de hoy en Madrid. */
export function cuerpoConsulta(obligado: { nombre: string; nif: string }, ahora: Date): string {
  const [anio, mes] = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit' }).format(ahora).split('-')
  return `<con:ConsultaFactuSistemaFacturacion xmlns:con="${NS_CONSULTA}" xmlns:sf="${NS_SF}">`
    + `<con:Cabecera><sf:IDVersion>1.0</sf:IDVersion><sf:ObligadoEmision><sf:NombreRazon>${esc(obligado.nombre)}</sf:NombreRazon><sf:NIF>${esc(obligado.nif)}</sf:NIF></sf:ObligadoEmision></con:Cabecera>`
    + `<con:FiltroConsulta><con:PeriodoImputacion><sf:Ejercicio>${anio}</sf:Ejercicio><sf:Periodo>${mes}</sf:Periodo></con:PeriodoImputacion></con:FiltroConsulta>`
    + `</con:ConsultaFactuSistemaFacturacion>`
}

export const sobreConsulta = (obligado: { nombre: string; nif: string }, ahora: Date) =>
  `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Header/><soapenv:Body>`
  + cuerpoConsulta(obligado, ahora) + `</soapenv:Body></soapenv:Envelope>`

/** ¿Ha salido bien? Solo si Hacienda contesta una respuesta de consulta y no un Fault. */
export function leerConexion(status: number, cuerpo: string): { ok: boolean; codigo: number | null; motivo: string } {
  const fault = /<(?:[\w.-]+:)?Fault[\s>]/.test(cuerpo)
  const respuesta = /<(?:[\w.-]+:)?RespuestaConsultaFactuSistemaFacturacion[\s>]/.test(cuerpo)
  const cod = /(?:Codigo|C[oó]digo)\s*\[?\s*(\d{3,5})/i.exec(cuerpo) ?? /<(?:[\w.-]+:)?faultcode>[^<]*?(\d{3,5})/.exec(cuerpo)
  const codigo = cod ? Number(cod[1]) : null
  if (respuesta && !fault) return { ok: true, codigo: null, motivo: 'respuesta_de_consulta' }
  if (fault) return { ok: false, codigo, motivo: 'fault' }
  return { ok: false, codigo, motivo: `http_${status}` }
}

// ── V03 · E3 · «COMPROBAR CON HACIENDA»: la consulta de un mes, con paginación ──
//
// La misma ConsultaFactuSistemaFacturacion, para el mes que se pide (el de la
// fecha de expedición), y con ClavePaginacion cuando Hacienda contesta que hay
// más (IndicadorPaginacion = S): la clave es la última factura de la página
// anterior. La respuesta (RespuestaConsultaLR.xsd) trae, por factura, su
// último estado (Correcto · AceptadoConErrores · Anulado), su huella y sus
// importes.

export interface ClavePaginacion { nif: string; numSerie: string; fecha: string /* AAAA-MM-DD */ }

const fechaAeat = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) throw new Error(`Fecha sin formato AAAA-MM-DD: ${iso}`)
  return `${m[3]}-${m[2]}-${m[1]}`
}

/** El cuerpo de la consulta de un mes; con la clave, la página siguiente. */
export function cuerpoConsultaPeriodo(obligado: { nombre: string; nif: string }, ejercicio: number, periodo: string, clave?: ClavePaginacion | null): string {
  if (!/^(0[1-9]|1[0-2])$/.test(periodo)) throw new Error(`Periodo que no es un mes: ${periodo}`)
  return `<con:ConsultaFactuSistemaFacturacion xmlns:con="${NS_CONSULTA}" xmlns:sf="${NS_SF}">`
    + `<con:Cabecera><sf:IDVersion>1.0</sf:IDVersion><sf:ObligadoEmision><sf:NombreRazon>${esc(obligado.nombre)}</sf:NombreRazon><sf:NIF>${esc(obligado.nif)}</sf:NIF></sf:ObligadoEmision></con:Cabecera>`
    + `<con:FiltroConsulta><con:PeriodoImputacion><sf:Ejercicio>${ejercicio}</sf:Ejercicio><sf:Periodo>${periodo}</sf:Periodo></con:PeriodoImputacion>`
    + (clave ? `<con:ClavePaginacion><sf:IDEmisorFactura>${esc(clave.nif)}</sf:IDEmisorFactura><sf:NumSerieFactura>${esc(clave.numSerie)}</sf:NumSerieFactura><sf:FechaExpedicionFactura>${fechaAeat(clave.fecha)}</sf:FechaExpedicionFactura></con:ClavePaginacion>` : '')
    + `</con:FiltroConsulta>`
    + `</con:ConsultaFactuSistemaFacturacion>`
}

export const sobreConsultaPeriodo = (obligado: { nombre: string; nif: string }, ejercicio: number, periodo: string, clave?: ClavePaginacion | null) =>
  `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Header/><soapenv:Body>`
  + cuerpoConsultaPeriodo(obligado, ejercicio, periodo, clave) + `</soapenv:Body></soapenv:Envelope>`

/** Una factura en Hacienda, como la guarda verifactu_cuadre_pagina. */
export interface FacturaEnHacienda {
  num_serie: string
  fecha: string // AAAA-MM-DD
  tipo_factura: string | null
  cuota_total: string | null
  importe_total: string | null
  huella: string | null
  estado: 'Correcto' | 'AceptadoConErrores' | 'Anulado'
  codigo: number | null
  descripcion: string | null
  modificado: string | null
}

export interface PaginaConsulta {
  conDatos: boolean
  /** S: hay más páginas, y la siguiente se pide con «clave». */
  hayMas: boolean
  clave: ClavePaginacion | null
  facturas: FacturaEnHacienda[]
}

/** La consulta entera rechazada (un Fault de SOAP, con su código). */
export class ConsultaRechazada extends Error {
  readonly codigo: number | null
  constructor(codigo: number | null, mensaje: string) {
    super(mensaje)
    this.name = 'ConsultaRechazada'
    this.codigo = codigo
  }
}

const P = '(?:[\\w.-]+:)?'
const desescapar = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
const uno = (xml: string, nombre: string): string | null => {
  const m = new RegExp(`<${P}${nombre}(?:\\s[^>]*)?>([\\s\\S]*?)</${P}${nombre}>`).exec(xml)
  return m ? desescapar(m[1].trim()) : null
}
const bloques = (xml: string, nombre: string): string[] =>
  [...xml.matchAll(new RegExp(`<${P}${nombre}(?:\\s[^>]*)?>([\\s\\S]*?)</${P}${nombre}>`, 'g'))].map((m) => m[1])
const iso = (aeat: string | null) => {
  const m = aeat ? /^(\d{2})-(\d{2})-(\d{4})$/.exec(aeat) : null
  if (!m) throw new Error(`Hacienda ha devuelto una fecha que no es DD-MM-AAAA: ${aeat}`)
  return `${m[3]}-${m[2]}-${m[1]}`
}

/** Lo que contestó Hacienda a una consulta. Lanza ConsultaRechazada si es un Fault. */
export function leerRespuestaConsulta(cuerpo: string): PaginaConsulta {
  if (new RegExp(`<${P}Fault[\\s>]`).test(cuerpo)) {
    const t = uno(cuerpo, 'faultstring') ?? 'Hacienda ha rechazado la consulta.'
    const cod = /(\d{3,5})/.exec(t)
    throw new ConsultaRechazada(cod ? Number(cod[1]) : null, t)
  }
  const raiz = bloques(cuerpo, 'RespuestaConsultaFactuSistemaFacturacion')[0]
  if (raiz === undefined) throw new Error('Hacienda no ha contestado una respuesta de consulta.')
  const facturas = bloques(raiz, 'RegistroRespuestaConsultaFactuSistemaFacturacion').map((r): FacturaEnHacienda => {
    const id = bloques(r, 'IDFactura')[0] ?? ''
    const datos = (bloques(r, 'DatosRegistroFacturacion')[0] ?? '').replace(new RegExp(`<${P}Encadenamiento[\\s>][\\s\\S]*?</${P}Encadenamiento>`), '')
    // El estado va en un EstadoRegistro DENTRO de otro EstadoRegistro (EstadoRegFactuType):
    // se lee lo que hay después de los datos, y el valor por su lista cerrada.
    const tras = r.slice(r.search(new RegExp(`</${P}DatosRegistroFacturacion>`)))
    const estado = new RegExp(`<${P}EstadoRegistro>\\s*(Correcto|AceptadoConErrores|Anulado)\\s*</${P}EstadoRegistro>`).exec(tras)?.[1]
    if (!estado) throw new Error('Hacienda ha devuelto una factura sin su estado.')
    const codigo = uno(tras, 'CodigoErrorRegistro')
    return {
      num_serie: uno(id, 'NumSerieFactura') ?? '',
      fecha: iso(uno(id, 'FechaExpedicionFactura')),
      tipo_factura: uno(datos, 'TipoFactura'),
      cuota_total: uno(datos, 'CuotaTotal'),
      importe_total: uno(datos, 'ImporteTotal'),
      huella: uno(datos, 'Huella'),
      estado: estado as FacturaEnHacienda['estado'],
      codigo: codigo ? Number(codigo) : null,
      descripcion: uno(tras, 'DescripcionErrorRegistro'),
      modificado: uno(tras, 'TimestampUltimaModificacion'),
    }
  })
  // La clave de la página siguiente es la del final (no la de dentro de una factura).
  const ultimo = raiz.lastIndexOf('RegistroRespuestaConsultaFactuSistemaFacturacion>')
  const cola = ultimo >= 0 ? raiz.slice(ultimo) : raiz
  const cp = bloques(cola, 'ClavePaginacion')[0]
  const hayMas = uno(raiz, 'IndicadorPaginacion') === 'S'
  return {
    conDatos: uno(raiz, 'ResultadoConsulta') === 'ConDatos',
    hayMas,
    clave: cp ? { nif: uno(cp, 'IDEmisorFactura') ?? '', numSerie: uno(cp, 'NumSerieFactura') ?? '', fecha: iso(uno(cp, 'FechaExpedicionFactura')) } : null,
    facturas,
  }
}
