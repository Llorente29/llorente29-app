// src/modules/conta/impuestos/calendario.ts
//
// I01b · P1 · Impuestos › Calendario (tablero 8). Núcleo puro: lo que dice
// cada fila, cada cifra y «Lo siguiente», a partir de lo que devuelve
// conta_impuesto_calendario. Se prueba sin React
// (tests/unit/modules/conta/i01b/calendario.test.ts).
//
// El nivel cambia las palabras, nunca los sitios (encargo, punto 8): en «sin
// experiencia», «IVA del trimestre (modelo 303)»; en medio, «IVA del
// trimestre» con «modelo 303» debajo; en experto, «303 · 3T».
//
// Lo que aún no se calcula aquí (todo menos el 303, hasta el I01c) sale igual,
// con sus fechas, y dice «Se calculará aquí pronto»: un modelo que la empresa
// presenta no se esconde (regla 7).

import type { Nivel } from '@/modules/conta/esqueleto/preferencias'
import type { TonoChip, TonoTarjeta } from '@/modules/conta/diseno'
import { diaMesCorto, eurosExactos } from '@/modules/conta/lib/formato'

export type Estado = 'pending' | 'draft' | 'reviewed' | 'filed' | 'booked' | 'paid' | 'offset' | 'refunded' | 'not_required'
export type Resultado = 'to_pay' | 'to_refund' | 'to_offset' | 'zero' | 'no_activity'
export type Cadencia = 'monthly' | 'quarterly' | 'annual' | 'instalments_202'

export interface Declaracion {
  id: string
  estado: Estado
  estado_texto: string
  resultado: Resultado | null
  importe: number | null
  anterior: number | null
  no_hace_falta: string | null
  presentada: string | null
  por: 'sumied' | 'outside' | null
  errores: number
  avisos: number
  aviso: string | null
  cuadra: boolean
}

export interface FilaCalendario {
  obligacion: string
  modelo: string
  nombre: string
  cadencia: Cadencia
  ejercicio: number
  periodo: string
  presentacion: string
  domiciliacion: string | null
  provisional: string | null
  atrasado: boolean
  domicilia: boolean
  cuenta_final: string | null
  se_calcula: boolean
  declaracion: Declaracion | null
}

export interface Siguiente { modelo: string; nombre: string; cadencia: Cadencia; ejercicio: number; periodo: string; presentacion: string; domiciliacion: string | null }
export interface ModeloLista { modelo: string; nombre: string; por_que: string; origen: 'rule' | 'added' | 'removed'; cadencia?: Cadencia; quien?: string | null }

export interface Calendario {
  hoy: string
  ventana: string | null
  desde: string | null
  puede_gestionar: boolean
  filas: FilaCalendario[]
  siguiente: Siguiente[]
  presentados: { ano: number; desde: string | null; vencidos: number; presentados: number; en_plazo: number; contabilizados: number }
  modelos: ModeloLista[]
  no_presenta: ModeloLista[]
  se_pueden_anadir: { modelo: string; nombre: string }[]
  /** El certificado con que presenta la empresa (para el aviso de caducidad de Inicio). */
  certificado: { titular: string; caduca: string } | null
  /** Lo presentado a pagar cuyo cargo no ha llegado al banco dos días después del plazo. */
  pagos_sin_llegar: { declaracion: string; modelo: string; ejercicio: number; periodo: string; importe: number; plazo: string; domicilia: boolean }[]
}

// ── Palabras ────────────────────────────────────────────────────────────────

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const mayuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** El nombre de oficina de cada modelo (medio). Lo que no está aquí, con el nombre del catálogo. */
const NOMBRES: Record<string, string> = {
  '111': 'Retenciones de nóminas y profesionales',
  '115': 'Retenciones del alquiler',
  '130': 'Pago a cuenta del IRPF',
  '180': 'Resumen anual del alquiler',
  '190': 'Resumen anual de retenciones',
  '200': 'Impuesto de sociedades',
  '202': 'Pago a cuenta de sociedades',
  '347': 'Clientes y proveedores de más de 3.005,06 €',
  '349': 'Operaciones con la Unión Europea',
  '390': 'Resumen anual del IVA',
}

