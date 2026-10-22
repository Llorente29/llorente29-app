// tests/unit/modules/conta/s02/recibidas.test.ts
//
// S02 · Compras y gastos › Facturas recibidas con la plantilla Lista, sin
// pintar: las pestañas de estado SUMAN «Todas» (cada fila en una sola), «Por
// revisar» cuenta lo mismo que el chip de la barra, los filtros, el orden, el
// pie, y el estado de la lista en la dirección (volver como estaba).
// Regla 31: las filas tienen la forma de las de conta_documentos_recibidos (su
// definición en producción, leída el 22/10): los seis estados, los tres tipos.

import { describe, expect, it } from 'vitest'
import type { FilaDocumento } from '@/modules/conta/documentos/documentos'
import type { ExtraFactura } from '@/modules/conta/services/documentosService'
import {
  ORDEN_DE_SERIE, colaDeFacturas, estadoDeFila, filasDeLaLista, filtrarSinPestana, filtrosDe, fraseDeLaLista, pestanaDe, pestanaDeFila, pestanasConNumero, totales,
  type Filtros,
} from '@/modules/conta/documentos/recibidas'
import { conCambio, leerEstado, listaRecordada, ordenar, pestanasConTodas, recordarLista, sumanTodas } from '@/modules/conta/diseno/plantillas'

const fila = (o: Partial<FilaDocumento> & { id: string }): FilaDocumento => ({
  tipo: 'factura', estado: 'para_mirar', proveedor: { id: 'p1', nombre: 'EUROPASTRY, S.A.' }, numero: '24048027', fecha: '2026-10-13', total: 110.87,
  canal: 'correo', confianza: 'seguro', porque: null, entendido: { cuenta: '60000001', nombre: 'Compras de mercaderías', origen: 'de su ficha' },
  recepcion: null, asiento: null, llego: '2026-10-14T08:00:00Z', ...o,
})
const extra = (o: Partial<ExtraFactura> = {}): ExtraFactura => ({ base: 100.79, iva: 10.08, pagada: null, comoPagada: null, localId: null, local: null, ...o })

// Una población con cada estado y cada tipo que devuelve la base.
const FILAS: FilaDocumento[] = [
  fila({ id: 'a' }),
  fila({ id: 'b', proveedor: { id: 'p2', nombre: 'COHELDI, S.L.' }, numero: 'T0626/657', total: 248.61, fecha: '2026-10-14', llego: '2026-10-15T08:00:00Z' }),
  fila({ id: 'c', estado: 'por_aclarar', proveedor: { id: null, nombre: 'AMAZON EU' }, entendido: null }),
  fila({ id: 'd', estado: 'apuntada', fecha: '2026-09-02', llego: '2026-09-03T08:00:00Z' }),
  fila({ id: 'e', estado: 'apuntada', fecha: '2026-09-05', llego: '2026-09-06T08:00:00Z' }),
  fila({ id: 'f', estado: 'repetida' }),
  fila({ id: 'g', estado: 'descartada' }),
  fila({ id: 'h', tipo: 'llegada', estado: 'por_aclarar', proveedor: { id: null, nombre: null }, numero: null, total: null, porque: 'Falta el PDF: el correo trae un enlace.', llego: '2026-10-20T08:00:00Z', fecha: '2026-10-20' }),
  fila({ id: 'i', tipo: 'recepcion', estado: 'en_diez', canal: 'cocina' }),
]
const EXTRAS = new Map<string, ExtraFactura>([
  ['a', extra()], ['b', extra({ base: 226.01, iva: 22.6, local: 'Foodint Alcalá' })], ['c', extra({ base: null, iva: null })],
  ['d', extra({ pagada: '2026-09-10' })], ['e', extra()], ['f', extra()], ['g', extra()],
])
const F = (o: Partial<Filtros> = {}): Filtros => ({ pestana: 'todas', q: '', mes: '', prov: '', local: '', canal: '', orden: ORDEN_DE_SERIE, ...o })

describe('las pestañas de estado suman «Todas» (encargo S02)', () => {
  it('cada fila en una sola pestaña, y la suma es «Todas»', () => {
    const p = pestanasConNumero(FILAS, EXTRAS)
    expect(p.map((x) => [x.id, x.n])).toEqual([['todas', 9], ['por-revisar', 2], ['por-aclarar', 2], ['por-pagar', 1], ['pagadas', 1], ['otras', 3]])
    expect(sumanTodas(p)).toBe(true)
  })
  it('las del patrón salen aunque cuenten 0; «Por aclarar» y «Otras», solo con algo', () => {
    expect(pestanasConNumero([fila({ id: 'z' })], new Map()).map((x) => x.id)).toEqual(['todas', 'por-revisar', 'por-pagar', 'pagadas'])
  })
  it('apuntada y pagada → Pagadas; apuntada sin pagar → Por pagar; para mirar → Por revisar, aunque esté pagada', () => {
    expect(pestanaDeFila(FILAS[3], EXTRAS.get('d'))).toBe('pagadas')
    expect(pestanaDeFila(FILAS[4], EXTRAS.get('e'))).toBe('por-pagar')
    expect(pestanaDeFila(FILAS[0], extra({ pagada: '2026-10-13' }))).toBe('por-revisar')
  })
  it('las direcciones de antes del S02 caen en la suya', () => {
    expect(pestanaDe('para-mirar')).toBe('por-revisar')
    expect(pestanaDe('apuntadas')).toBe('todas')
    expect(pestanaDe(null)).toBe('por-revisar')
    expect(pestanaDe('otras')).toBe('otras')
  })
  it('el chip de cada fila dice lo que de verdad le pasa', () => {
    expect(estadoDeFila(FILAS[2], undefined)).toEqual({ texto: 'Proveedor nuevo', tono: 'duda' })
    expect(estadoDeFila(FILAS[7], undefined)).toEqual({ texto: 'Falta el PDF', tono: 'duda' })
    expect(estadoDeFila(FILAS[3], EXTRAS.get('d'))).toEqual({ texto: 'Pagada', tono: 'seguro' })
    expect(estadoDeFila(FILAS[8], undefined).texto).toBe('En Diez')
  })
})

