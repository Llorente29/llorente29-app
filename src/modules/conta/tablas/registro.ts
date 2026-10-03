// src/modules/conta/tablas/registro.ts
//
// El REGISTRO de las tablas generales (encargo C00 §4.3). La pantalla es una
// sola y genérica: una tabla nueva se añade con una entrada aquí (nombre,
// columnas que se ven, detalle, qué se puede editar), no con una pantalla
// nueva. Puro: ni React ni base de datos.
//
// Comunes a todas (lo pone la pantalla, no cada entrada): «Vigente» si la
// tabla tiene vigencias, «Dónde lo usas», «Origen» (De serie / Tuyo) y el
// enlace que abre el detalle en la misma fila.

import { cuentaPgc } from '@/modules/conta/lib/pgc'
import { formatearIban, normalizarIban, validarIban } from '@/modules/conta/lib/iban'
import { avisoPlazo } from '@/modules/conta/lib/morosidad'
import { porcentaje } from '@/modules/conta/lib/formato'

// ── Las filas, ya leídas ────────────────────────────────────────────────────

/** Lo que una empresa cambió de una fila de serie (general_row_setting). */
export interface AjusteSerie {
  hidden: boolean
  pgc_hint: string | null
  pgc_input_hint: string | null
  pgc_output_hint: string | null
}

export interface FilaGeneral {
  id: string
  /** La tabla de la base de la que sale (países y monedas son dos). */
  tablaBd: string
  /** Agrupa las vigencias de lo mismo: un cambio de % es otra fila con el mismo code. */
  code: string
  /** De Folvy, igual para todos (is_system). */
  serie: boolean
  datos: Record<string, unknown>
  validFrom: string | null
  validTo: string | null
  ajuste: AjusteSerie | null
}

/** Un concepto de la tabla: la fila que vale hoy (o la última) y sus otras vigencias. */
export interface Concepto {
  fila: FilaGeneral
  historial: FilaGeneral[]
}

// ── Lo que describe cada tabla ──────────────────────────────────────────────

export type ClaveTabla =
  | 'impuestos' | 'retenciones' | 'formas-de-pago' | 'plazos-de-pago' | 'numeracion'
  | 'bancos-y-cajas' | 'tipos-de-gasto' | 'textos-de-apuntes' | 'paises-y-monedas'

export type CuentaEditable = 'pgc_hint' | 'pgc_input_hint' | 'pgc_output_hint'

export interface Columna {
  id: string
  etiqueta: string
  valor: (f: FilaGeneral) => string
  /** Cifra: letra de cifras y alineada a la derecha. */
  cifra?: boolean
  /** Más apagada (texto de apoyo). */
  apoyo?: boolean
  /** Ancho en la rejilla de ordenador. */
  ancho: string
}

export interface DatoDetalle {
  etiqueta: string
  valor: (f: FilaGeneral) => string | null
}

export type TipoCampo = 'texto' | 'porcentaje' | 'fecha' | 'opciones' | 'listaDias' | 'listaDiasMes' | 'entero' | 'siNo' | 'iban' | 'opcionesBancos'

export interface CampoFormulario {
  clave: string
  etiqueta: string
  tipo: TipoCampo
  opciones?: { valor: string; texto: string }[]
  obligatorio?: boolean
  ayuda?: string
  porDefecto?: string
  /** En una fila con vigencias no se edita: un cambio es una fila nueva. */
  fijoAlEditar?: boolean
}

export type Valores = Record<string, string>
export type Tono = 1 | 2 | 3 | 4 | 5 | 6

export interface DefinicionTabla {
  id: ClaveTabla
  titulo: string
  /** «impuesto», «retención»… para «Buscar un impuesto» y «+ Añadir impuesto». */
  singular: string
  /** Cabecera de la primera columna. */
  columnaTitulo: string
  /** De dónde se lee. La primera es la que se escribe. */
  tablasBd: string[]
  /** table_key de general_row_setting (solo si tiene filas de serie). */
  claveAjuste: string | null
  conSerie: boolean
  conVigencia: boolean
  soloLectura: boolean
  /** Cada fila es de una empresa (bancos, series): no hay filas de serie. */
  deEmpresa: boolean
  inicial: (f: FilaGeneral) => string
  /** Color de la inicial; si no se dice, sale del texto (el mismo texto, el mismo color). */
  tono?: (f: FilaGeneral) => Tono | undefined
  tituloFila: (f: FilaGeneral) => string
  apoyoFila: (f: FilaGeneral) => string | null
  columnas: Columna[]
  detalle: DatoDetalle[]
  /** De una fila de serie, la empresa puede cambiar estas cuentas (y ocultarla). */
  cuentasEditables: { clave: CuentaEditable; etiqueta: string }[]
  formulario: CampoFormulario[]
  /** Comprueba lo escrito; devuelve los fallos por campo. */
  validar: (v: Valores) => Record<string, string>
  /** Avisos que NO impiden guardar (se enseñan mientras se escribe). */
  avisos?: (v: Valores) => Record<string, string>
  /** Lo escrito → columnas de la base (sin cuenta, empresa ni is_system). */
  aBase: (v: Valores) => Record<string, unknown>
  /** Una fila → lo que se escribe en el formulario al editarla. */
  aValores: (f: FilaGeneral) => Valores
  /** Texto donde busca el buscador. */
  buscable: (f: FilaGeneral) => string
  /** Nota del detalle de una fila de serie. */
  notaSerie?: string
  /** Por qué está vacía, si lo está. */
  vacia: string
}

// ── Ayudas ─────────────────────────────────────────────────────────────────

const txt = (v: unknown): string => (v === null || v === undefined ? '' : String(v))
const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v))
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const d = (f: FilaGeneral, c: string) => f.datos[c]

