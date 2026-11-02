// W10 (Julio, 28/10; rehecho el 02/11) · Staging no llama a producción: las 24 funciones leen
// la dirección de su propio proyecto del Vault, el secreto de order-advance
// también, y una comprobación para que ninguna migración nueva vuelva a
// escribir una dirección o un secreto.
import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { direccionesYSecretos } from '../../../scripts/conta/sql-sin-direccion.mjs'
import { lineasAnadidas, secretosAnadidos } from '../../../scripts/conta/sin-secretos.mjs'
import { buscarSecretos } from '../../../scripts/staging/esquema.mjs'
import { comprobarSecreto } from '../../../supabase/functions/_shared/secretoConRelevo.ts'

// Los datos con forma de secreto se construyen aquí: nunca enteros en el
// repositorio (sin-secretos.mjs para cualquier línea añadida que lo parezca).
const FV = (para: string) => `fv_${para}_` + 'Ab0'.repeat(8)

const M0201 = readFileSync('supabase/migrations/20261102T0201_w10_project_url.sql', 'utf8')
const M0202 = readFileSync('supabase/migrations/20261102T0202_w10_funciones_leen_su_proyecto.sql', 'utf8')
const D0202 = readFileSync('supabase/vuelta-atras/20261102T0202_w10_funciones_leen_su_proyecto.down.sql', 'utf8')
const PRUEBA = readFileSync('supabase/staging/sql/20261102_w10_funciones_leen_su_proyecto_prueba.sql', 'utf8')
const DIR_TANDA = 'supabase/produccion/tandas/folvy/claude-w10-funciones-leen-su-proyecto'

describe('la comprobación: ni direcciones ni secretos escritos (punto 4)', () => {
  it('las migraciones del W10 no llevan ninguna', () => {
    expect(direccionesYSecretos(M0201)).toEqual([])
    expect(direccionesYSecretos(M0202)).toEqual([])
    expect(direccionesYSecretos(D0202)).toEqual([])
  })
  it('con la población real: las migraciones de antes que escribían la dirección (y el secreto), las ve', () => {
    // La de set_location_status (30/07) lleva la dirección y el secreto del despacho de locales.
    const loc = direccionesYSecretos(readFileSync('supabase/migrations/20260730T1620_set_location_status.sql', 'utf8'))
    expect(loc.map((x) => x.que)).toContain('la dirección de un proyecto de Supabase')
    expect(loc.map((x) => x.que)).toContain('un secreto interno de Folvy (fv_…)')
    // Y en todo el historial hay muchas: el W10 no las reescribe (son historia), solo para las nuevas.
    const todas = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql'))
      .flatMap((f) => direccionesYSecretos(readFileSync(`supabase/migrations/${f}`, 'utf8')))
    expect(todas.length).toBeGreaterThan(50)
  })
  it('una dirección en un comentario no cuenta; en el código o en una cadena, sí; con o sin https', () => {
    expect(direccionesYSecretos('-- antes llamaba a https://abcdefghijklmnopqrst.supabase.co\nselect 1;')).toEqual([])
    expect(direccionesYSecretos("select net.http_post(url := 'https://abcdefghijklmnopqrst.supabase.co/functions/v1/x');")[0].que).toContain('dirección')
    expect(direccionesYSecretos("select format('https://%s', 'abcdefghijklmnopqrst.supabase.co');")[0].que).toContain('dirección')
    expect(direccionesYSecretos("select public._project_url() || '/functions/v1/x';")).toEqual([])
  })
  it('un secreto cuenta también en un comentario', () => {
    expect(direccionesYSecretos(`-- el de antes era ${FV('oadv')}\nselect 1;`)[0].que).toContain('fv_')
  })
  it('corre en cada PR a main y en antes-de-subir', () => {
    expect(readFileSync('.github/workflows/pr-a-main.yml', 'utf8')).toContain('node scripts/conta/sql-sin-direccion.mjs "$BASE" "$HEAD"')
    expect(readFileSync('scripts/conta/antes-de-subir.sh', 'utf8')).toContain('node scripts/conta/sql-sin-direccion.mjs')
  })
})

describe('la búsqueda de secretos reconoce los fv_… (lo pidió Julio el 28/10)', () => {
  it('un fv_<para qué>_<tira larga> es secreto; el nombre de función fv_e164_or_null, no', () => {
    expect(buscarSecretos(`'x-order-advance-secret',  '${FV('oadv')}'`)[0].que).toContain('fv_')
    expect(buscarSecretos('  v_phone := public.fv_e164_or_null(s.customer_phone);')).toEqual([])
  })
})

