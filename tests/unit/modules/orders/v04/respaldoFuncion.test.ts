// tests/unit/modules/orders/v04/respaldoFuncion.test.ts
//
// V04 · Respuesta 1 (27/10) · La vuelta atrás de una función que cambia en
// caliente la deja EXACTAMENTE como estaba, también con sus saltos de línea.
// fiscal_for_print tiene \r\n en producción, y la copia a mano con \n de la
// primera vuelta atrás dejaba otra huella (el ensayo #256 paró por eso).
// Contra un Postgres DE VERDAD (regla 31): se carga el bloque «respaldo» de la
// migración 20261026T2309 tal cual, con una función con \r\n como la de
// producción, y se mide la huella (md5 de pg_get_functiondef, la del ensayo)
// antes y después.

import { spawnSync } from 'node:child_process'
import { chmodSync, chownSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir, userInfo } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const raiz = resolve(__dirname, '../../../../..')
const MIGRACION = join(raiz, 'supabase/migrations/20261026T2309_v04_tique_serie_y_quien_factura.sql')
const bin = (() => {
  const base = '/usr/lib/postgresql'
  if (!existsSync(base)) return null
  const v = readdirSync(base).filter((d) => existsSync(join(base, d, 'bin', 'pg_ctl'))).sort().pop()
  return v ? join(base, v, 'bin') : null
})()
const listo = !!bin && spawnSync('psql', ['--version']).status === 0
const PUERTO = String(55000 + Math.floor(Math.random() * 900))
let dir = ''
const comoPostgres = userInfo().uid === 0
const run = (exe: string, args: string[]) =>
  comoPostgres ? spawnSync('runuser', ['-u', 'postgres', '--', exe, ...args], { encoding: 'utf8' }) : spawnSync(exe, args, { encoding: 'utf8' })
