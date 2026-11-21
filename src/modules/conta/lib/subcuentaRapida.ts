// src/modules/conta/lib/subcuentaRapida.ts
//
// X20 (21/11) · Crear una subcuenta como en ERP10: el código y el nombre, y nada más. La regla, desde el
// 20/11: si ERP10 lo hace en un paso, Sumied no puede pedir más. Lo que se escribe en «Código»:
//   · entero, con los dígitos del plan: «43000030»;
//   · corto o con punto, EXACTAMENTE como en la ficha de la factura (X21: la misma pieza, codigoEscrito de
//     nucleo/ficha/teclas.ts, para que en toda la aplicación se escriba igual): las tres primeras cifras son la
//     cuenta y el resto, el número, con ceros en medio: «4301» → 43000001, «6001» → 60000001; «430.30» → 43000030;
//   · solo la raíz (tres cifras o menos): «430» → la siguiente libre (43000006), que se deja escrita para
//     aceptarla o cambiarla.
// La cuenta de la que cuelga la busca Sumied: la cuenta del plan, de las que admiten apuntes, más larga cuyo
// número empieza el código (43000030 cuelga de la 4300). Si no hay ninguna, lo dice con el número que falta
// y no inventa nada. Si el código ya existe, lo dice («Ya existe: ábrela»). Puro.

import { codigoEscrito, cuentasQueEncajan } from '@/modules/conta/nucleo/ficha/teclas'
import { siguienteLibre } from '@/modules/conta/lib/planEmpresa'

export type SeriePlan = { code: string; name: string; isLeaf: boolean }
export type CuentaDelPlan = { id: string; code: string; name: string }

export type LecturaCodigo =
  | { tipo: 'vacio' }
  | { tipo: 'mal'; porque: string }
  | { tipo: 'existe'; codigo: string; id: string; nombre: string }
  | { tipo: 'no_esta'; codigo: string; falta: string; porque: string }
  /** `propuesta`: se escribió la raíz y Sumied ha puesto la siguiente libre. */
  | { tipo: 'nueva'; codigo: string; hoja: { code: string; name: string }; propuesta: boolean }

/** Qué se ha escrito en «Código», contra el plan de la empresa. */
export function leerCodigo(texto: string, o: { digitos: number; serie: readonly SeriePlan[]; cuentas: readonly CuentaDelPlan[] }): LecturaCodigo {
  const escrito = texto.replace(/\s/g, '')
  if (!escrito) return { tipo: 'vacio' }
  if (!/^\d+(\.\d+)?$/.test(escrito)) return { tipo: 'mal', porque: 'El código son cifras: 43000030, 4301 o 430.30.' }
  const ocupados = new Set(o.cuentas.map((c) => c.code))
  // La raíz sola (tres cifras o menos, sin punto): la siguiente libre.
  const propuesta = !escrito.includes('.') && escrito.length < 4
  let codigo: string
  if (propuesta) {
    const siguiente = siguienteLibre(escrito, o.digitos, ocupados)
    if (!siguiente) return { tipo: 'mal', porque: `Ya no quedan códigos libres que empiecen por ${escrito}.` }
    codigo = siguiente
  } else {
    const c = codigoEscrito(escrito, o.digitos)
    if (!c) {
      return escrito.includes('.')
        ? { tipo: 'mal', porque: `Con punto, lo de delante y lo de detrás tienen que caber en ${o.digitos} cifras.` }
        : { tipo: 'mal', porque: `Tu plan tiene ${o.digitos} cifras: sobran ${escrito.length - o.digitos}.` }
    }
    codigo = c
  }
  const ya = o.cuentas.find((c) => c.code === codigo)
  if (ya) return { tipo: 'existe', codigo, id: ya.id, nombre: ya.name }
  const hoja = cuelgaDe(codigo, o.serie)
  if (!hoja) {
    // El número que falta: el primero que el plan no tiene (439 si el plan llega a la 43), como mínimo de tres cifras.
    const llega = o.serie.filter((s) => codigo.startsWith(s.code)).reduce((m, s) => Math.max(m, s.code.length), 0)
    const falta = codigo.slice(0, Math.min(codigo.length - 1, Math.max(3, llega + 1)))
    return { tipo: 'no_esta', codigo, falta, porque: `La ${falta} no está en tu plan: no hay de qué cuenta colgarla.` }
  }
  return { tipo: 'nueva', codigo, hoja: { code: hoja.code, name: hoja.name }, propuesta }
}

