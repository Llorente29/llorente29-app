// src/modules/conta/impuestos/declaracion.ts
//
// I01b · P2 · El IVA de un periodo (tablero 9, maqueta «Modelo303.png»).
// Núcleo puro: lo que dice cada parte de la pantalla a partir de
// conta_impuesto_declaracion_ver y de si la puerta de Hacienda está abierta.
// Se prueba sin React (tests/unit/modules/conta/i01b/declaracion.test.ts).
//
// Lo que manda (encargo, punto 3): mientras la puerta esté cerrada, el botón
// de presentar dice por qué no presenta todavía; no falla sin decir nada. Y lo
// mismo con cada cosa que lo impide: sin calcular, con algo que Sumied no sabe,
// con un aviso sin dar por bueno, sin certificado o sin permiso para usarlo.
// Y lo que no se sabe no se pinta como un cero (0240): sin el libro de IVA, o
// sin lo que quedaba por compensar de antes, «No se puede calcular todavía».

import type { Nivel } from '@/modules/conta/esqueleto/preferencias'
import { diaMesCorto, eurosExactos } from '@/modules/conta/lib/formato'
import { periodoEnPalabras, porQueNoSeCalcula, textoResultado, type Cadencia, type Estado, type Resultado } from './calendario'

export interface Comprobacion {
  id: string
  clave: string
  resultado: 'ok' | 'warning' | 'error'
  titulo: string
  detalle: Record<string, unknown>
  aceptada_por: string | null
  aceptada_el: string | null
  motivo: string | null
}

export interface DeclaracionVer {
  hoy: string
  ejercicio: number
  periodo: string
  desde: string
  hasta: string
  presenta_303: boolean
  cadencia: Cadencia | null
  presentacion: string | null
  domiciliacion: string | null
  provisional: string | null
  puede_gestionar: boolean
  declaracion: null | {
    id: string; estado: Estado; estado_texto: string; resultado: Resultado | null; importe: number | null
    pago: 'direct_debit' | 'nrc' | 'debt_recognition' | 'offset' | 'refund' | null; pago_cuenta: string | null; pago_cuenta_final: string | null
    calculada: string | null; revisada: string | null; revisada_por: string | null
    presentada: string | null; presentada_por: string | null; por: 'sumied' | 'outside' | null; quien_presenta: 'company' | 'advisor' | null
    csv: string | null; justificante: string | null; justificante_pdf: string | null
    liquidacion: string | null; pago_asiento: string | null; casado: string | null
  }
  casillas: { casilla: string; valor: number | null; texto: string | null; origen: 'calculated' | 'manual' | 'justificante'; motivo: string | null }[]
  comprobaciones: Comprobacion[]
  libros: Record<string, number>
  anterior: null | { ejercicio: number; periodo: string; estado: Estado; resultado: Resultado | null; importe: number | null; c27: number | null; c45: number | null }
  presentador: {
    modo: 'company' | 'advisor'
    consentida: boolean
    certificado: null | { id: string; nombre: string; caduca: string; estado: 'active' | 'expired' | 'removed'; probado: string | null; prueba: 'ok' | 'error' | null }
    puedo_presentar: boolean
  }
  bancos: { id: string; nombre: string; final: string }[]
  registro: { cuando: string; quien: string | null; que: string; a: string | null; mensaje: string | null; servicio: string | null; resultado: string | null }[]
}

/** Lo que dice la puerta de Hacienda (conta-hacienda, accion «puerta»). */
export interface Puerta { abierta: boolean; entorno: 'cerrada' | 'doble' | 'pruebas' | 'produccion' | 'desconocido'; mensaje: string }

const mayuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

// ── Títulos ─────────────────────────────────────────────────────────────────

