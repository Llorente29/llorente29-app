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
//   · La del C05 (libros y balances), ya aplicada: los seis en el historial de
//     producción con la huella del repositorio (medido el 09/10). Copia fija en
//     tanda-c05-20261009.txt, con su vuelta atrás en vuelta-atras-c05-20261009.txt.
//   · La de AHORA, el manifiesto vivo (supabase/produccion/aplicar.txt): las
//     políticas de lectura de contabilidad una vez por consulta, con el
//     contexto de producción leído en solo lectura el 09/10 y la regla del W01
//     (`informe`, la misma del ensayo). Al reescribir el manifiesto para otra
//     tanda, esta parte se reescribe con él.
// Y los casos que tienen que parar, sobre la población del C00.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
// @ts-expect-error — módulo .mjs sin tipos
import { analizarFichero, clasificar, creadosPorLaTanda, decidir, informe, sentencias } from '../../../scripts/conta/produccion/analizar.mjs'

type Op = { accion: string; tipo: string; objeto: string; detalle: string }
type Existentes = { tablas: string[]; funciones: string[] }
// Las líneas «cuenta:» declaran qué se cuenta antes y después (R9): no son ficheros de la tanda.
const leerTanda = (f: string) => readFileSync(f, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && !l.startsWith('cuenta:'))
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
    // Y lo que añadió después el cierre del día (conta_cerrado_hasta, comprobación cierre_dia).
    const cierre = readFileSync('supabase/migrations/20261016T0160_cierre_del_dia_lectura.sql', 'utf8')
    // Y el cierre del día 2 (journal_dismissal, comprobación dia_sin_asiento).
    const cierre2 = readFileSync('supabase/migrations/20261018T0120_cierre_proponer_lectura.sql', 'utf8')
    const tablas = new Set([...lectura.match(/tablas constant text\[\] := array\[([\s\S]*?)\];/)![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]))
    // Y el registro del cierre del día (C04b R5, el porqué del día sin asiento).
    const registro = readFileSync('supabase/migrations/20261020T0140_libro_lectura_registro.sql', 'utf8')
    for (const m of `${cierre2}\n${registro}`.matchAll(/grant select on table public\.([a-z_]+) to conta_lectura/g)) tablas.add(m[1])
    // C06b (#178): el agente del plan lee import_run, que la lectura de Diez (C04b) ya da a conta_lectura.
    const diez = readFileSync('supabase/migrations/20261019T0120_diez_lectura.sql', 'utf8')
    if (/grant select on table public\.import_run\b/.test(diez)) tablas.add('import_run')
    const funciones = new Set([...`${lectura}\n${cierre}`.matchAll(/grant execute on function public\.([a-z_]+)\(/g)].map((m) => m[1]))
    expect(nombrados.size).toBe(43) // 42 + import_run (C06b, #178)
    expect([...nombrados].filter((n) => !tablas.has(n) && !funciones.has(n))).toEqual([])
    expect([...tablas, ...funciones].filter((n) => !nombrados.has(n))).toEqual([])
  })
  it('su vuelta atrás es la de las cuatro, al revés', () => {
    expect(leerTanda('tests/conta/produccion/vuelta-atras-c04r-20261008.txt')).toEqual([...viva].reverse().map((f) => f.replace('supabase/migrations/', 'supabase/vuelta-atras/').replace(/\.sql$/, '.down.sql')))
  })
})

describe('la tanda del C05 — libros y balances (ya aplicada: los seis en el historial de producción con su huella), tal cual', () => {
  const MANIFIESTO = 'tests/conta/produccion/tanda-c05-20261009.txt'
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
    const atras = leerTanda('tests/conta/produccion/vuelta-atras-c05-20261009.txt')
    expect(atras).toEqual([...viva].reverse().map((f) => f.replace('supabase/migrations/', 'supabase/vuelta-atras/').replace(/\.sql$/, '.down.sql')))
    for (const f of atras) expect(existsSync(f), f).toBe(true)
  })
})

