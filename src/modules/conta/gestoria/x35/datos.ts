// src/modules/conta/gestoria/x35/datos.ts
//
// X35 · Lo que lee «El mes de un vistazo», y cómo lo arma: SOLO LEE, y lo mismo que ya leen «Facturas del mes» (Q10) y
// «Clientes y cuotas» (G04 y R20), con sus mismas funciones (q10/calculos.ts, g04/modelo.ts). Sin tablas nuevas.
//   · Del mes: los cobros de GoCardless (leerFacturasDelMes), lo leído de Cegid (leerGuardadoCegid), lo mandado a Cegid
//     (leerMandadoCegid) y lo cobrado por el banco y con tarjeta (leerBancoCegid: el «banco_leer» de conta-cegid-mandar,
//     que solo lee). Con eso, el plan de mandar y el cuadre por vía, como en «Facturas del mes».
//   · De la cuenta: «Te deben» y el próximo cobro de GoCardless (leerClientes + modeloClientes de la G04).
// Lo que falla se dice y la pantalla sigue: una cifra que no se puede calcular no sale.

import { cuadreVias } from '../../../../../supabase/functions/_shared/cegidBanco'
import { cuotasSinHasta, planMandar } from '../../../../../supabase/functions/_shared/cegidMandar'
import { leerBancoCegid, leerGuardadoCegid, leerMandadoCegid, type IncidenciaMandada } from '@/modules/conta/services/cegidService'
import { leerFacturasDelMes } from '../q10/datos'
import { facturasDelMes } from '../q10/facturasDelMes'
import { retieneQ10 } from '../q10/serie'
import { codigosDelMes, cobrosParaMandar, planesDelBanco, VIVAS, type DatosQ10, type GuardadoCegid } from '../q10/calculos'
import { leerClientes } from '../g04/datos'
import { modeloClientes, type Empresa } from '../g04/modelo'
import type { EntradaMes } from './modelo'

export interface LoDelMes {
  d: DatosQ10
  cg: GuardadoCegid | null
  md: IncidenciaMandada[]
  banco: Awaited<ReturnType<typeof leerBancoCegid>> | null
  /** Lo que no se ha podido leer, en palabras. */
  fallos: string[]
}

const porque = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Lo del mes (no para el mes que viene: aún no tiene cobros). */
export async function leerLoDelMes(cuenta: string, empresa: string, mes: string): Promise<LoDelMes> {
  const fallos: string[] = []
  const [d, cg, md, banco] = await Promise.all([
    leerFacturasDelMes(cuenta, empresa, mes),
    leerGuardadoCegid(empresa, Number(mes.slice(0, 4))).catch((e: unknown) => { fallos.push(`lo leído de Cegid (${porque(e)})`); return null }),
    leerMandadoCegid(empresa, mes),
    leerBancoCegid(empresa, mes).catch((e: unknown) => { fallos.push(`lo cobrado por el banco (${porque(e)})`); return null }),
  ])
  return { d, cg, md, banco, fallos }
}

/** Lo de la cuenta («Te deben» y el próximo cobro), para la empresa elegida. */
export async function leerLoDeLaCuenta(cuenta: string, empresas: readonly Empresa[], empresa: string, hoy: string) {
  const d = await leerClientes(cuenta)
  return modeloClientes(d, empresas, [empresa], hoy).cifras
}

/** El plan y el cuadre de «Facturas del mes», con lo leído: lo mismo que su página (pagina.tsx y BancoCegidQ10.tsx). */
export function planYCuadre(l: LoDelMes, empresa: { id: string; nombre: string }, mes: string) {
  const base = facturasDelMes({ mes, empresa: { id: empresa.id, nombre: empresa.nombre, retiene: false }, cobros: l.d.cobros, suscripciones: l.d.suscripciones,
    mandatos: l.d.mandatos, enlaces: l.d.enlaces, fichas: l.d.fichas, retenciones: new Map(), cobroCliente: l.d.cobroCliente })
  if (!l.cg || !l.cg.clientes.length) return { plan: null, planes: null, cuadre: null, nombreCegid: new Map<number, string>() }
  const { codigos } = codigosDelMes(l.d, base, l.cg)
  const cobrosMes = cobrosParaMandar(l.d, base, codigos, mes)
  const vivos = new Set(l.md.filter((x) => (VIVAS as readonly string[]).includes(x.estado)).map((x) => x.gcCobroId))
  const plan = planMandar(mes, cobrosMes, vivos, cuotasSinHasta(l.cg.clientes, l.cg.revisados))
  const nombreCegid = new Map(l.cg.clientes.map((c) => [c.codigo, c.nombre ?? String(c.codigo)]))
  if (!l.banco) return { plan, planes: null, cuadre: null, nombreCegid }
  const planes = planesDelBanco(mes, l.banco.cobros, l.banco.facturados, l.md)
  const cuadre = cuadreVias(mes, cobrosMes, planes, l.md.filter((m) => (VIVAS as readonly string[]).includes(m.estado))
    .map((m) => ({ clave: m.gcCobroId, cliente: m.cliente, totalCent: Math.round(m.total * 100) })))
  return { plan, planes, cuadre, nombreCegid }
}

/** Todo junto: lo que recibe mesDeUnVistazo. */
export function entradaDelMes(mes: string, hoy: string, empresa: { id: string; nombre: string }, l: LoDelMes | null,
  cuenta: Awaited<ReturnType<typeof leerLoDeLaCuenta>> | null): { entrada: EntradaMes; retiene: boolean } {
  const pc = l ? planYCuadre(l, empresa, mes) : { plan: null, planes: null, cuadre: null, nombreCegid: new Map<number, string>() }
  const retiene = l ? retieneQ10(l.d.empresa.tax_id) : false
  return {
    retiene,
    entrada: {
      mes, hoy, cuadre: pc.cuadre,
      // La autónoma: Sumied no le manda nada a Cegid todavía (Q10, respuesta 3, punto 6): sin «Por facturar».
      plan: retiene ? null : pc.plan, planes: retiene ? null : pc.planes,
      mandadas: l ? l.md.filter((m) => (VIVAS as readonly string[]).includes(m.estado)).length : 0,
      noCobrado: cuenta?.noCobrado ?? null, cuotas: cuenta?.cuotas ?? null, nombreCegid: pc.nombreCegid,
    },
  }
}
