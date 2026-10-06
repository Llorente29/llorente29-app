// C02c · Traer el plan de otro programa: lectura (CSV / tabla), resumen frente
// a la empresa, propuesta de enlaces y validación. Contra la fixture INVENTADA
// con la misma forma que el Diez del primer cliente
// (tests/conta/fixtures/importar/diez/, generada por generar.mjs).

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import serie from '../../../../supabase/conta/pgc/serie.json'
import {
  adivinarColumnas, claveNombre, genericaDe, hojaDe, ibanEnNombre, juntar, leerTabla, nifDeListado, parecido, partirCsv, resumir, type Lectura,
} from '@/modules/conta/lib/importarPlan'
import {
  cifras, decidir, filtrar, planTraer, proponer, resumenTraer, validar, type FichaBanco, type FichaProveedor, type FilaRevision,
} from '@/modules/conta/lib/propuestaImportacion'

const dir = join(__dirname, '../../../conta/fixtures/importar/diez')
const leerCsv = (f: string) => partirCsv(readFileSync(join(dir, f), 'utf8'))
const hojasPymes = new Set((serie as { cuentas: { plan: string; code: string; is_leaf: boolean; valid_to: string | null }[] }).cuentas
  .filter((c) => c.plan === 'pymes' && c.is_leaf && !c.valid_to).map((c) => c.code))
// Las cuentas del cuadro con hijas (respuesta 2: de ellas cuelgan las genéricas de Diez).
const ramasPymes = new Set((serie as { cuentas: { plan: string; code: string; is_leaf: boolean; valid_to: string | null }[] }).cuentas
  .filter((c) => c.plan === 'pymes' && !c.is_leaf && !c.valid_to).map((c) => c.code))
const folvy = JSON.parse(readFileSync(join(dir, 'folvy.json'), 'utf8')) as { proveedores: { name: string; nif: string | null }[]; bancos: { name: string; iban: string }[] }
const proveedores: FichaProveedor[] = folvy.proveedores.map((p, i) => ({ id: `p${i + 1}`, name: p.name, nif: p.nif }))
const bancos: FichaBanco[] = folvy.bancos.map((b, i) => ({ id: `b${i + 1}`, name: b.name, iban: b.iban }))

/** Los tres ficheros de la fixture, leídos como los leería el asistente con «Otro / Excel». */
function lecturaFixture(): Lectura {
  const leer = (f: string) => {
    const filas = leerCsv(f)
    const { columnas, cabecera } = adivinarColumnas(filas)
    if (!columnas) throw new Error(`sin columnas en ${f}`)
    return { filas, columnas, cabecera }
  }
  const plan = leer('plan.csv')
  const lecturaPlan = leerTabla('diez', plan.filas, plan.columnas, plan.cabecera)
  const terceros = ['proveedores.csv', 'clientes.csv'].map((f) => {
    const t = leer(f)
    const l = leerTabla('diez', t.filas, t.columnas, t.cabecera)
    // Los listados traen dirección: se añade como lo hace el lector de Diez.
    const cab = t.filas[0]
    const ix = (n: string) => cab.indexOf(n)
    const porCodigo = new Map(t.filas.slice(1).map((r) => [r[0], r]))
    return { ...l, terceros: l.terceros.map((x) => ({ ...x, direccion: porCodigo.get(x.code)?.[ix('direccion')] ?? null, cp: porCodigo.get(x.code)?.[ix('cp')] ?? null, poblacion: porCodigo.get(x.code)?.[ix('poblacion')] ?? null, provincia: porCodigo.get(x.code)?.[ix('provincia')] ?? null })) }
  })
  return juntar('diez', [lecturaPlan, ...terceros])
}

const fila = (filas: readonly FilaRevision[], code: string) => {
  const f = filas.find((x) => x.code === code)
  if (!f) throw new Error(`no hay fila ${code}`)
  return f
}

