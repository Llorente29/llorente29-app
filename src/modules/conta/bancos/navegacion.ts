// src/modules/conta/bancos/navegacion.ts
//
// B01 · Bancos: sus vistas y lo que encuentra el buscador (Ctrl K). Las
// páginas las pone el mapa (esqueleto/productos.ts: Movimientos · Cuentas y
// extractos · Reglas); los favoritos son los del esqueleto, para todo. Sin
// React: se prueba suelto.
//
// S02 · PR 2 (el patrón único): cada página de Bancos pinta su encabezado, y
// lo que dice ese encabezado (título, frase, migas de más) sale de aquí
// (encabezadoDe), igual que si sale el mes y el selector «Tus bancos»: solo
// donde la página los lee (decisión de Julio sobre el periodo, 22/10).
// El cierre del mes del banco se mudó a Contabilidad › Cierre y Registro, al
// lado del de la contabilidad: la dirección de antes (bancos/cierre) lleva allí
// (destinoDelCierre), con su mes y su banco.

import { rutaLibros } from '@/config/navegacion'
import { LO_HECHO } from '@/modules/conta/bancos/marca'
import { nombreMes, ultimosIban } from '@/modules/conta/lib/bancosVista'

export interface PestanaBancos { id: 'movimientos' | 'reglas' | 'cuentas' | 'prestamos'; nombre: string }
export const PESTANAS_BANCOS: PestanaBancos[] = [
  { id: 'movimientos', nombre: 'Movimientos' },
  { id: 'prestamos', nombre: 'Préstamos y aplazamientos' },
  { id: 'cuentas', nombre: 'Cuentas y extractos' },
  { id: 'reglas', nombre: 'Reglas' },
]

/** Lo que tiene ruta propia en Bancos: las tres páginas y dos acciones («Subir extracto» y «Lo que he hecho»). */
export type VistaBancos = PestanaBancos['id'] | 'subir' | 'hecho'
const VISTAS: VistaBancos[] = ['movimientos', 'reglas', 'cuentas', 'prestamos', 'subir', 'hecho']

export function resolverVista(p: string | undefined): VistaBancos {
  return (VISTAS as string[]).includes(p ?? '') ? (p as VistaBancos) : 'movimientos'
}

/** La página que se marca para cada vista («Subir extracto» y «Lo que he hecho» cuelgan de Movimientos). */
export function pestanaDe(v: VistaBancos): PestanaBancos['id'] {
  return v === 'subir' || v === 'hecho' ? 'movimientos' : v
}

// ── El cierre del mes, ahora en Contabilidad ────────────────────────────────

/** La pestaña de antes del cierre del mes del banco. */
export const PESTANA_CIERRE_ANTIGUA = 'cierre'

/**
 * A dónde lleva la dirección de antes (bancos/cierre): Contabilidad › Cierre y
 * Registro › Cerrar el mes, con el mes y el banco si venían (un enlace guardado
 * o un favorito no se pierde). Lo demás de la consulta no le sirve a esa página.
 */
export function destinoDelCierre(search: string): string {
  const antes = new URLSearchParams(search)
  const p = new URLSearchParams()
  const mes = antes.get('mes')
  if (mes && /^\d{4}-\d{2}$/.test(mes)) p.set('mes', mes)
  const banco = antes.get('banco')
  if (banco) p.set('banco', banco)
  const q = p.toString()
  return `${rutaLibros('cierre', 'cerrar-mes')}${q ? `?${q}` : ''}`
}

/**
 * El mes de los bancos en «Cerrar el mes»: el que pide la dirección (?mes=,
 * también si viene de otro ejercicio: se añade a la lista, no se pierde); si
 * no, el último que ya ha terminado (lo que toca cerrar), y si ninguno ha
 * terminado, el más reciente. `meses` son los del ejercicio ('YYYY-MM', de
 * más antiguo a más nuevo). Las opciones, de más nuevo a más antiguo.
 */
export function mesDelCierre(meses: readonly string[], pedido: string | null, hoy: string): { mes: string; opciones: string[] } {
  const valido = pedido && /^\d{4}-(0[1-9]|1[0-2])$/.test(pedido) ? pedido : null
  const todos = [...new Set([...meses, ...(valido ? [valido] : [])])].sort().reverse()
  if (valido) return { mes: valido, opciones: todos }
  const esteMes = hoy.slice(0, 7)
  const terminado = todos.find((m) => m < esteMes)
  return { mes: terminado ?? todos[0] ?? esteMes, opciones: todos.length ? todos : [esteMes] }
}

// ── El encabezado de cada página ────────────────────────────────────────────

/** Si la página lee el mes: solo entonces sale el botón del periodo en la cabecera. */
export const leeElMes = (v: VistaBancos): boolean => v === 'movimientos' || v === 'hecho'
/** Si la página es de UN banco: solo entonces sale «Tus bancos: … ▾» (en las demás no cambiaría nada de lo que se ve). */
export const leeElBanco = (v: VistaBancos): boolean => v === 'movimientos'

export interface EncabezadoBancos {
  titulo: string
  frase: string
  /** Lo que se añade a las migas del mapa («Bancos › Movimientos › Subir extracto»). */
  migasExtra: { etiqueta: string }[]
}

