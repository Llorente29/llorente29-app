// src/modules/conta/lib/fichaContrato.ts
//
// S01e · La ficha de cada préstamo o aplazamiento (tablero 5). Lo que no es
// pantalla: qué fila está pagada (por el cargo casado con su contrato y su
// fila, bank_match.contract_id y contract_due_date), la próxima, las cuatro
// cifras (lo que queda con su corto y su largo, la próxima cuota, las cuotas
// pagadas, los intereses que quedan) y lo que cambia al subir un cuadro nuevo.
// En céntimos. Sin inventar: lo que no se sabe se dice.

import type { ContratoVista, FilaCuadro } from '@/modules/conta/lib/contratos'

/** Un cargo del banco casado con una fila del cuadro. */
export interface PagoDeFila { fecha: string; asientoId: string | null; asiento: number | null; movimientoId: string; mesMovimiento: string; bancoId: string | null }
/** Un cargo del contrato que no se ha podido casar con su fila (el banco cobró otra cifra). */
export interface CargoSinCasar { movimientoId: string; fechaCargo: string; importeCent: number; bancoId: string | null }

export type EstadoFila =
  | { tipo: 'pagada'; pago: PagoDeFila }
  | { tipo: 'aclarar'; cargo: CargoSinCasar }
  | { tipo: 'proxima' }
  | { tipo: 'pendiente' }

export interface FilaFicha extends FilaCuadro { estado: EstadoFila }

/** Suma un número de meses a una fecha «AAAA-MM-DD» (el día se queda, recortado al último del mes). */
export function masMeses(fecha: string, meses: number): string {
  const [a, m, d] = fecha.split('-').map(Number)
  const total = a * 12 + (m - 1) + meses
  const anio = Math.floor(total / 12); const mes = total % 12 + 1
  const ultimo = new Date(Date.UTC(anio, mes, 0)).getUTCDate()
  return `${anio}-${String(mes).padStart(2, '0')}-${String(Math.min(d, ultimo)).padStart(2, '0')}`
}

/**
 * El estado de cada fila: «Pagada · asiento N» si un cargo está casado con
 * ella; «El banco cobró X: por aclarar» si hay un cargo del contrato de ese mes
 * sin casar; si no, la primera sin pagar desde hoy es la «Próxima» y las demás,
 * «Pendiente».
 */
export function filasDeLaFicha(cuadro: readonly FilaCuadro[], pagos: readonly PagoDeFila[], sinCasar: readonly CargoSinCasar[], hoy: string): FilaFicha[] {
  const pagada = new Map(pagos.map((p) => [p.fecha, p]))
  let proximaPuesta = false
  return cuadro.map((f) => {
    const p = pagada.get(f.fecha)
    if (p) return { ...f, estado: { tipo: 'pagada', pago: p } }
    const cargo = sinCasar.find((c) => c.fechaCargo.slice(0, 7) === f.fecha.slice(0, 7))
    if (cargo) return { ...f, estado: { tipo: 'aclarar', cargo } }
    if (!proximaPuesta && f.fecha >= hoy) { proximaPuesta = true; return { ...f, estado: { tipo: 'proxima' } } }
    return { ...f, estado: { tipo: 'pendiente' } }
  })
}

export interface CifrasFicha {
  /** Lo que queda por pagar: lo prestado o aplazado menos el capital de las cuotas pagadas (y lo amortizado de golpe). */
  quedaCent: number | null
  /** El capital de las cuotas sin pagar de los próximos 12 meses. */
  cortoCent: number
  /** El resto; null si el cuadro es parcial (faltan cuotas que no se conocen: no se inventa). */
  largoCent: number | null
  /** El cuadro no trae todas las cuotas: el corto es «al menos» y falta el año siguiente. */
  parcial: boolean
  anioQueFalta: number | null
  proxima: FilaCuadro | null
  pagadas: number
  filas: number
  cuotas: number
  ultimaFecha: string | null
  interesesQuedanCent: number
  interesesEsteAnioCent: number
}

