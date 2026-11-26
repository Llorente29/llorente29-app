// supabase/functions/_shared/cobro/porBanco.ts
//
// K14 (26/11) · LO COBRADO POR EL BANCO, CASADO SOLO CON SU CLIENTE. QBO no cobra solo por GoCardless: también por
// transferencia, Bizum y tarjeta (TPV). Desde noviembre solo se factura lo cobrado y confirmado, por la vía que sea
// (regla de Julio). Este motor, puro, dice de cada entrada del banco que no es de GoCardless:
//
//   · por qué vía entró (transferencia, traspaso, Bizum, ingreso en cajero, tarjeta, GoCardless u otra);
//   · de qué cliente es, en este orden: el NIF que venga en el concepto; el IBAN contra los del cliente; el nombre del
//     que paga contra la ficha (persona o empresa) y contra el nombre del cliente en GoCardless; y el texto libre (un
//     nombre que venga en él). Lo que no es seguro va a «Por confirmar» con su propuesta; no se adivina. Un apellido
//     común no basta: hacen falta dos palabras del nombre y que no sean todas de las muy comunes;
//   · si el cliente tiene recibos de GoCardless sin cobrar, a cuáles paga (por fecha, del más antiguo al más nuevo):
//     quedan pagados por el banco; el recargo de devolución (2 € por recibo: 1,65 € más IVA, concepto 0018 de Cegid) se
//     apunta como recargo; lo que sobre, como cobro del cliente del mes;
//   · si el cliente no tiene recibos pendientes, la entrada entera es cobro del mes de ese cliente, lista para facturar;
//   · el TPV (Comercia Global Payments) va aparte: es el total de un día, «Cobrado con tarjeta, sin asignar». No se
//     reparte ni se adivina.
//
// Lo prueba tests/unit/modules/conta/k14/porBanco.test.ts (todo inventado, T11).

export type Via = 'transferencia' | 'traspaso' | 'bizum' | 'cajero' | 'tarjeta' | 'gocardless' | 'otra'

export interface EntradaBanco { id: string; fecha: string; importeCent: number; concepto: string }

export interface ClienteBanco {
  partyId: string
  /** El nombre de la ficha (persona o empresa). */
  nombre: string
  nif: string | null
  /** Los nombres del cliente en GoCardless (pueden ser otros: el titular de la cuenta). */
  nombresGc: string[]
  ibans: string[]
}

/** Un recibo de GoCardless que no se cobró (fallido o devuelto) y que nadie ha pagado todavía. */
export interface ReciboSinCobrar { gcId: string; partyId: string; fecha: string; importeCent: number }

export type Estado = 'casado' | 'por_confirmar' | 'sin_cliente' | 'tarjeta' | 'gocardless' | 'no_es_cobro'

/** Lo que decidió una persona de una entrada: es de este cliente, o de ninguno (partyId null). */
export interface Decision { partyId: string | null }

export interface Aplicacion { gcId: string; importeCent: number }

export interface Casado {
  entradaId: string
  fecha: string
  importeCent: number
  via: Via
  estado: Estado
  /** El cliente (casado) o el propuesto (por confirmar). */
  partyId: string | null
  /** Por qué: «NIF 00000000T en el concepto», «Nombre del que paga: …», «Varios clientes se llaman así»… */
  porque: string
  /** Los recibos de GoCardless que paga (si es su cliente y los tiene). */
  recibos: Aplicacion[]
  recargoCent: number
  /** Lo que queda como cobro del cliente del mes (para facturar). */
  cobroCent: number
  /** El mes de la factura: el de la entrada (AAAA-MM). */
  mes: string
}

// ── La vía y quién paga, del concepto ───────────────────────────────────────────────────────────────────────────────

export function viaDe(concepto: string): Via {
  const u = concepto.toUpperCase()
  if (u.includes('GOCARDLESS')) return 'gocardless'
  if (u.includes('COMERCIA GLOBAL') || /^WEB\d{6,}\b/.test(u)) return 'tarjeta'
  if (u.startsWith('BIZUM') || u.includes(' BIZUM')) return 'bizum'
  if (u.startsWith('TRASPASO')) return 'traspaso'
  if (u.startsWith('TRANSF') || u.startsWith('TRANSFER')) return 'transferencia'
  if (u.startsWith('INGRESO CAJERO') || u.startsWith('INGRESO EN EFECTIVO')) return 'cajero'
  return 'otra'
}

const partes = (concepto: string) => concepto.split(',').map((x) => x.trim())

