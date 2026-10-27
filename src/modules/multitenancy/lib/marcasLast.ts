// src/modules/multitenancy/lib/marcasLast.ts
//
// F01 · Marcas de Last (tableros 1 y 2). Lo que se lee de la base y cómo se
// dice. Sin React ni Supabase: lo prueban las unitarias.
//
// La base (f01_marcas_last) da cada marca que hay en las cartas de Last de la
// cuenta, en sus locales ACTIVOS. Pendiente = «nueva» (no hay marca en Folvy) o
// «sin_vincular» (hay una marca que se llama igual, sin vincular). Las dos se
// dan de alta igual: el alta reutiliza la que ya existe y no duplica.

export type EstadoMarcaLast = 'nueva' | 'sin_vincular' | 'vinculada' | 'ignorada'

export interface LocalMarca { id: string; nombre: string }

export interface MarcaLast {
  org: string
  cuentaLast: string | null
  nombre: string
  estado: EstadoMarcaLast
  brandId: string | null
  marcaFolvy: string | null
  locales: LocalMarca[]
  canales: string[]
  platos: number
  ventas: number
  propuesta: { propia: boolean; socio: string | null; socioMarcas: number }
}

export interface CartaAlta {
  matriculas: number
  platos: number
  yaEstaban: number
  creados: number
  juntados: { plato: string; con: string }[]
  delAlmacen: string[]
  conReceta: number
  sinReceta: number
  preciosPorPlataforma: number
  archivadas: { plato: string }[]
}

export interface ResultadoAlta {
  brandId: string | null
  nombre: string
  nueva: boolean
  propia: boolean
  socio: string | null
  ensayo: boolean
  locales: LocalMarca[]
  canales: { slug: string; nombre: string }[]
  vinculosNuevos: number
  carta: CartaAlta | null
  ventas: { colocadas: number; fallidas: number; antesDelRecuento: number; corte: string | null } | null
}

type Fila = Record<string, unknown>
const txt = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null)
const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0) || 0)
const lista = (v: unknown): Fila[] => (Array.isArray(v) ? (v as Fila[]) : [])
const ESTADOS: EstadoMarcaLast[] = ['nueva', 'sin_vincular', 'vinculada', 'ignorada']

export function leerMarcas(datos: unknown): MarcaLast[] {
  return lista(datos).map((m) => {
    const p = (m.propuesta ?? {}) as Fila
    const estado = ESTADOS.includes(m.estado as EstadoMarcaLast) ? (m.estado as EstadoMarcaLast) : 'nueva'
    return {
      org: String(m.org ?? ''),
      cuentaLast: txt(m.cuenta_last),
      nombre: String(m.nombre ?? '').trim(),
      estado,
      brandId: txt(m.brand_id),
      marcaFolvy: txt(m.marca_folvy),
      locales: lista(m.locales).map((l) => ({ id: String(l.id ?? ''), nombre: String(l.nombre ?? '') }))
        .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
      canales: (Array.isArray(m.canales) ? (m.canales as unknown[]) : []).map(String).sort(ordenCanal),
      platos: num(m.platos),
      ventas: num(m.ventas),
      propuesta: { propia: p.propia === true, socio: txt(p.socio), socioMarcas: num(p.socio_marcas) },
    }
  })
}

