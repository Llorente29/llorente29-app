// L1a · PR 1. El texto de qué se guarda tiene que decir lo que hace la base:
// se compara con la migración, no con lo que uno recuerda de ella.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  APARTADOS_REGISTRO_DE_JORNADA, htmlDelTextoRegistroDeJornada,
} from '../../../src/lib/registroDeJornadaTexto'

const MIGRACION = readFileSync(
  resolve(__dirname, '../../../supabase/migrations/20261027T1905_l1a_fichar_en_el_servidor.sql'), 'utf8')
const TEXTO = APARTADOS_REGISTRO_DE_JORNADA.flatMap(a => a.parrafos).join(' ')

describe('el texto de qué se guarda dice lo que hace la base', () => {
  it('la ubicación exacta, tres meses', () => {
    expect(MIGRACION).toMatch(/v_corte_ubicacion timestamptz := now\(\) - interval '3 months'/)
    expect(TEXTO).toMatch(/ubicación exacta, tres meses/)
  })
  it('el registro, cuatro años', () => {
    expect(MIGRACION).toMatch(/v_corte_registro timestamptz := now\(\) - interval '4 years'/)
    expect(TEXTO).toMatch(/registro de jornada, cuatro años/)
  })
  it('sin red, como mucho tres días', () => {
    expect(MIGRACION).toMatch(/p_hora_declarada < now\(\) - interval '72 hours'/)
    expect(TEXTO).toMatch(/más de tres días sin red/)
  })
  it('fuera del radio, por defecto se guarda marcado', () => {
    expect(MIGRACION).toMatch(/clock_geofence_mode set default 'warn'/)
    expect(TEXTO).toMatch(/por defecto el fichaje se guarda igual/)
  })
})

describe('la página que descarga la empresa', () => {
  it('lleva todos los apartados y escapa el nombre de la empresa', () => {
    const html = htmlDelTextoRegistroDeJornada('Bar <Pepe> & Cía')
    for (const a of APARTADOS_REGISTRO_DE_JORNADA) expect(html).toContain(`<h2>${a.titulo}</h2>`)
    expect(html).toContain('Bar &lt;Pepe&gt; &amp; Cía')
    expect(html).not.toContain('<Pepe>')
  })
})
