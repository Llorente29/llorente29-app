// tests/unit/ci/cliSupabase.test.ts
//
// B01 (03/11) · La CLI de Supabase en los workflows: que no vuelva a cambiar
// sola y que un despliegue no se quede esperando una confirmación que nadie da.
//
// El 02/11 a las 12:18 UTC salió la CLI 3.0.0. Los workflows la instalaban con
// «version: latest» y, desde entonces, «supabase functions deploy» pedía
// confirmar: «Confirmation required … This run can't ask because stdout is not
// a terminal. Nothing was changed. Re-run with --yes to confirm» (staging,
// run 41540801769). En producción, la siguiente fusión no habría desplegado nada.
//
//   · ninguna llamada a «functions deploy» sin --yes (en los workflows y en
//     los guiones de scripts/);
//   · ninguna CLI instalada en «latest»: una versión fija (X.Y.Z), la misma en
//     todos los workflows.
// Y las dos reglas, probadas contra lo que tienen que cazar (regla 31).

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/** Los ficheros de un directorio, en todo su árbol, con una de estas extensiones. */
function ficheros(dir: string, ext: RegExp): string[] {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e)
    return statSync(p).isDirectory() ? (e === 'node_modules' ? [] : ficheros(p, ext)) : ext.test(e) ? [p] : []
  })
}

/** Las órdenes de un texto de shell: las líneas que siguen con «\» se juntan, y los comentarios fuera. */
function ordenes(texto: string): { linea: number; orden: string }[] {
  const out: { linea: number; orden: string }[] = []
  const ls = texto.split('\n')
  for (let i = 0; i < ls.length; i++) {
    const inicio = i
    let o = ls[i]
    while (/\\\s*$/.test(o) && i + 1 < ls.length) o = o.replace(/\\\s*$/, ' ') + ls[++i]
    if (/^\s*#/.test(o)) continue
    out.push({ linea: inicio + 1, orden: o })
  }
  return out
}

/** Las llamadas a «functions deploy» sin --yes, con su fichero y su línea. */
export function deploysSinYes(nombre: string, texto: string): string[] {
  return ordenes(texto)
    .filter(({ orden }) => /\bsupabase\s+functions\s+deploy\b/.test(orden) && !/(^|\s)--yes(\s|$)/.test(orden))
    .map(({ linea }) => `${nombre}:${linea}`)
}

/** Las versiones de la CLI que instala cada «uses: supabase/setup-cli» (la que no es X.Y.Z, tal cual). */
export function versionesCli(nombre: string, texto: string): { donde: string; version: string }[] {
  const ls = texto.split('\n')
  const out: { donde: string; version: string }[] = []
  ls.forEach((l, i) => {
    if (!/^\s*-?\s*uses:\s*supabase\/setup-cli@/.test(l)) return
    // La versión va en su «with:», en las líneas siguientes, antes del próximo paso.
    let version = '(sin versión: la de por defecto)'
    for (let j = i + 1; j < ls.length && !/^\s*- /.test(ls[j]); j++) {
      const m = /^\s*version:\s*['"]?([^'"\s#]+)/.exec(ls[j])
      if (m) { version = m[1]; break }
    }
    out.push({ donde: `${nombre}:${i + 1}`, version })
  })
  return out
}

const workflows = ficheros('.github/workflows', /\.ya?ml$/).map((f) => ({ f, t: readFileSync(f, 'utf8') }))
const guiones = ficheros('scripts', /\.(sh|mjs|js|ts)$/).map((f) => ({ f, t: readFileSync(f, 'utf8') }))

describe('la CLI de Supabase en los workflows (B01, 03/11)', () => {
  it('ninguna llamada a «functions deploy» sin --yes', () => {
    const mal = [...workflows, ...guiones].flatMap(({ f, t }) => deploysSinYes(f, t))
    expect(mal, `Sin --yes, la CLI 3 pide confirmar y no despliega nada (run 41540801769). Pon --yes en: ${mal.join(', ')}`).toEqual([])
  })

  it('hay despliegues que mirar (si no, la regla de arriba no vigila nada)', () => {
    const n = workflows.reduce((t, { t: x }) => t + ordenes(x).filter(({ orden }) => /\bsupabase\s+functions\s+deploy\b/.test(orden)).length, 0)
    expect(n).toBeGreaterThanOrEqual(6)
  })

  it('ninguna CLI en «latest»: una versión fija, la misma en todos', () => {
    const v = workflows.flatMap(({ f, t }) => versionesCli(f, t))
    expect(v.length, 'los workflows que instalan la CLI').toBeGreaterThanOrEqual(5)
    const sueltas = v.filter((x) => !/^\d+\.\d+\.\d+$/.test(x.version))
    expect(sueltas, `Con una versión que no es fija, la CLI cambia sola (02/11: la 3.0.0). Pon X.Y.Z en: ${sueltas.map((x) => `${x.donde} (${x.version})`).join(', ')}`).toEqual([])
    expect(new Set(v.map((x) => x.version)).size, `Versiones distintas: ${v.map((x) => `${x.donde} ${x.version}`).join(', ')}`).toBe(1)
  })
})

describe('las dos reglas cazan lo que tienen que cazar', () => {
  it('«functions deploy» sin --yes, también partido en dos líneas; con --yes o comentado, no', () => {
    expect(deploysSinYes('a', 'run: |\n  supabase functions deploy "$f" --project-ref "$REF" $FLAG\n')).toEqual(['a:2'])
    expect(deploysSinYes('a', '  supabase functions deploy "$f" \\\n    --project-ref "$REF"\n')).toEqual(['a:1'])
    expect(deploysSinYes('a', '  supabase functions deploy "$f" --project-ref "$REF" --yes $FLAG\n')).toEqual([])
    expect(deploysSinYes('a', '  supabase functions deploy "$f" \\\n    --yes --project-ref "$REF"\n')).toEqual([])
    expect(deploysSinYes('a', '# un `supabase functions deploy <nombre>` a secas\n')).toEqual([])
    expect(deploysSinYes('a', '  supabase functions deploy "$f" --yesterday\n')).toEqual(['a:1'])
  })
  it('la versión: latest, sin versión o con comillas; la fija, tal cual', () => {
    const paso = (v: string) => `      - uses: supabase/setup-cli@v1\n        with:\n${v}      - name: otro\n`
    expect(versionesCli('w', paso('          version: latest\n'))).toEqual([{ donde: 'w:1', version: 'latest' }])
    expect(versionesCli('w', paso(''))[0].version).toBe('(sin versión: la de por defecto)')
    expect(versionesCli('w', paso("          version: '2.122.1'\n"))[0].version).toBe('2.122.1')
    expect(versionesCli('w', paso('          # comentario\n          version: 2.122.1\n'))[0].version).toBe('2.122.1')
  })
})
