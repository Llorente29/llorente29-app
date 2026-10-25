// tests/unit/modules/conta/v03/enviar.test.ts
//
// V03 · E1 · Una vuelta de la cola, con dobles de la base y de Hacienda: lo que
// contesta se guarda, lo que no se puede enviar vuelve a la cola, y un envío
// entero rechazado no marca las facturas como incorrectas.

import { describe, expect, it } from 'vitest'
import { type Lote, type Piezas, unaVuelta } from '../../../../../supabase/functions/_shared/verifactu/enviar'
import type { Registro } from '../../../../../supabase/functions/_shared/verifactu/xml'
import { puerta } from '../../../../../supabase/functions/_shared/verifactu/puerta'
import { casosPruebas } from '../../../../../supabase/functions/_shared/verifactu/pruebasAeat'
import { cuerpoEnvio } from '../../../../../supabase/functions/_shared/verifactu/xml'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const RAIZ = resolve(__dirname, '../../../../..')
function validarXml(xml: string): boolean {
  const f = join(mkdtempSync(join(tmpdir(), 'v03-casos-')), 'e.xml')
  writeFileSync(f, xml)
  const r = spawnSync('xmllint', ['--nonet', '--noout', '--schema', join(RAIZ, 'docs/conta/v03/aeat/SuministroLR.xsd'), f],
    { encoding: 'utf8', env: { ...process.env, XML_CATALOG_FILES: join(RAIZ, 'tests/unit/modules/conta/v03/xsd/catalogo.xml') } })
  if (r.error) throw r.error
  if (r.status !== 0) console.error(r.stderr)
  return r.status === 0
}

const BASE = 'https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/'
const reg = (n: number): Registro => ({
  id: `r${n}`, tipo: 'alta', subsanacion: false, rechazo_previo: null, sin_registro_previo: false,
  nif_emisor: 'B28000016', nombre_emisor: 'Restaurante Prueba V03 SL', num_serie: `F-2026/00000${n}`, fecha_expedicion: '2026-10-25', fecha_operacion: null,
  tipo_factura: 'F1', tipo_rectificativa: null, rectificadas: null, descripcion: 'Menú', destinatarios: [{ nombre: 'Colegio', nif: '12345678Z' }],
  desglose: [{ impuesto: '01', clave_regimen: '01', calificacion: 'S1', tipo: 21, base: 10, cuota: 2.1 }], cuota_total: 2.1, importe_total: 12.1,
  primer_registro: n === 1, anterior_num_serie: n === 1 ? null : `F-2026/00000${n - 1}`, anterior_fecha: n === 1 ? null : '2026-10-25',
  huella_anterior: n === 1 ? null : 'A'.repeat(64), fecha_hora_huso: '2026-10-25T23:10:00+01:00', huella: 'B'.repeat(64),
})

const respuesta = (lineas: string) => `<env:Envelope xmlns:env="http://schemas.xmlsoap.org/soap/envelope/"><env:Body>`
  + `<tikR:RespuestaRegFactuSistemaFacturacion xmlns:tikR="${BASE}RespuestaSuministro.xsd" xmlns:tik="${BASE}SuministroInformacion.xsd">`
  + `<tikR:CSV>A-CSV</tikR:CSV><tikR:Cabecera/><tikR:TiempoEsperaEnvio>60</tikR:TiempoEsperaEnvio><tikR:EstadoEnvio>ParcialmenteCorrecto</tikR:EstadoEnvio>${lineas}`
  + `</tikR:RespuestaRegFactuSistemaFacturacion></env:Body></env:Envelope>`
const linea = (n: number, estado: string) => `<tikR:RespuestaLinea><tikR:IDFactura><tik:IDEmisorFactura>B28000016</tik:IDEmisorFactura>`
  + `<tik:NumSerieFactura>F-2026/00000${n}</tik:NumSerieFactura><tik:FechaExpedicionFactura>25-10-2026</tik:FechaExpedicionFactura></tikR:IDFactura>`
  + `<tikR:Operacion><tik:TipoOperacion>Alta</tik:TipoOperacion></tikR:Operacion><tikR:EstadoRegistro>${estado}</tikR:EstadoRegistro></tikR:RespuestaLinea>`

