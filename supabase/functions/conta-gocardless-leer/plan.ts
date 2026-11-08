// supabase/functions/conta-gocardless-leer/plan.ts
//
// G01 · Tarea 3 (06/11/2026). Lo que hace una lectura de GoCardless, sin red
// ni base: con lo leído (lectura.ts) y lo que ya hay en Sumied, QUÉ se
// escribe. index.ts solo lo escribe. Puro: lo prueban las unitarias con
// respuestas grabadas e inventadas (lecturaGocardless.test.ts).
//
//   planLectura: lo leído tal cual (con su huella: nuevos, cambiados,
//     iguales), el casado con Bitrix24 de toda la cuenta, la forma de cobro
//     de cada cliente casado, sus mandatos y la importación, UNA vez, de lo
//     activo que aún no se importó.
//   planDiferencias: lo que no cuadra, con su porqué como dato.

import { abonoContraTesoreria, alMesCent, COBRO_FALLIDO, MANDATO_POR_FIRMAR, MANDATO_VIVO, type CuentaAbonoGc } from './lector.ts'
import { casar, type ClienteParaCasar, type Diferencia, type FichaParaCasar, type Pareja } from './casado.ts'
import { convertir, type LineaImportada, type NoConvertida, type ServicioImportado, type TarifaImportada } from './conversion.ts'
import { comparar, euros, type Linea, type Tarifa } from './comparacion.ts'
import type { DatosGc } from './lectura.ts'
import { deRef } from '../_shared/crm/ficha.ts'

/** G01c · Las columnas de la ficha del CRM de una diferencia (de la referencia «crm|tipo|id» del casado). */
const SIN_FICHA = { crm: null, tipo_ficha: null, id_externo: null } as const
const fichaDe = (ref: string | null) => (ref ? (({ crm, tipoFicha, idExterno }) => ({ crm, tipo_ficha: tipoFicha, id_externo: idExterno }))(deRef(ref)) : SIN_FICHA)

// G01c · Los tipos del casado, neutros (los de antes los migró a estos el PR B).
export const TIPOS_DEL_CASADO = ['crm_sin_cobro', 'gocardless_sin_ficha', 'emisor_distinto', 'nif_repetido_en_crm', 'correo_repetido_en_crm', 'nif_distinto']

export const mesDe = (fecha: string | null | undefined, hoy: string): string => (fecha ?? hoy).slice(0, 7)
export const aEuros = (cent: number | null) => (cent === null ? null : Math.round(cent) / 100)

/** Lo que ya hay en Sumied y la lectura necesita. */
export interface Antes {
  /** La huella de cada cliente de esta cuenta de GoCardless, de la lectura anterior. */
  huellas: Map<string, string | null>
  /** Las fichas de Bitrix24 de la cuenta, con su cliente de Sumied. */
  fichas: (FichaParaCasar & { partyId: string })[]
  /** Los clientes de las OTRAS cuentas de GoCardless de la cuenta (para el casado de toda la cuenta). */
  otrosEmisores: ClienteParaCasar[]
  /** La forma de cobro que ya tiene cada cliente con este emisor (no se pisa). */
  formaAntes: Map<string, string | null>
  /** ¿GoCardless es la forma de cobro por defecto de este emisor? */
  porDefecto: boolean
  /** Las suscripciones ya importadas (se importan UNA vez). */
  importadas: Set<string>
  /** Las tarifas propias que ya hay: «cliente|clave del servicio». */
  tarifasPropias: Set<string>
  /** G01 · 4b · Lo que una persona enlazó en la ficha: cliente de GoCardless → cliente de Sumied (manda sobre el casado). */
  enlaces?: Map<string, string>
}