describe('los filtros, el orden y el pie', () => {
  it('buscar por proveedor, número o importe', () => {
    expect(filtrarSinPestana(FILAS, EXTRAS, F({ q: 'coheldi' })).map((x) => x.id)).toEqual(['b'])
    expect(filtrarSinPestana(FILAS, EXTRAS, F({ q: 'T0626' })).map((x) => x.id)).toEqual(['b'])
    expect(filtrarSinPestana(FILAS, EXTRAS, F({ q: '248,61' })).map((x) => x.id)).toEqual(['b'])
  })
  it('el mes, el proveedor y el local (sin local: «Común»)', () => {
    expect(filtrarSinPestana(FILAS, EXTRAS, F({ mes: '2026-09' })).map((x) => x.id)).toEqual(['d', 'e'])
    expect(filtrarSinPestana(FILAS, EXTRAS, F({ prov: 'p2' })).map((x) => x.id)).toEqual(['b'])
    expect(filtrarSinPestana(FILAS, EXTRAS, F({ local: 'Foodint Alcalá' })).map((x) => x.id)).toEqual(['b'])
    expect(filtrarSinPestana(FILAS, EXTRAS, F({ local: 'comun' })).map((x) => x.id)).not.toContain('b')
  })
  it('de serie, por fecha, la más nueva primero; la cola de «3 de 9» son las facturas en ese orden', () => {
    const l = filasDeLaLista(FILAS, EXTRAS, F({ pestana: 'por-revisar' }))
    expect(l.map((x) => x.id)).toEqual(['b', 'a'])
    expect(colaDeFacturas(filasDeLaLista(FILAS, EXTRAS, F()))).not.toContain('h')
    expect(filasDeLaLista(FILAS, EXTRAS, F({ pestana: 'por-revisar', orden: { columna: 'total', sentido: 'asc' } })).map((x) => x.id)).toEqual(['a', 'b'])
  })
  it('el pie: «2 facturas · Base … · IVA … · Total …», con las que aún no tienen importe aparte', () => {
    expect(totales(filasDeLaLista(FILAS, EXTRAS, F({ pestana: 'por-revisar' })), EXTRAS)).toEqual({ n: 2, base: 326.8, iva: 32.68, total: 359.48, sinImporte: 0 })
    expect(totales([FILAS[7]], EXTRAS).sinImporte).toBe(1)
  })
  it('la frase dice lo que de verdad entra solo', () => {
    expect(fraseDeLaLista({ correo: true, recibeMercancia: true, solo: false })).toBe('Las facturas de tus proveedores. Las que llegan por correo o desde el local entran solas.')
    expect(fraseDeLaLista({ correo: false, recibeMercancia: false, solo: true })).toBe('Las facturas de tus proveedores. Súbelas aquí y las leo yo.')
  })
})

describe('volver a la lista como estaba (respuesta 5 de Julio al paso 1)', () => {
  it('los filtros, el orden y la fila viven en la dirección; lo vacío no se escribe', () => {
    const q = conCambio('?ver=por-revisar&q=coheldi', { prov: 'p2', q: null, fila: 'b' })
    expect(q).toBe('?ver=por-revisar&prov=p2&fila=b')
    expect(leerEstado(q, ['ver', 'q', 'prov', 'fila'])).toEqual({ ver: 'por-revisar', prov: 'p2', fila: 'b' })
    expect(filtrosDe(new URLSearchParams('?ver=pagadas&mes=2026-09&orden=-total'))).toMatchObject({ pestana: 'pagadas', mes: '2026-09', orden: { columna: 'total', sentido: 'desc' } })
    expect(filtrosDe(new URLSearchParams('?mes=octubre')).mes).toBe('')
  })
  it('la última lista se recuerda en la pestaña del navegador; si no es de esa lista, la de serie', () => {
    const m = new Map<string, string>()
    const almacen = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) } }
    expect(listaRecordada('recibidas', '/conta/documentos', almacen)).toBe('/conta/documentos')
    recordarLista('recibidas', '/conta/documentos?ver=pagadas&fila=d', almacen)
    expect(listaRecordada('recibidas', '/conta/documentos', almacen)).toBe('/conta/documentos?ver=pagadas&fila=d')
    recordarLista('recibidas', '/conta/bancos?x=1', almacen)
    expect(listaRecordada('recibidas', '/conta/documentos', almacen)).toBe('/conta/documentos')
    expect(listaRecordada('recibidas', '/conta/documentos', null)).toBe('/conta/documentos')
  })
  it('«Todas» primero, con la suma; ordenar no toca la lista de entrada y deja lo vacío al final', () => {
    expect(pestanasConTodas([{ id: 'x', etiqueta: 'X', n: 2, siempre: true }, { id: 'y', etiqueta: 'Y', n: 0 }]).map((p) => [p.id, p.n])).toEqual([['todas', 2], ['x', 2]])
    const e = [{ v: 2 }, { v: null }, { v: 1 }]
    expect(ordenar(e, (x) => x.v, 'asc').map((x) => x.v)).toEqual([1, 2, null])
    expect(e.map((x) => x.v)).toEqual([2, null, 1])
  })
})
