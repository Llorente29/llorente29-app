// tests/unit/modules/multitenancy/costCentersService.mappers.test.ts
//
// Smoke tests del mapper rowToCostCenter.
//
// Casos elegidos con intención:
//   - Row "full" con location asignado            → mapeo completo
//   - Row con location_id null                    → centro general / cross-local
//   - Centro inactivo                             → soft delete sin archived_at
//   - Casos reales de seeds (CC-ALC, CC-CTB, CC-PZC)

import { describe, it, expect } from 'vitest'
import { rowToCostCenter } from '@/modules/multitenancy/services/costCentersService'
import type { RowCostCenter } from '@/types/multitenancy'

const ALCALA_UUID = '770a9c90-2448-4bae-b952-9cb6b35b4f29'
const CARABANCHEL_UUID = 'c0b1936f-f731-46a4-a031-3958918750a7'

function makeRow(overrides: Partial<RowCostCenter> = {}): RowCostCenter {
  return {
    id: '33333333-3333-3333-3333-333333333333',
    account_id: '00000000-0000-0000-0000-000000000001',
    location_id: ALCALA_UUID,
    code: 'CC-ALC',
    name: 'Centro de Coste Alcalá',
    is_active: true,
    created_at: '2026-05-15T10:00:00Z',
    updated_at: '2026-05-15T10:00:00Z',
    ...overrides,
  } as RowCostCenter
}

describe('rowToCostCenter', () => {
  it('mapea un row completo de snake_case a camelCase preservando todos los valores', () => {
    const row = makeRow()
    const cc = rowToCostCenter(row)

    expect(cc).toEqual({
      id: '33333333-3333-3333-3333-333333333333',
      accountId: '00000000-0000-0000-0000-000000000001',
      locationId: ALCALA_UUID,
      code: 'CC-ALC',
      name: 'Centro de Coste Alcalá',
      isActive: true,
      createdAt: '2026-05-15T10:00:00Z',
      updatedAt: '2026-05-15T10:00:00Z',
    })
  })

  it('preserva location_id=null como locationId=null (cost center general / cross-local)', () => {
    const row = makeRow({ location_id: null, code: 'CC-GEN', name: 'General' })
    const cc = rowToCostCenter(row)

    expect(cc.locationId).toBeNull()
    expect(cc.code).toBe('CC-GEN')
  })

  it('cost center inactivo: is_active=false (NO hay archived_at en esta tabla)', () => {
    const row = makeRow({ is_active: false })
    const cc = rowToCostCenter(row)

    expect(cc.isActive).toBe(false)
    // Confirmamos que el objeto resultante NO tiene archivedAt
    expect('archivedAt' in cc).toBe(false)
  })

  it('caso real: CC-CTB asignado a Carabanchel', () => {
    const row = makeRow({
      location_id: CARABANCHEL_UUID,
      code: 'CC-CTB',
      name: 'Centro de Coste Carabanchel',
    })
    const cc = rowToCostCenter(row)

    expect(cc.locationId).toBe(CARABANCHEL_UUID)
    expect(cc.code).toBe('CC-CTB')
    expect(cc.name).toBe('Centro de Coste Carabanchel')
  })
})
