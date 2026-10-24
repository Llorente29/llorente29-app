// supabase/functions/_shared/catcherCruces.ts
//
// E05 · Tarea 3 · Los cruces de la quincena de Catcher, antes de dar nada por
// bueno. Núcleo puro: entran la quincena leída (catcherQuincena.ts), los
// pedidos que la app mandó a Catcher (la tabla de ventas) y la tarifa en vigor;
// sale, factura a factura, si cuadra, y la lista de lo que hay que aclarar,
// cada cosa con su pedido concreto y su porqué.
//
//   1. Pedido a pedido: cada pedido del Excel PEDIDOS con el que se mandó a
//      Catcher, por su CÓDIGO y su FECHA Y HORA (el código solo se repite:
//      G901 puede ser de dos días). Un pedido que Catcher factura y no se le
//      mandó, uno cancelado que un rider factura, uno entregado que nadie
//      factura: por aclarar.
//   2. La tarifa: el precio de cada pedido. La app no guarda los km: guarda el
//      precio que dio Catcher al mandarlo (transport_price, con el bono ya
//      dentro). Se compara con ese; si no lo hay, con lo que permite la tarifa
//      (del tramo más barato al máximo con el bono más alto, o el pedido extra).
//   3. La comisión: 0,79 € de base por pedido ENTREGADO. Una comisión por un
//      pedido que nadie repartió (el G236 del 23/09: cancelado, comisión
//      cobrada y ningún rider que lo facture) va a «Por aclarar».
//   4. Los totales: lo que suman los pedidos de cada factura es su base; la
//      suma del Excel es la de las facturas del lote. (Lo que baja la 40700001
//      lo mira el pago, tarea 4.)
// Un umbral ordena, no esconde (regla 7): todo lo que no cuadra sale, cada uno
// con su pedido; no hay «y N más».

import type { PedidoExcel, TipoFactura } from './catcherTipos.ts'
import { eurosExactos } from './euros.ts'
import { cuadraConLosPedidos, type Cuenta } from './catcherCuenta.ts'

// ── La tarifa (fechada y editable: supplier_rate) ────────────────────────────

export type Tarifa = {
  /** AAAA-MM-DD: desde cuándo vale. */
  desde: string
  /** Precio base por tramo de distancia: hasta X km, tanto (sin IVA). */
  tramos: { hastaKm: number; precio: number }[]
  /** Por km de más a partir del último tramo, hasta el máximo. */
  porKmExtra: number
  /** El precio base no pasa de aquí (sin bonos). */
  maximo: number
  bonoLluviaPct: number
  bonoDemandaPct: number
  /** Lluvia y demanda juntas no pasan de aquí. */
  bonoMaxPct: number
  /** Cada pedido extra del mismo rider. */
  pedidoExtra: number
  /** La comisión de Catcher, de base, por pedido entregado. */
  comisionPedido: number
}

/** La del portal el 14/10/2026 (doc de Julio). */
export const TARIFA_PORTAL_20261014: Tarifa = {
  desde: '2026-10-14',
  tramos: [{ hastaKm: 1, precio: 4 }, { hastaKm: 2, precio: 4.2 }, { hastaKm: 3, precio: 4.7 }],
  porKmExtra: 0.5, maximo: 12, bonoLluviaPct: 10, bonoDemandaPct: 10, bonoMaxPct: 15, pedidoExtra: 2.5, comisionPedido: 0.79,
}

/** La que vale un día: la última cuyo «desde» no es posterior. */
export function tarifaDel(dia: string, tarifas: readonly Tarifa[]): Tarifa | null {
  return [...tarifas].filter((t) => t.desde <= dia).sort((a, b) => b.desde.localeCompare(a.desde))[0] ?? null
}

const c = (x: number) => Math.round(x * 100)
const e = (x: number) => x / 100

/** El precio base de una distancia (sin bonos): por tramo, y más allá, por km, hasta el máximo. */
export function precioPorKm(km: number, t: Tarifa): number {
  const tramo = t.tramos.find((x) => km <= x.hastaKm)
  if (tramo) return tramo.precio
  const ultimo = t.tramos[t.tramos.length - 1]
  return e(Math.min(c(t.maximo), c(ultimo.precio) + Math.round(Math.ceil(km - ultimo.hastaKm) * c(t.porKmExtra))))
}

/** ¿Cabe ese precio en la tarifa? Del tramo más barato al máximo con el bono más alto, o el pedido extra. */
export function cabeEnTarifa(precio: number, t: Tarifa): boolean {
  if (c(precio) === c(t.pedidoExtra)) return true
  const minimo = Math.min(...t.tramos.map((x) => x.precio))
  const tope = Math.round(c(t.maximo) * (1 + t.bonoMaxPct / 100))
  return c(precio) >= c(minimo) && c(precio) <= tope
}