export interface PlanLectura {
  filas: {
    clientes: Record<string, unknown>[]
    mandatos: Record<string, unknown>[]
    suscripciones: Record<string, unknown>[]
    cobros: Record<string, unknown>[]
  }
  nuevos: number
  cambiados: number
  iguales: number
  parejas: Pareja[]
  diferenciasDelCasado: Diferencia[]
  /** El cliente de Sumied de cada cliente de esta cuenta de GoCardless casado. */
  partyDeCliente: Map<string, string>
  /** El cliente de Sumied de cada ficha de Bitrix24. */
  partyDeFicha: Map<string, string>
  cobroCliente: Record<string, unknown>[]
  mandatosSumied: { gcMandatoId: string; fila: Record<string, unknown> }[]
  servicios: ServicioImportado[]
  tarifas: (TarifaImportada & { partyId: string; desde: string })[]
  lineas: (LineaImportada & { partyId: string; desdeMes: string; nombreSuscripcion: string })[]
  noConvertidas: (NoConvertida & { partyId: string | null; importeCent: number | null })[]
  resumen: { mandatosVivos: number; lineasActivas: number; alMesCent: number; abono: CuentaAbonoGc | null
    /** G01b · Clientes de Sumied con más de un cliente en esta cuenta de GoCardless (para la forma de cobro se usa uno). */
    clientesConVariosEnGc: number
    /** G01c (Julio, 07/11) · Suscripciones activas que siguen sin línea porque su cliente de GoCardless no está casado con ningún cliente de Sumied. */
    sinCasar: number }
}

