// tests/unit/modules/orders/v04/serieTique.test.ts
//
// V04 · PR 1 · La serie de las facturas simplificadas del tique de la bolsa,
// contra un Postgres DE VERDAD (regla 31): se arranca uno de usar y tirar, se
// carga el bloque «serie» de la migración 20261026T2309 TAL CUAL (entre sus dos
// marcas) y se le dan impresiones a la vez, cada una en su conexión.
//   · dos impresiones a la vez del mismo pedido: el mismo número, un solo gasto;
//   · reimprimir no gasta número;
//   · veinte pedidos a la vez: del 1 al 20, sin repetir y sin huecos;
//   · el año nuevo empieza otra serie, y la serie llena falla (no se inventa).
// Si el equipo no tiene los binarios de Postgres, la prueba lo dice y se salta
// (los runners de GitHub los traen: /usr/lib/postgresql/<v>/bin).

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, chmodSync, chownSync } from 'node:fs'
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
const hayPsql = spawnSync('psql', ['--version']).status === 0
const PUERTO = String(54000 + Math.floor(Math.random() * 900))
let dir = ''
const comoPostgres = userInfo().uid === 0   // initdb no corre como root
const run = (exe: string, args: string[]) =>
  comoPostgres ? spawnSync('runuser', ['-u', 'postgres', '--', exe, ...args], { encoding: 'utf8' }) : spawnSync(exe, args, { encoding: 'utf8' })

