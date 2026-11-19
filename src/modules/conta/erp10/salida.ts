// src/modules/conta/erp10/salida.ts
//
// X04 · Lo que la pantalla «Salida a ERP10» enseña y baja, sin red ni base:
// junta lo que sale del mes (conta_erp10_por_salir), las recibidas y (X05) las
// emitidas con lo que necesita su fila (conta_erp10_recibidas_por_salir,
// conta_erp10_emitidas_por_salir) y el módulo del X03 (ficheros.ts). De aquí
// salen las filas de «Qué sale», los avisos de «Qué mirar antes de sacarlo», las
// comprobaciones que se pueden afirmar, los tres ficheros con sus huellas, la
// lista de PDF y cómo se reparten en ficheros comprimidos.
//
// Salen las cuentas nuevas, las facturas recibidas, (X05) las emitidas, (X07) los
// asientos sin I.V.A. y (X08) los días de ventas del TPV: cada día, una factura expedida
// (el resumen del día, en dias-tpv.xlsx) y su cobro, un asiento más (en asientos.xlsx).
// Un día se apunta una vez, como «emitida», con la huella de su fila y la de su cobro.
// Lo que no puede salir se cuenta y se dice por qué (regla 7).

import { zipSync } from 'fflate'
import { columnas } from '../../../../supabase/functions/_shared/diezExcel.ts'
import { XML_EXPEDIDAS, XML_RECIBIDAS } from '@/modules/conta/erp10/configuracion'
import {
  FICHERO_ASIENTOS, FICHERO_DIAS, FICHERO_EXPEDIDAS, FICHERO_RECIBIDAS, FICHERO_SUBCUENTAS, columnasAsientos, convertirCuentas, filaSubcuenta, huellaFila, libroErp10,
  prepararAsientos, prepararDiasTpv, prepararExpedidas, prepararRecibidas, type Fila, type RecibidaParaApi,
} from '@/modules/conta/erp10/ficheros'
import { SIN_ASIENTOS, SIN_DIAS, type AsientosPorSalir, type DiasPorSalir, type CuentaDeLaBase, type Corregida, type EmitidasPorSalir, type PartidaPorSalir, type PorSalir, type RecibidasPorSalir } from '@/modules/conta/services/erp10Service'

export type Estado = 'Listo' | 'Mira esto' | 'Todavía no sale por aquí' | 'Nada'
export type IdFila = 'cuentas' | 'recibidas' | 'emitidas' | 'asientos' | 'tpv' | 'pdf'
export interface FilaQueSale { id: IdFila; que: string; cuantos: number; importe: number | null; estado: Estado; texto: string; sale: boolean }

export type Clase = 'recibida' | 'emitida' | 'asiento'
export interface FacturaQueSale { entryId: string; clase: Clase; fecha: string; tercero: string; numero: string; importe: number; deOtroMes: boolean; pdf: string | null }
/** X08 · «dia»: un día de ventas del TPV (sale como emitida; en pantalla, en su fila). */
export interface NoPuedeSalir { entryId: string; clase: Clase | 'dia'; fecha: string; quien: string; numero: string; porque: string }
/** X08 · Un día del TPV que sale: su factura del día. */
export interface DiaQueSale { entryId: string; fecha: string; local: string | null; rango: string; facturas: number; importe: number }