/** «IVA del trimestre», «Retenciones del alquiler»… (medio). */
export function nombreDeOficina(modelo: string, cadencia: Cadencia | undefined, nombreCatalogo: string): string {
  if (modelo === '303') return cadencia === 'monthly' ? 'IVA del mes' : 'IVA del trimestre'
  return NOMBRES[modelo] ?? nombreCatalogo
}

/** «3.er trimestre», «octubre», «2.º pago», «del año». */
export function periodoEnPalabras(periodo: string): string {
  const t = /^([1-4])T$/.exec(periodo)
  if (t) return `${t[1]}.${t[1] === '1' || t[1] === '3' ? 'er' : 'º'} trimestre`
  const p = /^([1-3])P$/.exec(periodo)
  if (p) return `${p[1]}.${p[1] === '1' || p[1] === '3' ? 'er' : 'º'} pago`
  if (/^(0[1-9]|1[0-2])$/.test(periodo)) return MESES[Number(periodo) - 1]
  return 'del año'
}

/** El nombre de una fila en el nivel de quien mira (el sitio no cambia). */
export function nombreDeFila(f: Pick<FilaCalendario, 'modelo' | 'cadencia' | 'nombre' | 'periodo' | 'ejercicio'>, nivel: Nivel): string {
  const oficina = nombreDeOficina(f.modelo, f.cadencia, f.nombre)
  if (nivel === 'experto') return `${f.modelo} · ${f.periodo === '0A' ? f.ejercicio : f.periodo}`
  if (nivel === 'sin_experiencia') return `${oficina} (modelo ${f.modelo})`
  return oficina
}

/**
 * La línea de debajo: el modelo y las dos fechas. «modelo 303 · domiciliado:
 * hasta el 15/10 · sin domiciliar, el 20/10». Sin domiciliación posible, una.
 */
export function lineaDeFila(f: FilaCalendario, nivel: Nivel): string {
  const partes: string[] = []
  if (nivel !== 'experto') partes.push(`modelo ${f.modelo}`)
  if (f.cadencia === 'instalments_202') partes.push(periodoEnPalabras(f.periodo))
  if (f.cadencia === 'annual') partes.push(`de ${f.ejercicio}`)
  const pres = diaMesCorto(f.presentacion)
  if (f.domiciliacion && f.domicilia) partes.push(`domiciliado: hasta el ${diaMesCorto(f.domiciliacion)} (sin domiciliar, el ${pres})`)
  else if (f.domiciliacion) partes.push(`hasta el ${pres} (domiciliado, el ${diaMesCorto(f.domiciliacion)})`)
  else partes.push(`hasta el ${pres}`)
  return partes.join(' · ')
}

const RESULTADO: Record<Resultado, string> = {
  to_pay: 'a pagar', to_refund: 'a devolver', to_offset: 'a compensar', zero: 'sale a cero', no_activity: 'sin actividad',
}
export const textoResultado = (r: Resultado | null): string => (r ? RESULTADO[r] : '')

// ── El estado y la acción de cada fila ─────────────────────────────────────

export type Accion = 'calcular' | 'revisar' | 'aviso' | 'presentar' | 'contabilizar' | 'pago' | 'ver' | null

export interface VistaFila {
  chip: { tono: TonoChip; texto: string } | null
  /** Una frase en vez del chip («Se calculará aquí pronto», «No hay que presentarlo: …»). */
  frase: string | null
  /** El aviso, en ámbar, debajo del chip. */
  aviso: string | null
  /** La fila entera en ámbar: tiene un aviso sin dar por bueno o se ha pasado de plazo. */
  ambar: boolean
  accion: Accion
  textoAccion: string | null
}

const ACCION: Record<Exclude<Accion, null>, string> = {
  calcular: 'Calcular', revisar: 'Revisar', aviso: 'Ver el aviso', presentar: 'Presentar', contabilizar: 'Contabilizar', pago: 'Casar el pago', ver: 'Ver',
}

