// G05 (08/11/2026). Los nombres que no se confunden, contra el caso real: en la
// cuenta de Piri Piri las tres sociedades tienen el mismo nombre comercial
// («Piri Piri», medido en producción el 08/11) y cada una su razón social. Son
// nombres de sociedades, no de personas (T11).
import { describe, it, expect } from 'vitest'
import {
  gruposDeEmpresas, nombreQueNoSeConfunde, nombresQueNoSeConfunden, seccionesDelSelector,
  type ClienteDeDespacho, type CuentaMia,
} from '../../../src/modules/multitenancy/lib/misEmpresas'

const PIRI = [
  { id: 's1', nombre: 'Piri Piri', razon_social: 'Piripiri España, S.L.' },
  { id: 's2', nombre: 'Piri Piri', razon_social: 'Frango Takeaway, S.L.' },
  { id: 's3', nombre: 'Piri Piri', razon_social: 'Inversiones Piripiri Prosperidad, S.L.' },
]

describe('G05 · el nombre que no se confunde', () => {
  it('tres «Piri Piri» en la misma cuenta salen cada una con su razón social', () => {
    const n = nombresQueNoSeConfunden(PIRI)
    expect([...n.values()]).toEqual(['Piripiri España, S.L.', 'Frango Takeaway, S.L.', 'Inversiones Piripiri Prosperidad, S.L.'])
    expect(new Set(n.values()).size).toBe(3)
  })
  it('una sociedad sola, o con nombres distintos, sale con su nombre comercial', () => {
    expect(nombreQueNoSeConfunde(PIRI[0], [PIRI[0]])).toBe('Piri Piri')
    const distintas = [{ id: 'a', nombre: 'Bar Prueba', razon_social: 'Bar Prueba, S.L.' }, { id: 'b', nombre: 'Asador Prueba', razon_social: 'Asador Prueba, S.L.' }]
    expect(nombreQueNoSeConfunde(distintas[0], distintas)).toBe('Bar Prueba')
  })
  it('se compara sin mayúsculas ni espacios de más, y vale con razonSocial (el de la pantalla)', () => {
    const t = [{ id: 'a', nombre: 'Piri Piri', razonSocial: 'Frango Takeaway, S.L.' }, { id: 'b', nombre: ' piri piri ', razonSocial: 'Piripiri España, S.L.' }]
    expect(nombreQueNoSeConfunde(t[0], t)).toBe('Frango Takeaway, S.L.')
  })
  it('sin razón social no se inventa ninguna: el nombre comercial', () => {
    const t = [{ id: 'a', nombre: 'Piri Piri', razon_social: null }, PIRI[1]]
    expect(nombreQueNoSeConfunde(t[0], t)).toBe('Piri Piri')
  })
  it('el selector de varias cuentas ya no enseña tres «Piri Piri»', () => {
    const cuenta: CuentaMia = {
      account_id: 'piri', nombre: 'Piri Piri', slug: null, logo: null, rol: 'manager', solo_sumied: false, activa: true,
      sociedades: PIRI.map((s) => ({ ...s, color: null, logo: null })),
    }
    const g = gruposDeEmpresas([cuenta], 's2')
    expect(g[0].filas.map((f) => f.nombre)).toEqual(['Piripiri España, S.L.', 'Frango Takeaway, S.L.', 'Inversiones Piripiri Prosperidad, S.L.'])
    expect(g[0].filas.find((f) => f.abierta)?.nombre).toBe('Frango Takeaway, S.L.')
  })
})

describe('G05 · el selector con los clientes del despacho', () => {
  const qbo: CuentaMia = { account_id: 'qbo', nombre: 'Asesoría QBO', slug: null, logo: null, rol: 'admin', solo_sumied: true, activa: false, sociedades: [{ id: 'q1', nombre: 'Asesoría QBO', razon_social: null, color: null, logo: null }] }
  const piri: CuentaMia = { account_id: 'piri', nombre: 'Piri Piri', slug: null, logo: null, rol: 'manager', solo_sumied: false, activa: true, sociedades: PIRI.map((s) => ({ ...s, color: null, logo: null })) }
  const clientes: ClienteDeDespacho[] = PIRI.map((s) => ({ company_id: s.id, account_id: 'piri', razon_social: s.razon_social, nombre: s.nombre, despacho_id: 'qbo', despacho_nombre: 'Asesoría QBO' }))

  it('separa «Tus empresas» de «Clientes de Asesoría QBO», por razón social, sin repetir los accesos', () => {
    const s = seccionesDelSelector([qbo, piri], clientes, { abierto: { account_id: 'piri', despacho_id: 'qbo', despacho_nombre: 'Asesoría QBO' }, accesos: ['piri'] }, 's2')
    expect(s.map((x) => x.titulo)).toEqual(['Tus empresas', 'Clientes de Asesoría QBO'])
    expect(s[0].grupos.flatMap((g) => g.filas.map((f) => f.accountId))).toEqual(['qbo'])
    expect(s[1].grupos[0].filas.map((f) => f.nombre)).toEqual(['Frango Takeaway, S.L.', 'Inversiones Piripiri Prosperidad, S.L.', 'Piripiri España, S.L.'])
    expect(s[1].grupos[0].filas.filter((f) => f.abierta).map((f) => f.nombre)).toEqual(['Frango Takeaway, S.L.'])
  })
  it('sin despacho, solo «Tus empresas»', () => {
    const s = seccionesDelSelector([qbo], [], { abierto: null, accesos: [] }, null)
    expect(s.map((x) => x.titulo)).toEqual(['Tus empresas'])
  })
})
