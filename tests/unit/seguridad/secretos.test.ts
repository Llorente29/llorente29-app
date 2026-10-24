// tests/unit/seguridad/secretos.test.ts — que no vuelvan (W02, 17/10).
// Antes de pasar el repositorio a privado se barrió el historial: un secreto
// interno escrito en cinco migraciones, el token (de pruebas) de football-data.org
// en el front y repartidores con nombre y NIF en una página. Esto mira el árbol
// entero de src/ y supabase/ cada vez.

import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const HUELLA_TOKEN_FOOTBALL = 'f1122b0c4904'

const ficheros = (dirs: string[]) =>
  execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', ...dirs], { encoding: 'utf8' })
    .split('\n').filter((f) => f && !/\.(png|jpe?g|pdf|ico|woff2?|zip)$/.test(f))

const conPatron = (re: RegExp, dirs: string[]) => {
  const fs = ficheros(dirs)
  if (!fs.length) return []
  try {
    return execFileSync('git', ['grep', '--no-index', '-lE', re.source, '--', ...fs], { encoding: 'utf8' }).split('\n').filter(Boolean)
  } catch { return [] } // git grep sale con 1 si no encuentra nada
}

describe('secretos fuera del código', () => {
  it('ningún secreto interno fv_c… escrito en src/ ni en supabase/', () => {
    expect(conPatron(/fv_c[A-Za-z0-9_]{20,}/, ['src', 'supabase'])).toEqual([])
  })

  it('el token de football-data.org no vuelve al código (se quitó con los partidos el 17/10)', () => {
    expect(conPatron(/X-Auth-Token['"]?\s*:\s*['"][0-9a-f]{32}/, ['src', 'supabase'])).toEqual([])
    // Y con cualquier forma: ninguna cadena de 32 hex con la huella del token
    // (los 12 primeros de su md5; el token no vive en esta prueba).
    const conHuella = ficheros(['src', 'supabase']).filter((f) => {
      const texto = readFileSync(f, 'utf8')
      return (texto.match(/[0-9a-f]{32}/g) ?? []).some((h) => createHash('md5').update(h).digest('hex').startsWith(HUELLA_TOKEN_FOOTBALL))
    })
    expect(conHuella).toEqual([])
  })

  it('el CSV de Glovo no vuelve a la raíz', () => {
    expect(ficheros(['glovo_orders.csv', 'glovo_settlements.csv'])).toEqual([])
  })
})
