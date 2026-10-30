// B01 · Bancos: lectura de extractos (tarea 2). Todo inventado: ningún IBAN,
// nombre ni importe real (el repositorio es público, RGPD).
//
//   · Norma 43: lectura de los seis registros, varias cuentas, IBAN
//     reconstruido, cuadre (registros 11 y 33), fin de fichero (88), errores
//     con su línea;
//   · Excel/CSV de los once bancos y la tarjeta, cada uno con su ejemplo;
//   · la huella: el mismo fichero dos veces no cambia nada, uno solapado solo
//     trae lo nuevo, y el mismo movimiento por otro camino es «posible repetido»;
//   · las fuentes correo (preparada) y agregador (simulado).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  cuadrar, huellas, limpiarConcepto, resumenLectura, separarNuevos, huellasSuaves, type ExtractoLeido,
} from '@/modules/conta/lib/extractoBanco'
import {
  CAMPOS, CONCEPTOS_COMUNES, DIVISAS, Norma43NoValido, digitosControlCcc, escribirNorma43, ibanDesdeCcc, leerNorma43, pareceNorma43,
  type CuentaAEscribir,
} from '@/modules/conta/lib/norma43'
import { CsvBancoNoValido, PERFILES, leerCsvBanco, leerFecha, leerImporte, reconocerBanco, type BancoCsv } from '@/modules/conta/lib/lectorCsvBanco'
import { extractosDeCorreo, leerDesdeAgregador, leerFicheroBanco, type ProveedorAgregador } from '@/modules/conta/lib/fuentesBanco'
import { validarIban } from '@/modules/conta/lib/iban'
import { partirCsv } from '@/modules/conta/lib/importarPlan'

const NORTE: CuentaAEscribir = {
  entidad: '0182', oficina: '9001', cuenta: '0000000017', nombre: 'TABERNA DE PRUEBA NORTE', desde: '2026-10-01', hasta: '2026-10-13',
  saldoInicialCent: 4_500_000,
  movimientos: [
    { fecha: '2026-10-09', importeCent: 127_817, comun: '04', ref1: '88213', concepto: 'TRANSFERENCIA RECIBIDA REF 88213' },
    { fecha: '2026-10-10', importeCent: -310_477, comun: '15', propio: '012', concepto: 'ADEUDO TGSS ** CUOTAS SEPTIEMBRE ****' },
    { fecha: '2026-10-11', importeCent: -200_000, comun: '04', concepto: 'TRASPASO A CUENTA SUR' },
    { fecha: '2026-10-12', importeCent: -8_640, comun: '12', documento: '937', concepto: 'PAGO CON TARJETA MERCADO CENTRAL 0937 0000000012345678' },
    { fecha: '2026-10-12', importeCent: -8_640, comun: '12', documento: '937', concepto: 'PAGO CON TARJETA MERCADO CENTRAL 0937 0000000012345678' },
    { fecha: '2026-10-13', importeCent: 341_218, comun: '02', ref2: 'LIQ-0107', concepto: 'TRANSFERENCIA DE PLATAFORMA NORTE SL LIQUIDACION 1-7 OCT CON UN TEXTO LARGO QUE OCUPA DOS REGISTROS' },
  ],
}
const SUR: CuentaAEscribir = {
  entidad: '0182', oficina: '9002', cuenta: '0000000025', nombre: 'TABERNA DE PRUEBA NORTE', desde: '2026-10-01', hasta: '2026-10-13',
  saldoInicialCent: -15_000,
  movimientos: [{ fecha: '2026-10-11', importeCent: 200_000, comun: '04', concepto: 'TRASPASO DE CUENTA NORTE' }],
}