describe('la 0202: las 24, con guarda, respaldo y vuelta atrás', () => {
  const cambia = [...M0202.matchAll(/^-- cambia: (public\.[a-z_0-9]+) · prueba: (\S+)$/gm)].map((m) => m[1])
  const respaldos = [...M0202.matchAll(/^select public\._respaldar_funcion\('(public\.[^']+)', '20261102T0202_w10_funciones_leen_su_proyecto'\);$/gm)].map((m) => m[1])
  const restaura = [...D0202.matchAll(/^select public\._restaurar_funcion\('(public\.[^']+)', '20261102T0202_w10_funciones_leen_su_proyecto'\);$/gm)].map((m) => m[1])
  const reescritas = [...M0202.matchAll(/^CREATE OR REPLACE FUNCTION (public\.[a-z_0-9]+)\(/gim)].map((m) => m[1])
  it('24 declaradas, 24 guardadas antes, 24 reescritas y 24 restauradas, las mismas', () => {
    expect(cambia).toHaveLength(24)
    expect(new Set(cambia).size).toBe(24)
    expect(respaldos.map((f) => f.replace(/\(.*$/, '')).sort()).toEqual([...cambia].sort())
    expect(reescritas.sort()).toEqual([...cambia].sort())
    expect([...restaura].sort()).toEqual([...respaldos].sort())
    // Cada respaldo, antes de que se reescriba ninguna.
    expect(M0202.lastIndexOf('_respaldar_funcion(')).toBeLessThan(M0202.search(/^CREATE OR REPLACE FUNCTION/m))
  })
  it('la guarda va primero y para en producción si la dirección escrita no es la del Vault', () => {
    const guarda = M0202.indexOf('do $guarda$')
    expect(guarda).toBeGreaterThan(0)
    expect(guarda).toBeLessThan(M0202.indexOf('_respaldar_funcion('))
    expect(M0202).toContain("en producción la dirección escrita en % no es la del Vault (project_url). No se toca nada.")
    // Las dos bases, por la huella de su dirección: ninguna dirección escrita.
    expect(M0202).toMatch(/md5\(v_url\) = '[0-9a-f]{32}'[\s\S]*md5\(v_url\) = '[0-9a-f]{32}'/)
    // Las 24 huellas medidas el 02/11, en la guarda de producción y en la de staging.
    expect((M0202.match(/\('public\.[^']+', '[0-9a-f]{32}'\)/g) ?? []).length).toBe(48)
  })
  it('las 24 leen del Vault; los dos disparadores de sale, sin romper el pedido si falta', () => {
    expect((M0202.match(/public\._project_url\(\) \|\| '\/functions\/v1\/[a-z-]+'/g) ?? []).length).toBe(22)
    expect((M0202.match(/public\._project_url_si_hay\(\)/g) ?? []).length).toBe(2)
    expect(M0202).toContain("select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'order_advance_secret';")
    expect(M0202).toContain("PERFORM public._aviso_falta_en_vault('catcher-dispatch', new.id);")
  })
  it('la 0201 solo añade, y nadie de fuera llama a sus funciones', () => {
    expect(M0201).not.toMatch(/\b(drop|delete|update|alter)\b/i)
    for (const f of ['_project_url_si_hay()', '_project_url()', '_aviso_falta_en_vault(text, uuid)'])
      expect(M0201).toContain(`revoke all on function public.${f} from public, anon, authenticated;`)
  })
})

describe('la tanda y la prueba de staging', () => {
  it('la tanda lleva las dos, su cuenta y su vuelta atrás en orden inverso', () => {
    const aplicar = readFileSync(`${DIR_TANDA}/aplicar.txt`, 'utf8').split('\n').filter((l) => l && !l.startsWith('#'))
    expect(aplicar).toEqual([
      'supabase/migrations/20261102T0201_w10_project_url.sql',
      'supabase/migrations/20261102T0202_w10_funciones_leen_su_proyecto.sql',
      'cuenta: scripts/conta/produccion/cuentas/w10-funciones-leen-su-proyecto.sql',
    ])
    const atras = readFileSync(`${DIR_TANDA}/vuelta-atras.txt`, 'utf8').split('\n').filter((l) => l && !l.startsWith('#'))
    expect(atras).toEqual([
      'supabase/vuelta-atras/20261102T0202_w10_funciones_leen_su_proyecto.down.sql',
      'supabase/vuelta-atras/20261102T0201_w10_project_url.down.sql',
    ])
  })
  it('la prueba ensaya el camino de verdad: una venta de Last que cambia de estado, con y sin secreto', () => {
    expect(PRUEBA).toContain("update public.sale set order_status = 'in_preparation'")
    expect(PRUEBA).toContain("vault.create_secret('secreto-de-prueba-w10', 'order_advance_secret')")
    expect(PRUEBA).toContain("url not like public._project_url() || '/%'")
    expect(PRUEBA.trim().endsWith('rollback;')).toBe(true)
    // No lleva ninguna dirección ni secreto escritos.
    expect(direccionesYSecretos(PRUEBA)).toEqual([])
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
  it('las cuatro funciones que solo aceptaban uno usan el relevo', () => {
    for (const [f, n] of [['availability-dispatch', 'AVAILABILITY_DISPATCH_SECRET'], ['hubrise-location-dispatch', 'LOCATION_STATUS_DISPATCH_SECRET'],
      ['last-catalog-probe', 'AVAILABILITY_DISPATCH_SECRET'], ['lastapp-set-price', 'AVAILABILITY_DISPATCH_SECRET']]) {
      const t = readFileSync(`supabase/functions/${f}/index.ts`, 'utf8')
      expect(t).toContain(`comprobarSecreto(`)
      expect(t).toContain(`"${n}")`)
      expect(t).not.toMatch(new RegExp(`Deno\\.env\\.get\\("${n}"\\)`))
    }
  })
})

describe('sin-secretos: ninguna línea añadida trae un secreto (punto 4, cualquier fichero)', () => {
  const diff = (f: string, lineas: string[]) => `diff --git a/${f} b/${f}\n--- a/${f}\n+++ b/${f}\n@@ -0,0 +1,${lineas.length} @@\n` + lineas.map((l) => `+${l}`).join('\n') + '\n'
  it('lo ve en cualquier fichero: un .md, un .json o un .ts', () => {
    expect(secretosAnadidos(diff('CONTEXTO_CLAUDE.md', ['nada', `clave: ${FV('locst')}`]))).toEqual([{ fichero: 'CONTEXTO_CLAUDE.md', linea: 2, que: 'un secreto interno de Folvy (fv_…)' }])
    expect(secretosAnadidos(diff('promo-agent/config.example.json', [`  "PUSH_AGENT_SECRET": "${FV('push')}",`]))).toHaveLength(1)
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
