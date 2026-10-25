// tests/unit/modules/conta/v03/respuesta.test.ts
//
// V03 · E1 · Lo que contesta Hacienda, leído. La respuesta de ejemplo se VALIDA
// PRIMERO contra el XSD oficial (RespuestaSuministro.xsd, con xmllint): si no
// valida, la prueba no mide nada, porque estaría leyendo un XML inventado a la
// medida del lector.

import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EnvioRechazado, leerRespuesta, RespuestaIlegible } from '../../../../../supabase/functions/_shared/verifactu/respuesta'
import type { Registro } from '../../../../../supabase/functions/_shared/verifactu/xml'

const raiz = resolve(__dirname, '../../../../..')
const XSD = join(raiz, 'docs/conta/v03/aeat/RespuestaSuministro.xsd')
const CATALOGO = join(raiz, 'tests/unit/modules/conta/v03/xsd/catalogo.xml')

function valida(xml: string): boolean {
  const f = join(mkdtempSync(join(tmpdir(), 'v03-resp-')), 'r.xml')
  writeFileSync(f, xml)
  const r = spawnSync('xmllint', ['--nonet', '--noout', '--schema', XSD, f], { encoding: 'utf8', env: { ...process.env, XML_CATALOG_FILES: CATALOGO } })
  if (r.error) throw r.error
  return r.status === 0
}

const BASE = 'https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/'
const linea = (num: string, op: 'Alta' | 'Anulacion', estado: string, extra = '') =>
  `<tikR:RespuestaLinea><tikR:IDFactura><tik:IDEmisorFactura>B28000016</tik:IDEmisorFactura><tik:NumSerieFactura>${num}</tik:NumSerieFactura>`
  + `<tik:FechaExpedicionFactura>25-10-2026</tik:FechaExpedicionFactura></tikR:IDFactura><tikR:Operacion><tik:TipoOperacion>${op}</tik:TipoOperacion></tikR:Operacion>`
  + `<tikR:EstadoRegistro>${estado}</tikR:EstadoRegistro>${extra}</tikR:RespuestaLinea>`

const cuerpo = (lineas: string, estado = 'ParcialmenteCorrecto') =>
  `<tikR:RespuestaRegFactuSistemaFacturacion xmlns:tikR="${BASE}RespuestaSuministro.xsd" xmlns:tik="${BASE}SuministroInformacion.xsd">`
  + `<tikR:CSV>A-ABCDEFGHIJKLMN</tikR:CSV>`
  + `<tikR:Cabecera><tik:ObligadoEmision><tik:NombreRazon>Restaurante Prueba V03 SL</tik:NombreRazon><tik:NIF>B28000016</tik:NIF></tik:ObligadoEmision></tikR:Cabecera>`
  + `<tikR:TiempoEsperaEnvio>120</tikR:TiempoEsperaEnvio><tikR:EstadoEnvio>${estado}</tikR:EstadoEnvio>${lineas}</tikR:RespuestaRegFactuSistemaFacturacion>`

const sobre = (c: string) => `<?xml version="1.0" encoding="UTF-8"?><env:Envelope xmlns:env="http://schemas.xmlsoap.org/soap/envelope/"><env:Header/><env:Body>${c}</env:Body></env:Envelope>`

const reg = (id: string, num: string, tipo: 'alta' | 'anulacion' = 'alta') => ({ id, num_serie: num, fecha_expedicion: '2026-10-25', tipo } as Registro)
const REGS = [reg('r1', 'F-2026/000001'), reg('r2', 'F-2026/000002'), reg('r3', 'F-2026/000003'), reg('r4', 'F-2026/000004'), reg('r5', 'F-2026/000001', 'anulacion')]

