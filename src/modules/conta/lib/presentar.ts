// src/modules/conta/lib/presentar.ts
//
// Respuesta 3 del C00, punto 5: la ficha de la empresa tiene que BASTAR para
// presentar el modelo 200 y depositar las cuentas anuales en el Registro
// Mercantil. Lo que esos documentos piden de la empresa tiene que estar ya en
// su ficha, no pedirse en el momento. Puro.
//
// La lista sale del cruce campo a campo de docs/conta/C00_ficha_vs_modelos.md
// (página 1 del 200 y hoja de datos generales de identificación del depósito).
// Cada requisito dice para qué documento es y en qué apartado se pone.
//
// Solo para sociedades: un autónomo no presenta el 200 ni deposita cuentas.

import { ejercicioActual, type DatosEmpresa, type EjercicioBd } from '@/modules/conta/empresa/datosEmpresa'

export type Documento = '200' | 'deposito' | 'notificaciones'
export type EstadoRequisito = 'hecho' | 'falta' | 'no_se'

export interface Requisito {
  clave: string
  /** Lo que se pide, en palabras de la calle. */
  texto: string
  para: Documento[]
  /** El apartado de «Tu empresa» donde se pone. */
  donde: 'quien-eres' | 'actividad' | 'ejercicio' | 'socios'
  estado: EstadoRequisito
}

const ROLES_DE_REPRESENTANTE = ['administrator', 'representative', 'president']

const lleno = (v: string | null | undefined): boolean => typeof v === 'string' && v.trim() !== ''

/** El ejercicio del que se presentarían el 200 y las cuentas: el último cerrado; si no hay, el de ahora. */
export function ejercicioParaPresentar(d: DatosEmpresa, hoy: string): EjercicioBd | null {
  const cerrados = d.ejercicios.filter((e) => e.status === 'closed').sort((a, b) => b.endsOn.localeCompare(a.endsOn))
  return cerrados[0] ?? ejercicioActual(d.ejercicios, hoy)
}

/**
 * Si ya toca tenerlo todo: una sociedad con algún ejercicio cerrado, o que
 * tiene el 200 entre lo que presenta. Antes, lo que falta se enseña igual
 * (regla 7) pero no avisa.
 */
export function tocaPresentar(d: DatosEmpresa): boolean {
  if (d.empresa.entityKind !== 'company') return false
  return d.ejercicios.some((e) => e.status === 'closed') || (d.perfil?.taxForms ?? []).includes('200')
}

export function requisitosParaPresentar(d: DatosEmpresa, hoy: string): Requisito[] {
  if (d.empresa.entityKind !== 'company') return []
  const e = d.empresa
  const ej = ejercicioParaPresentar(d, hoy)
  const vivas = d.actividades.filter((a) => a.endedOn === null)
  const principal = vivas.find((a) => a.isMain) ?? vivas[0]
  const socios = d.socios === null ? null : d.socios.filter((s) => s.endedOn === null)
  const sobreSocios = (f: (s: NonNullable<typeof socios>) => boolean): EstadoRequisito => (socios === null ? 'no_se' : f(socios) ? 'hecho' : 'falta')
  const r = (clave: string, texto: string, para: Documento[], donde: Requisito['donde'], ok: boolean | EstadoRequisito): Requisito =>
    ({ clave, texto, para, donde, estado: typeof ok === 'string' ? ok : ok ? 'hecho' : 'falta' })

  return [
    r('razon_social', 'Razón social', ['200', 'deposito'], 'quien-eres', lleno(e.legalName)),
    r('nif', 'NIF', ['200', 'deposito'], 'quien-eres', lleno(e.taxId)),
    r('forma', 'Forma jurídica', ['200', 'deposito'], 'quien-eres', lleno(e.legalFormCode)),
    r('domicilio', 'Domicilio fiscal completo', ['200', 'deposito'], 'quien-eres', lleno(e.fiscalStreet) && lleno(e.fiscalPostalCode) && lleno(e.fiscalCity)),
    r('constitucion', 'Fecha de constitución', ['200', 'deposito'], 'quien-eres', lleno(e.incorporatedOn)),
    r('registro', 'Datos del Registro Mercantil: registro, tomo, folio, hoja e inscripción', ['deposito'], 'quien-eres',
      [e.registryName, e.registryVolume, e.registryFolio, e.registrySheet, e.registryEntry].every(lleno)),
    r('contacto', 'Teléfono o correo de la empresa', ['deposito'], 'quien-eres', lleno(e.phone) || lleno(e.email)),
    r('dehu', 'Correo para los avisos de notificaciones (DEHú)', ['notificaciones'], 'quien-eres', lleno(e.dehuEmail)),
    r('cnae', 'CNAE de la actividad principal', ['200', 'deposito'], 'actividad', lleno(principal?.cnaeCode)),
    r('representante', 'Un representante legal (administrador o apoderado) con su NIF', ['200'], 'socios',
      sobreSocios((ss) => ss.some((s) => s.roles.some((x) => ROLES_DE_REPRESENTANTE.includes(x)) && lleno(s.taxId)))),
    r('socios', 'Los socios con un 5 % o más, con su NIF y su porcentaje', ['200'], 'socios',
      sobreSocios((ss) => ss.some((s) => s.ownershipPct !== null) && ss.filter((s) => (s.ownershipPct ?? 0) >= 5).every((s) => lleno(s.taxId)))),
    r('firmantes', 'Quién firma las cuentas anuales', ['deposito'], 'socios', sobreSocios((ss) => ss.some((s) => s.signsAccounts === true))),
    r('plantilla', `Plantilla media${ej ? ` de ${ej.code}` : ''}, fija y no fija`, ['200', 'deposito'], 'ejercicio',
      !!ej && ej.averageStaffFixed !== null && ej.averageStaffFixed !== undefined && ej.averageStaffTemporary !== null && ej.averageStaffTemporary !== undefined),
    r('auditoria', `Si las cuentas${ej ? ` de ${ej.code}` : ''} están auditadas y, si lo están, el auditor y su opinión`, ['200', 'deposito'], 'ejercicio',
      !!ej && (ej.isAudited === false || (ej.isAudited === true && lleno(ej.auditorName) && lleno(ej.auditOpinion)))),
  ]
}

export const faltan = (rs: Requisito[]): Requisito[] => rs.filter((x) => x.estado === 'falta')

export const NOMBRE_DOCUMENTO: Record<Documento, string> = {
  '200': 'el modelo 200', deposito: 'el depósito de cuentas', notificaciones: 'las notificaciones',
}
