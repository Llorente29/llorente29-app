// src/modules/conta/empresa/datosEmpresa.ts
//
// Ajustes › Tu empresa (C00, tarea 5): lo que la pantalla enseña, sacado de
// los datos de la empresa. Puro: el servicio lee y escribe; aquí solo se
// deduce (qué meses están cerrados, qué falta para «Todo listo», cómo se dice
// el IVA en palabras de la calle).

import { mesesDe, siguienteMesACerrar, mesQueSePuedeReabrir, type Ejercicio } from '@/modules/conta/lib/ejercicios'

// ── Lo que se lee ───────────────────────────────────────────────────────────

export interface Empresa {
  id: string
  legalName: string | null
  tradeName: string | null
  taxId: string | null
  taxIdVerifiedAt: string | null
  entityKind: 'company' | 'self_employed' | null
  legalFormCode: string | null
  fiscalStreetType: string | null
  fiscalStreet: string | null
  fiscalNumber: string | null
  fiscalExtra: string | null
  fiscalPostalCode: string | null
  fiscalCity: string | null
  fiscalProvince: string | null
  fiscalCountry: string
  registryName: string | null
  registrySheet: string | null
}

export interface PerfilFiscal {
  taxTerritory: 'peninsula_baleares' | 'canarias' | 'ceuta_melilla'
  vatSchemeCode: string | null
  vatCashBasis: boolean
  vatSurcharge: boolean
  vatPeriod: 'quarterly' | 'monthly'
  vatProrata: boolean
  vatProrataPct: number | null
  sii: boolean
  chartKind: 'pymes' | 'normal'
  accountDigits: number
  taxForms: string[]
}

export interface Actividad {
  id: string
  kind: 'business' | 'professional' | 'other'
  iaeCode: string | null
  iaeTitle: string | null
  cnaeCode: string | null
  cnaeTitle: string | null
  description: string
  startedOn: string | null
  endedOn: string | null
  isMain: boolean
}

export interface EjercicioBd extends Ejercicio { id: string; status: 'open' | 'closed' }

export interface Cierre { mes: string; quien: string | null; cuando: string }

export interface Socio {
  id: string
  fullName: string
  taxId: string | null
  roles: string[]
  ownershipPct: number | null
  startedOn: string | null
  endedOn: string | null
}

export interface Opcion { code: string; name: string }

export interface DatosEmpresa {
  empresa: Empresa
  perfil: PerfilFiscal | null
  actividades: Actividad[]
  ejercicios: EjercicioBd[]
  /** Meses con cierre vivo (sin reabrir). */
  cierres: Cierre[]
  /** null = quien mira no es administrador: los socios no se le enseñan. */
  socios: Socio[] | null
  formasJuridicas: Opcion[]
  regimenes: Opcion[]
  modelos: Opcion[]
}

// ── Textos ──────────────────────────────────────────────────────────────────

export const TERRITORIOS: Record<PerfilFiscal['taxTerritory'], string> = {
  peninsula_baleares: 'Península y Baleares', canarias: 'Canarias', ceuta_melilla: 'Ceuta y Melilla',
}

export const ROLES: Record<string, string> = {
  partner: 'Socio', administrator: 'Administrador', representative: 'Representante',
  secretary: 'Secretario', president: 'Presidente', filer: 'Presenta los impuestos',
}

export const CLASE_ACTIVIDAD: Record<Actividad['kind'], string> = {
  business: 'Empresarial', professional: 'Profesional', other: 'Otra',
}

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
const MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** «2026-09-01» → «septiembre». */
export const nombreMes = (mes: string): string => MESES_LARGOS[Number(mes.slice(5, 7)) - 1]

/** «2022-03-15» → «marzo de 2022». */
export const mesYAno = (iso: string): string => `${nombreMes(iso)} de ${iso.slice(0, 4)}`

/** El IVA en una frase: «General · cada tres meses». */
export function textoIva(perfil: PerfilFiscal | null, regimenes: Opcion[]): string {
  if (!perfil) return 'Sin poner'
  if (perfil.taxTerritory === 'canarias') return 'IGIC (Canarias)'
  if (perfil.taxTerritory === 'ceuta_melilla') return 'IPSI (Ceuta y Melilla)'
  const regimen = !perfil.vatSchemeCode || perfil.vatSchemeCode === 'general'
    ? 'General'
    : (regimenes.find((r) => r.code === perfil.vatSchemeCode)?.name ?? perfil.vatSchemeCode)
  return `${regimen} · ${perfil.vatPeriod === 'monthly' ? 'cada mes' : 'cada tres meses'}`
}

