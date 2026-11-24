// tests/unit/modules/conta/x26/modificar.test.ts — X26 · «Modificar» una recibida contabilizada: qué líneas se pueden
// cambiar (las de gasto, con la misma regla que la base), la franja y qué se le manda a la base. Cuentas inventadas.

import { describe, expect, it } from 'vitest'
import { esLineaDeGasto, franjaModificando, lineasQueCambian, porqueNoModificar } from '@/modules/conta/nucleo/recibida/contabilizada'

const APUNTES = [{ posicion: 1, cuenta: '62800000' }, { posicion: 2, cuenta: '47200021' }, { posicion: 3, cuenta: '40000071' }, { posicion: 4, cuenta: '62900000' }]

describe('X26 · las líneas que se cambian aquí: las de gasto', () => {
  it('ni la del proveedor (40, 41) ni la del IVA (472, 477, 4751); el resto, sí (la 480, el 21x)', () => {
    expect(['62800000', '48000000', '21300000', '60000000'].every(esLineaDeGasto)).toBe(true)
    expect(['40000071', '41000003', '47200021', '47700021', '47510000'].some(esLineaDeGasto)).toBe(false)
  })
})

describe('X26 · lo que se le manda a la base', () => {
  it('solo las de gasto que cambian, por su posición', () => {
    expect(lineasQueCambian(APUNTES, { 1: '62800001', 4: '62900000' })).toEqual([{ posicion: 1, cuenta: '62800001' }])
  })
  it('la del proveedor o la del IVA no se mandan aunque se hayan escrito', () => {
    expect(lineasQueCambian(APUNTES, { 2: '62800001', 3: '62800001' })).toEqual([])
  })
  it('sin cambios, nada', () => { expect(lineasQueCambian(APUNTES, {})).toEqual([]) })
})

describe('X26 · la franja y el porqué', () => {
  it('«Modificando el asiento 11», en ámbar', () => {
    expect(franjaModificando(11)).toEqual({ tono: 'ambar', fuerte: 'Modificando el asiento 11.', resto: 'Cambia la cuenta de cada gasto. Intro guarda; Esc lo deja como estaba.' })
  })
  it('el porqué del botón apagado, el de la base', () => {
    expect(porqueNoModificar({ puede: false, porque: 'El IVA del 3T ya está presentado: esta factura no se puede modificar.' })).toBe('El IVA del 3T ya está presentado: esta factura no se puede modificar.')
    expect(porqueNoModificar({ puede: true, porque: null })).toBeNull()
  })
})

describe('X26 · el porqué escrito al lado del botón apagado (regla 8)', () => {
  it('del porqué de la base, la frase corta', async () => {
    const { textoNoSeModifica } = await import('@/modules/conta/nucleo/recibida/contabilizada')
    expect(textoNoSeModifica({ puede: false, porque: 'El IVA del 4T ya está presentado: esta factura no se puede modificar.' })).toBe('No se puede modificar: el IVA del 4T ya está presentado.')
    expect(textoNoSeModifica({ puede: false, porque: 'Su asiento ya salió a Diez o a ERP10: se modifica allí, no aquí.' })).toBe('No se puede modificar: su asiento ya salió a Diez o a ERP10: se modifica allí, no aquí.')
    expect(textoNoSeModifica({ puede: true, porque: null })).toBeNull()
    expect(textoNoSeModifica(null)).toBeNull()
  })
})

describe('X26 · la lectura de «¿se puede modificar?» se hace cuando llega el asiento (e2e 44962297448 y #1733)', () => {
  // El modelo de useLeer (libros/contexto.ts): el efecto lee SOLO cuando cambia la clave; si al cambiar no hay qué leer, no lee.
  function lecturas(pasos: { leer: boolean; clave: string }[]): number {
    let n = 0; let antes: string | null = null
    for (const p of pasos) { if (p.clave !== antes) { antes = p.clave; if (p.leer) n++ } }
    return n
  }
  it('antes: con la clave sin el asiento, al llegar la factura validada no se leía nunca (el botón, apagado)', () => {
    const clave = 'f-1:se-puede-modificar:0'
    expect(lecturas([{ leer: false, clave }, { leer: true, clave }])).toBe(0)
  })
  it('ahora: la clave cambia con el asiento validado, y se lee una vez', async () => {
    const { claveSePuedeModificar } = await import('@/modules/conta/nucleo/recibida/contabilizada')
    const sin = claveSePuedeModificar({ invoiceId: 'f-1', asientoValidado: null, vuelta: 0 })
    const con = claveSePuedeModificar({ invoiceId: 'f-1', asientoValidado: 'a-11', vuelta: 0 })
    expect(sin).not.toBe(con)
    expect(lecturas([{ leer: false, clave: sin }, { leer: true, clave: con }, { leer: true, clave: con }])).toBe(1)
  })
})
