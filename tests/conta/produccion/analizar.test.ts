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
//   · La del C04, ya aplicada (real 37697073290): copia fija en
//     tanda-c04-20261007.txt, con su vuelta atrás en vuelta-atras-c04-20261007.txt.
//   · La del C04 R4 (historial, corte de Foodint, fusionar terceros), ya
//     aplicada: las cuatro en el historial de producción con la huella del
//     repositorio (medido el 09/10). Copia fija en tanda-c04r-20261008.txt, con
//     su vuelta atrás en vuelta-atras-c04r-20261008.txt.
//   · La de AHORA, el manifiesto vivo (supabase/produccion/aplicar.txt): C05
//     (libros y balances), con el contexto de producción leído en solo lectura
//     el 09/10 y la regla del W01 (`informe`, la misma del ensayo). Al reescribir
//     el manifiesto para otra tanda, esta parte se reescribe con él.
// Y los casos que tienen que parar, sobre la población del C00.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
// @ts-expect-error — módulo .mjs sin tipos
import { analizarFichero, clasificar, creadosPorLaTanda, decidir, informe, sentencias } from '../../../scripts/conta/produccion/analizar.mjs'

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

describe('la tanda del C04 (ya aplicada, real 37697073290), tal cual', () => {
  const MANIFIESTO = 'tests/conta/produccion/tanda-c04-20261007.txt'
  const viva = leerTanda(MANIFIESTO)
  // MEDIDO en producción el 07/10 con el conector de solo lectura (to_regclass /
  // to_regprocedure), con la consulta del workflow: de lo que nombra la tanda,
  // existen 23 tablas y una función (conta_reabrir_mes, del C00).
  const p = poblacion(viva, leerExistentes('tests/conta/produccion/existentes-produccion-c04-20261007.json'))
  const paran = () => viva.filter((f) => decidir(p.porFichero[f], p.existe).para.length > 0)

  it('son la 0130 del C00 y las cuatro del C04, en orden', () => {
    expect(viva).toEqual([
      'supabase/migrations/20261003T0130_c00_valores_de_serie.sql',
      'supabase/migrations/20261010T0100_c04_libro.sql',
      'supabase/migrations/20261010T0110_c04_enlaces.sql',
      'supabase/migrations/20261010T0120_c04_funciones.sql',
      'supabase/migrations/20261010T0130_c04_lectura.sql',
    ])
  })
  it('PARAN la C00 0130 (UPDATE de expense_category) y la C04 0120 (reemplaza conta_reabrir_mes)', () => {
    expect(paran()).toEqual([
      'supabase/migrations/20261003T0130_c00_valores_de_serie.sql',
      'supabase/migrations/20261010T0120_c04_funciones.sql',
    ])
    const motivo = (f: string) => decidir(p.porFichero[f], p.existe).para
    expect(motivo('supabase/migrations/20261003T0130_c00_valores_de_serie.sql').every((l: string) => /expense_category.*update/.test(l))).toBe(true)
    expect(motivo('supabase/migrations/20261010T0120_c04_funciones.sql')).toEqual([expect.stringMatching(/conta_reabrir_mes\(uuid,date,text\)/)])
  })
  it('la 0110 del C04 (papel «liquidacion» en los CHECK de company_account_link) solo añade, sigue', () => {
    expect(decidir(p.porFichero['supabase/migrations/20261010T0110_c04_enlaces.sql'], p.existe).para).toEqual([])
  })
  it('las dos están nombradas para «autorizo» en la cabecera del manifiesto, y solo ellas', () => {
    const nombradas = readFileSync(MANIFIESTO, 'utf8').split('\n').filter((l) => /^#\s+(\S+\.sql\s*)+$/.test(l)).map((l) => l.replace(/^#\s+/, '').trim())
    expect(nombradas).toEqual(paran().map((f) => f.replace('supabase/migrations/', '')))
  })
  it('su vuelta atrás es la de las cuatro del C04, al revés (la 0130 del C00 no tiene)', () => {
    const atras = leerTanda('tests/conta/produccion/vuelta-atras-c04-20261007.txt')
    expect(existsSync('supabase/vuelta-atras/20261003T0130_c00_valores_de_serie.down.sql')).toBe(false)
    expect(atras).toEqual([...viva].filter((f) => f.includes('_c04_')).reverse().map((f) => f.replace('supabase/migrations/', 'supabase/vuelta-atras/').replace(/\.sql$/, '.down.sql')))
  })
})

describe('la tanda del C04 R4 (ya aplicada: las cuatro en el historial de producción con su huella), tal cual', () => {
  const MANIFIESTO = 'tests/conta/produccion/tanda-c04r-20261008.txt'
  const viva = leerTanda(MANIFIESTO)
  // MEDIDO en producción el 08/10 con el conector de solo lectura (to_regclass /
  // to_regprocedure): de lo que nombra la tanda existen las cinco tablas de
  // antes; party_merge y sus dos funciones, no.
  const p = poblacion(viva, leerExistentes('tests/conta/produccion/existentes-produccion-c04r-20261008.json'))
  const paran = () => viva.filter((f) => decidir(p.porFichero[f], p.existe).para.length > 0)

  it('la lectura de los agentes va primero; después el historial, el corte y la fusión', () => {
    expect(viva).toEqual([
      'supabase/migrations/20261012T0050_c04r_lectura.sql',
      'supabase/migrations/20261012T0100_c04r_historial.sql',
      'supabase/migrations/20261012T0110_c04r_corte_datos.sql',
      'supabase/migrations/20261012T0120_c04r_fusionar_terceros.sql',
    ])
  })
  it('PARA solo el corte: actualiza el ejercicio, quita y pone cierres y borra las propuestas', () => {
    expect(paran()).toEqual(['supabase/migrations/20261012T0110_c04r_corte_datos.sql'])
    const motivos = decidir(p.porFichero[paran()[0]], p.existe).para.join(' | ')
    for (const t of ['fiscal_year', 'fiscal_period_lock', 'journal_entry']) expect(motivos).toContain(t)
  })
  it('el corte está nombrado para «autorizo» en la cabecera del manifiesto, y solo él', () => {
    const nombradas = readFileSync(MANIFIESTO, 'utf8').split('\n').filter((l) => /^#\s+(\S+\.sql\s*)+$/.test(l)).map((l) => l.replace(/^#\s+/, '').trim())
    expect(nombradas).toEqual(paran().map((f) => f.replace('supabase/migrations/', '')))
  })
  it('el historial da de alta 58 ficheros, cada uno con la huella de su fichero en el repositorio', () => {
    const sql = readFileSync(viva[1], 'utf8')
    const filas = [...sql.matchAll(/\('(\d{8}T\d{4}_[a-z0-9_]+)', '([0-9a-f]{32})', 'run \d+ · [0-9a-f]+'\)/g)]
    // Dos veces cada una: la guarda (para si ya está con otra huella) y el alta.
    expect(filas.length).toBe(116)
    const unicas = new Map(filas.map((m) => [m[1], m[2]]))
    expect(unicas.size).toBe(58)
    for (const [v, md5] of unicas) {
      const f = `supabase/migrations/${v}.sql`
      expect(existsSync(f), f).toBe(true)
      expect(createHash('md5').update(readFileSync(f)).digest('hex'), `huella de ${v}`).toBe(md5)
    }
  })
  it('la lectura da a conta_lectura todo lo que nombran los agentes (sacado de sus SQL, no de memoria)', () => {
    const agentes = ['datos-maestros', 'terceros', 'libro', 'plan-contable'].map((a) => readFileSync(`scripts/conta/agente-${a}.sql`, 'utf8')).join('\n')
    const nombrados = new Set([...agentes.matchAll(/public\.([a-z_]+)/g)].map((m) => m[1]))
    const lectura = readFileSync(viva[0], 'utf8')
    const tablas = new Set([...lectura.match(/tablas constant text\[\] := array\[([\s\S]*?)\];/)![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]))
    const funciones = new Set([...lectura.matchAll(/grant execute on function public\.([a-z_]+)\(/g)].map((m) => m[1]))
    expect(nombrados.size).toBe(39)
    expect([...nombrados].filter((n) => !tablas.has(n) && !funciones.has(n))).toEqual([])
    expect([...tablas, ...funciones].filter((n) => !nombrados.has(n))).toEqual([])
  })
  it('su vuelta atrás es la de las cuatro, al revés', () => {
    expect(leerTanda('tests/conta/produccion/vuelta-atras-c04r-20261008.txt')).toEqual([...viva].reverse().map((f) => f.replace('supabase/migrations/', 'supabase/vuelta-atras/').replace(/\.sql$/, '.down.sql')))
  })
})

describe('la tanda de AHORA (manifiesto vivo): C05 — libros y balances', () => {
  const MANIFIESTO = 'supabase/produccion/aplicar.txt'
  const viva = leerTanda(MANIFIESTO)
  // La respuesta REAL de la consulta de contexto del workflow (sqlContexto)
  // sobre estos seis ficheros, lanzada en solo lectura en producción el 09/10:
  // existen journal_entry (0 filas), conta_resultado_por_local y
  // journal_entry_validar; nada en el camino del pedido; nada en el historial.
  const ctx = JSON.parse(readFileSync('tests/conta/produccion/contexto-produccion-c05-20261009.json', 'utf8'))
  const leer = (r: string) => { try { return readFileSync(r, 'utf8') } catch { return null } }
  const r = informe(viva, ctx, {}, leer) as { markdown: string; ficheros: Record<string, string> }
  const bloque = (f: string) => r.markdown.split('### ').find((b) => b.startsWith(`\`${f}\``))!

  it('los seis del C05, en el orden del informe final', () => {
    expect(viva).toEqual(['0100_c05_libros', '0110_c05_modelos_serie', '0120_c05_cambia', '0130_c05_modelo_elegido', '0140_c05_validar_cierre', '0150_c05_lectura']
      .map((n) => `supabase/migrations/20261014T${n}.sql`))
  })
  it('con la regla del W01 los seis siguen: ninguno pide autorizo ni bloquea', () => {
    expect(Object.values(r.ficheros)).toEqual(Array(6).fill('sigue'))
  })
  it('las dos que cambian algo que existe lo declaran, con una prueba de staging que existe', () => {
    for (const [f, objeto, prueba] of [
      [viva[2], '`public.conta_resultado_por_local(uuid,date,date,boolean)` — reemplaza la función (misma firma)', 'supabase/staging/sql/20261014_c05_prueba_cambia.sql'],
      [viva[4], '`public.journal_entry_validar(uuid,text)` — reemplaza la función (misma firma)', 'supabase/staging/sql/20261014_c05_prueba_libros.sql'],
    ]) {
      expect(bloque(f)).toContain(objeto)
      expect(bloque(f)).toContain(`declarado, prueba \`${prueba}\``)
      expect(existsSync(prueba), prueba).toBe(true)
    }
  })
  it('la cabecera del manifiesto no nombra nada para «autorizo»', () => {
    const nombradas = readFileSync(MANIFIESTO, 'utf8').split('\n').filter((l) => /^#\s+(\S+\.sql\s*)+$/.test(l))
    expect(nombradas).toEqual([])
  })
  it('su vuelta atrás son sus seis .down.sql, al revés, y existen', () => {
    const atras = leerTanda('supabase/produccion/vuelta-atras.txt')
    expect(atras).toEqual([...viva].reverse().map((f) => f.replace('supabase/migrations/', 'supabase/vuelta-atras/').replace(/\.sql$/, '.down.sql')))
    for (const f of atras) expect(existsSync(f), f).toBe(true)
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
