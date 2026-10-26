// tests/unit/modules/conta/v03/consultaPeriodo.test.ts
//
// V03 · E3 · «Comprobar con Hacienda»: la consulta de un mes (con y sin
// ClavePaginacion) valida contra ConsultaLR.xsd, y la respuesta que se lee es
// una que valida contra RespuestaConsultaLR.xsd (regla 31: el ejemplo lo
// contradice el XSD oficial, no la cabeza de quien escribió el lector).

import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ConsultaRechazada, cuerpoConsultaPeriodo, leerRespuestaConsulta, NS_CONSULTA,
} from '../../../../../supabase/functions/_shared/verifactu/consulta'
import { NS_SF } from '../../../../../supabase/functions/_shared/verifactu/xml'

const raiz = resolve(__dirname, '../../../../..')
function valida(xml: string, xsd: string): { ok: boolean; salida: string } {
  const f = join(mkdtempSync(join(tmpdir(), 'v03-cp-')), 'c.xml')
  writeFileSync(f, xml)
  const r = spawnSync('xmllint', ['--nonet', '--noout', '--schema', join(raiz, 'docs/conta/v03/aeat', xsd), f],
    { encoding: 'utf8', env: { ...process.env, XML_CATALOG_FILES: join(raiz, 'tests/unit/modules/conta/v03/xsd/catalogo.xml') } })
  if (r.error) throw r.error
  return { ok: r.status === 0, salida: r.stderr }
}

const NS_RESP = NS_SF.replace('SuministroInformacion.xsd', 'RespuestaConsultaLR.xsd')
const obligado = { nombre: 'Prueba & Cía', nif: 'B28000016' }

const registro = (o: { num: string; fecha: string; huella: string; anterior?: string; estado: string; error?: [string, string] }) =>
  `<r:RegistroRespuestaConsultaFactuSistemaFacturacion>`
  + `<r:IDFactura><sf:IDEmisorFactura>B28000016</sf:IDEmisorFactura><sf:NumSerieFactura>${o.num}</sf:NumSerieFactura><sf:FechaExpedicionFactura>${o.fecha}</sf:FechaExpedicionFactura></r:IDFactura>`
  + `<r:DatosRegistroFacturacion><r:NombreRazonEmisor>Prueba &amp; Cía</r:NombreRazonEmisor><r:TipoFactura>F1</r:TipoFactura>`
  + `<r:DescripcionOperacion>Comidas</r:DescripcionOperacion><r:CuotaTotal>21.00</r:CuotaTotal><r:ImporteTotal>121.00</r:ImporteTotal>`
  + `<r:Encadenamiento>${o.anterior
    ? `<r:RegistroAnterior><sf:IDEmisorFactura>B28000016</sf:IDEmisorFactura><sf:NumSerieFactura>A-0</sf:NumSerieFactura><sf:FechaExpedicionFactura>01-10-2026</sf:FechaExpedicionFactura><sf:Huella>${o.anterior}</sf:Huella></r:RegistroAnterior>`
    : `<r:PrimerRegistro>S</r:PrimerRegistro>`}</r:Encadenamiento>`
  + `<r:FechaHoraHusoGenRegistro>2026-10-05T10:00:00+02:00</r:FechaHoraHusoGenRegistro><r:TipoHuella>01</r:TipoHuella><r:Huella>${o.huella}</r:Huella></r:DatosRegistroFacturacion>`
  + `<r:DatosPresentacion><sf:NIFPresentador>B28000016</sf:NIFPresentador><sf:TimestampPresentacion>2026-10-05T10:01:00+02:00</sf:TimestampPresentacion><sf:IdPeticion>202610051001</sf:IdPeticion></r:DatosPresentacion>`
  + `<r:EstadoRegistro><r:TimestampUltimaModificacion>2026-10-05T10:01:00+02:00</r:TimestampUltimaModificacion><r:EstadoRegistro>${o.estado}</r:EstadoRegistro>`
  + (o.error ? `<r:CodigoErrorRegistro>${o.error[0]}</r:CodigoErrorRegistro><r:DescripcionErrorRegistro>${o.error[1]}</r:DescripcionErrorRegistro>` : '')
  + `</r:EstadoRegistro></r:RegistroRespuestaConsultaFactuSistemaFacturacion>`

const respuesta = (cuerpo: string, paginacion: 'S' | 'N', resultado: 'ConDatos' | 'SinDatos') =>
  `<r:RespuestaConsultaFactuSistemaFacturacion xmlns:r="${NS_RESP}" xmlns:sf="${NS_SF}">`
  + `<r:Cabecera><sf:IDVersion>1.0</sf:IDVersion><sf:ObligadoEmision><sf:NombreRazon>Prueba &amp; Cía</sf:NombreRazon><sf:NIF>B28000016</sf:NIF></sf:ObligadoEmision></r:Cabecera>`
  + `<r:PeriodoImputacion><r:Ejercicio>2026</r:Ejercicio><r:Periodo>10</r:Periodo></r:PeriodoImputacion>`
  + `<r:IndicadorPaginacion>${paginacion}</r:IndicadorPaginacion><r:ResultadoConsulta>${resultado}</r:ResultadoConsulta>`
  + cuerpo + `</r:RespuestaConsultaFactuSistemaFacturacion>`

const sobre = (x: string) => `<?xml version="1.0" encoding="UTF-8"?><env:Envelope xmlns:env="http://schemas.xmlsoap.org/soap/envelope/"><env:Body>${x}</env:Body></env:Envelope>`