describe('Norma 43 · contra el cuaderno de la AEB descargado (regla 31)', () => {
  // El texto tal cual lo publica Cajamar (fuentes.json → aeb-cuaderno-43-cajamar).
  // Si el cuaderno cambia una longitud, esta prueba falla.
  const cuaderno = readFileSync('docs/conta/fuentes/textos/aeb-cuaderno-43-cajamar.txt', 'utf8')

  it('es el cuaderno 43, «Información normalizada de cuenta corriente», junio 2012', () => {
    expect(cuaderno).toContain('Información normalizada de')
    expect(cuaderno).toMatch(/Nº\s+43\s+Junio 2012/)
  })

  it('las longitudes de cada campo, registro a registro, son las del cuaderno', () => {
    // Las seis tablas «LONGITUD» del apartado III, en orden: 11, 22, 23, 24, 33, 88.
    const tablas = cuaderno.split('\n').filter((l) => l.startsWith('LONGITUD')).slice(0, 6)
      .map((l) => l.replace('LONGITUD', '').trim().split(/\s+/).map(Number))
    // De CAMPOS a longitudes, con el código de registro (1–2) y los huecos «Libre».
    const longitudes = (campos: Record<string, readonly [number, number]>) => {
      const tramos = [[1, 2], ...Object.values(campos)].sort((a, b) => a[0] - b[0])
      const out: number[] = []
      let pos = 1
      for (const [d, h] of tramos) { if (d > pos) out.push(d - pos); out.push(h - d + 1); pos = h + 1 }
      if (pos <= 80) out.push(81 - pos)
      return out
    }
    expect(tablas.map((t) => t.reduce((a, b) => a + b, 0))).toEqual([80, 80, 80, 80, 80, 80])
    expect([CAMPOS.r11, CAMPOS.r22, CAMPOS.r23, CAMPOS.r24, CAMPOS.r33, CAMPOS.r88].map(longitudes)).toEqual(tablas)
  })

  it('los conceptos comunes y las divisas son los del anexo 2', () => {
    const anexo = cuaderno.slice(cuaderno.indexOf('1.    CONCEPTOS COMUNES'), cuaderno.indexOf('2.    TABLAS DE DIVISAS'))
    const codigos = [...anexo.matchAll(/^(\d{2}) {3}\S/gm)].map((m) => m[1])
    expect(codigos).toEqual(Object.keys(CONCEPTOS_COMUNES).sort())
    const ini = cuaderno.indexOf('2.    TABLAS DE DIVISAS')
    const divisas = cuaderno.slice(ini, cuaderno.indexOf('ANEXO 3', ini))
    expect([...divisas.matchAll(/\s(\d{3})\s*$/gm)].map((m) => m[1]).sort()).toEqual(Object.keys(DIVISAS).sort())
  })

  it('el signo: 1 deudor/debe, 2 acreedor/haber; y el 88 cuenta los registros sin contarse a sí mismo', () => {
    expect(cuaderno).toMatch(/1\.- Apuntes Debe\s+2\.- Apuntes Haber/)
    expect(cuaderno).toMatch(/1\.- Deudor\s+2\.- Acreedor/)
    expect(cuaderno).toContain('Número total de registros que contiene el fichero, excluyéndose a sí mismo.')
  })
})

