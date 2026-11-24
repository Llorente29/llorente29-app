// tests/unit/modules/conta/k04b/franja.test.ts
//
// K04b · La franja y las comprobaciones de la recibida del núcleo dicen la
// verdad con lo que hay en la ficha (Julio, 19/11: un emisor que no está en
// sus proveedores salía «Rellenada por Sumied, con 1 duda · 3 comprobaciones
// bien», con el proveedor, el NIF y el nombre vacíos). Cada estado, contra lo
// que tiene la ficha. Datos inventados (T11).

import { describe, expect, it } from 'vitest'
import { casillasVacias, comprobacionesDe, emisorDesconocido, estadoDeLaFicha, nombreDePestana } from '@/modules/conta/nucleo/recibida/estado'
import { origenes } from '@/modules/conta/nucleo/recibida/origen'
import type { UnaComprobacion } from '@/modules/conta/nucleo/ficha/piezas'

const bien = (id: string): UnaComprobacion => ({ id, tono: 'bien', texto: id })
const llena = { proveedor: true, numero: 'A-1', fecha: '2026-07-01', total: 121, cuentaGasto: true }
const calendario = { mesesCerrados: [], ejercicios: [{ inicio: '2026-01-01', fin: '2026-12-31', abierto: true }] }
const base = {
  aMano: false, duplicada: null, noRepetida: false, fecha: '2026-07-01', numero: 'A-1', hayFicha: true, calendario,
  nifFicha: 'B00000000', nifLeido: 'B00000000', total: 121, totalDocumento: 121, lectura: [], avisos: [],
}
const proveedores = [{ id: 'p1', nombre: 'Suministros del Ejemplo S.L.', nif: 'B00000000' }]

describe('K04b · los estados de la franja', () => {
  it('la nueva, a mano: «La escribes tú.» en gris', () => {
    expect(estadoDeLaFicha({ aMano: true, leida: false, comprobaciones: [], hayDudaGasto: false, vacias: ['el proveedor'] }))
      .toEqual({ tono: 'gris', fuerte: 'La escribes tú.', resto: 'Se comprueba mientras escribes.' })
  })
  it('el emisor que no se conoce: «Mira esto · No conozco al que la emite», aunque las comprobaciones salgan bien', () => {
    expect(estadoDeLaFicha({ aMano: false, leida: true, comprobaciones: ['a', 'b', 'c'].map(bien), hayDudaGasto: true, desconocido: true, vacias: ['el proveedor'] }))
      .toEqual({ tono: 'ambar', fuerte: 'Mira esto ·', resto: 'No conozco al que la emite' })
  })
  it('con casillas vacías no dice «Rellenada» ni «bien»: dice lo que falta', () => {
    const e = estadoDeLaFicha({ aMano: false, leida: true, comprobaciones: ['a', 'b'].map(bien), hayDudaGasto: false, vacias: casillasVacias({ ...llena, numero: '', fecha: '' }) })
    expect(e).toEqual({ tono: 'ambar', fuerte: 'Mira esto ·', resto: 'Falta el número de factura y la fecha' })
    expect(`${e.fuerte} ${e.resto}`).not.toMatch(/Rellenada|bien/)
  })
  it('leída y llena, sin dudas: «Rellenada por Sumied.» en verde', () => {
    expect(estadoDeLaFicha({ aMano: false, leida: true, comprobaciones: ['a', 'b', 'c', 'd'].map(bien), hayDudaGasto: false, vacias: casillasVacias(llena) }))
      .toEqual({ tono: 'verde', fuerte: 'Rellenada por Sumied.', resto: '4 comprobaciones bien · pulsa Intro.' })
  })
  it('leída y llena, con la duda del gasto: ámbar, con sus dudas contadas', () => {
    expect(estadoDeLaFicha({ aMano: false, leida: true, comprobaciones: ['a', 'b', 'c', 'd'].map(bien), hayDudaGasto: true, vacias: [] }))
      .toEqual({ tono: 'ambar', fuerte: 'Rellenada por Sumied, con 1 duda.', resto: '4 comprobaciones bien · mira lo ámbar y pulsa Intro.' })
  })
  it('sin lectura (guardada a mano) y llena: «Escrita a mano.», nunca «Rellenada»', () => {
    expect(estadoDeLaFicha({ aMano: false, leida: false, comprobaciones: ['a'].map(bien), hayDudaGasto: false, vacias: [] }).fuerte).toBe('Escrita a mano.')
  })
  it('lo que cuenta como vacío: proveedor, número, fecha, importe y cuenta de gasto', () => {
    expect(casillasVacias(llena)).toEqual([])
    expect(casillasVacias({ proveedor: false, numero: ' ', fecha: '', total: 0, cuentaGasto: false }))
      .toEqual(['el proveedor', 'el número de factura', 'la fecha', 'el importe', 'la cuenta de gasto'])
  })
})

