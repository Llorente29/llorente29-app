// S01o · Lo que Sumied sabe al 100 % se apunta solo: lo que dice la pantalla.
// Datos inventados (proveedores, números e importes): ninguno real (T11).
import { describe, expect, it } from 'vitest'
import { deLaBase, lineaDeArriba, motivoDeRevisar, SIN_APUNTADAS } from '@/modules/conta/lib/apuntaSolo'
import { estadoDeFila, filasDeLaLista, filtrosDe, pestanaDe, pestanaDeFila, pestanasConNumero } from '@/modules/conta/documentos/recibidas'
import type { FilaDocumento } from '@/modules/conta/documentos/documentos'
import type { ExtraFactura } from '@/modules/conta/services/documentosService'

const fila = (id: string, estado: FilaDocumento['estado']): FilaDocumento => ({
  id, tipo: 'factura', estado, proveedor: { id: 'p', nombre: 'Plataforma Inventada' }, numero: `INV${id}0000`, fecha: '2026-10-15', total: 12.1,
  canal: 'correo', confianza: null, porque: null, entendido: null, recepcion: null, asiento: null, llego: '2026-10-15T10:00:00Z',
} as FilaDocumento)
const extra = (x: Partial<ExtraFactura>): ExtraFactura => ({ base: 10, iva: 2.1, pagada: null, comoPagada: null, localId: null, local: null, ...x })

describe('S01o · la línea de arriba', () => {
  it('dice cuántas apuntó sola esta semana, en singular y en plural', () => {
    expect(lineaDeArriba({ ...SIN_APUNTADAS, semana: 1 })).toBe('Sumied ha apuntado solo 1 factura esta semana')
    expect(lineaDeArriba({ ...SIN_APUNTADAS, semana: 12345 })).toBe('Sumied ha apuntado solo 12.345 facturas esta semana')
  })
  it('con ninguna esta semana no dice nada (no es una alerta en verde con 0)', () => {
    expect(lineaDeArriba(SIN_APUNTADAS)).toBeNull()
  })
})

describe('S01o · el motivo de «Por revisar»', () => {
  it('es la frase de la base; si falta la cuenta de la ficha, pide ponerla', () => {
    expect(motivoDeRevisar('Falta la cuenta de gasto en la ficha de Glovo.')).toEqual({ frase: 'Falta la cuenta de gasto en la ficha de Glovo.', ponerEnFicha: true })
    expect(motivoDeRevisar('Falta la subcuenta en la ficha de Uber.')?.ponerEnFicha).toBe(true)
    expect(motivoDeRevisar('La factura y su liquidación difieren en 21,00 € y no es la tarifa recurrente.')?.ponerEnFicha).toBe(false)
    expect(motivoDeRevisar('Es un abono sin liquidación ligada y no dice de qué local es.')?.ponerEnFicha).toBe(false)
  })
  it('sin motivo, nada', () => {
    expect(motivoDeRevisar(null)).toBeNull()
    expect(motivoDeRevisar('  ')).toBeNull()
  })
})

describe('S01o · lo que devuelve la base', () => {
  it('se lee igual venga como venga, y sin datos es «ninguna»', () => {
    expect(deLaBase(null)).toEqual(SIN_APUNTADAS)
    const r = deLaBase({ semana: 2, filas: [{ id: 'a', porque: 'Factura de Plataforma Inventada…', regla: 'plataforma', asiento: 'e', at: '2026-11-01T18:07:00Z' }], motivos: { b: 'No sé si es comisión o publicidad.' } })
    expect(r.semana).toBe(2)
    expect(r.filas[0]).toEqual({ id: 'a', porque: 'Factura de Plataforma Inventada…', regla: 'plataforma', asiento: 'e', at: '2026-11-01T18:07:00Z' })
    expect(r.motivos.b).toBe('No sé si es comisión o publicidad.')
  })
})

