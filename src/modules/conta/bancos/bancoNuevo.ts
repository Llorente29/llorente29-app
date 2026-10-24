// src/modules/conta/bancos/bancoNuevo.ts
//
// S01d · «+ Nuevo banco o tarjeta»: dar de alta un banco que aún no está en el
// plan (bank_cuenta_nueva), sin pasar por una subcuenta 572 que no existe. Es
// la salida del círculo de «Dar de alta un banco» (encargo S01b, 18/10): sin
// ningún banco, todos los enlaces mandaban a Cuentas y extractos, y allí solo
// se podía dar de alta desde una cuenta del plan… que no había.
//
// Sin React: lo que se comprueba antes de llamar a la base y lo que se dice en
// pantalla después (regla 8: «dado de alta» con su subcuenta, no un «Hecho»).

import { formatearIban, normalizarIban, validarIban } from '@/modules/conta/lib/iban'

export type TipoBancoNuevo = 'bank' | 'card'

/** El parámetro de la dirección que abre el diálogo al llegar a Cuentas y extractos. */
export const PARAM_NUEVO = 'nuevo'
export const VALOR_NUEVO = 'banco'
export const ACCION_NUEVO = '+ Nuevo banco o tarjeta'

export interface FormBancoNuevo { tipo: TipoBancoNuevo; nombre: string; iban: string }

export type Comprobado =
  | { ok: true; nombre: string; iban: string | null }
  | { ok: false; motivo: string }

/**
 * Lo que se comprueba en el navegador antes de llamar a la base: un nombre, y
 * para un banco su IBAN (la base lo exige igual: bank_cuenta_alta, 23514). El
 * IBAN se manda sin espacios y en mayúsculas; a una tarjeta no se le pide, pero
 * si se escribe tiene que estar bien.
 */
export function comprobarBancoNuevo(f: FormBancoNuevo): Comprobado {
  const nombre = f.nombre.trim().replace(/\s+/g, ' ')
  if (!nombre) return { ok: false, motivo: f.tipo === 'bank' ? 'Escribe el nombre del banco.' : 'Escribe el nombre de la tarjeta.' }
  const iban = normalizarIban(f.iban)
  if (!iban) {
    return f.tipo === 'bank'
      ? { ok: false, motivo: 'Un banco necesita su IBAN: lo trae su extracto, o lo ves en la app del banco.' }
      : { ok: true, nombre, iban: null }
  }
  const v = validarIban(iban)
  return v.ok ? { ok: true, nombre, iban: v.normalizado } : { ok: false, motivo: v.motivo }
}

/** «Nuevo banco con este IBAN (ES91 2100 …)» para la cuenta de un extracto que no es de ningún banco. */
export function textoNuevoConIban(iban: string | null): string {
  const n = normalizarIban(iban ?? '')
  return n ? `Nuevo banco con este IBAN (${formatearIban(n)})` : 'Nuevo banco para esta cuenta'
}

/** Las cuentas de un fichero cuyo IBAN no es de ningún banco de Folvy (ni recordado). */
export function ibanSinBanco(iban: string | null, bancos: { iban: string | null; ibanes: string[] }[]): boolean {
  const n = normalizarIban(iban ?? '')
  if (!n) return true
  return !bancos.some((b) => normalizarIban(b.iban ?? '') === n || b.ibanes.some((x) => normalizarIban(x) === n))
}

/**
 * La confirmación en pantalla, con lo que ha hecho la base (su `porque`):
 * «Banco Santander dado de alta. Nueva subcuenta 57200003 · Bancos · Banco
 * Santander, enlazada al banco.» Sin plan activado, el porqué lo explica.
 */
export function textoBancoNuevo(r: { tipo: TipoBancoNuevo; nombre: string; porque: string; local?: string | null; comun?: boolean }): string {
  const nombre = r.nombre.trim()
  const de = r.local ? `, del local ${r.local}` : r.comun ? ', común a todos los locales' : ''
  const hecho = r.tipo === 'bank' ? `${nombre} dado de alta${de}.` : `Tarjeta ${nombre} dada de alta${de}.`
  const porque = r.porque.trim()
  return porque ? `${hecho} ${porque}` : hecho
}

/** El error de la base, sin el nombre de la función delante (la frase ya es para la persona). */
export function mensajeDeAlta(e: unknown): string {
  const t = e instanceof Error ? e.message : String(e)
  return t.replace(/^bank_cuenta_(nueva|alta):\s*/, '')
}