/** La dirección fiscal en una línea: «C/ Ejemplo 12, Madrid». */
export function direccionEnUnaLinea(e: Empresa): string | null {
  const calle = [e.fiscalStreetType ? abreviarVia(e.fiscalStreetType) : null, e.fiscalStreet].filter(Boolean).join(' ')
  const primera = [calle, e.fiscalNumber, e.fiscalExtra].filter(Boolean).join(' ')
  const partes = [primera, e.fiscalCity].filter((p) => p && p.trim() !== '')
  return partes.length ? partes.join(', ') : null
}

function abreviarVia(t: string): string {
  const m: Record<string, string> = { calle: 'C/', avenida: 'Av.', plaza: 'Pl.', paseo: 'P.º', camino: 'Cmno.', carretera: 'Ctra.' }
  return m[t.trim().toLowerCase()] ?? t
}

/** El registro mercantil: «Madrid · M-000000». */
export function textoRegistro(e: Empresa): string | null {
  const partes = [e.registryName, e.registrySheet].filter((p): p is string => !!p && p.trim() !== '')
  return partes.length ? partes.join(' · ') : null
}

/** «Administrador · socio», con el primero en mayúscula. */
export function textoRoles(roles: string[]): string {
  const t = roles.map((r) => ROLES[r] ?? r).map((r, i) => (i === 0 ? r : r.charAt(0).toLowerCase() + r.slice(1)))
  return t.join(' · ')
}

// ── El ejercicio y sus meses ────────────────────────────────────────────────

export interface MesDelEjercicio {
  mes: string
  corto: string
  estado: 'cerrado' | 'abierto' | 'futuro'
}

/** El ejercicio que contiene hoy; si no hay, el último que empezó. */
export function ejercicioActual(ejercicios: EjercicioBd[], hoy: string): EjercicioBd | null {
  const dentro = ejercicios.find((e) => e.startsOn <= hoy && e.endsOn >= hoy)
  if (dentro) return dentro
  return [...ejercicios].filter((e) => e.startsOn <= hoy).sort((a, b) => b.startsOn.localeCompare(a.startsOn))[0] ?? null
}

/** Los meses de un ejercicio con su estado: cerrado, abierto (ya empezó) o por llegar. */
export function mesesConEstado(e: Ejercicio, cierres: Cierre[], hoy: string): MesDelEjercicio[] {
  const cerrados = new Set(cierres.map((c) => c.mes))
  const mesHoy = `${hoy.slice(0, 7)}-01`
  return mesesDe(e).map((mes) => ({
    mes,
    corto: MESES[Number(mes.slice(5, 7)) - 1],
    estado: cerrados.has(mes) ? 'cerrado' : mes <= mesHoy ? 'abierto' : 'futuro',
  }))
}

/**
 * El mes que se puede cerrar ahora: el primero abierto del ejercicio, y solo
 * si ya ha terminado (no se cierra un mes que aún está pasando).
 */
export function mesParaCerrar(e: Ejercicio, cierres: Cierre[], hoy: string): string | null {
  const m = siguienteMesACerrar(e, cierres.map((c) => c.mes))
  if (!m) return null
  return m < `${hoy.slice(0, 7)}-01` ? m : null
}

/** El que se puede reabrir: el último cerrado de este ejercicio. */
export function mesParaReabrir(e: Ejercicio, cierres: Cierre[]): string | null {
  const meses = new Set(mesesDe(e))
  return mesQueSePuedeReabrir(cierres.map((c) => c.mes).filter((m) => meses.has(m)))
}

/** «Septiembre y octubre abiertos», «Todo cerrado hasta agosto»… para el móvil. */
export function resumenMeses(meses: MesDelEjercicio[]): string {
  const abiertos = meses.filter((m) => m.estado === 'abierto').map((m) => nombreMes(m.mes))
  if (abiertos.length === 0) {
    const ultimo = [...meses].reverse().find((m) => m.estado === 'cerrado')
    return ultimo ? `Cerrado hasta ${nombreMes(ultimo.mes)}` : 'Aún no ha empezado'
  }
  const lista = abiertos.length === 1 ? abiertos[0] : `${abiertos.slice(0, -1).join(', ')} y ${abiertos[abiertos.length - 1]}`
  const primero = lista.charAt(0).toUpperCase() + lista.slice(1)
  return `${primero} ${abiertos.length === 1 ? 'abierto' : 'abiertos'}`
}

