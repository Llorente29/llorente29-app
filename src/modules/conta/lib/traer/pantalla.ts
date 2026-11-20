// src/modules/conta/lib/traer/pantalla.ts
//
// N07 · Lo que DECIDE la pantalla «Traer de ERP10» (las maquetas traer_paso1/2/3, aprobadas el 17/11).
// Puro: sin base y sin React. Recibe lo leído (leerCarga, N04), lo que va a la base (paraLaBase) y
// lo que la base ya sabe, y devuelve las filas, sus estados, los avisos y cuándo se enciende cada botón.
//
// Las palabras son las de un administrativo: «traer», «lo traído», «en prueba», «darlo por bueno»,
// «deshacer». Nunca «importar», «migración», «histórico», «carga» ni «serie».

import type { Carga } from './index'
import type { DatosDeLaCarga } from './paraLaBase'
import type { TipoFichero } from './reconocer'

export type Modo = 'nueva' | 'ejercicio'
export type EstadoFila = 'leido' | 'mira' | 'falta'

/** Lo que la base sabe traer hoy (N06a/N06b). Lo demás se dice en una línea, sin pintarlo como si funcionara. */
export const SE_TRAEN: readonly TipoFichero[] = ['proveedores', 'clientes', 'plan_cuentas', 'diario', 'expedidas', 'recibidas', 'sumas_saldos']
export const TODAVIA_NO = 'Todavía no se trae por aquí: el inmovilizado, los PDF de las facturas y los 303 presentados.'

/** Las filas de cada modo, en el orden de la maqueta. «Poner al día un ejercicio» no lleva las fichas de terceros. */
const FILAS: Record<Modo, readonly TipoFichero[]> = {
  nueva: ['proveedores', 'clientes', 'plan_cuentas', 'diario', 'expedidas', 'recibidas', 'sumas_saldos'],
  ejercicio: ['plan_cuentas', 'diario', 'expedidas', 'recibidas', 'sumas_saldos'],
}
export const MODOS: Record<Modo, { texto: string; ayuda: string }> = {
  nueva: { texto: 'Empresa nueva: traerlo todo', ayuda: 'Fichas, cuentas y la contabilidad del año. Los años anteriores se traen igual, uno a uno.' },
  ejercicio: { texto: 'Poner al día un ejercicio', ayuda: 'Solo la contabilidad del año, en una empresa que ya está en Sumied.' },
}

export interface FilaPaso1 {
  tipo: TipoFichero
  que: string
  /** «si lo tiene»: los que pueden faltar sin que pase nada. */
  siLoTiene: boolean
  fichero: string | null
  haLeido: string | null
  estado: EstadoFila
  /** Lo que se dice al lado de la etiqueta: corto («7 sin NIF», «Todos cuadran», «Para comprobar al final»). */
  nota: string
}

const QUE: Record<TipoFichero, string> = {
  proveedores: 'Proveedores', clientes: 'Clientes', plan_cuentas: 'Plan de cuentas', diario: 'Diario', expedidas: 'Facturas emitidas',
  recibidas: 'Facturas recibidas', sumas_saldos: 'Sumas y saldos', inmovilizado: 'Inmovilizado',
}

const n = (x: number) => x.toLocaleString('es-ES')
const cuantos = (x: number, uno: string, varios: string) => `${n(x)} ${x === 1 ? uno : varios}`

/** La nota corta de cada fila. */
function notaDe(t: TipoFichero, c: Carga, estado: EstadoFila): string {
  const f = c.comprobado
  if (estado === 'falta') {
    switch (t) {
      case 'sumas_saldos': return 'Para comprobar al final'
      case 'diario': return 'Sin él, solo las cuentas y las fichas'
      case 'proveedores': case 'clientes': return 'Sin él, sus fichas no se crean'
      case 'plan_cuentas': return 'Las cuentas salen del diario'
      default: return 'No entran facturas'
    }
  }
  switch (t) {
    case 'proveedores': case 'clientes': {
      const lista = (t === 'proveedores' ? c.proveedores : c.clientes)?.terceros ?? []
      const sin = lista.filter((x) => !x.nif).length
      return sin ? `${n(sin)} sin NIF` : 'Todos con NIF'
    }
    case 'plan_cuentas': return f.largos.largos.length === 1 ? `De ${f.largos.largos[0]} cifras` : ''
    case 'diario': return c.diario && c.diario.debe === c.diario.haber ? 'Todos cuadran' : 'No cuadra'
    case 'expedidas': case 'recibidas': {
      const sin = (f.facturas?.sinCasar ?? []).filter((x) => x.libro === t).length
      return !c.diario ? 'Sin el diario, no se casan' : sin ? `${n(sin)} sin su asiento` : 'Con su asiento'
    }
    case 'sumas_saldos': {
      if (!f.sumas) return 'Para comprobar al final'
      const mal = f.sumas.filter((x) => x.frase).length
      return mal ? `${n(mal)} no cuadran con el diario` : 'Cuadra con el diario'
    }
    default: return ''
  }
}