/** Las cuatro cifras de arriba (tablero 5). */
export function cifrasDeLaFicha(c: Pick<ContratoVista, 'cuadro' | 'principalCent' | 'cuotas'>, filas: readonly FilaFicha[], hoy: string): CifrasFicha {
  const sinPagar = filas.filter((f) => f.estado.tipo !== 'pagada')
  const pagadas = filas.length - sinPagar.length
  const amortizadoCent = (c.cuadro ?? []).reduce((t, f) => t + (f.amortizadoAntesCent ?? 0), 0)
  const capitalPagadoCent = filas.filter((f) => f.estado.tipo === 'pagada').reduce((t, f) => t + f.capitalCent, 0)
  const cuotas = Math.max(c.cuotas ?? 0, filas.length)
  const parcial = cuotas > filas.length
  const hasta = masMeses(hoy, 12)
  const cortoCent = sinPagar.filter((f) => f.fecha < hasta).reduce((t, f) => t + f.capitalCent, 0)
  // Sin cuadro parcial, lo que queda es el capital de las filas sin pagar (cuadra con lo prestado por construcción).
  const quedaCent = c.principalCent === null ? null : c.principalCent - capitalPagadoCent - amortizadoCent
  const ultima = filas.at(-1)?.fecha ?? null
  return {
    quedaCent, cortoCent, largoCent: parcial || quedaCent === null ? null : quedaCent - cortoCent,
    parcial, anioQueFalta: parcial && ultima ? Number(ultima.slice(0, 4)) + 1 : null,
    proxima: filas.find((f) => f.estado.tipo === 'proxima') ?? sinPagar[0] ?? null,
    pagadas, filas: filas.length, cuotas, ultimaFecha: ultima,
    interesesQuedanCent: sinPagar.reduce((t, f) => t + f.interesesCent, 0),
    interesesEsteAnioCent: sinPagar.filter((f) => f.fecha.slice(0, 4) === hoy.slice(0, 4)).reduce((t, f) => t + f.interesesCent, 0),
  }
}

/** «Todas · 57», «Pagadas · 0», «Pendientes · 57». */
export type FiltroFicha = 'todas' | 'pagadas' | 'pendientes'
export function filtrarFilas(filas: readonly FilaFicha[], filtro: FiltroFicha): FilaFicha[] {
  if (filtro === 'pagadas') return filas.filter((f) => f.estado.tipo === 'pagada')
  if (filtro === 'pendientes') return filas.filter((f) => f.estado.tipo !== 'pagada')
  return [...filas]
}

/** Lo que queda después de cada fila: el que guarda la base, o el que sale de lo prestado. */
export function quedaDespues(c: Pick<ContratoVista, 'principalCent'>, cuadro: readonly FilaCuadro[]): (number | null)[] {
  let queda = c.principalCent
  return cuadro.map((f) => {
    if (queda !== null) queda -= f.capitalCent + (f.amortizadoAntesCent ?? 0)
    return f.pendienteCent ?? queda
  })
}

/**
 * Lo que cambia al subir un cuadro nuevo desde la ficha (antes de guardar).
 * En un aplazamiento entran las filas de después de la última que tiene. En un
 * préstamo se van las cuotas desde la primera del cuadro nuevo y entran las
 * suyas; si alguna de las que se irían está pagada, no se puede. Lo amortizado
 * de golpe es lo que falta para que cuadre: lo prestado menos el capital de las
 * que se quedan, menos el del cuadro nuevo.
 */
export function cambioDeCuadro(c: Pick<ContratoVista, 'tipo' | 'cuadro' | 'principalCent'>, nuevo: readonly FilaCuadro[], pagos: readonly PagoDeFila[]): {
  modo: 'anadir' | 'sustituir'; entran: FilaCuadro[]; seVan: FilaCuadro[]; pagadaQueSeIria: string | null; amortizadoCent: number | null
} {
  const tiene = c.cuadro ?? []
  if (c.tipo !== 'prestamo') {
    const ultima = tiene.at(-1)?.fecha ?? ''
    return { modo: 'anadir', entran: nuevo.filter((f) => f.fecha > ultima), seVan: [], pagadaQueSeIria: null, amortizadoCent: null }
  }
  const desde = nuevo[0]?.fecha ?? ''
  const seVan = tiene.filter((f) => f.fecha >= desde)
  const quedan = tiene.filter((f) => f.fecha < desde)
  const pagadaQueSeIria = pagos.map((p) => p.fecha).filter((x) => x >= desde).sort()[0] ?? null
  const capitalQueda = quedan.reduce((t, f) => t + f.capitalCent, 0)
  const capitalNuevo = nuevo.reduce((t, f) => t + f.capitalCent, 0)
  return {
    modo: 'sustituir', entran: [...nuevo], seVan, pagadaQueSeIria,
    amortizadoCent: c.principalCent === null ? null : c.principalCent - capitalQueda - capitalNuevo,
  }
}

/** El nombre del fichero del Excel del cuadro: «Cuadro · Préstamo BBVA 0830149268». */
export const nombreExcelCuadro = (nombre: string) => `Cuadro · ${nombre}`.replace(/[\\/:*?"<>|]/g, '-')