describe('la tanda de las políticas de lectura (copia del manifiesto, aplicada el 09/10)', () => {
  const MANIFIESTO = 'tests/conta/produccion/tanda-politicas-20261009.txt'
  const viva = leerTanda(MANIFIESTO)
  // La respuesta REAL de la consulta de contexto del workflow (sqlContexto)
  // sobre estos dos ficheros, lanzada en solo lectura en producción el 09/10:
  // existen las 49 tablas; sales_day_summary está en el camino del pedido (por
  // el nombre, «sales_.*»); nada en el historial.
  const ctx = JSON.parse(readFileSync('tests/conta/produccion/contexto-produccion-politicas-20261009.json', 'utf8'))
  const leer = (r: string) => { try { return readFileSync(r, 'utf8') } catch { return null } }
  const r = informe(viva, ctx, {}, leer) as { markdown: string; ficheros: Record<string, string> }
  const bloque = (f: string) => r.markdown.split('### ').find((b) => b.startsWith(`\`${f}\``))!
  const medidas = JSON.parse(readFileSync('tests/conta/produccion/politicas-c00-c05-produccion-20261009.json', 'utf8')) as { t: string; p: string }[]
  const PRUEBA = 'supabase/staging/sql/20261015_politicas_prueba.sql'

  it('las dos, la de las 48 primero y la de sales_day_summary después', () => {
    expect(viva).toEqual(['supabase/migrations/20261015T0100_politicas_una_vez.sql', 'supabase/migrations/20261015T0110_politicas_una_vez_resumen.sql'])
  })
  it('entre las dos cambian EXACTAMENTE las 49 políticas medidas en producción, cada una una vez', () => {
    const cambiadas = viva.flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/^create policy (\S+) on public\.(\S+) as permissive for select/gm)].map((m) => `${m[2]}.${m[1]}`))
    expect(cambiadas.length).toBe(49)
    expect([...cambiadas].sort()).toEqual(medidas.map((x) => `${x.t}.${x.p}`).sort())
  })
  it('la de las 48 sigue sola; la de sales_day_summary pide «autorizo» por el camino del pedido', () => {
    expect(r.ficheros).toEqual({ [viva[0]]: 'sigue', [viva[1]]: 'autorizo' })
    expect(bloque(viva[1])).toContain('camino del pedido: autorizo')
  })
  it('cada política la declara su cabecera, con la prueba de staging, que existe y nombra las 49 tablas', () => {
    expect((bloque(viva[0]).match(/declarado, prueba/g) ?? []).length).toBe(48 * 2)
    const prueba = readFileSync(PRUEBA, 'utf8')
    for (const { t } of medidas) expect(prueba, t).toMatch(new RegExp(`\\b${t}\\b`))
  })
  it('la cabecera del manifiesto nombra para «autorizo» solo la de sales_day_summary', () => {
    const nombradas = readFileSync(MANIFIESTO, 'utf8').split('\n').filter((l) => /^#\s+(\S+\.sql\s*)+$/.test(l)).map((l) => l.replace(/^#\s+/, '').trim())
    expect(nombradas).toEqual(['20261015T0110_politicas_una_vez_resumen.sql'])
  })
  it('su vuelta atrás son sus dos .down.sql, al revés, y existen', () => {
    const atras = leerTanda('tests/conta/produccion/vuelta-atras-politicas-20261009.txt')
    expect(atras).toEqual([...viva].reverse().map((f) => f.replace('supabase/migrations/', 'supabase/vuelta-atras/').replace(/\.sql$/, '.down.sql')))
    for (const f of atras) expect(existsSync(f), f).toBe(true)
  })
})

