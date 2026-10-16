// tests/e2e/conta/c06/contrasena.spec.ts
//
// C06b (respuesta 5, punto 5) · «He olvidado la contraseña» no dice si un
// correo existe: ni por lo que contesta ni por lo que TARDA. Contra la
// conta-contrasena de staging, con la misma vara a los dos lados (regla 31):
// seis correos que existen (usuarios inventados de cuentas solas del frente C)
// y seis que no, intercalados.
//
// Cada correo que existe se pide UNA sola vez: conta_contrasena_pedir no manda
// dos en 60 s al mismo correo, y desde la segunda el que existe ya no mandaría
// nada y la medida no mediría lo que quiere. Hasta el 16/10 eran dos usuarios
// en tres vueltas con 62 s de espera entre una y otra (264 s, el 13 % de la
// e2e); ahora son seis (semilla seed_c06b_contrasena_staging.sql) en una
// vuelta: las mismas seis medidas de cada lado, sin esperar.
//
// Lo que se exige: la misma respuesta (200 y el mismo cuerpo) y medianas que
// no se separen más de 400 ms. Antes del C06b, el que existe esperaba al
// enlace y al correo antes de contestar.

import { test, expect } from '@playwright/test'
import { STAGING_URL } from '../sesion'

const EXISTEN = [
  'sola.admin@c06-prueba.test', 'sola.alta@c06-prueba.test', // seed_c06_staging.sql
  'sola.correo1@c06-prueba.test', 'sola.correo2@c06-prueba.test', 'sola.correo3@c06-prueba.test', 'sola.correo4@c06-prueba.test', // seed_c06b_contrasena_staging.sql
]
const mediana = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }

test('el que existe y el que no contestan lo mismo y tardan lo mismo', async ({ request }) => {
  test.setTimeout(2 * 60_000)
  const clave = process.env.VITE_SUPABASE_ANON_KEY ?? ''
  const tiempos = { existe: [] as number[], noExiste: [] as number[] }
  const cuerpos = new Set<string>()
  // Una sola vuelta: cada correo que existe, una vez (ver arriba); intercalados con los que no.
  for (const [i, correo] of EXISTEN.entries()) {
    for (const [lado, c] of [['existe', correo], ['noExiste', `nadie.${Date.now()}.${i}@c06b-prueba.test`]] as const) {
      const t0 = Date.now()
      const r = await request.post(`${STAGING_URL}/functions/v1/conta-contrasena`, {
        headers: { apikey: clave, Authorization: `Bearer ${clave}`, 'Content-Type': 'application/json' },
        data: { correo: c, marca: 'contabilidad' },
      })
      tiempos[lado].push(Date.now() - t0)
      expect(r.status()).toBe(200)
      cuerpos.add(await r.text())
    }
  }
  // Seis medidas de cada lado, como antes (2 usuarios × 3 vueltas).
  expect(tiempos.existe).toHaveLength(6)
  expect(tiempos.noExiste).toHaveLength(6)
  console.log(`[tiempos ms] existe ${tiempos.existe.join(', ')} · no existe ${tiempos.noExiste.join(', ')} · medianas ${mediana(tiempos.existe)} y ${mediana(tiempos.noExiste)}`)
  expect([...cuerpos]).toHaveLength(1)
  expect(Math.abs(mediana(tiempos.existe) - mediana(tiempos.noExiste))).toBeLessThan(400)
})
