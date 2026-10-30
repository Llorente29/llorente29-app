// src/modules/conta/lib/pagoDeModelo.ts
//
// S01d · Lo que no es pantalla del pago de un modelo: los periodos que se
// pueden elegir y la frase de lo que queda por pagar.

import { eurosExactos } from '@/modules/conta/lib/formato'
import type { ModeloPagado } from '@/modules/conta/services/diarioService'

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** Los trimestres, los meses y el año entero, como los guarda la base («3T», «01», «0A»). */
export function opcionesDePeriodo(): { valor: string; texto: string }[] {
  return [
    ...['1T', '2T', '3T', '4T'].map((t) => ({ valor: t, texto: `${t[0]}.º trimestre (${t})` })),
    ...MESES.map((m, i) => ({ valor: String(i + 1).padStart(2, '0'), texto: m[0].toUpperCase() + m.slice(1) })),
    { valor: '0A', texto: 'El año entero' },
  ]
}

/**
 * Lo que queda del modelo cuando se valide este asiento: «El 111 · 2T 2026 es
 * de 661,33 €: al validar este asiento quedarán 306,99 € por pagar». Sin
 * declaración en Sumied, dice solo lo pagado.
 */
export function queQuedaPorPagar(p: Pick<ModeloPagado, 'texto' | 'importe' | 'pagado' | 'pendiente'>, esteApunte: number): string {
  const tras = Math.round((p.pagado + esteApunte) * 100) / 100
  if (p.importe === null || p.pendiente === null) {
    return `No tengo la declaración del ${p.texto} en Sumied: no puedo decir lo que queda.`
  }
  const queda = Math.round((p.importe - tras) * 100) / 100
  if (queda === 0) return `El ${p.texto} es de ${eurosExactos(p.importe)}: al validar este asiento queda pagado.`
  if (queda > 0) return `El ${p.texto} es de ${eurosExactos(p.importe)}: al validar este asiento quedarán ${eurosExactos(queda)} por pagar.`
  return `El ${p.texto} es de ${eurosExactos(p.importe)}: con este asiento se habrán pagado ${eurosExactos(-queda)} de más.`
}

/** Una declaración presentada y sin pagar, como la lee la propuesta. */
export interface DeclaracionSinPagar { modelo: string; ejercicio: number; periodo: string; importeCent: number }

/**
 * S01d-b · Lo que se propone al abrir «Es el pago de un modelo» (respuesta 3):
 * el modelo de la cuenta (withholding_model; si no lo dice, el 111) y el
 * periodo del modelo presentado y sin pagar por ese mismo importe; si no hay
 * ninguno, el trimestre anterior a la fecha del asiento.
 */
export function propuestaDePago(modeloDeLaCuenta: string | null, declaraciones: readonly DeclaracionSinPagar[], importeCent: number, fecha: string):
  { modelo: '111' | '115' | '123'; ejercicio: number; periodo: string; porque: string } {
  const modelo = (['111', '115', '123'] as const).find((m) => m === modeloDeLaCuenta) ?? '111'
  const igual = declaraciones.filter((d) => d.modelo === modelo && d.importeCent === importeCent)
  if (igual.length === 1) {
    return { modelo, ejercicio: igual[0].ejercicio, periodo: igual[0].periodo, porque: `el ${modelo} presentado y sin pagar por ese importe` }
  }
  const anio = Number(fecha.slice(0, 4)), mes = Number(fecha.slice(5, 7))
  const t = Math.ceil(mes / 3)
  return t === 1
    ? { modelo, ejercicio: anio - 1, periodo: '4T', porque: 'el trimestre anterior a la fecha del asiento' }
    : { modelo, ejercicio: anio, periodo: `${t - 1}T`, porque: 'el trimestre anterior a la fecha del asiento' }
}
