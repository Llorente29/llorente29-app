// src/modules/conta/lib/reglasBanco.ts
//
// B02 · Reglas que no hacen daño. Puro y probado (tests/unit/modules/conta/reglasB02.test.ts).
//
//   · Una regla se enseña con aquello en lo que se basa (cuántos movimientos,
//     con «Ver ejemplos») y con lo que cambiaría (cuántos pendientes pasarían
//     a propuesta).
//   · Nunca se propone una regla con un texto que comparten varias contrapartes
//     o varias cuentas de destino («TRANSFERENCIAS», «PAGO CON TARJ», «LIQ OP
//     TRANSFEREN»): se enseña como «No la propongo», con el porqué. El agente lo
//     comprueba cada noche, también en las reglas ya guardadas (revisarReglas).
//   · Una regla nace de lo que la persona ha hecho al menos 3 veces igual, o de
//     una línea que la persona marca «Guárdalo como regla».

import { nombra, normal, nombreCuenta, type Aprendido, type Contexto, type Regla } from '@/modules/conta/lib/conciliacion'

/** Las etiquetas del banco: el tipo de operación, nunca de quién es. Ninguna regla puede ser solo esto. */
export const TEXTOS_DEL_BANCO = [
  'TRANSFERENCIA', 'TRANSFERENCIAS', 'TRANSF', 'TRANSFERENCIA RECIBIDA', 'TRANSFERENCIA REALIZADA', 'TRANSFERENCIA EMITIDA',
  'PAGO CON TARJ', 'PAGO CON TARJETA', 'COMPRA TARJ', 'COMPRA CON TARJETA', 'TARJETA', 'RECIBO', 'RECIBOS', 'ADEUDO', 'ADEUDO DOMICILIADO',
  'DOMICILIACION', 'TRASPASO', 'TRASPASOS', 'LIQ OP TRANSFEREN', 'LIQUIDACION', 'ABONO', 'INGRESO', 'CARGO', 'PAGO', 'COBRO', 'BIZUM',
  'COMISION', 'COMISIONES', 'CAJERO', 'REINTEGRO', 'SEPA', 'SCT', 'SDD',
].map(normal)

/** Lo que una regla necesita saber de un movimiento para enseñarse. */
export interface MovRegla {
  id: string
  fecha: string
  importeCent: number
  concepto: string
  contraparte: string | null
  /** Sin casar (pendiente, propuesto, por aclarar) o ya casado. */
  sinCasar: boolean
}

/** Lo casado antes, con su cuenta (bank_historial: lo de Bancos y lo traído de Diez). */
export interface Casado { concepto: string; cuenta: string }

export interface Examen {
  /** Movimientos con ese texto (y signo), del más reciente al más antiguo. */
  ejemplos: MovRegla[]
  /** Cuántos pendientes pasarían a propuesta si se guarda. */
  cambiaria: number
  /** Las contrapartes distintas que tienen ese texto. */
  contrapartes: string[]
  /** Las cuentas a las que ya se ha casado lo que tiene ese texto. */
  cuentas: string[]
  /** Si es un texto que comparten varias, por qué no se propone (o por qué hay que revisarla). */
  generica: string | null
}

const texto = (m: Pick<MovRegla, 'concepto' | 'contraparte'>) => `${m.concepto} ${m.contraparte ?? ''}`

/** ¿Es solo una etiqueta del banco? */
export const esEtiquetaDelBanco = (contiene: string) => TEXTOS_DEL_BANCO.includes(normal(contiene))

/** Lo que hay detrás de un texto: ejemplos, lo que cambiaría y si es genérico. */
export function examinarRegla(r: { contiene: string; signo?: 1 | -1 | null }, movs: readonly MovRegla[], casados: readonly Casado[] = []): Examen {
  const casa = (m: MovRegla) => nombra(texto(m), [r.contiene]) && (!r.signo || Math.sign(m.importeCent) === r.signo)
  const ejemplos = movs.filter(casa).sort((a, b) => b.fecha.localeCompare(a.fecha))
  const contrapartes = [...new Set(ejemplos.map((m) => m.contraparte && normal(m.contraparte)).filter((x): x is string => !!x))]
  const cuentas = [...new Set(casados.filter((c) => nombra(c.concepto, [r.contiene])).map((c) => c.cuenta))]
  let generica: string | null = null
  if (esEtiquetaDelBanco(r.contiene)) generica = `«${normal(r.contiene)}» es lo que pone el banco en muchos movimientos distintos, no dice de quién es.`
  else if (contrapartes.length > 1) generica = `«${normal(r.contiene)}» lo comparten ${contrapartes.length} contrapartes distintas: casaría cosas que no van juntas.`
  else if (cuentas.length > 1) generica = `Lo que tiene «${normal(r.contiene)}» ya ha ido a ${cuentas.length} cuentas distintas: no siempre va al mismo sitio.`
  return { ejemplos, cambiaria: ejemplos.filter((m) => m.sinCasar).length, contrapartes, cuentas, generica }
}