/** «IVA del 3.er trimestre» (medio); con «(modelo 303)» sin experiencia; «303 · 3T 2026» en experto. */
export function tituloIva(d: Pick<DeclaracionVer, 'periodo' | 'ejercicio'>, nivel: Nivel): string {
  if (nivel === 'experto') return `303 · ${d.periodo} ${d.ejercicio}`
  const t = `IVA del ${periodoEnPalabras(d.periodo)}`
  return nivel === 'sin_experiencia' ? `${t} (modelo 303)` : t
}

/** Las migas: «3.er trimestre 2026». */
export const migaIva = (d: Pick<DeclaracionVer, 'periodo' | 'ejercicio'>): string => `${mayuscula(periodoEnPalabras(d.periodo))} ${d.ejercicio}`

/** Debajo del título: «modelo 303 · domiciliado: hasta el 15/10 (sin domiciliar, el 20/10)». */
export function lineaPlazos(d: DeclaracionVer): string {
  if (!d.presentacion) return 'modelo 303'
  const pres = diaMesCorto(d.presentacion)
  if (!d.domiciliacion) return `modelo 303 · hasta el ${pres}`
  const dom = diaMesCorto(d.domiciliacion)
  return d.declaracion?.pago === 'direct_debit'
    ? `modelo 303 · domiciliado: hasta el ${dom} (sin domiciliar, el ${pres})`
    : `modelo 303 · hasta el ${pres} (domiciliado, el ${dom})`
}

// ── Los pasos en fila ───────────────────────────────────────────────────────

export interface Paso { texto: string; estado: 'hecho' | 'ahora' | 'luego' }

const ORDEN: Record<Estado, number> = { pending: 0, draft: 1, reviewed: 2, filed: 3, booked: 4, paid: 5, offset: 5, refunded: 5, not_required: 0 }

/** Calculado · Revisado · Presentar · Contabilizar · Pagado, con lo hecho en verde y lo que toca marcado. */
export function pasos(d: DeclaracionVer): Paso[] {
  const r = d.declaracion
  // Sin resultado (falta el libro o lo de antes), «Calcular» no está hecho: es lo que toca.
  const n = !r ? 0 : r.resultado === null && (r.estado === 'draft' || r.estado === 'reviewed') ? 0 : ORDEN[r.estado]
  const quinto = !r || ['to_pay', 'to_refund', 'to_offset'].includes(r.resultado ?? '')
  const ultimo = r?.estado === 'offset' || r?.resultado === 'to_offset' ? ['A compensar', 'A compensar']
    : r?.resultado === 'to_refund' ? ['Devolver', 'Devuelto'] : ['Pagar', 'Pagado']
  const lista: [string, string, number][] = [
    ['Calcular', 'Calculado', 1], ['Revisar', 'Revisado', 2], ['Presentar', 'Presentado', 3], ['Contabilizar', 'Contabilizado', 4],
    ...(quinto ? [[ultimo[0], ultimo[1], 5] as [string, string, number]] : []),
  ]
  return lista.map(([hacer, hecho, k]) => ({
    texto: n >= k ? hecho : hacer,
    estado: n >= k ? 'hecho' : n + 1 === k ? 'ahora' : 'luego',
  }))
}

// ── El resultado y la comparación ───────────────────────────────────────────

/** El resultado con signo: a pagar en positivo; a devolver o a compensar, en negativo. */
export function conSigno(resultado: Resultado | null, importe: number | null): number | null {
  if (importe === null || resultado === null) return null
  return resultado === 'to_pay' ? importe : resultado === 'to_refund' || resultado === 'to_offset' ? -importe : 0
}

function variacion(ahora: number | null, antes: number | null): string | null {
  if (ahora === null || antes === null || antes === 0) return null
  const p = ((ahora - antes) / Math.abs(antes)) * 100
  if (Math.abs(p) < 2) return 'casi igual'
  return `ha ${p > 0 ? 'subido' : 'bajado'} un ${Math.round(Math.abs(p))} %`
}

/**
 * «2.º trimestre: 5.910,40 € · +449,60 € (+7,6 %), porque el IVA de tus ventas ha subido un 6 % y el de tus compras casi igual».
 * Sin periodo anterior calculado aquí, se dice.
 */
