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
