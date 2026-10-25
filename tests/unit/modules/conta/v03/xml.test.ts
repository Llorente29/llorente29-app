// tests/unit/modules/conta/v03/xml.test.ts
//
// V03 · E1 · El mensaje de alta y anulación, VALIDADO CONTRA LOS XSD OFICIALES
// de la AEAT (docs/conta/v03/aeat, bajados por la sonda el 25/10) con xmllint.
// La firma XML del W3C, que los XSD importan para algo opcional que VERI*FACTU
// no usa, se sustituye por un esquema mínimo local (xsd/xmldsig-stub.xsd) para
// validar sin red.
//
// Los registros son los casos de la E1: el primero de la cadena, una F1
// encadenada, un cliente de Suiza (IDOtro 04), una N2, una rectificativa R4 y
// una anulación. La huella y la cadena son las de la base (huella.ts las da
// igual que _verifactu_registrar, probado con los ejemplos oficiales).

import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  cuerpoEnvio, dosDecimales, fechaXml, type Registro, RegistroNoValido, sobreEnvio, type SistemaInformatico,
} from '../../../../../supabase/functions/_shared/verifactu/xml'

const raiz = resolve(__dirname, '../../../../..')
const XSD = join(raiz, 'docs/conta/v03/aeat/SuministroLR.xsd')
const CATALOGO = join(raiz, 'tests/unit/modules/conta/v03/xsd/catalogo.xml')

