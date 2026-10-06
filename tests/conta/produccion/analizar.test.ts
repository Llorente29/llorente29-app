// La regla del workflow de producción (respuesta 7 del C00) contra tandas
// REALES y lo que EXISTÍA en producción el 04/10/2026 (leído en solo lectura).
//   · La del C00, ya aplicada: copia fija en tanda-c00-20261004.txt.
//   · La noche 1 del R02, ya aplicada: copia fija en tanda-r02-noche1-20261004.txt.
//   · La noche 2 del R02 (la eliminación, 0200), ya aplicada: copia fija en
//     tanda-r02-noche2-20261004.txt, con su vuelta atrás en
//     vuelta-atras-r02-noche2-20261004.txt (llegó a main después, desde 7470dc78).
//   · La de datos del C01b, ya aplicada (real 37219796909): copia fija en
//     tanda-c01b-datos-20261004.txt.
//   · La eliminación del C01b (0140), ya aplicada (columnas fuera y copia en
//     su tabla, medido el 05/10): copia fija en tanda-c01b-elimina-20261004.txt,
//     con su vuelta atrás en vuelta-atras-c01b-elimina-20261004.txt.
//   · La tanda 1 del C02, ya aplicada (en producción el 06/10 existen
//     company_account y sus funciones): copia fija en tanda-c02-tanda1-20261005.txt,
//     con su vuelta atrás en vuelta-atras-c02-tanda1-20261005.txt.
//   · El interruptor «Folvy Conta» de Foodint, tanda propia, ya aplicado (real
//     37432334442): copia fija en tanda-interruptor-foodint-20261006.txt, con su
//     vuelta atrás en vuelta-atras-interruptor-foodint-20261006.txt.
//   · La de AHORA, el manifiesto vivo (supabase/produccion/aplicar.txt): el
//     C02c (traer el plan de Diez). Lo existente está DEDUCIDO de las tandas ya
//     aplicadas, no medido (el conector a producción da «Unauthorized»): la
//     medida de verdad es la del ensayo. Al reescribir el manifiesto para otra
//     tanda, esta parte se reescribe con él.
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

