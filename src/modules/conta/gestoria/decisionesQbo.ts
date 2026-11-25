// src/modules/conta/gestoria/decisionesQbo.ts
//
// Q08 · Paso 2 · «Cargar decisiones de QBO»: lo que dice cada fila del Excel
// «Atar clientes GoCardless» (12/11) contestado por QBO, sin React y sin base.
// Puro: lo prueba tests/unit/modules/conta/q08/decisionesQbo.test.ts con datos
// inventados. El Excel de verdad, con sus nombres y correos, no pasa nunca por
// el repositorio (T11): lo sube Julio en producción y se lee en el navegador.
//
// De la hoja «Para atar», columnas «Cobra» (el emisor), «Cliente en
// GoCardless», «Correo en GoCardless», «Ficha candidata 1…3» (con su «nº 909»),
// «Decisión» y «Nº de ficha en Bitrix24». Cada fila es una de estas:
//   · «Es la candidata N»: la ficha de esa candidata, por su nº de Bitrix24;
//   · un nº en «Nº de ficha en Bitrix24»: esa ficha;
//   · en blanco: «se ata solo» (no se toca);
//   · un nombre: la ficha con ese nombre, si hay UNA sola (se busca en la base);
//   · lo demás (o un nombre con ninguna o varias fichas): «Pendiente de revisar»
//     con el texto de QBO. Lo que no se entiende no se adivina.

export const ORIGEN_QBO = 'QBO, Excel del 12/11'

export type Intencion =
  | { que: 'por_numero'; bitrixId: string; de: string }
  | { que: 'por_nombre'; nombre: string }
  | { que: 'solo' }
  | { que: 'pendiente'; texto: string }

export interface FilaQbo {
  fila: number
  emisor: string
  cliente: string
  correo: string
  decision: string
  intencion: Intencion
}

const txt = (v: unknown): string => (v === null || v === undefined ? '' : String(v)).trim()

/** Sin tildes, en minúsculas, solo letras y números separados por un espacio: para comparar nombres. */
export const normal = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9ñ]+/g, ' ').trim()

/** La clave de un nombre para compararlo: sin tildes, mayúsculas, espacios ni signos («S.L.» = «SL»). */
export const clave = (s: string): string => normal(s).replace(/ /g, '')

/** El nº de Bitrix24 de una candidata («AMLOSAR SL · nº 909 · activa…» → «909»). */
export const numeroDeCandidata = (s: string): string | null => /n[ºo°]\s*(\d+)/i.exec(s)?.[1] ?? null

/** Qué dice una fila: su decisión, en una de las cuatro clases. */
export function intencionDe(decision: string, numeroFicha: string, candidatas: readonly string[]): Intencion {
  const n = txt(numeroFicha).replace(/\D/g, '')
  if (n) return { que: 'por_numero', bitrixId: n, de: 'su nº de ficha' }
  const d = txt(decision)
  if (!d) return { que: 'solo' }
  const c = /^es\s+la\s+candidata\s+(\d)\b/i.exec(d)
  if (c) {
    const numero = numeroDeCandidata(candidatas[Number(c[1]) - 1] ?? '')
    return numero ? { que: 'por_numero', bitrixId: numero, de: `la candidata ${c[1]}` } : { que: 'pendiente', texto: d }
  }
  // Un nombre de ficha: corto, sin frases (sin verbos de por medio ni más de 8 palabras).
  const palabras = normal(d).split(' ').filter(Boolean)
  if (palabras.length && palabras.length <= 8 && !/\b(paga|pagar|ella|el|mirar|revisar|ver|es|son|esta|está|no)\b/i.test(d)) return { que: 'por_nombre', nombre: d }
  return { que: 'pendiente', texto: d }
}

