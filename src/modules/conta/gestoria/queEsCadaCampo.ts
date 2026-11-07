// src/modules/conta/gestoria/queEsCadaCampo.ts
//
// G01b · Parte 2 (07/11/2026) · Lo que hay detrás de «Qué es cada campo»
// (Ajustes › Cobros › Bitrix24), sin pantalla: puro, lo prueban las
// unitarias (tests/unit/modules/conta/gestoria/queEsCadaCampo.test.ts).
//   · Qué se propone al abrir: lo que ya dice el mapa guardado y, donde no
//     tiene código, una propuesta nueva con lo medido del portal.
//   · Qué falta: lo que sale en rojo.
//   · El mapa que se manda a confirmar: el NIF, la situación (cada opción con
//     lo que es en Sumied), la dirección (sus fuentes por orden, la primera
//     con algo y sin mezclar dos) y las cuotas de referencia.
// Decisiones de Julio (07/11, tras el recuento): la dirección, por este orden,
// Dirección Fiscal, Dirección Social, ADDRESS y «Calle, casa núm.»; la
// situación, ACTIVO, BAJA…, MOROSO y SOLO RENTA a lo suyo y lo demás «Sin
// clasificar»; las cuotas, las que no acaban en «z».

import { esCampoSensible } from '../../../../supabase/functions/conta-bitrix-leer/sensibles'
import {
  proponerMapa, situacionDeTexto,
  type CampoDelMapa, type CampoMedido, type FuenteDireccion, type MapaBitrix, type Situacion,
} from '../../../../supabase/functions/conta-bitrix-leer/mapa'

export type { CampoMedido, MapaBitrix, Situacion }
export type { MapaContactos } from '../../../../supabase/functions/conta-bitrix-leer/contactosClientes'
import type { EleccionContactos } from '../../../../supabase/functions/conta-bitrix-leer/contactosClientes'

export const SITUACIONES_SUMIED: readonly { valor: Situacion; texto: string }[] = [
  { valor: 'activo', texto: 'Activo' },
  { valor: 'baja', texto: 'De baja' },
  { valor: 'moroso', texto: 'Moroso' },
  { valor: 'solo_renta', texto: 'Solo la renta' },
  { valor: 'sin_clasificar', texto: 'Sin clasificar' },
]

/** Las cuatro fuentes de la dirección, por orden, y cómo se reconoce cada una por su etiqueta. */
export const FUENTES: readonly { nombre: string; patron: RegExp; estandar?: boolean }[] = [
  { nombre: 'Dirección Fiscal', patron: /^DIRECCION FISCAL$/ },
  { nombre: 'Dirección Social', patron: /^DIRECCION SOCIAL$/ },
  { nombre: 'Dirección (la de Bitrix24)', patron: /^$/, estandar: true },
  { nombre: 'Calle, casa núm.', patron: /^CALLE,? CASA/ },
]

export interface FuenteElegida { calle: string | null; cp: string | null; poblacion: string | null; provincia: string | null }
export interface Eleccion {
  nif: string | null
  situacion: string | null
  /** id de la opción en Bitrix24 → lo que es en Sumied. */
  opciones: Record<string, Situacion>
  direcciones: FuenteElegida[]
  cuotas: { etiqueta: string; codigo: string | null }[]
}

const sinTildes = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim()
export const etiquetaDe = (medidos: Record<string, CampoMedido>, codigo: string) => {
  const c = medidos[codigo]
  return [c?.formLabel, c?.listLabel, c?.title].find((x) => x && x.trim())?.trim() ?? codigo
}
const unicoCon = (medidos: Record<string, CampoMedido>, patron: RegExp, tipo?: (c: CampoMedido) => boolean) => {
  const hay = Object.keys(medidos).filter((k) => k.startsWith('UF_CRM_') && patron.test(sinTildes(etiquetaDe(medidos, k))) && (!tipo || tipo(medidos[k])))
  return hay.length === 1 ? hay[0] : null
}
const codigoDe = (campos: readonly CampoDelMapa[], campo: string, etiqueta?: string) =>
  campos.find((c) => c.campo === campo && (etiqueta === undefined || c.etiqueta === etiqueta))?.codigo ?? null
const existe = (medidos: Record<string, CampoMedido>, k: string | null | undefined) => (k && medidos[k] && !esCampoSensible(medidos[k], k) ? k : null)

/** Cada opción de la situación, con lo que es en Sumied: lo que diga el mapa guardado o, si no, la propuesta por su texto. */
export function opcionesDeSituacion(codigo: string | null, medidos: Record<string, CampoMedido>, antes?: Record<string, string>): Record<string, Situacion> {
  const out: Record<string, Situacion> = {}
  for (const it of (codigo ? medidos[codigo]?.items : null) ?? []) {
    const id = String(it.ID)
    const v = antes?.[id]
    out[id] = SITUACIONES_SUMIED.some((s) => s.valor === v) ? (v as Situacion) : situacionDeTexto(it.VALUE)
  }
  return out
}

