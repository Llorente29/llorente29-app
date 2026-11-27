// src/modules/conta/gestoria/x35/modelo.ts
//
// X35 (27/11) · «El mes de un vistazo»: el Inicio de «Clientes y cuotas» (maqueta aprobada GyPbKxEDqa8pPmnvwGqvcd). Puro: sin
// base ni pantalla. NO calcula nada nuevo: recibe lo que ya calculan «Facturas del mes» (Q10: el plan de mandar y el
// cuadre por vía, con calculos.ts) y «Clientes y cuotas» (R20: «Te deben» y el próximo cobro), y lo ordena.
//   · Cada cifra lleva su lista, y la cifra ES la suma de su lista (lista() de las cifras del R20). Sin lista fiable, la
//     cifra no sale (null), y se dice por qué en `faltan`.
//   · Cobrado = lo cobrado a clientes en el mes por GoCardless, el banco y la tarjeta: el «Cobrado» del cuadre de
//     «Facturas del mes» menos lo que ya se decidió que no es un cobro (que no sale en ninguna cifra).
//   · Por facturar = lo que el plan de «Facturas del mes» deja listo para mandar a Cegid y aún no se ha mandado (las dos
//     vueltas de GoCardless y los cobros del banco o con tarjeta).
//   · Te deben = la lista del R20 («Te deben», cruzado con el banco). Mientras alguna empresa no esté cruzada, no sale.

import { euros, lista, nombreDelMes, type FilaDeLista, type Lista, type CifrasDeCuotas, type NoCobrado } from '../../../../../supabase/functions/_shared/tarifa/cifras'
import type { CuadreVias, PlanCobro } from '../../../../../supabase/functions/_shared/cegidBanco'
import type { PlanMandar } from '../../../../../supabase/functions/_shared/cegidMandar'

export type EstadoPaso = 'hecho' | 'falta' | 'luego'
export interface Paso { nombre: string; estado: EstadoPaso }
export interface Cifra {
  id: 'cobrado' | 'porFacturar' | 'teDeben' | 'seVaACobrar' | 'altas' | 'bajas'
  titulo: string
  /** Lo que se enseña en grande: sale de la lista (su suma, o cuántas filas si es una lista que se cuenta). */
  valor: string
  /** La línea de debajo: de dónde sale. */
  fuente: string
  tono: 'normal' | 'bien' | 'aviso'
  lista: Lista
}
export type Etiqueta = 'Urgente' | 'Facturar' | 'Cobrar' | 'Revisar'
export interface Asunto {
  id: string
  etiqueta: Etiqueta
  titulo: string
  texto: string
  /** El dinero que mueve (ordena la lista); null si es una cuenta de cosas, no de euros. */
  cent: number | null
  importe: string
  lista: Lista
  /** Adónde lleva: la pantalla donde se resuelve. */
  ir: 'facturar' | 'facturasDelMes' | 'clientes'
}
export interface MesDeUnVistazo {
  mes: string
  /** «anterior», «actual» o «siguiente» respecto a hoy. */
  cual: 'anterior' | 'actual' | 'siguiente'
  titulo: string
  frase: string
  pct: number
  pasos: Paso[]
  cifras: Cifra[]
  asuntos: Asunto[]
  /** Lo que no sale y por qué (para «Lo que no sé» y para la propia pantalla). */
  faltan: string[]
}

export interface EntradaMes {
  mes: string
  hoy: string
  /** El cuadre por vía de «Facturas del mes» (null: no se ha podido leer lo del banco o lo de Cegid). */
  cuadre: CuadreVias | null
  /** El plan de mandar a Cegid de «Facturas del mes» (null: sin lo leído de Cegid). */
  plan: PlanMandar | null
  /** El plan de cada cobro del banco o con tarjeta (null: sin leer). */
  planes: PlanCobro[] | null
  /** Cuántas incidencias hay ya mandadas a Cegid de este mes (0: el mes se facturó fuera de Sumied). */
  mandadas: number
  /** «Te deben» del R20, a hoy (null: sin leer). */
  noCobrado: NoCobrado | null
  /** Las cuotas del próximo cobro de GoCardless del R20 (null: sin leer). */
  cuotas: CifrasDeCuotas | null
  /** El nombre de cada cliente de Cegid, por su código. */
  nombreCegid: ReadonlyMap<number, string>
}

