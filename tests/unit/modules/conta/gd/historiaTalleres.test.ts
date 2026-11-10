// GD · nº101 · La historia de Talleres Ruiz en «Volver a empezar»: los cuatro meses antes del cobro en curso, cada uno
// con la cadena entera (recibo, factura, cobro, liquidación, ingreso casado y validado). Los importes, los del recibo real
// de la demo: 225,00 € = 185,95 € de base + 39,05 € de IVA (gestión laboral de 3 trabajadores y gestoría mensual Premium).
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { HISTORIA, PASOS, historiaDeTalleres } from '../../../../../supabase/functions/conta-gd-volver-a-empezar/pasos'

const TRES = ['ADRIAN MOLINA CASTRO', 'RAUL IBARRA SOTO', 'SERGIO VELA RAMOS']

describe('GD · nº101 · la historia de Talleres Ruiz', () => {
  it('de julio a octubre si se cobra noviembre; con el cambio de año, también', () => {
    expect(historiaDeTalleres('2026-11-10', TRES).map((h) => h.mes)).toEqual(['2026-07', '2026-08', '2026-09', '2026-10'])
    expect(historiaDeTalleres('2027-02-01', TRES).map((h) => h.mes)).toEqual(['2026-10', '2026-11', '2026-12', '2027-01'])
  })

  it('cada recibo, como el real: 225,00 € = 185,95 + 39,05; comisión 2,50 €; neto 222,50 €', () => {
    for (const h of historiaDeTalleres('2026-11-10', TRES)) {
      expect([h.totalCent, h.factura.baseCent, h.factura.ivaCent, h.comisionCent, h.netoCent]).toEqual([22500, 18595, 3905, 250, 22250])
      expect(h.factura.lineas).toHaveLength(2)
      expect(h.cargoEl).toBe(`${h.mes}-05`)
      expect(h.llegada).toBe(`${h.mes}-07`)
      expect(h.cobroGc).toMatch(/^PM00GDHIST\d{6}$/)
    }
    expect(HISTORIA.cliente).toBe('Talleres Ruiz, S.L.')
  })

  it('va antes de los cambios (el alta del mes en curso no entra en la historia) y por los caminos de un cobro de verdad', () => {
    const ids = PASOS.map((p) => p.id)
    expect(ids.indexOf('historia')).toBe(ids.indexOf('cambios') - 1)
    const f = readFileSync('supabase/functions/conta-gd-volver-a-empezar/index.ts', 'utf8')
    const caso = f.slice(f.indexOf("case 'historia'"), f.indexOf("case 'cambios'"))
    expect(caso).toContain("admin.rpc('_conta_cobro_facturar'")
    expect(caso).toContain("admin.rpc('demo_gestoria_ingresos_gocardless'")
    expect(caso).toContain("persona.rpc('conta_abono_gocardless_casar'")
    expect(caso).toContain("p_por: 'folvy'")
    expect(caso).toContain("persona.rpc('journal_entry_validar'")
    expect(caso).toContain('.filter((n) => n !== CAMBIOS_DEL_MES.alta.trabajador)')
  })
})

describe('GD · nº102 · la anual, desde el último junio', () => {
  it('este año si ya pasó junio; si no, el del año pasado', async () => {
    const { inicioDeLaAnual } = await import('../../../../../supabase/functions/conta-gd-volver-a-empezar/pasos')
    expect(inicioDeLaAnual('2026-11-10')).toBe('2026-06-01')
    expect(inicioDeLaAnual('2026-06-01')).toBe('2026-06-01')
    expect(inicioDeLaAnual('2027-03-15')).toBe('2026-06-01')
  })
  it('«tarifa» la mueve, solo las anuales de GoCardless de la cuenta demo', () => {
    const f = readFileSync('supabase/functions/conta-gd-volver-a-empezar/index.ts', 'utf8')
    expect(f).toContain(".eq('account_id', cuenta).eq('origen', 'gocardless').eq('periodo', 'anio').gt('desde', desdeAnual)")
  })
})
