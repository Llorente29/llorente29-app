// src/modules/conta/lib/notaClientes.ts
//
// C06b, punto 1 · Lo que dice la barra de la IA de los clientes con saldo
// acreedor. La cifra del título es la de la LÍNEA OFICIAL del balance
// («1. Clientes por ventas y prestaciones de servicios»), la misma que se
// presenta y la misma que da Diez, no la suma suelta de las 430 que están en
// negativo: esa suma no sale en ningún estado y no se puede cotejar con nada.
//
// Por qué la línea compensa a los clientes acreedores con los deudores: lo
// hace el mapeo de serie (430–436 a la línea, sin «por saldo»), como Diez.
// La norma, literal, no lo pide así —PGC, primera parte, principio de no
// compensación, y tercera parte, norma 6.ª.2—; está en el informe del C06b.
// Aquí solo se dice cuántos hay dentro, y cuál mirar primero.

import type { CuentaEnLinea, ResultadoEstado } from '@/modules/conta/lib/cuentasAnuales'

export interface NotaIa { titulo: string; texto: string; cuenta: string }

const esCliente = (c: CuentaEnLinea) => (c.templateCode ?? c.code).startsWith('43')

/** La nota de clientes en negativo, o null si no hay ninguno. `euros` formatea (eurosExactos en pantalla). */
export function notaClientes(actual: ResultadoEstado, euros: (n: number) => string): NotaIa | null {
  const linea = actual.lineas.find((l) => l.cuentas.some((c) => c.anomalo && esCliente(c)))
  if (!linea) return null
  const negativos = linea.cuentas.filter((c) => c.anomalo && esCliente(c))
  const peor = negativos.reduce((a, c) => (c.importe < a.importe ? c : a))
  const n = negativos.length
  const dentro = `${n} ${n === 1 ? 'cliente' : 'clientes'} con saldo acreedor`
  const nombre = linea.text.replace(/^\d+\.\s*/, '').replace(/\.$/, '')
  const titulo = linea.importe < 0
    ? `Clientes en negativo: «${nombre}» suma ${euros(linea.importe)}.`
    : `«${nombre}»: ${euros(linea.importe)}, con ${dentro} dentro.`
  const texto = `${linea.importe < 0 ? `Dentro hay ${dentro}. ` : ''}Un saldo acreedor en un cliente no es normal: suele ser una liquidación asentada dos veces o un cobro sin su venta. La línea los compensa con los demás clientes, como Diez. Mira la ${peor.code}.`
  return { titulo, texto, cuenta: peor.code }
}
