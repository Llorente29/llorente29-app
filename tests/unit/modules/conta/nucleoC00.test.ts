// Núcleo del C00 (§5): reglas puras, con casos REALES donde los hay
// (regla 31): el IVA general 18 → 21 % el 01/09/2012 (Ley 37/1992 art. 90,
// texto descargado del BOE) y las filas del aceite de oliva que tiene hoy
// vat_rate en producción (2 % del 01/10 al 31/12/2024, 4 % desde 2025).
import { describe, expect, it } from 'vitest'
import { vigenteEn, solapes, vigentesEn } from '@/modules/conta/lib/vigencia'
import { proponerAlta, UMBRAL_IVA_MENSUAL, type EntradaAlta } from '@/modules/conta/lib/propuestaAlta'
import { modelosQuePresenta } from '@/modules/conta/lib/modelos'
import { problemasDeEjercicios, mesesDe, mesCerrado, sePuedeApuntar, siguienteMesACerrar, mesQueSePuedeReabrir } from '@/modules/conta/lib/ejercicios'
import { problemasDeSerie, siguienteNumero, numeroConSerie } from '@/modules/conta/lib/numeracion'
import { revisarActividades, revisarIbanBanco, revisarNifEmpresa, revisarSocios } from '@/modules/conta/lib/validacionesEmpresa'
import { NORMAS } from '@/modules/conta/lib/normas'

describe('1 · impuesto vigente en una fecha', () => {
  const general = [
    { code: 'iva_general', rate: 18, validFrom: '2010-07-01', validTo: '2012-08-31' },
    { code: 'iva_general', rate: 21, validFrom: '2012-09-01', validTo: null },
  ]
  it('cambio a mitad de año: el 31/08/2012 al 18 %, el 01/09/2012 al 21 %', () => {
    expect(vigenteEn(general, 'iva_general', '2012-08-31')?.rate).toBe(18)
    expect(vigenteEn(general, 'iva_general', '2012-09-01')?.rate).toBe(21)
    expect(vigenteEn(general, 'iva_general', '2026-10-03')?.rate).toBe(21)
  })
  const aceite = [
    { code: 'aceite_oliva', rate: 2, surcharge: 0.26, validFrom: '2024-10-01', validTo: '2024-12-31' },
    { code: 'aceite_oliva', rate: 4, surcharge: 0.5, validFrom: '2025-01-01', validTo: null },
  ]
  it('el aceite de oliva de producción: 2 % el 31/12/2024, 4 % el 01/01/2025, nada antes', () => {
    expect(vigenteEn(aceite, 'aceite_oliva', '2024-12-31')?.rate).toBe(2)
    expect(vigenteEn(aceite, 'aceite_oliva', '2025-01-01')?.rate).toBe(4)
    expect(vigenteEn(aceite, 'aceite_oliva', '2024-09-30')).toBeNull()
  })
  it('si dos se pisan, no elige: lo dice', () => {
    const mal = [...general, { code: 'iva_general', rate: 20, validFrom: '2026-01-01', validTo: null }]
    expect(() => vigenteEn(mal, 'iva_general', '2026-05-01')).toThrow(/vigentes/)
    expect(solapes(mal)).toHaveLength(1)
    expect(solapes(general)).toHaveLength(0)
  })
  it('vigentes hoy: una por concepto', () => {
    expect(vigentesEn([...general, ...aceite], '2026-10-03').map((f) => f.rate).sort()).toEqual([21, 4])
  })
})

const base: EntradaAlta = {
  tipo: 'company', territorio: 'peninsula_baleares', actividades: ['business'],
  retiene: true, alquilaConRetencion: true, volumenAnoAnterior: 900000, inicioActividad: '2022-03-01', hoy: '2026-10-03',
}

