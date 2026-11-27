// supabase/functions/_shared/factura/facturarMes.ts
//
// R21 · «Facturar el mes», paso a paso (Julio, 27/11). Puro: lo que decide la pantalla, sin leer ni escribir nada. Lo
// prueba tests/unit/modules/conta/r21/facturarMes.test.ts. No hay motor nuevo: los cobros, las decisiones del banco, lo
// mandado a Cegid y el cuadre por vía salen de lo que ya está en main (Q10 · _shared/cegidMandar.ts y
// _shared/cegidBanco.ts; K14). Aquí solo se ordena eso en cinco pasos:
//
//   1 · Preparar el mes            — hecho cuando lo leído del mes está al día.
//   2 · Resolver lo pendiente      — hecho cuando no queda ningún caso por resolver (los dejados para después no cuentan).
//   3 · Mandar a Cegid             — hecho cuando el cuadre da 0,00 € y no queda nada por mandar.
//   4 · Precalcular y visto bueno  — hecho con el visto bueno de QBO de lo mandado (el mismo total y número de facturas).
//   5 · Generar las facturas       — hecho cuando todas las facturas están en las traídas de Cegid.
//
// Un paso se abre solo con el anterior hecho. Las reglas de Julio que se ven aquí:
//   · Solo se factura lo cobrado; lo que no es un cobro no sale (ni en el cuadre ni en la lista).
//   · Lo decidido no vuelve a salir.
//   · Lo que no se puede atar se queda fuera, pero en una lista: «Dejar para después» (conta_factura_pendiente) lo saca de
//     esta factura y cuenta en la fila «Pendientes» del cuadre; los de meses de antes salen los primeros en el paso 2.
//   · Nada se manda a Cegid si el cuadre no da 0,00 €.
//
// Los pasos 4 y 5 (los hace X): pasoCuatro() y pasoCinco(), con su interfaz al final del fichero.

// ── Los casos del paso 2 ────────────────────────────────────────────────────────────────────────────────────────────

export type TipoCaso = 'paga_factura_antes' | 'paga_sin_recibo' | 'no_se_sabe_quien' | 'sin_unir_cegid' | 'falta_dato_cegid' | 'sin_datos'

