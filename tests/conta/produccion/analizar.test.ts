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
//   · La de AHORA, el manifiesto vivo (supabase/produccion/tandas/sumied/heredada/aplicar.txt, C10):
//     impuestos por dentro (I01a, 0100–0150), con el contexto de producción
//     leído en solo lectura el 18/10 y la regla del W01 (`informe`, la misma
//     del ensayo). La del S01, ya aplicada, queda en su copia
//     (tanda-s01-esqueleto-20261017.txt). Al reescribir el manifiesto para
//     otra tanda, esta parte se reescribe con él.
// Y los casos que tienen que parar, sobre la población del C00.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
// @ts-expect-error — módulo .mjs sin tipos
import { ambiguosEnPlpgsql, analizarFichero, columnasConocidas, clasificar, creadosPorLaTanda, decidir, informe, ordenEnElFichero, sentencias, veredicto } from '../../../scripts/conta/produccion/analizar.mjs'

type Op = { accion: string; tipo: string; objeto: string; detalle: string }
type Existentes = { tablas: string[]; funciones: string[] }
// Las líneas «cuenta:» declaran qué se cuenta antes y después (R9): no son ficheros de la tanda.
const leerTanda = (f: string) => readFileSync(f, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && !/^(cuenta|sin-vuelta-atras|esperado):/.test(l))
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
    // I01b (0160): el agente del libro lee tax_return (la liquidación del 303), que la 0110 del I01a ya da a conta_lectura.
    const i01 = readFileSync('supabase/migrations/20261122T0110_i01_modelo_datos.sql', 'utf8')
    if (/grant select on table [^;]*public\.tax_return,[^;]* to conta_lectura;/.test(i01)) tablas.add('tax_return')
    const funciones = new Set([...`${lectura}\n${cierre}`.matchAll(/grant execute on function public\.([a-z_]+)\(/g)].map((m) => m[1]))
    expect(nombrados.size).toBe(44) // 42 + import_run (C06b, #178) + tax_return (I01b)
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

describe('la tanda del documento de cada asiento de ventas (C04b R15; ya en el historial de producción con su huella), tal cual', () => {
  const MANIFIESTO = 'tests/conta/produccion/tanda-documentos-ventas-20261013.txt'
  const viva = leerTanda(MANIFIESTO)
  // La respuesta REAL de la consulta de contexto del workflow, lanzada en solo
  // lectura en producción el 13/10 a las 12:29 UTC para ESTE fichero (con su md5).
  const ctx = JSON.parse(readFileSync('tests/conta/produccion/contexto-produccion-documentos-20261013.json', 'utf8')).contexto
  const leer = (r: string) => { try { return readFileSync(r, 'utf8') } catch { return null } }
  const r = informe(viva, ctx, {}, leer) as { markdown: string; ficheros: Record<string, string> }

  it('un fichero, y sigue: todo es nuevo (sin «autorizo»)', () => {
    expect(viva).toEqual(['supabase/migrations/20261021T0100_conta_documentos.sql'])
    expect(r.ficheros).toEqual({ [viva[0]]: 'sigue' })
  })
  it('no quita ni vuelve a poner ninguna política de storage.objects (sería cambiarla en caliente: el paso 8 lo paró)', () => {
    expect(readFileSync(viva[0], 'utf8')).not.toMatch(/drop policy[^;]*on storage\.objects/i)
  })
  it('declara qué cuenta antes y después: el bucket, la tabla, los envíos; y el fichero existe', () => {
    const cuentas = readFileSync(MANIFIESTO, 'utf8').split('\n').filter((l) => l.startsWith('cuenta:')).map((l) => l.replace(/^cuenta:\s*/, '').trim())
    expect(cuentas).toEqual(['scripts/conta/produccion/cuentas/documentos.sql'])
    for (const c of cuentas) expect(existsSync(c), c).toBe(true)
  })
  it('su vuelta atrás es su .down.sql, que PARA si ya hay documentos o ficheros', () => {
    const atras = leerTanda('tests/conta/produccion/vuelta-atras-documentos-ventas-20261013.txt')
    expect(atras).toEqual(['supabase/vuelta-atras/20261021T0100_conta_documentos.down.sql'])
    const down = readFileSync(atras[0], 'utf8')
    expect(down).toMatch(/exists \(select 1 from public\.journal_entry_document\)/)
    expect(down).toMatch(/exists \(select 1 from storage\.objects where bucket_id = 'conta-documentos'\)/)
  })
})

describe('la tanda del balance según la norma y el tope de la contraseña (C06b, respuesta 6; ya aplicada, real 38566632165), tal cual', () => {
  const MANIFIESTO = 'tests/conta/produccion/tanda-c06b-r6-20261014.txt'
  const viva = leerTanda(MANIFIESTO)
  // La respuesta REAL de la consulta de contexto del workflow, lanzada en solo
  // lectura en producción el 14/10 a las 10:33 UTC para ESTOS ficheros (con su md5).
  const ctx = JSON.parse(readFileSync('tests/conta/produccion/contexto-produccion-c06b-r6-20261014.json', 'utf8')).contexto
  const leer = (r: string) => { try { return readFileSync(r, 'utf8') } catch { return null } }
  const r = informe(viva, ctx, {}, leer) as { markdown: string; ficheros: Record<string, string> }

  it('dos ficheros: la 0600 cambia filas de serie y pide «autorizo»; la 0610 solo añade y sigue', () => {
    expect(viva).toEqual(['supabase/migrations/20261111T0600_c06b_terceros_por_saldo.sql', 'supabase/migrations/20261111T0610_c06b_contrasena_tope.sql'])
    expect(r.ficheros).toEqual({ [viva[0]]: 'autorizo', [viva[1]]: 'sigue' })
  })
  it('la 0600 toca 42 o para, solo filas de serie sin signo, y las nuevas no pisan nada', () => {
    const sql = readFileSync(viva[0], 'utf8')
    expect(sql).toMatch(/if n <> 42 then raise exception/)
    expect(sql).toMatch(/by_balance is null/)
    expect(sql).toMatch(/on conflict \(model, statement, line_code, account_prefix\) where company_id is null do nothing/)
    expect(sql).not.toMatch(/delete from/i)
  })
  it('declara qué cuenta antes y después, y el fichero existe', () => {
    const cuentas = readFileSync(MANIFIESTO, 'utf8').split('\n').filter((l) => l.startsWith('cuenta:')).map((l) => l.replace(/^cuenta:\s*/, '').trim())
    expect(cuentas).toEqual(['scripts/conta/produccion/cuentas/terceros-y-contrasena.sql'])
    for (const c of cuentas) expect(existsSync(c), c).toBe(true)
  })
  it('su vuelta atrás, al revés: la 0610 y la 0600, que quita 42 y devuelve 42 o para', () => {
    const atras = leerTanda('tests/conta/produccion/vuelta-atras-c06b-r6-20261014.txt')
    expect(atras).toEqual(['supabase/vuelta-atras/20261111T0610_c06b_contrasena_tope.down.sql', 'supabase/vuelta-atras/20261111T0600_c06b_terceros_por_saldo.down.sql'])
    for (const f of atras) expect(existsSync(f), f).toBe(true)
    expect(readFileSync(atras[1], 'utf8').match(/if n <> 42 then/g)).toHaveLength(2)
  })
})

describe('la tanda de las facturas recibidas (D01 T7, R5 y R6; ya aplicada, real #74 desde 187335e0), tal cual', () => {
  const MANIFIESTO = 'tests/conta/produccion/tanda-d01-20261014.txt'
  const viva = leerTanda(MANIFIESTO)
  // La respuesta REAL de la consulta de contexto del workflow, lanzada en solo
  // lectura en producción el 14/10 para ESTOS doce ficheros
  // (con sus md5): existen las cinco tablas que amplía; ninguna de sus 22
  // funciones; nada del camino del pedido; nada en el historial.
  const ctx = JSON.parse(readFileSync('tests/conta/produccion/contexto-produccion-d01-20261014.json', 'utf8')).contexto
  const leer = (r: string) => { try { return readFileSync(r, 'utf8') } catch { return null } }
  const r = informe(viva, ctx, {}, leer) as { markdown: string; ficheros: Record<string, string> }

  it('las doce, en su orden', () => {
    expect(viva.map((f) => f.replace(/^.*\/20261021T/, '').replace(/\.sql$/, ''))).toEqual([
      '0200_d01_recibidas', '0210_d01_amplia', '0220_d01_entrada', '0230_d01_repetidas_con_total', '0240_d01_asiento_recibida',
      '0250_d01_aprendido_origen', '0260_d01_repetidas_c01b', '0270_d01_recibida_envio', '0280_d01_documentos', '0290_d01_revisar_y_pedir',
      '0300_d01_documentos_r5', '0310_d01_recepcion'])
  })
  it('todas siguen: ninguna pide «autorizo» ni bloquea', () => {
    expect(r.ficheros).toEqual(Object.fromEntries(viva.map((f) => [f, 'sigue'])))
  })
  it('lo que cambia en caliente (0210, 0230, 0250, 0260, 0300, 0310) lo declara en la cabecera, y la prueba de staging existe y lo nombra', () => {
    for (const f of viva) {
      for (const m of readFileSync(f, 'utf8').matchAll(/^-- cambia: public\.(\w+) · prueba: (\S+)$/gm)) {
        expect(existsSync(m[2]), m[2]).toBe(true)
        expect(readFileSync(m[2], 'utf8'), `${m[2]} nombra ${m[1]}`).toContain(m[1])
      }
    }
    const declaran = viva.filter((f) => /^-- cambia: /m.test(readFileSync(f, 'utf8'))).map((f) => f.replace(/^.*\/20261021T(\d+)_.*$/, '$1'))
    expect(declaran).toEqual(['0210', '0230', '0250', '0260', '0300', '0310'])
  })
  it('declara qué cuenta antes y después (R9): las recibidas, y el fichero existe y solo lee', () => {
    const cuentas = readFileSync(MANIFIESTO, 'utf8').split('\n').filter((l) => l.startsWith('cuenta:')).map((l) => l.replace(/^cuenta:\s*/, '').trim())
    expect(cuentas).toEqual(['scripts/conta/produccion/cuentas/recibidas.sql'])
    const sql = readFileSync(cuentas[0], 'utf8').split('\n').filter((l) => !l.startsWith('--')).join('\n')
    expect(sql).not.toMatch(/\b(insert|update|delete|drop|alter|create|truncate|grant)\b/i)
  })
  it('su vuelta atrás son sus doce .down.sql, al revés, y existen', () => {
    const atras = leerTanda('tests/conta/produccion/vuelta-atras-d01-20261014.txt')
    expect(atras).toEqual([...viva].reverse().map((f) => f.replace('supabase/migrations/', 'supabase/vuelta-atras/').replace(/\.sql$/, '.down.sql')))
    for (const f of atras) expect(existsSync(f), f).toBe(true)
  })
})

describe('la tanda de a Diez sin el PDF y el primer asiento autorizado en C0008 (C06b, respuesta 7; ya aplicada), tal cual', () => {
  const MANIFIESTO = 'tests/conta/produccion/tanda-c06b-r7-20261014.txt'
  const viva = leerTanda(MANIFIESTO)
  // La respuesta REAL de la consulta de contexto del workflow, lanzada en solo
  // lectura en producción el 14/10 a las 15:20 UTC para ESTOS ficheros (con su md5).
  const ctx = JSON.parse(readFileSync('tests/conta/produccion/contexto-produccion-c06b-r7-20261014.json', 'utf8')).contexto
  const leer = (r: string) => { try { return readFileSync(r, 'utf8') } catch { return null } }
  const r = informe(viva, ctx, {}, leer) as { markdown: string; ficheros: Record<string, string> }

  it('dos ficheros: la 0700 amplía y añade (declarada, con prueba); la 0710 escribe en la tabla nueva; los dos siguen', () => {
    expect(viva).toEqual(['supabase/migrations/20261111T0700_c06b_diez_pdf_pendiente.sql', 'supabase/migrations/20261111T0710_c06b_diez_autorizo_primero.sql'])
    expect(r.ficheros).toEqual({ [viva[0]]: 'sigue', [viva[1]]: 'sigue' })
  })
  it('la 0710 autoriza UN asiento, anclado por cuenta y empresa, o para; y no envía nada', () => {
    const sql = readFileSync(viva[1], 'utf8')
    expect(sql).toMatch(/coalesce\(array_length\(v_ids, 1\), 0\) <> 1 then/)
    expect(sql).toContain("'51ad1792-6629-4ef7-833a-b57b09a86710'")
    // Un asiento, no la empresa entera (eso, en otra tanda, después de mirarlo en Diez).
    expect(sql).toMatch(/values \(v_cuenta, v_empresa, 'asiento', v_ids\[1\], 'C0008'/)
    expect(sql).not.toMatch(/external_send|delete from|update /i)
  })
  it('declara qué cuenta antes y después, y el fichero existe', () => {
    const cuentas = readFileSync(MANIFIESTO, 'utf8').split('\n').filter((l) => l.startsWith('cuenta:')).map((l) => l.replace(/^cuenta:\s*/, '').trim())
    expect(cuentas).toEqual(['scripts/conta/produccion/cuentas/diez-pdf-pendiente.sql'])
    for (const c of cuentas) expect(existsSync(c), c).toBe(true)
  })
  it('su vuelta atrás, al revés: la 0710 (para si ya está en Diez) y la 0700 (para si hay algo pendiente, marcado o autorizado)', () => {
    const atras = leerTanda('tests/conta/produccion/vuelta-atras-c06b-r7-20261014.txt')
    expect(atras).toEqual(['supabase/vuelta-atras/20261111T0710_c06b_diez_autorizo_primero.down.sql', 'supabase/vuelta-atras/20261111T0700_c06b_diez_pdf_pendiente.down.sql'])
    for (const f of atras) expect(existsSync(f), f).toBe(true)
    expect(readFileSync(atras[0], 'utf8')).toMatch(/status in \('enviado', 'enlazado'\)/)
    expect(readFileSync(atras[1], 'utf8')).toMatch(/n_pend \+ n_mano \+ n_aut > 0/)
  })
})

describe('la tanda de conta_diez_autorizo.desde (C06b, respuesta 8, tarea 1; ya aplicada, real #78 desde 7276511f), tal cual', () => {
  const MANIFIESTO = 'tests/conta/produccion/tanda-c06b-r8-desde-20261014.txt'
  const viva = leerTanda(MANIFIESTO)
  // La respuesta REAL de la consulta de contexto del workflow, lanzada en solo
  // lectura en producción el 14/10 a las 21:56 UTC para ESTE fichero (con su md5).
  const ctx = JSON.parse(readFileSync('tests/conta/produccion/contexto-produccion-c06b-r8-desde-20261014.json', 'utf8')).contexto
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
    const atras = leerTanda('tests/conta/produccion/vuelta-atras-c06b-r8-desde-20261014.txt')
    expect(atras).toEqual(['supabase/vuelta-atras/20261111T0730_c06b_diez_autorizo_desde.down.sql'])
    const sql = readFileSync(atras[0], 'utf8')
    expect(sql).toMatch(/where desde is not null/)
    expect(sql).toMatch(/drop column if exists desde/)
  })
})

