// R06 · Lo que decide «Subir las ventas del TPV» (lib/subirTpv.ts): los cuatro
// ficheros, el estado de cada día y las frases de «no cuadra». Contra el ejemplo
// INVENTADO de Revo del R04 (tests/conta/r04/revo_ejemplo), leído con el lector
// de verdad, y con copias suyas cambiadas a propósito.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { leerRevo, reconocer, type FicheroRevo, type LecturaDia } from '../../../src/modules/conta/lib/lectorRevo'
import {
  avisoFormasNuevas, cuentaDe, enElMes, faltanCuentas, faltaPorSubir, huecos, juntarFicheros, nombreCanal, numeracion,
  porDentro, porQueNoCuadra, prepararDias, textoGuardado, ultimaSubida, type FormaCuenta,
} from '../../../src/modules/conta/lib/subirTpv'

const DIR = resolve(__dirname, '../r04/revo_ejemplo')
const fichero = (n: string): FicheroRevo => ({ nombre: `${n}_2026-11-09.csv`, contenido: new Uint8Array(readFileSync(resolve(DIR, `${n}_2026-11-09.csv`))) })
const CUATRO = ['Ordenes', 'Documentos', 'Impuestos', 'Pagos'].map(fichero)
const leido = (() => { const r = leerRevo(CUATRO); if (!r.ok) throw new Error(r.problemas.join(' | ')); return r.lectura.dias })()
const dia = leido[0]
const copia = (f: (l: LecturaDia) => void) => { const l = structuredClone(dia.lectura); f(l); return { ...dia, lectura: l } }

const forma = (f: string, canal: string | null, cuenta: string | null): FormaCuenta =>
  ({ forma: f, canal, cuenta_id: cuenta ? `id-${cuenta}` : null, cuenta, nombre: null, en_mes: 0, dias_sin_validar: 0, nueva: !cuenta })
const CUENTAS = [forma('Efectivo', null, '57000000'), forma('Tarjeta', null, '57200001'), forma('Deliverect', 'Glovo', '43000001'), forma('Deliverect', 'UberEats', '43000002')]

describe('los cuatro ficheros', () => {
  it('cada uno cae en su hueco por sus columnas, aunque se llamen de otra manera', () => {
    const r = reconocer(CUATRO.map((f, i) => ({ ...f, nombre: ['orders (3).csv', 'invoices_nov.csv', 'taxes_nov.csv', 'payments_nov.csv'][i] })))
    expect(r.ok).toBe(true)
    expect(huecos(r.clases).map((h) => [h.etiqueta, h.nombre])).toEqual([
      ['Órdenes', 'orders (3).csv'], ['Documentos', 'invoices_nov.csv'], ['Impuestos', 'taxes_nov.csv'], ['Pagos', 'payments_nov.csv'],
    ])
  })
  it('si falta uno, sobra uno o hay dos del mismo tipo, dice cuál', () => {
    const falta = reconocer(CUATRO.slice(0, 3))
    expect(falta.ok ? [] : falta.problemas).toEqual(['Falta el fichero de pagos.'])
    expect(huecos(falta.clases).find((h) => h.etiqueta === 'Pagos')?.nombre).toBeNull()
    const dos = reconocer([...CUATRO, { ...CUATRO[3], nombre: 'pagos otra vez.csv' }])
    expect(dos.ok ? [] : dos.problemas).toEqual(['Has subido dos ficheros de pagos: «Pagos_2026-11-09.csv» y «pagos otra vez.csv». Sube solo uno.'])
    expect(huecos(dos.clases).find((h) => h.etiqueta === 'Pagos')?.repetido).toBe(true)
    const ajeno = reconocer([...CUATRO, { nombre: 'nominas.csv', contenido: 'Nombre;Bruto\nX;1' }])
    expect(ajeno.ok ? [] : ajeno.problemas).toEqual(['No reconozco el fichero «nominas.csv»: no es ninguno de los cuatro de Revo (órdenes, documentos, impuestos y pagos).'])
  })
  it('soltar otra vez el mismo nombre lo sustituye; uno nuevo se suma', () => {
    const a = [{ nombre: 'a.csv', v: 1 }, { nombre: 'b.csv', v: 1 }]
    expect(juntarFicheros(a, [{ nombre: 'b.csv', v: 2 }, { nombre: 'c.csv', v: 1 }])).toEqual([{ nombre: 'a.csv', v: 1 }, { nombre: 'b.csv', v: 2 }, { nombre: 'c.csv', v: 1 }])
  })
})

