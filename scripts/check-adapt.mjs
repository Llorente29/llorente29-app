import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
const ACCOUNT = '00000000-0000-0000-0000-000000000001'
const env = readFileSync(new URL('../.env', import.meta.url), 'utf8')
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1] ?? '').trim().replace(/^["']|["']$/g, '')
const sb = createClient(get('VITE_SUPABASE_URL'), get('VITE_SUPABASE_ANON_KEY'))
const { error: e0 } = await sb.auth.signInWithPassword({ email: process.env.FOLVY_EMAIL, password: process.env.FOLVY_PASSWORD })
if (e0) { console.error('login:', e0.message); process.exit(1) }
// una venta que tenga un combo
const { data: line } = await sb.from('sale_line').select('sale_id, product_name').eq('account_id',ACCOUNT).ilike('product_name','%combo burger single%').limit(1)
if (!line?.length) { console.log('no encontrada'); process.exit(0) }
const saleId = line[0].sale_id
console.log('Venta de prueba:', saleId)
// adaptar SOLO esa venta
const { data: n, error: e1 } = await sb.rpc('adapt_lastapp_order', { p_sale_id: saleId })
if (e1) { console.error('adapt error:', e1.message); process.exit(1) }
console.log('Líneas canónicas creadas:', n)
// ver la jerarquía resultante
const { data: lines } = await sb.from('sale_line').select('id, parent_sale_line_id, line_type, product_name, unit_price, menu_item_id, modifier_option_id, map_needs_review').eq('sale_id', saleId).order('parent_sale_line_id',{nullsFirst:true})
console.log('\n-- jerarquia --')
for (const l of lines) {
  const indent = l.parent_sale_line_id ? '    └─ ' : ''
  console.log(`${indent}[${l.line_type}] ${l.product_name}  ${l.unit_price}€  menu=${l.menu_item_id?'si':'NO'} modopt=${l.modifier_option_id?'si':'-'} rev=${l.map_needs_review?'!':''}`)
}
await sb.auth.signOut()