export function comparacion(d: DeclaracionVer): string {
  const a = d.anterior
  const r = d.declaracion
  if (!r || r.resultado === null) return ''
  if (!a || a.resultado === null) return 'Del periodo anterior no hay nada calculado aquí con que compararlo.'
  const ahora = conSigno(r.resultado, r.importe) ?? 0
  const antes = conSigno(a.resultado, a.importe) ?? 0
  const dif = ahora - antes
  const pct = antes !== 0 ? `${dif >= 0 ? '+' : '−'}${String(Math.abs(Math.round((dif / Math.abs(antes)) * 1000) / 10)).replace('.', ',')} %` : null
  const c27 = d.casillas.find((c) => c.casilla === '27')?.valor ?? null
  const c45 = d.casillas.find((c) => c.casilla === '45')?.valor ?? null
  const v = variacion(c27, a.c27)
  const c = variacion(c45, a.c45)
  const porque = v && c ? `, porque el IVA de tus ventas ${v === 'casi igual' ? 'está casi igual' : v} y el de tus compras ${c === 'casi igual' ? 'casi igual' : c}` : ''
  const texto = `${periodoEnPalabras(a.periodo)}${a.ejercicio !== d.ejercicio ? ` de ${a.ejercicio}` : ''}: ${eurosExactos(Math.abs(antes))} ${textoResultado(a.resultado)}`
  return `${mayuscula(texto)} · ${dif >= 0 ? '+' : '−'}${eurosExactos(Math.abs(dif))}${pct ? ` (${pct})` : ''}${porque}`
}

// ── De dónde sale ───────────────────────────────────────────────────────────

const v = (d: DeclaracionVer, k: string) => d.casillas.find((c) => c.casilla === k)?.valor ?? 0
const pct = (n: number) => `${String(n).replace('.', ',')} %`

export interface LineaOrigen { titulo: string; detalle: string; libro: 'expedidas' | 'recibidas' | null; apuntes: number | null; importe: number; fuerte?: boolean }

/** Las líneas de «De dónde sale»: lo cobrado, lo pagado, lo compensado de antes y el resultado. */
export function deDondeSale(d: DeclaracionVer): LineaOrigen[] {
  const r = d.declaracion
  if (!r || r.resultado === null) return []
  const tramos = ([['01', 4], ['04', 10], ['07', 21]] as const).filter(([k]) => v(d, k) !== 0)
    .map(([k, t]) => `${pct(t)}: base ${eurosExactos(v(d, k))}`)
  const corr = v(d, '29'), inv = v(d, '31')
  const recibidas = [corr ? `gastos corrientes ${eurosExactos(corr)}` : '', inv ? `inversiones ${eurosExactos(inv)}` : ''].filter(Boolean)
  const lineas: LineaOrigen[] = [
    { titulo: 'IVA que has cobrado en tus ventas', detalle: tramos.join(' · ') || 'sin ventas con IVA en el periodo', libro: 'expedidas', apuntes: d.libros.issued ?? 0, importe: v(d, '27') },
    { titulo: 'IVA que has pagado en tus compras y gastos', detalle: recibidas.join(' · ') || 'sin compras con IVA en el periodo', libro: 'recibidas',
      apuntes: (d.libros.received ?? 0) + (d.libros.investment ?? 0), importe: -v(d, '45') },
  ]
  if (v(d, '78') !== 0) lineas.push({ titulo: 'Lo que te quedaba por compensar de antes', detalle: `quedaban ${eurosExactos(v(d, '110'))}`, libro: null, apuntes: null, importe: -v(d, '78') })
  lineas.push({ titulo: mayuscula(textoResultado(r.resultado) || 'resultado'), detalle: '', libro: null, apuntes: null, importe: Math.abs(v(d, '71')), fuerte: true })
  return lineas
}

// ── Cuando no se puede calcular ─────────────────────────────────────────────

