// B01 Revolut · PR 1 · Lo que no es pantalla del asistente (revolut.ts) y lo que
// dice Bancos de una cuenta de Revolut. Todo inventado (T11).
import { describe, expect, it } from 'vitest'
import {
  bancoLigado, CLAVE_VUELTA, comprobarClientId, desdePropuesto, lineaRevolut, nombreDeBanco, recordarVuelta, vueltaDeLaDireccion, type ConexionRevolut,
} from '@/modules/conta/bancos/revolut/revolut'
import { lineaConexion } from '@/modules/conta/lib/agregadorBanco'
import { SIN_CADUCIDAD } from '../../../../../supabase/functions/_shared/revolut/lectura.ts'

const ahora = new Date('2026-10-31T12:00:00Z')
const base: ConexionRevolut = { estado: 'conectada', entorno: 'sandbox', certificado: '-----BEGIN CERTIFICATE-----', vuelta: 'https://app.sumied.com/bancos/revolut/vuelta',
  desdeHistorico: '2026-08-01', conectadaAt: '2026-10-31T10:00:00Z', conectadaPor: 'Ana Prueba', lastOkAt: '2026-10-31T11:55:00Z', lastError: null }

describe('comprobarClientId', () => {
  it('pegar el certificado en vez del Client ID lo dice con palabras normales', () => {
    expect(comprobarClientId('-----BEGIN CERTIFICATE-----MIID…')).toMatch(/^Eso es el certificado, no el Client ID/)
  })
  it('vacío, con espacios o demasiado corto, no; uno con su forma, sí', () => {
    expect(comprobarClientId('   ')).toMatch(/Pega el Client ID/)
    expect(comprobarClientId('abc def ghi')).toMatch(/no tiene la forma/)
    expect(comprobarClientId('corto')).toMatch(/no tiene la forma/)
    expect(comprobarClientId('  aBc123_-XyZ7890  ')).toBeNull()
  })
})

describe('la vuelta de Revolut', () => {
  it('recordarVuelta guarda solo el camino, sin parámetros', () => {
    const guardado: Record<string, string> = {}
    recordarVuelta('/llorente29/conta/bancos/cuentas?nuevo=banco', { setItem: (k, v) => { guardado[k] = v } })
    expect(guardado).toEqual({ [CLAVE_VUELTA]: '/llorente29/conta/bancos/cuentas' })
  })
  it('vueltaDeLaDireccion: el código y el state; o el error; o nada', () => {
    expect(vueltaDeLaDireccion('?revolut_code=c-1&revolut_state=s-1')).toEqual({ code: 'c-1', state: 's-1' })
    expect(vueltaDeLaDireccion('?revolut_error=access_denied')).toEqual({ error: 'access_denied' })
    expect(vueltaDeLaDireccion('?nuevo=banco')).toBeNull()
  })
  it('la página de vuelta no lleva a otra dirección que la de este sitio', async () => {
    const { readFileSync } = await import('node:fs')
    const html = readFileSync('revolut-vuelta.html', 'utf8')
    expect(html).toContain("camino.charAt(0) !== '/' || camino.charAt(1) === '/'")
    expect(html).toContain(`localStorage.getItem('${CLAVE_VUELTA}')`)
    const v = JSON.parse(readFileSync('vercel.json', 'utf8')) as { rewrites: { source: string; destination: string }[] }
    expect(v.rewrites[0]).toEqual({ source: '/bancos/revolut/vuelta', destination: '/revolut-vuelta.html' })
  })
})

describe('lineaRevolut: lo que dice la tarjeta', () => {
  it('sin conexión, conectar; a medias, seguir; conectada, al día con cuándo', () => {
    expect(lineaRevolut(null, ahora)).toMatchObject({ nivel: 'nada', boton: 'conectar' })
    expect(lineaRevolut({ ...base, estado: 'autorizar' }, ahora)).toMatchObject({ nivel: 'aviso', boton: 'seguir', texto: 'A medias: falta autorizar en Revolut.' })
    expect(lineaRevolut(base, ahora)).toEqual({ nivel: 'ok', texto: 'Al día · hace 5 min', boton: 'desconectar' })
  })
  it('desconectada desde Revolut: en rojo y para volver a conectar', () => {
    expect(lineaRevolut({ ...base, estado: 'retirada' }, ahora)).toMatchObject({ nivel: 'error', boton: 'reconectar' })
  })
  it('una lectura que falla se dice con su porqué, y cuándo fue la última buena', () => {
    expect(lineaRevolut({ ...base, lastError: 'Revolut pide esperar un poco.' }, ahora).texto).toBe('Conectada · la última lectura no ha ido bien: Revolut pide esperar un poco. Al día hace 5 min.')
  })
})

describe('las cuentas de Revolut en Bancos', () => {
  it('ligada por IBAN, sin importar espacios ni mayúsculas', () => {
    const c = { id: 'x', nombre: 'Principal', divisa: 'EUR', saldo: 1, iban: 'ES0099990000000000005678', iban4: '5678' }
    expect(bancoLigado(c, [{ id: 'b1', nombre: 'Revolut · Principal', iban: 'es00 9999 0000 0000 0000 5678' }])).toEqual({ id: 'b1', nombre: 'Revolut · Principal' })
    expect(bancoLigado(c, [{ id: 'b2', nombre: 'BBVA', iban: 'ES0099990000000000001111' }])).toBeNull()
    expect(nombreDeBanco(c)).toBe('Revolut · Principal')
  })
  it('la fecha «sin caducidad» no hace decir «caduca el permiso»', () => {
    const l = lineaConexion({ banco: 'Revolut', estado: 'al_dia', leida: '2026-10-31T11:55:00Z', intentada: '2026-10-31T11:55:00Z', caduca: SIN_CADUCIDAD, mensaje: null, renovar: null }, ahora)
    expect(l?.nivel).toBe('ok')
    expect(l?.texto).not.toMatch(/[Cc]aduca/)
  })
  it('desde cuándo traer: propone el día 1 de hace tres meses', () => {
    expect(desdePropuesto(ahora)).toBe('2026-07-01')
  })
})
