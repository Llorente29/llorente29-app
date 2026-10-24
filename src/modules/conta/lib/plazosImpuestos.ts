// src/modules/conta/lib/plazosImpuestos.ts
//
// S01 (paso 4) · Los avisos de impuestos del Inicio, con sus DOS plazos (Julio,
// encargo del S01): domiciliando el pago, hasta el 15; si no, hasta el 20. En
// enero cambia: lo que se presenta hasta el 30 (el 303 y el 130 del cuarto
// trimestre, el 390) se domicilia hasta el 25.
//
// Sale de los modelos que presenta la empresa (company_tax_profile.tax_forms,
// los del alta) y de cómo declara el IVA (vat_period, sii). Es el calendario
// general de la AEAT para el ejercicio natural:
//   · trimestrales (303, 111, 115, 130): del 1 al 20 de abril, julio y octubre,
//     y en enero el cuarto (303 y 130 hasta el 30; 111 y 115 hasta el 20);
//   · 303 mensual: del 1 al 20 del mes siguiente (en el SII, hasta el 30);
//   · 202: del 1 al 20 de abril, octubre y diciembre;
//   · 200: del 1 al 25 de julio (domiciliado, hasta el 20);
//   · informativos, sin pago: 390 (hasta el 30 de enero), 190 y 180 (hasta el
//     31 de enero) y 347 (todo febrero).
// Si el último día cae en sábado o domingo, pasa al lunes. LOS FESTIVOS NO SE
// CUENTAN (aún no hay calendario de festivos nacionales en la base): lo dice el
// aviso. Un ejercicio que no acaba el 31/12 cambia el 200 y el 202: tampoco se
// cuenta aquí.

export interface AvisoImpuesto {
  modelo: string
  /** «IVA del 3.er trimestre de 2026». */
  que: string
  /** Primer día para presentar (YYYY-MM-DD). */
  desde: string
  /** Último día para presentar y pagar sin domiciliar. */
  hasta: string
  /** Último día para presentarlo domiciliando el pago; null = no se paga (informativo). */
  domiciliado: string | null
}

export interface PerfilFiscal { modelos: readonly string[]; periodoIva: 'quarterly' | 'monthly' | null; sii: boolean }

