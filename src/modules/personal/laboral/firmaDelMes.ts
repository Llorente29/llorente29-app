// src/modules/personal/laboral/firmaDelMes.ts
//
// L1a-H (29/10/2026). La firma del registro del mes, solo cuando la empresa la
// encienda: las frases del interruptor de Registro de jornada (regla 8: al
// cambiarlo, la pantalla dice qué ha hecho) y el mes que se pide firmar.

/** El título del interruptor, en Laboral › Registro de jornada. */
export const TITULO_INTERRUPTOR = 'Pedir a cada persona que firme su registro del mes'

/** La frase de debajo. */
export const APOYO_INTERRUPTOR = 'Cada mes, cada persona revisa y firma sus horas en su portal. Enciéndelo cuando las horas estén al día.'

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** El mes anterior al de hoy (AAAA-MM-DD, en Madrid): AAAA-MM. Es el que se pide firmar. */
export function mesAnterior(hoy: string): string {
  const [y, m] = hoy.split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

/** El nombre del mes de un AAAA-MM: «septiembre». */
export const nombreDelMes = (mes: string) => MESES[Number(mes.slice(5, 7)) - 1] ?? mes

/** Lo que ha hecho el interruptor, con contenido: a quién afecta y qué pasa con lo firmado. */
export function fraseDelCambio(pedir: boolean, personas: number, hoy: string): string {
  if (!pedir) {
    return 'Apagado: nadie ve ya en su portal la firma del registro. Las firmas que ya se hicieron se conservan.'
  }
  if (personas <= 0) {
    return `Encendido, pero no hay ninguna persona activa en la plantilla: cuando la haya, verá en su portal «Firma tu registro de ${nombreDelMes(mesAnterior(hoy))}».`
  }
  const quien = personas === 1 ? 'la persona activa de la plantilla ve' : `las ${personas} personas activas de la plantilla ven`
  return `Encendido: desde ahora, ${quien} en su portal «Firma tu registro de ${nombreDelMes(mesAnterior(hoy))}».`
}
