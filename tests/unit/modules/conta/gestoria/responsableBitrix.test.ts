// tests/unit/modules/conta/gestoria/responsableBitrix.test.ts
//
// GB · nº 24 (el 7 de Code 3) · Quién lleva al cliente: el responsable de la
// ficha de Bitrix24 (ASSIGNED_BY_ID) con su nombre y su correo (user.get), en la
// lectura del CRM. Bitrix24 se simula; datos inventados (T11).
import { describe, expect, it } from 'vitest'
import { conResponsable, datosDeUsuario, ponerResponsables } from '../../../../../supabase/functions/conta-bitrix-leer/lectura'
import type { FichaBitrix } from '../../../../../supabase/functions/conta-bitrix-leer/mapa'

const URL = 'https://portal-de-prueba.bitrix24.es/rest/1/clavedeprueba/'
const ficha = (id: string): FichaBitrix => ({ idExterno: id, nombre: `Empresa ${id}`, nif: null, nifEnCrm: null, calle: null, cp: null, poblacion: null, provincia: null,
  correos: [], telefonos: [], situacion: null, situacionTexto: null, direccionDe: null, otrasDirecciones: [], servicios: [], formaPago: null, emisorSegunCrm: null,
  cuotasReferencia: [], avisos: [] })

function bitrix(usuarios: Record<string, Record<string, unknown>> | 'sin_permiso') {
  const pedidas: { metodo: string; cuerpo: Record<string, unknown> }[] = []
  const pedir = async (url: string, init: { body: string }) => {
    const metodo = url.replace(URL, '').replace(/\.json$/, '')
    const cuerpo = JSON.parse(init.body) as Record<string, unknown>
    pedidas.push({ metodo, cuerpo })
    if (usuarios === 'sin_permiso') return new Response(JSON.stringify({ error: 'insufficient_scope', error_description: 'The request requires higher privileges than provided by the webhook token' }), { status: 401 })
    const id = String((cuerpo.FILTER as { ID: string }).ID)
    return new Response(JSON.stringify({ result: usuarios[id] ? [{ ID: id, ...usuarios[id] }] : [] }), { status: 200 })
  }
  return { pedir, pedidas }
}

describe('GB (nº 24) · quién lleva al cliente en Bitrix24', () => {
  it('pide ASSIGNED_BY_ID si el portal lo tiene, y solo una vez', () => {
    expect(conResponsable(['ID', 'TITLE'], { ASSIGNED_BY_ID: { type: 'user' } as never })).toEqual(['ID', 'TITLE', 'ASSIGNED_BY_ID'])
    expect(conResponsable(['ID', 'ASSIGNED_BY_ID'], { ASSIGNED_BY_ID: { type: 'user' } as never })).toEqual(['ID', 'ASSIGNED_BY_ID'])
    expect(conResponsable(['ID', 'TITLE'], {})).toEqual(['ID', 'TITLE'])
  })

  it('el nombre y el correo de cada responsable, una petición por persona', async () => {
    const { pedir, pedidas } = bitrix({ 7: { NAME: 'Gestora', LAST_NAME: 'Prueba', EMAIL: 'Gestora.Prueba@Ejemplo.invalid' }, 9: { LOGIN: 'comercial.prueba', EMAIL: 'no es un correo' } })
    const fichas = [ficha('1'), ficha('2'), ficha('3'), ficha('4')]
    const esperas: number[] = []
    const n = await ponerResponsables(pedir as never, URL, fichas, [{ ID: '1', ASSIGNED_BY_ID: '7' }, { ID: '2', ASSIGNED_BY_ID: 9 }, { ID: '3', ASSIGNED_BY_ID: '7' }, { ID: '4' }], async (ms) => { esperas.push(ms) })
    expect(n).toBe(2)
    expect(esperas).toEqual([500, 500])
    expect(pedidas.map((p) => [p.metodo, p.cuerpo])).toEqual([['user.get', { FILTER: { ID: '7' } }], ['user.get', { FILTER: { ID: '9' } }]])
    expect(fichas.map((f) => f.responsable)).toEqual([
      { idExterno: '7', nombre: 'Gestora Prueba', correo: 'gestora.prueba@ejemplo.invalid' },
      { idExterno: '9', nombre: null, correo: null },
      { idExterno: '7', nombre: 'Gestora Prueba', correo: 'gestora.prueba@ejemplo.invalid' },
      null,
    ])
    expect(fichas[0].avisos).toEqual([])
  })

  it('sin permiso para leer usuarios: se queda el id y se dice una vez', async () => {
    const { pedir, pedidas } = bitrix('sin_permiso')
    const fichas = [ficha('1'), ficha('2')]
    await ponerResponsables(pedir as never, URL, fichas, [{ ID: '1', ASSIGNED_BY_ID: '7' }, { ID: '2', ASSIGNED_BY_ID: '8' }], async () => {})
    expect(pedidas).toHaveLength(1)
    expect(fichas.map((f) => f.responsable)).toEqual([{ idExterno: '7', nombre: null, correo: null }, { idExterno: '8', nombre: null, correo: null }])
    expect(fichas[0].avisos).toEqual(['No se ha podido leer quién lleva a cada cliente (user.get: The request requires higher privileges than provided by the webhook token). Dale al webhook el permiso «Usuarios».'])
    expect(fichas[1].avisos).toEqual([])
  })

  it('los datos de un usuario', () => {
    expect(datosDeUsuario({ NAME: ' Ana ', LAST_NAME: '', EMAIL: '' })).toEqual({ nombre: 'Ana', correo: null })
    expect(datosDeUsuario({})).toEqual({ nombre: null, correo: null })
  })

  it('sin nombre, null: ni «Sin título» ni el login en su lugar (nº 29)', () => {
    expect(datosDeUsuario({ NAME: 'Sin título', EMAIL: 'sin.titulo@ejemplo.invalid' })).toEqual({ nombre: null, correo: 'sin.titulo@ejemplo.invalid' })
    expect(datosDeUsuario({ NAME: '  SIN TITULO ', LAST_NAME: '' })).toEqual({ nombre: null, correo: null })
    expect(datosDeUsuario({ NAME: 'Untitled' })).toEqual({ nombre: null, correo: null })
    expect(datosDeUsuario({ LOGIN: 'comercial.prueba' })).toEqual({ nombre: null, correo: null })
    expect(datosDeUsuario({ NAME: 'Gestora', LAST_NAME: 'Sin título' })).toEqual({ nombre: 'Gestora', correo: null })
  })
})
