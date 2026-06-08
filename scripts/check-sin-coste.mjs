// scripts/check-sin-coste.mjs
// Verifica las columnas nuevas de sales_mapping_reliability (casado sin coste).
// Login real (SECURITY DEFINER necesita sesión; el SQL Editor no la tiene).
//
// Uso (PowerShell):
//   $env:FOLVY_EMAIL='jgcolon@idasal.com'; $env:FOLVY_PASSWORD='...'; node scripts/check-sin-coste.mjs; Remove-Item Env:\FOLVY_EMAIL; Remove-Item Env:\FOLVY_PASSWORD

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const ACCOUNT = '00000000-0000-0000-0000-000000000001'

// Leer URL y anon key del .env del repo.
const env = readFileSync(new URL('../.env', import.meta.url), 'utf8')
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1] ?? '').trim().replace(/^["']|["']$/g, '')
const url = get('VITE_SUPABASE_URL')
const anon = get('VITE_SUPABASE_ANON_KEY')

const email = process.env.FOLVY_EMAIL
const password = process.env.FOLVY_PASSWORD
if (!email || !password) {
  console.error('Faltan FOLVY_EMAIL / FOLVY_PASSWORD en el entorno.')
  process.exit(1)
}

const supabase = createClient(url, anon)

const { error: authErr } = await supabase.auth.signInWithPassword({ email, password })
if (authErr) { console.error('Login falló:', authErr.message); process.exit(1) }

const { data, error } = await supabase.rpc('sales_mapping_reliability', {
  p_account_id: ACCOUNT,
  p_from: new Date(Date.now() - 90 * 864e5).toISOString(),
  p_to: new Date().toISOString(),
})
if (error) { console.error('RPC error:', error.message); process.exit(1) }

const r = Array.isArray(data) ? data[0] : data
console.log('\n── Señal de fiabilidad ──')
console.log('vendido total      :', r.revenue_total, '€')
console.log('casado             :', r.revenue_casado, '€')
console.log('fiabilidad (casado):', r.reliability_pct, '%  ·', r.status)
console.log('\n── Casado pero SIN COSTE (mecanismo de avisos) ──')
console.log('sin coste          :', r.casado_sin_coste_eur, '€  ·', r.casado_sin_coste_lineas, 'líneas')
console.log('cobertura de coste :', r.cost_coverage_pct, '%  (del casado, cuánto tiene coste conocido)')

await supabase.auth.signOut()
