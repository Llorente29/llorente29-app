// tests/unit/modules/conta/v03/cuadre.test.ts
//
// V03 · E3 · El bucle de «Comprobar con Hacienda» (cuadre.ts): pide página a
// página con la clave de la anterior, la última va con «final», y cualquier
// fallo deja el cuadre en «fallo» con un motivo que se puede leer.

import { describe, expect, it } from 'vitest'
import { type CuadreTomado, motivoDeFallo, type PiezasCuadre, vueltaDeCuadres } from '../../../../../supabase/functions/_shared/verifactu/cuadre'
import { ConsultaRechazada } from '../../../../../supabase/functions/_shared/verifactu/consulta'

const cuadre = (id: string): CuadreTomado => ({ cuadre_id: id, entorno: 'pruebas', company_id: 'e', nif_emisor: 'B28000016', nombre_emisor: 'Prueba', ejercicio: 2026, periodo: '10' })

const reg = (num: string) => `<r:RegistroRespuestaConsultaFactuSistemaFacturacion><r:IDFactura><sf:IDEmisorFactura>B28000016</sf:IDEmisorFactura><sf:NumSerieFactura>${num}</sf:NumSerieFactura><sf:FechaExpedicionFactura>05-10-2026</sf:FechaExpedicionFactura></r:IDFactura><r:DatosRegistroFacturacion><r:Huella>H${num}</r:Huella></r:DatosRegistroFacturacion><r:EstadoRegistro><r:TimestampUltimaModificacion>2026-10-05T10:01:00+02:00</r:TimestampUltimaModificacion><r:EstadoRegistro>Correcto</r:EstadoRegistro></r:EstadoRegistro></r:RegistroRespuestaConsultaFactuSistemaFacturacion>`
const resp = (nums: string[], mas: boolean, clave?: string) => `<env:Envelope><env:Body><r:RespuestaConsultaFactuSistemaFacturacion xmlns:r="x" xmlns:sf="y"><r:IndicadorPaginacion>${mas ? 'S' : 'N'}</r:IndicadorPaginacion><r:ResultadoConsulta>${nums.length ? 'ConDatos' : 'SinDatos'}</r:ResultadoConsulta>${nums.map(reg).join('')}${clave ? `<r:ClavePaginacion><sf:IDEmisorFactura>B28000016</sf:IDEmisorFactura><sf:NumSerieFactura>${clave}</sf:NumSerieFactura><sf:FechaExpedicionFactura>05-10-2026</sf:FechaExpedicionFactura></r:ClavePaginacion>` : ''}</r:RespuestaConsultaFactuSistemaFacturacion></env:Body></env:Envelope>`

function piezas(cola: CuadreTomado[], respuestas: (string | Error)[], extra: Partial<PiezasCuadre<string>> = {}) {
  const hecho = { paginas: [] as { id: string; nums: string[]; final: boolean }[], fallos: [] as { id: string; error: string }[], xml: [] as string[] }
  const p: PiezasCuadre<string> = {
    tomar: async () => cola.shift() ?? null,
    pagina: async (id, f, final) => { hecho.paginas.push({ id, nums: f.map((x) => x.num_serie), final }) },
    fallar: async (id, error) => { hecho.fallos.push({ id, error }) },
    material: async () => 'cert',
    llamar: async (_u, xml) => {
      hecho.xml.push(xml)
      const r = respuestas.shift()
      if (r === undefined) throw new Error('sin más respuestas')
      if (r instanceof Error) throw r
      return { status: 200, cuerpo: r }
    },
    url: 'https://aeat',
    ...extra,
  }
  return { p, hecho }
}

