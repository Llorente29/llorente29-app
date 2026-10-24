// tests/unit/modules/conta/s01e/libros.test.ts
//
// S01e · Lo que confunde en Libros (PR 3 de la auditoría de navegación):
// plurales, el nombre del fichero AEAT, el F4 sin jerga, el cierre sin
// ejercicio siguiente, el modelo de cuentas anuales sin contradecirse,
// Retenciones fuera de «IVA» y las tablas apiladas en el móvil.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { cuantas } from '@/modules/conta/lib/plural'
import { etiquetaTipo, nombreFichero } from '@/modules/conta/lib/libroRegistro'
import { prepararCierre, sumas, type SaldoACerrar } from '@/modules/conta/lib/cierre'
import { modeloPropuesto } from '@/modules/conta/lib/cuentasAnuales'
import { AREAS_LIBROS, dondeEsta } from '@/modules/conta/libros/navegacion'
import { periodosDelEjercicio } from '@/modules/conta/libros/contexto'
import { cintaDe } from '@/modules/conta/esqueleto/ordenes'

describe('S01e · el número con su palabra', () => {
  it('«1 expedida», «2 expedidas», «0 bienes», «1 bien»', () => {
    expect(cuantas(1, 'expedida', 'expedidas')).toBe('1 expedida')
    expect(cuantas(2, 'expedida', 'expedidas')).toBe('2 expedidas')
    expect(cuantas(0, 'bien', 'bienes')).toBe('0 bienes')
    expect(cuantas(1, 'bien', 'bienes')).toBe('1 bien')
  })
})

describe('S01e · el nombre del fichero del requerimiento', () => {
  // La razón social real de la única empresa en producción (company.legal_name,
  // leída el 18/10/2026): acaba en punto, que es justo el caso que fallaba.
  const REAL = 'Llorente29 Food, S.L.'
  it('sin «..» antes de la extensión', () => {
    const n = nombreFichero(2026, 'B12345678', REAL)
    expect(n).toBe('2026B12345678CLlorente29 Food, S.L.xlsx')
    expect(n).not.toMatch(/\.\.xlsx$/)
  })
  it('ni espacios ni puntos sueltos al final, y los caracteres prohibidos fuera', () => {
    expect(nombreFichero(2026, 'b-1', 'Casa: Pepe S.A. . ')).toBe('2026B1CCasa Pepe S.A.xlsx')
  })
})

describe('S01e · el resumen de tiques, sin la cita del reglamento', () => {
  it('dice qué es, su rango y cuántos', () => {
    const t = etiquetaTipo({ invoiceType: 'F4', number: 'T-1', numberTo: 'T-9', documentsCount: 9 })
    expect(t).toBe('F4 · resumen de tiques · T-1–T-9 · 9 tiques')
    expect(t).not.toMatch(/art\./)
    expect(etiquetaTipo({ invoiceType: 'F4', number: null, numberTo: null, documentsCount: 1 })).toBe('F4 · resumen de tiques · 1 tique')
  })
})

describe('S01e · el cierre no se para entero sin el ejercicio siguiente', () => {
  const saldos: SaldoACerrar[] = [
    { code: '57200001', name: 'Banco', templateCode: '572', debe: 1500, haber: 0 },
    { code: '10000000', name: 'Capital social', templateCode: '100', debe: 0, haber: 1000 },
    { code: '70000001', name: 'Ventas', templateCode: '700', debe: 0, haber: 800 },
    { code: '60000001', name: 'Compras', templateCode: '600', debe: 300, haber: 0 },
  ]
  const base = { cuenta129: '12900000', finEjercicio: '2026-12-31', ejercicio: '2026' }
  it('sin siguiente: regularización y cierre, la apertura espera', () => {
    const p = prepararCierre(saldos, { ...base, inicioSiguiente: null, siguiente: null })
    expect(p.regularizacion).not.toBeNull()
    expect(p.cierre).not.toBeNull()
    expect(p.apertura).toBeNull()
    expect(p.resultado).toBe(500)
    for (const a of [p.regularizacion!, p.cierre!]) expect(sumas(a).cuadra).toBe(true)
  })
  it('con siguiente: los tres, y la apertura es el cierre al revés', () => {
    const p = prepararCierre(saldos, { ...base, inicioSiguiente: '2027-01-01', siguiente: '2027' })
    expect(p.apertura?.fecha).toBe('2027-01-01')
    expect(sumas(p.apertura!).debe).toBe(sumas(p.cierre!).haber)
  })
})