describe('el día por dentro', () => {
  it('48 facturas de la 5001 a la 5048, el IVA por tipo, cómo se cobró (Deliverect por plataforma), con NIF y devoluciones', () => {
    const d = porDentro(dia.lectura, CUENTAS)
    expect([d.facturas, d.primero, d.ultimo, d.base, d.total, d.cobrado]).toEqual([48, 5001, 5048, 999.99, 1100, 1100])
    expect(d.ivaPorTipo).toEqual([{ tipo: 10, base: 999.99, cuota: 100.01 }])
    expect(d.cobros.map((x) => [x.etiqueta, x.porDeliverect, x.importe, x.sinCuenta])).toEqual([
      ['Efectivo', false, 180, false], ['Tarjeta', false, 420, false], ['Glovo', true, 300, false], ['Uber Eats', true, 200, false],
    ])
    expect([d.conNif, d.devoluciones.n]).toEqual([2, 1])
  })
  it('una forma de pago sin cuenta sale «sin cuenta», al final', () => {
    const l = copia((x) => { x.cobros.find((c) => c.forma === 'Efectivo')!.forma = 'Too Good To Go' }).lectura
    const d = porDentro(l, CUENTAS)
    expect(d.cobros.at(-1)).toMatchObject({ etiqueta: 'Too Good To Go', sinCuenta: true, porDeliverect: false })
    expect(cuentaDe(CUENTAS, 'deliverect', 'Glovo')?.cuenta).toBe('43000001')
    expect(cuentaDe(CUENTAS, 'Deliverect', 'JustEat')).toBeNull()
  })
  it('los nombres de las plataformas, legibles', () => {
    expect([nombreCanal('UberEats'), nombreCanal('JustEat'), nombreCanal('Glovo'), nombreCanal('--'), nombreCanal(null)]).toEqual(['Uber Eats', 'Just Eat', 'Glovo', 'el local', 'el local'])
  })
})

describe('¿cuadra?', () => {
  it('el ejemplo cuadra', () => {
    expect(porQueNoCuadra(dia.lectura)).toEqual([])
    const [x] = prepararDias(leido, [], CUENTAS)
    expect([x.como, x.seGuarda, x.aviso]).toEqual(['cuadra', true, null])
    expect(x.comprobaciones).toEqual([{ texto: 'Facturas, IVA y pagos dan lo mismo', ok: true }, { texto: 'No hay saltos de numeración', ok: true }])
  })
  it('falta un pago: dice cuánto, cuánto falta y qué orden mirar, y no se guarda', () => {
    const roto = copia((l) => { l.cobros = l.cobros.filter((c) => !(c.orden === '700002')) })
    const [x] = prepararDias([roto], [], CUENTAS)
    expect([x.como, x.seGuarda]).toEqual(['no_cuadra', false])
    expect(x.aviso).toEqual({
      titulo: 'El 09/11 no se guarda.',
      frases: ['Los pagos suman 1.080,07 € y las facturas 1.100,00 €. Faltan 19,93 €. Mira la orden 700002.'],
      queHacer: 'Vuelve a sacar de Revo los cuatro ficheros de ese día y súbelos otra vez. Los demás días se guardan igual.',
    })
  })
  it('un pago de más, el IVA que no es el de las facturas y un hueco en la numeración', () => {
    const roto = copia((l) => {
      l.cobros[0].importe += 1
      l.impuestos[0].cuota += 0.5
      l.documentos = l.documentos.filter((d) => d.numero !== 5010 && d.numero !== 5011)
    })
    expect(porQueNoCuadra(roto.lectura)).toEqual([
      expect.stringMatching(/^Los pagos suman .* y las facturas .*\. Sobran .*\. Mira las órdenes .*\.$/),
      expect.stringMatching(/^El IVA desglosado suma .* y el de las facturas .*\. Mira las órdenes 700001, .*\.$/),
      'Faltan las facturas 5010 a 5011 en la numeración.',
    ])
  })
  it('base e IVA que no dan el total, y una factura repetida', () => {
    const roto = copia((l) => { l.documentos[0].base += 0.01; l.documentos.push({ ...l.documentos[1] }) })
    const f = porQueNoCuadra(roto.lectura)
    expect(f).toContain('En la factura 5001 la base y el IVA no dan el total.')
    expect(f).toContain('La factura 5002 está dos veces (contador Facturas).')
  })
})