function dobles(lotes: Lote[], contesta: (xml: string) => { status: number; cuerpo: string } | Error) {
  const hecho = { respuestas: [] as { id: string; p: Record<string, unknown> }[], fallos: [] as { id: string; e: string }[], xml: [] as string[] }
  const p: Piezas = {
    tomar: async () => lotes.shift() ?? null,
    responder: async (id, x) => { hecho.respuestas.push({ id, p: x }) },
    fallar: async (id, e) => { hecho.fallos.push({ id, e }) },
    material: async () => ({ cert: 'CERT', key: 'KEY' }),
    llamar: async (_u, xml) => { hecho.xml.push(xml); const c = contesta(xml); if (c instanceof Error) throw c; return { ...c, ms: 5 } },
    sistema: { nombreRazon: 'P', nif: 'B12345674', nombre: 'Sumied', id: 'SU', version: '1', numeroInstalacion: 'x' },
    url: 'https://prewww1.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP',
  }
  return { p, hecho }
}

describe('V03 · una vuelta de la cola', () => {
  it('lo que contesta Hacienda se guarda, y lo que no contesta vuelve', async () => {
    const { p, hecho } = dobles([{ envio_id: 'e1', entorno: 'pruebas', nif_emisor: 'B28000016', company_id: 'c', registros: [reg(1), reg(2), reg(3)] }],
      () => ({ status: 200, cuerpo: respuesta(linea(1, 'Correcto') + linea(2, 'Incorrecto')) }))
    const r = await unaVuelta(p, 'pruebas')
    expect(r).toMatchObject({ envios: 1, registros: 3, correctos: 1, incorrectos: 1, vuelven: 1, fallos: [] })
    expect(hecho.respuestas[0].p).toMatchObject({ http_status: 200, estado_envio: 'ParcialmenteCorrecto', tiempo_espera_s: 60, csv: 'A-CSV' })
    expect((hecho.respuestas[0].p.registros as unknown[]).length).toBe(2)
    expect(hecho.xml[0]).toContain('<sf:NIF>B28000016</sf:NIF>')
  })

  it('sin conexión, vuelve a la cola entero', async () => {
    const e = Object.assign(new Error('Hacienda no ha contestado en 30 s.'), { name: 'LlamadaFallida', motivo: 'tiempo' })
    const { p, hecho } = dobles([{ envio_id: 'e1', entorno: 'pruebas', nif_emisor: 'B28000016', company_id: 'c', registros: [reg(1)] }], () => e)
    const r = await unaVuelta(p, 'pruebas')
    expect(r).toMatchObject({ envios: 1, vuelven: 1, fallos: [{ envio_id: 'e1', motivo: 'llamada_tiempo' }] })
    expect(hecho.respuestas).toEqual([])
    expect(hecho.fallos[0].e).toMatch(/30 s/)
  })

  it('un envío entero rechazado no marca las facturas: vuelve a la cola con su código', async () => {
    const { p, hecho } = dobles([{ envio_id: 'e1', entorno: 'pruebas', nif_emisor: 'B28000016', company_id: 'c', registros: [reg(1)] }],
      () => ({ status: 500, cuerpo: '<env:Envelope xmlns:env="x"><env:Body><env:Fault><faultstring>Codigo[4104].Error en la cabecera</faultstring></env:Fault></env:Body></env:Envelope>' }))
    const r = await unaVuelta(p, 'pruebas')
    expect(r.fallos).toEqual([{ envio_id: 'e1', motivo: 'rechazado_4104' }])
    expect(hecho.respuestas).toEqual([])
  })

  it('para cuando no queda nada que el flujo deje enviar, y no pasa de su tope', async () => {
    const l = (i: number): Lote => ({ envio_id: `e${i}`, entorno: 'pruebas', nif_emisor: 'B28000016', company_id: 'c', registros: [reg(1)] })
    const { p } = dobles([l(1), l(2), l(3)], () => ({ status: 200, cuerpo: respuesta(linea(1, 'Correcto')) }))
    expect((await unaVuelta(p, 'pruebas', 2)).envios).toBe(2)
    expect((await unaVuelta(p, 'pruebas', 5)).envios).toBe(1)
    expect((await unaVuelta(p, 'pruebas', 5)).envios).toBe(0)
  })
})

