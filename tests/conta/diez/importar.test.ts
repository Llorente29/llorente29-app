// El orquestador del histórico (diezImportar.ts) contra un Diez y una base de
// mentira en memoria. Datos INVENTADOS con la forma de Diez (Apunte). La base
// de verdad (20261019T0150) tiene su propia prueba en staging; aquí se mide lo
// que decide el orquestador: qué lee, qué aparta, en qué orden escribe, cómo
// suma el parte y que no se pierde nada en silencio.

import { afterEach, describe, expect, it } from 'vitest'
import { ClienteDiez, type Apunte } from '../../../supabase/functions/_shared/diezCliente'
import { arrancarDiezFalso } from '../../../scripts/conta/diez/falso.mjs'
import { enTandas, importarHistorico, mesesEntre, ordenarAsientos, parteLimpio, resumenParte, type LectorDiez, type Rpc } from '../../../supabase/functions/_shared/diezImportar'

const ap = (ej: string, serie: string, doc: number, fecha: number, lineas: [string, number, number][], tipo = 0): Apunte =>
  ({ Ejercicio: ej, Serie: serie, Documento: doc, Fecha: fecha, TipoAsiento: tipo, Descripcion: `Inventado ${doc}`,
     Detalles: lineas.map(([Cuenta, Debe, Haber], i) => ({ Linea: i + 1, Cuenta, Debe, Haber })) }) as Apunte

const DIEZ: Record<string, Apunte[]> = {
  '202409': [
    ap('2024', '4', 2, 20240915, [['57000000', 10, 0], ['55100000', 0, 10]]),
    ap('2024', '2', 7, 20240901, [['60000000', 100, 0], ['47200000', 21, 0], ['40000901', 0, 121]], 2),
    ap('2024', '4', 1, 20240901, [['57000000', 5, 0], ['55100000', 0, 5]]),
  ],
  '202410': [
    ap('2024', '4', 3, 20241002, [['57000000', 1, 0]]), // una sola línea: no se convierte
    ap('2024', '4', 4, 20241031, [['57000000', -3, 0], ['55100000', 0, -3]]), // negativos: se pasan de lado
  ],
}
const lector = (datos = DIEZ): LectorDiez & { pedidos: string[] } => {
  const pedidos: string[] = []
  return {
    pedidos,
    apuntesDelMes: async (m) => { pedidos.push(m); return datos[m] ?? [] },
    subcuentas: async () => [{ Codigo: '40000901', Descripcion: 'PROVEEDOR INVENTADO' }, { Codigo: '57000000', Descripcion: 'CAJA' }],
  }
}

/** Una base de mentira con las reglas que importan aquí. */
function base(opc: { ejercicioFolvy?: string; plan?: string[] } = {}) {
  const asientos = new Map<string, { huella: string; orden: number }>()
  const plan = new Set(opc.plan ?? ['57000000', '55100000', '60000000', '47200000'])
  const llamadas: { fn: string; args: Record<string, unknown> }[] = []
  let orden = 0
  const rpc: Rpc = async (fn, args) => {
    llamadas.push({ fn, args })
    if (fn === 'conta_diez_ejercicio') {
      if (args.p_code === opc.ejercicioFolvy) throw new Error(`El ejercicio ${args.p_code} ya existe y es de Folvy`)
      return `fy-${args.p_code}`
    }
    if (fn === 'conta_diez_subcuentas') {
      let nuevas = 0, estaban = 0
      for (const c of args.p_cuentas as { code: string; nombre: string }[]) { if (plan.has(c.code)) estaban++; else { plan.add(c.code); nuevas++ } }
      return { nuevas, estaban, rechazadas: [] }
    }
    if (fn === 'conta_diez_importar') {
      const r = { traidos: 0, yaEstaban: 0, distintos: [] as { clave: string; id: string }[], rechazados: [] as { clave: string; motivo: string }[] }
      for (const a of args.p_asientos as { ejercicio: string; serie: number; numero: number; huella: string; lineas: { cuenta: string }[] }[]) {
        const clave = `${a.ejercicio}/${a.serie}/${a.numero}`
        const ya = asientos.get(clave)
        if (ya) { if (ya.huella === a.huella) r.yaEstaban++; else r.distintos.push({ clave, id: clave }); continue }
        if (a.ejercicio === opc.ejercicioFolvy) { r.rechazados.push({ clave, motivo: `el ejercicio ${a.ejercicio} es de Folvy, no traído` }); continue }
        const falta = a.lineas.find((l) => !plan.has(l.cuenta))
        if (falta) { r.rechazados.push({ clave, motivo: `faltan en el plan las subcuentas ${falta.cuenta}` }); continue }
        asientos.set(clave, { huella: a.huella, orden: orden++ }); r.traidos++
      }
      return r
    }
    throw new Error(`función desconocida ${fn}`)
  }
  return { rpc, asientos, llamadas, plan }
}