/** Las filas del paso 1, con lo leído y cómo está cada una. */
export function filasPaso1(c: Carga, modo: Modo): FilaPaso1[] {
  return FILAS[modo].map((t) => {
    const f = c.ficheros.find((x) => x.tipo === t)!
    const estado: EstadoFila = f.estado
    return { tipo: t, que: QUE[t], siLoTiene: t === 'sumas_saldos', fichero: f.fichero, haLeido: f.haLeido, estado, nota: notaDe(t, c, estado) }
  })
}

/** Lo que se ha soltado y no se trae por aquí (hoy, el inmovilizado), para decirlo y no pintarlo. */
export function soltadosQueNoSeTraen(c: Carga, modo: Modo): string[] {
  return c.ficheros.filter((f) => f.fichero && !FILAS[modo].includes(f.tipo)).map((f) => `${f.fichero} (${QUE[f.tipo].toLowerCase()})`)
}

/** Solo las cuentas y las fichas: sin diario ni libros de facturas. */
export const soloCuentas = (c: Carga): boolean => !c.diario && !c.recibidas && !c.expedidas && !!(c.plan || c.proveedores || c.clientes)

export interface Aviso { id: string; titulo: string; texto: string; lista: string[]; tono: 'ambar' | 'nota' }

/** El título (hasta el primer punto o los dos puntos) y lo demás de una frase del N04. */
function partir(frase: string): { titulo: string; texto: string } {
  const m = /^(.+?\.)\s+(.*)$/s.exec(frase)
  return m ? { titulo: m[1], texto: m[2] } : { titulo: frase, texto: '' }
}

/** «Qué mirar antes de traerlo»: lo que no cuadra al leer, uno por fichero; y las notas en blanco. */
export function avisosPaso1(c: Carga, modo: Modo): Aviso[] {
  const out: Aviso[] = []
  for (const a of c.avisos) out.push({ id: `suelto-${out.length}`, ...partir(a), lista: [], tono: 'ambar' })
  for (const f of c.ficheros) {
    if (!FILAS[modo].includes(f.tipo) || !f.avisos.length) continue
    if (f.avisos.length === 1) { out.push({ id: f.tipo, ...partir(f.avisos[0]), lista: [], tono: 'ambar' }); continue }
    out.push({ id: f.tipo, titulo: `${QUE[f.tipo]}: ${cuantos(f.avisos.length, 'cosa que mirar', 'cosas que mirar')}.`, texto: 'Una a una:', lista: f.avisos, tono: 'ambar' })
  }
  if (c.comprobado.largos.frase) out.push({ id: 'largos', ...partir(c.comprobado.largos.frase), lista: [], tono: 'ambar' })
  if (c.diario && !c.sumas) {
    out.push({ id: 'sin-sumas', titulo: 'Falta el sumas y saldos.', texto: 'Sin él no se puede hacer el paso 3: comprobar que Sumied queda igual que ERP10, cuenta a cuenta.', lista: [], tono: 'nota' })
  }
  if (soloCuentas(c)) {
    out.push({ id: 'solo-cuentas', titulo: 'Solo traes las cuentas y las fichas.', texto: 'Lo de antes (el diario y las facturas) se trae después, cuando lo tengas: no hace falta para trabajar el mes en curso.', lista: [], tono: 'nota' })
  }
  return out
}

