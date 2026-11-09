// GD · Los datos de la demo: inventados, bien formados y que cuentan lo que tienen que contar.
import { describe, expect, it } from 'vitest'
import { CLIENTES, NIF_EMISORES, SOLO_EN_GOCARDLESS, cifConControl, correoDelCliente, dniConLetra, ibanDePrueba, ibanValido, resumen } from '../../../../../scripts/conta/gd/datos'
import { normalizarNif } from '../../../../../supabase/functions/_shared/crm/ficha'

describe('GD · datos de la demo', () => {
  it('los controles: CIF y DNI conocidos, e IBAN que cuadran', () => {
    // Los mismos que usa la semilla de Casa Lola (B00000018) y el 00000000T de siempre.
    expect(cifConControl('0000001')).toBe('B00000018')
    expect(dniConLetra('00000000')).toBe('00000000T')
    expect(ibanValido('ES9121000418450200051332')).toBe(true)
    for (let n = 0; n < 60; n++) expect(ibanValido(ibanDePrueba(n))).toBe(true)
    expect(new Set(Array.from({ length: 60 }, (_, n) => ibanDePrueba(n))).size).toBe(60)
  })

  it('40 clientes, con NIF y correo únicos, y ninguno que choque con los emisores', () => {
    expect(CLIENTES).toHaveLength(40)
    const nifs = [...CLIENTES.map((c) => c.nif), NIF_EMISORES.sociedad, NIF_EMISORES.autonomo, SOLO_EN_GOCARDLESS.nif]
    expect(new Set(nifs).size).toBe(nifs.length)
    for (const n of nifs) expect(normalizarNif(n)).toBe(n)
    const correos = CLIENTES.map(correoDelCliente)
    expect(new Set(correos).size).toBe(40)
    for (const c of correos) expect(c).toMatch(/^[a-z0-9.]+@example\.com$/)
  })

  it('las situaciones variadas y un caso para cada tarjeta de «Lo que tienes que hacer»', () => {
    const r = resumen()
    expect(r.porSituacion).toEqual({ Activo: 31, Moroso: 4, Baja: 3, 'Solo renta': 2 })
    expect(r.porTipo).toEqual({ sociedad: 30, autonomo: 10 })
    expect(r.escenarios).toEqual(['Successful: Clínica Dental Sonrisas, S.L.', 'Fickle: Veterinaria Cuatro Patas, S.L.', 'Penniless: Electricidad Voltio, S.L.'])
    // Mandato por firmar: activo, cobra con GoCardless (emisor sociedad) y sin mandato.
    expect(CLIENTES.some((c) => c.situacion === 'Activo' && c.emisor === 'sociedad' && !c.gc)).toBe(true)
    // Activo sin cuota: con mandato y sin ninguna suscripción.
    expect(CLIENTES.some((c) => c.situacion === 'Activo' && c.gc && c.gc.mensual === null && c.gc.trabajadores.length === 0)).toBe(true)
    // Ningún autónomo en GoCardless: el sandbox es del emisor sociedad.
    expect(CLIENTES.filter((c) => c.emisor === 'autonomo').every((c) => !c.gc)).toBe(true)
    // Los escenarios solo en sociedades (su nombre sale de company_name: el given_name especial no se ve).
    expect(CLIENTES.filter((c) => c.gc && c.gc.escenario !== 'normal').every((c) => c.tipo === 'sociedad')).toBe(true)
  })

  it('importes redondos que se leen bien', () => {
    const r = resumen()
    expect(r.alMes % 5).toBe(0)
    for (const c of CLIENTES) expect(c.cuota % 5).toBe(0)
  })
})
