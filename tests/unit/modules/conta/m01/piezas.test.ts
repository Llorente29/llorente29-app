// tests/unit/modules/conta/m01/piezas.test.ts
//
// M01 · Las tres piezas comunes, lo que deciden sin pintar: la tabla densa
// (filtros, vistas guardadas, teclado, pie, CSV), el formulario por bloques
// (lo propuesto, las teclas, F4) y el zoom del panel del documento.
// Regla 31: donde hay una lista de verdad se prueba contra ella (el plan de
// serie para F4; las series y los filtros reales del diario).

import {
  alternarMarca, borrarVista, claveVistas, csv, cuadreDe, cuantas, cumpleFiltros, guardarVista, hayFiltros, leerVistas, miles, moverEnTabla,
  nombreFichero, textoCuadre, type CampoFiltro,
} from '@/modules/conta/ui/tabla/tablaDensa'
import { TECLAS_DEL_NAVEGADOR, accionDeTecla, buscarSubcuentas, estadoCampo, textoPosicion } from '@/modules/conta/ui/formulario/formulario'
import { PASOS_ZOOM, ZOOM_INICIAL, siguienteZoom } from '@/modules/conta/ui/documento/zoom'
import { NOMBRE_CUENTA_PGC } from '@/modules/conta/lib/pgc'
import { eurosExactos } from '@/modules/conta/lib/formato'

class Almacen {
  datos = new Map<string, string>()
  getItem(k: string) { return this.datos.get(k) ?? null }
  setItem(k: string, v: string) { this.datos.set(k, v) }
}

describe('tabla densa · filtros', () => {
  const CAMPOS: CampoFiltro[] = [
    { id: 'desde', etiqueta: 'Desde', tipo: 'desde' },
    { id: 'hasta', etiqueta: 'Hasta', tipo: 'hasta' },
    { id: 'serie', etiqueta: 'Serie', tipo: 'opciones', opciones: [{ valor: '', texto: 'Todas' }, { valor: '1', texto: 'General' }] },
    { id: 'texto', etiqueta: 'Buscar', tipo: 'texto' },
  ]
  const fila = { fecha: '2026-10-05', opcion: (id: string) => (id === 'serie' ? '1' : ''), texto: 'Ventas del día · Norte Centro · General 1.287' }

  it('sin nada puesto, pasa todo', () => {
    expect(hayFiltros({ desde: '', texto: '  ' })).toBe(false)
    expect(cumpleFiltros(CAMPOS, {}, fila)).toBe(true)
  })
  it('las fechas son inclusivas por los dos lados', () => {
    expect(cumpleFiltros(CAMPOS, { desde: '2026-10-05', hasta: '2026-10-05' }, fila)).toBe(true)
    expect(cumpleFiltros(CAMPOS, { desde: '2026-10-06' }, fila)).toBe(false)
    expect(cumpleFiltros(CAMPOS, { hasta: '2026-10-04' }, fila)).toBe(false)
  })
  it('la lista, por su valor; una fila con varios valores (varios locales) cumple si tiene el pedido', () => {
    expect(cumpleFiltros(CAMPOS, { serie: '1' }, fila)).toBe(true)
    expect(cumpleFiltros(CAMPOS, { serie: '2' }, fila)).toBe(false)
    const varios = { ...fila, opcion: () => ['norte', 'mercado'] as const }
    expect(cumpleFiltros(CAMPOS, { serie: 'mercado' }, varios)).toBe(true)
  })
  it('el texto: todas las palabras, en cualquier orden, sin mirar acentos ni mayúsculas', () => {
    expect(cumpleFiltros(CAMPOS, { texto: 'centro VENTAS' }, fila)).toBe(true)
    expect(cumpleFiltros(CAMPOS, { texto: 'dia' }, fila)).toBe(true)
    expect(cumpleFiltros(CAMPOS, { texto: 'ventas mercado' }, fila)).toBe(false)
  })
})

