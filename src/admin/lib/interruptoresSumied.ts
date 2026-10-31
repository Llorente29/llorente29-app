// src/admin/lib/interruptoresSumied.ts
//
// S01f · Los interruptores de Sumied de una cuenta (feature_flags conta,
// conta_impuestos y conta_laboral), tal como los enseña la ficha de la cuenta
// en la administración de la plataforma. Aquí solo lo que se puede probar
// sin pantalla: la regla «sin Contabilidad no hay Impuestos ni Laboral», la
// línea de estado de cada fila y las frases (regla 8: confirmar con contenido).

export type ClaveSumied = 'conta' | 'conta_impuestos' | 'conta_laboral'

export const CLAVES_SUMIED: readonly ClaveSumied[] = ['conta', 'conta_impuestos', 'conta_laboral']

/** El nombre de cada interruptor en palabras de todos los días. */
export const NOMBRE_INTERRUPTOR: Record<ClaveSumied, string> = {
  conta: 'Contabilidad',
  conta_impuestos: 'Impuestos',
  conta_laboral: 'Laboral',
}

export interface Interruptor {
  clave: ClaveSumied
  encendida: boolean
  /** ¿Hay fila en feature_flags? Sin fila, nunca se ha encendido. */
  existe: boolean
  /** Cuándo se cambió por última vez (updated_at). */
  cambiada: string | null
  /** El nombre de quien lo cambió, si consta (granted_by → platform_admins). */
  quien: string | null
  motivo: string | null
}

export interface DatosCuenta { asientos: number; facturasRecibidas: number; impuestos: number }

export const FRASE_BLOQUEADA = 'Enciende antes la contabilidad.'

/** «Impuestos» y «Laboral» no se encienden con «Contabilidad» apagada. */
export function bloqueada(i: Interruptor, todos: readonly Interruptor[]): boolean {
  if (i.clave === 'conta' || i.encendida) return false
  return !todos.some((x) => x.clave === 'conta' && x.encendida)
}

/** dd/mm/aaaa en Madrid. */
export function fechaCorta(iso: string): string {
  const p = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(new Date(iso))
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? ''
  return `${v('day')}/${v('month')}/${v('year')}`
}

/**
 * La línea gris de cada fila: «Encendida desde el 31/10/2026 por Julio · «Alta
 * de cliente nuevo»». Lo que no consta se dice («no consta quién», «sin motivo
 * apuntado»), no se calla (Julio, 31/10: las 6 filas de antes no tienen quién).
 */
export function lineaDeEstado(i: Interruptor): string {
  if (!i.existe || !i.cambiada) return i.encendida ? 'Encendida' : 'Apagada'
  const estado = `${i.encendida ? 'Encendida' : 'Apagada'} desde el ${fechaCorta(i.cambiada)}`
  const quien = i.quien ? ` por ${i.quien}` : ' · no consta quién'
  const motivo = i.motivo ? `«${i.motivo}»` : 'sin motivo apuntado'
  return `${estado}${quien} · ${motivo}`
}

const LO: Record<ClaveSumied, { cosa: string; encendida: string; apagada: string; sale: string; noSale: string }> = {
  conta: { cosa: 'la contabilidad', encendida: 'Encendida', apagada: 'Apagada', sale: 'Ya sale Sumied en su menú.', noSale: 'Sumied ya no sale en su menú.' },
  conta_impuestos: { cosa: 'los impuestos', encendida: 'Encendidos', apagada: 'Apagados', sale: 'Ya salen en su Sumied.', noSale: 'ya no salen en su Sumied.' },
  conta_laboral: { cosa: 'lo laboral', encendida: 'Encendido', apagada: 'Apagado', sale: 'Ya sale en su Sumied.', noSale: 'ya no sale en su Sumied.' },
}

function lista(xs: string[]): string {
  return xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`
}

export interface Cambio { clave: ClaveSumied; de: boolean; a: boolean }

/**
 * La confirmación con contenido (regla 8): «Encendida la contabilidad de
 * Casa Lola. Ya sale Sumied en su menú.» Si no ha cambiado nada, también lo
 * dice: un botón que calla se lee como fallo.
 */
export function fraseConfirmacion(cuenta: string, clave: ClaveSumied, encender: boolean, cambiados: readonly Cambio[]): string {
  const l = LO[clave]
  if (cambiados.length === 0) return `No ha cambiado nada: el interruptor «${NOMBRE_INTERRUPTOR[clave]}» de ${cuenta} ya estaba ${encender ? 'encendido' : 'apagado'}.`
  if (encender) return `${l.encendida} ${l.cosa} de ${cuenta}. ${l.sale}`
  const otras = cambiados.filter((c) => c.clave !== clave).map((c) => LO[c.clave].cosa)
  return `${l.apagada} ${l.cosa} de ${cuenta}: ${l.noSale}${otras.length ? ` También se ha${otras.length > 1 || otras[0] === 'los impuestos' ? 'n' : ''} apagado ${lista(otras)}.` : ''} No se ha borrado nada.`
}

const n = (x: number, uno: string, varios: string) => `${new Intl.NumberFormat('es-ES').format(x)} ${x === 1 ? uno : varios}`

/**
 * El aviso de apagar «Contabilidad» con datos dentro: qué deja de verse.
 * Sin datos, no hay aviso (solo el motivo).
 */
export function avisoApagar(cuenta: string, datos: DatosCuenta, todos: readonly Interruptor[]): { titulo: string; texto: string } | null {
  const partes = [
    datos.asientos ? n(datos.asientos, 'asiento', 'asientos') : null,
    datos.facturasRecibidas ? n(datos.facturasRecibidas, 'factura recibida', 'facturas recibidas') : null,
    datos.impuestos ? n(datos.impuestos, 'impuesto', 'impuestos') : null,
  ].filter((x): x is string => !!x)
  if (!partes.length) return null
  const otras = todos.filter((x) => x.clave !== 'conta' && x.encendida).map((x) => `«${NOMBRE_INTERRUPTOR[x.clave]}»`)
  return {
    titulo: `${cuenta} tiene datos en Sumied`,
    texto: `${lista(partes)}. Al apagar la contabilidad, Sumied deja de salir en su menú y nadie de la cuenta los ve${otras.length ? `; también se apaga${otras.length > 1 ? 'n' : ''} ${lista(otras)}` : ''}. No se borra nada: al volver a encenderla, todo sigue ahí.`,
  }
}
