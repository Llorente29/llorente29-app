// tests/unit/modules/conta/x20/subcuentaRapida.test.ts — X20 · Crear una subcuenta como en ERP10
// (src/modules/conta/lib/subcuentaRapida.ts): el código entero, con punto y la raíz sola; la cuenta de la que
// cuelga; el código que ya existe; la raíz que no está en el plan. Con un trozo del plan de pymes (sus códigos
// y nombres del BOE) y subcuentas inventadas (T11).

import { describe, expect, it } from 'vitest'
import { cuelgaDe, fichaDeSubcuenta, fraseCodigo, leerCodigo, type SeriePlan } from '@/modules/conta/lib/subcuentaRapida'
import { codigoEscrito } from '@/modules/conta/nucleo/ficha/teclas'

const SERIE: SeriePlan[] = [
  { code: '43', name: 'Clientes', isLeaf: false },
  { code: '430', name: 'Clientes', isLeaf: false },
  { code: '4300', name: 'Clientes (euros)', isLeaf: true },
  { code: '4309', name: 'Clientes, facturas pendientes de formalizar', isLeaf: true },
  { code: '57', name: 'Tesorería', isLeaf: false },
  { code: '572', name: 'Bancos e instituciones de crédito c/c vista, euros', isLeaf: true },
  { code: '62', name: 'Servicios exteriores', isLeaf: false },
  { code: '623', name: 'Servicios de profesionales independientes', isLeaf: true },
  { code: '60', name: 'Compras', isLeaf: false },
  { code: '600', name: 'Compras de mercaderías', isLeaf: true },
]
const CUENTAS = [1, 2, 3, 4, 5].map((n) => ({ id: `c-${n}`, code: `4300000${n}`, name: `Cliente inventado ${n}` }))
const plan = { digitos: 8, serie: SERIE, cuentas: CUENTAS }

describe('X20 · el código, como en ERP10', () => {
  it('entero: 43000030, bajo la 4300', () => {
    expect(leerCodigo('43000030', plan)).toEqual({ tipo: 'nueva', codigo: '43000030', hoja: { code: '4300', name: 'Clientes (euros)' }, propuesta: false })
  })
  it('con punto, como en el resto de Sumied: 430.30 → 43000030 y 572.1 → 57200001', () => {
    expect(leerCodigo('430.30', plan)).toMatchObject({ tipo: 'nueva', codigo: '43000030', propuesta: false })
    expect(leerCodigo('572.1', plan)).toMatchObject({ tipo: 'nueva', codigo: '57200001', hoja: { code: '572' } })
  })
  it('X21 · corto, como en la ficha de la factura (la misma pieza, codigoEscrito): 4301 → 43000001, 43030 → 43000030, 6001 → 60000001; y el de la ficha da lo mismo', () => {
    expect(leerCodigo('4301', plan)).toEqual({ tipo: 'existe', codigo: '43000001', id: 'c-1', nombre: 'Cliente inventado 1' })
    expect(leerCodigo('43030', plan)).toEqual({ tipo: 'nueva', codigo: '43000030', hoja: { code: '4300', name: 'Clientes (euros)' }, propuesta: false })
    expect(leerCodigo('6001', plan)).toEqual({ tipo: 'nueva', codigo: '60000001', hoja: { code: '600', name: 'Compras de mercaderías' }, propuesta: false })
    // En toda la aplicación igual: lo que da la ficha de la factura para lo mismo escrito.
    for (const t of ['4301', '6001', '43012', '430.30', '572.1', '43000030']) {
      const l = leerCodigo(t, plan)
      expect(l.tipo === 'nueva' || l.tipo === 'existe' ? l.codigo : null).toBe(codigoEscrito(t, 8))
    }
  })
  it('la raíz sola: 430 → la siguiente libre (43000006), escrita para aceptarla o cambiarla', () => {
    expect(leerCodigo('430', plan)).toEqual({ tipo: 'nueva', codigo: '43000006', hoja: { code: '4300', name: 'Clientes (euros)' }, propuesta: true })
    expect(fraseCodigo(leerCodigo('430', plan))).toBe('Será la 43000006, bajo la 4300 · Clientes (euros).')
    expect(leerCodigo('572', plan)).toMatchObject({ codigo: '57200001', propuesta: true })
  })
  it('cuelga de la más larga que lo empieza, de las que admiten apuntes (la 430 a secas no: la 4300)', () => {
    expect(cuelgaDe('43090001', SERIE)?.code).toBe('4309')
    expect(cuelgaDe('43000001', SERIE)?.code).toBe('4300')
    expect(cuelgaDe('62300000', SERIE)?.code).toBe('623')
  })
  it('el que ya existe: lo dice, para abrirlo', () => {
    expect(leerCodigo('43000003', plan)).toEqual({ tipo: 'existe', codigo: '43000003', id: 'c-3', nombre: 'Cliente inventado 3' })
    expect(fraseCodigo(leerCodigo('430.3', plan))).toBe('Ya existe: la 43000003 · Cliente inventado 3.')
  })
  it('la raíz que no está en el plan: lo dice con su número y no inventa nada', () => {
    expect(leerCodigo('43900001', plan)).toMatchObject({ tipo: 'no_esta', falta: '439', porque: 'La 439 no está en tu plan: no hay de qué cuenta colgarla.' })
    expect(leerCodigo('4390', plan)).toMatchObject({ tipo: 'no_esta', falta: '439' })
    expect(leerCodigo('43050001', plan)).toMatchObject({ tipo: 'no_esta', falta: '4305' })
  })
  it('lo que no es un código, dicho', () => {
    expect(leerCodigo('', plan)).toEqual({ tipo: 'vacio' })
    expect(leerCodigo('Glovo', plan)).toMatchObject({ tipo: 'mal', porque: 'El código son cifras: 43000030, 4301 o 430.30.' })
    expect(leerCodigo('430000300', plan)).toMatchObject({ tipo: 'mal', porque: 'Tu plan tiene 8 cifras: sobran 1.' })
  })
  it('la ficha que se ofrece al lado: cliente (430), proveedor o acreedor (400 y 410), banco (572); las demás, ninguna', () => {
    expect(['43000006', '40000001', '41000001', '57200001', '62300001'].map(fichaDeSubcuenta)).toEqual(['cliente', 'proveedor', 'proveedor', 'banco', null])
  })
})
