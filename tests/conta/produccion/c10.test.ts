// C10 (Julio, 23/10) · «Que dos PR con tanda no choquen nunca más».
// Una tanda por rama (tanda.mjs), nombres sin choques (nombres.mjs) y el
// manifiesto de staging por rama (staging-tanda.mjs).
import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ajenos, carpetaDeTanda, ficherosDeTanda, slugDeRama, todas } from '../../../scripts/conta/produccion/tanda.mjs'
import { ANTIGUAS_ABIERTAS, contraProduccion, llave, revisar } from '../../../scripts/conta/produccion/nombres.mjs'

function raizDePrueba(tandas: Record<string, string[]>) {
  const raiz = mkdtempSync(join(tmpdir(), 'c10-tandas-'))
  for (const [donde, lineas] of Object.entries(tandas)) {
    mkdirSync(join(raiz, donde), { recursive: true })
    writeFileSync(join(raiz, donde, 'aplicar.txt'), lineas.join('\n') + '\n')
  }
  return raiz
}

describe('tanda.mjs · una tanda por rama', () => {
  it('el nombre de la carpeta es la rama con «/» cambiada por «-»', () => {
    expect(slugDeRama('conta/c10-tandas-por-rama')).toBe('conta-c10-tandas-por-rama')
    expect(slugDeRama('claude/cool-noether-i932tx')).toBe('claude-cool-noether-i932tx')
    expect(slugDeRama('  a b/c  ')).toBe('a-b-c')
    expect(slugDeRama('')).toBe('')
  })

  it('encuentra la tanda de una rama en su producto, y null si la rama no tiene', () => {
    const raiz = raizDePrueba({ 'sumied/conta-x': ['a.sql'], 'folvy/claude-y': ['b.sql'] })
    expect(carpetaDeTanda('conta/x', raiz)).toBe(join(raiz, 'sumied/conta-x'))
    expect(carpetaDeTanda('claude/y', raiz)).toBe(join(raiz, 'folvy/claude-y'))
    expect(carpetaDeTanda('conta-x', raiz)).toBe(join(raiz, 'sumied/conta-x'))
    expect(carpetaDeTanda('main', raiz)).toBeNull()
    expect(carpetaDeTanda('', raiz)).toBeNull()
    expect(todas(raiz)).toEqual(['sumied/conta-x', 'folvy/claude-y']) // sumied primero, luego folvy
  })

  it('el mismo nombre en los dos productos para: no se adivina', () => {
    const raiz = raizDePrueba({ 'sumied/doble': ['a.sql'], 'folvy/doble': ['b.sql'] })
    expect(() => carpetaDeTanda('doble', raiz)).toThrow(/un solo producto/)
  })

  it('cada tanda tiene sus tres ficheros en su carpeta', () => {
    expect(ficherosDeTanda('supabase/produccion/tandas/sumied/x')).toEqual({
      aplicar: 'supabase/produccion/tandas/sumied/x/aplicar.txt',
      vueltaAtras: 'supabase/produccion/tandas/sumied/x/vuelta-atras.txt',
      contexto: 'supabase/produccion/tandas/sumied/x/contexto.json',
    })
  })

  it('la tanda de antes del C10 es «heredada», y ya no hay manifiesto único', () => {
    expect(carpetaDeTanda('heredada')).toBe('supabase/produccion/tandas/sumied/heredada')
    for (const f of ['supabase/produccion/aplicar.txt', 'supabase/produccion/vuelta-atras.txt', 'tests/conta/produccion/contexto-produccion-tanda-viva.json']) {
      expect(() => readFileSync(f)).toThrow()
    }
  })
})

describe('tanda.mjs ajenos · ningún fichero compartido se edita en dos PR', () => {
  const rama = 'claude/cool-noether-i932tx'
  it('la suya, sí; la de otra rama o un manifiesto único de antes, no', () => {
    expect(ajenos(rama, [
      'supabase/produccion/tandas/sumied/claude-cool-noether-i932tx/aplicar.txt',
      'supabase/staging/tandas/sumied/claude-cool-noether-i932tx.txt',
      'supabase/migrations/20261208T0850_d07_iva_no_deducible_y_periodo_cerrado.sql',
      'src/modules/conta/x.tsx',
    ])).toEqual([])
    const f = ajenos(rama, [
      'supabase/produccion/aplicar.txt',
      'supabase/staging/aplicar.txt',
      'supabase/produccion/tandas/sumied/conta-otra/aplicar.txt',
      'supabase/staging/tandas/folvy/conta-otra.txt',
      'supabase/produccion/tandas/otro/claude-cool-noether-i932tx/aplicar.txt',
    ])
    expect(f).toHaveLength(5)
    expect(f[0]).toMatch(/ya no se edita \(C10\)/)
    expect(f[2]).toMatch(/tanda de otra rama/)
  })
  it('la heredada la puede terminar su PR (#299), y las carpetas vacías no cuentan', () => {
    expect(ajenos('claude/d07a-vuelta-atras-0820', ['supabase/produccion/tandas/sumied/heredada/aplicar.txt', 'supabase/produccion/tandas/folvy/.gitkeep'])).toEqual([])
  })
  it('pr-a-main.yml lo comprueba con los ficheros añadidos o cambiados del PR', () => {
    const pr = readFileSync('.github/workflows/pr-a-main.yml', 'utf8')
    expect(pr).toContain('git diff --name-only --diff-filter=d "$BASE...$HEAD" > /tmp/cambiados.txt')
    expect(pr).toContain('node scripts/conta/produccion/tanda.mjs ajenos "$RAMA" /tmp/cambiados.txt')
  })
})