export function planLectura(empresa: string, cuenta: string, datos: DatosGc, antes: Antes, hoy: string, nombreEmisor: (id: string) => string): PlanLectura {
  const ahora = `${hoy}T00:00:00Z`
  const clienteDeMandato = new Map(datos.mandatos.filter((m) => m.clienteId).map((m) => [m.id, m.clienteId!]))
  const vivosDe = new Map<string, number>()
  const activasDe = new Map<string, number>()
  for (const m of datos.mandatos) if (m.clienteId && MANDATO_VIVO.includes(m.estado)) vivosDe.set(m.clienteId, (vivosDe.get(m.clienteId) ?? 0) + 1)
  const activas = datos.suscripciones.filter((x) => x.estado === 'active')
  for (const x of activas) { const c = x.mandatoId ? clienteDeMandato.get(x.mandatoId) : undefined; if (c) activasDe.set(c, (activasDe.get(c) ?? 0) + 1) }

  // 1 · Lo leído, tal cual, con la huella de cada cliente.
  let nuevos = 0, cambiados = 0, iguales = 0
  const clientes = datos.clientes.map((c) => {
    const huella = JSON.stringify([c.nombre, c.correo, c.nif, vivosDe.get(c.id) ?? 0, activasDe.get(c.id) ?? 0])
    const h0 = antes.huellas.get(c.id)
    if (h0 === undefined) nuevos++; else if (h0 !== huella) cambiados++; else iguales++
    return { company_id: empresa, gc_id: c.id, account_id: cuenta, nombre: c.nombre, correo: c.correo, nif: c.nif,
      mandatos_vivos: vivosDe.get(c.id) ?? 0, suscripciones_activas: activasDe.get(c.id) ?? 0, huella, leido_at: ahora }
  })
  const mandatos = datos.mandatos.map((m) => ({ company_id: empresa, gc_id: m.id, account_id: cuenta, gc_cliente_id: m.clienteId,
    estado: m.estado, referencia: m.referencia, esquema: m.esquema, creado: m.creado, leido_at: ahora }))
  const suscripciones = datos.suscripciones.map((x) => ({ company_id: empresa, gc_id: x.id, account_id: cuenta,
    gc_cliente_id: x.mandatoId ? clienteDeMandato.get(x.mandatoId) ?? null : null, mandato_gc_id: x.mandatoId, nombre: x.nombre,
    importe: aEuros(x.importeCent), moneda: x.moneda, intervalo: x.intervalo, cada: x.cada, estado: x.estado, al_mes: aEuros(alMesCent(x)),
    inicio: x.inicio, fin: x.fin, leido_at: ahora }))
  const cobros = datos.cobros.map((p) => ({ company_id: empresa, gc_id: p.id, account_id: cuenta, mandato_gc_id: p.mandatoId,
    suscripcion_gc_id: p.suscripcionId, estado: p.estado, fecha: p.fecha, importe: aEuros(p.importeCent), moneda: p.moneda, motivo: p.motivo, leido_at: ahora }))

  // 2 · El casado, de toda la cuenta: esta cuenta de GoCardless (recién leída) y las otras (de la base).
  const deEsta: ClienteParaCasar[] = datos.clientes.map((c) => ({ emisor: empresa, id: c.id, nombre: c.nombre, nif: c.nif, correo: c.correo,
    mandatosVivos: vivosDe.get(c.id) ?? 0, suscripcionesActivas: activasDe.get(c.id) ?? 0 }))
  const casado = casar(antes.fichas, [...deEsta, ...antes.otrosEmisores.filter((c) => c.emisor !== empresa)], nombreEmisor)
  const partyDeFicha = new Map(antes.fichas.map((f) => [f.claveFicha, f.partyId]))
  const partyDeCliente = new Map<string, string>()
  const porDe = new Map<string, Pareja['por'] | 'persona'>()
  for (const p of casado.parejas.filter((x) => x.emisor === empresa)) {
    const party = partyDeFicha.get(p.claveFicha)
    if (party) { partyDeCliente.set(p.clienteGcId, party); porDe.set(p.clienteGcId, p.por) }
  }
  // Lo enlazado a mano en la ficha manda: ese cliente ya no sale «sin ficha».
  const enlaces = antes.enlaces ?? new Map<string, string>()
  for (const [gc, party] of enlaces) if (deEsta.some((c) => c.id === gc)) { partyDeCliente.set(gc, party); porDe.set(gc, 'persona') }
  casado.diferencias = casado.diferencias.filter((d) => !(d.tipo === 'gocardless_sin_ficha' && d.clienteGcId && enlaces.has(d.clienteGcId)))
  for (const f of clientes) {
    const party = partyDeCliente.get(String(f.gc_id))
    Object.assign(f, { party_id: party ?? null, casado_por: party ? porDe.get(String(f.gc_id)) : null })
  }
  // G01b (07/11) · Un cliente de Sumied, UNA fila en conta_cobro_cliente (clave company_id, party_id): si casan con él
  // dos o más clientes de esta cuenta de GoCardless, la tanda los llevaba todos y la base la rechazaba entera
  // («ON CONFLICT DO UPDATE command cannot affect row a second time»). Se queda uno: el enlazado a mano; si no, el
  // de más mandatos activos; después, el de más suscripciones activas; y si empatan, el de id más bajo. Lo dice la frase.
  const elegido = new Map<string, string>()
  const mejor = (a: string, b: string) => {
    const k = (g: string) => [porDe.get(g) === 'persona' ? 1 : 0, vivosDe.get(g) ?? 0, activasDe.get(g) ?? 0]
    const [ka, kb] = [k(a), k(b)]
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] > kb[i] ? a : b
    return a < b ? a : b
  }
  const cuantosGc = new Map<string, number>()
  for (const [gc, party] of partyDeCliente) {
    cuantosGc.set(party, (cuantosGc.get(party) ?? 0) + 1)
    const ya = elegido.get(party)
    elegido.set(party, ya ? mejor(ya, gc) : gc)
  }
  const clientesConVariosEnGc = [...cuantosGc.values()].filter((n) => n > 1).length
  const cobroCliente = [...elegido].map(([party, gc]) => ({
    company_id: empresa, party_id: party, account_id: cuenta, gc_cliente_id: gc, gc_casado_por: porDe.get(gc),
    forma_cobro: antes.formaAntes.get(party) ?? (antes.porDefecto ? 'gocardless' : null), updated_at: ahora, updated_by_name: 'GoCardless' }))

  // 3 · Los mandatos de los casados, también en conta_mandato.
  const mandatosSumied = datos.mandatos.flatMap((m) => {
    const party = m.clienteId ? partyDeCliente.get(m.clienteId) : undefined
    if (!party) return []
    const status = MANDATO_VIVO.includes(m.estado) ? 'firmado' : MANDATO_POR_FIRMAR.includes(m.estado) ? 'por_firmar' : 'anulado'
    return [{ gcMandatoId: m.id, fila: { account_id: cuenta, company_id: empresa, party_id: party, ref: m.referencia ?? m.id, status, origen: 'gocardless',
      gc_mandato_id: m.id, gc_estado: m.estado, signed_at: status === 'firmado' ? m.creado : null, created_by_name: 'GoCardless' } }]
  })

  // 4 · La importación, UNA vez: lo activo de los casados que aún no se importó.
  const porImportar = activas.filter((x) => !antes.importadas.has(x.id) && x.mandatoId && partyDeCliente.has(clienteDeMandato.get(x.mandatoId) ?? ''))
  const conv = convertir(empresa, porImportar, clienteDeMandato)
  const lineas = conv.lineas.map((l) => ({ ...l, partyId: partyDeCliente.get(l.clienteGcId)!, desdeMes: mesDe(l.desde, hoy),
    nombreSuscripcion: porImportar.find((x) => x.id === l.suscripcionId)?.nombre ?? '' }))
  const tarifas = conv.tarifas.flatMap((t) => {
    const partyId = partyDeCliente.get(t.clienteGcId)
    if (!partyId || antes.tarifasPropias.has(`${partyId}|${t.servicio}`)) return []
    const desde = lineas.filter((l) => l.clienteGcId === t.clienteGcId && l.servicio === t.servicio).map((l) => l.desdeMes).sort()[0] ?? mesDe(null, hoy)
    return [{ ...t, partyId, desde }]
  })
  const noConvertidas = conv.noConvertidas.map((n) => ({ ...n, partyId: n.clienteGcId ? partyDeCliente.get(n.clienteGcId) ?? null : null,
    importeCent: porImportar.find((x) => x.id === n.suscripcionId)?.importeCent ?? null }))

  return {
    filas: { clientes, mandatos, suscripciones, cobros }, nuevos, cambiados, iguales,
    parejas: casado.parejas, diferenciasDelCasado: casado.diferencias, partyDeCliente, partyDeFicha, cobroCliente, mandatosSumied,
    servicios: conv.servicios, tarifas, lineas, noConvertidas,
    resumen: {
      // «Mandatos activos», como los cuenta GoCardless (status active). El casado usa todos los vivos (también los que van camino del banco).
      mandatosVivos: datos.mandatos.filter((m) => m.estado === 'active').length,
      lineasActivas: activas.length,
      alMesCent: activas.filter((x) => x.moneda === 'EUR').reduce((t, x) => t + (alMesCent(x) ?? 0), 0),
      abono: datos.abonos[0] ?? null,
      clientesConVariosEnGc,
      sinCasar: activas.filter((x) => !antes.importadas.has(x.id) && !porImportar.includes(x)).length,
    },
  }
}