/** «Hostelería, alimentos» en vez de «» si no hay nada. */
const oNada = (s: string): string | null => (s.trim() === '' ? null : s)

/** La cuenta que vale para esta empresa: la suya si la cambió, si no la de serie. */
export function cuentaDe(f: FilaGeneral, c: CuentaEditable): string | null {
  const propia = f.ajuste?.[c]
  return oNada(txt(propia ?? d(f, c)))
}

const cuentaTexto = (f: FilaGeneral, c: CuentaEditable): string | null => {
  const v = cuentaDe(f, c)
  return v ? cuentaPgc(v) : null
}

/** «30» → [30]; «30, 60 y 90» → [30, 60, 90]. null si hay algo que no es un número entero. */
export function leerListaEnteros(s: string): number[] | null {
  const partes = s.split(/[\s,;y]+/).filter(Boolean)
  if (partes.length === 0) return []
  const ns = partes.map((p) => (/^\d+$/.test(p) ? Number(p) : NaN))
  return ns.some(Number.isNaN) ? null : ns
}

/** «21», «5,2», «9.5» → número. null si no lo es o no está entre 0 y 100. */
export function leerPorcentaje(s: string): number | null {
  const t = s.trim().replace(',', '.').replace(/\s*%$/, '')
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) return null
  const n = Number(t)
  return n >= 0 && n <= 100 ? n : null
}

const esFecha = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s))

function exigir(v: Valores, campos: CampoFormulario[]): Record<string, string> {
  const fallos: Record<string, string> = {}
  for (const c of campos) {
    if (c.obligatorio && (v[c.clave] ?? '').trim() === '') fallos[c.clave] = `Falta «${c.etiqueta.toLowerCase()}».`
  }
  return fallos
}

function comprobarPorcentaje(v: Valores, clave: string, fallos: Record<string, string>, obligatorio: boolean) {
  const s = (v[clave] ?? '').trim()
  if (s === '') { if (obligatorio) fallos[clave] ??= 'Falta el porcentaje.'; return }
  if (leerPorcentaje(s) === null) fallos[clave] = 'Escribe un porcentaje entre 0 y 100, con dos decimales como mucho (por ejemplo 21 o 5,2).'
}

function comprobarFecha(v: Valores, clave: string, fallos: Record<string, string>) {
  const s = (v[clave] ?? '').trim()
  if (s !== '' && !esFecha(s)) fallos[clave] = 'Esa fecha no es válida.'
}

const cuentaValida = (s: string) => s.trim() === '' || /^\d{3,12}$/.test(s.trim())
function comprobarCuentas(v: Valores, claves: string[], fallos: Record<string, string>) {
  for (const c of claves) if (!cuentaValida(v[c] ?? '')) fallos[c] = 'Una cuenta son solo números, de 3 a 12 cifras (por ejemplo 472).'
}

const nulo = (s: string | undefined): string | null => (s === undefined || s.trim() === '' ? null : s.trim())
const siNo = (s: string | undefined): boolean => s === 'si'

// ── Textos que se ven ───────────────────────────────────────────────────────

export const SISTEMA_IMPUESTO: Record<string, string> = { iva: 'IVA', igic: 'IGIC', ipsi: 'IPSI' }
export const TERRITORIO: Record<string, string> = {
  peninsula_baleares: 'Península y Baleares', canarias: 'Canarias', ceuta_melilla: 'Ceuta y Melilla',
}
export const TRATAMIENTO: Record<string, string> = {
  taxed: 'Con impuesto', exempt: 'Exento', intra_eu: 'Compra en otro país de la UE',
  reverse_charge: 'Lo declaras tú (inversión del sujeto pasivo)', not_subject: 'No sujeto',
}
export const FORMA_PAGO: Record<string, string> = {
  transfer: 'Transferencia', direct_debit: 'Domiciliación', card: 'Tarjeta', cash: 'Efectivo', other: 'Otra',
}
export const DOCUMENTO: Record<string, string> = {
  invoice: 'Factura', simplified: 'Factura simplificada (ticket)', rectifying: 'Factura rectificativa',
  rectifying_simplified: 'Rectificativa de una simplificada',
}
export const CAJA: Record<string, string> = { bank: 'Cuenta del banco', card: 'Tarjeta', cash: 'Caja (efectivo)' }
export const PARA_QUE: Record<string, string> = {
  purchase_invoice: 'Facturas que recibes', sales_invoice: 'Facturas que emites', payment: 'Pagos',
  collection: 'Cobros', other: 'Otros',
}
export const GASTO_O_INGRESO: Record<string, string> = { expense: 'Gasto', income: 'Ingreso' }

const opciones = (m: Record<string, string>) => Object.entries(m).map(([valor, texto]) => ({ valor, texto }))

const modelos = (f: FilaGeneral): string | null => {
  const ms = lista(d(f, 'declared_in')).map(String)
  return ms.length ? ms.map((m) => `Modelo ${m}`).join(' y ') : null
}

/** «30 días», «30, 60 y 90 días», «Al contado». */
export function textoPlazo(dias: number[], fijos: number[]): string {
  const base = dias.length === 0 || (dias.length === 1 && dias[0] === 0)
    ? 'Al contado'
    : `${dias.length === 1 ? dias[0] : `${dias.slice(0, -1).join(', ')} y ${dias[dias.length - 1]}`} días`
  if (fijos.length === 0) return base
  const f = fijos.length === 1 ? `el ${fijos[0]}` : `los días ${fijos.slice(0, -1).join(', ')} y ${fijos[fijos.length - 1]}`
  return `${base}, pago ${f} de cada mes`
}

// ── Las nueve ───────────────────────────────────────────────────────────────

