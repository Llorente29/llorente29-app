// tests/unit/modules/conta/laboral/ls1.test.ts
//
// LS1 (28/10/2026) · Laboral en Sumied: las cuentas de las piezas nuevas.
//   · el vocabulario: «centro» en Sumied, Folvy igual que siempre;
//   · el alta corta: DNI/NIE con su letra, teléfono, jornada y el usuario;
//   · los centros: lo que se pide para guardar uno;
//   · corregir en «Para revisar»: la hora de Madrid, también en los días del
//     cambio de hora, y qué pide cada petición;
//   · la marca del portal.
// Medido contra la población real (regla 31): los 8 DNI/NIE de Foodint en
// producción (28/10, solo lectura y solo recuentos) pasan `dniValido`, 8 de 8.

import { describe, expect, it } from 'vitest'
import { FOLVY, SUMIED, enVocabulario } from '@/modules/personal/laboral/productoLaboral'
import { contrasenaDeAlta, dniValido, errorDeAlta, telefonoValido, usuarioDeAlta, type DatosAlta } from '@/modules/personal/laboral/altaCorta'
import { VACIO, errorDeCentro } from '@/modules/conta/laboral/centros'
import { errorDeCorreccion, isoDeMadrid, textoDePeticion } from '@/modules/conta/laboral/correccion'
import { marcaDelPortal } from '@/pages/trabajador/marcaPortal'
import { MARCAS } from '@/marca/marca'
import type { ClockCorrectionRequest } from '@/services/clockEditService'

describe('el vocabulario de Sumied', () => {
  it('en Sumied, «centro»; en Folvy, el texto tal cual', () => {
    expect(enVocabulario('Local equivocado', SUMIED)).toBe('Centro equivocado')
    expect(enVocabulario('Todos los locales · Locales que gestiona · su local', SUMIED)).toBe('Todos los centros · Centros que gestiona · su centro')
    expect(enVocabulario('Local equivocado', FOLVY)).toBe('Local equivocado')
  })
  it('no toca palabras que solo empiezan por «local»', () => {
    expect(enVocabulario('localStorage, localización y localmente', SUMIED)).toBe('localStorage, localización y localmente')
  })
  it('Sumied no enseña hostelería y vive en /conta/laboral', () => {
    expect([SUMIED.hosteleria, SUMIED.base, SUMIED.marca]).toEqual([false, '/conta/laboral', 'Sumied'])
    expect([FOLVY.hosteleria, FOLVY.base, FOLVY.marca]).toEqual([true, '/personal', 'Folvy'])
  })
})

describe('el alta corta', () => {
  const bien: DatosAlta = {
    nombre: 'Lucía García López', dni: '12345678Z', telefono: '600 123 456', correo: '', puesto: 'Administración',
    centroId: 'c1', jornada: '40', fecha: '2026-10-28',
  }
  it('DNI y NIE con su letra; vacío vale; la letra mal, no', () => {
    expect(dniValido('12345678Z')).toBe(true)
    expect(dniValido('12345678-z')).toBe(true)
    expect(dniValido('X1234567L')).toBe(true)
    expect(dniValido('Y1234567X')).toBe(true)
    expect(dniValido('')).toBe(true)
    expect(dniValido('12345678A')).toBe(false)
    expect(dniValido('X12345678L')).toBe(false)
    expect(dniValido('1234567Z')).toBe(false)
  })
  it('el teléfono: 9 cifras, o con su prefijo', () => {
    expect(telefonoValido('600 123 456')).toBe(true)
    expect(telefonoValido('+34 600123456')).toBe(true)
    expect(telefonoValido('')).toBe(true)
    expect(telefonoValido('60012')).toBe(false)
  })
  it('lo que falla, en palabras', () => {
    expect(errorDeAlta(bien)).toBeNull()
    expect(errorDeAlta({ ...bien, nombre: 'Lucía' })).toBe('Escribe el nombre y al menos un apellido.')
    expect(errorDeAlta({ ...bien, centroId: '' })).toBe('Elige su centro de trabajo.')
    expect(errorDeAlta({ ...bien, dni: '12345678A' })).toMatch(/DNI o NIE no es correcto/)
    expect(errorDeAlta({ ...bien, correo: 'lucia@' })).toBe('El correo no es correcto.')
    expect(errorDeAlta({ ...bien, jornada: '0' })).toMatch(/de 1 a 40/)
    expect(errorDeAlta({ ...bien, jornada: '20,5' })).toBeNull()
    expect(errorDeAlta({ ...bien, fecha: '' })).toBe('Pon la fecha de alta.')
  })
  it('el usuario: nombre.apellido sin tildes, y un número si está cogido', () => {
    expect(usuarioDeAlta('Lucía García López')).toBe('lucia.garcia')
    expect(usuarioDeAlta('Lucía García López', 1)).toBe('lucia.garcia2')
    expect(usuarioDeAlta('  José   Muñoz ')).toBe('jose.munoz')
    expect(usuarioDeAlta('Al')).toBe('al.sumied')
  })
  it('la contraseña se dicta bien: Palabra-NNNN, sin 0 ni 1', () => {
    expect(contrasenaDeAlta(() => 0)).toBe('Sol-2222')
    expect(contrasenaDeAlta()).toMatch(/^[A-Z][a-z]+-[2-9]{4}$/)
  })
})