describe('Norma 43 · lectura', () => {
  const fichero = escribirNorma43([NORTE, SUR])

  it('las posiciones cubren los 80 caracteres de cada registro sin pisarse', () => {
    for (const [reg, campos] of Object.entries(CAMPOS)) {
      const usados = new Set<number>()
      for (const [d, h] of Object.values(campos) as [number, number][]) {
        expect(d, reg).toBeGreaterThanOrEqual(3)
        expect(h, reg).toBeLessThanOrEqual(80)
        for (let i = d; i <= h; i++) { expect(usados.has(i), `${reg} pos ${i}`).toBe(false); usados.add(i) }
      }
    }
    for (const l of fichero.split('\r\n').filter(Boolean)) expect(l).toHaveLength(80)
  })

  it('lee dos cuentas con sus saldos, signos, fechas y referencias', () => {
    expect(pareceNorma43(fichero)).toBe(true)
    const e = leerNorma43(fichero)
    expect(e.formato).toBe('norma43')
    expect(e.cuentas).toHaveLength(2)
    const [n, s] = e.cuentas
    expect(n.saldoInicialCent).toBe(4_500_000)
    expect(n.saldoFinalCent).toBe(4_500_000 + 127_817 - 310_477 - 200_000 - 8_640 - 8_640 + 341_218)
    expect(n.divisa).toBe('EUR')
    expect(n.desde).toBe('2026-10-01')
    expect(n.titular).toBe('TABERNA DE PRUEBA NORTE')
    expect(n.movimientos[0]).toMatchObject({ fecha: '2026-10-09', importeCent: 127_817, conceptoComun: '04', referencia1: '88213' })
    expect(n.movimientos[1]).toMatchObject({ importeCent: -310_477, conceptoComun: '15', conceptoPropio: '012' })
    expect(n.movimientos[3].numeroDocumento).toBe('0000000937')
    // El 23 de dos trozos se une al concepto.
    expect(n.movimientos[5].conceptoBanco).toContain('LIQUIDACION 1-7 OCT CON UN TEXTO LARGO QUE OCUPA DOS REGISTROS')
    expect(s.saldoInicialCent).toBe(-15_000) // saldo deudor (clave 1)
    expect(s.saldoFinalCent).toBe(185_000)
    expect(cuadrar(e).ok).toBe(true)
  })

  it('reconstruye el IBAN: dígitos de control del CCC y módulo 97', () => {
    // El IBAN de ejemplo que se usa en la documentación de los bancos (ES91 2100 0418 4502 0005 1332).
    expect(digitosControlCcc('2100', '0418', '0200051332')).toBe('45')
    expect(ibanDesdeCcc('2100', '0418', '0200051332')).toBe('ES9121000418450200051332')
    const iban = ibanDesdeCcc('0182', '9001', '0000000017')
    expect(validarIban(iban).ok).toBe(true)
    expect(iban.slice(4, 12)).toBe('01829001')
    expect(leerNorma43(fichero).cuentas[0].iban).toBe(iban)
  })

  it('los conceptos comunes son los diecinueve de la AEB', () => {
    expect(Object.keys(CONCEPTOS_COMUNES).sort()).toEqual(['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13', '14', '15', '16', '17', '98', '99'])
  })

  it('si no cuadra, lo dice con la cifra y no se importa', () => {
    // Se toca el saldo final del 33 de la primera cuenta.
    const ls = fichero.split('\r\n')
    const i = ls.findIndex((l) => l.startsWith('33'))
    ls[i] = ls[i].slice(0, 59) + String(Number(ls[i].slice(59, 73)) + 1).padStart(14, '0') + ls[i].slice(73)
    const c = cuadrar(leerNorma43(ls.join('\r\n')))
    expect(c.ok).toBe(false)
    expect(c.motivos[0]).toMatch(/saldo final es .* \(diferencia 0,01 €\)/)
  })

  it('si falta un movimiento, el registro 33 lo caza por número y total', () => {
    const ls = fichero.split('\r\n')
    const i = ls.findIndex((l) => l.startsWith('22'))
    let j = i + 1
    while (ls[j].startsWith('23')) j++
    ls.splice(i, j - i)
    ls[ls.length - 2] = `88${'9'.repeat(18)}${String(ls.length - 2).padStart(6, '0')}${' '.repeat(54)}`
    const c = cuadrar(leerNorma43(ls.join('\r\n')))
    expect(c.ok).toBe(false)
    expect(c.motivos.join(' ')).toMatch(/dice 2 abonos y hay 1/)
  })

  it('un fichero cortado o con un registro raro se rechaza con su línea', () => {
    const ls = fichero.split('\r\n').filter(Boolean)
    expect(() => leerNorma43(ls.slice(0, 5).join('\n'))).toThrow(Norma43NoValido)
    expect(() => leerNorma43(ls.slice(0, 5).join('\n'))).toThrow(/sin cerrar|falta su 33|cortado/)
    const raro = [...ls]; raro[2] = '77' + raro[2].slice(2)
    expect(() => leerNorma43(raro.join('\n'))).toThrow(/Línea 3: el registro «77»/)
    const fecha = [...ls]; fecha[1] = fecha[1].slice(0, 10) + '261332' + fecha[1].slice(16)
    expect(() => leerNorma43(fecha.join('\n'))).toThrow(/Línea 2: la fecha «261332» no existe/)
    const mal88 = [...ls]; mal88[mal88.length - 1] = `88${'9'.repeat(18)}000003${' '.repeat(54)}`
    expect(() => leerNorma43(mal88.join('\n'))).toThrow(/fin de fichero dice 3 registros/)
    expect(() => leerNorma43('')).toThrow(/vacío/)
    expect(() => leerNorma43('hola')).toThrow(/primera línea/)
  })

  it('acepta finales de línea de Windows, Unix y Mac, y líneas sin los espacios del final', () => {
    const unix = fichero.replace(/\r\n/g, '\n').split('\n').map((l) => l.trimEnd()).join('\n')
    const mac = fichero.replace(/\r\n/g, '\r')
    expect(leerNorma43(unix).cuentas[0].movimientos).toHaveLength(6)
    expect(leerNorma43(mac).cuentas[1].movimientos).toHaveLength(1)
  })

  it('«He leído…»: el resumen de la ventana de subir', () => {
    const e = leerNorma43(fichero)
    expect(resumenLectura(e, cuadrar(e))).toBe('He leído 2 cuentas, 7 movimientos, del 09/10 al 13/10; cuadra con el saldo del banco.')
  })
})