// ── Lo que entra ─────────────────────────────────────────────────────────────

/** Un pedido que la app mandó a Catcher (la tabla de ventas). `momento`: UTC. */
export type PedidoApp = {
  id: string; codigo: string; momento: string
  localId: string | null; marcaId: string | null; canalId: string | null
  /** delivered, canceled… (delivery_state de la venta). */
  estado: string
  /** El precio que dio Catcher al mandarlo (transport_price), base; null o 0 si no lo dio. */
  precio: number | null
}

export type FacturaParaCruzar = { numero: string; tipo: TipoFactura; base: number; total: number; seguraAlLeer: boolean }

// ── Lo que sale ──────────────────────────────────────────────────────────────

export type Motivo =
  | 'no_se_mando' | 'dos_pedidos_a_esa_hora' | 'cancelado_facturado' | 'precio_distinto' | 'fuera_de_tarifa' | 'sin_tarifa'
  | 'comision_sin_entrega' | 'comision_distinta' | 'entregado_sin_factura' | 'suma_pedidos' | 'suma_lote'

export type PorAclarar = {
  motivo: Motivo
  /** La factura a la que toca (null: el pedido no es de ninguna). */
  factura: string | null
  pedido: { codigo: string; momento: string | null } | null
  texto: string
  /** Céntimos de diferencia, si los hay (lo que Catcher cobra de más: positivo). */
  diferencia: number | null
}

export type CosteReparto = { localId: string | null; marcaId: string | null; canalId: string | null; pedidos: number; base: number }

export type Cruce = {
  facturas: Record<string, { estado: 'seguro' | 'aclarar'; aclarar: number }>
  porAclarar: PorAclarar[]
  /** Pedido del Excel → pedido de la app (la clave: factura|código|momento). */
  casados: Record<string, string>
  totales: { excel: number; lote: number | null; pedidosExcel: number; casados: number; comisionEsperada: number; comisionCobrada: number }
  /** Lo que cuesta repartir, por local, marca y plataforma (riders, flotas y comisión). */
  coste: CosteReparto[]
}

// ── Utilidades de presentación ──────────────────────────────────────────────

const eur = eurosExactos
/** «23/09 a las 16:29», en hora de Madrid. */
export function cuando(utc: string | null): string {
  if (!utc) return 'sin fecha'
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', day: 'numeric', month: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' })
    .formatToParts(new Date(utc)).map((x) => [x.type, x.value.padStart(2, '0')]))
  return `${p.day}/${p.month} a las ${p.hour}:${p.minute}`
}
const pedidoTxt = (p: { codigo: string; momento: string | null }) => `${p.codigo} del ${cuando(p.momento)}`
const diaMadrid = (utc: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date(utc))

/** Cuánto se puede separar la hora del Excel de la de la app para ser el mismo pedido. */
export const VENTANA_MINUTOS = 90

/** El pedido de la app con ese código más cerca de esa hora (dentro de la ventana); y si hay dos, los dos. */
function buscarEnApp(codigo: string, momento: string | null, app: readonly PedidoApp[]): PedidoApp[] {
  if (!momento) return []
  const t = Date.parse(momento)
  return app.filter((a) => a.codigo.toUpperCase() === codigo.toUpperCase() && Math.abs(Date.parse(a.momento) - t) <= VENTANA_MINUTOS * 60000)
    .sort((a, b) => Math.abs(Date.parse(a.momento) - t) - Math.abs(Date.parse(b.momento) - t))
}

const ENTREGADO = (estado: string) => /^(delivered|finish|finished|completed|entregado)$/i.test(estado)
const CANCELADO = (estado: string) => /^(canceled|cancelled|cancelado)$/i.test(estado)
const esComision = (p: PedidoExcel) => /commission/i.test(p.tipo)

// ── El cruce ─────────────────────────────────────────────────────────────────

/**
 * Cruza la quincena con lo que se mandó a Catcher y con la tarifa.
 * `periodo`: el de la quincena (para los entregados que nadie factura);
 * `totalLote`: lo que suman las facturas registradas del lote (null: sin registrar).
 */
