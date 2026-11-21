// tests/unit/modules/conta/x24/repetido.test.ts — X24 · Un proveedor nunca se da de alta dos veces: el alta a mano
// compara el NIF con la MISMA clave que la base (nifClave = _conta_nif_clave, la del índice único), y dice quién lo
// tiene para «Abrirlo». Uno, ninguno y dos. NIF todo ceros y nombres inventados (T11).

import { describe, expect, it } from 'vitest'
import { nifClave } from '@/modules/conta/lib/nif'
import { revisarAlta, textoNifRepetido } from '@/modules/conta/lib/altaProveedor'

describe('X24 · nifClave: la de la base (_conta_nif_clave)', () => {
  it.each([
    ['B-00000000', 'B00000000'], ['b00000000', 'B00000000'], ['ES B-00000000', 'B00000000'], ['ESB00000000', 'B00000000'],
    [' B.000.000.00 ', 'B00000000'], ['NIF: B00000000', 'B00000000'], ['VAT NL000000000B01', 'NL000000000B01'], ['ES00000000T', '00000000T'],
  ])('«%s» → %s', (escrito, clave) => expect(nifClave(escrito)).toBe(clave))
  it('lo que no tiene ni una letra ni una cifra, null', () => {
    expect(nifClave('')).toBeNull(); expect(nifClave(' - ')).toBeNull(); expect(nifClave(null)).toBeNull()
  })
})

describe('X24 · el alta a mano con el NIF de otro: «Ya tienes a … con este NIF»', () => {
  const OTROS = [
    { id: 's-1', name: 'Frutas Inventadas', taxId: 'B00000000' },
    { id: 's-2', name: 'Sin NIF Inventado', taxId: null },
  ]
  it('uno: escrito con guion, es el mismo; dice quién y lo devuelve para «Abrirlo»', () => {
    const r = revisarAlta({ nombre: 'Frutas Nuevas', nif: 'B-00000000' }, OTROS)
    expect(r.errores.nif).toBe('Ya tienes a Frutas Inventadas con este NIF.')
    expect(r.repetido).toEqual(OTROS[0])
    expect(textoNifRepetido('  Frutas Inventadas ')).toBe('Ya tienes a Frutas Inventadas con este NIF.')
  })
  it('ninguno: otro NIF válido, sin frase; los que no tienen NIF no cuentan', () => {
    const r = revisarAlta({ nombre: 'Frutas Nuevas', nif: 'J00000000' }, OTROS)
    expect(r.errores).toEqual({}); expect(r.repetido).toBeNull()
  })
  it('dos con el mismo NIF limpio (lo que la base ya no deja): el primero, y se dice igual', () => {
    const dos = [...OTROS, { id: 's-3', name: 'Frutas Inventadas Bis', taxId: 'b-00000000' }]
    expect(revisarAlta({ nombre: 'Otra', nif: 'B00000000' }, dos).repetido?.id).toBe('s-1')
  })
})