describe('V03 · E3 · el bucle del cuadre', () => {
  it('pide la página siguiente con la clave de la anterior y solo la última va con «final»', async () => {
    const { p, hecho } = piezas([cuadre('c1')], [resp(['A-1', 'A-2'], true, 'A-2'), resp(['A-3'], false)])
    const r = await vueltaDeCuadres(p, 'pruebas')
    expect(r).toEqual({ cuadres: 1, hechos: 1, fallos: [], paginas: 2, facturas: 3 })
    expect(hecho.paginas).toEqual([{ id: 'c1', nums: ['A-1', 'A-2'], final: false }, { id: 'c1', nums: ['A-3'], final: true }])
    expect(hecho.xml[0]).not.toContain('ClavePaginacion')
    expect(hecho.xml[1]).toContain('<sf:NumSerieFactura>A-2</sf:NumSerieFactura><sf:FechaExpedicionFactura>05-10-2026</sf:FechaExpedicionFactura></con:ClavePaginacion>')
  })

  it('un mes vacío también se cuadra (una página final sin facturas)', async () => {
    const { p, hecho } = piezas([cuadre('c1')], [resp([], false)])
    expect((await vueltaDeCuadres(p, 'pruebas')).hechos).toBe(1)
    expect(hecho.paginas).toEqual([{ id: 'c1', nums: [], final: true }])
  })

  it('un rechazo de Hacienda falla ESE cuadre con su código y sigue con el siguiente', async () => {
    const fault = '<env:Envelope><env:Body><env:Fault><faultcode>env:Client</faultcode><faultstring>Codigo[4112].El titular del certificado debe ser Obligado Emision</faultstring></env:Fault></env:Body></env:Envelope>'
    const { p, hecho } = piezas([cuadre('c1'), cuadre('c2')], [fault, resp(['A-1'], false)])
    const r = await vueltaDeCuadres(p, 'pruebas')
    expect(r.cuadres).toBe(2)
    expect(r.hechos).toBe(1)
    expect(hecho.fallos).toEqual([{ id: 'c1', error: 'Hacienda ha rechazado la consulta (código 4112): El titular del certificado debe ser Obligado Emision' }])
    expect(hecho.paginas).toEqual([{ id: 'c2', nums: ['A-1'], final: true }])
  })

  it('no se queda dando vueltas: sin clave, la misma clave o demasiadas páginas, falla diciéndolo', async () => {
    let x = piezas([cuadre('c1')], [resp(['A-1'], true)])
    await vueltaDeCuadres(x.p, 'pruebas')
    expect(x.hecho.fallos[0].error).toMatch(/no da por dónde seguir/)
    x = piezas([cuadre('c1')], [resp(['A-1'], true, 'A-1'), resp(['A-1'], true, 'A-1')])
    await vueltaDeCuadres(x.p, 'pruebas')
    expect(x.hecho.fallos[0].error).toMatch(/misma página dos veces/)
    x = piezas([cuadre('c1')], [resp(['A-1'], true, 'A-1'), resp(['A-2'], true, 'A-2'), resp(['A-3'], true, 'A-3')], { maxPaginas: 2 })
    await vueltaDeCuadres(x.p, 'pruebas')
    expect(x.hecho.fallos[0].error).toMatch(/más de 2 páginas/)
    expect(x.hecho.paginas.every((g) => !g.final)).toBe(true)
  })

  it('sin certificado o sin red, el motivo se entiende y no lleva nada de dentro', async () => {
    const sin = Object.assign(new Error('La empresa no ha autorizado usar su certificado para Verifactu (o lo ha retirado).'), { name: 'SinCertificado' })
    const x = piezas([cuadre('c1')], [], { material: async () => { throw sin } })
    await vueltaDeCuadres(x.p, 'pruebas')
    expect(x.hecho.fallos[0].error).toBe(sin.message)
    expect(motivoDeFallo(Object.assign(new Error('ECONNRESET 10.0.0.1'), { name: 'LlamadaFallida' }))).not.toMatch(/ECONN|10\.0/)
    expect(motivoDeFallo(new ConsultaRechazada(null, 'algo'))).toBe('Hacienda ha rechazado la consulta: algo')
  })

  it('sin nada pedido no llama a Hacienda', async () => {
    const { p, hecho } = piezas([], [])
    expect(await vueltaDeCuadres(p, 'pruebas')).toEqual({ cuadres: 0, hechos: 0, fallos: [], paginas: 0, facturas: 0 })
    expect(hecho.xml).toEqual([])
  })
})