describe('tabla densa · vistas guardadas, por usuario y en el navegador', () => {
  it('guarda, lee, sustituye la del mismo nombre y borra', () => {
    const a = new Almacen()
    expect(leerVistas('diario', 'Marta', a)).toEqual([])
    guardarVista('diario', 'Marta', 'Mis ventas', 'ventas', { texto: 'norte', desde: '' }, a, 'v1')
    expect(leerVistas('diario', 'Marta', a)).toEqual([{ id: 'v1', nombre: 'Mis ventas', base: 'ventas', filtros: { texto: 'norte' } }])
    // El mismo nombre (sin mirar mayúsculas) la sustituye: dos botones iguales no se distinguen.
    const l = guardarVista('diario', 'Marta', 'MIS VENTAS', 'todos', { texto: 'mercado' }, a, 'v2')
    expect(l).toHaveLength(1)
    expect(l[0]).toMatchObject({ id: 'v1', nombre: 'MIS VENTAS', filtros: { texto: 'mercado' } })
    expect(borrarVista('diario', 'Marta', 'v1', a)).toEqual([])
  })
  it('cada usuario y cada tabla, las suyas', () => {
    const a = new Almacen()
    guardarVista('diario', 'Marta', 'Una', 'todos', {}, a, 'v1')
    expect(leerVistas('diario', 'Luis', a)).toEqual([])
    expect(leerVistas('mayor', 'Marta', a)).toEqual([])
    expect(claveVistas('diario', 'Marta')).toBe('folvy.conta.vistas.diario.Marta')
  })
  it('lo roto o sin almacén no tumba la pantalla: sin vistas', () => {
    const a = new Almacen()
    a.setItem(claveVistas('diario', 'Marta'), '{no es json')
    expect(leerVistas('diario', 'Marta', a)).toEqual([])
    a.setItem(claveVistas('diario', 'Marta'), JSON.stringify([{ id: 1 }, { id: 'x', nombre: ' ' }, { id: 'y', nombre: 'Buena', filtros: { a: 'b', n: 3 } }]))
    expect(leerVistas('diario', 'Marta', a)).toEqual([{ id: 'y', nombre: 'Buena', base: 'todos', filtros: { a: 'b' } }])
    expect(leerVistas('diario', 'Marta', null)).toEqual([])
    expect(guardarVista('diario', 'Marta', '  ', 'todos', {}, a)).toHaveLength(1)
  })
})

describe('tabla densa · teclado', () => {
  it('↑ ↓ se paran en la primera y en la última: una tabla no da la vuelta', () => {
    expect(moverEnTabla(-1, 1, 5)).toBe(0)
    expect(moverEnTabla(-1, -1, 5)).toBe(4)
    expect(moverEnTabla(4, 1, 5)).toBe(4)
    expect(moverEnTabla(0, -1, 5)).toBe(0)
    expect(moverEnTabla(2, 15, 5)).toBe(4)
    expect(moverEnTabla(0, 1, 0)).toBe(-1)
  })
  it('Espacio marca y desmarca sin tocar las demás', () => {
    const m = alternarMarca(new Set(['a']), 'b')
    expect([...m].sort()).toEqual(['a', 'b'])
    expect([...alternarMarca(m, 'a')]).toEqual(['b'])
  })
})

describe('tabla densa · el pie', () => {
  it('el cuadre al céntimo (0,10 + 0,20 es 0,30)', () => {
    const c = cuadreDe([{ debe: 0.1, haber: 0 }, { debe: 0.2, haber: 0 }, { debe: 0, haber: 0.3 }])
    expect(c).toEqual({ debe: 0.3, haber: 0.3, cuadra: true, diferencia: 0 })
    expect(textoCuadre(c)).toBe(`Debe ${eurosExactos(0.3)} · Haber ${eurosExactos(0.3)} · Cuadra`)
  })
  it('si no cuadra, lo dice con la diferencia', () => {
    const c = cuadreDe([{ debe: 100, haber: 99.99 }])
    expect(c.cuadra).toBe(false)
    expect(textoCuadre(c)).toBe(`Debe ${eurosExactos(100)} · Haber ${eurosExactos(99.99)} · No cuadra: ${eurosExactos(0.01)} de diferencia`)
  })
  it('cuántas: con filtros, «N de M»; singular y plural', () => {
    expect(cuantas(1, 1, ['asiento', 'asientos'])).toBe('1 asiento')
    expect(cuantas(12, 12, ['asiento', 'asientos'])).toBe('12 asientos')
    expect(cuantas(12, 1340, ['asiento', 'asientos'])).toBe('12 de 1.340 asientos')
    expect(cuantas(0, 3, ['asiento', 'asientos'])).toBe('0 de 3 asientos')
  })
})

describe('tabla densa · exportar', () => {
  it('el CSV de Excel en español: BOM, «;», coma decimal, comillas donde hace falta y CRLF', () => {
    const t = csv(['Concepto', 'Importe'], [['Ventas; Norte', 1287.5], ['Dice "hola"', null], ['Sin nada', 3]])
    expect(t.charCodeAt(0)).toBe(0xfeff)
    expect(t.slice(1).split('\r\n')).toEqual(['Concepto;Importe', '"Ventas; Norte";1287,5', '"Dice ""hola""";', 'Sin nada;3', ''])
  })
  it('el nombre del fichero, sin espacios ni acentos', () => {
    expect(nombreFichero('Libro diario 2026 · Taberna Ñu', 'xlsx')).toBe('libro-diario-2026-taberna-nu.xlsx')
    expect(nombreFichero('···', 'csv')).toBe('tabla.csv')
  })
})

