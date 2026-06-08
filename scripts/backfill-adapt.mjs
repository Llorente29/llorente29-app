import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
const ACCOUNT = '00000000-0000-0000-0000-000000000001'
const env = readFileSync(new URL('../.env', import.meta.url), 'utf8')
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1] ?? '').trim().replace(/^["']|["']$/g, '')
const sb = createClient(get('VITE_SUPABASE_URL'), get('VITE_SUPABASE_ANON_KEY'))
const { error: e0 } = await sb.auth.signInWithPassword({ email: process.env.FOLVY_EMAIL, password: process.env.FOLVY_PASSWORD })
if (e0) { console.error('login:', e0.message); process.exit(1) }
// todas las ventas lastapp activas
const { data: sales, error: e1 } = await sb.from('sale').select('id').eq('account_id',ACCOUNT).eq('source','lastapp').eq('is_active',true)
if (e1) { console.error('select:', e1.message); process.exit(1) }
console.log('Ventas a adaptar:', sales.length)
let ok=0, err=0, lineas=0
for (const s of sales) {
  const { data:n, error } = await sb.rpc('adapt_lastapp_order', { p_sale_id: s.id })
  if (error) { err++; if(err<=3) console.log('  err', s.id, error.message) } else { ok++; lineas += n }
}
console.log(`\nAdaptadas: ${ok} | errores: ${err} | lineas canonicas creadas: ${lineas}`)
// resumen por line_type
const { data: tipos } = await sb.from('sale_line').select('line_type').eq('account_id',ACCOUNT)
const cnt = {}; for(const t of tipos) cnt[t.line_type]=(cnt[t.line_type]||0)+1
console.log('Por line_type:', JSON.stringify(cnt))
await sb.auth.signOut()