describe('la tanda de la C06b (0720, aplicada; su copia): validar y guardar el PDF van juntos (respuesta 8)', () => {
  const MANIFIESTO = 'tests/conta/produccion/tanda-c06b-validar-pdf-20261014.txt'
  const viva = leerTanda(MANIFIESTO)
  // La respuesta REAL de la consulta de contexto del workflow, lanzada en solo
  // lectura en producción el 14/10 a las 18:41 UTC para ESTE fichero (con su md5).
  const ctx = JSON.parse(readFileSync('tests/conta/produccion/contexto-produccion-c06b-validar-pdf-20261014.json', 'utf8')).contexto
  const leer = (r: string) => { try { return readFileSync(r, 'utf8') } catch { return null } }
  const r = informe(viva, ctx, {}, leer) as { markdown: string; ficheros: Record<string, string> }

  it('un fichero: la 0720 añade tres funciones y un disparador diferido en journal_entry (declarado, con prueba); sigue', () => {
    expect(viva).toEqual(['supabase/migrations/20261111T0720_c06b_validar_con_pdf.sql'])
    expect(r.ficheros).toEqual({ [viva[0]]: 'sigue' })
    expect(r.markdown).toContain('disparador nuevo en una tabla que existe')
  })
  it('no toca journal_entry_validar ni conta_documento_guardar, ni escribe datos', () => {
    const sql = readFileSync(viva[0], 'utf8')
    expect(sql).not.toMatch(/create or replace function public\.(journal_entry_validar|conta_documento_guardar)\(/i)
    expect(sql).not.toMatch(/^\s*(update|delete|insert)\b/im)
    expect(sql).toMatch(/deferrable initially deferred/)
  })
  it('declara qué cuenta antes y después, y el fichero existe', () => {
    const cuentas = readFileSync(MANIFIESTO, 'utf8').split('\n').filter((l) => l.startsWith('cuenta:')).map((l) => l.replace(/^cuenta:\s*/, '').trim())
    expect(cuentas).toEqual(['scripts/conta/produccion/cuentas/validar-con-pdf.sql'])
    for (const c of cuentas) expect(existsSync(c), c).toBe(true)
  })
  it('su vuelta atrás: fuera el disparador y las tres funciones, sin tocar asientos ni documentos', () => {
    const atras = leerTanda('tests/conta/produccion/vuelta-atras-c06b-validar-pdf-20261014.txt')
    expect(atras).toEqual(['supabase/vuelta-atras/20261111T0720_c06b_validar_con_pdf.down.sql'])
    const sql = readFileSync(atras[0], 'utf8')
    expect(sql).toMatch(/drop trigger if exists trg_journal_entry_valida_con_pdf on public\.journal_entry/)
    expect(sql).not.toMatch(/^\s*(update|delete|insert)\b/im)
  })
})

describe('la tanda de deshacer un extracto (B01, 0180; ya aplicada, real 38686485297 desde 71db58bd), tal cual', () => {
  const MANIFIESTO = 'tests/conta/produccion/tanda-b01-extracto-deshacer-20261015.txt'
  const viva = leerTanda(MANIFIESTO)
  // La respuesta REAL de la consulta de contexto del workflow, lanzada en solo
  // lectura en producción el 14/10 a las 22:35 UTC para ESTE fichero (con su md5).
  const ctx = JSON.parse(readFileSync('tests/conta/produccion/contexto-produccion-b01-extracto-deshacer-20261015.json', 'utf8')).contexto
  const leer = (r: string) => { try { return readFileSync(r, 'utf8') } catch { return null } }
  const r = informe(viva, ctx, {}, leer) as { markdown: string; ficheros: Record<string, string> }

  it('un fichero, una función nueva: sigue (sin «autorizo»)', () => {
    expect(viva).toEqual(['supabase/migrations/20261101T0180_b01_extracto_deshacer.sql'])
    expect(r.ficheros).toEqual({ [viva[0]]: 'sigue' })
  })
  it('al aplicarse no escribe datos: los borrados van dentro de la función', () => {
    const fuera = readFileSync(viva[0], 'utf8').replace(/\$\$[\s\S]*?\$\$/g, '')
    expect(fuera).not.toMatch(/^\s*(update|delete|insert)\b/im)
  })
  it('declara qué cuenta antes y después, y el fichero existe', () => {
    const cuentas = readFileSync(MANIFIESTO, 'utf8').split('\n').filter((l) => l.startsWith('cuenta:')).map((l) => l.replace(/^cuenta:\s*/, '').trim())
    expect(cuentas).toEqual(['scripts/conta/produccion/cuentas/extracto-deshacer.sql'])
    for (const c of cuentas) expect(existsSync(c), c).toBe(true)
  })
  it('su vuelta atrás quita solo la función', () => {
    const atras = leerTanda('tests/conta/produccion/vuelta-atras-b01-extracto-deshacer-20261015.txt')
    expect(atras).toEqual(['supabase/vuelta-atras/20261101T0180_b01_extracto_deshacer.down.sql'])
    const sql = readFileSync(atras[0], 'utf8').replace(/--.*$/gm, '')
    expect(sql.trim()).toBe('drop function if exists public.bank_extracto_deshacer(uuid, text);')
  })
})

describe('la tanda de conta_diez_autorizo.incluye_recibidas (C06b, respuesta 8, tarea 1; ya aplicada, su copia), tal cual', () => {
  const MANIFIESTO = 'tests/conta/produccion/tanda-c06b-r8-recibidas-20261015.txt'
  const viva = leerTanda(MANIFIESTO)
  // La respuesta REAL de la consulta de contexto del workflow, lanzada en solo
  // lectura en producción el 14/10 a las 23:26 UTC para ESTE fichero (con su md5).
  const ctx = JSON.parse(readFileSync('tests/conta/produccion/contexto-produccion-c06b-r8-recibidas-20261015.json', 'utf8')).contexto
  const leer = (r: string) => { try { return readFileSync(r, 'utf8') } catch { return null } }
  const r = informe(viva, ctx, {}, leer) as { markdown: string; ficheros: Record<string, string> }

  it('un fichero: la 0740 añade la columna con su valor por defecto; sigue', () => {
    expect(viva).toEqual(['supabase/migrations/20261111T0740_c06b_diez_autorizo_recibidas.sql'])
    expect(r.ficheros).toEqual({ [viva[0]]: 'sigue' })
  })
  it('solo estructura: not null con default false (lo de hoy queda cerrado para recibidas) y ninguna autorización escrita', () => {
    const sql = readFileSync(viva[0], 'utf8')
    expect(sql).toMatch(/add column if not exists incluye_recibidas boolean not null default false/)
    expect(sql).not.toMatch(/^\s*(insert|update|delete)\b/im)
  })
  it('declara qué cuenta antes y después, y el fichero existe', () => {
    const cuentas = readFileSync(MANIFIESTO, 'utf8').split('\n').filter((l) => l.startsWith('cuenta:')).map((l) => l.replace(/^cuenta:\s*/, '').trim())
    expect(cuentas).toEqual(['scripts/conta/produccion/cuentas/diez-autorizo-recibidas.sql'])
    for (const c of cuentas) expect(existsSync(c), c).toBe(true)
  })
  it('su vuelta atrás quita la columna y para si alguna autorización ya abre las recibidas', () => {
    const atras = leerTanda('tests/conta/produccion/vuelta-atras-c06b-r8-recibidas-20261015.txt')
    expect(atras).toEqual(['supabase/vuelta-atras/20261111T0740_c06b_diez_autorizo_recibidas.down.sql'])
    const sql = readFileSync(atras[0], 'utf8')
    expect(sql).toMatch(/where incluye_recibidas/)
    expect(sql).toMatch(/drop column if exists incluye_recibidas/)
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

describe('la tanda de nunca una tarjeta entera (B01, 0190 y 0191; ya aplicada, real desde d1779f00), tal cual', () => {
  const MANIFIESTO = 'tests/conta/produccion/tanda-b01-tarjeta-oculta-20261015.txt'
  const tanda = leerTanda(MANIFIESTO)
  // La respuesta REAL de la consulta de contexto del workflow, lanzada en solo
  // lectura en producción el 15/10 a las 08:17 UTC para ESTOS ficheros.
  const ctx = JSON.parse(readFileSync('tests/conta/produccion/contexto-produccion-b01-tarjeta-oculta-20261015.json', 'utf8')).contexto
  const leer = (r: string) => { try { return readFileSync(r, 'utf8') } catch { return null } }
  const r = informe(tanda, ctx, {}, leer) as { markdown: string; ficheros: Record<string, string> }

  it('la 0190 sigue (cambia bank_movement, declarado y con prueba); la 0191 pide «autorizo» (update)', () => {
    expect(tanda).toEqual(['supabase/migrations/20261101T0190_b01_tarjeta_oculta.sql', 'supabase/migrations/20261101T0191_b01_tarjeta_oculta_guardado.sql'])
    expect(r.ficheros).toEqual({ [tanda[0]]: 'sigue', [tanda[1]]: 'autorizo' })
  })
  it('la 0191 para si queda alguna tarjeta entera', () => {
    expect(readFileSync(tanda[1], 'utf8')).toMatch(/if n > 0 then raise exception/)
  })
  it('declara qué cuenta, y lo que cuenta lo repone la vuelta atrás (no las tarjetas: no se devuelven)', () => {
    const cuentas = readFileSync(MANIFIESTO, 'utf8').split('\n').filter((l) => l.startsWith('cuenta:')).map((l) => l.replace(/^cuenta:\s*/, '').trim())
    expect(cuentas).toEqual(['scripts/conta/produccion/cuentas/tarjeta-oculta.sql'])
    for (const c of cuentas) expect(existsSync(c), c).toBe(true)
    expect(readFileSync(cuentas[0], 'utf8')).not.toMatch(/luhn/i)
  })
  it('su vuelta atrás, al revés: la 0191 no devuelve nada y la 0190 quita el disparador y sus funciones', () => {
    const atras = leerTanda('tests/conta/produccion/vuelta-atras-b01-tarjeta-oculta-20261015.txt')
    expect(atras).toEqual(['supabase/vuelta-atras/20261101T0191_b01_tarjeta_oculta_guardado.down.sql', 'supabase/vuelta-atras/20261101T0190_b01_tarjeta_oculta.down.sql'])
    expect(readFileSync(atras[0], 'utf8').replace(/--.*$/gm, '').trim()).toBe('select 1;')
    expect(readFileSync(atras[1], 'utf8')).toMatch(/drop trigger if exists bank_movement_sin_tarjetas/)
  })
})

describe('la tanda de las facturas de riders de Catcher (E05, 0100–0140; ya aplicada, real #91 desde 452571c4), tal cual', () => {
  const MANIFIESTO = 'tests/conta/produccion/tanda-e05-catcher-20261015.txt'
  const viva = leerTanda(MANIFIESTO)
  // La respuesta REAL de la consulta de contexto del workflow, lanzada en solo
  // lectura en producción para ESTOS ficheros (con sus md5): ver el _que del JSON.
  const ctx = JSON.parse(readFileSync('tests/conta/produccion/contexto-produccion-e05-catcher-20261015.json', 'utf8')).contexto
  const leer = (r: string) => { try { return readFileSync(r, 'utf8') } catch { return null } }
  const r = informe(viva, ctx, {}, leer) as { markdown: string; ficheros: Record<string, string> }
  const E05 = ['0100_e05_lotes', '0110_e05_recibida_envio_emisor', '0120_e05_cruces', '0130_e05_pago_prepago', '0140_e05_datos']

  it('cinco ficheros, en orden, y los cinco siguen (sin «autorizo»)', () => {
    expect(viva).toEqual(E05.map((f) => `supabase/migrations/20261112T${f}.sql`))
    expect(r.ficheros).toEqual(Object.fromEntries(viva.map((f) => [f, 'sigue'])))
  })
  it('los datos (0140) solo añaden filas, con account_id, y si ya están no hacen nada', () => {
    const sql = readFileSync(viva[4], 'utf8')
    expect(sql).not.toMatch(/^\s*(update|delete)\b/im)
    expect(sql).toContain("'51ad1792-6629-4ef7-833a-b57b09a86710'")
    expect((sql.match(/insert into/g) ?? []).length).toBe((sql.match(/where not exists|on conflict do nothing/g) ?? []).length)
  })
  it('declara qué cuenta, y la cuenta existe', () => {
    const cuentas = readFileSync(MANIFIESTO, 'utf8').split('\n').filter((l) => l.startsWith('cuenta:')).map((l) => l.replace(/^cuenta:\s*/, '').trim())
    expect(cuentas).toEqual(['scripts/conta/produccion/cuentas/e05-catcher.sql'])
    for (const c of cuentas) expect(existsSync(c), c).toBe(true)
  })
  it('su vuelta atrás va en orden inverso y cada fichero para si se perdería algo', () => {
    const atras = leerTanda('tests/conta/produccion/vuelta-atras-e05-catcher-20261015.txt')
    expect(atras).toEqual([...E05].reverse().map((f) => `supabase/vuelta-atras/20261112T${f}.down.sql`))
    for (const f of atras) expect(readFileSync(f, 'utf8'), f).toMatch(/raise exception/)
  })
})

describe('la tanda del céntimo de redondeo en el IVA (C06b, 0100; ya en el historial de producción), tal cual', () => {
  const MANIFIESTO = 'tests/conta/produccion/tanda-c06b-centimo-iva-20261016.txt'
  const viva = leerTanda(MANIFIESTO)
  // La respuesta REAL de la consulta de contexto del workflow, lanzada en solo
  // lectura en producción para ESTOS ficheros (con sus md5): ver el _que del JSON.
  const ctx = JSON.parse(readFileSync('tests/conta/produccion/contexto-produccion-c06b-centimo-iva-20261016.json', 'utf8')).contexto
  const leer = (r: string) => { try { return readFileSync(r, 'utf8') } catch { return null } }
  const r = informe(viva, ctx, {}, leer) as { markdown: string; ficheros: Record<string, string> }
  const F = 'supabase/migrations/20261113T0100_c06b_centimo_iva.sql'

  it('un fichero, y sigue (sin «autorizo»): cambia dos funciones con la misma firma, declarado y con su prueba', () => {
    expect(viva).toEqual([F])
    expect(r.ficheros).toEqual({ [F]: 'sigue' })
    expect(r.markdown).toContain('declarado, prueba `supabase/staging/sql/20261113_c06b_centimo_iva_prueba.sql`')
  })
  it('no toca datos ni crea sobrecargas: solo create or replace de las dos funciones existentes', () => {
    expect(analizarFichero(F).map((o: Op) => `${o.accion} ${o.objeto}`)).toEqual([
      'reemplaza public.journal_entry_validar(uuid,text)', 'reemplaza public.conta_propuesta_ventas_unidad(uuid,uuid,date,uuid,uuid)'])
    expect(readFileSync(F, 'utf8').match(/^create or replace function public\.[a-z_]+\(/gm)).toEqual(['create or replace function public.journal_entry_validar(', 'create or replace function public.conta_propuesta_ventas_unidad('])
  })
  it('declara qué cuenta, y la cuenta existe', () => {
    const cuentas = readFileSync(MANIFIESTO, 'utf8').split('\n').filter((l) => l.startsWith('cuenta:')).map((l) => l.replace(/^cuenta:\s*/, '').trim())
    expect(cuentas).toEqual(['scripts/conta/produccion/cuentas/centimo-iva.sql'])
    for (const c of cuentas) expect(existsSync(c), c).toBe(true)
  })
  it('su vuelta atrás deja las dos funciones como estaban (las mismas que en la versión anterior del repositorio)', () => {
    const atras = leerTanda('tests/conta/produccion/vuelta-atras-c06b-centimo-iva-20261016.txt')
    expect(atras).toEqual(['supabase/vuelta-atras/20261113T0100_c06b_centimo_iva.down.sql'])
    const cuerpo = (sql: string, nombre: string, q: string) => { const i = sql.indexOf(`function public.${nombre}`); const a = sql.indexOf(q, i) + q.length; return sql.slice(a, sql.indexOf(q, a)) }
    const down = readFileSync(atras[0], 'utf8')
    expect(cuerpo(down, 'journal_entry_validar', '$function$')).toBe(cuerpo(readFileSync('supabase/migrations/20261019T0160_diez_numeracion.sql', 'utf8'), 'journal_entry_validar', '$function$'))
    expect(cuerpo(down, 'conta_propuesta_ventas_unidad', '$$')).toBe(cuerpo(readFileSync('supabase/migrations/20261020T0100_ventas_por_plataforma.sql', 'utf8'), 'conta_propuesta_ventas_unidad', '$$'))
  })
})

describe('la tanda de las liquidaciones por correo (D01, 0100 y 0110; ya aplicada, real #96), tal cual', () => {
  const MANIFIESTO = 'tests/conta/produccion/tanda-d01-liquidaciones-20261016.txt'
  const viva = leerTanda(MANIFIESTO)
  // La respuesta REAL de la consulta de contexto del workflow, lanzada en solo
  // lectura en producción para ESTOS ficheros (con sus md5): ver el _que del JSON.
  const ctx = JSON.parse(readFileSync('tests/conta/produccion/contexto-produccion-d01-liquidaciones-20261016.json', 'utf8')).contexto
  const leer = (r: string) => { try { return readFileSync(r, 'utf8') } catch { return null } }
  const r = informe(viva, ctx, {}, leer) as { markdown: string; ficheros: Record<string, string> }

  it('dos ficheros, en orden, y los dos siguen (sin «autorizo»): lo que cambia en caliente, declarado y con su prueba', () => {
    expect(viva).toEqual(['supabase/migrations/20261113T0100_d01_liquidaciones_correo.sql', 'supabase/migrations/20261113T0110_d01_liquidaciones_direccion_foodint.sql'])
    expect(r.ficheros).toEqual({ [viva[0]]: 'sigue', [viva[1]]: 'sigue' })
    const cabecera = readFileSync(viva[0], 'utf8').split('\n').filter((l) => /^-- cambia:/.test(l)).map((l) => l.replace(/^-- cambia: (\S+) .*$/, '$1'))
    expect(cabecera).toEqual(['public.company_inbound_address', 'public.inbound_email_log', 'public.conta_entrada_destino', 'public.supplier_invoice', 'public.channel_settlement', 'public.conta_recibida_envio'])
  })
  it('los datos (0110) solo añaden la dirección de Foodint, apagada, y si ya está no hacen nada', () => {
    const sql = readFileSync(viva[1], 'utf8').replace(/--.*$/gm, '')
    expect(sql).not.toMatch(/^\s*(update|delete)\b/im)
    expect(sql).toContain("'51ad1792-6629-4ef7-833a-b57b09a86710'")
    expect(sql).toMatch(/'liquidaciones', 'liquidaciones-foodint', 'entrada\.folvy\.app', false/)
    expect(sql).toMatch(/and not exists/)
  })
  it('declara qué cuenta; la cuenta existe y cuenta la tabla nueva sin nombrarla fuera de una cadena (ensayo #89 de E05)', () => {
    const cuentas = readFileSync(MANIFIESTO, 'utf8').split('\n').filter((l) => l.startsWith('cuenta:')).map((l) => l.replace(/^cuenta:\s*/, '').trim())
    expect(cuentas).toEqual(['scripts/conta/produccion/cuentas/d01-liquidaciones.sql'])
    for (const c of cuentas) expect(existsSync(c), c).toBe(true)
    const fuera = readFileSync(cuentas[0], 'utf8').replace(/--.*$/gm, '').replace(/'(?:[^']|'')*'/g, "''")
    expect(fuera).not.toMatch(/\b(from|join)\s+(public\.)?platform_store\b/i)
  })
  it('su vuelta atrás va en orden inverso y cada fichero para si se perdería algo', () => {
    const atras = leerTanda('tests/conta/produccion/vuelta-atras-d01-liquidaciones-20261016.txt')
    expect(atras).toEqual(['supabase/vuelta-atras/20261113T0110_d01_liquidaciones_direccion_foodint.down.sql', 'supabase/vuelta-atras/20261113T0100_d01_liquidaciones_correo.down.sql'])
    for (const f of atras) expect(readFileSync(f, 'utf8'), f).toMatch(/raise exception/)
  })
})

describe('la tanda que encendió liquidaciones-foodint@ (D01, 0100 del 14; ya aplicada, real #100), tal cual', () => {
  const MANIFIESTO = 'tests/conta/produccion/tanda-d01-encender-liquidaciones-20261016.txt'
  const F = 'supabase/migrations/20261114T0100_d01_encender_liquidaciones_foodint.sql'
  const viva = leerTanda(MANIFIESTO)
  // La respuesta REAL de la consulta de contexto del workflow, lanzada en solo
  // lectura en producción para ESTE fichero (con su md5): ver el _que del JSON.
  const ctx = JSON.parse(readFileSync('tests/conta/produccion/contexto-produccion-d01-encender-liquidaciones-20261016.json', 'utf8')).contexto
  const leer = (r: string) => { try { return readFileSync(r, 'utf8') } catch { return null } }
  const r = informe(viva, ctx, {}, leer) as { markdown: string; ficheros: Record<string, string> }
  const sql = readFileSync(F, 'utf8').replace(/--.*$/gm, '')

  it('un fichero, y pide «autorizo» (un update sobre lo que existe), sin tocar el camino del pedido', () => {
    expect(viva).toEqual([F])
    expect(r.ficheros).toEqual({ [F]: 'autorizo' })
    expect(analizarFichero(F).map((o: Op) => `${o.accion} ${o.objeto}`)).toEqual(['cambia_datos public.company_inbound_address'])
  })
  it('enciende solo esa fila: cuenta y empresa de Foodint, clase «liquidaciones», esa dirección', () => {
    const update = sql.slice(sql.indexOf('update public.company_inbound_address'))
    expect(update).toMatch(/set active = true/)
    for (const x of ["account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'", "company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9'", "kind = 'liquidaciones'",
      "lower(local_part) = 'liquidaciones-foodint'", "lower(domain) = 'entrada.folvy.app'", 'and not active']) expect(update.split(';')[0]).toContain(x)
    expect((sql.match(/\bupdate\b/gi) ?? []).length).toBe(1)
    expect(sql).not.toMatch(/\b(delete|insert|drop|alter)\b/i)
  })
  it('el freno: una sola fila y apagada antes; y después, exactamente una encendida (si no, para y no toca nada)', () => {
    expect(sql).toMatch(/if n <> 1 or encendidas <> 0 then\s+raise exception/)
    expect(sql).toMatch(/get diagnostics hechas = row_count;\s+if hechas <> 1 then\s+raise exception/)
  })
  it('declara qué cuenta, y la cuenta existe y solo lee', () => {
    const cuentas = readFileSync(MANIFIESTO, 'utf8').split('\n').filter((l) => l.startsWith('cuenta:')).map((l) => l.replace(/^cuenta:\s*/, '').trim())
    expect(cuentas).toEqual(['scripts/conta/produccion/cuentas/d01-encender-liquidaciones.sql'])
    const c = readFileSync(cuentas[0], 'utf8').replace(/--.*$/gm, '')
    expect(c).not.toMatch(/\b(update|delete|insert)\b/i)
  })
  it('su vuelta atrás la vuelve a apagar, solo esa fila, y para si no hay exactamente una', () => {
    const atras = leerTanda('tests/conta/produccion/vuelta-atras-d01-encender-liquidaciones-20261016.txt')
    expect(atras).toEqual(['supabase/vuelta-atras/20261114T0100_d01_encender_liquidaciones_foodint.down.sql'])
    const down = readFileSync(atras[0], 'utf8').replace(/--.*$/gm, '')
    expect(down).toMatch(/set active = false/)
    expect(down).toMatch(/if n <> 1 then\s+raise exception/)
    expect(down).not.toMatch(/\bdelete\b/i)
  })
})

describe('la tanda del corte por fecha de las liquidaciones (D01, 0100 y 0110 del 15; ya aplicada, real #105 desde 2f42f151), tal cual', () => {
  const MANIFIESTO = 'tests/conta/produccion/tanda-d01-corte-liquidaciones-20261016.txt'
  const ATRAS = 'tests/conta/produccion/vuelta-atras-d01-corte-liquidaciones-20261016.txt'
  const F0 = 'supabase/migrations/20261115T0100_d01_liquidaciones_corte.sql'
  const F1 = 'supabase/migrations/20261115T0110_d01_liquidaciones_referencia_foodint.sql'
  const viva = leerTanda(MANIFIESTO)
  const ctx = JSON.parse(readFileSync('tests/conta/produccion/contexto-produccion-d01-corte-liquidaciones-20261016.json', 'utf8')).contexto
  const leer = (r: string) => { try { return readFileSync(r, 'utf8') } catch { return null } }
  const r = informe(viva, ctx, {}, leer) as { markdown: string; ficheros: Record<string, string> }
  const sin = (f: string) => readFileSync(f, 'utf8').replace(/--.*$/gm, '')

  it('dos ficheros, en orden: el corte sigue (lo que cambia, declarado y con su prueba) y los datos piden «autorizo»', () => {
    expect(viva).toEqual([F0, F1])
    expect(r.ficheros).toEqual({ [F0]: 'sigue', [F1]: 'autorizo' })
    const cabecera = readFileSync(F0, 'utf8').split('\n').filter((l) => /^-- cambia:/.test(l)).map((l) => l.replace(/^-- cambia: (\S+) .*$/, '$1'))
    expect(cabecera).toEqual(['public._conta_liquidacion_marcar', 'public.conta_liquidacion_factura_proponer'])
  })
  it('el corte es el de Bancos y decide por el último día del periodo; la que cruza, real con su factura', () => {
    const s = sin(F0)
    expect(s).toMatch(/select cutover_date from public\.bank_settings where company_id = p_company/)
    expect(s).toMatch(/max\(imported_until\) \+ 1 from public\.fiscal_year/)
    expect(s).toMatch(/if v_corte is not null and v_cs\.period_to < v_corte then/)
    expect(s).toMatch(/v_fecha := v_cs\.period_to \+ 2;/)
  })
  it('la columna nueva admite nulos (añadir), y nada lee algo que el fichero crea después', () => {
    expect(sin(F0)).toMatch(/add column if not exists is_reference boolean;/)
    expect(ordenEnElFichero(readFileSync(F0, 'utf8'))).toEqual([])
  })
  it('los datos: solo Foodint, el freno de 7 y 7 sin nada colgando, la copia antes de borrar, y los solapes después', () => {
    const s = sin(F1)
    expect(s).toContain("'51ad1792-6629-4ef7-833a-b57b09a86710'")
    // En producción, Foodint, 7 y 2: lo que la prueba de staging cambia con d01_prueba.* solo vale sin cuentas de producción.
    expect(s).toMatch(/acc constant uuid := coalesce\(nullif\(current_setting\('d01_prueba\.cuenta', true\), ''\), '51ad1792-6629-4ef7-833a-b57b09a86710'\)::uuid;/)
    expect(s).toMatch(/emp constant uuid := coalesce\(nullif\(current_setting\('d01_prueba\.empresa', true\), ''\), '658728c0-fcd7-46ef-a860-d4e5e6eb21d9'\)::uuid;/)
    expect(s).toMatch(/esperadas constant int := coalesce\(nullif\(current_setting\('d01_prueba\.esperadas', true\), ''\), '7'\)::int;/)
    expect(s).toMatch(/solapes_min constant int := coalesce\(nullif\(current_setting\('d01_prueba\.solapes', true\), ''\), '2'\)::int;/)
    expect(s).toMatch(/if coalesce\(current_setting\('d01_prueba\.cuenta', true\), ''\) <> ''\s+and exists \(select 1 from public\.accounts where id in \('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001'\)\) then\s+raise exception/)
    expect(s).toMatch(/if n_liq <> esperadas or n_fac <> esperadas or n_mal <> 0 or n_colgando <> 0 then\s+raise exception/)
    expect(s.indexOf('insert into public.conta_respaldo_liquidacion_factura')).toBeLessThan(s.indexOf('delete from public.supplier_invoice'))
    expect(s).toMatch(/n_solape_despues <> n_solape_antes or n_solape_despues < solapes_min/)
    expect((s.match(/\bdelete\b/gi) ?? []).length).toBe(1)
  })
  it('declara qué cuenta; la cuenta solo lee y cuenta lo nuevo sin nombrarlo fuera de una cadena', () => {
    const cuentas = readFileSync(MANIFIESTO, 'utf8').split('\n').filter((l) => l.startsWith('cuenta:')).map((l) => l.replace(/^cuenta:\s*/, '').trim())
    expect(cuentas).toEqual(['scripts/conta/produccion/cuentas/d01-corte-liquidaciones.sql'])
    const fuera = sin(cuentas[0]).replace(/'(?:[^']|'')*'/g, "''")
    expect(fuera).not.toMatch(/\b(update|delete|insert)\b/i)
    expect(fuera).not.toMatch(/\b(from|join)\s+(public\.)?conta_respaldo_liquidacion_factura\b/i)
    expect(fuera).not.toMatch(/\bis_reference\b/)
  })
  it('su vuelta atrás va en orden inverso: devuelve las facturas desde la copia y para si algo no cuadra', () => {
    const atras = leerTanda(ATRAS)
    expect(atras).toEqual(['supabase/vuelta-atras/20261115T0110_d01_liquidaciones_referencia_foodint.down.sql', 'supabase/vuelta-atras/20261115T0100_d01_liquidaciones_corte.down.sql'])
    for (const f of atras) expect(readFileSync(f, 'utf8'), f).toMatch(/raise exception/)
    expect(readFileSync(atras[0], 'utf8')).toMatch(/jsonb_populate_record\(null::public\.supplier_invoice/)
    expect(readFileSync(atras[0], 'utf8')).toMatch(/is_generated = 'NEVER'/)
    expect(readFileSync(atras[0], 'utf8')).toMatch(/esperadas constant int := coalesce\(nullif\(current_setting\('d01_prueba\.esperadas', true\), ''\), '7'\)::int;/)
  })
  it('tanda y vuelta atrás, sin nombres ambiguos; y las dos vueltas atrás las ejecuta de verdad la prueba de staging, sobre datos', () => {
    const fs = [F0, F1, ...leerTanda(ATRAS)]
    const cols = columnasConocidas(readFileSync('src/types/database.ts', 'utf8'), fs.map((f) => readFileSync(f, 'utf8')))
    for (const f of fs) expect(ambiguosEnPlpgsql(readFileSync(f, 'utf8'), (t: string) => cols.get(t)), f).toEqual([])
    const prueba = 'supabase/staging/sql/20261115_d01_referencia_vuelta_atras_prueba.sql'
    expect(leerTanda('supabase/staging/aplicar.txt')).toContain(prueba)
    const ies = readFileSync(prueba, 'utf8').split('\n').filter((l) => l.startsWith('\\i ')).map((l) => l.slice(3).trim())
    expect(ies).toEqual([F1, ...leerTanda(ATRAS)])
  })
  it('la vuelta atrás del corte deja las dos funciones con el texto de la 0100 del 13, tal cual', () => {
    const down = readFileSync('supabase/vuelta-atras/20261115T0100_d01_liquidaciones_corte.down.sql', 'utf8')
    const antes = readFileSync('supabase/migrations/20261113T0100_d01_liquidaciones_correo.sql', 'utf8')
    const funcion = (t: string, nombre: string) => { const i = t.indexOf(`create or replace function public.${nombre}(`); return t.slice(i, t.indexOf('end $$;', i)) }
    for (const n of ['_conta_liquidacion_marcar', 'conta_liquidacion_factura_proponer']) expect(funcion(down, n)).toBe(funcion(antes, n))
  })
  it('sus copias son lo que se aplicó: los md5 de los dos ficheros, los medidos (y los del historial de producción)', () => {
    const medido = JSON.parse(readFileSync('tests/conta/produccion/contexto-produccion-d01-corte-liquidaciones-20261016.json', 'utf8')).tanda
    expect(medido).toEqual({ [F0]: 'ac563f722a3e43a6d24b5f9af96a8fcb', [F1]: '7cf0632555c99098caad314890ef7e43' })
    for (const f of viva) expect(createHash('md5').update(readFileSync(f)).digest('hex'), f).toBe(medido[f])
  })
})

describe('la tanda de «Esperan», los motivos para validar en un solo sitio (M01, Julio, 16/10), ya aplicada: su copia y su contexto medido', () => {
  const MANIFIESTO = 'tests/conta/produccion/tanda-m01-esperan-20261017.txt'
  const viva = leerTanda(MANIFIESTO)
  // La respuesta REAL de la consulta de contexto del workflow, lanzada en solo
  // lectura en producción el 16/10 a las 19:49 UTC para ESTE fichero (con su md5).
  const ctx = JSON.parse(readFileSync('tests/conta/produccion/contexto-produccion-m01-esperan-20261017.json', 'utf8')).contexto
  const leer = (r: string) => { try { return readFileSync(r, 'utf8') } catch { return null } }
  const r = informe(viva, ctx, {}, leer) as { markdown: string; ficheros: Record<string, string> }
  const PRUEBA = 'supabase/staging/sql/20261117_m01_motivos_para_validar_prueba.sql'

  it('un fichero, «sigue»: añade dos funciones y cambia dos, con la misma firma', () => {
    expect(viva).toEqual(['supabase/migrations/20261117T0100_m01_motivos_para_validar.sql'])
    expect(r.ficheros).toEqual({ [viva[0]]: 'sigue' })
  })
  it('declara lo que cambia, con su prueba de staging, y no toca ninguna tabla', () => {
    const sql = readFileSync(viva[0], 'utf8')
    for (const o of ['public.journal_entry_validar', 'public.tg_journal_entry_envio_por_aclarar']) expect(sql).toContain(`-- cambia: ${o} · prueba: ${PRUEBA}`)
    expect(existsSync(PRUEBA)).toBe(true)
    // Fuera de los cuerpos de las funciones (journal_entry_validar sí escribe al validar: eso no es la tanda).
    const codigo = sql.replace(/--.*$/gm, '').replace(/(\$\w*\$)[\s\S]*?\1/g, '')
    expect(codigo).toMatch(/create or replace function public\.journal_entry_validar\(/)
    expect(codigo).not.toMatch(/^\s*(alter|drop|create)\s+table\b/im)
    expect(codigo).not.toMatch(/^\s*(insert|update|delete)\b/im)
  })
  it('las dos que cambia están en producción con la huella de la que parte la vuelta atrás (medida el 16/10)', () => {
    expect(ctx.funciones).toEqual(['public.journal_entry_validar(uuid,text)', 'public.tg_journal_entry_envio_por_aclarar()'])
    const md5 = (s: string) => createHash('md5').update(s).digest('hex')
    const cuerpo = (f: string, nombre: string) => {
      const m = new RegExp(`create or replace function public\\.${nombre}\\(.*?as (\\$\\w*\\$)([\\s\\S]*?)\\1`, 's').exec(readFileSync(f, 'utf8'))
      return m ? md5(m[2]) : null
    }
    const atras = 'supabase/vuelta-atras/20261117T0100_m01_motivos_para_validar.down.sql'
    // Las huellas de producción (md5 de prosrc), las que pega la cuenta.
    expect(cuerpo(atras, 'journal_entry_validar')).toBe('798e4c431fe9d790288d974b7fe22431')
    expect(cuerpo(atras, 'tg_journal_entry_envio_por_aclarar')).toBe('7a2549b0b50731d33bfafb5cd5ee5fd9')
    expect(cuerpo('supabase/migrations/20261113T0100_c06b_centimo_iva.sql', 'journal_entry_validar')).toBe('798e4c431fe9d790288d974b7fe22431')
    expect(cuerpo('supabase/migrations/20261116T0100_c06b_promociones_envios.sql', 'tg_journal_entry_envio_por_aclarar')).toBe('7a2549b0b50731d33bfafb5cd5ee5fd9')
  })
  it('declara qué cuenta; la cuenta existe, solo lee y no nombra las funciones nuevas fuera de una cadena', () => {
    const cuentas = readFileSync(MANIFIESTO, 'utf8').split('\n').filter((l) => l.startsWith('cuenta:')).map((l) => l.replace(/^cuenta:\s*/, '').trim())
    expect(cuentas).toEqual(['scripts/conta/produccion/cuentas/m01-esperan.sql'])
    for (const c of cuentas) expect(existsSync(c), c).toBe(true)
    const fuera = readFileSync(cuentas[0], 'utf8').replace(/--.*$/gm, '').replace(/'(?:[^']|'')*'/g, "''")
    expect(fuera).toMatch(/to_regprocedure/)
    expect(fuera).not.toMatch(/conta_motivos_para_validar|conta_esperan/)
    expect(fuera).not.toMatch(/\b(insert|update|delete|create|drop|alter)\b/i)
    expect(readFileSync(cuentas[0], 'utf8')).toContain("'51ad1792-6629-4ef7-833a-b57b09a86710'")
  })
  it('su vuelta atrás es un fichero, con la misma cuenta, y su prueba de staging la ejecuta de verdad', () => {
    expect(leerTanda('tests/conta/produccion/vuelta-atras-m01-esperan-20261017.txt')).toEqual(['supabase/vuelta-atras/20261117T0100_m01_motivos_para_validar.down.sql'])
    expect(readFileSync('tests/conta/produccion/vuelta-atras-m01-esperan-20261017.txt', 'utf8')).toContain('cuenta: scripts/conta/produccion/cuentas/m01-esperan.sql')
    const p = readFileSync('supabase/staging/sql/20261117_m01_motivos_para_validar_vuelta_atras_prueba.sql', 'utf8')
    expect(p).toContain('\\i supabase/vuelta-atras/20261117T0100_m01_motivos_para_validar.down.sql')
    expect(p).toMatch(/rollback;\s*$/)
  })
})

describe('W02 · un secreto de Vault se escribe llamando a una función: vault.create_secret y vault.update_secret cuentan como escritura en vault.secrets', () => {
  // Con el analizador de antes (hasta el W02, 17/10) estas tres salían «sigue»:
  // ninguna orden de insert ni update, solo llamadas. Y cambian el secreto vivo.
  const existe = (o: { objeto: string }) => o.objeto === 'vault.secrets'
  const casos = [
    `do $$ declare v uuid; begin select id into v from vault.secrets where name = 'x'; perform vault.update_secret(v, 'nuevo'); end $$;`,
    `do $$ begin perform vault.create_secret('valor', 'x_anterior', 'el de antes'); end $$;`,
    `select vault.update_secret('00000000-0000-0000-0000-000000000000', 'nuevo');`,
  ]
  it('cada una, una escritura en vault.secrets', () => {
    for (const c of casos) {
      const ops = analizarFichero('caso.sql', c)
      expect(ops.some((o) => o.accion === 'cambia_datos' && o.tipo === 'tabla' && o.objeto === 'vault.secrets'), c).toBe(true)
    }
  })
  it('y, como vault.secrets existe, piden «autorizo»', () => {
    for (const c of casos) {
      const ops = analizarFichero('caso.sql', c)
      expect(veredicto(ops, { existe }).estado, c).toBe('autorizo')
    }
  })
  it('leer un secreto (vault.decrypted_secrets) no es escribir', () => {
    const ops = analizarFichero('caso.sql', `select decrypted_secret from vault.decrypted_secrets where name = 'x';`)
    expect(ops.filter((o) => o.objeto === 'vault.secrets')).toEqual([])
  })
})

describe('la tanda del C07 · todo asiento de Sumied a Diez (0450, aplicada; su copia)', () => {
  const MANIFIESTO = 'tests/conta/produccion/tanda-c07-diez-todo-20261022.txt'
  const viva = leerTanda(MANIFIESTO)
  // La respuesta REAL de la consulta de contexto del workflow, lanzada en solo
  // lectura en producción el 22/10 a las 06:46 UTC, después de la 0410 (aplicada), para ESTE fichero.
  const medida = JSON.parse(readFileSync('tests/conta/produccion/contexto-produccion-c07-diez-todo-20261022.json', 'utf8'))
  const ctx = medida.contexto
  const leer = (r: string) => { try { return readFileSync(r, 'utf8') } catch { return null } }
  const r = informe(viva, ctx, {}, leer) as { markdown: string; ficheros: Record<string, string> }
  const md5 = (x: string) => createHash('md5').update(x).digest('hex')
  const nombre = (f: string) => f.replace(/^.*\//, '')
  const PRUEBA = 'supabase/staging/sql/20261201_c07_diez_todo_prueba.sql'
  const DOWN = 'supabase/vuelta-atras/20261201T0450_c07_diez_todo.down.sql'
  // El cuerpo de una función (lo de entre sus $$) en un fichero.
  const cuerpo = (t: string, fn: string) => t.slice(t.indexOf(`create or replace function public.${fn}(`)).split('$$')[1]
  const ORIGEN = { conta_resumen_ventas: ['supabase/migrations/20261116T0100_c06b_promociones_envios.sql', '62ba30b970c7c61849dc2f96e8a8cfb1'], conta_recibida_envio: ['supabase/migrations/20261126T0320_i01f_recibida_envio_tratamiento.sql', 'e3c57e29abd43a52c2c95790e2cc494a'] } as const
  const ultimo = (t: string, fn: string) => t.slice(t.lastIndexOf(`create or replace function public.${fn}(`)).split('$$')[1]

  it('un fichero, el medido; sigue sin «autorizo»; las dos que cambian existen sin hermanas; nada del camino del pedido; nada registrado aún', () => {
    expect(viva.map(nombre)).toEqual(['20261201T0450_c07_diez_todo.sql'])
    expect(Object.keys(medida.tanda)).toEqual(viva)
    for (const f of viva) expect(md5(readFileSync(f, 'utf8')), f).toBe(medida.tanda[f])
    expect(viva.map((f) => r.ficheros[f])).toEqual(['sigue'])
    expect(ctx.tablas).toEqual(['public.conta_diez_autorizo', 'public.external_send'])
    expect(ctx.funciones).toEqual(['public.conta_recibida_envio(uuid)', 'public.conta_resumen_ventas(uuid)'])
    expect(ctx.otras).toEqual({})
    expect(ctx.camino).toEqual({ tablas: [], funciones: [] })
    expect(ctx.registro).toEqual([])
  })
  it('lo que cambia en caliente está en la cabecera, con su prueba de staging, y la prueba lo nombra, entra como usuario y como servidor, y ejecuta la vuelta atrás', () => {
    const cab = readFileSync(viva[0], 'utf8').split('\n').filter((l) => /^-- cambia:/.test(l))
    expect(cab).toEqual(['public.conta_resumen_ventas', 'public.conta_recibida_envio', 'public.external_send', 'public.conta_diez_autorizo'].map((o) => `-- cambia: ${o} · prueba: ${PRUEBA}`))
    const p = readFileSync(PRUEBA, 'utf8')
    for (const x of ['conta_resumen_ventas', 'conta_recibida_envio', 'conta_diez_por_enviar', 'conta_diez_reclamar', 'conta_diez_envio_poner', 'conta_asiento_envio',
      'set local role authenticated', 'set local role service_role', 'rollback;', `\\i ${DOWN}`]) expect(p).toContain(x)
    const m = readFileSync('supabase/staging/aplicar.txt', 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    // W04 (22/10): la 0450 ya está en producción, así que va de verdad a staging, desde
    // main, detrás de su prueba (que la aplica dentro de su ROLLBACK).
    expect(m.indexOf(PRUEBA)).toBeGreaterThan(-1)
    expect(m.indexOf(viva[0])).toBeGreaterThan(m.indexOf(PRUEBA))
  })
  it('las dos lecturas: el cuerpo de producción con una sola condición más (el servidor), y la vuelta atrás las deja byte a byte', () => {
    const t = readFileSync(viva[0], 'utf8')
    const d = readFileSync(DOWN, 'utf8')
    for (const [fn, [origen, huella]] of Object.entries(ORIGEN)) {
      const antes = ultimo(readFileSync(origen, 'utf8'), fn)
      expect(md5(antes), fn).toBe(huella)
      expect(cuerpo(t, fn), fn).toBe(antes.replace('if v_e.id is null or not public.belongs_to_account(v_e.account_id) then',
        "if v_e.id is null or not (public.belongs_to_account(v_e.account_id) or auth.role() = 'service_role') then"))
      expect(md5(cuerpo(d, fn)), fn).toBe(huella)
    }
  })
  it('no borra ni cambia filas: solo añade (y nadie lee sin cuenta)', () => {
    const t = readFileSync(viva[0], 'utf8').replace(/--.*$/gm, '')
    // (El único «truncate» es el de su tabla temporal, la de reclamar.)
    expect(t).not.toMatch(/\b(delete\s+from|truncate\s+(?!_c07_reclamo)|drop\s+(table|column))/i)
    // Lo único que escribe filas es reclamar (en external_send, las suyas) y el interruptor (el suyo), y van con cuenta.
    expect(t.match(/update public\.\w+/g)).toEqual(['update public.external_send', 'update public.conta_diez_envio_empresa'])
    expect(t).toMatch(/s\.account_id = r\.account_id/)
  })
  it('el cron solo donde está el secreto de los vigías, y solo llama si hay algo', () => {
    const t = readFileSync(viva[0], 'utf8')
    expect(t).toMatch(/exists \(select 1 from vault\.secrets where name = 'cron_secret'\)/)
    expect(t).toMatch(/if not exists \(select 1 from public\.conta_diez_por_enviar\(1\)\) then return; end if;/)
  })
  it('declara qué cuenta; la cuenta solo lee y va por Foodint', () => {
    const cuentas = readFileSync(MANIFIESTO, 'utf8').split('\n').filter((l) => l.startsWith('cuenta:')).map((l) => l.replace(/^cuenta:\s*/, '').trim())
    expect(cuentas).toEqual(['scripts/conta/produccion/cuentas/diez-todo.sql'])
    const c = readFileSync(cuentas[0], 'utf8')
    expect(c.replace(/--.*$/gm, '').replace(/'(?:[^']|'')*'/g, "''")).not.toMatch(/\b(insert|update|delete|create|drop|alter|grant|perform)\b/i)
    expect(c).toContain("'51ad1792-6629-4ef7-833a-b57b09a86710'")
  })
  it('su vuelta atrás', () => {
    expect(leerTanda('tests/conta/produccion/vuelta-atras-c07-diez-todo-20261022.txt')).toEqual([DOWN])
  })
})

describe('la tanda C08 · Lovers Burgers de Carabanchel, al catálogo de HubRise que existe (0840, PR #301), ya aplicada: su copia y su contexto medido', () => {
  const MANIFIESTO = 'tests/conta/produccion/tanda-c08-lovers-catalogo-20261023.txt'
  const viva = leerTanda(MANIFIESTO)
  // La respuesta REAL de la consulta de contexto del workflow, lanzada en solo
  // lectura en producción el 23/10 a las 16:24 UTC, para ESTE fichero.
  const medida = JSON.parse(readFileSync('tests/conta/produccion/contexto-produccion-c08-lovers-catalogo-20261023.json', 'utf8'))
  const ctx = medida.contexto
  const leer = (r: string) => { try { return readFileSync(r, 'utf8') } catch { return null } }
  const r = informe(viva, ctx, {}, leer) as { markdown: string; ficheros: Record<string, string> }
  const md5 = (x: string) => createHash('md5').update(x).digest('hex')
  const DOWN = 'supabase/vuelta-atras/20261208T0840_c08_lovers_catalogo_2qjdb.down.sql'

  it('un fichero, el medido; pidió «autorizo»; nada del camino del pedido; nada registrado al medir', () => {
    expect(viva).toEqual(['supabase/migrations/20261208T0840_c08_lovers_catalogo_2qjdb.sql'])
    expect(Object.keys(medida.tanda)).toEqual(viva)
    expect(md5(readFileSync(viva[0], 'utf8'))).toBe(medida.tanda[viva[0]])
    expect(r.ficheros[viva[0]]).toMatch(/autorizo/i)
    expect(ctx.tablas).toEqual(['public.brand_hubrise_catalog'])
    expect(ctx.camino).toEqual({ tablas: [], funciones: [] })
    expect(ctx.registro).toEqual([])
  })
  it('una sola fila, anclada por id, cuenta, marca, location y el catálogo de antes; para si no es una', () => {
    const sin = readFileSync(viva[0], 'utf8').replace(/--.*$/gm, '')
    expect(sin.match(/\bupdate\s+public\./gi)).toHaveLength(1)
    expect(sin).toContain("set external_catalog_id = '2qjdb'")
    expect(sin).toContain("where id = v_fila and account_id = v_acc and brand_id = v_marca")
    expect(sin).toContain("and external_location_id = '1b6p8-2' and external_catalog_id = 'q3v47'")
    expect(sin).toContain('if v_n <> 1 then')
    expect(sin).toMatch(/if not exists \(select 1 from public\.accounts where id = v_acc\) then/)
  })
  it('su vuelta atrás la devuelve al q3v47 solo si está en 2qjdb; la cuenta solo lee; y el manifiesto avisaba de la D07', () => {
    expect(leerTanda('tests/conta/produccion/vuelta-atras-c08-lovers-catalogo-20261023.txt')).toEqual([DOWN])
    const d = readFileSync(DOWN, 'utf8').replace(/--.*$/gm, '')
    expect(d).toContain("set external_catalog_id = 'q3v47'")
    expect(d).toContain("and external_location_id = '1b6p8-2' and external_catalog_id = '2qjdb'")
    const cuentas = readFileSync(MANIFIESTO, 'utf8').split('\n').filter((l) => l.startsWith('cuenta:')).map((l) => l.replace(/^cuenta:\s*/, '').trim())
    expect(cuentas).toEqual(['scripts/conta/produccion/cuentas/c08-lovers-catalogo.sql'])
    const c = readFileSync(cuentas[0], 'utf8')
    expect(c.replace(/--.*$/gm, '').replace(/'(?:[^']|'')*'/g, "''")).not.toMatch(/\b(insert|update|delete|create|drop|alter|grant|perform)\b/i)
    expect(readFileSync(MANIFIESTO, 'utf8')).toContain('Antes de fusionar, aplicar.txt y')
  })
})

describe('la tanda de AHORA (la heredada del C10): D07a + D07c · el respaldo (0880), las recibidas que Diez rechazó por la descripción, otra vez a la cola (0820), y «Saldo prepago» en todas las listas (0830)', () => {
  const MANIFIESTO = 'supabase/produccion/tandas/sumied/heredada/aplicar.txt'
  const viva = leerTanda(MANIFIESTO)
  // La respuesta REAL de la consulta de contexto del workflow, lanzada en solo
  // lectura en producción el 23/10 a las 14:55 UTC (después del run 190) y otra vez a las 16:50 (con la 0840 del C08 aplicada), para ESTOS ficheros.
  const medida = JSON.parse(readFileSync('supabase/produccion/tandas/sumied/heredada/contexto.json', 'utf8'))
  const ctx = medida.contexto
  const leer = (r: string) => { try { return readFileSync(r, 'utf8') } catch { return null } }
  const r = informe(viva, ctx, {}, leer) as { markdown: string; ficheros: Record<string, string> }
  const md5 = (x: string) => createHash('md5').update(x).digest('hex')
  const nombre = (f: string) => f.replace(/^.*\//, '')
  const PRUEBA = 'supabase/staging/sql/20261208_d07a_diez_reenviar_prueba.sql'
  const DOWN = 'supabase/vuelta-atras/20261208T0820_d07a_diez_reenviar_descripcion.down.sql'
  const PRUEBA_C = 'supabase/staging/sql/20261208_d07c_prepago_listas_prueba.sql'
  const DOWN_C = 'supabase/vuelta-atras/20261208T0830_d07c_prepago_en_todas_las_listas.down.sql'
  const PRUEBA_R = 'supabase/staging/sql/20261208_d07a_respaldo_prueba.sql'
  const DOWN_R = 'supabase/vuelta-atras/20261208T0880_d07a_respaldo_antes_de_reenviar.down.sql'
  const [respaldo, reenviar, prepago] = viva

  it('tres ficheros, los medidos, la 0880 ANTES que la 0820; la 0880 sigue, la 0820 (datos de Foodint) pide «autorizo» y la 0830 sigue; nada del camino del pedido; nada registrado aún', () => {
    expect(viva.map(nombre)).toEqual(['20261208T0880_d07a_respaldo_antes_de_reenviar.sql', '20261208T0820_d07a_diez_reenviar_descripcion.sql', '20261208T0830_d07c_prepago_en_todas_las_listas.sql'])
    expect(Object.keys(medida.tanda)).toEqual(viva)
    for (const f of viva) expect(md5(readFileSync(f, 'utf8')), f).toBe(medida.tanda[f])
    expect(r.ficheros[respaldo]).toBe('sigue')
    expect(r.ficheros[reenviar]).toMatch(/autorizo/i)
    expect(r.ficheros[prepago]).toBe('sigue')
    expect(ctx.tablas).toEqual(['public.customer_fiscal', 'public.external_send', 'public.payment_method', 'public.supplier_invoice'])
    expect(ctx.funciones).toEqual(['public.conta_recibida_guardar(uuid,jsonb,text)', 'public.mark_supplier_invoice_paid(uuid,date,text)'])
    expect(ctx.otras).toEqual({})
    expect(ctx.camino).toEqual({ tablas: [], funciones: [] })
    expect(ctx.registro).toEqual([])
  })
  it('solo toca los envíos de RIDERS de Foodint rechazados por la descripción, y para si no hay o si son más de 200', () => {
    const d = readFileSync(reenviar, 'utf8')
    expect(d).toContain("v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710'")
    expect(d).toContain("v_prov constant uuid := 'cbe3ddb1-5d3a-4aa7-a907-38f362e922b1'")
    expect(d).toMatch(/if not exists \(select 1 from public\.accounts where id = v_acc\) then/)
    const sin = d.replace(/--.*$/gm, '')
    expect(sin.match(/\bupdate\s+public\./gi)).toHaveLength(1)
    expect(sin).toContain("x.account_id = v_acc and i.supplier_id = v_prov and x.kind = 'factura' and x.status = 'pendiente'")
    expect(sin).toContain("x.last_error ilike '%factura.Descripcion%'")
    expect(sin).toContain('set attempts = 0, next_try_at = now()')
    expect(sin).toContain('if v_n = 0 then raise exception')
    expect(sin).toContain('if v_n > 200 then raise exception')
    // Solo los intentos, el siguiente intento y el motivo: el estado no se toca.
    expect(sin.match(/update public\.external_send x\s+set ([\s\S]*?)\s+from _d07a_reenviar/)?.[1]).not.toMatch(/\bstatus\b/)
    // El orden va dicho: después de desplegar las dos funciones.
    expect(d).toContain('Esta tanda va DESPUÉS de desplegar conta-diez-cola y')
    expect(readFileSync(MANIFIESTO, 'utf8')).toContain('DESPUÉS se aplica esta tanda, desde main')
  })
  it('su prueba de staging ejecuta la 0820 y su vuelta atrás, entra como usuario y acaba en ROLLBACK; la cuenta solo lee', () => {
    const p = readFileSync(PRUEBA, 'utf8')
    for (const x of [`\\i ${reenviar}`, `\\i ${DOWN}`, 'set local role authenticated']) expect(p).toContain(x)
    expect(p.trim().endsWith('rollback;')).toBe(true)
    const m = readFileSync('supabase/staging/aplicar.txt', 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    expect(m.indexOf(PRUEBA)).toBeGreaterThan(m.indexOf(reenviar))
    const cuentas = readFileSync(MANIFIESTO, 'utf8').split('\n').filter((l) => l.startsWith('cuenta:')).map((l) => l.replace(/^cuenta:\s*/, '').trim())
    expect(cuentas).toEqual(['scripts/conta/produccion/cuentas/d07ac-diez-y-prepago.sql'])
    const c = readFileSync(cuentas[0], 'utf8')
    expect(c.replace(/--.*$/gm, '').replace(/'(?:[^']|'')*'/g, "''")).not.toMatch(/\b(insert|update|delete|create|drop|alter|grant|perform)\b/i)
    expect(leerTanda('supabase/produccion/tandas/sumied/heredada/vuelta-atras.txt')).toEqual([DOWN_C, DOWN, DOWN_R])
  })
  it('la 0830: las cinco declaradas con su prueba; las dos funciones cambian SOLO en la lista y el error, y la vuelta atrás las deja como en producción byte a byte', () => {
    const t = readFileSync(prepago, 'utf8')
    const cab = t.split('\n').filter((l) => /^-- cambia:/.test(l))
    expect(cab).toEqual(['public.conta_recibida_guardar', 'public.mark_supplier_invoice_paid', 'public.supplier_invoice', 'public.customer_fiscal', 'public.payment_method']
      .map((o) => `-- cambia: ${o} · prueba: ${PRUEBA_C}`))
    const def = (s: string, fn: string) => { const a = s.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`); return s.slice(a, s.indexOf('end $function$', a) + 'end $function$'.length) }
    const d = readFileSync(DOWN_C, 'utf8')
    expect(md5(def(d, 'conta_recibida_guardar') + '\n')).toBe('08126d47a81d33fbb3826ce6b84179d8')
    expect(md5(def(d, 'mark_supplier_invoice_paid') + '\n')).toBe('192d75fa8906f443db5800ee209b0e9a')
    expect(md5(def(t, 'conta_recibida_guardar') + '\n')).toBe('5eecff4e2fea2a335fe7323cc1cc638e')
    expect(md5(def(t, 'mark_supplier_invoice_paid') + '\n')).toBe('7ec159755cec7bf80a8b548f9f213d9a')
    // La de guardar: solo la lista (con «prepaid» y su nombre) y el error en español.
    expect(def(t, 'conta_recibida_guardar')).toContain('"prepaid": "Saldo prepago Catcher (40700001)"')
    expect(def(t, 'conta_recibida_guardar')).not.toContain('transfer, direct_debit, card o cash')
    expect(def(t, 'mark_supplier_invoice_paid')).toContain("('transfer','direct_debit','card','cash','prepaid')")
    // Los CHECK solo amplían.
    for (const c of ['supplier_invoice_paid_method_check', 'customer_fiscal_payment_method_check', 'payment_method_kind_check']) expect(t).toContain(`drop constraint if exists ${c};`)
    const p = readFileSync(PRUEBA_C, 'utf8')
    for (const x of [`\\i ${prepago}`, `\\i ${DOWN_C}`, 'set local role authenticated', 'c01b0000-0000-4000-8000-0000000000b1', '08126d47a81d33fbb3826ce6b84179d8', '5eecff4e2fea2a335fe7323cc1cc638e', '"forma_pago": "prepaid"']) expect(p).toContain(x)
    expect(p.trim().endsWith('rollback;')).toBe(true)
    const m = readFileSync('supabase/staging/aplicar.txt', 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    expect(m.indexOf(PRUEBA_C)).toBeGreaterThan(m.indexOf(prepago))
  })
  it('la 0880 respalda, con la MISMA selección que la 0820, el estado de antes; la vuelta atrás de la 0820 lo devuelve de ahí byte a byte, y la de la 0880 quita la tabla (run 190: la de antes dejaba el last_error de la 0820)', () => {
    const sel = (x: string) => x.replace(/--.*$/gm, '').match(/from public\.external_send x[\s\S]*?intento anterior: Diez no ha aceptado la factura%'\)/)?.[0]
    const r0 = readFileSync(respaldo, 'utf8'), r1 = readFileSync(reenviar, 'utf8')
    expect(sel(r0)).toBeTruthy()
    expect(sel(r0)).toBe(sel(r1))
    const sin = r0.replace(/--.*$/gm, '')
    expect(sin).toContain('create table if not exists public.conta_respaldo_d07a_envios')
    expect(sin).toContain('enable row level security')
    expect(sin).not.toMatch(/\b(update|delete)\s+(from\s+)?public\.external_send/i)
    const d = readFileSync(DOWN, 'utf8').replace(/--.*$/gm, '')
    expect(d).toContain("to_regclass('public.conta_respaldo_d07a_envios') is null")
    expect(d).toContain('set attempts = r.attempts, next_try_at = r.next_try_at, last_error = r.last_error, updated_at = r.updated_at')
    expect(d).toContain("x.status = 'pendiente'")
    expect(d).not.toContain('set attempts = 3')
    expect(readFileSync(DOWN_R, 'utf8')).toContain('drop table if exists public.conta_respaldo_d07a_envios;')
    const p = readFileSync(PRUEBA_R, 'utf8')
    for (const x of [`\\i ${respaldo}`, `\\i ${reenviar}`, `\\i ${DOWN}`, `\\i ${DOWN_R}`, 'set local role authenticated', 'byte a byte']) expect(p).toContain(x)
    expect(p.trim().endsWith('rollback;')).toBe(true)
    const m = readFileSync('supabase/staging/tandas/sumied/claude-d07a-vuelta-atras-0820.txt', 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    expect(m.indexOf(PRUEBA_R)).toBeGreaterThan(m.indexOf(respaldo))
  })
})

describe('la tanda del D06 · el saldo prepago de Riders y el PDF bueno que sustituye a la foto (0800 y 0810, aplicada; su copia)', () => {
  const MANIFIESTO = 'tests/conta/produccion/tanda-d06-prepago-y-pdf-20261023.txt'
  const viva = leerTanda(MANIFIESTO)
  // La respuesta REAL de la consulta de contexto del workflow, lanzada en solo
  // lectura en producción el 23/10 a las 11:27 UTC, con la 0790 ya aplicada, para ESTOS ficheros.
  const medida = JSON.parse(readFileSync('tests/conta/produccion/contexto-produccion-d06-prepago-y-pdf-20261023.json', 'utf8'))
  const ctx = medida.contexto
  const leer = (r: string) => { try { return readFileSync(r, 'utf8') } catch { return null } }
  const r = informe(viva, ctx, {}, leer) as { markdown: string; ficheros: Record<string, string> }
  const md5 = (x: string) => createHash('md5').update(x).digest('hex')
  const nombre = (f: string) => f.replace(/^.*\//, '')
  const FN = 'conta_factura_desde_lectura'
  const PRUEBA = 'supabase/staging/sql/20261207_d06_prepago_y_pdf_prueba.sql'
  const DOWN = 'supabase/vuelta-atras/20261207T0800_d06_prepago_y_pdf_bueno.down.sql'
  const DOWN_DATOS = 'supabase/vuelta-atras/20261207T0810_d06_riders_prepago.down.sql'
  /** La definición entera, como la devuelve pg_get_functiondef (sin su salto final). */
  const definicion = (f: string) => {
    const s = readFileSync(f, 'utf8')
    const a = s.indexOf(`CREATE OR REPLACE FUNCTION public.${FN}(`)
    const b = s.indexOf('$function$', s.indexOf('AS $function$', a) + 'AS $function$'.length)
    return s.slice(a, b + '$function$'.length)
  }

  it('dos ficheros, los medidos; la 0800 sigue y solo la 0810 (datos de Foodint) pide «autorizo»; nada del camino del pedido; nada registrado aún', () => {
    expect(viva.map(nombre)).toEqual(['20261207T0800_d06_prepago_y_pdf_bueno.sql', '20261207T0810_d06_riders_prepago.sql'])
    expect(Object.keys(medida.tanda)).toEqual(viva)
    for (const f of viva) expect(md5(readFileSync(f, 'utf8')), f).toBe(medida.tanda[f])
    expect(r.ficheros[viva[0]]).toBe('sigue')
    expect(r.ficheros[viva[1]]).toMatch(/autorizo/i)
    expect(ctx.tablas).toEqual(['public.supplier', 'public.supplier_invoice'])
    expect(ctx.funciones).toEqual([`public.${FN}(uuid,uuid)`])
    expect(ctx.otras).toEqual({})
    expect(ctx.camino).toEqual({ tablas: [], funciones: [] })
    expect(ctx.registro).toEqual([])
  })
  it('los tres cambios van declarados en la cabecera, con su prueba de staging, que ejecuta la 0810 y las dos vueltas atrás, y acaba en ROLLBACK', () => {
    const cab = readFileSync(viva[0], 'utf8').split('\n').filter((l) => /^-- cambia:/.test(l))
    expect(cab).toEqual(['public.supplier', 'public.supplier_invoice', `public.${FN}`].map((o) => `-- cambia: ${o} · prueba: ${PRUEBA}`))
    expect(readFileSync(viva[1], 'utf8')).not.toMatch(/^-- cambia:/m)
    const p = readFileSync(PRUEBA, 'utf8')
    for (const x of [FN, 'set local role service_role', `\\i ${viva[0]}`, `\\i ${viva[1]}`, `\\i ${DOWN}`, `\\i ${DOWN_DATOS}`,
      'c7e7811e385ce489612d491213276602', '2279355e38145dd73f902a03e92e2808', 'pdf_sustituye_foto', 'check_violation']) expect(p).toContain(x)
    expect(p.trim().endsWith('rollback;')).toBe(true)
    const m = readFileSync('supabase/staging/aplicar.txt', 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    expect(m.indexOf(PRUEBA)).toBeGreaterThan(m.indexOf(viva[1]))
    expect(m.indexOf(viva[1])).toBeGreaterThan(m.indexOf(viva[0]))
  })
  it('los dos CHECK solo AMPLÍAN: lo de antes y «prepaid»; su vuelta atrás, lo de antes (y para si alguien ya lo usa)', () => {
    const t = readFileSync(viva[0], 'utf8')
    for (const [tb, c] of [['supplier', 'supplier_payment_method_check'], ['supplier_invoice', 'supplier_invoice_payment_method_check']]) {
      expect(t).toContain(`alter table public.${tb} drop constraint if exists ${c};\nalter table public.${tb} add constraint ${c}\n  check (payment_method is null or payment_method in ('transfer', 'direct_debit', 'card', 'cash', 'prepaid'));`)
      expect(readFileSync(DOWN, 'utf8')).toContain(`alter table public.${tb} add constraint ${c}\n  check (payment_method is null or payment_method in ('transfer', 'direct_debit', 'card', 'cash'));`)
    }
    const d = readFileSync(DOWN, 'utf8')
    expect(d.indexOf("payment_method = 'prepaid'")).toBeLessThan(d.indexOf('drop constraint'))
  })
  it('la función cambia SOLO en el bloque nuevo, y la vuelta atrás la deja como la de producción (la 0220, md5 c7e7811e…) byte a byte', () => {
    const origen = definicion(DOWN)
    expect(md5(origen + '\n')).toBe('c7e7811e385ce489612d491213276602')
    // Y es la de la 0220, cuerpo a cuerpo.
    const s = readFileSync('supabase/migrations/20261021T0220_d01_entrada.sql', 'utf8')
    const a = s.indexOf(`create or replace function public.${FN}(`)
    const cuerpo0220 = s.slice(s.indexOf('$$', a) + 2, s.indexOf('end $$;', a))
    expect(origen.slice(origen.indexOf('AS $function$') + 'AS $function$'.length, origen.lastIndexOf('end $function$'))).toBe(cuerpo0220)
    const nueva = definicion(viva[0])
    expect(md5(nueva + '\n')).toBe('2279355e38145dd73f902a03e92e2808')
    const decl = '  v_doc text; v_total numeric; v_estado text; v_validada boolean;\n'
    const ancla = "  if v_rep.nivel = 'repetida' then\n"
    const a2 = nueva.indexOf(ancla) + ancla.length
    const fin = "      return jsonb_build_object('estado', 'pdf_sustituye_foto'"
    const bloque = nueva.slice(a2, nueva.indexOf('    end if;\n', nueva.indexOf(fin)) + '    end if;\n'.length)
    expect(nueva.replace(decl, '').replace(bloque, '')).toBe(origen)
    // Lo que añade: la factura de ESTA cuenta (regla 9); solo un PDF, sobre una foto o nada, con el mismo total, sin asiento validado.
    expect(bloque).toContain('from public.supplier_invoice i where i.id = v_rep.invoice_id and i.account_id = v_in.account_id for update;')
    expect(bloque).toContain("(v_in.mime_type = 'application/pdf' or v_in.file_path ~* '\\.pdf$')")
    expect(bloque).toContain("(v_doc is null or v_doc ~* '\\.(jpe?g|png|webp|heic|heif)$')")
    expect(bloque).toContain("round(v_total, 2) = round(nullif(f->>'total', '')::numeric, 2)")
    expect(bloque).toContain("e.source_id = i.id and e.status = 'validado')")
    expect(bloque).toContain('delete from public.conta_recibida_pdf r where r.invoice_id = v_rep.invoice_id;')
    expect(bloque).toContain("'antes', v_doc, 'ahora', v_in.file_path")
    expect(bloque).not.toMatch(/insert into public\.supplier_invoice \(/)
  })
  it('la 0800 no toca filas fuera de la función', () => {
    const t = readFileSync(viva[0], 'utf8').replace(/--.*$/gm, '').replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, '$$$$')
    expect(t).not.toMatch(/\b(insert\s+into|update\s+public\.|delete\s+from|truncate)/i)
  })
  it('la 0810 solo toca RIDERS de Foodint, anclado por cuenta e id, y para si no es él o ya tiene otra forma', () => {
    const d = readFileSync(viva[1], 'utf8')
    expect(d).toContain("v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710'")
    expect(d).toContain("v_prov constant uuid := 'cbe3ddb1-5d3a-4aa7-a907-38f362e922b1'")
    expect(d).toMatch(/if not exists \(select 1 from public\.accounts where id = v_acc\) then/)
    const sin = d.replace(/--.*$/gm, '')
    expect(sin.match(/\bupdate\s+public\./gi)).toHaveLength(1)
    expect(sin).toContain("update public.supplier set payment_method = 'prepaid' where account_id = v_acc and id = v_prov and payment_method is null;")
    expect(sin).toContain("if v_s.name is distinct from 'RIDERS' then")
    expect(sin).toContain('if v_n <> 1 then')
    expect(sin).not.toMatch(/updated_at/)
    expect(readFileSync(DOWN_DATOS, 'utf8')).toContain("and payment_method = 'prepaid';")
  })
  it('declara qué cuenta; la cuenta solo lee y va por Foodint', () => {
    const cuentas = readFileSync(MANIFIESTO, 'utf8').split('\n').filter((l) => l.startsWith('cuenta:')).map((l) => l.replace(/^cuenta:\s*/, '').trim())
    expect(cuentas).toEqual(['scripts/conta/produccion/cuentas/d06-prepago-y-pdf.sql'])
    const c = readFileSync(cuentas[0], 'utf8')
    expect(c.replace(/--.*$/gm, '').replace(/'(?:[^']|'')*'/g, "''")).not.toMatch(/\b(insert|update|delete|create|drop|alter|grant|perform)\b/i)
    expect(c).toContain("'51ad1792-6629-4ef7-833a-b57b09a86710'")
  })
  it('su vuelta atrás, en orden inverso', () => {
    expect(leerTanda('tests/conta/produccion/vuelta-atras-d06-prepago-y-pdf-20261023.txt')).toEqual([DOWN_DATOS, DOWN])
  })
})

describe('la tanda del D03 · la recibida sin recepción nace con su documento, y «Guardar cambios» de su ficha (0770, 0780 y 0790, aplicada; su copia)', () => {
  const MANIFIESTO = 'tests/conta/produccion/tanda-d03-recibida-pdf-20261023.txt'
  const viva = leerTanda(MANIFIESTO)
  // La respuesta REAL de la consulta de contexto del workflow, lanzada en solo
  // lectura en producción el 23/10 a las 06:19 UTC, con la 0480 ya aplicada, para ESTOS ficheros.
  const medida = JSON.parse(readFileSync('tests/conta/produccion/contexto-produccion-d03-recibida-pdf-20261023.json', 'utf8'))
  const ctx = medida.contexto
  const leer = (r: string) => { try { return readFileSync(r, 'utf8') } catch { return null } }
  const r = informe(viva, ctx, {}, leer) as { markdown: string; ficheros: Record<string, string> }
  const md5 = (x: string) => createHash('md5').update(x).digest('hex')
  const nombre = (f: string) => f.replace(/^.*\//, '')
  const FN = '_compras_factura_desde_papel'
  const GUARDAR_DOWN = 'supabase/vuelta-atras/20261206T0790_d03_recibida_guardar.down.sql'
  const GUARDAR_PRUEBA = 'supabase/staging/sql/20261206_d03_recibida_guardar_prueba.sql'
  const PRUEBA = 'supabase/staging/sql/20261206_d03_recibida_pdf_prueba.sql'
  const DOWN = 'supabase/vuelta-atras/20261206T0770_d03_recibida_pdf_sin_recepcion.down.sql'
  const DOWN_DATOS = 'supabase/vuelta-atras/20261206T0780_d03_recibida_pdf_datos.down.sql'
  /** La definición entera, como la devuelve pg_get_functiondef (sin su salto final). */
  const definicion = (f: string) => {
    const s = readFileSync(f, 'utf8')
    const a = s.indexOf(`CREATE OR REPLACE FUNCTION public.${FN}(`)
    const b = s.indexOf('$function$', s.indexOf('AS $function$', a) + 'AS $function$'.length)
    return s.slice(a, b + '$function$'.length)
  }

  it('tres ficheros, los medidos; la 0770 y la 0790 siguen y solo la 0780 (datos de Foodint) pide «autorizo»; nada del camino del pedido; nada registrado aún', () => {
    expect(viva.map(nombre)).toEqual(['20261206T0770_d03_recibida_pdf_sin_recepcion.sql', '20261206T0780_d03_recibida_pdf_datos.sql', '20261206T0790_d03_recibida_guardar.sql'])
    expect(Object.keys(medida.tanda)).toEqual(viva)
    for (const f of viva) expect(md5(readFileSync(f, 'utf8')), f).toBe(medida.tanda[f])
    expect(r.ficheros[viva[0]]).toBe('sigue')
    expect(r.ficheros[viva[1]]).toMatch(/autorizo/i)
    expect(r.ficheros[viva[2]]).toBe('sigue')
    expect(ctx.tablas).toEqual(['public.supplier_invoice'])
    expect(ctx.funciones).toEqual([`public.${FN}(uuid,uuid,uuid,uuid,uuid,uuid,text)`])
    expect(ctx.otras).toEqual({})
    expect(ctx.camino).toEqual({ tablas: [], funciones: [] })
    expect(ctx.registro).toEqual([])
  })
  it('el cambio va declarado en la cabecera, con su prueba de staging, que entra como usuario, ejecuta la 0780 y las dos vueltas atrás, y acaba en ROLLBACK', () => {
    const cab = readFileSync(viva[0], 'utf8').split('\n').filter((l) => /^-- cambia:/.test(l))
    expect(cab).toEqual([`-- cambia: public.${FN} · prueba: ${PRUEBA}`])
    expect(readFileSync(viva[1], 'utf8')).not.toMatch(/^-- cambia:/m)
    const p = readFileSync(PRUEBA, 'utf8')
    for (const x of [FN, 'set local role authenticated', `\\i ${viva[0]}`, `\\i ${viva[1]}`, `\\i ${DOWN}`, `\\i ${DOWN_DATOS}`,
      'e0d04afddb7e98ab9cb1b46deccb91e0', 'a8b44ec38a996a24274f984030a13aa7']) expect(p).toContain(x)
    expect(p.trim().endsWith('rollback;')).toBe(true)
    const m = readFileSync('supabase/staging/aplicar.txt', 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    expect(m.indexOf(PRUEBA)).toBeGreaterThan(m.indexOf(viva[0]))
    expect(m).toContain(viva[1])
  })
  it('la función cambia SOLO en el bloque nuevo, y la vuelta atrás la deja como la 0370 (la de producción, md5 e0d04afd…) byte a byte', () => {
    const origen = definicion('supabase/migrations/20261129T0370_textos_sin_papel.sql')
    expect(md5(origen + '\n')).toBe('e0d04afddb7e98ab9cb1b46deccb91e0')
    expect(definicion(DOWN)).toBe(origen)
    const nueva = definicion(viva[0])
    expect(md5(nueva + '\n')).toBe('a8b44ec38a996a24274f984030a13aa7')
    const ancla = '  if p_recepcion is not null then select raw_document_url into v_url from goods_receipt where id = p_recepcion; end if;\n'
    const a = nueva.indexOf(ancla) + ancla.length
    const bloque = nueva.slice(a, nueva.indexOf('  end if;\n', a) + '  end if;\n'.length)
    expect(nueva.replace(bloque, '')).toBe(origen)
    // Lo que añade: solo lee la lectura de ESTA cuenta (regla 9), y solo si no hay documento todavía.
    expect(bloque).toMatch(/^ {2}--[\s\S]*\n {2}if v_url is null then\n/)
    expect(bloque).toContain('where a.id = p_sesion and a.account_id = p_cuenta')
    expect(bloque).toContain("= 'receipt-uploads'")
    expect(bloque.replace(/--.*$/gm, '')).not.toMatch(/\b(insert|update|delete)\b/i)
  })
  it('la 0770 no toca filas: solo reemplaza la función', () => {
    const t = readFileSync(viva[0], 'utf8').replace(/--.*$/gm, '').replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, '$$$$')
    expect(t).not.toMatch(/\b(insert\s+into|update\s+public\.|delete\s+from|truncate|drop\s+|alter\s+table)/i)
  })
  it('la 0780 solo toca las dos de Foodint, ancladas por cuenta, factura y lectura, y para si no son ellas', () => {
    const d = readFileSync(viva[1], 'utf8')
    expect(d).toContain("v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710'")
    expect(d).toContain("array['9a87fa22-fbc7-471b-bf1d-a88c856259ea', 'd6913598-9f52-4d43-8860-eddff2a6d436']::uuid[]")
    expect(d).toContain("array['92c53abd-d369-40e2-9beb-9a05adf5c80c', 'd155b941-2c47-4f1f-bca9-067129cfcd77']::uuid[]")
    expect(d).toMatch(/if not exists \(select 1 from public\.accounts where id = v_acc\) then/)
    const sin = d.replace(/--.*$/gm, '')
    expect(sin.match(/\bupdate\s+public\./gi)).toHaveLength(1)
    expect(sin).toContain('set raw_document_url = a.input_files -> 0 ->> \'path\'\n')
    expect(sin).toMatch(/i\.raw_document_url is null\n\s+and a\.id = m\.lec and a\.account_id = v_acc;/)
    expect(sin).toContain('if v_n <> 2 then')
    expect(sin).not.toMatch(/updated_at|status\s*=/)
    // Su vuelta atrás para si alguna ya tiene asiento o el D02 ya hizo algo con ella.
    const atras = readFileSync(DOWN_DATOS, 'utf8')
    expect(atras).toContain('from public.journal_entry e')
    expect(atras).toContain('from public.conta_recibida_pdf r')
    expect(atras).toMatch(/^-- sin prueba con datos: \S/m)
  })
  it('declara qué cuenta; la cuenta solo lee, va por Foodint y no enseña rutas', () => {
    const cuentas = readFileSync(MANIFIESTO, 'utf8').split('\n').filter((l) => l.startsWith('cuenta:')).map((l) => l.replace(/^cuenta:\s*/, '').trim())
    expect(cuentas).toEqual(['scripts/conta/produccion/cuentas/d03-recibida-pdf.sql'])
    const c = readFileSync(cuentas[0], 'utf8')
    expect(c.replace(/--.*$/gm, '').replace(/'(?:[^']|'')*'/g, "''")).not.toMatch(/\b(insert|update|delete|create|drop|alter|grant|perform)\b/i)
    expect(c).toContain("'51ad1792-6629-4ef7-833a-b57b09a86710'")
    expect(c).toContain("'el de su lectura'")
    expect(c.replace(/--.*$/gm, '')).not.toMatch(/raw_document_url\s+(valor|as)/i)
  })
  it('su vuelta atrás, en orden inverso', () => {
    expect(leerTanda('tests/conta/produccion/vuelta-atras-d03-recibida-pdf-20261023.txt')).toEqual([GUARDAR_DOWN, DOWN_DATOS, DOWN])
  })
  it('la 0790 solo añade: columnas que admiten nulos, dos tablas nuevas y tres funciones nuevas; ninguna función que exista, ninguna fila', () => {
    const t = readFileSync(viva[2], 'utf8')
    expect(t).not.toMatch(/^-- cambia:/m)
    const fuera = t.replace(/--.*$/gm, '').replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, '$$$$')
    expect(fuera).not.toMatch(/\b(insert\s+into|update\s+public\.|delete\s+from|truncate|drop\s+(table|function|column)|set\s+not\s+null|alter\s+column)/i)
    for (const l of fuera.split(';').filter((x) => /alter table public\.supplier_invoice add column/.test(x))) expect(l).not.toMatch(/not\s+null/i)
    const columnas = [...fuera.matchAll(/alter table public\.supplier_invoice add column if not exists (\w+)/g)].map((m) => m[1])
    expect(columnas).toEqual(['payment_method', 'no_document_at', 'no_document_reason', 'no_document_by_name', 'entry_overrides', 'withholding_base'])
    const funciones = [...fuera.matchAll(/create or replace function public\.(\w+)\(/g)].map((m) => m[1])
    expect(funciones).toEqual(['conta_recibida_guardar', 'conta_recibida_papel_poner', 'conta_recibida_sin_papel'])
    expect(ctx.funciones.some((f: string) => /conta_recibida_(guardar|papel_poner|sin_papel)/.test(f))).toBe(false)
    expect(ctx.tablas).not.toContain('public.supplier_invoice_expense')
    expect(ctx.tablas).not.toContain('public.supplier_invoice_change')
    // Las dos tablas, solo de lectura con la sesión; escriben las funciones.
    for (const tb of ['supplier_invoice_expense', 'supplier_invoice_change']) {
      expect(t).toContain(`revoke all on table public.${tb} from public, anon, authenticated;`)
      expect(t).toContain(`grant select on table public.${tb} to authenticated;`)
      expect(t).toMatch(new RegExp(`create policy ${tb}_leer on public\\.${tb} for select to authenticated\\s+using \\(public\\.belongs_to_account\\(account_id\\)\\);`))
    }
  })
  it('conta_recibida_guardar: sus diez claves, la cuenta de la factura, no con su asiento validado, quita el propuesto sin descartarlo, y el vencimiento por set_supplier_invoice_due_date', () => {
    const t = readFileSync(viva[2], 'utf8')
    const a = t.indexOf('create or replace function public.conta_recibida_guardar(')
    const g = t.slice(a, t.indexOf('end $$;', a))
    expect(g).toContain("v_claves constant text[] := array['proveedor', 'numero', 'fecha', 'local', 'vence', 'forma_pago', 'iva', 'retencion', 'gasto', 'asiento_a_mano'];")
    expect(g).toContain("if v_f.id is null or not public.belongs_to_account(v_f.account_id) then")
    expect(g).toMatch(/e\.source_id = v_f\.id and e\.status = 'validado'\) then\n\s+raise exception 'Ya está contabilizada: para cambiarla, anula su asiento\.'/)
    expect(g).toContain("and e.source_id = v_f.id and e.status in ('propuesto', 'borrador');")
    expect(g).not.toMatch(/journal_dismissal|journal_entry_descartar/)
    expect(g).toContain('perform public.set_supplier_invoice_due_date(v_f.id, v_vence);')
    expect(g).toContain("where a.company_id = v_n.company_id and a.code = g ->> 'cuenta' and a.status <> 'cerrada'")
    expect(g).toContain("insert into public.supplier_invoice_change (account_id, supplier_invoice_id, by_name, what, cambios)")
  })
  it('poner su documento reinicia su fila del D02; la prueba de staging entra como usuario y como B, y ejecuta la 0790 y su vuelta atrás; la vuelta atrás para si ya se guardó algo', () => {
    const t = readFileSync(viva[2], 'utf8')
    expect(t).toContain('delete from public.conta_recibida_pdf r where r.invoice_id = v_f.id;')
    expect(t).toContain("left(v_ruta, 37) <> v_f.account_id::text || '/'")
    expect(t).toMatch(/^-- sin hueco: \S/m)
    const p = readFileSync(GUARDAR_PRUEBA, 'utf8')
    for (const x of ['set local role authenticated', 'c01a0000-0001-4000-8000-0000000000a1', `\\i ${viva[2]}`, `\\i ${GUARDAR_DOWN}`, 'Ya está contabilizada']) expect(p).toContain(x)
    expect(p.trim().endsWith('rollback;')).toBe(true)
    const m = readFileSync('supabase/staging/aplicar.txt', 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    expect(m.indexOf(GUARDAR_PRUEBA)).toBeGreaterThan(m.indexOf(viva[2]))
    const d = readFileSync(GUARDAR_DOWN, 'utf8')
    expect(d).toMatch(/raise exception 'D03 0790 \(vuelta atrás\): ya hay/)
    expect(d.indexOf('raise exception')).toBeLessThan(d.indexOf('drop function'))
  })
})

describe('la tanda del S02 · PR 3 · las cifras (0490, aplicada; su copia)', () => {
  const MANIFIESTO = 'tests/conta/produccion/tanda-s02-cifras-20261023.txt'
  const viva = leerTanda(MANIFIESTO)
  // La respuesta REAL de la consulta de contexto del workflow, lanzada en solo
  // lectura en producción el 22/10 a las 22:29 UTC, con la 0480 ya aplicada, para ESTE fichero.
  const medida = JSON.parse(readFileSync('tests/conta/produccion/contexto-produccion-s02-cifras-20261023.json', 'utf8'))
  const ctx = medida.contexto
  const leer = (r: string) => { try { return readFileSync(r, 'utf8') } catch { return null } }
  const r = informe(viva, ctx, {}, leer) as { markdown: string; ficheros: Record<string, string> }
  const md5 = (x: string) => createHash('md5').update(x).digest('hex')
  const nombre = (f: string) => f.replace(/^.*\//, '')
  const PRUEBA = 'supabase/staging/sql/20261205_s02_cifras_prueba.sql'
  const DOWN = 'supabase/vuelta-atras/20261205T0490_s02_cifras.down.sql'
  const NUEVAS = ['conta_pendientes', 'conta_saldo_bancos', 'conta_saldos_terceros']
  const cuerpo = (t: string, fn: string) => { const a = t.indexOf(`create or replace function public.${fn}`); return t.slice(a, t.indexOf('end $$;', a) + 'end $$;'.length) }
  // El cuerpo entre $$ (lo que es prosrc en la base).
  const prosrc = (t: string, fn: string) => { const c = cuerpo(t, fn); return c.slice(c.indexOf('$$') + 2, c.length - '$$;'.length) }

  it('un fichero, el medido; sigue sin «autorizo»; de lo que toca solo existe el calendario; nada del camino del pedido; nada registrado aún', () => {
    expect(viva.map(nombre)).toEqual(['20261205T0490_s02_cifras.sql'])
    expect(Object.keys(medida.tanda)).toEqual(viva)
    for (const f of viva) expect(md5(readFileSync(f, 'utf8')), f).toBe(medida.tanda[f])
    expect(viva.map((f) => r.ficheros[f])).toEqual(['sigue'])
    expect(ctx.tablas).toEqual([])
    expect(ctx.funciones).toEqual(['public.conta_impuesto_calendario(uuid,date)'])
    expect(ctx.otras).toEqual({})
    expect(ctx.camino).toEqual({ tablas: [], funciones: [] })
    expect(ctx.registro).toEqual([])
  })
  it('el cambio va declarado en la cabecera, con su prueba de staging, que entra como usuario de A, mira que B no ve nada y ejecuta la vuelta atrás', () => {
    const cab = readFileSync(viva[0], 'utf8').split('\n').filter((l) => /^-- cambia:/.test(l))
    expect(cab).toEqual([`-- cambia: public.conta_impuesto_calendario · prueba: ${PRUEBA}`])
    const p = readFileSync(PRUEBA, 'utf8')
    for (const x of [...NUEVAS, 'conta_impuesto_calendario', 'set local role authenticated', 'c01b0000-0000-4000-8000-0000000000b1', 'set local role anon',
      'insufficient_privilege', 'rollback;', `\\i ${DOWN}`, `\\i ${viva[0]}`, '480da33a07e1885441de585237156d3e', '51ad1792-6629-4ef7-833a-b57b09a86710']) expect(p).toContain(x)
    const m = readFileSync('supabase/staging/aplicar.txt', 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    expect(m.indexOf(PRUEBA)).toBeGreaterThan(m.indexOf(viva[0]))
  })
  it('el calendario cambia SOLO en la ventana (salta lo que no hace falta) y en que eso que no hace falta sigue en las filas, y la vuelta atrás lo deja como en la 0340 (el de producción, md5 del cuerpo medido)', () => {
    const nueva = readFileSync(viva[0], 'utf8'), antes = readFileSync(DOWN, 'utf8'), origen = readFileSync('supabase/migrations/20261128T0340_i01h_sociedades_202.sql', 'utf8')
    const fn = 'conta_impuesto_calendario'
    expect(cuerpo(antes, fn)).toBe(cuerpo(origen, fn))
    expect(md5(prosrc(antes, fn))).toBe('480da33a07e1885441de585237156d3e')
    const ventana = / {2}-- La ventana:[\s\S]*?into v_ventana[\s\S]*?;\n/
    // Y una condición más en las filas: lo que no hace falta y vence antes de la ventana sigue saliendo (regla 7).
    const noHaceFalta = /\n {6}-- S02 · PR 3 \(0490\)[\s\S]*?\n {6}or \(d\.presentacion >= v_hoy and d\.status = 'not_required' and \(v_ventana is null or d\.presentacion < v_ventana\)\)/
    expect(cuerpo(nueva, fn)).toMatch(noHaceFalta)
    expect(cuerpo(nueva, fn).replace(ventana, '').replace(noHaceFalta, '')).toBe(cuerpo(origen, fn).replace(ventana, ''))
    expect(cuerpo(nueva, fn).match(ventana)?.[0]).toContain("coalesce(r.status, 'pending') <> 'not_required'")
  })
  it('las tres nuevas solo leen, comprueban la empresa (42501) y solo las llama quien tiene sesión', () => {
    const t = readFileSync(viva[0], 'utf8')
    for (const fn of NUEVAS) {
      const c = cuerpo(t, fn)
      expect(c, fn).toMatch(/ stable /)
      expect(c, fn).not.toMatch(/security definer/)
      expect(c, fn).toContain("if v_acc is null or not public.belongs_to_account(v_acc) then\n    raise exception 'Esa empresa no es tuya.' using errcode = '42501';")
      expect(c.replace(/--.*$/gm, ''), fn).not.toMatch(/\b(insert\s+into|update\s+public\.|delete\s+from|perform\s+public\.(?!belongs))/i)
    }
    const permisos = t.split('\n').filter((l) => /^(grant|revoke)\b/.test(l))
    expect(permisos).toEqual([
      'revoke all on function public.conta_pendientes(uuid) from public, anon;',
      'revoke all on function public.conta_saldo_bancos(uuid, date) from public, anon;',
      'revoke all on function public.conta_saldos_terceros(uuid, date) from public, anon;',
      'grant execute on function public.conta_pendientes(uuid) to authenticated, service_role;',
      'grant execute on function public.conta_saldo_bancos(uuid, date) to authenticated, service_role;',
      'grant execute on function public.conta_saldos_terceros(uuid, date) to authenticated, service_role;',
    ])
  })
  it('conta_pendientes devuelve exactamente sus ocho claves, y los movimientos y asientos con account_id y company_id (regla 9)', () => {
    const c = cuerpo(readFileSync(viva[0], 'utf8'), 'conta_pendientes')
    const ret = c.slice(c.indexOf('return jsonb_build_object('))
    expect([...ret.matchAll(/'([a-z_]+)', /g)].map((m) => m[1])).toEqual(['compras_decidir', 'compras_filas', 'facturas_para_mirar', 'facturas_por_aclarar',
      'asientos_por_validar', 'bancos_confirmar', 'bancos_aclarar', 'bancos_validar'])
    expect(c.match(/m\.account_id = v_acc and m\.company_id = p_company/g)).toHaveLength(2)
    expect(c).toContain('e.account_id = v_acc and e.company_id = p_company')
    // La misma vara que la pantalla: las bandejas de lib/conciliarVista y lo que se decide en su sitio de lib/diario.
    expect(c).toContain("m.status in ('por_aclarar', 'pendiente', 'posible_repetido')")
    expect(c).toContain("not (e.status = 'propuesto' and e.source_type in ('supplier_invoice', 'bank'))")
  })
  it('no toca filas: solo crea y reemplaza funciones', () => {
    const t = readFileSync(viva[0], 'utf8').replace(/--.*$/gm, '').replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, '$$$$')
    expect(t).not.toMatch(/\b(insert\s+into|update\s+public\.|delete\s+from|truncate|drop\s+|alter\s+table)/i)
  })
  it('la vuelta atrás para si otra función las llama, y quita las tres', () => {
    const d = readFileSync(DOWN, 'utf8')
    expect(d).toContain("raise exception 'S02 0490 vuelta atrás: % llama(n) a las funciones de las cifras y se quedarían rotas. No se toca nada.'")
    expect(d.split('\n').filter((l) => l.startsWith('drop function'))).toEqual([
      'drop function if exists public.conta_saldos_terceros(uuid, date);',
      'drop function if exists public.conta_saldo_bancos(uuid, date);',
      'drop function if exists public.conta_pendientes(uuid);',
    ])
  })
  it('declara qué cuenta; la cuenta solo lee y es de Foodint', () => {
    const cuentas = readFileSync(MANIFIESTO, 'utf8').split('\n').filter((l) => l.startsWith('cuenta:')).map((l) => l.replace(/^cuenta:\s*/, '').trim())
    expect(cuentas).toEqual(['scripts/conta/produccion/cuentas/s02-cifras.sql'])
    const c = readFileSync(cuentas[0], 'utf8')
    expect(c.replace(/--.*$/gm, '').replace(/'(?:[^']|'')*'/g, "''")).not.toMatch(/\b(insert|update|delete|create|drop|alter|grant|perform)\b/i)
    expect(c).toContain("'51ad1792-6629-4ef7-833a-b57b09a86710'")
  })
  it('su vuelta atrás', () => {
    expect(leerTanda('tests/conta/produccion/vuelta-atras-s02-cifras-20261023.txt')).toEqual([DOWN])
  })
})

describe('la tanda del E05 · volver a leer los PDF de Catcher (0480, aplicada; su copia)', () => {
  const MANIFIESTO = 'tests/conta/produccion/tanda-e05-releer-riders-20261022.txt'
  const viva = leerTanda(MANIFIESTO)
  // La respuesta REAL de la consulta de contexto del workflow, lanzada en solo
  // lectura en producción el 22/10 a las 19:54 UTC, con la 0470 ya aplicada, para ESTE fichero.
  const medida = JSON.parse(readFileSync('tests/conta/produccion/contexto-produccion-e05-releer-riders-20261022.json', 'utf8'))
  const ctx = medida.contexto
  const leer = (r: string) => { try { return readFileSync(r, 'utf8') } catch { return null } }
  const r = informe(viva, ctx, {}, leer) as { markdown: string; ficheros: Record<string, string> }
  const md5 = (x: string) => createHash('md5').update(x).digest('hex')
  const nombre = (f: string) => f.replace(/^.*\//, '')
  const PRUEBA = 'supabase/staging/sql/20261204_e05_releer_riders_prueba.sql'
  const DOWN = 'supabase/vuelta-atras/20261204T0480_e05_releer_riders.down.sql'
  const cuerpo = (t: string, fn: string) => { const a = t.indexOf(`create or replace function public.${fn}`); return t.slice(a, t.indexOf('end $$;', a)) }

  it('un fichero, el medido; sigue sin «autorizo»; de lo que toca solo existen las dos de cruzar; nada del camino del pedido; nada registrado aún', () => {
    expect(viva.map(nombre)).toEqual(['20261204T0480_e05_releer_riders.sql'])
    expect(Object.keys(medida.tanda)).toEqual(viva)
    for (const f of viva) expect(md5(readFileSync(f, 'utf8')), f).toBe(medida.tanda[f])
    expect(viva.map((f) => r.ficheros[f])).toEqual(['sigue'])
    expect(ctx.tablas).toEqual([])
    expect(ctx.funciones).toEqual(['public.conta_lote_cruce_guardar(uuid,jsonb,text)', 'public.conta_lote_pedidos_app(uuid)'])
    expect(ctx.otras).toEqual({})
    expect(ctx.camino).toEqual({ tablas: [], funciones: [] })
    expect(ctx.registro).toEqual([])
  })
  it('los dos cambios van declarados en la cabecera, con su prueba de staging, que entra como usuario y como servidor y ejecuta la vuelta atrás', () => {
    const cab = readFileSync(viva[0], 'utf8').split('\n').filter((l) => /^-- cambia:/.test(l))
    expect(cab).toEqual([`-- cambia: public.conta_lote_pedidos_app · prueba: ${PRUEBA}`, `-- cambia: public.conta_lote_cruce_guardar · prueba: ${PRUEBA}`])
    const p = readFileSync(PRUEBA, 'utf8')
    for (const x of ['conta_lote_cruce_guardar', 'conta_lote_pedidos_app', 'set local role authenticated', 'set local role service_role', 'rollback;', `\\i ${DOWN}`, '7586a749f6203ca8fc947ab4c6449d64', '79a57d0b9e3a3dca21197c224bdde093']) expect(p).toContain(x)
    const m = readFileSync('supabase/staging/aplicar.txt', 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    expect(m.indexOf(PRUEBA)).toBeGreaterThan(m.indexOf(viva[0]))
  })
  it('cada función cambia SOLO en sus comprobaciones de quién llama, y la vuelta atrás las deja como en la 0120 (las de producción)', () => {
    const nueva = readFileSync(viva[0], 'utf8'), antes = readFileSync(DOWN, 'utf8'), origen = readFileSync('supabase/migrations/20261112T0120_e05_cruces.sql', 'utf8')
    for (const [fn, n] of [['conta_lote_pedidos_app', 1], ['conta_lote_cruce_guardar', 2]] as const) {
      expect(cuerpo(antes, fn), fn).toBe(cuerpo(origen, fn))
      const sin = cuerpo(nueva, fn).replaceAll(" or auth.role() = 'service_role')", '').replaceAll('not (public.', 'not public.')
      expect(sin, fn).toBe(cuerpo(origen, fn))
      expect(cuerpo(nueva, fn).match(/auth\.role\(\) = 'service_role'/g), fn).toHaveLength(n)
    }
  })
  it('no toca filas: solo crea y reemplaza; lo que escribe va dentro de las funciones', () => {
    const t = readFileSync(viva[0], 'utf8').replace(/--.*$/gm, '').replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, '$$$$')
    expect(t).not.toMatch(/\b(insert\s+into|update\s+public\.|delete\s+from|truncate|drop\s+table|alter\s+table\s+public\.(?!conta_lote_relectura))/i)
  })
  it('guardar la lectura no toca lo que ya decidió una persona', () => {
    const g = cuerpo(readFileSync(viva[0], 'utf8'), 'conta_lote_relectura_guardar')
    expect(g).toContain("if v_f.status <> 'en_revision' then v_sin := v_sin + 1; continue; end if;")
    expect(g).not.toMatch(/supplier_batch_issue/)
  })
  it('declara qué cuenta; la cuenta solo lee y es de Foodint', () => {
    const cuentas = readFileSync(MANIFIESTO, 'utf8').split('\n').filter((l) => l.startsWith('cuenta:')).map((l) => l.replace(/^cuenta:\s*/, '').trim())
    expect(cuentas).toEqual(['scripts/conta/produccion/cuentas/e05-releer.sql'])
    const c = readFileSync(cuentas[0], 'utf8')
    expect(c.replace(/--.*$/gm, '').replace(/'(?:[^']|'')*'/g, "''")).not.toMatch(/\b(insert|update|delete|create|drop|alter|grant|perform)\b/i)
    expect(c).toContain("'51ad1792-6629-4ef7-833a-b57b09a86710'")
  })
  it('su vuelta atrás', () => {
    expect(leerTanda('tests/conta/produccion/vuelta-atras-e05-releer-riders-20261022.txt')).toEqual([DOWN])
  })
})

describe('la tanda del D02 · el PDF de las recibidas (0470, aplicada; su copia)', () => {
  const MANIFIESTO = 'tests/conta/produccion/tanda-d02-recibida-pdf-20261022.txt'
  const viva = leerTanda(MANIFIESTO)
  // La respuesta REAL de la consulta de contexto del workflow, lanzada en solo
  // lectura en producción el 22/10 a las 17:17 UTC, con la 0460 ya aplicada, para ESTE fichero.
  const medida = JSON.parse(readFileSync('tests/conta/produccion/contexto-produccion-d02-recibida-pdf-20261022.json', 'utf8'))
  const ctx = medida.contexto
  const leer = (r: string) => { try { return readFileSync(r, 'utf8') } catch { return null } }
  const r = informe(viva, ctx, {}, leer) as { markdown: string; ficheros: Record<string, string> }
  const md5 = (x: string) => createHash('md5').update(x).digest('hex')
  const nombre = (f: string) => f.replace(/^.*\//, '')
  const PRUEBA = 'supabase/staging/sql/20261203_d02_recibida_pdf_prueba.sql'
  const DOWN = 'supabase/vuelta-atras/20261203T0470_d02_recibida_pdf.down.sql'
  const GUARDAR = 'public.conta_documento_factura_guardar(uuid,text,text,text,integer,text)'
  const cuerpo = (t: string) => t.slice(t.indexOf('create or replace function public.conta_documento_factura_guardar')).split('$function$')[1]

  it('un fichero, el medido; sigue sin «autorizo»; de lo que toca solo existe la función de guardar el documento; nada del camino del pedido; nada registrado aún', () => {
    expect(viva.map(nombre)).toEqual(['20261203T0470_d02_recibida_pdf.sql'])
    expect(Object.keys(medida.tanda)).toEqual(viva)
    for (const f of viva) expect(md5(readFileSync(f, 'utf8')), f).toBe(medida.tanda[f])
    expect(viva.map((f) => r.ficheros[f])).toEqual(['sigue'])
    expect(ctx.tablas).toEqual([])
    expect(ctx.funciones).toEqual([GUARDAR])
    expect(ctx.otras).toEqual({})
    expect(ctx.camino).toEqual({ tablas: [], funciones: [] })
    expect(ctx.registro).toEqual([])
  })
  it('el cambio de la función va declarado en la cabecera, con su prueba de staging, que entra como usuario y como servidor y ejecuta la vuelta atrás', () => {
    const cab = readFileSync(viva[0], 'utf8').split('\n').filter((l) => /^-- cambia:/.test(l))
    expect(cab).toEqual([`-- cambia: public.conta_documento_factura_guardar · prueba: ${PRUEBA}`])
    const p = readFileSync(PRUEBA, 'utf8')
    for (const x of ['conta_documento_factura_guardar', 'set local role authenticated', 'set local role service_role', 'rollback;', `\\i ${DOWN}`, 'dbc3443e216fe2a6b5131f40d2d04240']) expect(p).toContain(x)
    const m = readFileSync('supabase/staging/aplicar.txt', 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    expect(m.indexOf(PRUEBA)).toBeGreaterThan(m.indexOf(viva[0]))
  })
  it('la función cambia SOLO en sus dos comprobaciones de quién llama, y la vuelta atrás la deja como estaba', () => {
    const nueva = cuerpo(readFileSync(viva[0], 'utf8'))
    const antes = cuerpo(readFileSync(DOWN, 'utf8'))
    expect(nueva.replaceAll(" or auth.role() = 'service_role')", '').replace('not (public.belongs_to_account(v_e.account_id)', 'not public.belongs_to_account(v_e.account_id)')
      .replace('if not (public.current_user_is_admin_or_manager_of(v_e.account_id)', 'if not public.current_user_is_admin_or_manager_of(v_e.account_id)')).toBe(antes)
    expect(nueva.match(/auth\.role\(\) = 'service_role'/g)).toHaveLength(2)
  })
  it('no toca filas: solo crea y reemplaza; lo que escribe va dentro de las funciones', () => {
    const t = readFileSync(viva[0], 'utf8').replace(/--.*$/gm, '').replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, '$$$$')
    expect(t).not.toMatch(/\b(insert\s+into|update\s+public\.|delete\s+from|truncate|drop\s+table|alter\s+table\s+public\.(?!conta_recibida_pdf))/i)
  })
  it('declara qué cuenta; la cuenta solo lee y es de Foodint', () => {
    const cuentas = readFileSync(MANIFIESTO, 'utf8').split('\n').filter((l) => l.startsWith('cuenta:')).map((l) => l.replace(/^cuenta:\s*/, '').trim())
    expect(cuentas).toEqual(['scripts/conta/produccion/cuentas/d02-recibida-pdf.sql'])
    const c = readFileSync(cuentas[0], 'utf8')
    expect(c.replace(/--.*$/gm, '').replace(/'(?:[^']|'')*'/g, "''")).not.toMatch(/\b(insert|update|delete|create|drop|alter|grant|perform)\b/i)
    expect(c).toContain("'51ad1792-6629-4ef7-833a-b57b09a86710'")
  })
  it('su vuelta atrás', () => {
    expect(leerTanda('tests/conta/produccion/vuelta-atras-d02-recibida-pdf-20261022.txt')).toEqual([DOWN])
  })
})

describe('la tanda del S02 · el color de la empresa (0460, aplicada; su copia)', () => {
  const MANIFIESTO = 'tests/conta/produccion/tanda-s02-color-empresa-20261022.txt'
  const viva = leerTanda(MANIFIESTO)
  // La respuesta REAL de la consulta de contexto del workflow, lanzada en solo
  // lectura en producción el 22/10 (se vuelve a medir con el número nuevo), para ESTE fichero.
  const medida = JSON.parse(readFileSync('tests/conta/produccion/contexto-produccion-s02-color-empresa-20261022.json', 'utf8'))
  const ctx = medida.contexto
  const leer = (r: string) => { try { return readFileSync(r, 'utf8') } catch { return null } }
  const r = informe(viva, ctx, {}, leer) as { markdown: string; ficheros: Record<string, string> }
  const md5 = (x: string) => createHash('md5').update(x).digest('hex')
  const nombre = (f: string) => f.replace(/^.*\//, '')
  const PRUEBA = 'supabase/staging/sql/20261202_s02_color_empresa_prueba.sql'
  const DOWN = 'supabase/vuelta-atras/20261202T0460_s02_color_empresa.down.sql'

  it('un fichero, el medido; sigue sin «autorizo»; company existe y no es del camino del pedido; nada registrado aún', () => {
    expect(viva.map(nombre)).toEqual(['20261202T0460_s02_color_empresa.sql'])
    expect(Object.keys(medida.tanda)).toEqual(viva)
    for (const f of viva) expect(md5(readFileSync(f, 'utf8')), f).toBe(medida.tanda[f])
    expect(viva.map((f) => r.ficheros[f])).toEqual(['sigue'])
    expect(ctx.tablas).toEqual(['public.company'])
    expect(ctx.funciones).toEqual([])
    expect(ctx.camino).toEqual({ tablas: [], funciones: [] })
    expect(ctx.registro).toEqual([])
  })
  it('la comprobación nueva sobre company va declarada en la cabecera, con su prueba de staging, que entra como usuario y ejecuta la vuelta atrás', () => {
    const cab = readFileSync(viva[0], 'utf8').split('\n').filter((l) => /^-- cambia:/.test(l))
    expect(cab).toEqual([`-- cambia: public.company · prueba: ${PRUEBA}`])
    const p = readFileSync(PRUEBA, 'utf8')
    for (const x of ['company', 'company_color_formato', 'set local role authenticated', 'rollback;', `\\i ${DOWN}`]) expect(p).toContain(x)
    const m = readFileSync('supabase/staging/aplicar.txt', 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    expect(m.indexOf(PRUEBA)).toBeGreaterThan(m.indexOf(viva[0]))
  })
  it('solo añade: una columna que admite nulos y su CHECK; ni filas ni funciones', () => {
    const t = readFileSync(viva[0], 'utf8').replace(/--.*$/gm, '')
    expect(t).toMatch(/alter table public\.company add column if not exists color text;/)
    expect(t).toMatch(/check \(color is null or color ~ '\^#\[0-9A-Fa-f\]\{6\}\$'\)/)
    expect(t).not.toMatch(/\b(insert\s+into|update\s+public\.|delete\s+from|drop\s|truncate|not null|function)\b/i)
  })
  it('declara qué cuenta; la cuenta solo lee', () => {
    const cuentas = readFileSync(MANIFIESTO, 'utf8').split('\n').filter((l) => l.startsWith('cuenta:')).map((l) => l.replace(/^cuenta:\s*/, '').trim())
    expect(cuentas).toEqual(['scripts/conta/produccion/cuentas/color-empresa.sql'])
    const c = readFileSync(cuentas[0], 'utf8')
    expect(c.replace(/--.*$/gm, '').replace(/'(?:[^']|'')*'/g, "''")).not.toMatch(/\b(insert|update|delete|create|drop|alter|grant|perform)\b/i)
  })
  it('su vuelta atrás', () => {
    expect(leerTanda('tests/conta/produccion/vuelta-atras-s02-color-empresa-20261022.txt')).toEqual([DOWN])
  })
})


describe('la tanda de I01d · los impuestos de 2025 (0420, PR #281), ya aplicada: su copia y su contexto medido', () => {
  const MANIFIESTO = 'tests/conta/produccion/tanda-i01d-impuestos-2025-20261022.txt'
  const viva = leerTanda(MANIFIESTO)
  // La respuesta REAL de la consulta de contexto del workflow, lanzada en solo
  // lectura en producción el 22/10 a las 00:15 UTC, después de la 0380–0410 (aplicadas), para ESTE fichero.
  const medida = JSON.parse(readFileSync('tests/conta/produccion/contexto-produccion-i01d-impuestos-2025-20261022.json', 'utf8'))
  const ctx = medida.contexto
  const leer = (r: string) => { try { return readFileSync(r, 'utf8') } catch { return null } }
  const r = informe(viva, ctx, {}, leer) as { markdown: string; ficheros: Record<string, string> }
  const md5 = (x: string) => createHash('md5').update(x).digest('hex')
  const nombre = (f: string) => f.replace(/^.*\//, '')
  const PRUEBA = 'supabase/staging/sql/20261130_i01d_impuestos_2025_prueba.sql'
  const DOWN = 'supabase/vuelta-atras/20261130T0420_i01d_impuestos_2025.down.sql'
  const ORIGEN = 'supabase/migrations/20261122T0280_i01c_trimestre.sql'
  const cuerpo = (t: string) => t.slice(t.indexOf('create or replace function public.conta_impuesto_trimestre')).split('$$')[1]

  it('un fichero, el medido; sigue sin «autorizo»; la función existe y no tiene hermanas; nada del camino del pedido; nada registrado aún', () => {
    expect(viva.map(nombre)).toEqual(['20261130T0420_i01d_impuestos_2025.sql'])
    expect(Object.keys(medida.tanda)).toEqual(viva)
    for (const f of viva) expect(md5(readFileSync(f, 'utf8')), f).toBe(medida.tanda[f])
    expect(viva.map((f) => r.ficheros[f])).toEqual(['sigue'])
    expect(ctx.tablas).toEqual([])
    expect(ctx.funciones).toEqual(['public.conta_impuesto_trimestre(uuid,int,int)'])
    expect(ctx.otras).toEqual({})
    expect(ctx.camino).toEqual({ tablas: [], funciones: [] })
    expect(ctx.registro).toEqual([])
  })
  it('lo que cambia en caliente está en la cabecera, con su prueba de staging, y la prueba lo nombra, entra como usuario y ejecuta la vuelta atrás', () => {
    const cab = readFileSync(viva[0], 'utf8').split('\n').filter((l) => /^-- cambia:/.test(l))
    expect(cab).toEqual([`-- cambia: public.conta_impuesto_trimestre · prueba: ${PRUEBA}`])
    const p = readFileSync(PRUEBA, 'utf8')
    for (const x of ['conta_impuesto_trimestre', 'conta_impuesto_justificante_apuntar', 'set local role authenticated', 'rollback;', `\\i ${DOWN}`]) expect(p).toContain(x)
    const m = readFileSync('supabase/staging/aplicar.txt', 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    expect(m.indexOf(PRUEBA)).toBeGreaterThan(m.indexOf(viva[0]))
  })
  it('no toca tablas ni filas: solo la función, con la misma firma', () => {
    const t = readFileSync(viva[0], 'utf8').replace(/--.*$/gm, '')
    expect(t.match(/create or replace function public\.(\w+)\(([^)]*)\)/g)).toEqual(['create or replace function public.conta_impuesto_trimestre(p_company uuid, p_year int, p_quarter int)'])
    expect(t).not.toMatch(/\b(insert\s+into|update\s+public\.|delete\s+from|alter\s+table|drop\s|truncate)\b/i)
  })
  it('la vuelta atrás es la de la 0280, byte a byte', () => {
    expect(cuerpo(readFileSync(DOWN, 'utf8'))).toBe(cuerpo(readFileSync(ORIGEN, 'utf8')))
    expect(md5(cuerpo(readFileSync(DOWN, 'utf8')))).toBe('9522728be846f7d8acc8d03a09cabfa5')
  })
  it('lo que cambia del cuerpo: «desde», el 4T antes que el 1T y la [110] del 1T al lado', () => {
    const antes = cuerpo(readFileSync(ORIGEN, 'utf8')).split('\n')
    const ahora = cuerpo(readFileSync(viva[0], 'utf8')).split('\n')
    const nuevas = ahora.filter((l) => !antes.includes(l)).map((l) => l.trim()).filter((l) => l && !l.startsWith('--'))
    expect(nuevas).toEqual([
      'v_inicio numeric; v_inicio_de text; v_110_1t numeric; v_desde date;',
      // Estas dos solo cambian de sangría: el 4T sube de dentro del «if» a primero.
      'where company_id = p_company and form_code = \'303\' and fiscal_year = p_year - 1 and period = \'4T\' and sequence = 1 and status = any (v_hechos);',
      'v_inicio := coalesce((select b.value from public.tax_return_box b where b.tax_return_id = v_ant.id and b.box = \'87\'), 0)',
      '+ case when v_ant.result_kind = \'to_offset\' then v_ant.amount else 0 end;',
      'v_inicio_de := \'4T/\' || (p_year - 1);',
      'v_110_1t := (select b.value from public.tax_return_box b where b.tax_return_id = v_ant.id and b.box = \'110\');',
      'if v_inicio is null and v_110_1t is not null then',
      'v_inicio := v_110_1t;',
      'v_inicio_de := \'1T/\' || p_year;',
      'select min(valid_from) into v_desde from public.tax_obligation where company_id = p_company and valid_to is null and active;',
      '\'ejercicio\', p_year, \'trimestre\', v_q, \'desde\', v_desde,',
      '\'pendiente_al_empezar\', case when v_inicio is null then null else jsonb_build_object(\'importe\', v_inicio, \'de\', v_inicio_de,',
      '\'c110_1t\', case when v_inicio_de like \'4T/%\' then v_110_1t end) end,',
    ])
  })
  it('declara qué cuenta; la cuenta solo lee y va por Foodint', () => {
    const cuentas = readFileSync(MANIFIESTO, 'utf8').split('\n').filter((l) => l.startsWith('cuenta:')).map((l) => l.replace(/^cuenta:\s*/, '').trim())
    expect(cuentas).toEqual(['scripts/conta/produccion/cuentas/impuestos-2025.sql'])
    const c = readFileSync(cuentas[0], 'utf8')
    expect(c.replace(/--.*$/gm, '').replace(/'(?:[^']|'')*'/g, "''")).not.toMatch(/\b(insert|update|delete|create|drop|alter|grant|perform)\b/i)
    expect(c).toContain("'51ad1792-6629-4ef7-833a-b57b09a86710'")
  })
  it('su vuelta atrás', () => {
    expect(leerTanda('tests/conta/produccion/vuelta-atras-i01d-impuestos-2025-20261022.txt')).toEqual([DOWN])
  })
})

describe('la tanda de E05 · la ficha de Catcher (0420), ya aplicada: su copia y su contexto medido', () => {
  const MANIFIESTO = 'tests/conta/produccion/tanda-e05-catcher-ficha-20261021.txt'
  const viva = leerTanda(MANIFIESTO)
  // La respuesta REAL de la consulta de contexto del workflow, lanzada en solo
  // lectura en producción el 21/10 a las 22:37 UTC, después de la 0410, para ESTE fichero.
  const medida = JSON.parse(readFileSync('tests/conta/produccion/contexto-produccion-e05-catcher-ficha-20261021.json', 'utf8'))
  const ctx = medida.contexto
  const leer = (r: string) => { try { return readFileSync(r, 'utf8') } catch { return null } }
  const r = informe(viva, ctx, {}, leer) as { markdown: string; ficheros: Record<string, string> }
  const md5 = (x: string) => createHash('md5').update(x).digest('hex')
  const DOWN = 'supabase/vuelta-atras/20261130T0420_e05_catcher_ficha.down.sql'

  it('un fichero, el medido; pide «autorizo» (cambia un dato); nada del camino del pedido; nada registrado aún', () => {
    expect(viva.map((f) => f.replace(/^.*\//, ''))).toEqual(['20261130T0420_e05_catcher_ficha.sql'])
    expect(Object.keys(medida.tanda)).toEqual(viva)
    expect(md5(readFileSync(viva[0], 'utf8'))).toBe(medida.tanda[viva[0]])
    expect(r.ficheros[viva[0]]).toBe('autorizo')
    expect(ctx.tablas).toEqual(['public.company_account', 'public.company_account_link', 'public.supplier', 'public.supplier_invoice'])
    expect(ctx.funciones).toEqual([])
    expect(ctx.camino).toEqual({ tablas: [], funciones: [] })
    expect(ctx.registro).toEqual([])
  })
  it('solo Foodint, con sus guardas, y la factura por su id y su cuenta', () => {
    const t = readFileSync(viva[0], 'utf8')
    expect(t).toContain("'51ad1792-6629-4ef7-833a-b57b09a86710'")
    expect(t).toContain("'98416803-9f78-411f-a95d-59c334533f05'")
    expect(t).toContain('where id = f and account_id = a and supplier_id is null')
    for (const x of ['ya tiene proveedor', 'ya hay % ficha(s)', 'ya existen', 'no es el medido']) expect(t).toContain(x)
  })
  it('declara qué cuenta; la cuenta solo lee y va por Foodint', () => {
    const cuentas = readFileSync(MANIFIESTO, 'utf8').split('\n').filter((l) => l.startsWith('cuenta:')).map((l) => l.replace(/^cuenta:\s*/, '').trim())
    expect(cuentas).toEqual(['scripts/conta/produccion/cuentas/e05-catcher.sql'])
    const c = readFileSync(cuentas[0], 'utf8')
    expect(c.replace(/--.*$/gm, '').replace(/'(?:[^']|'')*'/g, "''")).not.toMatch(/\b(insert|update|delete|create|drop|alter|grant|perform)\b/i)
    expect(c).toContain("'51ad1792-6629-4ef7-833a-b57b09a86710'")
  })
  it('su vuelta atrás, y la prueba de staging que la ejecuta', () => {
    expect(leerTanda('tests/conta/produccion/vuelta-atras-e05-catcher-ficha-20261021.txt')).toEqual([DOWN])
    const p = readFileSync('supabase/staging/sql/20261130_e05_catcher_ficha_prueba.sql', 'utf8')
    expect(p).toContain(`\\i ${viva[0]}`)
    expect(p).toContain(`\\i ${DOWN}`)
    expect(p.trim().endsWith('rollback;')).toBe(true)
  })
})

describe('la tanda de las facturas de riders (E05, 0410, PR #273), ya aplicada: su copia y su contexto medido', () => {
  const MANIFIESTO = 'tests/conta/produccion/tanda-e05-riders-20261021.txt'
  const viva = leerTanda(MANIFIESTO)
  // La respuesta REAL de la consulta de contexto del workflow, lanzada en solo
  // lectura en producción el 21/10 a las 17:42 UTC, después de la 0350–0370, para ESTE fichero.
  const medida = JSON.parse(readFileSync('tests/conta/produccion/contexto-produccion-e05-riders-20261021.json', 'utf8'))
  const ctx = medida.contexto
  const leer = (r: string) => { try { return readFileSync(r, 'utf8') } catch { return null } }
  const r = informe(viva, ctx, {}, leer) as { markdown: string; ficheros: Record<string, string> }
  const md5 = (x: string) => createHash('md5').update(x).digest('hex')
  const DOWN = 'supabase/vuelta-atras/20261130T0410_e05_riders_ficha_y_libro.down.sql'
  const PRUEBA = 'supabase/staging/sql/20261130_e05_riders_ficha_y_libro_prueba.sql'
  const DOS = ['public.compras_ficha_le_falta(uuid)', 'public.conta_vat_book_desde_asiento(uuid)']

  it('un fichero, el medido; sigue; nada del camino del pedido; las dos funciones existen con una sola firma', () => {
    expect(viva.map((f) => f.replace(/^.*\//, ''))).toEqual(['20261130T0410_e05_riders_ficha_y_libro.sql'])
    expect(Object.keys(medida.tanda)).toEqual(viva)
    expect(md5(readFileSync(viva[0], 'utf8'))).toBe(medida.tanda[viva[0]])
    expect(r.ficheros[viva[0]]).toBe('sigue')
    expect(ctx.funciones).toEqual(DOS)
    expect(ctx.otras).toEqual({})
    expect(ctx.camino).toEqual({ tablas: [], funciones: [] })
    expect(ctx.registro).toEqual([])
  })
  it('lo que cambia en caliente está en la cabecera, con su prueba de staging, que nombra las dos y ejecuta la vuelta atrás', () => {
    const t = readFileSync(viva[0], 'utf8')
    expect(t.split('\n').filter((l) => /^-- cambia:/.test(l))).toEqual([
      `-- cambia: public.compras_ficha_le_falta · prueba: ${PRUEBA}`, `-- cambia: public.conta_vat_book_desde_asiento · prueba: ${PRUEBA}`])
    const prueba = readFileSync(PRUEBA, 'utf8')
    expect(prueba).toContain('compras_ficha_le_falta')
    expect(prueba).toContain('vat_book_entry')
    expect(prueba).toContain(`\\i ${DOWN}`)
    expect(prueba.trim().endsWith('rollback;')).toBe(true)
  })
  it('la vuelta atrás repone los cuerpos de producción del 21/10, y la prueba lo mira por su md5', () => {
    const d = readFileSync(DOWN, 'utf8')
    const cuerpos = [...d.matchAll(/as \$function\$([\s\S]*?)\$function\$;/g)].map((m) => md5(m[1]))
    expect(cuerpos).toEqual(['5dbcedf7f850fdd8643993ea06e25eec', '08eb4f42e58e105460e64a6396169c51'])
    expect(readFileSync(PRUEBA, 'utf8')).toContain("'5dbcedf7f850fdd8643993ea06e25eec'")
  })
  it('declara qué cuenta; la cuenta solo lee y ancla Foodint por su cuenta', () => {
    const cuentas = readFileSync(MANIFIESTO, 'utf8').split('\n').filter((l) => l.startsWith('cuenta:')).map((l) => l.replace(/^cuenta:\s*/, '').trim())
    expect(cuentas).toEqual(['scripts/conta/produccion/cuentas/e05-riders.sql'])
    const c = readFileSync(cuentas[0], 'utf8')
    expect(c.replace(/--.*$/gm, '').replace(/'(?:[^']|'')*'/g, "''")).not.toMatch(/\b(insert|update|delete|create|drop|alter|grant|perform)\b/i)
    expect(c).toContain("'51ad1792-6629-4ef7-833a-b57b09a86710'")
  })
  it('su vuelta atrás', () => {
    expect(leerTanda('tests/conta/produccion/vuelta-atras-e05-riders-20261021.txt')).toEqual([DOWN])
  })
})

describe('la tanda del Autoconteo (0390 y 0400, PR #277), ya aplicada: su copia y su contexto medido', () => {
  const MANIFIESTO = 'tests/conta/produccion/tanda-autoconteo-20261021.txt'
  const viva = leerTanda(MANIFIESTO)
  // La respuesta REAL de la consulta de contexto del workflow, lanzada en solo lectura
  // en producción el 21/10 a las 15:58 UTC, después de la de Compras, para ESTOS ficheros.
  const medida = JSON.parse(readFileSync('tests/conta/produccion/contexto-produccion-autoconteo-20261021.json', 'utf8'))
  const ctx = medida.contexto
  const leer = (r: string) => { try { return readFileSync(r, 'utf8') } catch { return null } }
  const r = informe(viva, ctx, {}, leer) as { markdown: string; ficheros: Record<string, string> }
  const md5 = (x: string) => createHash('md5').update(x).digest('hex')
  const nombre = (f: string) => f.replace(/^.*\//, '')
  const PRUEBA = 'supabase/staging/sql/20261129_autoconteo_prueba.sql'

  it('dos ficheros, los medidos; los dos piden «autorizo»; del camino del pedido, solo la función del cron; nada registrado aún', () => {
    expect(viva.map(nombre)).toEqual(['20261129T0390_autoconteo_anula_atascados.sql', '20261129T0400_autoconteo_se_aplica_entero.sql'])
    expect(Object.keys(medida.tanda)).toEqual(viva)
    for (const f of viva) expect(md5(readFileSync(f, 'utf8')), f).toBe(medida.tanda[f])
    expect(viva.map((f) => r.ficheros[f])).toEqual(['autorizo', 'autorizo'])
    expect(ctx.tablas).toEqual(['public.inventory_count'])
    expect(ctx.funciones).toEqual(['public.apply_inventory_count(uuid,uuid,text,boolean)', 'public.autoclose_daily_count(uuid)',
      'public.close_inventory_count(uuid)', 'public.cron_autoclose_daily_counts()'])
    expect(ctx.otras).toEqual({})
    expect(ctx.camino).toEqual({ tablas: [], funciones: ['public.cron_autoclose_daily_counts()'] })
    expect(ctx.registro).toEqual([])
  })
  it('lo que cambia en caliente está en la cabecera, con su prueba de staging, y la prueba lo nombra', () => {
    const cab = (f: string) => readFileSync(f, 'utf8').split('\n').filter((l) => /^-- cambia:/.test(l))
    expect(cab(viva[0])).toEqual([`-- cambia: public.autoconteo_anulacion_20261021 · prueba: ${PRUEBA}`])
    expect(cab(viva[1])).toEqual(['inventory_count', 'close_inventory_count', 'apply_inventory_count', 'autoclose_daily_count', 'cron_autoclose_daily_counts']
      .map((x) => `-- cambia: public.${x} · prueba: ${PRUEBA}`))
    const p = readFileSync(PRUEBA, 'utf8')
    for (const x of ['close_inventory_count', 'apply_inventory_count', 'autoclose_daily_count', 'autoconteo_cierre_nocturno', 'set local role authenticated',
      'close_sale', 'register_waste']) expect(p).toContain(x)
  })
  it('la 0390 anula 23 por id y cuenta, para entera si alguno no está como se midió, y no toca el stock', () => {
    const t = readFileSync(viva[0], 'utf8')
    expect(t.match(/\('[0-9a-f-]{36}',\s*'INV-\d+',\s*c_(plantilla|foodint),/g)).toHaveLength(23)
    expect(t).toContain("raise exception 'autoconteo 0390: no se anula nada")
    expect(t.replace(/--.*$/gm, '')).not.toMatch(/stock_movement|recompute_location_stock/)
  })
  it('declara qué cuenta; la cuenta solo lee y va por Foodint', () => {
    const cuentas = readFileSync(MANIFIESTO, 'utf8').split('\n').filter((l) => l.startsWith('cuenta:')).map((l) => l.replace(/^cuenta:\s*/, '').trim())
    expect(cuentas).toEqual(['scripts/conta/produccion/cuentas/autoconteo.sql'])
    const c = readFileSync(cuentas[0], 'utf8')
    expect(c.replace(/--.*$/gm, '').replace(/'(?:[^']|'')*'/g, "''")).not.toMatch(/\b(insert|update|delete|create|drop|alter|grant|perform)\b/i)
    expect(c).toContain("'51ad1792-6629-4ef7-833a-b57b09a86710'")
  })
  it('su vuelta atrás, en orden inverso', () => {
    expect(leerTanda('tests/conta/produccion/vuelta-atras-autoconteo-20261021.txt').map(nombre)).toEqual([
      '20261129T0400_autoconteo_se_aplica_entero.down.sql', '20261129T0390_autoconteo_anula_atascados.down.sql'])
  })
})

describe('la tanda de C06b · el nombre del PDF lo limpia la base (0380, PR #275), ya aplicada: su copia y su contexto medido', () => {
  const MANIFIESTO = 'tests/conta/produccion/tanda-c06b-nombre-pdf-base-20261021.txt'
  const viva = leerTanda(MANIFIESTO)
  // La respuesta REAL de la consulta de contexto del workflow, lanzada en solo
  // lectura en producción el 21/10 a las 19:16 UTC, después de la 0350–0370, para ESTE fichero.
  const medida = JSON.parse(readFileSync('tests/conta/produccion/contexto-produccion-c06b-nombre-pdf-base-20261021.json', 'utf8'))
  const ctx = medida.contexto
  const leer = (r: string) => { try { return readFileSync(r, 'utf8') } catch { return null } }
  const r = informe(viva, ctx, {}, leer) as { markdown: string; ficheros: Record<string, string> }
  const md5 = (x: string) => createHash('md5').update(x).digest('hex')
  const nombre = (f: string) => f.replace(/^.*\//, '')
  const PRUEBA = 'supabase/staging/sql/20261129_c06b_nombre_pdf_base_prueba.sql'
  const DOWN = 'supabase/vuelta-atras/20261129T0380_c06b_nombre_pdf_base.down.sql'

  it('un fichero, el medido; sigue sin «autorizo»; la tabla existe y lo nuevo no; nada del camino del pedido; nada registrado aún', () => {
    expect(viva.map(nombre)).toEqual(['20261129T0380_c06b_nombre_pdf_base.sql'])
    expect(Object.keys(medida.tanda)).toEqual(viva)
    for (const f of viva) expect(md5(readFileSync(f, 'utf8')), f).toBe(medida.tanda[f])
    expect(viva.map((f) => r.ficheros[f])).toEqual(['sigue'])
    expect(ctx.tablas).toEqual(['public.journal_entry_document'])
    expect(ctx.funciones).toEqual([])
    expect(ctx.otras).toEqual({})
    expect(ctx.camino).toEqual({ tablas: [], funciones: [] })
    expect(ctx.registro).toEqual([])
  })
  it('solo añade y se puede volver a correr: la columna admite nulos, las dos funciones no existen en producción, el único drop es el del disparador nuevo y ningún update ni delete', () => {
    const t = readFileSync(viva[0], 'utf8').replace(/--.*$/gm, '')
    expect(t).toMatch(/add column if not exists original_name text;/)
    expect(t).not.toMatch(/\bnot null\b/i)
    expect(t.match(/create or replace function public\.(\w+)/g)).toEqual(['create or replace function public.conta_nombre_fichero', 'create or replace function public.journal_entry_document_nombre_limpio'])
    expect(ctx.funciones).toEqual([])
    expect(t.match(/\bdrop\b[^;]*;/g)).toEqual(['drop trigger if exists trg_journal_entry_document_nombre_limpio on public.journal_entry_document;'])
    expect(t).not.toMatch(/\bupdate\s+public\.|\bdelete\s+from\b|\brename\b|\btruncate\b/i)
  })
  it('el disparador nuevo está en la cabecera, con su prueba de staging; la prueba lo nombra, pasa por los tres que escriben y ejecuta la vuelta atrás', () => {
    const cab = readFileSync(viva[0], 'utf8').split('\n').filter((l) => /^-- cambia:/.test(l))
    expect(cab).toEqual([`-- cambia: public.journal_entry_document · prueba: ${PRUEBA}`])
    const p = readFileSync(PRUEBA, 'utf8')
    for (const x of ['journal_entry_document', 'conta_documento_factura_guardar', "'resumen_ventas'", "'factura_expedida'", 'set local role authenticated', 'rollback;']) expect(p).toContain(x)
    expect(p).toContain(`\\i ${DOWN}`)
    const m = readFileSync('supabase/staging/aplicar.txt', 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    expect(m.indexOf(PRUEBA)).toBeGreaterThan(m.indexOf(viva[0]))
  })
  it('declara qué cuenta; la cuenta solo lee y va por Foodint', () => {
    const cuentas = readFileSync(MANIFIESTO, 'utf8').split('\n').filter((l) => l.startsWith('cuenta:')).map((l) => l.replace(/^cuenta:\s*/, '').trim())
    expect(cuentas).toEqual(['scripts/conta/produccion/cuentas/nombre-pdf-base.sql'])
    const c = readFileSync(cuentas[0], 'utf8')
    expect(c.replace(/--.*$/gm, '').replace(/'(?:[^']|'')*'/g, "''")).not.toMatch(/\b(insert|update|delete|create|drop|alter|grant|perform)\b/i)
    expect(c).toContain("'51ad1792-6629-4ef7-833a-b57b09a86710'")
  })
  it('su vuelta atrás', () => {
    expect(leerTanda('tests/conta/produccion/vuelta-atras-c06b-nombre-pdf-base-20261021.txt')).toEqual([DOWN])
  })
})

describe('la tanda de Compras · Por revisar y los textos sin «papel» (0350, 0360 y 0370, PR #271), ya aplicada: su copia y su contexto medido', () => {
  const MANIFIESTO = 'tests/conta/produccion/tanda-compras-revisar-20261021.txt'
  const viva = leerTanda(MANIFIESTO)
  // La respuesta REAL de la consulta de contexto del workflow, lanzada en solo
  // lectura en producción el 21/10 a las 13:06 UTC, después de la 0340, para ESTOS ficheros.
  const medida = JSON.parse(readFileSync('tests/conta/produccion/contexto-produccion-compras-revisar-20261021.json', 'utf8'))
  const ctx = medida.contexto
  const leer = (r: string) => { try { return readFileSync(r, 'utf8') } catch { return null } }
  const r = informe(viva, ctx, {}, leer) as { markdown: string; ficheros: Record<string, string> }
  const md5 = (x: string) => createHash('md5').update(x).digest('hex')
  const nombre = (f: string) => f.replace(/^.*\//, '')
  const DOCE = ['_compras_camino_calcula', '_compras_factura_desde_papel', 'compras_factura_desde_papel', 'compras_sin_iva', 'tg_goods_receipt_path_factura',
    'compras_camino_de', 'conta_documentos_recibidos', 'company_chart_import_apply', 'company_chart_import_undo', 'party_add_role', 'party_misma_cuenta', '_party_merge']

  it('tres ficheros, los medidos; la 0350 y la 0370 siguen, la 0360 pide «autorizo»; nada del camino del pedido; nada registrado aún', () => {
    expect(viva.map(nombre)).toEqual(['20261129T0350_compras_preguntas_de_la_ficha.sql', '20261129T0360_compras_preguntas_foodint.sql', '20261129T0370_textos_sin_papel.sql'])
    expect(Object.keys(medida.tanda)).toEqual(viva)
    for (const f of viva) expect(md5(readFileSync(f, 'utf8')), f).toBe(medida.tanda[f])
    expect(viva.map((f) => r.ficheros[f])).toEqual(['sigue', 'autorizo', 'sigue'])
    expect(ctx.tablas).toEqual(['public.goods_receipt_path'])
    expect(ctx.funciones).toHaveLength(14)
    expect(ctx.otras).toEqual({})
    expect(ctx.camino).toEqual({ tablas: [], funciones: [] })
    expect(ctx.registro).toEqual([])
  })
  it('lo que cambia en caliente está en la cabecera, con su prueba de staging, y la prueba lo nombra', () => {
    const cab = (f: string) => readFileSync(f, 'utf8').split('\n').filter((l) => /^-- cambia:/.test(l))
    expect(cab(viva[0])).toEqual(['_compras_camino_guarda', '_compras_forma_facturar'].map((x) => `-- cambia: public.${x} · prueba: supabase/staging/sql/20261129_compras_preguntas_de_la_ficha_prueba.sql`))
    expect(cab(viva[1])).toEqual([])
    expect(cab(viva[2])).toEqual(DOCE.map((x) => `-- cambia: public.${x} · prueba: supabase/staging/sql/20261129_textos_sin_papel_prueba.sql`))
    const p0 = readFileSync('supabase/staging/sql/20261129_compras_preguntas_de_la_ficha_prueba.sql', 'utf8')
    const p2 = readFileSync('supabase/staging/sql/20261129_textos_sin_papel_prueba.sql', 'utf8')
    for (const x of ['compras_forma_facturar', 'compras_mirar', 'set local role authenticated']) expect(p0).toContain(x)
    for (const x of DOCE) expect(p2).toContain(x)
    expect(p0).toContain('\\i supabase/vuelta-atras/20261129T0350_compras_preguntas_de_la_ficha.down.sql')
    expect(p2).toContain('\\i supabase/vuelta-atras/20261129T0370_textos_sin_papel.down.sql')
  })
  it('la 0360 solo toca Foodint y solo la pregunta; su vuelta atrás devuelve las 5 medidas', () => {
    const t = readFileSync(viva[1], 'utf8').replace(/--.*$/gm, '')
    expect(t).toContain("v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710'")
    expect(t.match(/update public\.goods_receipt_path set ([^\n]*)/)![1]).toBe("question = v->>'question', question_detail = nullif(v->'question_detail', 'null'::jsonb)")
    const down = readFileSync('supabase/vuelta-atras/20261129T0360_compras_preguntas_foodint.down.sql', 'utf8')
    expect(down.match(/'[0-9a-f-]{36}',\s+-- ALB-\d+/g)).toHaveLength(4)
    expect(down).toMatch(/'6fbb2943-db4a-4bd7-a4b6-ed75ecf124e4'\);\s+-- ALB-00218/)
  })
  it('la regla 10 se ensaya en staging con las tres puestas: los cuatro caminos, detrás de la 0370', () => {
    const m = readFileSync('supabase/staging/aplicar.txt', 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    const cuatro = 'supabase/staging/sql/20261129_compras_revisar_cuatro_caminos_prueba.sql'
    expect(m.indexOf(cuatro)).toBeGreaterThan(m.indexOf('supabase/migrations/20261129T0370_textos_sin_papel.sql'))
    const p = readFileSync(cuatro, 'utf8')
    for (const x of ['close_sale', 'confirm_goods_receipt', 'compras_camino_de', 'register_waste', 'apply_inventory_count', 'set local role authenticated']) expect(p).toContain(x)
  })
  it('declara qué cuenta; la cuenta solo lee y va por Foodint', () => {
    const cuentas = readFileSync(MANIFIESTO, 'utf8').split('\n').filter((l) => l.startsWith('cuenta:')).map((l) => l.replace(/^cuenta:\s*/, '').trim())
    expect(cuentas).toEqual(['scripts/conta/produccion/cuentas/compras-revisar.sql'])
    const c = readFileSync(cuentas[0], 'utf8')
    expect(c.replace(/--.*$/gm, '').replace(/'(?:[^']|'')*'/g, "''")).not.toMatch(/\b(insert|update|delete|create|drop|alter|grant|perform)\b/i)
    expect(c).toContain("'51ad1792-6629-4ef7-833a-b57b09a86710'")
  })
  it('su vuelta atrás, en orden inverso', () => {
    expect(leerTanda('tests/conta/produccion/vuelta-atras-compras-revisar-20261021.txt').map(nombre)).toEqual([
      '20261129T0370_textos_sin_papel.down.sql', '20261129T0360_compras_preguntas_foodint.down.sql', '20261129T0350_compras_preguntas_de_la_ficha.down.sql'])
  })
})

describe('la tanda del 202 desde el último 200 (I01h, 0340, PR #269), ya aplicada: su copia y su contexto medido', () => {
  const MANIFIESTO = 'tests/conta/produccion/tanda-i01h-sociedades-20261021.txt'
  const viva = leerTanda(MANIFIESTO)
  // La respuesta REAL de la consulta de contexto del workflow, lanzada en solo
  // lectura en producción el 21/10 a las 08:20 UTC, después de la 0330, para ESTE fichero.
  const medida = JSON.parse(readFileSync('tests/conta/produccion/contexto-produccion-i01h-sociedades-20261021.json', 'utf8'))
  const ctx = medida.contexto
  const leer = (r: string) => { try { return readFileSync(r, 'utf8') } catch { return null } }
  const r = informe(viva, ctx, {}, leer) as { markdown: string; ficheros: Record<string, string> }
  const md5 = (x: string) => createHash('md5').update(x).digest('hex')
  const DOWN = 'supabase/vuelta-atras/20261128T0340_i01h_sociedades_202.down.sql'
  const PRUEBA = 'supabase/staging/sql/20261128_i01h_sociedades_202_prueba.sql'
  const ORIGEN_CAL = 'supabase/migrations/20261122T0250_i01b_349_por_operaciones.sql'
  const NUEVAS = ['conta_impuesto_sociedades(uuid)', 'conta_impuesto_200_poner(uuid, int, jsonb, text)', 'conta_impuesto_202_calcular(uuid, int, text)']
  const cuerpoCal = (f: string) => {
    const t = readFileSync(f, 'utf8')
    const k = t.indexOf('create or replace function public.conta_impuesto_calendario(')
    const ini = t.indexOf('$$', k) + 2
    return t.slice(ini, t.indexOf('$$;', ini))
  }

  it('un fichero, el medido; sigue; nada del camino del pedido; la tabla y las tres funciones aún no existen', () => {
    expect(viva.map((f) => f.replace(/^.*\//, ''))).toEqual(['20261128T0340_i01h_sociedades_202.sql'])
    expect(Object.keys(medida.tanda)).toEqual(viva)
    expect(md5(readFileSync(viva[0], 'utf8'))).toBe(medida.tanda[viva[0]])
    expect(r.ficheros[viva[0]]).toBe('sigue')
    expect(ctx.tablas).toEqual(['public.tax_return_check'])
    expect(ctx.funciones).toEqual(['public.conta_impuesto_calendario(uuid,date)'])
    expect(ctx.otras).toEqual({})
    expect(ctx.camino).toEqual({ tablas: [], funciones: [] })
    expect(ctx.registro).toEqual([])
  })
  it('lo que cambia en caliente (el CHECK, que solo amplía, y el calendario) está en la cabecera, con su prueba de staging', () => {
    const t = readFileSync(viva[0], 'utf8')
    expect(t.split('\n').filter((l) => /^-- cambia:/.test(l))).toEqual([
      `-- cambia: public.tax_return_check · prueba: ${PRUEBA}`, `-- cambia: public.conta_impuesto_calendario · prueba: ${PRUEBA}`])
    const prueba = readFileSync(PRUEBA, 'utf8')
    expect(prueba).toMatch(/\btax_return_check\b/)
    expect(prueba).toMatch(/\bconta_impuesto_calendario\b/)
    const claves = (x: string) => [...x.matchAll(/check \(check_key in \(([^)]*)\)\)/g)].map((m) => m[1].match(/'[a-z_0-9]+'/g)!.map((y) => y.slice(1, -1)))
    const [ahora] = claves(t)
    const [antes] = claves(readFileSync(DOWN, 'utf8'))
    expect(antes).toHaveLength(13)
    expect(ahora.filter((k) => !antes.includes(k))).toEqual(['base_200'])
    expect(antes.every((k) => ahora.includes(k))).toBe(true)
  })
  it('el calendario sale del de producción (la 0250, caccacb3…), solo AÑADE una condición, y la vuelta atrás lo devuelve BYTE A BYTE', () => {
    expect(md5(cuerpoCal(ORIGEN_CAL))).toBe('caccacb3d2fa9528b5737830b4fd93b2')
    expect(cuerpoCal(DOWN)).toBe(cuerpoCal(ORIGEN_CAL))
    const antes = cuerpoCal(ORIGEN_CAL).split('\n')
    const ahora = cuerpoCal(viva[0]).split('\n')
    expect(antes.filter((l) => !ahora.includes(l)).map((l) => l.trim())).toEqual(["and (d.rid is not null or (v_desde is not null and d.presentacion >= v_desde)));"])
    expect(ahora.filter((l) => !antes.includes(l)).map((l) => l.trim()).filter((l) => !l.startsWith('--'))).toEqual([
      'and (d.rid is not null or (v_desde is not null and d.presentacion >= v_desde)))',
      "or (d.presentacion < v_hoy and d.status = 'not_required' and d.presentacion >= v_hoy - 31);",
    ])
  })
  it('lo nuevo es nuevo y la vuelta atrás lo quita; la prueba de staging recorre sus caminos y su vuelta atrás', () => {
    const t = readFileSync(viva[0], 'utf8')
    const down = readFileSync(DOWN, 'utf8')
    expect(t).toContain('create table if not exists public.corporate_tax_filing (')
    expect(down).toContain('drop table if exists public.corporate_tax_filing;')
    for (const f of NUEVAS) {
      expect(t).toContain(`create or replace function public.${f.replace(/\(.*$/, '')}(`)
      expect(down).toContain(`drop function if exists public.${f};`)
    }
    const prueba = readFileSync(PRUEBA, 'utf8')
    expect(prueba).toContain(`\\i ${viva[0]}`)
    expect(prueba).toContain(`\\i ${DOWN}`)
    for (const paso of ['conta_impuesto_200_poner', 'conta_impuesto_202_calcular', 'conta_impuesto_sociedades', 'conta_impuesto_calendario', 'journal_entry_validar', 'set local role anon']) expect(prueba).toContain(paso)
    expect(prueba.trim().endsWith('rollback;')).toBe(true)
  })
  it('declara qué cuenta; la cuenta solo lee y va por Foodint', () => {
    const cuentas = readFileSync(MANIFIESTO, 'utf8').split('\n').filter((l) => l.startsWith('cuenta:')).map((l) => l.replace(/^cuenta:\s*/, '').trim())
    expect(cuentas).toEqual(['scripts/conta/produccion/cuentas/i01h-sociedades.sql'])
    const c = readFileSync(cuentas[0], 'utf8')
    expect(c.replace(/--.*$/gm, '').replace(/'(?:[^']|'')*'/g, "''")).not.toMatch(/\b(insert|update|delete|create|drop|alter|grant|perform)\b/i)
    expect(c).toContain("'51ad1792-6629-4ef7-833a-b57b09a86710'")
  })
  it('su vuelta atrás', () => {
    expect(leerTanda('tests/conta/produccion/vuelta-atras-i01h-sociedades-20261021.txt')).toEqual([DOWN])
  })
})

describe('la tanda del 111 y el 115 desde el diario (I01g, 0330, PR #266), ya aplicada: su copia y su contexto medido', () => {
  const MANIFIESTO = 'tests/conta/produccion/tanda-i01g-retenciones-20261021.txt'
  const viva = leerTanda(MANIFIESTO)
  // La respuesta REAL de la consulta de contexto del workflow, lanzada en solo
  // lectura en producción el 20/10 a las 23:24 UTC, después de la 0320, para ESTE fichero.
  const medida = JSON.parse(readFileSync('tests/conta/produccion/contexto-produccion-i01g-retenciones-20261020.json', 'utf8'))
  const ctx = medida.contexto
  const leer = (r: string) => { try { return readFileSync(r, 'utf8') } catch { return null } }
  const r = informe(viva, ctx, {}, leer) as { markdown: string; ficheros: Record<string, string> }
  const md5 = (x: string) => createHash('md5').update(x).digest('hex')
  const DOWN = 'supabase/vuelta-atras/20261127T0330_i01g_retenciones_111_115.down.sql'
  const PRUEBA = 'supabase/staging/sql/20261127_i01g_retenciones_prueba.sql'
  const NUEVAS = ['conta_impuesto_perceptores_poner(uuid, int, text)', 'conta_impuesto_retenciones_calcular(uuid, int, text, text)', 'conta_impuesto_retenciones_diario(uuid, int, text)']

  it('un fichero, el medido; sigue; nada del camino del pedido; las tres funciones aún no existen', () => {
    expect(viva.map((f) => f.replace(/^.*\//, ''))).toEqual(['20261127T0330_i01g_retenciones_111_115.sql'])
    expect(Object.keys(medida.tanda)).toEqual(viva)
    expect(md5(readFileSync(viva[0], 'utf8'))).toBe(medida.tanda[viva[0]])
    expect(r.ficheros[viva[0]]).toBe('sigue')
    expect(ctx.tablas).toEqual(['public.tax_return_check'])
    expect(ctx.funciones).toEqual([])
    expect(ctx.otras).toEqual({})
    expect(ctx.camino).toEqual({ tablas: [], funciones: [] })
    expect(ctx.registro).toEqual([])
  })
  it('lo que cambia en caliente (el CHECK de lo comprobado, que solo amplía) está en la cabecera, con su prueba de staging', () => {
    const s = readFileSync(viva[0], 'utf8')
    expect(s.split('\n').filter((l) => /^-- cambia:/.test(l))).toEqual([`-- cambia: public.tax_return_check · prueba: ${PRUEBA}`])
    expect(readFileSync(PRUEBA, 'utf8')).toMatch(/\btax_return_check\b/)
    // Las diez claves de antes siguen; solo se añaden tres.
    const claves = (t: string) => [...t.matchAll(/check \(check_key in \(([^)]*)\)\)/g)].map((m) => m[1].match(/'[a-z_0-9]+'/g)!.map((x) => x.slice(1, -1)))
    const [ahora] = claves(s)
    const [antes] = claves(readFileSync(DOWN, 'utf8'))
    expect(antes).toHaveLength(10)
    expect(ahora.filter((k) => !antes.includes(k))).toEqual(['ledger_4751', 'payees_111', 'withholding_unclassified'])
    expect(antes.every((k) => ahora.includes(k))).toBe(true)
  })
  it('las funciones son nuevas y la vuelta atrás las quita, y la prueba de staging recorre sus caminos', () => {
    const s = readFileSync(viva[0], 'utf8')
    const down = readFileSync(DOWN, 'utf8')
    for (const f of NUEVAS) {
      expect(s).toContain(`create or replace function public.${f.replace(/\(.*$/, '')}(`)
      expect(down).toContain(`drop function if exists public.${f};`)
    }
    const prueba = readFileSync(PRUEBA, 'utf8')
    expect(prueba).toContain(`\\i ${viva[0]}`)
    for (const paso of ['journal_entry_validar', 'conta_impuesto_retenciones_calcular', 'conta_impuesto_perceptores_poner', 'conta_impuesto_revisar']) expect(prueba).toContain(paso)
    expect(prueba.trim().endsWith('rollback;')).toBe(true)
  })
  it('declara qué cuenta; la cuenta solo lee y va por Foodint', () => {
    const cuentas = readFileSync(MANIFIESTO, 'utf8').split('\n').filter((l) => l.startsWith('cuenta:')).map((l) => l.replace(/^cuenta:\s*/, '').trim())
    expect(cuentas).toEqual(['scripts/conta/produccion/cuentas/i01g-retenciones.sql'])
    const c = readFileSync(cuentas[0], 'utf8')
    expect(c.replace(/--.*$/gm, '').replace(/'(?:[^']|'')*'/g, "''")).not.toMatch(/\b(insert|update|delete|create|drop|alter|grant|perform)\b/i)
    expect(c).toContain("'51ad1792-6629-4ef7-833a-b57b09a86710'")
  })
  it('su vuelta atrás', () => {
    expect(leerTanda('tests/conta/produccion/vuelta-atras-i01g-retenciones-20261021.txt')).toEqual([DOWN])
  })
})

describe('la tanda del envío a Diez de las autoliquidadas (I01f, 0320, PR #264), ya aplicada: su copia y su contexto medido', () => {
  const MANIFIESTO = 'tests/conta/produccion/tanda-i01f-recibida-envio-20261020.txt'
  const viva = leerTanda(MANIFIESTO)
  // La respuesta REAL de la consulta de contexto del workflow, lanzada en solo
  // lectura en producción el 20/10 a las 18:00 UTC, después de la 0300 y la 0310, para ESTE fichero.
  const medida = JSON.parse(readFileSync('tests/conta/produccion/contexto-produccion-i01f-recibida-envio-20261020.json', 'utf8'))
  const ctx = medida.contexto
  const leer = (r: string) => { try { return readFileSync(r, 'utf8') } catch { return null } }
  const r = informe(viva, ctx, {}, leer) as { markdown: string; ficheros: Record<string, string> }
  const cuerpo = (f: string) => {
    const s = readFileSync(f, 'utf8')
    const k = s.indexOf('create or replace function public.conta_recibida_envio(')
    const m = /as (\$(?:function)?\$)/.exec(s.slice(k))!
    const ini = k + m.index + m[0].length
    return s.slice(ini, s.indexOf(`${m[1]};`, ini))
  }
  const md5 = (x: string) => createHash('md5').update(x).digest('hex')
  const ORIGEN = 'supabase/migrations/20261113T0100_d01_liquidaciones_correo.sql'
  const DOWN = 'supabase/vuelta-atras/20261126T0320_i01f_recibida_envio_tratamiento.down.sql'

  it('un fichero, el medido; sigue; nada del camino del pedido', () => {
    expect(viva.map((f) => f.replace(/^.*\//, ''))).toEqual(['20261126T0320_i01f_recibida_envio_tratamiento.sql'])
    expect(Object.keys(medida.tanda)).toEqual(viva)
    expect(md5(readFileSync(viva[0], 'utf8'))).toBe(medida.tanda[viva[0]])
    expect(r.ficheros[viva[0]]).toBe('sigue')
    expect(ctx.funciones).toEqual(['public.conta_recibida_envio(uuid)'])
    expect(ctx.otras).toEqual({})
    expect(ctx.camino).toEqual({ tablas: [], funciones: [] })
    expect(ctx.registro).toEqual([])
  })
  it('lo que cambia en caliente está en la cabecera, con su prueba de staging, que existe y la nombra', () => {
    const cab = readFileSync(viva[0], 'utf8').split('\n').filter((l) => /^-- cambia:/.test(l))
    expect(cab).toEqual(['-- cambia: public.conta_recibida_envio · prueba: supabase/staging/sql/20261126_i01f_recibida_envio_prueba.sql'])
    expect(readFileSync('supabase/staging/sql/20261126_i01f_recibida_envio_prueba.sql', 'utf8')).toMatch(/\bconta_recibida_envio\b/)
  })
  it('sale de la de producción (6e5ed258…), solo AÑADE dos claves, y la vuelta atrás la devuelve BYTE A BYTE', () => {
    expect(md5(cuerpo(ORIGEN)).slice(0, 8)).toBe('6e5ed258')
    expect(cuerpo(DOWN)).toBe(cuerpo(ORIGEN))
    const antes = cuerpo(ORIGEN).split('\n')
    const ahora = cuerpo(viva[0]).split('\n')
    // Nada de lo de antes se va, salvo las dos líneas que ahora siguen con una clave más.
    expect(antes.filter((l) => !ahora.includes(l)).map((l) => l.trim())).toEqual([
      "'nif', coalesce(nullif(trim(v_i.issuer_tax_id), ''), nullif(trim(v_s.tax_id), ''))),",
      "'tipoIva', t.rate, 'baseIva', l.tax_base) order by l.position)",
    ])
    expect(ahora.filter((l) => !antes.includes(l)).map((l) => l.trim()).filter((l) => !l.startsWith('--'))).toEqual([
      "'nif', coalesce(nullif(trim(v_i.issuer_tax_id), ''), nullif(trim(v_s.tax_id), '')),",
      "'pais', coalesce(nullif(upper(btrim(v_s.country_code)), ''), 'ES')),",
      "'tipoIva', t.rate, 'baseIva', l.tax_base,",
      "'tratamiento', t.treatment) order by l.position)",
    ])
  })
  it('declara qué cuenta; la cuenta solo lee y va por Foodint', () => {
    const cuentas = readFileSync(MANIFIESTO, 'utf8').split('\n').filter((l) => l.startsWith('cuenta:')).map((l) => l.replace(/^cuenta:\s*/, '').trim())
    expect(cuentas).toEqual(['scripts/conta/produccion/cuentas/i01f-recibida-envio.sql'])
    const c = readFileSync(cuentas[0], 'utf8')
    expect(c.replace(/--.*$/gm, '').replace(/'(?:[^']|'')*'/g, "''")).not.toMatch(/\b(insert|update|delete|create|drop|alter|grant|perform)\b/i)
    expect(c).toContain("'51ad1792-6629-4ef7-833a-b57b09a86710'")
  })
  it('su vuelta atrás, y la ensaya staging', () => {
    expect(leerTanda('tests/conta/produccion/vuelta-atras-i01f-recibida-envio-20261020.txt')).toEqual([DOWN])
    const prueba = readFileSync('supabase/staging/sql/20261126_i01f_recibida_envio_prueba.sql', 'utf8')
    expect(prueba).toContain(`\\i ${viva[0]}`)
    expect(prueba).toContain(`\\i ${DOWN}`)
  })
})

describe('la tanda de las autoliquidaciones (I01d, 0300 y 0310, PR #260), ya aplicada: su copia y su contexto medido', () => {
  const MANIFIESTO = 'tests/conta/produccion/tanda-i01d-autoliquidaciones-20261020.txt'
  const viva = leerTanda(MANIFIESTO)
  // La respuesta REAL de la consulta de contexto del workflow, lanzada en solo
  // lectura en producción el 20/10 a las 14:33 UTC, después de la 0290, para ESTOS ficheros.
  const medida = JSON.parse(readFileSync('tests/conta/produccion/contexto-produccion-i01d-autoliquidaciones-20261020.json', 'utf8'))
  const ctx = medida.contexto
  const leer = (r: string) => { try { return readFileSync(r, 'utf8') } catch { return null } }
  const r = informe(viva, ctx, {}, leer) as { markdown: string; ficheros: Record<string, string> }
  /** El cuerpo de una función (entre sus $$ o $function$), como lo guarda pg_proc.prosrc. */
  const cuerpo = (f: string, nombre: string) => {
    const s = readFileSync(f, 'utf8')
    const k = s.indexOf(`create or replace function public.${nombre}(`)
    const m = /as (\$(?:function)?\$)/.exec(s.slice(k))!
    const ini = k + m.index + m[0].length
    return s.slice(ini, s.indexOf(`${m[1]};`, ini))
  }
  const md5 = (x: string) => createHash('md5').update(x).digest('hex')
  // Las cuatro que cambian: de dónde salen y su huella en producción (medida el 20/10).
  const CAMBIAN: [string, string, string][] = [
    ['conta_impuesto_303_calcular', 'supabase/migrations/20261124T0290_i01c_deducida.sql', '911debc83af0c4f782d1dc7138423661'],
    ['conta_libro_iva_deducir_en', 'supabase/migrations/20261124T0290_i01c_deducida.sql', '89e4fde383d80331d16c287a8059dada'],
    ['conta_vat_book_desde_asiento', 'supabase/migrations/20261014T0100_c05_libros.sql', 'f5570d0cdb353daaa5f4a8eb59c37662'],
    ['conta_motivos_para_validar', 'supabase/migrations/20261122T0180_i01b_asiento_303.sql', 'ed8b9e8c2e2a1740b4052ea9479d8520'],
  ]

  it('dos ficheros, los medidos; la 0300 sigue, la 0310 (datos de Foodint) pide «autorizo»; nada del camino del pedido', () => {
    expect(viva.map((f) => f.replace(/^.*\//, ''))).toEqual(['20261125T0300_i01d_autoliquidaciones.sql', '20261125T0310_i01d_proveedores_foodint.sql'])
    expect(Object.keys(medida.tanda)).toEqual(viva)
    for (const f of viva) expect(md5(readFileSync(f, 'utf8')), f).toBe(medida.tanda[f])
    expect(r.ficheros[viva[0]]).toBe('sigue')
    expect(r.ficheros[viva[1]]).toMatch(/autorizo/i)
    expect(ctx.tablas).toEqual(['public.company_account_link', 'public.supplier'])
    expect(ctx.funciones).toEqual(CAMBIAN.map(([n]) => n).sort().map((n) => `public.${n}${{
      conta_impuesto_303_calcular: '(uuid,int,text)', conta_libro_iva_deducir_en: '(uuid,jsonb,int,text,text)',
      conta_vat_book_desde_asiento: '(uuid)', conta_motivos_para_validar: '(uuid)' }[n]}`))
    expect(ctx.otras).toEqual({})
    expect(ctx.camino).toEqual({ tablas: [], funciones: [] })
    expect(ctx.registro).toEqual([])
  })
  it('lo que cambia en caliente (las cuatro funciones) está en la cabecera, con su prueba de staging, que existe y las nombra', () => {
    const cab = readFileSync(viva[0], 'utf8').split('\n').filter((l) => /^-- cambia:/.test(l))
    expect(cab.map((l) => l.replace(/^-- cambia: public\.(\S+).*$/, '$1')).sort()).toEqual(CAMBIAN.map(([n]) => n).sort())
    for (const l of cab) {
      const prueba = readFileSync(l.replace(/^.*prueba: (\S+).*$/, '$1'), 'utf8')
      expect(prueba).toMatch(new RegExp(`\\b${l.replace(/^-- cambia: public\.(\S+).*$/, '$1')}\\b`))
    }
  })
  it('cada una sale de la versión de producción (su md5) y la vuelta atrás la devuelve BYTE A BYTE', () => {
    const down = 'supabase/vuelta-atras/20261125T0300_i01d_autoliquidaciones.down.sql'
    for (const [n, origen, huella] of CAMBIAN) {
      expect(md5(cuerpo(origen, n)), n).toBe(huella)
      expect(cuerpo(down, n), n).toBe(cuerpo(origen, n))
      expect(cuerpo(viva[0], n), n).not.toBe(cuerpo(origen, n))
    }
  })
  it('el cálculo del 303: solo cambian las casillas de cada apunte (ahora en conta_impuesto_303_cajas) y la suma de cuatro', () => {
    const antes = cuerpo(CAMBIAN[0][1], 'conta_impuesto_303_calcular').split('\n')
    const ahora = cuerpo(viva[0], 'conta_impuesto_303_calcular').split('\n')
    const soloAhora = ahora.filter((l) => !antes.includes(l)).map((l) => l.trim())
    expect(soloAhora).toEqual([
      'cross join lateral public.conta_impuesto_303_cajas(v) x',
      "when 'rectificativa_isp' then n || ' rectificativas recibidas con inversión del sujeto pasivo o intracomunitarias: Sumied todavía no las declara.'",
      "when 'extranjera_sin_isp' then n || ' compras a proveedores de fuera de España sin autoliquidar: mira si son importaciones (con DUA) o si les falta el tipo «Compra en otro país de la UE» o «Inversión del sujeto pasivo».'",
      "select boxes[2], case when libro = 'issued' then cuota else ded end from l where cardinality(boxes) = 2",
      '-- 0300: la autoliquidación lleva cuatro casillas: base y cuota',
      '-- devengadas ([10]/[11] o [12]/[13]) y base y cuota deducibles.',
      'union all select boxes[2], cuota from l where cardinality(boxes) = 4',
      'union all select boxes[3], base from l where cardinality(boxes) = 4',
      'union all select boxes[4], ded from l where cardinality(boxes) = 4) s',
    ])
  })
  it('declara qué cuenta; la cuenta solo lee, va por Foodint y lleva el testigo del 3T', () => {
    const cuentas = readFileSync(MANIFIESTO, 'utf8').split('\n').filter((l) => l.startsWith('cuenta:')).map((l) => l.replace(/^cuenta:\s*/, '').trim())
    expect(cuentas).toEqual(['scripts/conta/produccion/cuentas/i01d-autoliquidaciones.sql'])
    const c = readFileSync(cuentas[0], 'utf8')
    const fuera = c.replace(/--.*$/gm, '').replace(/'(?:[^']|'')*'/g, "''")
    expect(fuera).not.toMatch(/\b(insert|update|delete|create|drop|alter|grant|perform)\b/i)
    expect(c).toContain("'51ad1792-6629-4ef7-833a-b57b09a86710'")
    expect(c).toContain('conta_impuesto_303_desde_libro')
  })
  it('la 0310 solo toca Foodint y no lleva ningún NIF escrito', () => {
    const d = readFileSync(viva[1], 'utf8')
    expect(d).toContain("v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710'")
    expect(d).toMatch(/if not exists \(select 1 from public\.company where id = v_emp and account_id = v_acc\) then/)
    expect(d.replace(/--.*$/gm, '')).not.toMatch(/\b(IE|FR|PT|EU|US)\d{6,}/)
  })
  it('su vuelta atrás, en orden inverso, y la ensaya staging', () => {
    const atras = leerTanda('tests/conta/produccion/vuelta-atras-i01d-autoliquidaciones-20261020.txt')
    expect(atras).toEqual(['supabase/vuelta-atras/20261125T0310_i01d_proveedores_foodint.down.sql', 'supabase/vuelta-atras/20261125T0300_i01d_autoliquidaciones.down.sql'])
    const down = readFileSync(atras[1], 'utf8')
    for (const f of ['conta_impuesto_303_desde_libro(uuid, int, text)', 'conta_impuesto_303_cajas(public.vat_book_entry)', 'conta_proveedor_iva_clase(text, text, text, text, text)', 'conta_pais_nombre(text)']) {
      expect(down).toContain(`drop function if exists public.${f};`)
    }
    const prueba = readFileSync('supabase/staging/sql/20261125_i01d_autoliquidaciones_prueba.sql', 'utf8')
    expect(prueba).toContain(`\\i ${viva[0]}`)
    expect(prueba).toContain(`\\i ${atras[1]}`)
  })
})

describe('la tanda de «deducida en» (I01c, 0290, PR #257), ya aplicada: su copia y su contexto medido', () => {
  const MANIFIESTO = 'tests/conta/produccion/tanda-i01c-deducida-20261020.txt'
  const viva = leerTanda(MANIFIESTO)
  // La respuesta REAL de la consulta de contexto del workflow, lanzada en solo
  // lectura en producción el 20/10 a las 10:08 UTC, después de la 0280, para ESTE fichero.
  const medida = JSON.parse(readFileSync('tests/conta/produccion/contexto-produccion-i01c-deducida-20261020.json', 'utf8'))
  const ctx = medida.contexto
  const leer = (r: string) => { try { return readFileSync(r, 'utf8') } catch { return null } }
  const r = informe(viva, ctx, {}, leer) as { markdown: string; ficheros: Record<string, string> }
  /** El cuerpo de conta_impuesto_303_calcular (entre los $$), como lo guarda pg_proc.prosrc. */
  const cuerpo303 = (f: string) => {
    const s = readFileSync(f, 'utf8')
    const i = s.indexOf('$$', s.indexOf('create or replace function public.conta_impuesto_303_calcular')) + 2
    return s.slice(i, s.indexOf('end $$;', i) + 4)
  }

  it('un fichero, el medido; sigue (no pide «autorizo») y no toca el camino del pedido', () => {
    expect(viva.map((f) => f.replace(/^.*\//, ''))).toEqual(['20261124T0290_i01c_deducida.sql'])
    expect(Object.keys(medida.tanda)).toEqual(viva)
    for (const f of viva) expect(createHash('md5').update(readFileSync(f)).digest('hex'), f).toBe(medida.tanda[f])
    expect(Object.values(r.ficheros)).toEqual(['sigue'])
    expect(ctx.tablas).toEqual(['public.vat_book_entry'])
    expect(ctx.funciones).toEqual(['public.conta_impuesto_303_calcular(uuid,int,text)'])
    expect(ctx.otras).toEqual({})
    expect(ctx.camino).toEqual({ tablas: [], funciones: [] })
    expect(ctx.registro).toEqual([])
  })
  it('lo que cambia en caliente (el cálculo del 303 y la restricción) está en la cabecera, con su prueba de staging, que existe y lo nombra', () => {
    const cab = readFileSync(viva[0], 'utf8').split('\n').filter((l) => /^-- cambia:/.test(l))
    // El cálculo del 303 (misma firma) y la restricción nueva sobre vat_book_entry (revisa sus 4.509 filas).
    expect(cab.map((l) => l.replace(/^-- cambia: (\S+).*$/, '$1'))).toEqual(['public.conta_impuesto_303_calcular', 'public.vat_book_entry'])
    for (const l of cab) {
      const prueba = readFileSync(l.replace(/^.*prueba: (\S+).*$/, '$1'), 'utf8')
      expect(prueba).toMatch(new RegExp(`\\b${l.replace(/^-- cambia: public\.(\S+).*$/, '$1')}\\b`))
    }
  })
  it('el cálculo del 303 es el de la 0280 (el de producción) con tres cambios y nada más', () => {
    const antes = cuerpo303('supabase/migrations/20261122T0280_i01c_trimestre.sql')
    const ahora = cuerpo303(viva[0])
    // El de la 0280 es el que hay en producción (md5 de prosrc medido el 20/10 a las 10:08 UTC).
    expect(createHash('md5').update(antes).digest('hex')).toBe('34eb07273e5020aea7f270dc0ecd4254')
    // Las únicas líneas de la 0280 que ya no están: las tres cosas que cambian (la línea del libro, el
    // filtro del periodo y «out_of_period») y la declaración de dos variables más.
    const a = antes.split('\n'), b = ahora.split('\n')
    const soloAhora = b.filter((l) => !a.includes(l))
    const soloAntes = a.filter((l) => !b.includes(l))
    expect([...soloAntes].sort()).toEqual([
      "                            'no_sabe', x.no_sabe)",
      "     and case when v.book in ('received', 'investment') then coalesce(v.received_date, v.issue_date) else coalesce(v.operation_date, v.issue_date) end",
      '         between v_desde and v_hasta;',
      "  v_sabe110 boolean; v_sabido boolean; v_ant_y int; v_ant_p text; v_txt_vacio text;",
      "  values (r.id, c.account_id, p_company, 'out_of_period', case when v_n > 0 then 'warning' else 'ok' end,",
      "          case when v_n = 0 then 'Ninguna factura de otro periodo.'",
      "               when v_n = 1 then '1 factura recibida tiene fecha de antes del periodo, pero llegó en él: va en este 303.'",
      "               else v_n || ' facturas recibidas tienen fecha de antes del periodo, pero llegaron en él: van en este 303.' end,",
    ].sort())
    expect(soloAhora.join('\n')).toContain('v.deduction_year = p_year and v.deduction_period = p_period')
  })
  it('declara qué cuenta; la cuenta solo lee y va por Foodint', () => {
    const cuentas = readFileSync(MANIFIESTO, 'utf8').split('\n').filter((l) => l.startsWith('cuenta:')).map((l) => l.replace(/^cuenta:\s*/, '').trim())
    expect(cuentas).toEqual(['scripts/conta/produccion/cuentas/i01c-deducida.sql'])
    const c = readFileSync(cuentas[0], 'utf8')
    const fuera = c.replace(/--.*$/gm, '').replace(/'(?:[^']|'')*'/g, "''")
    expect(fuera).not.toMatch(/\b(insert|update|delete|create|drop|alter|grant|perform)\b/i)
    expect(c).toContain("'51ad1792-6629-4ef7-833a-b57b09a86710'")
  })
  it('su vuelta atrás quita lo nuevo y devuelve el cálculo del 303 (0280) BYTE A BYTE, y la ensaya staging', () => {
    const atras = leerTanda('tests/conta/produccion/vuelta-atras-i01c-deducida-20261020.txt')
    expect(atras).toEqual(['supabase/vuelta-atras/20261124T0290_i01c_deducida.down.sql'])
    const down = readFileSync(atras[0], 'utf8')
    expect(down).toContain('drop function if exists public.conta_libro_iva_deducir_en(uuid, jsonb, int, text, text);')
    expect(down).toContain('drop column if exists deduction_year')
    expect(cuerpo303(atras[0])).toBe(cuerpo303('supabase/migrations/20261122T0280_i01c_trimestre.sql'))
    const prueba = readFileSync('supabase/staging/sql/20261124_i01c_deducida_prueba.sql', 'utf8')
    expect(prueba).toContain(`\\i ${viva[0]}`)
    expect(prueba).toContain(`\\i ${atras[0]}`)
  })
})

describe('la tanda del trimestre (I01c, 0280, PR #252), ya aplicada: su copia y su contexto medido', () => {
  const MANIFIESTO = 'tests/conta/produccion/tanda-i01c-trimestre-20261019.txt'
  const viva = leerTanda(MANIFIESTO)
  // La respuesta REAL de la consulta de contexto del workflow, lanzada en solo
  // lectura en producción el 19/10 a las 21:22 UTC, después de la 0100 de P01, para ESTE fichero (con su md5).
  const medida = JSON.parse(readFileSync('tests/conta/produccion/contexto-produccion-i01c-trimestre-20261019.json', 'utf8'))
  const ctx = medida.contexto
  const leer = (r: string) => { try { return readFileSync(r, 'utf8') } catch { return null } }
  const r = informe(viva, ctx, {}, leer) as { markdown: string; ficheros: Record<string, string> }
  /** El cuerpo de conta_impuesto_303_calcular (entre los $$), como lo guarda pg_proc.prosrc. */
  const cuerpo303 = (f: string) => {
    const s = readFileSync(f, 'utf8')
    const i = s.indexOf('$$', s.indexOf('create or replace function public.conta_impuesto_303_calcular')) + 2
    return s.slice(i, s.indexOf('end $$;', i) + 4)
  }

  it('un fichero, el medido; sigue (no pide «autorizo») y no toca el camino del pedido', () => {
    expect(viva.map((f) => f.replace(/^.*\//, ''))).toEqual(['20261122T0280_i01c_trimestre.sql'])
    expect(Object.keys(medida.tanda)).toEqual(viva)
    for (const f of viva) expect(createHash('md5').update(readFileSync(f)).digest('hex'), f).toBe(medida.tanda[f])
    expect(Object.values(r.ficheros)).toEqual(['sigue'])
    expect(ctx.tablas).toEqual([])
    expect(ctx.funciones).toEqual(['public.conta_impuesto_303_calcular(uuid,int,text)'])
    expect(ctx.otras).toEqual({})
    expect(ctx.camino).toEqual({ tablas: [], funciones: [] })
    expect(ctx.registro).toEqual([])
  })
  it('lo que cambia en caliente (el cálculo del 303, misma firma) está en la cabecera, con su prueba de staging, que existe y lo nombra', () => {
    const cab = readFileSync(viva[0], 'utf8').split('\n').filter((l) => /^-- cambia:/.test(l))
    expect(cab.map((l) => l.replace(/^-- cambia: (\S+).*$/, '$1'))).toEqual(['public.conta_impuesto_303_calcular'])
    for (const l of cab) {
      const prueba = readFileSync(l.replace(/^.*prueba: (\S+).*$/, '$1'), 'utf8')
      expect(prueba).toMatch(new RegExp(`\\b${l.replace(/^-- cambia: public\.(\S+).*$/, '$1')}\\b`))
    }
  })
  it('el cálculo del 303 es el de la 0240 con un solo añadido: la [110] también sin resultado', () => {
    const antes = cuerpo303('supabase/migrations/20261122T0240_i01b_303_no_inventa.sql')
    const ahora = cuerpo303(viva[0])
    // El de la 0240 es el que hay en producción (md5 de prosrc medido el 19/10 a las 20:32 y a las 21:22 UTC).
    expect(createHash('md5').update(antes).digest('hex')).toBe('9141db88860d38cc7ae7175f12b382b0')
    const quitar = ahora.slice(ahora.indexOf('    -- Salvo la [110] (0280)'), ahora.indexOf('    end if;\n  end if;', ahora.indexOf('    -- Salvo la [110] (0280)')) + '    end if;\n'.length)
    expect(quitar).toContain("values (r.id, c.account_id, p_company, '110', round(v110, 2),")
    expect(ahora.replace(quitar, '')).toBe(antes)
  })
  it('declara qué cuenta; la cuenta solo lee y va por Foodint', () => {
    const cuentas = readFileSync(MANIFIESTO, 'utf8').split('\n').filter((l) => l.startsWith('cuenta:')).map((l) => l.replace(/^cuenta:\s*/, '').trim())
    expect(cuentas).toEqual(['scripts/conta/produccion/cuentas/i01c-trimestre.sql'])
    const c = readFileSync(cuentas[0], 'utf8')
    const fuera = c.replace(/--.*$/gm, '').replace(/'(?:[^']|'')*'/g, "''")
    expect(fuera).not.toMatch(/\b(insert|update|delete|create|drop|alter|grant|perform)\b/i)
    expect(c).toContain("'51ad1792-6629-4ef7-833a-b57b09a86710'")
  })
  it('su vuelta atrás quita la lectura y devuelve el cálculo del 303 (0240) BYTE A BYTE, y la ensaya staging', () => {
    const atras = leerTanda('tests/conta/produccion/vuelta-atras-i01c-trimestre-20261019.txt')
    expect(atras).toEqual(['supabase/vuelta-atras/20261122T0280_i01c_trimestre.down.sql'])
    const down = readFileSync(atras[0], 'utf8')
    expect(down).toContain('drop function if exists public.conta_impuesto_trimestre(uuid, int, int);')
    const c24 = readFileSync('supabase/migrations/20261122T0240_i01b_303_no_inventa.sql', 'utf8')
    const a = c24.indexOf('create or replace function public.conta_impuesto_303_calcular')
    expect(down).toContain(c24.slice(a, c24.indexOf('comment on function public.conta_impuesto_303_calcular(uuid, int, text)', a)).trimEnd())
    expect(cuerpo303(atras[0])).toBe(cuerpo303('supabase/migrations/20261122T0240_i01b_303_no_inventa.sql'))
    const prueba = readFileSync('supabase/staging/sql/20261122_i01c_trimestre_prueba.sql', 'utf8')
    expect(prueba).toContain(`\\i ${viva[0]}`)
    expect(prueba).toContain(`\\i ${atras[0]}`)
  })
})

describe('la tanda de Impuestos de tus clientes (P01, 0100, PR #248), ya aplicada: su copia y su contexto medido', () => {
  const MANIFIESTO = 'tests/conta/produccion/tanda-p01-despacho-20261019.txt'
  const viva = leerTanda(MANIFIESTO)
  // La respuesta REAL de la consulta de contexto del workflow, lanzada en solo
  // lectura en producción el 19/10 a las 17:08 UTC, después de la 0270, para ESTE fichero (con su md5).
  const medida = JSON.parse(readFileSync('tests/conta/produccion/contexto-produccion-p01-despacho-20261019.json', 'utf8'))
  const ctx = medida.contexto
  const leer = (r: string) => { try { return readFileSync(r, 'utf8') } catch { return null } }
  const r = informe(viva, ctx, {}, leer) as { markdown: string; ficheros: Record<string, string> }

  it('un fichero, el medido; sigue (no pide «autorizo») y no toca el camino del pedido', () => {
    expect(viva.map((f) => f.replace(/^.*\//, ''))).toEqual(['20261123T0100_p01_despacho.sql'])
    expect(Object.keys(medida.tanda)).toEqual(viva)
    for (const f of viva) expect(createHash('md5').update(readFileSync(f)).digest('hex'), f).toBe(medida.tanda[f])
    expect(Object.values(r.ficheros)).toEqual(['sigue'])
    expect(ctx.tablas).toEqual(['public.accounts'])
    expect(ctx.funciones).toEqual([])
    expect(ctx.camino).toEqual({ tablas: [], funciones: [] })
    expect(ctx.registro).toEqual([])
  })
  it('solo añade: nada «cambia» en la cabecera y las dos columnas de accounts admiten nulos, sin valor por defecto', () => {
    const sql = readFileSync(viva[0], 'utf8')
    expect(sql.split('\n').filter((l) => /^-- cambia:/.test(l))).toEqual([])
    for (const c of ['tax_advisor_since timestamptz', 'tax_advisor_by uuid']) expect(sql).toContain(`add column if not exists ${c}`)
    const deAccounts = sql.split('\n').filter((l) => /alter table public\.accounts/i.test(l))
    expect(deAccounts).toHaveLength(2)
    for (const l of deAccounts) expect(l).not.toMatch(/not null|default/i)
  })
  it('declara qué cuenta; la cuenta solo lee y va por Foodint', () => {
    const cuentas = readFileSync(MANIFIESTO, 'utf8').split('\n').filter((l) => l.startsWith('cuenta:')).map((l) => l.replace(/^cuenta:\s*/, '').trim())
    expect(cuentas).toEqual(['scripts/conta/produccion/cuentas/p01-despacho.sql'])
    const c = readFileSync(cuentas[0], 'utf8')
    const fuera = c.replace(/--.*$/gm, '').replace(/'(?:[^']|'')*'/g, "''")
    expect(fuera).not.toMatch(/\b(insert|update|delete|create|drop|alter|grant|perform)\b/i)
    expect(c).toContain("'51ad1792-6629-4ef7-833a-b57b09a86710'")
  })
  it('su vuelta atrás quita lo que añade, para si hay datos, y la ensaya staging', () => {
    const atras = leerTanda('tests/conta/produccion/vuelta-atras-p01-despacho-20261019.txt')
    expect(atras).toEqual(['supabase/vuelta-atras/20261123T0100_p01_despacho.down.sql'])
    const down = readFileSync(atras[0], 'utf8')
    expect(down).toMatch(/drop table if exists public\.tax_client_assignee/i)
    for (const c of ['tax_advisor_since', 'tax_advisor_by']) expect(down).toContain(`drop column if exists ${c}`)
    expect(down).toMatch(/raise exception/i)
    const prueba = readFileSync('supabase/staging/sql/20261123_p01_despacho_prueba.sql', 'utf8')
    expect(prueba).toContain(`\\i ${viva[0]}`)
    expect(prueba).toContain(`\\i ${atras[0]}`)
  })
})

describe('la tanda del justificante por CSV (0270, PR #249), ya aplicada: su copia y su contexto medido', () => {
  const MANIFIESTO = 'tests/conta/produccion/tanda-i01c-csv-20261019.txt'
  const viva = leerTanda(MANIFIESTO)
  // La respuesta REAL de la consulta de contexto del workflow, lanzada en solo
  // lectura en producción el 19/10 a las 13:43 UTC, después de la 0260, para ESTE fichero (con su md5).
  const medida = JSON.parse(readFileSync('tests/conta/produccion/contexto-produccion-i01c-csv-20261019.json', 'utf8'))
  const ctx = medida.contexto
  const leer = (r: string) => { try { return readFileSync(r, 'utf8') } catch { return null } }
  const r = informe(viva, ctx, {}, leer) as { markdown: string; ficheros: Record<string, string> }

  it('un fichero, el medido; sigue (no pide «autorizo») y no toca el camino del pedido', () => {
    expect(viva.map((f) => f.replace(/^.*\//, ''))).toEqual(['20261122T0270_i01c_csv.sql'])
    expect(Object.keys(medida.tanda)).toEqual(viva)
    for (const f of viva) expect(createHash('md5').update(readFileSync(f)).digest('hex'), f).toBe(medida.tanda[f])
    expect(Object.values(r.ficheros)).toEqual(['sigue'])
    expect(ctx.tablas).toEqual(['public.tax_return'])
    expect(ctx.funciones).toEqual(['public.conta_impuesto_justificante_apuntar(uuid,jsonb)', 'public.conta_impuesto_presentados(uuid)'])
    expect(ctx.camino).toEqual({ tablas: [], funciones: [] })
    expect(ctx.registro).toEqual([])
  })
  it('lo que cambia en caliente (las dos funciones, misma firma) está en la cabecera, con su prueba de staging, que existe y lo nombra', () => {
    const cab = readFileSync(viva[0], 'utf8').split('\n').filter((l) => /^-- cambia:/.test(l))
    expect(cab.map((l) => l.replace(/^-- cambia: (\S+).*$/, '$1'))).toEqual(['public.conta_impuesto_justificante_apuntar', 'public.conta_impuesto_presentados'])
    for (const l of cab) {
      const prueba = readFileSync(l.replace(/^.*prueba: (\S+).*$/, '$1'), 'utf8')
      expect(prueba).toMatch(new RegExp(`\\b${l.replace(/^-- cambia: public\.(\S+).*$/, '$1')}\\b`))
    }
    // Las columnas, nuevas y que admiten nulos.
    for (const c of ['aeat_expediente', 'presenter_tax_id', 'presenter_name', 'receipt_source']) {
      expect(readFileSync(viva[0], 'utf8')).toContain(`alter table public.tax_return add column if not exists ${c} text`)
    }
  })
  it('declara qué cuenta; la cuenta solo lee y va por Foodint', () => {
    const cuentas = readFileSync(MANIFIESTO, 'utf8').split('\n').filter((l) => l.startsWith('cuenta:')).map((l) => l.replace(/^cuenta:\s*/, '').trim())
    expect(cuentas).toEqual(['scripts/conta/produccion/cuentas/i01c-csv.sql'])
    const c = readFileSync(cuentas[0], 'utf8')
    const fuera = c.replace(/--.*$/gm, '').replace(/'(?:[^']|'')*'/g, "''")
    expect(fuera).not.toMatch(/\b(insert|update|delete|create|drop|alter|grant|perform)\b/i)
    expect(c).toContain("'51ad1792-6629-4ef7-833a-b57b09a86710'")
  })
  it('su vuelta atrás devuelve apuntar (0260) y presentados (0210) BYTE A BYTE y quita las columnas, y la ensaya staging', () => {
    const atras = leerTanda('tests/conta/produccion/vuelta-atras-i01c-csv-20261019.txt')
    expect(atras).toEqual(['supabase/vuelta-atras/20261122T0270_i01c_csv.down.sql'])
    const down = readFileSync(atras[0], 'utf8')
    const c26 = readFileSync('supabase/migrations/20261122T0260_i01c_justificantes.sql', 'utf8')
    const a = c26.indexOf('create or replace function public.conta_impuesto_justificante_apuntar')
    expect(down).toContain(c26.slice(a, c26.indexOf('comment on function public.conta_impuesto_justificante_apuntar(uuid, jsonb)', a)).trimEnd())
    const c21 = readFileSync('supabase/migrations/20261122T0210_i01b_presentados.sql', 'utf8')
    const b = c21.indexOf('create or replace function public.conta_impuesto_presentados')
    expect(down).toContain(c21.slice(b, c21.indexOf('comment on function public.conta_impuesto_presentados(uuid)', b)).trimEnd())
    for (const c of ['aeat_expediente', 'presenter_tax_id', 'presenter_name', 'receipt_source']) expect(down).toContain(`alter table public.tax_return drop column if exists ${c};`)
    const prueba = readFileSync('supabase/staging/sql/20261122_i01c_csv_prueba.sql', 'utf8')
    expect(prueba).toContain(`\\i ${viva[0]}`)
    expect(prueba).toContain(`\\i ${atras[0]}`)
  })
})

describe('la tanda de los justificantes (0260, PR #247), ya aplicada: su copia y su contexto medido', () => {
  const MANIFIESTO = 'tests/conta/produccion/tanda-i01c-justificantes-20261019.txt'
  const viva = leerTanda(MANIFIESTO)
  // La respuesta REAL de la consulta de contexto del workflow, lanzada en solo
  // lectura en producción el 19/10 a las 10:28 UTC, después de la 0250, para ESTE fichero (con su md5).
  const medida = JSON.parse(readFileSync('tests/conta/produccion/contexto-produccion-i01c-justificantes-20261019.json', 'utf8'))
  const ctx = medida.contexto
  const leer = (r: string) => { try { return readFileSync(r, 'utf8') } catch { return null } }
  const r = informe(viva, ctx, {}, leer) as { markdown: string; ficheros: Record<string, string> }

  it('un fichero, el medido; sigue (no pide «autorizo») y no toca el camino del pedido', () => {
    expect(viva.map((f) => f.replace(/^.*\//, ''))).toEqual(['20261122T0260_i01c_justificantes.sql'])
    expect(Object.keys(medida.tanda)).toEqual(viva)
    for (const f of viva) expect(createHash('md5').update(readFileSync(f)).digest('hex'), f).toBe(medida.tanda[f])
    expect(Object.values(r.ficheros)).toEqual(['sigue'])
    expect(ctx.tablas).toEqual(['public.tax_return_box'])
    expect(ctx.funciones).toEqual([])
    expect(ctx.camino).toEqual({ tablas: [], funciones: [] })
    expect(ctx.registro).toEqual([])
  })
  it('lo que cambia en caliente (el CHECK de tax_return_box, que amplía) está en la cabecera, con su prueba de staging, que existe y lo nombra', () => {
    const cab = readFileSync(viva[0], 'utf8').split('\n').filter((l) => /^-- cambia:/.test(l))
    expect(cab.map((l) => l.replace(/^-- cambia: (\S+).*$/, '$1'))).toEqual(['public.tax_return_box'])
    const prueba = readFileSync(cab[0].replace(/^.*prueba: (\S+).*$/, '$1'), 'utf8')
    expect(prueba).toMatch(/\btax_return_box\b/)
    // Amplía: los dos valores de antes siguen dentro.
    expect(readFileSync(viva[0], 'utf8')).toContain("check (origin in ('calculated', 'manual', 'justificante'))")
  })
  it('declara qué cuenta; la cuenta solo lee y va por Foodint', () => {
    const cuentas = readFileSync(MANIFIESTO, 'utf8').split('\n').filter((l) => l.startsWith('cuenta:')).map((l) => l.replace(/^cuenta:\s*/, '').trim())
    expect(cuentas).toEqual(['scripts/conta/produccion/cuentas/i01c-justificantes.sql'])
    const c = readFileSync(cuentas[0], 'utf8')
    const fuera = c.replace(/--.*$/gm, '').replace(/'(?:[^']|'')*'/g, "''")
    expect(fuera).not.toMatch(/\b(insert|update|delete|create|drop|alter|grant|perform)\b/i)
    expect(c).toContain("'51ad1792-6629-4ef7-833a-b57b09a86710'")
  })
  it('su vuelta atrás quita las tres funciones y devuelve el CHECK de la 0110, y la ensaya staging', () => {
    const atras = leerTanda('tests/conta/produccion/vuelta-atras-i01c-justificantes-20261019.txt')
    expect(atras).toEqual(['supabase/vuelta-atras/20261122T0260_i01c_justificantes.down.sql'])
    const down = readFileSync(atras[0], 'utf8')
    for (const f of ['conta_impuesto_justificante_apuntar', 'conta_impuesto_justificantes_repasar', 'conta_impuesto_justificante_mirar']) expect(down).toContain(`drop function if exists public.${f}(uuid, jsonb);`)
    expect(down).toContain("check (origin in ('calculated', 'manual'));")
    const prueba = readFileSync('supabase/staging/sql/20261122_i01c_justificantes_prueba.sql', 'utf8')
    expect(prueba).toContain(`\\i ${viva[0]}`)
    expect(prueba).toContain(`\\i ${atras[0]}`)
  })
})

describe('la tanda del 349 por operaciones (0250, PR #244), ya aplicada: su copia y su contexto medido', () => {
  const MANIFIESTO = 'tests/conta/produccion/tanda-i01b-349-por-operaciones-20261019.txt'
  const viva = leerTanda(MANIFIESTO)
  // La respuesta REAL de la consulta de contexto del workflow, lanzada en solo
  // lectura en producción el 19/10, después de la 0240, para ESTE fichero (con su md5).
  const medida = JSON.parse(readFileSync('tests/conta/produccion/contexto-produccion-i01b-349-por-operaciones-20261019.json', 'utf8'))
  const ctx = medida.contexto
  const leer = (r: string) => { try { return readFileSync(r, 'utf8') } catch { return null } }
  const r = informe(viva, ctx, {}, leer) as { markdown: string; ficheros: Record<string, string> }

  it('un fichero, el medido; sigue (no pide «autorizo») y no toca el camino del pedido ni ninguna tabla', () => {
    expect(viva.map((f) => f.replace(/^.*\//, ''))).toEqual(['20261122T0250_i01b_349_por_operaciones.sql'])
    expect(Object.keys(medida.tanda)).toEqual(viva)
    for (const f of viva) expect(createHash('md5').update(readFileSync(f)).digest('hex'), f).toBe(medida.tanda[f])
    expect(Object.values(r.ficheros)).toEqual(['sigue'])
    expect(ctx.tablas).toEqual([])
    expect(ctx.funciones).toEqual(['public.conta_impuesto_calendario(uuid,date)', 'public.conta_impuesto_reglas(uuid)'])
    expect(ctx.camino).toEqual({ tablas: [], funciones: [] })
    expect(ctx.registro).toEqual([])
  })
  it('lo que cambia en caliente está en la cabecera, con su prueba de staging, que existe y lo nombra', () => {
    const cab = readFileSync(viva[0], 'utf8').split('\n').filter((l) => /^-- cambia:/.test(l))
    expect(cab.map((l) => l.replace(/^-- cambia: (\S+).*$/, '$1'))).toEqual(['public.conta_impuesto_reglas', 'public.conta_impuesto_calendario'])
    for (const l of cab) {
      const prueba = readFileSync(l.replace(/^.*prueba: (\S+).*$/, '$1'), 'utf8')
      expect(prueba).toMatch(new RegExp(`\\b${l.replace(/^-- cambia: public\.(\S+).*$/, '$1')}\\b`))
    }
  })
  it('declara qué cuenta; la cuenta solo lee y va por Foodint', () => {
    const cuentas = readFileSync(MANIFIESTO, 'utf8').split('\n').filter((l) => l.startsWith('cuenta:')).map((l) => l.replace(/^cuenta:\s*/, '').trim())
    expect(cuentas).toEqual(['scripts/conta/produccion/cuentas/i01b-349-por-operaciones.sql'])
    const c = readFileSync(cuentas[0], 'utf8')
    const fuera = c.replace(/--.*$/gm, '').replace(/'(?:[^']|'')*'/g, "''")
    expect(fuera).not.toMatch(/\b(insert|update|delete|create|drop|alter|grant|perform)\b/i)
    expect(c).toContain("'51ad1792-6629-4ef7-833a-b57b09a86710'")
  })
  it('su vuelta atrás devuelve la regla de la 0120 y el calendario de la 0190 BYTE A BYTE, y la ensaya staging', () => {
    const atras = leerTanda('tests/conta/produccion/vuelta-atras-i01b-349-por-operaciones-20261019.txt')
    expect(atras).toEqual(['supabase/vuelta-atras/20261122T0250_i01b_349_por_operaciones.down.sql'])
    const down = readFileSync(atras[0], 'utf8')
    const c20 = readFileSync('supabase/migrations/20261122T0120_i01_obligaciones.sql', 'utf8')
    const a = c20.indexOf('create or replace function public.conta_impuesto_reglas')
    expect(down).toContain(c20.slice(a, c20.indexOf('comment on function public.conta_impuesto_reglas(uuid)', a)).trimEnd())
    const c19 = readFileSync('supabase/migrations/20261122T0190_i01b_calendario.sql', 'utf8')
    const b = c19.indexOf('create or replace function public.conta_impuesto_calendario')
    expect(down).toContain(c19.slice(b, c19.indexOf('comment on function public.conta_impuesto_calendario(uuid, date)', b)).trimEnd())
    expect(down).toContain('drop function if exists public.conta_paises_ue();')
    const prueba = readFileSync('supabase/staging/sql/20261122_i01b_349_por_operaciones_prueba.sql', 'utf8')
    expect(prueba).toContain(`\\i ${viva[0]}`)
    expect(prueba).toContain(`\\i ${atras[0]}`)
  })
})

describe('la tanda del 303 que no inventa (0240, PR #240): su copia y su contexto medido', () => {
  const MANIFIESTO = 'tests/conta/produccion/tanda-i01b-303-no-inventa-20261018.txt'
  const viva = leerTanda(MANIFIESTO)
  // La respuesta REAL de la consulta de contexto del workflow, lanzada en solo
  // lectura en producción el 18/10 a las 20:38 UTC para ESTE fichero (con su md5).
  const medida = JSON.parse(readFileSync('tests/conta/produccion/contexto-produccion-i01b-303-no-inventa-20261018.json', 'utf8'))
  const ctx = medida.contexto
  const leer = (r: string) => { try { return readFileSync(r, 'utf8') } catch { return null } }
  const r = informe(viva, ctx, {}, leer) as { markdown: string; ficheros: Record<string, string> }

  it('un fichero, el medido; sigue (no pide «autorizo») y no toca el camino del pedido ni ninguna tabla', () => {
    expect(viva.map((f) => f.replace(/^.*\//, ''))).toEqual(['20261122T0240_i01b_303_no_inventa.sql'])
    expect(Object.keys(medida.tanda)).toEqual(viva)
    for (const f of viva) expect(createHash('md5').update(readFileSync(f)).digest('hex'), f).toBe(medida.tanda[f])
    expect(Object.values(r.ficheros)).toEqual(['sigue'])
    expect(ctx.tablas).toEqual([])
    expect(ctx.funciones).toEqual(['public.conta_impuesto_303_calcular(uuid,int,text)', 'public.conta_impuesto_303_fichero(uuid)',
      'public.conta_impuesto_fuera(uuid,uuid,text,boolean,text,timestamptz,uuid)'])
    expect(ctx.otras).toEqual({})
    expect(ctx.camino).toEqual({ tablas: [], funciones: [] })
    expect(ctx.registro).toEqual([])
  })
  it('las tres que cambian en caliente están en la cabecera, con su prueba de staging, que existe y las nombra', () => {
    const cab = readFileSync(viva[0], 'utf8').split('\n').filter((l) => /^-- cambia:/.test(l))
    expect(cab.map((l) => l.replace(/^-- cambia: (\S+).*$/, '$1'))).toEqual(['public.conta_impuesto_303_calcular', 'public.conta_impuesto_303_fichero', 'public.conta_impuesto_fuera'])
    for (const l of cab) {
      const prueba = readFileSync(l.replace(/^.*prueba: (\S+).*$/, '$1'), 'utf8')
      expect(prueba, l).toMatch(new RegExp(`\\b${l.replace(/^-- cambia: public\.(\S+).*$/, '$1')}\\b`))
    }
  })
  it('declara qué cuenta; la cuenta solo lee y va por Foodint', () => {
    const cuentas = readFileSync(MANIFIESTO, 'utf8').split('\n').filter((l) => l.startsWith('cuenta:')).map((l) => l.replace(/^cuenta:\s*/, '').trim())
    expect(cuentas).toEqual(['scripts/conta/produccion/cuentas/i01b-303-no-inventa.sql'])
    const c = readFileSync(cuentas[0], 'utf8')
    const fuera = c.replace(/--.*$/gm, '').replace(/'(?:[^']|'')*'/g, "''")
    expect(fuera).not.toMatch(/\b(insert|update|delete|create|drop|alter|grant|perform)\b/i)
    expect(c).toContain("'51ad1792-6629-4ef7-833a-b57b09a86710'")
  })
  it('su vuelta atrás: el .down.sql, con la misma cuenta, devuelve las tres BYTE A BYTE de la 0140 y la 0150; la ensaya staging', () => {
    const atras = leerTanda('tests/conta/produccion/vuelta-atras-i01b-303-no-inventa-20261018.txt')
    expect(atras).toEqual(['supabase/vuelta-atras/20261122T0240_i01b_303_no_inventa.down.sql'])
    expect(readFileSync('tests/conta/produccion/vuelta-atras-i01b-303-no-inventa-20261018.txt', 'utf8')).toContain('cuenta: scripts/conta/produccion/cuentas/i01b-303-no-inventa.sql')
    const down = readFileSync(atras[0], 'utf8')
    const trozo = (t: string, desde: string, hasta: string) => { const a = t.indexOf(desde); return t.slice(a, t.indexOf(hasta, a)).trimEnd() }
    const c40 = readFileSync('supabase/migrations/20261122T0140_i01_calculo_303.sql', 'utf8')
    const c50 = readFileSync('supabase/migrations/20261122T0150_i01_presentar.sql', 'utf8')
    expect(down).toContain(trozo(c40, 'create or replace function public.conta_impuesto_303_calcular', '-- ── 4.'))
    expect(down).toContain(trozo(c40, 'create or replace function public.conta_impuesto_303_fichero(p_return uuid)', 'create or replace function public.conta_impuesto_303_fichero_comprobado'))
    expect(down).toContain(trozo(c50, 'create or replace function public.conta_impuesto_fuera(', '-- ── Cada llamada a Hacienda'))
    expect(down).toContain('drop function if exists public.conta_impuesto_casillas_poner(uuid, jsonb, text);')
    const prueba = readFileSync('supabase/staging/sql/20261122_i01b_303_no_inventa_prueba.sql', 'utf8')
    expect(prueba).toContain(`\\i ${viva[0]}`)
    expect(prueba).toContain(`\\i ${atras[0]}`)
  })
})

describe('la tanda del I01b (0180–0230, PR #235), ya aplicada: su copia y su contexto medido', () => {
  const MANIFIESTO = 'tests/conta/produccion/tanda-i01b-asiento-303-20261018.txt'
  const viva = leerTanda(MANIFIESTO)
  // La respuesta REAL de la consulta de contexto del workflow, lanzada en solo
  // lectura en producción el 18/10 a las 14:46 UTC para ESTOS ficheros (con sus md5).
  const medida = JSON.parse(readFileSync('tests/conta/produccion/contexto-produccion-i01b-asiento-303-20261018.json', 'utf8'))
  const ctx = medida.contexto
  const leer = (r: string) => { try { return readFileSync(r, 'utf8') } catch { return null } }
  const r = informe(viva, ctx, {}, leer) as { markdown: string; ficheros: Record<string, string> }

  it('seis ficheros, los medidos; todos siguen (ninguno pide «autorizo») y no tocan el camino del pedido', () => {
    expect(viva.map((f) => f.replace(/^.*\//, ''))).toEqual(['20261122T0180_i01b_asiento_303.sql', '20261122T0190_i01b_calendario.sql',
      '20261122T0200_i01b_declaracion.sql', '20261122T0210_i01b_presentados.sql', '20261122T0220_i01b_certificados.sql', '20261122T0230_i01b_asesoria.sql'])
    expect(Object.keys(medida.tanda)).toEqual(viva)
    for (const f of viva) expect(createHash('md5').update(readFileSync(f)).digest('hex'), f).toBe(medida.tanda[f])
    expect(Object.values(r.ficheros)).toEqual(['sigue', 'sigue', 'sigue', 'sigue', 'sigue', 'sigue'])
    expect(ctx.tablas).toEqual(['public.bank_match', 'public.bank_match_item', 'public.journal_entry'])
    expect(ctx.funciones).toEqual(['public.conta_impuesto_estado_vale(text,text)', 'public.conta_motivos_para_validar(uuid)'])
    expect(ctx.camino).toEqual({ tablas: [], funciones: [] })
    expect(ctx.registro).toEqual([])
  })
  it('cada objeto que cambia en caliente está en la cabecera, con su prueba de staging, que existe y lo nombra', () => {
    const cab = readFileSync(viva[0], 'utf8').split('\n').filter((l) => /^-- cambia:/.test(l))
    const objetos = cab.map((l) => l.replace(/^-- cambia: (\S+).*$/, '$1'))
    expect(objetos).toEqual(['public.conta_motivos_para_validar', 'public.conta_impuesto_estado_vale', 'public.bank_match_item', 'public.bank_match', 'public.journal_entry'])
    for (const l of cab) {
      const prueba = readFileSync(l.replace(/^.*prueba: (\S+).*$/, '$1'), 'utf8')
      expect(prueba, l).toMatch(new RegExp(`\\b${l.replace(/^-- cambia: public\.(\S+).*$/, '$1')}\\b`))
    }
  })
  it('declara qué cuenta; la cuenta solo lee y va por Foodint', () => {
    const cuentas = readFileSync(MANIFIESTO, 'utf8').split('\n').filter((l) => l.startsWith('cuenta:')).map((l) => l.replace(/^cuenta:\s*/, '').trim())
    expect(cuentas).toEqual(['scripts/conta/produccion/cuentas/i01b-asiento-303.sql'])
    const c = readFileSync(cuentas[0], 'utf8')
    const fuera = c.replace(/--.*$/gm, '').replace(/'(?:[^']|'')*'/g, "''")
    expect(fuera).not.toMatch(/\b(insert|update|delete|create|drop|alter|grant|perform)\b/i)
    expect(c).toContain("'51ad1792-6629-4ef7-833a-b57b09a86710'")
  })
  it('su vuelta atrás: los seis .down.sql en orden inverso, con la misma cuenta; la 0180 para si ya hay liquidaciones o pagos casados; cada una la ensaya staging', () => {
    const atras = leerTanda('tests/conta/produccion/vuelta-atras-i01b-asiento-303-20261018.txt')
    expect(atras).toEqual([...viva].reverse().map((f) => f.replace('supabase/migrations/', 'supabase/vuelta-atras/').replace(/\.sql$/, '.down.sql')))
    expect(readFileSync('tests/conta/produccion/vuelta-atras-i01b-asiento-303-20261018.txt', 'utf8')).toContain('cuenta: scripts/conta/produccion/cuentas/i01b-asiento-303.sql')
    expect(readFileSync(atras[5], 'utf8')).toMatch(/raise exception 'I01b 0180 vuelta atrás/)
    expect(readFileSync(atras[0], 'utf8')).toMatch(/raise exception 'I01b 0230 vuelta atrás/)
    const pruebas: Record<string, string> = {
      '0180': 'supabase/staging/sql/20261122_i01b_vuelta_atras_prueba.sql', '0190': 'supabase/staging/sql/20261122_i01b_calendario_prueba.sql',
      '0200': 'supabase/staging/sql/20261122_i01b_declaracion_prueba.sql', '0210': 'supabase/staging/sql/20261122_i01b_presentados_prueba.sql',
      '0220': 'supabase/staging/sql/20261122_i01b_certificados_prueba.sql', '0230': 'supabase/staging/sql/20261122_i01b_asesoria_prueba.sql',
    }
    for (const [i, f] of viva.entries()) {
      const prueba = readFileSync(pruebas[f.slice(f.indexOf('T') + 1, f.indexOf('T') + 5)], 'utf8')
      expect(prueba, f).toContain(`\\i ${f}`)
      expect(prueba, f).toContain(`\\i ${atras[atras.length - 1 - i]}`)
    }
  })
})

describe('la tanda del S01d (0160–0170, PR #236), ya aplicada: su copia y su contexto medido', () => {
  const MANIFIESTO = 'tests/conta/produccion/tanda-s01d-tanda-20261018.txt'
  const viva = leerTanda(MANIFIESTO)
  // La respuesta REAL de la consulta de contexto del workflow, lanzada en solo
  // lectura en producción el 18/10 a las 09:25 UTC para ESTOS ficheros (con sus md5).
  const medida = JSON.parse(readFileSync('tests/conta/produccion/contexto-produccion-s01d-tanda-20261018.json', 'utf8'))
  const ctx = medida.contexto
  const leer = (r: string) => { try { return readFileSync(r, 'utf8') } catch { return null } }
  const r = informe(viva, ctx, {}, leer) as { markdown: string; ficheros: Record<string, string> }

  it('dos ficheros, en orden y los medidos; los dos siguen (ninguno pide «autorizo»)', () => {
    expect(viva.map((f) => f.replace(/^.*\//, '').slice(0, 13))).toEqual(['20261122T0160', '20261122T0170'])
    expect(Object.keys(medida.tanda)).toEqual(viva)
    for (const f of viva) expect(createHash('md5').update(readFileSync(f)).digest('hex'), f).toBe(medida.tanda[f])
    expect(Object.values(r.ficheros)).toEqual(['sigue', 'sigue'])
    expect(ctx.tablas).toEqual(['public.journal_entry_document'])
    expect(ctx.camino).toEqual({ tablas: [], funciones: [] })
    expect(ctx.funciones).toEqual([])
    expect(ctx.registro).toEqual([])
  })
  it('la 0160 cambia en caliente journal_entry_document (su CHECK solo amplía), declarado en la cabecera con su prueba de staging, que existe y lo nombra', () => {
    const cab = readFileSync(viva[0], 'utf8').split('\n').find((l) => /^-- cambia:/.test(l))!
    expect(cab).toContain('cambia: public.journal_entry_document')
    const prueba = cab.replace(/^.*prueba: (\S+).*$/, '$1')
    expect(readFileSync(prueba, 'utf8')).toContain('journal_entry_document')
    expect(readFileSync(viva[0], 'utf8')).toContain("check (kind = any (array['resumen_ventas', 'factura_recibida', 'factura_expedida']))")
  })
  it('declara qué cuenta; la cuenta solo lee, va por Foodint y cuenta lo nuevo sin nombrarlo fuera de una cadena', () => {
    const cuentas = readFileSync(MANIFIESTO, 'utf8').split('\n').filter((l) => l.startsWith('cuenta:')).map((l) => l.replace(/^cuenta:\s*/, '').trim())
    expect(cuentas).toEqual(['scripts/conta/produccion/cuentas/s01d-tanda.sql'])
    const c = readFileSync(cuentas[0], 'utf8')
    const fuera = c.replace(/--.*$/gm, '').replace(/'(?:[^']|'')*'/g, "''")
    expect(fuera).not.toMatch(/\b(insert|update|delete|create|drop|alter|grant|perform)\b/i)
    expect(c).toContain("'51ad1792-6629-4ef7-833a-b57b09a86710'")
  })
  it('su vuelta atrás: los dos .down.sql en orden inverso, con la misma cuenta; la 0160 para si ya hay un PDF de expedida, y las dos las ensaya staging', () => {
    const atras = leerTanda('tests/conta/produccion/vuelta-atras-s01d-tanda-20261018.txt')
    expect(atras).toEqual([...viva].reverse().map((f) => f.replace('supabase/migrations/', 'supabase/vuelta-atras/').replace(/\.sql$/, '.down.sql')))
    expect(readFileSync('tests/conta/produccion/vuelta-atras-s01d-tanda-20261018.txt', 'utf8')).toContain('cuenta: scripts/conta/produccion/cuentas/s01d-tanda.sql')
    expect(readFileSync(atras[1], 'utf8')).toMatch(/raise exception 'S01d 0160 vuelta atrás/)
    expect(readFileSync('supabase/staging/sql/20261122_s01d_documento_expedida_prueba.sql', 'utf8')).toContain(`\\i ${atras[1]}`)
    expect(readFileSync('supabase/staging/sql/20261122_s01d_banco_nuevo_prueba.sql', 'utf8')).toContain(`\\i ${atras[0]}`)
  })
})

describe('la tanda de impuestos por dentro (I01a, 0100–0150, PR #232), ya aplicada: su copia y su contexto medido', () => {
  const MANIFIESTO = 'tests/conta/produccion/tanda-i01a-impuestos-20261018.txt'
  const viva = leerTanda(MANIFIESTO)
  // La respuesta REAL de la consulta de contexto del workflow, lanzada en solo
  // lectura en producción el 18/10 a las 06:40 UTC para ESTOS ficheros (con sus md5).
  const medida = JSON.parse(readFileSync('tests/conta/produccion/contexto-produccion-i01a-impuestos-20261018.json', 'utf8'))
  const ctx = medida.contexto
  const leer = (r: string) => { try { return readFileSync(r, 'utf8') } catch { return null } }
  const r = informe(viva, ctx, {}, leer) as { markdown: string; ficheros: Record<string, string> }

  it('seis ficheros, en orden y los medidos; cinco siguen y la 0130 (vault.create_secret dentro de una función) pide «autorizo»', () => {
    expect(viva.map((f) => f.replace(/^.*\//, '').slice(0, 13))).toEqual(['20261122T0100', '20261122T0110', '20261122T0120', '20261122T0130', '20261122T0140', '20261122T0150'])
    expect(Object.keys(medida.tanda)).toEqual(viva)
    for (const f of viva) expect(createHash('md5').update(readFileSync(f)).digest('hex'), f).toBe(medida.tanda[f])
    expect(Object.values(r.ficheros)).toEqual(['sigue', 'sigue', 'sigue', 'autorizo', 'sigue', 'sigue'])
    expect(ctx.camino).toEqual({ tablas: [], funciones: [] })
    expect(ctx.funciones).toEqual([])
    expect(ctx.registro).toEqual([])
  })
  it('el comentario del manifiesto dice, para «autorizo», exactamente ese fichero', () => {
    const l = readFileSync(MANIFIESTO, 'utf8').split('\n')
    const i = l.findIndex((x) => /^#\s*autorizo:\s*$/.test(x))
    expect(l[i + 1].replace(/^#\s*/, '').trim()).toBe('20261122T0130_i01_certificados.sql')
  })
  it('la 0110 cambia en caliente company_tax_profile (su disparador), declarado en la cabecera con su prueba de staging, que existe y lo nombra', () => {
    const cab = readFileSync(viva[1], 'utf8').split('\n').find((l) => /^-- cambia:/.test(l))!
    expect(cab).toContain('cambia: public.company_tax_profile')
    const prueba = cab.replace(/^.*prueba: (\S+).*$/, '$1')
    expect(readFileSync(prueba, 'utf8')).toContain('company_tax_profile')
  })
  it('declara qué cuenta; la cuenta solo lee, va por Foodint y cuenta lo nuevo sin nombrarlo fuera de una cadena', () => {
    const cuentas = readFileSync(MANIFIESTO, 'utf8').split('\n').filter((l) => l.startsWith('cuenta:')).map((l) => l.replace(/^cuenta:\s*/, '').trim())
    expect(cuentas).toEqual(['scripts/conta/produccion/cuentas/i01a-impuestos.sql'])
    const c = readFileSync(cuentas[0], 'utf8')
    const fuera = c.replace(/--.*$/gm, '').replace(/'(?:[^']|'')*'/g, "''")
    expect(fuera).not.toMatch(/\b(insert|update|delete|create|drop|alter|grant|perform)\b/i)
    expect(fuera).not.toMatch(/\b(from|join)\s+(public\.)?(tax_obligation|tax_return|tax_certificate|tax_holiday)\b/i)
    expect(c).toContain("'51ad1792-6629-4ef7-833a-b57b09a86710'")
  })
  it('su vuelta atrás: los seis .down.sql en orden inverso, con la misma cuenta; los que perderían algo de personas paran antes', () => {
    const atras = leerTanda('tests/conta/produccion/vuelta-atras-i01a-impuestos-20261018.txt')
    expect(atras).toEqual([...viva].reverse().map((f) => f.replace('supabase/migrations/', 'supabase/vuelta-atras/').replace(/\.sql$/, '.down.sql')))
    expect(readFileSync('tests/conta/produccion/vuelta-atras-i01a-impuestos-20261018.txt', 'utf8')).toContain('cuenta: scripts/conta/produccion/cuentas/i01a-impuestos.sql')
    for (const [f, n] of [[atras[0], '0150'], [atras[1], '0140'], [atras[2], '0130'], [atras[4], '0110']]) {
      expect(readFileSync(f, 'utf8'), f).toMatch(new RegExp(`raise exception 'I01a ${n} vuelta atrás`))
    }
    // La de staging la ensaya entera: hacia delante, atrás y otra vez delante.
    const prueba = readFileSync('supabase/staging/sql/20261122_i01_vuelta_atras_prueba.sql', 'utf8')
    for (const f of [...viva, ...atras]) expect(prueba, f).toContain(`\\i ${f}`)
  })
})

describe('la tanda del esqueleto de Sumied (S01, 0100–0160, PR #226), ya aplicada: su copia y su contexto medido', () => {
  const MANIFIESTO = 'tests/conta/produccion/tanda-s01-esqueleto-20261017.txt'
  const viva = leerTanda(MANIFIESTO)
  // La respuesta REAL de la consulta de contexto del workflow, lanzada en solo
  // lectura en producción el 17/10 a las 19:40 UTC para ESTOS ficheros (con sus md5).
  const ctx = JSON.parse(readFileSync('tests/conta/produccion/contexto-produccion-s01-esqueleto-20261017.json', 'utf8')).contexto
  const leer = (r: string) => { try { return readFileSync(r, 'utf8') } catch { return null } }
  const r = informe(viva, ctx, {}, leer) as { markdown: string; ficheros: Record<string, string> }

  it('siete ficheros, en orden; seis siguen y la 0110 (update de company) pide «autorizo»', () => {
    expect(viva.map((f) => f.replace(/^.*\//, '').slice(0, 13))).toEqual(['20261121T0100', '20261121T0110', '20261121T0120', '20261121T0130', '20261121T0140', '20261121T0150', '20261121T0160'])
    expect(Object.values(r.ficheros)).toEqual(['sigue', 'autorizo', 'sigue', 'sigue', 'sigue', 'sigue', 'sigue'])
    expect(ctx.camino).toEqual({ tablas: [], funciones: [] })
  })
  it('la 0140 y la 0150 cambian en caliente, declaradas en su cabecera con su prueba de staging, que existe y nombra la función', () => {
    for (const [f, fn] of [[viva[4], 'conta_motivos_para_validar'], [viva[5], 'banco_facturas_recibidas_pendientes']]) {
      const cab = readFileSync(f, 'utf8').split('\n').find((l) => /^-- cambia:/.test(l))!
      const prueba = cab.replace(/^.*prueba: (\S+).*$/, '$1')
      expect(cab).toContain(`cambia: ${fn}`)
      expect(readFileSync(prueba, 'utf8')).toContain(fn)
    }
  })
  it('declara qué cuenta; la cuenta solo lee, va por Foodint y cuenta lo nuevo sin nombrarlo fuera de una cadena', () => {
    const cuentas = readFileSync(MANIFIESTO, 'utf8').split('\n').filter((l) => l.startsWith('cuenta:')).map((l) => l.replace(/^cuenta:\s*/, '').trim())
    expect(cuentas).toEqual(['scripts/conta/produccion/cuentas/s01-esqueleto.sql'])
    const c = readFileSync(cuentas[0], 'utf8')
    const fuera = c.replace(/--.*$/gm, '').replace(/'(?:[^']|'')*'/g, "''")
    expect(fuera).not.toMatch(/\b(insert|update|delete|create|drop|alter|grant|perform)\b/i)
    expect(fuera).not.toMatch(/\b(from|join)\s+(public\.)?(conta_user_pref|conta_eje_analitico)\b/i)
    expect(c).toContain("'51ad1792-6629-4ef7-833a-b57b09a86710'")
  })
  it('su vuelta atrás: los siete .down.sql en orden inverso, con la misma cuenta; los que borran datos de personas paran antes', () => {
    const atras = leerTanda('tests/conta/produccion/vuelta-atras-s01-esqueleto-20261017.txt')
    expect(atras).toEqual([...viva].reverse().map((f) => f.replace('supabase/migrations/', 'supabase/vuelta-atras/').replace(/\.sql$/, '.down.sql')))
    expect(readFileSync('tests/conta/produccion/vuelta-atras-s01-esqueleto-20261017.txt', 'utf8')).toContain('cuenta: scripts/conta/produccion/cuentas/s01-esqueleto.sql')
    for (const f of [atras[0], atras[3], atras[4], atras[6]]) expect(readFileSync(f, 'utf8'), f).toMatch(/raise exception 'S01 01[0236]0 vuelta atrás/)
  })
})

describe('la tanda del fin del relevo del secreto del despacho (W02, 0200), ya en el historial: su copia y su contexto medido', () => {
  const MANIFIESTO = 'tests/conta/produccion/tanda-w02-secreto-despacho-20261017.txt'
  const viva = leerTanda(MANIFIESTO)
  // La respuesta REAL de la consulta de contexto del workflow, lanzada en solo
  // lectura en producción el 17/10 a las 15:59 UTC para ESTE fichero (con su md5),
  // con la 0100 ya en el historial y los dos secretos del relevo en Vault.
  const ctx = JSON.parse(readFileSync('tests/conta/produccion/contexto-produccion-w02-secreto-despacho-20261017.json', 'utf8')).contexto
  const leer = (r: string) => { try { return readFileSync(r, 'utf8') } catch { return null } }
  const r = informe(viva, ctx, {}, leer) as { markdown: string; ficheros: Record<string, string> }

  it('un fichero, AUTORIZO: borra en vault.secrets, que existe', () => {
    expect(viva).toEqual(['supabase/migrations/20261120T0200_w02_secreto_despacho_fin_relevo.sql'])
    expect(ctx.tablas).toEqual(['vault.secrets'])
    expect(r.ficheros).toEqual({ [viva[0]]: 'autorizo' })
  })
  it('el comentario del manifiesto dice, para «autorizo», exactamente ese fichero', () => {
    const l = readFileSync(MANIFIESTO, 'utf8').split('\n')
    const i = l.findIndex((x) => /^#\s*autorizo:\s*$/.test(x))
    expect(l[i + 1].replace(/^#\s*/, '').trim()).toBe('20261120T0200_w02_secreto_despacho_fin_relevo.sql')
  })
  it('solo borra el _anterior, y para si no hay secreto vivo', () => {
    const sql = readFileSync(viva[0], 'utf8').replace(/--.*$/gm, '')
    expect(sql).toMatch(/delete from vault\.secrets where name = 'catcher_dispatch_secret_anterior'/)
    expect(sql).not.toMatch(/delete from vault\.secrets where name = 'catcher_dispatch_secret'\s*;/)
    expect(sql).toMatch(/raise exception 'W02: no hay catcher_dispatch_secret en Vault/)
  })
  it('declara qué cuenta: la misma cuenta del relevo, que ve si queda el _anterior', () => {
    const cuentas = readFileSync(MANIFIESTO, 'utf8').split('\n').filter((l) => l.startsWith('cuenta:')).map((l) => l.replace(/^cuenta:\s*/, '').trim())
    expect(cuentas).toEqual(['scripts/conta/produccion/cuentas/w02-secreto-despacho.sql'])
    expect(readFileSync(cuentas[0], 'utf8')).toContain("'catcher_dispatch_secret_anterior'")
  })
  it('sin vuelta atrás, a propósito: no hay .down.sql y el manifiesto de vuelta atrás no lista ninguno (el modo vuelta_atras para)', () => {
    expect(existsSync('supabase/vuelta-atras/20261120T0200_w02_secreto_despacho_fin_relevo.down.sql')).toBe(false)
    expect(leerTanda('tests/conta/produccion/vuelta-atras-w02-secreto-despacho-20261017.txt')).toEqual([])
    expect(readFileSync('tests/conta/produccion/vuelta-atras-w02-secreto-despacho-20261017.txt', 'utf8')).toMatch(/NINGUNA, a propósito/)
    expect(readFileSync(MANIFIESTO, 'utf8')).toMatch(/SIN VUELTA ATRÁS, a propósito/)
  })
})

describe('la tanda del relevo del secreto del despacho (W02, 0100; PR #225), ya aplicada (real de las 15:54 UTC del 17/10): su copia y su contexto medido', () => {
  const MANIFIESTO = 'tests/conta/produccion/tanda-w02-secreto-relevo-20261017.txt'
  const viva = leerTanda(MANIFIESTO)
  // La respuesta REAL de la consulta de contexto del workflow, lanzada en solo
  // lectura en producción el 17/10 a las 12:52 UTC para ESTE fichero (con su md5).
  const ctx = JSON.parse(readFileSync('tests/conta/produccion/contexto-produccion-w02-secreto-relevo-20261017.json', 'utf8')).contexto
  const leer = (r: string) => { try { return readFileSync(r, 'utf8') } catch { return null } }
  const r = informe(viva, ctx, {}, leer) as { markdown: string; ficheros: Record<string, string> }

  it('un fichero, AUTORIZO: escribe en vault.secrets, que existe', () => {
    expect(viva).toEqual(['supabase/migrations/20261120T0100_w02_secreto_despacho_relevo.sql'])
    expect(ctx.tablas).toEqual(['vault.secrets'])
    expect(r.ficheros).toEqual({ [viva[0]]: 'autorizo' })
  })
  it('el comentario del manifiesto dice, para «autorizo», exactamente ese fichero', () => {
    const l = readFileSync(MANIFIESTO, 'utf8').split('\n')
    const i = l.findIndex((x) => /^#\s*autorizo:\s*$/.test(x))
    expect(l[i + 1].replace(/^#\s*/, '').trim()).toBe('20261120T0100_w02_secreto_despacho_relevo.sql')
  })
  it('el secreto nuevo se genera dentro de la base: el fichero no lleva ningún valor', () => {
    const sql = readFileSync(viva[0], 'utf8')
    expect(sql).toMatch(/vault\.update_secret\(v_id, encode\(extensions\.gen_random_bytes\(32\), 'hex'\)\)/)
    expect(sql).not.toMatch(/fv_c[A-Za-z0-9_]{8,}/)
    expect(sql).not.toMatch(/'[0-9a-f]{32,}'/)
  })
  it('declara qué cuenta; la cuenta existe, solo lee y no saca valores, solo huellas cortas', () => {
    const cuentas = readFileSync(MANIFIESTO, 'utf8').split('\n').filter((l) => l.startsWith('cuenta:')).map((l) => l.replace(/^cuenta:\s*/, '').trim())
    expect(cuentas).toEqual(['scripts/conta/produccion/cuentas/w02-secreto-despacho.sql'])
    const c = readFileSync(cuentas[0], 'utf8')
    const fuera = c.replace(/--.*$/gm, '').replace(/'(?:[^']|'')*'/g, "''")
    expect(fuera).not.toMatch(/\b(insert|update|delete|create|drop|alter|grant|perform)\b/i)
    // Todo decrypted_secret que sale, sale dentro de left(md5(…), 12).
    expect((fuera.match(/decrypted_secret\b(?! from)/g) ?? []).length).toBe((fuera.match(/left\(md5\(decrypted_secret\), 12\)/g) ?? []).length)
  })
  it('su vuelta atrás era un fichero, con la misma cuenta, y dejaba el de antes', () => {
    expect(leerTanda('tests/conta/produccion/vuelta-atras-w02-secreto-relevo-20261017.txt')).toEqual(['supabase/vuelta-atras/20261120T0100_w02_secreto_despacho_relevo.down.sql'])
    expect(readFileSync('tests/conta/produccion/vuelta-atras-w02-secreto-relevo-20261017.txt', 'utf8')).toContain('cuenta: scripts/conta/produccion/cuentas/w02-secreto-despacho.sql')
    const atras = readFileSync('supabase/vuelta-atras/20261120T0100_w02_secreto_despacho_relevo.down.sql', 'utf8')
    expect(atras).toMatch(/perform vault\.update_secret\(v_id, v_ant\)/)
    expect(atras).toMatch(/raise exception/)
  })
})

describe('la tanda de la dirección que no llega (R03, 0300, 0310 y 0320; PR #219), ya aplicada: su copia y su contexto medido', () => {
  const MANIFIESTO = 'tests/conta/produccion/tanda-r03-direccion-20261017.txt'
  const viva = leerTanda(MANIFIESTO)
  // La respuesta REAL de la consulta de contexto del workflow, lanzada en solo
  // lectura en producción el 17/10 a las 04:25 UTC para ESTOS ficheros (con su md5).
  const ctx = JSON.parse(readFileSync('tests/conta/produccion/contexto-produccion-r03-direccion-20261017.json', 'utf8')).contexto
  const leer = (r: string) => { try { return readFileSync(r, 'utf8') } catch { return null } }
  const r = informe(viva, ctx, {}, leer) as { markdown: string; ficheros: Record<string, string> }

  it('tres ficheros, los tres en el camino del pedido: autorizo con su nombre', () => {
    expect(viva).toEqual(['supabase/migrations/20261118T0300_r03_direccion_incompleta.sql',
      'supabase/migrations/20261118T0310_r03_ticket_codigo_quien_reparte.sql', 'supabase/migrations/20261118T0320_r03_entrega_datos.sql'])
    expect(r.ficheros).toEqual({ [viva[0]]: 'autorizo', [viva[1]]: 'autorizo', [viva[2]]: 'autorizo' })
  })
  it('la 0300 y la 0310 declaran lo que cambian en caliente, con su prueba de staging', () => {
    const a = readFileSync(viva[0], 'utf8'), b = readFileSync(viva[1], 'utf8')
    expect(a).toContain('-- cambia: public.resolve_dispatch · prueba: supabase/staging/sql/20261118_r03_direccion_incompleta_prueba.sql')
    for (const o of ['public.pedidos_sin_direccion', 'public.orders_feed', 'public.orders_feed_by_token', 'public.order_for_print', 'public.sale']) {
      expect(b).toContain(`-- cambia: ${o} · prueba: supabase/staging/sql/20261118_r03_ticket_codigo_quien_reparte_prueba.sql`)
    }
    for (const f of ['supabase/staging/sql/20261118_r03_direccion_incompleta_prueba.sql', 'supabase/staging/sql/20261118_r03_ticket_codigo_quien_reparte_prueba.sql']) expect(existsSync(f), f).toBe(true)
  })
  it('ninguna borra ni hace obligatoria una columna de sale; anon sigue sin sale_coordenadas_de_entrega', () => {
    for (const f of viva) {
      const sql = readFileSync(f, 'utf8').replace(/--.*$/gm, '')
      expect(sql, f).not.toMatch(/drop\s+column|set\s+not\s+null|drop\s+table\s+(if exists\s+)?public\.sale\b/i)
      expect(sql, f).not.toMatch(/grant[^;]*sale_coordenadas_de_entrega\(uuid\)[^;]*to[^;]*anon/i)
    }
  })
  it('declara qué cuenta; la cuenta existe y solo lee', () => {
    const cuentas = readFileSync(MANIFIESTO, 'utf8').split('\n').filter((l) => l.startsWith('cuenta:')).map((l) => l.replace(/^cuenta:\s*/, '').trim())
    expect(cuentas).toEqual(['scripts/conta/produccion/cuentas/r03-direccion.sql'])
    for (const c of cuentas) expect(existsSync(c), c).toBe(true)
    const fuera = readFileSync(cuentas[0], 'utf8').replace(/--.*$/gm, '').replace(/'(?:[^']|'')*'/g, "''")
    expect(fuera).not.toMatch(/\b(insert|update|delete|create|drop|alter|grant)\b/i)
  })
  it('su vuelta atrás va en orden inverso, y la de la 0300 para si hay direcciones completadas', () => {
    const atras = leerTanda('tests/conta/produccion/vuelta-atras-r03-direccion-20261017.txt')
    expect(atras).toEqual(['supabase/vuelta-atras/20261118T0320_r03_entrega_datos.down.sql',
      'supabase/vuelta-atras/20261118T0310_r03_ticket_codigo_quien_reparte.down.sql', 'supabase/vuelta-atras/20261118T0300_r03_direccion_incompleta.down.sql'])
    expect(readFileSync(atras[2], 'utf8')).toMatch(/raise exception/)
  })
})

describe('la tanda de las promociones y los envíos en el asiento de ventas del día (C06b, 0100 y 0110; ya aplicada, real 38954792366), tal cual', () => {
  const MANIFIESTO = 'tests/conta/produccion/tanda-c06b-promociones-envios-20261016.txt'
  const viva = leerTanda(MANIFIESTO)
  // La respuesta REAL de la consulta de contexto del workflow, lanzada en solo
  // lectura en producción el 16/10 para ESTOS ficheros (con su md5).
  const ctx = JSON.parse(readFileSync('tests/conta/produccion/contexto-produccion-c06b-promociones-envios-20261016.json', 'utf8')).contexto
  const leer = (r: string) => { try { return readFileSync(r, 'utf8') } catch { return null } }
  const r = informe(viva, ctx, {}, leer) as { markdown: string; ficheros: Record<string, string> }

  it('dos ficheros, los dos «sigue»: la 0100 añade y cambia lo declarado; la 0110 solo inserta', () => {
    expect(viva).toEqual(['supabase/migrations/20261116T0100_c06b_promociones_envios.sql', 'supabase/migrations/20261116T0110_c06b_promociones_envios_datos.sql'])
    expect(r.ficheros).toEqual({ [viva[0]]: 'sigue', [viva[1]]: 'sigue' })
  })
  it('la 0100 declara lo que cambia, con su prueba de staging, y no toca ninguna tabla del camino del pedido', () => {
    const sql = readFileSync(viva[0], 'utf8')
    for (const o of ['public.conta_propuesta_ventas_unidad', 'public.conta_resumen_ventas', 'public.journal_entry']) {
      expect(sql).toContain(`-- cambia: ${o} · prueba: supabase/staging/sql/20261116_c06b_promociones_envios_prueba.sql`)
    }
    expect(existsSync('supabase/staging/sql/20261116_c06b_promociones_envios_prueba.sql')).toBe(true)
    expect(sql.replace(/--.*$/gm, '')).not.toMatch(/references public\.sale\b/)
    expect(sql.replace(/--.*$/gm, '')).not.toMatch(/^\s*(alter|drop)\s+table\s+(if exists\s+)?public\.(sale|sales_)/im)
  })
  it('la 0110 solo inserta, anclada a Foodint, y para si las subcuentas ya existen', () => {
    const sql = readFileSync(viva[1], 'utf8').replace(/--.*$/gm, '')
    expect(sql).not.toMatch(/^\s*(update|delete)\b/im)
    expect(sql).toContain("'51ad1792-6629-4ef7-833a-b57b09a86710'")
    for (const c of ["('70009001', '700', 'PROMOCIONES UBER EATS')", "('70009002', '700', 'PROMOCIONES GLOVO')", "('70009003', '700', 'PROMOCIONES JUST EAT')", "('70500001', '705', 'ENVÍOS COBRADOS')"]) expect(sql).toContain(c)
    expect(sql).toMatch(/ya existen; alguien las ha creado/)
  })
  it('declara qué cuenta; la cuenta existe y no nombra las tablas nuevas fuera de una cadena', () => {
    const cuentas = readFileSync(MANIFIESTO, 'utf8').split('\n').filter((l) => l.startsWith('cuenta:')).map((l) => l.replace(/^cuenta:\s*/, '').trim())
    expect(cuentas).toEqual(['scripts/conta/produccion/cuentas/promociones-envios.sql'])
    for (const c of cuentas) expect(existsSync(c), c).toBe(true)
    const fuera = readFileSync(cuentas[0], 'utf8').replace(/--.*$/gm, '').replace(/'(?:[^']|'')*'/g, "''")
    expect(fuera).toMatch(/to_regclass/)
  })
  it('su vuelta atrás va en orden inverso y cada fichero para si se perdería algo', () => {
    const atras = leerTanda('tests/conta/produccion/vuelta-atras-c06b-promociones-envios-20261016.txt')
    expect(atras).toEqual(['supabase/vuelta-atras/20261116T0110_c06b_promociones_envios_datos.down.sql', 'supabase/vuelta-atras/20261116T0100_c06b_promociones_envios.down.sql'])
    for (const f of atras) expect(readFileSync(f, 'utf8'), f).toMatch(/raise exception/)
  })
})

describe('la tanda de DATOS de las recibidas abiertas en C0008 para la empresa de Foodint (C06b, Julio, 15/10; ya en el historial de producción, run #98), tal cual', () => {
  const MANIFIESTO = 'tests/conta/produccion/tanda-c06b-recibidas-abiertas-20261016.txt'
  const viva = leerTanda(MANIFIESTO)
  // La respuesta REAL de la consulta de contexto del workflow, lanzada en solo
  // lectura en producción el 16/10 a las 05:42 UTC para ESTE fichero (con su md5).
  const ctx = JSON.parse(readFileSync('tests/conta/produccion/contexto-produccion-c06b-recibidas-abiertas-20261016.json', 'utf8')).contexto
  const leer = (r: string) => { try { return readFileSync(r, 'utf8') } catch { return null } }
  const r = informe(viva, ctx, {}, leer) as { markdown: string; ficheros: Record<string, string> }

  it('un fichero: la 0760 cambia una fila que existe; pide autorizo con su nombre', () => {
    expect(viva).toEqual(['supabase/migrations/20261111T0760_c06b_diez_recibidas_abiertas_datos.sql'])
    expect(r.ficheros).toEqual({ [viva[0]]: 'autorizo' })
  })
  it('lo que cambia: solo incluye_recibidas (y la nota del motivo) de la de empresa en C0008 desde el 01/10; no inserta ni borra', () => {
    const sql = readFileSync(viva[0], 'utf8')
    expect(sql).toMatch(/v_cuenta\s+constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710'/)
    expect(sql).toMatch(/set incluye_recibidas = true, motivo = motivo \|\| v_nota/)
    expect(sql).toMatch(/and desde = v_desde and incluye_recibidas = false;/)
    expect(sql).toMatch(/if n <> 1 then/)
    expect(sql).not.toMatch(/^\s*(insert|delete)\b/im)
    expect(sql).not.toMatch(/set desde/)
  })
  it('declara qué cuenta antes y después, y el fichero existe', () => {
    const cuentas = readFileSync(MANIFIESTO, 'utf8').split('\n').filter((l) => l.startsWith('cuenta:')).map((l) => l.replace(/^cuenta:\s*/, '').trim())
    expect(cuentas).toEqual(['scripts/conta/produccion/cuentas/diez-recibidas-abiertas.sql'])
    for (const c of cuentas) expect(existsSync(c), c).toBe(true)
  })
  it('su vuelta atrás la cierra otra vez y para si con ella ya se ha enviado (o intentado escribir) alguna recibida o su contraasiento', () => {
    const atras = leerTanda('tests/conta/produccion/vuelta-atras-c06b-recibidas-abiertas-20261016.txt')
    expect(atras).toEqual(['supabase/vuelta-atras/20261111T0760_c06b_diez_recibidas_abiertas_datos.down.sql'])
    const sql = readFileSync(atras[0], 'utf8')
    expect(sql).toMatch(/je\.source_type = 'supplier_invoice' or anulado\.source_type = 'supplier_invoice'/)
    expect(sql).toMatch(/s\.status in \('enviado', 'enlazado'\) or \(s\.status = 'pendiente' and s\.attempts > 0 and s\.payload_hash <> 'sin-enviar'\)/)
    expect(sql).toMatch(/if n > 0 then\s+raise exception/)
    expect(sql).toMatch(/set incluye_recibidas = false, motivo = replace\(motivo, v_nota, ''\)/)
  })
})

describe('la tanda de DATOS de la empresa de Foodint en C0008 desde el 01/10, solo ventas (C06b, respuesta 8, tarea 1, paso 3; ya aplicada, real desde 1228da9b), tal cual', () => {
  const MANIFIESTO = 'tests/conta/produccion/tanda-c06b-r8-empresa-20261015.txt'
  const viva = leerTanda(MANIFIESTO)
  // La respuesta REAL de la consulta de contexto del workflow, lanzada en solo
  // lectura en producción el 15/10 a las 05:52 UTC para ESTE fichero (con su md5).
  const ctx = JSON.parse(readFileSync('tests/conta/produccion/contexto-produccion-c06b-r8-empresa-20261015.json', 'utf8')).contexto
  const leer = (r: string) => { try { return readFileSync(r, 'utf8') } catch { return null } }
  const r = informe(viva, ctx, {}, leer) as { markdown: string; ficheros: Record<string, string> }

  it('un fichero: la 0750 escribe UNA autorización nueva; sigue', () => {
    expect(viva).toEqual(['supabase/migrations/20261111T0750_c06b_diez_autorizo_empresa_datos.sql'])
    expect(r.ficheros).toEqual({ [viva[0]]: 'sigue' })
  })
  it('lo que escribe: empresa, C0008, desde el 01/10/2026, sin recibidas, por Julio; anclado por cuenta y empresa; no cambia nada que ya esté', () => {
    const sql = readFileSync(viva[0], 'utf8')
    expect(sql).toMatch(/v_cuenta\s+constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710'/)
    expect(sql).toMatch(/v_desde\s+constant date := '2026-10-01'/)
    expect(sql).toMatch(/values \(v_cuenta, v_empresa, 'empresa', null, 'C0008', 'Julio',/)
    expect(sql).toMatch(/v_desde, false\);/)
    expect(sql).not.toMatch(/^\s*(update|delete)\b/im)
    expect(sql).not.toMatch(/C0001/)
  })
  it('declara qué cuenta antes y después, y el fichero existe', () => {
    const cuentas = readFileSync(MANIFIESTO, 'utf8').split('\n').filter((l) => l.startsWith('cuenta:')).map((l) => l.replace(/^cuenta:\s*/, '').trim())
    expect(cuentas).toEqual(['scripts/conta/produccion/cuentas/diez-autorizo-empresa.sql'])
    for (const c of cuentas) expect(existsSync(c), c).toBe(true)
  })
  it('su vuelta atrás quita solo la de empresa y para si con ella ya se ha enviado (o intentado escribir) algo que no cubre un asiento', () => {
    const atras = leerTanda('tests/conta/produccion/vuelta-atras-c06b-r8-empresa-20261015.txt')
    expect(atras).toEqual(['supabase/vuelta-atras/20261111T0750_c06b_diez_autorizo_empresa_datos.down.sql'])
    const sql = readFileSync(atras[0], 'utf8')
    expect(sql).toMatch(/s\.status in \('enviado', 'enlazado'\) or \(s\.status = 'pendiente' and s\.attempts > 0 and s\.payload_hash <> 'sin-enviar'\)/)
    expect(sql).toMatch(/a\.entry_id in \(s\.entry_id, je\.reverses_entry_id\)/)
    expect(sql).toMatch(/if n > 0 then\s+raise exception/)
    expect(sql).toMatch(/delete from public\.conta_diez_autorizo\s+where account_id = v_cuenta and company_id = v_empresa and alcance = 'empresa'/)
  })
})

describe('la tanda B02 · T1 «lo que entra» (0200; ya en el historial de producción), tal cual', () => {
  const MANIFIESTO = 'tests/conta/produccion/tanda-b02-entrada-20261016.txt'
  const viva = leerTanda(MANIFIESTO)
  // La respuesta REAL de la consulta de contexto del workflow, lanzada en solo
  // lectura en producción para ESTE fichero (con su md5): ver el _que del JSON.
  const ctx = JSON.parse(readFileSync('tests/conta/produccion/contexto-produccion-b02-entrada-20261016.json', 'utf8')).contexto
  const leer = (r: string) => { try { return readFileSync(r, 'utf8') } catch { return null } }
  const r = informe(viva, ctx, {}, leer) as { markdown: string; ficheros: Record<string, string> }
  const F = 'supabase/migrations/20261101T0200_b02_entrada.sql'

  it('un fichero, y sigue (sin «autorizo»): lo que cambia en caliente, declarado y con su prueba', () => {
    expect(viva).toEqual([F])
    expect(r.ficheros).toEqual({ [F]: 'sigue' })
    const cabecera = readFileSync(F, 'utf8').split('\n').filter((l) => /^-- cambia:/.test(l)).map((l) => l.replace(/^-- cambia: (\S+) .*$/, '$1'))
    expect(cabecera).toEqual(['public.bank_importar', 'public.bank_casar', 'public.supplier_invoice', 'public.bank_regla_guardar'])
    expect(r.markdown).toContain('declarado, prueba `supabase/staging/sql/20261101_b02_entrada_prueba.sql`')
  })
  it('no toca datos ni crea asientos (contabilidad cerrada a 30/09/2026): ni update, ni delete, ni insert fuera de sus funciones', () => {
    const fuera = readFileSync(F, 'utf8').replace(/--.*$/gm, '').replace(/\$([a-z_]*)\$[\s\S]*?\$\1\$/g, '')
    expect(fuera).not.toMatch(/^\s*(update|delete|insert)\b/im)
  })
  it('declara qué cuenta, y la cuenta existe', () => {
    const cuentas = readFileSync(MANIFIESTO, 'utf8').split('\n').filter((l) => l.startsWith('cuenta:')).map((l) => l.replace(/^cuenta:\s*/, '').trim())
    expect(cuentas).toEqual(['scripts/conta/produccion/cuentas/b02-entrada.sql'])
    for (const c of cuentas) expect(existsSync(c), c).toBe(true)
  })
  it('su vuelta atrás para si se perdería algo (casados con diferencia)', () => {
    const atras = leerTanda('tests/conta/produccion/vuelta-atras-b02-entrada-20261016.txt')
    expect(atras).toEqual(['supabase/vuelta-atras/20261101T0200_b02_entrada.down.sql'])
    for (const f of atras) expect(readFileSync(f, 'utf8'), f).toMatch(/raise exception/)
  })
})

describe('la tanda de las facturas por correo (D01, la 0040 y la 0041; antes 0100 y 0110 del 19), en su carpeta de rama (C10)', () => {
  const MANIFIESTO = 'supabase/produccion/tandas/sumied/conta-d01-facturas-correo/aplicar.txt'
  const F0 = 'supabase/migrations/20261024T0040_d01_facturas_correo.sql'
  const F1 = 'supabase/migrations/20261024T0041_d01_facturas_foodint.sql'
  const viva = leerTanda(MANIFIESTO)
  const ctx = JSON.parse(readFileSync('supabase/produccion/tandas/sumied/conta-d01-facturas-correo/contexto.json', 'utf8'))
  const leer = (r: string) => { try { return readFileSync(r, 'utf8') } catch { return null } }
  const r = informe(viva, ctx.contexto, {}, leer) as { markdown: string; ficheros: Record<string, string> }
  it('dos ficheros, y los dos siguen (sin «autorizo»): la 0100 añade y cambia con la misma firma, declarado y con su prueba; la 0110 solo añade', () => {
    expect(viva).toEqual([F0, F1])
    expect(r.ficheros).toEqual({ [F0]: 'sigue', [F1]: 'sigue' })
    for (const f of viva) expect(ctx.tanda[f]).toBe(createHash('md5').update(readFileSync(f)).digest('hex'))
    const cabecera = readFileSync(F0, 'utf8').split('\n').filter((l) => /^-- cambia:/.test(l)).map((l) => l.replace(/^-- cambia: (\S+) .*$/, '$1'))
    expect(cabecera).toEqual(['public.conta_entrada_llegada'])
  })
  it('la 0110 solo añade: ni update ni delete; inserta una dirección de Foodint y un remitente por su huella, sin la dirección en claro', () => {
    const t = readFileSync(F1, 'utf8')
    expect(t.replace(/--.*$/gm, '')).not.toMatch(/\b(update|delete)\b/i)
    expect(t).toMatch(/'efb721fef32c202a4279b3b73b3111296e5359cf133edcc22ac383e6b2b2f2c8'/)
    expect(t).not.toMatch(/[a-z0-9._-]+@(?!entrada\.folvy\.app)[a-z0-9-]+\.[a-z]{2,}/i)
  })
  it('su vuelta atrás va en orden inverso, y la de la 0100 deja conta_entrada_llegada con el texto de la 0220, tal cual', () => {
    const atras = leerTanda('supabase/produccion/tandas/sumied/conta-d01-facturas-correo/vuelta-atras.txt')
    expect(atras).toEqual(['supabase/vuelta-atras/20261024T0041_d01_facturas_foodint.down.sql', 'supabase/vuelta-atras/20261024T0040_d01_facturas_correo.down.sql'])
    const cuerpo = (t: string) => { const i = t.indexOf('create or replace function public.conta_entrada_llegada('); const a = t.indexOf('$$', i) + 2; return t.slice(a, t.indexOf('$$', a)) }
    expect(cuerpo(readFileSync(atras[1], 'utf8'))).toBe(cuerpo(readFileSync('supabase/migrations/20261021T0220_d01_entrada.sql', 'utf8')))
    expect(cuerpo(readFileSync(F0, 'utf8'))).toContain('Ha vuelto a llegar por correo el ')
  })
  it('declara qué cuenta, y la cuenta solo lee', () => {
    const cuentas = readFileSync(MANIFIESTO, 'utf8').split('\n').filter((l) => l.startsWith('cuenta:')).map((l) => l.replace(/^cuenta:\s*/, '').trim())
    expect(cuentas).toEqual(['scripts/conta/produccion/cuentas/d01-facturas-correo.sql'])
    expect(readFileSync(cuentas[0], 'utf8').replace(/--.*$/gm, '').replace(/'(?:[^']|'')*'/g, "''")).not.toMatch(/\b(update|delete|insert)\b/i)
  })
})

describe('la tanda B02 · T2 «lo ya guardado, legible» (0201; ya en el historial de producción, run real sobre d0d9a74c), tal cual', () => {
  const MANIFIESTO = 'tests/conta/produccion/tanda-b02-relleno-20261016.txt'
  const viva = leerTanda(MANIFIESTO)
  // La respuesta REAL de la consulta de contexto del workflow, lanzada en solo
  // lectura en producción para ESTE fichero (con su md5): ver el _que del JSON.
  const ctx = JSON.parse(readFileSync('tests/conta/produccion/contexto-produccion-b02-relleno-20261016.json', 'utf8')).contexto
  const leer = (r: string) => { try { return readFileSync(r, 'utf8') } catch { return null } }
  const r = informe(viva, ctx, {}, leer) as { markdown: string; ficheros: Record<string, string> }
  const F = 'supabase/migrations/20261101T0201_b02_entrada_relleno.sql'

  it('un fichero, que pide «autorizo» con su nombre entero (es un update sobre filas que existen)', () => {
    expect(viva).toEqual([F])
    expect(r.ficheros).toEqual({ [F]: 'autorizo' })
  })
  it('solo rellena las dos columnas nuevas, solo en los Excel de BBVA y solo donde están vacías; no toca el texto del banco ni el libro', () => {
    const sql = readFileSync(F, 'utf8').replace(/--.*$/gm, '')
    expect(sql.match(/^\s*update\b[\s\S]*?;/gim)).toHaveLength(1)
    expect(sql).toMatch(/set movement_type = [\s\S]*counterparty = /)
    expect(sql).toContain("s.format = 'csv:bbva' and m.movement_type is null and m.counterparty is null")
    expect(sql).not.toMatch(/bank_concept\s*=|journal_|bank_match|insert\b|delete\b/i)
    expect(sql).toMatch(/raise exception/)
  })
  it('declara qué cuenta, y la cuenta mide el tipo y la contraparte', () => {
    const cuentas = readFileSync(MANIFIESTO, 'utf8').split('\n').filter((l) => l.startsWith('cuenta:')).map((l) => l.replace(/^cuenta:\s*/, '').trim())
    expect(cuentas).toEqual(['scripts/conta/produccion/cuentas/b02-entrada.sql'])
    expect(readFileSync(cuentas[0], 'utf8')).toMatch(/movimientos con tipo[\s\S]*movimientos con contraparte/)
  })
  it('su vuelta atrás vacía solo esas dos columnas de los mismos movimientos', () => {
    const atras = leerTanda('tests/conta/produccion/vuelta-atras-b02-relleno-20261016.txt')
    expect(atras).toEqual(['supabase/vuelta-atras/20261101T0201_b02_entrada_relleno.down.sql'])
    const sql = readFileSync(atras[0], 'utf8').replace(/--.*$/gm, '')
    expect(sql).toMatch(/set movement_type = null, counterparty = null/)
    expect(sql).toContain("s.format = 'csv:bbva'")
  })
})

describe('la tanda B02 · T3 «las reglas de Foodint, corregidas» (0210; ya en el historial de producción, run real sobre db0fc5f4), tal cual', () => {
  const MANIFIESTO = 'tests/conta/produccion/tanda-b02-reglas-20261016.txt'
  const viva = leerTanda(MANIFIESTO)
  // La respuesta REAL de la consulta de contexto del workflow, lanzada en solo
  // lectura en producción para ESTE fichero (con su md5): ver el _que del JSON.
  const ctx = JSON.parse(readFileSync('tests/conta/produccion/contexto-produccion-b02-reglas-20261016.json', 'utf8')).contexto
  const leer = (r: string) => { try { return readFileSync(r, 'utf8') } catch { return null } }
  const r = informe(viva, ctx, {}, leer) as { markdown: string; ficheros: Record<string, string> }
  const F = 'supabase/migrations/20261101T0210_b02_reglas_foodint.sql'

  it('un fichero, que pide «autorizo» con su nombre entero (es un update sobre filas que existen)', () => {
    expect(viva).toEqual([F])
    expect(r.ficheros).toEqual({ [F]: 'autorizo' })
  })
  it('toca solo las cuatro reglas por su id, y ANTES de escribir para si falta la 40700001, si una regla ha cambiado o si alguna ha casado algo', () => {
    const sql = readFileSync(F, 'utf8')
    for (const id of ['f2afd853-b93a-43b8-bc1c-fdd5136a0c13', 'a094fd3a-c8e5-4209-a989-52ecb3c862a3', '11f54405-a466-455d-be9c-6583d9ae58be', '103ccdd6-ce74-4464-ab6a-645e43dff288']) expect(sql).toContain(id)
    expect(sql).toContain("'CATCHER DISCO', 'CATCHER'")
    const freno = sql.indexOf('PARO'), escribe = sql.search(/^update public\.bank_rule/m)
    expect(freno).toBeGreaterThan(0)
    expect(freno).toBeLessThan(escribe)
    expect(sql).toMatch(/ha cambiado, vuelve a medir/)
    expect(sql).toMatch(/ya ha casado algo/)
    expect(sql.replace(/--.*$/gm, '')).not.toMatch(/journal_|delete\b/i)
  })
  it('declara qué cuenta; la cuenta mide estado, cuenta, condición y confirmaciones de las cuatro', () => {
    const cuentas = readFileSync(MANIFIESTO, 'utf8').split('\n').filter((l) => l.startsWith('cuenta:')).map((l) => l.replace(/^cuenta:\s*/, '').trim())
    expect(cuentas).toEqual(['scripts/conta/produccion/cuentas/b02-reglas.sql'])
    expect(readFileSync(cuentas[0], 'utf8')).toMatch(/condition->>'contiene'/)
  })
  it('su vuelta atrás devuelve lo de antes desde el registro, también la condición, y para si alguna ha casado algo', () => {
    const atras = leerTanda('tests/conta/produccion/vuelta-atras-b02-reglas-20261016.txt')
    expect(atras).toEqual(['supabase/vuelta-atras/20261101T0210_b02_reglas_foodint.down.sql'])
    const sql = readFileSync(atras[0], 'utf8')
    expect(sql).toMatch(/condition = coalesce\(l\.before->'condicion', r\.condition\)/)
    expect(sql).toMatch(/raise exception/)
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

// 16/10 · Ensayo #92 de la D01: 42703 al crear _conta_liquidacion_solape, una
// función «language sql» que leía channel_settlement.store_id; la 0100 añadía
// esa columna 80 líneas más abajo. Postgres comprueba el cuerpo de una función
// SQL (y la consulta de una vista) al crearla; staging ya tenía la columna de
// una pasada anterior y salió verde. Lo reproduce una base limpia: el fichero
// de 8731545a falla en la línea 161 y el reordenado entra, sale y vuelve a entrar.
describe('nombres ambiguos en PL/pgSQL: tanda y vuelta atrás, el mismo control (16/10, ensayo #103)', () => {
  const cols = (m: Record<string, string[]>) => (t: string) => (m[t] ? new Set(m[t]) : undefined)
  it('la vuelta atrás de 0b0a6a89, la que paró el ensayo #103 con 42702: sus tres inserts dinámicos', () => {
    // Su texto, tal cual estaba en ese commit (la copia de la medida, abajo).
    const viejo = readFileSync('tests/conta/produccion/vuelta-atras-0110-0b0a6a89-42702.sql', 'utf8')
    const r = ambiguosEnPlpgsql(viejo, () => undefined)
    expect(r.map((x) => [x.tipo, x.nombre])).toEqual([['dinamico', 'cols_i'], ['dinamico', 'cols_l'], ['dinamico', 'cols_t']])
  })
  it('con la lista cualificada («x.» || …) no hay nada', () => {
    const t = `do $$ declare a text; b text; begin
  select string_agg(quote_ident(column_name), ', '), string_agg('x.' || quote_ident(column_name), ', ') into a, b from information_schema.columns where table_name = 't';
  execute format('insert into public.t (%1$s) select %2$s from public.copia c, jsonb_populate_record(null::public.t, c.j) x', a, b);
end $$;`
    expect(ambiguosEnPlpgsql(t, () => undefined)).toEqual([])
    expect(ambiguosEnPlpgsql(t.replace('%2$s from', '%1$s from'), () => undefined).map((x) => x.nombre)).toEqual(['a'])
  })
  it('con una sola relación, la lista sin cualificar no es ambigua', () => {
    const t = `do $$ declare a text; begin select string_agg(column_name, ', ') into a from information_schema.columns; execute format('select %s from public.t where true', a); end $$;`
    expect(ambiguosEnPlpgsql(t, () => undefined)).toEqual([])
  })
  it('una variable que se llama como una columna de su tabla, usada sin cualificar (la «tanda» de la 0110)', () => {
    const t = `do $$ declare tanda constant text := 'x'; n int; begin select count(*) into n from public.copia c where c.tanda = tanda; end $$;`
    expect(ambiguosEnPlpgsql(t, cols({ copia: ['id', 'tanda'] }))).toEqual([{ bloque: 'do', tipo: 'variable', nombre: 'tanda', detalle: 'variable con el nombre de una columna de copia' }])
    expect(ambiguosEnPlpgsql(t.replace(/\btanda\b(?! =)/g, 'v_tanda').replace('c.v_tanda', 'c.tanda'), cols({ copia: ['id', 'tanda'] }))).toEqual([])
  })
  it('un parámetro o una columna de «returns table»; y no cuenta donde no se confunde (alias, lista de un insert, set x =, x :=)', () => {
    const f = `create function public.f(estado text) returns table (total numeric) language plpgsql as $$
begin
  total := 0;
  insert into public.t (estado, total) values ('a', 1);
  update public.t set total = 2 where id is null;
  return query select sum(t.total) as total from public.t t where t.estado = estado;
end $$;`
    expect(ambiguosEnPlpgsql(f, cols({ t: ['id', 'estado', 'total'] })).map((x) => x.nombre)).toEqual(['estado'])
    expect(ambiguosEnPlpgsql(f.replace("where t.estado = estado", "where t.estado = $1"), cols({ t: ['id', 'estado', 'total'] }))).toEqual([])
    expect(ambiguosEnPlpgsql(f.replace('begin\n', 'begin\n#variable_conflict use_column\n'), cols({ t: ['id', 'estado', 'total'] }))).toEqual([])
  })
  it('las columnas: de los tipos generados y de lo que crean los ficheros (la copia, is_reference)', () => {
    const c = columnasConocidas(readFileSync('src/types/database.ts', 'utf8'), [
      readFileSync('supabase/migrations/20261115T0100_d01_liquidaciones_corte.sql', 'utf8'),
      readFileSync('supabase/migrations/20261115T0110_d01_liquidaciones_referencia_foodint.sql', 'utf8')])
    expect(c.get('supplier_invoice')?.has('id')).toBe(true)
    expect(c.get('channel_settlement')?.has('is_reference')).toBe(true)
    expect([...(c.get('conta_respaldo_liquidacion_factura') ?? [])]).toEqual(['id', 'tanda', 'settlement_id', 'invoice_id', 'invoice', 'lines', 'taxes', 'saved_at'])
  })
})

describe('el orden dentro de un fichero: nada SQL lee lo que el fichero crea después', () => {
  const forma = (antes: boolean) => {
    const columna = 'alter table public.liquidacion_inventada add column if not exists tienda_id uuid;'
    const fn = `create or replace function public._inventada_solape(p uuid)
returns text language sql stable as $$
  select 'Se solapa con ' || count(*) from public.liquidacion_inventada c where c.id = p and c.tienda_id is not null
$$;`
    return antes ? [columna, fn].join('\n') : [fn, columna].join('\n')
  }
  it('una función SQL que lee una columna que nace más abajo: se dice cuál, dónde y dónde nace', () => {
    expect(ordenEnElFichero(forma(false))).toEqual([{ sentencia: 1, objeto: 'public._inventada_solape', lee: 'public.liquidacion_inventada.tienda_id', nace: 2 }])
    expect(ordenEnElFichero(forma(true))).toEqual([])
  })
  it('una tabla que nace más abajo, también; y en una vista, igual', () => {
    const t = `create view public.v_inventada as select id from public.tabla_inventada;
create table if not exists public.tabla_inventada (id uuid);`
    expect(ordenEnElFichero(t)).toEqual([{ sentencia: 1, objeto: 'public.v_inventada', lee: 'public.tabla_inventada', nace: 2 }])
  })
  it('plpgsql no: su cuerpo se resuelve al ejecutarla (y el nombre dentro de una cadena tampoco cuenta)', () => {
    const t = `create function public.f_inventada() returns void language plpgsql as $$ begin perform tienda_id from public.liquidacion_inventada; end $$;
create function public.g_inventada() returns text language sql as $$ select 'liquidacion_inventada tienda_id' $$;
alter table public.liquidacion_inventada add column tienda_id uuid;`
    expect(ordenEnElFichero(t)).toEqual([])
  })
  it('la población real: los SQL del repositorio no tienen ninguna (si alguno la tuviera, ya habría fallado al aplicarse limpio)', () => {
    const malos: string[] = []
    let n = 0
    for (const d of ['supabase/migrations', 'supabase/vuelta-atras', 'supabase/staging/sql']) {
      for (const f of readdirSync(d).filter((x) => x.endsWith('.sql'))) {
        n++
        if (ordenEnElFichero(readFileSync(`${d}/${f}`, 'utf8')).length) malos.push(`${d}/${f}`)
      }
    }
    expect(n).toBeGreaterThan(1600)
    expect(malos).toEqual([])
  })
  it('la 0100 de la D01, reordenada: ninguna', () => {
    expect(ordenEnElFichero(readFileSync('supabase/migrations/20261113T0100_d01_liquidaciones_correo.sql', 'utf8'))).toEqual([])
  })
})

describe('la tanda de la rama claude/cool-noether-i932tx (C10): D07 + D07b · el IVA no deducible con su motivo (0850), Uber sin provisionales (0860) y las 8 provisionales fuera de recibidas (0870)', () => {
  const MANIFIESTO = 'supabase/produccion/tandas/sumied/claude-cool-noether-i932tx/aplicar.txt'
  const viva = leerTanda(MANIFIESTO)
  // La respuesta REAL de la consulta de contexto del workflow, lanzada en solo
  // lectura en producción el 23/10 a las 15:33 UTC, para ESTOS ficheros.
  const medida = JSON.parse(readFileSync('supabase/produccion/tandas/sumied/claude-cool-noether-i932tx/contexto.json', 'utf8'))
  const ctx = medida.contexto
  const leer = (r: string) => { try { return readFileSync(r, 'utf8') } catch { return null } }
  const r = informe(viva, ctx, {}, leer) as { markdown: string; ficheros: Record<string, string> }
  const md5 = (x: string) => createHash('md5').update(x).digest('hex')
  const nombre = (f: string) => f.replace(/^.*\//, '')
  const [iva, uber, datos] = viva
  const PRUEBA_IVA = 'supabase/staging/sql/20261208_d07_iva_no_deducible_prueba.sql'
  const PRUEBA_UBER = 'supabase/staging/sql/20261208_d07_uber_liquidaciones_prueba.sql'
  const DOWN = (f: string) => `supabase/vuelta-atras/${nombre(f).replace(/\.sql$/, '.down.sql')}`

  it('tres ficheros, los medidos; la 0850 y la 0860 siguen; la 0870 (datos de Foodint) pide «autorizo»; nada del camino del pedido; nada registrado aún', () => {
    expect(viva.map(nombre)).toEqual(['20261208T0850_d07_iva_no_deducible_y_periodo_cerrado.sql', '20261208T0860_d07_uber_liquidaciones.sql', '20261208T0870_d07_uber_quitar_provisionales.sql'])
    expect(Object.keys(medida.tanda)).toEqual(viva)
    for (const f of viva) expect(md5(readFileSync(f, 'utf8')), f).toBe(medida.tanda[f])
    expect(r.ficheros[iva]).toBe('sigue')
    expect(r.ficheros[uber]).toBe('sigue')
    expect(r.ficheros[datos]).toMatch(/autorizo/i)
    expect(ctx.camino).toEqual({ tablas: [], funciones: [] })
    expect(ctx.registro).toEqual([])
    expect(leerTanda('supabase/produccion/tandas/sumied/claude-cool-noether-i932tx/vuelta-atras.txt')).toEqual([DOWN(datos), DOWN(uber), DOWN(iva)])
  })
  it('la 0850: el 303 deja fuera la no deducible; el libro conserva la fecha de factura y registra el día del asiento; la vuelta atrás, como en producción (cuerpos de la 0300 y la 0410)', () => {
    const t = readFileSync(iva, 'utf8')
    expect(t).toContain("and coalesce(v.deductible_amount, 0) = 0 and coalesce(v.tax_amount, 0) <> 0 then '{}'::text[]")
    expect(t).toContain('greatest(si.created_at::date, v_e.entry_date)')
    expect(t).toContain('coalesce(l.document_date, v_e.document_date, v_fac, v_e.entry_date)')
    const cuerpo = (s: string, fn: string) => {
      const resto = s.slice(s.indexOf(`create or replace function public.${fn}(`))
      const m = /\bas\s+(\$[a-z_]*\$)/i.exec(resto)!
      const a = m.index + m[0].length
      return resto.slice(a, resto.indexOf(m[1], a))
    }
    const d = readFileSync(DOWN(iva), 'utf8')
    expect(md5(cuerpo(d, 'conta_vat_book_desde_asiento'))).toBe('2a2b8594c58d568dfc4bf37478306bfd')
    expect(md5(cuerpo(d, 'conta_impuesto_303_cajas'))).toBe('d15814822393969b4336775f74f96644')
    const p = readFileSync(PRUEBA_IVA, 'utf8')
    for (const x of [`\\i ${iva}`, `\\i ${DOWN(iva)}`, 'set local role authenticated', 'journal_entry_validar', "'deducible', 'no'", '2026-08-06']) expect(p).toContain(x)
    expect(p.trim().endsWith('rollback;')).toBe(true)
  })
  it('la 0860: no crea la provisional; la de enlazar comprueba proveedor, cuenta y que no tengan otra factura; vuelta atrás como en producción (la 0100 del D01)', () => {
    const t = readFileSync(uber, 'utf8')
    const proponer = t.slice(t.indexOf('create or replace function public.conta_liquidacion_factura_proponer'), t.indexOf('create or replace function public.conta_liquidacion_enlazar_factura'))
    expect(proponer).not.toMatch(/insert into public\.supplier_invoice/)
    expect(proponer).toContain("'estado', 'espera_factura'")
    expect(t).toContain('ya tienen otra factura: no se enlaza ninguna')
    expect(readFileSync(DOWN(uber), 'utf8')).toContain("insert into public.supplier_invoice (account_id, company_id, supplier_id")
    const p = readFileSync(PRUEBA_UBER, 'utf8')
    for (const x of [`\\i ${uber}`, `\\i ${datos}`, `\\i ${DOWN(uber)}`, `\\i ${DOWN(datos)}`, 'set local role authenticated', 'c01b0000-0000-4000-8000-0000000000b1', 'daff8f19ef7d7b2eca1a2c2c693d3fa8']) expect(p).toContain(x)
    expect(p.trim().endsWith('rollback;')).toBe(true)
  })
  it('la 0870: solo las provisionales de Foodint, sin número, PDF ni asiento; para si no es lo medido; respalda antes de borrar; la cuenta solo lee', () => {
    const t = readFileSync(datos, 'utf8').replace(/--.*$/gm, '')
    expect(t).toContain("v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710'")
    expect(t).toContain("si.source = 'liquidacion' and si.invoice_number is null and si.raw_document_url is null")
    for (const x of ['if v_n = 0 then raise exception', 'if v_n > 20 then raise exception', 'if v_todas <> v_n then', 'if v_otras > 0 then']) expect(t).toContain(x)
    expect(t.indexOf('insert into public.conta_respaldo_d07_provisionales')).toBeLessThan(t.indexOf('delete from public.supplier_invoice'))
    const cuentas = readFileSync(MANIFIESTO, 'utf8').split('\n').filter((l) => l.startsWith('cuenta:')).map((l) => l.replace(/^cuenta:\s*/, '').trim())
    expect(cuentas).toEqual(['scripts/conta/produccion/cuentas/d07-uber-y-no-deducible.sql'])
    expect(readFileSync(cuentas[0], 'utf8').replace(/--.*$/gm, '').replace(/'(?:[^']|'')*'/g, "''")).not.toMatch(/\b(insert|update|delete|create|drop|alter|grant|perform)\b/i)
    const m = readFileSync('supabase/staging/tandas/sumied/claude-cool-noether-i932tx.txt', 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    expect(m.indexOf(PRUEBA_IVA)).toBeGreaterThan(m.indexOf(iva))
    expect(m.indexOf(PRUEBA_UBER)).toBeGreaterThan(m.indexOf(datos))
  })
})

describe('DM1 (30/10) · la firma de una función no cuenta sus parámetros OUT, como Postgres', () => {
  it('current_employee_and_account(out …, out …) es la firma (), no (uuid,uuid)', () => {
    const ops = analizarFichero('x.sql', 'create or replace function public.f(out a uuid, out b uuid) returns record language sql stable as $$ select null::uuid, null::uuid $$;')
    expect(ops.find((o) => o.tipo === 'funcion')?.objeto).toBe('public.f()')
  })
  it('los INOUT sí cuentan', () => {
    const ops = analizarFichero('x.sql', 'create or replace function public.g(inout a int, b text) language sql as $$ select a $$;')
    expect(ops.find((o) => o.tipo === 'funcion')?.objeto).toBe('public.g(int,text)')
  })
  it('el analizador para cualquier línea que empiece por «\\» (W12b)', () => {
    const ops = analizarFichero('x.sql', 'select 1;\n\\connect otra\n')
    expect(ops.some((o) => o.accion === 'psql')).toBe(true)
  })
})
