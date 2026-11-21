// src/modules/conta/lib/subcuentaRapida.ts
//
// X20 (21/11) · Crear una subcuenta como en ERP10: el código y el nombre, y nada más. La regla, desde el
// 20/11: si ERP10 lo hace en un paso, Sumied no puede pedir más. Lo que se escribe en «Código»:
//   · entero, con los dígitos del plan: «43000030»;
//   · con punto, como en el resto de Sumied (expandirSubcuenta): «430.30» → 43000030, «572.1» → 57200001;
//   · solo la raíz: «430» → la siguiente libre (43000006), que se deja escrita para aceptarla o cambiarla.
// La cuenta de la que cuelga la busca Sumied: la cuenta del plan, de las que admiten apuntes, más larga cuyo
// número empieza el código (43000030 cuelga de la 4300). Si no hay ninguna, lo dice con el número que falta
// y no inventa nada. Si el código ya existe, lo dice («Ya existe: ábrela»). Puro.

import { expandirSubcuenta } from '@/modules/conta/diseno/valores'
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
  const t = escrito.includes('.') ? expandirSubcuenta(escrito, o.digitos) : escrito
  if (t.includes('.')) return { tipo: 'mal', porque: `Con punto, lo de delante y lo de detrás tienen que caber en ${o.digitos} cifras.` }
  if (!/^\d+$/.test(t)) return { tipo: 'mal', porque: 'El código son cifras: 43000030, o 430.30.' }
  if (t.length > o.digitos) return { tipo: 'mal', porque: `Tu plan tiene ${o.digitos} cifras: sobran ${t.length - o.digitos}.` }
  const ocupados = new Set(o.cuentas.map((c) => c.code))
  let codigo = t
  const propuesta = t.length < o.digitos
  if (propuesta) {
    const siguiente = siguienteLibre(t, o.digitos, ocupados)
    if (!siguiente) return { tipo: 'mal', porque: `Ya no quedan códigos libres que empiecen por ${t}.` }
    codigo = siguiente
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
