// C03 · Respuesta 3: la revisión de las 430 traídas (src/modules/conta/lib/revision430.ts).
//
// La población es la fixture INVENTADA de Diez (tests/conta/fixtures/importar/diez/),
// la misma forma que el Diez del primer cliente: siete 430 (tres plataformas, una
// de un proveedor con el mismo NIF, dos clientes sin ficha y «GLOVO VENTAS»),
// leídas de sus CSV, no escritas a mano. El caso de producción (la 430 de una
// plataforma cuyo proveedor está con el nombre de su sociedad) va aparte, con
// los nombres públicos de las plataformas.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { elegida, hecha, plataformaDe, proponer430, queHace, type Cuenta430, type Tercero430 } from '@/modules/conta/lib/revision430'

const dir = join(__dirname, '../../../conta/fixtures/importar/diez')
const csv = (f: string) => readFileSync(join(dir, f), 'utf8').trim().split('\n').slice(1).map((l) => l.split(';'))

// Los proveedores de la fixture, como quedan tras traer el plan: un tercero con papel de proveedor por ficha.
const terceros: Tercero430[] = csv('proveedores.csv').map(([code, nif, nombre]) => ({
  id: `p-${code}`, nombre, nif: nif || null, papeles: ['supplier'], supplierId: `s-${code}`, archivado: false, codigoProveedor: code,
}))
// Lo que dejó la importación (C02c): la 430 de Glovo, cuenta de pago de su proveedor (41000001, mismo nombre).
const PAGO: Record<string, string> = { '43000001': 's-41000001' }
const cuentas: Cuenta430[] = csv('clientes.csv').map(([code, nif, nombre, calle, cp, poblacion, provincia]) => ({
  id: `c-${code}`, code, name: nombre, nif: nif || null, direccion: { calle, cp, poblacion, provincia },
  pagoDeProveedor: PAGO[code] ?? null, clienteDe: null, propia: false,
}))
const canales = [
  { id: 'k-glovo', nombre: 'Glovo', plataformaDe: null },
  { id: 'k-uber', nombre: 'Uber', plataformaDe: null },
  { id: 'k-je', nombre: 'JustEat', plataformaDe: 'otra-plataforma' },
]
const de = (code: string) => proponer430(cuentas.find((c) => c.code === code)!, terceros, canales)

describe('la fixture de Diez: las siete 430, cada una con su papel', () => {
  it('son siete y ninguna está hecha (un enlace de pago no es un papel)', () => {
    expect(cuentas.map((c) => c.code)).toEqual(['43000001', '43000002', '43000003', '43000004', '43000005', '43000006', '43000101'])
    expect(cuentas.filter((c) => hecha(c, terceros))).toEqual([])
  })
  it('la tabla entera: tipo, ficha y confianza', () => {
    const tabla = cuentas.map((c) => {
      const p = proponer430(c, terceros, canales)
      return `${c.code} ${p.tipo} ${p.tercero?.codigoProveedor ?? '-'} ${p.confianza} ${p.canal?.nombre ?? '-'}`
    })
    expect(tabla).toEqual([
      '43000001 plataforma 41000001 seguro Glovo',
      '43000002 plataforma 41000002 seguro Uber',
      // Mismo nombre, pero el NIF de la 430 no es el de la ficha: probable, y el canal ya es de otra plataforma.
      '43000003 plataforma 41000003 probable -',
      // Nadie con su NIF ni su nombre: ficha nueva con el NIF del listado.
      '43000004 cliente - seguro -',
      // Mismo NIF que un proveedor: socio de marca.
      '43000005 socio 40000003 seguro -',
      '43000006 cliente - probable -',
      '43000101 propia - probable -',
    ])
  })
  it('cada porqué dice de dónde sale', () => {
    expect(de('43000001').porque).toBe('Es Glovo y ya está enlazada a 41000001 · GLOVOAPP SPAIN PLATFORM para compensar sus pagos.')
    expect(de('43000003').porque).toBe('Es Just Eat: mismo nombre que 41000003 · JUST EAT SPAIN.')
    expect(de('43000005').porque).toBe('Mismo NIF que 40000003 · NORTE SOCIOS, S.L. Es proveedor y cliente a la vez: te vende y te paga, lo propio de un socio de marca.')
    expect(de('43000004').porque).toBe('Nadie tiene su NIF (B99009011) ni su nombre: ficha nueva, traída del listado y por completar.')
    expect(de('43000101').porque).toContain('es la cuenta de tus ventas por Glovo, no un cliente')
  })
  it('lo que hace «Confirmar», en palabras', () => {
    const c = (code: string) => cuentas.find((x) => x.code === code)!
    expect(queHace(c('43000001'), de('43000001'))).toBe('GLOVOAPP SPAIN PLATFORM pasa a ser plataforma de reparto (canal Glovo, con sus liquidaciones) y 43000001 su cuenta de cliente.')
    expect(queHace(c('43000005'), de('43000005'), true)).toBe('NORTE SOCIOS, S.L. pasa a ser socio de marca y cliente, con 43000005 como su cuenta de cliente; queda archivado (histórico).')
    expect(queHace(c('43000004'), de('43000004'))).toBe('Ficha nueva de cliente «NUBE COCINAS COMPARTIDAS» con NIF B99009011 y 43000004 como su cuenta.')
    expect(queHace(c('43000101'), de('43000101'))).toBe('43000101 se queda como cuenta tuya, sin ficha.')
  })
})

