// C06b · Respuesta 8, pregunta 1: validar y guardar el PDF van juntos.
// El orden y los frenos de lib/validarConPdf.ts, con dobles del puerto. La
// transacción misma (que la base no valide sin el PDF) la prueba la de
// staging: supabase/staging/sql/20261111_c06b_validar_con_pdf_prueba.sql.
// Números y nombres INVENTADOS; la forma, la de conta_resumen_ventas.
import { describe, expect, it } from 'vitest'
import { jsPDF } from 'jspdf'
import { esNumeroCambiado, noSeValida, validarConPdf, type PuertoValidarConPdf } from '@/modules/conta/lib/validarConPdf'
import { resumenDeAsiento, type ResumenBD } from '../../../../supabase/functions/_shared/resumenDeAsiento'
import { resumenVentasPdf } from '../../../../supabase/functions/_shared/resumenVentasPdf'

const resumen = (o: Partial<ResumenBD> = {}): ResumenBD => ({
  id: 'e1', account_id: 'acc', company_id: 'emp', estado: 'propuesto', serie: 1, numero: null, fecha: '2026-10-01',
  empresa: { nombre: 'Empresa de Prueba SL', nif: 'B00000000' }, local: { id: 'l1', nombre: 'Local de Prueba' }, canal: { id: 'c1', slug: 'glovo', nombre: 'Glovo' },
  pedidos: [{ hora: '13:05', codigo: 'A1', marca: 'Marca de Prueba', total: 22, base: 20, cuota: 2 }],
  lineas: [{ cuenta: '43000001', debe: 22, haber: 0, marca: null, tipoIva: null, documento: null }, { cuenta: '70000001', debe: 0, haber: 20, marca: 'Marca de Prueba', tipoIva: null, documento: null },
    { cuenta: '47700010', debe: 0, haber: 2, marca: null, tipoIva: 10, documento: null }],
  documento: null,
  ...o,
})

/** La base, de mentira: el número previsto es el siguiente; validar comprueba que el PDF lleva ESE número. */
function base(o: { r?: ResumenBD; otrosValidanAntes?: number; pdfFalla?: string; guardarFalla?: string } = {}) {
  let siguiente = 1288
  let colarse = o.otrosValidanAntes ?? 0
  const log: string[] = []
  const p: PuertoValidarConPdf = {
    resumen: async () => o.r ?? resumen(),
    numeroPrevisto: async () => { log.push(`previsto ${siguiente}`); return siguiente },
    hacerPdf: async (r) => {
      if (o.pdfFalla) throw new Error(o.pdfFalla)
      log.push(`pdf nº ${r.numero} (${r.estado})`)
      const listo = resumenDeAsiento(r, { correspondencia: null, generado: new Date('2026-10-14T10:00:00Z'), hoy: '2026-10-14' })
      return { bytes: resumenVentasPdf(jsPDF, listo.datos), nombre: listo.nombreFichero }
    },
    subir: async () => { log.push('sube'); return { ruta: 'acc/e1/0123456789abcdef.pdf', sha256: 'ab'.repeat(32) } },
    validarConDocumento: async (a) => {
      // Otro asiento de la serie se valida justo antes: el número cambia.
      if (colarse > 0) { colarse--; siguiente++ }
      if (a.numero !== siguiente) { log.push(`no valida (${a.numero} ≠ ${siguiente})`); throw new Error(`El PDF se hizo con el nº ${a.numero} y al validar le toca el nº ${siguiente} (se ha validado otro asiento de la serie a la vez): no se valida. Vuelve a pulsar.`) }
      if (o.guardarFalla) { log.push('no valida (pdf)'); throw new Error(o.guardarFalla) }
      log.push(`valida nº ${a.numero} con su PDF`); return { serie: 1, numero: siguiente++ }
    },
    guardarDocumento: async () => { log.push('guarda el PDF de lo ya validado'); return null },
  }
  return { p, log }
}