const cent = (n: number) => Math.round(n * 100)
const plural = (n: number, uno: string, varios: string) => `${n.toLocaleString('es-ES')} ${n === 1 ? uno : varios}`
const diaMes = (f: string) => `${Number(f.slice(8, 10))}/${Number(f.slice(5, 7))}`
export const mesDe = (mes: string, mas: number) => {
  const d = new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)) - 1 + mas, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}
const Mayus = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
export const tituloDelMes = (mes: string) => `${Mayus(nombreDelMes(mes))} de ${mes.slice(0, 4)}`

/** Cobrado: lo cobrado a clientes por cada vía, sin lo que no es un cobro. La suma de sus filas es la cifra. */
export function listaCobrado(cuadre: CuadreVias, mes: string): Lista {
  const filas: FilaDeLista[] = cuadre.vias.map((v) => ({ id: v.via, texto: v.via, fichaId: null, importeCent: v.cobradoCent - v.noCobroCent,
    detalle: v.noCobroCent ? `${euros(v.cobradoCent)} entrado, menos ${euros(v.noCobroCent)} que no es un cobro` : `Entrado en ${nombreDelMes(mes)}` }))
  return lista(`Cobrado en ${nombreDelMes(mes)}`, filas.filter((f) => f.importeCent !== 0 || filas.length === 1))
}

/** Por facturar: lo listo para mandar a Cegid y aún sin mandar. Una fila por factura (cliente y serie) y por cobro del banco. */
export function listaPorFacturar(plan: PlanMandar, planes: readonly PlanCobro[], mes: string, nombreCegid: ReadonlyMap<number, string>): Lista {
  const filas: FilaDeLista[] = []
  for (const v of [plan.vueltas['1'], plan.vueltas['3']]) {
    for (const x of v.listos) filas.push({ id: `gc:${v.serie}:${x.codigo}`, texto: x.nombre || nombreCegid.get(x.codigo) || `Cliente ${x.codigo}`, fichaId: null,
      importeCent: x.totalCent, detalle: `Serie ${v.serie} · ${plural(x.lineas.length, 'recibo de GoCardless', 'recibos de GoCardless')}` })
  }
  for (const p of planes) {
    if (p.estado !== 'listo' || p.cobro.fecha.slice(0, 7) !== mes) continue
    filas.push({ id: `banco:${p.cobro.clave}`, texto: (p.cliente != null ? nombreCegid.get(p.cliente) : null) ?? p.cobro.texto ?? 'Cobro del banco', fichaId: null,
      importeCent: cent(p.cobro.importe) - p.pagaFacturaCent - p.noCobroCent, fecha: p.cobro.fecha,
      detalle: `${p.cobro.tipo === 'tarjeta' ? 'Con tarjeta' : 'Por el banco'} el ${diaMes(p.cobro.fecha)}` })
  }
  return lista(`Por facturar en ${nombreDelMes(mes)}`, filas.sort((a, b) => b.importeCent - a.importeCent || a.texto.localeCompare(b.texto, 'es')))
}

/** Lo que el plan no deja mandar (sin concepto, sin ficha, sin código…): se resuelve antes de facturar. */
export function listaSinFacturar(plan: PlanMandar): Lista {
  return lista('Recibos que no se pueden facturar todavía', plan.noSalen.filter((x) => x.porque !== 'no_cobrado' && x.porque !== 'ya_mandado')
    .map((x) => ({ id: x.gcId, texto: x.nombre ?? 'Sin cliente', fichaId: null, importeCent: x.totalCent, detalle: x.frase })))
}