/** Las comprobaciones en verde debajo de la tabla (solo lo que se puede afirmar) y la línea gris del IVA. */
export function comprobacionesPaso1(c: Carga): { verdes: string[]; gris: string | null } {
  const verdes: string[] = []
  if (c.diario && c.diario.debe === c.diario.haber && !c.diario.avisos.length) verdes.push('Todos los asientos cuadran')
  if (c.comprobado.facturas && !c.comprobado.facturas.sinCasar.length) verdes.push('Cada factura encuentra su asiento')
  if (c.comprobado.sumas && c.comprobado.sumas.every((x) => !x.frase)) verdes.push('El diario da el sumas y saldos, cuenta a cuenta')
  if (c.comprobado.iva.length && c.comprobado.iva.every((x) => x.cuadra)) verdes.push('El IVA del diario es el de los libros')
  return { verdes, gris: c.diario ? 'El IVA de cada trimestre: sin los 303 no se puede comprobar con lo presentado' : null }
}

/** «Ver lo que entra»: con algo que se pueda traer leído, y sin cuentas de largos distintos (la base no convierte nada). */
export function puedeVerLoQueEntra(c: Carga, modo: Modo): { puede: boolean; porque: string | null } {
  const leidos = c.ficheros.filter((f) => f.fichero && FILAS[modo].includes(f.tipo))
  if (!leidos.length) return { puede: false, porque: 'Suelta al menos el plan de cuentas o el listado de proveedores.' }
  if (c.comprobado.largos.largos.length > 1) return { puede: false, porque: 'Las cuentas de los ficheros no tienen todas el mismo largo: sácalas de ERP10 con el mismo.' }
  if (modo === 'ejercicio' && !c.diario) return { puede: false, porque: 'Para poner al día un ejercicio hace falta su diario.' }
  return { puede: true, porque: null }
}

// ── Paso 2 · Mira lo que entra ─────────────────────────────────────────────────────────────────────

/** Lo que ya está en Sumied (para decir cuántas cuentas y fichas ya estaban). */
export interface YaEnSumied { cuentas: ReadonlySet<string>; nifsProveedores: ReadonlySet<string>; nifsClientes: ReadonlySet<string> }

export interface FilaPaso2 { id: string; que: string; cuantos: string; importe: number | null; como: string; mira: boolean }

const enRango = (fecha: string, ejercicio: string | null, inicio: string | null) =>
  (ejercicio === null || fecha.startsWith(ejercicio)) && (inicio === null || fecha < inicio)

/** Lo que entra, con lo que hará la base: las fechas del día de inicio en adelante se quedan fuera. Importes en céntimos. */
export function filasPaso2(d: DatosDeLaCarga, ya: YaEnSumied, ejercicio: string | null, inicio: string | null): { filas: FilaPaso2[]; fuera: { asientos: number; facturas: number } } {
  const filas: FilaPaso2[] = []
  if (d.cuentas.length) {
    const nuevas = d.cuentas.filter((c) => !ya.cuentas.has(c.codigo)).length
    const estaban = d.cuentas.length - nuevas
    filas.push({ id: 'cuentas', que: 'Cuentas', cuantos: `${n(nuevas)} ${nuevas === 1 ? 'nueva' : 'nuevas'}`, importe: null,
      como: estaban ? `${estaban === 1 ? 'La otra ya estaba' : `Las otras ${n(estaban)} ya estaban`} en Sumied` : 'Con sus números de ERP10', mira: false })
  }
  for (const [clase, que] of [['proveedor', 'Proveedores'], ['cliente', 'Clientes']] as const) {
    const ts = d.terceros.filter((t) => t.clase === clase)
    if (!ts.length) continue
    const nifs = clase === 'proveedor' ? ya.nifsProveedores : ya.nifsClientes
    const estaban = ts.filter((t) => t.nif && nifs.has(t.nif)).length
    const sinNif = ts.filter((t) => !t.nif).length
    filas.push({ id: clase, que, cuantos: n(ts.length), importe: null,
      como: [estaban ? `${estaban === 1 ? '1 ya estaba' : `${n(estaban)} ya estaban`} en Sumied: se completa${estaban === 1 ? '' : 'n'}` : 'Cada uno con su NIF y su cuenta',
        sinNif ? `${n(sinNif)} sin NIF` : ''].filter(Boolean).join('. '), mira: sinNif > 0 })
  }
  const asientos = d.asientos.filter((a) => enRango(a.fecha, ejercicio, inicio))
  const facturas = d.facturas.filter((f) => enRango(f.fecha, ejercicio, inicio))
  const fuera = {
    asientos: d.asientos.filter((a) => (ejercicio === null || a.fecha.startsWith(ejercicio)) && inicio !== null && a.fecha >= inicio).length,
    facturas: d.facturas.filter((f) => (ejercicio === null || f.fecha.startsWith(ejercicio)) && inicio !== null && f.fecha >= inicio).length,
  }
  if (asientos.length) {
    const debe = asientos.reduce((s, a) => s + a.apuntes.reduce((t, x) => t + x.debe, 0), 0)
    filas.push({ id: 'asientos', que: 'Asientos', cuantos: n(asientos.length), importe: debe, como: 'Debe igual a haber, con su número de ERP10', mira: false })
  }
  for (const [libro, que] of [['expedidas', 'Facturas emitidas'], ['recibidas', 'Facturas recibidas']] as const) {
    const fs = facturas.filter((f) => f.libro === libro)
    if (!fs.length) continue
    const sin = fs.filter((f) => !f.asiento).length
    filas.push({ id: libro, que, cuantos: n(fs.length), importe: fs.reduce((s, f) => s + f.total, 0),
      como: sin ? `Como facturas. ${n(sin)} sin su asiento: entran marcadas` : 'Como facturas, cada una con su asiento', mira: sin > 0 })
  }
  const pend = facturas.filter((f) => (f.pendiente ?? 0) > 0)
  if (pend.length) {
    const mal = d.pendientesNoExactos.length
    filas.push({ id: 'pendientes', que: 'Por pagar y por cobrar', cuantos: cuantos(pend.length, 'factura', 'facturas'), importe: pend.reduce((s, f) => s + (f.pendiente ?? 0), 0),
      como: `Lo propone Sumied con el saldo de cada uno.${mal ? ` En ${n(mal)} no cuadra exacto.` : ''}`, mira: mal > 0 })
  }
  return { filas, fuera }
}