describe('la noche 2 del R02 (la eliminación, 0200; ya aplicada), tal cual', () => {
  const COPIA = 'tests/conta/produccion/tanda-r02-noche2-20261004.txt'
  const viva = leerTanda(COPIA)
  const p = poblacion(viva, leerExistentes('tests/conta/produccion/existentes-produccion-r02-0200-20261004.json'))
  const paran = () => viva.filter((f) => decidir(p.porFichero[f], p.existe).para.length > 0)

  it('es solo la 0200, sola', () => {
    expect(viva).toEqual(['supabase/migrations/20261005T0200_r02_elimina_interruptor_antiguo.sql'])
  })

  it('PARA, y para por borrar la columna y la función que existían', () => {
    expect(paran()).toEqual(viva)
    const motivos = decidir(p.porFichero[viva[0]], p.existe).para.join('\n')
    expect(motivos).toContain('marca_reparte_propio')
    expect(motivos).toContain('own_delivery_enabled')
  })

  it('el comentario de la copia dice, para «autorizo», exactamente los que paran', () => {
    const linea = readFileSync(COPIA, 'utf8').split('\n').find((l) => /^#\s+(\S+\.sql\s*)+$/.test(l))
    expect(linea).toBeDefined()
    expect(linea!.replace(/^#/, '').trim().split(/\s+/)).toEqual(paran().map((f) => f.replace(/^.*\//, '')))
  })

  it('su vuelta atrás era la suya, y existe', () => {
    const atras = leerTanda('tests/conta/produccion/vuelta-atras-r02-noche2-20261004.txt')
    expect(atras).toEqual(['supabase/vuelta-atras/20261005T0200_r02_elimina_interruptor_antiguo.down.sql'])
    expect(readFileSync(atras[0], 'utf8')).toContain('add column if not exists own_delivery_enabled')
  })
})

describe('la tanda de datos del C01b (ya aplicada, real 37219796909), tal cual', () => {
  const viva = leerTanda('tests/conta/produccion/tanda-c01b-datos-20261004.txt')
  // Lo que existe en producción, medido en solo lectura el 04/10/2026.
  const p = poblacion(viva, leerExistentes('tests/conta/produccion/existentes-produccion-c01b-20261004.json'))
  const paran = () => viva.filter((f) => decidir(p.porFichero[f], p.existe).para.length > 0)

  it('son 0100–0135, en orden; la eliminación (0140) NO va', () => {
    expect(viva.map((f) => f.replace(/^.*\/20261006T(\d{4})_.*$/, '$1'))).toEqual(['0100', '0110', '0120', '0130', '0135'])
    expect(viva.some((f) => f.includes('0140_c01b_elimina'))).toBe(false)
  })
  it('PARAN exactamente 0110 (cambia datos de supplier) y 0120 (reemplaza dos funciones): los de «autorizo»', () => {
    expect(paran()).toEqual(['supabase/migrations/20261006T0110_c01b_datos.sql', 'supabase/migrations/20261006T0120_c01b_lectores.sql'])
  })
  it('el comentario del manifiesto dice, para «autorizo», exactamente los que paran', () => {
    const linea = readFileSync('tests/conta/produccion/tanda-c01b-datos-20261004.txt', 'utf8').split('\n').find((l) => /^#\s+(\S+\.sql\s*)+$/.test(l))
    expect(linea!.replace(/^#/, '').trim().split(/\s+/)).toEqual(paran().map((f) => f.replace(/^.*\//, '')))
  })
  it('cada fichero tiene su .down.sql', () => {
    for (const f of viva) {
      expect(readFileSync(f.replace('supabase/migrations/', 'supabase/vuelta-atras/').replace(/\.sql$/, '.down.sql'), 'utf8').length).toBeGreaterThan(0)
    }
  })
  it('y la eliminación (0140), en su tanda, PARA por borrar las cuatro columnas', () => {
    const ops = analizarFichero('supabase/migrations/20261006T0140_c01b_elimina.sql')
    const r = decidir(ops, (o: Op) => o.objeto === 'public.supplier')
    expect(r.para.filter((l: string) => l.startsWith('borra · columna'))).toHaveLength(4)
  })
})

describe('la eliminación del C01b (0140), ya aplicada', () => {
  const MANIFIESTO = 'tests/conta/produccion/tanda-c01b-elimina-20261004.txt'
  const viva = leerTanda(MANIFIESTO)
  const p = poblacion(viva, leerExistentes('tests/conta/produccion/existentes-produccion-c01b-0140-20261004.json'))
  const paran = () => viva.filter((f) => decidir(p.porFichero[f], p.existe).para.length > 0)

  it('es solo la 0140, sola', () => {
    expect(viva).toEqual(['supabase/migrations/20261006T0140_c01b_elimina.sql'])
  })

  it('PARA, y para por borrar las cuatro columnas que existen (notify_group no)', () => {
    expect(paran()).toEqual(viva)
    const motivos = decidir(p.porFichero[viva[0]], p.existe).para
    const borra = motivos.filter((l: string) => l.startsWith('borra · columna'))
    expect(borra).toHaveLength(4)
    for (const c of ['email', 'phone', 'address', 'usual_vat_rates']) expect(borra.join('\n')).toContain(c)
    expect(motivos.join('\n')).not.toContain('notify_group')
  })

  it('el comentario del manifiesto dice, para «autorizo», exactamente los que paran', () => {
    const linea = readFileSync(MANIFIESTO, 'utf8').split('\n').find((l) => /^#\s+(\S+\.sql\s*)+$/.test(l))
    expect(linea).toBeDefined()
    expect(linea!.replace(/^#/, '').trim().split(/\s+/)).toEqual(paran().map((f) => f.replace(/^.*\//, '')))
  })

  it('su vuelta atrás está en el manifiesto de vuelta atrás, y devuelve las cuatro con su tipo', () => {
    const atras = leerTanda('tests/conta/produccion/vuelta-atras-c01b-elimina-20261004.txt')
    expect(atras).toEqual(['supabase/vuelta-atras/20261006T0140_c01b_elimina.down.sql'])
    const sql = readFileSync(atras[0], 'utf8')
    expect(sql).toContain('add column if not exists email text')
    expect(sql).toContain("add column if not exists usual_vat_rates numeric[] not null default '{}'")
  })
})

describe('la tanda 1 del C02 (ya aplicada), tal cual', () => {
  const MANIFIESTO = 'tests/conta/produccion/tanda-c02-tanda1-20261005.txt'
  const viva = leerTanda(MANIFIESTO)
  const p = poblacion(viva, leerExistentes('tests/conta/produccion/existentes-produccion-c02-tanda1-20261005.json'))
  const paran = () => viva.filter((f) => decidir(p.porFichero[f], p.existe).para.length > 0)

  it('son las doce del C02 sin la 0170 (que va sola, en la tanda 2), en orden', () => {
    expect(viva.map((f) => f.match(/T(\d{4})_/)![1])).toEqual(['0100', '0110', '0115', '0120', '0130', '0140', '0150', '0160', '0180', '0185', '0187', '0189'])
    expect(viva.some((f) => f.includes('0170'))).toBe(false)
  })

  it('PARA solo la 0130, por rellenar las columnas que ella misma añade a expense_category', () => {
    expect(paran()).toEqual(['supabase/migrations/20261007T0130_c02_proveedor_400_410.sql'])
    const motivos = decidir(p.porFichero[paran()[0]], p.existe).para
    expect(motivos).toHaveLength(2)
    for (const m of motivos) expect(m).toMatch(/^cambia_datos · tabla · `?public\.expense_category`? · update/)
    const sql = readFileSync(paran()[0], 'utf8')
    expect(sql.match(/^update public\.expense_category\s+set supplier_account_leaf = '(4000|4100)',\s+supplier_account_ref = /gm)).toHaveLength(2)
  })

  it('la 0130 está nombrada para «autorizo» en la cabecera del manifiesto', () => {
    expect(readFileSync(MANIFIESTO, 'utf8')).toMatch(/^#\s+20261007T0130_c02_proveedor_400_410\.sql\s*$/m)
  })

  it('su vuelta atrás es la de las doce, al revés', () => {
    const atras = leerTanda('tests/conta/produccion/vuelta-atras-c02-tanda1-20261005.txt')
    expect(atras).toEqual([...viva].reverse().map((f) => f.replace('supabase/migrations/', 'supabase/vuelta-atras/').replace(/\.sql$/, '.down.sql')))
  })
})

describe('el interruptor de Foodint (ya aplicado), tal cual', () => {
  const MANIFIESTO = 'tests/conta/produccion/tanda-interruptor-foodint-20261006.txt'
  const viva = leerTanda(MANIFIESTO)
  // Lo que existe en producción, medido en solo lectura el 06/10/2026: feature_flags (0 filas) y accounts.
  const p = poblacion(viva, leerExistentes('tests/conta/produccion/existentes-produccion-interruptor-20261006.json'))

  it('es un solo fichero: el de datos del interruptor', () => {
    expect(viva).toEqual(['supabase/migrations/20261006T1300_conta_interruptor_foodint_datos.sql'])
  })
  it('NO para: solo inserta en feature_flags', () => {
    const r = decidir(p.porFichero[viva[0]], p.existe)
    expect(r.para).toEqual([])
    expect(p.porFichero[viva[0]].map((o: Op) => `${o.accion} · ${o.objeto}`)).toEqual(['inserta · public.feature_flags'])
  })
  it('por eso el manifiesto no nombra ningún fichero para «autorizo» (el workflow se niega si se autoriza uno que no para)', () => {
    expect(readFileSync(MANIFIESTO, 'utf8').split('\n').some((l) => /^#\s+(\S+\.sql\s*)+$/.test(l))).toBe(false)
  })
  it('su vuelta atrás es la suya, sola', () => {
    expect(leerTanda('tests/conta/produccion/vuelta-atras-interruptor-foodint-20261006.txt')).toEqual(['supabase/vuelta-atras/20261006T1300_conta_interruptor_foodint_datos.down.sql'])
  })
})

describe('la tanda de AHORA (manifiesto vivo): el C03', () => {
  const MANIFIESTO = 'supabase/produccion/aplicar.txt'
  const viva = leerTanda(MANIFIESTO)
  // MEDIDO en producción el 06/10 con el conector de solo lectura (to_regclass / pg_proc):
  // de lo que nombra la tanda, existen estas cuatro tablas y dos funciones.
  const p = poblacion(viva, leerExistentes('tests/conta/produccion/existentes-produccion-c03-20261006.json'))
  const paran = () => viva.filter((f) => decidir(p.porFichero[f], p.existe).para.length > 0)

  it('son las ocho del C03, en orden', () => {
    expect(viva.map((f) => f.match(/T(\d{4})_/)![1])).toEqual(['0100', '0110', '0120', '0130', '0140', '0150', '0160', '0170'])
    expect(viva.every((f) => f.startsWith('supabase/migrations/20261009T01'))).toBe(true)
  })
  it('PARAN la 0100, la 0130 y la 0160, cada una por lo suyo', () => {
    expect(paran()).toEqual([
      'supabase/migrations/20261009T0100_c03_terceros.sql',
      'supabase/migrations/20261009T0130_c03_periodos_propuestos.sql',
      'supabase/migrations/20261009T0160_c03_deshacer_importacion.sql',
    ])
    const motivo = (f: string) => decidir(p.porFichero[f], p.existe).para
    expect(motivo('supabase/migrations/20261009T0100_c03_terceros.sql')).toEqual([expect.stringMatching(/company_account_misma_cuenta\(\)/)])
    expect(motivo('supabase/migrations/20261009T0130_c03_periodos_propuestos.sql')).toEqual([expect.stringMatching(/channel_settlement.*update/)])
    expect(motivo('supabase/migrations/20261009T0160_c03_deshacer_importacion.sql')).toEqual([expect.stringMatching(/company_chart_import_undo\(uuid,text\)/)])
  })
  it('la 0170 solo añade: un disparador nuevo en supplier, sigue', () => {
    expect(decidir(p.porFichero['supabase/migrations/20261009T0170_c03_borrar_proveedor.sql'], p.existe).para).toEqual([])
  })
  it('las tres están nombradas para «autorizo» en la cabecera del manifiesto, y solo ellas', () => {
    const nombradas = readFileSync(MANIFIESTO, 'utf8').split('\n').filter((l) => /^#\s+(\S+\.sql\s*)+$/.test(l)).map((l) => l.replace(/^#\s+/, '').trim())
    expect(nombradas).toEqual(paran().map((f) => f.replace('supabase/migrations/', '')))
  })
  it('su vuelta atrás es la de las ocho, al revés', () => {
    const atras = leerTanda('supabase/produccion/vuelta-atras.txt')
    expect(atras).toEqual([...viva].reverse().map((f) => f.replace('supabase/migrations/', 'supabase/vuelta-atras/').replace(/\.sql$/, '.down.sql')))
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
  // C01b, 04/10: la 0110 salía «sigue» y cambia datos. Dos huecos: un «--»
  // dentro de un DO se comía el resto del bloque (se leía en una sola línea),
  // y las CTE que escriben no se miraban.
  it('…aunque el DO lleve comentarios «--» dentro', () => {
    expect(sup('do $$\nbegin\n  -- 1. Contactos\n  update public.supplier s set notes = null;\nend $$').para).toHaveLength(1)
  })
  it('…y aunque el cambio vaya dentro de un with (CTE que escribe)', () => {
    expect(sup('with n as (update public.supplier s set notes = null returning id) select count(*) from n').para).toHaveLength(1)
    expect(sup('with f as (delete from public.supplier_invoice where false returning id) select 1 from f').para).toHaveLength(1)
    expect(sup('do $$\nbegin\n  -- una CTE\n  with n as (delete from public.supplier where false returning id) select count(*) into v from n;\nend $$').para).toHaveLength(1)
  })
  it('la 0110 del C01b (datos) PARA: va en «autorizo»', () => {
    const ops = analizarFichero('supabase/migrations/20261006T0110_c01b_datos.sql')
    const r = decidir(ops, (o: Op) => ['public.supplier', 'public.supplier_contact', 'public.supplier_proposal'].includes(o.objeto))
    expect(r.para.some((l: string) => l.includes('`public.supplier` · update'))).toBe(true)
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
