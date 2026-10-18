// tests/unit/modules/conta/s01d/nombreRecibida.test.ts
//
// S01d · El nombre del PDF de una recibida cabe en journal_entry_document.file_name
// (check '^[A-Za-z0-9._-]+\.pdf$' de la 20261021T0100). Antes iba «Proveedor Nº.pdf»,
// con espacios y tildes, y la base lo rechazaba: ninguna recibida llegaba a Diez con
// su PDF (0 en producción el 18/10). Los nombres, de proveedores con tilde, «ñ» y «&».

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { nombreExpedida } from '@/modules/conta/lib/expedidaPdf'

const check = new RegExp(readFileSync('supabase/migrations/20261021T0100_conta_documentos.sql', 'utf8').match(/file_name ~ '([^']+)'/)![1])

describe('S01d · el nombre del PDF de la recibida', () => {
  it('lo que antes rechazaba la base ahora cabe', () => {
    for (const [proveedor, numero] of [['Hermanos Ruiz', 'F-12'], ['Panadería Señor Pérez', 'Nº 2026/0034'], ['Coca & Co, S.L.', 'A 001'], ['Ñoquis', ''], ['', '']]) {
      const n = nombreExpedida(`${proveedor || 'factura'}${numero ? ` ${numero}` : ''}`)
      expect(n, `${proveedor} ${numero}`).toMatch(check)
    }
    expect(nombreExpedida('Hermanos Ruiz F-12')).toBe('Hermanos-Ruiz-F-12.pdf')
  })
})