const IMPUESTOS: DefinicionTabla = {
  id: 'impuestos', titulo: 'Impuestos', singular: 'impuesto', columnaTitulo: 'Impuesto',
  tablasBd: ['tax_rate'], claveAjuste: 'tax_rate', conSerie: true, conVigencia: true, soloLectura: false, deEmpresa: false,
  inicial: (f) => (f.datos.treatment === 'intra_eu' ? 'UE' : String(Number(d(f, 'rate'))).replace('.', ',')),
  // Los de la maqueta: 21 azul, 10 verde, 4 naranja, 0 gris, UE lila.
  tono: (f) => (f.datos.treatment === 'intra_eu' ? 4 : ({ 21: 1, 10: 2, 4: 3, 0: 6 } as Record<number, Tono>)[Number(d(f, 'rate'))]),
  tituloFila: (f) => txt(d(f, 'name')),
  apoyoFila: (f) => oNada(txt(d(f, 'example'))),
  columnas: [
    { id: 'rate', etiqueta: '%', cifra: true, ancho: '70px', valor: (f) => porcentaje(Number(d(f, 'rate'))) },
    { id: 'surcharge', etiqueta: 'Recargo', cifra: true, apoyo: true, ancho: '80px',
      valor: (f) => (num(d(f, 'surcharge_rate')) === null ? '—' : porcentaje(Number(d(f, 'surcharge_rate')))) },
  ],
  detalle: [
    { etiqueta: 'Qué es', valor: (f) => `${SISTEMA_IMPUESTO[txt(d(f, 'tax_system'))] ?? ''} · ${TRATAMIENTO[txt(d(f, 'treatment'))] ?? ''}` },
    { etiqueta: 'Dónde vale', valor: (f) => TERRITORIO[txt(d(f, 'territory'))] ?? null },
    { etiqueta: 'IVA que pagas', valor: (f) => cuentaTexto(f, 'pgc_input_hint') },
    { etiqueta: 'IVA que cobras', valor: (f) => cuentaTexto(f, 'pgc_output_hint') },
    { etiqueta: 'Se declara en', valor: modelos },
  ],
  cuentasEditables: [
    { clave: 'pgc_input_hint', etiqueta: 'Cuenta del IVA que pagas' },
    { clave: 'pgc_output_hint', etiqueta: 'Cuenta del IVA que cobras' },
  ],
  formulario: [
    { clave: 'name', etiqueta: 'Nombre', tipo: 'texto', obligatorio: true },
    { clave: 'example', etiqueta: 'Para qué es', tipo: 'texto', ayuda: 'Una frase para reconocerlo: «Lo que cobra el gestor».' },
    { clave: 'tax_system', etiqueta: 'Impuesto', tipo: 'opciones', opciones: opciones(SISTEMA_IMPUESTO), obligatorio: true, porDefecto: 'iva', fijoAlEditar: true },
    { clave: 'territory', etiqueta: 'Dónde vale', tipo: 'opciones', opciones: opciones(TERRITORIO), obligatorio: true, porDefecto: 'peninsula_baleares', fijoAlEditar: true },
    { clave: 'treatment', etiqueta: 'Cómo se aplica', tipo: 'opciones', opciones: opciones(TRATAMIENTO), obligatorio: true, porDefecto: 'taxed', fijoAlEditar: true },
    { clave: 'rate', etiqueta: 'Porcentaje', tipo: 'porcentaje', obligatorio: true, fijoAlEditar: true },
    { clave: 'surcharge_rate', etiqueta: 'Recargo de equivalencia', tipo: 'porcentaje', fijoAlEditar: true },
    { clave: 'valid_from', etiqueta: 'Vale desde', tipo: 'fecha', obligatorio: true, fijoAlEditar: true },
    { clave: 'pgc_input_hint', etiqueta: 'Cuenta del IVA que pagas', tipo: 'texto', porDefecto: '472' },
    { clave: 'pgc_output_hint', etiqueta: 'Cuenta del IVA que cobras', tipo: 'texto', porDefecto: '477' },
  ],
  validar: (v) => {
    const fallos = exigir(v, IMPUESTOS.formulario)
    comprobarPorcentaje(v, 'rate', fallos, true)
    comprobarPorcentaje(v, 'surcharge_rate', fallos, false)
    comprobarFecha(v, 'valid_from', fallos)
    comprobarCuentas(v, ['pgc_input_hint', 'pgc_output_hint'], fallos)
    return fallos
  },
  aBase: (v) => ({
    name: v.name.trim(), example: nulo(v.example), tax_system: v.tax_system, territory: v.territory, treatment: v.treatment,
    rate: leerPorcentaje(v.rate), surcharge_rate: nulo(v.surcharge_rate) === null ? null : leerPorcentaje(v.surcharge_rate),
    valid_from: v.valid_from, pgc_input_hint: nulo(v.pgc_input_hint), pgc_output_hint: nulo(v.pgc_output_hint),
  }),
  aValores: (f) => ({
    name: txt(d(f, 'name')), example: txt(d(f, 'example')), tax_system: txt(d(f, 'tax_system')), territory: txt(d(f, 'territory')),
    treatment: txt(d(f, 'treatment')), rate: txt(d(f, 'rate')).replace('.', ','), surcharge_rate: txt(d(f, 'surcharge_rate')).replace('.', ','),
    valid_from: txt(d(f, 'valid_from')), pgc_input_hint: txt(d(f, 'pgc_input_hint')), pgc_output_hint: txt(d(f, 'pgc_output_hint')),
  }),
  buscable: (f) => `${txt(d(f, 'name'))} ${txt(d(f, 'example'))} ${txt(d(f, 'rate'))} ${SISTEMA_IMPUESTO[txt(d(f, 'tax_system'))] ?? ''}`,
  notaSerie: 'Si cambia la ley, Folvy lo actualiza y te avisa. Puedes cambiar sus cuentas, no su porcentaje.',
  vacia: 'Todavía no hay impuestos cargados.',
}

