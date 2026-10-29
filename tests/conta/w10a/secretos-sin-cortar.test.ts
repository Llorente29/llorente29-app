// W10a (Julio, 28/10) · Lo necesario para cambiar los tres secretos expuestos
// sin cortar nada: trg_sale_push_status lee el de order-advance del Vault, las
// funciones de la plataforma aceptan <NOMBRE>_PREV durante el cambio, y una
// comprobación para que no vuelva a entrar ninguno en el repositorio.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { lineasAnadidas, secretosAnadidos } from '../../../scripts/conta/sin-secretos.mjs'
import { buscarSecretos } from '../../../scripts/staging/esquema.mjs'
import { comprobarSecreto } from '../../../supabase/functions/_shared/secretoConRelevo.ts'

// Los datos con forma de secreto se construyen aquí: nunca enteros en el
// repositorio (sin-secretos.mjs para cualquier línea añadida que lo parezca).
const FV = (para: string) => `fv_${para}_` + 'Ab0'.repeat(8)

const M = readFileSync('supabase/migrations/20261028T1630_w10a_order_advance_secreto_del_vault.sql', 'utf8')
const D = readFileSync('supabase/vuelta-atras/20261028T1630_w10a_order_advance_secreto_del_vault.down.sql', 'utf8')
const PRUEBA = readFileSync('supabase/staging/sql/20261028_w10a_order_advance_secreto_del_vault_prueba.sql', 'utf8')
const TANDA = 'supabase/produccion/tandas/folvy/claude-w10a-secretos-sin-cortar'

