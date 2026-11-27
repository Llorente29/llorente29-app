// src/modules/conta/gestoria/q10/calculos.ts
//
// X35 (27/11) · Lo que «Facturas del mes» calculaba dentro de su página, sacado aquí, tal cual, para que el Inicio de
// «Clientes y cuotas» («El mes de un vistazo») dé las MISMAS cifras: el mismo cálculo, no uno parecido.
//   · codigosDelMes: el código de Cegid de cada ficha con un cobro del mes (y las que no lo tienen).
//   · cobrosParaMandar: cada cobro del mes de GoCardless con su ficha y su código (lo que recibe planMandar y el cuadre).
//   · planesDelBanco: el plan de cada cobro del banco o con tarjeta (lo que recibe cuadreVias).
// Puras: sin base ni pantalla.

import { esCobroDeCliente, planCobro, type CobroBanco, type PlanCobro } from '../../../../../supabase/functions/_shared/cegidBanco'
import { proponerAtado, type CobroParaMandar } from '../../../../../supabase/functions/_shared/cegidMandar'
import type { leerFacturasDelMes } from './datos'
import type { leerGuardadoCegid } from '@/modules/conta/services/cegidService'
import type { MesQ10 } from './facturasDelMes'
import { codigosCegid } from './equivalencias'

export type DatosQ10 = Awaited<ReturnType<typeof leerFacturasDelMes>>
export type GuardadoCegid = Awaited<ReturnType<typeof leerGuardadoCegid>>

/** Las incidencias que cuentan como mandadas (las mismas tres en el plan, en el cuadre y en «Lo cobrado por el banco»). */
export const VIVAS = ['mandando', 'mandada', 'facturada'] as const

/** El código de Cegid de las fichas con algún cobro cobrado este mes (las que se facturan), y las que no lo tienen. */
export function codigosDelMes(d: DatosQ10, base: MesQ10, cg: GuardadoCegid, atadosAhora: ReadonlyMap<string, number> = new Map()) {
  const conCobro = new Map([...base.facturas.map((f) => f.ficha), ...base.pendientes.map((p) => p.ficha).filter((f): f is NonNullable<typeof f> => !!f)].map((f) => [f.partyId, f]))
  const fichas = [...conCobro.values()].map((f) => ({ partyId: f.partyId, nif: f.nif, cuenta430: d.cuentas.get(f.partyId) ?? null, codigo: atadosAhora.get(f.partyId) ?? d.codigoCliente.get(f.partyId) ?? null }))
  const codigos = codigosCegid(fichas, cg.clientes)
  // Respuesta 4 · Cada ficha sin código, con lo que se le propone de Cegid: por su correo de GoCardless o por su nombre.
  const atables = cg.clientes.map((c) => ({ codigo: c.codigo, nombre: c.nombre, nif: c.nif, email: c.email ?? null }))
  const sinCodigo = [...codigos].filter(([, c]) => c.codigo === null).map(([partyId, c]) => ({ partyId, nombre: conCobro.get(partyId)?.nombre ?? '', nif: conCobro.get(partyId)?.nif ?? null,
    cuenta430: d.cuentas.get(partyId) ?? null, porque: c.porque,
    propuestas: proponerAtado(conCobro.get(partyId)?.nombre ?? null, d.correos.get(partyId) ?? [], atables) })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
  return { codigos, sinCodigo }
}

/** Paso 2 · Cada cobro del mes con su ficha y su código de Cegid: el plan decide qué sale. */
export function cobrosParaMandar(d: DatosQ10, base: MesQ10, codigos: ReturnType<typeof codigosDelMes>['codigos'], mes: string,
  elegidosAhora: ReadonlyMap<string, string> = new Map()): CobroParaMandar[] {
  const sus = new Map(d.suscripciones.map((s) => [s.gcId, s]))
  const fichaDe = new Map([...base.facturas.map((f) => [f.cobro.gcId, f.ficha] as const), ...base.pendientes.filter((p) => p.ficha).map((p) => [p.cobro.gcId, p.ficha!] as const),
    ...base.sinFactura.filter((x) => x.ficha).map((x) => [x.cobro.gcId, x.ficha!] as const)])
  return d.cobros.filter((c) => c.fecha.slice(0, 7) === mes).map((c) => {
    const f = fichaDe.get(c.gcId) ?? null
    return { gcId: c.gcId, estado: c.estado, fecha: c.fecha, importe: c.importe, concepto: (c.suscripcionId ? sus.get(c.suscripcionId)?.nombre : null) ?? null,
      suscripcionId: c.suscripcionId, descripcion: c.descripcion,
      elegido: (c.suscripcionId ? elegidosAhora.get(`suscripcion:${c.suscripcionId}`) ?? d.elegidos.get(`suscripcion:${c.suscripcionId}`)
        : elegidosAhora.get(`cobro:${c.gcId}`) ?? d.elegidos.get(`cobro:${c.gcId}`)) ?? null,
      partyId: f?.partyId ?? null, nombre: f?.nombre ?? null, codigoCegid: f ? codigos.get(f.partyId)?.codigo ?? null : null }
  })
}

/** Respuesta 7 · El plan de cada cobro del banco o con tarjeta que es de un cliente (lo que no es un cobro, fuera). */
export function planesDelBanco(mes: string, cobros: readonly CobroBanco[], facturados: Readonly<Record<string, readonly string[]>>,
  mandadas: readonly { estado: string; gcCobroId: string }[]): PlanCobro[] {
  const vivas = new Set(mandadas.filter((m) => (VIVAS as readonly string[]).includes(m.estado)).map((m) => m.gcCobroId))
  return cobros.filter((c) => esCobroDeCliente(c.via)).map((c) => planCobro(mes, c, (cli, m) => (facturados[String(cli)] ?? []).includes(m), vivas))
}