function validar(xml: string): { ok: boolean; salida: string } {
  const d = mkdtempSync(join(tmpdir(), 'v03-xml-'))
  const f = join(d, 'envio.xml')
  writeFileSync(f, xml)
  const r = spawnSync('xmllint', ['--nonet', '--noout', '--schema', XSD, f], {
    encoding: 'utf8', env: { ...process.env, XML_CATALOG_FILES: CATALOGO },
  })
  if (r.error) throw r.error // sin xmllint la prueba falla, no se salta
  return { ok: r.status === 0, salida: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

const SIF: SistemaInformatico = {
  nombreRazon: 'Productor de prueba SL', nif: 'B12345674', nombre: 'Sumied', id: 'SU', version: '1.0.0', numeroInstalacion: 'staging-1',
}
const OBLIGADO = { nombre: 'Restaurante Prueba V03 SL', nif: 'B28000016' }
const H = (c: string) => c.repeat(64).slice(0, 64)

const base: Omit<Registro, 'id' | 'num_serie' | 'huella'> = {
  tipo: 'alta', subsanacion: false, rechazo_previo: null, sin_registro_previo: false,
  nif_emisor: 'B28000016', nombre_emisor: 'Restaurante Prueba V03 SL', fecha_expedicion: '2026-10-25', fecha_operacion: null,
  tipo_factura: 'F1', tipo_rectificativa: null, rectificadas: null, descripcion: 'Menú comedor · 10 ud',
  destinatarios: [{ nombre: 'Colegio Prueba V03', nif: '12345678Z' }],
  desglose: [{ impuesto: '01', clave_regimen: '01', calificacion: 'S1', tipo: 21, base: 100, cuota: 21 }],
  cuota_total: 21, importe_total: 121, primer_registro: false, anterior_num_serie: 'F-2026/000001', anterior_fecha: '2026-10-25',
  huella_anterior: H('A'), fecha_hora_huso: '2026-10-25T23:10:00+01:00',
}

const CASOS: Registro[] = [
  { ...base, id: '1', num_serie: 'F-2026/000001', huella: H('A'), primer_registro: true, anterior_num_serie: null, anterior_fecha: null, huella_anterior: null },
  { ...base, id: '2', num_serie: 'F-2026/000002', huella: H('B') },
  { ...base, id: '3', num_serie: 'F-2026/000003', huella: H('C'), anterior_num_serie: 'F-2026/000002', huella_anterior: H('B'),
    descripcion: 'Menú de empresa (evento) & café', importe_total: 726, cuota_total: 126,
    destinatarios: [{ nombre: 'Alpen Gastro AG <prueba>', codigo_pais: 'CH', id_type: '04', id: 'CHE123456789' }],
    desglose: [{ impuesto: '01', clave_regimen: '01', calificacion: 'S1', tipo: 21, base: 600, cuota: 126 }] },
  { ...base, id: '4', num_serie: 'F-2026/000004', huella: H('D'), anterior_num_serie: 'F-2026/000003', huella_anterior: H('C'),
    importe_total: 2150, cuota_total: 0, destinatarios: [{ nombre: 'Alpen Gastro AG', codigo_pais: 'CH', id_type: '04', id: 'CHE123456789' }],
    desglose: [{ impuesto: '01', clave_regimen: '01', calificacion: 'N2', base: 2150 }] },
  { ...base, id: '5', num_serie: 'R-2026/000001', huella: H('E'), anterior_num_serie: 'F-2026/000004', huella_anterior: H('D'),
    tipo_factura: 'R4', tipo_rectificativa: 'I', rectificadas: [{ nif: 'ESB28000016', num_serie: 'F-2026/000002', fecha: '2026-10-25' }],
    descripcion: 'Un menú de menos', importe_total: -12.1, cuota_total: -2.1,
    desglose: [{ impuesto: '01', clave_regimen: '01', calificacion: 'S1', tipo: 21, base: -10, cuota: -2.1, tipo_recargo: 5.2, cuota_recargo: 0 }] },
  { ...base, id: '6', tipo: 'anulacion', num_serie: 'F-2026/000002', huella: H('F'), anterior_num_serie: 'R-2026/000001', huella_anterior: H('E'),
    tipo_factura: null, desglose: null, cuota_total: null, importe_total: null, destinatarios: null, descripcion: null },
]

describe('V03 · el mensaje a Hacienda', () => {
  it('los formatos: fecha DD-MM-AAAA e importes con dos decimales y punto', () => {
    expect(fechaXml('2026-10-25')).toBe('25-10-2026')
    expect(dosDecimales(121)).toBe('121.00')
    expect(dosDecimales('-12.1')).toBe('-12.10')
    expect(() => fechaXml('25/10/2026')).toThrow()
  })

  it('un envío con los seis casos valida contra los XSD oficiales', () => {
    const r = validar(sobreEnvio(OBLIGADO, CASOS, SIF).replace(/^[\s\S]*<soapenv:Body>|<\/soapenv:Body>[\s\S]*$/g, ''))
    expect(r.salida).toMatch(/validates/)
    expect(r.ok).toBe(true)
  })

  it('y la validación puede fallar: un elemento fuera de su sitio no pasa', () => {
    const xml = cuerpoEnvio(OBLIGADO, [CASOS[1]], SIF)
    const mal = xml.replace(/(<sf:TipoFactura>F1<\/sf:TipoFactura>)(<sf:DescripcionOperacion>[^<]*<\/sf:DescripcionOperacion>)/, '$2$1')
    expect(mal).not.toBe(xml)
    expect(validar(mal).ok).toBe(false)
  })

  it('lo que entra en la huella va tal cual: número, fecha, tipo, cuota, importe, anterior, hora', () => {
    const xml = cuerpoEnvio(OBLIGADO, [CASOS[1]], SIF)
    for (const trozo of ['<sf:NumSerieFactura>F-2026/000002</sf:NumSerieFactura>', '<sf:FechaExpedicionFactura>25-10-2026</sf:FechaExpedicionFactura>',
      '<sf:TipoFactura>F1</sf:TipoFactura>', '<sf:CuotaTotal>21.00</sf:CuotaTotal>', '<sf:ImporteTotal>121.00</sf:ImporteTotal>',
      `<sf:Huella>${H('A')}</sf:Huella></sf:RegistroAnterior>`, '<sf:FechaHoraHusoGenRegistro>2026-10-25T23:10:00+01:00</sf:FechaHoraHusoGenRegistro>',
      `<sf:TipoHuella>01</sf:TipoHuella><sf:Huella>${H('B')}</sf:Huella>`]) {
      expect(xml).toContain(trozo)
    }
  })

  it('el texto del cliente se escapa', () => {
    const xml = cuerpoEnvio(OBLIGADO, [CASOS[2]], SIF)
    expect(xml).toContain('Alpen Gastro AG &lt;prueba&gt;')
    expect(xml).toContain('Menú de empresa (evento) &amp; café')
  })

  it('no se envía lo que no está completo, ni registros de otro obligado', () => {
    expect(() => cuerpoEnvio(OBLIGADO, [{ ...CASOS[1], anterior_num_serie: null }], SIF)).toThrow(RegistroNoValido)
    expect(() => cuerpoEnvio(OBLIGADO, [{ ...CASOS[1], desglose: [] }], SIF)).toThrow(RegistroNoValido)
    expect(() => cuerpoEnvio(OBLIGADO, [{ ...CASOS[1], nif_emisor: 'A12345674' }], SIF)).toThrow(RegistroNoValido)
    expect(() => cuerpoEnvio(OBLIGADO, [], SIF)).toThrow()
  })
})
