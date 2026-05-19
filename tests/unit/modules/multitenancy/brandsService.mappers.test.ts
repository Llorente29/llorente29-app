// tests/unit/modules/multitenancy/brandsService.mappers.test.ts
//
// Smoke tests del mapper rowToBrand: BBDD snake_case → dominio camelCase.
//
// Casos elegidos con intención:
//   - Row "full" con todos los campos rellenos → mapeo completo
//   - Row con nullables a null            → preserva null sin crashear
//   - Ownership type 'own' / 'cedida'     → cast a BrandOwnershipType
//
// No testeamos brandInsertToRow ni brandUpdateToRow hoy. Esos los cubriremos
// cuando montemos el mock encadenable de Supabase y testeemos createBrand /
// updateBrand de extremo a extremo (Fase 1).

import { describe, it, expect } from 'vitest'
import { rowToBrand } from '@/modules/multitenancy/services/brandsService'
import type { RowBrand } from '@/types/multitenancy'

// Helper: row baseline válido. Cada test sobreescribe lo que necesite.
function makeRow(overrides: Partial<RowBrand> = {}): RowBrand {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    account_id: '00000000-0000-0000-0000-000000000001',
    name: 'Lobbers',
    slug: 'lobbers',
    ownership_type: 'own',
    color: '#FF0000',
    logo_url: 'https://example.com/lobbers.png',
    commission_pct: 12.5,
    notes: 'Marca principal',
    is_active: true,
    archived_at: null,
    created_at: '2026-05-15T10:00:00Z',
    updated_at: '2026-05-15T10:00:00Z',
    created_by: 'admin-uuid',
    created_by_name: 'Julio',
    ...overrides,
  } as RowBrand
}

describe('rowToBrand', () => {
  it('mapea un row completo de snake_case a camelCase preservando todos los valores', () => {
    const row = makeRow()
    const brand = rowToBrand(row)

    expect(brand).toEqual({
      id: '11111111-1111-1111-1111-111111111111',
      accountId: '00000000-0000-0000-0000-000000000001',
      name: 'Lobbers',
      slug: 'lobbers',
      ownershipType: 'own',
      color: '#FF0000',
      logoUrl: 'https://example.com/lobbers.png',
      commissionPct: 12.5,
      notes: 'Marca principal',
      isActive: true,
      archivedAt: null,
      createdAt: '2026-05-15T10:00:00Z',
      updatedAt: '2026-05-15T10:00:00Z',
      createdBy: 'admin-uuid',
      createdByName: 'Julio',
    })
  })

  it('preserva nullables a null sin convertirlos a undefined ni a "null"', () => {
    const row = makeRow({
      color: null,
      logo_url: null,
      commission_pct: null,
      notes: null,
      archived_at: null,
      created_by: null,
      created_by_name: null,
    })
    const brand = rowToBrand(row)

    expect(brand.color).toBeNull()
    expect(brand.logoUrl).toBeNull()
    expect(brand.commissionPct).toBeNull()
    expect(brand.notes).toBeNull()
    expect(brand.archivedAt).toBeNull()
    expect(brand.createdBy).toBeNull()
    expect(brand.createdByName).toBeNull()
  })

  it('cast de ownership_type "cedida" se preserva como BrandOwnershipType', () => {
    const row = makeRow({ ownership_type: 'cedida' })
    const brand = rowToBrand(row)
    expect(brand.ownershipType).toBe('cedida')
  })

  it('row archivado: is_active=false con archived_at no nulo mapea correctamente', () => {
    const row = makeRow({
      is_active: false,
      archived_at: '2026-05-16T09:00:00Z',
    })
    const brand = rowToBrand(row)
    expect(brand.isActive).toBe(false)
    expect(brand.archivedAt).toBe('2026-05-16T09:00:00Z')
  })
})