/** El ejercicio que se propone abrir si no hay ninguno: el año natural de hoy. */
export function ejercicioPropuesto(hoy: string): Ejercicio {
  const ano = hoy.slice(0, 4)
  return { code: ano, startsOn: `${ano}-01-01`, endsOn: `${ano}-12-31` }
}

// ── «Todo listo para llevar tu contabilidad» ────────────────────────────────

/**
 * Lo que falta para poder llevar la contabilidad, en frases. Vacío = todo
 * listo. La etiqueta verde de la cabecera solo sale si no falta nada: nunca
 * dice «listo» habiendo huecos (regla 7: no se esconde lo que falta).
 */
export function loQueFalta(d: DatosEmpresa, hoy: string): string[] {
  const falta: string[] = []
  if (!d.empresa.legalName) falta.push('la razón social')
  if (!d.empresa.taxId) falta.push('el NIF')
  if (!direccionEnUnaLinea(d.empresa)) falta.push('la dirección fiscal')
  if (!d.actividades.some((a) => a.endedOn === null && a.isMain)) falta.push('a qué te dedicas')
  if (!d.perfil) falta.push('tus impuestos')
  if (!d.ejercicios.some((e) => e.startsOn <= hoy && e.endsOn >= hoy)) falta.push(`el ejercicio de ${hoy.slice(0, 4)}`)
  return falta
}

/** «Falta el NIF y a qué te dedicas». */
export function fraseFalta(falta: string[]): string {
  if (falta.length === 0) return ''
  const lista = falta.length === 1 ? falta[0] : `${falta.slice(0, -1).join(', ')} y ${falta[falta.length - 1]}`
  return `Falta ${lista}`
}

// ── Validaciones de lo que se edita ─────────────────────────────────────────

export interface CambiosQuienEres {
  legalName: string
  tradeName: string
  legalFormCode: string
  fiscalStreetType: string
  fiscalStreet: string
  fiscalNumber: string
  fiscalExtra: string
  fiscalPostalCode: string
  fiscalCity: string
  fiscalProvince: string
  registryName: string
  registrySheet: string
}

export function revisarQuienEres(c: CambiosQuienEres, pais: string): Record<string, string> {
  const f: Record<string, string> = {}
  if (c.legalName.trim() === '') f.legalName = 'Falta la razón social: el nombre que sale en el NIF.'
  if (pais === 'ES' && c.fiscalPostalCode.trim() !== '' && !/^\d{5}$/.test(c.fiscalPostalCode.trim())) {
    f.fiscalPostalCode = 'El código postal son cinco cifras.'
  }
  return f
}

export function revisarPorcentajeProrrata(pct: string): string | null {
  if (pct.trim() === '') return 'Di qué porcentaje de prorrata aplicas.'
  const n = Number(pct.replace(',', '.'))
  return Number.isFinite(n) && n >= 0 && n <= 100 ? null : 'La prorrata va de 0 a 100.'
}

export function revisarDigitos(d: string): string | null {
  const n = Number(d)
  return Number.isInteger(n) && n >= 4 && n <= 12 ? null : 'Las cuentas van de 4 a 12 dígitos.'
}

// ── Códigos ─────────────────────────────────────────────────────────────────

/**
 * Un epígrafe del IAE como se escribe: el ISTAC lo da con la sección delante
 * y sin punto («1_6779»); en la calle es «677.9». Grupo: «671».
 */
export function codigoIae(code: string): string {
  const num = code.includes('_') ? code.split('_')[1] : code
  return num.length === 4 ? `${num.slice(0, 3)}.${num.slice(3)}` : num
}

/** Los títulos oficiales llevan guiones de partición invisibles: fuera. */
export const limpiarTitulo = (t: string): string => t.replace(/­/g, '').replace(/\s+/g, ' ').trim()

/** «303 IVA», «111 Retenciones»: como en la maqueta. El nombre largo sale en el título. */
export const NOMBRE_CORTO_MODELO: Record<string, string> = {
  '303': 'IVA', '390': 'Resumen del IVA', '111': 'Retenciones', '115': 'Alquiler', '123': 'Capital',
  '130': 'IRPF', '180': 'Resumen del alquiler', '190': 'Resumen de retenciones', '200': 'Sociedades',
  '202': 'Sociedades', '347': 'Terceros', '349': 'Europa',
}
