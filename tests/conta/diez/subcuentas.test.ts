// C04b R5 · Las subcuentas que Diez no tenga se crean primero en Diez, con el
// mismo código y nombre que en Folvy. Las del caso real: 47700010 y las tres
// 708 nuevas de la 0120 (los nombres son los de Folvy; el plan de Diez,
// inventado salvo esos códigos).
import { afterEach, describe, expect, it } from 'vitest'
import { asegurarSubcuentas, planDeDiez, subcuentasQueFaltan } from '../../../supabase/functions/_shared/diezSubcuentas'
import { ClienteDiez, FrenoDiez, type AlmacenToken } from '../../../supabase/functions/_shared/diezCliente'
import { arrancarDiezFalso } from '../../../scripts/conta/diez/falso.mjs'

const USADAS = [
  { codigo: '43000001', nombre: 'GLOVO' },
  { codigo: '70000002', nombre: 'VENTAS MERAKI PITA' },
  { codigo: '47700010', nombre: 'IVA repercutido 10 %' },
  { codigo: '70800003', nombre: 'DEVOL. VENTAS SCANDAL BURGER' },
  { codigo: '47700010', nombre: 'IVA repercutido 10 %' },
]
const PLAN = planDeDiez([{ Codigo: '43000001', Descripcion: 'GLOVO' }, { Codigo: '70000002', Descripcion: 'VENTAS MERAKI PITA' }, { Codigo: '47700000', Descripcion: 'H.P. IVA REPERCUTIDO' }])

describe('qué falta en Diez', () => {
  it('solo lo que no está, una vez cada una, en orden', () => {
    const q = subcuentasQueFaltan(USADAS, PLAN)
    expect(q.crear).toEqual([{ codigo: '47700010', nombre: 'IVA repercutido 10 %' }, { codigo: '70800003', nombre: 'DEVOL. VENTAS SCANDAL BURGER' }])
    expect(q.frenos).toEqual([])
  })
  it('la que ya está con otro nombre no se toca, y se dice', () => {
    const q = subcuentasQueFaltan([{ codigo: '43000001', nombre: 'GLOVO APP' }], PLAN)
    expect(q.crear).toEqual([])
    expect(q.otroNombre).toEqual([{ codigo: '43000001', folvy: 'GLOVO APP', diez: 'GLOVO' }])
  })
  it('un código que no es de 8 dígitos o un nombre que Diez cortaría: freno, no se recorta', () => {
    const q = subcuentasQueFaltan([{ codigo: '4770001', nombre: 'x' }, { codigo: '62900099', nombre: 'x'.repeat(61) }], PLAN)
    expect(q.frenos).toHaveLength(2)
    expect(q.crear).toEqual([])
  })
})

describe('crearlas y comprobarlas', () => {
  const doble = (plan: { Codigo: string; Descripcion: string }[], guardar = true) => {
    const creadas: { Codigo: string; Descripcion: string }[] = []
    return {
      creadas,
      c: {
        subcuentas: async () => [...plan, ...(guardar ? creadas : [])] as Record<string, unknown>[],
        crearSubcuenta: async (s: { Codigo: string; Descripcion: string }) => { creadas.push(s); return [s] },
      },
    }
  }
  it('crea las que faltan con su código y su nombre, y las vuelve a leer', async () => {
    const d = doble([{ Codigo: '43000001', Descripcion: 'GLOVO' }, { Codigo: '70000002', Descripcion: 'VENTAS MERAKI PITA' }])
    const r = await asegurarSubcuentas(d.c, USADAS)
    expect(d.creadas).toEqual([{ Codigo: '47700010', Descripcion: 'IVA repercutido 10 %' }, { Codigo: '70800003', Descripcion: 'DEVOL. VENTAS SCANDAL BURGER' }])
    expect(r.creadas).toEqual(['47700010', '70800003'])
    expect(r.yaEstaban).toBe(2)
  })
  it('si después no están, falla: no se da por hecho', async () => {
    const d = doble([], false)
    await expect(asegurarSubcuentas(d.c, [{ codigo: '47700010', nombre: 'IVA repercutido 10 %' }])).rejects.toThrow(/después de crearlas no están/)
  })
  it('con un freno no se crea ninguna', async () => {
    const d = doble([])
    await expect(asegurarSubcuentas(d.c, [{ codigo: '47700010', nombre: 'IVA' }, { codigo: '123', nombre: 'mal' }])).rejects.toThrow(/no se crea ninguna/)
    expect(d.creadas).toEqual([])
  })
})

describe('el alta pasa por los frenos del cliente', () => {
  let falso: Awaited<ReturnType<typeof arrancarDiezFalso>> | null = null
  afterEach(async () => { await falso?.cerrar(); falso = null })
  const almacen: AlmacenToken = { leer: async () => null, guardar: async () => {}, caida: async () => {} }
  it('sin «escribir» no sale; en C0008 exige escribirEnReal', async () => {
    falso = await arrancarDiezFalso({ bases: { C0009: {}, C0008: {} } })
    const sin = new ClienteDiez({ base: falso.url, nombreBd: 'C0009', credenciales: falso.credenciales, almacen })
    await expect(sin.crearSubcuenta({ Codigo: '47700010', Descripcion: 'IVA repercutido 10 %' })).rejects.toThrow(FrenoDiez)
    const real = new ClienteDiez({ base: falso.url, nombreBd: 'C0008', credenciales: falso.credenciales, almacen, escribir: true })
    await expect(real.crearSubcuenta({ Codigo: '47700010', Descripcion: 'IVA repercutido 10 %' })).rejects.toThrow(/escribirEnReal/)
    expect(falso.estado.peticiones.filter((p: { ruta?: string; url?: string }) => String(p.ruta ?? p.url ?? '').includes('subcuentas/add'))).toHaveLength(0)
  })
})