describe('hecha: cuándo sale de «por revisar»', () => {
  const c = cuentas.find((x) => x.code === '43000001')!
  it('enlazada como cuenta de cliente de alguien que solo es proveedor: no está hecha', () => {
    expect(hecha({ ...c, clienteDe: 'p-41000001' }, terceros)).toBe(false)
  })
  it('con papel de plataforma, cliente o socio: hecha; y la cuenta tuya, también', () => {
    const conPapel = terceros.map((t) => (t.id === 'p-41000001' ? { ...t, papeles: ['supplier', 'platform'] as const } : t))
    expect(hecha({ ...c, clienteDe: 'p-41000001' }, conPapel)).toBe(true)
    expect(hecha({ ...c, propia: true }, terceros)).toBe(true)
  })
})

describe('plataformas por su nombre o su sociedad', () => {
  it('los nombres con que llegan', () => {
    for (const n of ['GLOVO', 'GLOVOAPP SPAIN PLATFORM', 'Acreedores · GLOVOAPP SPAIN PLATFORM', 'Glovo']) expect(plataformaDe(n)?.nombre, n).toBe('Glovo')
    for (const n of ['UBER EATS', 'Uber', 'UBER EATS SPAIN']) expect(plataformaDe(n)?.nombre, n).toBe('Uber Eats')
    for (const n of ['JUST EAT', 'JUST EAT, S.L.', 'JustEat']) expect(plataformaDe(n)?.nombre, n).toBe('Just Eat')
    expect(plataformaDe('PORTIER EATS SPAIN, S.L.')).toEqual({ nombre: 'Uber Eats', porSociedad: 'Portier Eats Spain es la sociedad de Uber Eats en España' })
  })
  it('lo que no es una plataforma no lo parece', () => {
    for (const n of ['Uberto Restaurante', 'GLOBO ROJO', 'Plataforma Norte', 'Mostrador', 'Shop', 'NUBE COCINAS COMPARTIDAS']) expect(plataformaDe(n), n).toBeNull()
  })
  it('la 430 sin NIF de una plataforma cuyo proveedor está con el nombre de su sociedad: probable', () => {
    const portier: Tercero430 = { id: 'p-port', nombre: 'PORTIER EATS SPAIN, S.L.', nif: 'B00000000', papeles: ['supplier'], supplierId: 's-port', archivado: false, codigoProveedor: '41000003' }
    const p = proponer430({ ...cuentas[1], name: 'UBER EATS', nif: null }, [portier], canales)
    expect(p.tipo).toBe('plataforma')
    expect(p.tercero?.id).toBe('p-port')
    expect(p.confianza).toBe('probable')
    expect(p.porque).toBe('Portier Eats Spain es la sociedad de Uber Eats en España: 41000003 · PORTIER EATS SPAIN, S.L. La 430 no trae NIF: confírmalo tú.')
    expect(p.canal?.nombre).toBe('Uber')
  })
})

describe('«Cambiar»', () => {
  it('lo que elige la persona va como seguro y con su porqué', () => {
    const t = terceros.find((x) => x.codigoProveedor === '41000001')!
    expect(elegida('plataforma', t, canales)).toEqual({ tipo: 'plataforma', tercero: t, canal: canales[0], confianza: 'seguro', porque: 'Lo has elegido tú.' })
    expect(elegida('propia', t, canales).tercero).toBeNull()
  })
})