/** Las comprobaciones en rojo que importan (el formato del fichero no: se rehace al bajarlo). */
const enRojo = (d: DeclaracionVer) => d.comprobaciones.filter((c) => c.resultado === 'error' && c.clave !== 'file_layout')

/** ¿El libro de IVA del periodo está vacío con el diario lleno? (motivo «libro_vacio» de book_vs_303) */
export function libroVacio(d: DeclaracionVer): boolean {
  const k = d.comprobaciones.find((c) => c.clave === 'book_vs_303' && c.resultado === 'error')
  const no = k?.detalle?.no_sabe
  return Array.isArray(no) && no.some((x) => (x as { motivo?: string })?.motivo === 'libro_vacio')
}

/** La [110] se pide: no hay un 303 anterior presentado en Sumied y nadie la ha escrito. */
export const pideLa110 = (c: Comprobacion): boolean => c.clave === 'previous_offset' && c.resultado === 'error'

/**
 * Sin resultado, la pantalla no enseña un 0: dice «No se puede calcular todavía» y por qué,
 * con lo que hay que hacer. null si hay resultado.
 */
export function noSeCalcula(d: DeclaracionVer): { titulo: string; porque: string[] } | null {
  const r = d.declaracion
  if (!r || r.resultado !== null || !['draft', 'reviewed'].includes(r.estado)) return null
  // En corto: el porqué entero va justo debajo, en «Lo que ha comprobado Sumied» (en el móvil salía dos veces seguidas).
  const porque = enRojo(d).filter((c) => c.clave === 'book_vs_303' || c.clave === 'previous_offset').map((c) => porQueNoSeCalcula(c.titulo) ?? c.titulo)
  return { titulo: 'No se puede calcular todavía', porque: porque.length ? porque : ['Falta algo para calcularlo: mira «Lo que ha comprobado Sumied».'] }
}

/** Las casillas del justificante que pide «Ya lo presenté fuera» cuando Sumied no ha podido calcularlo. */
export const CASILLAS_JUSTIFICANTE = ['27', '45', '110', '78', '87', '71'] as const
export type CasillaJustificante = (typeof CASILLAS_JUSTIFICANTE)[number]

/** «Ya lo presenté fuera» necesita las casillas del justificante: hay algo en rojo. */
export const pideJustificante = (d: DeclaracionVer): boolean => enRojo(d).length > 0

const cent = (n: number) => Math.round(n * 100)

/**
 * Las casillas del justificante, antes de mandarlas: que están todas, que las
 * de compensar no son negativas y que cuadran como en el modelo
 * ([27] − [45] − [78] = [71]; [110] − [78] = [87]). null si están bien.
 */
export function cuadranCasillas(v: Partial<Record<CasillaJustificante, number | null>>): string | null {
  const faltan = CASILLAS_JUSTIFICANTE.filter((k) => v[k] === null || v[k] === undefined)
  if (faltan.length) return `Faltan ${faltan.map((k) => `[${k}]`).join(', ')}: están en el justificante (si una sale en blanco, escribe 0).`
  const x = v as Record<CasillaJustificante, number>
  const negativa = (['110', '78', '87'] as const).find((k) => x[k] < 0)
  if (negativa) return `La [${negativa}] no puede ser negativa: son cuotas a compensar.`
  if (cent(x['27']) - cent(x['45']) - cent(x['78']) !== cent(x['71'])) {
    return `No cuadran: [27] − [45] − [78] da ${eurosExactos(x['27'] - x['45'] - x['78'])}, y la [71] dice ${eurosExactos(x['71'])}. Mira el justificante otra vez.`
  }
  if (cent(x['110']) - cent(x['78']) !== cent(x['87'])) {
    return `No cuadran: [110] − [78] da ${eurosExactos(x['110'] - x['78'])}, y la [87] dice ${eurosExactos(x['87'])}. Mira el justificante otra vez.`
  }
  return null
}

// ── Lo que ha comprobado Sumied ─────────────────────────────────────────────

