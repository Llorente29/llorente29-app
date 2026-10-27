// tests/unit/modules/conta/pc01/cobros.test.ts
//
// PC01 · Entrega 3 · Ventas › Cobros (tableros cobros-1 y cobros-2), sin React:
// el estado de cada fila, qué entra en una remesa de recibos y por qué no, las
// pestañas, las cifras, la próxima remesa, los pasos de una remesa, lo que
// Bancos propone para un abono o una devolución, y (E4) la columna
// «Recordatorios» y los días en palabras. El correo del mandato lo escribe
// ahora el servidor: pc01/cobroCorreos.test.ts.
//
// Dos poblaciones:
//   · la REAL de Foodint (fixtures/cobros-foodint-20261026.json): sus 89
//     emitidas por cobrar, todas de plataforma (Foodint no tiene clientes
//     domiciliados), con el total medido aparte en producción;
//   · los casos del tablero cobros-1 (Club Deportivo Vallecas, Academia de
//     Baile, Bar La Esquina sin mandato, Ghost Kitchens vencida…), para lo que
//     Foodint aún no tiene.

import { describe, expect, it } from 'vitest'
import foodint from './fixtures/cobros-foodint-20261026.json'
import {
  abonosQueCuadran, chipEstado, cifrasCobros, devolucionesQueCuadran, enPestana, estadoCobro, filaCobro, filtrar, libre,
  pasosRemesa, porQueNoEnRemesa, siguienteLaborable, cargoProximo, leerDias, textoDias, textoRecordatorios, type FilaCobro,
} from '@/modules/conta/lib/cobros'

const f = (x: Record<string, unknown>): FilaCobro => filaCobro({
  id: x.id ?? 'x', party_id: 'c', cliente: 'Cliente', numero: 'A-1', fecha: '2026-10-01', vence: '2026-11-01', total: 100, cobrado: 0, pendiente: 100,
  estado: 'por_cobrar', dias_vencida: null, forma: 'direct_debit', location_id: null, local: null, mandato: 'SUM-000001', mandato_firmado: '2026-09-03',
  con_mandato: true, iban4: '1332', con_cuenta: true, remesa: null, devuelto: null, ...x,
})

const HOY = '2026-10-26' // lunes
const CLUB = f({ id: 'club', cliente: 'Club Deportivo Vallecas', numero: 'F-2026/0084', total: 432, pendiente: 432 })
const ACADEMIA = f({ id: 'acad', cliente: 'Academia de Baile Lavapiés', numero: 'A-2026/0012', total: 660, pendiente: 660 })
const BAR = f({ id: 'bar', cliente: 'Bar La Esquina de Usera', numero: 'A-2026/0014', total: 385, pendiente: 385, con_mandato: false, mandato: null })
const GHOST = f({ id: 'ghost', cliente: 'Ghost Kitchens Madrid SL', vence: '2026-10-10', total: 1452, pendiente: 1452, estado: 'vencida', dias_vencida: 15, forma: 'transfer' })
const EVENTOS = f({ id: 'eventos', cliente: 'Eventos Rivas Catering SL', vence: '2026-11-14', total: 780.5, pendiente: 780.5, forma: 'transfer' })
const EN_REMESA = f({ id: 'colegio', cliente: 'Colegio Nuestra Señora del Pilar', total: 1248, pendiente: 1248, remesa: { id: 'r9', codigo: 'C-2026/009', importe: 1248, cargo: '2026-11-03' } })
const DEVUELTO = f({ id: 'dev', cliente: 'Club Deportivo Vallecas', numero: 'F-2026/0071', total: 432, pendiente: 432,
  devuelto: { linea: 'l1', remesa: 'r8', codigo: 'C-2026/008', fecha: '2026-10-08', motivo: 'sin fondos', gastos: 3.5 } })
const COBRADA = f({ id: 'cob', total: 200, cobrado: 200, pendiente: 0, estado: 'cobrada' })

