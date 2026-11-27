// src/modules/conta/gestoria/x35/escapa.ts
//
// X35 · PR 2 · «Cobrado y sin cobrar» (seis meses) y «Dónde se te escapa el dinero», de la maqueta aprobada. Puro: sin
// base ni pantalla. No calcula nada nuevo:
//   · Cobrado de cada mes: los recibos de GoCardless cobrados en ese mes, con los mismos estados que la fila «GoCardless»
//     del cuadre de «Facturas del mes» (COBRADO_GC).
//   · Sin cobrar de cada mes: «Te deben» del R20 (lo que GoCardless no cobró, sin cobrar después y, cruzado con el banco,
//     sin pagar por transferencia), repartido por el mes de cada recibo.
//   · Las tarjetas: las listas del R20b tal cual («Pagado después por el banco», el TPV sin asignar) y el tramo de «Te
//     deben» de más de 90 días.
// Cada cifra lleva su lista, y la cifra ES su suma. Sin «Te deben» fiable (sin cruzar con el banco), no sale nada de esto.

import { euros, lista, nombreDelMes, type Lista, type NoCobrado } from '../../../../../supabase/functions/_shared/tarifa/cifras'
import { COBRADO_GC } from '../../../../../supabase/functions/_shared/cegidMandar'
import { mesDe } from './modelo'

export interface CobroGc { gcId: string; fecha: string; importe: number; estado: string; nombre: string | null }
export interface MesDeLaGrafica {
  mes: string
  nombre: string
  cobrado: Lista
  sinCobrar: Lista
  /** El % que sigue sin cobrar (una cifra, con una coma). */
  pct: string
}
export interface Tarjeta { id: 'pagadoDespues' | 'sinPagar' | 'tarjeta'; cifra: string; titulo: string; texto: string; tono: 'bien' | 'mal' | 'neutro'; lista: Lista }
export interface DondeSeEscapa { frase: string; tarjetas: Tarjeta[]; nota: string | null }

const CORTO = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
const plural = (n: number, uno: string, varios: string) => `${n.toLocaleString('es-ES')} ${n === 1 ? uno : varios}`
const pctDe = (sin: number, total: number) => (total ? `${(Math.round((sin / total) * 1000) / 10).toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %` : '—')

/** Los seis meses que acaban en el de hoy. */
export const seisMeses = (hoy: string) => [-5, -4, -3, -2, -1, 0].map((n) => mesDe(hoy.slice(0, 7), n))

export function grafica(hoy: string, cobros: readonly CobroGc[], nc: NoCobrado): MesDeLaGrafica[] {
  return seisMeses(hoy).map((mes) => {
    const cobrado = lista(`Cobrado por GoCardless en ${nombreDelMes(mes)}`, cobros
      .filter((c) => c.fecha.slice(0, 7) === mes && (COBRADO_GC as readonly string[]).includes(c.estado))
      .map((c) => ({ id: c.gcId, texto: c.nombre ?? c.gcId, detalle: `Cobrado el ${Number(c.fecha.slice(8, 10))}/${Number(c.fecha.slice(5, 7))}`, importeCent: Math.round(c.importe * 100), fichaId: null, fecha: c.fecha })))
    const sinCobrar = lista(`Sin cobrar de ${nombreDelMes(mes)}`, nc.lista.filas.filter((f) => (f.fecha ?? '').slice(0, 7) === mes))
    return { mes, nombre: CORTO[Number(mes.slice(5, 7)) - 1], cobrado, sinCobrar, pct: pctDe(sinCobrar.totalCent, cobrado.totalCent + sinCobrar.totalCent) }
  })
}

export function dondeSeEscapa(nc: NoCobrado): DondeSeEscapa {
  const pagado = nc.pagadoPorElBanco ?? lista('Pagado después por el banco', [])
  const viejos = nc.tramos.find((t) => t.texto === 'Más de 90 días')?.lista ?? lista('', [])
  const tarjeta = nc.tarjetaSinAsignar ?? lista('Cobrado con tarjeta, sin saber de quién', [])
  const recibos = nc.lista.filas.length + pagado.filas.length
  const total = nc.lista.totalCent + pagado.totalCent
  const clientesViejos = new Set(viejos.filas.map((f) => f.fichaId ?? f.id)).size
  const desde = [...nc.lista.filas, ...pagado.filas].map((f) => f.fecha ?? '').filter(Boolean).sort()[0] ?? null
  return {
    frase: `${desde ? `Desde ${nombreDelMes(desde)} de ${desde.slice(0, 4)} · ` : ''}GoCardless no cobró ${plural(recibos, 'recibo', 'recibos')}, ${euros(total)} · cruzado con las transferencias del banco`,
    tarjetas: [
      { id: 'pagadoDespues', cifra: euros(pagado.totalCent), titulo: 'Pagado después por transferencia', tono: 'bien', lista: pagado,
        texto: `${plural(pagado.filas.length, 'recibo', 'recibos')}: GoCardless no lo cobró, pero llegó al banco a nombre del cliente. Sumied lo casa solo.` },
      { id: 'sinPagar', cifra: plural(clientesViejos, 'cliente', 'clientes'), titulo: 'Sin pagar desde hace más de 90 días', tono: 'mal', lista: { ...viejos, titulo: 'Sin pagar desde hace más de 90 días' },
        texto: `${euros(viejos.totalCent)}: ni GoCardless ni transferencia. Está dentro de «Te deben».` },
      { id: 'tarjeta', cifra: euros(tarjeta.totalCent), titulo: 'Cobrado con tarjeta, sin saber de quién', tono: 'neutro', lista: tarjeta,
        texto: `${plural(tarjeta.filas.length, 'abono', 'abonos')} del TPV. Con su detalle, Sumied sabrá qué impagados están pagados.` },
    ],
    nota: tarjeta.filas.length ? 'Falta el detalle del TPV: hasta tenerlo, la deuda real no se puede cerrar cliente a cliente.' : null,
  }
}
