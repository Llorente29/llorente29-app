// tests/unit/modules/conta/pc01/sepaRecibos.test.ts
//
// PC01 · Entrega 3 · El fichero de la remesa de RECIBOS (pain.008.001.02, CORE)
// contra su ESQUEMA OFICIAL ISO 20022 (tests/fixtures/sepa, procedencia en su
// README), con xmllint (xmllint-wasm), y el identificador de acreedor SEPA.
//
// Los recibos son los del tablero cobros-2 (aprobado por Julio el 25/10): tres
// clientes domiciliados, 2.340,00 €, a BBVA ···4417, con acentos y eñes.
// El identificador de acreedor se comprueba contra uno REAL: el de pruebas que
// publica el Bundesbank (DE98ZZZ09999999999), que sigue la misma regla.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { validateXML } from 'xmllint-wasm'
import { acreedorValido, ficheroRecibos, identificadorAcreedor, nombreFicheroRecibos, type DatosRemesaRecibos } from '@/modules/conta/lib/sepa'

const XSD = readFileSync('tests/fixtures/sepa/pain.008.001.02.xsd', 'utf8')
const valida = async (xml: string) => validateXML({ xml: [{ fileName: 'recibos.xml', contents: xml }], schema: [XSD] })

const REMESA: DatosRemesaRecibos = {
  codigo: 'C-2026/009', fechaCargo: '2026-10-01', creado: '2026-09-29T08:00:00.000Z',
  acreedor: { nombre: 'Llorente29 Food SL', nif: 'B12345678', iban: 'ES21 0182 0000 0000 0000 4417', bic: null, sufijo: null },
  recibos: [
    { id: 'l1', importe: 432, iban: 'ES9121000418450200051332', bic: null, nombre: 'Club Deportivo Vallecas', mandato: 'SUM-000123', firmado: '2026-09-03', primero: false, factura: 'F-2026/0071', fechaFactura: '2026-09-25' },
    { id: 'l2', importe: 660, iban: 'ES7921000813610123456789', bic: 'BBVAESMMXXX', nombre: 'Academia de Baile Lavapiés', mandato: 'SUM-000131', firmado: '2026-09-10', primero: true, factura: 'A-2026/0007', fechaFactura: '2026-09-26' },
    { id: 'l3', importe: 1248, iban: 'ES6621000418401234567891', bic: null, nombre: 'Colegio Nuestra Señora del Pilar', mandato: 'SUM-000140', firmado: '2026-09-12', primero: true, factura: 'A-2026/0008', fechaFactura: null },
  ],
}

describe('el identificador de acreedor SEPA', () => {
  it('la regla cuadra con un identificador real (el de pruebas del Bundesbank)', () => {
    expect(acreedorValido('DE98ZZZ09999999999')).toBe(true)
    expect(acreedorValido('DE97ZZZ09999999999')).toBe(false)
  })
  it('el de una empresa española: ES, control, sufijo y NIF; y se valida a sí mismo', () => {
    const id = identificadorAcreedor('B12345678')
    expect(id).toMatch(/^ES\d{2}000B12345678$/)
    expect(acreedorValido(id)).toBe(true)
    expect(identificadorAcreedor('es-b12345678', '001')).toBe(`${id.slice(0, 4)}001B12345678`)
    expect(acreedorValido('ES00000B12345678')).toBe(false)
  })
  it('sin un NIF que valga no se inventa ninguno', () => {
    expect(() => identificadorAcreedor('123')).toThrow('no tiene la forma de un NIF')
  })
})

describe('el fichero de la remesa de recibos', () => {
  it('valida contra el esquema oficial pain.008.001.02', async () => {
    const r = await valida(ficheroRecibos(REMESA))
    expect(r.errors.map((e) => e.message)).toEqual([])
    expect(r.valid).toBe(true)
  })
  it('el esquema caza un fichero roto (la prueba no es un espejo)', async () => {
    const roto = ficheroRecibos(REMESA).replace(/\s*<ReqdColltnDt>[^<]*<\/ReqdColltnDt>/g, '')
    expect((await valida(roto)).valid).toBe(false)
  })
  it('primeros y recurrentes van en bloques separados, con sus sumas; el total, 2.340,00', () => {
    const x = ficheroRecibos(REMESA)
    expect(x).toContain('<CtrlSum>2340.00</CtrlSum>')
    expect(x).toMatch(/<SeqTp>FRST<\/SeqTp>[\s\S]*<SeqTp>RCUR<\/SeqTp>/)
    expect(x.match(/<PmtInf>/g)).toHaveLength(2)
    expect(x).toContain('<NbOfTxs>2</NbOfTxs>\n      <CtrlSum>1908.00</CtrlSum>')
    expect(x).toContain('<NbOfTxs>1</NbOfTxs>\n      <CtrlSum>432.00</CtrlSum>')
    expect(x).toContain(`<CdtrSchmeId><Id><PrvtId><Othr><Id>${identificadorAcreedor('B12345678')}</Id>`)
  })
  it('cada recibo lleva su mandato y su fecha de firma; los nombres, sin acentos ni eñes', () => {
    const x = ficheroRecibos(REMESA)
    expect(x).toContain('<MndtId>SUM-000123</MndtId><DtOfSgntr>2026-09-03</DtOfSgntr>')
    expect(x).toContain('<Nm>Colegio Nuestra Senora del Pilar</Nm>')
    expect(x).toContain('<Nm>Academia de Baile Lavapies</Nm>')
    expect(x).not.toMatch(/[ñáéíóú]/i)
  })
  it('todos recurrentes: un solo bloque', async () => {
    const x = ficheroRecibos({ ...REMESA, recibos: REMESA.recibos.map((r) => ({ ...r, primero: false })) })
    expect(x.match(/<PmtInf>/g)).toHaveLength(1)
    expect((await valida(x)).valid).toBe(true)
  })
  it('sin recibos no hay fichero; el nombre del fichero sin barras', () => {
    expect(() => ficheroRecibos({ ...REMESA, recibos: [] })).toThrow('no tiene recibos')
    expect(nombreFicheroRecibos('C-2026/009')).toBe('recibos-C-2026-009.xml')
  })
})