const H1 = 'A'.repeat(64)
const H0 = 'B'.repeat(64)
const H2 = 'C'.repeat(64)
const pagina1 = respuesta(
  registro({ num: 'A-1', fecha: '05-10-2026', huella: H1, anterior: H0, estado: 'Correcto' })
  + registro({ num: 'A-2', fecha: '06-10-2026', huella: H2, estado: 'AceptadoConErrores', error: ['1100', 'Valor o tipo incorrecto &lt;Destinatario&gt;'] })
  + `<r:ClavePaginacion><sf:IDEmisorFactura>B28000016</sf:IDEmisorFactura><sf:NumSerieFactura>A-2</sf:NumSerieFactura><sf:FechaExpedicionFactura>06-10-2026</sf:FechaExpedicionFactura></r:ClavePaginacion>`,
  'S', 'ConDatos')

describe('V03 · E3 · la consulta de un mes', () => {
  it('valida contra ConsultaLR.xsd, sin clave y con la clave de la página anterior (fecha DD-MM-AAAA)', () => {
    const sin = cuerpoConsultaPeriodo(obligado, 2026, '10')
    expect(valida(sin, 'ConsultaLR.xsd').ok).toBe(true)
    expect(sin).not.toContain('ClavePaginacion')
    const con = cuerpoConsultaPeriodo(obligado, 2026, '10', { nif: 'B28000016', numSerie: 'A-2', fecha: '2026-10-06' })
    const v = valida(con, 'ConsultaLR.xsd')
    expect(v.salida).toBe(v.ok ? v.salida : '')
    expect(v.ok).toBe(true)
    expect(con).toContain('<sf:FechaExpedicionFactura>06-10-2026</sf:FechaExpedicionFactura>')
    expect(con).toContain(`xmlns:con="${NS_CONSULTA}"`)
  })

  it('no acepta un periodo que no sea un mes ni una fecha sin formato', () => {
    expect(() => cuerpoConsultaPeriodo(obligado, 2026, '1T')).toThrow(/mes/)
    expect(() => cuerpoConsultaPeriodo(obligado, 2026, '13')).toThrow(/mes/)
    expect(() => cuerpoConsultaPeriodo(obligado, 2026, '10', { nif: 'B28000016', numSerie: 'A', fecha: '06/10/2026' })).toThrow(/AAAA-MM-DD/)
  })
})

describe('V03 · E3 · lo que contesta Hacienda', () => {
  it('el ejemplo es una respuesta válida según RespuestaConsultaLR.xsd (si no, la prueba no vale)', () => {
    const v = valida(pagina1, 'RespuestaConsultaLR.xsd')
    expect(v.salida).toBe(v.ok ? v.salida : '')
    expect(v.ok).toBe(true)
    expect(valida(respuesta('', 'N', 'SinDatos'), 'RespuestaConsultaLR.xsd').ok).toBe(true)
    expect(valida(pagina1.replace('>Correcto<', '>Correcta<'), 'RespuestaConsultaLR.xsd').ok).toBe(false)
    expect(valida(pagina1.replace(/<r:DatosPresentacion>[\s\S]*?<\/r:DatosPresentacion>/, (m) => m + m), 'RespuestaConsultaLR.xsd').ok).toBe(false)
  })

  it('lee cada factura con SU huella (no la de la anterior del encadenamiento), su estado y su error', () => {
    const p = leerRespuestaConsulta(sobre(pagina1))
    expect(p.conDatos).toBe(true)
    expect(p.hayMas).toBe(true)
    expect(p.clave).toEqual({ nif: 'B28000016', numSerie: 'A-2', fecha: '2026-10-06' })
    expect(p.facturas).toEqual([
      { num_serie: 'A-1', fecha: '2026-10-05', tipo_factura: 'F1', cuota_total: '21.00', importe_total: '121.00', huella: H1,
        estado: 'Correcto', codigo: null, descripcion: null, modificado: '2026-10-05T10:01:00+02:00' },
      { num_serie: 'A-2', fecha: '2026-10-06', tipo_factura: 'F1', cuota_total: '21.00', importe_total: '121.00', huella: H2,
        estado: 'AceptadoConErrores', codigo: 1100, descripcion: 'Valor o tipo incorrecto <Destinatario>', modificado: '2026-10-05T10:01:00+02:00' },
    ])
  })

  it('un mes sin facturas: sin datos, sin más páginas y sin clave', () => {
    expect(leerRespuestaConsulta(sobre(respuesta('', 'N', 'SinDatos')))).toEqual({ conDatos: false, hayMas: false, clave: null, facturas: [] })
  })

  it('un Fault es una consulta rechazada con su código; otra cosa, un error que lo dice', () => {
    const f = '<env:Envelope><env:Body><env:Fault><faultcode>env:Client</faultcode><faultstring>Codigo[4112].El titular del certificado debe ser Obligado Emision</faultstring></env:Fault></env:Body></env:Envelope>'
    expect(() => leerRespuestaConsulta(f)).toThrow(ConsultaRechazada)
    try { leerRespuestaConsulta(f) } catch (e) { expect((e as ConsultaRechazada).codigo).toBe(4112) }
    expect(() => leerRespuestaConsulta('<html>Forbidden</html>')).toThrow(/respuesta de consulta/)
  })
})
