// G04 · Tarea 4 · El servicio que se propone en «Añadirla como línea» (Julio,
// nº 14). Nombres de trabajadores inventados (T11).
import { describe, expect, it } from 'vitest'
import { proponerServicio } from '@/modules/conta/gestoria/g04/propuestas'

const S = [
  { id: 'ges', nombre: 'Gestoría mensual', clave: 'gestoria_mensual', porTrabajador: false },
  { id: 'lab', nombre: 'Gestión laboral', clave: 'gestion_laboral', porTrabajador: true },
  { id: 'vig', nombre: 'Vigilancia de la salud', clave: 'vigilancia de la salud', porTrabajador: false },
  { id: 'nom', nombre: 'Nóminas', clave: 'nominas', porTrabajador: true },
]

describe('G04 · el servicio que se propone para una suscripción de GoCardless', () => {
  it('«GESTION LABORAL <nombre>» → Gestión laboral, con ese trabajador', () => {
    expect(proponerServicio('GESTION LABORAL Persona Prueba Uno', S)).toEqual({ servicioId: 'lab', trabajador: 'Persona Prueba Uno' })
  })
  it('«GESTORIA MENSUAL…» → Gestoría mensual', () => {
    expect(proponerServicio('GESTORIA MENSUAL - Sociedad Ejemplo', S)).toEqual({ servicioId: 'ges', trabajador: null })
  })
  it('otro nombre: el servicio que comparte más palabras, sin tildes', () => {
    expect(proponerServicio('VIGILANCIA DE LA SALUD 2026', S)).toEqual({ servicioId: 'vig', trabajador: null })
    expect(proponerServicio('NOMINAS Persona Prueba Dos', S)).toEqual({ servicioId: 'nom', trabajador: 'Persona Prueba Dos' })
  })
  it('si no se parece ninguno, sin propuesta: elige la persona', () => {
    expect(proponerServicio('SERVICIOS MENSUALES', S)).toEqual({ servicioId: null, trabajador: null })
  })
})
