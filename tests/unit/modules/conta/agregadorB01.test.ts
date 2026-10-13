// tests/unit/modules/conta/agregadorB01.test.ts
//
// B01 · tarea 6: el agregador preparado para Enable Banking (con un transporte
// falso: ni claves ni red), el simulado, el mismo movimiento por dos caminos
// y el aviso del consentimiento. Y lo de la respuesta 4 que vive en el núcleo:
// la barra de una fila, el botón principal de cada fila y las migas.
// Los movimientos son los del Norma 43 inventado de la demostración
// (tests/e2e/conta/b01/datos.ts), no ejemplos sueltos.

import { describe, expect, it } from 'vitest'
import { huellas, huellasSuaves, type MovimientoLeido } from '@/modules/conta/lib/extractoBanco'
import { leerDesdeAgregador } from '@/modules/conta/lib/fuentesBanco'
import { leerNorma43 } from '@/modules/conta/lib/norma43'
import {
  avisoConsentimiento, caducaElConsentimiento, movimientoDeEnableBanking, proveedorEnableBanking, proveedorSimulado, type TransaccionEnableBanking,
} from '@/modules/conta/lib/agregadorBanco'
import { bancosEnBarra, filaDe, migasBanco, nombreCorto, type MovimientoBanco } from '@/modules/conta/lib/bancosVista'
import { decidir } from '@/modules/conta/lib/conciliacion'
import { FICHERO } from '../../../e2e/conta/b01/datos'

describe('Enable Banking: su transacción, en nuestro modelo', () => {
  it('cargo y abono, con céntimos, concepto y contraparte', () => {
    const cargo = movimientoDeEnableBanking({ entry_reference: 'E1', transaction_amount: { amount: '86.4', currency: 'EUR' }, credit_debit_indicator: 'DBIT',
      booking_date: '2026-10-10', value_date: '2026-10-11', remittance_information: ['PAGO CON TARJETA', ' MERCADO CENTRAL 0937'], creditor: { name: 'MERCADO CENTRAL' } })
    expect(cargo).toEqual({ id: 'E1', fecha: '2026-10-10', fechaValor: '2026-10-11', importeCent: -8640, concepto: 'PAGO CON TARJETA MERCADO CENTRAL 0937', contraparte: 'MERCADO CENTRAL' })
    const abono = movimientoDeEnableBanking({ transaction_id: 'T2', transaction_amount: { amount: '3412.18', currency: 'EUR' }, credit_debit_indicator: 'CRDT',
      booking_date: '2026-10-08', remittance_information: [''], debtor: { name: 'GLOVO' } })
    expect(abono).toMatchObject({ id: 'T2', importeCent: 341218, concepto: 'GLOVO', contraparte: 'GLOVO' })
    expect(() => movimientoDeEnableBanking({ transaction_amount: { amount: '1', currency: 'EUR' }, credit_debit_indicator: 'DBIT' })).toThrow(/sin fecha/)
  })

  it('el proveedor: cuentas con su IBAN, páginas con continuation_key y solo lo contabilizado', async () => {
    const llamadas: string[] = []
    const paginas: Record<string, { transactions: TransaccionEnableBanking[]; continuation_key?: string }> = {
      '': { transactions: [{ entry_reference: 'a', transaction_amount: { amount: '12.50', currency: 'EUR' }, credit_debit_indicator: 'DBIT', booking_date: '2026-10-03', remittance_information: ['COMISION MANTENIMIENTO'] },
                           { entry_reference: 'p', transaction_amount: { amount: '5.00', currency: 'EUR' }, credit_debit_indicator: 'DBIT', booking_date: '2026-10-13', status: 'PDNG' }], continuation_key: 'k2' },
      k2: { transactions: [{ entry_reference: 'b', transaction_amount: { amount: '250.00', currency: 'EUR' }, credit_debit_indicator: 'DBIT', booking_date: '2026-10-13', remittance_information: ['TRANSFERENCIA'] }] },
    }
    const eb = proveedorEnableBanking({
      get: async <T,>(ruta: string, q?: Record<string, string>) => {
        llamadas.push(`${ruta}?${new URLSearchParams(q).toString()}`)
        if (ruta.startsWith('/sessions/')) return { accounts: [{ uid: 'acc-1', account_id: { iban: 'es02 0182 9101 3200 0000 0011' }, currency: 'EUR' }] } as T
        return paginas[q?.continuation_key ?? ''] as T
      },
    })
    const e = await leerDesdeAgregador(eb, 'sesion-1', '2026-10-01', '2026-10-13')
    expect(e.formato).toBe('agregador:enable-banking')
    expect(e.cuentas[0].iban).toBe('ES0201829101320000000011')
    expect(e.cuentas[0].movimientos.map((m) => m.importeCent)).toEqual([-1250, -25000])
    expect(llamadas).toEqual(['/sessions/sesion-1?', '/accounts/acc-1/transactions?date_from=2026-10-01&date_to=2026-10-13',
      '/accounts/acc-1/transactions?date_from=2026-10-01&date_to=2026-10-13&continuation_key=k2'])
    // Sin saldo de cierre: el extracto entra «sin comprobar» y lo dice.
    expect(e.cuentas[0].saldoFinalCent).toBeNull()
  })
})

