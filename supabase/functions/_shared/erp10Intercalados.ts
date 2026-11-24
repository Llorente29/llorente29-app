// supabase/functions/_shared/erp10Intercalados.ts
//
// X31 · 2 · Antes de enviar: ¿hay en la serie de ERP10 asientos del mes metidos a mano (que no ha escrito ni enlazado
// Sumied)? Si los hay, los números que dé ERP10 a lo que salga quedan intercalados con los suyos: se avisa antes de mandar.
// Puro (lo prueba tests/conta/x31-erp10/intercalados.test.ts); la lectura vive en conta-erp10-leer, acción «intercalados».

export type ApunteLeido = { Serie?: unknown; Documento?: unknown; Fecha?: unknown }
export type Conocido = { serie: string | null; documento: number | null }
export type DeFuera = { serie: string; cuantos: number; numeros: number[]; deSumied: number }

const clave = (serie: unknown, doc: unknown) => `${String(serie ?? '').trim()}/${Number(doc)}`

/** Por serie, los asientos del mes en ERP10 que Sumied no conoce (ni escritos ni enlazados por él), y cuántos sí. */
export function deFuera(apuntes: readonly ApunteLeido[], conocidos: readonly Conocido[]): DeFuera[] {
  const suyos = new Set(conocidos.filter((c) => c.documento != null).map((c) => clave(c.serie, c.documento)))
  const porSerie = new Map<string, { fuera: Set<number>; suyos: Set<number> }>()
  for (const a of apuntes) {
    const d = Number(a.Documento)
    if (!Number.isFinite(d)) continue
    const s = String(a.Serie ?? '').trim()
    const x = porSerie.get(s) ?? { fuera: new Set<number>(), suyos: new Set<number>() }
    porSerie.set(s, x)
    ;(suyos.has(clave(s, d)) ? x.suyos : x.fuera).add(d)
  }
  return [...porSerie.entries()].filter(([, x]) => x.fuera.size > 0)
    .map(([serie, x]) => ({ serie, cuantos: x.fuera.size, numeros: [...x.fuera].sort((a, b) => a - b), deSumied: x.suyos.size }))
    .sort((a, b) => a.serie.localeCompare(b.serie))
}

const lista = (ns: readonly number[]) => {
  const v = ns.slice(0, 5).map(String)
  const resto = ns.length - v.length
  if (resto > 0) return `${v.join(', ')} y ${resto} más`
  return v.length > 1 ? `${v.slice(0, -1).join(', ')} y ${v[v.length - 1]}` : v[0] ?? ''
}

/** El aviso antes de mandar, o null si no hay nada de fuera. */
export function avisoIntercalados(xs: readonly DeFuera[], mes: string): string | null {
  if (!xs.length) return null
  const partes = xs.map((x) => `en la serie ${x.serie || 'sin serie'}, ${x.cuantos === 1 ? `el ${lista(x.numeros)}` : `${x.cuantos}: los ${lista(x.numeros)}`}`)
  const n = xs.reduce((t, x) => t + x.cuantos, 0)
  return `En ERP10 ya ${n === 1 ? 'hay 1 asiento' : `hay ${n} asientos`} de ${mes} que no ha escrito Sumied (${partes.join('; ')}). `
    + `Lo que salga ahora coge los números siguientes de ERP10 y queda intercalado con ${n === 1 ? 'ese' : 'esos'}: si alguien está metiendo asientos a mano en ERP10, mejor que pare mientras sale.`
}
