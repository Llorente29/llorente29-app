// tests/unit/modules/conta/i01b/calendario.test.ts
//
// I01b · P1 · El núcleo del calendario de impuestos. Regla 31: la población es
// la real. Los modelos son los nueve vigentes de Foodint en producción (18/10,
// tax_obligation filtrada por su cuenta: 111, 115, 180, 190, 200, 202, 303,
// 347 y 390, todos sin domiciliar), y las fechas, las del calendario oficial de
// 2026 (3.er trimestre: domiciliado hasta el 15/10, presentar hasta el 20/10;
// 202: 2.º pago hasta el 20/10, sin domiciliación).

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  cifraPago, cifraPlazo, cifraPresentados, lineaDeFila, loSiguiente, nombreDeFila, periodoEnPalabras, tituloVentana, tonoDePlazo, vistaDeFila,
  type Calendario, type Declaracion, type FilaCalendario,
} from '@/modules/conta/impuestos/calendario'

const fila = (modelo: string, cadencia: FilaCalendario['cadencia'], periodo: string, o: Partial<FilaCalendario> = {}): FilaCalendario => ({
  obligacion: `o-${modelo}`, modelo, nombre: modelo, cadencia, ejercicio: 2026, periodo,
  presentacion: '2026-10-20', domiciliacion: cadencia === 'quarterly' ? '2026-10-15' : null, provisional: null,
  atrasado: false, domicilia: false, cuenta_final: null, se_calcula: modelo === '303', declaracion: null, ...o,
})
const dec = (o: Partial<Declaracion>): Declaracion => ({
  id: 'r', estado: 'draft', estado_texto: 'Borrador', resultado: 'to_pay', importe: 6360, anterior: null, no_hace_falta: null,
  presentada: null, por: null, errores: 0, avisos: 0, aviso: null, cuadra: true, ...o,
})
// Octubre de Foodint: 111, 115 y 303 del 3T, y el 2.º pago del 202.
const OCTUBRE = [fila('111', 'quarterly', '3T'), fila('115', 'quarterly', '3T'), fila('202', 'instalments_202', '2P'), fila('303', 'quarterly', '3T')]
const cal = (filas: FilaCalendario[], o: Partial<Calendario> = {}): Calendario => ({
  hoy: '2026-10-18', ventana: '2026-10-01', desde: '2026-10-18', puede_gestionar: true, filas, siguiente: [],
  presentados: { ano: 2026, desde: '2026-10-18', vencidos: 0, presentados: 0, en_plazo: 0, contabilizados: 0 },
  modelos: [], no_presenta: [], se_pueden_anadir: [], certificado: null, pagos_sin_llegar: [], ...o,
})

describe('las palabras: cambian con el nivel, no el sitio', () => {
  it('el 303 en los tres niveles (encargo, punto 8)', () => {
    const f = fila('303', 'quarterly', '3T')
    expect(nombreDeFila(f, 'sin_experiencia')).toBe('IVA del trimestre (modelo 303)')
    expect(nombreDeFila(f, 'medio')).toBe('IVA del trimestre')
    expect(nombreDeFila(f, 'experto')).toBe('303 · 3T')
  })
  it('los nueve de Foodint tienen nombre de oficina (ninguno sale con el del catálogo)', () => {
    for (const m of ['111', '115', '180', '190', '200', '202', '303', '347', '390']) {
      expect(nombreDeFila({ modelo: m, cadencia: 'annual', nombre: 'CATALOGO', periodo: '0A', ejercicio: 2026 }, 'medio'), m).not.toBe('CATALOGO')
    }
  })
  it('los periodos en palabras', () => {
    expect(['1T', '2T', '3T', '4T', '1P', '2P', '10', '0A'].map(periodoEnPalabras))
      .toEqual(['1.er trimestre', '2.º trimestre', '3.er trimestre', '4.º trimestre', '1.er pago', '2.º pago', 'octubre', 'del año'])
  })
  it('las dos fechas debajo; sin domiciliar, la de presentar primero; el 202, una', () => {
    expect(lineaDeFila(fila('303', 'quarterly', '3T'), 'medio')).toBe('modelo 303 · hasta el 20/10 (domiciliado, el 15/10)')
    expect(lineaDeFila(fila('303', 'quarterly', '3T', { domicilia: true }), 'medio')).toBe('modelo 303 · domiciliado: hasta el 15/10 (sin domiciliar, el 20/10)')
    expect(lineaDeFila(fila('202', 'instalments_202', '2P'), 'medio')).toBe('modelo 202 · 2.º pago · hasta el 20/10')
    expect(lineaDeFila(fila('202', 'instalments_202', '2P'), 'experto')).toBe('2.º pago · hasta el 20/10')
  })
})