/** Quién paga y el texto libre, según la forma de cada vía en el extracto. */
export function ordenanteYTexto(concepto: string): { ordenante: string | null; texto: string } {
  const p = partes(concepto)
  const via = viaDe(concepto)
  const esRef = (x: string) => /^\d{6,}$/.test(x) || /\bORIGEN:/i.test(x) || /[A-Z]{6}[A-Z0-9]{2}XXX$/i.test(x)
  let ord: string | null = null
  if (via === 'transferencia' || via === 'traspaso' || via === 'bizum') {
    ord = (p[1] ?? '').replace(/^\d{6,}-/, '').trim() || null
  }
  const limpio = (x: string) => x.replace(/^\d{6,}-/, '').trim()
  const texto = p.slice(via === 'cajero' ? 1 : 2)
    .filter((x) => x !== '' && !esRef(x))
    .map(limpio)
    .filter((x) => !ord || x !== ord && !x.startsWith(`${ord} `))
    .filter((x, i, xs) => xs.indexOf(x) === i)
    .join(' · ')
  return { ordenante: ord, texto }
}

// ── NIF, IBAN y nombres ─────────────────────────────────────────────────────────────────────────────────────────────

/** Un NIF, también pegado a una referencia («B00000000001»: el NIF y tres cifras más). */
const RE_NIF = /(?<![A-Z0-9])([XYZ]\d{7}[A-Z]|\d{8}[A-Z]|[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J])(?![A-Z])/g
const RE_IBAN = /\b([A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){4,7}(?:\s?[A-Z0-9]{1,3})?)\b/g
const nifLimpio = (x: string) => x.toUpperCase().replace(/[\s.-]/g, '')

export function nifsEn(texto: string): string[] {
  return [...texto.toUpperCase().matchAll(RE_NIF)].map((m) => m[1])
}
export function ibansEn(texto: string): string[] {
  return [...texto.toUpperCase().matchAll(RE_IBAN)].map((m) => m[1].replace(/\s/g, ''))
}

/** Palabras que no dicen quién es: artículos, formas de sociedad. */
const VACIAS = new Set(['DE', 'DEL', 'LA', 'LAS', 'LOS', 'EL', 'Y', 'E', 'SL', 'SLU', 'SA', 'SAU', 'SC', 'SCP', 'CB', 'SLL', 'SLP', 'SOCIEDAD', 'LIMITADA', 'ANONIMA', 'SRL', 'SLR', 'S', 'L', 'U', 'A', 'RR'])
/** Nombres y apellidos muy comunes: dos de estos solos no bastan para casar. */
const COMUNES = new Set(['MARIA', 'JOSE', 'JUAN', 'ANTONIO', 'MANUEL', 'FRANCISCO', 'DAVID', 'JAVIER', 'CARLOS', 'ANA', 'CARMEN', 'LAURA', 'LUIS', 'PEDRO',
  'JESUS', 'MIGUEL', 'ANGEL', 'DANIEL', 'ALEJANDRO', 'RAFAEL', 'ISABEL', 'ROSA', 'ELENA', 'PILAR', 'DOLORES', 'LUCIA', 'SARA', 'PAULA', 'ANDREA',
  'GARCIA', 'GONZALEZ', 'RODRIGUEZ', 'FERNANDEZ', 'LOPEZ', 'MARTINEZ', 'SANCHEZ', 'PEREZ', 'GOMEZ', 'MARTIN', 'JIMENEZ', 'RUIZ', 'HERNANDEZ',
  'DIAZ', 'MORENO', 'ALVAREZ', 'MUNOZ', 'ROMERO', 'ALONSO', 'GUTIERREZ', 'NAVARRO', 'TORRES', 'DOMINGUEZ', 'VAZQUEZ', 'RAMOS', 'GIL', 'RAMIREZ',
  'SERRANO', 'BLANCO', 'SUAREZ', 'MOLINA', 'MORALES', 'ORTEGA', 'DELGADO', 'CASTRO', 'ORTIZ', 'RUBIO', 'MARIN', 'SANZ', 'NUNEZ', 'IGLESIAS', 'MEDINA'])

/** Las palabras de un nombre: en mayúsculas, sin tildes ni signos; «**» (una letra que el banco no sabe escribir) queda como «?». */
export function palabras(nombre: string): string[] {
  return nombre.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\*\*/g, '?')
    .replace(/[^A-Z?Ñ ]+/g, ' ').split(/\s+/).filter((w) => w.length >= 2 && !VACIAS.has(w))
}