export interface DiferenciaAEscribir {
  tipo: string
  porque_codigo: string
  porque: string
  company_id: string | null
  party_id: string | null
  /** G01c · La ficha del CRM (crm, tipo de ficha e id externo), si la diferencia es de una. */
  crm: string | null
  tipo_ficha: 'empresa' | 'contacto' | null
  id_externo: string | null
  gc_cliente_id: string | null
  datos: Record<string, unknown>
}

/** Lo que no cuadra en esta lectura, con su porqué como dato. Las líneas y tarifas, ya como están en Sumied después de importar. */
export function planDiferencias(
  empresa: string, datos: DatosGc, plan: PlanLectura, hoy: string,
  sinConvertir: { suscripcion: string; gcCliente: string | null; partyId: string | null; nombre: string; codigo: string; porque: string }[],
  lineasDe: (partyId: string) => Linea[], tarifas: Tarifa[], tesoreria: { id: string; nombre: string; iban: string | null }[],
): { diferencias: DiferenciaAEscribir[]; abono: ReturnType<typeof abonoContraTesoreria> } {
  const clienteDeMandato = new Map(datos.mandatos.filter((m) => m.clienteId).map((m) => [m.id, m.clienteId!]))
  const activas = datos.suscripciones.filter((x) => x.estado === 'active')
  const out: DiferenciaAEscribir[] = plan.diferenciasDelCasado.map((d) => ({ tipo: d.tipo, porque_codigo: d.tipo, porque: d.porque, company_id: d.emisor,
    party_id: d.claveFicha ? plan.partyDeFicha.get(d.claveFicha) ?? null : null, ...fichaDe(d.claveFicha), gc_cliente_id: d.clienteGcId,
    datos: { emisor: d.emisor, ficha: d.claveFicha ? deRef(d.claveFicha).idExterno : null, gocardless: d.clienteGcId } }))
  for (const n of sinConvertir) {
    if (!activas.some((x) => x.id === n.suscripcion)) continue
    out.push({ tipo: 'suscripcion_sin_convertir', porque_codigo: n.codigo, porque: `«${n.nombre}»: ${n.porque}`, company_id: empresa, party_id: n.partyId,
      ...SIN_FICHA, gc_cliente_id: n.gcCliente, datos: { suscripcion: n.suscripcion } })
  }
  for (const m of datos.mandatos.filter((x) => MANDATO_POR_FIRMAR.includes(x.estado) && x.clienteId)) {
    out.push({ tipo: 'mandato_por_firmar', porque_codigo: m.estado, porque: `El mandato ${m.referencia ?? m.id} está pendiente de la firma del cliente.`,
      company_id: empresa, party_id: plan.partyDeCliente.get(m.clienteId!) ?? null, ...SIN_FICHA, gc_cliente_id: m.clienteId, datos: { mandato: m.id } })
  }
  const fallidos = new Map<string, number>()
  for (const p of datos.cobros) { const c = p.mandatoId ? clienteDeMandato.get(p.mandatoId) : undefined; if (c && COBRO_FALLIDO.includes(p.estado)) fallidos.set(c, (fallidos.get(c) ?? 0) + 1) }
  for (const [c, n] of fallidos) if (n >= 3) {
    out.push({ tipo: 'falla_a_menudo', porque_codigo: 'tres_o_mas_fallos', porque: `${n} cobros fallidos en los últimos 6 meses.`, company_id: empresa,
      party_id: plan.partyDeCliente.get(c) ?? null, ...SIN_FICHA, gc_cliente_id: c, datos: { fallidos: n, desde: datos.desde } })
  }
  const mes = hoy.slice(0, 7)
  for (const [gc, party] of plan.partyDeCliente) {
    // Solo lo que ya cobra este mes: en GoCardless «start_date» es el primer cobro (una recién creada empieza el mes que viene).
    const gcActivas = activas.filter((x) => x.mandatoId && clienteDeMandato.get(x.mandatoId) === gc && x.moneda === 'EUR' && (x.inicio ?? hoy).slice(0, 7) <= mes)
      .map((x) => ({ id: x.id, emisor: empresa, nombre: x.nombre, alMesCent: alMesCent(x) ?? 0 }))
    const r = comparar(party, mes, lineasDe(party), tarifas, gcActivas)
    if (r.diferenciaCent !== 0) {
      out.push({ tipo: 'totales_distintos', porque_codigo: r.diferenciaCent > 0 ? 'sumied_mas' : 'gocardless_mas',
        porque: `Sumied ${euros(r.sumiedCent)} y GoCardless ${euros(r.gocardlessCent)} al mes. ${r.explicaciones.join(' ')}`.trim(), company_id: empresa,
        party_id: party, ...SIN_FICHA, gc_cliente_id: gc, datos: { mes, sumied: aEuros(r.sumiedCent), gocardless: aEuros(r.gocardlessCent), explicaciones: r.explicaciones } })
    }
  }
  const abono = plan.resumen.abono
  const casaAbono = abono ? abonoContraTesoreria(abono, tesoreria) : { coincide: false as const, porque: 'GoCardless no tiene ninguna cuenta de abono activa.' }
  if (!casaAbono.coincide) out.push({ tipo: 'abono_en_otra_cuenta', porque_codigo: abono ? 'abono_no_casa' : 'sin_cuenta_de_abono', porque: casaAbono.porque,
    company_id: empresa, party_id: null, ...SIN_FICHA, gc_cliente_id: null, datos: { banco: abono?.banco ?? null, termina_en: abono?.terminaEn ?? null } })
  return { diferencias: out, abono: casaAbono }
}

