// src/modules/conta/impuestos/anual.ts
//
// S02 · Los modelos del año (390, 190, 180, 347 y 349), lo que no es pantalla:
// qué año se abre por defecto, la tarjeta de cada modelo en la tira, qué
// falta para tener el fichero y los perceptores del 190 en el orden en que se
// enseñan. La tira y la ficha son las del trimestre (TrimestrePage): aquí solo
// lo que cambia en un modelo anual informativo, que no se paga.

import { eurosExactos } from '@/modules/conta/lib/formato'
import type { Perceptor190 } from '@/modules/conta/services/impuestosService'
import { estaPresentada, tarjeta, type ModeloTrimestre } from './trimestre'

/** Los modelos anuales que Sumied calcula hoy. Los demás se presentan fuera y se apuntan con su CSV. */
export const CALCULA_SUMIED: ReadonlySet<string> = new Set(['190'])

/** Los anuales se presentan en enero y febrero del año siguiente: hasta febrero se abre el año anterior. */
export function ejercicioPorDefecto(hoy: string): number {
  const y = Number(hoy.slice(0, 4))
  return Number(hoy.slice(5, 7)) <= 2 ? y - 1 : y
}

/**
 * La tarjeta de la tira: la del trimestre, pero sin «0,00 €» de un modelo que
 * no se paga. En el 190 calculado, lo retenido en el año ([03]).
 */
export function tarjetaAnual(m: ModeloTrimestre, hoy: string, ejercicio: number, desde?: string | null): ReturnType<typeof tarjeta> {
  const t = tarjeta(m, hoy, ejercicio, desde)
  const c03 = m.declaracion?.casillas.find((c) => c.casilla === '03')?.valor ?? null
  const importe = m.modelo === '190' && c03 !== null ? `${eurosExactos(c03)} retenidos` : '—'
  // Un informativo calculado sale «cero»: no es «Para revisar 0,00 €», es para revisar.
  return { ...t, importe }
}

/** Qué falta para presentar un modelo anual, en palabras, si no está presentado. */
export function queFaltaAnual(m: ModeloTrimestre): { titulo: string; texto: string; calcula: boolean } {
  const d = m.declaracion
  if (CALCULA_SUMIED.has(m.modelo)) {
    if (!d || d.estado === 'pending') {
      return {
        titulo: `Falta calcular el ${m.modelo} del año`,
        texto: 'Sumied lo calcula con los 111 del año: cada proveedor con retención y cada trabajador con nómina, con su NIF, su provincia y lo retenido. Después comprueba que suma lo mismo que los 111.',
        calcula: true,
      }
    }
    return { titulo: 'Calculado', texto: '', calcula: true }
  }
  return {
    titulo: `Sumied aún no calcula el ${m.modelo}`,
    texto: 'Mientras, preséntalo fuera y apúntalo aquí con su CSV: queda presentado y con candado.',
    calcula: false,
  }
}

type Check = { resultado: 'ok' | 'warning' | 'error'; aceptado: boolean }

/** Por qué no se puede bajar el fichero todavía; null si se puede. */
export function porQueNoFichero(m: ModeloTrimestre, checks: readonly Check[] | null): string | null {
  const d = m.declaracion
  if (!d || d.estado === 'pending' || d.resultado === null) return 'Primero hay que calcularlo.'
  if (estaPresentada(d.estado)) return null
  if (!checks) return 'Leyendo lo comprobado…'
  const errores = checks.filter((c) => c.resultado === 'error').length
  if (errores > 0) return `Para bajar el fichero falta resolver ${errores === 1 ? 'una cosa' : `${errores} cosas`} de «Lo comprobado».`
  const avisos = checks.filter((c) => c.resultado === 'warning' && !c.aceptado).length
  if (avisos > 0) return `Antes, mira ${avisos === 1 ? 'el aviso' : `los ${avisos} avisos`} de «Lo comprobado» y dalo por bueno si lo está.`
  return null
}

/**
 * Los perceptores del 190 en el orden en que se enseñan: primero los que
 * tienen algo que corregir (sin NIF que valga, sin provincia o sin
 * trabajador), después el resto por clave y nombre. No se esconde ninguno
 * (regla 7): el orden y la etiqueta lo dicen.
 */
export function perceptoresEnOrden(lista: readonly Perceptor190[]): (Perceptor190 & { falta: string[] })[] {
  const conFalta = lista.map((p) => {
    const falta: string[] = []
    if (p.sin_trabajador) falta.push('sin trabajador')
    else {
      if (!p.nif) falta.push('sin NIF')
      else if (!p.nif_valido) falta.push('NIF que no vale')
      if (!p.provincia) falta.push('sin provincia')
    }
    return { ...p, falta }
  })
  return conFalta.sort((a, b) => (b.falta.length > 0 ? 1 : 0) - (a.falta.length > 0 ? 1 : 0)
    || a.clave.localeCompare(b.clave) || (a.nombre ?? '').localeCompare(b.nombre ?? '', 'es'))
}

/** La clave del 190 en palabras de oficina (de las claves del anexo de la Orden EHA/3127/2009). */
export function claveEnPalabras(clave: string, subclave: string | null): string {
  const c: Record<string, string> = {
    A: 'Empleado por cuenta ajena',
    E: 'Consejero o administrador',
    G: 'Actividad profesional',
    L: 'Rentas exentas',
  }
  const sub = clave === 'G' && subclave === '03' ? ' · tipo reducido de inicio'
    : clave === 'L' && subclave === '05' ? ' · indemnización por despido o cese exenta' : ''
  return `${c[clave] ?? `Clave ${clave}`}${sub}`
}

/**
 * Una línea «sin trabajador» del 190, en palabras: lo que el diario paga y no
 * está en ninguna nómina por trabajador. Las nóminas (640, clave A) y las
 * indemnizaciones exentas (641, clave L.05) se dicen por separado.
 */
export function sinTrabajadorEnPalabras(p: Pick<Perceptor190, 'clave' | 'subclave'>): { titulo: string; apoyo: string } {
  if (p.clave === 'L') {
    return { titulo: 'Indemnizaciones sin trabajador', apoyo: 'Las indemnizaciones exentas del diario (la 641) que no están en ninguna nómina por trabajador' }
  }
  return { titulo: 'Nóminas sin trabajador', apoyo: 'Lo que el diario paga en nóminas (la 640) y no está en ninguna nómina por trabajador' }
}