describe('validar y guardar el PDF van juntos (respuesta 8)', () => {
  it('el PDF se hace con el número que le toca, validado, y se valida con él en una sola llamada', async () => {
    const { p, log } = base()
    expect(await validarConPdf('e1', 'Julio', p)).toEqual({ serie: 1, numero: 1288, yaEstaba: false })
    expect(log).toEqual(['previsto 1288', 'pdf nº 1288 (validado)', 'sube', 'valida nº 1288 con su PDF'])
  })
  it('si el PDF no se puede hacer, no se valida: ni se sube ni se llama a validar', async () => {
    const { p, log } = base({ pdfFalla: 'La empresa no tiene nombre o NIF: el resumen los lleva en la cabecera.' })
    await expect(validarConPdf('e1', 'Julio', p)).rejects.toThrow(/no tiene nombre o NIF/)
    expect(log).toEqual(['previsto 1288'])
  })
  it('…y con el resumen real: sin NIF de la empresa, no hay PDF y no se valida', async () => {
    const { p, log } = base({ r: resumen({ empresa: { nombre: 'Empresa de Prueba SL', nif: '' } }) })
    await expect(validarConPdf('e1', 'Julio', p)).rejects.toThrow(/NIF/)
    expect(log.some((l) => l.startsWith('valida'))).toBe(false)
  })
  it('si la base no puede guardar el PDF, no valida y se dice por qué', async () => {
    const { p, log } = base({ guardarFalla: 'El documento no está subido (acc/e1/x.pdf): no se enlaza nada.' })
    await expect(validarConPdf('e1', 'Julio', p)).rejects.toThrow(/no está subido/)
    expect(log.at(-1)).toBe('no valida (pdf)')
  })
  it('si otro asiento de la serie se valida entre medias, vuelve a empezar UNA vez con el número nuevo', async () => {
    const { p, log } = base({ otrosValidanAntes: 1 })
    expect(await validarConPdf('e1', 'Julio', p)).toEqual({ serie: 1, numero: 1289, yaEstaba: false })
    expect(log).toEqual(['previsto 1288', 'pdf nº 1288 (validado)', 'sube', 'no valida (1288 ≠ 1289)', 'previsto 1289', 'pdf nº 1289 (validado)', 'sube', 'valida nº 1289 con su PDF'])
  })
  it('…y si vuelve a pasar, para y lo dice (no se queda dando vueltas)', async () => {
    const { p, log } = base({ otrosValidanAntes: 2 })
    await expect(validarConPdf('e1', 'Julio', p)).rejects.toThrow(/otro asiento de la serie a la vez/)
    expect(log.filter((l) => l.startsWith('previsto'))).toHaveLength(2)
    expect(log.some((l) => l.startsWith('valida'))).toBe(false)
  })
  it('lo ya validado con su PDF no se toca; lo validado antes de esto sin PDF, solo guarda el PDF', async () => {
    const con = base({ r: resumen({ estado: 'validado', numero: 1200, documento: { id: 'd', ruta: 'r', nombre: 'n', sha256: 's', bytes: 1, creado_en: '', creado_por: null } }) })
    expect(await validarConPdf('e1', 'Julio', con.p)).toEqual({ serie: 1, numero: 1200, yaEstaba: true })
    expect(con.log).toEqual([])
    const sin = base({ r: resumen({ estado: 'validado', numero: 1200 }) })
    expect(await validarConPdf('e1', 'Julio', sin.p)).toEqual({ serie: 1, numero: 1200, yaEstaba: true })
    expect(sin.log).toEqual(['guarda el PDF de lo ya validado'])
  })
  it('lo que dice la pantalla: no se ha validado, por qué, y que van juntos', () => {
    expect(noSeValida('su PDF no se puede hacer (la empresa no tiene NIF).'))
      .toBe('No se ha validado: su PDF no se puede hacer (la empresa no tiene NIF). Validar y guardar su PDF van juntos: sin su PDF, el asiento sigue sin validar.')
    expect(esNumeroCambiado('El PDF se hizo con el nº 1 y al validar le toca el nº 2 (se ha validado otro asiento de la serie a la vez): no se valida.')).toBe(true)
    expect(esNumeroCambiado('No cuadra: Debe 1 y Haber 2.')).toBe(false)
  })
})
