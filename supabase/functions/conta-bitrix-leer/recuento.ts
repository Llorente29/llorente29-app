// supabase/functions/conta-bitrix-leer/recuento.ts
//
// G01b · El recuento de los campos dudosos del Bitrix24 de una cuenta, para
// decidir el mapa con datos y no solo con la etiqueta (Julio, 07/11). Puro:
// recibe las fichas tal como las devuelve crm.company.list y los campos
// medidos con crm.company.fields, y devuelve SOLO números (ni nombres ni NIF):
//   · cada grupo de texto (NIF, calle): cuántas fichas tienen relleno cada
//     campo, cuántas tienen más de uno y en cuántas no coinciden;
//   · la situación: cuántas fichas hay en cada opción (y vacías);
//   · las cuotas: cuántas tienen importe y la suma de cada una;
//   · (G01b, 07/11) los NIF repetidos: cuántos salen en más de una ficha, con
//     qué situaciones, de qué tipo y si mezclan sociedad y persona.

import { situacionDeTexto, type CampoMedido, type Situacion } from './mapa.ts'
import { agrupar, esCampoSensible, nifComoLaBase, resumenDeUnion, tipoDeNif, type ResumenDeUnion } from './clientes.ts'

export { nifComoLaBase, tipoDeNif }

export interface GruposRecuento {
  /** Campos de texto que pueden ser lo mismo, por grupo («nif», «calle»). */
  texto: Record<string, string[]>
  /** El campo de lista de la situación. */
  situacion: string
  /** Los campos de importe. */
  cuotas: string[]
  /** G01b · Para los NIF repetidos: el campo del NIF y el del nombre (solo para saber si suena a sociedad; no sale). */
  repetidos?: { nif: string; nombre: string }
}

/** G01b · Los NIF que salen en más de una ficha: solo números (Julio, 07/11, tras el «ux_party_nif»). */
export interface ResultadoRepetidos {
  campoNif: { codigo: string; etiqueta: string }
  fichasConNif: number
  nifRepetidos: number
  fichasEnRepetidos: number
  /** Cuántas fichas tiene el NIF más repetido. */
  maximoPorNif: number
  mismaSituacion: number
  distintaSituacion: number
  /** El mismo NIF en una ficha activa y en otra de baja. */
  activaYBaja: number
  /** De qué tipo es cada NIF repetido: DNI, NIE, CIF u otro. */
  porTipo: { DNI: number; NIE: number; CIF: number; otro: number }
  /** Repetidos entre una ficha con nombre de sociedad (S.L., S.A., C.B.…) y otra con nombre de persona. */
  sociedadYPersona: number
  /** De dónde sale la situación: del mapa confirmado o, si no lo hay, de su texto. */
  situacionSegun: 'mapa confirmado' | 'texto de la opción'
}

export interface ResultadoTexto { campos: { codigo: string; etiqueta: string; rellenas: number }[]; masDeUno: number; noCoinciden: number }
export interface ResultadoRecuento {
  total: number
  texto: Record<string, ResultadoTexto>
  situacion: { codigo: string; etiqueta: string; opciones: { id: string; texto: string; fichas: number }[]; vacias: number; otras: number }
  cuotas: { codigo: string; etiqueta: string; conImporte: number; sumaCent: number }[]
  repetidos?: ResultadoRepetidos
  /** G01b · Lo que saldría con la regla de la unión (clientes.ts), solo números. */
  union?: ResumenDeUnion
}

const etiqueta = (m: Record<string, CampoMedido>, codigo: string) => {
  const c = m[codigo]
  return [c?.formLabel, c?.listLabel, c?.title].find((x) => x && x.trim()) ?? codigo
}

/** Un valor de Bitrix24 en texto: lo de una dirección va antes de «|»; de una lista de varios, el primero con algo. */
export function textoDe(v: unknown): string {
  if (Array.isArray(v)) return v.map(textoDe).find((x) => x) ?? ''
  if (v === null || v === undefined || typeof v === 'object') return ''
  return String(v).split('|')[0].trim()
}

/** Para comparar: sin tildes, sin signos, en mayúsculas y con un solo espacio. */
export function normal(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()
}

