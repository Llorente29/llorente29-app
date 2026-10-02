// Pruebas de la tarea 2 del C00: navegación del módulo, contrato con la
// cuenta, empresa activa y contraste de los colores (leídos de tokens.css, el
// único sitio donde están).
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  BARRA_CONTA, CONTA, MENU_CONTA, PESTANAS_AJUSTES, entradaActiva, entradasVisibles,
  rutaAltaEmpresa, rutaApartadoEmpresa, rutaTablasGenerales, rutaTuEmpresa,
} from '@/config/navegacion'
import { leerFilaDeCuenta } from '@/modules/conta/cuenta/contratoCuenta'
import { empresaQueQuedaActiva, type EmpresaResumen } from '@/modules/conta/empresa/contexto'

describe('navegación del módulo de contabilidad', () => {
  it('las direcciones salen de un sitio', () => {
    expect(rutaTuEmpresa()).toBe('/conta/ajustes')
    expect(rutaTablasGenerales()).toBe('/conta/ajustes/tablas')
    expect(rutaTablasGenerales('impuestos')).toBe('/conta/ajustes/tablas/impuestos')
    expect(rutaApartadoEmpresa('quien')).toBe('/conta/ajustes/empresa/quien')
    expect(rutaAltaEmpresa()).toBe('/conta/alta')
  })
  it('las entradas sin pantalla no se pintan', () => {
    const visibles = MENU_CONTA.flat().filter((e) => e.ruta !== null).map((e) => e.id)
    expect(visibles).toEqual(['ajustes'])
    expect(entradasVisibles(PESTANAS_AJUSTES).map((e) => e.id)).toEqual(['empresa', 'tablas'])
    expect(entradasVisibles(BARRA_CONTA.derecha).map((e) => e.id)).toEqual(['ajustes'])
  })
  it('el menú está entero, en el orden de la maqueta', () => {
    expect(MENU_CONTA.flat().map((e) => e.etiqueta)).toEqual([
      'Inicio', 'Por hacer', 'Documentos', 'Bancos', 'Clientes y proveedores', 'Pagos y cobros',
      'Facturas que emites', 'Impuestos', 'Cómo va tu negocio', 'Libros', 'Ajustes',
    ])
  })
  it('la pestaña activa es la de prefijo más largo', () => {
    expect(entradaActiva('/conta/ajustes', PESTANAS_AJUSTES)).toBe('empresa')
    expect(entradaActiva('/conta/ajustes/empresa/quien', PESTANAS_AJUSTES)).toBe('empresa')
    expect(entradaActiva('/conta/ajustes/tablas', PESTANAS_AJUSTES)).toBe('tablas')
    expect(entradaActiva('/conta/ajustes/tablas/impuestos', PESTANAS_AJUSTES)).toBe('tablas')
    expect(entradaActiva('/conta/ajustes/tablas/impuestos', MENU_CONTA.flat())).toBe('ajustes')
    expect(entradaActiva('/kitchen/proveedores', PESTANAS_AJUSTES)).toBeNull()
  })
  it('no cuelga de Cocina', () => {
    expect(CONTA.modulo).toBe('conta')
    const todas = [...MENU_CONTA.flat(), ...PESTANAS_AJUSTES].map((e) => e.ruta ?? '')
    expect(todas.some((r) => r.includes('kitchen'))).toBe(false)
  })
})

describe('contrato con la cuenta', () => {
  it('lee lo que accounts ya tiene (forma de producción)', () => {
    expect(leerFilaDeCuenta({
      name: 'Foodint', legal_name: 'Llorente29 Food, S.L.', cif: 'B56496938',
      billing_address: { city: 'Madrid', street: 'Florencio Llorente, 29', province: 'Madrid', postalCode: '28027' },
    })).toEqual({
      nombre: 'Foodint', razonSocial: 'Llorente29 Food, S.L.', nif: 'B56496938',
      direccion: { calle: 'Florencio Llorente, 29', codigoPostal: '28027', poblacion: 'Madrid', provincia: 'Madrid' },
    })
  })
  it('lo que falta queda en null, sin inventar (Folvy Interno: sin CIF y dirección {})', () => {
    expect(leerFilaDeCuenta({ name: 'Folvy Interno', legal_name: 'Folvy', cif: null, billing_address: {} }))
      .toEqual({ nombre: 'Folvy Interno', razonSocial: 'Folvy', nif: null, direccion: null })
    expect(leerFilaDeCuenta(null)).toEqual({ nombre: null, razonSocial: null, nif: null, direccion: null })
  })
})

describe('empresa activa', () => {
  const e = (id: string): EmpresaResumen => ({ id, nombre: id, razonSocial: null, nif: null, completa: true })
  it('la recordada si existe; si no, la primera; sin empresas, ninguna', () => {
    expect(empresaQueQuedaActiva([e('a'), e('b')], 'b')?.id).toBe('b')
    expect(empresaQueQuedaActiva([e('a'), e('b')], 'borrada')?.id).toBe('a')
    expect(empresaQueQuedaActiva([], 'a')).toBeNull()
  })
})

// ── Contraste, con los valores de tokens.css ──────────────────────────────
const tokens = readFileSync(resolve(__dirname, '../../../../src/modules/conta/estilo/tokens.css'), 'utf8')
function token(nombre: string): string {
  const m = tokens.match(new RegExp(`--cx-${nombre}:\\s*(#[0-9A-Fa-f]{6})`))
  if (!m) throw new Error(`no encuentro --cx-${nombre}`)
  return m[1]
}
function luminancia(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
function contraste(a: string, b: string): number {
  const x = luminancia(a); const y = luminancia(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

describe('contraste del estilo nuevo (mínimo 4,5:1)', () => {
  const pares: [string, string][] = [
    ['texto', 'fondo'], ['texto', 'blanco'], ['apoyo', 'blanco'], ['apoyo', 'fondo'],
    ['blanco', 'azul'], ['azul', 'blanco'], ['azul', 'azul-suave'], ['verde-oscuro', 'verde-suave'],
    ['ambar', 'ambar-suave'], ['texto', 'ia'], ['ia-apoyo', 'verde-suave'], ['neutro-texto', 'neutro-suave'],
    ['rojo', 'rojo-suave'], ['apoyo', 'pendiente'], ['verde-oscuro', 'blanco'],
    ['texto', 'inicial-1'], ['texto', 'inicial-2'], ['texto', 'inicial-3'], ['texto', 'inicial-4'], ['texto', 'inicial-5'],
  ]
  for (const [letra, fondo] of pares) {
    it(`${letra} sobre ${fondo}`, () => {
      expect(contraste(token(letra), token(fondo))).toBeGreaterThanOrEqual(4.5)
    })
  }
  it('el verde de la IA NO sirve como letra sobre blanco (por eso solo es fondo)', () => {
    expect(contraste(token('ia'), token('blanco'))).toBeLessThan(4.5)
  })
})
