// tests/unit/modules/multitenancy/analysisAccountsService.mappers.test.ts
//
// Smoke tests del mapper rowToAnalysisAccount.
//
// Casos elegidos con intención:
//   - Row "full" con parent_id presente              → mapeo completo (cuenta hija)
//   - Row con parent_id null                         → cuenta raíz
//   - Distintos account_type literales               → cast AnalysisAccountType
//   - Cuenta inactiva                                → soft delete sin archived_at

import { describe, it, expect } from 'vitest'
import { rowToAnalysisAccount } from '@/modules/multitenancy/services/analysisAccountsService'
import type { RowAnalysisAccount } from '@/types/multitenancy'

const ACCOUNT_ID = '00000000-0000-0000-0000-000000000001'
const PARENT_UUID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'

function makeRow(
  overrides: Partial<RowAnalysisAccount> = {}
): RowAnalysisAccount {
  return {
    id: '55555555-5555-5555-5555-555555555555',
    account_id: ACCOUNT_ID,
    code: '700.001',
    name: 'Ventas Sala',
    parent_id: PARENT_UUID,
    account_type: 'revenue',
    is_active: true,
    created_at: '2026-05-16T10:00:00Z',
    updated_at: '2026-05-16T10:00:00Z',
    ...overrides,
  } as RowAnalysisAccount
}

describe('rowToAnalysisAccount', () => {
  it('mapea un row completo de snake_case a camelCase preservando todos los valores', () => {
    const row = makeRow()
    const aa = rowToAnalysisAccount(row)

    expect(aa).toEqual({
      id: '55555555-5555-5555-5555-555555555555',
      accountId: ACCOUNT_ID,
      code: '700.001',
      name: 'Ventas Sala',
      parentId: PARENT_UUID,
      accountType: 'revenue',
      isActive: true,
      createdAt: '2026-05-16T10:00:00Z',
      updatedAt: '2026-05-16T10:00:00Z',
    })
  })

  it('cuenta raíz: parent_id=null → parentId=null', () => {
    const row = makeRow({
      parent_id: null,
      code: '700',
      name: 'Ventas',
    })
    const aa = rowToAnalysisAccount(row)

    expect(aa.parentId).toBeNull()
    expect(aa.code).toBe('700')
  })

  it('soporta los distintos account_type del enum AnalysisAccountType', () => {
    const types = ['expense', 'revenue', 'cost_of_goods', 'other'] as const
    for (const t of types) {
      const aa = rowToAnalysisAccount(makeRow({ account_type: t }))
      expect(aa.accountType).toBe(t)
    }
  })

  it('cuenta inactiva: is_active=false (NO hay archived_at en esta tabla)', () => {
    const row = makeRow({ is_active: false })
    const aa = rowToAnalysisAccount(row)

    expect(aa.isActive).toBe(false)
    expect('archivedAt' in aa).toBe(false)
  })

  it('caso real: cuenta hija "600.001 — Mercaderías Lobbers" bajo padre "600 — Compras"', () => {
    const row = makeRow({
      code: '600.001',
      name: 'Mercaderías Lobbers',
      parent_id: PARENT_UUID,
      account_type: 'cost_of_goods',
    })
    const aa = rowToAnalysisAccount(row)

    expect(aa.code).toBe('600.001')
    expect(aa.name).toBe('Mercaderías Lobbers')
    expect(aa.parentId).toBe(PARENT_UUID)
    expect(aa.accountType).toBe('cost_of_goods')
  })
})
