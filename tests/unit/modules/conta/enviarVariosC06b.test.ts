// C06b · Respuesta 8, tarea 1b: «Validar y enviar a Diez» con varios a la vez
// (lib/enviarVarios.ts), con dobles del puerto. La forma, la del 15/10 en
// producción: 56 propuestos de ventas por plataforma, todos de octubre. Los
// nombres y los días son inventados.
import { describe, expect, it } from 'vitest'
import { ordenEnvio, textoVarios, validarYEnviarVarios, type AsientoParaEnviar, type PuertoEnviarVarios, type ResultadoEnvioVarios } from '@/modules/conta/lib/enviarVarios'

const asiento = (dia: number, canal: string, estado = 'propuesto'): AsientoParaEnviar =>
  ({ id: `${canal}-${dia}`, concepto: `Ventas ${canal} · Local de Prueba`, fecha: `2026-10-${String(dia).padStart(2, '0')}`, estado })

const EN_DIEZ: ResultadoEnvioVarios = { estado: 'en_diez', pdfPendiente: true, texto: 'En Diez: 1/NNNN. PDF pendiente en Diez.' }
const CERRADO: ResultadoEnvioVarios = { estado: 'no_llega', texto: 'No ha llegado a Diez: Diez real (C0008) está cerrado: no se escribe nada hasta que Julio lo autorice.' }

function puerto(o: { noValida?: Record<string, string>; envio?: Record<string, ResultadoEnvioVarios> } = {}) {
  const log: string[] = []
  const p: PuertoEnviarVarios = {
    validarConDocumento: async (id) => { if (o.noValida?.[id]) { log.push(`no valida ${id}`); throw new Error(o.noValida[id]) } log.push(`valida ${id}`) },
    guardarDocumento: async (id) => { log.push(`pdf ${id}`) },
    enviarADiez: async (id) => { log.push(`envía ${id}`); return o.envio?.[id] ?? EN_DIEZ },
  }
  return { p, log }
}

describe('validar y enviar varios a la vez (respuesta 8, tarea 1b)', () => {
  it('van por fecha (el número sigue el calendario), aunque se marquen en otro orden', async () => {
    const { p, log } = puerto()
    await validarYEnviarVarios([asiento(3, 'Uber'), asiento(1, 'Glovo'), asiento(2, 'Uber'), asiento(1, 'Uber')], 'Julio', p)
    expect(log.filter((l) => l.startsWith('valida'))).toEqual(['valida Glovo-1', 'valida Uber-1', 'valida Uber-2', 'valida Uber-3'])
  })
  it('los 56 de octubre: los 56 validados con su PDF y en Diez, y lo dice', async () => {
    const xs = Array.from({ length: 28 }, (_, i) => [asiento(i + 1, 'Glovo'), asiento(i + 1, 'Uber')]).flat()
    const { p } = puerto()
    const r = await validarYEnviarVarios(xs, 'Julio', p)
    expect(r).toHaveLength(56)
    expect(r.every((x) => x.validado && x.documento && x.enDiez)).toBe(true)
    expect(textoVarios(r)).toBe('56 de 56 en Diez (56 con el PDF pendiente de adjuntar allí).')
  })
  it('si uno se valida y NO llega a Diez, se para ahí: los siguientes ni se validan ni se envían', async () => {
    const xs = [asiento(1, 'Glovo'), asiento(2, 'Glovo'), asiento(3, 'Glovo'), asiento(4, 'Glovo')]
    const { p, log } = puerto({ envio: { 'Glovo-2': CERRADO } })
    const r = await validarYEnviarVarios(xs, 'Julio', p)
    expect(log).toEqual(['valida Glovo-1', 'envía Glovo-1', 'valida Glovo-2', 'envía Glovo-2'])
    expect(r.map((x) => [x.validado, x.enDiez, x.sinTocar === true])).toEqual([[true, true, false], [true, false, false], [false, false, true], [false, false, true]])
    expect(r[1].texto).toBe(CERRADO.texto)
    expect(r[2].texto).toBe('Sin tocar: sigue propuesto.')
    expect(textoVarios(r)).toBe('1 de 4 en Diez (1 con el PDF pendiente de adjuntar allí) · parado en «Ventas Glovo · Local de Prueba», que se ha validado y no ha llegado a Diez · 2 sin tocar: siguen como estaban.')
  })
  it('…y si es el primero, ninguno más se toca (Diez cerrado no deja 56 validados fuera de Diez)', async () => {
    const xs = Array.from({ length: 56 }, (_, i) => asiento((i % 28) + 1, i < 28 ? 'Glovo' : 'Uber'))
    const primero = ordenEnvio(xs)[0].id
    const { p, log } = puerto({ envio: { [primero]: CERRADO } })
    const r = await validarYEnviarVarios(xs, 'Julio', p)
    expect(log).toEqual([`valida ${primero}`, `envía ${primero}`])
    expect(r.filter((x) => x.sinTocar)).toHaveLength(55)
    expect(textoVarios(r)).toMatch(/^ninguno de 56 en Diez · parado en .* · 55 sin tocar: siguen como estaban\.$/)
  })
  it('si uno no se puede validar, se dice por qué y se sigue con los demás: no ha salido nada', async () => {
    const xs = [asiento(1, 'Glovo'), asiento(2, 'Glovo'), asiento(3, 'Glovo')]
    const { p, log } = puerto({ noValida: { 'Glovo-2': 'No cuadra: Debe 10,00 y Haber 9,00.' } })
    const r = await validarYEnviarVarios(xs, 'Julio', p)
    expect(log).toEqual(['valida Glovo-1', 'envía Glovo-1', 'no valida Glovo-2', 'valida Glovo-3', 'envía Glovo-3'])
    expect(r[1]).toMatchObject({ validado: false, enDiez: false })
    expect(r[1].texto).toMatch(/^No se ha validado: No cuadra/)
    expect(textoVarios(r)).toBe('2 de 3 en Diez (2 con el PDF pendiente de adjuntar allí) · 1 sin validar (debajo, por qué).')
  })
  it('lo ya validado que no llegó no se vuelve a validar: se guarda su PDF y se envía', async () => {
    const { p, log } = puerto()
    const r = await validarYEnviarVarios([asiento(1, 'Uber', 'validado')], 'Julio', p)
    expect(log).toEqual(['pdf Uber-1', 'envía Uber-1'])
    expect(r[0]).toMatchObject({ validado: true, documento: true, enDiez: true })
  })
  it('lo validado sin poder guardar su PDF para ahí (no se envía sin documento), y lo validado de lo que queda dice que sigue sin enviar', async () => {
    const xs = [asiento(1, 'Uber', 'validado'), asiento(2, 'Uber', 'validado')]
    const { p, log } = puerto()
    p.guardarDocumento = async (id) => { log.push(`pdf ${id}`); throw new Error('el almacén no contesta') }
    const r = await validarYEnviarVarios(xs, 'Julio', p)
    expect(log).toEqual(['pdf Uber-1'])
    expect(r[0].texto).toBe('Validado, pero no ha llegado a Diez: falta el documento (el almacén no contesta).')
    expect(r[1]).toMatchObject({ sinTocar: true, texto: 'Sin tocar: sigue validado y sin enviar.' })
  })
  it('dice en qué asiento va', async () => {
    const vistos: number[] = []
    const { p } = puerto()
    await validarYEnviarVarios([asiento(1, 'Uber'), asiento(2, 'Uber'), asiento(3, 'Uber')], null, p, (i) => vistos.push(i))
    expect(vistos).toEqual([0, 1, 2])
  })
})
