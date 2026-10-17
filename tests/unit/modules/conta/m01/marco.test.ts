// tests/unit/modules/conta/m01/marco.test.ts
//
// M01 · El marco nuevo: qué módulo y qué pestaña tiene cada dirección, la
// preferencia por usuario, el buscador y las pestañas que caben.
//
// Regla 31: la población es la real. Las direcciones son TODAS las de
// CONTA.rutas (las que monta module.tsx), con sus parámetros rellenos; las
// pestañas de Libros, las seis áreas de AREAS_LIBROS; las opciones, las de
// Libros y Bancos que abrían sus Ctrl K.

import { describe, expect, it } from 'vitest'
import { CONTA, rutaConta } from '@/config/navegacion'
import { AREAS_LIBROS, accionesDe } from '@/modules/conta/libros/navegacion'
import {
  MODULOS, cuantasCaben, moduloDe, modulosVisibles, pestanaDe, pestanasArriba, relativa,
} from '@/modules/conta/marco/nuevo/modulos'
import { DE_SERIE, clavePreferencias, guardarPreferencia, leerPreferencias } from '@/modules/conta/marco/nuevo/preferencias'
import { enFila, interpretar, mover, opciones, ordenar, paraIlike, pregunta, type Grupo } from '@/modules/conta/marco/nuevo/buscar'
import { chipsDelInicio } from '@/modules/conta/marco/nuevo/teTocaHoy'

const rellena = (r: string) => rutaConta(r, { apartado: 'x', tabla: 'x', entrada: 'impuestos', codigo: '40000002', partyId: 'p', supplierId: 's', entryId: 'e', area: 'mayor', accion: 'libro-mayor', liqId: 'l', invoiceId: 'i', loteId: 'k', pestana: 'reglas' })

describe('cada dirección del módulo es de un módulo', () => {
  // Lo que se espera, a mano, para cada ruta de CONTA.rutas: si falta una
  // ruta nueva aquí, la prueba lo dice (no pasa en silencio).
  const ESPERADO: Record<keyof typeof CONTA.rutas, string> = {
    inicio: 'inicio', empresa: 'ajustes', empresaApartado: 'ajustes', tablas: 'ajustes', tabla: 'ajustes', alta: 'ajustes',
    ajustesEntrada: 'ajustes', plan: 'ajustes', planSitio: 'ajustes', planCuenta: 'ajustes', mayor: 'libros',
    terceros: 'terceros', tercero: 'terceros', terceroApartado: 'terceros', comoTeFactura: 'terceros', fichaProveedor: 'terceros', fichaProveedorApartado: 'terceros',
    libroDiario: 'libros', nuevoAsiento: 'libros', asiento: 'libros', libros: 'libros', diarioResumido: 'libros', pendientesDiez: 'libros',
    librosArea: 'libros', librosAccion: 'libros', compras: 'compras', ventas: 'ventas', liquidacionNueva: 'compras', liquidacion: 'compras',
    documentos: 'compras', revisarFactura: 'compras', loteCatcher: 'compras', bancos: 'bancos', bancosPestana: 'bancos',
    muestraPiezas: 'ajustes',
    sistemaDiseno: 'ajustes',
  }
  it('las de CONTA.rutas, todas, con el suyo', () => {
    const rutas = Object.entries(CONTA.rutas) as [keyof typeof CONTA.rutas, string][]
    expect(rutas.length).toBe(Object.keys(ESPERADO).length)
    const mal = rutas.filter(([k, r]) => moduloDe(rellena(r))?.id !== ESPERADO[k]).map(([k, r]) => `${k} (${r}) → ${moduloDe(rellena(r))?.id}`)
    expect(mal).toEqual([])
  })
  it('lo de fuera del módulo y la portada no son de ninguno', () => {
    expect(moduloDe('/conta')).toBeNull()
    expect(moduloDe('/kitchen/proveedores')).toBeNull()
    expect(moduloDe('/conta/ajustesx')).toBeNull()   // casa por trozo entero, no por letras
  })
  it('relativa quita el módulo, la barra final, la búsqueda y el ancla', () => {
    expect(relativa('/conta/libros/diario/?ejercicio=2026#x')).toBe('libros/diario')
    expect(relativa('/conta')).toBe('')
  })
})

describe('la barra de módulos (N30 y las decisiones del F01)', () => {
  it('Inicio arriba; V C B L I P; y Ajustes abajo', () => {
    expect(MODULOS.map((m) => m.letra ?? 'casa')).toEqual(['casa', 'V', 'C', 'B', 'L', 'I', 'P', 'A'])
    expect(MODULOS.filter((m) => m.grupo === 'abajo').map((m) => m.id)).toEqual(['ajustes'])
  })
  it('Impuestos sale apagado (sin pantalla), no se esconde; en el producto solo, tampoco', () => {
    const imp = MODULOS.find((m) => m.id === 'impuestos')!
    expect(imp.ruta).toBeNull()
    expect(modulosVisibles(true).map((m) => m.id)).toContain('impuestos')
  })
  it('en el producto solo no sale Ventas (su pantalla dice «Aún no.»); con Folvy, sí', () => {
    expect(modulosVisibles(true).map((m) => m.etiqueta)).toEqual(['Inicio', 'Compras', 'Bancos', 'Libros', 'Impuestos', 'Clientes y proveedores', 'Ajustes'])
    expect(modulosVisibles(false).map((m) => m.etiqueta)).toContain('Ventas')
  })
  it('Documentos va dentro de Compras, como pestaña', () => {
    const c = MODULOS.find((m) => m.id === 'compras')!
    expect(c.pestanas.map((p) => p.etiqueta)).toEqual(['Compras', 'Documentos'])
    expect(pestanaDe(c, '/conta/documentos/recibidas/123')?.id).toBe('documentos')
    expect(pestanaDe(c, '/conta/compras/liquidacion/9')?.id).toBe('compras')
  })
})

