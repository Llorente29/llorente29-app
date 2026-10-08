// W01 · Los agentes alrededor del real: el «antes» es la foto de partida, no una
// guarda; el «después» es obligatorio; y la comparación solo cuenta los agentes
// medibles en los dos lados (C04 R4, 08/10).
//
// El caso de hoy, tal cual: el real 37782327988 paró en «Antes · D1, salud del
// pedido y agentes» con «agente-libro.sql:144: permission denied for table
// sale», porque conta_lectura aún no tenía SELECT sobre sale y la tanda era
// justo la que se lo da (20261012T0050_c04r_lectura.sql). Aquí lo hace un psql
// falso: sin permiso antes, con permiso después.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error — módulo .mjs sin tipos
import { compararAgentes, leerAgentes } from '../../../scripts/conta/produccion/agentes-comparar.mjs'

// El psql falso: responde a to_regclass con «t», a los SQL de los agentes con un
// volcado mínimo que sus jueces aceptan, y al del libro con el error EXACTO de
// producción mientras SIN_SALE=1.
const PSQL = `#!/usr/bin/env bash
f=""; prev=""; for a in "$@"; do [ "$prev" = "-f" ] && f="$a"; prev="$a"; done
case "$f" in
  "") echo t ;;
  scripts/conta/agente-datos-maestros.sql) echo '{"tablas":{}}' ;;
  scripts/conta/agente-terceros.sql) echo '{}' ;;
  scripts/conta/agente-libro.sql)
    if [ "$SIN_SALE" = "1" ]; then
      echo 'psql:scripts/conta/agente-libro.sql:144: ERROR:  permission denied for table sale' >&2; exit 3
    fi
    echo '{}' ;;
  *) echo "psql falso: no sé qué hacer con $f" >&2; exit 9 ;;
esac
`

function entorno() {
  const dir = mkdtempSync(join(tmpdir(), 'agentes-'))
  const psql = join(dir, 'psql')
  writeFileSync(psql, PSQL, { mode: 0o755 })
  const correr = (et: 'antes' | 'despues', sinSale: boolean) => {
    let rc = 0
    try {
      execFileSync('bash', ['scripts/conta/produccion/agentes.sh', et], { env: { ...process.env, PSQL: psql, RO_DB_URL: 'postgres://falsa', AGENTES_DIR: dir, SIN_SALE: sinSale ? '1' : '0' }, stdio: 'pipe' })
    } catch (e) { rc = (e as { status: number }).status }
    return { rc, txt: readFileSync(join(dir, `agentes-${et}.txt`), 'utf8') }
  }
  const comparar = () => {
    try {
      return { rc: 0, md: execFileSync('node', ['scripts/conta/produccion/agentes-comparar.mjs', join(dir, 'agentes-antes.txt'), join(dir, 'agentes-despues.txt')], { encoding: 'utf8' }) }
    } catch (e) { return { rc: (e as { status: number }).status, md: String((e as { stdout: string }).stdout) } }
  }
  return { correr, comparar }
}

describe('el caso de hoy: la tanda da el permiso que el «antes» no tiene', () => {
  const { correr, comparar } = entorno()
  const antes = correr('antes', true)
  const despues = correr('despues', false)
  const c = comparar()

  it('el «antes» no para: el libro queda «no-medible» con el motivo de producción', () => {
    expect(antes.rc).toBe(0)
    expect(antes.txt).toContain('libro\tno-medible\tagente-libro.sql:144: ERROR: permission denied for table sale')
    // Los demás se miden igual: un agente que no lee no se lleva a los otros.
    expect(antes.txt).toMatch(/^datos\t(verde|rojo)\t$/m)
  })
  it('el «después», ya con el permiso, mide los dos', () => {
    expect(despues.rc).toBe(0)
    expect(despues.txt).toContain('libro\tverde\t')
    expect(despues.txt).not.toContain('no-medible')
  })
  it('la comparación pasa: el libro no cuenta (no medible antes) y datos queda igual', () => {
    expect(c.rc).toBe(0)
    expect(c.md).toContain('| libro | no-medible (agente-libro.sql:144: ERROR: permission denied for table sale) | verde | no cuenta (no medible en los dos lados) |')
    expect(c.md).toMatch(/\| datos \| (verde|rojo) \| \1 \| igual \|/)
  })
})

describe('el «después» es obligatorio', () => {
  it('si la tanda NO da el permiso, el después sale con 2 y la comparación falla', () => {
    const { correr, comparar } = entorno()
    expect(correr('antes', true).rc).toBe(0)
    const d = correr('despues', true)
    expect(d.rc).toBe(2)
    expect(d.txt).toContain('libro\tno-medible\tagente-libro.sql:144: ERROR: permission denied for table sale')
    const c = comparar()
    expect(c.rc).toBe(1)
    expect(c.md).toContain('**no se ha podido medir después: falla**')
  })
})

