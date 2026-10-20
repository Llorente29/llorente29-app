// I01b · Libros de IVA de Diez → libro de IVA de Sumied: el mapeo y la lectura sin repetir ni saltar.
import { describe, expect, it } from 'vitest'
import { enCorto, filasDeFactura, leerFacturas, paisDe, PAGINA } from '../../../scripts/conta/diez/libros-iva-mapeo'

const base = { Ejercicio: '2026', Documento: 7, Fecha: 20260320, FechaFactura: 20260318, FechaIntroduccionFactura: 20260405, NumeroFactura: ' A-1 ', CifCliente: 'B00000000', NombreCliente: 'PROVEEDOR DE PRUEBA', TipoFactura: 1 }

describe('filasDeFactura', () => {
  it('una expedida: libro de expedidas, F1, sin fecha de recibida, céntimos', () => {
    const [f] = filasDeFactura({ ...base, Serie: '1', BaseImponible1: 100, PorcentajeIVA1: 10, CuotaIVA1: 10 }, 'asiento')
    expect(f).toMatchObject({ e: '2026', s: '1', n: 7, libro: 'issued', tipo_factura: 'F1', numero: 'A-1', fecha_factura: '2026-03-18', fecha_recibida: null, base: 10000, tipo: 10, cuota: 1000, tramo: 1, pais: null })
  })
  it('una recibida con dos tipos: una fila por tramo; la retención, solo en la primera', () => {
    const fs = filasDeFactura({ ...base, Serie: '2', BaseImponible1: 100, PorcentajeIVA1: 21, CuotaIVA1: 21, BaseImponible2: 50, PorcentajeIVA2: 10, CuotaIVA2: 5, PorcentajeRetencion: 15, CuotaRetencion: 15 }, 'asiento')
    expect(fs.map((x) => [x.libro, x.tipo, x.cuota, x.tramo, x.retencion])).toEqual([['received', 21, 2100, 1, 1500], ['received', 10, 500, 2, null]])
  })
  it('la fecha de la recibida: la del asiento o la de introducción, según se lance', () => {
    const fac = { ...base, Serie: '2', BaseImponible1: 100, PorcentajeIVA1: 21, CuotaIVA1: 21 }
    expect(filasDeFactura(fac, 'asiento')[0].fecha_recibida).toBe('2026-03-20')
    expect(filasDeFactura(fac, 'introduccion')[0].fecha_recibida).toBe('2026-04-05')
  })
  it('un tramo al 0 % sin cuota de una recibida va a no sujetas (su base no infla la [28])', () => {
    const fs = filasDeFactura({ ...base, Serie: '2', BaseImponible1: 30, PorcentajeIVA1: 0, CuotaIVA1: 0, BaseImponible2: 100, PorcentajeIVA2: 21, CuotaIVA2: 21 }, 'asiento')
    expect(fs.map((x) => x.libro)).toEqual(['not_subject', 'received'])
  })
  it('un abono: recibida, F1 con su signo (como lo declaró Diez); expedida, R1', () => {
    expect(filasDeFactura({ ...base, Serie: '2', TipoFactura: 7, BaseImponible1: -10, PorcentajeIVA1: 21, CuotaIVA1: -2.1 }, 'asiento')[0]).toMatchObject({ tipo_factura: 'F1', cuota: -210 })
    expect(filasDeFactura({ ...base, Serie: '1', TipoFactura: 6, BaseImponible1: -10, PorcentajeIVA1: 10, CuotaIVA1: -1 }, 'asiento')[0].tipo_factura).toBe('R1')
  })
  it('una simplificada es F2', () => {
    expect(filasDeFactura({ ...base, Serie: '1', EsFacturaSimplificada: true, BaseImponible1: 10, PorcentajeIVA1: 10, CuotaIVA1: 1 }, 'asiento')[0].tipo_factura).toBe('F2')
  })
  it('otra serie, o sin tramos, no se convierte: lanza', () => {
    expect(() => filasDeFactura({ ...base, Serie: '4', BaseImponible1: 1, CuotaIVA1: 0.1 }, 'asiento')).toThrow()
    expect(() => filasDeFactura({ ...base, Serie: '1' }, 'asiento')).toThrow()
  })
})

describe('paisDe', () => {
  it('solo con dos letras de otro país delante', () => {
    expect(paisDe('DE123456789')).toBe('DE')
    expect(paisDe('IE1234567X')).toBe('IE')
    expect(paisDe('ESB00000000')).toBeNull()
    expect(paisDe('B00000000')).toBeNull()
    expect(paisDe('X1234567L')).toBeNull()
    expect(paisDe('12345678Z')).toBeNull()
    expect(paisDe(null)).toBeNull()
  })
})

