// src/modules/conta/lib/terceros.ts
//
// C03 · El tercero y sus papeles. Una ficha por alguien (proveedor, cliente,
// plataforma de reparto, socio de marca), con los papeles que tenga.
//
// Regla 1 · Un NIF, un tercero: dar de alta un cliente con un NIF que ya tiene
//   otro tercero no crea otro; propone añadirle el papel («Es el mismo que tu
//   proveedor X: añadirle el papel de cliente»).
// Regla 6 · Archivado: un tercero archivado no sale en las listas ni en las
//   propuestas (salvo en «Archivados»), conserva cuentas, movimientos e
//   histórico, y se recupera con un clic.

import { rutaFichaProveedor, rutaFichaTercero } from '@/config/navegacion'

export type Papel = 'supplier' | 'customer' | 'platform' | 'brand_partner'

/** A dónde lleva un tercero: la ficha de proveedor de siempre si solo es proveedor; si no, la suya (N9/N10). */
export function rutaDeTercero(t: { id: string; papeles: readonly Papel[]; supplierId: string | null }): string {
  return t.papeles.length === 1 && t.papeles[0] === 'supplier' && t.supplierId ? rutaFichaProveedor(t.supplierId) : rutaFichaTercero(t.id)
}

export interface Tercero {
  id: string
  nombre: string
  /** NIF normalizado (como party_nif): mayúsculas, solo letras y números. */
  nif: string | null
  archivadoEn: string | null
  notaArchivado: string | null
  papeles: Papel[]
}

/** Como party_nif de la base: «b-12.345.678» → «B12345678». */
export function nifNormal(nif: string | null | undefined): string | null {
  const n = (nif ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  return n || null
}

export const NOMBRE_PAPEL: Record<Papel, string> = {
  supplier: 'Proveedor',
  customer: 'Cliente',
  platform: 'Plataforma de reparto',
  brand_partner: 'Socio de marca',
}

/** El orden de las píldoras: lo que más define primero. */
const ORDEN: Papel[] = ['platform', 'brand_partner', 'customer', 'supplier']
export const ordenarPapeles = (ps: readonly Papel[]): Papel[] => ORDEN.filter((p) => ps.includes(p))

/** Cómo se nombra a alguien según su papel principal: «tu proveedor», «tu cliente»… */
function quienEs(t: Tercero): string {
  const p = ordenarPapeles(t.papeles)[0]
  if (p === 'supplier') return `tu proveedor ${t.nombre}`
  if (p === 'platform') return `tu plataforma ${t.nombre}`
  if (p === 'brand_partner') return `tu socio de marca ${t.nombre}`
  if (p === 'customer') return `tu cliente ${t.nombre}`
  return t.nombre
}

export interface MismoNif {
  tercero: Tercero
  /** Ya tiene el papel que se quería dar: no hay nada que añadir. */
  yaLoEs: boolean
  texto: string
}

/**
 * Regla 1. ¿Hay ya un tercero con ese NIF? Si lo hay, lo que se propone: el
 * mismo tercero con un papel más. Los archivados cuentan (el NIF sigue siendo
 * suyo): se dice que está archivado.
 */
export function mismoNif(terceros: readonly Tercero[], nif: string | null | undefined, papel: Papel, excluir?: string): MismoNif | null {
  const n = nifNormal(nif)
  if (!n) return null
  const t = terceros.find((x) => x.nif === n && x.id !== excluir)
  if (!t) return null
  const yaLoEs = t.papeles.includes(papel)
  const archivado = t.archivadoEn ? ' (está archivado: se recupera)' : ''
  const texto = yaLoEs
    ? `${t.nombre} ya es ${NOMBRE_PAPEL[papel].toLowerCase()} con el NIF ${n}${archivado}.`
    : `Es el mismo que ${quienEs(t)}${archivado}: añadirle el papel de ${NOMBRE_PAPEL[papel].toLowerCase()}.`
  return { tercero: t, yaLoEs, texto }
}

export type FiltroTerceros = 'todos' | 'proveedores' | 'clientes' | 'plataformas' | 'socios' | 'archivados'

export const FILTROS_TERCEROS: { id: FiltroTerceros; texto: string }[] = [
  { id: 'todos', texto: 'Todos' },
  { id: 'proveedores', texto: 'Proveedores' },
  { id: 'clientes', texto: 'Clientes' },
  { id: 'plataformas', texto: 'Plataformas' },
  { id: 'socios', texto: 'Socios de marca' },
  { id: 'archivados', texto: 'Archivados' },
]

const PAPEL_DEL_FILTRO: Partial<Record<FiltroTerceros, Papel>> = {
  proveedores: 'supplier', clientes: 'customer', plataformas: 'platform', socios: 'brand_partner',
}

const sinAcentos = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/**
 * Regla 6 y el buscador. Los archivados solo salen en «Archivados» (y ahí
 * salen todos, sean lo que sean). Se busca por nombre (sin acentos) o por NIF
 * (con o sin guiones). «Clientes» incluye a plataformas y socios que también
 * son clientes: el filtro es por papel, no por tipo.
 */
export function filtrarTerceros<T extends Tercero>(lista: readonly T[], filtro: FiltroTerceros, q: string): T[] {
  const texto = sinAcentos(q.trim())
  const nif = nifNormal(q)
  return lista.filter((t) => {
    if (filtro === 'archivados') { if (!t.archivadoEn) return false }
    else {
      if (t.archivadoEn) return false
      const p = PAPEL_DEL_FILTRO[filtro]
      if (p && !t.papeles.includes(p)) return false
    }
    if (!texto) return true
    return sinAcentos(t.nombre).includes(texto) || (!!nif && nif.length >= 3 && !!t.nif && t.nif.includes(nif))
  })
}

/** Cuántos hay en cada filtro (los números de las píldoras). */
export function cuentaPorFiltro(lista: readonly Tercero[]): Record<FiltroTerceros, number> {
  const out = {} as Record<FiltroTerceros, number>
  for (const f of FILTROS_TERCEROS) out[f.id] = filtrarTerceros(lista, f.id, '').length
  return out
}

/** La franja de un archivado: «Archivado · histórico de 2024». */
export function franjaArchivado(t: Pick<Tercero, 'archivadoEn' | 'notaArchivado'>): string | null {
  if (!t.archivadoEn) return null
  return t.notaArchivado ? `Archivado · ${t.notaArchivado}` : `Archivado desde el ${t.archivadoEn.slice(8, 10)}/${t.archivadoEn.slice(5, 7)}/${t.archivadoEn.slice(0, 4)}`
}

/** La acción principal de la ficha según el papel (encargo §6). */
export function accionPrincipal(papeles: readonly Papel[], mes: string): { id: 'subir_liquidacion' | 'preparar_liquidacion' | 'nueva_factura' | null; texto: string | null } {
  if (papeles.includes('platform')) return { id: 'subir_liquidacion', texto: 'Subir liquidación' }
  if (papeles.includes('brand_partner')) return { id: 'preparar_liquidacion', texto: `Preparar liquidación de ${mes}` }
  if (papeles.includes('customer')) return { id: 'nueva_factura', texto: 'Nueva factura' }
  return { id: null, texto: null }
}
