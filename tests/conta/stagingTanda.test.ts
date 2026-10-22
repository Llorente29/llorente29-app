// tests/conta/stagingTanda.test.ts — W04 (Julio, 22/10): qué pasa por staging en cada run.
// Contra la población real (regla 31): las dos últimas fusiones de main, los
// 98 ficheros del manifiesto de hoy y las migraciones viejas que llevan COMMIT.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { lineas, nuevas, porQueNoSeEnsaya, llevaSuTransaccion, sesiones, MANIFIESTO } from '../../scripts/conta/staging-tanda.mjs'

const enCommit = (ref: string) => execFileSync('git', ['show', `${ref}:${MANIFIESTO}`], { encoding: 'utf8' })

describe('lo que añade una rama o un push al manifiesto', () => {
  it('la fusión del #279 (Catcher) añadió su 0420 y su prueba, y nada más', () => {
    expect(nuevas(enCommit('a6133686'), enCommit('7818c125'))).toEqual([
      'supabase/migrations/20261130T0420_e05_catcher_ficha.sql',
      'supabase/staging/sql/20261130_e05_catcher_ficha_prueba.sql',
    ])
  })
  it('la fusión del #281 (I01d) añadió su 0420 y su prueba, y nada más', () => {
    expect(nuevas(enCommit('7818c125'), enCommit('03229c4b'))).toEqual([
      'supabase/migrations/20261130T0420_i01d_impuestos_2025.sql',
      'supabase/staging/sql/20261130_i01d_impuestos_2025_prueba.sql',
    ])
  })
  it('sin cambios, nada; un comentario o un blanco no cuentan; el orden es el del manifiesto nuevo', () => {
    const m = readFileSync(MANIFIESTO, 'utf8')
    expect(nuevas(m, m)).toEqual([])
    expect(nuevas(m, `${m}\n# un comentario\n\n`)).toEqual([])
    expect(nuevas('a.sql\n', 'b.sql\na.sql\nc.sql\n')).toEqual(['b.sql', 'c.sql'])
  })
})

describe('qué se puede ensayar en ROLLBACK', () => {
  const hoy = lineas(readFileSync(MANIFIESTO, 'utf8'))
  it('los 98 ficheros del manifiesto de hoy (sin W03 y con la 0450 y su prueba) se ensayan, y 45 llevan su propia transacción', () => {
    expect(hoy).toHaveLength(98)
    expect(hoy.filter((f) => porQueNoSeEnsaya(readFileSync(f, 'utf8')))).toEqual([])
    expect(hoy.filter((f) => llevaSuTransaccion(readFileSync(f, 'utf8')))).toHaveLength(45)
  })
  it('una migración vieja con COMMIT no se ensaya: dejaría cosas de verdad', () => {
    const f = 'supabase/migrations/20260923T0015_casar_el_combo_por_su_id.sql'
    expect(porQueNoSeEnsaya(readFileSync(f, 'utf8'))).toMatch(/COMMIT/)
  })
  it('un ROLLBACK que no es la última sentencia, tampoco; el «end;» de un cuerpo $$ no es un COMMIT', () => {
    expect(porQueNoSeEnsaya('begin;\nselect 1;\nrollback;\ninsert into t values (1);\n')).toMatch(/ROLLBACK/)
    expect(porQueNoSeEnsaya('do $$ begin perform 1; end $$;\ncreate function f() returns int language plpgsql as $f$ begin return 1; end; $f$;\n')).toBeNull()
    expect(porQueNoSeEnsaya("select 'commit;';\n-- commit;\n")).toBeNull()
  })
})

describe('las sesiones del ensayo', () => {
  it('cada fichero en su sesión, con BEGIN y ROLLBACK; la prueba encuentra antes las migraciones de la rama', () => {
    const leer = (f: string) => (f.includes('prueba') ? 'begin;\nselect 1;\nrollback;\n' : 'create table t (x int);\n')
    const s = sesiones(['m1.sql', 'p1_prueba.sql', 'm2.sql', 'p2_prueba.sql'], leer)
    expect(s.map((x) => x.sql)).toEqual([
      'begin;\n\\i m1.sql\nrollback;',
      'begin;\n\\i m1.sql\n\\i p1_prueba.sql\nrollback;',
      'begin;\n\\i m1.sql\n\\i m2.sql\nrollback;',
      'begin;\n\\i m1.sql\n\\i m2.sql\n\\i p2_prueba.sql\nrollback;',
    ])
  })
})