describe('S01o · «Apuntadas solas» es una pestaña más, y las pestañas siguen sumando «Todas» (regla 7)', () => {
  const filas = [fila('1', 'apuntada'), fila('2', 'apuntada'), fila('3', 'para_mirar'), fila('4', 'repetida')]
  const mapa = new Map<string, ExtraFactura>([
    ['1', extra({ sola: 'Factura de Plataforma Inventada de su liquidación del 1–15/10 de Local Inventado (mismo número); cuadra al céntimo.', pagada: '2026-10-15' })],
    ['2', extra({ pagada: '2026-10-15' })],
    ['3', extra({ motivo: 'Falta la cuenta de gasto en la ficha de Glovo.' })],
  ])
  it('la apuntada sola va en «Apuntadas solas» (aunque esté pagada), con su chip; la otra, en «Pagadas»', () => {
    expect(pestanaDeFila(filas[0], mapa.get('1'))).toBe('solas')
    expect(estadoDeFila(filas[0], mapa.get('1'))).toEqual({ texto: 'Apuntada sola', tono: 'seguro' })
    expect(pestanaDeFila(filas[1], mapa.get('2'))).toBe('pagadas')
  })
  it('cada fila cae en una sola y la suma es «Todas»; «Otras» se llama «Apartadas»', () => {
    const p = pestanasConNumero(filas, mapa)
    const todas = p.find((x) => x.id === 'todas')!.n
    expect(p.filter((x) => x.id !== 'todas').reduce((t, x) => t + x.n, 0)).toBe(todas)
    expect(p.map((x) => x.etiqueta)).toEqual(['Todas', 'Por revisar', 'Apuntadas solas', 'Por pagar', 'Pagadas', 'Apartadas'])
  })
  it('sin ninguna apuntada sola, la pestaña no sale (y no hay filas escondidas)', () => {
    expect(pestanasConNumero(filas.slice(1), new Map()).some((x) => x.id === 'solas')).toBe(false)
  })
  it('?ver=solas abre esa pestaña y lista solo esas', () => {
    expect(pestanaDe('solas')).toBe('solas')
    expect(filasDeLaLista(filas, mapa, filtrosDe(new URLSearchParams('ver=solas'))).map((x) => x.id)).toEqual(['1'])
  })
})

describe('S01o·2 · lo que dice la pantalla de las demás facturas', () => {
  it('«Falta su local» también lleva a la ficha', async () => {
    const { motivoDeRevisar: m } = await import('@/modules/conta/lib/apuntaSolo')
    expect(m('Falta su local en la ficha de Proveedor Inventado, S.L..')?.ponerEnFicha).toBe(true)
    expect(m('La lectura dudó: No cuadra: bases + IVA no es el total.')?.ponerEnFicha).toBe(false)
  })
  it('el ROI se dice en una frase, y el motivo que lo pide se reconoce', async () => {
    const { textoRoi, motivoPideRoi } = await import('@/modules/conta/lib/apuntaSolo')
    expect(textoRoi(false, true)).toBe('Guardado. Tu empresa no está en el ROI: el IVA español que te cobre un proveedor de la UE no se puede deducir y va al gasto.')
    expect(motivoPideRoi('Es de un proveedor de la UE que cobra IVA español: falta saber si estás en el ROI (Ajustes › Tus impuestos).')).toBe(true)
    expect(motivoPideRoi('Falta su local en la ficha de X.')).toBe(false)
  })
  it('«Entrega mercancía»: lo que dice la ficha en cada caso', async () => {
    const { textoEntregaMercancia } = await import('@/modules/conta/lib/apuntaSolo')
    expect(textoEntregaMercancia(false)).toBe('Es de servicios: sus facturas no esperan albarán.')
    expect(textoEntregaMercancia(null)).toMatch(/lo deduce Sumied/)
  })
  it('una llegada de un servicio no dice «esperando su albarán»', async () => {
    const { queSeHizo } = await import('@/modules/conta/lib/correoFacturas')
    const l = { resultado: 'factura', llegada: 'factura', motivo: null, dicho: null,
      factura: { id: 'f', codigo: null, numero: 'INV0000000001', total: 12.1, proveedor: 'Servicios Inventados', casada: false, espera_albaran: false } } as never
    expect(queSeHizo(l).titulo).toBe('Factura leída: INV0000000001 de Servicios Inventados')
    const l2 = { ...(l as object), factura: { id: 'f', codigo: null, numero: 'INV0000000002', total: 1, proveedor: 'Mercancía Inventada', casada: false, espera_albaran: true } } as never
    expect(queSeHizo(l2).titulo).toBe('Factura esperando su albarán: INV0000000002 de Mercancía Inventada')
  })
  it('el IVA no deducible por no estar en el ROI tiene su porqué', async () => {
    const { porQueNoDeducible } = await import('@/modules/conta/lib/ivaNoDeducible')
    expect(porQueNoDeducible('sin_roi')).toBe('es de un proveedor de la UE que cobra IVA español y la empresa no está en el ROI')
  })
})
