// tests/unit/modules/conta/x35/mesDeUnVistazo.test.ts
//
// X35 · «El mes de un vistazo»: cada cifra es la suma de su lista; «Cobrado» es el del cuadre de «Facturas del mes» (el
// mismo cuadreVias, con los mismos cobros), sin lo que no es un cobro; lo que no se puede calcular no sale. Y la página
// de «Facturas del mes» y el Inicio usan las MISMAS funciones (calculos.ts): si una deja de usarlas, en rojo.
// Datos inventados (T11).

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { cuadreVias, type CobroBanco, type PlanCobro } from '../../../../../supabase/functions/_shared/cegidBanco'
import { planMandar, type CobroParaMandar } from '../../../../../supabase/functions/_shared/cegidMandar'
import { lista, type CifrasDeCuotas, type NoCobrado } from '../../../../../supabase/functions/_shared/tarifa/cifras'
import { listaCobrado, mesDeUnVistazo, type EntradaMes } from '@/modules/conta/gestoria/x35/modelo'

const MES = '2026-11'
const gc = (gcId: string, importe: number, codigo: number | null, estado = 'paid_out', concepto: string | null = 'CUOTA GESTORIA'): CobroParaMandar => ({
  gcId, estado, fecha: '2026-11-04', importe, concepto, suscripcionId: `SB${gcId}`, descripcion: concepto, elegido: '00001',
  partyId: codigo === null ? null : `p${codigo}`, nombre: codigo === null ? null : `Cliente ${codigo}`, codigoCegid: codigo,
})
const banco = (clave: string, importe: number, estado: PlanCobro['estado'], cliente: number | null, noCobroCent = 0, tipo: 'banco' | 'tarjeta' = 'banco'): PlanCobro => ({
  cobro: { clave, tipo, movementId: `m-${clave}`, fecha: '2026-11-12', importe, via: tipo === 'tarjeta' ? 'tarjeta' : 'transferencia', estado: 'casado', texto: `Transferencia ${clave}`,
    codigo: cliente, recibos: [], decision: null } as unknown as CobroBanco,
  estado, cliente, lineas: [], porque: estado === 'para_julio' ? 'No paga ningún recibo' : '', pagaFacturaCent: 0, noCobroCent,
})
const COBROS = [gc('PM1', 60.5, 101), gc('PM2', 121, 102), gc('PM3', 84.7, null), gc('PM4', 50, 103, 'failed')]
const PLANES = [banco('b1', 200, 'listo', 104), banco('b2', 30, 'no_es_cobro', null, 3000), banco('b3', 45.5, 'para_julio', null)]
const CUADRE = cuadreVias(MES, COBROS, PLANES, [])
const PLAN = planMandar(MES, COBROS, new Set())

const NO_COBRADO = (cruzado: boolean): NoCobrado => {
  const l = lista('Te deben', [{ id: 'r1', texto: 'Cliente 7', detalle: 'Fallido', importeCent: 6050, fichaId: 'f7', fecha: '2026-06-04' },
    { id: 'r2', texto: 'Cliente 8', detalle: 'Devuelto', importeCent: 12100, fichaId: 'f8', fecha: '2026-11-04' }])
  return { titulo: cruzado ? 'Te deben' : 'GoCardless no cobró', cruzado, lista: l, recibos: 2, clientes: 2, desde: '2026-06-04',
    tramos: [{ texto: 'Hasta 30 días', lista: lista('', [l.filas[1]]) }, { texto: 'Más de 90 días', lista: lista('', [l.filas[0]]) }],
    conMandatoCancelado: lista('', []), pagadoPorElBanco: lista('', []), tarjetaSinAsignar: lista('Tarjeta', [{ id: 't1', texto: 'TPV', detalle: '', importeCent: 4235, fichaId: null }]),
    faltanPorCruzar: cruzado ? [] : ['Empresa B'] }
}
const entrada = (x: Partial<EntradaMes> = {}): EntradaMes => ({
  mes: MES, hoy: '2026-11-27', cuadre: CUADRE, plan: PLAN, planes: PLANES, mandadas: 3, noCobrado: NO_COBRADO(true), cuotas: null,
  nombreCegid: new Map([[101, 'Cliente 101'], [102, 'Cliente 102'], [104, 'Cliente 104']]), ...x,
})

describe('cada cifra es la suma de su lista', () => {
  it('Cobrado, Por facturar y Te deben', () => {
    const m = mesDeUnVistazo(entrada())
    expect(m.cifras.map((c) => c.id)).toEqual(['cobrado', 'porFacturar', 'teDeben'])
    for (const c of m.cifras) expect(c.lista.totalCent, c.id).toBe(c.lista.filas.reduce((s, f) => s + f.importeCent, 0))
    const porFacturar = m.cifras.find((c) => c.id === 'porFacturar')!
    expect(porFacturar.valor).toBe(String(porFacturar.lista.filas.length))
    for (const a of m.asuntos) if (a.cent !== null) expect(a.cent, a.id).toBe(a.lista.filas.reduce((s, f) => s + f.importeCent, 0))
  })
})

