// tests/unit/modules/conta/s02/marco.test.ts
//
// S02 · El marco del patrón único, sin pintar: el reparto de las acciones de
// una página (un principal, dos blancos, «Más acciones» y los selectores), las
// migas, el color de la empresa y lo que dice el botón del periodo.
// Regla 31: las acciones son las del catálogo DE VERDAD de cada página
// (esqueleto/ordenes.ts), no unas inventadas.

import { describe, expect, it } from 'vitest'
import { rutaConta } from '@/config/navegacion'
import { PRODUCTOS, dondeEsta, type Contexto } from '@/modules/conta/esqueleto/productos'
import { cintaDe } from '@/modules/conta/esqueleto/ordenes'
import { BLANCOS, hayAcciones, repartirAcciones, type GrupoDeAcciones } from '@/modules/conta/marco/acciones'
import { resolverGrupos } from '@/modules/conta/marco/resolverGrupos'
import { migasDe } from '@/modules/conta/marco/migas'
import { COLORES_DE_SERIE, FORMATO_COLOR, aHex, colorDeEmpresa, inicialDeEmpresa, numeroDeSerie } from '@/modules/conta/marco/colorEmpresa'
import { ejercicioDelDia, nombreDelMes, textoDelPeriodo, type Ejercicio } from '@/modules/conta/marco/periodo'

const NADA: Contexto = { hosteleria: false, diez: false, interruptores: new Set() }
const resueltas = (producto: Parameters<typeof cintaDe>[0], pagina: string, pathname = '/conta', search = '') =>
  resolverGrupos(cintaDe(producto, pagina, NADA), { datos: null, entradas: null, pathname, search, abrirBuscador: () => undefined })

describe('las acciones de una página, con la regla del patrón', () => {
  it('en cada página del catálogo: como mucho UN principal y dos blancos; lo demás en «Más acciones»; nada se pierde', () => {
    for (const p of PRODUCTOS) for (const t of p.pestanas) {
      const g = resueltas(p.id, t.id)
      const r = repartirAcciones(g)
      const todas = g.flatMap((x) => x.acciones.map((a) => a.id))
      const repartidas = [
        ...(r.principal ? [r.principal.id] : []), ...r.blancos.map((a) => a.id),
        ...r.mas.flatMap((x) => x.acciones.map((a) => a.id)), ...r.selectores.flatMap((s) => s.opciones.flatMap((x) => x.acciones.map((a) => a.id))),
      ]
      expect(r.blancos.length, `${p.id}.${t.id}`).toBeLessThanOrEqual(BLANCOS)
      expect([...repartidas].sort(), `${p.id}.${t.id}`).toEqual([...todas].sort())
    }
  })
  it('Asientos: «Para revisar» y «Libro diario» van en «Ver: … ▾» (a dónde ir), el resto son acciones', () => {
    const r = repartirAcciones(resueltas('contabilidad', 'asientos', '/conta/libros/diario', '?ver=revisar'))
    expect(r.selectores.map((s) => [s.titulo, s.actual?.etiqueta])).toEqual([['Ver', 'Para revisar']])
    expect(r.principal).toBeNull()
    // S02 · PR 2: la emitida y las recibidas salieron de Asientos (Facturación, Compras y gastos).
    expect(r.blancos.map((a) => a.etiqueta)).toEqual(['Tesorería', 'General'])
    expect(r.mas.map((g) => g.titulo)).toEqual(['Nuevo', 'Utilidades'])
  })
  it('con la barra de la página (el libro diario), todo lo del catálogo va a «Más acciones»: no compite con su principal', () => {
    const r = repartirAcciones(resueltas('contabilidad', 'asientos'), true)
    expect(r.principal).toBeNull()
    expect(r.blancos).toEqual([])
    expect(r.mas.flatMap((g) => g.acciones).length).toBe(4)
  })
  it('Bancos: «Subir extracto» es el principal; los bancos de la pantalla, un selector', () => {
    const g: GrupoDeAcciones[] = [
      { titulo: 'Tus bancos', acciones: [{ id: 'b1', etiqueta: 'BBVA', a: '/conta/bancos?banco=b1', actual: true, grupo: 'Tus bancos' }, { id: 'b2', etiqueta: 'Caixa', a: '/conta/bancos?banco=b2', actual: false, grupo: 'Tus bancos' }] },
      ...resueltas('bancos', 'movimientos').filter((x) => x.acciones.length > 0),
    ]
    const r = repartirAcciones(g)
    expect(r.principal?.etiqueta).toBe('Subir extracto')
    expect(r.selectores.map((s) => [s.titulo, s.actual?.etiqueta])).toEqual([['Tus bancos', 'BBVA']])
  })
  it('una página sin acciones no pinta la fila (no queda un hueco vacío)', () => {
    expect(hayAcciones(repartirAcciones([]))).toBe(false)
  })
})