/** La cuenta del plan de la que cuelga un código: la de apuntes más larga cuyo número lo empieza (más corta que él). */
export function cuelgaDe(codigo: string, serie: readonly SeriePlan[]): SeriePlan | null {
  let mejor: SeriePlan | null = null
  for (const s of serie) {
    if (!s.isLeaf || s.code.length >= codigo.length || !codigo.startsWith(s.code)) continue
    if (!mejor || s.code.length > mejor.code.length) mejor = s
  }
  return mejor
}

/** La ficha que se ofrece al lado al crearla: la del cliente (430), del proveedor o acreedor (400 y 410) o del banco (572). */
export function fichaDeSubcuenta(codigo: string): 'cliente' | 'proveedor' | 'banco' | null {
  if (codigo.startsWith('430')) return 'cliente'
  if (codigo.startsWith('400') || codigo.startsWith('410')) return 'proveedor'
  if (codigo.startsWith('572')) return 'banco'
  return null
}

/** Lo que se dice debajo de las dos casillas, en palabras de la calle. */
export function fraseCodigo(l: LecturaCodigo): string | null {
  if (l.tipo === 'vacio') return null
  if (l.tipo === 'mal' || l.tipo === 'no_esta') return l.porque
  if (l.tipo === 'existe') return `Ya existe: la ${l.codigo} · ${l.nombre}.`
  return `Será la ${l.codigo}, bajo la ${l.hoja.code} · ${l.hoja.name}.`
}

/**
 * X21b (Julio, 21/11) · «No está» solo si no está en el PLAN ENTERO, nunca en la lista filtrada de un buscador
 * (regla 30: la lista con la que se elige no es la lista con la que se lee). Lo escrito, contra todas las subcuentas
 * de la empresa: un código entero, corto o con punto (como en la ficha: codigoEscrito), o un nombre (las mismas
 * palabras que el buscador, cuentasQueEncajan). La raíz sola («430») no cuenta: con ella se crea la siguiente libre.
 * Devuelve la primera que encaja y cuántas más, o null si no está.
 */
export function yaEnElPlan(texto: string, cuentas: readonly { code: string; name: string; status?: string | null }[], digitos: number):
  { code: string; name: string; cerrada: boolean; mas: number } | null {
  const t = texto.trim()
  if (!t) return null
  const subcuentas = cuentas.filter((c) => c.code.length === digitos)
  const de = (code: string, mas: number) => {
    const c = subcuentas.find((x) => x.code === code)
    return c ? { code: c.code, name: c.name, cerrada: c.status === 'cerrada', mas } : null
  }
  const escrito = t.replace(/\s/g, '')
  if (/^[\d.]+$/.test(escrito)) {
    if (!escrito.includes('.') && escrito.length < 4) return null
    const completo = codigoEscrito(escrito, digitos)
    return completo ? de(completo, 0) : null
  }
  const encajan = cuentasQueEncajan(t, subcuentas.map((c) => ({ codigo: c.code, nombre: c.name })), digitos)
  return encajan.length ? de(encajan[0].codigo, encajan.length - 1) : null
}

/** La frase cuando existe pero no sale en ese buscador: «La 43000004 · Cliente existe, pero aquí solo van bancos y caja.» */
export function textoYaEnElPlan(c: { code: string; name: string; cerrada: boolean; mas: number }, porque: string | null): string {
  const cual = `La ${c.code} · ${c.name}`
  const otras = c.mas > 0 ? ` (y ${c.mas} más con ese nombre)` : ''
  if (c.cerrada) return `${cual}${otras} existe, pero está cerrada: ábrela en Plan contable para usarla.`
  return `${cual}${otras} existe, pero aquí ${porque ?? 'no sale en esta lista'}.`
}