const RETENCIONES: DefinicionTabla = {
  id: 'retenciones', titulo: 'Retenciones', singular: 'retención', columnaTitulo: 'Retención',
  tablasBd: ['withholding_rate'], claveAjuste: 'withholding_rate', conSerie: true, conVigencia: true, soloLectura: false, deEmpresa: false,
  inicial: (f) => String(Number(d(f, 'rate'))).replace('.', ','),
  tituloFila: (f) => txt(d(f, 'name')),
  apoyoFila: (f) => oNada(txt(d(f, 'example'))),
  columnas: [
    { id: 'rate', etiqueta: '%', cifra: true, ancho: '70px', valor: (f) => porcentaje(Number(d(f, 'rate'))) },
    { id: 'filed_in', etiqueta: 'Modelo', cifra: true, apoyo: true, ancho: '80px', valor: (f) => txt(d(f, 'filed_in')) },
  ],
  detalle: [
    { etiqueta: 'Se ingresa en', valor: (f) => `Modelo ${txt(d(f, 'filed_in'))}` },
    { etiqueta: 'Clave del resumen anual', valor: (f) => {
      const k = oNada(txt(d(f, 'model_190_key')))
      return k ? `${k}${d(f, 'model_190_subkey') ? `.${txt(d(f, 'model_190_subkey'))}` : ''}` : null
    } },
    { etiqueta: 'Cuenta', valor: (f) => cuentaTexto(f, 'pgc_hint') },
  ],
  cuentasEditables: [{ clave: 'pgc_hint', etiqueta: 'Cuenta de la retención' }],
  formulario: [
    { clave: 'name', etiqueta: 'Nombre', tipo: 'texto', obligatorio: true },
    { clave: 'example', etiqueta: 'Para qué es', tipo: 'texto' },
    { clave: 'rate', etiqueta: 'Porcentaje', tipo: 'porcentaje', obligatorio: true, fijoAlEditar: true },
    { clave: 'filed_in', etiqueta: 'Se ingresa en', tipo: 'opciones', obligatorio: true, porDefecto: '111', fijoAlEditar: true,
      opciones: [{ valor: '111', texto: 'Modelo 111' }, { valor: '115', texto: 'Modelo 115' }, { valor: '123', texto: 'Modelo 123' }] },
    { clave: 'valid_from', etiqueta: 'Vale desde', tipo: 'fecha', obligatorio: true, fijoAlEditar: true },
    { clave: 'model_190_key', etiqueta: 'Clave del resumen anual', tipo: 'texto', ayuda: 'La letra del modelo 190, si la sabes (por ejemplo G).' },
    { clave: 'model_190_subkey', etiqueta: 'Subclave', tipo: 'texto' },
    { clave: 'pgc_hint', etiqueta: 'Cuenta', tipo: 'texto', porDefecto: '4751' },
  ],
  validar: (v) => {
    const fallos = exigir(v, RETENCIONES.formulario)
    comprobarPorcentaje(v, 'rate', fallos, true)
    comprobarFecha(v, 'valid_from', fallos)
    comprobarCuentas(v, ['pgc_hint'], fallos)
    return fallos
  },
  aBase: (v) => ({
    name: v.name.trim(), example: nulo(v.example), rate: leerPorcentaje(v.rate), filed_in: v.filed_in, valid_from: v.valid_from,
    model_190_key: nulo(v.model_190_key), model_190_subkey: nulo(v.model_190_subkey), pgc_hint: nulo(v.pgc_hint),
  }),
  aValores: (f) => ({
    name: txt(d(f, 'name')), example: txt(d(f, 'example')), rate: txt(d(f, 'rate')).replace('.', ','), filed_in: txt(d(f, 'filed_in')),
    valid_from: txt(d(f, 'valid_from')), model_190_key: txt(d(f, 'model_190_key')), model_190_subkey: txt(d(f, 'model_190_subkey')),
    pgc_hint: txt(d(f, 'pgc_hint')),
  }),
  buscable: (f) => `${txt(d(f, 'name'))} ${txt(d(f, 'example'))} ${txt(d(f, 'rate'))} ${txt(d(f, 'filed_in'))}`,
  notaSerie: 'Si cambia la ley, Folvy lo actualiza y te avisa. Puedes cambiar su cuenta, no su porcentaje.',
  vacia: 'Todavía no hay retenciones cargadas.',
}

