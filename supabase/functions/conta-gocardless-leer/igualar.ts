// supabase/functions/conta-gocardless-leer/igualar.ts
//
// R19 · paso 1 · Sumied igual a GoCardless (Julio, 25/11: «GoCardless es la verdad. La cuota y las líneas de cada
// cliente en Sumied salen de lo que cobra GoCardless. Lo no atado va a «Pendiente de revisar» y no para el resto»).
//
// Después de convertir en línea las suscripciones nuevas (conversion.ts), cada lectura iguala las líneas que YA salieron
// de una suscripción de GoCardless, solo si su cliente de GoCardless está ATADO a esa misma ficha
// (conta_gc_enlace_elegido):
//   · la suscripción ya no cobra (cancelada o acabada) y la línea sigue abierta → la línea se da de baja, con la fecha
//     de fin de GoCardless o, si no la trae, el último día del mes de hoy;
//   · la suscripción cobra otro importe que la línea → la línea lleva el de GoCardless como importe propio.
// Lo que no está atado no se adivina: va a «Pendiente de revisar», con su porqué, y no para lo demás:
//   · linea_sin_atar: Sumied tiene una línea de una suscripción cuyo cliente de GoCardless no está atado a ninguna ficha;
//   · linea_en_otra_ficha: está atado a otra ficha que la de la línea;
//   · gc_sin_atar: GoCardless cobra a un cliente que no está atado a ninguna ficha (si no lo dice ya «gocardless_sin_ficha»).
// Puro: lo prueban las unitarias (tests/unit/modules/conta/r19/igualar.test.ts).

import { euros, tarifaDelMes, vale, type Linea, type Mes, type Tarifa } from './comparacion.ts'

export interface LineaParaIgualar extends Linea {
  partyId: string
}

export interface SuscripcionParaIgualar {
  id: string
  clienteGcId: string | null
  nombreCliente: string | null
  nombre: string
  importeCent: number
  estado: string
  fin: string | null
  periodo: 'mes' | 'anio'
  /** Cobra en el mes que se cuenta (la forma de contar de la copia: próximo cobro dentro del mes). */
  cobraEnElMes: boolean
}

export interface Cambio {
  lineaId: string
  partyId: string
  que: 'baja' | 'importe'
  /** Lo que se escribe en la línea. */
  hasta?: string
  importePropioCent?: number
  /** Cómo estaba (para el registro y la vuelta atrás). */
  antes: { hasta: string | null; importePropioCent: number | null; alMesCent: number | null }
  porque: string
}

export interface Pendiente {
  tipo: 'linea_sin_atar' | 'linea_en_otra_ficha' | 'gc_sin_atar'
  porque_codigo: string
  porque: string
  company_id: string
  party_id: string | null
  gc_cliente_id: string | null
  datos: Record<string, unknown>
}

/** GoCardless ya no la cobra: cancelada o acabada. (Las demás —pendiente de aprobar, en pausa— se dejan como están.) */
export const YA_NO_COBRA = new Set(['cancelled', 'finished'])

const finDeMes = (hoy: string): string => {
  const a = Number(hoy.slice(0, 4)); const m = Number(hoy.slice(5, 7))
  const d = new Date(Date.UTC(a, m, 0))
  return d.toISOString().slice(0, 10)
}
const texto = (l: Linea) => [l.nombreServicio, l.empleado ?? l.detalle].filter(Boolean).join(' · ')

/** El importe que Sumied pone hoy a una línea en su periodo (el propio; si no, la tarifa propia; si no, la general). */
export function importeDeLinea(l: LineaParaIgualar, tarifas: Tarifa[], mes: Mes): number | null {
  if (l.importePropioCent !== null) return l.importePropioCent
  const t = tarifaDelMes(tarifas, l.partyId, l.emisor, l.servicio, mes)
  if (!t || t.tarifa.periodo !== l.periodo) return null
  return t.tarifa.importeCent
}