describe('la población real de Foodint (89 emitidas por cobrar, todas de plataforma)', () => {
  const filas = foodint.filas.map((x, i) => f({ ...x, id: `fi${i}`, forma: 'plataforma', con_mandato: false, mandato: null }))
  it('ninguna entra en una remesa de recibos: se cobran en Liquidaciones', () => {
    expect(filas.filter((x) => porQueNoEnRemesa(x) === null)).toHaveLength(0)
    expect(new Set(filas.map(porQueNoEnRemesa))).toEqual(new Set(['la paga una plataforma: se cobra en Liquidaciones']))
  })
  it('el estado es el de la base: 39 «Falta su liquidación» (ámbar, no Vencida) y 50 «Esperando liquidación»', () => {
    expect(filas.filter((x) => estadoCobro(x) === 'falta_liquidacion')).toHaveLength(39)
    expect(filas.filter((x) => estadoCobro(x) === 'esperando_liquidacion')).toHaveLength(50)
    expect(filas.filter((x) => estadoCobro(x) === 'vencida')).toHaveLength(0)
    expect(chipEstado(filas[0])).toEqual({ texto: 'Falta su liquidación', tono: 'duda' })
  })
  it('«Por cobrar» suma lo medido aparte en producción (19.108,63 €, 89 facturas); la próxima remesa, nada', () => {
    const c = cifrasCobros(filas, 0, 0, foodint.hoy)
    expect(c.porCobrar).toEqual({ importe: 19108.63, n: 89 })
    expect(c.proxima.n).toBe(0)
    expect(filas.filter((x) => enPestana(x, 'proxima'))).toHaveLength(0)
    expect(filas.filter((x) => enPestana(x, 'por_cobrar'))).toHaveLength(89) // regla 7: ninguna se esconde
  })
})

describe('el estado y qué entra en una remesa (tablero cobros-1)', () => {
  it('domiciliada con mandato: «Próxima remesa» y entra', () => {
    expect(chipEstado(CLUB)).toEqual({ texto: 'Próxima remesa', tono: 'seguro' })
    expect(porQueNoEnRemesa(CLUB)).toBeNull()
  })
  it('domiciliada sin mandato: «Falta el mandato» (ámbar) y no entra, con su porqué', () => {
    expect(chipEstado(BAR)).toEqual({ texto: 'Falta el mandato', tono: 'duda' })
    expect(porQueNoEnRemesa(BAR)).toBe('Bar La Esquina de Usera no tiene mandato firmado')
  })
  it('vencida por transferencia: rojo con los días, y no va por remesa', () => {
    expect(chipEstado(GHOST)).toEqual({ texto: 'Vencida · 15 días', tono: 'falta' })
    expect(porQueNoEnRemesa(GHOST)).toBe('paga por transferencia')
    expect(porQueNoEnRemesa(f({ forma: 'card' }))).toBe('paga con tarjeta')
    expect(porQueNoEnRemesa(f({ forma: null }))).toBe('no dice cómo paga')
    expect(porQueNoEnRemesa(f({ con_cuenta: false, cliente: 'Sin 430' }))).toBe('Sin 430 no tiene su cuenta de cliente (430)')
  })
  it('ya en una remesa: su código, y no entra en otra', () => {
    expect(estadoCobro(EN_REMESA)).toBe('en_remesa')
    expect(chipEstado(EN_REMESA)).toEqual({ texto: 'En la remesa C-2026/009', tono: 'seguro' })
    expect(porQueNoEnRemesa(EN_REMESA)).toBe('ya está en la remesa C-2026/009')
    expect(libre(EN_REMESA)).toBe(0)
  })
  it('devuelto: rojo con el motivo, sale en «Devueltos» y vuelve a entrar en la próxima remesa', () => {
    expect(chipEstado(DEVUELTO)).toEqual({ texto: 'Devuelto · sin fondos', tono: 'falta' })
    expect(enPestana(DEVUELTO, 'devueltos')).toBe(true)
    expect(porQueNoEnRemesa(DEVUELTO)).toBeNull()
    expect(enPestana(DEVUELTO, 'proxima')).toBe(true)
  })
  it('cobrada: no entra y sale solo en «Cobrados»', () => {
    expect(porQueNoEnRemesa(COBRADA)).toBe('ya está cobrada')
    expect(enPestana(COBRADA, 'cobrados')).toBe(true)
    expect(enPestana(COBRADA, 'por_cobrar')).toBe(false)
  })
})

