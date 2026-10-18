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
    // I01b (0180): la liquidación del 303 no pide tipo a la 477 y la 472; la tolerancia, igual.
    expect(ultimaValidar()).toBe('20261122T0180_i01b_asiento_303.sql')
    expect(tolerancia(readFileSync(`${MIG}/${ultimaValidar()}`, 'utf8'))).toBe('greatest(1, floor(l.tax_documents / 2.0)) / 100')
  })
  it('el agente usa exactamente la misma tolerancia que la base', () => {
    const agente = tolerancia(readFileSync('scripts/conta/agente-libro.sql', 'utf8'))
    expect(agente).not.toBeNull()
    expect(agente).toBe(tolerancia(readFileSync(`${MIG}/${ultimaValidar()}`, 'utf8')))
  })
})

describe('la liquidación del 303: la base y el agente «libro», con la misma excepción', () => {
  const base = readFileSync(`${MIG}/20261122T0180_i01b_asiento_303.sql`, 'utf8')
  const agente = readFileSync('scripts/conta/agente-libro.sql', 'utf8')
  it('las dos se libran solo con origen una declaración 303 de la misma empresa (o su contraasiento)', () => {
    for (const sql of [base, agente]) {
      expect(sql).toMatch(/o\.source_type = 'vat_settlement'/)
      expect(sql).toMatch(/\.form_code = '303'/)
      expect(sql).toMatch(/case when (v_e|e)\.source_type = 'reversal' then (v_e|e)\.reverses_entry_id else (v_e|e)\.id end/)
    }
  })
})
