// src/modules/conta/lib/aprendidoCliente.ts
//
// C03 · Regla 5: «Lo que he aprendido de este cliente», como en proveedores
// (C01b): con su porqué y «Cambiar». Para una plataforma, de sus liquidaciones:
//   · los días del mes en que llega el dinero («Liquida los días 5 y 20»);
//   · el % de comisión que se ve («Comisión 21 %»);
//   · el banco donde cobra.
// Se aprende cuando las ÚLTIMAS 3 (VECES_PARA_APRENDER, la misma de
// proveedores) dicen lo mismo. Lo que la persona fija a mano gana y no se
// desaprende solo. Aprender es proponer: nada se aplica sin confirmar.

import { VECES_PARA_APRENDER } from './aprendizaje'

export interface LiquidacionVista {
  /** Fecha en que llegó el dinero (o, si no consta, la de la liquidación). */
  llegoEl: string | null
  ventas: number | null
  comision: number | null
  banco: string | null
}

export interface AprendidoCliente {
  campo: 'dias_cobro' | 'comision' | 'banco'
  texto: string
  porque: string
  fijadoAMano: boolean
}

const dia = (iso: string) => Number(iso.slice(8, 10))

/** «5 y 20», «5, 15 y 25». */
function listaDias(ds: number[]): string {
  const t = ds.map(String)
  return t.length <= 1 ? t.join('') : `${t.slice(0, -1).join(', ')} y ${t[t.length - 1]}`
}

/**
 * Los días de cobro: el conjunto de días del mes de las últimas liquidaciones.
 * Se aprende si en las últimas 3 × (nº de días distintos) se repite el mismo
 * conjunto (una quincenal necesita 6 para ver dos veces el 5 y el 20).
 */
function diasDeCobro(liqs: LiquidacionVista[]): AprendidoCliente | null {
  const fechas = liqs.map((l) => l.llegoEl).filter((x): x is string => !!x).sort()
  if (fechas.length < VECES_PARA_APRENDER) return null
  const ultimos = fechas.slice(-VECES_PARA_APRENDER * 2)
  const dias = [...new Set(ultimos.map(dia))].sort((a, b) => a - b)
  if (dias.length > 2) return null
  const necesarias = VECES_PARA_APRENDER * dias.length
  if (fechas.length < necesarias) return null
  const recientes = fechas.slice(-necesarias)
  if (!recientes.every((f) => dias.includes(dia(f)))) return null
  return {
    campo: 'dias_cobro',
    texto: dias.length === 1 ? `Liquida el día ${dias[0]}` : `Liquida los días ${listaDias(dias)}`,
    porque: `las últimas ${recientes.length} liquidaciones llegaron así`,
    fijadoAMano: false,
  }
}

/** La comisión vista: comisión / ventas de cada liquidación, redondeada a 0,5 puntos. */
function comisionVista(liqs: LiquidacionVista[]): AprendidoCliente | null {
  const pcts = liqs.filter((l) => l.ventas && l.comision != null)
    .map((l) => Math.round((Math.abs(l.comision as number) / (l.ventas as number)) * 200) / 2)
  if (pcts.length < VECES_PARA_APRENDER) return null
  const ultimos = pcts.slice(-VECES_PARA_APRENDER)
  if (!ultimos.every((p) => p === ultimos[0])) return null
  const iguales = (() => { let n = 0; for (let i = pcts.length - 1; i >= 0 && pcts[i] === ultimos[0]; i--) n++; return n })()
  return {
    campo: 'comision',
    texto: `Comisión ${String(ultimos[0]).replace('.', ',')} %`,
    porque: iguales === pcts.length ? `igual en las ${iguales}; si cambia, te aviso` : `igual en las últimas ${iguales}; antes fue distinta`,
    fijadoAMano: false,
  }
}

function bancoDeCobro(liqs: LiquidacionVista[]): AprendidoCliente | null {
  const bancos = liqs.map((l) => l.banco).filter((b): b is string => !!b)
  if (bancos.length < VECES_PARA_APRENDER) return null
  const ultimos = bancos.slice(-VECES_PARA_APRENDER)
  if (!ultimos.every((b) => b === ultimos[0])) return null
  return { campo: 'banco', texto: `Cobro por transferencia a ${ultimos[0]}`, porque: `las ${bancos.filter((b) => b === ultimos[0]).length} llegaron ahí`, fijadoAMano: false }
}

/**
 * Lo aprendido, en el orden de la maqueta (días, comisión, banco). Lo fijado
 * a mano sustituye a lo aprendido de su campo y dice que lo fijó la persona.
 * Las liquidaciones, de la más antigua a la más reciente.
 */
export function aprendidoDeCliente(
  liqs: LiquidacionVista[],
  fijado: Partial<Record<AprendidoCliente['campo'], string>> = {},
): AprendidoCliente[] {
  const out: AprendidoCliente[] = []
  for (const [campo, calcular] of [['dias_cobro', diasDeCobro], ['comision', comisionVista], ['banco', bancoDeCobro]] as const) {
    const aMano = fijado[campo]
    if (aMano) { out.push({ campo, texto: aMano, porque: 'lo has fijado tú', fijadoAMano: true }); continue }
    const a = calcular(liqs)
    if (a) out.push(a)
  }
  return out
}