describe('Cobrado es el del cuadre de «Facturas del mes»', () => {
  it('el mismo cuadreVias, sin lo que no es un cobro', () => {
    const l = listaCobrado(CUADRE, MES)
    // GoCardless 60,50 + 121,00 + 84,70 (el fallido no) + banco 200,00 + 30,00 + 45,50, menos los 30,00 que no son un cobro.
    expect(CUADRE.total.cobradoCent).toBe(54170)
    expect(l.totalCent).toBe(CUADRE.total.cobradoCent - CUADRE.total.noCobroCent)
    expect(l.totalCent).toBe(51170)
    expect(mesDeUnVistazo(entrada()).cifras.find((c) => c.id === 'cobrado')!.valor).toBe('511,70 €')
  })
  it('la página de «Facturas del mes» y el Inicio usan las mismas funciones', () => {
    const pagina = readFileSync('src/modules/conta/gestoria/q10/pagina.tsx', 'utf8')
    const banco = readFileSync('src/modules/conta/gestoria/q10/BancoCegidQ10.tsx', 'utf8')
    const inicio = readFileSync('src/modules/conta/gestoria/x35/datos.ts', 'utf8')
    for (const f of ['codigosDelMes(', 'cobrosParaMandar(']) { expect(pagina).toContain(f); expect(inicio).toContain(f) }
    expect(banco).toContain('planesDelBanco(')
    expect(inicio).toContain('planesDelBanco(')
    expect(inicio).toContain('cuadreVias(')
  })
})

describe('lo que no se puede calcular no sale', () => {
  it('sin el cuadre, no hay Cobrado; sin el plan, no hay Por facturar; sin cruzar con el banco, no hay Te deben', () => {
    const m = mesDeUnVistazo(entrada({ cuadre: null, plan: null, planes: null, noCobrado: NO_COBRADO(false) }))
    expect(m.cifras).toEqual([])
    expect(m.faltan.length).toBe(3)
    expect(m.faltan[2]).toContain('Empresa B')
  })
  it('un mes anterior facturado fuera de Sumied no tiene «Por facturar»', () => {
    const m = mesDeUnVistazo(entrada({ mes: '2026-10', mandadas: 0 }))
    expect(m.cifras.map((c) => c.id)).toEqual(['cobrado', 'teDeben'])
    expect(m.frase).toBe('Se hizo en Cegid, antes de Sumied')
  })
  it('X35d · «Te deben» es lo del mes elegido: solo sus recibos sin cobrar', () => {
    const oct = mesDeUnVistazo(entrada({ mes: '2026-10' })).cifras.find((c) => c.id === 'teDeben')!
    const nov = mesDeUnVistazo(entrada()).cifras.find((c) => c.id === 'teDeben')!
    expect([oct.titulo, oct.lista.totalCent, nov.titulo, nov.lista.totalCent]).toEqual(['Te deben de octubre', 0, 'Te deben de noviembre', 12100])
  })
})

describe('«Lo que hay que resolver»', () => {
  it('primero lo que más dinero mueve, y «Mandar a Cegid» lleva a facturar', () => {
    const m = mesDeUnVistazo(entrada())
    const cents = m.asuntos.map((a) => a.cent ?? -1)
    expect([...cents].sort((a, b) => b - a)).toEqual(cents)
    const mandar = m.asuntos.find((a) => a.id === 'mandar')!
    expect(mandar.ir).toBe('facturar')
    // 60,50 (101) + 121,00 (102) de GoCardless + 200,00 del banco (104): el 103 falló y el PM3 no tiene cliente.
    expect(mandar.lista.totalCent).toBe(38150)
    expect(m.asuntos.find((a) => a.id === 'decidir')!.lista.totalCent).toBe(4550)
    expect(m.asuntos.find((a) => a.id === 'reclamar')!.lista.totalCent).toBe(12100)
  })
})

describe('el mes que viene', () => {
  it('lo que va a cobrar GoCardless, sus altas y sus bajas', () => {
    const cuotas = { mes: '2026-12', gocardless: { lista: lista('GoCardless', [{ id: 's1', texto: 'A', detalle: '', importeCent: 6050, fichaId: null }]), cobros: 1, porDia: [] },
      sumied: { lista: lista('', []), clientes: 0 }, diferencia: { cent: 0, grupos: [] }, altas: lista('Altas', []), bajas: lista('Bajas', []), porFicha: new Map() } as unknown as CifrasDeCuotas
    const m = mesDeUnVistazo(entrada({ mes: '2026-12', cuotas }))
    expect(m.cifras.map((c) => [c.id, c.valor])).toEqual([['seVaACobrar', '60,50 €'], ['altas', '0'], ['bajas', '0']])
    expect(m.pasos[0]).toEqual({ nombre: 'Revisar el cobro', estado: 'hecho' })
  })
})