describe('la comparación, solo entre medibles en los dos lados', () => {
  const cmp = (a: string, d: string) => compararAgentes(leerAgentes(a), leerAgentes(d)) as { fallos: string[]; markdown: string }
  it('verde antes y rojo después: falla', () => {
    expect(cmp('libro\tverde\t\n', 'libro\trojo\t\n').fallos).toEqual(['agente-libro'])
  })
  it('rojo antes y rojo después: no es de la tanda', () => {
    expect(cmp('datos\trojo\t\n', 'datos\trojo\t\n').fallos).toEqual([])
  })
  it('no-medible antes y rojo después: se dice, no cuenta', () => {
    const r = cmp('libro\tno-medible\tpermission denied for table sale\n', 'libro\trojo\t\n')
    expect(r.fallos).toEqual([])
    expect(r.markdown).toContain('rojo después sin foto de antes: se dice, no cuenta')
  })
  it('un agente que falta en el después cuenta como no medido: falla', () => {
    expect(cmp('libro\tverde\t\n', '').fallos).toEqual(['agente-libro-no-corre'])
  })
  it('«no-aplica» (la tabla aún no existe) no falla en ningún lado', () => {
    expect(cmp('libro\tno-aplica\tno existe public.journal_entry\n', 'libro\tno-aplica\tno existe public.journal_entry\n').fallos).toEqual([])
  })
})

describe('el workflow: los agentes del «antes» no son guarda; D1 y la salud del pedido sí', () => {
  const texto = readFileSync('.github/workflows/aplicar-produccion-conta.yml', 'utf8')
  const pasos = texto.split(/\n {6}- (?:name|uses): /).slice(1)
  const antes = pasos.find((p) => p.startsWith('Antes · D1, salud del pedido y agentes'))!
  const despues = pasos.find((p) => p.startsWith('Después · comprobación'))!
  it('el «antes» sigue con set -e, D1 y la salud del pedido, y llama a agentes.sh antes (que sale con 0)', () => {
    expect(antes).toContain('set -euo pipefail')
    expect(antes).toContain('-f scripts/conta/produccion/d1.sql > /tmp/d1-antes.csv')
    expect(antes).toContain('-f scripts/conta/produccion/salud-pedido.sql > /tmp/salud-antes.txt')
    expect(antes).toContain('bash scripts/conta/produccion/agentes.sh antes')
  })
  it('el «después» exige agentes.sh despues y compara con agentes-comparar.mjs', () => {
    expect(despues).toContain('bash scripts/conta/produccion/agentes.sh despues || mal="$mal agentes-no-corren-despues"')
    expect(despues).toContain('node scripts/conta/produccion/agentes-comparar.mjs /tmp/agentes-antes.txt /tmp/agentes-despues.txt > /tmp/agentes.md || mal="$mal agentes"')
    expect(despues).not.toMatch(/datos=\(\[01\]\)/)
  })
})

// C04 R5 (Julio, 08/10): la guarda 4 del nocturno admite BYPASSRLS y sigue exigiendo
// que el rol no escriba. Lo que hace la guarda contra una base lo prueba
// supabase/staging/sql/20261013_c04r5_prueba_guarda.sql; aquí, que el nocturno la usa.
describe('el nocturno de producción: la guarda 4 es guarda-lectura.sql, en los dos trabajos que leen', () => {
  const texto = readFileSync('.github/workflows/cumplimiento-produccion-conta.yml', 'utf8')
  const guarda = readFileSync('scripts/conta/produccion/guarda-lectura.sql', 'utf8').replace(/--.*$/gm, '')
  it('los dos trabajos la corren y paran si dice algo', () => {
    expect(texto.match(/-f scripts\/conta\/produccion\/guarda-lectura\.sql/g)).toHaveLength(2)
    expect(texto.match(/if \[ -n "\$f" \]; then echo "::error::Falla la guarda 4/g)).toHaveLength(2)
  })
  it('nadie rechaza BYPASSRLS', () => {
    expect(texto).not.toMatch(/rolbypassrls/)
    expect(guarda).not.toMatch(/bypassrls/i)
  })
  it('y sigue mirando escritura, superusuario, createrole, createdb y roles que escriben', () => {
    for (const s of ["'INSERT,UPDATE,DELETE,TRUNCATE'", 'rolsuper', 'rolcreaterole', 'rolcreatedb', "pg_has_role(yo.oid, r.oid, 'MEMBER')", "privilege_type <> 'SELECT'"]) expect(guarda).toContain(s)
  })
})