describe('La huella: nunca un movimiento dos veces', () => {
  const e = leerNorma43(escribirNorma43([NORTE]))
  const movs = e.cuentas[0].movimientos

  it('dos movimientos iguales el mismo día tienen huellas distintas (número de orden)', () => {
    const hs = huellas(movs)
    expect(new Set(hs).size).toBe(movs.length)
    expect(hs[3].endsWith('|1')).toBe(true)
    expect(hs[4].endsWith('|2')).toBe(true)
  })

  it('el mismo fichero dos veces: todo repetido, nada nuevo', () => {
    const ya = { huellas: new Set(huellas(movs)), suaves: new Set(huellasSuaves(movs)) }
    const r = separarNuevos(ya, leerNorma43(escribirNorma43([NORTE])).cuentas[0].movimientos)
    expect(r).toEqual({ nuevos: [], repetidos: [0, 1, 2, 3, 4, 5], posiblesRepetidos: [] })
  })

  it('un extracto que se solapa solo trae lo nuevo', () => {
    const ya = { huellas: new Set(huellas(movs.slice(0, 3))), suaves: new Set(huellasSuaves(movs.slice(0, 3))) }
    expect(separarNuevos(ya, movs).nuevos).toEqual([3, 4, 5])
  })

  it('el mismo movimiento traído por Excel una semana y por Norma 43 la siguiente sale como posible repetido', () => {
    const excel = movs.map((m) => ({ ...m, referencia1: null, referencia2: null, numeroDocumento: null }))
    const ya = { huellas: new Set(huellas(excel)), suaves: new Set(huellasSuaves(excel)) }
    const r = separarNuevos(ya, movs)
    expect(r.posiblesRepetidos).toEqual([0, 3, 4, 5]) // los que traen referencias en el Norma 43
    expect(r.repetidos).toEqual([1, 2])
    expect(r.nuevos).toEqual([])
  })
})

