// supabase/functions/conta-bitrix-leer/recuento.ts
//
// G01b · El recuento de los campos dudosos del Bitrix24 de una cuenta, para
// decidir el mapa con datos y no solo con la etiqueta (Julio, 07/11). Puro:
// recibe las fichas tal como las devuelve crm.company.list y los campos
// medidos con crm.company.fields, y devuelve SOLO números (ni nombres ni NIF):
//   · cada grupo de texto (NIF, calle): cuántas fichas tienen relleno cada
//     campo, cuántas tienen más de uno y en cuántas no coinciden;
//   · la situación: cuántas fichas hay en cada opción (y vacías);
//   · las cuotas: cuántas tienen importe y la suma de cada una.

import type { CampoMedido } from './mapa.ts'

export interface GruposRecuento {
  /** Campos de texto que pueden ser lo mismo, por grupo («nif», «calle»). */
  texto: Record<string, string[]>
  /** El campo de lista de la situación. */
  situacion: string
  /** Los campos de importe. */
  cuotas: string[]
}

export interface ResultadoTexto { campos: { codigo: string; etiqueta: string; rellenas: number }[]; masDeUno: number; noCoinciden: number }
export interface ResultadoRecuento {
  total: number
  texto: Record<string, ResultadoTexto>
  situacion: { codigo: string; etiqueta: string; opciones: { id: string; texto: string; fichas: number }[]; vacias: number; otras: number }
  cuotas: { codigo: string; etiqueta: string; conImporte: number; sumaCent: number }[]
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

export function contar(filas: readonly Record<string, unknown>[], g: GruposRecuento, medidos: Record<string, CampoMedido>): ResultadoRecuento {
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
  }
}

/** Todos los campos que hay que pedir a crm.company.list. */
export const camposDelRecuento = (g: GruposRecuento): string[] => ['ID', ...new Set([...Object.values(g.texto).flat(), g.situacion, ...g.cuotas])]

/** Los grupos válidos: códigos de Bitrix24 (TITLE, ADDRESS, UF_CRM_…) y nada más. */
export function gruposValidos(x: unknown): GruposRecuento | null {
  const ok = (c: unknown): c is string => typeof c === 'string' && /^[A-Z][A-Z0-9_]{1,60}$/.test(c)
  const o = x as Partial<GruposRecuento> | null
  if (!o || typeof o !== 'object' || !o.texto || typeof o.texto !== 'object' || !ok(o.situacion) || !Array.isArray(o.cuotas) || !o.cuotas.every(ok)) return null
  for (const [k, v] of Object.entries(o.texto)) if (!/^[a-z_]{1,20}$/.test(k) || !Array.isArray(v) || !v.length || !v.every(ok)) return null
  return o as GruposRecuento
}
