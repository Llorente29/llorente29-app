// R12 · Una orden de Revo con varias facturas. Revo da el IVA POR ORDEN (Impuestos) y la base une
// el IVA a su factura por la orden: con dos facturas en una orden, la base paraba al guardar («No sé
// a qué factura va el IVA: la orden … tiene las facturas … y …») después de una vista previa que decía
// «Cuadra». Días INVENTADOS (T11) con los dos casos: la cuenta dividida y el ticket cambiado por una
// factura con NIF.

import { describe, expect, it } from 'vitest'
import { leerRevo, type FicheroRevo, type LecturaDia } from '../../../src/modules/conta/lib/lectorRevo'
import { loQueMiraLaBase, porQueNoCuadra, prepararDias } from '../../../src/modules/conta/lib/subirTpv'

const t = (...l: string[]) => l.join('\r\n') + '\r\n'
const hora = (k: number) => `2026-10-08 1${k % 10}:00:00`
interface Doc { numero: number; contador: string; nif?: string; base: string; iva: string; total: string }
interface Orden { id: string; total: string; base: string; iva: string; docs: Doc[]; iva_lineas: [tipo: number, base: string, iva: string][]; pagos: string[] }

function ficheros(os: Orden[]): FicheroRevo[] {
  return [
    { nombre: 'Ordenes_2026-10-08.csv', contenido: t('ID;Mesa;Sala;Empleado;Comensales;Abierto;Cerrado;Valor medio;Suma;Descuento;Subtotal;Impuesto total;Total;Entrega',
      ...os.map((o, k) => `    ${o.id};Mesa ${k};Sala;Empleado de ejemplo 1;2;${hora(k)};${hora(k)};${o.total};${o.total};0;${o.base};${o.iva};${o.total};--`)) },
    { nombre: 'Documentos_2026-10-08.csv', contenido: t('Orden;Documento;Contador;Cliente;NIF;Grupos de clientes;Fecha;Suma;Descuento;Subtotal;Impuesto total;Total',
      ...os.flatMap((o, k) => o.docs.map((d) => `    ${o.id};${d.numero};${d.contador};${d.nif ? 'Cliente de ejemplo' : ''};${d.nif ?? ''};;${hora(k)};${d.total};0;${d.base};${d.iva};${d.total}`))) },
    { nombre: 'Impuestos_2026-10-08.csv', contenido: t('Orden;Impuesto;Total;Subtotal;Impuesto total;Fecha',
      ...os.flatMap((o, k) => o.iva_lineas.map(([tipo, b, q]) => `    ${o.id};IVA ${tipo}%;${o.total};${b};${q};${hora(k)}`))) },
    { nombre: 'Pagos_2026-10-08.csv', contenido: t(';Orden;Total de la orden;Cliente;Factura;Caja;Fecha;Forma de pago;Turno;Empleado;Motivo de cancelación;Información adicional;Propina;Importe;Total',
      ...os.flatMap((o, k) => o.pagos.map((p, j) => `    ${o.id}${j};${o.id};${o.total};;${o.docs[0].numero};Caja Principal;${hora(k)};Efectivo;8001;Empleado de ejemplo 1;;;0;${p};${p}`))) },
  ]
}
function leer(os: Orden[]) {
  const r = leerRevo(ficheros(os))
  if (!r.ok) throw new Error(r.problemas.join(' | '))
  expect(r.lectura.dias).toHaveLength(1)
  return r.lectura.dias[0]
}
const cent = (xs: number[]) => xs.reduce((a, b) => a + Math.round(b * 100), 0)

// Una orden normal, con su factura, para que el día no sea solo el caso raro.
const NORMAL: Orden = { id: '920000', total: '11,00', base: '10,00', iva: '1,00', pagos: ['11,00'],
  docs: [{ numero: 8001, contador: 'Facturas', base: '10,00', iva: '1,00', total: '11,00' }], iva_lineas: [[10, '10,000', '1,000']] }
