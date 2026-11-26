// supabase/functions/_shared/tarifa/cifras.ts
//
// R20 · Las cifras de «Clientes y cuotas», 100 % fiables (Julio, 26/11). Puro: lo usan la pantalla
// (src/modules/conta/gestoria/g04/modelo.ts) y la comprobación de cada noche (conta-gocardless-leer), con el
// mismo código a los dos lados. Lo prueba tests/unit/modules/conta/r20/cifras.test.ts.
//
// Las reglas de cada cifra de dinero:
//   1 · Una cifra, una fuente, dicha en la tarjeta: «Según GoCardless» o «Según las cuotas de Sumied».
//   2 · Cada cifra se abre en la lista que la forma, y la lista suma exactamente la cifra (cada Lista lleva su
//       total, que ES la suma de sus filas: no hay otro sitio de donde salga).
//   3 · Dos cifras que miden lo mismo son iguales; si no, la diferencia sale en ámbar con sus listas, que suman
//       exactamente la diferencia.
//   4 · Ninguna frase dice lo que los datos no dicen (nada de «sin bajas» si hay bajas).
//
// Las cifras de cuota son del MES DEL PRÓXIMO COBRO de GoCardless (la forma de contar de la copia del R19,
// conta_gc_contar_copia): las suscripciones activas con su próximo cobro en ese mes, por su próximo importe. Sumied,
// su recibo de ESE mismo mes. Hasta el R20 se comparaba lo que GoCardless cobraría hoy con el recibo de Sumied del
// mes de hoy, y salían «distintos» los clientes con un alta o una baja de un mes a otro.
//
// «GoCardless no cobró» (Julio, 26/11: «deuda es solo lo que el cliente no ha pagado por NINGUNA vía»): los
// recibos fallidos o devueltos en GoCardless, sin cobrar después (en GoCardless, ni marcados como cobrados por otra
// vía), recibo a recibo y también los de un mandato ya cancelado. Mientras no esté cruzado con el banco se llama así;
// con lo pagado por el banco (la tabla del K14), pasa a llamarse «Te deben» y lo descuenta. Lo cobrado con tarjeta
// sin asignar va en su propia línea y no se descuenta.

import { catalogoYAsignaciones, type FilasDeLaTarifa } from '../cobro/datos.ts'
import { reciboDelMes } from './precio.ts'

export interface FilaDeLista {
  id: string
  /** Quién o qué: el cliente, la suscripción, el recibo. */
  texto: string
  /** El porqué o el detalle, en palabras («GoCardless 84,70 € · Sumied 60,50 €»). */
  detalle: string
  importeCent: number
  fichaId: string | null
  fecha?: string
}

export interface Lista {
  titulo: string
  filas: FilaDeLista[]
  /** La suma de las filas: la cifra que se enseña sale de aquí y de ningún otro sitio. */
  totalCent: number
  /** Una lista que se cuenta (las altas y las bajas): su cifra es cuántas filas tiene, no euros. */
  soloCuenta?: boolean
}