describe('2 · propuesta por defecto del alta, cada una con su porqué', () => {
  it('sociedad de restauración en Madrid (la maqueta)', () => {
    const p = proponerAlta(base)
    expect(p.regimenIva.valor).toBe('general')
    expect(p.regimenIva.duda).toBeNull()
    expect(p.periodoIva.valor).toBe('quarterly')
    expect(p.plan.valor).toBe('pymes')
    expect(p.digitos.valor).toBe(8)
    expect(p.ejercicio.valor).toEqual({ code: '2026', startsOn: '2026-01-01', endsOn: '2026-12-31' })
    expect(p.modelos.valor.map((m) => m.codigo)).toEqual(['303', '390', '111', '115', '202'])
  })
  it('cada propuesta dice por qué, en una frase', () => {
    const p = proponerAlta(base)
    for (const prop of [p.regimenIva, p.periodoIva, p.modelos, p.plan, p.digitos, p.ejercicio]) {
      expect(prop.porque.length).toBeGreaterThan(10)
      expect(prop.porque.trim().split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚ¿])/).length).toBe(1)
    }
  })
  it('toda norma citada existe en el fichero de normas (y allí se comprueba contra el BOE)', () => {
    const p = proponerAlta(base)
    const citadas = [p.regimenIva, p.periodoIva, p.plan, p.digitos, p.ejercicio].map((x) => x.norma).filter((n) => n !== null)
    for (const n of [...citadas, ...p.modelos.valor.map((m) => m.norma)]) expect(Object.keys(NORMAS)).toContain(n)
  })
  it('por encima de 6.010.121,04 € el IVA es mensual; justo en el umbral, trimestral', () => {
    expect(proponerAlta({ ...base, volumenAnoAnterior: UMBRAL_IVA_MENSUAL + 0.01 }).periodoIva.valor).toBe('monthly')
    expect(proponerAlta({ ...base, volumenAnoAnterior: UMBRAL_IVA_MENSUAL }).periodoIva.valor).toBe('quarterly')
  })
  it('autónomo: régimen general, pero con duda (módulos) para el asesor', () => {
    const p = proponerAlta({ ...base, tipo: 'self_employed' })
    expect(p.regimenIva.valor).toBe('general')
    expect(p.regimenIva.duda).toMatch(/módulos/)
    expect(p.ejercicio.norma).toBe('irpfAnoNatural')
    expect(p.plan.duda).not.toBeNull()
  })
  it('Canarias: fuera del IVA, con su artículo; sin 303', () => {
    const p = proponerAlta({ ...base, territorio: 'canarias' })
    expect(p.regimenIva).toMatchObject({ valor: 'fuera_iva', norma: 'ivaFueraCanarias' })
    expect(p.modelos.valor.map((m) => m.codigo)).not.toContain('303')
  })
  it('empezó este año: el primer ejercicio va desde que empezó', () => {
    const p = proponerAlta({ ...base, inicioActividad: '2026-03-15' })
    expect(p.ejercicio.valor.startsOn).toBe('2026-03-15')
    expect(p.plan.norma).toBe('pgcPymesConstitucion')
  })
})

describe('3 · ejercicios y meses cerrados', () => {
  const e26 = { code: '2026', startsOn: '2026-01-01', endsOn: '2026-12-31' }
  it('sin solapes, sin huecos, doce meses como mucho', () => {
    expect(problemasDeEjercicios([e26, { code: '2027', startsOn: '2027-01-01', endsOn: '2027-12-31' }])).toEqual([])
    expect(problemasDeEjercicios([e26, { code: '2027', startsOn: '2027-01-02', endsOn: '2027-12-31' }])[0]).toMatch(/hueco/)
    expect(problemasDeEjercicios([e26, { code: '2026b', startsOn: '2026-06-01', endsOn: '2027-05-31' }])[0]).toMatch(/pisan/)
    expect(problemasDeEjercicios([{ code: 'x', startsOn: '2026-01-01', endsOn: '2027-01-01' }])[0]).toMatch(/doce meses/)
  })
  it('un mes cerrado no admite apuntes con fecha dentro', () => {
    expect(mesCerrado(['2026-01-01'], '2026-01-31')).toBe(true)
    expect(sePuedeApuntar(['2026-01-01'], '2026-01-15').ok).toBe(false)
    expect(sePuedeApuntar(['2026-01-01'], '2026-02-01').ok).toBe(true)
  })
  it('se cierra en orden y se reabre el último', () => {
    expect(mesesDe(e26)).toHaveLength(12)
    expect(siguienteMesACerrar(e26, ['2026-01-01', '2026-02-01'])).toBe('2026-03-01')
    expect(siguienteMesACerrar(e26, mesesDe(e26))).toBeNull()
    expect(mesQueSePuedeReabrir(['2026-02-01', '2026-01-01'])).toBe('2026-02-01')
    expect(mesQueSePuedeReabrir([])).toBeNull()
  })
  it('ejercicio que empieza a mitad de mes: su primer mes cuenta', () => {
    expect(mesesDe({ code: '2026', startsOn: '2026-03-15', endsOn: '2026-12-31' })[0]).toBe('2026-03-01')
  })
})