const d = (y: number, m: number, dia: number): string => `${y}-${String(m).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
const ultimoDia = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate()

/** Sábado o domingo → el lunes siguiente. */
export function sinFinDeSemana(fecha: string): string {
  const f = new Date(`${fecha}T12:00:00Z`)
  const dia = f.getUTCDay()
  if (dia === 6) f.setUTCDate(f.getUTCDate() + 2)
  else if (dia === 0) f.setUTCDate(f.getUTCDate() + 1)
  return f.toISOString().slice(0, 10)
}

const TRIMESTRE = ['1.er', '2.º', '3.er', '4.º'] as const
const MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'] as const
const NOMBRE: Record<string, string> = { '303': 'IVA', '111': 'Retenciones', '115': 'Retenciones del alquiler', '130': 'Pago fraccionado del IRPF', '202': 'Pago fraccionado del Impuesto sobre Sociedades' }

function plazo(modelo: string, que: string, y: number, m: number, ultimo: number, domiciliado: number | null): AvisoImpuesto {
  return { modelo, que, desde: d(y, m, 1), hasta: sinFinDeSemana(d(y, m, ultimo)), domiciliado: domiciliado === null ? null : d(y, m, domiciliado) }
}

/** Todos los plazos de un año natural de presentación (los que caen en `y`). */
export function plazosDelAnio(p: PerfilFiscal, y: number): AvisoImpuesto[] {
  const tiene = new Set(p.modelos)
  const fuera: AvisoImpuesto[] = []
  for (const mod of ['303', '111', '115', '130']) {
    if (!tiene.has(mod)) continue
    if (mod === '303' && p.periodoIva === 'monthly') {
      for (let m = 1; m <= 12; m++) {
        const mesDe = m === 1 ? 12 : m - 1, anioDe = m === 1 ? y - 1 : y
        const ult = m === 1 || p.sii ? 30 : 20
        fuera.push(plazo(mod, `${NOMBRE[mod]} de ${MES[mesDe - 1]} de ${anioDe}`, y, m, ult, ult === 30 ? 25 : 15))
      }
      continue
    }
    const enero = mod === '303' || mod === '130' ? 30 : 20
    fuera.push(plazo(mod, `${NOMBRE[mod]} del ${TRIMESTRE[3]} trimestre de ${y - 1}`, y, 1, enero, enero === 30 ? 25 : 15))
    for (const [m, t] of [[4, 0], [7, 1], [10, 2]] as const) fuera.push(plazo(mod, `${NOMBRE[mod]} del ${TRIMESTRE[t]} trimestre de ${y}`, y, m, 20, 15))
  }
  if (tiene.has('202')) for (const [m, n] of [[4, '1.er'], [10, '2.º'], [12, '3.er']] as const) fuera.push(plazo('202', `${NOMBRE['202']}, ${n} pago de ${y}`, y, m, 20, 15))
  if (tiene.has('200')) fuera.push(plazo('200', `Impuesto sobre Sociedades de ${y - 1}`, y, 7, 25, 20))
  if (tiene.has('390')) fuera.push(plazo('390', `Resumen anual del IVA de ${y - 1}`, y, 1, 30, null))
  if (tiene.has('190')) fuera.push(plazo('190', `Resumen anual de retenciones de ${y - 1}`, y, 1, 31, null))
  if (tiene.has('180')) fuera.push(plazo('180', `Resumen anual de retenciones del alquiler de ${y - 1}`, y, 1, 31, null))
  if (tiene.has('347')) fuera.push(plazo('347', `Operaciones con terceros de ${y - 1}`, y, 2, ultimoDia(y, 2), null))
  return fuera
}

/**
 * Lo que toca presentar: lo que tiene la ventana abierta hoy y lo que se abre
 * en los próximos `antes` días. Por el último día, y a igualdad, por modelo.
 * Lo vencido no sale (ya no se puede hacer a tiempo; eso es otro aviso).
 */
export function avisosDeImpuestos(p: PerfilFiscal, hoy: string, antes = 15): AvisoImpuesto[] {
  const y = Number(hoy.slice(0, 4))
  const limite = new Date(`${hoy}T12:00:00Z`); limite.setUTCDate(limite.getUTCDate() + antes)
  const hasta = limite.toISOString().slice(0, 10)
  return [...plazosDelAnio(p, y), ...plazosDelAnio(p, y + 1)]
    .filter((a) => a.hasta >= hoy && a.desde <= hasta)
    .sort((a, b) => a.hasta.localeCompare(b.hasta) || a.modelo.localeCompare(b.modelo))
}

const fecha = (f: string): string => `${f.slice(8, 10)}/${f.slice(5, 7)}`

/** La frase de los dos plazos, según el día de hoy. */
export function frasePlazo(a: AvisoImpuesto, hoy: string): string {
  if (hoy < a.desde) {
    return a.domiciliado
      ? `Del ${fecha(a.desde)} al ${fecha(a.hasta)}; domiciliando el pago, hasta el ${fecha(a.domiciliado)}.`
      : `Del ${fecha(a.desde)} al ${fecha(a.hasta)}. No se paga: es informativo.`
  }
  if (!a.domiciliado) return `Hasta el ${fecha(a.hasta)}. No se paga: es informativo.`
  if (hoy <= a.domiciliado) return `Si lo domicilias, hasta el ${fecha(a.domiciliado)}; si no, hasta el ${fecha(a.hasta)}.`
  return `Domiciliar ya no se puede (era hasta el ${fecha(a.domiciliado)}); presentarlo y pagarlo, hasta el ${fecha(a.hasta)}.`
}