export function leerAlta(datos: unknown): ResultadoAlta {
  const r = (datos ?? {}) as Fila
  const c = r.carta as Fila | null | undefined
  const v = r.ventas as Fila | null | undefined
  return {
    brandId: txt(r.brand_id),
    nombre: String(r.nombre ?? ''),
    nueva: r.nueva === true,
    propia: r.propia === true,
    socio: txt(r.socio),
    ensayo: r.ensayo === true,
    locales: lista(r.locales).map((l) => ({ id: String(l.id ?? ''), nombre: String(l.nombre ?? '') }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
    canales: lista(r.canales).map((x) => ({ slug: String(x.slug ?? ''), nombre: nombreCanal(String(x.slug ?? '')) }))
      .sort((a, b) => ordenCanal(a.slug, b.slug)),
    vinculosNuevos: num(r.vinculos_nuevos),
    carta: c ? {
      matriculas: num(c.matriculas),
      platos: num(c.platos),
      yaEstaban: num(c.ya_estaban),
      creados: num(c.creados),
      juntados: lista(c.juntados).map((j) => ({ plato: String(j.plato ?? ''), con: String(j.con ?? '') })),
      delAlmacen: (Array.isArray(c.del_almacen) ? (c.del_almacen as unknown[]) : []).map((x) => String(x).trim()),
      conReceta: num(c.con_receta),
      sinReceta: num(c.sin_receta),
      preciosPorPlataforma: num(c.precios_por_plataforma),
      archivadas: lista(c.archivadas).map((a) => ({ plato: String(a.plato ?? '') })),
    } : null,
    ventas: v ? { colocadas: num(v.colocadas), fallidas: num(v.fallidas), antesDelRecuento: num(v.antes_del_recuento), corte: txt(v.corte) } : null,
  }
}

/** Las que piden alta: las que no están vinculadas ni ignoradas. */
export const pendientes = (m: MarcaLast[]): MarcaLast[] => m.filter((x) => x.estado === 'nueva' || x.estado === 'sin_vincular')

const NOMBRE_CANAL: Record<string, string> = { uber: 'Uber Eats', glovo: 'Glovo', justeat: 'Just Eat', deliveroo: 'Deliveroo', shop: 'Tienda online' }
const ORDEN_CANAL = ['uber', 'glovo', 'justeat', 'deliveroo', 'shop']
export const nombreCanal = (slug: string): string => NOMBRE_CANAL[slug] ?? slug
function ordenCanal(a: string, b: string): number {
  const i = (x: string) => { const n = ORDEN_CANAL.indexOf(x); return n < 0 ? 99 : n }
  return i(a) - i(b) || a.localeCompare(b)
}

/** «Alcalá», «Alcalá y Carabanchel», «Alcalá, Carabanchel y Centro». Sin «Foodint» delante. */
export function enumerar(xs: string[]): string {
  if (xs.length <= 1) return xs[0] ?? ''
  return `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`
}

/** El nombre corto del local: sin el nombre de la cuenta delante («Foodint Alcalá» → «Alcalá»). */
export function localCorto(nombre: string): string {
  const partes = nombre.trim().split(/\s+/)
  return partes.length > 1 && /^foodint$/i.test(partes[0]) ? partes.slice(1).join(' ') : nombre.trim()
}

export const enumerarLocales = (l: LocalMarca[]): string => enumerar(l.map((x) => localCorto(x.nombre)))
export const enumerarCanales = (c: string[]): string => enumerar(c.map(nombreCanal))

/** Las iniciales del icono: «El Delicioso Latin Food» → «ED»; «Van Van» → «VV». */
export function iniciales(nombre: string): string {
  const palabras = nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^A-Za-z0-9]+/).filter(Boolean)
  const letras = palabras.filter((p) => p[0] === p[0].toUpperCase()).map((p) => p[0])
  const r = (letras.length ? letras : palabras.map((p) => p[0])).slice(0, 2).join('').toUpperCase()
  return r || '?'
}

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`

/** El aviso de Inicio (tablero 1). */
export function avisoMarca(m: MarcaLast): { titulo: string; detalle: string; chip: string } {
  const donde = m.locales.length ? `en ${enumerarLocales(m.locales)}` : 'sin local'
  const con = m.canales.length ? `, con ${enumerarCanales(m.canales)}` : ''
  const vendido = m.ventas > 0 ? `Ya lleva ${plural(m.ventas, 'venta', 'ventas')}.` : 'Todavía no ha vendido.'
  return {
    titulo: `Marca nueva: ${m.nombre}`,
    detalle: `Ha aparecido en Last, ${donde}${con}. ${plural(m.platos, 'plato', 'platos')}. ${vendido}`,
    chip: 'Sin dar de alta',
  }
}

/** Las líneas de «La carta» del panel (tablero 2), con lo que diga el ensayo. */
export function lineasCarta(c: CartaAlta, canales: string[]): { tono: 'ok' | 'aviso'; fuerte: string; resto: string }[] {
  const out: { tono: 'ok' | 'aviso'; fuerte: string; resto: string }[] = []
  const varias = canales.length > 1
  out.push({
    tono: 'ok',
    fuerte: `${plural(c.platos, 'plato', 'platos')}.`,
    resto: varias
      ? ` ${enumerarCanales(canales)} tienen la misma carta: queda una sola, con el precio de cada plataforma.`
      : ' Una sola carta, con su precio.',
  })
  for (const j of c.juntados) {
    out.push({ tono: 'ok', fuerte: `«${j.con}» y «${j.plato}»`, resto: ' son el mismo plato con dos nombres: se juntan en uno.' })
  }
  if (c.delAlmacen.length) {
    out.push({
      tono: 'ok',
      fuerte: `${plural(c.delAlmacen.length, 'producto que ya tienes', 'productos que ya tienes')} en el almacén`,
      resto: ` (${enumerar(c.delAlmacen)}): se ${c.delAlmacen.length === 1 ? 'enlaza solo' : 'enlazan solos'}.`,
    })
  }
  if (c.sinReceta > 0) {
    out.push({
      tono: 'aviso',
      fuerte: `${plural(c.sinReceta, 'plato sin receta', 'platos sin receta')}.`,
      resto: ' Se venden igual; lo vendido descuenta almacén cuando pongas la receta.',
    })
  }
  if (c.archivadas.length) {
    out.push({
      tono: 'aviso',
      fuerte: `${plural(c.archivadas.length, 'plato archivado', 'platos archivados')}`,
      resto: ` (${enumerar(c.archivadas.map((a) => a.plato))}): se quedan archivados, no se vuelven a crear.`,
    })
  }
  return out
}

/** La confirmación con contenido (regla 8): «Dada de alta X: 2 locales, 18 platos. Faltan 8 recetas.» */
export function fraseHecho(r: ResultadoAlta): string {
  const partes = [`Dada de alta ${r.nombre}: ${plural(r.locales.length, 'local', 'locales')}`]
  if (r.carta) partes.push(plural(r.carta.platos, 'plato', 'platos'))
  let frase = partes.join(', ') + '.'
  if (r.carta && r.carta.sinReceta > 0) frase += ` Faltan ${plural(r.carta.sinReceta, 'receta', 'recetas')}.`
  if (r.ventas && r.ventas.colocadas > 0) frase += ` ${plural(r.ventas.colocadas, 'venta colocada', 'ventas colocadas')}.`
  if (r.ventas && r.ventas.antesDelRecuento > 0) {
    frase += ` ${plural(r.ventas.antesDelRecuento, 'venta es', 'ventas son')} de antes del último recuento cerrado y no se ${r.ventas.antesDelRecuento === 1 ? 'toca' : 'tocan'}.`
  }
  if (r.ventas && r.ventas.fallidas > 0) frase += ` ${plural(r.ventas.fallidas, 'venta no se ha podido colocar', 'ventas no se han podido colocar')}.`
  return frase
}

/** La clave de una marca de Last en la dirección de la pantalla: «org:nombre». */
export const claveMarca = (m: { org: string; nombre: string }): string => `${m.org}:${m.nombre}`
export function deClave(clave: string | null): { org: string; nombre: string } | null {
  if (!clave) return null
  const i = clave.indexOf(':')
  if (i < 1) return null
  return { org: clave.slice(0, i), nombre: clave.slice(i + 1) }
}