// Cuenta dividida, cada factura con su tipo: la comida al 10 % y la bebida al 21 %.
const DIVIDIDA: Orden = { id: '920001', total: '23,10', base: '20,00', iva: '3,10', pagos: ['11,00', '12,10'],
  docs: [{ numero: 8002, contador: 'Facturas', base: '10,00', iva: '1,00', total: '11,00' }, { numero: 8003, contador: 'Facturas', base: '10,00', iva: '2,10', total: '12,10' }],
  iva_lineas: [[10, '10,000', '1,000'], [21, '10,000', '2,100']] }
// Cuenta dividida a partes desiguales (20 € y 10 €), las dos con los dos tipos: en proporción a su total.
const A_PARTES: Orden = { id: '920002', total: '30,00', base: '26,04', iva: '3,96', pagos: ['20,00', '10,00'],
  docs: [{ numero: 8002, contador: 'Facturas', base: '17,36', iva: '2,64', total: '20,00' }, { numero: 8003, contador: 'Facturas', base: '8,68', iva: '1,32', total: '10,00' }],
  iva_lineas: [[10, '13,636', '1,364'], [21, '12,397', '2,603']] }
// El ticket 501 cambiado por la factura 8002, con NIF y los mismos importes; se pagó una vez.
const CAMBIADO: Orden = { id: '920003', total: '5,50', base: '5,00', iva: '0,50', pagos: ['5,50'],
  docs: [{ numero: 501, contador: 'Tickets', base: '5,00', iva: '0,50', total: '5,50' }, { numero: 8002, contador: 'Facturas', nif: 'B00000000', base: '5,00', iva: '0,50', total: '5,50' }],
  iva_lineas: [[10, '5,000', '0,500']] }
// Los tickets de alrededor, para ver que el 501 no deja hueco.
const TICKET = (id: string, numero: number): Orden => ({ id, total: '2,20', base: '2,00', iva: '0,20', pagos: ['2,20'],
  docs: [{ numero, contador: 'Tickets', base: '2,00', iva: '0,20', total: '2,20' }], iva_lineas: [[10, '2,000', '0,200']] })