describe('Concepto limpio', () => {
  it('sin asteriscos, códigos ni rellenos, y sin gritar', () => {
    // Como N17: la operación en minúscula, el tercero y las siglas como vienen.
    expect(limpiarConcepto('ADEUDO TGSS ** CUOTAS SEPTIEMBRE ****')).toBe('Adeudo TGSS cuotas septiembre')
    expect(limpiarConcepto('PAGO CON TARJETA MERCADO CENTRAL 0937 0000000012345678')).toBe('Pago con tarjeta MERCADO CENTRAL 0937')
    expect(limpiarConcepto('RECIBO SUMINISTROS ELECTRICOS DEL NORTE')).toBe('Recibo SUMINISTROS ELECTRICOS DEL NORTE')
    expect(limpiarConcepto('TRANSFERENCIA DE PLATAFORMA NORTE SL LIQUIDACION 1-7 OCT')).toBe('Transferencia de PLATAFORMA NORTE SL liquidacion 1-7 oct')
    expect(limpiarConcepto('TRANSFERENCIA A CUENTA SUR')).toBe('Transferencia a cuenta SUR')
    // Lo que no viene todo en mayúsculas se respeta.
    expect(limpiarConcepto('Transferencia recibida · Plataforma Norte SL')).toBe('Transferencia recibida · Plataforma Norte SL')
    expect(limpiarConcepto('  ** ')).toBe('')
  })
})

