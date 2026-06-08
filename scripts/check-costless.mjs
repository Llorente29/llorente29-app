import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
const ACCOUNT = '00000000-0000-0000-0000-000000000001'
const env = readFileSync(new URL('../.env', import.meta.url), 'utf8')
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1] ?? '').trim().replace(/^["']|["']$/g, '')
const supabase = createClient(get('VITE_SUPABASE_URL'), get('VITE_SUPABASE_ANON_KEY'))
const email = process.env.FOLVY_EMAIL, password = process.env.FOLVY_PASSWORD
const { error: authErr } = await supabase.auth.signInWithPassword({ email, password })
if (authErr) { console.error('Login fallo:', authErr.message); process.exit(1) }
const { data, error } = await supabase.rpc('list_costless_sold_products', { p_account_id: ACCOUNT, p_from: new Date(Date.now()-90*864e5).toISOString(), p_to: new Date().toISOString() })
if (error) { console.error('RPC error:', error.message); process.exit(1) }
console.log('\n-- Productos vendidos SIN coste (por importe) --')
let suma = 0
for (const r of data) { suma += Number(r.importe ?? 0); const tipo = r.has_recipe_lines ? 'escandallo a medias' : (r.is_purchasable ? 'comprable' : 'cascaron'); console.log(`${String(r.importe).padStart(8)} EUR  ${String(r.ventas).padStart(3)} ventas  ${r.recipe_type}/${tipo}  ${r.product_name}`) }
console.log('-'.repeat(50)); console.log(`${data.length} productos - ${suma.toFixed(2)} EUR food cost desconocido`)
await supabase.auth.signOut()
