// tests/unit/build/guardaVistaPrevia.test.ts
//
// La guarda que impide construir en Vercel la vista previa de una rama conta/**
// o reparto-** contra producción (05/10: la del C02 iba contra producción).
// La clave de staging es la real (la del workflow de e2e, pública); la de
// producción se fabrica aquí con el ref de producción: no es una clave real.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { motivoParaParar } from '../../../build/guardaVistaPrevia'

const yml = readFileSync('.github/workflows/e2e-staging-conta.yml', 'utf8')
const STAGING_URL = yml.match(/VITE_SUPABASE_URL: (\S+)/)![1]
const STAGING_CLAVE = yml.match(/VITE_SUPABASE_ANON_KEY: (\S+)/)![1]
const PROD_URL = 'https://xzmpnchlguibclvxyynt.supabase.co'
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
const PROD_CLAVE = `${b64({ alg: 'HS256' })}.${b64({ iss: 'supabase', ref: 'xzmpnchlguibclvxyynt', role: 'anon' })}.firma`

const vista = (rama: string, url?: string, clave?: string) =>
  motivoParaParar({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: rama, VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: clave })

describe('guarda de la vista previa', () => {
  it('la del C02 sin variables de rama (coge las generales, de producción): no se construye', () => {
    const m = vista('conta/c02-plan-contable', PROD_URL, PROD_CLAVE)
    expect(m).toMatch(/^La vista previa de «conta\/c02-plan-contable» se construiría contra la base «xzmpnchlguibclvxyynt», no contra staging-conta/)
    expect(m).toContain('solo «Preview» y solo la rama «conta/c02-plan-contable»')
  })
  it('con las dos de staging-conta, sí', () => {
    expect(STAGING_URL).toContain('oseymswjlzplqoxrfjzi')
    expect(vista('conta/c02-plan-contable', STAGING_URL, STAGING_CLAVE)).toBeNull()
    expect(vista('reparto-r02-marca-plataforma', STAGING_URL, STAGING_CLAVE)).toBeNull()
  })
  it('la URL de staging con la clave de producción (una variable sí y otra no): no', () => {
    expect(vista('conta/c02-plan-contable', STAGING_URL, PROD_CLAVE)).toMatch(/la clave anónima de «xzmpnchlguibclvxyynt»/)
  })
  it('sin URL: no', () => {
    expect(vista('reparto-r03', undefined, STAGING_CLAVE)).toMatch(/contra ninguna base/)
  })
  it('no toca producción, otras ramas, ni lo que no es Vercel', () => {
    expect(motivoParaParar({ VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'main', VITE_SUPABASE_URL: PROD_URL, VITE_SUPABASE_ANON_KEY: PROD_CLAVE })).toBeNull()
    expect(vista('claude/otra-cosa', PROD_URL, PROD_CLAVE)).toBeNull()
    expect(motivoParaParar({ VITE_SUPABASE_URL: PROD_URL })).toBeNull() // npm run build en local, y el bundle OTA
  })
})