/** «Qué decidir»: lo que la base parará y lo que hay que mirar. */
export function avisosPaso2(d: DatosDeLaCarga, asientosAMano: { n: number; desde: string; hasta: string } | null, fuera: { asientos: number; facturas: number }, inicio: string | null): Aviso[] {
  const out: Aviso[] = []
  if (asientosAMano && asientosAMano.n > 0) {
    out.push({ id: 'a-mano', titulo: `En Sumied ya hay ${cuantos(asientosAMano.n, 'asiento apuntado', 'asientos apuntados')} entre el ${dma(asientosAMano.desde)} y el ${dma(asientosAMano.hasta)}.`,
      texto: 'Lo traído no se mezcla con lo apuntado aquí: así no se puede traer. Trae solo hasta el día de antes del primero.', lista: [], tono: 'ambar' })
  }
  if (d.pendientesNoExactos.length) {
    out.push({ id: 'no-cuadra', titulo: `${cuantos(d.pendientesNoExactos.length, 'tercero', 'terceros')}: lo que se les debe no cuadra con sus facturas.`,
      texto: 'Sumied reparte el saldo de cada uno entre sus últimas facturas para saber cuáles están por pagar. En estos sobra o falta algo.',
      lista: d.pendientesNoExactos.map((p) => p.frase), tono: 'ambar' })
  }
  if (inicio && fuera.asientos + fuera.facturas > 0) {
    out.push({ id: 'fuera', titulo: `Del ${dma(inicio)} en adelante lo lleva ya Sumied.`,
      texto: `Se quedan fuera ${cuantos(fuera.asientos, 'asiento', 'asientos')} y ${cuantos(fuera.facturas, 'factura', 'facturas')} de esas fechas.`, lista: [], tono: 'nota' })
  }
  out.push({ id: 'cuenta', titulo: 'Lo traído cuenta como lo hecho aquí.', texto: 'Avisa de facturas repetidas, respeta los trimestres presentados y da el saldo de cada proveedor y cliente.', lista: [], tono: 'nota' })
  if (d.asientos.length) out.push({ id: 'rastro', titulo: 'Se queda el rastro.', texto: 'Cada asiento guarda su número de ERP10, para encontrarlo en los dos programas.', lista: [], tono: 'nota' })
  return out
}

/** «Traerlo»: con algo que entre y sin asientos apuntados en el periodo (la base pararía). */
export const puedeTraer = (filas: readonly FilaPaso2[], asientosAMano: { n: number } | null): boolean =>
  filas.length > 0 && !(asientosAMano && asientosAMano.n > 0)

// ── Paso 3 · Comprueba que queda igual ─────────────────────────────────────────────────────────────

