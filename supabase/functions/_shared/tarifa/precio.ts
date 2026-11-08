// supabase/functions/_shared/tarifa/precio.ts
//
// G04 · Tarea 2 (08/11/2026). UN SOLO CÁLCULO del precio de un cliente en un
// mes. Lo usan la lista, el panel, la ficha, «Pruébalo», las descargas y,
// después, el recibo (G05). Puro: sin base, sin red, sin fecha de hoy. Todo lo
// que define una tarifa es dato (cada gestoría cobra a su manera): servicios,
// niveles, paquetes, formas de cobro, tramos y nombres.
//
// Reglas (Julio, 07/11 y 08/11):
//   · Forma de cobro de un servicio, de un nivel o de un precio:
//       - «fijo»: al mes, al año o por vez. Lo anual cuenta al mes entre 12, al
//         céntimo (la regla de hoy en conta_linea_al_mes);
//       - «por_trabajador»: el importe por cada trabajador del mes;
//       - «tramos»: el tramo en el que cae el número de trabajadores; si el
//         tramo es «por unidad», cada trabajador a ese importe;
//       - «tramo_y_por_trabajador»: los tramos se suman en orden («de 1 a 5
//         trabajadores 100 €, y después 18 € por cada uno»: con 8, 154 €).
//   · El precio del cliente manda sobre el general. Sin ninguno, NO hay precio
//     (null): no se inventa.
//   · Palabras (Julio, 08/11): «Precio de tarifa» si paga el general; «Precio
//     especial» solo cuando hay precio general y el del cliente es distinto;
//     «Precio de este cliente» cuando el servicio no tiene precio general.
//   · Un precio y una asignación valen de su mes «desde» a su mes «hasta»
//     (incluido; sin «hasta», sigue). Si dos precios valen el mismo mes, el de
//     «desde» más reciente.
//   · Un trabajador cuenta el mes si está de alta ese mes. Las altas y bajas a
//     mitad de mes son un AJUSTE DE LA GESTORÍA (Julio, 08/11), no código:
//       - «mes entero» (por defecto, lo de hoy en conta_gestoria_baja_linea: «se
//         cobra entero y ya no se cobra desde el mes siguiente»);
//       - «proporcional»: los días de alta del mes entre los días del mes, al
//         céntimo. Vale para lo que va por trabajador y para un servicio fijo
//         que empieza o acaba a mitad de mes. En tramos y paquetes el número de
//         trabajadores decide el tramo: cada uno cuenta entero.
//   · Un paquete: su precio, y si el cliente se pasa del límite de trabajadores
//     de una de sus líneas, cada uno de más al importe del exceso.
//
// Importes en céntimos (enteros). Lo prueban las unitarias de
// tests/unit/modules/conta/gestoria/g04/precio.test.ts.

export type Mes = string // «AAAA-MM»

export type Periodo = 'mes' | 'anio' | 'vez'

export interface Tramo {
  desde: number
  /** Null: en adelante. */
  hasta: number | null
  importeCent: number
  /** Cada unidad del tramo a este importe; si no, el tramo entero cuesta el importe. */
  porUnidad: boolean
}

export type Forma =
  | { tipo: 'fijo'; periodo: Periodo; importeCent: number }
  | { tipo: 'por_trabajador'; importeCent: number }
  | { tipo: 'tramos'; tramos: Tramo[] }
  | { tipo: 'tramo_y_por_trabajador'; tramos: Tramo[] }

/** A qué se pone precio: un servicio sin niveles, un nivel de un servicio o un paquete. */
export type Objetivo =
  | { tipo: 'servicio'; servicioId: string }
  | { tipo: 'nivel'; servicioId: string; nivelId: string }
  | { tipo: 'paquete'; paqueteId: string }

export const claveDe = (o: Objetivo): string =>
  o.tipo === 'servicio' ? `servicio:${o.servicioId}` : o.tipo === 'nivel' ? `nivel:${o.nivelId}` : `paquete:${o.paqueteId}`

