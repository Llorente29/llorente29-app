// La regla del workflow de producción (respuesta 7 del C00) contra tandas
// REALES y lo que EXISTÍA en producción el 04/10/2026 (leído en solo lectura).
//   · La del C00, ya aplicada: copia fija en tanda-c00-20261004.txt.
//   · La noche 1 del R02, ya aplicada (04/10): copia fija en tanda-r02-noche1-20261004.txt.
//   · La de AHORA, el manifiesto vivo (supabase/produccion/aplicar.txt): la
//     noche 2 del R02, la eliminación (0200). Al reescribir el manifiesto para
//     otra tanda, esta parte se reescribe con él.
// Y los casos que tienen que parar, sobre la población del C00.
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
// @ts-expect-error — módulo .mjs sin tipos
import { analizarFichero, clasificar, creadosPorLaTanda, decidir, sentencias } from '../../../scripts/conta/produccion/analizar.mjs'

type Op = { accion: string; tipo: string; objeto: string; detalle: string }
type Existentes = { tablas: string[]; funciones: string[] }
const leerTanda = (f: string) => readFileSync(f, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
const leerExistentes = (f: string) => JSON.parse(readFileSync(f, 'utf8')) as Existentes
function poblacion(tanda: string[], ex: Existentes) {
  const porFichero: Record<string, Op[]> = Object.fromEntries(tanda.map((f) => [f, analizarFichero(f)]))
  const deLaTanda = creadosPorLaTanda(porFichero) as Set<string>
  const existe = (o: Op) => o.tipo === 'funcion'
    ? (o.objeto.includes('(') ? ex.funciones.includes(o.objeto) && !deLaTanda.has(o.objeto) : ex.funciones.some((f) => f.startsWith(`${o.objeto}(`)))
    : ex.tablas.includes(o.objeto.replace(/\(.*$/, '')) && !deLaTanda.has(o.objeto.replace(/\(.*$/, ''))
  return { porFichero, existe }
}

const tanda = leerTanda('tests/conta/produccion/tanda-c00-20261004.txt')
const existentes = leerExistentes('tests/conta/produccion/existentes-produccion-20261004.json')
const { porFichero, existe } = poblacion(tanda, existentes)

describe('la tanda del C00 (ya aplicada), tal cual', () => {
  it('son las dos del C01 y las doce del C00, en orden', () => {
    expect(tanda[0]).toContain('20261002T0100_c01')
    expect(tanda[1]).toContain('20261002T0110_c01')
    expect(tanda.slice(2).every((f) => f.includes('20261003T0'))).toBe(true)
    expect(tanda).toHaveLength(14)
  })

  it('ningún fichero PARA', () => {
    const paran = tanda.filter((f) => decidir(porFichero[f], existe).para.length > 0)
    expect(paran).toEqual([])
  })

  it('solo la 0140 reemplaza vat_rate_for, con su firma', () => {
    const tocan = tanda.filter((f) => decidir(porFichero[f], existe).tocaVatRateFor)
    expect(tocan).toEqual(['supabase/migrations/20261003T0140_c00_vat_rate_lee_de_impuestos.sql'])
  })

  it('lo existente que se altera es solo supplier, supplier_invoice, compliance_document, vat_rate (comentario) y vat_rate_for', () => {
    const tocados = new Set<string>()
    for (const f of tanda) for (const o of porFichero[f]) if (existe(o)) tocados.add(o.objeto.replace(/\(.*$/, ''))
    expect([...tocados].sort()).toEqual(['public.compliance_document', 'public.supplier', 'public.supplier_invoice', 'public.vat_rate', 'public.vat_rate_for'])
  })

  it('la T0110 recortada no tiene ninguna sentencia', () => {
    expect(sentencias(readFileSync(tanda[1], 'utf8'))).toEqual([])
  })
})

describe('la noche 1 del R02 (ya aplicada), tal cual', () => {
  const viva = leerTanda('tests/conta/produccion/tanda-r02-noche1-20261004.txt')
  const p = poblacion(viva, leerExistentes('tests/conta/produccion/existentes-produccion-r02-20261004.json'))
  const paran = () => viva.filter((f) => decidir(p.porFichero[f], p.existe).para.length > 0)

  it('son 0100–0140 y el saneado 0210, en orden; la eliminación (0200) NO va', () => {
    expect(viva.map((f) => f.replace(/^.*\/20261005T(\d{4})_.*$/, '$1'))).toEqual(['0100', '0110', '0120', '0130', '0140', '0210'])
    expect(viva.some((f) => f.includes('0200_r02_elimina'))).toBe(false)
  })

  it('PARAN exactamente 0120 y 0210: los dos que van en «autorizo»', () => {
    expect(paran()).toEqual([
      'supabase/migrations/20261005T0120_r02_lectores_de_la_resolucion.sql',
      'supabase/migrations/20261005T0210_r02_saneado_pedidos_abiertos.sql',
    ])
  })

  it('el comentario del manifiesto dice, para «autorizo», exactamente los que paran', () => {
    // La línea que se copia al campo: un comentario solo con nombres de fichero.
    const linea = readFileSync('tests/conta/produccion/tanda-r02-noche1-20261004.txt', 'utf8').split('\n')
      .find((l) => /^#\s+(\S+\.sql\s*)+$/.test(l))
    expect(linea).toBeDefined()
    expect(linea!.replace(/^#/, '').trim().split(/\s+/)).toEqual(paran().map((f) => f.replace(/^.*\//, '')))
  })

  it('ninguno toca vat_rate_for, y la 0120 lleva el aviso del execute dinámico (los feeds)', () => {
    expect(viva.filter((f) => decidir(p.porFichero[f], p.existe).tocaVatRateFor)).toEqual([])
    expect(decidir(p.porFichero[viva[2]], p.existe).avisos.length).toBeGreaterThan(0)
  })
})

describe('la tanda de AHORA (manifiesto vivo): noche 2 del R02, la eliminación', () => {
  const MANIFIESTO = 'supabase/produccion/aplicar.txt'
  const viva = leerTanda(MANIFIESTO)
  const p = poblacion(viva, leerExistentes('tests/conta/produccion/existentes-produccion-r02-0200-20261004.json'))
  const paran = () => viva.filter((f) => decidir(p.porFichero[f], p.existe).para.length > 0)

  it('es solo la 0200, sola', () => {
    expect(viva).toEqual(['supabase/migrations/20261005T0200_r02_elimina_interruptor_antiguo.sql'])
  })

  it('PARA, y para por borrar la columna y la función que existen', () => {
    expect(paran()).toEqual(viva)
    const motivos = decidir(p.porFichero[viva[0]], p.existe).para.join('\n')
    expect(motivos).toContain('marca_reparte_propio')
    expect(motivos).toContain('own_delivery_enabled')
  })

  it('el comentario del manifiesto dice, para «autorizo», exactamente los que paran', () => {
    const linea = readFileSync(MANIFIESTO, 'utf8').split('\n').find((l) => /^#\s+(\S+\.sql\s*)+$/.test(l))
    expect(linea).toBeDefined()
    expect(linea!.replace(/^#/, '').trim().split(/\s+/)).toEqual(paran().map((f) => f.replace(/^.*\//, '')))
  })

  it('su vuelta atrás está en el manifiesto de vuelta atrás, y existe', () => {
    const atras = leerTanda('supabase/produccion/vuelta-atras.txt')
    expect(atras).toEqual(['supabase/vuelta-atras/20261005T0200_r02_elimina_interruptor_antiguo.down.sql'])
    expect(readFileSync(atras[0], 'utf8')).toContain('add column if not exists own_delivery_enabled')
  })
})

describe('lo que tiene que parar', () => {
  const sup = (sql: string) => decidir(sentencias(sql).flatMap((s: string) => clasificar(s)), existe)
  it('borrar o renombrar algo existente', () => {
    expect(sup('alter table public.supplier drop column email').para).toHaveLength(1)
    expect(sup('alter table public.supplier rename column email to correo').para).toHaveLength(1)
    expect(sup('drop table public.vat_rate').para).toHaveLength(1)
    expect(sup('drop function public.vat_rate_for(uuid, date)').para).toHaveLength(1)
    expect(sup('drop function if exists public.vat_rate_for(p_category_id uuid, p_date date)').para).toHaveLength(1)
    expect(sup('drop function public.vat_rate_for').para).toHaveLength(1)
  })
  it('cambiar datos de algo existente, también dentro de un DO', () => {
    expect(sup("update public.supplier set name = 'x'").para).toHaveLength(1)
    expect(sup('delete from public.supplier_invoice').para).toHaveLength(1)
    expect(sup("do $$ begin update public.supplier set notes = null; end $$").para).toHaveLength(1)
  })
  it('reemplazar una función que no es vat_rate_for, o vat_rate_for con otra firma', () => {
    expect(sup('create or replace function public.vat_rate_for(p uuid, d date, x int) returns int language sql as $$ select 1 $$').para).toHaveLength(0)
    // Otra firma = otra función: no existe, así que es nueva (y crearía una sobrecarga: regla 2). Se ve en el informe.
    expect(sup('create or replace function public.vat_rate_for(p uuid, d date) returns int language sql as $$ select 1 $$').tocaVatRateFor).toBe(true)
  })
  it('una columna obligatoria sin valor por defecto, o un cambio de tipo', () => {
    expect(sup('alter table public.supplier add column x text not null').para).toHaveLength(1)
    expect(sup('alter table public.supplier alter column name type varchar(10)').para).toHaveLength(1)
  })
  it('lo que solo añade, sigue', () => {
    expect(sup('alter table public.supplier add column x text').para).toHaveLength(0)
    expect(sup("alter table public.supplier add column y text not null default 'a'").para).toHaveLength(0)
    expect(sup('create index on public.supplier (name)').para).toHaveLength(0)
    expect(sup('create or replace function public.otra() returns int language sql as $$ update public.supplier set name = null $$').para).toHaveLength(0)
  })
})

describe('D1: el comparador', () => {
  const comparar = (a: string, d: string) => {
    const fa = '/tmp/d1-a.csv'; const fd = '/tmp/d1-d.csv'
    writeFileSync(fa, a); writeFileSync(fd, d)
    try { return { ok: true, out: execFileSync('node', ['scripts/conta/produccion/d1-comparar.mjs', fa, fd]).toString() } }
    catch (e) { return { ok: false, out: String((e as { stdout?: Buffer }).stdout ?? e) } }
  }
  it('4 = 4.00, y la diferencia decidida del 4T2024 no cuenta', () => {
    expect(comparar('reducido,2025-01-01,10,1.4\nalimento_basico,2024-11-01,,\n', 'reducido,2025-01-01,10.00,1.40\nalimento_basico,2024-11-01,2.00,0.26\n').ok).toBe(true)
  })
  it('cualquier otra diferencia, sí', () => {
    const r = comparar('reducido,2025-01-01,10,1.4\n', 'reducido,2025-01-01,21,5.2\n')
    expect(r.ok).toBe(false)
    expect(r.out).toContain('diferencias: 1')
  })
})