/** Un ejemplo inventado de la exportación de cada banco: cabecera habitual y tres movimientos. */
const EJEMPLOS: Record<BancoCsv, string[][]> = {
  bbva: [['Movimientos de la cuenta'], ['Cuenta', ibanDesdeCcc('0182', '9001', '0000000017')], [],
    ['F.Valor', 'Fecha', 'Concepto', 'Movimiento', 'Importe', 'Divisa', 'Disponible', 'Divisa', 'Observaciones'],
    ['13/10/2026', '13/10/2026', 'Transferencia recibida', 'Plataforma Norte SL', '3.412,18', 'EUR', '50.000,00', 'EUR', 'Liquidación 1-7 oct'],
    ['12/10/2026', '12/10/2026', 'Recibo', 'Suministros del Norte', '-498,88', 'EUR', '46.587,82', 'EUR', ''],
    ['11/10/2026', '11/10/2026', 'Transferencia realizada', 'A cuenta Sur', '-2.000,00', 'EUR', '47.086,70', 'EUR', '']],
  santander: [['Fecha Operación', 'Fecha Valor', 'Concepto', 'Importe', 'Divisa', 'Saldo'],
    ['01/10/2026', '01/10/2026', 'Transferencia de Cliente Alfa', '100,00', 'EUR', '1.100,00'],
    ['02/10/2026', '02/10/2026', 'Comisión mantenimiento', '-12,00', 'EUR', '1.088,00'],
    ['03/10/2026', '03/10/2026', 'Recibo luz', '-55,10', 'EUR', '1.032,90']],
  caixabank: [['Fecha', 'Fecha valor', 'Movimiento', 'Más datos', 'Importe', 'Saldo'],
    ['03/10/2026', '03/10/2026', 'TRANSF A FAVOR', 'MAYORISTA ALFA', '-1.411,47', '8.588,53'],
    ['02/10/2026', '02/10/2026', 'INGRESO', 'CAJA', '2.000,00', '10.000,00'],
    ['01/10/2026', '01/10/2026', 'RECIBO', 'TELEFONO', '-45,00', '8.000,00']],
  sabadell: [['F. Operativa', 'Concepto', 'F. Valor', 'Importe', 'Saldo', 'Referencia 1', 'Referencia 2'],
    ['01/10/2026', 'TRANSFERENCIA DE CLIENTE BETA', '01/10/2026', '250,00', '1.250,00', 'R-001', ''],
    ['02/10/2026', 'CUOTA PRESTAMO', '02/10/2026', '-800,00', '450,00', 'P-77', '']],
  bankinter: [['Fecha contable', 'Fecha valor', 'Descripción', 'Importe', 'Saldo'],
    ['05/10/2026', '05/10/2026', 'TRANSF. RECIBIDA', '1.000,00', '6.000,00'],
    ['06/10/2026', '06/10/2026', 'COMISION', '-3,50', '5.996,50']],
  unicaja: [['Fecha', 'Fecha valor', 'Concepto', 'Importe', 'Saldo'],
    ['07/10/2026', '07/10/2026', 'RECIBO AGUA', '-30,25', '969,75'],
    ['08/10/2026', '08/10/2026', 'TRANSFERENCIA', '100,00', '1.069,75']],
  kutxabank: [['Fecha', 'Concepto', 'Fecha valor', 'Importe', 'Saldo'],
    ['09/10/2026', 'RECIBO SEGURO', '09/10/2026', '-120,00', '880,00'],
    ['10/10/2026', 'ABONO', '10/10/2026', '20,00', '900,00']],
  ibercaja: [['Fecha Oper.', 'Fecha Valor', 'Concepto', 'Descripción', 'Importe', 'Saldo'],
    ['01/10/2026', '01/10/2026', 'RECIBO', 'ALQUILER LOCAL', '-1.200,00', '3.800,00'],
    ['02/10/2026', '02/10/2026', 'TRANSFERENCIA', 'CLIENTE GAMMA', '600,00', '4.400,00']],
  abanca: [['Fecha ctble', 'Fecha valor', 'Concepto', 'Importe', 'Moneda', 'Saldo', 'Moneda'],
    ['01/10/2026', '01/10/2026', 'TRANSFERENCIA', '75,00', 'EUR', '175,00', 'EUR'],
    ['02/10/2026', '02/10/2026', 'TARJETA', '-25,00', 'EUR', '150,00', 'EUR']],
  ing: [['F. VALOR', 'CATEGORÍA', 'SUBCATEGORÍA', 'DESCRIPCIÓN', 'COMENTARIO', 'IMAGEN', 'IMPORTE (€)', 'SALDO (€)'],
    ['01/10/2026', 'Ingresos', 'Transferencias', 'Transferencia recibida de Cliente Delta', '', 'No', '50', '1050'],
    ['02/10/2026', 'Gastos', 'Suministros', 'Recibo gas', '', 'No', '-20.5', '1029.5']],
  cajamar: [['Fecha', 'Fecha Valor', 'Concepto', 'Cargo', 'Abono', 'Saldo'],
    ['01/10/2026', '01/10/2026', 'RECIBO', '40,00', '', '960,00'],
    ['02/10/2026', '02/10/2026', 'TRANSFERENCIA', '', '140,00', '1.100,00']],
  tarjeta: [['Tarjeta ···· 1150'], ['Fecha', 'Comercio', 'Importe'],
    ['03/10/2026', 'MERCADO CENTRAL', '86,40'],
    ['04/10/2026', 'GASOLINERA', '50,00'],
    ['05/10/2026', 'DEVOLUCION MERCADO CENTRAL', '-10,00']],
}