export interface Diferencia { cuenta: string; nombre: string; alli_debe: number; alli_haber: number; traido_debe: number; traido_haber: number }
export interface FilaPaso3 { cuenta: string; nombre: string; erp10: number; sumied: number; diferencia: number }

/** Cuenta a cuenta (saldo debe − haber, en euros): las que no quedan igual primero, después las demás. */
export function filasPaso3(sumas: readonly { cuenta: string; nombre: string; debe: number; haber: number }[], diferencias: readonly Diferencia[]): { distintas: FilaPaso3[]; iguales: FilaPaso3[]; total: { erp10: number; sumied: number; diferencia: number } } {
  const r2 = (x: number) => Math.round(x * 100) / 100
  const distintas = diferencias.map((d) => {
    const erp10 = r2(Number(d.alli_debe) - Number(d.alli_haber)), sumied = r2(Number(d.traido_debe) - Number(d.traido_haber))
    return { cuenta: d.cuenta, nombre: d.nombre, erp10, sumied, diferencia: r2(sumied - erp10) }
  })
  const otras = new Set(distintas.map((d) => d.cuenta))
  const iguales = sumas.filter((s) => !otras.has(s.cuenta)).map((s) => {
    const saldo = r2((s.debe - s.haber) / 100)
    return { cuenta: s.cuenta, nombre: s.nombre, erp10: saldo, sumied: saldo, diferencia: 0 }
  }).sort((a, b) => a.cuenta.localeCompare(b.cuenta))
  const todas = [...distintas, ...iguales]
  return { distintas, iguales, total: { erp10: r2(todas.reduce((s, x) => s + x.erp10, 0)), sumied: r2(todas.reduce((s, x) => s + x.sumied, 0)), diferencia: r2(distintas.reduce((s, x) => s + x.diferencia, 0)) } }
}

/** La línea de siempre arriba mientras está en prueba: qué, cuándo y quién, y que no se paga ni cobra. */
export function lineaEnPrueba(quien: string | null, cuando: Date, que: string): string {
  const f = cuando.toLocaleString('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', ' a las')
  return `Traído en prueba el ${f}${quien ? ` por ${quien}` : ''}: ${que}. Lo traído no se puede pagar ni cobrar hasta darlo por bueno.`
}

/**
 * Lo traído cuando son solo cuentas y fichas, dicho como la tabla: «0 cuentas nuevas (las 16 ya estaban),
 * 4 proveedores y 1 cliente». Las cuentas, con lo que guardó la base (nuevas y las que ya estaban); los
 * terceros, como los dice la base en su texto («He traído 16 cuentas, 4 proveedores y 1 cliente. …»).
 */
export function queSeTrajoSoloCuentas(cuentas: { cuentas_nuevas?: number; cuentas_estaban?: number }, textoDeLaBase: string | null): string {
  const nuevas = cuentas.cuentas_nuevas ?? 0, estaban = cuentas.cuentas_estaban ?? 0
  const deCuentas = `${n(nuevas)} ${nuevas === 1 ? 'cuenta nueva' : 'cuentas nuevas'}`
    + (estaban ? ` (${nuevas === 0 ? (estaban === 1 ? 'la que había ya estaba' : `las ${n(estaban)} ya estaban`) : (estaban === 1 ? 'la otra ya estaba' : `las otras ${n(estaban)} ya estaban`)})` : '')
  const terceros = /^He traído [^,]+?, (.+?)\.(?: |$)/.exec(textoDeLaBase ?? '')?.[1] ?? /^He traído [^,]+? y (.+?)\.(?: |$)/.exec(textoDeLaBase ?? '')?.[1]
  return terceros ? `${deCuentas}, ${terceros}` : deCuentas
}

/** Cambia, en una frase de la base, «16 cuentas, 4 proveedores y 1 cliente» por como lo dice la tabla. */
export function conLoDeLaTabla(frase: string, que: string): string {
  return frase.replace(/\b[\d.]+ cuentas?(, [^.]*?)?(?=\.( |$))/, que)
}

/** «el 18/11 a las 18:40»: cuándo, en Madrid. */
const cuandoEs = (cuando: Date) =>
  cuando.toLocaleString('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', ' a las')

/**
 * La confirmación de «Darlo por bueno», tal como queda: lo que guardó la base al darlo por bueno (su
 * texto, sin el «Hecho.» del principio), con quién y cuándo. Se lee de la base, no de un aviso de
 * la pantalla: se ve aunque la pantalla se vuelva a montar.
 */