/** ¿La palabra del banco es esta palabra de la ficha? «?» vale por una o dos letras; la última puede venir cortada. */
function igual(banco: string, ficha: string, cortada: boolean): boolean {
  if (!banco.includes('?')) return banco === ficha || (cortada && banco.length >= 2 && ficha.startsWith(banco))
  const re = new RegExp(`^${banco.replace(/\?/g, '.{1,2}')}${cortada ? '' : '$'}`)
  return re.test(ficha)
}

/** Cuántas palabras del que paga están en un nombre de la ficha (todas, si es él). */
function encaje(ord: string[], ficha: string[], cortado: boolean): number {
  let n = 0
  ord.forEach((w, i) => { if (ficha.some((f) => igual(w, f, cortado && i === ord.length - 1))) n++ })
  return n
}


export interface Encaje { partyId: string; completo: boolean; palabras: number; distintivas: number; exacto?: boolean }

/** El nombre de la ficha sin la persona de contacto entre paréntesis («EMPRESA INVENTADA SL (NOMBRE APELLIDO)»). */
const sinContacto = (n: string) => n.replace(/\([^)]*\)?/g, ' ')

/**
 * Los clientes cuyo nombre (ficha o GoCardless) encaja con un nombre del banco, del mejor al peor. El banco corta el
 * nombre del que paga (a 32 caracteres con su prefijo, y a veces antes): con «cortado», la última palabra puede venir a medias.
 */
export function clientesPorNombre(nombreBanco: string, clientes: readonly ClienteBanco[], cortado = false): Encaje[] {
  const ord = palabras(nombreBanco)
  if (!ord.length) return []
  const out: Encaje[] = []
  for (const c of clientes) {
    let mejor: Encaje | null = null
    for (const n of [c.nombre, ...c.nombresGc]) {
      const f = palabras(n)
      if (!f.length) continue
      const p = encaje(ord, f, cortado)
      if (!p) continue
      // Una palabra cortada no cuenta como distintiva: «MAR» puede ser muchas.
      const distintivas = ord.filter((w) => !COMUNES.has(w) && f.some((x) => igual(w, x, false))).length
      // El mismo nombre, palabra por palabra o todo junto («FLOWLOGISTIC» y «FLOW LOGISTIC»), sin el contacto de la ficha.
      const g = palabras(sinContacto(n))
      const exacto = (g.length === ord.length && ord.every((w) => g.includes(w))) || (ord.join('').length >= 8 && ord.join('') === g.join(''))
      const e = { partyId: c.partyId, completo: p === ord.length || exacto, palabras: Math.max(p, exacto ? ord.length : 0), distintivas: exacto ? Math.max(distintivas, ord.some((w) => !COMUNES.has(w)) ? 1 : 0) : distintivas, exacto }
      if (!mejor || e.palabras > mejor.palabras || (e.palabras === mejor.palabras && e.distintivas > mejor.distintivas)) mejor = e
    }
    if (mejor) out.push(mejor)
  }
  return out.sort((a, b) => Number(b.completo) - Number(a.completo) || b.palabras - a.palabras || b.distintivas - a.distintivas)
}

/**
 * Los clientes cuyo nombre entero (ficha o GoCardless) está dentro del texto libre («Mes de noviembre Peluqueria
 * Inventada SL»). Solo nombres de dos palabras o más: un nombre de una sola palabra en un texto no basta.
 */
export function clientesEnElTexto(texto: string, clientes: readonly ClienteBanco[]): Encaje[] {
  const t = new Set(palabras(texto))
  if (!t.size) return []
  const out: Encaje[] = []
  for (const c of clientes) {
    for (const n of [c.nombre, ...c.nombresGc]) {
      const f = palabras(sinContacto(n))
      if (f.length < 2 || !f.every((w) => t.has(w))) continue
      out.push({ partyId: c.partyId, completo: true, palabras: f.length, distintivas: f.filter((w) => !COMUNES.has(w)).length })
      break
    }
  }
  return out.sort((a, b) => b.palabras - a.palabras || b.distintivas - a.distintivas)
}

/**
 * ¿Basta este encaje para casar solo? Todas las palabras del que paga, al menos dos y no todas muy comunes (o tres); o
 * el nombre exacto de la ficha con una palabra que no es común (una empresa de una sola palabra, «INVENTADA SL»).
 */
const seguro = (e: Encaje) => e.completo && e.distintivas >= 1 && (e.palabras >= 2 || (e.exacto === true && e.palabras >= 1))
  || e.completo && e.palabras >= 3

