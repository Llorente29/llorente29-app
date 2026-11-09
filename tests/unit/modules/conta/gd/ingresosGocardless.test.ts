// GD · nº 47 · El ingreso que siembra la 1707 en el banco de la demo lo casa
// solo el motor de Bancos (abonoDeGocardless, la T4 de Code 1). Se lee el
// concepto de la propia migración, para que si uno cambia, la prueba lo diga.
// Datos inventados (T11).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { abonoDeGocardless, type AbonoGocardless, type Movimiento } from '@/modules/conta/lib/conciliacion'

const sql = readFileSync('supabase/migrations/20261109T1707_gd_ingresos_gocardless.sql', 'utf8')
const concepto = /'concepto_banco', '([^']+)'/.exec(sql)?.[1] ?? ''

const pago: AbonoGocardless = { id: 'PO-PRUEBA-1', llegada: '2026-11-07', netoCent: 12345, referencia: 'PRUEBA-GD-1', cuenta: '57200002', cobros: 3 }
const mov = (p: Partial<Movimiento> = {}): Movimiento =>
  ({ id: 'm1', cuentaId: 'cta-banco', fecha: '2026-11-07', importeCent: 12345, concepto, conceptoComun: null, referencias: [], antesDelCorte: false, ...p })

describe('GD · nº 47 · el ingreso de la liquidación en el banco de la demo', () => {
  it('lleva el concepto de QBO', () => {
    expect(concepto).toBe('TRANSFER INMEDIATA GOCARDLESS SAS')
  })

  it('el día de llegada y el neto exacto: el motor la casa sola', () => {
    expect(abonoDeGocardless(mov(), [pago])).toMatchObject({ abono: { id: 'PO-PRUEBA-1' }, confianza: 'seguro' })
  })

  it('solo entran las pagadas, en euros, con neto positivo y ya llegadas', () => {
    expect(sql).toMatch(/p\.estado = 'paid' and p\.moneda = 'EUR'\s+and p\.importe > 0 and p\.llegada is not null and p\.llegada <= v_hoy/)
  })
})
