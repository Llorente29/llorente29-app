// S02 · PR 2 · Contabilidad › Asientos deja de listar lo PROPUESTO que se
// decide en otro apartado (lib/diario, delLibroDiario), con la misma vara en la
// lista, «Para revisar», las cifras, «Lo que he hecho yo», el número del menú y
// el cierre (regla 31).
//
// La población real (Foodint, 22/10/2026, leída con account_id —regla 9—):
//   select status, source_type, count(*) from journal_entry
//    where account_id = '51ad1792-…' and company_id = '658728c0-…' and status in ('propuesto','borrador')
//   → propuesto · bank · 25. Nada más.
// Y de esos 25, con su movimiento: bank_movement.status = 'casado' los 25
// (del 01/10 al 14/10), cada uno con su bank_match vivo. Julio (22/10): se
// validan en Bancos › Movimientos › «Por validar» (lib/validarBanco.ts), así
// que «bank» propuesto también sale de Asientos: ya tiene sitio.
// Facturas recibidas propuestas no hay hoy en la base: ese caso va con
// ejemplos, y se dice.

import { describe, expect, it } from 'vitest'
import {
  cifras, delLibroDiario, filtrar, filtrosVisibles, loQueHeHechoYo, pasosCierre, seDecideEnSuSitio, sePuedeCerrar, sinValidarPorSitio,
  type ApunteDiario, type AsientoDiario, type FuenteCierre,
} from '@/modules/conta/lib/diario'
import { paraRevisar } from '@/modules/conta/libro/paraRevisar'
import { chipsDelInicio } from '@/modules/conta/marco/nuevo/teTocaHoy'
import { rutaDocumentos } from '@/config/navegacion'

function apunte(p: Partial<ApunteDiario>): ApunteDiario {
  return {
    posicion: 1, cuentaId: 'c', cuenta: '57200001', nombreCuenta: 'Banco', tituloOficial: null, debe: 0, haber: 0, concepto: null, localId: null, local: null,
    comun: true, marcaId: null, marca: null, cedida: false, documento: null, iva: null, retencion: null, negativoEnDiez: null, ...p,
  }
}
function asiento(p: Partial<AsientoDiario>): AsientoDiario {
  return {
    id: 'a', serie: 3, numero: null, fecha: '2026-10-05', concepto: 'Movimiento', origen: 'bank', origenId: 'm', estado: 'propuesto',
    confianza: 'probable', porque: null, razones: [], documento: null, terceroId: null, creadoPor: 'Folvy', creadoEn: '2026-10-06T01:00:00Z',
    validadoPor: null, validadoEn: null, anuladoPor: null, anuladoEn: null, motivoAnulacion: null, anuladoCon: null, anulaA: null, traido: null,
    huella: null, huellaAnterior: null, cadena: null,
    apuntes: [apunte({ cuenta: '62900000', nombreCuenta: 'Otros gastos', debe: 10 }), apunte({ haber: 10 })],
    ...p,
  }
}

// Los 25 de la base: propuestos del banco, del 1 al 14 de octubre.
const BANCO_REAL = Array.from({ length: 25 }, (_, i) =>
  asiento({ id: `bank-${i + 1}`, fecha: `2026-10-${String(1 + (i % 14)).padStart(2, '0')}`, creadoEn: `2026-10-15T0${i % 10}:00:00Z` }))
const sinEspera = () => null

describe('la población real: los 25 propuestos del banco se deciden en Bancos › Movimientos', () => {
  it('los 25 tienen su sitio («bancos») y ninguno se queda en Asientos', () => {
    expect(BANCO_REAL.every((a) => seDecideEnSuSitio(a) === 'bancos')).toBe(true)
    expect(delLibroDiario(BANCO_REAL)).toHaveLength(0)
  })
  it('«Para revisar», su vista y las cifras dicen 0, los tres (no se cuentan dos veces)', () => {
    expect(paraRevisar(BANCO_REAL, sinEspera)).toHaveLength(0)
    expect(filtrosVisibles(delLibroDiario(BANCO_REAL)).find((f) => f.id === 'revisar')?.n).toBe(0)
    expect(cifras(delLibroDiario(BANCO_REAL), '2026-10-01', [], null).revisar).toBe(0)
  })
  it('validado, el del banco sí sale en Asientos y en su vista «Banco»: es el libro diario', () => {
    const validados = BANCO_REAL.map((a, i) => ({ ...a, estado: 'validado' as const, numero: 100 + i, validadoPor: 'Ana', validadoEn: '2026-10-22T10:00:00Z' }))
    expect(filtrar(delLibroDiario(validados), 'banco')).toHaveLength(25)
  })
})