export function vistaDeFila(f: FilaCalendario): VistaFila {
  const d = f.declaracion
  const fuera = f.atrasado && (!d || ['pending', 'draft', 'reviewed'].includes(d.estado))
  const pre = fuera ? 'Fuera de plazo · ' : ''
  const v = (chip: VistaFila['chip'], accion: Accion, extra: Partial<VistaFila> = {}): VistaFila => ({
    chip, frase: null, aviso: null, ambar: fuera, accion, textoAccion: accion ? ACCION[accion] : null, ...extra,
  })
  if (!d) {
    if (!f.se_calcula) return v(null, null, { frase: fuera ? 'Fuera de plazo · se calculará aquí pronto' : 'Se calculará aquí pronto' })
    return v({ tono: fuera ? 'falta' : 'neutro', texto: `${pre}Por calcular` }, 'calcular')
  }
  if (d.estado === 'not_required') return v(null, null, { frase: `No hay que presentarlo${d.no_hace_falta ? `: ${d.no_hace_falta}` : ''}`, ambar: false })
  if (d.estado === 'pending') return v({ tono: fuera ? 'falta' : 'neutro', texto: `${pre}Por calcular` }, 'calcular')
  if (d.estado === 'draft' || d.estado === 'reviewed') {
    const base = d.estado === 'draft' ? 'Borrador' : 'Revisado'
    // Sin resultado (sin el libro de IVA, o sin lo que quedaba de antes): no se pinta un cero (0240).
    if (d.errores > 0 && d.resultado === null) {
      return v({ tono: 'falta', texto: `${pre}No se puede calcular` }, 'aviso', { aviso: d.aviso, ambar: true })
    }
    if (d.errores > 0) {
      const t = `${d.errores} ${d.errores === 1 ? 'cosa' : 'cosas'} que Sumied no sabe`
      return v({ tono: 'falta', texto: `${pre}${base} · ${t}` }, 'revisar', { aviso: d.aviso, ambar: true })
    }
    if (d.avisos > 0) {
      return v({ tono: 'duda', texto: `${pre}${base} · ${d.avisos} ${d.avisos === 1 ? 'aviso' : 'avisos'}` }, 'aviso', { aviso: d.aviso, ambar: true })
    }
    const cuadra = d.cuadra ? ' · cuadra con los libros' : ''
    if (d.estado === 'draft') return v({ tono: fuera ? 'falta' : 'accion', texto: `${pre}Borrador${cuadra}` }, 'revisar')
    return v({ tono: fuera ? 'falta' : 'seguro', texto: `${pre}Revisado${cuadra}` }, 'presentar')
  }
  const fuera_ = d.por === 'outside' ? ' fuera' : ''
  if (d.estado === 'filed') return v({ tono: 'seguro', texto: `Presentado${fuera_}` }, 'contabilizar', { ambar: false })
  if (d.estado === 'booked') {
    return v({ tono: 'seguro', texto: `Presentado${fuera_} · contabilizado` }, d.resultado === 'to_pay' || d.resultado === 'to_refund' ? 'pago' : 'ver', { ambar: false })
  }
  const final: Record<string, string> = { paid: 'Pagado', refunded: 'Devuelto', offset: 'A compensar' }
  return v({ tono: 'seguro', texto: `${final[d.estado] ?? d.estado_texto} · contabilizado` }, 'ver', { ambar: false })
}

// ── Las tres cifras de arriba ───────────────────────────────────────────────

const PRESENTADA: readonly Estado[] = ['filed', 'booked', 'paid', 'offset', 'refunded']
const sinPresentar = (f: FilaCalendario) => !f.declaracion || (!PRESENTADA.includes(f.declaracion.estado) && f.declaracion.estado !== 'not_required')

/** Días de hoy a una fecha (las dos 'AAAA-MM-DD'). */
export function diasHasta(hoy: string, dia: string): number {
  return Math.round((Date.parse(`${dia}T00:00:00Z`) - Date.parse(`${hoy}T00:00:00Z`)) / 86_400_000)
}

