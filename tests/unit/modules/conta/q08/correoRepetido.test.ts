// tests/unit/modules/conta/q08/correoRepetido.test.ts
//
// Q08 · En «Cobros de GoCardless sin cliente», cuando un mismo email está en
// varios clientes de GoCardless (una persona con una sociedad en cada uno), no
// se propone por email: saldrían todos a la misma ficha. En cada uno, su
// mandato (banco, el final de la cuenta que guarde GoCardless, la referencia),
// para que una persona elija. Datos inventados (T11).

import { describe, expect, it } from 'vitest'
import { porAsignar, textoDeMandato } from '@/modules/conta/gestoria/g04/asignar'
import type { DatosClientes } from '@/modules/conta/gestoria/g04/datos'

const E = 'emp-prueba'
const datos = { clientes: [
  { cliente_id: 'f-persona', cliente: 'Persona Prueba Ejemplo', empresa_id: E, cliente_en_gocardless: null, correos: ['comun@ejemplo.test'] },
  { cliente_id: 'f-otra', cliente: 'Otra Empresa de Prueba, S.L.', empresa_id: E, cliente_en_gocardless: null, correos: ['otra@ejemplo.test'] },
] } as unknown as DatosClientes
const susc = (gc: string) => ({ company_id: E, gc_cliente_id: gc, estado: 'active', nombre: 'GESTORIA MENSUAL', al_mes: 100 })
const GCS = [
  { company_id: E, gc_id: 'CU-1', nombre: 'PERSONA PRUEBA EJEMPLO', correo: 'comun@ejemplo.test' },
  { company_id: E, gc_id: 'CU-2', nombre: 'PERSONA PRUEBA EJEMPLO', correo: 'Comun@Ejemplo.test' },
  { company_id: E, gc_id: 'CU-3', nombre: 'SOCIEDAD TRES DE PRUEBA SL', correo: 'comun@ejemplo.test' },
  { company_id: E, gc_id: 'CU-4', nombre: 'GC CUATRO', correo: 'otra@ejemplo.test' },
]
const MANDATOS = [
  { company_id: E, gc_cliente_id: 'CU-1', estado: 'active', referencia: 'PRUEBA-0001', cuenta_final: '53', banco: 'Banco Ejemplo' },
  { company_id: E, gc_cliente_id: 'CU-2', estado: 'cancelled', referencia: 'PRUEBA-0002', cuenta_final: '56', banco: 'Banco Ejemplo' },
  { company_id: E, gc_cliente_id: 'CU-2', estado: 'active', referencia: 'PRUEBA-0003', cuenta_final: '49', banco: null },
]
const lista = porAsignar(datos, ['CU-1', 'CU-2', 'CU-3', 'CU-4'].map(susc), GCS, [{ id: E, nombre: 'Gestoría de Prueba' }], [E], [], MANDATOS)
const de = (gc: string) => lista.find((x) => x.gcClienteId === gc)!

describe('Q08 · email en varios clientes de GoCardless', () => {
  it('no se propone por email (sin mayúsculas que valgan); se dice en cuántos está', () => {
    for (const gc of ['CU-1', 'CU-2', 'CU-3']) expect(de(gc).correoEnVarios).toBe(3)
    expect(de('CU-3').propuesta).toEqual({ tipo: 'ninguna' })
  })
  it('el nombre sigue valiendo para proponer (no lo tapa el email)', () => {
    expect(de('CU-1').propuesta).toEqual({ tipo: 'una', clienteId: 'f-persona', por: 'nombre' })
  })
  it('un email que está en un solo cliente de GoCardless propone como antes', () => {
    expect(de('CU-4')).toMatchObject({ correoEnVarios: 1, propuesta: { tipo: 'una', clienteId: 'f-otra', por: 'email' } })
  })
})

describe('Q08 · el mandato de cada uno, para distinguirlos', () => {
  it('banco, final de la cuenta (lo que haya) y referencia; los activos primero', () => {
    expect(de('CU-1').mandatos.map(textoDeMandato)).toEqual(['Banco Ejemplo ··53 · ref. PRUEBA-0001 (activo)'])
    expect(de('CU-2').mandatos.map(textoDeMandato)).toEqual(['··49 · ref. PRUEBA-0003 (activo)', 'Banco Ejemplo ··56 · ref. PRUEBA-0002 (cancelado)'])
    expect(de('CU-3').mandatos).toEqual([])
  })
  it('sin banco ni cuenta, lo dice', () => {
    expect(textoDeMandato({ banco: null, cuentaFinal: null, referencia: 'PRUEBA-0009', estado: 'pending_submission' })).toBe('Cuenta sin datos · ref. PRUEBA-0009 (pendiente)')
  })
})