export interface Salida {
  filas: FilaQueSale[]
  /** Las listas de cada fila, enteras (regla 7). */
  listas: {
    cuentas: { codigo: string; codigoErp10: string; nombre: string; nif: string | null }[]
    recibidas: FacturaQueSale[]
    emitidas: FacturaQueSale[]
    asientos: PartidaPorSalir[]
    tpv: DiaQueSale[]
    pdf: { nombre: string; ruta: string; factura: string }[]
  }
  /** «Qué mirar antes de sacarlo». */
  sinPdf: FacturaQueSale[]
  noPuedenSalir: NoPuedeSalir[]
  /** Las emitidas que salieron y después se corrigieron (ERP10 tiene la de antes). */
  corregidas: Corregida[]
  /** Las comprobaciones que se pueden afirmar de verdad de lo que sale. */
  comprobaciones: string[]
  /** Lo que va a los ficheros. */
  ficheros: {
    subcuentas: Fila[]
    expedidas: { entryId: string; fila: Fila }[]
    /** X10b · Con la recibida para la conexión con ERP10 y su PDF (ruta guardada y nombre). */
    recibidas: { entryId: string; fila: Fila; api?: RecibidaParaApi; pdf?: { ruta: string; nombre: string } | null }[]
    /** X07 · Cada asiento, con sus filas (una por apunte, numeradas en A). X08: también el cobro de cada día. */
    asientos: { entryId: string; filas: Fila[] }[]
    /** X08 · Cada día del TPV, su fila de expedidas (el resumen del día). */
    dias: { entryId: string; fila: Fila }[]
    pdfs: { nombre: string; ruta: string; entryId: string }[]
  }
  /** Lo que suma lo que sale (para la confirmación). */
  totalRecibidas: number
  totalEmitidas: number
  totalAsientos: number
  totalDias: number
}

const c = (x: number) => Math.round(x * 100)

/**
 * Junta lo que sale. `carpeta`: la carpeta del ordenador de ERP10 donde se
 * descomprimen los PDF (la de la ficha, o C:\Sumied\<código>\).
 */