export function cuandoEs(dias: number): string {
  if (dias < 0) return dias === -1 ? 'ayer' : `hace ${-dias} días`
  if (dias === 0) return 'hoy'
  if (dias === 1) return 'mañana'
  return `dentro de ${dias} días`
}

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`

export interface Cifra { etiqueta: string; valor: string; apoyo: string; tono: TonoTarjeta; texto?: boolean }

/** La primera: el plazo que toca, cuántos modelos y cómo están. */
export function cifraPlazo(c: Calendario): Cifra {
  const pend = c.filas.filter(sinPresentar)
  if (c.filas.length === 0) return { etiqueta: 'Este mes', valor: 'Nada que presentar', apoyo: 'no hay ningún plazo cerca', tono: 'ok', texto: true }
  if (pend.length === 0) return { etiqueta: 'Este mes', valor: 'Todo presentado', apoyo: plural(c.filas.length, 'modelo', 'modelos') + ' en plazo', tono: 'ok', texto: true }
  const domic = pend.filter((f) => f.domicilia && f.domiciliacion && f.domiciliacion >= c.hoy)
  const listos = pend.filter((f) => f.declaracion?.estado === 'reviewed').length
  const porRevisar = pend.filter((f) => f.se_calcula && f.declaracion?.estado !== 'reviewed').length
  const sinCalcular = pend.filter((f) => !f.se_calcula).length
  const estado = [listos ? `${listos} ${listos === 1 ? 'listo' : 'listos'}` : '', porRevisar ? `${porRevisar} por revisar` : '',
    sinCalcular ? `${sinCalcular} sin calcular aquí` : ''].filter(Boolean).join(', ')
  const atrasados = pend.filter((f) => f.atrasado).length
  if (domic.length > 0) {
    const fecha = domic.map((f) => f.domiciliacion!).sort()[0]
    const dias = diasHasta(c.hoy, fecha)
    const resto = pend.filter((f) => !domic.includes(f)).map((f) => f.presentacion).sort()[0]
    const sinDom = pend.filter((f) => f.domiciliacion).map((f) => f.presentacion).sort()[0]
    return {
      etiqueta: `Domiciliados: presentar hasta el ${diaMesCorto(fecha)} · ${cuandoEs(dias)}`,
      valor: plural(domic.length, 'modelo', 'modelos'),
      apoyo: [estado, sinDom ? `sin domiciliar, hasta el ${diaMesCorto(sinDom)}` : resto ? `los demás, hasta el ${diaMesCorto(resto)}` : ''].filter(Boolean).join(' · '),
      tono: dias <= 3 ? 'falta' : dias <= 7 ? 'duda' : 'normal',
    }
  }
  const fecha = pend.filter((f) => !f.atrasado).map((f) => f.presentacion).sort()[0]
  if (!fecha) {
    return { etiqueta: 'Se ha pasado el plazo', valor: plural(atrasados, 'modelo', 'modelos'), apoyo: estado, tono: 'falta' }
  }
  const dias = diasHasta(c.hoy, fecha)
  return {
    etiqueta: `Presentar hasta el ${diaMesCorto(fecha)} · ${cuandoEs(dias)}`,
    valor: plural(pend.length, 'modelo', 'modelos'),
    apoyo: [estado, atrasados ? `${atrasados} fuera de plazo` : ''].filter(Boolean).join(' · '),
    tono: atrasados || dias <= 3 ? 'falta' : dias <= 7 ? 'duda' : 'normal',
  }
}

/**
 * La segunda: lo que hay que pagar. Solo lo calculado aquí (respuesta 3 de
 * Julio): si hay modelos sin calcular, se dice, pero no se suma lo que no se sabe.
 */
export function cifraPago(c: Calendario): Cifra {
  const pend = c.filas.filter(sinPresentar)
  const aPagar = pend.filter((f) => f.declaracion?.resultado === 'to_pay' && f.declaracion.importe !== null)
  const sinCalcular = pend.filter((f) => !f.declaracion || f.declaracion.estado === 'pending').length
  const nota = sinCalcular ? ` · solo lo calculado aquí (${plural(sinCalcular, 'modelo sin calcular', 'modelos sin calcular')})` : ''
  const domic = aPagar.filter((f) => f.domicilia)
  if (domic.length > 0) {
    const suma = domic.reduce((s, f) => s + (f.declaracion!.importe ?? 0), 0)
    const dia = domic.map((f) => f.presentacion).sort()[0]
    const cuenta = domic.find((f) => f.cuenta_final)?.cuenta_final
    return { etiqueta: `Hacienda lo carga el ${diaMesCorto(dia)}`, valor: eurosExactos(suma),
      apoyo: `domiciliado${cuenta ? ` en la cuenta ···· ${cuenta}` : ''}${nota}`, tono: 'normal' }
  }
  if (aPagar.length === 0) {
    return { etiqueta: 'A pagar', valor: '—', apoyo: sinCalcular ? `aún no hay nada calculado${nota}` : 'nada que pagar este mes', tono: 'normal' }
  }
  const suma = aPagar.reduce((s, f) => s + (f.declaracion!.importe ?? 0), 0)
  const dia = aPagar.map((f) => f.presentacion).sort()[0]
  return { etiqueta: `A pagar hasta el ${diaMesCorto(dia)}`, valor: eurosExactos(suma), apoyo: `sin domiciliar: lo pagas tú${nota}`, tono: 'normal' }
}

/** La tercera: los presentados del año, desde que lleva aquí sus impuestos. */
export function cifraPresentados(c: Calendario): Cifra {
  const p = c.presentados
  const desde = p.desde ? `desde el ${diaMesCorto(p.desde)}, que llevas aquí tus impuestos` : 'aún no llevas aquí tus impuestos'
  if (p.vencidos === 0) return { etiqueta: `Presentados en ${p.ano}`, valor: 'Ninguno todavía', apoyo: desde, tono: 'normal', texto: true }
  const faltan = p.vencidos - p.presentados
  const fuera = p.presentados - p.en_plazo
  const sinCont = p.presentados - p.contabilizados
  const apoyo = faltan > 0 ? `${plural(faltan, 'sin presentar', 'sin presentar')} · ${desde}`
    : fuera === 0 && sinCont === 0 ? 'todos en plazo y contabilizados'
      : [fuera ? `${fuera} fuera de plazo` : '', sinCont ? `${plural(sinCont, 'sin contabilizar', 'sin contabilizar')}` : ''].filter(Boolean).join(' · ')
  return { etiqueta: `Presentados en ${p.ano}`, valor: `${p.presentados} de ${p.vencidos}`, apoyo, tono: faltan > 0 ? 'duda' : 'normal' }
}

// ── El título de la ventana y «Lo siguiente» ────────────────────────────────

/** «Octubre · 3.er trimestre»: el mes del plazo y el periodo de los trimestrales (o mensuales). */
export function tituloVentana(c: Calendario): string {
  if (!c.ventana) return 'Ningún plazo cerca'
  const mes = mayuscula(MESES[Number(c.ventana.slice(5, 7)) - 1])
  const delMes = c.filas.filter((f) => f.presentacion.slice(0, 7) === c.ventana!.slice(0, 7))
  const t = delMes.find((f) => f.cadencia === 'quarterly') ?? delMes.find((f) => f.cadencia === 'monthly')
  return t ? `${mes} · ${periodoEnPalabras(t.periodo)}` : mes
}

/** El mes de la ventana, para el botón: «los de octubre». */
export const mesDeVentana = (c: Calendario): string | null => (c.ventana ? MESES[Number(c.ventana.slice(5, 7)) - 1] : null)

export interface GrupoSiguiente { cuando: string; que: string; nota: string }

/** Lo siguiente, por meses: «hasta el 20/01 o el 30/01 · IVA del trimestre (303), Resumen anual del IVA (390)». */
export function loSiguiente(c: Calendario, nivel: Nivel, meses = 3): GrupoSiguiente[] {
  const porMes = new Map<string, Siguiente[]>()
  for (const s of c.siguiente) {
    const k = s.presentacion.slice(0, 7)
    if (!porMes.has(k)) { if (porMes.size >= meses) break; porMes.set(k, []) }
    porMes.get(k)!.push(s)
  }
  return [...porMes.values()].map((l) => {
    const fechas = [...new Set(l.map((s) => s.presentacion))].sort().map(diaMesCorto)
    const cuando = `hasta el ${fechas.length > 1 ? `${fechas.slice(0, -1).join(', el ')} o el ${fechas[fechas.length - 1]}` : fechas[0]}`
    const que = l.map((s) => nivel === 'experto' ? `${s.modelo} · ${s.periodo === '0A' ? s.ejercicio : s.periodo}`
      : `${nombreDeOficina(s.modelo, s.cadencia, s.nombre)} (${s.modelo})`).join(', ')
    const nota = l.every((s) => s.modelo !== '303') ? 'se calculará aquí pronto' : 'el IVA lo calcula Sumied con tus libros'
    return { cuando, que, nota }
  })
}
