// tests/unit/modules/conta/r18/actualizarBitrix.test.ts
//
// R18b · Lo que dice el bloque «Actualizar Bitrix24» de Ajustes (src/modules/conta/gestoria/actualizarBitrix.ts).

import { describe, expect, it } from 'vitest'
import { LINEA_APAGADO, textosActualizar } from '@/modules/conta/gestoria/actualizarBitrix'
import type { EstadoActualizar } from '@/modules/conta/services/gestoriaService'

const e = (x: Partial<EstadoActualizar>): EstadoActualizar => ({ actualizar: false, quien: null, cuando: null, clave: false, claveQuien: null, claveCuando: null, puedeEncender: false, ...x })

describe('R18b · «Actualizar Bitrix24» en Ajustes', () => {
  it('de serie: apagado, la línea de arriba y sin botón (ni clave ni poder encender)', () => {
    expect(textosActualizar(e({}))).toEqual({ linea: LINEA_APAGADO, tono: 'apagado', clave: 'Aún no hay clave para actualizar Bitrix24.', boton: null })
    expect(LINEA_APAGADO).toBe('Bitrix24 no se actualiza: lo enciende Julio en Ajustes.')
  })
  it('la administradora con la clave puesta tampoco ve «Encender»: solo Julio', () => {
    expect(textosActualizar(e({ clave: true })).boton).toBeNull()
  })
  it('Julio, sin clave, no puede encenderlo; con clave, sí', () => {
    expect(textosActualizar(e({ puedeEncender: true })).boton).toBeNull()
    expect(textosActualizar(e({ puedeEncender: true, clave: true })).boton).toEqual({ texto: 'Encender', on: true })
  })
  it('encendido: dice quién y cuándo, y cualquiera con permiso lo apaga', () => {
    const t = textosActualizar(e({ actualizar: true, quien: 'Julio', cuando: '2026-11-25T09:00:00Z', clave: true, claveQuien: 'Anny', claveCuando: '2026-11-24T18:00:00Z' }))
    expect(t).toEqual({ linea: 'Encendido por Julio el 25/11/2026: Sumied actualiza Bitrix24, solo en la ficha de prueba.', tono: 'encendido',
      clave: 'Clave para actualizar guardada por Anny el 24/11/2026. No se enseña.', boton: { texto: 'Apagar', on: false } })
  })
  it('sin palabras de dentro', () => {
    for (const x of [e({}), e({ actualizar: true, clave: true })]) {
      const t = textosActualizar(x)
      expect(`${t.linea} ${t.clave}`).not.toMatch(/webhook|placement|token/i)
    }
  })
})
