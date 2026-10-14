// src/modules/conta/lib/notaClientes.ts
//
// Los clientes en el balance, según la norma (C06b, respuesta 6 de Julio,
// tarea 1). Un cliente con saldo acreedor es una DEUDA con él: va al pasivo
// («Otros acreedores» en el abreviado y en pymes, «Acreedores varios» en el
// normal) y no se compensa con lo que deben los demás clientes (PGC, primera
// parte, principio 5 «No compensación»; tercera parte, norma 6.ª.2). Lo hace
// el mapeo de serie, por el signo del saldo (20261111T0600).
//
// Aquí, solo lo que se dice:
//   · la nota de una línea bajo «Clientes» en el balance;
//   · la nota de la barra de la IA: la cifra de la LÍNEA OFICIAL de clientes
//     (la que se presenta), y cuántos clientes van al pasivo y cuánto suman.

import type { CuentaEnLinea, LineaCalculada, ResultadoEstado } from '@/modules/conta/lib/cuentasAnuales'

/** La nota bajo «Clientes», palabra por palabra de Julio. */
export const NOTA_CLIENTES_PASIVO = 'Los clientes a los que debes dinero van al pasivo, como dice el Plan Contable. Por eso esta cifra puede no coincidir con la de tu programa anterior.'

/** «1. Clientes por ventas y prestaciones de servicios», en los tres modelos (en el normal hay además la de grupo). */
export const esLineaClientes = (l: Pick<LineaCalculada, 'text' | 'side'>) => l.side === 'activo' && /^1\. Clientes por ventas/.test(l.text)

export interface NotaIa { titulo: string; texto: string; cuenta: string }

const esCliente = (c: CuentaEnLinea) => /^43[0-6]/.test(c.templateCode ?? c.code)
const sinNumero = (t: string) => t.replace(/^\d+\.\s*/, '').replace(/\.$/, '')

/**
 * La nota de la barra de la IA sobre los clientes, o null si ningún cliente
 * tiene saldo acreedor (no hay nada que decir). `euros` formatea (eurosExactos).
 */
export function notaClientes(actual: ResultadoEstado, euros: (n: number) => string): NotaIa | null {
  const enPasivo = actual.lineas.filter((l) => l.side === 'pn_pasivo').flatMap((l) => l.cuentas.filter(esCliente).map((c) => ({ c, linea: l })))
  if (!enPasivo.length) return null
  const clientes = actual.lineas.find(esLineaClientes)
  const n = enPasivo.length
  const suman = enPasivo.reduce((a, x) => a + x.c.importe, 0)
  const peor = enPasivo.reduce((a, x) => (x.c.importe > a.c.importe ? x : a))
  const donde = [...new Set(enPasivo.map((x) => `«${sinNumero(x.linea.text)}»`))].join(' y ')
  const titulo = clientes
    ? `«${sinNumero(clientes.text)}»: ${euros(clientes.importe)}. ${n} ${n === 1 ? 'cliente al que debes' : 'clientes a los que debes'} ${euros(suman)}, en el pasivo.`
    : `${n} ${n === 1 ? 'cliente al que debes' : 'clientes a los que debes'} ${euros(suman)}, en el pasivo.`
  const texto = `Van en ${donde}, como dice el Plan Contable: no se restan de lo que te deben los demás. Un cliente al que debes dinero no es lo normal: suele ser una liquidación asentada dos veces o un cobro sin su venta. Mira la ${peor.c.code}.`
  return { titulo, texto, cuenta: peor.c.code }
}
