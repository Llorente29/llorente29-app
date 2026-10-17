// tests/unit/seguridad/secretos.test.ts — que no vuelvan (W02, 17/10).
// Antes de pasar el repositorio a privado se barrió el historial: un secreto
// interno escrito en cinco migraciones, el token de football-data.org en el
// front y repartidores con nombre y NIF en una página. Esto mira el árbol
// entero de src/ y supabase/ cada vez.

import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'

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

  it('el front no lleva el token de football-data.org: lo pone la función futbol-partidos', () => {
    expect(conPatron(/X-Auth-Token['"]?\s*:\s*['"][0-9a-f]{32}/, ['src'])).toEqual([])
  })

  it('el CSV de Glovo no vuelve a la raíz', () => {
    expect(ficheros(['glovo_orders.csv', 'glovo_settlements.csv'])).toEqual([])
  })
})
