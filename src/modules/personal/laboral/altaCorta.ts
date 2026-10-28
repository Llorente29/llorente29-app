// src/modules/personal/laboral/altaCorta.ts
//
// LS1 (28/10/2026) · Las cuentas del alta corta de una persona (Sumied ›
// Laboral › Equipo), aparte para probarlas sin pintar nada.

export interface DatosAlta {
  nombre: string
  dni: string
  telefono: string
  correo: string
  puesto: string
  centroId: string
  /** Horas a la semana, como se escriben («40», «20,5»). */
  jornada: string
  /** AAAA-MM-DD. */
  fecha: string
}

const LETRAS_DNI = 'TRWAGMYFPDXBNJZSQVHLCKE'

/** DNI o NIE con su letra de control bien puesta. Vacío vale: el DNI no es obligatorio. */
export function dniValido(t: string): boolean {
  const s = t.trim().toUpperCase().replace(/[\s-]/g, '')
  if (!s) return true
  const m = /^([XYZ]?)(\d{7,8})([A-Z])$/.exec(s)
  if (!m) return false
  const [, pre, num, letra] = m
  if (pre && num.length !== 7) return false
  if (!pre && num.length !== 8) return false
  const n = Number(`${pre ? 'XYZ'.indexOf(pre) : ''}${num}`)
  return LETRAS_DNI[n % 23] === letra
}

/** El DNI como se guarda: en mayúsculas y sin espacios ni guiones. */
export function dniLimpio(t: string): string {
  return t.trim().toUpperCase().replace(/[\s-]/g, '')
}

/** Un teléfono que se puede marcar (9 cifras en España, o con prefijo +). Vacío vale. */
export function telefonoValido(t: string): boolean {
  const s = t.replace(/[\s().-]/g, '')
  if (!s) return true
  return /^(\+\d{8,15}|\d{9})$/.test(s)
}

/** Lo que falla del alta, en palabras; null si se puede dar de alta. */
export function errorDeAlta(d: DatosAlta): string | null {
  if (d.nombre.trim().split(/\s+/).filter(Boolean).length < 2) return 'Escribe el nombre y al menos un apellido.'
  if (!d.centroId) return 'Elige su centro de trabajo.'
  if (!dniValido(d.dni)) return 'El DNI o NIE no es correcto: revisa los números y la letra.'
  if (!telefonoValido(d.telefono)) return 'El teléfono no es correcto: 9 cifras, o con su prefijo (+34…).'
  if (d.correo.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.correo.trim())) return 'El correo no es correcto.'
  const h = Number(d.jornada.trim().replace(',', '.'))
  if (!d.jornada.trim() || !Number.isFinite(h) || h <= 0 || h > 40) return 'La jornada va en horas a la semana, de 1 a 40.'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.fecha)) return 'Pon la fecha de alta.'
  return null
}

function trozo(t: string): string {
  return t.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-z0-9]/g, '')
}

/** El usuario para entrar al portal: «nombre.apellido» (y un número si ya está cogido). */
export function usuarioDeAlta(nombre: string, intento = 0): string {
  const partes = nombre.trim().split(/\s+/).map(trozo).filter(Boolean)
  const base = partes.length > 1 ? `${partes[0]}.${partes[1]}` : (partes[0] ?? 'persona')
  const usuario = base.length >= 3 ? base : `${base}.sumied`
  return intento > 0 ? `${usuario}${intento + 1}` : usuario
}

/** Una contraseña que se dicta bien: «Palabra-NNNN», sin 0/O ni 1/l. */
export function contrasenaDeAlta(azar: () => number = Math.random): string {
  const palabras = ['Sol', 'Rio', 'Monte', 'Faro', 'Puerto', 'Torre', 'Lago', 'Norte', 'Plaza', 'Puente', 'Valle', 'Bosque', 'Cielo', 'Mar', 'Luna', 'Mesa']
  const cifras = '23456789'
  let s = palabras[Math.floor(azar() * palabras.length)]
  s += '-'
  for (let i = 0; i < 4; i++) s += cifras[Math.floor(azar() * cifras.length)]
  return s
}