/** Los encajes de las dos búsquedas, el mejor de cada cliente (uno que basta gana a uno que solo se parece). */
const unir = (a: readonly Encaje[], b: readonly Encaje[]) => {
  const mejor = new Map<string, Encaje>()
  for (const x of [...a, ...b]) {
    const y = mejor.get(x.partyId)
    if (!y || (seguro(x) && !seguro(y)) || (seguro(x) === seguro(y) && x.palabras > y.palabras)) mejor.set(x.partyId, x)
  }
  return [...mejor.values()].sort((p, q) => Number(seguro(q)) - Number(seguro(p)) || q.palabras - p.palabras || q.distintivas - p.distintivas)
}

// ── Quién es ────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface Quien { estado: 'casado' | 'por_confirmar' | 'sin_cliente'; partyId: string | null; porque: string }

/**
 * Entre varios clientes que encajan igual (la ficha de la empresa y la persona que la paga por GoCardless, con el mismo
 * nombre), el único al que este importe le paga recibos sin cobrar enteros, sin que sobre más que el recargo.
 */
function elDeLosRecibos(cs: readonly Encaje[], e: EntradaBanco, pendientes?: ReadonlyMap<string, readonly ReciboSinCobrar[]>): Encaje | null {
  if (!pendientes) return null
  const con = cs.filter((c) => { const a = aplicar(e.importeCent, e.fecha, pendientes.get(c.partyId) ?? []); return a.recibos.length > 0 && a.cobroCent === 0 })
  return con.length === 1 ? con[0] : null
}

export function quienEs(e: EntradaBanco, clientes: readonly ClienteBanco[], pendientes?: ReadonlyMap<string, readonly ReciboSinCobrar[]>): Quien {
  const { ordenante, texto } = ordenanteYTexto(e.concepto)
  // 1 · El NIF del concepto.
  for (const nif of nifsEn(e.concepto)) {
    const cs = clientes.filter((c) => c.nif && nifLimpio(c.nif) === nif)
    if (cs.length === 1) return { estado: 'casado', partyId: cs[0].partyId, porque: `NIF ${nif} en el concepto` }
    if (cs.length > 1) return { estado: 'por_confirmar', partyId: cs[0].partyId, porque: `El NIF ${nif} es de ${cs.length} clientes` }
  }
  // 2 · El IBAN contra el del cliente.
  for (const iban of ibansEn(e.concepto)) {
    const cs = clientes.filter((c) => c.ibans.some((i) => i.replace(/\s/g, '').toUpperCase() === iban))
    if (cs.length === 1) return { estado: 'casado', partyId: cs[0].partyId, porque: `IBAN ····${iban.slice(-4)} del cliente` }
    if (cs.length > 1) return { estado: 'por_confirmar', partyId: cs[0].partyId, porque: `El IBAN ····${iban.slice(-4)} es de ${cs.length} clientes` }
  }
  // 3 · El nombre del que paga (y 4 · un nombre en el texto libre).
  for (const [de, nombre] of [['El que paga', ordenante], ['El texto', texto]] as const) {
    if (!nombre) continue
    const es = unir(clientesPorNombre(nombre, clientes, true), clientesEnElTexto(nombre, clientes))
    if (!es.length) continue
    const seguros = es.filter(seguro)
    if (seguros.length === 1) return { estado: 'casado', partyId: seguros[0].partyId, porque: `${de}: «${nombre}»` }
    if (seguros.length > 1) {
      const r = elDeLosRecibos(seguros, e, pendientes)
      if (r) return { estado: 'casado', partyId: r.partyId, porque: `${de}: «${nombre}» encaja con ${seguros.length} clientes; solo uno tiene recibos sin cobrar de este importe` }
      return { estado: 'por_confirmar', partyId: seguros[0].partyId, porque: `${de}: «${nombre}» encaja con ${seguros.length} clientes` }
    }
    return { estado: 'por_confirmar', partyId: es[0].partyId, porque: `${de}: «${nombre}» se parece, pero no basta (${es[0].palabras} ${es[0].palabras === 1 ? 'palabra' : 'palabras'})` }
  }
  return { estado: 'sin_cliente', partyId: null, porque: ordenante ? `Ningún cliente se llama «${ordenante}»` : 'El concepto no dice quién paga' }
}

// ── A qué recibos paga ──────────────────────────────────────────────────────────────────────────────────────────────

/** El recargo de devolución de cada recibo: 1,65 € más IVA (concepto 0018 de Cegid). */
export const RECARGO_CENT = 200

