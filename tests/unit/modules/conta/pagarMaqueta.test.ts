// B01 · Cola 1d y 1e (maqueta v2 de Pagar, aprobada por Julio el 02/11): el
// orden por columna, «Pagar lo de esta semana», si el saldo llega, las que
// están por revisar y la confirmación con contenido. Datos inventados.
import { describe, expect, it } from 'vitest'
import {
  cambiarOrden, cifrasPagos, enPestana, leerOrdenPagos, llega, loDeEstaSemana, ordenarPagos, porQueNoEnRemesa, type FilaPago,
} from '@/modules/conta/lib/pagos'
import { textoPagadas } from '@/modules/conta/pagos/pagarService'

const fila = (id: string, o: Partial<FilaPago> = {}): FilaPago => ({
  id, proveedorId: `p-${id}`, proveedor: `Proveedor ${id}`, numero: id, fecha: '2026-10-20', vence: '2026-11-05', total: 100, pagado: 0, pendiente: 100,
  estadoBase: 'vence_semana', diasVencida: null, forma: 'transfer', localId: null, local: null, iban4: '0001', conIban: true,
  ibanSinConfirmar: false, ibanDistinto: false, ibanLeido4: null, conCuenta: true, remesa: null, ...o,
})

describe('Cola 1d · ordenar por columna', () => {
  const filas = [
    fila('b', { vence: '2026-11-07', proveedor: 'Bebidas', pendiente: 50 }),
    fila('s', { vence: null, proveedor: 'Aceites', pendiente: 10, estadoBase: 'sin_vencimiento' }),
    fila('a', { vence: '2026-10-28', proveedor: 'Carnes', pendiente: 300, estadoBase: 'vencida' }),
  ]
  it('por defecto, por vencimiento, lo más cercano primero; las «sin fecha», al final, también al revés', () => {
    expect(ordenarPagos(filas).map((f) => f.id)).toEqual(['a', 'b', 's'])
    expect(ordenarPagos(filas, { columna: 'vence', sentido: 'desc' }).map((f) => f.id)).toEqual(['b', 'a', 's'])
  })
  it('por proveedor, importe y estado, en los dos sentidos', () => {
    expect(ordenarPagos(filas, { columna: 'proveedor', sentido: 'asc' }).map((f) => f.id)).toEqual(['s', 'b', 'a'])
    expect(ordenarPagos(filas, { columna: 'pendiente', sentido: 'desc' }).map((f) => f.id)).toEqual(['a', 'b', 's'])
    expect(ordenarPagos(filas, { columna: 'estado', sentido: 'asc' }).map((f) => f.id)).toEqual(['a', 'b', 's'])
  })
  it('la misma columna cambia de sentido; otra empieza ascendente; lo guardado se lee (y si no vale, el de siempre)', () => {
    expect(cambiarOrden({ columna: 'vence', sentido: 'asc' }, 'vence')).toEqual({ columna: 'vence', sentido: 'desc' })
    expect(cambiarOrden({ columna: 'vence', sentido: 'desc' }, 'proveedor')).toEqual({ columna: 'proveedor', sentido: 'asc' })
    expect(leerOrdenPagos('pendiente:desc')).toEqual({ columna: 'pendiente', sentido: 'desc' })
    expect(leerOrdenPagos('cualquiera')).toEqual({ columna: 'vence', sentido: 'asc' })
  })
})

describe('Cola 1e · lo que toca pagar', () => {
  const filas = [
    fila('v', { estadoBase: 'vencida', pendiente: 288.4 }),
    fila('s', { estadoBase: 'vence_semana', pendiente: 96.3 }),
    fila('d', { estadoBase: 'vence_semana', forma: 'direct_debit', pendiente: 40 }),
    fila('r', { estadoBase: 'vence_semana', porRevisar: true, pendiente: 180.15 }),
    fila('l', { estadoBase: 'por_pagar', vence: '2026-12-01', pendiente: 500 }),
  ]
  it('«Pagar lo de esta semana»: lo vencido y lo de esta semana que se puede pagar; lo demás, fuera con su porqué', () => {
    const r = loDeEstaSemana(filas)
    expect(r.entran.map((f) => f.id)).toEqual(['v', 's'])
    expect(r.total).toBe(384.7)
    expect(r.fuera.map((f) => [f.id, porQueNoEnRemesa(f)])).toEqual([['d', 'la paga el banco solo (domiciliada)'], ['r', 'está por revisar: apruébala para pagarla']])
  })
  it('las cuatro cifras: la de por revisar aparte, sin contar en las demás', () => {
    const c = cifrasPagos(filas, 0, 0)
    expect(c.porRevisar).toEqual({ importe: 180.15, n: 1 })
    expect(c.semana.n).toBe(2)
    expect(c.vencido.importe).toBe(288.4)
  })
  it('una por revisar sale en «Por pagar», no en las de la semana, y no se puede marcar', () => {
    const r = filas[3]
    expect([enPestana(r, 'por_pagar'), enPestana(r, 'semana')]).toEqual([true, false])
    expect(porQueNoEnRemesa(r)).toBe('está por revisar: apruébala para pagarla')
  })
  it('si el saldo llega (con el céntimo justo), no llega o no se sabe', () => {
    expect([llega(708.7, 708.7), llega(3, 708.7), llega(null, 708.7)]).toEqual([true, false, null])
  })
  it('la confirmación lleva contenido (regla 8)', () => {
    expect(textoPagadas(3, 708.7, 'Revolut')).toBe('Pagadas 3 facturas · 708,70 € desde Revolut · el cargo se casará solo.')
    expect(textoPagadas(1, 288.4, 'Revolut')).toBe('Pagadas 1 factura · 288,40 € desde Revolut · el cargo se casará solo.')
  })
})