describe('S01e · el modelo de cuentas anuales no se contradice', () => {
  const pequena = { activo: 900_000, cifraNegocios: 2_100_000, plantillaMedia: 6 }
  it('con ejercicio anterior lo dice; sin él, dice que no lo hay (nunca «tu primer ejercicio»)', () => {
    const con = modeloPropuesto(pequena, pequena).frase
    const sin = modeloPropuesto(pequena, null).frase
    expect(con).toMatch(/también en el anterior/)
    expect(sin).toMatch(/no hay uno anterior/)
    expect(con + sin).not.toMatch(/primer ejercicio/)
  })
})

describe('S01e · Retenciones no cuelga de «IVA»', () => {
  it('su propio grupo en Libros y en la cinta, con la misma dirección', () => {
    const d = dondeEsta('retenciones')!
    expect(d.grupo.etiqueta).toBe('Retenciones')
    expect(d.area.id).toBe('registro')
    const otros = AREAS_LIBROS.find((a) => a.id === 'registro')!.grupos.find((g) => g.etiqueta === 'Otros libros')!
    expect(otros.acciones.map((x) => x.id)).not.toContain('retenciones')
    const ctx: Parameters<typeof cintaDe>[2] = { hosteleria: false, diez: false, interruptores: new Set() }
    const cinta = cintaDe('contabilidad', 'listados', ctx)
    expect(cinta.find((g) => g.titulo === 'IVA')!.ordenes.map((o) => o.id)).not.toContain('libros.retenciones')
    expect(cinta.find((g) => g.titulo === 'Retenciones')!.ordenes.map((o) => o.id)).toEqual(['libros.retenciones'])
  })
  it('los periodos del ejercicio: cuatro trimestres y el año entero', () => {
    const ps = periodosDelEjercicio('2026-01-01', '2026-12-31')
    expect(ps.map((p) => p.nombre)).toEqual(['1T 2026', '2T 2026', '3T 2026', '4T 2026', 'Todo el ejercicio'])
    expect(ps[1]).toMatchObject({ desde: '2026-04-01', hasta: '2026-06-30' })
  })
})

describe('S01e · en el móvil cada cifra apilada lleva su título', () => {
  const css = readFileSync('src/modules/conta/estilo/libros.css', 'utf8')
  const movil = css.slice(css.indexOf('@media (max-width: 767px)'))
  it('una cifra vacía (Debe o Haber a cero) no desaparece: sale con su título y una raya', () => {
    expect(movil).toMatch(/\.cxl-apilada td:empty:not\(\[data-titulo\]\) \{ display: none; \}/)
    expect(movil).toMatch(/\.cxl-apilada td\[data-titulo\]:empty::after \{ content: '—'/)
    expect(movil).not.toMatch(/\.cxl-apilada td:empty \{ display: none; \}/)
  })
  it('la tabla apilada va en bloque (sin celdas anónimas alrededor de la fila)', () => {
    expect(movil).toMatch(/\.cxl-tabla\.cxl-apilada, \.cxl-tabla\.cxl-apilada tbody, \.cxl-tabla\.cxl-apilada tfoot \{ display: block;/)
  })
  it('toda cifra (td a la derecha) de las tablas apiladas de Libros lleva data-titulo', () => {
    // Recorre el código de verdad: cada <td className="cxl-der…"> dentro de Libros.
    const ficheros = ['LibroMayor', 'DiarioResumido', 'SumasSaldos', 'OtrosLibros', 'Estados', 'Anuales', 'Cierre', 'RegistroIva']
    const sinTitulo: string[] = []
    for (const f of ficheros) {
      const src = readFileSync(`src/modules/conta/libros/${f}.tsx`, 'utf8')
      for (const m of src.matchAll(/<td\b[^>]*className=\{?["'`][^"'`]*cxl-der[^>]*>/g)) if (!/data-titulo=/.test(m[0])) sinTitulo.push(`${f}: ${m[0].slice(0, 80)}`)
    }
    expect(sinTitulo).toEqual([])
  })
})