/** Lo que se propone al abrir la pantalla. */
export function eleccionInicial(mapa: MapaBitrix | null, medidos: Record<string, CampoMedido>): Eleccion {
  const fresca = proponerMapa(mapa?.nombre ?? 'Cuenta', medidos, []).mapa
  const guardado = mapa?.campos ?? []
  const de = (campo: string, etiqueta?: string) => existe(medidos, codigoDe(guardado, campo, etiqueta)) ?? existe(medidos, codigoDe(fresca.campos, campo, etiqueta))
  const situacion = de('situacion') ?? unicoCon(medidos, /^SITUACION/, (c) => !!c.items?.length)
  const antes = guardado.find((c) => c.campo === 'situacion' && c.codigo === situacion)?.opciones

  let direcciones: FuenteElegida[]
  if (mapa?.direcciones?.length) {
    direcciones = mapa.direcciones.map((d) => ({ calle: existe(medidos, d.calle), cp: existe(medidos, d.cp), poblacion: existe(medidos, d.poblacion), provincia: existe(medidos, d.provincia) }))
  } else {
    // Los sueltos de antes (código postal, población, provincia) son de «Calle, casa núm.», no de ADDRESS: van con ella.
    const suelto = (campo: string) => { const k = existe(medidos, codigoDe(guardado, campo)); return k && k.startsWith('UF_CRM_') ? k : null }
    direcciones = FUENTES.map((f) => f.estandar
      ? { calle: existe(medidos, 'ADDRESS'), cp: existe(medidos, 'ADDRESS_POSTAL_CODE'), poblacion: existe(medidos, 'ADDRESS_CITY'), provincia: existe(medidos, 'ADDRESS_PROVINCE') }
      : f.nombre === 'Calle, casa núm.'
        ? { calle: unicoCon(medidos, f.patron), cp: suelto('cp'), poblacion: suelto('poblacion'), provincia: suelto('provincia') }
        : { calle: unicoCon(medidos, f.patron), cp: null, poblacion: null, provincia: null })
  }

  // Las cuotas que ya tiene el mapa guardado (si no tiene ninguna, las de la propuesta).
  const cuotasDe = (cs: readonly CampoDelMapa[]) => [...new Set(cs.filter((c) => c.campo === 'cuota_referencia').map((c) => c.etiqueta ?? ''))].filter(Boolean)
  const etiquetasCuota = cuotasDe(guardado).length ? cuotasDe(guardado) : cuotasDe(fresca.campos)
  return {
    nif: de('nif'),
    situacion,
    opciones: opcionesDeSituacion(situacion, medidos, antes),
    direcciones,
    cuotas: etiquetasCuota.map((etiqueta) => ({ etiqueta, codigo: de('cuota_referencia', etiqueta) })),
  }
}

/** Lo que falta, en palabras (sale en rojo). */
export function loQueFalta(e: Eleccion): string[] {
  const out: string[] = []
  if (!e.nif) out.push('El NIF: ningún campo elegido.')
  if (!e.situacion) out.push('La situación del cliente: ningún campo elegido. Sin él no se guarda la situación de nadie.')
  if (!e.direcciones.some((d) => d.calle)) out.push('La dirección: ninguna fuente elegida.')
  for (const c of e.cuotas) if (!c.codigo) out.push(`La cuota «${c.etiqueta}»: ningún campo elegido.`)
  return out
}

/** Se puede confirmar con la situación elegida (lo demás que falte se avisa, pero no para). */
export const sePuedeConfirmar = (e: Eleccion) => !!e.situacion

/** Cuántas opciones van a cada situación de Sumied («2 activo, 2 de baja…»), para el aviso antes de confirmar. */
export function resumenDeOpciones(e: Eleccion): string {
  const n = (v: Situacion) => Object.values(e.opciones).filter((x) => x === v).length
  return SITUACIONES_SUMIED.map((s) => `${s.texto}: ${n(s.valor)}`).join(' · ')
}