const FORMAS_PAGO: DefinicionTabla = {
  id: 'formas-de-pago', titulo: 'Formas de pago', singular: 'forma de pago', columnaTitulo: 'Forma de pago',
  tablasBd: ['payment_method'], claveAjuste: 'payment_method', conSerie: true, conVigencia: false, soloLectura: false, deEmpresa: false,
  inicial: (f) => txt(d(f, 'name')).slice(0, 1).toUpperCase(),
  tituloFila: (f) => txt(d(f, 'name')),
  apoyoFila: (f) => oNada(txt(d(f, 'example'))),
  columnas: [
    { id: 'kind', etiqueta: 'Tipo', apoyo: true, ancho: '130px', valor: (f) => FORMA_PAGO[txt(d(f, 'kind'))] ?? '' },
  ],
  detalle: [
    { etiqueta: 'Tipo', valor: (f) => FORMA_PAGO[txt(d(f, 'kind'))] ?? null },
    { etiqueta: 'Banco o caja', valor: (f) => oNada(txt(f.datos._banco)) },
  ],
  cuentasEditables: [],
  formulario: [
    { clave: 'name', etiqueta: 'Nombre', tipo: 'texto', obligatorio: true },
    { clave: 'example', etiqueta: 'Para qué es', tipo: 'texto' },
    { clave: 'kind', etiqueta: 'Tipo', tipo: 'opciones', opciones: opciones(FORMA_PAGO), obligatorio: true, porDefecto: 'transfer' },
    { clave: 'treasury_account_id', etiqueta: 'Banco o caja', tipo: 'opcionesBancos', ayuda: 'De dónde sale el dinero.' },
  ],
  validar: (v) => exigir(v, FORMAS_PAGO.formulario),
  aBase: (v) => ({ name: v.name.trim(), example: nulo(v.example), kind: v.kind, treasury_account_id: nulo(v.treasury_account_id) }),
  aValores: (f) => ({ name: txt(d(f, 'name')), example: txt(d(f, 'example')), kind: txt(d(f, 'kind')), treasury_account_id: txt(d(f, 'treasury_account_id')) }),
  buscable: (f) => `${txt(d(f, 'name'))} ${txt(d(f, 'example'))} ${FORMA_PAGO[txt(d(f, 'kind'))] ?? ''}`,
  notaSerie: 'Es de serie: no se borra, pero puedes ocultarla para que no salga en tus desplegables.',
  vacia: 'Todavía no hay formas de pago cargadas.',
}

const PLAZOS: DefinicionTabla = {
  id: 'plazos-de-pago', titulo: 'Plazos de pago', singular: 'plazo de pago', columnaTitulo: 'Plazo',
  tablasBd: ['payment_term'], claveAjuste: 'payment_term', conSerie: true, conVigencia: false, soloLectura: false, deEmpresa: false,
  inicial: (f) => { const ds = lista(d(f, 'days')).map(Number); return ds.length === 1 && ds[0] === 0 ? '0' : String(ds[0] ?? '') },
  tituloFila: (f) => txt(d(f, 'name')),
  apoyoFila: (f) => oNada(txt(d(f, 'example'))) ?? textoPlazo(lista(d(f, 'days')).map(Number), lista(d(f, 'fixed_days')).map(Number)),
  columnas: [
    { id: 'days', etiqueta: 'Días', cifra: true, ancho: '120px', valor: (f) => lista(d(f, 'days')).map(Number).join(' / ') },
  ],
  detalle: [
    { etiqueta: 'Vence', valor: (f) => textoPlazo(lista(d(f, 'days')).map(Number), lista(d(f, 'fixed_days')).map(Number)) },
    { etiqueta: 'Varios vencimientos', valor: (f) => (lista(d(f, 'days')).length > 1 ? 'Se definen aquí; el reparto en pagos llega con Pagos y cobros' : null) },
    { etiqueta: 'Ley de morosidad', valor: (f) => avisoPlazo(lista(d(f, 'days')).map(Number)) },
  ],
  cuentasEditables: [],
  formulario: [
    { clave: 'name', etiqueta: 'Nombre', tipo: 'texto', obligatorio: true },
    { clave: 'example', etiqueta: 'Para qué es', tipo: 'texto' },
    { clave: 'days', etiqueta: 'Días desde la factura', tipo: 'listaDias', obligatorio: true, porDefecto: '30',
      ayuda: 'Uno o varios, separados por comas: «30» o «30, 60». 0 es al contado.' },
    { clave: 'fixed_days', etiqueta: 'Días fijos de pago del mes', tipo: 'listaDiasMes', ayuda: 'Si pagas solo ciertos días: «5, 20».' },
  ],
  validar: (v) => {
    const fallos = exigir(v, PLAZOS.formulario)
    const dias = leerListaEnteros(v.days ?? '')
    if (dias === null || (v.days ?? '').trim() !== '' && dias.some((n) => n > 365)) fallos.days = 'Escribe días enteros entre 0 y 365, separados por comas.'
    const fijos = leerListaEnteros(v.fixed_days ?? '')
    if (fijos === null || fijos.some((n) => n < 1 || n > 31)) fallos.fixed_days = 'Los días del mes van del 1 al 31.'
    return fallos
  },
  // Ley 3/2004, art. 4.3: más de 60 días se puede guardar, pero se avisa (respuesta 2 de Julio).
  avisos: (v): Record<string, string> => {
    const a = avisoPlazo(leerListaEnteros(v.days ?? '') ?? [])
    return a ? { days: a } : {}
  },
  aBase: (v) => ({ name: v.name.trim(), example: nulo(v.example), days: leerListaEnteros(v.days) ?? [0], fixed_days: leerListaEnteros(v.fixed_days ?? '') ?? [] }),
  aValores: (f) => ({ name: txt(d(f, 'name')), example: txt(d(f, 'example')), days: lista(d(f, 'days')).join(', '), fixed_days: lista(d(f, 'fixed_days')).join(', ') }),
  buscable: (f) => `${txt(d(f, 'name'))} ${txt(d(f, 'example'))} ${lista(d(f, 'days')).join(' ')}`,
  notaSerie: 'Es de serie: no se borra, pero puedes ocultarlo para que no salga en tus desplegables.',
  vacia: 'Aún no hay plazos de serie: se cargan cuando esté comprobada su norma. Puedes añadir los tuyos.',
}

