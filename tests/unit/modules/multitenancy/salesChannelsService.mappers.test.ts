// tests/unit/modules/multitenancy/salesChannelsService.mappers.test.ts
//
// Smoke tests del mapper rowToSalesChannel: BBDD snake_case → dominio camelCase.
//
// Casos elegidos con intención:
//   - Row "full" con todos los campos rellenos                → mapeo completo
//   - Row con nullables a null                                → preserva null
//   - Distintos channel_type literales                        → cast SalesChannelType
//   - Row archivado (is_active=false + archived_at)           → flags correctos
//
// No testeamos salesChannelInsertToRow ni salesChannelUpdateToRow hoy.
// Esos se cubrirán cuando montemos el mock encadenable de Supabase.

import { describe, it, expect } from 'vitest'
import { rowToSalesChannel } from '@/modules/multitenancy/services/salesChannelsService'
import type { RowSalesChannel } from '@/types/multitenancy'

// Helper: row baseline válido. Cada test sobreescribe lo que necesite.
function makeRow(overrides: Partial<RowSalesChannel> = {}): RowSalesChannel {
  return {
    id: '22222222-2222-2222-2222-222222222222',
    account_id: '00000000-0000-0000-0000-000000000001',
    name: 'Glovo',
    slug: 'glovo',
    channel_type: 'delivery',
    default_commission_pct: 30.0,
    color: '#FF7700',
    is_active: true,
    archived_at: null,
    created_at: '2026-05-15T10:00:00Z',
    updated_at: '2026-05-15T10:00:00Z',
    ...overrides,
  } as RowSalesChannel
}

describe('rowToSalesChannel', () => {
  it('mapea un row completo de snake_case a camelCase preservando todos los valores', () => {
    const row = makeRow()
    const channel = rowToSalesChannel(row)

    expect(channel).toEqual({
      id: '22222222-2222-2222-2222-222222222222',
      accountId: '00000000-0000-0000-0000-000000000001',
      name: 'Glovo',
      slug: 'glovo',
      channelType: 'delivery',
      defaultCommissionPct: 30.0,
      color: '#FF7700',
      isActive: true,
      archivedAt: null,
      createdAt: '2026-05-15T10:00:00Z',
      updatedAt: '2026-05-15T10:00:00Z',
    })
  })

  it('preserva nullables a null sin convertirlos a undefined', () => {
    const row = makeRow({
      default_commission_pct: null,
      color: null,
      archived_at: null,
    })
    const channel = rowToSalesChannel(row)

    expect(channel.defaultCommissionPct).toBeNull()
    expect(channel.color).toBeNull()
    expect(channel.archivedAt).toBeNull()
  })

  it('soporta los distintos channel_type del enum SalesChannelType', () => {
    const types = ['delivery', 'dine_in', 'takeaway', 'catering', 'other'] as const
    for (const t of types) {
      const channel = rowToSalesChannel(makeRow({ channel_type: t }))
      expect(channel.channelType).toBe(t)
    }
  })

  it('row archivado: is_active=false con archived_at no nulo mapea correctamente', () => {
    const row = makeRow({
      is_active: false,
      archived_at: '2026-05-16T09:00:00Z',
    })
    const channel = rowToSalesChannel(row)

    expect(channel.isActive).toBe(false)
    expect(channel.archivedAt).toBe('2026-05-16T09:00:00Z')
  })

  it('canal "Sala" como dine_in (caso real de los seeds del proyecto)', () => {
    const row = makeRow({
      name: 'Sala',
      slug: 'sala',
      channel_type: 'dine_in',
      default_commission_pct: null,
      color: null,
    })
    const channel = rowToSalesChannel(row)

    expect(channel.name).toBe('Sala')
    expect(channel.channelType).toBe('dine_in')
    expect(channel.defaultCommissionPct).toBeNull()
  })
})