export function lineaDadoPorBueno(quien: string | null, cuando: Date, textoDeLaBase: string): string {
  return `Dado por bueno el ${cuandoEs(cuando)}${quien ? ` por ${quien}` : ''}. ${textoDeLaBase.replace(/^Hecho\.\s*/, '')}`
}

/** La confirmación de «Deshacer el traspaso», con lo que se quitó (lo que guardó la base al deshacer). */
export function lineaDeshecho(quien: string | null, cuando: Date, quitado: Record<string, number>): string {
  const q = (k: string) => quitado[k] ?? 0
  const partes = [
    cuantos(q('asientos'), 'asiento', 'asientos'), cuantos(q('recibidas') + q('emitidas'), 'factura', 'facturas'),
    cuantos(q('cuentas'), 'cuenta', 'cuentas'), cuantos(q('proveedores'), 'proveedor', 'proveedores'), cuantos(q('clientes'), 'cliente', 'clientes'),
  ]
  return `Deshecho el ${cuandoEs(cuando)}${quien ? ` por ${quien}` : ''}: se ha quitado todo lo traído (${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}). La empresa queda como estaba antes de traerlo.`
}

/** N09 · Lo pagado o cobrado de un tercero, como lo guardó la base al traer (detail.pendientesNoExactos). */
export interface TerceroConPagos { codigo: string; nombre: string; frase: string; facturasSinCasar?: string[]; cuadraConSaldo?: boolean }

/** N09 · Cuántas de lo traído están pagadas (o cobradas), con pago parcial y pendientes enteras. */
export interface ResumenPagado { pagadas: number; aMedias: number; pendientes: number }

/**
 * N09 · La frase del paso 3 sobre lo pagado y lo cobrado de las facturas traídas:
 *   · con pagos que no se han podido casar: «N facturas con pagos que no he podido casar: míralas.»;
 *   · si no, si lo pendiente de algún tercero no da su saldo: «A N proveedores y clientes no les da…»;
 *   · si todo cuadra: cuántas pagadas, con pago parcial y pendientes, y que da igual que el sumas y saldos.
 * Con la lista de cada tercero que hay que mirar (como «Al traerlo se apuntaron N cosas»).
 */
export function frasePagado(terceros: readonly TerceroConPagos[], resumen: ResumenPagado | null): { aviso: boolean; titulo: string; lista: string[] } {
  const sinCasar = terceros.reduce((s, t) => s + (t.facturasSinCasar?.length ?? 0), 0)
  const noCuadran = terceros.filter((t) => t.cuadraConSaldo === false)
  const lista = terceros.filter((t) => (t.facturasSinCasar?.length ?? 0) > 0 || t.cuadraConSaldo === false).map((t) => t.frase)
  if (sinCasar > 0) return { aviso: true, titulo: `${sinCasar === 1 ? '1 factura con pagos' : `${sinCasar} facturas con pagos`} que no he podido casar: míralas.`, lista }
  if (noCuadran.length) return { aviso: true, titulo: `A ${noCuadran.length === 1 ? '1 proveedor o cliente' : `${noCuadran.length} proveedores y clientes`} lo que les queda por pagar o cobrar no les da igual que su saldo en el sumas y saldos: míralo.`, lista }
  const r = resumen ?? { pagadas: 0, aMedias: 0, pendientes: 0 }
  const partes = [r.pagadas && `${r.pagadas} ${r.pagadas === 1 ? 'pagada o cobrada' : 'pagadas o cobradas'}`, r.aMedias && `${r.aMedias} con pago parcial`,
    r.pendientes && `${r.pendientes} ${r.pendientes === 1 ? 'pendiente' : 'pendientes'}`].filter(Boolean) as string[]
  const cuales = partes.length > 1 ? `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}` : partes[0] ?? 'ninguna factura'
  return { aviso: false, titulo: `Pagadas y cobradas: ${cuales}. Lo que le queda a cada proveedor y cliente da igual que su saldo en ERP10.`, lista: [] }
}
export const SIN_SALDOS = 'Solo has traído las cuentas y los proveedores. No hay saldos que comparar.'
export const SIN_CUENTA_DE_GASTO = 'La primera factura de cada proveedor te pedirá a qué cuenta de gasto va: ERP10 no la da en su listado.'

/** 2026-03-31 → «31/03/2026». */
export const dma = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}`