const conexion = () => ['-h', dir, '-p', PUERTO, '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1']
function sql(q: string): string {
  const r = spawnSync('psql', [...conexion(), '-f', '-'], { input: q, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(r.stderr || `psql salió con ${r.status}`)
  return r.stdout.trim()
}
const huella = `select md5(pg_get_functiondef('public.f_tique(text,uuid)'::regprocedure))`
const retornos = `select length(prosrc) - length(replace(prosrc, chr(13), '')) from pg_proc where proname = 'f_tique'`
const MIG = '20261026T2309_v04_tique_serie_y_quien_factura'

describe.skipIf(!listo)('V04 · el respaldo de una función: la vuelta atrás la deja byte a byte', () => {
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'v04-respaldo-'))
    if (comoPostgres) { chmodSync(dir, 0o777); chownSync(dir, 102, 104) }
    const ini = run(join(bin!, 'initdb'), ['-D', join(dir, 'datos'), '-A', 'trust', '-U', 'postgres', '--no-sync'])
    if (ini.status !== 0) throw new Error(ini.stderr)
    const arr = run(join(bin!, 'pg_ctl'), ['-D', join(dir, 'datos'), '-o', `-k ${dir} -p ${PUERTO} -c listen_addresses='' -c fsync=off`, '-w', 'start', '-l', join(dir, 'log')])
    if (arr.status !== 0) throw new Error(arr.stderr || readFileSync(join(dir, 'log'), 'utf8'))
    sql('create role anon; create role authenticated;')
    const bloque = /-- ── respaldo: inicio[^\n]*\n([\s\S]*?)-- ── respaldo: fin/.exec(readFileSync(MIGRACION, 'utf8'))?.[1]
    if (!bloque) throw new Error('La migración no tiene el bloque «respaldo» entre sus marcas.')
    sql(bloque)
    // Una función como la de producción: su cuerpo con \r\n.
    sql(`create or replace function public.f_tique(p_token text, p_sale uuid) returns jsonb language plpgsql security definer set search_path to 'public' as ` +
        `E'\\r\\ndeclare\\r\\n  v jsonb;\\r\\nbegin\\r\\n  return jsonb_build_object(''antes'', true);\\r\\nend;\\r\\n';\n` +
        `grant execute on function public.f_tique(text, uuid) to anon;`)
  }, 60_000)

  afterAll(() => {
    if (!dir) return
    run(join(bin!, 'pg_ctl'), ['-D', join(dir, 'datos'), '-m', 'immediate', 'stop'])
    rmSync(dir, { recursive: true, force: true })
  })

  it('cambiarla y restaurarla deja la misma huella, con sus \\r\\n y sus permisos', () => {
    const antes = sql(huella)
    expect(Number(sql(retornos))).toBe(6)
    expect(sql(`select public._respaldar_funcion('public.f_tique(text,uuid)', '${MIG}')`)).toBe(antes)
    // La migración la cambia (con \n, como se escribe en el repositorio).
    sql(`create or replace function public.f_tique(p_token text, p_sale uuid) returns jsonb language plpgsql security definer set search_path to 'public' as $$\nbegin\n  return jsonb_build_object('nueva', true);\nend;\n$$;`)
    expect(sql(huella)).not.toBe(antes)
    // Pasar la migración dos veces no pisa el respaldo de antes del cambio.
    expect(sql(`select public._respaldar_funcion('public.f_tique(text,uuid)', '${MIG}')`)).toBe(antes)
    // La vuelta atrás: la de antes, byte a byte.
    expect(sql(`select public._restaurar_funcion('public.f_tique(text,uuid)', '${MIG}')`)).toBe(antes)
    expect(sql(huella)).toBe(antes)
    expect(Number(sql(retornos))).toBe(6)
    expect(sql(`select has_function_privilege('anon', 'public.f_tique(text,uuid)', 'execute')`)).toBe('t')
    expect(sql(`select count(*) from public.funcion_respaldo`)).toBe('0')
  })

  it('una copia a mano con \\n (lo que hacía la primera vuelta atrás) deja OTRA huella: por eso el respaldo', () => {
    const antes = sql(huella)
    const lf = sql(`select replace(pg_get_functiondef('public.f_tique(text,uuid)'::regprocedure), chr(13), '')`)
    sql(lf + ';')
    expect(sql(huella)).not.toBe(antes)
  })

  it('sin respaldo, la vuelta atrás para y lo dice (no deja la función a medias)', () => {
    expect(() => sql(`select public._restaurar_funcion('public.f_tique(text,uuid)', 'otra_migracion')`)).toThrow(/No hay respaldo de public\.f_tique\(text,uuid\) de la migración otra_migracion/)
  })

  // El final del .down.sql de la 2309: quita el respaldo y sus dos funciones
  // solo si queda vacío (si otra tanda guardó la suya, se queda).
  const finalDelDown = () => {
    const down = readFileSync(join(raiz, 'supabase/vuelta-atras/20261026T2309_v04_tique_serie_y_quien_factura.down.sql'), 'utf8')
    const i = down.lastIndexOf('do $$')
    if (i < 0) throw new Error('La vuelta atrás no acaba con el bloque que quita el respaldo.')
    return down.slice(i)
  }
  it('con otro respaldo dentro, el final de la vuelta atrás no quita nada', () => {
    sql(`select public._respaldar_funcion('public.f_tique(text,uuid)', 'otra_tanda')`)
    sql(finalDelDown())
    expect(sql(`select to_regclass('public.funcion_respaldo') is not null`)).toBe('t')
    sql(`delete from public.funcion_respaldo`)
  })
  it('vacío, el final de la vuelta atrás quita la tabla y sus dos funciones', () => {
    sql(finalDelDown())
    expect(sql(`select to_regclass('public.funcion_respaldo') is null and to_regprocedure('public._respaldar_funcion(text,text)') is null and to_regprocedure('public._restaurar_funcion(text,text)') is null`)).toBe('t')
  })
})

describe.skipIf(listo)('V04 · el respaldo de una función (sin Postgres)', () => {
  it('este equipo no tiene los binarios de Postgres: la prueba del respaldo se salta (en GitHub sí corre)', () => {
    expect(listo).toBe(false)
  })
})