const NUMERACION: DefinicionTabla = {
  id: 'numeracion', titulo: 'Numeración de facturas', singular: 'serie', columnaTitulo: 'Serie',
  tablasBd: ['invoice_series'], claveAjuste: null, conSerie: false, conVigencia: false, soloLectura: false, deEmpresa: true,
  inicial: (f) => txt(d(f, 'code')).slice(0, 3),
  tituloFila: (f) => txt(d(f, 'name')),
  apoyoFila: (f) => DOCUMENTO[txt(d(f, 'doc_type'))] ?? null,
  columnas: [
    { id: 'ejemplo', etiqueta: 'Así sale', cifra: true, ancho: '150px',
      valor: (f) => `${txt(d(f, 'code'))}-${String(d(f, 'starts_at') ?? 1).padStart(Number(d(f, 'digits') ?? 6), '0')}` },
  ],
  detalle: [
    { etiqueta: 'Documento', valor: (f) => DOCUMENTO[txt(d(f, 'doc_type'))] ?? null },
    { etiqueta: 'Cifras del número', valor: (f) => txt(d(f, 'digits')) },
    { etiqueta: 'Empieza en', valor: (f) => txt(d(f, 'starts_at')) },
    { etiqueta: 'Vuelve a 1 cada año', valor: (f) => (d(f, 'reset_yearly') ? 'Sí' : 'No') },
    { etiqueta: 'La que se usa si no eliges', valor: (f) => (d(f, 'is_default') ? 'Sí' : 'No') },
  ],
  cuentasEditables: [],
  formulario: [
    { clave: 'code', etiqueta: 'Prefijo', tipo: 'texto', obligatorio: true, ayuda: 'Letras y números en mayúscula: «F», «T», «R2026».' },
    { clave: 'name', etiqueta: 'Nombre', tipo: 'texto', obligatorio: true },
    { clave: 'doc_type', etiqueta: 'Documento', tipo: 'opciones', opciones: opciones(DOCUMENTO), obligatorio: true, porDefecto: 'invoice' },
    { clave: 'digits', etiqueta: 'Cifras del número', tipo: 'entero', obligatorio: true, porDefecto: '6' },
    { clave: 'starts_at', etiqueta: 'Empieza en', tipo: 'entero', obligatorio: true, porDefecto: '1' },
    { clave: 'reset_yearly', etiqueta: 'Vuelve a 1 cada año', tipo: 'siNo', porDefecto: 'si' },
    { clave: 'is_default', etiqueta: 'Es la que se usa si no eliges', tipo: 'siNo', porDefecto: 'no' },
  ],
  validar: (v) => {
    const fallos = exigir(v, NUMERACION.formulario)
    if ((v.code ?? '') !== '' && !/^[A-Z0-9][A-Z0-9-]{0,9}$/.test(v.code.trim().toUpperCase())) fallos.code = 'Hasta 10 letras, números o guiones, empezando por letra o número.'
    const dig = Number(v.digits)
    if (!Number.isInteger(dig) || dig < 1 || dig > 12) fallos.digits = 'Entre 1 y 12 cifras.'
    const ini = Number(v.starts_at)
    if (!Number.isInteger(ini) || ini < 1) fallos.starts_at = 'Un número entero, de 1 en adelante.'
    return fallos
  },
  aBase: (v) => ({
    code: v.code.trim().toUpperCase(), name: v.name.trim(), doc_type: v.doc_type, digits: Number(v.digits),
    starts_at: Number(v.starts_at), reset_yearly: siNo(v.reset_yearly), is_default: siNo(v.is_default),
  }),
  aValores: (f) => ({
    code: txt(d(f, 'code')), name: txt(d(f, 'name')), doc_type: txt(d(f, 'doc_type')), digits: txt(d(f, 'digits')),
    starts_at: txt(d(f, 'starts_at')), reset_yearly: d(f, 'reset_yearly') ? 'si' : 'no', is_default: d(f, 'is_default') ? 'si' : 'no',
  }),
  buscable: (f) => `${txt(d(f, 'code'))} ${txt(d(f, 'name'))} ${DOCUMENTO[txt(d(f, 'doc_type'))] ?? ''}`,
  vacia: 'Aún no tienes series. La numeración se usará cuando emitas facturas desde Folvy.',
}

const BANCOS: DefinicionTabla = {
  id: 'bancos-y-cajas', titulo: 'Bancos y cajas', singular: 'banco o caja', columnaTitulo: 'Cuenta',
  tablasBd: ['treasury_account'], claveAjuste: null, conSerie: false, conVigencia: false, soloLectura: false, deEmpresa: true,
  inicial: (f) => (f.datos.kind === 'cash' ? '€' : txt(d(f, 'name')).slice(0, 1).toUpperCase()),
  tituloFila: (f) => txt(d(f, 'name')),
  apoyoFila: (f) => CAJA[txt(d(f, 'kind'))] ?? null,
  columnas: [
    { id: 'iban', etiqueta: 'IBAN', cifra: true, apoyo: true, ancho: '260px', valor: (f) => (d(f, 'iban') ? formatearIban(txt(d(f, 'iban'))) : '—') },
  ],
  detalle: [
    { etiqueta: 'Tipo', valor: (f) => CAJA[txt(d(f, 'kind'))] ?? null },
    { etiqueta: 'IBAN', valor: (f) => (d(f, 'iban') ? formatearIban(txt(d(f, 'iban'))) : null) },
    { etiqueta: 'BIC', valor: (f) => oNada(txt(d(f, 'bic'))) },
    { etiqueta: 'Cuenta', valor: (f) => cuentaTexto(f, 'pgc_hint') },
    { etiqueta: 'La que se usa si no eliges', valor: (f) => (d(f, 'is_default') ? 'Sí' : 'No') },
  ],
  cuentasEditables: [],
  formulario: [
    { clave: 'kind', etiqueta: 'Qué es', tipo: 'opciones', opciones: opciones(CAJA), obligatorio: true, porDefecto: 'bank' },
    { clave: 'name', etiqueta: 'Nombre', tipo: 'texto', obligatorio: true, ayuda: '«Cuenta del Santander», «Caja del local».' },
    { clave: 'iban', etiqueta: 'IBAN', tipo: 'iban', ayuda: 'Obligatorio si es una cuenta del banco.' },
    { clave: 'bic', etiqueta: 'BIC', tipo: 'texto' },
    { clave: 'pgc_hint', etiqueta: 'Cuenta', tipo: 'texto', porDefecto: '572' },
    { clave: 'is_default', etiqueta: 'Es la que se usa si no eliges', tipo: 'siNo', porDefecto: 'no' },
  ],
  validar: (v) => {
    const fallos = exigir(v, BANCOS.formulario)
    const iban = (v.iban ?? '').trim()
    if (v.kind === 'bank' && iban === '') fallos.iban = 'Una cuenta del banco lleva su IBAN.'
    if (iban !== '') { const r = validarIban(iban); if (!r.ok) fallos.iban = r.motivo }
    comprobarCuentas(v, ['pgc_hint'], fallos)
    return fallos
  },
  aBase: (v) => ({
    kind: v.kind, name: v.name.trim(), iban: nulo(v.iban) === null ? null : normalizarIban(v.iban), bic: nulo(v.bic),
    pgc_hint: nulo(v.pgc_hint), is_default: siNo(v.is_default),
  }),
  aValores: (f) => ({
    kind: txt(d(f, 'kind')), name: txt(d(f, 'name')), iban: d(f, 'iban') ? formatearIban(txt(d(f, 'iban'))) : '', bic: txt(d(f, 'bic')),
    pgc_hint: txt(d(f, 'pgc_hint')), is_default: d(f, 'is_default') ? 'si' : 'no',
  }),
  buscable: (f) => `${txt(d(f, 'name'))} ${txt(d(f, 'iban'))} ${CAJA[txt(d(f, 'kind'))] ?? ''}`,
  vacia: 'Aún no has puesto tus bancos ni tus cajas.',
}