describe('leerFacturas', () => {
  // Un Diez de mentira que pagina como el de verdad: un listado que pasa de una
  // página repite unas y se salta otras. Un día con 250: la primera lectura
  // llena la página; por tramos de documento, cada tramo cabe.
  const dia = (d: number, n: number, desde = 1) => Array.from({ length: n }, (_, i) => ({ Ejercicio: '2026', Serie: '2', Documento: desde + i, Fecha: d }))
  const datos = [...dia(20260102, 3), ...dia(20260103, 250, 100)]
  const c = {
    todas: async <T,>(ruta: string): Promise<T[]> => {
      const f = decodeURIComponent(ruta.split('$filter=')[1])
      const d = Number(/Fecha ge (\d+)/.exec(f)![1])
      const docs = /Documento ge (\d+) and Documento le (\d+)/.exec(f)
      let r = datos.filter((x) => x.Fecha === d && (!docs || (x.Documento >= Number(docs[1]) && x.Documento <= Number(docs[2]))))
      if (r.length > PAGINA) r = [...r.slice(0, PAGINA), ...r.slice(0, 10)] // repite 10 y se salta las demás
      return r as T[]
    },
  }
  it('trae todas, una vez cada una: el día lleno, en tramos de documento', async () => {
    const l = await leerFacturas(c, '202601', '202601')
    expect(l.dias).toBe(31)
    expect(l.diasLlenos).toBe(1)
    expect(l.tramosLlenos).toBe(0)
    expect(l.facturas.length).toBe(253)
    expect(new Set(l.facturas.map((f) => f.Documento)).size).toBe(253)
    expect(l.repetidas).toBe(0)
  })
  const sinEsperar = () => { const pausas: number[] = []; return { pausas, espera: async (ms: number) => { pausas.push(ms) } } }
  it('un día que no contesta nunca se reintenta al final, con pausa, y se dice', async () => {
    const roto = { todas: async <T,>(ruta: string): Promise<T[]> => (ruta.includes('20260105') ? Promise.reject(new Error('500')) : c.todas<T>(ruta)) }
    const e = sinEsperar()
    const l = await leerFacturas(roto, '202601', '202601', { espera: e.espera })
    expect(l.sinContestar).toEqual([20260105])
    expect(l.recuperados).toBe(0)
    expect(e.pausas).toEqual([30_000, 60_000, 90_000])
    expect(l.dias).toBe(30)
  })
  it('el ensayo #5 (20/10): los días que no contestan a la primera se recuperan al final, solo ellos', async () => {
    // El 3 (el día lleno) y el 2 fallan dos veces; los demás contestan siempre.
    const fallos = new Map([[20260102, 2], [20260103, 2]])
    const pedidas: number[] = []
    const lento = {
      todas: async <T,>(ruta: string): Promise<T[]> => {
        const d = Number(/Fecha ge (\d+)/.exec(decodeURIComponent(ruta))![1])
        pedidas.push(d)
        const n = fallos.get(d) ?? 0
        if (n > 0) { fallos.set(d, n - 1); throw new Error('The operation was aborted due to timeout') }
        return c.todas<T>(ruta)
      },
    }
    const e = sinEsperar()
    const l = await leerFacturas(lento, '202601', '202601', { espera: e.espera })
    expect(l.sinContestar).toEqual([])
    expect(l.recuperados).toBe(2)
    expect(e.pausas).toEqual([30_000, 60_000]) // a la segunda vuelta ya están todos: no hay tercera
    expect(l.dias).toBe(31)
    expect(l.facturas.length).toBe(253)
    expect(new Set(l.facturas.map((f) => f.Documento)).size).toBe(253)
    expect(l.diasLlenos).toBe(1)
    // En las vueltas solo se piden los que fallaron.
    expect(new Set(pedidas.slice(31))).toEqual(new Set([20260102, 20260103]))
  })
  it('sin días por reintentar no hay pausa', async () => {
    const e = sinEsperar()
    const l = await leerFacturas(c, '202601', '202601', { espera: e.espera })
    expect([l.recuperados, e.pausas]).toEqual([0, []])
  })
  it('un tramo de documento que también llena la página se parte y se pide cada mitad', async () => {
    // La serie 1 y la 2 con los mismos números el mismo día: 300 en el tramo 1–150.
    const dos = [...dia(20260107, 150, 1), ...dia(20260107, 150, 1).map((f) => ({ ...f, Serie: '1' }))]
    const cc = {
      todas: async <T,>(ruta: string): Promise<T[]> => {
        const f = decodeURIComponent(ruta.split('$filter=')[1])
        const d = Number(/Fecha ge (\d+)/.exec(f)![1])
        const docs = /Documento ge (\d+) and Documento le (\d+)/.exec(f)
        const r = dos.filter((x) => x.Fecha === d && (!docs || (x.Documento >= Number(docs[1]) && x.Documento <= Number(docs[2]))))
        return (r.length > PAGINA ? r.slice(0, PAGINA) : r) as T[]
      },
    }
    const l = await leerFacturas(cc, '202601', '202601', { espera: async () => {} })
    expect(l.tramosLlenos).toBe(0)
    expect(l.facturas.length).toBe(300)
    expect(l.repetidas).toBe(0)
  })
})

describe('enCorto: Pais y TipoOperacion de Diez, para medirlos como clave (18/10)', () => {
  it('minúsculas, sin tildes, [a-z0-9_] y 12 como mucho; vacío no va', () => {
    expect([enCorto('Irlanda'), enCorto('ESTADOS UNIDOS'), enCorto('Alemaña del Sur y más'), enCorto(3), enCorto(0), enCorto(''), enCorto(null), enCorto('  ')])
      .toEqual(['irlanda', 'estados_unid', 'alemana_del_', '3', '0', undefined, undefined, undefined])
  })
  it('en la fila del libro solo si Diez lo trae', () => {
    const base = { Ejercicio: 2026, Serie: '2', Documento: 7, Fecha: 20260115, BaseImponible1: 100, PorcentajeIVA1: 21, CuotaIVA1: 21 }
    const [sin] = filasDeFactura(base, 'asiento')
    expect('pais_diez' in sin || 'tipo_operacion' in sin).toBe(false)
    const [con] = filasDeFactura({ ...base, Pais: 'Irlanda', TipoOperacion: 2 }, 'asiento')
    expect([con.pais_diez, con.tipo_operacion]).toEqual(['irlanda', '2'])
  })
})