/** Un precio con su historia: el general (sin cliente) o el de un cliente. */
export interface Precio {
  id: string
  empresaId: string
  objetivo: Objetivo
  /** Null: el precio general de la tarifa. */
  clienteId: string | null
  forma: Forma
  desde: Mes
  hasta: Mes | null
}

export interface Servicio { id: string; empresaId: string; nombre: string }
export interface Nivel { id: string; servicioId: string; nombre: string; orden: number; incluye: string[]; masElegido: boolean }

export interface LineaDePaquete {
  objetivo: Extract<Objetivo, { tipo: 'servicio' | 'nivel' }>
  /** Hasta cuántos trabajadores incluye; null: sin límite (o no va por trabajador). */
  limiteTrabajadores: number | null
}
export interface Paquete {
  id: string
  empresaId: string
  nombre: string
  descripcion: string | null
  lineas: LineaDePaquete[]
  /** Cada trabajador de más sobre el límite de una línea; null: el paquete no cobra exceso. */
  excesoPorTrabajadorCent: number | null
}

/** Un trabajador; «altaEl» y «bajaEl» (AAAA-MM-DD), el día, si se sabe (para lo proporcional). */
export interface Trabajador { nombre: string; desde: Mes; hasta: Mes | null; altaEl?: string | null; bajaEl?: string | null; /** La línea que lo cobra (para «Dar de baja»). */ lineaId?: string }

/** Los ajustes de cobro de la gestoría (los guarda conta_gestoria_ajustes). */
export interface AjustesDeCobro {
  /** Altas y bajas a mitad de mes: se cobra el mes entero o la parte proporcional. */
  mitadDeMes: 'mes_entero' | 'proporcional'
}
export const AJUSTES_DE_SIEMPRE: AjustesDeCobro = { mitadDeMes: 'mes_entero' }

/** Lo que tiene un cliente: un servicio (o un nivel) o un paquete, con la empresa que le factura. */
export interface Asignacion {
  id: string
  clienteId: string
  empresaId: string
  objetivo: Objetivo
  desde: Mes
  hasta: Mes | null
  /** El día del alta y de la baja (AAAA-MM-DD), si se sabe (para lo proporcional). */
  altaEl?: string | null
  bajaEl?: string | null
  /** Los trabajadores, si se cobra por trabajador o por tramos. */
  trabajadores?: Trabajador[]
}

export interface Catalogo {
  servicios: Servicio[]
  niveles: Nivel[]
  paquetes: Paquete[]
  precios: Precio[]
  /** Sin ajustes: los de siempre (mes entero). */
  ajustes?: AjustesDeCobro
}

export type DePrecio = 'tarifa' | 'especial' | 'de_este_cliente' | 'sin_precio'

export const PALABRA_DE_PRECIO: Record<DePrecio, string> = {
  tarifa: 'Precio de tarifa',
  especial: 'Precio especial',
  de_este_cliente: 'Precio de este cliente',
  sin_precio: 'Sin precio',
}

export interface LineaDelRecibo {
  asignacionId: string
  objetivo: Objetivo
  texto: string
  /** Null: sin precio (no se inventa). */
  importeCent: number | null
  dePrecio: DePrecio
  /** Cómo sale el importe, en palabras («18 × 24,20 €», «tramo de 1 a 5»). */
  cuenta: string
  trabajadores: number | null
  altasDelMes: string[]
  bajasDelMes: string[]
}

export interface Recibo {
  clienteId: string
  empresaId: string
  mes: Mes
  lineas: LineaDelRecibo[]
  /** La suma de lo que tiene precio; las líneas sin precio no suman y se dicen en «sinPrecio». */
  totalCent: number
  sinPrecio: number
}

export const vale = (desde: Mes, hasta: Mes | null, mes: Mes) => desde <= mes && (hasta === null || mes <= hasta)