const LINEAS = linea('F-2026/000001', 'Alta', 'Correcto')
  + linea('F-2026/000002', 'Alta', 'AceptadoConErrores', '<tikR:CodigoErrorRegistro>2005</tikR:CodigoErrorRegistro><tikR:DescripcionErrorRegistro>Aviso &amp; corrección</tikR:DescripcionErrorRegistro>')
  + linea('F-2026/000003', 'Alta', 'Incorrecto', '<tikR:CodigoErrorRegistro>1189</tikR:CodigoErrorRegistro><tikR:DescripcionErrorRegistro>Si TipoFactura es F1 el bloque Destinatarios tiene que estar cumplimentado.</tikR:DescripcionErrorRegistro>')
  + linea('F-2026/000004', 'Alta', 'Incorrecto', '<tikR:CodigoErrorRegistro>3000</tikR:CodigoErrorRegistro><tikR:DescripcionErrorRegistro>Registro de facturación duplicado.</tikR:DescripcionErrorRegistro>'
    + '<tikR:RegistroDuplicado><tik:IdPeticionRegistroDuplicado>202610250001</tik:IdPeticionRegistroDuplicado><tik:EstadoRegistroDuplicado>Correcta</tik:EstadoRegistroDuplicado>'
    + '<tik:CodigoErrorRegistro>9999</tik:CodigoErrorRegistro></tikR:RegistroDuplicado>')
  + linea('F-2026/000001', 'Anulacion', 'Correcto')

describe('V03 · lo que contesta Hacienda', () => {
  it('el ejemplo es una respuesta válida según el XSD oficial (y uno roto no lo es)', () => {
    expect(valida(cuerpo(LINEAS))).toBe(true)
    expect(valida(cuerpo(LINEAS).replace('<tikR:TiempoEsperaEnvio>120</tikR:TiempoEsperaEnvio>', ''))).toBe(false)
  })

  it('cada línea con su registro, su estado, su código y su texto', () => {
    const l = leerRespuesta(sobre(cuerpo(LINEAS)), REGS)
    expect(l.estado_envio).toBe('ParcialmenteCorrecto')
    expect(l.tiempo_espera_s).toBe(120)
    expect(l.csv).toBe('A-ABCDEFGHIJKLMN')
    expect(l.sin_casar).toBe(0)
    expect(l.registros).toEqual([
      { id: 'r1', estado: 'Correcto', codigo: null, descripcion: null },
      { id: 'r2', estado: 'AceptadoConErrores', codigo: 2005, descripcion: 'Aviso & corrección' },
      { id: 'r3', estado: 'Incorrecto', codigo: 1189, descripcion: 'Si TipoFactura es F1 el bloque Destinatarios tiene que estar cumplimentado.' },
      // 3000: ya estaba en Hacienda, «Correcta»: no es un rechazo. Y el 9999 del duplicado no se cuela.
      { id: 'r4', estado: 'Correcto', codigo: 3000, descripcion: 'Registro de facturación duplicado.' },
      // El alta y la anulación de la MISMA factura se distinguen por la operación.
      { id: 'r5', estado: 'Correcto', codigo: null, descripcion: null },
    ])
  })

  it('una línea que no es de este envío no se casa con ninguno', () => {
    const l = leerRespuesta(sobre(cuerpo(linea('F-2026/000099', 'Alta', 'Correcto'), 'Correcto')), REGS)
    expect(l.registros).toEqual([])
    expect(l.sin_casar).toBe(1)
  })

  it('el envío entero rechazado (Fault) se dice con su código', () => {
    const f = sobre('<env:Fault><faultcode>env:Client</faultcode><faultstring>Codigo[4102].El XML no cumple el esquema. Falta informar campo obligatorio.: Huella</faultstring></env:Fault>')
    let e: unknown
    try { leerRespuesta(f, REGS) } catch (x) { e = x }
    expect(e).toBeInstanceOf(EnvioRechazado)
    expect((e as EnvioRechazado).codigo).toBe(4102)
  })

  it('lo que no es una respuesta no se da por respondido', () => {
    expect(() => leerRespuesta('<html>Servicio no disponible</html>', REGS)).toThrow(RespuestaIlegible)
  })
})
