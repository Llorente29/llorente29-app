// C06b (Julio, 16/10) · La comprobación de IVA del agente «libro» y la regla 5
// de journal_entry_validar son la MISMA regla. El 16/10 se separaron: la 0100
// del céntimo (#206) cambió la base y el agente siguió con la de antes, y en
// cuanto se validó el asiento de Glovo del 13/10 (1,85 sobre 18,55 al 10 %) el
// agente lo dio en rojo. La regla de la base se lee de la ÚLTIMA migración que
// redefine journal_entry_validar, la que manda en producción. M01 (16/10): o
// conta_motivos_para_validar, que desde la 20261117T0100 es donde vive la regla
// (journal_entry_validar para con su primer motivo).
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const MIG = 'supabase/migrations'
/** La tolerancia de la regla del IVA: lo que va detrás de «(l.debit + l.credit)) >». */
const tolerancia = (sql: string) => {
  const m = sql.match(/abs\(round\(l\.tax_base \* t\.rate \/ 100, 2\) - \(l\.debit \+ l\.credit\)\) > ([^\n]+)\n/)
  return m?.[1].trim() ?? null
}
const ultimaValidar = () => readdirSync(MIG).filter((f) => /^\d{8}T\d{4}_.*\.sql$/.test(f)).sort()
  .filter((f) => /create (or replace )?function public\.(journal_entry_validar|conta_motivos_para_validar)\(/.test(readFileSync(`${MIG}/${f}`, 'utf8'))).at(-1)!

describe('la regla del IVA: la base y el agente «libro», iguales', () => {
  it('la última regla de validar es la de los motivos (con la tolerancia del céntimo), y su tolerancia se lee', () => {
    // S01 (0140): la regla 5 solo pide el local con el eje encendido; la del IVA, igual que en la M01.
    expect(ultimaValidar()).toBe('20261121T0140_s01_regla5_eje_local.sql')
    expect(tolerancia(readFileSync(`${MIG}/${ultimaValidar()}`, 'utf8'))).toBe('greatest(1, floor(l.tax_documents / 2.0)) / 100')
  })
  it('el agente usa exactamente la misma tolerancia que la base', () => {
    const agente = tolerancia(readFileSync('scripts/conta/agente-libro.sql', 'utf8'))
    expect(agente).not.toBeNull()
    expect(agente).toBe(tolerancia(readFileSync(`${MIG}/${ultimaValidar()}`, 'utf8')))
  })
})
