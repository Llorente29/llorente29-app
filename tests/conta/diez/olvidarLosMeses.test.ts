// B01r26 (14/11) · Cada tanda del traspaso lee el mes de Diez de nuevo: lo leído
// del mes se olvida (olvidarLosMeses) y lo de después de borrar en Diez se ve.
// Contra el Diez simulado, con datos inventados.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ClienteDiez, olvidarLoLeido, olvidarLosMeses, type AlmacenToken, type TokenGuardado } from '../../../supabase/functions/_shared/diezCliente'
import { arrancarDiezFalso } from '../../../scripts/conta/diez/falso.mjs'

type Falso = Awaited<ReturnType<typeof arrancarDiezFalso>>
let falso: Falso | null = null
let guardado: TokenGuardado | null = null
beforeEach(() => { olvidarLoLeido(); guardado = null })
afterEach(async () => { await falso?.cerrar(); falso = null })
const almacen: AlmacenToken = { leer: async () => guardado, guardar: async (token, expiresAt) => { guardado = { token, expiresAt } }, caida: async () => { guardado = null } }
const ap = (doc: number) => ({ Ejercicio: '2026', Serie: '4', Documento: doc, TipoAsiento: 0, Fecha: 20261007, Detalles: [{ Linea: 1, Cuenta: '57200001', Debe: 0, Haber: 100 }, { Linea: 2, Cuenta: '40700001', Debe: 100, Haber: 0 }] })

describe('olvidarLosMeses', () => {
  it('lo borrado en Diez después de leer el mes se ve en cuanto se olvida lo leído', async () => {
    falso = await arrancarDiezFalso({ bases: { C0008: { apuntes: [ap(3442), ap(3443)] } } })
    const c = new ClienteDiez({ base: falso.url, nombreBd: 'C0008', credenciales: falso.credenciales as never, almacen, escribir: false })
    expect((await c.apuntesDelMes('202610')).length).toBe(2)
    // Alguien borra en Diez.
    falso.estado.bases.C0008.apuntes.length = 0
    expect((await c.apuntesDelMes('202610')).length).toBe(2) // lo leído, 10 minutos
    olvidarLosMeses()
    expect((await c.apuntesDelMes('202610')).length).toBe(0)
  })
})
