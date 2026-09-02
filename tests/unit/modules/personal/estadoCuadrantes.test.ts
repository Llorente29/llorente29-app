import { describe, it, expect } from 'vitest'
import {
  construyeFilas, detectaSoledad, nombreDePila, rangoLegible,
} from '@/modules/personal/home/estadoCuadrantes'

const ALCALA = { id: 'a', nombre: 'Foodint Alcalá' }
const CARA = { id: 'c', nombre: 'Foodint Carabanchel' }
const LUNES = '2026-08-31'

describe('construyeFilas · el estado real del 02/09/2026', () => {
  it('Alcalá publicó la semana en curso; Carabanchel lleva 4 semanas', () => {
    const filas = construyeFilas([ALCALA, CARA], [
      { locationId: 'a', weekStart: '2026-08-31', status: 'published' },
      { locationId: 'a', weekStart: '2026-08-24', status: 'published' },
      { locationId: 'c', weekStart: '2026-08-31', status: 'draft' },
      { locationId: 'c', weekStart: '2026-08-17', status: 'draft' },
      { locationId: 'c', weekStart: '2026-08-03', status: 'published' },
    ], LUNES)

    expect(filas[0]).toMatchObject({ valor: 'publicado', tono: 'neutral' })
    expect(filas[0].etiqueta).toBe('Foodint Alcalá · semana del 31')
    // La cifra de la maqueta, que salió de estos mismos datos.
    expect(filas[1]).toMatchObject({ valor: 'borrador · 4 sem.', tono: 'bad' })
  })

  // La palabra dice QUÉ es; el color dice cómo de grave. Un borrador reciente
  // es ámbar; uno de hace un mes no.
  it('un borrador de esta misma semana es ámbar, no rojo', () => {
    const filas = construyeFilas([CARA], [
      { locationId: 'c', weekStart: '2026-08-31', status: 'draft' },
      { locationId: 'c', weekStart: '2026-08-24', status: 'published' },
    ], LUNES)
    expect(filas[0]).toMatchObject({ valor: 'borrador', tono: 'attention' })
  })

  it('sin fila para la semana en curso: «sin publicar», y en rojo', () => {
    const filas = construyeFilas([CARA], [
      { locationId: 'c', weekStart: '2026-08-24', status: 'published' },
    ], LUNES)
    expect(filas[0]).toMatchObject({ estado: 'sin_publicar', valor: 'sin publicar', tono: 'bad' })
  })

  // Publicar la semana que viene no arregla que ésta falte.
  it('un cuadrante publicado del futuro no cuenta como «al día»', () => {
    const filas = construyeFilas([CARA], [
      { locationId: 'c', weekStart: '2026-09-07', status: 'published' },
    ], LUNES)
    expect(filas[0].estado).toBe('sin_publicar')
    expect(filas[0].semanasSinPublicar).toBe(0)
  })

  it('sin ningún publicado nunca, no se inventa una antigüedad', () => {
    const filas = construyeFilas([CARA], [
      { locationId: 'c', weekStart: '2026-08-31', status: 'draft' },
    ], LUNES)
    expect(filas[0].valor).toBe('borrador')
  })
})

describe('nombreDePila y rangoLegible', () => {
  it('normaliza las mayúsculas de la ficha', () => {
    expect(nombreDePila('KEILYMAR ARAUJO LOBO')).toBe('Keilymar')
    expect(nombreDePila('Mirlenys Eloisa Castañeda')).toBe('Mirlenys')
  })
  it('el rango dice el mes solo cuando cambia', () => {
    expect(rangoLegible('2026-09-07', '2026-09-13')).toBe('del 7 al 13')
    expect(rangoLegible('2026-09-28', '2026-10-04')).toBe('del 28 de septiembre al 4 de octubre')
  })
})

describe('detectaSoledad · el caso real de Carabanchel', () => {
  const EMPLEADOS = [
    { id: 'k', nombre: 'KEILYMAR ARAUJO LOBO', locationId: 'c' },
    { id: 'm', nombre: 'Mirlenys Eloisa Castañeda', locationId: 'c' },
    { id: 'p', nombre: 'Pamela Guzman Velásquez', locationId: 'a' },
    { id: 'j', nombre: 'Johanny Garzón Rodríguez', locationId: 'a' },
    { id: 'n', nombre: 'Natacha del Valle Rondón', locationId: 'a' },
    { id: 'r', nombre: 'Marlón Mafla Rivera', locationId: 'a' },
  ]

  it('la línea de la maqueta, con los datos de verdad', () => {
    const linea = detectaSoledad([ALCALA, CARA], EMPLEADOS, [
      { empleadoId: 'm', estado: 'aprobada', desde: '2026-09-07', hasta: '2026-09-13', tipo: 'vacaciones' },
      { empleadoId: 'p', estado: 'aprobada', desde: '2026-09-14', hasta: '2026-09-20', tipo: 'vacaciones' },
    ], '2026-09-02')
    expect(linea).toBe(
      'Mirlenys de vacaciones del 7 al 13 — Keilymar se queda como única persona')
  })

  // Una solicitud rechazada no quita a nadie de su puesto.
  it('una ausencia RECHAZADA no genera aviso', () => {
    expect(detectaSoledad([CARA], EMPLEADOS, [
      { empleadoId: 'm', estado: 'rechazada', desde: '2026-09-14', hasta: '2026-09-21', tipo: 'vacaciones' },
    ], '2026-09-02')).toBeNull()
  })

  it('con cuatro en plantilla y uno fuera no hay soledad', () => {
    expect(detectaSoledad([ALCALA], EMPLEADOS, [
      { empleadoId: 'p', estado: 'aprobada', desde: '2026-09-14', hasta: '2026-09-20', tipo: 'vacaciones' },
    ], '2026-09-02')).toBeNull()
  })

  // Si no hay caso, no se pinta nada. Una tarjeta que siempre tiene algo que
  // decir acaba diciendo cosas que no importan.
  it('sin ausencias, ninguna línea inventada', () => {
    expect(detectaSoledad([ALCALA, CARA], EMPLEADOS, [], '2026-09-02')).toBeNull()
  })

  it('una ausencia ya terminada no se anuncia', () => {
    expect(detectaSoledad([CARA], EMPLEADOS, [
      { empleadoId: 'm', estado: 'aprobada', desde: '2026-08-01', hasta: '2026-08-07', tipo: 'vacaciones' },
    ], '2026-09-02')).toBeNull()
  })

  it('un local INACTIVO no genera urgencia aunque se quede sin nadie', () => {
    expect(detectaSoledad([ALCALA], [
      { id: 'x', nombre: 'Alguien Uno', locationId: 'cerrado' },
      { id: 'y', nombre: 'Alguien Dos', locationId: 'cerrado' },
    ], [
      { empleadoId: 'x', estado: 'aprobada', desde: '2026-09-07', hasta: '2026-09-13', tipo: 'vacaciones' },
    ], '2026-09-02')).toBeNull()
  })
})