describe('la 1630: trg_sale_push_status lee el secreto del Vault, y nada más cambia', () => {
  const nueva = M.slice(M.indexOf('CREATE OR REPLACE FUNCTION public.trg_sale_push_status()'))
  it('no lleva ningún secreto escrito; lo lee del Vault y lo manda en la misma cabecera', () => {
    expect(buscarSecretos(M)).toEqual([])
    expect(nueva).toContain("select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'order_advance_secret';")
    expect(nueva).toContain("'x-order-advance-secret',  v_secret")
  })
  it('lo demás, como estaba: los mismos estados, la misma dirección y el mismo cuerpo de la llamada', () => {
    expect(nueva).toContain("'in_preparation','awaiting_collection','awaiting_shipment',\n    'in_delivery','completed','rejected','cancelled','delivery_failed'")
    expect(nueva).toContain("if new.source = 'lastapp' and new.order_status = any(v_pushable) then")
    expect(nueva).toMatch(/url {5}:= 'https:\/\/[a-z0-9]{20}\.supabase\.co\/functions\/v1\/order-advance',/)
    expect(nueva).toContain("'sale_id',    new.id,\n        'new_status', new.order_status,\n        'internal',   true")
  })
  it('si falta el secreto, no llama, avisa y deja seguir el pedido', () => {
    expect(nueva).toMatch(/if v_secret is null then[\s\S]*_queue_system_alert\([\s\S]*return new;\n {4}end if;/)
  })
  it('la guarda va antes de nada y para si la función cambió o el Vault no tiene el mismo valor', () => {
    const g = M.indexOf('do $guarda$')
    expect(g).toBeGreaterThan(0)
    expect(g).toBeLessThan(M.indexOf('_respaldar_funcion('))
    expect(M).toContain("if md5(v_def) <> '2470441d8329691b9c0e1d1017f87a41' then")
    expect(M).toContain('if v_vault is not null and v_vault <> v_escrito then')
    expect(M).toContain("en producción el Vault no tiene order_advance_secret")
  })
  it('respaldo antes y restauración en la vuelta atrás; una sola firma, sin drop', () => {
    expect(M.indexOf("select public._respaldar_funcion('public.trg_sale_push_status()', '20261028T1630_w10a_order_advance_secreto_del_vault');"))
      .toBeLessThan(M.indexOf('CREATE OR REPLACE FUNCTION'))
    expect(D).toContain("select public._restaurar_funcion('public.trg_sale_push_status()', '20261028T1630_w10a_order_advance_secreto_del_vault');")
    expect(M).not.toMatch(/\bdrop\s+function\b/i)
  })
  it('la tanda: la 1630 con su cuenta, su vuelta atrás, y la prueba de staging recorre el camino de verdad', () => {
    const aplicar = readFileSync(`${TANDA}/aplicar.txt`, 'utf8').split('\n').filter((l) => l && !l.startsWith('#'))
    expect(aplicar).toEqual([
      'supabase/migrations/20261028T1630_w10a_order_advance_secreto_del_vault.sql',
      'cuenta: scripts/conta/produccion/cuentas/w10a-order-advance-secreto.sql',
    ])
    expect(readFileSync(`${TANDA}/vuelta-atras.txt`, 'utf8')).toContain('supabase/vuelta-atras/20261028T1630_w10a_order_advance_secreto_del_vault.down.sql')
    expect(PRUEBA).toContain("update public.sale set order_status = 'in_preparation'")
    expect(PRUEBA).toContain("vault.create_secret('secreto-de-prueba-w10a', 'order_advance_secret')")
    expect(PRUEBA.trim().endsWith('rollback;')).toBe(true)
    expect(buscarSecretos(PRUEBA)).toEqual([])
  })
})

describe('el relevo: durante el cambio, la función acepta el vigente y el anterior', () => {
  const env = (m: Record<string, string>) => (k: string) => m[k]
  it('con el vigente entra; con el anterior, solo si existe <NOMBRE>_PREV; con otro, no', () => {
    const e = env({ X_SECRET: 'nuevo', X_SECRET_PREV: 'viejo' })
    expect(comprobarSecreto('nuevo', 'X_SECRET', e)).toBe('vigente')
    expect(comprobarSecreto('viejo', 'X_SECRET', e)).toBe('anterior')
    expect(comprobarSecreto('otro', 'X_SECRET', e)).toBeNull()
    expect(comprobarSecreto('viejo', 'X_SECRET', env({ X_SECRET: 'nuevo' }))).toBeNull()
  })
  it('sin secreto configurado, nada entra (tampoco una cadena vacía)', () => {
    expect(comprobarSecreto('', 'X_SECRET', env({}))).toBeNull()
    expect(comprobarSecreto('', 'X_SECRET', env({ X_SECRET: '', X_SECRET_PREV: '' }))).toBeNull()
  })
  it('las cuatro funciones de la plataforma que solo aceptaban uno usan el relevo; order-advance ya lo tenía', () => {
    for (const [f, n] of [['availability-dispatch', 'AVAILABILITY_DISPATCH_SECRET'], ['hubrise-location-dispatch', 'LOCATION_STATUS_DISPATCH_SECRET'],
      ['last-catalog-probe', 'AVAILABILITY_DISPATCH_SECRET'], ['lastapp-set-price', 'AVAILABILITY_DISPATCH_SECRET']]) {
      const t = readFileSync(`supabase/functions/${f}/index.ts`, 'utf8')
      expect(t).toContain('comprobarSecreto(')
      expect(t).toContain(`"${n}")`)
      expect(t).not.toMatch(new RegExp(`Deno\\.env\\.get\\("${n}"\\)`))
    }
    expect(readFileSync('supabase/functions/order-advance/index.ts', 'utf8')).toContain('Deno.env.get("ORDER_ADVANCE_SECRET_PREV")')
  })
})

describe('sin-secretos: ninguna línea añadida trae un secreto, en ningún fichero', () => {
  const diff = (f: string, lineas: string[]) => `diff --git a/${f} b/${f}\n--- a/${f}\n+++ b/${f}\n@@ -0,0 +1,${lineas.length} @@\n` + lineas.map((l) => `+${l}`).join('\n') + '\n'
  it('los fv_… internos son secreto; el nombre de función fv_e164_or_null, no', () => {
    expect(buscarSecretos(`'x-order-advance-secret',  '${FV('oadv')}'`)[0].que).toContain('fv_')
    expect(buscarSecretos('  v_phone := public.fv_e164_or_null(s.customer_phone);')).toEqual([])
  })
  it('lo ve en cualquier fichero: un .md, un .json, un .sql o un .ts', () => {
    expect(secretosAnadidos(diff('CONTEXTO_CLAUDE.md', ['nada', `clave: ${FV('locst')}`]))).toEqual([{ fichero: 'CONTEXTO_CLAUDE.md', linea: 2, que: 'un secreto interno de Folvy (fv_…)' }])
    expect(secretosAnadidos(diff('promo-agent/config.example.json', [`  "PUSH_AGENT_SECRET": "${FV('push')}",`]))).toHaveLength(1)
    expect(secretosAnadidos(diff('supabase/migrations/x.sql', [`  'x-availability-dispatch-secret', '${FV('avl')}'`]))).toHaveLength(1)
    expect(secretosAnadidos(diff('src/x.ts', ['const sk = "sk_' + 'live_' + 'A'.repeat(24) + '"']))[0].que).toContain('Stripe')
  })
  it('solo lo añadido: lo que se quita o ya estaba no cuenta', () => {
    const d = `diff --git a/a.md b/a.md\n--- a/a.md\n+++ b/a.md\n@@ -3 +3 @@\n-clave: ${FV('avl')}\n+clave: (en el Vault)\n`
    expect(secretosAnadidos(d)).toEqual([])
    expect(lineasAnadidas(d)).toEqual([{ fichero: 'a.md', linea: 3, texto: 'clave: (en el Vault)' }])
  })
  it('la clave anon (pública) no cuenta', () => {
    const anon = 'eyJhbGciOiJIUzI1NiJ9.' + Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url') + '.firmaDePruebaFirma'
    expect(secretosAnadidos(diff('.github/workflows/x.yml', [`  ANON: ${anon}`]))).toEqual([])
  })
  it('corre en cada PR a main y en antes-de-subir', () => {
    expect(readFileSync('.github/workflows/pr-a-main.yml', 'utf8')).toContain('node scripts/conta/sin-secretos.mjs "$BASE" "$HEAD"')
    expect(readFileSync('scripts/conta/antes-de-subir.sh', 'utf8')).toContain('node scripts/conta/sin-secretos.mjs')
  })
})