export interface ReglaPropuesta { palabras: string; contiene: string; cuenta: string; terceroId: string | null; veces: number }
export interface NoLaPropongo { contiene: string; cuenta: string; veces: number; porque: string }

/**
 * Lo que la persona ha hecho al menos 3 veces igual (lo aprendido por
 * contraparte) y aún no tiene regla: se propone. Lo que comparte texto con
 * otras contrapartes o cuentas, no: va a «No la propongo», con el porqué.
 */
export function reglasQuePropongo(ctx: Pick<Contexto, 'aprendido' | 'reglas' | 'nombres'>, movs: readonly MovRegla[] = [], casados: readonly Casado[] = []):
  { propongo: ReglaPropuesta[]; noPropongo: NoLaPropongo[] } {
  const propongo: ReglaPropuesta[] = []
  const noPropongo: NoLaPropongo[] = []
  for (const a of ctx.aprendido) {
    if (a.veces < 3) continue
    if (ctx.reglas.some((r) => normal(r.contiene) === a.contraparte)) continue
    const otra = ctx.aprendido.find((x: Aprendido) => x.contraparte === a.contraparte && x.cuenta !== a.cuenta && x.veces >= 1)
    const ex = examinarRegla({ contiene: a.contraparte }, movs, casados)
    const porque = ex.generica ?? (otra ? `«${a.contraparte}» ya ha ido también a ${nombreCuenta(ctx, otra.cuenta)}: no siempre va al mismo sitio.` : null)
    if (porque) { noPropongo.push({ contiene: a.contraparte, cuenta: a.cuenta, veces: a.veces, porque }); continue }
    propongo.push({ palabras: `Cuando el concepto tenga «${a.contraparte}» → ${nombreCuenta(ctx, a.cuenta)}`, contiene: a.contraparte, cuenta: a.cuenta, terceroId: a.terceroId, veces: a.veces })
  }
  return { propongo, noPropongo }
}

/** Las reglas guardadas que hoy son genéricas: el agente las enseña cada noche (no las apaga solo). */
export function revisarReglas(reglas: readonly Pick<Regla, 'id' | 'contiene' | 'signo'>[], movs: readonly MovRegla[], casados: readonly Casado[] = []):
  { id: string; contiene: string; porque: string }[] {
  return reglas.map((r) => ({ r, ex: examinarRegla(r, movs, casados) })).filter((x) => x.ex.generica)
    .map((x) => ({ id: x.r.id, contiene: x.r.contiene, porque: x.ex.generica! }))
}

/**
 * «Guárdalo como regla» desde una línea: precargada con su contraparte (o, si
 * no la hay, con lo que el banco pone), la cuenta a la que va y su signo.
 * Si ese texto es genérico, lo dice y no deja guardarla tal cual.
 */
export function reglaDesdeLinea(m: MovRegla, cuenta: string, ctx: Pick<Contexto, 'nombres'>, movs: readonly MovRegla[] = [], casados: readonly Casado[] = []):
  { contiene: string; signo: 1 | -1; palabras: string; generica: string | null } {
  const contiene = m.contraparte ? normal(m.contraparte) : normal(m.concepto.split(' · ').slice(-1)[0] ?? m.concepto)
  const signo = m.importeCent < 0 ? -1 as const : 1 as const
  return { contiene, signo, palabras: `Cuando el concepto tenga «${contiene}» → ${nombreCuenta(ctx, cuenta)}`, generica: examinarRegla({ contiene, signo }, movs, casados).generica }
}

/** «Casa sola» cuando la persona la ha confirmado 3 veces sin corregir (B01). */
export const casaSola = (confirmaciones: number) => confirmaciones >= 3