describe('las pestañas de Libros son sus seis áreas', () => {
  const libros = MODULOS.find((m) => m.id === 'libros')!
  it('una por área, en su orden, y cada una abre su primera acción', () => {
    expect(libros.pestanas.map((p) => p.etiqueta)).toEqual(AREAS_LIBROS.map((a) => a.nombre))
    expect(libros.pestanas.map((p) => p.ruta)).toEqual(AREAS_LIBROS.map((a) => `libros/${a.id}/${accionesDe(a)[0].id}`))
  })
  it('la activa sale de la dirección; la portada es el diario; el Mayor del plan es «Mayor y saldos»', () => {
    expect(pestanaDe(libros, '/conta/libros')?.id).toBe('diario')
    expect(pestanaDe(libros, '/conta/libros/diario/resumido')?.id).toBe('diario')
    expect(pestanaDe(libros, '/conta/libros/diario/9f2c')?.id).toBe('diario')
    expect(pestanaDe(libros, '/conta/libros/registro/expedidas')?.id).toBe('registro')
    expect(pestanaDe(libros, '/conta/plan/40000002')?.id).toBe('mayor')
  })
  it('arriba en el ordenador; en el móvil las pinta Libros (va por niveles)', () => {
    expect(pestanasArriba(libros, false)).toBe(true)
    expect(pestanasArriba(libros, true)).toBe(false)
  })
  it('Bancos todavía pinta las suyas: arriba no se repiten', () => {
    expect(pestanasArriba(MODULOS.find((m) => m.id === 'bancos')!, false)).toBe(false)
    expect(pestanasArriba(null, false)).toBe(false)
  })
})

describe('«Más ▾»: cuántas pestañas caben', () => {
  it('si caben todas, todas y sin «Más»', () => {
    expect(cuantasCaben([60, 80, 70], 300, 76, 4)).toBe(3)
  })
  it('si no, las que caben dejando sitio a «Más»', () => {
    // Las seis de Libros con anchos de verdad (14 px): no caben en 520.
    expect(cuantasCaben([70, 120, 190, 90, 210, 70], 520, 76, 4)).toBe(3)
    expect(cuantasCaben([200], 100, 76, 4)).toBe(0)
  })
})

describe('la preferencia, por usuario y en el navegador', () => {
  const almacen = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) }, m } }
  it('de serie: compacta, plegada y con el documento a la vista', () => {
    expect(leerPreferencias('u1', null)).toEqual({ densidad: 'compacta', barraDesplegada: false, documentoOculto: false })
    expect(DE_SERIE.densidad).toBe('compacta')
  })
  it('se recuerda por usuario: lo de uno no es lo de otro', () => {
    const a = almacen()
    guardarPreferencia('u1', { densidad: 'comoda' }, a)
    guardarPreferencia('u1', { barraDesplegada: true }, a)
    expect(leerPreferencias('u1', a)).toEqual({ densidad: 'comoda', barraDesplegada: true, documentoOculto: false })
    expect(leerPreferencias('u2', a)).toEqual(DE_SERIE)
    expect([...a.m.keys()]).toEqual([clavePreferencias('u1')])
  })
  it('lo que no se entiende vale lo de serie; sin almacén, nada falla', () => {
    const a = almacen()
    a.setItem(clavePreferencias('u1'), '{"densidad":"enorme","barraDesplegada":"si"')
    expect(leerPreferencias('u1', a)).toEqual(DE_SERIE)
    a.setItem(clavePreferencias('u1'), '{"densidad":"enorme","barraDesplegada":"si"}')
    expect(leerPreferencias('u1', a)).toEqual(DE_SERIE)
    const roto = { getItem: () => { throw new Error('bloqueado') }, setItem: () => { throw new Error('lleno') } }
    expect(guardarPreferencia('u1', { densidad: 'comoda' }, roto)).toEqual({ ...DE_SERIE, densidad: 'comoda' })
  })
})

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
    expect(t('documentos')).toContain('Documentos')
  })
  it('en el producto solo, ni Ventas ni lo de Ajustes que dice «aún no»', () => {
    expect(opciones('ventas', true).map((r) => r.titulo)).not.toContain('Ventas')
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
  it('los cuatro, siempre; contando (undefined) o sin poder contar (null), nunca 0', () => {
    expect(chipsDelInicio({}).map((c) => c.numero)).toEqual([undefined, undefined, undefined, undefined])
    expect(chipsDelInicio({ compras: 3, libros: 0, bancos: null, terceros: 2 }).map((c) => [c.id, c.numero])).toEqual([
      ['compras', 3], ['libros', 0], ['bancos', null], ['terceros', 2],
    ])
  })
  it('cada chip lleva a lo suyo', () => {
    expect(chipsDelInicio({}).map((c) => c.ruta)).toEqual(['/conta/compras', '/conta/libros/diario?ver=revisar', '/conta/bancos', '/conta/clientes-y-proveedores'])
  })
})