describe('El mismo movimiento por el agregador y por Norma 43', () => {
  it('distinta huella entera (no traen las mismas referencias), la misma huella suave', async () => {
    const n43 = leerNorma43(FICHERO).cuentas[0]   // Banco B01 · Norte
    const delBanco = n43.movimientos.map((m, i) => ({ id: `eb-${i}`, fecha: m.fecha, fechaValor: m.fechaValor, importeCent: m.importeCent, concepto: m.conceptoBanco, contraparte: null }))
    const sim = proveedorSimulado({ cuentas: [{ id: 'norte', iban: n43.iban!, titular: null, divisa: 'EUR' }], movimientos: { norte: [...delBanco].reverse() } })
    const agr = (await leerDesdeAgregador(sim, 'c', '2026-10-01', '2026-10-13')).cuentas[0]
    expect([...huellasSuaves(agr.movimientos)].sort()).toEqual([...huellasSuaves(n43.movimientos)].sort())
    const enteras = huellas(agr.movimientos)
    expect(huellas(n43.movimientos).filter((h) => enteras.includes(h))).toEqual([])
  })

  it('dos pagos iguales el mismo día siguen siendo dos (el orden en el día entra en la huella)', () => {
    const m = (n: number): MovimientoLeido => ({ fecha: '2026-10-10', fechaValor: '2026-10-10', importeCent: -500, conceptoBanco: `CAFE ${n}`, conceptoComun: null,
      conceptoPropio: null, numeroDocumento: null, referencia1: null, referencia2: null, equivalencia: null })
    const s = huellasSuaves([m(1), m(2)])
    expect(new Set(s).size).toBe(2)
  })
})

describe('El consentimiento: 180 días y el aviso 7 días antes', () => {
  const c = { conexionId: 'l1', banco: 'Banco B01 · Sur', caduca: caducaElConsentimiento('2026-04-20') }
  it('caduca a los 180 días', () => expect(c.caduca).toBe('2026-10-17'))
  it('nada hasta 7 días antes; luego cuándo y cómo renovarlo con un clic; y caducado', () => {
    expect(avisoConsentimiento(c, '2026-10-09').nivel).toBe('nada')
    const a = avisoConsentimiento(c, '2026-10-12')
    expect(a).toMatchObject({ nivel: 'aviso', dias: 5, accion: { etiqueta: 'Renovar el permiso', conexionId: 'l1' } })
    expect(a.texto).toBe('El permiso para leer Banco B01 · Sur caduca el 17/10/2026 (en 5 días). Renuévalo con un clic: «Renovar el permiso» y confirmas en tu banco.')
    expect(avisoConsentimiento(c, '2026-10-17').texto).toContain('(hoy)')
    expect(avisoConsentimiento(c, '2026-10-18').nivel).toBe('caducado')
  })
})