/** Los cobros del banco o con tarjeta que esperan a que alguien decida (paga una factura, facturar o no es un cobro). */
export function listaPorDecidir(planes: readonly PlanCobro[], mes: string, nombreCegid: ReadonlyMap<number, string>): Lista {
  return lista('Cobros del banco por decidir', planes.filter((p) => p.estado === 'para_julio' && p.cobro.fecha.slice(0, 7) === mes).map((p) => ({
    id: p.cobro.clave, texto: (p.cliente != null ? nombreCegid.get(p.cliente) : null) ?? p.cobro.texto ?? 'Sin cliente', fichaId: null, fecha: p.cobro.fecha,
    importeCent: cent(p.cobro.importe) - p.pagaFacturaCent - p.noCobroCent, detalle: `${p.cobro.tipo === 'tarjeta' ? 'Con tarjeta' : 'Por el banco'} el ${diaMes(p.cobro.fecha)} · ${p.porque}` })))
}

const asunto = (id: string, etiqueta: Etiqueta, titulo: string, texto: string, l: Lista, ir: Asunto['ir'], cuenta = false): Asunto =>
  ({ id, etiqueta, titulo, texto, cent: cuenta ? null : l.totalCent, importe: cuenta ? plural(l.filas.length, 'cliente', 'clientes') : euros(l.totalCent), lista: l, ir })