const TIPOS_GASTO: DefinicionTabla = {
  id: 'tipos-de-gasto', titulo: 'Tipos de gasto e ingreso', singular: 'tipo', columnaTitulo: 'Tipo',
  tablasBd: ['expense_category'], claveAjuste: 'expense_category', conSerie: true, conVigencia: false, soloLectura: false, deEmpresa: false,
  inicial: (f) => txt(d(f, 'pgc_account_hint')).slice(0, 3),
  // El título oficial de la cuenta es el nombre; lo coloquial va de apoyo (encargo §4.4).
  tituloFila: (f) => txt(d(f, 'name')),
  apoyoFila: (f) => oNada(txt(d(f, 'example'))),
  columnas: [
    { id: 'kind', etiqueta: 'Es', apoyo: true, ancho: '90px', valor: (f) => GASTO_O_INGRESO[txt(d(f, 'kind'))] ?? '' },
    { id: 'cuenta', etiqueta: 'Cuenta', cifra: true, apoyo: true, ancho: '80px', valor: (f) => txt(d(f, 'pgc_account_hint')) },
  ],
  detalle: [
    { etiqueta: 'Cuenta', valor: (f) => cuentaPgc(txt(d(f, 'pgc_account_hint'))) },
    { etiqueta: 'Lo que suele ser', valor: (f) => oNada(txt(d(f, 'example'))) },
    { etiqueta: 'Es', valor: (f) => GASTO_O_INGRESO[txt(d(f, 'kind'))] ?? null },
  ],
  cuentasEditables: [],
  formulario: [
    { clave: 'name', etiqueta: 'Nombre oficial', tipo: 'texto', obligatorio: true, ayuda: 'El título de la cuenta: «Suministros».' },
    { clave: 'example', etiqueta: 'Lo que suele ser', tipo: 'texto', ayuda: 'En palabras de la calle: «luz, agua y gas».' },
    { clave: 'kind', etiqueta: 'Es', tipo: 'opciones', opciones: opciones(GASTO_O_INGRESO), obligatorio: true, porDefecto: 'expense' },
    { clave: 'pgc_account_hint', etiqueta: 'Cuenta', tipo: 'texto', obligatorio: true },
  ],
  validar: (v) => {
    const fallos = exigir(v, TIPOS_GASTO.formulario)
    comprobarCuentas(v, ['pgc_account_hint'], fallos)
    return fallos
  },
  aBase: (v) => ({ name: v.name.trim(), example: nulo(v.example), kind: v.kind, pgc_account_hint: v.pgc_account_hint.trim() }),
  aValores: (f) => ({ name: txt(d(f, 'name')), example: txt(d(f, 'example')), kind: txt(d(f, 'kind')), pgc_account_hint: txt(d(f, 'pgc_account_hint')) }),
  buscable: (f) => `${txt(d(f, 'name'))} ${txt(d(f, 'example'))} ${txt(d(f, 'pgc_account_hint'))}`,
  notaSerie: 'Es de serie: no se borra, pero puedes ocultarlo para que no salga en tus desplegables.',
  vacia: 'Todavía no hay tipos de gasto cargados.',
}