/** Las filas de la hoja «Para atar» (la primera, la cabecera). Las que no tienen cliente se saltan. */
export function filasDeLaHoja(filas: readonly (readonly unknown[])[]): FilaQbo[] {
  const cab = (filas[0] ?? []).map((x) => txt(x))
  const col = (nombre: string) => cab.findIndex((c) => normal(c) === normal(nombre))
  const i = {
    emisor: col('Cobra'), cliente: col('Cliente en GoCardless'), correo: col('Correo en GoCardless'), decision: col('Decisión'), numero: col('Nº de ficha en Bitrix24'),
    c1: col('Ficha candidata 1'), c2: col('Ficha candidata 2'), c3: col('Ficha candidata 3'),
  }
  const faltan = Object.entries({ Cobra: i.emisor, 'Cliente en GoCardless': i.cliente, 'Decisión': i.decision }).filter(([, v]) => v < 0).map(([k]) => k)
  if (faltan.length) throw new Error(`La hoja «Para atar» no tiene ${faltan.map((f) => `«${f}»`).join(' ni ')}: ¿es el Excel «Atar clientes GoCardless» contestado por QBO?`)
  const de = (r: readonly unknown[], k: number) => (k < 0 ? '' : txt(r[k]))
  return filas.slice(1).map((r, n) => ({
    fila: n + 2, emisor: de(r, i.emisor), cliente: de(r, i.cliente), correo: de(r, i.correo), decision: de(r, i.decision),
    intencion: intencionDe(de(r, i.decision), de(r, i.numero), [de(r, i.c1), de(r, i.c2), de(r, i.c3)]),
  })).filter((f) => f.cliente)
}

/** El emisor de una fila («QBO Integrity», «Anny Zerpa») entre las empresas: todas sus palabras en el nombre de una sola. */
export function emisorDe<E extends { id: string; nombre: string }>(cobra: string, empresas: readonly E[]): E | null {
  const p = normal(cobra).split(' ').filter(Boolean)
  if (!p.length) return null
  const casan = empresas.filter((e) => { const n = ` ${normal(e.nombre)} `; return p.every((x) => n.includes(` ${x} `)) })
  return casan.length === 1 ? casan[0] : null
}

/** El cliente de GoCardless de una fila, en su empresa: por el nombre; si hay varios, el del correo. Uno solo, o null. */
export function clienteGcDe<C extends { gcId: string; nombre: string | null; correo: string | null }>(f: Pick<FilaQbo, 'cliente' | 'correo'>, clientes: readonly C[]): C | null {
  const porNombre = clientes.filter((c) => clave(c.nombre ?? '') === clave(f.cliente))
  if (porNombre.length === 1) return porNombre[0]
  const correo = f.correo.toLowerCase()
  const conCorreo = (porNombre.length ? porNombre : clientes).filter((c) => correo && (c.correo ?? '').toLowerCase() === correo)
  return conCorreo.length === 1 ? conCorreo[0] : null
}

/** La ficha que dice el nombre que escribió QBO: la de ese nombre, si hay una sola. */
export function fichaPorNombre<F extends { partyId: string; nombre: string }>(nombre: string, fichas: readonly F[]): F | null {
  const n = clave(nombre)
  const casan = fichas.filter((f) => clave(f.nombre) === n)
  return casan.length === 1 ? casan[0] : null
}

export type Resultado = 'atado' | 'pendiente' | 'solo' | 'sin_cliente' | 'error'

export interface Linea { fila: number; emisor: string; cliente: string; resultado: Resultado; frase: string }

/** El resumen de la carga, en una frase con sus números (regla 8). */
export function resumen(lineas: readonly Linea[]): string {
  const n = (r: Resultado) => lineas.filter((l) => l.resultado === r).length
  const partes = [`${n('atado')} atados a su ficha`, `${n('pendiente')} pendientes de revisar con el texto de QBO`, `${n('solo')} que se atan solos`]
  if (n('sin_cliente')) partes.push(`${n('sin_cliente')} que no están en lo leído de GoCardless`)
  if (n('error')) partes.push(`${n('error')} con error`)
  return `Cargadas las decisiones de QBO (${lineas.length} filas): ${partes.join(', ')}.`
}