describe('nombres.mjs · AAAAMMDDTHHMM_<sesión>_<qué>.sql, sin repetir', () => {
  it('lee la versión y su llave (fecha, hora, minuto y sesión)', () => {
    expect(llave('supabase/migrations/20261023T1812_c10_tandas_por_rama.sql')).toEqual({ version: '20261023T1812_c10_tandas_por_rama', prefijo: '20261023T1812_c10' })
    expect(llave('20261208T0850_d07_iva.sql').prefijo).toBe('20261208T0850_d07')
    expect(llave('20260902204305_vieja.sql').prefijo).toBeNull()
  })

  it('rechaza el formato antiguo, salvo las que ya estaban en PR abiertos el 23/10', () => {
    expect(revisar(['20261209T0890_algo_nuevo.sql'])).toEqual([])
    expect(revisar(['20260902204305_vieja.sql'])[0]).toMatch(/no es «AAAAMMDDTHHMM_<sesión>_<qué>\.sql»/)
    expect(revisar(['20261023T1812_C10_Mayus.sql'])).toHaveLength(1)
    for (const f of ANTIGUAS_ABIERTAS) expect(revisar([f])).toEqual([])
  })

  it('rechaza un nombre, o su fecha+hora+sesión, que ya está en main o en otro PR abierto', () => {
    const main = ['supabase/migrations/20261023T1812_c10_tandas_por_rama.sql']
    const prs = ['supabase/migrations/20261023T1900_d08_otra_cosa.sql']
    expect(revisar(['20261023T1812_c10_tandas_por_rama.sql'], { main })).toEqual([]) // es la misma: no choca consigo
    expect(revisar(['20261023T1812_c10_otra_cosa.sql'], { main })[0]).toMatch(/en main/)
    expect(revisar(['20261023T1900_d08_distinta.sql'], { prs })[0]).toMatch(/en otro PR abierto/)
    expect(revisar(['20261023T1901_d08_distinta.sql'], { main, prs })).toEqual([])
  })

  it('dos del mismo PR no pueden compartir fecha, hora y sesión', () => {
    expect(revisar(['20261023T1812_c10_a.sql', '20261023T1812_c10_b.sql'])[0]).toMatch(/en este mismo PR/)
    expect(revisar(['20261023T1812_c10_a.sql', '20261023T1813_c10_b.sql'])).toEqual([])
  })

  it('contra producción: para si el historial ya tiene esa fecha, hora y sesión con otro nombre', () => {
    const versiones = ['20261023T1812_c10_tandas_por_rama', '0840_lo_que_sea']
    expect(contraProduccion(['supabase/migrations/20261023T1812_c10_tandas_por_rama.sql'], versiones)).toEqual([])
    expect(contraProduccion(['supabase/migrations/20261023T1812_c10_otra.sql'], versiones)[0]).toMatch(/producción ya tiene 20261023T1812_c10_tandas_por_rama/)
    expect(contraProduccion(['supabase/migrations/20260902204305_vieja.sql'], versiones)).toEqual([])
  })

  it('pr-a-main.yml revisa los nombres nuevos contra main y los PR abiertos, y el aplicar contra producción', () => {
    const pr = readFileSync('.github/workflows/pr-a-main.yml', 'utf8')
    expect(pr).toContain('node scripts/conta/produccion/nombres.mjs revisar')
    const ap = readFileSync('.github/workflows/aplicar-produccion-conta.yml', 'utf8')
    expect(ap).toContain('node scripts/conta/produccion/nombres.mjs produccion /tmp/versiones.txt')
  })
})

describe('staging-tanda.mjs · un manifiesto por rama', () => {
  it('el manifiesto de antes queda cerrado y las ramas escriben en supabase/staging/tandas', async () => {
    const st = await import('../../../scripts/conta/staging-tanda.mjs')
    expect(st.TANDAS).toBe('supabase/staging/tandas')
    const texto: string = st.textoDelManifiesto()
    // El cerrado sigue dentro, entero: lo de antes no se pierde.
    const cerrado = readFileSync('supabase/staging/aplicar.txt', 'utf8')
    for (const l of cerrado.split('\n').filter((x) => /\.sql\s*$/.test(x)).slice(0, 5)) expect(texto).toContain(l.trim())
  })
})
