// src/modules/conta/nucleo/bancos/mes.ts
//
// E05b · El periodo de Bancos, como ERP10 («Introducción de asientos por
// tesorería»: el periodo junto a la subcuenta del banco). Qué mes se enseña y qué
// se lee de cada uno, con la regla de la pantalla de hoy (bancos/Movimientos.tsx):
//   · el corte: el fin del mes, o hoy si el mes no ha acabado;
//   · el saldo del banco: el del último extracto del banco que acaba dentro del mes y trae saldo;
//   · Re Pág, el mes de antes; Av Pág, el de después (la lista va del más nuevo al más viejo).
// Núcleo puro: lo prueba tests/conta/e05b-bancos.

import { limitesMes, nombreMes } from '@/modules/conta/lib/bancosVista'

/** La fecha de corte de un mes: su último día, o hoy si aún no ha acabado. */
export function corteDelMes(mes: string, hoy: string): string {
  const { hasta } = limitesMes(mes)
  return hasta < hoy ? hasta : hoy
}

/**
 * El extracto que da el saldo del banco en ese mes: el primero del banco que acaba dentro del mes y trae
 * saldo, en el orden en que llegan (leerDatosBancos: del más reciente al más viejo). Es el `.find` de la
 * pantalla de hoy, tal cual (regla 31: la misma vara).
 */
export function extractoDelMes<T extends { cuentaId: string; hasta: string; saldoFinalCent: number | null }>(extractos: readonly T[], bancoId: string, mes: string): T | null {
  const { hasta } = limitesMes(mes)
  return extractos.find((e) => e.cuentaId === bancoId && e.hasta <= hasta && e.saldoFinalCent !== null) ?? null
}

/** Re Pág: el mes de antes; Av Pág: el de después. En los extremos se queda donde está. */
export function mesDeAlLado(meses: readonly string[], mes: string, tecla: 'PageUp' | 'PageDown'): string {
  const i = meses.indexOf(mes)
  if (i < 0) return mes
  const j = tecla === 'PageUp' ? i + 1 : i - 1
  return meses[j] ?? mes
}

/** «Octubre 2026». */
export const textoMes = (mes: string): string => `${nombreMes(mes)} ${mes.slice(0, 4)}`