describe('V03 · la puerta de conta-verifactu', () => {
  const STAGING = 'https://oseymswjlzplqoxrfjzi.supabase.co'
  const PROD = 'https://xzmpnchlguibclvxyynt.supabase.co'
  it('cerrada si no se dice nada, o si se dice otra cosa', () => {
    expect(puerta(undefined, STAGING)).toEqual({ cerrada: 'CONTA_VERIFACTU sin poner' })
    expect(puerta('si', PROD)).toEqual({ cerrada: 'CONTA_VERIFACTU sin poner' })
  })
  it('pruebas solo desde staging; real solo desde producción', () => {
    expect(puerta('pruebas', STAGING)).toEqual({ entorno: 'pruebas' })
    expect(puerta('pruebas', PROD)).toHaveProperty('cerrada')
    expect(puerta('real', PROD)).toEqual({ entorno: 'real' })
    expect(puerta('real', STAGING)).toHaveProperty('cerrada')
  })
})

describe('V03 · las facturas contra la AEAT de pruebas', () => {
  const B = { account_id: 'a', company_id: 'c', nif_emisor: 'B28000016', nombre_emisor: 'Pruebas V03', prefijo: 'PR2610252301', fecha: '2026-10-25' }
  const { altas, anular } = casosPruebas(B)
  it('son 24 altas y una anulación: 25, con una rectificativa y una de fuera de la UE', () => {
    expect(altas.length + 1).toBe(25)
    expect(altas.filter((c) => c.p.tipo_factura === 'R4')).toHaveLength(1)
    expect(altas.filter((c) => (c.p.destinatarios as { id_type?: string }[] | undefined)?.[0]?.id_type === '04')).toHaveLength(1)
    expect(altas[anular].p.tipo_factura).toBe('F1')
  })
  it('cada alta cuadra: el total es base + cuotas, y los números no se repiten', () => {
    for (const c of altas) {
      const d = c.p.desglose as { base: number; cuota: number; cuota_recargo?: number }[]
      const base = d.reduce((t, l) => t + l.base, 0), cuota = d.reduce((t, l) => t + l.cuota + (l.cuota_recargo ?? 0), 0)
      expect(Math.round((base + cuota) * 100)).toBe(Math.round(Number(c.p.importe_total) * 100))
      expect(Math.round(cuota * 100)).toBe(Math.round(Number(c.p.cuota_total) * 100))
      expect(String(c.p.num_serie)).toMatch(/^[ !#-&(-;?-~]{1,60}$/)
    }
    expect(new Set(altas.map((c) => c.p.num_serie)).size).toBe(altas.length)
  })
  it('y todas valen como mensaje: validan contra el XSD (con su cadena puesta)', () => {
    const regs = altas.map((c, i) => ({
      ...c.p, id: String(i), subsanacion: false, rechazo_previo: null, sin_registro_previo: false, fecha_operacion: null,
      tipo_rectificativa: c.p.tipo_rectificativa ?? null, rectificadas: c.p.rectificadas ?? null, destinatarios: c.p.destinatarios ?? null,
      primer_registro: i === 0, anterior_num_serie: i === 0 ? null : String(altas[i - 1].p.num_serie), anterior_fecha: i === 0 ? null : '2026-10-25',
      huella_anterior: i === 0 ? null : 'A'.repeat(64), fecha_hora_huso: '2026-10-25T23:10:00+01:00', huella: 'B'.repeat(64),
    })) as unknown as Registro[]
    const xml = cuerpoEnvio({ nombre: 'Pruebas V03', nif: 'B28000016' }, regs, { nombreRazon: 'P', nif: 'B12345674', nombre: 'Sumied', id: 'SU', version: '1', numeroInstalacion: 'x' })
    expect(validarXml(xml)).toBe(true)
  })
})
