// tests/unit/modules/conta/m01/retoques.test.ts
//
// M01 · Los retoques de Julio sobre el #211 (16/10): las fechas en
// dd/mm/aaaa, lo vivo primero en el buscador, los chips a 0 fuera del
// «Te toca hoy» y no pedir cerrar un mes ya cerrado fuera.

import { describe, expect, it } from 'vitest'
import { aTexto, deTexto, enmascarar, fechaMal } from '@/modules/conta/ui/fecha/fecha'
import { vivoPrimero } from '@/modules/conta/marco/nuevo/buscar'
import { chipsQueSalen } from '@/modules/conta/marco/nuevo/teTocaHoy'
import { pedirCierre, type CierreMes } from '@/modules/conta/lib/diario'

describe('las fechas de las piezas, en dd/mm/aaaa', () => {
  it('se leen en español, sin depender del navegador', () => {
    expect(aTexto('2026-10-16')).toBe('16/10/2026')
    expect(aTexto('2026-01-05')).toBe('05/01/2026')
    expect(aTexto('')).toBe('')
    expect(aTexto('16/10/2026')).toBe('')
  })
  it('se escriben con las barras puestas solas', () => {
    expect(enmascarar('16')).toBe('16')
    expect(enmascarar('161')).toBe('16/1')
    expect(enmascarar('1610')).toBe('16/10')
    expect(enmascarar('16102026')).toBe('16/10/2026')
    expect(enmascarar('161020269')).toBe('16/10/2026')
    expect(enmascarar('16/')).toBe('16/')
    expect(enmascarar('1/2/2026')).toBe('1/2/2026')
    // Un trozo que se pasa vuelve a partirse por cifras.
    expect(enmascarar('16/102')).toBe('16/10/2')
    expect(enmascarar('ab16c10')).toBe('16/10')
  })
  it('lo escrito pasa a ISO solo entero y si existe', () => {
    expect(deTexto('16/10/2026')).toBe('2026-10-16')
    expect(deTexto('1/2/2026')).toBe('2026-02-01')
    expect(deTexto('29/02/2028')).toBe('2028-02-29')
    expect(deTexto('')).toBe('')
    expect(deTexto('16/10')).toBeNull()
    expect(deTexto('31/02/2026')).toBeNull()
    expect(deTexto('29/02/2026')).toBeNull()
    expect(deTexto('16/13/2026')).toBeNull()
    // Lo que se escribe y se vuelve a leer es lo mismo.
    expect(aTexto(deTexto('05/01/2026')!)).toBe('05/01/2026')
  })
  it('una fecha imposible se dice; a medias, no', () => {
    expect(fechaMal('31/02/2026')).toBe(true)
    expect(fechaMal('16/10')).toBe(false)
    expect(fechaMal('16/10/2026')).toBe(false)
  })
})

describe('el buscador: lo vivo primero', () => {
  it('lo apagado va al final de su grupo, sin perder el orden ni esconder nada', () => {
    const r = [{ id: 'a', apagado: true }, { id: 'b' }, { id: 'c', apagado: true }, { id: 'd', apagado: false }]
    expect(vivoPrimero(r).map((x) => x.id)).toEqual(['b', 'd', 'a', 'c'])
    expect(vivoPrimero(r)).toHaveLength(r.length)
  })
})

describe('«Te toca hoy»: lo que está a 0 no sale', () => {
  const chip = (id: string, numero: number | null | undefined, activo = false) => ({ id, etiqueta: id, numero, activo })
  it('sale lo que tiene algo, lo que cuenta y lo que no se pudo contar', () => {
    const { visibles, nada } = chipsQueSalen([chip('compras', 6), chip('libros', 0), chip('bancos', undefined), chip('terceros', null)])
    expect(visibles.map((c) => c.id)).toEqual(['compras', 'bancos', 'terceros'])
    expect(nada).toBe(false)
  })
  it('todo a 0: «Nada pendiente hoy»', () => {
    expect(chipsQueSalen([chip('a', 0), chip('b', 0)])).toEqual({ visibles: [], nada: true })
  })
  it('un «—» nunca es «nada pendiente», ni lo que aún cuenta', () => {
    expect(chipsQueSalen([chip('a', 0), chip('b', null)]).nada).toBe(false)
    expect(chipsQueSalen([chip('a', 0), chip('b', undefined)]).nada).toBe(false)
  })
  it('el pulsado se queda aunque baje a 0, para poder soltarlo', () => {
    expect(chipsQueSalen([chip('revisar', 0, true)]).visibles.map((c) => c.id)).toEqual(['revisar'])
  })
})

describe('no se pide cerrar un mes ya cerrado fuera', () => {
  // Producción, Foodint (leído el 16/10, solo SELECT): ejercicio 2026 mixto de
  // Diez, imported_until 2026-09-30, de enero a septiembre cerrados al traerlo
  // (kind 'migrated'). conta_primer_dia_abierto(empresa, 2026-09-01) = 2026-10-01.
  const migrados: CierreMes[] = ['01', '02', '03', '04', '05', '06', '07', '08', '09']
    .map((m) => ({ mes: `2026-${m}-01`, tipo: 'migrated' as const, quien: null }))
  it('Foodint: septiembre, traído de Diez, no se pide', () => {
    expect(pedirCierre('2026-09-01', '2026-10-01', migrados)).toBe(false)
  })
  it('Foodint: octubre, abierto, sí', () => {
    expect(pedirCierre('2026-10-01', '2026-10-01', migrados)).toBe(true)
  })
  // Staging-conta (16/10): Taberna de Prueba Norte, septiembre abierto.
  it('staging, Taberna Norte: septiembre abierto, se pide', () => {
    expect(pedirCierre('2026-09-01', '2026-09-01', [])).toBe(true)
    expect(pedirCierre('2026-09-01', '2026-09-15', [])).toBe(true)
  })
  // Staging-conta: Cocina de Prueba Sur, enero a septiembre cerrados a mano en Folvy.
  it('staging, Cocina Sur: cerrado a mano en Folvy, sale hecho', () => {
    expect(pedirCierre('2026-09-01', '2026-10-01', [{ mes: '2026-09-01', tipo: 'manual', quien: 'Ana' }])).toBe(true)
  })
  it('sin ejercicio o sin ningún día abierto, no', () => {
    expect(pedirCierre('2026-09-01', null, [])).toBe(false)
  })
  it('cerrado al presentar el impuesto, tampoco', () => {
    expect(pedirCierre('2026-09-01', '2026-10-01', [{ mes: '2026-09-01', tipo: 'tax_filed', quien: null }])).toBe(false)
  })
})