const conexion = () => ['-h', dir, '-p', PUERTO, '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1']
function sql(q: string): string {
  const r = spawnSync('psql', [...conexion(), '-c', q], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(r.stderr || `psql salió con ${r.status}`)
  return r.stdout.trim()
}
/** Una conexión aparte, en su transacción, que tarda en confirmar: así se pisan de verdad. */
function aLaVez(q: string): Promise<string> {
  return new Promise((ok, mal) => {
    const p = spawn('psql', [...conexion(), '-c', `begin; ${q}; select pg_sleep(0.4); commit;`])
    let out = '', err = ''
    p.stdout.on('data', (d) => { out += d })
    p.stderr.on('data', (d) => { err += d })
    p.on('close', (c) => (c === 0 ? ok(out.trim().split('\n').filter((l) => l && l !== 'BEGIN' && l !== 'COMMIT' && l !== '')[0] ?? '') : mal(new Error(err))))
  })
}

const CUENTA = '00000000-0000-4000-8000-0000000000aa'
const LOCAL = '00000000-0000-4000-8000-0000000000bb'
const numerar = (venta: string, at = '2026-10-26T20:00:00+00') =>
  `select number_text from public._ticket_invoice_number('${CUENTA}', '${LOCAL}', '${venta}', 'CA', 'Llorente29 Food, S.L.', 'B56496938', timestamptz '${at}')`
const venta = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

const listo = !!bin && hayPsql
describe.skipIf(!listo)('V04 · la serie del tique, en un Postgres de verdad', () => {
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'v04-serie-'))
    if (comoPostgres) { chmodSync(dir, 0o777); chownSync(dir, 102, 104) }
    const ini = run(join(bin!, 'initdb'), ['-D', join(dir, 'datos'), '-A', 'trust', '-U', 'postgres', '--no-sync'])
    if (ini.status !== 0) throw new Error(ini.stderr)
    const arr = run(join(bin!, 'pg_ctl'), ['-D', join(dir, 'datos'), '-o', `-k ${dir} -p ${PUERTO} -c listen_addresses='' -c fsync=off`, '-w', 'start', '-l', join(dir, 'log')])
    if (arr.status !== 0) throw new Error(arr.stderr || readFileSync(join(dir, 'log'), 'utf8'))
    // Lo mínimo de fuera que el bloque usa (roles de Supabase, cuentas y locales).
    sql(`create role anon; create role authenticated;
         create table public.accounts (id uuid primary key, name text);
         create table public.locations (id uuid primary key, account_id uuid, name text);
         insert into public.accounts values ('${CUENTA}', 'Foodint');
         insert into public.locations values ('${LOCAL}', '${CUENTA}', 'Foodint Carabanchel');`)
    const m = readFileSync(MIGRACION, 'utf8')
    const bloque = /-- ── serie: inicio[^\n]*\n([\s\S]*?)-- ── serie: fin/.exec(m)?.[1]
    if (!bloque) throw new Error('La migración no tiene el bloque «serie» entre sus marcas.')
    const r = spawnSync('psql', [...conexion(), '-f', '-'], { input: bloque, encoding: 'utf8' })
    if (r.status !== 0) throw new Error(r.stderr)
  }, 60_000)

  afterAll(() => {
    if (!dir) return
    run(join(bin!, 'pg_ctl'), ['-D', join(dir, 'datos'), '-m', 'immediate', 'stop'])
    rmSync(dir, { recursive: true, force: true })
  })

  it('el primero de 2026 en Carabanchel es CA26-000001, y reimprimirlo no gasta número', () => {
    expect(sql(numerar(venta(1)))).toBe('CA26-000001')
    expect(sql(numerar(venta(1)))).toBe('CA26-000001')
    expect(sql(`select last_number from public.ticket_invoice_series where kind = 'F' and year = 2026`)).toBe('1')
    expect(sql(`select count(*) from public.ticket_invoice`)).toBe('1')
  })

  it('dos impresiones a la vez del mismo pedido: el mismo número, y la serie avanza una sola vez', async () => {
    const [a, b] = await Promise.all([aLaVez(numerar(venta(2))), aLaVez(numerar(venta(2)))])
    expect(a).toBe('CA26-000002')
    expect(b).toBe('CA26-000002')
    expect(sql(`select last_number from public.ticket_invoice_series where kind = 'F' and year = 2026`)).toBe('2')
  }, 15_000)

  // Van uno detrás de otro sobre la fila de su serie (cada uno la tiene hasta su commit): unos 8 s.
  it('veinte pedidos a la vez: del 3 al 22, sin repetir ni saltarse ninguno', async () => {
    const ns = await Promise.all(Array.from({ length: 20 }, (_, i) => aLaVez(numerar(venta(100 + i)))))
    const nums = ns.map((t) => Number(t.slice(-6))).sort((x, y) => x - y)
    expect(nums).toEqual(Array.from({ length: 20 }, (_, i) => i + 3))
    expect(sql(`select last_number from public.ticket_invoice_series where kind = 'F' and year = 2026`)).toBe('22')
    // Y en la base, la serie no tiene huecos: del 1 al último, uno por número.
    expect(sql(`select count(*) = max(number) and count(distinct number) = count(*) from public.ticket_invoice where kind = 'F'`)).toBe('t')
  }, 30_000)

  it('el 1 de enero (en Madrid) empieza otra serie; las rectificativas llevan la R', () => {
    // 31/12/2026 a las 23:30 UTC ya es 2027 en Madrid.
    expect(sql(numerar(venta(500), '2026-12-31T23:30:00+00'))).toBe('CA27-000001')
    expect(sql(`select public._ticket_invoice_text('CA', 2027, 'R', 4)`)).toBe('CA27-R-000004')
  })

  it('una serie llena falla: no se inventa un número', () => {
    sql(`update public.ticket_invoice_series set last_number = 999999 where year = 2027 and kind = 'F'`)
    expect(() => sql(numerar(venta(501), '2027-03-01T10:00:00+00'))).toThrow(/ticket_invoice_series_last_number_check|check constraint/)
    expect(sql(`select count(*) from public.ticket_invoice where sale_id = '${venta(501)}'`)).toBe('0')
  })

  it('Folvy propone las dos primeras letras del local, sin el nombre de la cuenta', () => {
    const p = (l: string, c: string) => sql(`select public._ticket_codigo_propuesto('${l}', '${c}')`)
    expect(p('Foodint Carabanchel', 'Foodint')).toBe('CA')
    expect(p('Foodint Alcalá', 'Foodint')).toBe('AL')
    expect(p('Foodint Plaza Castilla', 'Foodint')).toBe('PL')
    expect(p('Foodint', 'Foodint')).toBe('FO')
  })
})

describe.skipIf(listo)('V04 · la serie del tique (sin Postgres)', () => {
  it('este equipo no tiene los binarios de Postgres: la prueba de la serie se salta (en GitHub sí corre)', () => {
    expect(listo).toBe(false)
  })
})