/** El tipo, en palabras de la maqueta («antes de noviembre» lo pone tipoEnPalabras con el mes). */
export const TIPOS: Readonly<Record<TipoCaso, string>> = {
  paga_factura_antes: 'Paga una factura de antes de',
  paga_sin_recibo: 'Cliente que paga sin recibo',
  no_se_sabe_quien: 'No se sabe quién paga',
  sin_unir_cegid: 'Cliente sin unir a Cegid',
  falta_dato_cegid: 'A la ficha de Cegid le falta un dato',
  sin_datos: 'Cliente sin datos',
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
/** «noviembre» de «2026-11». */
export const nombreDelMes = (mes: string) => MESES[Number(mes.slice(5, 7)) - 1] ?? mes
/** «Noviembre de 2026». */
export const mesLargo = (mes: string) => `${nombreDelMes(mes).replace(/^./, (x) => x.toUpperCase())} de ${mes.slice(0, 4)}`
export const tipoEnPalabras = (t: TipoCaso, mes: string) => (t === 'paga_factura_antes' ? `${TIPOS[t]} ${nombreDelMes(mes)}` : TIPOS[t])

/**
 * Un caso que Sumied no puede decidir solo, como lo arma quien lee (PR 2): su clave (la del cobro o la de la ficha, la
 * misma que se guarda al dejarlo para después), su tipo, una frase con quién, cuánto y cuándo, la propuesta de Sumied
 * (en azul) o lo que falta (en naranja) y sus botones. «decidido»: ya se decidió donde se decide hoy («Revisar el
 * cobro»), y no vuelve a salir.
 */
export interface CasoEntrada {
  clave: string
  tipo: TipoCaso
  cliente: string | null
  importeCent: number
  /** AAAA-MM-DD: el día del cobro (o del mes, si es de una ficha). */
  fecha: string
  frase: string
  propuesta: string | null
  falta: string | null
  decidido: boolean
}

/** Lo dejado para después (conta_factura_pendiente), vivo: ni deshecho ni resuelto. */
export interface PendienteGuardado {
  id: string
  clave: string
  tipo: TipoCaso
  /** AAAA-MM: el mes en que se dejó. */
  mes: string
  cliente: string | null
  importeCent: number
  motivo: string
  dejadoPor: string | null
  dejadoAt: string
}

export type EstadoCaso = 'por_resolver' | 'pendiente'

export interface Caso {
  clave: string
  tipo: TipoCaso
  tipoTexto: string
  cliente: string | null
  importeCent: number
  fecha: string
  frase: string
  propuesta: string | null
  falta: string | null
  estado: EstadoCaso
  /** Si está en Pendientes: su fila (para «Deshacer» y para resolverlo). */
  pendiente: PendienteGuardado | null
  /** Un pendiente de un mes de antes: sale el primero. */
  deMesAnterior: boolean
}

/**
 * Los casos del paso 2 de un mes: primero los pendientes de meses de antes (los más viejos primero), después los de este
 * mes por resolver y los de este mes dejados para después. Lo decidido no sale. Un pendiente vivo cuyo caso ya no llega
 * (porque se decidió en otro sitio) sigue saliendo como pendiente: no se olvida.
 */
export function casosDelMes(mes: string, entradas: readonly CasoEntrada[], pendientes: readonly PendienteGuardado[]): Caso[] {
  const vivos = new Map(pendientes.map((p) => [p.clave, p]))
  const vistos = new Set<string>()
  const casos: Caso[] = []
  for (const e of entradas) {
    if (vistos.has(e.clave)) continue
    vistos.add(e.clave)
    const p = vivos.get(e.clave) ?? null
    if (e.decidido && !p) continue
    casos.push({ clave: e.clave, tipo: e.tipo, tipoTexto: tipoEnPalabras(e.tipo, mes), cliente: e.cliente, importeCent: e.importeCent, fecha: e.fecha, frase: e.frase,
      propuesta: e.propuesta, falta: e.falta, estado: p ? 'pendiente' : 'por_resolver', pendiente: p, deMesAnterior: !!p && p.mes < mes })
  }
  for (const p of pendientes) {
    if (vistos.has(p.clave) || p.mes > mes) continue
    vistos.add(p.clave)
    casos.push({ clave: p.clave, tipo: p.tipo, tipoTexto: tipoEnPalabras(p.tipo, p.mes), cliente: p.cliente, importeCent: p.importeCent, fecha: `${p.mes}-01`,
      frase: p.motivo, propuesta: null, falta: null, estado: 'pendiente', pendiente: p, deMesAnterior: p.mes < mes })
  }
  const orden = (c: Caso) => (c.deMesAnterior ? 0 : c.estado === 'por_resolver' ? 1 : 2)
  return casos.sort((a, b) => orden(a) - orden(b) || (a.pendiente?.mes ?? '').localeCompare(b.pendiente?.mes ?? '') || a.fecha.localeCompare(b.fecha) || a.clave.localeCompare(b.clave))
}

// ── El cuadre del paso 3 ────────────────────────────────────────────────────────────────────────────────────────────

/** De dónde salen las cifras: el total de cuadreVias (Q10 · respuesta 7) y lo dejado para después de este mes. */
export interface EntradaCuadre {
  /** Lo cobrado en el mes por GoCardless, el banco y la tarjeta (cuadreVias.total.cobradoCent). */
  cobradoCent: number
  /** Lo que no es un cobro (cuadreVias.total.noCobroCent): no sale en esta pantalla. */
  noEsCobroCent: number
  /** Lo vivo en Cegid de este mes (cuadreVias.total.mandadoCent). */
  mandadoCent: number
  /** Lo que paga facturas que ya existían (cuadreVias.total.pagaFacturaCent). */
  pagaFacturasCent: number
  /** Los pendientes de meses de antes resueltos este mes: se facturan ahora, así que cuentan como cobrado del mes. */
  deAntesResueltosCent?: number
}

export interface Cuadre {
  /** Cobrado de clientes en el mes (sin lo que no es un cobro, con lo de antes resuelto este mes). */
  cobradoCent: number
  mandadoCent: number
  pagaFacturasCent: number
  pendientesCent: number
  diferenciaCent: number
  cuadra: boolean
}

/** Las cuatro filas: cobrado de clientes − mandado − paga facturas de antes − pendientes = diferencia. */
export function cuadreDelMes(mes: string, e: EntradaCuadre, pendientes: readonly PendienteGuardado[]): Cuadre {
  const pendientesCent = pendientes.filter((p) => p.mes === mes).reduce((s, p) => s + p.importeCent, 0)
  const cobradoCent = e.cobradoCent - e.noEsCobroCent + (e.deAntesResueltosCent ?? 0)
  const diferenciaCent = cobradoCent - e.mandadoCent - e.pagaFacturasCent - pendientesCent
  return { cobradoCent, mandadoCent: e.mandadoCent, pagaFacturasCent: e.pagaFacturasCent, pendientesCent, diferenciaCent, cuadra: diferenciaCent === 0 }
}

// ── Los cinco pasos ─────────────────────────────────────────────────────────────────────────────────────────────────

export interface EstadoDelMes {
  /** Lo leído del mes está al día (GoCardless, banco, tarjeta y Cegid): el resultado del paso 1 en una línea. */
  preparado: { cobradoCent: number; listos: number; casos: number } | null
  casos: readonly Caso[]
  /** El cuadre con lo que quedaría mandado si se manda lo listo: «Mandar» se activa solo con 0,00 €. */
  cuadre: Cuadre
  /** Los cobros listos para mandar y aún no mandados. */
  porMandar: number
  /** Los cobros ya mandados (vivos en Cegid). */
  mandados: number
  /** El paso 4 (de pasoCuatro) y el visto bueno vivo de QBO de la serie 1. */
  paso4: PasoCuatro | null
  vistoBueno: VistoBueno | null
  /** El paso 5 (de pasoCinco), si ya se ha comprobado. */
  paso5: PasoCinco | null
}

export interface Paso {
  numero: 1 | 2 | 3 | 4 | 5
  hecho: boolean
  /** Se puede trabajar en él: el anterior está hecho y él no. */
  activo: boolean
  /** Su resultado en una línea, cuando está hecho. */
  resultado: string | null
}

export interface Pasos {
  pasos: Paso[]
  /** El paso en el que abre la pantalla (6: todo hecho). */
  actual: 1 | 2 | 3 | 4 | 5 | 6
  porResolver: number
  pendientes: number
  /** «Mandar N cobros a Cegid» solo con el cuadre a 0,00 € y algo que mandar. */
  puedeMandar: boolean
}

const eur = (cent: number) => {
  // eslint-disable-next-line no-restricted-syntax -- «cent» es siempre un entero (céntimos)
  const s = (Math.abs(cent) / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${cent < 0 ? '−' : ''}${s} €`
}
export { eur as euros }
const n = (x: number, uno: string, varios: string) => `${x.toLocaleString('es-ES')} ${x === 1 ? uno : varios}`

export function pasosDelMes(e: EstadoDelMes): Pasos {
  const porResolver = e.casos.filter((c) => c.estado === 'por_resolver').length
  const pendientes = e.casos.filter((c) => c.estado === 'pendiente').length
  const h1 = e.preparado !== null
  const h2 = h1 && porResolver === 0
  const h3 = h2 && e.mandados > 0 && e.porMandar === 0 && e.cuadre.cuadra
  const vbOk = !!(e.paso4 && e.vistoBueno && e.vistoBueno.totalCent === e.paso4.serie1.totalCent && e.vistoBueno.facturas === e.paso4.serie1.facturas)
  const h4 = h3 && vbOk
  const h5 = h4 && !!e.paso5 && e.paso5.faltan.length === 0
  const hechos = [h1, h2, h3, h4, h5]
  const resultados = [
    e.preparado ? `Cobrado a clientes: ${eur(e.preparado.cobradoCent)}. Listo para mandar: ${n(e.preparado.listos, 'cobro', 'cobros')}. Pendiente de decidir: ${n(e.preparado.casos, 'caso', 'casos')}.` : null,
    pendientes ? `Revisado. ${n(pendientes, 'caso', 'casos')} en Pendientes, fuera de esta factura.` : 'Todo resuelto.',
    'Mandados. Cegid aún no ha hecho ninguna factura.',
    e.paso4 ? `${n(e.paso4.serie1.facturas, 'factura', 'facturas')}, ${eur(e.paso4.serie1.totalCent)}. Listado mandado a QBO.` : null,
    e.paso5 ? `${n(e.paso5.estan, 'factura emitida', 'facturas emitidas')} y comprobadas.` : null,
  ]
  const primero = hechos.indexOf(false)
  const actual = (primero === -1 ? 6 : primero + 1) as Pasos['actual']
  const pasos = hechos.map((h, i): Paso => ({ numero: (i + 1) as Paso['numero'], hecho: h, activo: i + 1 === actual, resultado: h ? resultados[i] : null }))
  return { pasos, actual, porResolver, pendientes, puedeMandar: actual === 3 && e.porMandar > 0 && e.cuadre.cuadra }
}

// ── Los pasos 4 y 5 (los hace X): su interfaz ───────────────────────────────────────────────────────────────────────

/** Lo mandado a Cegid de un mes (conta_cegid_incidencia viva), cliente a cliente. */
export interface MandadoCegid {
  cliente: number
  nombre: string | null
  /** La serie de la factura que hará Cegid: '1' (las cuotas) o '3' (Contasimple). */
  serie: string
  totalCent: number
  /** El estado de la incidencia: solo cuentan 'mandando', 'mandada' y 'facturada'. */
  estado: string
}

export interface SerieCegid { serie: string; totalCent: number; facturas: number; porCliente: { cliente: number; nombre: string | null; totalCent: number; lineas: number }[] }
export interface PasoCuatro {
  /** La cifra que Cegid tiene que dar al precalcular la serie 1: total y número de facturas (una por cliente). */
  serie1: SerieCegid
  /** La serie 3 (Contasimple), para el paso 5. */
  serie3: SerieCegid
}
export interface VistoBueno { serie: string; totalCent: number; facturas: number; quien: string | null; at: string }

const VIVAS = ['mandando', 'mandada', 'facturada']

/** El paso 4: lo mandado, por serie y cliente a cliente («No coincide» enseña porCliente). */
export function pasoCuatro(mandado: readonly MandadoCegid[]): PasoCuatro {
  const serie = (s: string): SerieCegid => {
    const de = new Map<number, SerieCegid['porCliente'][number]>()
    for (const m of mandado) {
      if (m.serie !== s || !VIVAS.includes(m.estado)) continue
      const x = de.get(m.cliente) ?? { cliente: m.cliente, nombre: m.nombre, totalCent: 0, lineas: 0 }
      x.totalCent += m.totalCent; x.lineas += 1
      de.set(m.cliente, x)
    }
    const porCliente = [...de.values()].sort((a, b) => a.cliente - b.cliente)
    return { serie: s, totalCent: porCliente.reduce((t, c) => t + c.totalCent, 0), facturas: porCliente.length, porCliente }
  }
  return { serie1: serie('1'), serie3: serie('3') }
}

/** Una factura traída de Cegid (conta_cegid_factura), con su mes ya resuelto por quien la lee. */
export interface FacturaCegid { serie: string; codigo: number; cliente: number | null; totalCent: number; mes: string }
export interface PasoCinco {
  estan: number
  /** Lo mandado que no tiene su factura en lo traído de Cegid: cliente, serie y cuánto. */
  faltan: { cliente: number; nombre: string | null; serie: string; totalCent: number }[]
}

/** El paso 5: cada cliente mandado tiene su factura del mes, de su serie y por su total. */
export function pasoCinco(mes: string, paso4: PasoCuatro, facturas: readonly FacturaCegid[]): PasoCinco {
  const hay = new Set(facturas.filter((f) => f.mes === mes && f.cliente != null).map((f) => `${f.serie}|${f.cliente}|${f.totalCent}`))
  const faltan: PasoCinco['faltan'] = []
  let estan = 0
  for (const s of [paso4.serie1, paso4.serie3]) {
    for (const c of s.porCliente) {
      if (hay.has(`${s.serie}|${c.cliente}|${c.totalCent}`)) estan += 1
      else faltan.push({ cliente: c.cliente, nombre: c.nombre, serie: s.serie, totalCent: c.totalCent })
    }
  }
  return { estan, faltan }
}
