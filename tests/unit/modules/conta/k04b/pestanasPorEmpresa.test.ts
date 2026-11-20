// tests/unit/modules/conta/k04b/pestanasPorEmpresa.test.ts
//
// K05 · 0b · Las pestañas son de su empresa (Julio, 19/11): a qué empresa
// pertenece cada pestaña y qué se ve al cambiar. Al cambiar, solo las de la
// nueva (o su Inicio); las de la otra se aparcan tal cual y vuelven al volver.

import { describe, expect, it } from 'vitest'
import {
  abiertasEnOtras, aGuardarPorEmpresa, alNavegar, cambiarDeEmpresa, estadoInicial, fraseAbiertasEn, INICIO, llaveDe, pestanasDeEmpresasGuardadas,
  type PestanasDeEmpresas,
} from '@/modules/conta/nucleo/pestanas'

const FACTURA = '/conta/documentos/recibidas/f1?ver=por-revisar'
const BANCOS = '/conta/bancos'

function conUnaFactura(): PestanasDeEmpresas {
  const e = alNavegar(alNavegar(estadoInicial(1), BANCOS, 2), FACTURA, 3)
  return { empresa: 'e1', estado: e, aparcadas: {} }
}

describe('K05 · 0b · las pestañas son de su empresa', () => {
  it('la primera vez que se sabe la empresa, las que se ven pasan a ser suyas y no se navega', () => {
    const t = { ...conUnaFactura(), empresa: null }
    const r = cambiarDeEmpresa(t, 'e1', 9)
    expect(r.ir).toBeNull()
    expect(r.t.empresa).toBe('e1')
    expect(r.t.estado).toBe(t.estado)
  })
  it('al cambiar a una empresa sin nada abierto: sale su Inicio, y las de la otra se aparcan tal cual', () => {
    const t = conUnaFactura()
    const r = cambiarDeEmpresa(t, 'e2', 10)
    expect(r.t.empresa).toBe('e2')
    expect(r.t.estado.abiertas.map((p) => p.id)).toEqual([INICIO])
    expect(r.t.estado.activa).toBe(INICIO)
    expect(r.ir).toBe('/conta/inicio')
    expect(r.t.aparcadas.e1).toBe(t.estado)
  })
  it('al volver, están las suyas, con la que estaba activa y su dirección', () => {
    const a = cambiarDeEmpresa(conUnaFactura(), 'e2', 10).t
    const b = { ...a, estado: alNavegar(a.estado, BANCOS, 11) }
    const r = cambiarDeEmpresa(b, 'e1', 12)
    expect(r.t.estado.abiertas.map((p) => p.id)).toEqual([INICIO, 'boton:bancos', 'ficha:recibida'])
    expect(r.t.estado.activa).toBe('ficha:recibida')
    expect(r.ir).toBe(FACTURA)
    // Las de la e2 quedan aparcadas, también tal cual.
    expect(r.t.aparcadas.e2.abiertas.map((p) => p.id)).toEqual([INICIO, 'boton:bancos'])
    expect(r.t.aparcadas.e1).toBeUndefined()
  })
  it('cambiar a la misma empresa no hace nada', () => {
    const t = conUnaFactura()
    expect(cambiarDeEmpresa(t, 'e1', 5)).toEqual({ t, ir: null })
  })
  it('la llave de una pestaña lleva su empresa: la misma ficha en dos empresas son dos pestañas', () => {
    expect(llaveDe('e1', 'ficha:recibida')).not.toBe(llaveDe('e2', 'ficha:recibida'))
  })
  it('la línea de abajo: las otras empresas con algo abierto además de su Inicio', () => {
    const a = cambiarDeEmpresa(conUnaFactura(), 'e2', 10).t
    expect(abiertasEnOtras(a)).toEqual([{ empresa: 'e1', n: 2 }])
    const soloInicio = cambiarDeEmpresa(cambiarDeEmpresa({ empresa: 'e1', estado: estadoInicial(1), aparcadas: {} }, 'e2', 2).t, 'e3', 3).t
    expect(abiertasEnOtras(soloInicio)).toEqual([])
    expect(fraseAbiertasEn(2, 'Gestoría de Ejemplo Núcleo, S.L.')).toBe('2 pestañas abiertas en Gestoría de Ejemplo Núcleo, S.L.')
    expect(fraseAbiertasEn(1, 'X')).toBe('1 pestaña abierta en X')
  })
  it('al recargar siguen las de cada empresa: las que se veían, con la dirección de ahora, y las aparcadas, dormidas', () => {
    const a = cambiarDeEmpresa(conUnaFactura(), 'e2', 10).t
    const g = JSON.parse(JSON.stringify(aGuardarPorEmpresa(a)))
    const r = pestanasDeEmpresasGuardadas(g, '/conta/inicio', 20)
    expect(r.empresa).toBe('e2')
    expect(r.aparcadas.e1.abiertas.map((p) => p.id)).toEqual([INICIO, 'boton:bancos', 'ficha:recibida'])
    expect(r.aparcadas.e1.activa).toBe('ficha:recibida')
    expect(r.aparcadas.e1.abiertas.every((p) => !p.montada)).toBe(true)
  })
  it('lo guardado con el formato de antes (sin empresa) se sigue entendiendo', () => {
    const r = pestanasDeEmpresasGuardadas({ abiertas: [{ id: 'boton:bancos', url: BANCOS }], activa: 'boton:bancos' }, BANCOS, 1)
    expect(r.empresa).toBeNull()
    expect(r.estado.abiertas.map((p) => p.id)).toEqual([INICIO, 'boton:bancos'])
    expect(r.aparcadas).toEqual({})
  })
})