describe('nombres: el PDF de Diez parte palabras y las formas jurídicas no cuentan', () => {
  it('«GL OVO» y «Glovo» son el mismo; «NOR TE SOCIOS, S.L.» y «Norte Socios»', () => {
    expect(claveNombre('GL OVO')).toBe(claveNombre('Glovo'))
    expect(parecido('NORTE SOC IOS, S.L.', 'Norte Socios')).toBe('igual')
    expect(parecido('NOR TE SOCIOS, S.L.', 'Norte Socios SL')).toBe('igual')
    expect(parecido('Cárnicas Valle Alto', 'CARNICAS VALLE ALTO')).toBe('igual')
  })
  it('contener a la otra con 5 letras o más es «parecido»; con menos, nada (demasiadas casualidades)', () => {
    expect(parecido('GLOVOAPP SPAIN PLATFORM', 'GLOVO')).toBe('parecido')
    expect(parecido('UBER EATS SPAIN', 'UBER EATS')).toBe('parecido')
    expect(parecido('BAR', 'BARRIL DEL NORTE')).toBe(null)
    expect(parecido('GLOVO VENTAS', 'GLOVOAPP SPAIN PLATFORM')).toBe(null)
  })
  it('una forma jurídica sola no deja un nombre vacío que case con todo', () => {
    expect(claveNombre('S.L.')).toBe('')
    expect(parecido('S.L.', 'S.L.')).toBe(null)
  })
})

describe('NIF e IBAN: nunca se inventan', () => {
  it('un NIF que no valida no se usa (y se dice); uno de otro país se guarda', () => {
    expect(nifDeListado('B-99000010')).toEqual({ nif: 'B99000010', aviso: null })
    expect(nifDeListado('B99000011').nif).toBeNull()
    expect(nifDeListado('B99000011').aviso).toMatch(/no es un NIF válido/)
    expect(nifDeListado('PT500000000').nif).toBe('PT500000000')
    expect(nifDeListado('').nif).toBeNull()
  })
  it('el IBAN dentro del nombre del banco, solo si valida entero', () => {
    const [, nombre] = leerCsv('plan.csv').find((r) => r[0] === '57200001')!
    expect(ibanEnNombre(nombre)).toBe(folvy.bancos[0].iban)
    expect(ibanEnNombre('BANCO PRUEBA ES00 9999 0001')).toBeNull()
    expect(ibanEnNombre('CAJA')).toBeNull()
  })
})

describe('lectura de tabla (CSV/Excel) con asignación de columnas', () => {
  it('reconoce la cabecera (codigo;nombre) y lee las 875 filas del plan, de ellas 96 tuyas', () => {
    const filas = leerCsv('plan.csv')
    const { columnas, cabecera } = adivinarColumnas(filas)
    expect(cabecera).toBe(true)
    expect(columnas).toEqual({ codigo: 0, nombre: 1, nif: null })
    const l = leerTabla('diez', filas, columnas!, cabecera)
    // Las cabeceras de grupo (1, 10…) no son subcuentas: el lector las salta y avisa.
    expect(l.cuentas.every((c) => /^\d{6,12}$/.test(c.code))).toBe(true)
  })
  it('sin cabecera, adivina por el contenido: la columna de códigos y la de texto más larga', () => {
    const filas = [['40000001', 'B99000010', 'DISTRIBUCIONES ALBA ORIENTE'], ['40000002', 'B99000028', 'CARNICAS VALLE ALTO']]
    const { columnas, cabecera } = adivinarColumnas(filas)
    expect(cabecera).toBe(false)
    expect(columnas?.codigo).toBe(0)
    expect(columnas?.nombre).toBe(2)
  })
  it('CSV con comillas, punto y coma dentro y BOM', () => {
    expect(partirCsv('\uFEFFcodigo;nombre\n43000005;"NORTE SOCIOS; S.L."\n')).toEqual([['codigo', 'nombre'], ['43000005', 'NORTE SOCIOS; S.L.']])
    expect(partirCsv('a,b\r\n1,"x ""y"""\r\n')).toEqual([['a', 'b'], ['1', 'x "y"']])
  })
})