describe('el estado y la acción de cada fila', () => {
  it('lo que aún no se calcula aquí lo dice, sin chip ni acción', () => {
    expect(vistaDeFila(fila('111', 'quarterly', '3T'))).toMatchObject({ chip: null, frase: 'Se calculará aquí pronto', accion: null })
  })
  it('el 303: por calcular, borrador que cuadra, revisado, con aviso, con lo que Sumied no sabe', () => {
    expect(vistaDeFila(fila('303', 'quarterly', '3T')).chip).toEqual({ tono: 'neutro', texto: 'Por calcular' })
    expect(vistaDeFila(fila('303', 'quarterly', '3T', { declaracion: dec({}) }))).toMatchObject({ chip: { tono: 'accion', texto: 'Borrador · cuadra con los libros' }, textoAccion: 'Revisar' })
    expect(vistaDeFila(fila('303', 'quarterly', '3T', { declaracion: dec({ estado: 'reviewed' }) }))).toMatchObject({ chip: { tono: 'seguro', texto: 'Revisado · cuadra con los libros' }, textoAccion: 'Presentar' })
    const aviso = vistaDeFila(fila('303', 'quarterly', '3T', { declaracion: dec({ avisos: 1, aviso: '1 factura fuera de plazo' }) }))
    expect(aviso).toMatchObject({ chip: { tono: 'duda', texto: 'Borrador · 1 aviso' }, ambar: true, aviso: '1 factura fuera de plazo', textoAccion: 'Ver el aviso' })
    expect(vistaDeFila(fila('303', 'quarterly', '3T', { declaracion: dec({ errores: 2 }) })).chip).toEqual({ tono: 'falta', texto: 'Borrador · 2 cosas que Sumied no sabe' })
  })
  it('presentado, fuera, contabilizado y pagado; no hay que presentarlo; fuera de plazo', () => {
    expect(vistaDeFila(fila('303', 'quarterly', '3T', { declaracion: dec({ estado: 'filed', por: 'outside' }) }))).toMatchObject({ chip: { texto: 'Presentado fuera' }, textoAccion: 'Contabilizar' })
    expect(vistaDeFila(fila('303', 'quarterly', '3T', { declaracion: dec({ estado: 'booked', por: 'sumied' }) }))).toMatchObject({ chip: { texto: 'Presentado · contabilizado' }, textoAccion: 'Casar el pago' })
    expect(vistaDeFila(fila('303', 'quarterly', '3T', { declaracion: dec({ estado: 'paid' }) })).chip?.texto).toBe('Pagado · contabilizado')
    expect(vistaDeFila(fila('202', 'instalments_202', '2P', { declaracion: dec({ estado: 'not_required', no_hace_falta: 'el impuesto de 2025 salió a cero' }) })).frase)
      .toBe('No hay que presentarlo: el impuesto de 2025 salió a cero')
    expect(vistaDeFila(fila('303', 'quarterly', '2T', { atrasado: true, declaracion: dec({}) }))).toMatchObject({ chip: { tono: 'falta', texto: 'Fuera de plazo · Borrador · cuadra con los libros' }, ambar: true })
  })
})

describe('el recuadro del plazo: el color y lo fuera de plazo primero (Julio, 20/10)', () => {
  // La cuenta de pruebas A de staging el 21/10, tal cual (fixtures/): el 3T y el 2.º pago del 202,
  // fuera de plazo; el 3.er pago del 202, hasta el 21/12. Salía «Presentar hasta el 21/12 · dentro
  // de 61 días», en rojo y sin decir por qué.
  const A = JSON.parse(readFileSync(join(__dirname, 'fixtures/calendario-a-staging-20261021.json'), 'utf8')) as { hoy: string; filas: FilaCalendario[] }
  it('con algo fuera de plazo, lo dice primero, en rojo, y el siguiente plazo debajo', () => {
    expect(cifraPlazo(cal(A.filas, { hoy: A.hoy }))).toEqual({
      etiqueta: 'Fuera de plazo',
      valor: '4 fuera de plazo: 111 · 3T, 115 · 3T, 202 · 2P y 1 más',
      apoyo: 'el siguiente, hasta el 21/12 · dentro de 61 días · 1 por revisar, 4 sin calcular aquí',
      tono: 'falta',
      texto: true,
    })
  })
  it('uno solo: «1 fuera de plazo: 202 · 2P»', () => {
    const solo = A.filas.filter((f) => !f.atrasado || (f.modelo === '202' && f.periodo === '2P'))
    expect(cifraPlazo(cal(solo, { hoy: A.hoy }))).toMatchObject({ valor: '1 fuera de plazo: 202 · 2P', tono: 'falta' })
  })
  it('lo de la misma cuenta ya presentado: a 61 días del siguiente, neutro (no rojo)', () => {
    const presentado = A.filas.map((f) => (f.atrasado ? { ...f, atrasado: false, declaracion: dec({ estado: 'filed', estado_texto: 'Presentado' }) } : f))
    expect(cifraPlazo(cal(presentado, { hoy: A.hoy }))).toEqual({ etiqueta: 'Presentar hasta el 21/12 · dentro de 61 días', valor: '1 modelo', apoyo: '1 sin calcular aquí', tono: 'normal' })
  })
  it('el color: rojo con 2 días o menos, ámbar con 15 o menos, neutro con más', () => {
    expect([0, 1, 2, 3, 15, 16, 61].map(tonoDePlazo)).toEqual(['falta', 'falta', 'falta', 'duda', 'duda', 'normal', 'normal'])
    const a = (hoy: string) => cifraPlazo(cal([fila('303', 'quarterly', '3T')], { hoy })).tono
    expect([a('2026-10-18'), a('2026-10-17'), a('2026-10-05'), a('2026-10-04')]).toEqual(['falta', 'duda', 'duda', 'normal'])
  })
})

