// G01 · Tarea 3. Conectar y leer Bitrix24 con respuestas GRABADAS e inventadas
// (grabadas/bitrix.ts): se miden los campos, se propone el mapa, y se leen las
// empresas de 50 en 50 con una espera entre peticiones.
import { describe, expect, it } from 'vitest'
import { fraseDeBitrix, leerFichas, medirCampos, portalDe } from '../../../../../supabase/functions/conta-bitrix-leer/lectura'
import { proponerMapa } from '../../../../../supabase/functions/conta-bitrix-leer/mapa'
import { fetchGrabado, URL_PRUEBA } from './grabadas/bitrix'

const EMISORES = [{ id: 'empresa-a', nombre: 'EMISOR PRUEBA ALFA, S.L.' }, { id: 'empresa-b', nombre: 'GOMEZ, PERSONA PRUEBA' }]

describe('G01 · Bitrix24 con respuestas grabadas', () => {
  it('solo se enseña el nombre del portal, nunca la clave', () => {
    expect(portalDe(URL_PRUEBA)).toBe('portal-de-prueba.bitrix24.es')
    expect(portalDe('http://sin-https.test/rest/1/x/')).toBeNull()
    expect(portalDe('https://portal.test/otra/cosa')).toBeNull()
  })

  it('mide los campos y propone el mapa: qué es cada uno y lo que no se usa', async () => {
    const medidos = await medirCampos(fetchGrabado(), URL_PRUEBA)
    const p = proponerMapa('Gestoría de prueba', medidos, EMISORES)
    const cod = (c: string) => p.queEsCadaUno.find((x) => x.campo === c)?.codigo
    expect([cod('nif'), cod('situacion'), cod('servicios'), cod('forma_pago'), cod('Cuota mensual')]).toEqual(['UF_CRM_100', 'UF_CRM_101', 'UF_CRM_102', 'UF_CRM_103', 'UF_CRM_104'])
    expect(p.sinUsar).toEqual([{ codigo: 'UF_CRM_105', etiqueta: 'COMERCIAL' }])
    expect(p.mapa.formaPagoAEmisor).toEqual({ 'Emisor Prueba Alfa': 'empresa-a', 'Emisor Prueba Alfa Nuevo': 'empresa-a', 'Persona Prueba Gomez': 'empresa-b' })
  })

  it('una dirección que Bitrix24 no acepta, en palabras', async () => {
    await expect(medirCampos(fetchGrabado(), 'https://otro-portal.bitrix24.es/rest/1/mal/')).rejects.toThrow('Bitrix24 no acepta esa dirección')
  })

  it('lee las 60 empresas en dos páginas, con solo los campos del mapa y una espera de 500 ms', async () => {
    const pedidas: { metodo: string; cuerpo: Record<string, unknown> }[] = []
    const esperas: number[] = []
    const medidos = await medirCampos(fetchGrabado(), URL_PRUEBA)
    const { mapa } = proponerMapa('Gestoría de prueba', medidos, EMISORES)
    const r = await leerFichas(fetchGrabado(pedidas), URL_PRUEBA, mapa, async (ms) => { esperas.push(ms) })
    expect(r.fichas).toHaveLength(60)
    expect(r).toMatchObject({ total: 60, peticiones: 2 })
    expect(esperas).toEqual([500])
    expect(pedidas.map((p) => p.cuerpo.start)).toEqual([0, 50])
    expect(pedidas[0].cuerpo.select).not.toContain('UF_CRM_105')
    expect(r.fichas[0]).toMatchObject({ bitrixId: '1', nif: 'B00000001', situacion: 'activo', servicios: ['C', 'L'], emisorSegunBitrix: 'empresa-a', correos: ['cliente1@prueba.test'] })
    expect(r.fichas.find((f) => f.bitrixId === '3')?.emisorSegunBitrix).toBe('empresa-b')
    expect(r.fichas.filter((f) => f.situacion === 'baja')).toHaveLength(6)
  })

  it('la frase de la lectura', () => {
    expect(fraseDeBitrix(60, { nuevos: 60, cambiados: 0, iguales: 0 }, true)).toBe('Conectado Bitrix24: 60 empresas (60 nuevas, 0 cambiadas, 0 iguales).')
  })
})
