// src/modules/conta/services/inicioService.ts
//
// C06 · Lo que lee el Inicio del producto vendido solo. Todo sale de lo que ya
// existe (encargo C06, 3: «las cifras que hoy se pueden calcular de verdad»):
//   · los saldos del libro a fin de cada mes (conta_saldos_cuentas), para las
//     tres tarjetas de saldo y sus barritas;
//   · el IVA del trimestre (movimientoIva, sin la liquidación);
//   · el próximo pago de las facturas de proveedor (calcularCifras);
//   · lo que hizo lo automático desde ayer (asientos y registro de la IA);
//   · el cierre del mes anterior (fuenteCierre + pasosCierre, como el Libro).
// Lo que falla en una pieza se dice en esa pieza; no tumba el Inicio.

import { tabla, mensaje } from '@/modules/conta/services/bd'
import { saldosCuentas, aSaldoCuenta, movimientoIva } from '@/modules/conta/services/librosService'
import { leerAsientos, leerCierres, fuenteCierre } from '@/modules/conta/services/diarioService'
import { listarFacturasDeLaCuenta } from '@/modules/conta/services/proveedorService'
import { calcularCifras } from '@/modules/conta/lib/cifras'
import { esFirmaAutomatica } from '@/modules/conta/lib/autor'
import { pasosCierre, type PasoCierre, type CierreMes } from '@/modules/conta/lib/diario'
import { finDeMes, mesesHasta, puntoDeMes, trimestreDe, type PuntoMes } from '@/modules/conta/lib/inicio'

type Fila = Record<string, unknown>

/** Los saldos a fin de cada uno de los seis meses que acaban en `mes`. Un mes sin ejercicio, null. */
export async function puntosDeSaldo(companyId: string, mes: string, hoy: string): Promise<(PuntoMes | null)[]> {
  return Promise.all(mesesHasta(mes, 6).map(async (m) => {
    const hasta = finDeMes(m) < hoy ? finDeMes(m) : hoy
    if (m > hoy) return null
    try {
      const s = await saldosCuentas(companyId, m, hasta)
      return puntoDeMes(m, s.map((x) => aSaldoCuenta(x, 'balance')))
    } catch {
      return null
    }
  }))
}

/** IVA del trimestre del mes: repercutido (477) − soportado (472), hasta hoy. */
export async function ivaDelTrimestre(accountId: string, companyId: string, mes: string, hoy: string) {
  const t = trimestreDe(mes)
  const hasta = t.hasta < hoy ? t.hasta : hoy
  const [repercutido, soportado] = await Promise.all([
    movimientoIva(accountId, companyId, 'issued', t.desde, hasta),
    movimientoIva(accountId, companyId, 'received', t.desde, hasta),
  ])
  return { trimestre: t.nombre, repercutido, soportado, aPagar: Math.round((repercutido - soportado) * 100) / 100 }
}

/** El IVA de cada uno de los seis meses que acaban en `mes` (477 − 472 del mes), para las barritas. */
export async function ivaPorMes(accountId: string, companyId: string, mes: string, hoy: string): Promise<(number | null)[]> {
  return Promise.all(mesesHasta(mes, 6).map(async (m) => {
    if (m > hoy) return null
    const hasta = finDeMes(m) < hoy ? finDeMes(m) : hoy
    try {
      const [r, s] = await Promise.all([movimientoIva(accountId, companyId, 'issued', m, hasta), movimientoIva(accountId, companyId, 'received', m, hasta)])
      return Math.round((r - s) * 100) / 100
    } catch { return null }
  }))
}

/** La fecha del próximo pago a proveedores (o la más vieja vencida), o null si no hay ninguno pendiente con fecha. */
export async function proximoPago(accountId: string, hoy: string): Promise<string | null> {
  const f = await listarFacturasDeLaCuenta(accountId)
  return calcularCifras(f, hoy).proximoPago?.fecha ?? null
}

export interface HechoDesdeAyer { asientosSolos: number; asientosParaRevisar: number; datosDeLaEmpresa: number }

/** Lo que hizo lo automático desde ayer a las 00:00 de Madrid. */
export async function hechoDesdeAyer(companyId: string, desde: string): Promise<HechoDesdeAyer> {
  const [validados, propuestos, ia] = await Promise.all([
    tabla('journal_entry').select('validated_by_name').eq('company_id', companyId).gte('validated_at', desde).eq('status', 'validado'),
    tabla('journal_entry').select('id', { count: 'exact', head: true }).eq('company_id', companyId).gte('created_at', desde).eq('status', 'propuesto').is('created_by', null),
    tabla('ai_action_log').select('id', { count: 'exact', head: true }).eq('company_id', companyId).gte('done_at', desde).is('undone_at', null),
  ])
  for (const r of [validados, propuestos, ia]) if (r.error) throw new Error(mensaje('No se ha podido leer lo que he hecho', r.error))
  return {
    asientosSolos: ((validados.data ?? []) as Fila[]).filter((f) => esFirmaAutomatica(typeof f.validated_by_name === 'string' ? f.validated_by_name : null)).length,
    asientosParaRevisar: propuestos.count ?? 0,
    datosDeLaEmpresa: ia.count ?? 0,
  }
}

/** El cierre de un mes: sus pasos (los del Libro diario) y si ya está cerrado. */
export async function cierreDelMes(accountId: string, companyId: string, mes: string): Promise<{ pasos: PasoCierre[]; cierres: CierreMes[] }> {
  const [asientos, cierres] = await Promise.all([leerAsientos(accountId, companyId, mes, finDeMes(mes)), leerCierres(accountId, companyId)])
  const f = await fuenteCierre(accountId, companyId, mes, asientos, cierres.some((c) => c.mes === mes))
  return { pasos: pasosCierre(f), cierres }
}

/** Ayer a las 00:00 de Madrid, en ISO con su desfase (regla 4). */
export function ayerEnMadrid(hoy: string): string {
  const [y, m, d] = hoy.split('-').map(Number)
  const ayer = new Date(Date.UTC(y, m - 1, d - 1, 12))
  const dia = ayer.toISOString().slice(0, 10)
  // El desfase de Madrid ese día (+01:00 o +02:00), sacado del propio Intl.
  const hora = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', hourCycle: 'h23' }).format(ayer))
  const desfase = hora - 12
  return `${dia}T00:00:00+0${desfase}:00`
}