export function cruzar(o: {
  facturas: readonly FacturaParaCruzar[]
  pedidos: readonly PedidoExcel[]
  app: readonly PedidoApp[]
  tarifas: readonly Tarifa[]
  periodo: { desde: string; hasta: string }
  totalLote: number | null
}): Cruce {
  const aclarar: PorAclarar[] = []
  const casados: Record<string, string> = {}
  const clave = (p: PedidoExcel) => `${p.factura}|${p.codigo}|${p.momento ?? ''}`
  const tipoDe = new Map(o.facturas.map((f) => [f.numero, f.tipo] as [string, TipoFactura]))
  const reparto = o.pedidos.filter((p) => !esComision(p) && tipoDe.get(p.factura) !== 'catcher')
  const comisiones = o.pedidos.filter((p) => esComision(p) || tipoDe.get(p.factura) === 'catcher')
  const usados = new Set<string>()
  const coste = new Map<string, CosteReparto>()
  const sumarCoste = (a: PedidoApp | null, base: number) => {
    const k = `${a?.localId ?? ''}|${a?.marcaId ?? ''}|${a?.canalId ?? ''}`
    const x = coste.get(k) ?? { localId: a?.localId ?? null, marcaId: a?.marcaId ?? null, canalId: a?.canalId ?? null, pedidos: 0, base: 0 }
    x.pedidos++; x.base = e(c(x.base) + c(base)); coste.set(k, x)
  }

  // 1 · Los pedidos de los riders y flotas, uno a uno.
  for (const p of reparto) {
    const enApp = buscarEnApp(p.codigo, p.momento, o.app)
    if (!enApp.length) {
      aclarar.push({ motivo: 'no_se_mando', factura: p.factura, pedido: p, diferencia: c(p.base),
        texto: `${pedidoTxt(p)}: Catcher lo cobra (${eur(p.base)}) y no está entre los pedidos que se le mandaron.` })
      sumarCoste(null, p.base)
      continue
    }
    if (enApp.length > 1 && Math.abs(Date.parse(enApp[0].momento) - Date.parse(enApp[1].momento)) < 60000) {
      aclarar.push({ motivo: 'dos_pedidos_a_esa_hora', factura: p.factura, pedido: p, diferencia: null,
        texto: `${pedidoTxt(p)}: hay dos pedidos con ese código a esa hora; no sé cuál es.` })
    }
    const a = enApp[0]
    usados.add(a.id); casados[clave(p)] = a.id
    sumarCoste(a, p.base)
    if (CANCELADO(a.estado) || CANCELADO(p.estado)) {
      aclarar.push({ motivo: 'cancelado_facturado', factura: p.factura, pedido: p, diferencia: c(p.base),
        texto: `${pedidoTxt(p)}: está cancelado y el rider lo factura (${eur(p.base)}).` })
      continue
    }
    if (a.precio != null && c(a.precio) !== 0) {
      if (c(a.precio) !== c(p.base)) {
        aclarar.push({ motivo: 'precio_distinto', factura: p.factura, pedido: p, diferencia: c(p.base) - c(a.precio),
          texto: `${pedidoTxt(p)}: Catcher cobra ${eur(p.base)} y al mandarlo dijo ${eur(a.precio)}.` })
      }
      continue
    }
    const t = p.momento ? tarifaDel(diaMadrid(p.momento), o.tarifas) : null
    if (!t) {
      aclarar.push({ motivo: 'sin_tarifa', factura: p.factura, pedido: p, diferencia: null,
        texto: `${pedidoTxt(p)}: no se sabe qué precio dio Catcher al mandarlo y no hay tarifa en vigor ese día: no se puede comprobar.` })
    } else if (!cabeEnTarifa(p.base, t)) {
      aclarar.push({ motivo: 'fuera_de_tarifa', factura: p.factura, pedido: p, diferencia: null,
        texto: `${pedidoTxt(p)}: ${eur(p.base)} no cabe en la tarifa (de ${eur(Math.min(...t.tramos.map((x) => x.precio)))} a ${eur(e(Math.round(c(t.maximo) * (1 + t.bonoMaxPct / 100))))}, o ${eur(t.pedidoExtra)} el pedido extra).` })
    }
  }

  // 2 · La comisión: por pedido entregado, a su precio.
  const repartidos = new Set(reparto.map((p) => `${p.codigo.toUpperCase()}|${p.momento ?? ''}`))
  let comisionEsperada = 0, comisionCobrada = 0
  for (const p of comisiones) {
    comisionCobrada += c(p.base)
    const enApp = buscarEnApp(p.codigo, p.momento, o.app)
    const a = enApp[0] ?? null
    if (a) { casados[clave(p)] = a.id; usados.add(a.id) }
    sumarCoste(a, p.base)
    const entregado = !CANCELADO(p.estado) && (!a || ENTREGADO(a.estado))
    const tieneRider = repartidos.has(`${p.codigo.toUpperCase()}|${p.momento ?? ''}`)
    const t = p.momento ? tarifaDel(diaMadrid(p.momento), o.tarifas) : null
    if (!entregado || !tieneRider) {
      const como = CANCELADO(p.estado) || (a && CANCELADO(a.estado)) ? 'cancelado' : !a ? 'no se le mandó a Catcher' : 'sin entregar'
      aclarar.push({ motivo: 'comision_sin_entrega', factura: p.factura, pedido: p, diferencia: c(p.base),
        texto: `${pedidoTxt(p)}: ${como}, con comisión cobrada (${eur(p.base)})${tieneRider ? '' : ' y ningún rider que lo facture'}.` })
      continue
    }
    if (t) comisionEsperada += c(t.comisionPedido)
    if (!t) {
      aclarar.push({ motivo: 'sin_tarifa', factura: p.factura, pedido: p, diferencia: null,
        texto: `${pedidoTxt(p)}: no hay tarifa en vigor ese día para comprobar la comisión.` })
    } else if (c(p.base) !== c(t.comisionPedido)) {
      aclarar.push({ motivo: 'comision_distinta', factura: p.factura, pedido: p, diferencia: c(p.base) - c(t.comisionPedido),
        texto: `${pedidoTxt(p)}: la comisión es ${eur(p.base)} y la tarifa dice ${eur(t.comisionPedido)}.` })
    }
  }

  // 3 · Lo que se mandó a Catcher, se entregó en la quincena y nadie factura.
  for (const a of o.app) {
    if (usados.has(a.id) || !ENTREGADO(a.estado)) continue
    const dia = diaMadrid(a.momento)
    if (dia < o.periodo.desde || dia > o.periodo.hasta) continue
    aclarar.push({ motivo: 'entregado_sin_factura', factura: null, pedido: { codigo: a.codigo, momento: a.momento }, diferencia: null,
      texto: `${pedidoTxt({ codigo: a.codigo, momento: a.momento })}: se mandó a Catcher, se entregó y no está en ninguna factura de la quincena.` })
  }

  // 4 · Los totales: los pedidos de cada factura suman su base; el Excel, lo que el lote.
  for (const f of o.facturas) {
    const suyos = o.pedidos.filter((p) => p.factura === f.numero)
    if (!suyos.length) continue
    const suma = suyos.reduce((t, p) => t + c(p.base), 0)
    if (suma !== c(f.base)) {
      aclarar.push({ motivo: 'suma_pedidos', factura: f.numero, pedido: null, diferencia: c(f.base) - suma,
        texto: `La factura ${f.numero}: su base es ${eur(f.base)} y sus pedidos suman ${eur(e(suma))}.` })
    }
  }
  const excel = o.facturas.reduce((t, f) => t + c(f.total), 0)
  if (o.totalLote != null && c(o.totalLote) !== excel) {
    aclarar.push({ motivo: 'suma_lote', factura: null, pedido: null, diferencia: excel - c(o.totalLote),
      texto: `El Excel suma ${eur(e(excel))} y las facturas del lote ${eur(o.totalLote)}.` })
  }

  const porFactura: Cruce['facturas'] = {}
  for (const f of o.facturas) {
    const n = aclarar.filter((x) => x.factura === f.numero).length
    porFactura[f.numero] = { estado: n === 0 && f.seguraAlLeer ? 'seguro' : 'aclarar', aclarar: n }
  }
  return {
    facturas: porFactura, porAclarar: aclarar, casados,
    totales: { excel: e(excel), lote: o.totalLote, pedidosExcel: o.pedidos.length, casados: Object.keys(casados).length, comisionEsperada: e(comisionEsperada), comisionCobrada: e(comisionCobrada) },
    coste: [...coste.values()].sort((a, b) => b.base - a.base),
  }
}