describe('los centros de trabajo', () => {
  it('el nombre es lo único obligatorio; la ubicación, las dos coordenadas o ninguna', () => {
    expect(errorDeCentro({ ...VACIO, nombre: 'Oficina' })).toBeNull()
    expect(errorDeCentro(VACIO)).toBe('Ponle un nombre al centro.')
    expect(errorDeCentro({ ...VACIO, nombre: 'Oficina', lat: '40,4168', lng: '-3,7038' })).toBeNull()
    expect(errorDeCentro({ ...VACIO, nombre: 'Oficina', lat: '40.4' })).toBe('La ubicación necesita las dos coordenadas, o ninguna.')
    expect(errorDeCentro({ ...VACIO, nombre: 'Oficina', lat: '140', lng: '0' })).toBe('La latitud va de −90 a 90.')
    expect(errorDeCentro({ ...VACIO, nombre: 'Oficina', radio: '5' })).toBe('El radio va de 20 a 5.000 metros.')
  })
})

describe('corregir en «Para revisar»', () => {
  it('la hora se escribe en Madrid, también los días del cambio de hora', () => {
    expect(isoDeMadrid('2026-10-28', '17:30')).toBe('2026-10-28T16:30:00.000Z')
    expect(isoDeMadrid('2026-07-01', '09:00')).toBe('2026-07-01T07:00:00.000Z')
    expect(isoDeMadrid('2026-10-25', '12:00')).toBe('2026-10-25T11:00:00.000Z')
    expect(isoDeMadrid('2026-03-29', '12:00')).toBe('2026-03-29T10:00:00.000Z')
    expect(isoDeMadrid('2026-10-24', '23:30')).toBe('2026-10-24T21:30:00.000Z')
  })
  it('pide día, hora y motivo; la salida va después de la entrada, y nada en el futuro', () => {
    const entrada = '2026-10-26T08:00:00.000Z' // 09:00 en Madrid
    expect(errorDeCorreccion({ dia: '2026-10-26', hora: '17:00', motivo: 'No fichó', despuesDe: entrada })).toBeNull()
    expect(errorDeCorreccion({ dia: '2026-10-26', hora: '', motivo: 'No fichó' })).toBe('Pon el día y la hora.')
    expect(errorDeCorreccion({ dia: '2026-10-26', hora: '17:00', motivo: ' ' })).toMatch(/Escribe el motivo/)
    expect(errorDeCorreccion({ dia: '2026-10-26', hora: '08:30', motivo: 'x', despuesDe: entrada })).toBe('Tiene que ser después de la entrada (09:00).')
    expect(errorDeCorreccion({ dia: '2999-01-01', hora: '08:30', motivo: 'x' })).toBe('Esa hora aún no ha llegado.')
  })
  it('qué pide cada petición, en una frase', () => {
    const base: ClockCorrectionRequest = {
      id: 'p', accountId: 'a', employeeId: 'e', requestedByEmployeeId: 'e', kind: 'add', proposedType: 'entrada',
      proposedDatetime: '2026-10-27T07:30:00.000Z', reason: 'Se me olvidó', status: 'pending', createdAt: '2026-10-27T10:00:00.000Z',
    }
    expect(textoDePeticion(base)).toMatch(/^Añadir una entrada a las 08:30 del /)
    expect(textoDePeticion({ ...base, kind: 'edit', proposedType: 'salida' })).toMatch(/^Cambiar la hora de su salida a las 08:30 del /)
    expect(textoDePeticion({ ...base, kind: 'void' })).toBe('Anular un fichaje')
  })
})

describe('la marca del portal del trabajador', () => {
  it('la de la pestaña si la hay; si no, la de la cuenta solo de Sumied; en Folvy, ninguna', () => {
    expect(marcaDelPortal(null, 'sumied')).toBe(MARCAS.sumied)
    expect(marcaDelPortal(MARCAS.sumied, null)).toBe(MARCAS.sumied)
    expect(marcaDelPortal(null, null)).toBeNull()
    expect(marcaDelPortal(null, 'folvy')).toBeNull()
    expect(marcaDelPortal(null, 'otra')).toBeNull()
  })
})
