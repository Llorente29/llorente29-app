// C05 · respuesta 3. Una cuenta correctora va en la MISMA línea que la cuenta
// que corrige (la 2935 corrige la 2405: va a «V. Inversiones financieras a
// largo plazo», no a «grupo y asociadas» con el resto de la 293).
//
// La tabla correctora → corregida sale de las definiciones del cuadro del PGC
// (quinta parte del RD 1514/2007 y del RD 1515/2007), no del generador: si el
// generador coloca mal una correctora, esta prueba falla. Se mira en los tres
// modelos, con las cuentas que existen en el cuadro de cada plan.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { colocar, type FilaMapeo } from '@/modules/conta/lib/cuentasAnuales'

const serie = JSON.parse(readFileSync('supabase/conta/pgc/cuentas-anuales.json', 'utf8')) as { mapeo: Record<string, unknown>[]; lineas: { model: string; statement: string; code: string; text: string }[] }
const cuadro = JSON.parse(readFileSync('supabase/conta/pgc/serie.json', 'utf8')) as { cuentas?: { code: string; plan: string }[] } | { code: string; plan: string }[]
const cuentas = (Array.isArray(cuadro) ? cuadro : cuadro.cuentas ?? []) as { code: string; plan: string }[]

/** correctora → la cuenta que corrige (definiciones del cuadro de cuentas). */
const CORRECTORAS: [string, string][] = [
  // Amortización acumulada y deterioro del inmovilizado, cuenta a cuenta (el
  // modelo normal reparte el inmovilizado por cuentas de tres cifras).
  ['2800', '200'], ['2801', '201'], ['2802', '202'], ['2803', '203'], ['2805', '205'], ['2806', '206'],
  ['2811', '211'], ['2812', '212'], ['2813', '213'], ['2815', '215'], ['2819', '219'], ['282', '221'],
  ['2900', '200'], ['2901', '201'], ['2903', '203'], ['2905', '205'], ['2906', '206'],
  ['2910', '210'], ['2911', '211'], ['2915', '215'], ['2919', '219'], ['2920', '220'], ['2921', '221'],
  // Desembolsos pendientes sobre participaciones a largo plazo (249x → 240x).
  ['2493', '2403'], ['2494', '2404'], ['2495', '2405'],
  // Deterioro de participaciones a largo plazo en partes vinculadas (293x → 240x).
  ['2933', '2403'], ['2934', '2404'], ['2935', '2405'],
  // Deterioro de valores representativos de deuda a largo plazo de partes vinculadas (294x → 241x).
  ['2943', '2413'], ['2944', '2414'], ['2945', '2415'],
  // Deterioro de créditos a largo plazo a partes vinculadas (295x → 242x).
  ['2953', '2423'], ['2954', '2424'], ['2955', '2425'],
  // Deterioro de valores representativos de deuda y de créditos a largo plazo (297 → 251, 298 → 252).
  ['297', '251'], ['298', '252'],
  // Deterioro de existencias (39x → 3x0).
  ['390', '300'], ['391', '310'], ['392', '320'], ['393', '330'], ['394', '340'], ['395', '350'],
  // Deterioro de créditos por operaciones comerciales (490 → 430).
  ['490', '430'],
  // Desembolsos pendientes sobre participaciones a corto plazo (539x → 530x).
  ['5393', '5303'], ['5394', '5304'], ['5395', '5305'],
  // Deterioro de participaciones, valores y créditos a corto plazo en partes vinculadas (593x/594x/595x → 530x/531x/532x).
  ['5933', '5303'], ['5934', '5304'], ['5935', '5305'],
  ['5943', '5313'], ['5944', '5314'], ['5945', '5315'],
  ['5953', '5323'], ['5954', '5324'], ['5955', '5325'],
  // Deterioro de valores representativos de deuda y de créditos a corto plazo (597 → 541, 598 → 542).
  ['597', '541'], ['598', '542'],
  // Deterioro de activos no corrientes mantenidos para la venta (599 → 580).
  ['599', '580'],
]

const PLAN = { normal: 'general', abreviado: 'general', pymes: 'pymes' } as const
const mapeoDe = (modelo: string): FilaMapeo[] => serie.mapeo
  .filter((m) => m.model === modelo && m.statement === 'balance')
  .map((m) => ({ lineCode: String(m.line_code), prefix: String(m.account_prefix), sign: m.sign as FilaMapeo['sign'], byBalance: (m.by_balance ?? null) as FilaMapeo['byBalance'], origin: m.origin as FilaMapeo['origin'] }))
const existe = (code: string, plan: string) => cuentas.some((c) => c.plan === plan && (c.code === code || c.code.startsWith(code)))

describe('una correctora va en la línea de la cuenta que corrige', () => {
  for (const modelo of ['normal', 'abreviado', 'pymes'] as const) {
    it(`modelo ${modelo}`, () => {
      const mapeo = mapeoDe(modelo)
      const mal: string[] = []
      let miradas = 0
      // Todas las parejas, estén o no en el cuadro vigente de su plan: una
      // empresa traída de Diez puede tener la 2935, que el plan general quitó
      // en 2021. Solo se salta la pareja cuya cuenta corregida no tiene línea.
      for (const [correctora, corregida] of CORRECTORAS) {
        const b = colocar(corregida, 1, mapeo)?.lineCode
        if (!b) continue
        if (existe(corregida, PLAN[modelo])) miradas++
        const a = colocar(correctora, -1, mapeo)?.lineCode ?? 'sin sitio'
        if (a !== b) mal.push(`${correctora} en ${a}, pero ${corregida} en ${b}`)
      }
      expect(miradas, 'la tabla tiene que tocar cuentas del cuadro').toBeGreaterThan(20)
      expect(mal).toEqual([])
    })
  }
})

// Respuesta 3 · la 510 de 3 cifras va a «Otras deudas a corto plazo», colocada
// por defecto y con «Completar»; al completarla, 5103/5104 van a grupo y
// asociadas y 5105 a entidades de crédito.
describe('la 510 va a la línea «otras» de su grupo', () => {
  const OTRAS = { normal: 'PNP.C.III.5', abreviado: 'PNP.C.III.3', pymes: 'PNP.C.II.3' } as const
  const CREDITO = { normal: 'PNP.C.III.2', abreviado: 'PNP.C.III.1', pymes: 'PNP.C.II.1' } as const
  const GRUPO = { normal: 'PNP.C.IV', abreviado: 'PNP.C.IV', pymes: 'PNP.C.III' } as const
  for (const modelo of ['normal', 'abreviado', 'pymes'] as const) {
    it(`modelo ${modelo}`, () => {
      const mapeo = mapeoDe(modelo)
      const texto = (c: string) => serie.lineas.find((l) => l.model === modelo && l.statement === 'balance' && l.code === c)?.text ?? ''
      const m510 = colocar('510', -1, mapeo)
      expect(m510?.lineCode).toBe(OTRAS[modelo])
      expect(texto(OTRAS[modelo])).toMatch(/^\d+\. Otr[ao]s (deudas|pasivos)/)
      expect(m510?.origin).toBe('defecto')
      expect(colocar('5105', -1, mapeo)?.lineCode).toBe(CREDITO[modelo])
      expect(colocar('5103', -1, mapeo)?.lineCode).toBe(GRUPO[modelo])
      expect(colocar('5104', -1, mapeo)?.lineCode).toBe(GRUPO[modelo])
    })
  }
})