describe('las pestañas, las cifras y la próxima remesa', () => {
  const todas = [GHOST, CLUB, ACADEMIA, BAR, EVENTOS, EN_REMESA, DEVUELTO, COBRADA]
  it('«Próxima remesa»: solo las domiciliadas con mandato sin remesa (el Bar, sin mandato, no)', () => {
    expect(todas.filter((x) => enPestana(x, 'proxima')).map((x) => x.id)).toEqual(['club', 'acad', 'dev'])
  })
  it('las cifras: por cobrar, vencido con sus días y la próxima remesa con su cargo', () => {
    const c = cifrasCobros(todas, 31240.55, 218, HOY)
    expect(c.porCobrar).toEqual({ importe: 1452 + 432 + 660 + 385 + 780.5 + 1248 + 432, n: 7 })
    expect(c.vencido).toEqual({ importe: 1452, n: 1, dias: 15 })
    expect(c.proxima).toEqual({ importe: 1524, n: 3, cargo: '2026-11-02' })
    expect(c.cobradoMes).toEqual({ importe: 31240.55, n: 218 })
  })
  it('el cargo: el vencimiento más cercano, nunca antes del siguiente laborable, y nunca en fin de semana', () => {
    expect(siguienteLaborable('2026-10-30')).toBe('2026-11-02') // viernes → lunes
    expect(cargoProximo([f({ vence: '2026-10-20' })], HOY)).toBe('2026-10-27') // vencida ya: mañana
    expect(cargoProximo([f({ vence: '2026-11-01' })], HOY)).toBe('2026-11-02') // domingo → lunes
    expect(cargoProximo([], HOY)).toBe('2026-10-27')
  })
  it('los filtros: buscar por importe con coma y por cliente, y «Cómo paga»', () => {
    const fl = { buscar: '1.452,00', hasta: null, forma: 'todas' as const, local: null }
    expect(filtrar(todas, 'por_cobrar', fl).map((x) => x.id)).toEqual(['ghost'])
    expect(filtrar(todas, 'por_cobrar', { ...fl, buscar: 'vallecas' }).map((x) => x.id)).toEqual(['club', 'dev'])
    expect(filtrar(todas, 'por_cobrar', { ...fl, buscar: '', forma: 'transfer' }).map((x) => x.id)).toEqual(['ghost', 'eventos'])
  })
})

describe('una remesa de recibos (tablero cobros-2)', () => {
  it('los pasos: Preparada → En el banco → Abonada → Plazo de devoluciones hasta el día', () => {
    expect(pasosRemesa('preparada', null).map((p) => [p.etiqueta, p.hecho, p.actual])).toEqual([
      ['Preparada', false, true], ['En el banco', false, false], ['Abonada', false, false], ['Plazo de devoluciones', false, false]])
    expect(pasosRemesa('plazo', '2026-11-26').map((p) => [p.etiqueta, p.hecho, p.actual])).toEqual([
      ['Preparada', true, false], ['En el banco', true, false], ['Abonada', true, false], ['Plazo de devoluciones · hasta el 26/11', false, true]])
    expect(pasosRemesa('cerrada', '2026-11-26').every((p) => p.hecho)).toBe(true)
  })
})

describe('lo que propone Bancos', () => {
  const remesas = [{ id: 'r9', codigo: 'C-2026/009', cargo: '2026-10-01', porAbonarCent: 234000, recibos: [
    { id: 'l1', importeCent: 43200, cliente: 'Club Deportivo Vallecas', factura: 'F-2026/0071' },
    { id: 'l2', importeCent: 66000, cliente: 'Academia de Baile Lavapiés', factura: 'A-2026/0007' },
    { id: 'l3', importeCent: 124800, cliente: 'Colegio Nuestra Señora del Pilar', factura: 'A-2026/0008' }] }]
  it('un abono de 2.340,00: la remesa entera; uno de 660,00: el recibo de la Academia', () => {
    expect(abonosQueCuadran(234000, remesas).map((x) => [x.texto, x.lineas])).toEqual([['Remesa de recibos C-2026/009', null]])
    expect(abonosQueCuadran(66000, remesas).map((x) => [x.texto, x.lineas])).toEqual([['Un recibo de la remesa C-2026/009', ['l2']]])
    expect(abonosQueCuadran(100, remesas)).toEqual([])
  })
  it('un cargo de 435,50: la devolución del recibo de 432,00 con 3,50 de gastos; más de 30 € de diferencia, no', () => {
    const recibos = [{ id: 'l1', remesa: 'C-2026/009', importeCent: 43200, cliente: 'Club Deportivo Vallecas', factura: 'F-2026/0071', abonado: '2026-10-01' },
      { id: 'l2', remesa: 'C-2026/009', importeCent: 66000, cliente: 'Academia de Baile Lavapiés', factura: 'A-2026/0007', abonado: '2026-10-01' }]
    expect(devolucionesQueCuadran(43550, recibos).map((x) => [x.id, x.gastosCent])).toEqual([['l1', 350]])
    expect(devolucionesQueCuadran(46300, recibos)).toEqual([])
    expect(devolucionesQueCuadran(43100, recibos)).toEqual([])
  })
})