export interface VistaComprobacion { marca: '✓' | '!' | '✗'; texto: string; aceptada: string | null; sePuedeAceptar: boolean }

export function vistaComprobacion(c: Comprobacion): VistaComprobacion {
  const aceptada = c.aceptada_el ? `${c.aceptada_por ?? 'Alguien'} la dio por buena el ${diaMesCorto(c.aceptada_el)}${c.motivo ? `: ${c.motivo}` : ''}` : null
  return {
    marca: c.resultado === 'ok' ? '✓' : c.resultado === 'warning' ? '!' : '✗',
    texto: c.titulo,
    aceptada,
    sePuedeAceptar: c.resultado === 'warning' && !c.aceptada_el,
  }
}

// ── El panel «Presentar a Hacienda» ─────────────────────────────────────────

export interface Boton { activo: boolean; texto: string; porque: string | null }

/** El botón de presentar y, si no se puede, por qué (en una frase, con lo que hay que hacer). */
export function botonPresentar(d: DeclaracionVer, puerta: Puerta | null): Boton {
  const r = d.declaracion
  const importe = r?.resultado === 'to_pay' && r.importe ? ` ${eurosExactos(r.importe)}` : ''
  const texto = `Presentar${importe}`
  const no = (porque: string): Boton => ({ activo: false, texto, porque })
  if (!r || r.estado === 'pending') return no('Primero hay que calcularlo con tus libros.')
  if (['filed', 'booked', 'paid', 'offset', 'refunded'].includes(r.estado)) {
    return { activo: false, texto: r.por === 'outside' ? 'Presentado fuera' : 'Presentado', porque: null }
  }
  if (!d.puede_gestionar) return no('Solo un administrador o un encargado de la empresa, o su asesoría con su consentimiento, presenta sus impuestos.')
  if (libroVacio(d)) return no('Sin el libro de IVA del periodo, Sumied no lo calcula: tráelo a Libros y vuelve a calcular. Si ya lo presentó tu asesoría, apúntalo con «Ya lo presenté fuera» y las casillas del justificante.')
  if (d.comprobaciones.some(pideLa110)) return no('Falta lo que te quedaba por compensar de antes: escríbelo en la casilla [110], en «Lo que ha comprobado Sumied», aunque sea 0.')
  const errores = d.comprobaciones.filter((c) => c.resultado === 'error').length
  if (errores > 0) return no(`Tiene ${errores === 1 ? 'una cosa' : `${errores} cosas`} que Sumied todavía no sabe declarar: mírala abajo. Mientras, preséntalo fuera.`)
  const avisos = d.comprobaciones.filter((c) => c.resultado === 'warning' && !c.aceptada_el).length
  if (avisos > 0) return no(`Antes, mira ${avisos === 1 ? 'el aviso' : `los ${avisos} avisos`} de «Lo que ha comprobado Sumied» (en el Resumen) y dalos por buenos si lo están.`)
  const ce = d.presentador.certificado
  if (!ce || ce.estado === 'removed') return no('Aún no hay certificado para presentar: súbelo en Impuestos › Certificados.')
  if (ce.estado === 'expired' || ce.caduca <= d.hoy) return no(`El certificado caducó el ${diaMesCorto(ce.caduca)}: sube uno nuevo en Impuestos › Certificados.`)
  if (!d.presentador.puedo_presentar) return no('No tienes permiso para presentar con este certificado: pídeselo a quien lo subió.')
  if (!puerta) return no('Comprobando la conexión con Hacienda…')
  if (!puerta.abierta) return no(`${puerta.mensaje} Mientras, puedes descargar el fichero oficial, presentarlo tú en la sede de Hacienda y luego apuntarlo con «Ya lo presenté fuera».`)
  return { activo: true, texto, porque: puerta.entorno === 'doble' ? puerta.mensaje : null }
}

