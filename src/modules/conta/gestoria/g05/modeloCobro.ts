// src/modules/conta/gestoria/g05/modeloCobro.ts
//
// G05 · Tarea 4 · «REVISAR EL COBRO», sin pintar. Recibe la lectura única de
// la pantalla (conta_pantalla_cobro, de la base: el mes, los ajustes, la
// conexión y los recibos ya preparados por el servidor) y devuelve lo que pinta
// la maqueta aprobada (Cobro.dc.html): antes de enviar, la revisión (los que
// cambian uno a uno, los iguales de una vez, los que no entran y «Enviar el
// cobro» con su aviso); después de enviar, cómo va cada recibo. Las cuentas y
// los textos son los de los núcleos de la T2 (_shared/cobro/revision.ts y
// gocardless.ts): aquí solo se traduce la fila de la base a su forma.
// Lo prueba tests/unit/modules/conta/gestoria/g05/modeloCobro.test.ts.

import { avisoDeEnvio, revision, type AvisoDeEnvio, type Revision, type ReciboEnRevision, type SinReciboEnRevision } from '../../../../../supabase/functions/_shared/cobro/revision'
import { ESTADO_EN_PALABRAS, type EstadoDelRecibo } from '../../../../../supabase/functions/_shared/cobro/gocardless'
import { nombreDelMes, type Cambio, type LineaDeRecibo } from '../../../../../supabase/functions/_shared/cobro/recibo'
import { euros } from '../../../../../supabase/functions/_shared/tarifa/precio'

/** Un recibo como lo devuelve conta_pantalla_cobro. */
export interface FilaRecibo {
  id: string
  cliente_id: string
  cliente: string
  clave: string
  lineas: LineaDeRecibo[]
  total_cent: number
  cobrar_cent: number | null
  anterior_cent: number | null
  cambios: Cambio[]
  pide_clic: string | null
  parado: string[]
  decision: 'pendiente' | 'aprobado' | 'este_mes_no'
  estado: EstadoDelRecibo
  cargo_el: string | null
  confirmado_el: string | null
  factura: string | null
  factura_id: string | null
}

/** Lo que devuelve conta_pantalla_cobro (una sola lectura por pantalla). */
export interface DatosCobro {
  mes: {
    mes: string
    /** Los que se cobraban y este mes no tienen recibo; con su cliente, para el botón. */
    sin_recibo: (SinReciboEnRevision & { cliente_id?: string })[] | null
    iguales_aprobados: boolean
    aviso_el: string | null
    cargo_el: string | null
    preparado_at: string | null
    preparado_por_name: string | null
    enviado_at: string | null
    enviado_por_name: string | null
  } | null
  ajustes: { dia_aviso: number; dia_cargo: number } & Record<string, unknown> | null
  conexion: { entorno: 'real' | 'pruebas' } | null
  recibos: FilaRecibo[]
}

export type Tono = 'neutro' | 'aviso' | 'bien' | 'mal'

/** Una fila de «Cómo va cada recibo». */
export interface FilaSeguimiento { id: string; cliente: string; importe: string; estado: string; detalle: string; tono: Tono; factura: string }