export function euros(cent: number): string {
  // eslint-disable-next-line no-restricted-syntax -- «cent» es siempre un entero (céntimos)
  const s = (Math.abs(cent) / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${cent < 0 ? '−' : ''}${s} €`
}

/** El mes («AAAA-MM») de una fecha «AAAA-MM-DD»: un alta del 15 de noviembre es de noviembre. */
export const mesDeFecha = (fecha: string): Mes => fecha.slice(0, 7)

const diasDelMes = (mes: Mes) => new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0)).getUTCDate()

/**
 * La parte del mes que está de alta, de 0 a 1: los días desde el alta (si es de
 * ese mes) hasta la baja (si es de ese mes), incluidos, entre los días del mes.
 * Sin días: el mes entero (1).
 */
export function parteDelMes(mes: Mes, altaEl?: string | null, bajaEl?: string | null): { parte: number; dias: number; delMes: number } {
  const delMes = diasDelMes(mes)
  const ini = altaEl && altaEl.slice(0, 7) === mes ? Number(altaEl.slice(8, 10)) : 1
  const fin = bajaEl && bajaEl.slice(0, 7) === mes ? Number(bajaEl.slice(8, 10)) : delMes
  const dias = Math.max(0, fin - ini + 1)
  return { parte: dias / delMes, dias, delMes }
}

const enTramo = (t: Tramo, n: number) => n >= t.desde && (t.hasta === null || n <= t.hasta)

/** Lo que cuesta una forma con N trabajadores (o unidades), al mes. Null si ningún tramo cubre N. */
export function importeDeForma(f: Forma, n: number, partes?: { parte: number; dias: number; delMes: number }[]): { cent: number; cuenta: string } | null {
  if (f.tipo === 'por_trabajador' && partes && partes.some((x) => x.parte !== 1)) {
    // Proporcional: cada trabajador por su parte del mes, al céntimo.
    const enteros = partes.filter((x) => x.parte === 1).length
    const partidos = partes.filter((x) => x.parte !== 1)
    const cent = enteros * f.importeCent + partidos.reduce((s, x) => s + Math.round(f.importeCent * x.parte), 0)
    const cuenta = [enteros ? `${enteros} × ${euros(f.importeCent)}` : '', ...partidos.map((x) => `${euros(f.importeCent)} × ${x.dias}/${x.delMes} días`)].filter(Boolean).join(' + ')
    return { cent, cuenta }
  }
  switch (f.tipo) {
    case 'fijo':
      if (f.periodo === 'anio') return { cent: Math.round(f.importeCent / 12), cuenta: `${euros(f.importeCent)} al año, ${euros(Math.round(f.importeCent / 12))} al mes` }
      return { cent: f.importeCent, cuenta: f.periodo === 'vez' ? `${euros(f.importeCent)} cada vez` : `${euros(f.importeCent)} al mes` }
    case 'por_trabajador':
      return { cent: n * f.importeCent, cuenta: `${n} × ${euros(f.importeCent)}` }
    case 'tramos': {
      const t = [...f.tramos].sort((a, b) => a.desde - b.desde).find((x) => enTramo(x, n))
      if (!t) return null
      const rango = t.hasta === null ? `desde ${t.desde}` : `de ${t.desde} a ${t.hasta}`
      return t.porUnidad
        ? { cent: n * t.importeCent, cuenta: `${n} × ${euros(t.importeCent)} (tramo ${rango})` }
        : { cent: t.importeCent, cuenta: `tramo ${rango}: ${euros(t.importeCent)}` }
    }
    case 'tramo_y_por_trabajador': {
      let cent = 0
      const partes: string[] = []
      for (const t of [...f.tramos].sort((a, b) => a.desde - b.desde)) {
        if (n < t.desde) break
        if (t.porUnidad) {
          const hasta = t.hasta === null ? n : Math.min(n, t.hasta)
          const unidades = hasta - t.desde + 1
          cent += unidades * t.importeCent
          partes.push(`${unidades} × ${euros(t.importeCent)}`)
        } else {
          cent += t.importeCent
          partes.push(`${t.hasta === null ? `desde ${t.desde}` : `de ${t.desde} a ${t.hasta}`}: ${euros(t.importeCent)}`)
        }
      }
      return partes.length ? { cent, cuenta: partes.join(' + ') } : null
    }
  }
}

/** Los fallos de una forma, en palabras: tramos que se pisan, huecos, importes negativos. Vacío: está bien. */
export function fallosDeForma(f: Forma): string[] {
  const fallos: string[] = []
  const importes = f.tipo === 'fijo' || f.tipo === 'por_trabajador' ? [f.importeCent] : f.tramos.map((t) => t.importeCent)
  if (importes.some((i) => !Number.isInteger(i) || i < 0)) fallos.push('Un importe es negativo o no está en céntimos.')
  if (f.tipo === 'tramos' || f.tipo === 'tramo_y_por_trabajador') {
    const ts = [...f.tramos].sort((a, b) => a.desde - b.desde)
    if (!ts.length) fallos.push('Falta al menos un tramo.')
    ts.forEach((t, i) => {
      if (t.hasta !== null && t.hasta < t.desde) fallos.push(`El tramo que empieza en ${t.desde} acaba antes de empezar.`)
      const sig = ts[i + 1]
      if (sig) {
        if (t.hasta === null) fallos.push(`El tramo desde ${t.desde} no tiene final y hay otro después.`)
        else if (sig.desde <= t.hasta) fallos.push(`Los tramos que empiezan en ${t.desde} y en ${sig.desde} se pisan.`)
        else if (sig.desde > t.hasta + 1) fallos.push(`Entre ${t.hasta} y ${sig.desde} no hay tramo.`)
      }
    })
  }
  return fallos
}

/** El precio que vale un mes para un cliente y un objetivo: el suyo y, si no hay, el general. */
export function precioDelMes(precios: Precio[], empresaId: string, objetivo: Objetivo, clienteId: string, mes: Mes):
  { forma: Forma; dePrecio: Exclude<DePrecio, 'sin_precio'> } | null {
  const clave = claveDe(objetivo)
  const elegir = (lista: Precio[]) => lista.filter((p) => vale(p.desde, p.hasta, mes)).sort((a, b) => (a.desde < b.desde ? 1 : a.desde > b.desde ? -1 : 0))[0] ?? null
  const mismos = precios.filter((p) => p.empresaId === empresaId && claveDe(p.objetivo) === clave)
  const general = elegir(mismos.filter((p) => p.clienteId === null))
  const suyo = elegir(mismos.filter((p) => p.clienteId === clienteId))
  if (suyo) {
    if (!general) return { forma: suyo.forma, dePrecio: 'de_este_cliente' }
    return { forma: suyo.forma, dePrecio: mismaForma(suyo.forma, general.forma) ? 'tarifa' : 'especial' }
  }
  return general ? { forma: general.forma, dePrecio: 'tarifa' } : null
}

export function mismaForma(a: Forma, b: Forma): boolean {
  return JSON.stringify(normalizar(a)) === JSON.stringify(normalizar(b))
}
const normalizar = (f: Forma): Forma =>
  f.tipo === 'tramos' || f.tipo === 'tramo_y_por_trabajador' ? { ...f, tramos: [...f.tramos].sort((x, y) => x.desde - y.desde) } : f

/** Los trabajadores de alta un mes, y las altas y bajas de ese mes. */
export function trabajadoresDelMes(ts: Trabajador[] | undefined, mes: Mes) {
  const lista = ts ?? []
  return {
    deAlta: lista.filter((t) => vale(t.desde, t.hasta, mes)),
    altas: lista.filter((t) => t.desde === mes).map((t) => t.nombre),
    bajas: lista.filter((t) => t.hasta === mes).map((t) => t.nombre),
  }
}

function nombreDe(c: Catalogo, o: Objetivo): string {
  if (o.tipo === 'paquete') return c.paquetes.find((p) => p.id === o.paqueteId)?.nombre ?? 'Paquete'
  const s = c.servicios.find((x) => x.id === o.servicioId)?.nombre ?? 'Servicio'
  if (o.tipo === 'nivel') return `${s} · ${c.niveles.find((n) => n.id === o.nivelId)?.nombre ?? 'Nivel'}`
  return s
}

/** Lo que cuesta un paquete un mes: su precio y el exceso de trabajadores sobre el límite de sus líneas. */
function importeDePaquete(paq: Paquete, forma: Forma, n: number): { cent: number; cuenta: string } | null {
  const base = importeDeForma(forma, n)
  if (!base) return null
  const limite = paq.lineas.map((l) => l.limiteTrabajadores).filter((x): x is number => x !== null)
  const tope = limite.length ? Math.min(...limite) : null
  if (tope === null || paq.excesoPorTrabajadorCent === null || n <= tope) return base
  const deMas = n - tope
  return { cent: base.cent + deMas * paq.excesoPorTrabajadorCent, cuenta: `${base.cuenta} + ${deMas} de más × ${euros(paq.excesoPorTrabajadorCent)}` }
}

/** El recibo de un cliente con una empresa en un mes: una línea por asignación vigente. */
export function reciboDelMes(c: Catalogo, asignaciones: Asignacion[], clienteId: string, empresaId: string, mes: Mes): Recibo {
  const lineas: LineaDelRecibo[] = []
  for (const a of asignaciones) {
    if (a.clienteId !== clienteId || a.empresaId !== empresaId || !vale(a.desde, a.hasta, mes)) continue
    const tr = trabajadoresDelMes(a.trabajadores, mes)
    const n = a.trabajadores ? tr.deAlta.length : 0
    const p = precioDelMes(c.precios, empresaId, a.objetivo, clienteId, mes)
    const paq = a.objetivo.tipo === 'paquete' ? c.paquetes.find((x) => x.id === (a.objetivo as { paqueteId: string }).paqueteId) ?? null : null
    const proporcional = (c.ajustes ?? AJUSTES_DE_SIEMPRE).mitadDeMes === 'proporcional'
    let imp = !p ? null : paq ? importeDePaquete(paq, p.forma, n)
      : importeDeForma(p.forma, n, proporcional ? tr.deAlta.map((t) => parteDelMes(mes, t.altaEl, t.bajaEl)) : undefined)
    // Un servicio fijo que empieza o acaba a mitad de mes, en proporcional: su parte del mes.
    const delServicio = parteDelMes(mes, a.altaEl, a.bajaEl)
    if (imp && proporcional && !paq && p?.forma.tipo === 'fijo' && delServicio.parte !== 1) {
      imp = { cent: Math.round(imp.cent * delServicio.parte), cuenta: `${imp.cuenta} × ${delServicio.dias}/${delServicio.delMes} días` }
    }
    const conTrab = a.trabajadores ? ` · ${n} ${n === 1 ? 'trabajador' : 'trabajadores'}` : ''
    lineas.push({
      asignacionId: a.id, objetivo: a.objetivo, texto: `${nombreDe(c, a.objetivo)}${conTrab}`,
      importeCent: imp?.cent ?? null, dePrecio: p && imp ? p.dePrecio : 'sin_precio',
      cuenta: imp?.cuenta ?? (p ? `Ningún tramo para ${n} trabajadores` : 'Sin precio en la tarifa ni para este cliente'),
      trabajadores: a.trabajadores ? n : null, altasDelMes: tr.altas, bajasDelMes: tr.bajas,
    })
  }
  return {
    clienteId, empresaId, mes, lineas,
    totalCent: lineas.reduce((s, l) => s + (l.importeCent ?? 0), 0),
    sinPrecio: lineas.filter((l) => l.importeCent === null).length,
  }
}

/** Lo que costaría por separado lo que incluye un paquete, con N trabajadores, a precio de tarifa. Null si a algo le falta precio general. */
export function porSeparado(c: Catalogo, paq: Paquete, n: number, mes: Mes): number | null {
  let total = 0
  for (const l of paq.lineas) {
    const general = c.precios.filter((p) => p.empresaId === paq.empresaId && p.clienteId === null && claveDe(p.objetivo) === claveDe(l.objetivo) && vale(p.desde, p.hasta, mes))
      .sort((a, b) => (a.desde < b.desde ? 1 : -1))[0]
    const imp = general ? importeDeForma(general.forma, n) : null
    if (!imp) return null
    total += imp.cent
  }
  return total
}