export function armarSalida(ps: PorSalir, rs: RecibidasPorSalir, em: EmitidasPorSalir, carpeta: string, as: AsientosPorSalir = SIN_ASIENTOS, ds: DiasPorSalir = SIN_DIAS): Salida {
  const yaSalidas = new Map([...rs.yaSalidas, ...em.yaSalidas, ...as.yaSalidas, ...ds.yaSalidas])
  const plan = new Map([...rs.cuentas, ...em.cuentas, ...as.cuentas, ...ds.cuentas, ...ds.contado].map((x) => [x.codigo, x.plantilla]))
  for (const d of ds.dias) for (const l of d.lineas) plan.set(l.cuenta, l.plantilla)
  for (const r of rs.recibidas) for (const l of r.lineas) plan.set(l.cuenta, l.plantilla)
  for (const r of em.emitidas) for (const l of r.lineas) plan.set(l.cuenta, l.plantilla)
  for (const r of as.asientos) for (const l of r.lineas) plan.set(l.cuenta, l.plantilla)
  // Los PDF de las dos van en el mismo zip: los nombres, sin repetirse entre las dos.
  const usados = new Set<string>()
  const prepE = prepararExpedidas(em.emitidas, { plan, largo: ps.largo, carpetaPdf: carpeta, yaSalidas, usados })
  const prepR = prepararRecibidas(rs.recibidas, { plan, largo: ps.largo, carpetaPdf: carpeta, yaSalidas, usados })
  const porId = new Map<string, { fecha: string; tercero: string; pdf: { ruta: string } | null; clase: Clase }>([
    ...rs.recibidas.map((r) => [r.entryId, { fecha: r.factura.fecha, tercero: r.proveedor.nombre, pdf: r.pdf, clase: 'recibida' as const }] as const),
    ...em.emitidas.map((r) => [r.entryId, { fecha: r.factura.fecha, tercero: r.cliente.nombre, pdf: r.pdf, clase: 'emitida' as const }] as const),
  ])
  const partida = new Map(ps.partidas.map((p) => [p.entryId, p]))

  // Las cuentas de las facturas no se cruzan entre ellas (las recibidas usan las 2, 6, 40, 41 y 4751; las emitidas, las 7,
  // 43, 44 y 473, y la conversión guarda la plantilla). Los asientos (X07) usan de todo: dos cuentas de Sumied que darían la
  // misma en ERP10, una de un asiento y otra de una factura, no salen ninguna de las dos.
  // X08 · Los días del TPV: su factura del día y su cobro, que va con los asientos.
  const prepD = prepararDiasTpv(ds.dias, ds.contado, { plan, largo: ps.largo, yaSalidas })
  const esDia = new Set(ds.dias.map((d) => d.entryId))
  const prepA0 = prepararAsientos([...as.asientos, ...prepD.dias.map((d) => d.cobro)], { plan, largo: ps.largo, yaSalidas })
  const cruce = convertirCuentas([...prepE.filas, ...prepR.filas, ...prepA0.asientos, ...prepD.dias].flatMap((f) => f.usa), plan, ps.largo, yaSalidas).noCaben
  const chocan: { entryId: string; numero: string; porque: string }[] = []
  const sinCruce = <T extends { entryId: string; numero: string; usa: string[] }>(fs: T[]) => fs.filter((f) => {
    const mala = f.usa.find((k) => cruce.has(k))
    if (mala) chocan.push({ entryId: f.entryId, numero: f.numero, porque: cruce.get(mala)! })
    return !mala
  })
  const filasE = sinCruce(prepE.filas)
  const filasR = sinCruce(prepR.filas)
  const filasD0 = sinCruce(prepD.dias)
  // Los asientos, numerados otra vez (desde 1) sin los que chocan; con el cobro de cada día que sale.
  const prepA = cruce.size ? prepararAsientos([...as.asientos, ...filasD0.map((d) => d.cobro)], { plan, largo: ps.largo, yaSalidas, noCaben: cruce }) : prepA0
  // Un día sale con su cobro o no sale (si su cobro no pudiera ir al fichero de asientos).
  const conCobro = new Set(prepA.asientos.map((a) => a.entryId))
  const filasD = filasD0.filter((d) => conCobro.has(d.entryId))

  const total = (xml: string) => columnas(xml)['045'] - 1
  const aFactura = (f: { entryId: string; numero: string; fila: Fila; pdf: string | null }, col: number): FacturaQueSale => {
    const x = porId.get(f.entryId)!
    return { entryId: f.entryId, clase: x.clase, fecha: x.fecha, tercero: x.tercero, numero: f.numero, importe: Number(f.fila[col]), deOtroMes: partida.get(f.entryId)?.deOtroMes ?? false, pdf: f.pdf }
  }
  const recibidas = filasR.map((f) => aFactura(f, total(XML_RECIBIDAS)))
  const emitidas = filasE.map((f) => aFactura(f, total(XML_EXPEDIDAS)))
  const suma = (xs: { importe: number }[]) => xs.reduce((t, x) => t + c(x.importe), 0) / 100
  const totalRecibidas = suma(recibidas)
  const totalEmitidas = suma(emitidas)

  // Las cuentas nuevas: las que usan las filas que salen y no han salido nunca.
  const salidas = new Set(yaSalidas.values())
  const usadas = new Set([...filasE, ...filasR, ...prepA.asientos, ...filasD].flatMap((f) => f.usa))
  const nuevas = [...usadas].filter((k) => !salidas.has(k)).sort()
  // De cada cuenta, los datos de su ficha (el de la ficha con NIF si las dos lo traen).
  const datos = new Map<string, CuentaDeLaBase>()
  for (const x of [...rs.cuentas, ...em.cuentas, ...as.cuentas, ...ds.cuentas]) { const y = datos.get(x.codigo); if (!y || (!y.nif && x.nif)) datos.set(x.codigo, { ...y, ...x, gastoHabitual: x.gastoHabitual ?? y?.gastoHabitual ?? null }) }
  // La cuenta de gasto habitual va en la ficha si ERP10 la va a tener: sale ahora o ya salió.
  const conGasto = [...new Set([...nuevas, ...nuevas.map((k) => datos.get(k)?.gastoHabitual).filter((g): g is string => !!g && plan.has(g))])]
  const { erp } = convertirCuentas(conGasto, plan, ps.largo, yaSalidas)
  for (const [x, k] of yaSalidas) erp.set(k, x)
  const cuentas = nuevas.map((k) => ({ codigo: k, codigoErp10: erp.get(k) ?? k, nombre: datos.get(k)?.nombre ?? k, nif: datos.get(k)?.nif ?? null }))
  const subcuentas = nuevas.map((k) => {
    const g = datos.get(k)?.gastoHabitual ?? null
    return filaSubcuenta({ codigo: k, nombre: datos.get(k)?.nombre ?? k, nif: datos.get(k)?.nif ?? null, gastoHabitual: g && erp.has(g) && (nuevas.includes(g) || salidas.has(g)) ? g : null }, erp)
  })

  // Lo que no puede salir: lo que la base ya dice que no sale (de las facturas) y lo que no pasa el módulo.
  const esTpv = (p: PartidaPorSalir) => p.clase === 'emitida' && p.origen === 'sales_day'
  const dia = new Map(ds.dias.map((d) => [d.entryId, d]))
  const quien = (p: PartidaPorSalir) => p.tercero ?? p.concepto
  const noPuedenSalir: NoPuedeSalir[] = [
    ...ps.partidas.filter((p) => !p.sale).map((p) => ({
      entryId: p.entryId, clase: esTpv(p) ? 'dia' as const : p.clase as Clase, fecha: p.fecha, quien: esTpv(p) ? (dia.get(p.entryId)?.local ?? 'Día de ventas') : quien(p),
      numero: p.numeroFactura ?? `${p.serie}/${p.numero ?? ''}`,
      porque: p.avisos.filter((a) => !a.startsWith('No tiene su PDF')).join(' '),
    })),
    // X08 · Un día que la base da por salible y no ha llegado con los días leídos: se cuenta (regla 7).
    ...ps.partidas.filter((p) => esTpv(p) && p.sale && !dia.has(p.entryId)).map((p) => ({
      entryId: p.entryId, clase: 'dia' as const, fecha: p.fecha, quien: 'Día de ventas', numero: `${p.serie}/${p.numero ?? ''}`,
      porque: 'No se ha leído el día del TPV: vuelve a cargar la página.',
    })),
    ...[...prepE.noSalen, ...prepR.noSalen, ...prepD.noSalen,
      ...prepA.noSalen.filter((x) => (!cruce.size || !chocan.some((y) => y.entryId === x.entryId)) && (!esDia.has(x.entryId) || !chocan.some((y) => y.entryId === x.entryId))),
      ...chocan].map((x) => {
      const r = porId.get(x.entryId)
      const p = partida.get(x.entryId)
      const d = dia.get(x.entryId)
      return r
        ? { entryId: x.entryId, clase: r.clase, fecha: r.fecha, quien: r.tercero, numero: x.numero, porque: x.porque }
        : d
          ? { entryId: x.entryId, clase: 'dia' as const, fecha: d.fecha, quien: d.local ?? 'Día de ventas', numero: x.numero, porque: x.porque }
          : { entryId: x.entryId, clase: 'asiento' as const, fecha: p?.fecha ?? '', quien: p?.concepto ?? '', numero: x.numero, porque: x.porque }
    }),
  ].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.numero.localeCompare(b.numero))

  const sinPdf = [...emitidas, ...recibidas].filter((x) => !x.pdf)
  const conPdf = [...filasE, ...filasR].filter((f) => f.pdf)
  const pdfs = conPdf.map((f) => ({ nombre: f.pdf!, ruta: porId.get(f.entryId)!.pdf!.ruta, entryId: f.entryId }))
  // X07 · Los asientos que salen (en el orden del fichero) y lo que suman.
  const salenA = new Set(prepA.asientos.filter((a) => !esDia.has(a.entryId)).map((a) => a.entryId))
  const asientos = prepA.asientos.filter((a) => !esDia.has(a.entryId)).map((a) => partida.get(a.entryId)).filter((p): p is PartidaPorSalir => !!p)
  const sumaP = (xs: PartidaPorSalir[]) => xs.reduce((t, p) => t + c(p.importe), 0) / 100
  const totalAsientos = sumaP(asientos)
  const npA = noPuedenSalir.filter((x) => x.clase === 'asiento').length
  // X08 · Los días del TPV que salen, y lo que suman.
  const tpv: DiaQueSale[] = filasD.map((d) => ({ entryId: d.entryId, fecha: d.fecha, local: d.local, rango: d.numero, facturas: d.facturas, importe: d.total }))
  const totalDias = tpv.reduce((t, d) => t + c(d.importe), 0) / 100
  const facturasDias = tpv.reduce((t, d) => t + d.facturas, 0)
  const npD = noPuedenSalir.filter((x) => x.clase === 'dia').length

  const filaFacturas = (id: 'recibidas' | 'emitidas', que: string, clase: Clase, lista: FacturaQueSale[], importe: number): FilaQueSale => {
    const sp = sinPdf.filter((x) => x.clase === clase).length
    const np = noPuedenSalir.filter((x) => x.clase === clase).length
    return {
      id, que, cuantos: lista.length, importe, sale: true,
      estado: sp || np ? 'Mira esto' : lista.length ? 'Listo' : 'Nada',
      texto: [sp ? `${sp} sin PDF` : '', np ? `${np} no ${np === 1 ? 'puede' : 'pueden'} salir` : ''].filter(Boolean).join(' · ')
        || (lista.length ? 'Todas con su PDF' : 'Ninguna este mes'),
    }
  }
  const filas: FilaQueSale[] = [
    { id: 'cuentas', que: 'Cuentas nuevas', cuantos: nuevas.length, importe: null, sale: true,
      estado: nuevas.length ? 'Listo' : 'Nada', texto: nuevas.length ? 'ERP10 no las tiene todavía; van las primeras' : 'Todas las que usan ya están en ERP10' },
    filaFacturas('recibidas', 'Facturas recibidas', 'recibida', recibidas, totalRecibidas),
    filaFacturas('emitidas', 'Facturas emitidas', 'emitida', emitidas, totalEmitidas),
    { id: 'asientos', que: 'Asientos', cuantos: asientos.length, importe: totalAsientos, sale: true,
      estado: npA ? 'Mira esto' : asientos.length ? 'Listo' : 'Nada',
      texto: npA ? `${npA} no ${npA === 1 ? 'puede' : 'pueden'} salir` : asientos.length ? 'Nóminas, pagos y cobros, bancos, traspasos' : 'Ninguno este mes' },
    { id: 'tpv', que: 'Días de ventas del TPV', cuantos: tpv.length, importe: totalDias, sale: true,
      estado: npD ? 'Mira esto' : tpv.length ? 'Listo' : 'Nada',
      texto: [tpv.length ? `${facturasDias} ${facturasDias === 1 ? 'factura' : 'facturas'} del TPV, una factura por día` : '', npD ? `${npD} no ${npD === 1 ? 'puede' : 'pueden'} salir` : '']
        .filter(Boolean).join(' · ') || 'Ninguno este mes' },
    { id: 'pdf', que: 'Los PDF', cuantos: pdfs.length, importe: null, sale: true, estado: pdfs.length ? 'Listo' : 'Nada',
      texto: pdfs.length ? 'Con el nombre de su factura, para que ERP10 los pegue solo' : 'Ninguno' },
  ]

  // Se afirman de lo que sale: cada fila lleva su registro de IVA (la clase «recibida» o «emitida» es tenerlo),
  // ninguna repetida (la base las aparta) y todas cuadran (el módulo no deja salir ninguna que no).
  const comprobaciones = [
    ...(recibidas.length || emitidas.length ? ['Cada factura lleva su registro de IVA', 'Ninguna repetida', 'Todas cuadran'] : []),
    ...(salenA.size ? ['Cada asiento cuadra'] : []),
    ...(tpv.length ? ['Cada día lleva su rango de facturas', 'Cada cobro cuadra con su día'] : []),
  ]

  return {
    filas,
    listas: {
      cuentas, recibidas, emitidas, asientos, tpv,
      pdf: conPdf.map((f) => ({ nombre: f.pdf!, ruta: porId.get(f.entryId)!.pdf!.ruta, factura: f.numero })),
    },
    sinPdf, noPuedenSalir, corregidas: em.corregidas, comprobaciones,
    ficheros: {
      subcuentas,
      expedidas: filasE.map((f) => ({ entryId: f.entryId, fila: f.fila })),
      recibidas: filasR.map((f) => ({
        entryId: f.entryId, fila: f.fila, api: f.api,
        pdf: f.pdf && porId.get(f.entryId)?.pdf ? { ruta: porId.get(f.entryId)!.pdf!.ruta, nombre: f.pdf } : null,
      })),
      asientos: prepA.asientos.map((a) => ({ entryId: a.entryId, filas: a.filas })),
      dias: filasD.map((d) => ({ entryId: d.entryId, fila: d.fila })),
      pdfs,
    },
    totalRecibidas, totalEmitidas, totalAsientos, totalDias,
  }
}