describe('formulario por bloques · lo propuesto', () => {
  it('azul mientras es lo propuesto y nadie lo ha aceptado; aceptado con Tab; cambiado si se escribe otra cosa', () => {
    expect(estadoCampo('62900000', '62900000', false)).toBe('propuesto')
    expect(estadoCampo('62900000', '62900000', true)).toBe('aceptado')
    expect(estadoCampo('62800000', '62900000', false)).toBe('cambiado')
    expect(estadoCampo('lo que sea', undefined, false)).toBe('normal')
    expect(estadoCampo('', '', false)).toBe('normal')
  })
  it('«3 de 12»', () => {
    expect(textoPosicion(3, 12)).toBe('3 de 12')
    expect(textoPosicion(1, 1250)).toBe('1 de 1.250')
    expect(textoPosicion(0, 0)).toBe('')
  })
})

describe('formulario por bloques · teclas', () => {
  it('las de la maqueta', () => {
    expect(accionDeTecla({ key: 'Enter' })).toBe('siguiente')
    expect(accionDeTecla({ key: 'Enter' }, true)).toBeNull()
    expect(accionDeTecla({ key: 'Enter', shiftKey: true })).toBeNull()
    expect(accionDeTecla({ key: 'F4' })).toBe('buscar')
    expect(accionDeTecla({ key: 's', ctrlKey: true })).toBe('guardar')
    expect(accionDeTecla({ key: 'S', metaKey: true })).toBe('guardar')
    expect(accionDeTecla({ key: 'Enter', ctrlKey: true })).toBe('validar')
    expect(accionDeTecla({ key: 'PageDown' })).toBe('documento-siguiente')
    expect(accionDeTecla({ key: 'PageUp' })).toBe('documento-anterior')
  })
  it('ninguna de las del navegador (F5, F10, F11, F12), ni sola ni con Ctrl', () => {
    expect([...TECLAS_DEL_NAVEGADOR]).toEqual(['F5', 'F10', 'F11', 'F12'])
    for (const key of TECLAS_DEL_NAVEGADOR) {
      expect(accionDeTecla({ key })).toBeNull()
      expect(accionDeTecla({ key, ctrlKey: true })).toBeNull()
    }
  })
  it('lo demás no lo toca (las letras se escriben; Ctrl con otra cosa es del navegador)', () => {
    expect(accionDeTecla({ key: 'a' })).toBeNull()
    expect(accionDeTecla({ key: 'Tab' })).toBeNull()
    expect(accionDeTecla({ key: 'p', ctrlKey: true })).toBeNull()
    expect(accionDeTecla({ key: 'F4', altKey: true })).toBeNull()
  })
})

describe('formulario por bloques · F4 contra el plan de serie (regla 31)', () => {
  const PLAN = Object.entries(NOMBRE_CUENTA_PGC).map(([codigo, nombre]) => ({ codigo, nombre }))
  it('por número: las que empiezan por lo escrito', () => {
    expect(buscarSubcuentas(PLAN, '62').map((s) => s.codigo)).toEqual(['621', '622', '623', '624', '625', '626', '627', '628', '629'])
    expect(buscarSubcuentas(PLAN, '475').map((s) => s.codigo)).toEqual(['4751'])
    expect(buscarSubcuentas(PLAN, '9')).toEqual([])
  })
  it('por nombre: todas las palabras, sin acentos', () => {
    expect(buscarSubcuentas(PLAN, 'iva').map((s) => s.codigo)).toEqual(['472', '477'])
    expect(buscarSubcuentas(PLAN, 'hacienda repercutido').map((s) => s.codigo)).toEqual(['477'])
    expect(buscarSubcuentas(PLAN, 'publicidad').map((s) => s.codigo)).toEqual(['627'])
    expect(buscarSubcuentas(PLAN, 'compras mercaderias').map((s) => s.codigo)).toEqual(['600'])
  })
  it('vacío, las primeras; y nunca más de lo pedido', () => {
    expect(buscarSubcuentas(PLAN, '', 3)).toHaveLength(3)
    expect(buscarSubcuentas(PLAN, '6', 4)).toHaveLength(4)
  })
})

describe('panel del documento · el zoom', () => {
  it('de paso en paso, sin pasarse', () => {
    expect(ZOOM_INICIAL).toBe(100)
    expect(siguienteZoom(100, 1)).toBe(125)
    expect(siguienteZoom(100, -1)).toBe(75)
    expect(siguienteZoom(PASOS_ZOOM[0], -1)).toBe(PASOS_ZOOM[0])
    expect(siguienteZoom(PASOS_ZOOM[PASOS_ZOOM.length - 1], 1)).toBe(PASOS_ZOOM[PASOS_ZOOM.length - 1])
    // Uno que no está en la lista va al paso de al lado.
    expect(siguienteZoom(110, 1)).toBe(125)
    expect(siguienteZoom(110, -1)).toBe(100)
  })
})

describe('los números de las piezas', () => {
  it('punto de miles también en cuatro cifras (es-ES no lo pone solo)', () => {
    expect(miles(1250)).toBe('1.250')
    expect(miles(999)).toBe('999')
    expect(miles(1234567)).toBe('1.234.567')
    expect(miles(0)).toBe('0')
  })
})
