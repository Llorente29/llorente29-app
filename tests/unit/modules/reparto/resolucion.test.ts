// R02 · La resolución de «quién reparte»: las capas, el local y las celdas
// reales de Foodint (regla 31: la población de verdad, medida el 04/10 en solo
// lectura, no ejemplos inventados). Espejo de public.resolve_delivery_by; la
// prueba en la base es supabase/staging/sql/20261005_r02_prueba_resolucion.sql.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  TODOS_LOS_LOCALES, esDecidida, localesQueSeSeparan, quienDeServiceType, resolver, serviceTypeDe,
  type Celda, type Herencia, type TipoDeMarca,
} from '@/modules/reparto/lib/resolucion'

const herenciasBase: Herencia[] = [
  { channelSlug: 'glovo', ownershipType: 'own', locationId: null, deliveryBy: 'own' },
  { channelSlug: 'glovo', ownershipType: 'licensed', locationId: null, deliveryBy: 'platform' },
  { channelSlug: 'uber', ownershipType: 'own', locationId: null, deliveryBy: 'own' },
]
const burger = { id: 'burger', ownershipType: 'own' as TipoDeMarca }
const cedida = { id: 'cedida', ownershipType: 'licensed' as TipoDeMarca }
const celda = (c: Partial<Celda>): Celda => ({
  brandId: 'burger', channelSlug: 'glovo', locationId: TODOS_LOS_LOCALES, deliveryBy: 'platform',
  source: 'manual', decidedAt: null, decidedByName: null, ...c,
})

describe('las capas', () => {
  it('sin celda, hereda por tipo de marca', () => {
    expect(resolver([], herenciasBase, burger, 'glovo', null)).toMatchObject({ deliveryBy: 'own', source: 'inherited', nivel: 'herencia_cuenta' })
    expect(resolver([], herenciasBase, cedida, 'glovo', null)).toMatchObject({ deliveryBy: 'platform', source: 'inherited' })
  })
  it('sin celda ni herencia, «Plataforma» por defecto', () => {
    expect(resolver([], herenciasBase, burger, 'justeat', null)).toMatchObject({ deliveryBy: 'platform', source: 'default', nivel: 'defecto' })
    expect(resolver([], herenciasBase, { id: 'x', ownershipType: null }, 'glovo', null)).toMatchObject({ source: 'default' })
  })
  it('la celda de la marca manda sobre la herencia, con su origen', () => {
    const r = resolver([celda({ deliveryBy: 'platform', source: 'migrated' })], herenciasBase, burger, 'glovo', null)
    expect(r).toMatchObject({ deliveryBy: 'platform', source: 'migrated', nivel: 'marca' })
    expect(esDecidida(r)).toBe(true)
  })
  it('la celda del local manda en su local, y solo en el suyo', () => {
    const celdas = [celda({ deliveryBy: 'platform' }), celda({ locationId: 'mercado', deliveryBy: 'own' })]
    expect(resolver(celdas, herenciasBase, burger, 'glovo', 'mercado')).toMatchObject({ deliveryBy: 'own', nivel: 'local' })
    expect(resolver(celdas, herenciasBase, burger, 'glovo', 'centro')).toMatchObject({ deliveryBy: 'platform', nivel: 'marca' })
    expect(localesQueSeSeparan(celdas, 'burger', 'glovo')).toEqual(['mercado'])
  })
  it('la herencia del local antes que la de la cuenta', () => {
    const h: Herencia[] = [...herenciasBase, { channelSlug: 'glovo', ownershipType: 'own', locationId: 'mercado', deliveryBy: 'platform' }]
    expect(resolver([], h, burger, 'glovo', 'mercado')).toMatchObject({ deliveryBy: 'platform', nivel: 'herencia_local' })
    expect(resolver([], h, burger, 'glovo', 'centro')).toMatchObject({ deliveryBy: 'own', nivel: 'herencia_cuenta' })
  })
  it('la celda de otra marca o de otro canal no cuenta', () => {
    expect(resolver([celda({ brandId: 'otra' }), celda({ channelSlug: 'uber' })], herenciasBase, burger, 'glovo', null))
      .toMatchObject({ nivel: 'herencia_cuenta' })
  })
  it('service_type ↔ quién reparte', () => {
    expect(serviceTypeDe('own')).toBe('own_delivery')
    expect(serviceTypeDe('platform')).toBe('platform_delivery')
    expect(quienDeServiceType('own_delivery')).toBe('own')
    expect(quienDeServiceType('pickup')).toBeNull()
  })
})