/** El mapa que se manda a confirmar: el de antes con lo elegido en su sitio. */
export function mapaParaConfirmar(mapa: MapaBitrix | null, e: Eleccion, medidos: Record<string, CampoMedido>): MapaBitrix {
  const base = mapa ?? proponerMapa('Cuenta', medidos, []).mapa
  const fuera = new Set(['nif', 'situacion', 'calle', 'cp', 'poblacion', 'provincia', 'cuota_referencia'])
  const campos: CampoDelMapa[] = base.campos.filter((c) => !fuera.has(c.campo))
  if (e.nif) campos.push({ codigo: e.nif, campo: 'nif' })
  if (e.situacion) {
    const items = medidos[e.situacion]?.items ?? []
    campos.push({ codigo: e.situacion, campo: 'situacion', opciones: { ...e.opciones },
      textos: Object.fromEntries(items.map((it) => [String(it.ID), it.VALUE])) })
  }
  for (const c of e.cuotas) if (c.codigo) campos.push({ codigo: c.codigo, campo: 'cuota_referencia', etiqueta: c.etiqueta })
  const direcciones: FuenteDireccion[] = e.direcciones.filter((d) => d.calle).map((d) => ({
    etiqueta: etiquetaDe(medidos, d.calle!), calle: d.calle!,
    ...(d.cp ? { cp: d.cp } : {}), ...(d.poblacion ? { poblacion: d.poblacion } : {}), ...(d.provincia ? { provincia: d.provincia } : {}),
  }))
  return { nombre: base.nombre, campos, formaPagoAEmisor: base.formaPagoAEmisor ?? {}, direcciones, dudas: [] }
}

/**
 * Los campos medidos para un selector: por su etiqueta, con su código. G01b ·
 * Nunca los que guardan contraseñas o certificados (clientes.ts ·
 * esCampoSensible): no salen para elegir.
 */
export function opcionesDeCampos(medidos: Record<string, CampoMedido>, filtro?: (c: CampoMedido) => boolean): { valor: string; texto: string }[] {
  return Object.keys(medidos).filter((k) => !esCampoSensible(medidos[k], k) && (!filtro || filtro(medidos[k])))
    .map((k) => ({ valor: k, texto: `${etiquetaDe(medidos, k)} · ${k}` }))
    .sort((a, b) => a.texto.localeCompare(b.texto, 'es'))
}

// ── G01c · Elegir un campo sin códigos, y el mapa de contactos ──────────────

/** El tipo de un campo de Bitrix24, en palabras de oficina. */
export function tipoEnPalabras(tipo: string | undefined): string {
  switch (tipo) {
    case 'string': return 'Texto'
    case 'enumeration': case 'crm_status': return 'Lista'
    case 'address': return 'Dirección'
    case 'money': return 'Importe'
    case 'double': case 'integer': return 'Número'
    case 'date': return 'Fecha'
    case 'datetime': return 'Fecha y hora'
    case 'boolean': case 'char': return 'Sí o no'
    case 'crm_multifield': return 'Varios valores'
    case 'employee': case 'user': return 'Persona del equipo'
    case 'url': return 'Enlace'
    default: return tipo?.startsWith('crm') ? 'Enlace del CRM' : 'Otro'
  }
}

export interface CampoParaElegir { valor: string; etiqueta: string; tipo: string; propio: boolean }

/**
 * Los campos para elegir: por su etiqueta, con su tipo en palabras y si es
 * propio del portal o de serie de Bitrix24. Nunca el código (UF_CRM_…), ni los
 * que guardan contraseñas, certificados o el IBAN.
 */
export function camposParaElegir(medidos: Record<string, CampoMedido>, filtro?: (c: CampoMedido) => boolean): CampoParaElegir[] {
  return Object.keys(medidos).filter((k) => !esCampoSensible(medidos[k], k) && (!filtro || filtro(medidos[k])))
    .map((k) => ({ valor: k, etiqueta: etiquetaDe(medidos, k), tipo: tipoEnPalabras(medidos[k]?.type), propio: k.startsWith('UF_CRM_') }))
    .sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, 'es') || Number(a.propio) - Number(b.propio))
}

const normal = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
/** Los campos cuyo nombre o tipo tiene todas las palabras buscadas (sin tildes ni mayúsculas). */
export function buscarCampos(campos: readonly CampoParaElegir[], texto: string): CampoParaElegir[] {
  const palabras = normal(texto).split(' ').filter(Boolean)
  if (!palabras.length) return [...campos]
  return campos.filter((c) => { const t = normal(`${c.etiqueta} ${c.tipo}`); return palabras.every((p) => t.includes(p)) })
}

export function loQueFaltaContactos(e: EleccionContactos): string[] {
  const out: string[] = []
  if (!e.nif) out.push('El NIF: ningún campo elegido. Sin él, ningún contacto se une con su empresa.')
  if (!e.direccion) out.push('La dirección: ningún campo elegido.')
  return out
}

// G01c · La propuesta y el mapa de contactos viven en el adaptador de Bitrix24 (la lectura propone lo mismo que la pantalla).
export { mapaContactosDe, propuestaContactos, type EleccionContactos } from '../../../../supabase/functions/conta-bitrix-leer/contactosClientes'
export type { ResumenContactos, ContactosLeidos } from '../../../../supabase/functions/_shared/crm/contactos'