describe('lo que ya estaba', () => {
  const guardado = { dia: '2026-11-09', facturas: 48, primero: 5001, ultimo: 5048, total: 1100, estado: 'por_validar' }
  it('igual: «Ya estaba, igual», y no se vuelve a guardar', () => {
    const [x] = prepararDias(leido, [guardado], CUENTAS)
    expect([x.como, x.seGuarda, x.aviso]).toEqual(['igual', false, null])
  })
  it('distinto sin validar: se sustituye, y lo dice', () => {
    const [x] = prepararDias(leido, [{ ...guardado, facturas: 47, ultimo: 5047, total: 1066.75 }], CUENTAS)
    expect([x.como, x.seGuarda]).toEqual(['distinto', true])
    expect(x.aviso?.frases).toEqual(['Tenía 47 facturas y 1.066,75 €; lo leído trae 48 facturas y 1.100,00 €.'])
    expect(x.aviso?.queHacer).toMatch(/^Al guardar, se sustituye por lo leído\./)
  })
  it('distinto y validado: no se pisa', () => {
    const [x] = prepararDias(leido, [{ ...guardado, total: 1000, estado: 'validado' }], CUENTAS)
    expect([x.como, x.seGuarda, x.aviso?.titulo, x.aviso?.queHacer]).toEqual(['validado_distinto', false, 'El 09/11 ya está validado: no se cambia.', 'Si hay que corregir algo, se hace desde su asiento.'])
  })
  it('sigue (o no) a la última factura del día anterior guardado', () => {
    const antes = { dia: '2026-11-08', facturas: 10, primero: 4991, ultimo: 5000, total: 100, estado: 'validado' }
    expect(prepararDias(leido, [antes], CUENTAS)[0].comprobaciones[2]).toEqual({ texto: 'Sigue a la última factura del día anterior (5000)', ok: true })
    expect(prepararDias(leido, [{ ...antes, ultimo: 4990 }], CUENTAS)[0].comprobaciones[2])
      .toEqual({ texto: 'Entre el 08/11 y el 09/11 faltan las facturas 4991 a 5000, o falta por subir un día.', ok: false })
  })
})

describe('las frases del paso 3 y de la lista', () => {
  it('«Guardados 2 días, del 12/11 al 13/11: 119 facturas, 2.750,00 €. El 14/11 no se ha guardado.»', () => {
    expect(textoGuardado([
      { dia: '2026-11-13', ok: true, facturas: 70, total: 1540 }, { dia: '2026-11-12', ok: true, facturas: 49, total: 1210 },
      { dia: '2026-11-14', ok: false, facturas: 63, total: 1386 },
    ])).toBe('Guardados 2 días, del 12/11 al 13/11: 119 facturas, 2.750,00 €. El 14/11 no se ha guardado.')
    expect(textoGuardado([{ dia: '2026-11-12', ok: true, facturas: 1, total: 10 }, { dia: '2026-11-15', ok: false, facturas: 1, total: 1, error: 'Las ventas del 15/11/2026 son de antes de tu día de inicio.' }], ['2026-11-11']))
      .toBe('Guardado 1 día, el 12/11: 1 factura, 10,00 €. El 15/11 no se ha guardado: Las ventas del 15/11/2026 son de antes de tu día de inicio. El 11/11 ya estaba igual: no se ha tocado.')
  })
  it('«Última subida: ayer, hasta el 11/11» y «Falta por subir: del 12/11 a ayer»', () => {
    const g = [{ dia: '2026-11-10', subido_en: '2026-11-16T09:00:00Z' }, { dia: '2026-11-11', subido_en: '2026-11-16T09:00:01Z' }]
    expect(ultimaSubida(g, '2026-11-17')).toBe('Última subida: ayer, hasta el 11/11')
    expect(faltaPorSubir(g, '2026-11-17')).toBe('del 12/11 a ayer')
    expect(faltaPorSubir(g, '2026-11-13')).toBe('ayer')
    expect(faltaPorSubir(g, '2026-11-12')).toBeNull()
    expect([ultimaSubida([], '2026-11-17'), faltaPorSubir([], '2026-11-17')]).toEqual([null, null])
  })
  it('las formas de pago: el aviso, lo que falta y el mes', () => {
    expect(avisoFormasNuevas([{ forma: 'Too Good To Go', canal: null }])).toBe('Hay una forma de pago nueva: Too Good To Go.')
    expect(avisoFormasNuevas([{ forma: 'Too Good To Go', canal: null }, { forma: 'Deliverect', canal: 'JustEat' }])).toBe('Hay 2 formas de pago nuevas: Too Good To Go y Deliverect (pedidos de Just Eat).')
    expect([faltanCuentas(0), faltanCuentas(1), faltanCuentas(2)]).toEqual([null, 'Falta 1 cuenta por elegir.', 'Faltan 2 cuentas por elegir.'])
    expect([enElMes('2026-11-01'), numeracion(5001, 5048), numeracion(7, 7), numeracion(null, null)]).toEqual(['En noviembre', '5001 a 5048', '7', '—'])
  })
})
