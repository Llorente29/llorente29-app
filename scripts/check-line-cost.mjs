import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
const ACCOUNT = '00000000-0000-0000-0000-000000000001'
const env = readFileSync(new URL('../.env', import.meta.url), 'utf8')
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1] ?? '').trim().replace(/^["']|["']$/g, '')
const sb = createClient(get('VITE_SUPABASE_URL'), get('VITE_SUPABASE_ANON_KEY'))
const { error: e0 } = await sb.auth.signInWithPassword({ email: process.env.FOLVY_EMAIL, password: process.env.FOLVY_PASSWORD })
if (e0) { console.error('login:', e0.message); process.exit(1) }
// 5 lineas casadas cuyo plato tiene coste, con modificadores en el JSON
const { data: lines, error: e1 } = await sb.from('sale_line')
  .select('id, product_name, quantity, menu_item_id')
  .eq('account_id', ACCOUNT).not('menu_item_id','is',null).limit(8)
if (e1) { console.error('select:', e1.message); process.exit(1) }
console.log('\n-- compute_sale_line_cost (impactos vacios => coste = escandallo base x qty) --')
for (const l of lines) {
  const { data: c, error: e2 } = await sb.rpc('compute_sale_line_cost', { p_sale_line_id: l.id })
  if (e2) { console.log(`  ${l.product_name}: ERROR ${e2.message}`); continue }
  console.log(`  ${String(c).padStart(10)}  x${l.quantity}  ${l.product_name}`)
}
await sb.auth.signOut()
