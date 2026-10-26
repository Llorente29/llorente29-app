// tests/unit/modules/conta/pc01/sepa.test.ts
//
// PC01 · Entrega 2 · El fichero de la remesa de transferencias (pain.001.001.03)
// contra su ESQUEMA OFICIAL ISO 20022 (tests/fixtures/sepa, con su procedencia
// en el README de esa carpeta), con xmllint (xmllint-wasm: el mismo libxml2,
// sin depender de lo que tenga instalado la máquina).
//
// Los pagos son los del tablero 16 («pagos_2», aprobado por Julio el 25/10):
// tres facturas, 4.218,40 €, desde BBVA ···4417, con nombres con acentos, eñes
// y un «&», que el banco no admite tal cual.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { validateXML } from 'xmllint-wasm'
import { ficheroTransferencias, idSepa, importeSepa, nombreFicheroRemesa, textoSepa, type DatosRemesaSepa } from '@/modules/conta/lib/sepa'

const XSD = readFileSync('tests/fixtures/sepa/pain.001.001.03.xsd', 'utf8')
const valida = async (xml: string) => validateXML({ xml: [{ fileName: 'remesa.xml', contents: xml }], schema: [XSD] })

const REMESA: DatosRemesaSepa = {
  codigo: 'R-2026/014', fechaPago: '2026-10-28', creado: '2026-10-25T07:12:00.000Z',
  ordenante: { nombre: 'Llorente29 Food SL', nif: 'B12345678', iban: 'ES21 0182 0000 0000 0000 4417', bic: null },
  pagos: [
    { id: 'l1', importe: 1105.30, iban: 'ES9121000418450200051332', bic: 'BBVAESMMXXX', nombre: 'Distribuciones Cárnicas Vallecas SL', factura: 'DCV-2026/1184', fechaFactura: '2026-10-05' },
    { id: 'l2', importe: 642.80, iban: 'ES7921000813610123456789', bic: null, nombre: 'Panadería Hermanos Ruiz & Hijos', factura: 'A-3391', fechaFactura: '2026-10-12' },
    { id: 'l3', importe: 2470.30, iban: 'ES6621000418401234567891', bic: null, nombre: 'Bebidas del Centro SA', factura: 'FV26-08812', fechaFactura: null },
  ],
}

describe('el fichero de la remesa de transferencias', () => {
  it('valida contra el esquema oficial pain.001.001.03', async () => {
    const r = await valida(ficheroTransferencias(REMESA))
    expect(r.errors.map((e) => e.message)).toEqual([])
    expect(r.valid).toBe(true)
  })

  it('el esquema caza un fichero roto (la prueba no es un espejo)', async () => {
    const roto = ficheroTransferencias(REMESA).replace(/\s*<ReqdExctnDt>[^<]*<\/ReqdExctnDt>/, '')
    const r = await valida(roto)
    expect(r.valid).toBe(false)
    expect(r.errors[0].message).toMatch(/ReqdExctnDt|Dbtr/)
  })

  it('suma y cuenta al céntimo, en la cabecera y en el lote', () => {
    const x = ficheroTransferencias(REMESA)
    expect(x.match(/<NbOfTxs>3<\/NbOfTxs>/g)).toHaveLength(2)
    expect(x.match(/<CtrlSum>4218\.40<\/CtrlSum>/g)).toHaveLength(2)
    expect(x).toContain('<InstdAmt Ccy="EUR">642.80</InstdAmt>')
    expect(x).toContain('<ReqdExctnDt>2026-10-28</ReqdExctnDt>')
    expect(x).toContain('<CreDtTm>2026-10-25T07:12:00</CreDtTm>')
  })

  it('el nombre del ordenante y su NIF con el sufijo del banco; el IBAN sin espacios; sin BIC, NOTPROVIDED', () => {
    const x = ficheroTransferencias(REMESA)
    expect(x).toContain('<Othr><Id>B12345678000</Id></Othr>')
    expect(x).toContain('<DbtrAcct><Id><IBAN>ES2101820000000000004417</IBAN></Id></DbtrAcct>')
    expect(x).toMatch(/<DbtrAgt>\s*<FinInstnId><Othr><Id>NOTPROVIDED<\/Id><\/Othr><\/FinInstnId>\s*<\/DbtrAgt>/)
    // Con BIC del proveedor, su banco; sin él, no se pone.
    expect(x).toContain('<FinInstnId><BIC>BBVAESMMXXX</BIC></FinInstnId>')
    expect(x.match(/<CdtrAgt>/g)).toHaveLength(1)
  })

  it('el mismo identificador de mensaje para la misma remesa: el banco rechaza el fichero subido dos veces', () => {
    const a = ficheroTransferencias(REMESA)
    const b = ficheroTransferencias({ ...REMESA, creado: '2026-10-26T10:00:00.000Z' })
    const msg = (x: string) => x.match(/<MsgId>([^<]+)<\/MsgId>/)?.[1]
    expect(msg(a)).toBe('SUMIED-R-2026/014')
    expect(msg(b)).toBe(msg(a))
  })

  it('el concepto lleva el número de la factura y su fecha', () => {
    const x = ficheroTransferencias(REMESA)
    expect(x).toContain('<Ustrd>Factura DCV-2026/1184 de 05/10/2026</Ustrd>')
    expect(x).toContain('<Ustrd>Factura FV26-08812</Ustrd>')
  })

  it('sin pagos, no hay fichero', () => {
    expect(() => ficheroTransferencias({ ...REMESA, pagos: [] })).toThrow('La remesa no tiene pagos.')
  })
})

describe('el juego de caracteres del banco', () => {
  it('sin acentos, la ñ a n, el & a Y, y lo demás fuera', () => {
    expect(textoSepa('Panadería Hermanos Ruiz & Hijos', 70)).toBe('Panaderia Hermanos Ruiz Y Hijos')
    expect(textoSepa('Ñoquis Peña · Calle Mayor nº 3 «bajo»', 70)).toBe('Noquis Pena Calle Mayor no 3 bajo')
    expect(textoSepa('a'.repeat(80), 70)).toHaveLength(70)
  })
  it('un identificador sin espacios, sin «//» ni «/» en los extremos, y hasta 35', () => {
    expect(idSepa('R-2026/014-1')).toBe('R-2026/014-1')
    expect(idSepa('/R 2026//014/')).toBe('R-2026/014')
    expect(idSepa('X'.repeat(50))).toHaveLength(35)
  })
  it('el importe con punto y dos decimales; el nombre del fichero sin «/»', () => {
    expect([importeSepa(1105.3), importeSepa(0.1 + 0.2), importeSepa(4218.4)]).toEqual(['1105.30', '0.30', '4218.40'])
    expect(nombreFicheroRemesa('R-2026/014')).toBe('remesa-R-2026-014.xml')
  })
})
