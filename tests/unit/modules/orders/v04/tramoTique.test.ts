// tests/unit/modules/orders/v04/tramoTique.test.ts
//
// V04 · PR 2 · La serie al pasar a «real» no repite números (Respuesta 2, 27/10).
// Contra un Postgres DE VERDAD (regla 31): se cargan TAL CUAL el bloque «serie»
// de la 2309 y el bloque «tramo» de la 0741, y se numera como la tablet.
//   · Sin Verifactu en real: como en el PR 1 (CA26-000001…).
//   · Paso a real a mitad de año, con números ya dados ese año: lo de real va en
//     el tramo B (CA26B-000001…), sin repetir ninguno del papel de antes.
//   · Paso a real el 1 de enero (sin números ese año): la serie del año ya es
//     nueva y va sin letra (CA27-000001).
//   · El año siguiente, otra vez sin letra.
//   · Dos impresiones a la vez en el tramo B: números distintos y seguidos.

import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, chownSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir, userInfo } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const raiz = resolve(__dirname, '../../../../..')
const M2309 = join(raiz, 'supabase/migrations/20261026T2309_v04_tique_serie_y_quien_factura.sql')
const M0741 = join(raiz, 'supabase/migrations/20261027T0741_v04_tique_verifactu.sql')
const bin = (() => {
  const base = '/usr/lib/postgresql'
  if (!existsSync(base)) return null
  const v = readdirSync(base).filter((d) => existsSync(join(base, d, 'bin', 'pg_ctl'))).sort().pop()
  return v ? join(base, v, 'bin') : null
})()
const listo = !!bin && spawnSync('psql', ['--version']).status === 0
const PUERTO = String(56000 + Math.floor(Math.random() * 900))
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
function aLaVez(q: string): Promise<string> {
  return new Promise((ok, mal) => {
    const p = spawn('psql', [...conexion(), '-c', `begin; ${q}; select pg_sleep(0.4); commit;`])
    let out = '', err = ''
    p.stdout.on('data', (d) => { out += d })
    p.stderr.on('data', (d) => { err += d })
    p.on('close', (c) => (c === 0 ? ok(out.trim().split('\n').filter((l) => l && l !== 'BEGIN' && l !== 'COMMIT')[0] ?? '') : mal(new Error(err))))
  })
}
const bloque = (f: string, nombre: string) => {
  const b = new RegExp(`-- ── ${nombre}: inicio[^\\n]*\\n([\\s\\S]*?)-- ── ${nombre}: fin`).exec(readFileSync(f, 'utf8'))?.[1]
  if (!b) throw new Error(`${f} no tiene el bloque «${nombre}» entre sus marcas.`)
  return b
}

const CUENTA = '00000000-0000-4000-8000-0000000000aa'
const CA = '00000000-0000-4000-8000-0000000000bb'
const AL = '00000000-0000-4000-8000-0000000000cc'
const EMPRESA = '00000000-0000-4000-8000-0000000000dd'
const venta = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const numerar = (local: string, code: string, v: string, at: string) =>
  `select number_text from public._ticket_invoice_number('${CUENTA}', '${local}', '${v}', '${code}', 'Llorente29 Food, S.L.', 'B56496938', timestamptz '${at}')`
const real = (desde: string) => `update public.verifactu_empresa set modo = 'real', real_desde = timestamptz '${desde}' where company_id = '${EMPRESA}'`

