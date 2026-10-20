// tests/unit/modules/conta/s01f/pestanas.test.ts
//
// S01f · La cabecera de pestañas como pieza común del marco (Julio, 20/10).
// Los contadores, contra el calendario REAL de dos clientes de la demo de
// staging (fixtures/, regla 31); y lo que pide la franja: 56 px, icono de
// trazo de 14 px en cada pestaña, la activa en el azul de acción (#1E63C9 con
// Sumied), en negrita y subrayada con 3 px.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { avisosInicio } from '@/modules/conta/impuestos/avisosInicio'
import type { Calendario } from '@/modules/conta/impuestos/calendario'
import { contadoresDeCuentas, contadoresDeImpuestos, CUENTA_DE_PESTANA, clavePestana } from '@/modules/conta/esqueleto/contadoresPestanas'
import { PRODUCTOS } from '@/modules/conta/esqueleto/productos'
import { ICONOS, TAM_ICONO_PESTANA } from '@/modules/conta/diseno/iconos'
import { MARCAS } from '../../../../../supabase/functions/_shared/marcas'

const F = JSON.parse(readFileSync(join(__dirname, 'fixtures/calendario-staging-20261013.json'), 'utf8')) as { talleres: Calendario; bar: Calendario }
const vence = (c: Calendario) => contadoresDeImpuestos(avisosInicio(c, 'medio'), c.presentados.presentados)

describe('S01f · lo que vence, en rojo (el calendario de staging a 13/10)', () => {
  it('Talleres: 111, 115 y 303 revisados sin presentar, plazo el 20/10 → 3 en Calendario', () => {
    expect(vence(F.talleres)).toEqual({
      'impuestos.calendario': { n: 3, tono: 'vence', frase: '3 modelos con el plazo encima o pasado' },
    })
  })
  it('el Bar: el 111 ya presentado no cuenta; el 303 sí → 1. Y «Presentados 1», en gris (maqueta_trimestre_v3)', () => {
    expect(vence(F.bar)).toEqual({
      'impuestos.calendario': { n: 1, tono: 'vence', frase: '1 modelo con el plazo encima o pasado' },
      'impuestos.presentados': { n: 1, tono: 'neutro', frase: '1 presentado este año' },
    })
  })
  it('a más de 15 días del plazo no hay número (es el umbral del Inicio: interrumpe)', () => {
    expect(vence({ ...F.talleres, hoy: '2026-10-01' })).toEqual({})
  })
  it('el cargo que no ha llegado al banco no «vence»: no cuenta en Calendario', () => {
    const conPago: Calendario = { ...F.bar, filas: [], pagos_sin_llegar: [{ declaracion: 'x', modelo: '303', ejercicio: 2026, periodo: '2T', importe: 10, plazo: '2026-07-20', domicilia: false }] } as Calendario
    expect(avisosInicio(conPago, 'medio')).toHaveLength(1)
    expect(vence(conPago)['impuestos.calendario']).toBeUndefined()
  })
  it('el certificado que caduca (de mentira: en staging no hay) va en Certificados', () => {
    const c = { ...F.talleres, filas: [], certificado: { caduca: '2026-10-18' } } as unknown as Calendario
    expect(vence(c)).toEqual({ 'impuestos.certificados': { n: 1, tono: 'vence', frase: 'El certificado caduca pronto o ya ha caducado' } })
  })
})

describe('S01f · lo que pide una decisión, en gris (las cuentas de la barra)', () => {
  it('cada cuenta en la pestaña donde se resuelve; 0 y lo no contado (null) no salen', () => {
    expect(contadoresDeCuentas({ compras: 4, recibidas: 0, libros: 6, bancos: null, terceros: 1 })).toEqual({
      'compras.por-revisar': { n: 4, tono: 'neutro', frase: '4 por revisar' },
      'contabilidad.asientos': { n: 6, tono: 'neutro', frase: '6 por revisar' },
      'contactos.todos': { n: 1, tono: 'neutro', frase: '1 por revisar' },
    })
    expect(contadoresDeCuentas({})).toEqual({})
  })
  it('cada clave apunta a una pestaña que existe', () => {
    const todas = new Set(PRODUCTOS.flatMap((p) => p.pestanas.map((t) => clavePestana(p.id, t.id))))
    for (const k of [...Object.keys(CUENTA_DE_PESTANA), 'impuestos.calendario', 'impuestos.presentados', 'impuestos.certificados']) expect(todas.has(k), k).toBe(true)
  })
})

describe('S01f · la franja', () => {
  const css = readFileSync('src/modules/conta/esqueleto/esqueleto.css', 'utf8')
  const tokens = readFileSync('src/modules/conta/diseno/tokens.css', 'utf8')
  it('cada pestaña de cada producto lleva su icono de trazo, de 14 px', () => {
    const sin = PRODUCTOS.flatMap((p) => p.pestanas.filter((t) => !ICONOS[t.icono]).map((t) => `${p.id}.${t.id}`))
    expect(sin).toEqual([])
    expect(TAM_ICONO_PESTANA).toBe(14)
    expect(tokens).toMatch(/--s-icono-pestana: 14px;/)
  })
  it('56 px en el ordenador; 48 en el móvil', () => {
    expect(tokens).toMatch(/--s-alto-cabecera: 56px;/)
    expect(css).toMatch(/\.cxm\.cxm-es-movil \{ --s-alto-cabecera: 48px; \}/)
  })
  it('la activa: el azul de acción, en negrita y subrayada con 3 px (con Sumied, #1E63C9)', () => {
    expect(css).toMatch(/\.s-pestana\[data-activa\], \.s-pestana-activa \{ color: var\(--s-accion\); font-weight: var\(--s-peso-fuerte\); border-bottom-color: var\(--s-accion\); \}/)
    expect(css).toMatch(/border-bottom: var\(--s-raya-pestana\) solid transparent/)
    expect(tokens).toMatch(/--s-raya-pestana: 3px;/)
    expect(MARCAS.sumied.tema?.accion).toBe('#1E63C9')
  })
  it('el contador: gris de serie, rojo lo que vence', () => {
    expect(css).toMatch(/\.s-pestana-contador \{[^}]*background: var\(--s-neutro-fondo\); color: var\(--s-apoyo\)/)
    expect(css).toMatch(/\.s-pestana-contador\[data-tono='vence'\] \{ background: var\(--s-falta-fondo\); color: var\(--s-falta\); \}/)
  })
  it('en el móvil ninguna pestaña se encoge: la fila se desliza', () => {
    expect(css).toMatch(/\.s-pestanas-movil \.s-pestana \{ flex-shrink: 0;/)
    expect(css).toMatch(/\.s-pestanas-movil \{[^}]*overflow-x: auto/)
  })
})