const CFG = { empresa: 'c', lectura: 'r', desde: '202409', hasta: '202410', corte: '2024-10-30' }

describe('mesesEntre y enTandas', () => {
  it('cuenta los meses cruzando el año, y no admite un rango al revés', () => {
    expect(mesesEntre('202311', '202402')).toEqual(['202311', '202312', '202401', '202402'])
    expect(() => mesesEntre('202402', '202311')).toThrow(/no válidos/)
  })
  it('parte en tandas sin perder ni repetir', () => {
    expect(enTandas([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(() => enTandas([1], 0)).toThrow()
  })
})

describe('importarHistorico', () => {
  it('lee cada mes, aparta lo que no se convierte y lo posterior al corte, y escribe en el orden de la cadena', async () => {
    const L = lector(), B = base()
    const p = await importarHistorico({ ...CFG, lector: L, rpc: B.rpc })
    expect(L.pedidos).toEqual(['202409', '202410'])
    expect(p.leidos).toBe(5)
    expect(p.rechazadosAlConvertir.map((r) => r.clave)).toEqual(['2024/4/3'])
    expect(p.fueraDelCorte).toEqual(['2024/4/4']) // 31/10, después del corte del 30/10
    expect(p.traidos).toBe(3)
    // (fecha, serie, número): el 01/09 serie 2 antes que el 01/09 serie 4, y el 15/09 al final.
    const orden = [...B.asientos.entries()].sort((a, b) => a[1].orden - b[1].orden).map(([k]) => k)
    expect(orden).toEqual(['2024/2/7', '2024/4/1', '2024/4/2'])
    // La subcuenta que faltaba se da de alta con el nombre de Diez, antes de escribir.
    const sub = B.llamadas.find((l) => l.fn === 'conta_diez_subcuentas')!
    expect(sub.args.p_cuentas).toContainEqual({ code: '40000901', nombre: 'PROVEEDOR INVENTADO' })
    expect(B.llamadas.findIndex((l) => l.fn === 'conta_diez_subcuentas')).toBeLessThan(B.llamadas.findIndex((l) => l.fn === 'conta_diez_importar'))
    expect(p.subcuentas).toEqual({ nuevas: 1, estaban: 4, rechazadas: [] })
    expect(parteLimpio(p)).toBe(false) // el de una sola línea queda por explicar
    expect(resumenParte(p)).toBe('3 asientos traídos de 5 leídos en 2 meses · 1 que no se pueden convertir · 1 posteriores al corte (entran por el día a día) · 1 subcuentas nuevas traídas de Diez')
  })

  it('un asiento con todo a cero queda fuera «sin importe en Diez», no es un rechazo y deja el parte limpio', async () => {
    const B = base()
    const datos = { '202409': [...DIEZ['202409'], ap('2024', '4', 9, 20240920, [['57000000', 0, 0], ['55100000', 0, 0]])] }
    const p = await importarHistorico({ ...CFG, hasta: '202409', lector: lector(datos), rpc: B.rpc })
    expect(p.sinImporte).toEqual([{ clave: '2024/4/9', motivo: 'sin importe en Diez' }])
    expect(p.rechazadosAlConvertir).toEqual([])
    expect(p.traidos).toBe(3)
    expect(parteLimpio(p)).toBe(true)
    expect(resumenParte(p)).toContain('1 fuera, sin importe en Diez')
  })

  it('el negativo de Diez viaja con su marca a la base', async () => {
    const B = base()
    await importarHistorico({ ...CFG, corte: '2024-12-31', lector: lector(), rpc: B.rpc })
    const enviado = B.llamadas.filter((l) => l.fn === 'conta_diez_importar').flatMap((l) => l.args.p_asientos as { numero: number; lineas: { cuenta: string; debe: number; haber: number; negativoEnDiez: string | null }[] }[])
    const cuatro = enviado.find((a) => a.numero === 4)!
    expect(cuatro.lineas.map((l) => [l.cuenta, l.debe, l.haber, l.negativoEnDiez])).toEqual([['57000000', 0, 300, 'debe'], ['55100000', 300, 0, 'haber']])
  })

  it('traerlo dos veces no duplica; si cambió en Diez, se dice y no se pisa', async () => {
    const B = base()
    await importarHistorico({ ...CFG, lector: lector(), rpc: B.rpc })
    const otra = { ...DIEZ, '202409': DIEZ['202409'].map((a) => (a.Documento === 2 ? ap('2024', '4', 2, 20240915, [['57000000', 11, 0], ['55100000', 0, 11]]) : a)) }
    const p = await importarHistorico({ ...CFG, lector: lector(otra), rpc: B.rpc })
    expect(p.traidos).toBe(0)
    expect(p.yaEstaban).toBe(2)
    expect(p.distintos.map((d) => d.clave)).toEqual(['2024/4/2'])
    expect(B.asientos.size).toBe(3)
    expect(resumenParte(p)).toContain('1 cambiados en Diez después de traerlos (no se pisan)')
  })

  it('un ejercicio de Folvy no se toca: el problema sale en el parte y sus asientos, rechazados con motivo', async () => {
    const B = base({ ejercicioFolvy: '2024' })
    const p = await importarHistorico({ ...CFG, lector: lector(), rpc: B.rpc })
    expect(p.ejercicios).toEqual([{ codigo: '2024', problema: 'El ejercicio 2024 ya existe y es de Folvy' }])
    expect(p.traidos).toBe(0)
    expect(p.rechazados).toHaveLength(3)
    expect(p.rechazados[0].motivo).toMatch(/es de Folvy/)
    expect(resumenParte(p)).toContain('ejercicios con problema: 2024')
  })

  it('por tandas: cada llamada lleva como mucho el tamaño pedido, y el total es el mismo', async () => {
    const B = base()
    const p = await importarHistorico({ ...CFG, tandas: 2, lector: lector(), rpc: B.rpc })
    const tamaños = B.llamadas.filter((l) => l.fn === 'conta_diez_importar').map((l) => (l.args.p_asientos as unknown[]).length)
    expect(tamaños).toEqual([2, 1])
    expect(p.traidos).toBe(3)
  })

  it('si Diez repite un asiento en el listado, para sin escribir nada', async () => {
    const B = base()
    const repe = { '202409': [DIEZ['202409'][0], DIEZ['202409'][0]] }
    await expect(importarHistorico({ ...CFG, hasta: '202409', lector: lector(repe), rpc: B.rpc })).rejects.toThrow(/dos veces el asiento 2024\/4\/2/)
    expect(B.llamadas).toHaveLength(0)
  })

  it('el corte se valida', async () => {
    await expect(importarHistorico({ ...CFG, corte: '30/09/2026', lector: lector(), rpc: base().rpc })).rejects.toThrow(/Corte no válido/)
  })

  it('ordenarAsientos no toca la lista que recibe', () => {
    const xs = [{ fecha: '2024-02-01', serie: 1, numero: 1 }, { fecha: '2024-01-01', serie: 1, numero: 2 }] as never[]
    const copia = JSON.stringify(xs)
    expect(ordenarAsientos(xs).map((x: { numero: number }) => x.numero)).toEqual([2, 1])
    expect(JSON.stringify(xs)).toBe(copia)
  })
})

describe('con el ClienteDiez de verdad contra el Diez simulado', () => {
  let falso: Awaited<ReturnType<typeof arrancarDiezFalso>> | null = null
  afterEach(async () => { await falso?.cerrar(); falso = null })

  it('lee por mes con el cliente (paginado, por Fecha) y trae lo mismo que con el lector de mentira', async () => {
    // 250 asientos en un mes: más de una página de 200.
    const muchos = Array.from({ length: 250 }, (_, i) => ap('2024', '3', i + 1, 20240901 + (i % 28), [['57000000', 1 + i, 0], ['55100000', 0, 1 + i]]))
    falso = await arrancarDiezFalso({ bases: { C0009: { apuntes: [...muchos, ...DIEZ['202410']], subcuentas: [{ Codigo: '57000000', Descripcion: 'CAJA' }] } } })
    let guardado: { token: string; expiresAt: string } | null = null
    const c = new ClienteDiez({ base: falso.url, nombreBd: 'C0009', credenciales: falso.credenciales, pausaMs: 0,
      almacen: { leer: async () => guardado, guardar: async (token, expiresAt) => { guardado = { token, expiresAt } }, caida: async () => { guardado = null } } })
    const B = base()
    const p = await importarHistorico({ ...CFG, lector: c, rpc: B.rpc })
    expect(p.leidos).toBe(252)
    expect(p.traidos).toBe(250)
    expect(B.asientos.size).toBe(250)
    expect(p.rechazadosAlConvertir).toHaveLength(1)
    expect(p.fueraDelCorte).toHaveLength(1)
    // Solo lectura: el importador no escribe nada en Diez.
    expect(falso.estado.peticiones.filter((x: { metodo: string }) => x.metodo !== 'GET' && x.metodo !== 'POST').length + falso.estado.peticiones.filter((x: { ruta: string }) => x.ruta.endsWith('/add')).length).toBe(0)
  })
})