/** El mes, de un vistazo. */
export function mesDeUnVistazo(e: EntradaMes): MesDeUnVistazo {
  const actual = e.hoy.slice(0, 7)
  const cual = e.mes < actual ? 'anterior' : e.mes > actual ? 'siguiente' : 'actual'
  const faltan: string[] = []
  const cifras: Cifra[] = []
  const asuntos: Asunto[] = []
  const titulo = tituloDelMes(e.mes)

  if (cual === 'siguiente') {
    // El mes que viene: lo que GoCardless va a cobrar (el R20, el mes de su próximo cobro), y sus altas y bajas.
    const c = e.cuotas && e.cuotas.mes === e.mes ? e.cuotas : null
    if (!c) faltan.push(`Lo que se cobrará en ${nombreDelMes(e.mes)}: GoCardless aún no tiene su próximo cobro en ese mes.`)
    else {
      cifras.push({ id: 'seVaACobrar', titulo: 'Se va a cobrar', valor: euros(c.gocardless.lista.totalCent), tono: 'normal', lista: c.gocardless.lista,
        fuente: `${plural(c.gocardless.cobros, 'recibo', 'recibos')} · próximos cobros de GoCardless` })
      cifras.push({ id: 'altas', titulo: 'Altas', valor: c.altas.filas.length.toLocaleString('es-ES'), tono: 'bien', lista: c.altas,
        fuente: `${euros(c.altas.totalCent)} más al mes · las suscripciones nuevas de GoCardless` })
      cifras.push({ id: 'bajas', titulo: 'Bajas', valor: c.bajas.filas.length.toLocaleString('es-ES'), tono: 'normal', lista: c.bajas,
        fuente: `${euros(c.bajas.totalCent)} menos al mes · las que GoCardless ya no cobra` })
      if (c.diferencia.cent !== 0) {
        const filas = c.diferencia.grupos.flatMap((g) => g.filas)
        asuntos.push({ ...asunto('cuotas', 'Revisar', 'Cuotas distintas entre Sumied y GoCardless', `Resuélvelas antes del próximo cobro · ${plural(filas.length, 'cliente', 'clientes')}`,
          lista('Cuotas distintas entre Sumied y GoCardless', filas), 'clientes'), cent: Math.abs(c.diferencia.cent) })
      }
    }
    const revisar: EstadoPaso = !c ? 'luego' : c.diferencia.cent === 0 ? 'hecho' : 'falta'
    const pasos: Paso[] = [{ nombre: 'Revisar el cobro', estado: revisar }, { nombre: 'Cobrar', estado: 'luego' }, { nombre: 'Facturar', estado: 'luego' },
      { nombre: 'Reclamar', estado: 'luego' }, { nombre: 'Contabilizar', estado: 'luego' }]
    const frase = !c ? 'GoCardless aún no ha programado su cobro' : revisar === 'hecho' ? 'Las cuotas cuadran con GoCardless' : 'Revisa las cuotas antes del cobro'
    return { mes: e.mes, cual, titulo, frase, pct: pct(pasos), pasos, cifras, asuntos: ordenar(asuntos), faltan }
  }

  // Un mes que ya ha empezado (el actual) o pasado.
  const fuera = cual === 'anterior' && e.mandadas === 0
  let cobrado: Lista | null = null
  if (e.cuadre) {
    cobrado = listaCobrado(e.cuadre, e.mes)
    const VIA: Record<string, string> = { GoCardless: 'GoCardless', Banco: 'el banco', Tarjeta: 'la tarjeta' }
    const vias = e.cuadre.vias.map((v) => VIA[v.via] ?? v.via).join(', ').replace(/, ([^,]*)$/, ' y $1')
    cifras.push({ id: 'cobrado', titulo: 'Cobrado', valor: euros(cobrado.totalCent), tono: 'bien', lista: cobrado,
      fuente: `Por ${vias || 'GoCardless'} · el mismo de «Facturas del mes»` })
  } else faltan.push(`Cobrado en ${nombreDelMes(e.mes)}: no se ha podido leer lo cobrado por el banco y con tarjeta (o lo leído de Cegid). Se calcula en «Facturas del mes».`)

  let porFacturar: Lista | null = null
  if (fuera) faltan.push(`${Mayus(nombreDelMes(e.mes))} se facturó en Cegid, antes de Sumied: no hay nada por facturar desde aquí.`)
  else if (e.plan && e.planes) {
    porFacturar = listaPorFacturar(e.plan, e.planes, e.mes, e.nombreCegid)
    cifras.push({ id: 'porFacturar', titulo: 'Por facturar', valor: porFacturar.filas.length.toLocaleString('es-ES'), tono: 'normal', lista: porFacturar,
      fuente: `${euros(porFacturar.totalCent)} por mandar a Cegid · las facturas las emite Cegid` })
    if (porFacturar.filas.length) asuntos.push(asunto('mandar', 'Facturar', 'Mandar a Cegid las facturas del mes', `${plural(porFacturar.filas.length, 'factura', 'facturas')} por mandar`, porFacturar, 'facturar'))
    const sin = listaSinFacturar(e.plan)
    if (sin.filas.length) asuntos.push(asunto('sinFacturar', 'Facturar', 'Recibos sin concepto o sin ficha', `Se resuelven antes de facturar · ${plural(sin.filas.length, 'recibo', 'recibos')}`, sin, 'facturasDelMes'))
    const decidir = listaPorDecidir(e.planes, e.mes, e.nombreCegid)
    if (decidir.filas.length) asuntos.push(asunto('decidir', 'Revisar', 'Cobros del banco por decidir', `Paga una factura, se factura o no es un cobro · ${plural(decidir.filas.length, 'cobro', 'cobros')}`, decidir, 'facturasDelMes'))
  } else faltan.push(`Por facturar en ${nombreDelMes(e.mes)}: falta lo leído de Cegid o lo cobrado por el banco.`)

  // X35d · «Te deben» es lo del mes elegido: los recibos de ese mes que GoCardless no cobró y el banco tampoco (a hoy).
  // Lo de todos los meses junto sale aparte, en «Recibos sin cobrar desde hace más de 90 días» (solo en el mes actual).
  let teDeben: Lista | null = null
  if (!e.noCobrado) faltan.push('Te deben: no se ha podido leer lo que GoCardless no cobró.')
  else if (!e.noCobrado.cruzado) faltan.push(`Te deben: falta cruzar con el banco ${e.noCobrado.faltanPorCruzar.join(', ') || 'alguna empresa'}; hasta entonces, lo que GoCardless no cobró no es aún deuda.`)
  else {
    const mesTexto = nombreDelMes(e.mes)
    teDeben = lista(`Te deben de ${mesTexto}`, e.noCobrado.lista.filas.filter((f) => (f.fecha ?? '').slice(0, 7) === e.mes))
    const clientesMes = new Set(teDeben.filas.map((f) => f.fichaId ?? f.texto)).size
    cifras.push({ id: 'teDeben', titulo: `Te deben de ${mesTexto}`, valor: euros(teDeben.totalCent), tono: teDeben.totalCent ? 'aviso' : 'bien', lista: teDeben,
      fuente: `${plural(teDeben.filas.length, 'recibo', 'recibos')} de ${plural(clientesMes, 'cliente', 'clientes')} de ${mesTexto} · GoCardless no lo cobró y el banco tampoco` })
    if (teDeben.filas.length) asuntos.push(asunto('reclamar', 'Cobrar', `Reclamar a quien no ha pagado ${mesTexto}`, `${plural(clientesMes, 'cliente', 'clientes')} · ${plural(teDeben.filas.length, 'recibo', 'recibos')}`, teDeben, 'clientes'))
    if (cual === 'actual') {
      const viejos = e.noCobrado.tramos.find((t) => t.texto === 'Más de 90 días')?.lista
      if (viejos?.filas.length) asuntos.push({ ...asunto('viejos', 'Urgente', 'Recibos sin cobrar desde hace más de 90 días', `${plural(new Set(viejos.filas.map((f) => f.fichaId ?? f.id)).size, 'cliente', 'clientes')} · de todos los meses`, viejos, 'clientes') })
    }
    // X35c · Los abonos del TPV sin detalle son de desde mayo, no de este mes: van en «Dónde se te escapa el dinero», no aquí.
  }

  const comprobado = e.cuadre ? e.cuadre.cuadra : false
  const pasos: Paso[] = fuera
    ? [{ nombre: 'Cobrado', estado: cobrado ? 'hecho' : 'luego' }, { nombre: 'Facturado en Cegid', estado: 'hecho' }, { nombre: 'Sin comprobar', estado: 'luego' }]
    : [
      { nombre: 'Cobrar', estado: cobrado && cobrado.totalCent > 0 ? 'hecho' : cual === 'actual' ? 'falta' : 'luego' },
      { nombre: 'Facturar', estado: !porFacturar ? 'luego' : porFacturar.filas.length || asuntos.some((a) => a.id === 'sinFacturar' || a.id === 'decidir') ? 'falta' : 'hecho' },
      { nombre: 'Reclamar', estado: teDeben === null ? 'luego' : teDeben.filas.length ? 'falta' : 'hecho' },
      { nombre: 'Comprobar', estado: comprobado ? 'hecho' : 'luego' },
      { nombre: 'Contabilizar', estado: 'luego' },
    ]
  const quedan = pasos.filter((p) => p.estado === 'falta').map((p) => p.nombre.toLowerCase())
  const hechos = pasos.filter((p) => p.estado === 'hecho').map((p) => p.nombre)
  const frase = fuera ? 'Se hizo en Cegid, antes de Sumied'
    : quedan.length ? `${hechos.length ? `${hechos.map((h) => (h === 'Cobrar' ? 'Cobrado' : h === 'Comprobar' ? 'comprobado' : h.toLowerCase())).join(' y ')}. ` : ''}Falta ${quedan.join(' y ')}`
    : hechos.length ? 'Todo lo de este mes, hecho' : 'Aún no hay nada que hacer este mes'
  return { mes: e.mes, cual, titulo, frase: Mayus(frase), pct: pct(pasos), pasos, cifras, asuntos: ordenar(asuntos), faltan }
}

const pct = (pasos: readonly Paso[]) => (pasos.length ? Math.round((pasos.filter((p) => p.estado === 'hecho').length / pasos.length) * 100) : 0)
/** Primero lo que más dinero mueve; lo que es una cuenta de cosas, al final. */
const ordenar = (a: Asunto[]) => [...a].sort((x, y) => (y.cent ?? -1) - (x.cent ?? -1))