describe('K04b · las comprobaciones dicen la verdad', () => {
  const nif = (l: UnaComprobacion[]) => l.find((c) => c.id === 'nif')
  it('sin ficha, el NIF que se comprueba es el leído: «NIF correcto»', () => {
    expect(nif(comprobacionesDe({ ...base, hayFicha: false, nifFicha: null, nifLeido: 'B00000000' }))).toEqual({ id: 'nif', tono: 'bien', texto: 'NIF correcto' })
  })
  it('sin ficha y con el NIF leído mal: «NIF no válido»', () => {
    expect(nif(comprobacionesDe({ ...base, hayFicha: false, nifFicha: null, nifLeido: 'B00000001' }))).toEqual({ id: 'nif', tono: 'rojo', texto: 'NIF no válido' })
  })
  it('sin ficha nunca habla de «su ficha»', () => {
    for (const leido of ['B00000000', 'B00000001', null]) {
      const l = comprobacionesDe({ ...base, hayFicha: false, nifFicha: null, nifLeido: leido })
      expect(l.map((c) => c.texto).join(' | ')).not.toMatch(/su ficha/)
    }
    expect(nif(comprobacionesDe({ ...base, hayFicha: false, nifFicha: null, nifLeido: null }))).toEqual({ id: 'nif', tono: 'ambar', texto: 'La factura no trae NIF' })
  })
  it('con ficha y sin NIF en ella, sí: «Su ficha no tiene NIF» (es verdad)', () => {
    expect(nif(comprobacionesDe({ ...base, nifFicha: null }))?.texto).toBe('Su ficha no tiene NIF')
  })
  it('sin número no dice «No está repetida»; sin importe no dice «suman el total»', () => {
    const l = comprobacionesDe({ ...base, numero: '', total: 0, totalDocumento: null })
    expect(l.map((c) => c.id)).not.toContain('repetida')
    expect(l.map((c) => c.id)).not.toContain('suma')
  })
})

describe('K04b · el emisor que no se reconoce', () => {
  it('leída, sin proveedor y con un NIF que no es de nadie: el alta, con el nombre y el NIF leídos', () => {
    expect(emisorDesconocido({ aMano: false, proveedorId: '', leido: { nombre: ' Otra Empresa S.L. ', nif: 'B00000018' }, proveedores }))
      .toEqual({ que: 'alta', nombre: 'Otra Empresa S.L.', nif: 'B00000018' })
  })
  it('con el NIF leído de uno que ya tienes: ese, para elegirlo', () => {
    expect(emisorDesconocido({ aMano: false, proveedorId: '', leido: { nombre: 'SUMINISTROS', nif: 'b-00000000' }, proveedores }))
      .toMatchObject({ que: 'es_uno_tuyo', proveedorId: 'p1', nombre: 'Suministros del Ejemplo S.L.' })
  })
  it('con proveedor, o en la nueva a mano, no hay emisor desconocido', () => {
    expect(emisorDesconocido({ aMano: false, proveedorId: 'p1', leido: { nombre: 'x', nif: 'B00000018' }, proveedores })).toBeNull()
    expect(emisorDesconocido({ aMano: true, proveedorId: '', leido: null, proveedores })).toBeNull()
  })
  it('el NIF y el nombre leídos llevan su origen, «PDF», mientras no hay proveedor', () => {
    const o = origenes({ leido: { nif: 'B00000018', numero: 'A-1', fecha: '2026-07-01', nombre: 'Otra Empresa S.L.' }, deRecepcion: false, proveedor: null, proveedorCambiado: false, numero: 'A-1', fecha: '2026-07-01', conceptoPropuesto: false })
    expect(o).toMatchObject({ nif: 'PDF', nombre: 'PDF', numero: 'PDF', fecha: 'PDF' })
    expect(o.proveedor).toBeUndefined()
  })
})

describe('K04b · el nombre de la pestaña', () => {
  it('una que ya existe nunca se llama «nueva»: el emisor leído, o «sin proveedor»', () => {
    expect(nombreDePestana('Emisor Nuevo de Prueba 1, S.L.', true)).toBe('Factura recibida · Emisor Nuevo de Prueba 1, S.L.')
    expect(nombreDePestana(null, true)).toBe('Factura recibida · sin proveedor')
    expect(nombreDePestana(null)).toBe('Factura recibida · nueva')
  })
})