describe('4 · modelos que presenta', () => {
  it('lo que no se sabe se pregunta, no se adivina', () => {
    const r = modelosQuePresenta({ ...base, retiene: null, alquilaConRetencion: null })
    expect(r.modelos.map((m) => m.codigo)).toEqual(['303', '390', '202'])
    expect(r.preguntas.map((q) => q.clave)).toEqual(['retiene', 'alquiler'])
  })
  it('autónomo profesional con 70 % retenido no adelanta IRPF; con 60 %, sí (130)', () => {
    const prof = { ...base, tipo: 'self_employed' as const, actividades: ['professional' as const], retiene: false, alquilaConRetencion: false }
    expect(modelosQuePresenta({ ...prof, porcentajeIngresosRetenidos: 70 }).modelos.map((m) => m.codigo)).not.toContain('130')
    expect(modelosQuePresenta({ ...prof, porcentajeIngresosRetenidos: 60 }).modelos.map((m) => m.codigo)).toContain('130')
    expect(modelosQuePresenta({ ...prof, porcentajeIngresosRetenidos: null }).preguntas.map((q) => q.clave)).toContain('retenido_70')
  })
  it('solo operaciones exentas: sin 303', () => {
    expect(modelosQuePresenta({ ...base, soloExentas: true }).modelos.map((m) => m.codigo)).not.toContain('303')
  })
})

describe('5 · numeración sin saltos ni repeticiones', () => {
  it('una serie correcta no tiene problemas', () => {
    expect(problemasDeSerie([1, 2, 3, 4])).toEqual([])
  })
  it('caza el repetido y el salto', () => {
    const p = problemasDeSerie([1, 2, 2, 5])
    expect(p.map((x) => x.tipo).sort()).toEqual(['repetido', 'salto'])
    expect(p.find((x) => x.tipo === 'salto')?.texto).toBe('Faltan del 3 al 4.')
  })
  it('una serie que empieza en 100', () => {
    expect(problemasDeSerie([100, 101], 100)).toEqual([])
    expect(problemasDeSerie([99], 100)[0].tipo).toBe('antes_de_empezar')
    expect(siguienteNumero([], 100)).toBe(100)
    expect(siguienteNumero([100, 101], 100)).toBe(102)
    expect(numeroConSerie('F', 123, 6)).toBe('F-000123')
  })
})

describe('6 · validaciones de la empresa', () => {
  it('NIF único por cuenta (compara normalizado) y válido', () => {
    const otras = [{ id: 'x', nif: 'b-91000018', nombre: 'Taberna' }]
    expect(revisarNifEmpresa('B91000018', otras, null)[0].texto).toMatch(/Taberna/)
    expect(revisarNifEmpresa('B91000018', otras, 'x')).toEqual([])
    expect(revisarNifEmpresa('B91000019', [], null)).toHaveLength(1)
  })
  it('una y solo una actividad principal entre las vigentes', () => {
    expect(revisarActividades([{ esPrincipal: true, vigente: true }, { esPrincipal: false, vigente: true }])).toEqual([])
    expect(revisarActividades([{ esPrincipal: false, vigente: true }])).toHaveLength(1)
    expect(revisarActividades([{ esPrincipal: true, vigente: true }, { esPrincipal: true, vigente: true }])).toHaveLength(1)
    expect(revisarActividades([{ esPrincipal: true, vigente: false }, { esPrincipal: true, vigente: true }])).toEqual([])
  })
  it('IBAN válido (el del C01)', () => {
    expect(revisarIbanBanco('ES91 2100 0418 4502 0005 1332')).toEqual([])
    expect(revisarIbanBanco('ES91 2100 0418 4502 0005 1333')).toHaveLength(1)
  })
  it('socios hasta 100 %, sin contar los que ya no están', () => {
    expect(revisarSocios([{ pct: 60, vigente: true }, { pct: 40, vigente: true }])).toEqual([])
    expect(revisarSocios([{ pct: 60, vigente: true }, { pct: 50, vigente: true }])[0].texto).toMatch(/110/)
    expect(revisarSocios([{ pct: 60, vigente: true }, { pct: 50, vigente: false }])).toEqual([])
    expect(revisarSocios([{ pct: 33.33, vigente: true }, { pct: 33.33, vigente: true }, { pct: 33.34, vigente: true }])).toEqual([])
  })
})