describe('resumen frente a la empresa: el código manda, la longitud no se toca', () => {
  const l = lecturaFixture()
  it('«714 cuentas, 96 tuyas y 3 genéricas · plan de pymes · 8 dígitos, igual que aquí»', () => {
    const r = resumir(l, { plan: 'pymes', digitos: 8 }, hojasPymes, ramasPymes)
    expect(r.ok).toBe(true)
    expect(r.tuyas).toBe(96)
    expect(r.genericas).toBe(3)
    expect(r.total).toBe(hojasPymes.size + 96 + 3)
    expect(r.frase).toBe(`${hojasPymes.size + 99} cuentas, 96 tuyas y 3 genéricas · plan de pymes · 8 dígitos, igual que aquí`)
  })
  it('sin las cuentas con hijas del cuadro, las genéricas no encajan: para y dice cuáles, sin hablar del otro plan', () => {
    const r = resumir(l, { plan: 'pymes', digitos: 8 }, hojasPymes)
    expect(r.ok).toBe(false)
    expect(r.fuera.map((c) => c.code)).toEqual(['16000000', '44500000', '79540000'])
    expect(r.motivo).toMatch(/^3 cuentas no encajan en el plan de pymes \(16000000, 44500000, 79540000\): no son subcuenta de una cuenta sin hijas ni la genérica/)
    expect(r.motivo).not.toMatch(/otro plan/)
  })
  it('sufijo 0000 que coincide con su hoja = de serie (no se duplica); 76201000 también, con hoja de 5 dígitos', () => {
    const r = resumir(l, { plan: 'pymes', digitos: 8 }, hojasPymes, ramasPymes)
    const c = (code: string) => r.cuentas.find((x) => x.code === code)!
    expect(c('47200000')).toMatchObject({ hoja: '472', clase: 'serie' })
    expect(c('76201000')).toMatchObject({ hoja: '76201', clase: 'serie' })
    expect(c('40000001')).toMatchObject({ hoja: '4000', clase: 'propia' })
    expect(c('52000001')).toMatchObject({ hoja: '5200', clase: 'propia' })
    expect(hojaDe('41000100', hojasPymes)).toBe('4100')
  })
  it('longitud distinta: para y lo dice; no se renumera nada', () => {
    const r = resumir(l, { plan: 'pymes', digitos: 10 }, hojasPymes, ramasPymes)
    expect(r.ok).toBe(false)
    expect(r.motivo).toMatch(/tienen 8 dígitos y tu empresa en Folvy usa 10/)
  })
  it('longitudes mezcladas en el fichero: para', () => {
    const r = resumir({ cuentas: [{ code: '40000001', nombre: 'A', nombreOrigen: 'A' }, { code: '4000000001', nombre: 'B', nombreOrigen: 'B' }, { code: '40000002', nombre: 'C', nombreOrigen: 'C' }] }, { plan: 'pymes', digitos: 8 }, hojasPymes, ramasPymes)
    expect(r.ok).toBe(false)
    expect(r.motivo).toMatch(/mezcla longitudes/)
  })
  it('una cuenta que no cuelga de ninguna hoja del plan de la empresa: para con la lista', () => {
    const r = resumir({ cuentas: [{ code: '40000001', nombre: 'A', nombreOrigen: 'A' }, { code: '80000001', nombre: 'GRUPO 8', nombreOrigen: 'GRUPO 8' }] }, { plan: 'pymes', digitos: 8 }, hojasPymes, ramasPymes)
    expect(r.ok).toBe(false)
    expect(r.fuera.map((c) => c.code)).toEqual(['80000001'])
  })
  it('un fichero sin subcuentas no es un plan', () => {
    expect(resumir({ cuentas: [] }, { plan: 'pymes', digitos: 8 }, hojasPymes, ramasPymes).motivo).toMatch(/no hay ninguna subcuenta/)
  })
})