/**
 * X06 · «Volver a sacar solo esa»: la salida con una sola factura (su fila y su PDF).
 * Sin subcuentas: sus cuentas ya salieron con ella la primera vez. Nulo si esa factura
 * no está en lo que sale (no se puede preparar su fila).
 */
export function soloUna(x: Salida, entryId: string): Salida | null {
  const expedidas = x.ficheros.expedidas.filter((f) => f.entryId === entryId)
  const recibidas = x.ficheros.recibidas.filter((f) => f.entryId === entryId)
  // X07 · Un asiento solo: el primero (y único) del fichero, con el 1 en A.
  const colA = columnasAsientos()['001'] - 1
  const asientos = x.ficheros.asientos.filter((f) => f.entryId === entryId).map((a) => ({ entryId: a.entryId, filas: a.filas.map((f) => f.map((v, i) => (i === colA ? 1 : v))) }))
  const dias = x.ficheros.dias.filter((f) => f.entryId === entryId)
  if (!expedidas.length && !recibidas.length && !asientos.length && !dias.length) return null
  const emitidas = x.listas.emitidas.filter((f) => f.entryId === entryId)
  const rec = x.listas.recibidas.filter((f) => f.entryId === entryId)
  const suma = (xs: FacturaQueSale[]) => xs.reduce((t, f) => t + c(f.importe), 0) / 100
  return {
    ...x,
    listas: { ...x.listas, cuentas: [], emitidas, recibidas: rec, asientos: x.listas.asientos.filter((p) => p.entryId === entryId), tpv: x.listas.tpv.filter((d) => d.entryId === entryId),
      pdf: x.listas.pdf.filter((p) => x.ficheros.pdfs.some((q) => q.entryId === entryId && q.nombre === p.nombre)) },
    ficheros: { subcuentas: [], expedidas, recibidas, asientos, dias, pdfs: x.ficheros.pdfs.filter((p) => p.entryId === entryId) },
    totalEmitidas: suma(emitidas), totalRecibidas: suma(rec), totalAsientos: x.listas.asientos.filter((p) => p.entryId === entryId).reduce((t, p) => t + c(p.importe), 0) / 100,
    totalDias: x.listas.tpv.filter((d) => d.entryId === entryId).reduce((t, d) => t + c(d.importe), 0) / 100,
  }
}