/** «Descargar el fichero oficial»: por qué no sale todavía (la base tampoco lo prepara), o null si sale. */
export function porQueNoFichero(d: DeclaracionVer): string | null {
  const r = d.declaracion
  if (!r || r.estado === 'pending') return 'El fichero oficial sale cuando esté calculado.'
  if (enRojo(d).length > 0 || r.resultado === null) return 'El fichero oficial sale cuando no quede nada en rojo en «Lo que ha comprobado Sumied».'
  const avisos = d.comprobaciones.filter((c) => c.resultado === 'warning' && !c.aceptada_el).length
  if (avisos > 0) return `El fichero oficial sale cuando des por ${avisos === 1 ? 'bueno el aviso' : `buenos los ${avisos} avisos`} de «Lo que ha comprobado Sumied».`
  return null
}

/** Lo que dice el botón de calcular (o volver a calcular) al acabar: con resultado, o por qué no lo hay. */
export function fraseCalculo(c: { apuntes: number; resultado: Resultado | null; importe: number | null; sabido?: boolean }, de = 'Calculado'): string {
  if (c.resultado === null || c.importe === null || c.sabido === false) {
    return `${de} con ${c.apuntes} apuntes del libro de IVA, pero todavía no se puede saber el resultado: mira por qué en «Lo que ha comprobado Sumied».`
  }
  return `${de} con ${c.apuntes} apuntes del libro de IVA: ${eurosExactos(c.importe)} ${textoResultado(c.resultado)}.`
}

/** La frase del pago, para el panel y para la confirmación. */
export function textoPago(d: DeclaracionVer): string {
  const r = d.declaracion
  if (!r || !r.resultado) return ''
  if (r.resultado === 'to_offset') return 'No hay que pagar: sale a compensar en los próximos trimestres.'
  if (r.resultado === 'zero' || r.resultado === 'no_activity') return 'No hay que pagar nada.'
  if (r.resultado === 'to_refund') {
    return r.pago === 'refund' && r.pago_cuenta_final ? `A devolver en la cuenta ···· ${r.pago_cuenta_final}.` : 'A devolver: elige en qué banco quieres que te lo devuelvan.'
  }
  if (r.pago === 'direct_debit' && r.pago_cuenta_final) {
    return `Domiciliado en la cuenta ···· ${r.pago_cuenta_final}. Hacienda lo carga el ${d.presentacion ? diaMesCorto(d.presentacion) : '—'} y Sumied lo casa con el banco.`
  }
  return `Sin domiciliar: lo pagas tú hasta el ${d.presentacion ? diaMesCorto(d.presentacion) : '—'}.`
}

/** ¿Todavía se puede domiciliar? */
export const sePuedeDomiciliar = (d: DeclaracionVer): boolean =>
  d.declaracion?.resultado === 'to_pay' && !!d.domiciliacion && d.hoy <= d.domiciliacion && ['draft', 'reviewed'].includes(d.declaracion.estado)

/** La confirmación antes de enviar: lo que se presenta, cómo se paga y que enviar supone aceptar los datos. */
export function textoConfirmar(d: DeclaracionVer): string {
  const r = d.declaracion
  if (!r) return ''
  const que = `${tituloIva(d, 'medio')} de ${d.ejercicio}`
  const res = r.resultado === 'to_pay' || r.resultado === 'to_refund' || r.resultado === 'to_offset'
    ? `${eurosExactos(r.importe ?? 0)} ${textoResultado(r.resultado)}` : textoResultado(r.resultado)
  return `Vas a presentar a Hacienda el ${que}: ${res}. ${textoPago(d)} Al enviarlo aceptas estos datos como tuyos.`
}

/** Después de presentar: qué queda por hacer en el panel. */
export function siguientePaso(d: DeclaracionVer): 'contabilizar' | 'casar' | 'nada' | null {
  const r = d.declaracion
  if (!r) return null
  if (r.estado === 'filed') return 'contabilizar'
  if (r.estado === 'booked' && (r.resultado === 'to_pay' || r.resultado === 'to_refund')) return 'casar'
  if (['booked', 'paid', 'offset', 'refunded'].includes(r.estado)) return 'nada'
  return null
}