describe('Respuesta 4 en el núcleo', () => {
  const b = (id: string, nombre: string, alias: string | null = null) => ({ id, nombre, alias, iban: null })
  it('la barra: hasta cuatro, todos; desde cinco, tres a la vista con el de más dudas y el elegido', () => {
    const cuatro = [b('1', 'A'), b('2', 'B'), b('3', 'C'), b('4', 'D')]
    expect(bancosEnBarra(cuatro, {}, null)).toEqual({ visibles: cuatro, resto: [] })
    const seis = [...cuatro, b('5', 'E'), b('6', 'F')]
    const r = bancosEnBarra(seis, { 6: 9, 2: 1 }, '5')
    expect(r.visibles.map((x) => x.id)).toEqual(['1', '5', '6'])
    expect(r.resto.map((x) => x.id)).toEqual(['2', '3', '4'])
  })
  it('el nombre corto y las migas sin caracteres raros', () => {
    expect(nombreCorto(b('1', 'Banco B01 · Norte', ' B01 Norte '))).toBe('B01 Norte')
    expect(nombreCorto(b('1', 'Banco B01 · Norte', ''))).toBe('Banco B01 · Norte')
    expect(migasBanco({ nombre: 'Banco B01 · Norte', iban: 'ES0201829101320000000011' })).toBe('Bancos › Banco B01 · Norte · ···0011')
  })
  it('un solo botón principal por fila: «Sí» en ámbar, «Decirlo yo» en gris, ninguno en verde', () => {
    const base: MovimientoBanco = { id: 'm', cuentaId: 'b', fecha: '2026-10-03', importeCent: -1250, conceptoBanco: '', conceptoLimpio: '', estado: 'propuesto',
      confianza: 'probable', porque: 'p', propuesta: { que: 'Comisión del banco' }, casado: null, tarjeta: null, ticket: null, motivoIgnorado: null }
    expect(filaDe(base).principal).toBe('si')
    expect(filaDe({ ...base, propuesta: { que: 'x', pideTicket: true } }).principal).toBe('subir-foto')
    expect(filaDe({ ...base, estado: 'por_aclarar' }).principal).toBe('decirlo-yo')
    expect(filaDe({ ...base, estado: 'casado', casado: { id: 'c', tipo: 'cuenta', porque: 'x', porQuien: 'folvy', asientoId: 'e', asientoConcepto: 'x' } }).principal).toBeNull()
  })
  it('una regla propone, nunca casa sola (respuesta 4, punto 3)', () => {
    const regla = { id: 'r1', palabras: 'Cuando el concepto tenga «PLENITUDE» → Luz y agua · 62800000', contiene: 'PLENITUDE', signo: -1 as const, cuenta: '62800000', terceroId: null }
    const ctxVacio = {
      cuentas: [{ id: 'b', nombre: 'Norte', cuenta: '57200001' }], sinCasar: [], facturas: [], saldosTraidos: [], proveedores: [], clientes: [], liquidaciones: [], plataformas: [],
      nominas: [], impuestos: [], contratos: [], reglas: [regla], aprendido: [{ contraparte: 'PLENITUDE', cuenta: '62800000', terceroId: null, veces: 40 }], asientos: [],
      nombres: { '62800000': 'Luz y agua' }, cuentas626: '62600000', cuentas476: '47600000',
    }
    const d = decidir({ id: 'm', cuentaId: 'b', fecha: '2026-10-05', importeCent: -12_345, concepto: 'RECIBO PLENITUDE ENERGIA', conceptoComun: '03', referencias: [], antesDelCorte: false }, ctxVacio)
    expect(d.confianza).toBe('probable')
  })
})
