// C06 · Respuesta 3: los pasos antes de traer de Diez (datos → plan → banco →
// Diez). Las entradas son la forma real que devuelve conta_diez_listo.

import { describe, it, expect } from 'vitest'
import { pasosDiez, resumenPasos, type ListoDiez } from '../../../../src/modules/conta/lib/pasosDiez'

const listo = (hechos: [boolean, boolean, boolean, boolean], extra: Partial<ListoDiez['pasos'][3]> = {}): ListoDiez => {
  const claves = ['datos', 'plan', 'banco', 'diez'] as const
  const falta = claves.find((_, i) => !hechos[i]) ?? null
  return { pasos: claves.map((paso, i) => ({ paso, hecho: hechos[i], ...(paso === 'diez' ? { base: null, fallo: null, ...extra } : {}) })), falta, sinNombre: 0 }
}

describe('los pasos antes de traer de Diez', () => {
  it('recién creada: falta el 1, con su botón; los de detrás esperan, sin botón', () => {
    const p = pasosDiez(listo([false, false, false, false]), 'Contabilidad', 0)
    expect(p.map((x) => x.estado)).toEqual(['falta', 'espera', 'espera', 'espera'])
    expect(p[0].boton).toEqual({ tipo: 'ir', texto: 'Terminar el alta', a: 'alta' })
    expect(p.slice(1).every((x) => x.boton === null)).toBe(true)
  })

  it('con el alta: falta el plan, «Activar el plan»', () => {
    const p = pasosDiez(listo([true, false, false, false]), 'Contabilidad', 0)
    expect(p[1]).toMatchObject({ estado: 'falta', boton: { texto: 'Activar el plan', a: 'plan' } })
  })

  it('con el plan: falta el banco; si el banco existe sin su 572, el botón la crea', () => {
    expect(pasosDiez(listo([true, true, false, false]), 'Contabilidad', 0)[2].boton).toEqual({ tipo: 'ir', texto: 'Poner tu banco', a: 'bancos' })
    expect(pasosDiez(listo([true, true, false, false]), 'Contabilidad', 1)[2].boton).toEqual({ tipo: 'subcuentaBanco', texto: 'Crear su cuenta en el plan' })
  })

  it('el cuarto no tiene botón: lo hace la marca; dice en qué está', () => {
    const sinBase = pasosDiez(listo([true, true, true, false]), 'Contabilidad', 0)[3]
    expect(sinBase).toMatchObject({ estado: 'falta', boton: null })
    expect(sinBase.texto).toBe('Lo hace Contabilidad por ti: en cuanto registre tu base de Diez, la trae.')
    expect(pasosDiez(listo([true, true, true, false], { base: 'C0009' }), 'Contabilidad', 0)[3].texto).toContain('(C0009) está registrada')
    expect(pasosDiez(listo([true, true, true, false], { base: 'C0009', fallo: 'no cuadra con el testigo' }), 'Contabilidad', 0)[3].texto).toContain('no salió (no cuadra con el testigo)')
  })

  it('todo hecho: cuatro de cuatro, y el de Diez dice de qué base', () => {
    const p = pasosDiez(listo([true, true, true, true], { base: 'C0009' }), 'Contabilidad', 0)
    expect(resumenPasos(p)).toBe('4 de 4 hechos')
    expect(p[3].texto).toBe('Traída de la C0009.')
  })

  it('sin la palabra Folvy: la marca entra por parámetro', () => {
    const textos = pasosDiez(listo([true, true, true, false]), 'Contabilidad', 0).map((x) => x.texto).join(' ')
    expect(textos).not.toMatch(/folvy/i)
  })
})

import { dudas } from '../../../../src/modules/conta/lib/inicio'
import { filasPlan, SIN_NOMBRE, type CuentaPlan } from '../../../../src/modules/conta/lib/planVista'

describe('la subcuenta que llega de Diez sin nombre', () => {
  it('sale en «Solo necesito que me digas esto», con su texto', () => {
    expect(dudas([], 0, 0, 2)).toEqual([expect.objectContaining({ id: 'sin-nombre', tipo: 'sinNombre', titulo: '2 subcuentas sin nombre en Diez · pónselo' })])
    expect(dudas([], 0, 0, 1)[0].titulo).toBe('1 subcuenta sin nombre en Diez · pónselo')
    expect(dudas([], 0, 0)).toEqual([])
  })
  it('en el plan: «sin nombre en Diez · pónselo», y debajo el nombre de su cuenta del plan', () => {
    const c = (code: string, name: string, sinNombre: boolean): CuentaPlan => ({
      id: code, code, templateCode: '572', name, plainName: null, keywords: [], kind: 'own', status: 'activa', isCommon: false, source: 'migrated', sinNombre,
    })
    const filas = filasPlan({
      serie: [{ code: '57', name: 'Tesorería', plainName: null, groupCode: 5, parentCode: null, isLeaf: false },
        { code: '572', name: 'Bancos e instituciones de crédito c/c vista, euros', plainName: null, groupCode: 5, parentCode: '57', isLeaf: true }],
      cuentas: [c('57200002', 'Bancos e instituciones de crédito c/c vista, euros', true), c('57200003', 'Banco de la prueba', false)],
      enlaces: [], grupo: null, busqueda: '', orden: 'todas',
    })
    const sub = filas.filter((f) => f.tipo === 'subcuenta' || f.tipo === 'cuenta')
    expect(sub.find((f) => f.numero === '57200002')).toMatchObject({ titulo: SIN_NOMBRE, plain: 'Bancos e instituciones de crédito c/c vista, euros' })
    expect(sub.find((f) => f.numero === '57200003')?.titulo).toBe('Banco de la prueba')
  })
})