export function planIgualar(empresa: string, hoy: string, mes: Mes, lineas: LineaParaIgualar[], tarifas: Tarifa[],
  suscripciones: SuscripcionParaIgualar[], atado: Map<string, string>, yaSinFicha: Set<string>): { cambios: Cambio[]; pendientes: Pendiente[] } {
  const cambios: Cambio[] = []
  const pendientes: Pendiente[] = []
  const susc = new Map(suscripciones.map((s) => [s.id, s]))
  const mesHoy = hoy.slice(0, 7)

  for (const l of lineas) {
    if (!l.suscripcionId) continue
    const s = susc.get(l.suscripcionId)
    if (!s) continue
    const abierta = l.hasta === null || l.hasta >= mesHoy
    if (!abierta) continue
    const cliente = s.clienteGcId
    const a = cliente ? atado.get(cliente) ?? null : null
    const quien = s.nombreCliente ?? cliente ?? 'su cliente'
    if (!a) {
      pendientes.push({ tipo: 'linea_sin_atar', porque_codigo: 'cliente_gc_sin_atar', company_id: empresa, party_id: l.partyId, gc_cliente_id: cliente,
        porque: `«${texto(l)}» sale de lo que GoCardless cobra a ${quien}, que no está atado a ninguna ficha: Sumied no la cambia hasta que se ate.`,
        datos: { linea: l.id, suscripcion: s.id } })
      continue
    }
    if (a !== l.partyId) {
      pendientes.push({ tipo: 'linea_en_otra_ficha', porque_codigo: 'atado_a_otra_ficha', company_id: empresa, party_id: l.partyId, gc_cliente_id: cliente,
        porque: `«${texto(l)}» está en esta ficha, pero en GoCardless ${quien} está atado a otra: Sumied no la cambia hasta que se aclare cuál es.`,
        datos: { linea: l.id, suscripcion: s.id, atado_a: a } })
      continue
    }
    const actual = importeDeLinea(l, tarifas, mes)
    const alMesAntes = actual === null ? null : l.periodo === 'anio' ? Math.round(actual / 12) : actual
    if (YA_NO_COBRA.has(s.estado)) {
      const hasta = s.fin && s.fin >= `${mesHoy}-01` ? s.fin : finDeMes(hoy)
      cambios.push({ lineaId: l.id, partyId: l.partyId, que: 'baja', hasta, antes: { hasta: l.hasta, importePropioCent: l.importePropioCent, alMesCent: alMesAntes },
        porque: `GoCardless ya no cobra «${s.nombre}» (${s.estado === 'finished' ? 'acabada' : 'cancelada'}): «${texto(l)}» se da de baja el ${hasta}.` })
      continue
    }
    if (s.estado === 'active' && vale(l.desde, l.hasta, mes) && s.periodo === l.periodo && actual !== s.importeCent) {
      cambios.push({ lineaId: l.id, partyId: l.partyId, que: 'importe', importePropioCent: s.importeCent,
        antes: { hasta: l.hasta, importePropioCent: l.importePropioCent, alMesCent: alMesAntes },
        porque: `«${texto(l)}»: Sumied ${actual === null ? 'no tenía importe' : euros(actual)} y GoCardless cobra ${euros(s.importeCent)}${s.periodo === 'anio' ? ' al año' : ' al mes'}: se pone el de GoCardless.` })
    }
  }

  // Los clientes de GoCardless que cobran en el mes y no están atados a ninguna ficha (uno por cliente).
  const porCliente = new Map<string, SuscripcionParaIgualar[]>()
  for (const s of suscripciones) {
    if (s.estado !== 'active' || !s.cobraEnElMes || !s.clienteGcId || atado.has(s.clienteGcId) || yaSinFicha.has(s.clienteGcId)) continue
    porCliente.set(s.clienteGcId, [...(porCliente.get(s.clienteGcId) ?? []), s])
  }
  for (const [cliente, ss] of porCliente) {
    const total = ss.reduce((t, s) => t + (s.periodo === 'anio' ? Math.round(s.importeCent / 12) : s.importeCent), 0)
    pendientes.push({ tipo: 'gc_sin_atar', porque_codigo: 'cliente_gc_sin_atar', company_id: empresa, party_id: null, gc_cliente_id: cliente,
      porque: `GoCardless cobra a ${ss[0].nombreCliente ?? cliente} ${euros(total)} al mes (${ss.length} ${ss.length === 1 ? 'suscripción' : 'suscripciones'}) y no está atado a ninguna ficha: no cuenta en Sumied hasta que se ate.`,
      datos: { suscripciones: ss.map((s) => s.id), al_mes_cent: total } })
  }
  return { cambios, pendientes }
}
