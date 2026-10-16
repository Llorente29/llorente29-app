// tests/e2e/conta/c06/contrasena.spec.ts
//
// C06b (respuesta 5, punto 5) · «He olvidado la contraseña» no dice si un
// correo existe: ni por lo que contesta ni por lo que TARDA. Contra la
// conta-contrasena de staging, con la misma vara a los dos lados (regla 31):
// dos correos que existen (usuarios inventados de la cuenta sola del frente C)
// y dos que no, intercalados, en tres vueltas separadas por más de un minuto
// (el límite de uno por minuto haría que, desde la segunda, el que existe ya
// no mandara nada y la medida no mediría lo que quiere).
//
// Lo que se exige: la misma respuesta (200 y el mismo cuerpo) y medianas que
// no se separen más de 400 ms. Antes del C06b, el que existe esperaba al
// enlace y al correo antes de contestar.

import { test, expect } from '@playwright/test'
import { STAGING_URL, correoDelCarril } from '../sesion'

const EXISTEN = ['sola.admin@c06-prueba.test', 'sola.alta@c06-prueba.test'].map((c) => correoDelCarril(c))
const mediana = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }

test('el que existe y el que no contestan lo mismo y tardan lo mismo', async ({ request }) => {
  test.setTimeout(6 * 60_000)
  const clave = process.env.VITE_SUPABASE_ANON_KEY ?? ''
  const tiempos = { existe: [] as number[], noExiste: [] as number[] }
  const cuerpos = new Set<string>()
  for (let vuelta = 0; vuelta < 3; vuelta++) {
    if (vuelta > 0) await new Promise((r) => setTimeout(r, 62_000))
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
  }
  console.log(`[tiempos ms] existe ${tiempos.existe.join(', ')} · no existe ${tiempos.noExiste.join(', ')} · medianas ${mediana(tiempos.existe)} y ${mediana(tiempos.noExiste)}`)
  expect([...cuerpos]).toHaveLength(1)
  expect(Math.abs(mediana(tiempos.existe) - mediana(tiempos.noExiste))).toBeLessThan(400)
})