/**
 * El título y la frase de cada página de Bancos, con lo que se ve: qué banco y
 * qué mes en Movimientos (antes iba en unas migas sueltas dentro de la página),
 * el mes en «Lo que he hecho». En palabras de calle y sin nombrar la marca
 * (B02: lo automático habla en primera persona).
 */
export function encabezadoDe(v: VistaBancos, o: { banco: { nombre: string; iban: string | null } | null; mes: string }): EncabezadoBancos {
  const mes = nombreMes(o.mes).toLowerCase()
  switch (v) {
    case 'movimientos': {
      if (!o.banco) return { titulo: 'Movimientos', frase: 'Aún no hay ningún banco: dalo de alta y sube su extracto.', migasExtra: [] }
      const u = ultimosIban(o.banco.iban)
      return {
        titulo: 'Movimientos',
        frase: `${o.banco.nombre}${u ? ` ···${u}` : ''}, ${mes}: lo que trae el banco, para casarlo con contabilidad.`,
        migasExtra: [],
      }
    }
    case 'subir':
      return { titulo: 'Subir extracto', frase: 'Norma 43 o Excel del banco. Un fichero puede traer varias cuentas: cada una va a la suya.', migasExtra: [{ etiqueta: 'Subir extracto' }] }
    case 'hecho':
      return { titulo: LO_HECHO, frase: `En ${mes}, en todos tus bancos, con el porqué de cada cosa. Lo que hice solo se deshace desde aquí.`, migasExtra: [{ etiqueta: LO_HECHO }] }
    case 'reglas':
      return { titulo: 'Reglas', frase: 'Lo que se hace siempre igual. Las uso para proponer; una regla casa sola cuando la has confirmado 3 veces sin corregirla.', migasExtra: [] }
    case 'cuentas':
      return { titulo: 'Cuentas y extractos', frase: 'Tus cuentas del banco, sus tarjetas de débito y lo que se ha subido de cada una.', migasExtra: [] }
    case 'prestamos':
      return { titulo: 'Préstamos y aplazamientos', frase: 'Lo que pagas a plazos: con su cuadro, cada cuota se casa sola con su fila.', migasExtra: [] }
  }
}

// ── El buscador ─────────────────────────────────────────────────────────────

export interface Buscable { vista: VistaBancos; nombre: string; donde: string; palabras: string }
export const BUSCABLES: Buscable[] = [
  { vista: 'movimientos', nombre: 'Movimientos', donde: 'Bancos', palabras: 'movimientos confirmar aclarar casar conciliar' },
  { vista: 'subir', nombre: 'Subir extracto', donde: 'Movimientos', palabras: 'subir extracto norma 43 n43 excel csv fichero importar' },
  { vista: 'hecho', nombre: LO_HECHO, donde: 'Movimientos', palabras: 'hecho folvy deshacer automatico casado solo' },
  { vista: 'reglas', nombre: 'Reglas', donde: 'Bancos', palabras: 'reglas aprender siempre concepto' },
  { vista: 'cuentas', nombre: 'Cuentas y extractos', donde: 'Bancos', palabras: 'cuentas extractos tarjetas iban alta local' },
  { vista: 'prestamos', nombre: 'Préstamos y aplazamientos', donde: 'Bancos', palabras: 'prestamo aplazamiento poliza credito cuadro amortizacion cuota seguridad social hacienda fraccionamiento' },
  { vista: 'cuentas', nombre: 'Tarjetas', donde: 'Cuentas y extractos', palabras: 'tarjeta tarjetas debito titular ticket' },
]

const normal = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export function buscarEnBancos(q: string): Buscable[] {
  const t = normal(q).trim()
  if (!t) return BUSCABLES
  return BUSCABLES.filter((b) => normal(`${b.nombre} ${b.donde} ${b.palabras}`).includes(t))
}

// ── Dónde se abre ───────────────────────────────────────────────────────────

/**
 * S01e · El banco con el que se abre Bancos si la dirección no dice cuál: el de
 * movimientos más recientes (su último extracto); a igualdad, el de más dudas.
 * Antes se abría siempre el primero, aunque no tuviera ningún extracto.
 */
export function bancoInicial<T extends { id: string; ultimoExtracto: { hasta: string } | null }>(
  bancos: readonly T[], dudas: Readonly<Record<string, number>>,
): T | null {
  if (bancos.length === 0) return null
  const conExtracto = bancos.filter((b) => b.ultimoExtracto)
  if (conExtracto.length === 0) return bancos[0]
  return [...conExtracto].sort((a, b) => b.ultimoExtracto!.hasta.localeCompare(a.ultimoExtracto!.hasta) || (dudas[b.id] ?? 0) - (dudas[a.id] ?? 0))[0]
}

/**
 * S01e · El mes con el que se abre si la dirección no lo dice: el del último
 * extracto del banco elegido (donde están sus movimientos), si se puede elegir;
 * si no, el más reciente. Así no se abre en un mes vacío («No hay movimientos de
 * octubre») mientras el banco tiene sus movimientos en septiembre.
 */
export function mesInicial(meses: readonly string[], banco: { ultimoExtracto: { hasta: string } | null } | null, hoy: string): string {
  const delExtracto = banco?.ultimoExtracto?.hasta.slice(0, 7) ?? null
  if (delExtracto && meses.includes(delExtracto)) return delExtracto
  return meses[0] ?? hoy.slice(0, 7)
}
