// R10 · Los ficheros de Revo con 3 decimales («28,909», «2,891»), como los de verdad. Un día
// INVENTADO (T11): cuatro órdenes iguales de 2,20 €, cada una con base 2,004 e IVA 0,196 al 10 %.
// Se suma con los 3 decimales y se redondea a céntimos al final, por día y tipo: base 8,02 e IVA
// 0,78 (redondear línea a línea daría 8,00 y 0,80). Base + IVA del día = 8,80, lo mismo que los
// Documentos y que los Pagos (regla 31).

import { describe, expect, it } from 'vitest'
import { leerRevo, milesimasRevo, repartirCentimos, type FicheroRevo } from '../../../src/modules/conta/lib/lectorRevo'
import { porQueNoCuadra } from '../../../src/modules/conta/lib/subirTpv'

const t = (...l: string[]) => l.join('\r\n') + '\r\n'
const ORDENES = ['910001', '910002', '910003', '910004']
const hora = (k: number) => `2026-10-07 1${k}:00:00`
const ficheros = (doc = { base: '2,004', iva: '0,196' }): FicheroRevo[] => [
  { nombre: 'Ordenes_2026-10-07.csv', contenido: t('ID;Mesa;Sala;Empleado;Comensales;Abierto;Cerrado;Valor medio;Suma;Descuento;Subtotal;Impuesto total;Total;Entrega',
    ...ORDENES.map((o, k) => `    ${o};Mesa ${k};Sala;Empleado de ejemplo 1;1;${hora(k)};${hora(k)};2,20;2,20;0;2,004;0,196;2,20;--`)) },
  { nombre: 'Documentos_2026-10-07.csv', contenido: t('Orden;Documento;Contador;Cliente;NIF;Grupos de clientes;Fecha;Suma;Descuento;Subtotal;Impuesto total;Total',
    ...ORDENES.map((o, k) => `    ${o};${7001 + k};Facturas;;;;${hora(k)};2,20;0;${doc.base};${doc.iva};2,20`)) },
  { nombre: 'Impuestos_2026-10-07.csv', contenido: t('Orden;Impuesto;Total;Subtotal;Impuesto total;Fecha',
    ...ORDENES.map((o, k) => `    ${o};IVA 10%;2,20;2,004;0,196;${hora(k)}`)) },
  { nombre: 'Pagos_2026-10-07.csv', contenido: t(';Orden;Total de la orden;Cliente;Factura;Caja;Fecha;Forma de pago;Turno;Empleado;Motivo de cancelación;Información adicional;Propina;Importe;Total',
    ...ORDENES.map((o, k) => `    ${o};${o};2,20;;${7001 + k};Caja Principal;${hora(k)};Efectivo;8001;Empleado de ejemplo 1;;;0;2,200;2,20`)) },
]

const sumaCent = (xs: number[]) => xs.reduce((a, b) => a + Math.round(b * 100), 0)

describe('R10 · 3 decimales en los ficheros de Revo', () => {
  it('se leen en milésimas, con signo y miles', () => {
    expect(milesimasRevo('28,909')).toBe(28909)
    expect(milesimasRevo('-2,891')).toBe(-2891)
    expect(milesimasRevo('1.234,5')).toBe(1234500)
    expect(milesimasRevo('2,1234')).toBeNull()
  })
  it('el reparto: las líneas suman el redondeo de su suma, no la suma de sus redondeos', () => {
    expect(repartirCentimos([196, 196, 196, 196])).toEqual([20, 20, 19, 19])
    expect(repartirCentimos([28909, 28909])).toEqual([2891, 2891])
    // En negativo (una devolución), igual: −0,392 → −0,39.
    expect(repartirCentimos([-196, -196])).toEqual([-19, -20])
  })
  it('el día se lee entero y cuadra: base + IVA de Impuestos = Documentos = Pagos (regla 31)', () => {
    const r = leerRevo(ficheros())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.lectura.problemas).toEqual([])
    const d = r.lectura.dias[0]
    expect([d.dia, d.leido]).toEqual(['2026-10-07', true])
    const l = d.lectura
    const imp = { base: sumaCent(l.impuestos.map((i) => i.base)), iva: sumaCent(l.impuestos.map((i) => i.cuota)) }
    const doc = { base: sumaCent(l.documentos.map((x) => x.base)), iva: sumaCent(l.documentos.map((x) => x.cuota)), total: sumaCent(l.documentos.map((x) => x.total)) }
    const pagos = sumaCent(l.cobros.map((x) => x.importe))
    // Las dos cifras del día, con la misma vara: 8,02 + 0,78 = 8,80 en Impuestos; 8,80 en Documentos y en Pagos.
    expect(imp).toEqual({ base: 802, iva: 78 })
    expect(doc).toEqual({ base: 802, iva: 78, total: 880 })
    expect(imp.base + imp.iva).toBe(doc.total)
    expect(pagos).toBe(doc.total)
    // Línea a línea, base + IVA = total en cada factura.
    for (const x of l.documentos) expect(Math.round(x.base * 100) + Math.round(x.cuota * 100)).toBe(Math.round(x.total * 100))
    expect(porQueNoCuadra(l)).toEqual([])
    expect([d.resumen.facturas, d.resumen.base, d.resumen.cuota, d.resumen.total]).toEqual([4, 8.02, 0.78, 8.8])
  })
  it('con los Documentos en 2 decimales (redondeados factura a factura), el IVA del día no cuadra por 2 céntimos y lo dice', () => {
    const r = leerRevo(ficheros({ base: '2,00', iva: '0,20' }))
    if (!r.ok) throw new Error(r.problemas.join(' | '))
    expect(porQueNoCuadra(r.lectura.dias[0].lectura)).toEqual([expect.stringMatching(/^El IVA desglosado suma 0,78 € y el de las facturas 0,80 €\./)])
  })
})