/** Lo que se baja y se apunta: los libros (en el orden en que se importan), con su huella y la de cada fila. */
export async function prepararDescarga(x: Salida): Promise<{
  libros: { nombre: string; bytes: ArrayBuffer; filas: number; huella: string }[]
  partidas: { entry_id: string; clase: Clase; huella: string }[]
}> {
  const huellaBytes = async (b: ArrayBuffer) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', b))].map((v) => v.toString(16).padStart(2, '0')).join('')
  const libros: { nombre: string; bytes: ArrayBuffer; filas: number; huella: string }[] = []
  for (const [nombre, filas] of [
    [FICHERO_SUBCUENTAS, x.ficheros.subcuentas], [FICHERO_EXPEDIDAS, x.ficheros.expedidas.map((r) => r.fila)], [FICHERO_DIAS, x.ficheros.dias.map((r) => r.fila)],
    [FICHERO_RECIBIDAS, x.ficheros.recibidas.map((r) => r.fila)],
    [FICHERO_ASIENTOS, x.ficheros.asientos.flatMap((a) => a.filas)],
  ] as const) {
    if (!filas.length) continue
    const bytes = await libroErp10(filas)
    libros.push({ nombre, bytes, filas: filas.length, huella: await huellaBytes(bytes) })
  }
  const dias = new Set(x.ficheros.dias.map((d) => d.entryId))
  const partidas = await Promise.all([
    ...x.ficheros.expedidas.map(async (r) => ({ entry_id: r.entryId, clase: 'emitida' as const, huella: await huellaFila(r.fila) })),
    ...x.ficheros.recibidas.map(async (r) => ({ entry_id: r.entryId, clase: 'recibida' as const, huella: await huellaFila(r.fila) })),
    ...x.ficheros.asientos.filter((a) => !dias.has(a.entryId)).map(async (a) => ({ entry_id: a.entryId, clase: 'asiento' as const, huella: await huellaFila(a.filas.flat()) })),
    // X08 · Un día sale una vez, como emitida: la huella de su fila y la de su cobro.
    ...x.ficheros.dias.map(async (d) => ({
      entry_id: d.entryId, clase: 'emitida' as const,
      huella: await huellaFila([...d.fila, ...x.ficheros.asientos.filter((a) => a.entryId === d.entryId).flatMap((a) => a.filas.flat())]),
    })),
  ])
  return { libros, partidas }
}

