// src/modules/conta/lib/plazoPlataforma.ts
//
// PC01 · Entrega 1 · Cuándo paga una plataforma (Julio, 25/10). El dato vive en
// su ficha de Contactos (party_role: settlement_every, payout_days_after y
// payout_margin_days) y no en el código. Esto es la misma cuenta que hace la
// base (conta_vence_por_plataforma), para que la ficha enseñe un ejemplo con
// fechas de verdad antes de guardar. Las dos las prueban los mismos casos
// (tests/unit/modules/conta/pc01/plazoPlataforma.test.ts y la prueba de staging).
//
//   · el periodo: semana de lunes a domingo, quincena (del 1 al 15 y del 16 a fin
//     de mes) o mes;
//   · el día de pago: el fin del periodo más los días que tarda;
//   · el vencimiento de su factura: el día de pago más el margen (5 si no se dice).
//     Hasta entonces sale «Esperando liquidación»; pasado sin cobrar, «Vencida».

export type Periodo = 'weekly' | 'fortnightly' | 'monthly'
export const MARGEN_POR_DEFECTO = 5

const dia = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`)
const iso = (d: Date) => d.toISOString().slice(0, 10)
const mas = (d: Date, n: number) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x }

/** El periodo que contiene `fecha`: su primer y su último día. */
export function periodoDe(cada: Periodo, fecha: string): { desde: string; hasta: string } {
  const d = dia(fecha)
  if (cada === 'weekly') {
    const lunes = mas(d, -((d.getUTCDay() + 6) % 7))
    return { desde: iso(lunes), hasta: iso(mas(lunes, 6)) }
  }
  const y = d.getUTCFullYear(); const m = d.getUTCMonth()
  const ultimo = new Date(Date.UTC(y, m + 1, 0, 12))
  if (cada === 'fortnightly') {
    return d.getUTCDate() <= 15
      ? { desde: iso(new Date(Date.UTC(y, m, 1, 12))), hasta: iso(new Date(Date.UTC(y, m, 15, 12))) }
      : { desde: iso(new Date(Date.UTC(y, m, 16, 12))), hasta: iso(ultimo) }
  }
  return { desde: iso(new Date(Date.UTC(y, m, 1, 12))), hasta: iso(ultimo) }
}

/** El día de pago (fin del periodo + días) y el vencimiento (+ margen) de lo vendido el día `fecha`. */
export function pagoYVencimiento(cada: Periodo, dias: number, margen: number | null, fecha: string): { pago: string; vence: string } {
  const fin = dia(periodoDe(cada, fecha).hasta)
  const pago = mas(fin, dias)
  return { pago: iso(pago), vence: iso(mas(pago, margen ?? MARGEN_POR_DEFECTO)) }
}

const DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const ddmm = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}`

/** Lo que dice la ficha, con fechas: «La semana del 12 al 18/10 la paga hacia el lunes 19/10; …». */
export function ejemploDePlazo(cada: Periodo, dias: number, margen: number | null, hoy: string): string {
  const m = margen ?? MARGEN_POR_DEFECTO
  const unPeriodo = (fecha: string) => {
    const p = periodoDe(cada, fecha)
    const { pago, vence } = pagoYVencimiento(cada, dias, margen, fecha)
    const que = cada === 'weekly' ? `La semana del ${ddmm(p.desde)} al ${ddmm(p.hasta)}` : cada === 'fortnightly' ? `La quincena del ${ddmm(p.desde)} al ${ddmm(p.hasta)}` : `El mes del ${ddmm(p.desde)} al ${ddmm(p.hasta)}`
    return `${que} la paga hacia el ${DIAS_SEMANA[dia(pago).getUTCDay()]} ${ddmm(pago)}; si el ${ddmm(vence)} no ha llegado, sus facturas salen «Vencida»`
  }
  const partes = [unPeriodo(hoy)]
  if (cada === 'fortnightly') {
    const d = dia(hoy)
    const otra = d.getUTCDate() <= 15 ? iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 20, 12))) : iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 5, 12)))
    partes.push(unPeriodo(otra))
  }
  return `${partes.join('. ')}. Margen: ${m} ${m === 1 ? 'día' : 'días'}.`
}

/** Lo que dice al guardar (regla 8): qué se guardó y cuántas facturas cambian de vencimiento. */
export function textoGuardado(nombre: string, cada: Periodo | null, dias: number | null, margen: number | null, facturas: number): string {
  const que = cada === 'weekly' ? 'cada semana' : cada === 'fortnightly' ? 'cada quincena' : cada === 'monthly' ? 'cada mes' : 'sin periodo'
  const cuando = dias == null ? 'sin día de pago (sus facturas vencen el día que se emiten)' : `hacia ${dias} ${dias === 1 ? 'día' : 'días'} después de cerrarlo, con ${margen ?? MARGEN_POR_DEFECTO} de margen`
  const mueve = facturas === 0 ? 'Ninguna factura por cobrar cambia de vencimiento.' : `${facturas} ${facturas === 1 ? 'factura por cobrar cambia' : 'facturas por cobrar cambian'} de vencimiento.`
  return `Guardado: ${nombre} paga ${que}, ${cuando}. ${mueve}`
}