describe('la tanda del cierre del día (09/10, ya en el historial de producción)', () => {
  const MANIFIESTO = 'tests/conta/produccion/tanda-cierre-20261009.txt'
  const viva = leerTanda(MANIFIESTO)
  // La respuesta REAL de la consulta de contexto del workflow (sqlContexto)
  // sobre estos siete ficheros, lanzada en solo lectura en producción el 09/10:
  // existen sale, journal_entry y company_tax_profile, las dos conta_ que se
  // reemplazan y el disparador de consumo; sale y el disparador están en el
  // camino del pedido; nada en el historial.
  const ctx = JSON.parse(readFileSync('tests/conta/produccion/contexto-produccion-cierre-20261009.json', 'utf8'))
  const leer = (r: string) => { try { return readFileSync(r, 'utf8') } catch { return null } }
  const r = informe(viva, ctx, {}, leer) as { markdown: string; ficheros: Record<string, string> }
  const bloque = (f: string) => r.markdown.split('### ').find((b) => b.startsWith(`\`${f}\``))!
  const PRUEBA = 'supabase/staging/sql/20261016_cierre_del_dia_prueba.sql'

  it('las siete, en su orden: la base, el consumo, proponer, retirar, el cron, la liquidación y la lectura', () => {
    expect(viva.map((f) => f.replace(/^.*\/20261016T/, '').replace(/\.sql$/, ''))).toEqual([
      '0100_cierre_del_dia', '0110_cierre_del_dia_consumo', '0120_cierre_del_dia_proponer', '0130_cierre_del_dia_retirar',
      '0140_cierre_del_dia_cron', '0150_cierre_del_dia_liquidacion', '0160_cierre_del_dia_lectura'])
  })
  it('piden «autorizo» la 0110 (el disparador de consumo, camino del pedido) y la 0130 (borra lo propuesto antes de su cierre); el resto sigue', () => {
    expect(r.ficheros).toEqual(Object.fromEntries(viva.map((f) => [f, /T0110_|T0130_/.test(f) ? 'autorizo' : 'sigue'])))
    expect(bloque(viva[1])).toContain('camino del pedido: autorizo')
    expect(bloque(viva[3])).toContain('delete')
  })
  it('lo que cambia en caliente lo declara su cabecera, con la prueba de staging, que existe y nombra cada objeto', () => {
    expect((bloque(viva[2]).match(/declarado, prueba/g) ?? []).length).toBe(2)
    const prueba = readFileSync(PRUEBA, 'utf8')
    for (const o of ['tg_sale_consumption_on_complete', 'generate_sale_consumption', 'conta_dias_por_asentar', 'conta_pedidos_del_dia']) expect(prueba, o).toMatch(new RegExp(`\\b${o}\\b`))
  })
  it('el execute dinámico de la 0110 es la línea de generate_sale_consumption, y sale como aviso', () => {
    expect(bloque(viva[1])).toMatch(/execute dinámico[\s\S]*generate_sale_consumption/)
  })
  it('la cabecera del manifiesto nombra para «autorizo» exactamente la 0110 y la 0130', () => {
    const nombradas = readFileSync(MANIFIESTO, 'utf8').split('\n').filter((l) => /^#\s+(\S+\.sql\s*)+$/.test(l)).map((l) => l.replace(/^#\s+/, '').trim())
    expect(nombradas).toEqual(['20261016T0110_cierre_del_dia_consumo.sql 20261016T0130_cierre_del_dia_retirar.sql'])
  })
  it('su vuelta atrás son sus siete .down.sql, al revés, y existen', () => {
    const atras = leerTanda('tests/conta/produccion/vuelta-atras-cierre-20261009.txt')
    expect(atras).toEqual([...viva].reverse().map((f) => f.replace('supabase/migrations/', 'supabase/vuelta-atras/').replace(/\.sql$/, '.down.sql')))
    for (const f of atras) expect(existsSync(f), f).toBe(true)
  })
})

describe('la tanda de compras (ya aplicada: las diez en el historial de producción con su huella, real 48 del 11/10), tal cual', () => {
  const MANIFIESTO = 'tests/conta/produccion/tanda-compras-20261010.txt'
  const viva = leerTanda(MANIFIESTO)
  // La respuesta REAL de la consulta de contexto del workflow (sqlContexto)
  // sobre los nueve primeros ficheros, lanzada en solo lectura en producción
  // el 10/10: existen goods_receipt, journal_entry, licensed_settlement,
  // supplier y supplier_invoice, y party_merge_do / _undo; nada en el camino
  // del pedido; nada en el historial. La 0190 (el repaso) no nombra nada más
  // que exista: sus funciones, goods_receipt_path y la columna nueva no
  // estaban en producción (medido el 10/10, solo lectura).
  const ctx = JSON.parse(readFileSync('tests/conta/produccion/contexto-produccion-compras-20261010.json', 'utf8'))
  const leer = (r: string) => { try { return readFileSync(r, 'utf8') } catch { return null } }
  const r = informe(viva, ctx, {}, leer) as { markdown: string; ficheros: Record<string, string> }
  const bloque = (f: string) => r.markdown.split('### ').find((b) => b.startsWith(`\`${f}\``))!

  it('las diez, en su orden', () => {
    expect(viva.map((f) => f.replace(/^.*\/20261017T/, '').replace(/\.sql$/, ''))).toEqual([
      '0100_compras_fusion_proveedores', '0110_compras_socio_una_ficha', '0120_compras_forma_de_facturar',
      '0130_compras_forma_de_facturar_datos', '0140_compras_factura_desde_el_papel', '0150_compras_pendiente_y_fin_de_mes',
      '0160_compras_liquidacion_mensual', '0170_compras_pantallas', '0180_compras_octubre_foodint', '0190_compras_repaso'])
  })
  it('pide «autorizo» la 0130 (cambia datos de tres fichas); el resto sigue', () => {
    expect(r.ficheros).toEqual(Object.fromEntries(viva.map((f) => [f, /T0130_/.test(f) ? 'autorizo' : 'sigue'])))
    expect(bloque(viva[3])).toContain('update')
  })
  it('los disparadores nuevos sobre tablas que ya existen los declara su cabecera, con su prueba, que nombra la tabla', () => {
    for (const [i, tabla, prueba] of [[2, 'goods_receipt', 'supabase/staging/sql/20261017_compras_camino_prueba.sql'],
                                      [4, 'supplier_invoice', 'supabase/staging/sql/20261017_compras_factura_prueba.sql']] as const) {
      expect((bloque(viva[i]).match(/declarado, prueba/g) ?? []).length, tabla).toBeGreaterThan(0)
      expect(readFileSync(prueba, 'utf8'), tabla).toMatch(new RegExp(`\\b${tabla}\\b`))
    }
  })
  it('el manifiesto dice que la 0110 y la 0180 mueven datos por una función, que el analizador no lee', () => {
    const m = readFileSync(MANIFIESTO, 'utf8')
    expect(m).toMatch(/0110[\s\S]*no lee dentro de una llamada a función/)
    expect(m).toMatch(/0180[\s\S]*CREA\s+#?\s*DATOS por una función/)
  })
  it('la cabecera del manifiesto nombra para «autorizo» exactamente la 0130', () => {
    const nombradas = readFileSync(MANIFIESTO, 'utf8').split('\n').filter((l) => /^#\s+(\S+\.sql\s*)+$/.test(l)).map((l) => l.replace(/^#\s+/, '').trim())
    expect(nombradas).toEqual(['20261017T0130_compras_forma_de_facturar_datos.sql'])
  })
  it('la 0190 declara el cambio de _compras_destinatario con su prueba, que lo nombra', () => {
    const f = viva[9]
    expect(readFileSync(f, 'utf8')).toMatch(/-- cambia: public\._compras_destinatario · prueba: supabase\/staging\/sql\/20261017_compras_repaso_prueba\.sql/)
    expect(readFileSync('supabase/staging/sql/20261017_compras_repaso_prueba.sql', 'utf8')).toMatch(/_compras_destinatario|compras_nombre_generico/)
    expect(r.ficheros[f]).toBe('sigue')
  })
  it('su vuelta atrás son sus diez .down.sql, al revés, y existen', () => {
    const atras = leerTanda('tests/conta/produccion/vuelta-atras-compras-20261010.txt')
    expect(atras).toEqual([...viva].reverse().map((f) => f.replace('supabase/migrations/', 'supabase/vuelta-atras/').replace(/\.sql$/, '.down.sql')))
    for (const f of atras) expect(existsSync(f), f).toBe(true)
  })
})

describe('la tanda del cierre que también propone (ya aplicada: las tres en el historial de producción), tal cual', () => {
  const MANIFIESTO = 'tests/conta/produccion/tanda-cierre-proponer-20261011.txt'
  const viva = leerTanda(MANIFIESTO)
  // La respuesta REAL de la consulta de contexto del workflow (sqlContexto)
  // sobre los tres ficheros, lanzada en solo lectura en producción el 11/10:
  // existen sales_day_summary (120 filas, en el camino del pedido por su
  // nombre) y journal_entry_proponer; nada más; nada en el historial.
  const ctx = JSON.parse(readFileSync('tests/conta/produccion/contexto-produccion-cierre-proponer-20261011.json', 'utf8'))
  const leer = (r: string) => { try { return readFileSync(r, 'utf8') } catch { return null } }
  const r = informe(viva, ctx, {}, leer) as { markdown: string; ficheros: Record<string, string> }
  const bloque = (f: string) => r.markdown.split('### ').find((b) => b.startsWith(`\`${f}\``))!

  it('las tres, en su orden', () => {
    expect(viva.map((f) => f.replace(/^.*\/20261018T/, '').replace(/\.sql$/, ''))).toEqual([
      '0100_cierre_proponer_solo', '0110_cierre_proponer_dias_datos', '0120_cierre_proponer_lectura'])
  })
  it('pide «autorizo» la 0110 (borra el resumen a medias del 09/10); el resto sigue', () => {
    expect(r.ficheros).toEqual(Object.fromEntries(viva.map((f) => [f, /T0110_/.test(f) ? 'autorizo' : 'sigue'])))
    expect(bloque(viva[1])).toContain('delete')
  })
  it('la 0100 declara el cambio de journal_entry_proponer con su prueba, que lo nombra', () => {
    expect(readFileSync(viva[0], 'utf8')).toMatch(/-- cambia: public\.journal_entry_proponer · prueba: supabase\/staging\/sql\/20261018_cierre_proponer_prueba\.sql/)
    expect(bloque(viva[0])).toContain('declarado, prueba')
    expect(readFileSync('supabase/staging/sql/20261018_cierre_proponer_prueba.sql', 'utf8')).toMatch(/journal_entry_proponer/)
  })
  it('la cabecera del manifiesto nombra para «autorizo» exactamente la 0110', () => {
    const nombradas = readFileSync(MANIFIESTO, 'utf8').split('\n').filter((l) => /^#\s+(\S+\.sql\s*)+$/.test(l)).map((l) => l.replace(/^#\s+/, '').trim())
    expect(nombradas).toEqual(['20261018T0110_cierre_proponer_dias_datos.sql'])
  })
  it('su vuelta atrás son sus tres .down.sql, al revés, y existen', () => {
    const atras = leerTanda('tests/conta/produccion/vuelta-atras-cierre-proponer-20261011.txt')
    expect(atras).toEqual([...viva].reverse().map((f) => f.replace('supabase/migrations/', 'supabase/vuelta-atras/').replace(/\.sql$/, '.down.sql')))
    for (const f of atras) expect(existsSync(f), f).toBe(true)
  })
})

describe('la tanda de Diez (ya aplicada: las siete en el historial de producción, comprobado el 12/10), tal cual', () => {
  // Copia del manifiesto con el que se aplicó (desde la rama, el 12/10).
  const MANIFIESTO = 'tests/conta/produccion/tanda-diez-20261012.txt'
  const viva = leerTanda(MANIFIESTO)
  // La respuesta REAL de la consulta de contexto del workflow (sqlContexto)
  // sobre los siete ficheros, lanzada en solo lectura en producción el 12/10:
  // existen account_connector, connector, fiscal_year, journal_entry y
  // journal_line, y journal_entry_validar; nada en el camino del pedido; nada
  // en el historial.
  const ctx = JSON.parse(readFileSync('tests/conta/produccion/contexto-produccion-diez-20261012.json', 'utf8'))
  const leer = (r: string) => { try { return readFileSync(r, 'utf8') } catch { return null } }
  const r = informe(viva, ctx, {}, leer) as { markdown: string; ficheros: Record<string, string> }

  it('las siete, en su orden', () => {
    expect(viva.map((f) => f.replace(/^.*\/20261019T/, '').replace(/\.sql$/, ''))).toEqual([
      '0100_diez_conexion', '0110_diez_libro', '0120_diez_lectura', '0130_diez_documento_compartido',
      '0140_diez_linea_negativa', '0150_diez_importar', '0160_diez_numeracion'])
  })
  it('las siete siguen: ninguna pide «autorizo» y la cabecera del manifiesto no nombra ninguna', () => {
    expect(r.ficheros).toEqual(Object.fromEntries(viva.map((f) => [f, 'sigue'])))
    const nombradas = readFileSync(MANIFIESTO, 'utf8').split('\n').filter((l) => /^#\s+(\S+\.sql\s*)+$/.test(l))
    expect(nombradas).toEqual([])
  })
  it('la 0160 declara el cambio de journal_entry_validar con su prueba, que lo nombra', () => {
    expect(readFileSync(viva[6], 'utf8')).toMatch(/-- cambia: public\.journal_entry_validar · prueba: supabase\/staging\/sql\/20261019_diez_numeracion_prueba\.sql/)
    expect(readFileSync('supabase/staging/sql/20261019_diez_numeracion_prueba.sql', 'utf8')).toMatch(/journal_entry_validar/)
  })
  it('su vuelta atrás son sus siete .down.sql, al revés, y existen', () => {
    const atras = leerTanda('tests/conta/produccion/vuelta-atras-diez-20261012.txt')
    expect(atras).toEqual([...viva].reverse().map((f) => f.replace('supabase/migrations/', 'supabase/vuelta-atras/').replace(/\.sql$/, '.down.sql')))
    for (const f of atras) expect(existsSync(f), f).toBe(true)
  })
})

describe('la tanda del cierre a las 2:00 (ya aplicada: run real 38352237907, en el historial de producción, comprobado el 13/10), tal cual', () => {
  // Copia del manifiesto con el que se aplicó (desde la rama, el 13/10).
  const MANIFIESTO = 'tests/conta/produccion/tanda-cierre-dos-20261012.txt'
  const viva = leerTanda(MANIFIESTO)
  // La respuesta REAL de la consulta de contexto del workflow (sqlContexto)
  // sobre los dos ficheros, lanzada en solo lectura en producción el 12/10:
  // existen company_tax_profile y las tres funciones; nada en el camino del
  // pedido; nada en el historial.
  const ctx = JSON.parse(readFileSync('tests/conta/produccion/contexto-produccion-cierre-dos-20261012.json', 'utf8'))
  const leer = (r: string) => { try { return readFileSync(r, 'utf8') } catch { return null } }
  const r = informe(viva, ctx, {}, leer) as { markdown: string; ficheros: Record<string, string> }

  it('las dos, en su orden', () => {
    expect(viva.map((f) => f.replace(/^.*\/20261019T/, '').replace(/\.sql$/, ''))).toEqual(['0170_cierre_a_las_dos', '0175_cierre_a_las_dos_foodint'])
  })
  it('la 0170 sigue (cambia en caliente, declarada con su prueba); la 0175 pide «autorizo» y la cabecera la nombra', () => {
    expect(r.ficheros).toEqual({ [viva[0]]: 'sigue', [viva[1]]: 'autorizo' })
    const nombradas = readFileSync(MANIFIESTO, 'utf8').split('\n').filter((l) => /^#\s+(\S+\.sql\s*)+$/.test(l)).map((l) => l.replace(/^#\s+/, '').trim())
    expect(nombradas).toEqual(['20261019T0175_cierre_a_las_dos_foodint.sql'])
  })
  it('la 0170 declara cada objeto que cambia, y la prueba de staging los nombra', () => {
    const sql = readFileSync(viva[0], 'utf8')
    const prueba = readFileSync('supabase/staging/sql/20261019_cierre_a_las_dos_prueba.sql', 'utf8')
    for (const o of ['company_tax_profile', 'conta_ultimo_dia_cerrado', 'conta_cerrar_dias', 'conta_propuestos_antes_del_cierre']) {
      expect(sql).toMatch(new RegExp(`-- cambia: public\\.${o} · prueba: supabase/staging/sql/20261019_cierre_a_las_dos_prueba\\.sql`))
      expect(prueba).toContain(o)
    }
  })
  it('la 0175 está anclada por id y cuenta (regla 9) y no pisa una hora que no sea la de serie de antes', () => {
    const sql = readFileSync(viva[1], 'utf8')
    expect(sql).toContain("'658728c0-fcd7-46ef-a860-d4e5e6eb21d9'")
    expect(sql).toContain("'51ad1792-6629-4ef7-833a-b57b09a86710'")
    expect(sql).toMatch(/v_hora is distinct from time '06:00'/)
  })
  it('su vuelta atrás son sus dos .down.sql, al revés, y existen', () => {
    const atras = leerTanda('tests/conta/produccion/vuelta-atras-cierre-dos-20261012.txt')
    expect(atras).toEqual([...viva].reverse().map((f) => f.replace('supabase/migrations/', 'supabase/vuelta-atras/').replace(/\.sql$/, '.down.sql')))
    for (const f of atras) expect(existsSync(f), f).toBe(true)
  })
})

describe('la tanda de la regla de ventas por plataforma (C04b R5; ya aplicada, real 38380236640), tal cual', () => {
  const MANIFIESTO = 'tests/conta/produccion/tanda-ventas-plataforma-20261013.txt'
  const viva = leerTanda(MANIFIESTO)
  // La respuesta REAL de la consulta de contexto del workflow (sqlContexto,
  // con CAMINO_TABLAS y CAMINO_FUNCIONES del workflow) sobre los cuatro
  // ficheros, lanzada en solo lectura en producción el 13/10: existen
  // company_account, journal_entry, sales_day_summary y sales_day_proposal_log
  // (las dos del camino del pedido: sales_.*) y las cuatro funciones que
  // cambian; nada en el historial. (sales_day_proposal_log, añadida a mano
  // con lo medido al sumar la 0140: existe y tiene 13 filas.)
  // R11: el contexto REAL medido para estos mismos ficheros (con sus md5), no
  // el del 13/10 de la R7. El de la R7 no tenía la copia que dejó el real de
  // las 07:52, y con él la 0130 de fe7f0883 salía «autorizo»; con el real,
  // BLOQUEA (abajo).
  const ctx = JSON.parse(readFileSync('tests/conta/produccion/contexto-produccion-ventas-plataforma-r11-20261013.json', 'utf8')).contexto
  const leer = (r: string) => { try { return readFileSync(r, 'utf8') } catch { return null } }
  const r = informe(viva, ctx, {}, leer) as { markdown: string; ficheros: Record<string, string> }

  it('las seis, en su orden', () => {
    expect(viva.map((f) => f.replace(/^.*\/20261020T/, '').replace(/\.sql$/, ''))).toEqual([
      '0100_ventas_por_plataforma', '0105_ventas_por_plataforma_permiso', '0110_ventas_por_plataforma_indice', '0120_ventas_por_plataforma_foodint', '0130_ventas_por_plataforma_rehacer',
      '0140_libro_lectura_registro'])
  })
  it('0100, 0105, 0120 y 0140 siguen; 0110 y 0130 piden «autorizo», y la cabecera las nombra', () => {
    expect(r.ficheros).toEqual({ [viva[0]]: 'sigue', [viva[1]]: 'sigue', [viva[2]]: 'autorizo', [viva[3]]: 'sigue', [viva[4]]: 'autorizo', [viva[5]]: 'sigue' })
    const nombradas = readFileSync(MANIFIESTO, 'utf8').split('\n').filter((l) => /^#\s+(\S+\.sql\s*)+$/.test(l)).map((l) => l.replace(/^#\s+/, '').trim())
    expect(nombradas).toEqual(['20261020T0110_ventas_por_plataforma_indice.sql', '20261020T0130_ventas_por_plataforma_rehacer.sql'])
  })
  it('la 0100 declara cada función que cambia, y la prueba de staging las nombra', () => {
    const sql = readFileSync(viva[0], 'utf8')
    const prueba = readFileSync('supabase/staging/sql/20261020_ventas_por_plataforma_prueba.sql', 'utf8')
    for (const o of ['conta_dias_por_asentar', '_journal_entry_proponer', 'conta_proponer_dias', 'journal_entry_descartar']) {
      expect(sql).toMatch(new RegExp(`-- cambia: public\\.${o} · prueba: supabase/staging/sql/20261020_ventas_por_plataforma_prueba\\.sql`))
      expect(prueba).toContain(o)
    }
  })
  it('la 0120 está anclada por id y cuenta (regla 9)', () => {
    const sql = readFileSync(viva[3], 'utf8')
    expect(sql).toContain("'658728c0-fcd7-46ef-a860-d4e5e6eb21d9'")
    expect(sql).toContain("'51ad1792-6629-4ef7-833a-b57b09a86710'")
  })
  it('declara qué cuenta antes y después (R9): las ventas del día, y el fichero existe', () => {
    const cuentas = readFileSync(MANIFIESTO, 'utf8').split('\n').filter((l) => l.startsWith('cuenta:')).map((l) => l.replace(/^cuenta:\s*/, '').trim())
    expect(cuentas).toEqual(['scripts/conta/produccion/cuentas/ventas-del-dia.sql'])
    for (const c of cuentas) expect(existsSync(c), c).toBe(true)
  })
  it('la 0130 retira, propone y comprueba en la misma transacción (R9: sin hueco)', () => {
    const sql = readFileSync(viva[4], 'utf8')
    const i = (t: string) => sql.indexOf(t)
    expect(i('delete from public.journal_entry e using _a_rehacer')).toBeGreaterThan(0)
    expect(i('public.conta_proponer_dias(v_emp.company_id, now())')).toBeGreaterThan(i('delete from public.journal_entry e using _a_rehacer'))
    expect(i("no todos los días retirados quedan asentados por unidad con el mismo cobro")).toBeGreaterThan(i('public.conta_proponer_dias(v_emp.company_id, now())'))
  })
  it('R11: la 0130 de fe7f0883 contra el contexto del ensayo #57 BLOQUEA por «parece aplicado» (su copia ya existía)', () => {
    const vieja = 'tests/conta/produccion/r11/20261020T0130_ventas_por_plataforma_rehacer.sql'
    const ctx57 = JSON.parse(readFileSync('tests/conta/produccion/r11/contexto-produccion-ensayo57.json', 'utf8'))
    const r57 = informe([vieja], ctx57, {}, leer) as { markdown: string; ficheros: Record<string, string> }
    expect(r57.ficheros[vieja]).toBe('bloquea')
    expect(r57.markdown).toContain('todo lo que crea ya existe en producción, y no está en el historial')
    // La de ahora, contra ese mismo contexto: su copia es nueva, y pide «autorizo» por los delete.
    const r = informe([viva[4]], ctx57, {}, leer) as { ficheros: Record<string, string> }
    expect(r.ficheros[viva[4]]).toBe('autorizo')
  })
  it('su vuelta atrás son sus seis .down.sql, al revés, y existen', () => {
    const atras = leerTanda('tests/conta/produccion/vuelta-atras-ventas-plataforma-20261013.txt')
    expect(atras).toEqual([...viva].reverse().map((f) => f.replace('supabase/migrations/', 'supabase/vuelta-atras/').replace(/\.sql$/, '.down.sql')))
    for (const f of atras) expect(existsSync(f), f).toBe(true)
  })
})

describe('la tanda de AHORA (manifiesto vivo): conta_diez_autorizo.desde (C06b, respuesta 8, tarea 1, paso 1)', () => {
  const MANIFIESTO = 'supabase/produccion/aplicar.txt'
  const viva = leerTanda(MANIFIESTO)
  // La respuesta REAL de la consulta de contexto del workflow, lanzada en solo
  // lectura en producción el 14/10 a las 21:56 UTC para ESTE fichero (con su md5).
  const ctx = JSON.parse(readFileSync('tests/conta/produccion/contexto-produccion-tanda-viva.json', 'utf8')).contexto
  const leer = (r: string) => { try { return readFileSync(r, 'utf8') } catch { return null } }
  const r = informe(viva, ctx, {}, leer) as { markdown: string; ficheros: Record<string, string> }

  it('un fichero: la 0730 añade la columna y su CHECK (declarado, con prueba); sigue', () => {
    expect(viva).toEqual(['supabase/migrations/20261111T0730_c06b_diez_autorizo_desde.sql'])
    expect(r.ficheros).toEqual({ [viva[0]]: 'sigue' })
  })
  it('solo estructura: no escribe ninguna autorización (la de empresa va en otra tanda, después del despliegue)', () => {
    const sql = readFileSync(viva[0], 'utf8')
    expect(sql).not.toMatch(/^\s*(insert|update|delete)\b/im)
    expect(sql).toMatch(/add column if not exists desde date/)
    expect(sql).toMatch(/check \(desde is null or alcance = 'empresa'\)/)
  })
  it('declara qué cuenta antes y después, y el fichero existe', () => {
    const cuentas = readFileSync(MANIFIESTO, 'utf8').split('\n').filter((l) => l.startsWith('cuenta:')).map((l) => l.replace(/^cuenta:\s*/, '').trim())
    expect(cuentas).toEqual(['scripts/conta/produccion/cuentas/diez-autorizo-desde.sql'])
    for (const c of cuentas) expect(existsSync(c), c).toBe(true)
  })
  it('su vuelta atrás quita la columna y para si alguna autorización ya lleva fecha', () => {
    const atras = leerTanda('supabase/produccion/vuelta-atras.txt')
    expect(atras).toEqual(['supabase/vuelta-atras/20261111T0730_c06b_diez_autorizo_desde.down.sql'])
    const sql = readFileSync(atras[0], 'utf8')
    expect(sql).toMatch(/where desde is not null/)
    expect(sql).toMatch(/drop column if exists desde/)
  })
})

describe('la tanda del B01 (aplicada el 14/10, su copia): Bancos y conciliación (0100–0170)', () => {
  const MANIFIESTO = 'tests/conta/produccion/tanda-b01-20261014.txt'
  const viva = leerTanda(MANIFIESTO)
  // La respuesta REAL de la consulta de contexto del workflow, lanzada en solo
  // lectura en producción el 14/10 a las 08:01 UTC (después de la C06) para
  // ESTOS ficheros (con su md5).
  const ctx = JSON.parse(readFileSync('tests/conta/produccion/contexto-produccion-b01-20261014.json', 'utf8')).contexto
  const leer = (r: string) => { try { return readFileSync(r, 'utf8') } catch { return null } }
  const r = informe(viva, ctx, {}, leer) as { markdown: string; ficheros: Record<string, string> }
  const B01 = ['0100_b01_bancos', '0110_b01_funciones', '0120_b01_foodint', '0130_b01_lectura', '0140_b01_tarjetas',
    '0150_b01_cierre_agente', '0160_b01_lectura_agente', '0170_b01_foodint_cuentas']

  it('ocho ficheros, en orden, y todos siguen: todo es nuevo (sin «autorizo»)', () => {
    expect(viva).toEqual(B01.map((f) => `supabase/migrations/20261101T${f}.sql`))
    expect(Object.values(r.ficheros)).toEqual(B01.map(() => 'sigue'))
  })
  it('ningún fichero lleva un IBAN escrito (repositorio público): la 0170 lo lee del nombre de la cuenta al aplicar', () => {
    for (const f of viva) expect(readFileSync(f, 'utf8'), f).not.toMatch(/ES[0-9]{2}(?: ?[0-9]{4}){5}/)
  })
  it('declara qué cuenta antes y después: tablas, funciones, las fichas de Foodint y la huella de sus 50 asientos; y el fichero existe', () => {
    const cuentas = readFileSync(MANIFIESTO, 'utf8').split('\n').filter((l) => l.startsWith('cuenta:')).map((l) => l.replace(/^cuenta:\s*/, '').trim())
    expect(cuentas).toEqual(['scripts/conta/produccion/cuentas/bancos.sql'])
    for (const c of cuentas) expect(existsSync(c), c).toBe(true)
    expect(readFileSync(cuentas[0], 'utf8')).toMatch(/created_at < timestamptz '2026-10-13 18:00\+00'/)
  })
  it('ninguna vuelta atrás escribe en storage con SQL (ensayo #64: Supabase no deja borrar de sus tablas; el bucket de la 0140 se queda)', () => {
    for (const f of leerTanda('tests/conta/produccion/vuelta-atras-b01-20261014.txt')) {
      const sql = readFileSync(f, 'utf8').replace(/--.*$/gm, '')
      expect(sql, f).not.toMatch(/\b(insert\s+into|update|delete\s+from|truncate)\s+(table\s+)?storage\./i)
      expect(sql, f).not.toMatch(/\b(drop|create|alter)\s+policy\b[^;]*\bon\s+storage\./i)
      expect(sql, f).not.toMatch(/storage\.allow_delete_query/)
    }
  })
  it('su vuelta atrás es la de cada fichero en orden inverso; la 0170 PARA si sus fichas ya tienen extractos', () => {
    const atras = leerTanda('tests/conta/produccion/vuelta-atras-b01-20261014.txt')
    expect(atras).toEqual([...B01].reverse().map((f) => `supabase/vuelta-atras/20261101T${f}.down.sql`))
    for (const f of atras) expect(existsSync(f), f).toBe(true)
    expect(readFileSync(atras[0], 'utf8')).toMatch(/ya tienen % extractos, movimientos o tarjetas: no se quitan/)
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
  it('C04b R5: la firma no se corta en un paréntesis de un valor por defecto ni de un tipo', () => {
    const f = (x: string) => clasificar(x).find((o: { tipo: string }) => o.tipo === 'funcion')?.objeto
    expect(f("create or replace function public.conta_proponer_dias(p_company uuid, p_ahora timestamptz default now(), p_quien text default 'Folvy (cierre del día)') returns jsonb language sql as $$ select null $$"))
      .toBe('public.conta_proponer_dias(uuid,timestamptz,text)')
    expect(f("create function public.g(a numeric(5,2), b text default 'x, y') returns int language sql as $$ select 1 $$")).toBe('public.g(numeric(5,2),text)')
    expect(f('create function public.h() returns int language sql as $$ select 1 $$')).toBe('public.h()')
    // La 0100 del C04b R5 reemplaza conta_proponer_dias con su firma entera, no crea otra.
    expect(analizarFichero('supabase/migrations/20261020T0100_ventas_por_plataforma.sql').map((o: { objeto: string }) => o.objeto))
      .toContain('public.conta_proponer_dias(uuid,timestamptz,text)')
  })
  it('una columna obligatoria sin valor por defecto, o un cambio de tipo', () => {
    expect(sup('alter table public.supplier add column x text not null').para).toHaveLength(1)
    expect(sup('alter table public.supplier alter column name type varchar(10)').para).toHaveLength(1)
  })
  it('C06b: un disparador nuevo en una tabla que existe, también «constraint trigger» (diferido): cambia, no se cuela callado', () => {
    for (const sql of [
      'create trigger t1 after update on public.supplier for each row execute function public.f()',
      'create constraint trigger t2 after update of status on public.supplier deferrable initially deferred for each row execute function public.f()',
    ]) {
      const ops = sentencias(sql).flatMap((s: string) => clasificar(s))
      expect(ops, sql).toEqual([expect.objectContaining({ accion: 'crea', tipo: 'disparador', objeto: 'public.supplier' })])
    }
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