/** La frase de la lectura (regla 8: con contenido). */
export function fraseDeLectura(emisor: string, plan: PlanLectura, convertidas: number, conDiferencias: number, conectada = false): string {
  return `${conectada ? 'Conectada' : 'Leída'} la cuenta de GoCardless de ${emisor}: ${plan.resumen.mandatosVivos} mandatos activos y ${plan.resumen.lineasActivas} líneas leídas` +
    ` (${euros(plan.resumen.alMesCent)} al mes). ${convertidas} convertidas en línea, ${plan.noConvertidas.length} sin convertir; ${conDiferencias} con diferencias.` +
    // G01c (Julio, 07/11) · Las que esperan a casar no son «0 sin convertir»: se dicen (regla 7).
    (plan.resumen.sinCasar
      ? ` ${plan.resumen.sinCasar} ${plan.resumen.sinCasar === 1 ? 'suscripción activa sigue' : 'suscripciones activas siguen'} sin línea porque su cliente de GoCardless no está casado con ningún cliente de Sumied (salen en «En GoCardless sin ficha en tu CRM»).`
      : '') +
    (plan.resumen.clientesConVariosEnGc
      ? ` ${plan.resumen.clientesConVariosEnGc} ${plan.resumen.clientesConVariosEnGc === 1 ? 'cliente de Sumied tiene' : 'clientes de Sumied tienen'} más de un cliente en esta cuenta de GoCardless: para la forma de cobro se usa el enlazado a mano o, si no, el de más mandatos activos.`
      : '')
}