export interface ModeloCobro {
  mes: string
  /** «Cobro de diciembre · aviso al cliente el día 2 · cargo el día 4». */
  antetitulo: string
  /** Sin nada preparado: hay que pulsar «Preparar el cobro». */
  vacio: boolean
  /** Ya se ha enviado (hay algún recibo fuera de «preparado»). */
  enviado: boolean
  /** «Enviado el 1 de diciembre a las 10:42 por Julio · cargo el día 4». */
  enviadoTexto: string | null
  revision: Revision
  /** Los que «Este mes no»: salen con «Deshacer». */
  fueraDeEsteCobro: ReciboEnRevision[]
  /** Ya se ha pulsado «Aprobar los N» de los que no cambian. */
  igualesAprobados: boolean
  /** La clave de cada recibo → su id (para decidir). */
  idDe: Record<string, string>
  aviso: AvisoDeEnvio | null
  /** La conexión de GoCardless no es de pruebas: por ahora no se envía (lo dice la función). */
  soloPruebas: boolean
  cifras: { titulo: string; valor: string; detalle: string; tono: Tono }[]
  seguimiento: FilaSeguimiento[]
  /** Los pasos de arriba: Revisar · Enviar el cobro · Cobrado · Facturado; cuántos hechos. */
  pasosHechos: number
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const fechaLarga = (f: string) => `${Number(f.slice(8, 10))} de ${MESES[Number(f.slice(5, 7)) - 1]}`
const importeDe = (f: FilaRecibo) => f.cobrar_cent ?? f.total_cent

/** La fila de la base, con la forma de los núcleos. El mandato ya va en «parado» (lo pone el servidor al preparar). */
export function enRevision(f: FilaRecibo, empresaId: string, mes: string): ReciboEnRevision {
  return {
    recibo: {
      clave: f.clave, clienteId: f.cliente_id, empresaId, mes, lineas: f.lineas ?? [], totalCent: importeDe(f),
      anteriorCent: f.anterior_cent, cambios: f.cambios ?? [], igualQueElMesPasado: (f.cambios ?? []).length === 0 && f.anterior_cent !== null,
      pideClic: f.pide_clic, parado: f.parado ?? [],
    },
    cliente: f.cliente, mandato: { vale: true }, decision: f.decision,
  }
}

const DETALLE: Partial<Record<EstadoDelRecibo, (f: FilaRecibo) => string>> = {
  enviado: (f) => (f.cargo_el ? `Cargo el ${fechaLarga(f.cargo_el)}` : 'En GoCardless, camino del banco'),
  en_el_banco: () => 'Su banco aún no ha respondido',
  cobrado: (f) => (f.confirmado_el ? fechaLarga(f.confirmado_el) : 'Confirmado'),
  facturado: (f) => (f.confirmado_el ? fechaLarga(f.confirmado_el) : 'Confirmado'),
  devuelto: () => 'No se ha podido cobrar',
  retrocedido: () => 'El cliente lo reclamó a su banco',
  cancelado: () => 'Cancelado en GoCardless',
}

function facturaDe(f: FilaRecibo): string {
  if (f.estado === 'devuelto') return f.factura ? `${f.factura} · se deshace el cobro` : 'Sin factura · pasa a «Te deben»'
  if (f.estado === 'retrocedido') return f.factura ? `${f.factura} · se deshace el cobro` : 'Sin factura'
  if (f.factura) return f.factura
  if (f.estado === 'cancelado') return 'Sin factura'
  return 'Cuando se cobre'
}

/** El cobro de un mes de una empresa, para pintar. `ahora`: para «Enviado el … a las …» (hora de Madrid). */
export function modeloCobro(d: DatosCobro, empresa: { id: string; nombre: string }, mes: string): ModeloCobro {
  const diaAviso = Number(d.ajustes?.dia_aviso ?? 2)
  const diaCargo = Number(d.ajustes?.dia_cargo ?? 4)
  const antetitulo = `Cobro de ${nombreDelMes(mes)} · aviso al cliente el día ${diaAviso} · cargo el día ${diaCargo}`
  const filas = d.recibos ?? []
  const enviado = filas.some((f) => f.estado !== 'preparado')
  const entran = filas.filter((f) => f.decision !== 'este_mes_no')
  const xs = entran.map((f) => enRevision(f, empresa.id, mes))
  const fueraDeEsteCobro = filas.filter((f) => f.decision === 'este_mes_no').map((f) => enRevision(f, empresa.id, mes))
  const sinRecibo = d.mes?.sin_recibo ?? []
  const r = revision(xs, sinRecibo, !!d.mes?.iguales_aprobados)
  const avisoEl = d.mes?.aviso_el ?? `${mes}-${String(diaAviso).padStart(2, '0')}`
  const cargoEl = d.mes?.cargo_el ?? `${mes}-${String(diaCargo).padStart(2, '0')}`
  const aviso = enviado ? null : avisoDeEnvio(r, mes, empresa.nombre, avisoEl, cargoEl, filas.length)

  const enviados = filas.filter((f) => f.estado !== 'preparado')
  const cuenta = (es: EstadoDelRecibo[]) => enviados.filter((f) => es.includes(f.estado))
  const cobrados = cuenta(['cobrado', 'facturado'])
  const banco = cuenta(['enviado', 'en_el_banco'])
  const devueltos = cuenta(['devuelto', 'retrocedido'])
  const facturas = enviados.filter((f) => f.factura)
  const suma = (fs: FilaRecibo[]) => fs.reduce((s, f) => s + importeDe(f), 0)
  const cifras: ModeloCobro['cifras'] = [
    { titulo: 'Cobrados', valor: String(cobrados.length), detalle: euros(suma(cobrados)), tono: 'bien' },
    { titulo: 'Facturas', valor: String(facturas.length), detalle: 'con Verifactu', tono: 'neutro' },
    { titulo: 'En el banco', valor: String(banco.length), detalle: euros(suma(banco)), tono: 'neutro' },
    { titulo: 'Devueltos', valor: String(devueltos.length), detalle: devueltos.length ? euros(suma(devueltos)) : 'ninguno', tono: devueltos.length ? 'mal' : 'neutro' },
  ]
  const seguimiento: FilaSeguimiento[] = enviados
    .slice().sort((a, b) => a.cliente.localeCompare(b.cliente, 'es'))
    .map((f) => ({
      id: f.id, cliente: f.cliente, importe: euros(importeDe(f)), estado: ESTADO_EN_PALABRAS[f.estado].texto,
      detalle: DETALLE[f.estado]?.(f) ?? '', tono: ESTADO_EN_PALABRAS[f.estado].tono, factura: facturaDe(f),
    }))

  let enviadoTexto: string | null = null
  if (enviado && d.mes?.enviado_at) {
    const t = new Date(d.mes.enviado_at)
    const madrid = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(t)
    enviadoTexto = `Enviado el ${fechaLarga(madrid.slice(0, 10))} a las ${madrid.slice(11, 16)}${d.mes.enviado_por_name ? ` por ${d.mes.enviado_por_name}` : ''} · cargo el día ${diaCargo}`
  }
  const pasosHechos = !enviado ? 0 : cobrados.length + devueltos.length === enviados.length && enviados.length > 0 ? 4 : 2

  return {
    mes, antetitulo, vacio: filas.length === 0 && !d.mes, enviado, enviadoTexto, revision: r, fueraDeEsteCobro, aviso,
    igualesAprobados: !!d.mes?.iguales_aprobados, idDe: Object.fromEntries(filas.map((f) => [f.clave, f.id])),
    soloPruebas: !!d.conexion && d.conexion.entorno !== 'pruebas', cifras, seguimiento, pasosHechos,
  }
}