/** El tope de cada fichero comprimido de PDF (encargo X04: si un mes pasa de 150 MB, en varios). */
export const TOPE_ZIP = 150 * 1024 * 1024

/** Reparte los PDF en ficheros comprimidos de como mucho `tope` bytes, en orden. Uno que pase del tope, solo. */
export function repartirPdfs<T extends { bytes: Uint8Array }>(pdfs: readonly T[], tope = TOPE_ZIP): T[][] {
  const grupos: T[][] = []
  let actual: T[] = []; let peso = 0
  for (const p of pdfs) {
    if (actual.length && peso + p.bytes.length > tope) { grupos.push(actual); actual = []; peso = 0 }
    actual.push(p); peso += p.bytes.length
  }
  if (actual.length) grupos.push(actual)
  return grupos
}

/** Los ficheros comprimidos: pdf.zip si es uno; pdf-1.zip, pdf-2.zip… si son varios. Los PDF ya van comprimidos: se guardan sin volver a comprimir. */
export function comprimirPdfs(pdfs: readonly { nombre: string; bytes: Uint8Array }[], tope = TOPE_ZIP): { nombre: string; bytes: Uint8Array; pdfs: number }[] {
  const grupos = repartirPdfs(pdfs, tope)
  return grupos.map((g, i) => ({
    nombre: grupos.length === 1 ? 'pdf.zip' : `pdf-${i + 1}.zip`,
    bytes: zipSync(Object.fromEntries(g.map((p) => [p.nombre, [p.bytes, { level: 0 }]]))),
    pdfs: g.length,
  }))
}

/** El mes en palabras: «noviembre de 2026». */
export function mesEnPalabras(aaaamm01: string): string {
  const [a, m] = aaaamm01.split('-').map(Number)
  return `${['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'][m - 1]} de ${a}`
}

/** Importe con punto de miles y coma decimal, siempre con dos decimales («20.730,65»). */
export function importe(n: number): string {
  const c = Math.round(Math.abs(n) * 100)
  return `${n < 0 ? '−' : ''}${String(Math.floor(c / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${String(c % 100).padStart(2, '0')}`
}

/** Los meses desde el primero que sale hasta el de hoy, del más nuevo al más viejo. */
export function mesesDesde(desde: string, hoy: string): string[] {
  const out: string[] = []
  let [a, m] = desde.slice(0, 7).split('-').map(Number)
  const [ah, mh] = hoy.slice(0, 7).split('-').map(Number)
  if (a * 12 + m > ah * 12 + mh) [a, m] = [ah, mh]
  while (a * 12 + m <= ah * 12 + mh) { out.push(`${a}-${String(m).padStart(2, '0')}-01`); m++; if (m > 12) { m = 1; a++ } }
  return out.reverse()
}
