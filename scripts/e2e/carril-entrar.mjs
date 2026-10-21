#!/usr/bin/env node
// scripts/e2e/carril-entrar.mjs <N>
//
// W02 (paso 1c): los usuarios del carril N entran con la contraseña de
// un solo uso (CLAVE_PRUEBAS) y cada uno ve SU cuenta del carril, no la de la
// plantilla ni la de otro carril. Es lo primero que haría una prueba: si esto
// falla, el carril no sirve y se dice aquí, no a mitad de la suite.
//
// Entorno: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY (públicas), CLAVE_PRUEBAS.

import { enCarril, correoDelCarril } from './carril.mjs'

const n = Number(process.argv[2])
const URL_ = process.env.VITE_SUPABASE_URL
const ANON = process.env.VITE_SUPABASE_ANON_KEY
const CLAVE = process.env.CLAVE_PRUEBAS
if (!Number.isInteger(n) || n < 1 || !URL_ || !ANON || !CLAVE) {
  console.error('uso: CLAVE_PRUEBAS=… VITE_SUPABASE_URL=… VITE_SUPABASE_ANON_KEY=… carril-entrar.mjs <N>')
  process.exit(2)
}

// Los de la plantilla (ocho desde el S01) y la cuenta que tiene que ver cada uno (null: ninguna, el de plataforma).
const PLANTILLA = [
  ['a.admin@prueba.folvy.test', 'c01a0000-0000-4000-8000-00000000000a'],
  ['a.encargado@prueba.folvy.test', 'c01a0000-0000-4000-8000-00000000000a'],
  ['b.admin@prueba.folvy.test', 'c01b0000-0000-4000-8000-00000000000b'],
  ['c.admin@prueba.folvy.test', 'c01c0000-0000-4000-8000-00000000000c'],
  ['d.admin@prueba.folvy.test', 'c01d0000-0000-4000-8000-00000000000d'],
  ['sola.admin@c06-prueba.test', null],
  ['sola.alta@c06-prueba.test', null],
  ['c06.plataforma@c06-prueba.test', null],
]

async function entrar(correo) {
  const r = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: correo, password: CLAVE }),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`${correo}: ${r.status} ${j.error_description ?? j.msg ?? ''}`)
  return j.access_token
}

async function perfiles(token) {
  const r = await fetch(`${URL_}/rest/v1/user_profiles?select=account_id`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } })
  if (!r.ok) throw new Error(`user_profiles: ${r.status}`)
  return (await r.json()).map((p) => p.account_id)
}

let mal = 0
for (const [correo, cuenta] of PLANTILLA) {
  const suyo = correoDelCarril(correo, n)
  try {
    const t = await entrar(suyo)
    const ve = await perfiles(t)
    const fuera = ve.filter((a) => a && !a.includes(`-${n.toString(16).padStart(4, '0')}-`))
    if (cuenta && !ve.includes(enCarril(cuenta, n))) throw new Error(`no ve su cuenta del carril (${enCarril(cuenta, n)}); ve: ${ve.join(', ') || 'nada'}`)
    if (cuenta && fuera.length) throw new Error(`ve cuentas que no son del carril: ${fuera.join(', ')}`)
    console.log(`✓ ${suyo} entra${cuenta ? ` y ve su cuenta ${enCarril(cuenta, n)}` : ''}`)
  } catch (e) {
    mal++
    console.error(`✗ ${suyo}: ${e.message}`)
  }
}
// Y el de la plantilla NO entra con esta contraseña (no se le ha tocado).
try { await entrar(PLANTILLA[0][0]); mal++; console.error('✗ el usuario de la PLANTILLA entra con la contraseña del carril') } catch { console.log('✓ el de la plantilla no entra con la contraseña del carril') }
if (mal) process.exit(1)
