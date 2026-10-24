// src/modules/conta/lib/tiendas.ts
//
// D01 · «Sus tiendas» en la ficha de una plataforma (Julio, 16/10). Cada
// tienda, tal como la nombra la plataforma (Uber: el saludo de su resumen,
// «Marca (dirección)»), con su marca, su local y la cuenta donde cobra. Sin
// marca y local, sus liquidaciones no se pueden comparar ni asentar.
//
// Puro: el estado de cada fila, la marca que se propone por el nombre y lo que
// se dice al guardar (regla 8: con contenido). Lo prueba
// tests/unit/modules/conta/tiendas.test.ts.

export interface TiendaPlataforma {
  id: string
  /** Como la nombra la plataforma. */
  nombre: string
  marcaId: string | null
  localId: string | null
  bancoId: string | null
  /** Cuántas liquidaciones suyas hay. */
  liquidaciones: number
}

export interface Opcion { id: string; nombre: string }

export type EstadoTienda = 'asignada' | 'sin_asignar' | 'sin_banco'

/** Asignada = con marca y local; sin la cuenta de cobro también se compara, pero el cobro no se casa solo. */
export function estadoTienda(t: Pick<TiendaPlataforma, 'marcaId' | 'localId' | 'bancoId'>): EstadoTienda {
  if (!t.marcaId || !t.localId) return 'sin_asignar'
  return t.bancoId ? 'asignada' : 'sin_banco'
}

const plano = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/**
 * La marca que se propone para una tienda sin marca: la que se llama igual que
 * lo que va antes del paréntesis («Marca (dirección)»), sin mirar tildes ni
 * mayúsculas. Si no hay una sola igual, ninguna: no se adivina.
 */
export function marcaPropuesta(nombreTienda: string, marcas: readonly Opcion[]): string | null {
  const antes = plano(nombreTienda.replace(/\s*\(.*$/, ''))
  if (!antes) return null
  const iguales = marcas.filter((m) => plano(m.nombre) === antes)
  return iguales.length === 1 ? iguales[0].id : null
}

/** El resumen de arriba: cuántas faltan y qué pasa con ellas. */
export function resumenTiendas(ts: readonly TiendaPlataforma[]): string {
  if (ts.length === 0) return 'Aún no ha llegado ninguna tienda suya: entran solas con su primer resumen de pagos.'
  const sin = ts.filter((t) => estadoTienda(t) === 'sin_asignar').length
  const sinBanco = ts.filter((t) => estadoTienda(t) === 'sin_banco').length
  const de = `${ts.length} ${ts.length === 1 ? 'tienda' : 'tiendas'}`
  if (sin === 0 && sinBanco === 0) return ts.length === 1 ? 'La tienda tiene su marca, su local y su cuenta de cobro.' : `Las ${ts.length} tiendas tienen su marca, su local y su cuenta de cobro.`
  const partes: string[] = []
  if (sin) partes.push(`${sin === 1 ? '1 no tiene' : `${sin} no tienen`} marca y local: sus liquidaciones no se comparan ni se asientan hasta que se lo digas`)
  if (sinBanco) partes.push(`${sinBanco === 1 ? '1 no tiene' : `${sinBanco} no tienen`} cuenta de cobro: su cobro no se casa solo en Bancos`)
  return `De ${de}, ${partes.join('; ')}.`
}

/** Lo que se dice al guardar una fila. */
export function textoGuardada(t: { nombre: string; liquidaciones: number }, marca: string | null, local: string | null, banco: string | null): string {
  const que = marca && local ? `es ${marca} en ${local}` : 'queda sin marca y local'
  const cobro = banco ? `; cobra en ${banco}` : '; sin cuenta de cobro'
  const liqs = marca && local && t.liquidaciones > 0
    ? ` ${t.liquidaciones === 1 ? 'Su liquidación ya tiene' : `Sus ${t.liquidaciones} liquidaciones ya tienen`} marca y local.`
    : ''
  return `Guardado: «${t.nombre}» ${que}${cobro}.${liqs}`
}