describe('las migas: desde el segundo nivel, y la última no es un enlace', () => {
  const r = (x: string) => rutaConta(x)
  it('Compras y gastos › Facturas recibidas › EUROPASTRY 24048027 (tablero 3)', () => {
    const m = migasDe(dondeEsta('/conta/documentos/recibidas/x'), r, [{ etiqueta: 'EUROPASTRY 24048027' }])
    expect(m).toEqual([
      { etiqueta: 'Compras y gastos', a: '/conta/documentos' },
      { etiqueta: 'Facturas recibidas', a: '/conta/documentos' },
      { etiqueta: 'EUROPASTRY 24048027' },
    ])
  })
  it('una página de un apartado: dos migas, la segunda sin enlace (tablero 2)', () => {
    expect(migasDe(dondeEsta('/conta/documentos'), r)).toEqual([{ etiqueta: 'Compras y gastos', a: '/conta/documentos' }, { etiqueta: 'Facturas recibidas' }])
  })
  it('Inicio es el primer nivel: sin migas', () => {
    expect(migasDe(dondeEsta('/conta/inicio'), r)).toEqual([])
  })
})

describe('el color de la empresa', () => {
  it('el elegido si es #RRGGBB; si no, uno de los ocho de serie por su inicial, siempre el mismo', () => {
    expect(colorDeEmpresa('#0B6B67', 'Foodint')).toBe('#0B6B67')
    expect(colorDeEmpresa('verde', 'Foodint')).toBe(`var(--s-empresa-${numeroDeSerie('Foodint')})`)
    expect(colorDeEmpresa(null, 'Foodint')).toBe(colorDeEmpresa(null, 'Foodint'))
    expect(numeroDeSerie('Ñandú')).toBeGreaterThanOrEqual(1)
    expect(numeroDeSerie('Ñandú')).toBeLessThanOrEqual(COLORES_DE_SERIE)
    expect(numeroDeSerie('')).toBe(COLORES_DE_SERIE)
  })
  it('la inicial: la primera letra o cifra; sin nombre, un punto', () => {
    expect(inicialDeEmpresa('foodint')).toBe('F')
    expect(inicialDeEmpresa('  29 Llorente')).toBe('2')
    expect(inicialDeEmpresa('')).toBe('·')
  })
  it('lo que pinta el navegador se guarda como #RRGGBB, el mismo formato que comprueba la base (0460)', () => {
    expect(aHex('rgb(11, 107, 103)')).toBe('#0B6B67')
    expect(aHex('#1e63c9')).toBe('#1E63C9')
    expect(aHex('var(--x)')).toBeNull()
    expect(FORMATO_COLOR.test('#0B6B67')).toBe(true)
    expect(FORMATO_COLOR.test('#0B6B6')).toBe(false)
  })
})

describe('el botón del periodo: «Octubre 2026 · Ejercicio 2026 · abierto»', () => {
  const EJ: Ejercicio[] = [
    { codigo: '2026', desde: '2026-01-01', hasta: '2026-12-31', estado: 'open' },
    { codigo: '2025', desde: '2025-01-01', hasta: '2025-12-31', estado: 'closed' },
  ]
  it('de un mes: el mes y su ejercicio con su estado', () => {
    expect(textoDelPeriodo({ mes: '2026-10' }, EJ)).toEqual({ arriba: 'Octubre 2026', abajo: 'Ejercicio 2026 · abierto', entero: 'Octubre 2026 · Ejercicio 2026 · abierto' })
    expect(textoDelPeriodo({ mes: '2025-03' }, EJ).abajo).toBe('Ejercicio 2025 · cerrado')
  })
  it('de un ejercicio entero', () => {
    expect(textoDelPeriodo({ ejercicio: '2025' }, EJ).entero).toBe('Ejercicio 2025 · cerrado')
  })
  it('sin ejercicio dado de alta para esa fecha, se dice: no se inventa un estado', () => {
    expect(textoDelPeriodo({ mes: '2024-05' }, EJ).abajo).toBe('sin ejercicio dado de alta')
    expect(ejercicioDelDia('2024-05-01', EJ)).toBeNull()
    expect(nombreDelMes('2026-01')).toBe('Enero 2026')
  })
})
