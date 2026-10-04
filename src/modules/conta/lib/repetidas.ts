// src/modules/conta/lib/repetidas.ts
//
// C01b §4 · Factura REPETIDA: una factura del mismo proveedor con el mismo
// número e importe que otra se marca «¿Repetida?» y NO se apunta (no cuenta en
// «Le debes», «Le has comprado», próximo pago…) hasta que la persona decide.
//
// Por qué número E importe, y no solo número (población real, regla 31: los
// 179 números de albarán de Foodint, tests/unit/modules/conta/datos/):
//   · Hay proveedores que repiten número de verdad («T2826/1092», «AV260559511»
//     salen dos veces) y otros que ponen «0», «01» o «sn» en todos.
//   · Un número que no es número («0», «sn», «s/n», «-») no sirve para casar
//     nada: con esos, nunca se marca repetida solo por el número.
// La normalización es CONSERVADORA: mayúsculas y espacios. No quita barras ni
// guiones («03-140726» y «03 12 06 2026» son de verdad distintos), porque
// casar dos facturas distintas como repetidas es peor que no ver una repetida:
// la segunda deja de apuntarse en silencio.

export interface FacturaParaRepetida {
  id: string
  number: string | null
  total: number | null
  status: string
  /** Cuándo entró en Folvy: la primera es la buena. */
  createdAt: string
  /** La persona dijo «no es repetida»: no se vuelve a marcar. */
  noRepetidaConfirmada?: boolean
}

export interface Repetida {
  /** La factura que estaba antes, con la que coincide. */
  deId: string
  explicacion: string
}

export const EXPLICACION_REPETIDA = 'Mismo número e importe que la de arriba. No la he apuntado.'

const SIN_NUMERO = /^(s\s*\/?\s*n|sin\s+n[uú]mero|-+|0+)$/i

/** El número para comparar, o null si no es un número de verdad. */
export function claveNumero(numero: string | null | undefined): string | null {
  const t = (numero ?? '').trim().replace(/\s+/g, ' ').toUpperCase()
  if (t === '' || SIN_NUMERO.test(t) || !/[0-9A-Z]/.test(t)) return null
  return t
}

const centimos = (x: number | null): number | null =>
  x === null || !Number.isFinite(x) ? null : Math.round(x * 100)

/**
 * Las repetidas de UN proveedor: id → con cuál coincide. Las anuladas no
 * cuentan ni como original ni como repetida.
 */
export function detectarRepetidas(facturas: readonly FacturaParaRepetida[]): Map<string, Repetida> {
  const res = new Map<string, Repetida>()
  const vivas = facturas
    .filter((f) => f.status !== 'anulada')
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  const vistas = new Map<string, FacturaParaRepetida>()
  for (const f of vivas) {
    const clave = claveNumero(f.number)
    const c = centimos(f.total)
    if (clave === null || c === null) continue
    const k = `${clave}|${c}`
    const antes = vistas.get(k)
    if (antes && !f.noRepetidaConfirmada) {
      res.set(f.id, { deId: antes.id, explicacion: EXPLICACION_REPETIDA })
    } else if (!antes) {
      vistas.set(k, f)
    }
  }
  return res
}