describe('la columna «Recordatorios» (E4), como en el tablero', () => {
  const r = (x: Partial<Parameters<typeof textoRecordatorios>[0] & object>) => ({ id: 'f', enviados: 0, ultimo: null, proximo: null, sin: null, noSalio: null, ...x })
  it('enviados y el próximo', () => {
    expect(textoRecordatorios(r({ enviados: 3, proximo: '2026-11-01' }))).toBe('3 enviados · próximo 01/11')
    expect(textoRecordatorios(r({ proximo: '2026-11-11' }))).toBe('próximo 11/11')
    expect(textoRecordatorios(r({ enviados: 1 }))).toBe('1 enviado')
    expect(textoRecordatorios(r({}))).toBe('ya no quedan')
  })
  it('por qué no lleva: domiciliada, plataforma y en remesa «no hacen falta»; apagados y sin correo, dicho', () => {
    expect(textoRecordatorios(r({ sin: 'domiciliada' }))).toBe('no hacen falta')
    expect(textoRecordatorios(r({ sin: 'plataforma' }))).toBe('no hacen falta')
    expect(textoRecordatorios(r({ sin: 'en_remesa' }))).toBe('no hacen falta')
    expect(textoRecordatorios(r({ sin: 'cliente', enviados: 2 }))).toBe('2 enviados · apagados para este cliente')
    expect(textoRecordatorios(r({ sin: 'apagados' }))).toBe('apagados')
    expect(textoRecordatorios(r({ sin: 'sin_correo' }))).toBe('sin correo del cliente')
    expect(textoRecordatorios(undefined)).toBe('—')
  })
  it('con enlace de pago (E4), como en el tablero: «con enlace · abierta 2 veces»', () => {
    expect(textoRecordatorios(r({ proximo: '2026-11-11' }), { aperturas: 2 })).toBe('con enlace · abierta 2 veces')
    expect(textoRecordatorios(r({}), { aperturas: 1 })).toBe('con enlace · abierta 1 vez')
    expect(textoRecordatorios(undefined, { aperturas: 0 })).toBe('con enlace · sin abrir')
    expect(textoRecordatorios(r({ sin: 'domiciliada' }), { aperturas: 3 })).toBe('no hacen falta')
  })
  it('las 89 por cobrar REALES de Foodint son de plataforma: «no hacen falta» en todas (0 recordatorios, como se midió en producción)', () => {
    const filas = (foodint as { filas: Record<string, unknown>[] }).filas
    expect(filas).toHaveLength(89)
    expect(new Set(filas.map((f) => textoRecordatorios(r({ sin: f.de_plataforma === true ? 'plataforma' : null }))))).toEqual(new Set(['no hacen falta']))
  })
})

describe('los días de los recordatorios (E4)', () => {
  it('en palabras', () => {
    expect(textoDias([-3, 0, 7, 15])).toBe('3 días antes, el día que vence y a los 7 y 15 días')
    expect(textoDias([0])).toBe('el día que vence')
    expect(textoDias([-1, 30])).toBe('1 día antes y a los 30 días')
    expect(textoDias([-5, -2, 1])).toBe('2 y 5 días antes y a los 1 día')
  })
  it('leídos del campo', () => {
    expect(leerDias('-3, 0, 7, 15')).toEqual([-3, 0, 7, 15])
    expect(leerDias('15 7 0 -3 7')).toEqual([-3, 0, 7, 15])
    expect(leerDias('')).toBeNull()
    expect(leerDias('-3, siete')).toBeNull()
    expect(leerDias('1.5')).toBeNull()
  })
})