/** Un importe de Bitrix24 («24.2», 24.2 o «24.2|EUR») en céntimos; null si no hay. */
export function centDe(v: unknown): number | null {
  const t = textoDe(v).replace(',', '.')
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? Math.round(n * 100) : null
}

/** ¿El nombre suena a sociedad? (S.L., S.L.U., S.A., S.C., C.B., sociedad, limitada, anónima, cooperativa). */
export const suenaASociedad = (nombre: string) =>
  /(^|[^A-Z])(S ?L ?U?|S ?A ?U?|S ?C ?P?|C ?B|SOCIEDAD|LIMITADA|ANONIMA|COOPERATIVA)($|[^A-Z])/.test(normal(nombre.replace(/\./g, ' ')))

/** La situación de una ficha por el id de su opción: la del mapa confirmado o, si no lo hay, la de su texto. Null si está vacía. */
export function situacionDeFila(situacion: string, medidos: Record<string, CampoMedido>, opcionesConfirmadas?: Record<string, string> | null) {
  const texto = new Map((medidos[situacion]?.items ?? []).map((it) => [String(it.ID), it.VALUE]))
  return (id: string): Situacion | null => (id ? ((opcionesConfirmadas ? opcionesConfirmadas[id] ?? 'sin_clasificar' : situacionDeTexto(texto.get(id) ?? id)) as Situacion) : null)
}

/** G01b · Lo que saldría con la regla de la unión: las fichas, en clientes (solo números). */
export function simularUnion(filas: readonly Record<string, unknown>[], nif: string, situacion: string, medidos: Record<string, CampoMedido>, opcionesConfirmadas?: Record<string, string> | null): ResumenDeUnion {
  const sit = situacionDeFila(situacion, medidos, opcionesConfirmadas)
  return resumenDeUnion(agrupar(filas.map((f) => ({ bitrixId: String(f.ID ?? ''), nif: textoDe(f[nif]) || null, situacion: sit(textoDe(f[situacion])) })), true))
}

/** G01b · Los campos que el recuento no puede pedir nunca (contraseñas, certificados). */
export const camposSensiblesDe = (codigos: readonly string[], medidos: Record<string, CampoMedido>) => codigos.filter((c) => esCampoSensible(medidos[c]))

export function contarRepetidos(
  filas: readonly Record<string, unknown>[], r: { nif: string; nombre: string }, situacion: string,
  medidos: Record<string, CampoMedido>, opcionesConfirmadas?: Record<string, string> | null,
): ResultadoRepetidos {
  const sit = situacionDeFila(situacion, medidos, opcionesConfirmadas)
  const sitDe = (id: string) => sit(id) ?? 'vacia'
  const porNif = new Map<string, { sits: Set<string>; soc: boolean; persona: boolean; n: number }>()
  let fichasConNif = 0
  for (const f of filas) {
    const nif = nifComoLaBase(f[r.nif])
    if (!nif) continue
    fichasConNif++
    const x = porNif.get(nif) ?? { sits: new Set<string>(), soc: false, persona: false, n: 0 }
    x.n++
    x.sits.add(sitDe(textoDe(f[situacion])))
    if (suenaASociedad(textoDe(f[r.nombre]))) x.soc = true
    else x.persona = true
    porNif.set(nif, x)
  }
  const out: ResultadoRepetidos = {
    campoNif: { codigo: r.nif, etiqueta: etiqueta(medidos, r.nif) }, fichasConNif,
    nifRepetidos: 0, fichasEnRepetidos: 0, maximoPorNif: 0, mismaSituacion: 0, distintaSituacion: 0, activaYBaja: 0,
    porTipo: { DNI: 0, NIE: 0, CIF: 0, otro: 0 }, sociedadYPersona: 0,
    situacionSegun: opcionesConfirmadas ? 'mapa confirmado' : 'texto de la opción',
  }
  for (const [nif, x] of porNif) {
    if (x.n < 2) continue
    out.nifRepetidos++
    out.fichasEnRepetidos += x.n
    out.maximoPorNif = Math.max(out.maximoPorNif, x.n)
    if (x.sits.size > 1) out.distintaSituacion++
    else out.mismaSituacion++
    if (x.sits.has('activo') && x.sits.has('baja')) out.activaYBaja++
    out.porTipo[tipoDeNif(nif)]++
    if (x.soc && x.persona) out.sociedadYPersona++
  }
  return out
}

