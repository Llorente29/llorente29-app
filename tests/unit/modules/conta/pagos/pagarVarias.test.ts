// B01 Revolut · PR 3b · Varias facturas a la vez con el banco: qué sale y qué no
// (src/modules/conta/pagos/pagarService.ts · quienesSalen). Todo inventado (T11).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { preparadoDe, quienesSalen, textoPagarVarias, type FilaVarias } from '@/modules/conta/pagos/pagarService'

const sePuede = (importe: number, motivos: string[] = []) => preparadoDe({ se_puede: true, porque: null, beneficiario: 'X', iban4: '1234', iban_check: 'comprobado', importe,
  motivos, motivos_texto: motivos, salida: { banco: 'Revolut', puede: true }, quien: { yo_puedo: true, segunda: 'la_misma', personas: [] } })
const fila = (id: string, c: Partial<FilaVarias>): FilaVarias => ({ facturaId: id, proveedor: `Proveedor ${id}`, numero: id, preparado: null, error: null, titular: null, titularError: null, pagarIgual: false, porque: '', ...c })

describe('quienesSalen', () => {
  it('mientras se comprueba alguna, la cuenta como «comprobando» y no sale', () => {
    const r = quienesSalen([fila('a', {}), fila('b', { preparado: sePuede(10) })])
    expect(r.comprobando).toBe(2)
    expect(r.salen).toEqual([])
  })
  it('sale lo que se puede pagar con su titular dicho; lo que la base no deja, se queda con su porqué', () => {
    const sinIban = preparadoDe({ se_puede: false, porque: 'Proveedor c no tiene un IBAN válido en su ficha: pónselo antes de pagar.', salida: {}, quien: {} })
    const r = quienesSalen([
      fila('a', { preparado: sePuede(10), titular: { resultado: 'coincide' } }),
      fila('b', { preparado: sePuede(20), titularError: 'Revolut no ha contestado.' }),
      fila('c', { preparado: sinIban }),
      fila('d', { error: 'Esa factura no es de la empresa.' }),
    ])
    expect(r.salen.map((f) => f.facturaId)).toEqual(['a', 'b'])
    expect(r.fuera.map((f) => [f.fila.facturaId, f.porque])).toEqual([
      ['c', 'Proveedor c no tiene un IBAN válido en su ficha: pónselo antes de pagar.'],
      ['d', 'Esa factura no es de la empresa.'],
    ])
    expect(r.comprobando).toBe(0)
  })
  it('un titular que no coincide no sale, salvo «pagar igual» con su porqué', () => {
    const no = { preparado: sePuede(30), titular: { resultado: 'no_coincide' as const } }
    expect(quienesSalen([fila('a', no)]).fuera[0].porque).toMatch(/El titular no coincide/)
    expect(quienesSalen([fila('a', { ...no, pagarIgual: true, porque: '   ' })]).salen).toEqual([])
    expect(quienesSalen([fila('a', { ...no, pagarIgual: true, porque: 'Confirmado por teléfono con el proveedor.' })]).salen.map((f) => f.facturaId)).toEqual(['a'])
  })
})

describe('textoPagarVarias', () => {
  it('lleva el nombre del banco de «Desde»', () => {
    expect(textoPagarVarias(1, 'Revolut')).toBe('Pagar 1 con Revolut')
    expect(textoPagarVarias(5, 'Revolut')).toBe('Pagar las 5 con Revolut')
  })
})

describe('Pagos: el banco como salida principal, el fichero como segunda', () => {
  const pagina = readFileSync('src/modules/conta/compras/PagosPage.tsx', 'utf8')
  it('solo con una cuenta que paga desde Sumied y quien puede pagar', () => {
    expect(pagina).toMatch(/const porBanco = !!cuentaBanco && quienPaga\.datos\?\.yoPuedo === true/)
    expect(pagina).toMatch(/Preparar el fichero SEPA/)
  })
})
