// tests/unit/modules/conta/m01/marco.test.ts
//
// M01 · Lo que queda del marco del M01: el buscador general (Ctrl K) y el «Te
// toca hoy» del Inicio. Los módulos, las pestañas y las preferencias pasaron
// al esqueleto del S01: tests/unit/modules/conta/s01/esqueleto.test.ts.
//
// Regla 31: la población es la real. Las opciones son las de Libros y Bancos
// que abrían sus Ctrl K.

import { describe, expect, it } from 'vitest'
import { enFila, interpretar, mover, opciones, ordenar, paraIlike, pregunta, type Grupo } from '@/modules/conta/marco/nuevo/buscar'
import { chipsDelInicio } from '@/modules/conta/marco/nuevo/teTocaHoy'
import { rutaRecibidaEnAsientos } from '@/config/navegacion'

describe('el buscador general (Ctrl K)', () => {
  it('lee números, importes y texto como se escriben en una oficina', () => {
    expect(interpretar(' 1287 ')).toEqual({ texto: '1287', entero: 1287, importe: 1287 })
    expect(interpretar('1.278,17').importe).toBe(1278.17)
    expect(interpretar('1278,17').importe).toBe(1278.17)
    expect(interpretar('1278.17').importe).toBe(1278.17)
    expect(interpretar('40000002').entero).toBe(40000002)
    expect(interpretar('B12345678')).toEqual({ texto: 'B12345678', entero: null, importe: null })
  })
  it('lo escrito no rompe la búsqueda: fuera comodines, comillas y separadores', () => {
    expect(paraIlike('a,b (c)* "d" %e_')).toBe('a b c d e')
  })
  it('las opciones que abrían Libros y Bancos con su Ctrl K salen aquí', () => {
    const t = (q: string) => opciones(q, false).map((r) => r.titulo)
    expect(t('balance')).toContain('Balance de situación')
    expect(t('irpf')).toContain('Retenciones')
    expect(t('norma 43')).toContain('Subir extracto')
    expect(t('tablas')).toContain('Tablas generales')
    // S01: «Documentos» es ahora «Compras y gastos › Facturas recibidas».
    expect(t('recibidas')).toContain('Facturas recibidas')
  })
  it('ni Ventas (S01: sobra, la sustituye Facturación) ni, en el producto solo, lo de Ajustes que dice «aún no»', () => {
    expect(opciones('ventas', true).map((r) => r.titulo)).not.toContain('Ventas')
    expect(opciones('ventas', false).map((r) => r.titulo)).not.toContain('Ventas')
    expect(opciones('certificados', true)).toEqual([])
    expect(opciones('certificados', false).map((r) => r.titulo)).toEqual(['Certificados y accesos'])
  })
  it('cada opción sale una vez aunque la encuentren dos', () => {
    const r = opciones('movimientos', false)
    expect(new Set(r.map((x) => x.ruta)).size).toBe(r.length)
  })
  it('la pregunta (lo de la barra de la IA) lleva lo escrito y no navega', () => {
    expect(pregunta('  ¿cuánto debo?  ')).toEqual({ clave: 'pregunta', tipo: 'pregunta', titulo: 'Preguntar: «¿cuánto debo?»', ruta: null })
    expect(pregunta('   ')).toBeNull()
  })
  it('los grupos van en su orden; el vacío que ya terminó no sale; el que falla, sí', () => {
    const g = (tipo: Grupo['tipo'], n: number, extra: Partial<Grupo> = {}): Grupo => ({ tipo, nombre: tipo, resultados: Array.from({ length: n }, (_, i) => ({ clave: `${tipo}${i}`, tipo, titulo: 'x', ruta: '/' })), ...extra })
    const r = ordenar([g('opcion', 1), g('subcuenta', 0), g('asiento', 2), g('factura', 0, { error: 'No he podido buscar en las facturas' }), g('tercero', 0, { buscando: true })])
    expect(r.map((x) => x.tipo)).toEqual(['asiento', 'factura', 'tercero', 'opcion'])
    expect(enFila(r).map((x) => x.clave)).toEqual(['asiento0', 'asiento1', 'opcion0'])
  })
  it('↑ ↓ dan la vuelta', () => {
    expect(mover(-1, 1, 3)).toBe(0)
    expect(mover(2, 1, 3)).toBe(0)
    expect(mover(0, -1, 3)).toBe(2)
    expect(mover(0, 1, 0)).toBe(-1)
  })
})

describe('el «Te toca hoy» del Inicio', () => {
  // S01c: cinco, con las recibidas para revisar (antes iban solo en «Dudas» y la barra no cuadraba con el Inicio).
  it('los cinco, siempre; contando (undefined) o sin poder contar (null), nunca 0', () => {
    expect(chipsDelInicio({}).map((c) => c.numero)).toEqual([undefined, undefined, undefined, undefined, undefined])
    expect(chipsDelInicio({ compras: 3, recibidas: 4, libros: 0, bancos: null, terceros: 2 }).map((c) => [c.id, c.numero])).toEqual([
      ['compras', 3], ['recibidas', 4], ['libros', 0], ['bancos', null], ['terceros', 2],
    ])
  })
  it('cada chip lleva a lo suyo', () => {
    expect(chipsDelInicio({}).map((c) => c.ruta)).toEqual(['/conta/compras', rutaRecibidaEnAsientos(), '/conta/libros/diario?ver=revisar', '/conta/bancos', '/conta/clientes-y-proveedores'])
  })
})