describe('R12 · Una orden con varias facturas', () => {
  it('la base paraba: la vista previa ya dice lo mismo, con su frase (regla 8)', () => {
    const crudo: LecturaDia = {
      documentos: [
        { numero: 8002, contador: 'Facturas', fecha: '2026-10-08T10:00:00', orden: '920001', canal: '', nif: null, cliente: null, base: 10, cuota: 1, total: 11 },
        { numero: 8003, contador: 'Facturas', fecha: '2026-10-08T10:00:00', orden: '920001', canal: '', nif: null, cliente: null, base: 10, cuota: 2.1, total: 12.1 },
      ],
      impuestos: [{ orden: '920001', tipo: 10, base: 10, cuota: 1 }, { orden: '920001', tipo: 21, base: 10, cuota: 2.1 }],
      cobros: [{ fila: 2, orden: '920001', forma: 'Efectivo', importe: 23.1 }, { fila: 2, orden: '920001', forma: 'Efectivo', importe: 0 }, { fila: 3, orden: '920009', forma: 'Efectivo', importe: 0 }],
    }
    const frases = loQueMiraLaBase(crudo)
    expect(frases).toContain('No sé a qué factura va el IVA: la orden 920001 tiene las facturas 8002 y 8003.')
    expect(frases).toContain('Hay pagos de órdenes sin factura este día: la fila 3 (orden 920009).')
    expect(frases).toContain('El pago de la fila 2 está dos veces.')
    expect(porQueNoCuadra(crudo)).toEqual(expect.arrayContaining(frases))
  })

  it('cuenta dividida con un tipo cada una: cada factura lleva el IVA que dice en Documentos, y el día cuadra', () => {
    const d = leer([NORMAL, DIVIDIDA])
    const l = d.lectura
    expect(l.documentos.map((x) => [x.numero, x.orden])).toEqual([[8001, '920000'], [8002, '920001'], [8003, '920001·2']])
    expect(l.impuestos.filter((i) => i.orden.startsWith('920001')).map((i) => [i.orden, i.tipo, i.base, i.cuota]))
      .toEqual([['920001', 10, 10, 1], ['920001·2', 21, 10, 2.1]])
    expect(d.avisos).toContain('La orden 920001 tiene 2 facturas (8002 y 8003): su IVA va a cada una, con lo que dice cada factura.')
    // La misma vara a los dos lados (regla 31): el IVA del día, antes 4,10 en Impuestos y 4,10 en Documentos; después, igual.
    expect(cent(l.impuestos.map((i) => i.cuota))).toBe(410)
    expect(cent(l.documentos.map((x) => x.cuota))).toBe(410)
    expect(porQueNoCuadra(l)).toEqual([])
    expect(prepararDias([d], [], [])[0].como).toBe('cuadra')
  })

  it('sin un tipo claro por factura: el IVA de la orden va en proporción a su total, sin perder un céntimo', () => {
    const d = leer([NORMAL, A_PARTES])
    const l = d.lectura
    expect(l.impuestos.filter((i) => i.orden.startsWith('920002')).map((i) => [i.orden, i.tipo, i.base, i.cuota]))
      .toEqual([['920002', 10, 9.09, 0.91], ['920002·2', 10, 4.55, 0.45], ['920002', 21, 8.27, 1.73], ['920002·2', 21, 4.13, 0.87]])
    expect(d.avisos).toContain('La orden 920002 tiene 2 facturas (8002 y 8003): su IVA va a cada una, en proporción a su total.')
    expect(cent(l.impuestos.map((i) => i.base + i.cuota))).toBe(cent(l.documentos.map((x) => x.total)))
    expect(d.ajuste).toBeNull()
    expect(porQueNoCuadra(l)).toEqual([])
    expect(prepararDias([d], [], [])[0].como).toBe('cuadra')
  })

  it('el ticket cambiado por factura con NIF: cuenta solo la buena, el ticket se queda a cero con su número', () => {
    const d = leer([TICKET('920010', 500), CAMBIADO, TICKET('920011', 502), NORMAL])
    const l = d.lectura
    const ticket = l.documentos.find((x) => x.numero === 501)!
    expect([ticket.base, ticket.cuota, ticket.total]).toEqual([0, 0, 0])
    expect(l.documentos.find((x) => x.numero === 8002)).toMatchObject({ orden: '920003', nif: 'B00000000', total: 5.5 })
    expect(d.avisos).toContain('La factura 501 (sin NIF) la sustituye la 8002, con NIF y los mismos importes: cuenta solo la 8002.')
    // Antes y después, con la misma vara: el día vendía 5,50 + 2,20 + 2,20 + 11,00 = 20,90 €, y se pagaron 20,90 €.
    expect(cent(l.documentos.map((x) => x.total))).toBe(2090)
    expect(cent(l.cobros.map((x) => x.importe))).toBe(2090)
    expect(d.resumen.conNif.map((x) => x.numero)).toEqual([8002])
    expect(porQueNoCuadra(l)).toEqual([])
    const [p] = prepararDias([d], [], [])
    expect(p.como).toBe('cuadra')
  })

  it('lo que no se puede guardar lo dice la vista previa, no la base al guardar', () => {
    // La cuenta dividida, pero Impuestos trae 1 € menos de IVA que las dos facturas.
    const mal: Orden = { ...DIVIDIDA, iva_lineas: [[10, '10,000', '1,000'], [21, '10,000', '1,100']] }
    const d = leer([NORMAL, mal])
    const [p] = prepararDias([d], [], [])
    expect(p.como).toBe('no_cuadra')
    expect(p.aviso?.frases.join(' ')).toMatch(/El IVA desglosado/)
  })
})