describe.skipIf(!listo)('V04 · el tramo de la serie al pasar a real, en un Postgres de verdad', () => {
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'v04-tramo-'))
    if (comoPostgres) { chmodSync(dir, 0o777); chownSync(dir, 102, 104) }
    const ini = run(join(bin!, 'initdb'), ['-D', join(dir, 'datos'), '-A', 'trust', '-U', 'postgres', '--no-sync'])
    if (ini.status !== 0) throw new Error(ini.stderr)
    const arr = run(join(bin!, 'pg_ctl'), ['-D', join(dir, 'datos'), '-o', `-k ${dir} -p ${PUERTO} -c listen_addresses='' -c fsync=off`, '-w', 'start', '-l', join(dir, 'log')])
    if (arr.status !== 0) throw new Error(arr.stderr || readFileSync(join(dir, 'log'), 'utf8'))
    // Lo mínimo de fuera que usan los dos bloques.
    sql(`create role anon; create role authenticated;
         create table public.accounts (id uuid primary key, name text);
         create table public.locations (id uuid primary key, account_id uuid, name text);
         create table public.location_company (location_id uuid primary key, account_id uuid, company_id uuid);
         create table public.verifactu_empresa (company_id uuid primary key, modo text, real_desde timestamptz);
         insert into public.accounts values ('${CUENTA}', 'Foodint');
         insert into public.locations values ('${CA}', '${CUENTA}', 'Foodint Carabanchel'), ('${AL}', '${CUENTA}', 'Foodint Alcalá');
         insert into public.location_company values ('${CA}', '${CUENTA}', '${EMPRESA}'), ('${AL}', '${CUENTA}', '${EMPRESA}');
         insert into public.verifactu_empresa values ('${EMPRESA}', 'pruebas', null);`)
    sql(bloque(M2309, 'serie'))
    // La columna company_id del tique la añade la 0741 fuera del bloque (con su clave ajena a company).
    sql(`alter table public.ticket_invoice add column company_id uuid;`)
    sql(bloque(M0741, 'tramo'))
  }, 60_000)

  afterAll(() => {
    if (!dir) return
    run(join(bin!, 'pg_ctl'), ['-D', join(dir, 'datos'), '-m', 'immediate', 'stop'])
    rmSync(dir, { recursive: true, force: true })
  })

  it('en pruebas, como en el PR 1: sin letra, y con la empresa del local', () => {
    expect(sql(numerar(CA, 'CA', venta(1), '2026-10-27T10:00:00+00'))).toBe('CA26-000001')
    expect(sql(numerar(CA, 'CA', venta(2), '2026-10-27T11:00:00+00'))).toBe('CA26-000002')
    expect(sql(`select company_id from public.ticket_invoice where sale_id = '${venta(1)}'`)).toBe(EMPRESA)
  })

  it('a real a mitad de año, con números dados: tramo B, sin repetir ninguno', () => {
    sql(real('2026-10-27T12:00:00+00'))
    expect(sql(numerar(CA, 'CA', venta(3), '2026-10-27T12:05:00+00'))).toBe('CA26B-000001')
    expect(sql(numerar(CA, 'CA', venta(4), '2026-10-27T12:06:00+00'))).toBe('CA26B-000002')
    // Reimprimir el de antes no cambia nada: sigue siendo el suyo.
    expect(sql(numerar(CA, 'CA', venta(1), '2026-10-27T12:07:00+00'))).toBe('CA26-000001')
    // Un local que no había dado números ese año no necesita letra.
    expect(sql(numerar(AL, 'AL', venta(5), '2026-10-27T12:08:00+00'))).toBe('AL26-000001')
    expect(sql(`select count(distinct number_text) = count(*) from public.ticket_invoice`)).toBe('t')
  })

  it('dos impresiones a la vez en el tramo B: números distintos y seguidos', async () => {
    const [a, b] = await Promise.all([aLaVez(numerar(CA, 'CA', venta(6), '2026-10-27T13:00:00+00')), aLaVez(numerar(CA, 'CA', venta(7), '2026-10-27T13:00:00+00'))])
    expect([a, b].sort()).toEqual(['CA26B-000003', 'CA26B-000004'])
  }, 15_000)

  it('el año siguiente (en Madrid), otra vez sin letra: la serie del año ya es nueva', () => {
    // 31/12/2026 a las 23:30 UTC ya es 2027 en Madrid.
    expect(sql(numerar(CA, 'CA', venta(8), '2026-12-31T23:30:00+00'))).toBe('CA27-000001')
  })

  it('a real el 1 de enero, sin números ese año: sin letra (CA28-)', () => {
    sql(real('2028-01-01T00:00:00+01'))
    expect(sql(numerar(CA, 'CA', venta(9), '2028-01-01T09:00:00+01'))).toBe('CA28-000001')
  })

  it('el texto del número, con y sin tramo, y la R de las rectificativas', () => {
    expect(sql(`select public._ticket_numero_texto('CA', 2027, 'B', 'R', 4)`)).toBe('CA27B-R-000004')
    expect(sql(`select public._ticket_numero_texto('CA', 2027, null, 'F', 123)`)).toBe('CA27-000123')
  })
})

describe.skipIf(listo)('V04 · el tramo de la serie (sin Postgres)', () => {
  it('este equipo no tiene los binarios de Postgres: la prueba del tramo se salta (en GitHub sí corre)', () => {
    expect(listo).toBe(false)
  })
})
