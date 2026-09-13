// tests/unit/modules/multitenancy/salesChannelsService.mappers.test.ts
//
// Los mapeos de `sales_channel`: de la BBDD al dominio y de vuelta.
//
// ── POR QUÉ SE REESCRIBE ENTERO (13/09) ────────────────────────────────────
//
// Mismo caso que `brandsService.mappers`: llevaba días en rojo, tres partes lo
// llamaron «deuda conocida», y al mirarlo resultó que **la prueba describía
// una tabla que no existe**.
//
//   · `default_commission_pct` / `defaultCommissionPct`: NO EXISTE en
//     `sales_channel`, ni en la tabla ni en el tipo `SalesChannel`. Es lo que
//     ponía en rojo tres de las cinco pruebas. El mapper hace bien en no
//     emitirlo.
//   · «canal "Sala" (caso real de los seeds del proyecto)»: **no hay ningún
//     canal que se llame Sala**. Los `dine_in` de verdad son «Mostrador» y
//     «Salón». Una prueba que se etiqueta a sí misma «caso real» y no lo es
//     hace más daño que una sin etiqueta, porque el siguiente que la lea se
//     la cree.
//   · El bucle por los cinco `channel_type` del tipo: en la tabla solo hay
//     tres —`delivery` (Glovo, JustEat, Uber), `dine_in` (Mostrador, Salón) y
//     `takeaway` (Shop)—. Recorrer los cinco contra un mapper que hace `as`
//     no comprueba nada: un `as` no valida, solo calla al compilador. Abajo se
//     sustituye por lo que sí vale — que todo valor que HAY EN LA TABLA cabe
//     en el tipo, que es el que se rompe el día que alguien añade uno.
//
// Las filas de abajo están copiadas de `sales_channel` con `to_jsonb`, no
// escritas de memoria (regla 31).

import { describe, it, expect } from 'vitest'
import {
  rowToSalesChannel, salesChannelUpdateToRow,
} from '@/modules/multitenancy/services/salesChannelsService'
import type {
  RowSalesChannel, SalesChannelType, SalesChannelUpdate,
} from '@/types/multitenancy'

/** Glovo, tal y como está hoy en Foodint. */
const GLOVO = {
  id: 'f98fcf5b-7ee3-4995-9a29-e755d2bd29f3',
  account_id: '51ad1792-6629-4ef7-833a-b57b09a86710',
  name: 'Glovo',
  slug: 'glovo',
  channel_type: 'delivery',
  color: null,
  is_active: true,
  archived_at: null,
  created_at: '2026-06-20T16:15:02.286843+00:00',
  updated_at: '2026-06-20T16:15:02.286843+00:00',
} as unknown as RowSalesChannel

function fila(cambios: Partial<Record<string, unknown>> = {}): RowSalesChannel {
  return { ...GLOVO, ...cambios } as unknown as RowSalesChannel
}

/** Los tipos que EXISTEN en la tabla, contados el 13/09. */
const LOS_QUE_HAY: Array<{ tipo: string; cuantos: number; ejemplos: string[] }> = [
  { tipo: 'delivery', cuantos: 9, ejemplos: ['Glovo', 'JustEat', 'Uber'] },
  { tipo: 'dine_in',  cuantos: 3, ejemplos: ['Mostrador', 'Salón'] },
  { tipo: 'takeaway', cuantos: 3, ejemplos: ['Shop'] },
]

describe('rowToSalesChannel · de la tabla al dominio', () => {
  it('mapea la fila real entera, y NO se inventa una comisión que no está en esta tabla', () => {
    expect(rowToSalesChannel(fila())).toEqual({
      id: 'f98fcf5b-7ee3-4995-9a29-e755d2bd29f3',
      accountId: '51ad1792-6629-4ef7-833a-b57b09a86710',
      name: 'Glovo',
      slug: 'glovo',
      channelType: 'delivery',
      color: null,
      isActive: true,
      archivedAt: null,
      createdAt: '2026-06-20T16:15:02.286843+00:00',
      updatedAt: '2026-06-20T16:15:02.286843+00:00',
    })
  })

  it('un null de la tabla llega como null, nunca como undefined', () => {
    const c = rowToSalesChannel(fila({ color: null, archived_at: null }))
    for (const [clave, valor] of Object.entries(c)) {
      expect(valor, `${clave} no puede ser undefined`).not.toBeUndefined()
    }
    expect(c.color).toBeNull()
    expect(c.archivedAt).toBeNull()
  })

  it('🔴 todo channel_type que HAY EN LA TABLA cabe en el tipo del dominio', () => {
    // Esto sí se puede romper: el día que alguien meta un canal con un tipo
    // nuevo en la base y no lo añada al tipo, el `as` del mapper lo dejará
    // pasar en silencio y la pantalla pintará algo que nadie contempló.
    const DEL_TIPO: SalesChannelType[] = ['delivery', 'dine_in', 'takeaway', 'catering', 'other']
    for (const { tipo, ejemplos } of LOS_QUE_HAY) {
      expect(DEL_TIPO, `${tipo} está en la tabla y no en el tipo`).toContain(tipo)
      const c = rowToSalesChannel(fila({ channel_type: tipo, name: ejemplos[0] }))
      expect(c.channelType).toBe(tipo)
      expect(c.name).toBe(ejemplos[0])
    }
  })

  it('los canales de sala se llaman Mostrador y Salón, no «Sala»', () => {
    // Se deja escrito porque la prueba vieja afirmaba lo contrario diciendo
    // que era «el caso real de los seeds».
    const nombres = LOS_QUE_HAY.find((x) => x.tipo === 'dine_in')!.ejemplos
    expect(nombres).toEqual(['Mostrador', 'Salón'])
    expect(nombres).not.toContain('Sala')
  })

  it('archivado: is_active false con su fecha', () => {
    const c = rowToSalesChannel(fila({ is_active: false, archived_at: '2026-05-16T09:00:00Z' }))
    expect(c.isActive).toBe(false)
    expect(c.archivedAt).toBe('2026-05-16T09:00:00Z')
  })
})

describe('🔴 salesChannelUpdateToRow · ¿se puede BORRAR un campo, de verdad?', () => {
  it('sí: un null explícito viaja como null y limpia la columna', () => {
    const row = salesChannelUpdateToRow({ color: null, archivedAt: null })
    expect(Object.prototype.hasOwnProperty.call(row, 'color')).toBe(true)
    expect(row.color).toBeNull()
    expect(Object.prototype.hasOwnProperty.call(row, 'archived_at')).toBe(true)
    expect(row.archived_at).toBeNull()
  })

  it('y lo que no se toca NO viaja', () => {
    expect(Object.keys(salesChannelUpdateToRow({}))).toHaveLength(0)
    const parche: SalesChannelUpdate = { color: undefined, name: 'Glovo' }
    const row = salesChannelUpdateToRow(parche)
    expect(Object.prototype.hasOwnProperty.call(row, 'color')).toBe(false)
    expect(row.name).toBe('Glovo')
  })
})
