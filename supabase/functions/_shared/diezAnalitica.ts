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
// Marcas (subgrupos), confirmadas por Julio el 12/10:
//   · 1–8 y 11 son marcas propias de Folvy; el 9 («French Tacos Club» en Diez)
//     es Lovers Burgers igual que el 11: al leer, los dos son Lovers Burgers;
//     al enviar, SIEMPRE el 11 (el 9 lo frena el cliente: SUBGRUPOS_VETADOS);
//   · 10 (Vooger) y 12 (NKD Burger) no tienen marca en Folvy: al leer se
//     conservan con el nombre de Diez;
//   · las cedidas (Milanesa Haus y las otras siete) van por la liquidación con
//     el socio y, si algo suyo llega a Diez, va sin marca; Lobbers ya no existe.
// Lo que no tiene correspondencia confirmada no se adivina: se envía sin esa
// dimensión y se dice por qué (la analítica es optativa en Diez y no retiene
// ninguna factura).

import { GRUPOS_VETADOS, SUBGRUPOS_VETADOS } from './diezCliente.ts'

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
  /** Marca de Folvy → Subgrupo de Diez, al enviar. */
  marcaAlEnviar: Record<string, string>
  /**
   * Subgrupo de Diez → al leer: la marca de Folvy, o el nombre que tiene en
   * Diez si no hay marca de Folvy (se conserva tal cual).
   */
  subgrupoAlLeer: Record<string, { marca: string } | { nombreDiez: string }>
  /** Subgrupos que solo valen al LEER: ningún envío los lleva, con su porqué. */
  subgruposSoloLectura: Record<string, string>
  /** Marcas de Folvy que se envían SIN subgrupo a propósito, con su porqué. */
  marcasSinSubgrupo: Record<string, string>
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
  // Tabla confirmada por Julio (12/10, T2 §6.6).
  marcaAlEnviar: {
    'Milanesa House': '1',
    'Meraki Pita': '2',
    'Scandal Burgers': '3',
    'Smash Brothers Burgers': '4',
    "Mila's Sandwiches": '5',
    'Bendito Burrito': '6',
    'The Urban Kebab': '7',
    'Dirty Burger': '8',
    'Lovers Burgers': '11',
  },
  subgrupoAlLeer: {
    '1': { marca: 'Milanesa House' },
    '2': { marca: 'Meraki Pita' },
    '3': { marca: 'Scandal Burgers' },
    '4': { marca: 'Smash Brothers Burgers' },
    '5': { marca: "Mila's Sandwiches" },
    '6': { marca: 'Bendito Burrito' },
    '7': { marca: 'The Urban Kebab' },
    '8': { marca: 'Dirty Burger' },
    // «French Tacos Club» en Diez: la misma tienda de Glovo (Florencio
    // Llorente 29, Alcalá) que Lovers Burgers; Glovo no cambió los datos.
    '9': { marca: 'Lovers Burgers' },
    '10': { nombreDiez: 'Vooger' },
    '11': { marca: 'Lovers Burgers' },
    '12': { nombreDiez: 'NKD Burger' },
  },
  subgruposSoloLectura: {
    '9': 'Lovers Burgers se envía siempre con el 11, nunca con el 9',
  },
  marcasSinSubgrupo: {
    'Milanesa Haus': 'marca cedida: va por la liquidación con el socio',
    'Ay Mamita Bowls': 'marca cedida: va por la liquidación con el socio',
    'Big Mike´s Burger Joint': 'marca cedida: va por la liquidación con el socio',
    "Big Mike's Burger Joint": 'marca cedida: va por la liquidación con el socio',
    'Birria Burrito': 'marca cedida: va por la liquidación con el socio',
    'Chivuos': 'marca cedida: va por la liquidación con el socio',
    'Deep Pizza': 'marca cedida: va por la liquidación con el socio',
    'Dos Coyotes': 'marca cedida: va por la liquidación con el socio',
    'Koreans do it better - Fried Chicken': 'marca cedida: va por la liquidación con el socio',
    'Lobbers': 'ya no existe y no se usa',
  },
  // R13: en Folvy el canal de Uber se llama «uber» (sales_channel.slug); es UBR.
  canalAlEnviar: { glovo: 'GLV', justeat: 'JUS', just_eat: 'JUS', ubereats: 'UBR', uber: 'UBR' },
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
  const subVetados = SUBGRUPOS_VETADOS[c.base] ?? []
  for (const [marca, sg] of Object.entries(c.marcaAlEnviar)) {
    if (subVetados.includes(sg)) p.push(`${marca} se enviaría con el subgrupo ${sg}, que está vetado`)
    if (sg in c.subgruposSoloLectura) p.push(`${marca} se enviaría con el subgrupo ${sg}, que solo vale al leer: ${c.subgruposSoloLectura[sg]}`)
    const l = c.subgrupoAlLeer[sg]
    if (!l || !('marca' in l) || l.marca !== marca) p.push(`${marca} se envía con el subgrupo ${sg}, pero ${sg} se lee como ${l ? ('marca' in l ? l.marca : l.nombreDiez) : 'nada'}`)
    if (marca in c.marcasSinSubgrupo) p.push(`${marca} tiene subgrupo y a la vez está entre las que van sin`)
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
    const subVetados = SUBGRUPOS_VETADOS[c.base] ?? []
    if (d.marca in c.marcasSinSubgrupo) sinPoner.push(`marca «${d.marca}»: sin marca en Diez (${c.marcasSinSubgrupo[d.marca]})`)
    else if (!s) sinPoner.push(`marca «${d.marca}»: sin subgrupo en Diez`)
    else if (subVetados.includes(s) || s in c.subgruposSoloLectura) sinPoner.push(`marca «${d.marca}»: su subgrupo ${s} no se envía`)
    else analitica.Subgrupo = s
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

/** La marca de un subgrupo de Diez al leer: la de Folvy, o el nombre de Diez si no la hay. */
export function marcaAlLeer(subgrupo: string | number | null | undefined, c: Correspondencia): { marca: string } | { nombreDiez: string } | { sinMarca: string } {
  const s = String(subgrupo ?? '').trim().replace(/^0+(?=\d)/, '')
  if (!s) return { sinMarca: 'sin analítica' }
  return c.subgrupoAlLeer[s] ?? { sinMarca: `subgrupo ${s} sin correspondencia` }
}