const TEXTOS: DefinicionTabla = {
  id: 'textos-de-apuntes', titulo: 'Textos de los apuntes', singular: 'texto', columnaTitulo: 'Texto',
  tablasBd: ['entry_text'], claveAjuste: 'entry_text', conSerie: true, conVigencia: false, soloLectura: false, deEmpresa: false,
  inicial: () => 'Aa',
  tituloFila: (f) => txt(d(f, 'text')),
  apoyoFila: (f) => PARA_QUE[txt(d(f, 'purpose'))] ?? null,
  columnas: [],
  detalle: [
    { etiqueta: 'Se usa en', valor: (f) => PARA_QUE[txt(d(f, 'purpose'))] ?? null },
    { etiqueta: 'El asterisco', valor: (f) => (txt(d(f, 'text')).includes('*') ? 'Se cambia por el número del documento' : null) },
  ],
  cuentasEditables: [],
  formulario: [
    { clave: 'text', etiqueta: 'Texto', tipo: 'texto', obligatorio: true, ayuda: 'Un * se cambia por el número del documento: «Fra. n.º *».' },
    { clave: 'purpose', etiqueta: 'Se usa en', tipo: 'opciones', opciones: opciones(PARA_QUE), obligatorio: true, porDefecto: 'purchase_invoice' },
  ],
  validar: (v) => exigir(v, TEXTOS.formulario),
  aBase: (v) => ({ text: v.text.trim(), purpose: v.purpose }),
  aValores: (f) => ({ text: txt(d(f, 'text')), purpose: txt(d(f, 'purpose')) }),
  buscable: (f) => `${txt(d(f, 'text'))} ${PARA_QUE[txt(d(f, 'purpose'))] ?? ''}`,
  notaSerie: 'Es de serie: no se borra, pero puedes ocultarlo para que no salga en tus desplegables.',
  vacia: 'Todavía no hay textos cargados.',
}

const PAISES: DefinicionTabla = {
  id: 'paises-y-monedas', titulo: 'Países y monedas', singular: 'país o moneda', columnaTitulo: 'País o moneda',
  tablasBd: ['country', 'currency'], claveAjuste: null, conSerie: true, conVigencia: false, soloLectura: true, deEmpresa: false,
  inicial: (f) => f.code,
  tituloFila: (f) => txt(d(f, 'name_es')),
  apoyoFila: (f) => (f.tablaBd === 'country' ? 'País' : 'Moneda'),
  columnas: [
    { id: 'codigo', etiqueta: 'Código', cifra: true, apoyo: true, ancho: '110px',
      valor: (f) => (f.tablaBd === 'country' ? `${f.code} · ${txt(d(f, 'alpha3'))}` : f.code) },
  ],
  detalle: [
    { etiqueta: 'Es', valor: (f) => (f.tablaBd === 'country' ? 'País (ISO 3166)' : 'Moneda (ISO 4217)') },
    { etiqueta: 'Código', valor: (f) => f.code },
    { etiqueta: 'Código de tres letras', valor: (f) => (f.tablaBd === 'country' ? txt(d(f, 'alpha3')) : null) },
  ],
  cuentasEditables: [],
  formulario: [],
  validar: () => ({}),
  aBase: () => ({}),
  aValores: () => ({}),
  buscable: (f) => `${f.code} ${txt(d(f, 'alpha3'))} ${txt(d(f, 'name_es'))}`,
  notaSerie: 'Las listas oficiales de la Unión Europea. Solo se consultan.',
  vacia: 'Todavía no hay países ni monedas cargados.',
}

/** Las tablas, en el orden de la maqueta. */
export const TABLAS_GENERALES: readonly DefinicionTabla[] = [
  IMPUESTOS, RETENCIONES, FORMAS_PAGO, PLAZOS, NUMERACION, BANCOS, TIPOS_GASTO, TEXTOS, PAISES,
]

/** Lo que sale escrito al abrir «Añadir»: los valores por defecto; las fechas, hoy. */
export function valoresIniciales(def: DefinicionTabla, hoy: string): Valores {
  const v: Valores = {}
  for (const c of def.formulario) v[c.clave] = c.porDefecto ?? (c.tipo === 'fecha' ? hoy : '')
  return v
}

export function definicion(id: string | undefined): DefinicionTabla | null {
  return TABLAS_GENERALES.find((t) => t.id === id) ?? null
}

// ── Vigencias ───────────────────────────────────────────────────────────────

const vale = (f: FilaGeneral, dia: string) =>
  f.validFrom !== null && f.validFrom <= dia && (f.validTo === null || f.validTo >= dia)

/**
 * Agrupa las vigencias de lo mismo (code): la fila principal es la que vale
 * hoy; si ninguna vale hoy, la más reciente (se ve, con su fecha de fin, no se
 * esconde). El resto va al historial, de la más nueva a la más vieja.
 */
export function agruparConceptos(filas: FilaGeneral[], conVigencia: boolean, hoy: string): Concepto[] {
  if (!conVigencia) return filas.map((fila) => ({ fila, historial: [] }))
  const grupos = new Map<string, FilaGeneral[]>()
  for (const f of filas) {
    const k = `${f.serie ? 'serie' : 'propia'}:${f.code}`
    grupos.set(k, [...(grupos.get(k) ?? []), f])
  }
  return [...grupos.values()].map((g) => {
    const orden = [...g].sort((a, b) => (b.validFrom ?? '').localeCompare(a.validFrom ?? ''))
    const fila = orden.find((f) => vale(f, hoy)) ?? orden[0]
    return { fila, historial: orden.filter((f) => f !== fila) }
  })
}

/** «Desde 01/09/2012», «Hasta 31/12/2024», «Del 01/10/2024 al 31/12/2024». */
export function textoVigencia(f: FilaGeneral, hoy: string): string {
  const fecha = (iso: string) => { const [y, m, dd] = iso.split('-'); return `${dd}/${m}/${y}` }
  if (!f.validFrom) return 'Siempre'
  if (f.validTo === null) return f.validFrom > hoy ? `Desde ${fecha(f.validFrom)} (aún no)` : `Desde ${fecha(f.validFrom)}`
  if (f.validTo < hoy) return `Hasta ${fecha(f.validTo)}`
  return `Del ${fecha(f.validFrom)} al ${fecha(f.validTo)}`
}

/** ¿Vale hoy? (Para decir «ya no vale» sin esconder la fila.) */
export const valeHoy = (f: FilaGeneral, hoy: string): boolean => f.validFrom === null || vale(f, hoy)