describe('Excel/CSV de los once bancos y la tarjeta', () => {
  it('hay un perfil y un ejemplo por cada banco del encargo, y la tarjeta', () => {
    expect(Object.keys(PERFILES).sort()).toEqual(['abanca', 'bankinter', 'bbva', 'caixabank', 'cajamar', 'ibercaja', 'ing', 'kutxabank', 'sabadell', 'santander', 'tarjeta', 'unicaja'])
    expect(Object.keys(EJEMPLOS).sort()).toEqual(Object.keys(PERFILES).sort())
  })

  for (const banco of Object.keys(EJEMPLOS) as BancoCsv[]) {
    it(`${PERFILES[banco].nombre}: lee su ejemplo y cuadra (o dice que no puede)`, () => {
      const e = leerCsvBanco(EJEMPLOS[banco], banco)
      const c = e.cuentas[0]
      expect(c.movimientos.length).toBeGreaterThanOrEqual(2)
      // En orden de fechas, aunque el banco dé lo último arriba.
      const fechas = c.movimientos.map((m) => m.fecha)
      expect([...fechas].sort()).toEqual(fechas)
      const cu = cuadrar(e)
      expect(cu.motivos).toEqual([])
      if (banco === 'tarjeta') expect(cu.sinComprobar).toHaveLength(1)
      else expect(cu.sinComprobar).toEqual([])
    })
  }

  it('signos: cargo/abono en dos columnas, y la tarjeta con los cargos en positivo', () => {
    expect(leerCsvBanco(EJEMPLOS.cajamar, 'cajamar').cuentas[0].movimientos.map((m) => m.importeCent)).toEqual([-4000, 14000])
    expect(leerCsvBanco(EJEMPLOS.tarjeta, 'tarjeta').cuentas[0].movimientos.map((m) => m.importeCent)).toEqual([-8640, -5000, 1000])
  })

  it('BBVA: une concepto, movimiento y observaciones; saca el IBAN de la cabecera; reconoce el banco por él', () => {
    const e = leerCsvBanco(EJEMPLOS.bbva, 'bbva')
    expect(e.cuentas[0].iban).toBe(ibanDesdeCcc('0182', '9001', '0000000017'))
    expect(e.cuentas[0].movimientos[2].conceptoBanco).toBe('Transferencia recibida · Plataforma Norte SL · Liquidación 1-7 oct')
    expect(reconocerBanco(EJEMPLOS.bbva)).toBe('bbva')
    expect(reconocerBanco(EJEMPLOS.santander)).toBe('santander')
  })

  it('S01d · un saldo que no sale de la fila anterior se caza, pero si el total cuadra entra con aviso', () => {
    const malo = EJEMPLOS.santander.map((f) => [...f]); malo[2][5] = '1.090,00'
    const c = cuadrar(leerCsvBanco(malo, 'santander'))
    expect(c.ok).toBe(true)
    expect(c.avisos?.[0]).toMatch(/el saldo del banco no sale de la anterior; el total cuadra\.$/)
    expect(c.filasRotas?.some((f) => f.saldoCent === 109000 && f.esperadoCent === 108800)).toBe(true)
  })

  it('S01d · si el total no cuadra (falta un movimiento), no entra', () => {
    const malo = EJEMPLOS.santander.map((f) => [...f]); malo.splice(2, 1)
    const c = cuadrar({ ...leerCsvBanco(malo, 'santander'), cuentas: leerCsvBanco(malo, 'santander').cuentas.map((x) => ({ ...x, saldoFinalCent: (x.saldoFinalCent ?? 0) + 1 })) })
    expect(c.ok).toBe(false)
    expect(c.motivos[0]).toMatch(/y el banco dice que el saldo final es/)
  })

  it('el fichero de otro banco no se lee a ciegas: dice qué columnas busca', () => {
    expect(() => leerCsvBanco(EJEMPLOS.ing, 'cajamar')).toThrow(CsvBancoNoValido)
    expect(() => leerCsvBanco(EJEMPLOS.ing, 'cajamar')).toThrow(/Cargo y Abono, Fecha, Concepto/)
  })

  it('importes y fechas en todas sus formas', () => {
    expect(leerImporte('1.234,56')).toBe(123456)
    expect(leerImporte('-1.234,56 €')).toBe(-123456)
    expect(leerImporte('1,234.56')).toBe(123456)
    expect(leerImporte('1234.5')).toBe(123450)
    expect(leerImporte('1.234')).toBe(123400)
    expect(leerImporte('(12,50)')).toBe(-1250)
    expect(leerImporte('12,50-')).toBe(-1250)
    expect(leerImporte('−3,00')).toBe(-300)
    expect(leerImporte('1234.5600000001')).toBe(123456)
    expect(leerImporte('abc')).toBeNull()
    expect(leerFecha('13/10/2026')).toBe('2026-10-13')
    expect(leerFecha('13-10-26')).toBe('2026-10-13')
    expect(leerFecha('2026-10-13')).toBe('2026-10-13')
    expect(leerFecha('46308')).toBe('2026-10-13') // número de serie de Excel
    expect(leerFecha('31/02/2026')).toBeNull()
  })
})