describe('propuesta de enlaces, con la fixture (los casos del encargo §3)', () => {
  const l = lecturaFixture()
  const r = resumir(l, { plan: 'pymes', digitos: 8 }, hojasPymes, ramasPymes)
  const filas = proponer({ cuentas: r.cuentas, terceros: l.terceros, proveedores, bancos, programa: 'Cegid Diez' })

  it('una fila por cuenta tuya (96) y por genérica (3), más las dos de serie que cambian (472/477)', () => {
    expect(filas.filter((f) => !f.cambia)).toHaveLength(99)
    expect(filas.filter((f) => f.decision.tipo === 'generica').map((f) => f.code)).toEqual(['16000000', '44500000', '79540000'])
    expect(filas.filter((f) => f.cambia).map((f) => f.code)).toEqual(['47200000', '47700000'])
    expect(fila(filas, '47200000').porque).toMatch(/el IVA va por tipo; el 303 suma igual/)
  })
  it('mismo NIF → seguro, con su ficha', () => {
    expect(fila(filas, '40000001')).toMatchObject({ confianza: 'seguro', decision: { tipo: 'enlazar', entityId: 'p1', papel: 'principal' } })
    expect(fila(filas, '40000001').porque).toMatch(/^mismo NIF B99/)
  })
  it('NIF en Diez y no en la ficha, mismo nombre → probable', () => {
    const f = fila(filas, '40000005')
    expect(f).toMatchObject({ confianza: 'probable', decision: { tipo: 'enlazar', entityId: 'p6' } })
    expect(f.porque).toMatch(/el NIF B99\w+ viene del fichero y la ficha no lo tiene/)
  })
  it('sin NIF en ninguno, mismo nombre → probable, con las salidas «Crear ficha por completar» y «Cuenta mía sin ficha»', () => {
    const f = fila(filas, '40000006')
    expect(f).toMatchObject({ confianza: 'probable', decision: { tipo: 'enlazar', entityId: 'p8' } })
    expect(f.opciones.map((o) => o.texto)).toEqual(['Crear ficha por completar', 'Cuenta mía sin ficha'])
  })
  it('con NIF y sin ficha → se CREA la ficha por completar (respuesta 1)', () => {
    const f = fila(filas, '41000001')
    expect(f).toMatchObject({ confianza: 'seguro', decision: { tipo: 'crear_proveedor', nombre: 'GLOVOAPP SPAIN PLATFORM' } })
    expect(f.porque).toMatch(/se crea con su NIF/)
  })
  it('sin NIF y sin ficha → decide tú (Riders, Facturas por localizar)', () => {
    for (const code of ['41000100', '40000099']) {
      const f = fila(filas, code)
      expect(f.confianza).toBe('decide')
      expect(f.decision.tipo).toBe('pendiente')
      expect(f.opciones.map((o) => o.texto)).toContain('Cuenta mía sin ficha')
      expect(f.opciones.map((o) => o.texto)).toContain('Crear ficha por completar')
    }
  })
  it('un tercero en dos cuentas (proveedor 400 y cliente 430): las dos, la 430 con el papel de pago', () => {
    expect(fila(filas, '40000003')).toMatchObject({ confianza: 'seguro', decision: { tipo: 'enlazar', entityId: 'p3', papel: 'principal' } })
    expect(fila(filas, '43000005')).toMatchObject({ confianza: 'seguro', decision: { tipo: 'enlazar', entityId: 'p3', papel: 'pago' } })
  })
  it('Glovo cliente sin NIF → la ficha que crea el 41000001, como pago (probable, con el porqué)', () => {
    const f = fila(filas, '43000001')
    expect(f).toMatchObject({ confianza: 'probable', decision: { tipo: 'enlazar_creada', codigoCreadora: '41000001', papel: 'pago' } })
    expect(f.porque).toMatch(/sin NIF en el fichero; mismo nombre que el 41000001/)
  })
  it('cliente con NIF que no es proveedor (aunque se llame como uno con otro NIF) → sin ficha hasta el C03', () => {
    expect(fila(filas, '43000003')).toMatchObject({ confianza: 'seguro', decision: { tipo: 'sin_ficha', nota: 'cliente_c03' } })
    expect(fila(filas, '43000004')).toMatchObject({ decision: { tipo: 'sin_ficha', nota: 'cliente_c03' } })
  })
  it('«Glovo Ventas» (430 sin NIF que no es de nadie) → decide tú: ¿cliente o cuenta tuya?', () => {
    const f = fila(filas, '43000101')
    expect(f.confianza).toBe('decide')
    expect(f.opciones.map((o) => o.texto)).toEqual(['Solo es cliente', 'Cuenta mía sin ficha'])
  })
  it('bancos: mismo IBAN → seguro; el que no está en Bancos → cuenta tuya', () => {
    expect(fila(filas, '57200001')).toMatchObject({ confianza: 'seguro', porque: 'mismo IBAN en Bancos', decision: { tipo: 'enlazar', entity: 'bank_account', entityId: 'b1' } })
    expect(fila(filas, '57200002').decision).toEqual({ tipo: 'sin_ficha', nota: 'cuenta' })
  })
  it('retenciones: las dos iguales → decide tú (111 / 115); la del alquiler del local → 115', () => {
    for (const code of ['47510015', '47510019']) {
      const f = fila(filas, code)
      expect(f.confianza).toBe('decide')
      expect(f.porque).toMatch(/hay 2 iguales: 47510015 y 47510019/)
      expect(f.opciones.map((o) => o.texto)).toEqual(['111', '115', 'Ninguno'])
    }
    expect(fila(filas, '47510001')).toMatchObject({ confianza: 'probable', decision: { tipo: 'retencion', modelo: '115' } })
  })
  it('gastos, socios y préstamos entran tal cual, sin ficha', () => {
    for (const code of ['60000001', '62300001', '17000001', '55100001', '55500001']) expect(fila(filas, code)).toMatchObject({ confianza: 'seguro', decision: { tipo: 'sin_ficha', nota: 'cuenta' } })
  })
  it('las cuatro cifras', () => {
    const k = cifras(filas)
    expect(k.cambian).toBe(2)
    expect(k.todas).toBe(101) // 96 tuyas + 3 genéricas + 472/477
    expect(k.tal + k.revisar + k.cambian + k.nuevas).toBe(101)
    expect(k.pendientes).toBe(filas.filter((f) => f.decision.tipo === 'pendiente').length)
    expect(k.nuevas).toBe(filas.filter((f) => f.decision.tipo === 'crear_proveedor').length)
  })
  it('filtros y buscador («Glovo», «410»)', () => {
    expect(filtrar(filas, 'revisar', '').every((f) => f.confianza !== 'seguro')).toBe(true)
    expect(filtrar(filas, 'bancos', '').map((f) => f.code)).toEqual(['57200001', '57200002'])
    expect(filtrar(filas, 'todas', 'Glovo').map((f) => f.code).sort()).toEqual(['41000001', '43000001', '43000101', '62300001'])
    expect(filtrar(filas, 'todas', '410').every((f) => f.code.startsWith('410'))).toBe(true)
  })

  it('no se puede traer con «decide tú» sin contestar; contestado, sí', () => {
    expect(validar(filas).length).toBe(cifras(filas).pendientes)
    let d = filas
    for (const f of filas.filter((x) => x.decision.tipo === 'pendiente')) {
      const opcion = f.code === '47510015' ? f.opciones.find((o) => o.id === '111')! : f.code === '47510019' ? f.opciones.find((o) => o.id === 'ninguno')! : f.opciones.find((o) => o.id === 'sin_ficha') ?? f.opciones[0]
      d = decidir(d, f.code, opcion.decision)
    }
    expect(validar(d)).toEqual([])
    expect(fila(d, '41000100')).toMatchObject({ confianza: 'seguro', porque: 'lo has decidido tú' })
  })
  it('dos retenciones al mismo modelo, o dos cuentas a la misma ficha y papel: no se puede', () => {
    let d = decidir(filas, '47510015', { tipo: 'retencion', modelo: '115' })
    d = decidir(d, '47510019', { tipo: 'retencion', modelo: '111' })
    expect(validar(d).some((p) => /van los dos al modelo 115/.test(p.texto))).toBe(true)
    const doble = decidir(filas, '43000101', { tipo: 'enlazar_creada', codigoCreadora: '41000001', papel: 'pago' })
    expect(validar(doble).some((p) => /43000001 y 43000101 acaban en la misma ficha/.test(p.texto))).toBe(true)
  })
  it('si la fila que creaba la ficha deja de crearla, la 430 que se apoyaba en ella no puede ir', () => {
    const d = decidir(filas, '41000001', { tipo: 'sin_ficha', nota: 'cuenta' })
    expect(validar(d).some((p) => /se enlazaba con la ficha que iba a crear el 41000001/.test(p.texto))).toBe(true)
  })

  it('lo que se manda a la base: código del fichero, nombre de la ficha, nombre de origen aparte', () => {
    let d = filas
    for (const f of filas.filter((x) => x.decision.tipo === 'pendiente')) {
      const o = f.code === '47510015' ? '111' : f.code === '47510019' ? 'ninguno' : 'sin_ficha'
      d = decidir(d, f.code, (f.opciones.find((x) => x.id === o) ?? f.opciones[0]).decision)
    }
    const p = planTraer(d, r.cuentas, l.terceros)
    expect(p.cuentas).toHaveLength(96)
    expect(p.cuentas.find((c) => c.code === '40000001')).toEqual({ code: '40000001', hoja: '4000', nombre: 'Proveedores · Distribuciones Alba Oriente', nombre_origen: 'DISTRIBUCIONES ALBA ORIENTE', nota: null })
    expect(p.cuentas.find((c) => c.code === '41000001')?.nombre).toBe('Acreedores · GLOVOAPP SPAIN PLATFORM')
    expect(p.cuentas.find((c) => c.code === '43000004')?.nota).toBe('cliente_c03')
    expect(p.crear.find((c) => c.code === '41000001')).toMatchObject({ nombre: 'GLOVOAPP SPAIN PLATFORM', poblacion: 'MADRID' })
    expect(p.enlaces.find((x) => x.code === '43000001')).toEqual({ code: '43000001', entity: 'supplier', entity_id: null, crea_code: '41000001', role: 'pago' })
    expect(p.retenciones).toEqual(expect.arrayContaining([{ code: '47510015', modelo: '111' }, { code: '47510001', modelo: '115' }]))
    expect(p.nombres_serie.find((x) => x.code === '47200000')?.nombre_origen).toBe('HACIENDA PÚBLICA, IVA SOPORTADO')
    expect(resumenTraer(p, 'Diez', true)).toMatch(/^96 cuentas tuyas con su número de Diez · 3 genéricas de Diez · \d+ enlazadas · \d+ fichas nuevas · el IVA pasa a ir por tipo$/)
  })
})