// La migración (20261005T0110) escribe, para cada marca × canal, la conjunción
// de hoy: herencia own_delivery Y interruptor efectivo. Con las celdas que
// escribe, la resolución nueva tiene que dar lo mismo que la decisión de hoy
// en las 54 celdas de Foodint, y coincidir con la regla de Julio (encendido →
// own en todas; apagado → platform en todas).
describe('Foodint, 04/10: las 54 celdas migradas', () => {
  const f = JSON.parse(readFileSync('tests/unit/modules/reparto/foodint-20261004.json', 'utf8')) as {
    canales: string[]
    herencias: { channelSlug: string; ownershipType: TipoDeMarca; serviceType: string }[]
    marcas: { nombre: string; tipo: TipoDeMarca; interruptor: boolean | null }[]
  }
  const herencias: Herencia[] = f.herencias.map(h => ({
    channelSlug: h.channelSlug, ownershipType: h.ownershipType, locationId: null,
    deliveryBy: h.serviceType === 'own_delivery' ? 'own' : 'platform',
  }))
  const efectivo = (m: { tipo: TipoDeMarca; interruptor: boolean | null }) => m.interruptor ?? m.tipo === 'own'
  const hoy = (m: { tipo: TipoDeMarca; interruptor: boolean | null }, canal: string) => {
    const h = f.herencias.find(x => x.channelSlug === canal && x.ownershipType === m.tipo)
    return h?.serviceType === 'own_delivery' && efectivo(m) ? 'own' : 'platform'
  }
  const migradas: Celda[] = f.marcas.flatMap(m => f.canales.map(canal => ({
    brandId: m.nombre, channelSlug: canal, locationId: TODOS_LOS_LOCALES, deliveryBy: hoy(m, canal),
    source: 'migrated' as const, decidedAt: null, decidedByName: null,
  })))

  it('son 54', () => expect(migradas).toHaveLength(54))
  it('la resolución nueva da lo de hoy en todas (0 diferencias)', () => {
    const distintas = f.marcas.flatMap(m => f.canales
      .filter(canal => resolver(migradas, herencias, { id: m.nombre, ownershipType: m.tipo }, canal, null).deliveryBy !== hoy(m, canal))
      .map(canal => `${m.nombre} · ${canal}`))
    expect(distintas).toEqual([])
  })
  it('y coincide con la regla de Julio: encendido → own en todas; apagado → platform en todas', () => {
    for (const m of f.marcas) for (const canal of f.canales) {
      expect(resolver(migradas, herencias, { id: m.nombre, ownershipType: m.tipo }, canal, null).deliveryBy)
        .toBe(efectivo(m) ? 'own' : 'platform')
    }
  })
  it('Smash y Lovers quedan en «Plataforma» en las tres; las cedidas también', () => {
    const plat = migradas.filter(c => c.deliveryBy === 'platform').map(c => c.brandId)
    expect(new Set(plat)).toEqual(new Set(f.marcas.filter(m => !efectivo(m)).map(m => m.nombre)))
    expect(plat.filter(n => n === 'Smash Brothers Burgers')).toHaveLength(3)
    expect(plat.filter(n => n === 'Lovers Burgers')).toHaveLength(3)
  })
})