describe('Fuentes: fichero, correo (preparado) y agregador (simulado)', () => {
  it('fichero: Norma 43 si lo parece; si no, CSV con su banco', () => {
    expect(leerFicheroBanco({ texto: escribirNorma43([NORTE]) }, partirCsv).formato).toBe('norma43')
    const csv = EJEMPLOS.santander.map((f) => f.join(';')).join('\n')
    expect(leerFicheroBanco({ texto: csv }, partirCsv).formato).toBe('csv:santander')
    expect(() => leerFicheroBanco({ texto: 'a;b\n1;2' }, partirCsv)).toThrow(/No reconozco el banco/)
  })

  it('correo: solo el de la dirección de la empresa; ignora lo que no es extracto; un adjunto malo no tumba a los demás', () => {
    const r = extractosDeCorreo({
      para: 'Bancos-Taberna@in.folvy.app', de: 'avisos@banco.test', asunto: 'Su extracto', recibido: '2026-10-13T07:02:00Z',
      adjuntos: [
        { nombre: 'extracto.n43', contenido: { texto: escribirNorma43([NORTE, SUR]) } },
        { nombre: 'publicidad.pdf', contenido: { texto: '' } },
        { nombre: 'roto.csv', contenido: { texto: 'nada;que;ver' } },
      ],
    }, 'bancos-taberna@in.folvy.app', partirCsv)
    expect(r.aceptado).toBe(true)
    expect(r.extractos.map((x) => [x.adjunto, x.extracto?.cuentas.length ?? null, x.error !== null])).toEqual([['extracto.n43', 2, false], ['roto.csv', null, true]])
    expect(r.ignorados).toEqual([{ adjunto: 'publicidad.pdf', motivo: 'no es un fichero de extracto (Norma 43, Excel o CSV)' }])
    expect(extractosDeCorreo({ para: 'otra@in.folvy.app', de: '', asunto: '', recibido: '', adjuntos: [] }, 'bancos-taberna@in.folvy.app', partirCsv).aceptado).toBe(false)
  })

  it('agregador: cualquier proveedor que cumpla la interfaz entra con el mismo modelo, y la huella usa su id', async () => {
    const iban = ibanDesdeCcc('0182', '9001', '0000000017')
    const simulado: ProveedorAgregador = {
      id: 'simulado', nombre: 'Proveedor simulado',
      cuentas: async () => [{ id: 'c1', iban, titular: 'Taberna de Prueba Norte', divisa: 'EUR' }],
      movimientos: async () => ({ saldoInicialCent: 1000, saldoFinalCent: 1500, movimientos: [
        { id: 'tx-2', fecha: '2026-10-02', fechaValor: null, importeCent: -500, concepto: 'Recibo', contraparte: 'Suministros' },
        { id: 'tx-1', fecha: '2026-10-01', fechaValor: null, importeCent: 1000, concepto: 'Transferencia', contraparte: null },
      ] }),
    }
    const e: ExtractoLeido = await leerDesdeAgregador(simulado, 'conexion-1', '2026-10-01', '2026-10-13')
    expect(e.formato).toBe('agregador:simulado')
    expect(e.cuentas[0].movimientos.map((m) => m.referencia2)).toEqual(['tx-1', 'tx-2'])
    expect(cuadrar(e).ok).toBe(true)
    expect(huellas(e.cuentas[0].movimientos)[0]).toContain('tx-1')
    await expect(leerDesdeAgregador({ ...simulado, id: 'Con Espacios' }, 'x', '2026-10-01', '2026-10-02')).rejects.toThrow(/no vale para la fuente/)
  })
})