/** «58 facturas: 57 cuadran y 1 por aclarar». */
export function resumenCruce(x: Cruce): string {
  const fs = Object.values(x.facturas)
  const bien = fs.filter((f) => f.estado === 'seguro').length
  const mal = fs.length - bien
  return `${fs.length} ${fs.length === 1 ? 'factura' : 'facturas'}: ${bien} ${bien === 1 ? 'cuadra' : 'cuadran'}${mal ? ` y ${mal} por aclarar` : ''}` +
    (x.porAclarar.length ? ` (${x.porAclarar.length} ${x.porAclarar.length === 1 ? 'cosa' : 'cosas'} que mirar)` : '')
}

/**
 * El resumen de un lote en una línea, como lo pide el encargo:
 * «2.ª quincena de septiembre de 2026 · 58 facturas · 1.062,25 € · cuadra con los pedidos salvo 1».
 * `cuenta`: la de catcherCuenta (lo abierto y lo reclamado ahora); sin cruzar, lo dice.
 */
export function resumenLote(l: { etiqueta: string; facturas: number; total: number; cruzado: boolean; cuenta: Cuenta }): string {
  const c = cuadraConLosPedidos(l.cruzado, l.cuenta)
  const cuadra = c.charAt(0).toLowerCase() + c.slice(1)
  return `${l.etiqueta} · ${l.facturas} ${l.facturas === 1 ? 'factura' : 'facturas'} · ${eur(l.total)} · ${cuadra}`
}
