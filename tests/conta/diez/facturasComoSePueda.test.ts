// B01r26 (14/11) · «Ya lo he importado» en la C0009: «GET /api/facturas → 500».
// Las facturas del mes como se pueda: el mes, en páginas de 25 y, si no, día a día,
// diciendo los días que Diez no deja leer (no se dan por vacíos). Datos inventados.

import { describe, expect, it } from 'vitest'
import { ClienteDiez, ErrorDiez, type AlmacenToken } from '../../../supabase/functions/_shared/diezCliente'

const almacen: AlmacenToken = { leer: async () => null, guardar: async () => {}, caida: async () => {} }
const quinientos = () => new ErrorDiez('GET /api/facturas → 500', 500, null)

class Probado extends ClienteDiez {
  rutas: string[] = []
  constructor(private contesta: (ruta: string, tam: number) => unknown[]) {
    super({ base: 'https://diez.invalid', nombreBd: 'C0009', credenciales: { grant_type: 'password', client_id: 'x', client_secret: 'x', username: 'x', password: 'x' }, almacen, escribir: false })
  }
  override async todas<T>(ruta: string, tam = 200): Promise<T[]> { this.rutas.push(`${tam} ${decodeURIComponent(ruta)}`); return this.contesta(ruta, tam) as T[] }
}

describe('facturasDelMesComoSePueda', () => {
  it('el mes entero, si Diez lo deja', async () => {
    const c = new Probado(() => [{ Id: 1 }, { Id: 2 }])
    expect(await c.facturasDelMesComoSePueda('202610')).toMatchObject({ como: 'mes', diasSinLeer: [], facturas: [{ Id: 1 }, { Id: 2 }] })
  })
  it('en páginas de 25 si las de 200 dan 500', async () => {
    const c = new Probado((_r, tam) => { if (tam === 200) throw quinientos(); return [{ Id: 1 }] })
    expect((await c.facturasDelMesComoSePueda('202610')).como).toBe('mes_25')
  })
  it('día a día, y dice los días que Diez no deja leer', async () => {
    const c = new Probado((r, tam) => {
      if (tam !== 10) throw quinientos()
      if (decodeURIComponent(r).includes('Fecha ge 20261015 ')) throw quinientos()
      return decodeURIComponent(r).includes('Fecha ge 20261001 ') ? [{ Id: 9 }] : []
    })
    const r = await c.facturasDelMesComoSePueda('202610')
    expect(r.como).toBe('dia')
    expect(r.diasSinLeer).toEqual(['20261015'])
    expect(r.facturas).toEqual([{ Id: 9 }])
    expect(c.rutas.filter((x) => x.startsWith('10 ')).length).toBe(31)
  })
  it('lo que no es un 500 no se tapa', async () => {
    const c = new Probado(() => { throw new ErrorDiez('GET /api/facturas → 401', 401, null) })
    await expect(c.facturasDelMesComoSePueda('202610')).rejects.toThrow(/401/)
  })
})