describe('la factura recibida propuesta se decide en Compras y gastos (ejemplos: hoy no hay ninguna en la base)', () => {
  const libro = [
    ...BANCO_REAL.slice(0, 3),
    asiento({ id: 'fra-prop', origen: 'supplier_invoice', serie: 2, concepto: 'Factura 24048027 · EUROPASTRY' }),
    asiento({ id: 'fra-val', origen: 'supplier_invoice', serie: 2, estado: 'validado', numero: 7, validadoPor: 'Ana', validadoEn: '2026-10-07T10:00:00Z' }),
    asiento({ id: 'fra-anul', origen: 'supplier_invoice', serie: 2, estado: 'anulado', numero: 8, validadoPor: 'Ana' }),
    asiento({ id: 'pago-prop', origen: 'supplier_payment', serie: 3 }),
    asiento({ id: 'accrual-prop', origen: 'purchase_accrual', serie: 2 }),
    asiento({ id: 'borr', origen: 'manual', serie: 4, estado: 'borrador' }),
  ]
  const delLibro = delLibroDiario(libro)

  it('propuesta: fuera de la lista, de «Compras», de «Para revisar» y de «Lo que he hecho yo»', () => {
    expect(seDecideEnSuSitio(libro[3])).toBe('recibidas')
    expect(delLibro.map((a) => a.id)).not.toContain('fra-prop')
    expect(filtrar(delLibro, 'compras').map((a) => a.id).sort()).toEqual(['accrual-prop', 'fra-anul', 'fra-val', 'pago-prop'])
    expect(paraRevisar(libro, sinEspera).map((a) => a.id)).not.toContain('fra-prop')
    expect(loQueHeHechoYo(delLibro, 50).map((h) => h.asientoId)).not.toContain('fra-prop')
  })
  it('validada o anulada, sí sale: es el libro diario', () => {
    expect(delLibro.map((a) => a.id)).toEqual(expect.arrayContaining(['fra-val', 'fra-anul']))
  })
  it('el pago y el recibido sin factura se quedan: ninguna pantalla de Compras los valida', () => {
    expect(paraRevisar(libro, sinEspera).map((a) => a.id)).toEqual(expect.arrayContaining(['pago-prop', 'accrual-prop', 'borr']))
  })
  it('el número del menú y la lista, con la misma vara (las filas que lee el menú: id, estado y origen)', () => {
    const filasMenu = libro.filter((a) => a.estado === 'propuesto' || a.estado === 'borrador').map((a) => ({ id: a.id, estado: a.estado, origen: a.origen }))
    const espera = (a: { id: string }) => (a.id === 'bank-2' ? 'El mes está cerrado.' : null)
    const menu = delLibroDiario(filasMenu).filter((a) => !espera(a)).length
    expect(menu).toBe(paraRevisar(libro, espera).length)
    expect(menu).toBe(3) // el pago, el recibido sin factura y el borrador (los del banco, en Bancos)
  })
})

describe('el cierre: lo que espera en su sitio frena, y dice dónde', () => {
  const libro = [asiento({ id: 'fra', origen: 'supplier_invoice', fecha: '2026-09-20' }), asiento({ id: 'b', fecha: '2026-09-21' }), asiento({ id: 'otro-mes', origen: 'supplier_invoice' })]
  const sep = sinValidarPorSitio(libro, '2026-09-01')
  it('separa lo de Asientos de lo de Compras y de Bancos, del mes', () => {
    expect(sep).toEqual({ enAsientos: 0, enSuSitio: [{ sitio: 'recibidas', n: 1 }, { sitio: 'bancos', n: 1 }] })
  })
  const fuente: FuenteCierre = { diasVenta: null, facturas: null, liquidaciones: null, socios: null, nominas: null, pendientes: sep.enAsientos, enSuSitio: sep.enSuSitio, cerrado: false }
  it('un paso propio con el apartado, y no se puede cerrar hasta decidirlo', () => {
    const pasos = pasosCierre(fuente)
    expect(pasos.map((p) => p.texto)).toEqual([
      '1 asiento propuesto espera en Compras y gastos › Facturas recibidas',
      '1 asiento propuesto espera en Bancos › Movimientos › Por validar',
      'Nada esperando revisión',
      'Cerrar el mes',
    ])
    expect(sePuedeCerrar(pasos).puede).toBe(false)
  })
  it('cerrado, «sin validar dentro» suma los dos', () => {
    expect(pasosCierre({ ...fuente, cerrado: true }).at(-1)?.texto).toBe('Mes cerrado, pero con 2 asientos sin validar dentro')
  })
  it('sin enSuSitio (el Inicio, de momento), como antes', () => {
    expect(pasosCierre({ ...fuente, enSuSitio: undefined, pendientes: 2 }).map((p) => p.texto)).toEqual(['2 asientos esperan revisión', 'Cerrar el mes'])
  })
})

describe('«Te toca hoy»: las recibidas llevan a Compras y gastos, no a Asientos', () => {
  it('el chip de recibidas va a Facturas recibidas › Por revisar', () => {
    expect(chipsDelInicio({ recibidas: 3 }).find((c) => c.id === 'recibidas')?.ruta).toBe(rutaDocumentos('por-revisar'))
  })
})
