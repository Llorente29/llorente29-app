// tests/unit/modules/multitenancy/brandLocationService.mappers.test.ts
//
// Smoke tests del mapper rowToBrandLocationAvailability.
//
// Casos elegidos con intención:
//   - Row "full" con todos los campos rellenos      → mapeo completo
//   - Row con nullables a null                      → preserva null
//   - Availability activa típica (caso uso real)    → opt-in básico
//   - Availability retirada (caso uso real)         → soft delete

import { describe, it, expect } from 'vitest'
import { rowToBrandLocationAvailability } from '@/modules/multitenancy/services/brandLocationService'
import type { RowBrandLocationAvailability } from '@/types/multitenancy'

const ACCOUNT_ID = '00000000-0000-0000-0000-000000000001'
const ALCALA_UUID = '770a9c90-2448-4bae-b952-9cb6b35b4f29'
const CARABANCHEL_UUID = 'c0b1936f-f731-46a4-a031-3958918750a7'
const LOBBERS_FAKE_UUID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const BIG_MIKES_FAKE_UUID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

function makeRow(
  overrides: Partial<RowBrandLocationAvailability> = {}
): RowBrandLocationAvailability {
  return {
    id: '44444444-4444-4444-4444-444444444444',
    account_id: ACCOUNT_ID,
    brand_id: LOBBERS_FAKE_UUID,
    location_id: ALCALA_UUID,
    is_active: true,
    active_since: '2024-01-15',
    inactive_since: null,
    notes: null,
    created_at: '2024-01-15T10:00:00Z',
    updated_at: '2024-01-15T10:00:00Z',
    ...overrides,
  } as RowBrandLocationAvailability
}

describe('rowToBrandLocationAvailability', () => {
  it('mapea un row completo de snake_case a camelCase preservando todos los valores', () => {
    const row = makeRow({
      notes: 'Marca destacada en este local',
    })
    const bla = rowToBrandLocationAvailability(row)

    expect(bla).toEqual({
      id: '44444444-4444-4444-4444-444444444444',
      accountId: ACCOUNT_ID,
      brandId: LOBBERS_FAKE_UUID,
      locationId: ALCALA_UUID,
      isActive: true,
      activeSince: '2024-01-15',
      inactiveSince: null,
      notes: 'Marca destacada en este local',
      createdAt: '2024-01-15T10:00:00Z',
      updatedAt: '2024-01-15T10:00:00Z',
    })
  })

  it('preserva nullables a null sin convertirlos a undefined', () => {
    const row = makeRow({
      active_since: null,
      inactive_since: null,
      notes: null,
    })
    const bla = rowToBrandLocationAvailability(row)

    expect(bla.activeSince).toBeNull()
    expect(bla.inactiveSince).toBeNull()
    expect(bla.notes).toBeNull()
  })

  it('caso real: Lobbers operando en Alcalá desde enero 2024', () => {
    const row = makeRow({
      brand_id: LOBBERS_FAKE_UUID,
      location_id: ALCALA_UUID,
      is_active: true,
      active_since: '2024-01-15',
      inactive_since: null,
    })
    const bla = rowToBrandLocationAvailability(row)

    expect(bla.isActive).toBe(true)
    expect(bla.activeSince).toBe('2024-01-15')
    expect(bla.inactiveSince).toBeNull()
  })

  it('caso real: Big Mike\'s retirada de Carabanchel en marzo 2026', () => {
    const row = makeRow({
      brand_id: BIG_MIKES_FAKE_UUID,
      location_id: CARABANCHEL_UUID,
      is_active: false,
      active_since: '2023-06-01',
      inactive_since: '2026-03-15',
      notes: 'Sustituida por nueva marca propia',
    })
    const bla = rowToBrandLocationAvailability(row)

    expect(bla.isActive).toBe(false)
    expect(bla.activeSince).toBe('2023-06-01')
    expect(bla.inactiveSince).toBe('2026-03-15')
    expect(bla.notes).toBe('Sustituida por nueva marca propia')
  })
})