export function lista(titulo: string, filas: FilaDeLista[]): Lista {
  return { titulo, filas, totalCent: filas.reduce((s, f) => s + f.importeCent, 0) }
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
export const nombreDelMes = (mes: string) => MESES[Number(mes.slice(5, 7)) - 1] ?? mes
export function euros(cent: number): string {
  // eslint-disable-next-line no-restricted-syntax -- «cent» es siempre un entero (céntimos)
  const s = (Math.abs(cent) / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${cent < 0 ? '−' : ''}${s} €`
}
const conSigno = (cent: number) => `${cent > 0 ? '+' : ''}${euros(cent)}`
const diaCorto = (f: string) => `${Number(f.slice(8, 10))}/${Number(f.slice(5, 7))}`
/** «Gestión laboral · 3 trabajadores» → «Gestión laboral» (también «· 1 trabajador»). */
const sinTrabajadores = (t: string) => t.replace(/ · \d+ trabajador(es)?$/, '')
const plural = (n: number, uno: string, varios: string) => `${n.toLocaleString('es-ES')} ${n === 1 ? uno : varios}`

// ── Las cuotas: GoCardless y Sumied del mismo mes ───────────────────────────────────────────────

/** Una suscripción activa de GoCardless con su próximo cobro en el mes (conta_cifras_del_cobro). */
export interface SuscripcionDelCobro {
  empresaId: string
  gcId: string
  gcClienteId: string | null
  /** El nombre del cliente en GoCardless. */
  clienteGc: string | null
  /** La ficha a la que está ATADO su cliente de GoCardless (conta_gc_enlace en «atado»); null: sin atar. */
  fichaId: string | null
  nombre: string
  fecha: string
  importeCent: number
}

/** El recibo de Sumied de una ficha con una empresa en un mes (reciboDelMes), línea a línea. */
export interface ReciboDeFicha {
  empresaId: string
  fichaId: string
  nombre: string
  /** Cada línea del recibo, con los trabajadores que entran (altas) y los que se cobran por última vez (bajas) ese mes. */
  lineas: { id: string; texto: string; importeCent: number | null; altas?: string[]; bajas?: string[] }[]
  totalCent: number
}

export interface CifrasDeCuotas {
  mes: string
  gocardless: {
    lista: Lista
    cobros: number
    /** El día que más cobra (el 4) y lo demás del mes, cada uno con su lista. */
    porDia: { texto: string; lista: Lista; cobros: number }[]
  }
  sumied: { lista: Lista; clientes: number }
  /** GoCardless − Sumied, y por qué, en cuatro listas que suman exactamente la diferencia. */
  diferencia: { cent: number; grupos: Lista[] }
  altas: Lista
  bajas: Lista
  /** Por ficha (empresa|ficha): lo de GoCardless y lo de Sumied, para el «Este mes» de cada fila. */
  porFicha: Map<string, { gocardlessCent: number | null; sumiedCent: number | null }>
}

const clave = (empresa: string, ficha: string) => `${empresa}|${ficha}`

export function cifrasDeCuotas(mes: string, suscripciones: readonly SuscripcionDelCobro[], recibos: readonly ReciboDeFicha[],
  recibosDelMesAnterior: readonly ReciboDeFicha[], nombreDeFicha: (fichaId: string) => string | null = () => null): CifrasDeCuotas {
  const delMes = suscripciones.filter((s) => s.fecha.slice(0, 7) === mes)
  const nombreMes = nombreDelMes(mes)

  // GoCardless: cada suscripción, con su cliente.
  const filaGc = (s: SuscripcionDelCobro): FilaDeLista => ({ id: s.gcId, texto: s.clienteGc ?? s.gcClienteId ?? 'Sin cliente', detalle: `${s.nombre} · ${diaCorto(s.fecha)}`,
    importeCent: s.importeCent, fichaId: s.fichaId, fecha: s.fecha })
  const gcLista = lista(`GoCardless cobrará en ${nombreMes}`, delMes.map(filaGc).sort((a, b) => a.texto.localeCompare(b.texto, 'es')))
  const porFecha = new Map<string, SuscripcionDelCobro[]>()
  for (const s of delMes) porFecha.set(s.fecha, [...(porFecha.get(s.fecha) ?? []), s])
  const principal = [...porFecha.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))[0]
  const porDia: CifrasDeCuotas['gocardless']['porDia'] = []
  if (principal) {
    const otros = delMes.filter((s) => s.fecha !== principal[0])
    porDia.push({ texto: `El ${diaCorto(principal[0])}`, cobros: principal[1].length, lista: lista(`GoCardless cobrará el ${diaCorto(principal[0])}`, principal[1].map(filaGc)) })
    if (otros.length) porDia.push({ texto: `Otros días de ${nombreMes}`, cobros: otros.length, lista: lista(`GoCardless cobrará otros días de ${nombreMes}`, otros.map(filaGc)) })
  }

  // Sumied: cada ficha con su recibo de ese mes (las que no tienen nada no salen: suman 0).
  const conCuota = recibos.filter((r) => r.totalCent !== 0)
  const suLista = lista(`Cuotas en Sumied · ${nombreMes}`, conCuota.map((r) => ({ id: clave(r.empresaId, r.fichaId), texto: r.nombre,
    detalle: r.lineas.map((l) => l.texto).join(' · '), importeCent: r.totalCent, fichaId: r.fichaId })).sort((a, b) => a.texto.localeCompare(b.texto, 'es')))

  // La diferencia, ficha a ficha: cada ficha cae en un solo grupo, así que los cuatro suman GoCardless − Sumied.
  const gcDeFicha = new Map<string, { cent: number; nombre: string }>()
  const sinAtar = new Map<string, FilaDeLista>()
  for (const s of delMes) {
    if (!s.fichaId) {
      const k = `${s.empresaId}|${s.gcClienteId ?? s.gcId}`
      const x = sinAtar.get(k) ?? { id: k, texto: s.clienteGc ?? s.gcClienteId ?? 'Sin cliente', detalle: '', importeCent: 0, fichaId: null }
      x.importeCent += s.importeCent
      x.detalle = x.detalle ? `${x.detalle} · ${s.nombre}` : s.nombre
      sinAtar.set(k, x)
      continue
    }
    const k = clave(s.empresaId, s.fichaId)
    const x = gcDeFicha.get(k) ?? { cent: 0, nombre: s.clienteGc ?? '' }
    x.cent += s.importeCent
    gcDeFicha.set(k, x)
  }
  const suDeFicha = new Map(conCuota.map((r) => [clave(r.empresaId, r.fichaId), r]))
  const soloSumied: FilaDeLista[] = []
  const distintos: FilaDeLista[] = []
  const soloGc: FilaDeLista[] = []
  const porFicha: CifrasDeCuotas['porFicha'] = new Map()
  for (const k of new Set([...gcDeFicha.keys(), ...suDeFicha.keys()])) {
    const gc = gcDeFicha.get(k)
    const su = suDeFicha.get(k)
    porFicha.set(k, { gocardlessCent: gc ? gc.cent : null, sumiedCent: su ? su.totalCent : null })
    const ficha = k.split('|')[1]
    const nombre = su?.nombre ?? nombreDeFicha(ficha) ?? gc?.nombre ?? ficha
    if (gc && su) {
      if (gc.cent !== su.totalCent) distintos.push({ id: k, texto: nombre, detalle: `GoCardless ${euros(gc.cent)} · Sumied ${euros(su.totalCent)}`, importeCent: gc.cent - su.totalCent, fichaId: ficha })
    } else if (su) {
      soloSumied.push({ id: k, texto: nombre, detalle: `Sumied ${euros(su.totalCent)} · GoCardless no le cobra en ${nombreMes}`, importeCent: -su.totalCent, fichaId: ficha })
    } else if (gc) {
      soloGc.push({ id: k, texto: nombre, detalle: `GoCardless ${euros(gc.cent)} · Sumied no tiene cuota en ${nombreMes}`, importeCent: gc.cent, fichaId: ficha })
    }
  }
  const orden = (xs: FilaDeLista[]) => xs.sort((a, b) => Math.abs(b.importeCent) - Math.abs(a.importeCent) || a.texto.localeCompare(b.texto, 'es'))
  const grupos = [
    lista(`GoCardless cobra a ${plural(sinAtar.size, 'cliente', 'clientes')} sin atar a ninguna ficha`, orden([...sinAtar.values()])),
    lista(`Sumied tiene cuota y GoCardless no les cobra (${plural(soloSumied.length, 'ficha', 'fichas')})`, orden(soloSumied)),
    lista(`Con un importe distinto en cada lado (${plural(distintos.length, 'ficha', 'fichas')})`, orden(distintos)),
    lista(`Atados, y Sumied sin cuota en ${nombreMes} (${plural(soloGc.length, 'ficha', 'fichas')})`, orden(soloGc)),
  ].filter((g) => g.filas.length > 0)

  // Altas y bajas, de las líneas de Sumied: lo que se cobra por primera vez este mes y lo que se cobró por última vez el
  // anterior. Sumied junta los trabajadores de un servicio en una línea del recibo: cada trabajador que entra o sale
  // cuenta como un alta o una baja (como cada línea en conta_linea); un servicio entero, como una.
  const lineasDe = (rs: readonly ReciboDeFicha[]) => new Map(rs.flatMap((r) => r.lineas.map((l) => [`${r.empresaId}|${l.id}`, { r, l }] as const)))
  const ahora = lineasDe(recibos)
  const antes = lineasDe(recibosDelMesAnterior)
  const filaDe = (k: string, r: ReciboDeFicha, texto: string): FilaDeLista => ({ id: k, texto: r.nombre, detalle: texto, importeCent: 0, fichaId: r.fichaId })
  const altas: FilaDeLista[] = []
  for (const [k, { r, l }] of ahora) {
    const nuevos = l.altas ?? []
    if (!antes.has(k) && !nuevos.length) altas.push(filaDe(k, r, l.texto))
    else for (const n of nuevos) altas.push(filaDe(`${k}|${n}`, r, `${sinTrabajadores(l.texto)} · alta de ${n}`))
  }
  const bajas: FilaDeLista[] = []
  for (const [k, { r, l }] of antes) {
    const salen = l.bajas ?? []
    if (!ahora.has(k) && !salen.length) bajas.push(filaDe(k, r, l.texto))
    else for (const n of salen) bajas.push(filaDe(`${k}|${n}`, r, `${sinTrabajadores(l.texto)} · baja de ${n}`))
  }
  const porNombre = (xs: FilaDeLista[]) => xs.sort((a, b) => a.texto.localeCompare(b.texto, 'es') || a.detalle.localeCompare(b.detalle, 'es'))

  const sumied = lista(suLista.titulo, suLista.filas)
  return {
    mes,
    gocardless: { lista: gcLista, cobros: delMes.length, porDia },
    sumied: { lista: sumied, clientes: new Set(conCuota.map((r) => r.fichaId)).size },
    diferencia: { cent: gcLista.totalCent - sumied.totalCent, grupos },
    altas: { ...lista(`Altas de ${nombreMes}: lo que Sumied cobra por primera vez`, porNombre(altas)), soloCuenta: true },
    bajas: { ...lista(`Bajas: lo que Sumied cobró por última vez en ${nombreDelMes(mesAnterior(mes))}`, porNombre(bajas)), soloCuenta: true },
    porFicha,
  }
}

/** «+38 altas (24 clientes)», «sin altas»; «−7 bajas (6 clientes)», «sin bajas». Las cuenta de su lista. */
export function textoAltasBajas(l: Lista, que: 'alta' | 'baja'): string {
  if (!l.filas.length) return que === 'alta' ? 'sin altas' : 'sin bajas'
  const clientes = new Set(l.filas.map((f) => f.fichaId)).size
  return `${que === 'alta' ? '+' : '−'}${plural(l.filas.length, que, `${que}s`)} (${plural(clientes, 'cliente', 'clientes')})`
}

/** La frase del ámbar: «314,60 € más en Sumied que en GoCardless». Null si son iguales. */
export function fraseDiferencia(cent: number): string | null {
  if (cent === 0) return null
  return cent < 0 ? `${euros(-cent)} más en Sumied que en GoCardless` : `${euros(cent)} más en GoCardless que en Sumied`
}

// ── «GoCardless no cobró» (y «Te deben», cuando esté cruzado con el banco) ──────────────────────

export interface CargoParaDeuda {
  id: string
  empresaId: string
  /** La ficha, si el cargo es de una sola (conta_consulta_cargo_devuelto.clientes). */
  fichaId: string | null
  nombre: string
  suscripcionId: string | null
  estado: string
  fecha: string
  importeCent: number
  mandatoActivo: boolean
  cobradoDespues: boolean
  cobradoPorOtraVia: boolean
}

/**
 * Lo que dice el K14 (el casado del extracto del banco con cada cliente: conta_banco_cobro y conta_banco_cobro_recibo,
 * leídos por conta_cifras_del_banco): qué empresas están ya cruzadas, qué recibos de GoCardless pagó el banco y el TPV
 * que aún no es de nadie.
 */
export interface CruceConElBanco {
  /** Las empresas elegidas ya cruzadas con el banco. */
  cruzadas: ReadonlySet<string>
  /** Las elegidas que aún no lo están, por su nombre: mientras quede alguna, la tarjeta no es «Te deben». */
  faltan: string[]
  /** «empresa|recibo de GoCardless» → cómo lo pagó el banco. */
  pagadosPorElBanco: ReadonlyMap<string, { fecha: string; via: string; importeCent: number }>
  /** El TPV sin asignar, entrada a entrada: va en su línea y no se descuenta de nadie. */
  tarjeta: Lista
}

export interface NoCobrado {
  /** «GoCardless no cobró» mientras no esté cruzado con el banco; «Te deben» cuando lo esté. */
  titulo: 'GoCardless no cobró' | 'Te deben'
  cruzado: boolean
  lista: Lista
  recibos: number
  clientes: number
  desde: string | null
  /** Por antigüedad: hasta 30, de 31 a 60, de 61 a 90 y más de 90 días. Suman exactamente la lista. */
  tramos: { texto: string; lista: Lista }[]
  /** Los de un mandato ya cancelado (están dentro de la lista, no aparte). */
  conMandatoCancelado: Lista
  /** Lo que ya pagó por el banco (de las empresas cruzadas): no cuenta. */
  pagadoPorElBanco: Lista | null
  /** El TPV sin asignar (de las empresas cruzadas): no se descuenta. */
  tarjetaSinAsignar: Lista | null
  /** Las empresas que aún no están cruzadas con el banco. */
  faltanPorCruzar: string[]
}

const COBRADO = new Set(['paid_out', 'confirmed'])
/** La vía del banco, en palabras (las del K14: _shared/cobro/porBanco.ts y el CHECK de conta_banco_cobro.via). */
const VIA: Record<string, string> = { transferencia: 'transferencia', traspaso: 'traspaso', bizum: 'Bizum', cajero: 'ingreso en cajero', tarjeta: 'tarjeta', otra: 'otra vía' }
const NO_COBRADO = new Set(['failed', 'charged_back'])

export function noCobrado(cargos: readonly CargoParaDeuda[], hoy: string, banco: CruceConElBanco | null): NoCobrado {
  const dias = (f: string) => Math.round((Date.parse(`${hoy}T00:00:00Z`) - Date.parse(`${f}T00:00:00Z`)) / 86_400_000)
  // Recibo a recibo: fallido o devuelto, y sin cobrar después en GoCardless (la base, o un cobro posterior de la misma
  // suscripción) ni marcado como cobrado por otra vía. El mandato da igual: uno cancelado también se debe.
  const candidatos = cargos.filter((c) => NO_COBRADO.has(c.estado) && !c.cobradoPorOtraVia && !c.cobradoDespues
    && !cargos.some((p) => COBRADO.has(p.estado) && p.empresaId === c.empresaId && c.suscripcionId !== null && p.suscripcionId === c.suscripcionId && p.fecha > c.fecha))
  const pagadoPor = (c: CargoParaDeuda) => (banco && banco.cruzadas.has(c.empresaId) ? banco.pagadosPorElBanco.get(`${c.empresaId}|${c.id}`) ?? null : null)
  const pagados = candidatos.filter((c) => pagadoPor(c))
  const quedan = candidatos.filter((c) => !pagadoPor(c))
  const fila = (c: CargoParaDeuda): FilaDeLista => ({ id: c.id, texto: c.nombre, fichaId: c.fichaId, fecha: c.fecha, importeCent: c.importeCent,
    detalle: `${c.estado === 'charged_back' ? 'Devuelto por el banco' : 'Fallido'} el ${Number(c.fecha.slice(8, 10))}/${c.fecha.slice(5, 7)}/${c.fecha.slice(0, 4)}${c.mandatoActivo ? '' : ' · mandato ya cancelado'}` })
  const filas = quedan.map(fila).sort((a, b) => (a.fecha ?? '').localeCompare(b.fecha ?? '') || a.texto.localeCompare(b.texto, 'es'))
  // «Te deben» solo cuando TODAS las empresas elegidas están cruzadas con el banco; si falta alguna, lo que no cobró
  // GoCardless no es aún deuda (pudo pagarse por transferencia, Bizum o tarjeta) y se dice cuál falta.
  const cruzado = banco !== null && banco.faltan.length === 0
  const titulo = cruzado ? 'Te deben' : 'GoCardless no cobró'
  const filaPagada = (c: CargoParaDeuda): FilaDeLista => {
    const b = pagadoPor(c)!
    return { ...fila(c), detalle: `${fila(c).detalle} · pagado por el banco (${VIA[b.via] ?? b.via}) el ${Number(b.fecha.slice(8, 10))}/${b.fecha.slice(5, 7)}/${b.fecha.slice(0, 4)}` }
  }
  const TRAMOS: [string, (d: number) => boolean][] = [
    ['Hasta 30 días', (d) => d <= 30], ['De 31 a 60 días', (d) => d > 30 && d <= 60], ['De 61 a 90 días', (d) => d > 60 && d <= 90], ['Más de 90 días', (d) => d > 90],
  ]
  return {
    titulo, cruzado,
    lista: lista(titulo, filas),
    recibos: filas.length,
    clientes: new Set(quedan.map((c) => c.fichaId ?? `sin:${c.id}`)).size,
    desde: filas[0]?.fecha ?? null,
    tramos: TRAMOS.map(([texto, en]) => ({ texto, lista: lista(`${titulo} · ${texto.toLowerCase()}`, filas.filter((f) => en(dias(f.fecha!)))) })),
    conMandatoCancelado: lista(`${titulo} · con el mandato ya cancelado`, filas.filter((f) => f.detalle.endsWith('mandato ya cancelado'))),
    pagadoPorElBanco: banco ? lista('Pagado después por el banco (no cuenta)', pagados.map(filaPagada)) : null,
    tarjetaSinAsignar: banco ? banco.tarjeta : null,
    faltanPorCruzar: banco ? banco.faltan : [],
  }
}

/** «Fallidos y devueltos en GoCardless desde mayo, sin cobrar después». */
export function fraseNoCobrado(x: NoCobrado): string {
  const desde = x.desde ? ` desde ${nombreDelMes(x.desde)}` : ''
  return `Fallidos y devueltos en GoCardless${desde}, sin cobrar después · ${plural(x.recibos, 'recibo', 'recibos')} de ${plural(x.clientes, 'cliente', 'clientes')}`
}

// ── La comprobación de cada noche (regla 5) ─────────────────────────────────────────────────────

export interface Aviso { codigo: 'cuotas_no_cuadran' | 'lista_no_suma'; porque: string; cent: number }

/**
 * Lo que la comprobación de cada noche deja en «Lo que tienes que hacer»: si GoCardless y Sumied no cuadran en el mes
 * del próximo cobro, la diferencia con sus grupos; y, por si un día se rompe, cualquier cifra que no sea la suma de su
 * lista.
 */
export function avisosDeLasCifras(c: CifrasDeCuotas, n: NoCobrado): Aviso[] {
  const avisos: Aviso[] = []
  const frase = fraseDiferencia(c.diferencia.cent)
  if (frase) {
    const grupos = c.diferencia.grupos.map((g) => `${g.titulo}: ${conSigno(g.totalCent)}`).join('; ')
    avisos.push({ codigo: 'cuotas_no_cuadran', cent: c.diferencia.cent,
      porque: `${nombreDelMes(c.mes).replace(/^./, (x) => x.toUpperCase())}: GoCardless cobrará ${euros(c.gocardless.lista.totalCent)} y las cuotas de Sumied suman ${euros(c.sumied.lista.totalCent)}; ${frase}. Por qué: ${grupos}.` })
  }
  const suma = (xs: Lista[]) => xs.reduce((s, x) => s + x.totalCent, 0)
  const malas: string[] = []
  if (suma(c.diferencia.grupos) !== c.diferencia.cent) malas.push('la diferencia de las cuotas')
  if (suma(c.gocardless.porDia.map((d) => d.lista)) !== c.gocardless.lista.totalCent) malas.push('lo que cobrará GoCardless por días')
  if (suma(n.tramos.map((t) => t.lista)) !== n.lista.totalCent) malas.push(`«${n.titulo}» por antigüedad`)
  if (malas.length) avisos.push({ codigo: 'lista_no_suma', cent: 0, porque: `Una cifra de «Clientes y cuotas» no es la suma de su lista: ${malas.join(', ')}. Avisa a soporte.` })
  return avisos
}

// ── De las filas de la base a lo de arriba (lo mismo en la pantalla y en la lectura de cada noche) ──────

type Fila = Record<string, unknown>
const centDe = (v: unknown) => Math.round(Number(v ?? 0) * 100)
const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)

/** Lo que devuelve conta_cifras_del_cobro. */
export function delCobro(j: unknown): { meses: { empresaId: string; mes: string; leidoAt: string | null }[]; suscripciones: SuscripcionDelCobro[] } {
  const o = (j && typeof j === 'object' ? j : {}) as Fila
  const filas = (x: unknown) => (Array.isArray(x) ? (x as Fila[]) : [])
  return {
    meses: filas(o.meses).map((m) => ({ empresaId: String(m.empresa_id), mes: String(m.mes), leidoAt: texto(m.leido_at) })),
    suscripciones: filas(o.suscripciones).map((s) => ({ empresaId: String(s.empresa_id), gcId: String(s.gc_id), gcClienteId: texto(s.gc_cliente_id),
      clienteGc: texto(s.cliente_gc), fichaId: texto(s.ficha_id), nombre: texto(s.nombre) ?? 'Suscripción', fecha: String(s.fecha).slice(0, 10), importeCent: centDe(s.importe) })),
  }
}

/** El mes anterior a «AAAA-MM». */
export function mesAnterior(mes: string): string {
  const a = Number(mes.slice(0, 4)); const m = Number(mes.slice(5, 7))
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`
}

/**
 * El recibo de Sumied de cada ficha de una empresa en un mes, con el código del recibo (reciboDelMes). Las fichas son
 * las que tienen algo asignado con esa empresa: las mismas en la pantalla y en la lectura de cada noche.
 */
export function recibosDeLaEmpresa(filas: FilasDeLaTarifa, empresaId: string, mes: string, nombreDe: (fichaId: string) => string | null): ReciboDeFicha[] {
  const { catalogo, asignaciones } = catalogoYAsignaciones(filas)
  const fichas = [...new Set(asignaciones.filter((a) => a.empresaId === empresaId).map((a) => a.clienteId))].sort()
  return fichas.map((fichaId) => {
    const r = reciboDelMes(catalogo, asignaciones, fichaId, empresaId, mes)
    return { empresaId, fichaId, nombre: nombreDe(fichaId) ?? 'Cliente sin nombre',
      lineas: r.lineas.map((l) => ({ id: l.asignacionId, texto: l.texto, importeCent: l.importeCent, altas: l.altasDelMes, bajas: l.bajasDelMes })), totalCent: r.totalCent }
  })
}

/** Las filas de conta_consulta_cargo_devuelto (o de conta_pantalla_clientes.cargos), para «GoCardless no cobró». */
export function cargosParaDeuda(filas: readonly Fila[], nombreDe: (fichaId: string) => string | null): CargoParaDeuda[] {
  return filas.map((c) => {
    const clientes = Array.isArray(c.clientes) ? (c.clientes as unknown[]).map(String) : []
    const fichaId = clientes.length === 1 ? clientes[0] : null
    return { id: String(c.gc_id), empresaId: String(c.empresa_id), fichaId,
      nombre: (fichaId ? nombreDe(fichaId) : null) ?? (clientes.length > 1 ? `Cliente de GoCardless en ${clientes.length} fichas` : 'Cliente de GoCardless sin ficha'),
      suscripcionId: texto(c.suscripcion_gc_id), estado: String(c.estado), fecha: String(c.fecha).slice(0, 10), importeCent: centDe(c.importe),
      mandatoActivo: c.mandato_activo === true, cobradoDespues: c.cobrado_despues === true, cobradoPorOtraVia: !!c.otra_via }
  })
}

/**
 * Lo que devuelve conta_cifras_del_banco, para las empresas elegidas. Null si ninguna está cruzada con el banco todavía
 * (entonces la tarjeta es «GoCardless no cobró», sin más).
 */
export function cruceDelBanco(j: unknown, elegidas: readonly string[], nombreDeEmpresa: (id: string) => string): CruceConElBanco | null {
  const o = (j && typeof j === 'object' ? j : {}) as Fila
  const filas = (x: unknown) => (Array.isArray(x) ? (x as Fila[]) : [])
  const todas = new Set((Array.isArray(o.cruzadas) ? o.cruzadas : []).map(String))
  const cruzadas = new Set(elegidas.filter((e) => todas.has(e)))
  if (!cruzadas.size) return null
  const pagados = new Map(filas(o.recibos).filter((r) => cruzadas.has(String(r.empresa_id)))
    .map((r) => [`${String(r.empresa_id)}|${String(r.gc_id)}`, { fecha: String(r.fecha).slice(0, 10), via: String(r.via ?? 'otra'), importeCent: centDe(r.importe) }]))
  const tarjeta = filas(o.tarjeta).filter((t) => cruzadas.has(String(t.empresa_id))).map((t): FilaDeLista => {
    const f = String(t.fecha).slice(0, 10)
    return { id: String(t.movement_id), texto: 'Cobrado con tarjeta (TPV)', detalle: `Abono del ${Number(f.slice(8, 10))}/${f.slice(5, 7)}/${f.slice(0, 4)}`, importeCent: centDe(t.importe), fichaId: null, fecha: f }
  })
  return {
    cruzadas, faltan: elegidas.filter((e) => !todas.has(e)).map(nombreDeEmpresa), pagadosPorElBanco: pagados,
    tarjeta: lista('Cobrado con tarjeta, sin asignar a ningún cliente (no se descuenta)', tarjeta),
  }
}