describe('las genéricas de Diez (respuesta 2, camino B): entran con su número bajo su cuenta con hijas', () => {
  it('16000000 es la genérica de la 160 (hojas 1603, 1604, 1605); 79540000, de la 7954', () => {
    expect(genericaDe('16000000', hojasPymes, ramasPymes)).toEqual({ madre: '160', relleno: '160', choque: null })
    expect(genericaDe('79540000', hojasPymes, ramasPymes)).toEqual({ madre: '7954', relleno: '7954', choque: null })
  })
  it('44500000: la 445 no está en el plan de pymes; va bajo la 44, su antecesora más cercana', () => {
    expect(ramasPymes.has('445')).toBe(false)
    expect(genericaDe('44500000', hojasPymes, ramasPymes)).toEqual({ madre: '44', relleno: '445', choque: null })
  })
  it('lo que cuelga de una hoja no es genérica (40000001, y 47500000 es la serie de la 4750)', () => {
    expect(genericaDe('40000001', hojasPymes, ramasPymes)).toBeNull()
    expect(genericaDe('47500000', hojasPymes, ramasPymes)).toBeNull()
    expect(hojaDe('47500000', hojasPymes)).toBe('4750')
  })
  it('16012300 no es el relleno de nadie (subcuenta propia de una cuenta con hijas): no es genérica, para', () => {
    expect(genericaDe('16012300', hojasPymes, ramasPymes)).toBeNull()
    const r = resumir({ cuentas: [{ code: '40000001', nombre: 'A', nombreOrigen: 'A' }, { code: '16012300', nombre: 'RARA', nombreOrigen: 'RARA' }] }, { plan: 'pymes', digitos: 8 }, hojasPymes, ramasPymes)
    expect(r.ok).toBe(false)
    expect(r.fuera.map((c) => c.code)).toEqual(['16012300'])
  })
  it('choque: si una hoja hija de la madre, rellenada, da el mismo número, para y lo dice', () => {
    // Leyendo un fichero no puede pasar (un código que empieza por una hoja es de ella, y hojaDe
    // mira hasta 5 dígitos): se fuerza con una hoja inventada de 6. El de verdad lo prueba la base
    // (disparador company_account_madre, en la prueba de staging).
    const hojas = new Set([...hojasPymes, '160000'])
    expect(genericaDe('16000000', hojas, ramasPymes)).toEqual({ madre: '160', relleno: '160', choque: '160000' })
    const r = resumir({ cuentas: [{ code: '40000001', nombre: 'A', nombreOrigen: 'A' }, { code: '16000000', nombre: 'G', nombreOrigen: 'G' }] }, { plan: 'pymes', digitos: 8 }, hojas, ramasPymes)
    expect(r.ok).toBe(false)
    expect(r.choques).toEqual([{ code: '16000000', madre: '160', hoja: '160000' }])
    expect(r.motivo).toMatch(/16000000 sería la genérica de la 160, pero la 160000 rellenada da el mismo número/)
  })
  it('en la revisión: seguras, con su porqué; ni proveedor ni cliente aunque cuelguen de la 44', () => {
    const l = lecturaFixture()
    const r = resumir(l, { plan: 'pymes', digitos: 8 }, hojasPymes, ramasPymes)
    const filas = proponer({ cuentas: r.cuentas, terceros: l.terceros, proveedores, bancos, programa: 'Cegid Diez' })
    expect(fila(filas, '16000000')).toMatchObject({ confianza: 'seguro', clase: 'otra', decision: { tipo: 'generica' }, hoja: '160' })
    expect(fila(filas, '16000000').porque).toBe('genérica de la 160, que aquí se desglosa en sus hijas; entra con su número y no se propone para nada nuevo')
    expect(fila(filas, '44500000').porque).toBe('genérica de la 445, que no está en el plan de pymes: va bajo la 44; entra con su número y no se propone para nada nuevo')
    const plan = planTraer(filas, r.cuentas, l.terceros)
    expect(plan.genericas).toEqual([
      { code: '16000000', madre: '160', nombre: 'DEUDAS A LARGO PLAZO CON ENTIDADES DE CRÉDITO VINCULADAS', nombre_origen: 'DEUDAS A LARGO PLAZO CON ENTIDADES DE CRÉDITO VINCULADAS' },
      { code: '44500000', madre: '44', nombre: 'DEUDORES DUDOSO COBRO', nombre_origen: 'DEUDORES DUDOSO COBRO' },
      { code: '79540000', madre: '7954', nombre: 'EXCESO DE PROVISIÓN POR OPERACIONES COMERCIALES', nombre_origen: 'EXCESO DE PROVISIÓN POR OPERACIONES COMERCIALES' },
    ])
    expect(plan.cuentas.some((c) => ['16000000', '44500000', '79540000'].includes(c.code))).toBe(false)
    expect(resumenTraer(plan, 'Diez', true)).toMatch(/^96 cuentas tuyas con su número de Diez · 3 genéricas de Diez · \d+ enlazadas/)
    expect(cifras(filas).todas).toBe(101)
  })
})
