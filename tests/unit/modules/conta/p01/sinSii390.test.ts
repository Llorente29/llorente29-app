// tests/unit/modules/conta/p01/sinSii390.test.ts
//
// P01 · 0380 (Julio, 21/10): quien lleva el SII no presenta el 390. La regla
// vive en tres sitios y tiene que decir lo mismo en los tres: la base
// (conta_impuesto_reglas, la que escribe los modelos en el alta), la app
// (ANUAL_SIN_SII de src/modules/conta/lib/modelos.ts) y el agente de
// cumplimiento (scripts/conta/lib/coherencia.mjs). Y la 0380 es la 0250 byte a
// byte más su condición: nada más se mueve.

import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { ANUAL_SIN_SII } from '@/modules/conta/lib/modelos'
import { ANUAL_SIN_SII as ANUAL_SIN_SII_AGENTE } from '../../../../../scripts/conta/lib/coherencia.mjs'

const M0250 = readFileSync('supabase/migrations/20261122T0250_i01b_349_por_operaciones.sql', 'utf8')
const M0380 = readFileSync('supabase/migrations/20261130T0380_p01_390_sin_sii.sql', 'utf8')
const BAJA = readFileSync('supabase/vuelta-atras/20261130T0380_p01_390_sin_sii.down.sql', 'utf8')
const cuerpo = (sql: string) => {
  const i = sql.indexOf('create or replace function public.conta_impuesto_reglas')
  const m = /as \$\$([\s\S]*?)\$\$;/.exec(sql.slice(i))
  return m![1]
}
const md5 = (s: string) => createHash('md5').update(s).digest('hex')

describe('con el SII no va el 390: lo mismo en la base, la app y el agente', () => {
  it('la app y el agente, la misma excepción y la misma norma', () => {
    expect(ANUAL_SIN_SII).toEqual(ANUAL_SIN_SII_AGENTE)
    expect(Object.keys(ANUAL_SIN_SII)).toEqual(['390'])
  })
  it('la base, la misma norma que la app, y el porqué en palabras de oficina', () => {
    expect(M0380).toContain(`'norma', '${ANUAL_SIN_SII['390']}'`)
    expect(cuerpo(M0380)).toContain("why := 'Llevas el SII: no presentas el 390 (instrucciones del modelo 390, AEAT).';")
    expect(cuerpo(M0380)).toMatch(/if t\.annual_form_code = '390' and active and coalesce\(p\.sii, false\) then\n\s+active := false;/)
  })
})

describe('la 0380 es la 0250 más su condición, y la vuelta atrás es la 0250', () => {
  it('el cuerpo de la 0250 es el que hay en producción y en staging (md5 8d6cce36…, medido el 21/10)', () => {
    expect(md5(cuerpo(M0250))).toBe('8d6cce36753a63009a2a1a71cf4f99fa')
  })
  it('quitando el bloque de la 0380, queda la 0250 byte a byte', () => {
    const sinBloque = cuerpo(M0380).replace(/ {4}-- 0380 \(Julio, 21\/10\)[\s\S]*? {4}end if;\n/, '')
    expect(sinBloque).toBe(cuerpo(M0250))
  })
  it('misma firma (create or replace con uuid): no es un parámetro nuevo (regla 2)', () => {
    expect(M0380).toContain('create or replace function public.conta_impuesto_reglas(p_company uuid)')
    expect(M0380.match(/create or replace function/g)).toHaveLength(1)
  })
  it('la vuelta atrás deja la 0250 byte a byte', () => {
    expect(md5(cuerpo(BAJA))).toBe('8d6cce36753a63009a2a1a71cf4f99fa')
  })
  it('la cabecera declara lo que cambia y su prueba de staging, que existe y lo nombra', () => {
    expect(M0380.split('\n')[0]).toBe('-- cambia: public.conta_impuesto_reglas · prueba: supabase/staging/sql/20261130_p01_390_sin_sii_prueba.sql')
    expect(readFileSync('supabase/staging/sql/20261130_p01_390_sin_sii_prueba.sql', 'utf8')).toContain('public.conta_impuesto_reglas')
  })
})