/**
 * Lo que paga una entrada de un cliente: sus recibos sin cobrar de hasta ese día, del más antiguo al más nuevo, los que
 * quepan enteros (uno que no cabe se salta: no se paga a medias); el recargo (hasta 2 € por recibo pagado); y el resto, cobro del mes. Sin recibos, todo es cobro.
 */
export function aplicar(importeCent: number, fecha: string, recibos: readonly ReciboSinCobrar[]): { recibos: Aplicacion[]; recargoCent: number; cobroCent: number } {
  let queda = importeCent
  const pagados: Aplicacion[] = []
  for (const r of [...recibos].filter((x) => x.fecha <= fecha).sort((a, b) => a.fecha.localeCompare(b.fecha) || a.gcId.localeCompare(b.gcId))) {
    if (r.importeCent > queda) continue
    pagados.push({ gcId: r.gcId, importeCent: r.importeCent })
    queda -= r.importeCent
  }
  const recargoCent = pagados.length ? Math.min(queda, RECARGO_CENT * pagados.length) : 0
  return { recibos: pagados, recargoCent, cobroCent: queda - recargoCent }
}

// ── Todo el extracto ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Casa las entradas de un extracto. Las salidas no se miran. Los recibos que una entrada ya paga no los paga otra (se
 * van gastando en orden de fecha de la entrada). Lo que está por confirmar lleva su propuesta, sin gastar recibos. Lo
 * que decidió una persona («Sí, es este», «Es otro…», «No es de ningún cliente») manda sobre el motor.
 */
export function casarExtracto(entradas: readonly EntradaBanco[], clientes: readonly ClienteBanco[], recibos: readonly ReciboSinCobrar[],
  decisiones: ReadonlyMap<string, Decision> = new Map()): Casado[] {
  const pendientes = new Map<string, ReciboSinCobrar[]>()
  for (const r of recibos) pendientes.set(r.partyId, [...(pendientes.get(r.partyId) ?? []), r])
  const out: Casado[] = []
  for (const e of [...entradas].filter((x) => x.importeCent > 0).sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id.localeCompare(b.id))) {
    const via = viaDe(e.concepto)
    const base = { entradaId: e.id, fecha: e.fecha, importeCent: e.importeCent, via, mes: e.fecha.slice(0, 7), recibos: [] as Aplicacion[], recargoCent: 0, cobroCent: 0 }
    if (via === 'gocardless') { out.push({ ...base, estado: 'gocardless', partyId: null, porque: 'Abono de GoCardless: sus cobros ya están en Sumied' }); continue }
    if (via === 'tarjeta') { out.push({ ...base, estado: 'tarjeta', partyId: null, porque: 'Total de un día del TPV: cobrado con tarjeta, sin asignar' }); continue }
    const d = decisiones.get(e.id)
    if (d && d.partyId === null) { out.push({ ...base, estado: 'no_es_cobro', partyId: null, porque: 'Una persona dijo que no es de ningún cliente' }); continue }
    const q: Quien = d ? { estado: 'casado', partyId: d.partyId, porque: 'Lo confirmó una persona' } : quienEs(e, clientes, pendientes)
    if (q.estado === 'casado' && q.partyId) {
      const suyos = pendientes.get(q.partyId) ?? []
      const a = aplicar(e.importeCent, e.fecha, suyos)
      const pagados = new Set(a.recibos.map((r) => r.gcId))
      pendientes.set(q.partyId, suyos.filter((r) => !pagados.has(r.gcId)))
      out.push({ ...base, estado: 'casado', partyId: q.partyId, porque: q.porque, ...a })
    } else {
      out.push({ ...base, estado: q.estado, partyId: q.partyId, porque: q.porque, cobroCent: 0 })
    }
  }
  return out
}

/** Céntimos como «1.234,56» (sin el signo ni el «€»). */
export function eurosTexto(cent: number): string {
  const e = Math.abs(Math.round(cent))
  return `${String(Math.floor(e / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${String(e % 100).padStart(2, '0')}`
}

/** «Pagado por transferencia el 19/11 · 74,60 €» (la línea de cada recibo pagado por el banco). */
export function lineaPagado(via: Via, fecha: string, importeCent: number): string {
  const como = via === 'bizum' ? 'Bizum' : via === 'cajero' ? 'ingreso en cajero' : via === 'tarjeta' ? 'tarjeta' : 'transferencia'
  return `Pagado por ${como} el ${fecha.slice(8, 10)}/${fecha.slice(5, 7)} · ${eurosTexto(importeCent)} €`
}
