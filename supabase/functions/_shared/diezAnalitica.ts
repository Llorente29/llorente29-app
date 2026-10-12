// supabase/functions/_shared/diezAnalitica.ts
//
// C04b · T3 · La analítica de Diez ↔ Folvy. Núcleo puro.
//
// En Diez la analítica tiene tres niveles (medido en la C0009 el 12/10):
//   Grupo = Local · Subgrupo = Marca · Nivel3 = Plataforma.
// facturas/add la admite en Analitica[] y Diez la guarda; se lee por
// analitica/asiento (facturas/factura no la devuelve).
//
// La correspondencia NO es simétrica, y por eso hay dos tablas (Julio, 12/10):
//   · al LEER, BAR (Juan Antonio Bardem) cuenta como Carabanchel: es Scandal
//     Burger, que se prepara y se recibe en Camichi 4; la dirección de Bardem
//     solo sale porque Glovo no la cambió;
//   · al ENVIAR, Carabanchel va SIEMPRE con CAM (Camichi 4), nunca con BAR.
//     Scandal Burger se dice en el subgrupo, como las demás marcas;
//   · JDH (José del Hierro) no es un local abierto ni tiene ventas: fuera de
//     la correspondencia, y además el cliente lo frena en cualquier envío
//     (GRUPOS_VETADOS en diezCliente.ts).
// Lo que no tiene correspondencia confirmada no se adivina: se envía sin esa
// dimensión y se dice por qué (la analítica es optativa en Diez y no retiene
// ninguna factura).

import { GRUPOS_VETADOS } from './diezCliente.ts'

export type Correspondencia = {
  base: string
  /** Local de Folvy → Grupo de Diez, al enviar. */
  localAlEnviar: Record<string, string>
  /** Grupo de Diez → local de Folvy, al leer. */
  grupoAlLeer: Record<string, string>
  /** Grupos que existen en Diez y se dejan fuera a propósito, con su porqué. */
  gruposFuera: Record<string, string>
  /** Grupos que solo valen al LEER: ningún envío los lleva, con su porqué. */
  gruposSoloLectura: Record<string, string>
  /** Marca de Folvy → Subgrupo de Diez (solo las confirmadas). */
  marcaAlEnviar: Record<string, string>
  /** Canal de Folvy → Nivel3 de Diez. */
  canalAlEnviar: Record<string, string>
}

// Llorente29 (C0008; la C0009 es su copia). Claves de Folvy por NOMBRE de
// local, que es igual en staging y producción; los id no.
export const CORRESPONDENCIA_LLORENTE29: Correspondencia = {
  base: 'C0008',
  localAlEnviar: {
    'Foodint Carabanchel': 'CAM',
    'Foodint Alcalá': 'FLO',
    'Foodint Plaza Castilla': 'CAN',
  },
  grupoAlLeer: {
    CAM: 'Foodint Carabanchel',
    BAR: 'Foodint Carabanchel',
    FLO: 'Foodint Alcalá',
    CAN: 'Foodint Plaza Castilla',
  },
  gruposFuera: {
    JDH: 'José del Hierro: no es un local abierto y no tiene ventas',
  },
  gruposSoloLectura: {
    BAR: 'Carabanchel se envía siempre con CAM (Camichi 4), nunca con BAR',
  },
  // Pendiente de que Julio confirme la tabla de T2 §6.3. Hasta entonces, sin
  // marca: no se adivina.
  marcaAlEnviar: {},
  canalAlEnviar: { glovo: 'GLV', justeat: 'JUS', just_eat: 'JUS', ubereats: 'UBR' },
}

/**
 * Lo que se le pide a una correspondencia antes de usarla. Devuelve los
 * problemas; vacía = vale.
 */
export function revisarCorrespondencia(c: Correspondencia): string[] {
  const p: string[] = []
  const vetados = GRUPOS_VETADOS[c.base] ?? []
  for (const [local, g] of Object.entries(c.localAlEnviar)) {
    if (vetados.includes(g)) p.push(`${local} se enviaría con ${g}, que está vetado`)
    if (g in c.gruposFuera) p.push(`${local} se enviaría con ${g}, que está fuera de la correspondencia`)
    if (g in c.gruposSoloLectura) p.push(`${local} se enviaría con ${g}, que solo vale al leer: ${c.gruposSoloLectura[g]}`)
    // Lo que se envía tiene que leerse como el mismo local.
    if (c.grupoAlLeer[g] !== local) p.push(`${local} se envía con ${g}, pero ${g} se lee como ${c.grupoAlLeer[g] ?? 'nada'}`)
  }
  const usados = Object.values(c.localAlEnviar)
  if (new Set(usados).size !== usados.length) p.push('dos locales se enviarían con el mismo grupo')
  for (const g of Object.keys(c.grupoAlLeer)) if (g in c.gruposFuera) p.push(`${g} está a la vez en la lectura y fuera`)
  return p
}

export type DimensionesFolvy = { local?: string | null; marca?: string | null; canal?: string | null }
export type AnaliticaEnvio = { Grupo?: string; Subgrupo?: string; Nivel3?: string }

/**
 * La analítica de una línea al enviar, y lo que se queda sin poner y por qué.
 * Nunca devuelve un grupo vetado, ni uno de los que están fuera, ni uno de
 * los que solo valen al leer (BAR).
 */
export function analiticaParaEnviar(d: DimensionesFolvy, c: Correspondencia): { analitica: AnaliticaEnvio; sinPoner: string[] } {
  const analitica: AnaliticaEnvio = {}
  const sinPoner: string[] = []
  const vetados = GRUPOS_VETADOS[c.base] ?? []
  if (d.local) {
    const g = c.localAlEnviar[d.local]
    if (!g) sinPoner.push(`local «${d.local}»: sin grupo en Diez`)
    else if (vetados.includes(g) || g in c.gruposFuera || g in c.gruposSoloLectura) sinPoner.push(`local «${d.local}»: su grupo ${g} no se envía`)
    else analitica.Grupo = g
  } else sinPoner.push('sin local')
  if (d.marca) {
    const s = c.marcaAlEnviar[d.marca]
    if (s) analitica.Subgrupo = s
    else sinPoner.push(`marca «${d.marca}»: sin subgrupo confirmado en Diez`)
  }
  if (d.canal) {
    const n = c.canalAlEnviar[d.canal.toLowerCase()]
    if (n) analitica.Nivel3 = n
    else sinPoner.push(`canal «${d.canal}»: sin plataforma en Diez`)
  }
  return { analitica, sinPoner }
}

/** El local de Folvy de un grupo de Diez al leer, o por qué no tiene. */
export function localAlLeer(grupo: string | null | undefined, c: Correspondencia): { local: string } | { sinLocal: string } {
  const g = String(grupo ?? '').trim().toUpperCase()
  if (!g) return { sinLocal: 'sin analítica' }
  if (g in c.gruposFuera) return { sinLocal: `${g}: ${c.gruposFuera[g]}` }
  const local = c.grupoAlLeer[g]
  return local ? { local } : { sinLocal: `${g}: grupo sin correspondencia` }
}