export function contar(filas: readonly Record<string, unknown>[], g: GruposRecuento, medidos: Record<string, CampoMedido>, opcionesConfirmadas?: Record<string, string> | null): ResultadoRecuento {
  const texto: Record<string, ResultadoTexto> = {}
  for (const [grupo, codigos] of Object.entries(g.texto)) {
    const rellenas = codigos.map(() => 0)
    let masDeUno = 0
    let noCoinciden = 0
    for (const f of filas) {
      const valores = codigos.map((c, i) => { const t = normal(textoDe(f[c])); if (t) rellenas[i]++; return t }).filter(Boolean)
      if (valores.length > 1) {
        masDeUno++
        // El NIF se compara sin espacios (B 12345678 = B12345678).
        const comparables = new Set(valores.map((x) => (grupo === 'nif' ? x.replace(/ /g, '') : x)))
        if (comparables.size > 1) noCoinciden++
      }
    }
    texto[grupo] = { campos: codigos.map((codigo, i) => ({ codigo, etiqueta: etiqueta(medidos, codigo), rellenas: rellenas[i] })), masDeUno, noCoinciden }
  }

  const items = medidos[g.situacion]?.items ?? []
  const porId = new Map(items.map((it) => [String(it.ID), 0]))
  let vacias = 0
  let otras = 0
  for (const f of filas) {
    const id = textoDe(f[g.situacion])
    if (!id) vacias++
    else if (porId.has(id)) porId.set(id, porId.get(id)! + 1)
    else otras++
  }

  const cuotas = g.cuotas.map((codigo) => {
    let conImporte = 0
    let sumaCent = 0
    for (const f of filas) {
      const c = centDe(f[codigo])
      if (c !== null && c !== 0) { conImporte++; sumaCent += c }
    }
    return { codigo, etiqueta: etiqueta(medidos, codigo), conImporte, sumaCent }
  })

  return {
    total: filas.length,
    texto,
    situacion: {
      codigo: g.situacion, etiqueta: etiqueta(medidos, g.situacion),
      opciones: items.map((it) => ({ id: String(it.ID), texto: it.VALUE, fichas: porId.get(String(it.ID)) ?? 0 })), vacias, otras,
    },
    cuotas,
    ...(g.repetidos ? { repetidos: contarRepetidos(filas, g.repetidos, g.situacion, medidos, opcionesConfirmadas),
      union: simularUnion(filas, g.repetidos.nif, g.situacion, medidos, opcionesConfirmadas) } : {}),
  }
}

/** Todos los campos que hay que pedir a crm.company.list. */
export const camposDelRecuento = (g: GruposRecuento): string[] =>
  ['ID', ...new Set([...Object.values(g.texto).flat(), g.situacion, ...g.cuotas, ...(g.repetidos ? [g.repetidos.nif, g.repetidos.nombre] : [])])]

/** Los grupos válidos: códigos de Bitrix24 (TITLE, ADDRESS, UF_CRM_…) y nada más. */
export function gruposValidos(x: unknown): GruposRecuento | null {
  const ok = (c: unknown): c is string => typeof c === 'string' && /^[A-Z][A-Z0-9_]{1,60}$/.test(c)
  const o = x as Partial<GruposRecuento> | null
  if (!o || typeof o !== 'object' || !o.texto || typeof o.texto !== 'object' || !ok(o.situacion) || !Array.isArray(o.cuotas) || !o.cuotas.every(ok)) return null
  for (const [k, v] of Object.entries(o.texto)) if (!/^[a-z_]{1,20}$/.test(k) || !Array.isArray(v) || !v.length || !v.every(ok)) return null
  if (o.repetidos !== undefined && (!o.repetidos || typeof o.repetidos !== 'object' || !ok(o.repetidos.nif) || !ok(o.repetidos.nombre))) return null
  return o as GruposRecuento
}