describe('las tres cifras', () => {
  it('Foodint el 18/10, sin domiciliar: cuatro modelos hasta el 20/10, dentro de 2 días, en rojo; el 303 por revisar, tres sin calcular aquí', () => {
    const c = cal(OCTUBRE.map((f) => (f.modelo === '303' ? { ...f, declaracion: dec({}) } : f)))
    expect(cifraPlazo(c)).toEqual({ etiqueta: 'Presentar hasta el 20/10 · dentro de 2 días', valor: '4 modelos', apoyo: '1 por revisar, 3 sin calcular aquí', tono: 'falta' })
  })
  it('domiciliado: el plazo de domiciliar manda mientras se puede', () => {
    const c = cal(OCTUBRE.map((f) => (f.modelo === '303' ? { ...f, domicilia: true, declaracion: dec({ estado: 'reviewed' }) } : f)), { hoy: '2026-10-10' })
    expect(cifraPlazo(c)).toMatchObject({ etiqueta: 'Domiciliados: presentar hasta el 15/10 · dentro de 5 días', valor: '1 modelo', tono: 'duda' })
  })
  it('lo que hay que pagar: solo lo calculado, y dice cuánto falta por calcular (respuesta 3)', () => {
    const c = cal(OCTUBRE.map((f) => (f.modelo === '303' ? { ...f, declaracion: dec({ importe: 6360 }) } : f)))
    expect(cifraPago(c)).toEqual({ etiqueta: 'A pagar hasta el 20/10', valor: '6.360,00 €', apoyo: 'sin domiciliar: lo pagas tú · solo lo calculado aquí (3 modelos sin calcular)', tono: 'normal' })
    const d = cal([{ ...OCTUBRE[3], domicilia: true, cuenta_final: '4821', declaracion: dec({ importe: 6360 }) }])
    expect(cifraPago(d)).toMatchObject({ etiqueta: 'Hacienda lo carga el 20/10', valor: '6.360,00 €', apoyo: 'domiciliado en la cuenta ···· 4821' })
  })
  it('presentados del año: desde que lleva aquí sus impuestos; nueve de nueve, todos en plazo y contabilizados', () => {
    expect(cifraPresentados(cal(OCTUBRE))).toMatchObject({ valor: 'Ninguno todavía', apoyo: 'desde el 18/10, que llevas aquí tus impuestos' })
    expect(cifraPresentados(cal(OCTUBRE, { presentados: { ano: 2026, desde: '2026-01-01', vencidos: 9, presentados: 9, en_plazo: 9, contabilizados: 9 } })))
      .toMatchObject({ valor: '9 de 9', apoyo: 'todos en plazo y contabilizados' })
    expect(cifraPresentados(cal(OCTUBRE, { presentados: { ano: 2026, desde: '2026-01-01', vencidos: 9, presentados: 8, en_plazo: 8, contabilizados: 8 } })))
      .toMatchObject({ valor: '8 de 9', tono: 'duda' })
  })
})

describe('el título y lo siguiente', () => {
  it('«Octubre · 3.er trimestre»', () => { expect(tituloVentana(cal(OCTUBRE))).toBe('Octubre · 3.er trimestre') })
  it('lo siguiente de Foodint, por meses: diciembre (202), enero (303, 111, 115 y los resúmenes) y febrero (347)', () => {
    const s = (modelo: string, cadencia: FilaCalendario['cadencia'], periodo: string, presentacion: string, ejercicio = 2026) =>
      ({ modelo, nombre: modelo, cadencia, ejercicio, periodo, presentacion, domiciliacion: null })
    const c = cal(OCTUBRE, { siguiente: [
      s('202', 'instalments_202', '3P', '2026-12-21'),
      s('111', 'quarterly', '4T', '2027-01-20'), s('115', 'quarterly', '4T', '2027-01-20'), s('180', 'annual', '0A', '2027-02-01'),
      s('303', 'quarterly', '4T', '2027-02-01'),
    ] })
    const g = loSiguiente(c, 'medio')
    expect(g.map((x) => x.cuando)).toEqual(['hasta el 21/12', 'hasta el 20/01', 'hasta el 01/02'])
    expect(g[2]).toEqual({ cuando: 'hasta el 01/02', que: 'Resumen anual del alquiler (180), IVA del trimestre (303)', nota: 'el IVA lo calcula Sumied con tus libros' })
    expect(g[0].nota).toBe('se calculará aquí pronto')
    expect(loSiguiente(c, 'experto')[1].que).toBe('111 · 4T, 115 · 4T')
  })
})
