// E01 · Las facturas de los clientes de Sumied entran por @entrada.sumied.com.
// La firma con los dos secretos (Folvy y Sumied), la cuenta de cada correo para
// pedirlo otra vez, y que ningún dominio de entrada quede escrito a fuego en el
// front ni en _shared. La regla del dominio vive en la base
// (_conta_dominio_entrada): sus tres casos los prueba
// supabase/staging/sql/20261116_e01_entrada_sumied_prueba.sql. Todo inventado.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cuentaDelAviso, firmaSvix, parejaDelCorreo, parejasResend, type ParejaResend } from '../../../supabase/functions/_shared/facturasEntrada'

const secreto = (s: string) => 'whsec_' + Buffer.from(`secreto-de-prueba-${s}-32bytes!!`).toString('base64')
const FOLVY: ParejaResend = { cuenta: 'folvy', secreto: secreto('folvy'), clave: 're_prueba_folvy' }
const SUMIED: ParejaResend = { cuenta: 'sumied', secreto: secreto('sumied'), clave: 're_prueba_sumied' }
const OTRO = secreto('nadie')
const T = '1760000000'
const ahora = 1760000060
const aviso = (to: string) => JSON.stringify({ type: 'email.received', data: { email_id: 'e1', to: [to], from: 'proveedor@ejemplo.test' } })
const cabeceras = async (sec: string, cuerpo: string) => ({ id: 'msg_1', timestamp: T, firma: await firmaSvix(sec, 'msg_1', T, cuerpo) })

describe('E01 · la firma con los dos secretos', () => {
  it('vale la de Folvy: el aviso es de la cuenta de Folvy, y se usa su clave', async () => {
    const c = aviso('facturas-taberna-norte@entrada.folvy.app')
    const r = await cuentaDelAviso([FOLVY, SUMIED], await cabeceras(FOLVY.secreto, c), c, ahora)
    expect(r.pareja?.cuenta).toBe('folvy')
    expect(r.pareja?.clave).toBe('re_prueba_folvy')
  })
  it('vale la de Sumied: el aviso es de la cuenta de Sumied, y se usa su clave', async () => {
    const c = aviso('facturas-taberna-norte@entrada.sumied.com')
    const r = await cuentaDelAviso([FOLVY, SUMIED], await cabeceras(SUMIED.secreto, c), c, ahora)
    expect(r.pareja?.cuenta).toBe('sumied')
    expect(r.pareja?.clave).toBe('re_prueba_sumied')
  })
  it('no vale ninguna: no hay cuenta y se dice por qué (la función contesta 401)', async () => {
    const c = aviso('facturas-taberna-norte@entrada.sumied.com')
    const r = await cuentaDelAviso([FOLVY, SUMIED], await cabeceras(OTRO, c), c, ahora)
    expect(r.pareja).toBeUndefined()
    expect(r.mal).toBe('la firma no es la de Resend')
    const viejo = await cuentaDelAviso([FOLVY, SUMIED], await cabeceras(SUMIED.secreto, c), c, ahora + 3600)
    expect(viejo.mal).toBe('el sello de tiempo no es de ahora')
  })
  it('no vale elegir por el dominio: un aviso a entrada.sumied.com firmado por Folvy es de Folvy, y uno sin firma buena no es de nadie', async () => {
    const c = aviso('facturas-taberna-norte@entrada.sumied.com')
    expect((await cuentaDelAviso([FOLVY, SUMIED], await cabeceras(FOLVY.secreto, c), c, ahora)).pareja?.cuenta).toBe('folvy')
    // Con solo la cuenta de Folvy configurada, la firma de Sumied no entra aunque el destinatario sea de Sumied.
    expect((await cuentaDelAviso([FOLVY], await cabeceras(SUMIED.secreto, c), c, ahora)).pareja).toBeUndefined()
  })
  it('sin ninguna cuenta configurada, no entra nada', async () => {
    const c = aviso('x@entrada.folvy.app')
    expect((await cuentaDelAviso([], await cabeceras(FOLVY.secreto, c), c, ahora)).mal).toBe('no hay ninguna cuenta de Resend configurada')
  })
})

describe('E01 · la configuración: basta una pareja completa', () => {
  it('solo cuentan las parejas con secreto y clave', () => {
    expect(parejasResend({ folvy: { secreto: 's1', clave: 'k1' }, sumied: { secreto: 's2', clave: 'k2' } }).map((p) => p.cuenta)).toEqual(['folvy', 'sumied'])
    expect(parejasResend({ folvy: { secreto: 's1', clave: '' }, sumied: { secreto: 's2', clave: 'k2' } }).map((p) => p.cuenta)).toEqual(['sumied'])
    expect(parejasResend({ folvy: { secreto: 's1', clave: 'k1' }, sumied: { secreto: null, clave: 'k2' } }).map((p) => p.cuenta)).toEqual(['folvy'])
    expect(parejasResend({ folvy: {}, sumied: {} })).toEqual([])
  })
})

describe('E01 · «Volver a leer» y «Poner el PDF» piden el correo a la cuenta por la que entró', () => {
  it('la apuntada; sin apuntar (los de antes), la de Folvy; si esa cuenta no está configurada, ninguna', () => {
    expect(parejaDelCorreo('sumied', [FOLVY, SUMIED])?.cuenta).toBe('sumied')
    expect(parejaDelCorreo('folvy', [FOLVY, SUMIED])?.cuenta).toBe('folvy')
    expect(parejaDelCorreo(null, [FOLVY, SUMIED])?.cuenta).toBe('folvy')
    expect(parejaDelCorreo(undefined, [SUMIED])).toBeNull()
    expect(parejaDelCorreo('sumied', [FOLVY])).toBeNull()
  })
})

describe('E01 · ningún dominio de entrada escrito a fuego en el front ni en _shared', () => {
  const ficheros = (d: string): string[] => readdirSync(d).flatMap((n) => {
    const p = join(d, n)
    return statSync(p).isDirectory() ? ficheros(p) : /\.(ts|tsx)$/.test(n) ? [p] : []
  })
  it('src/ y supabase/functions/_shared no tienen «entrada.folvy.app» ni «entrada.sumied.com» fuera de los comentarios', () => {
    const malos: string[] = []
    for (const f of [...ficheros('src'), ...ficheros('supabase/functions/_shared')]) {
      readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
        const codigo = l.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '').replace(/\/\*.*?\*\//g, '')
        if (/entrada\.(folvy\.app|sumied\.com)/.test(codigo)) malos.push(`${f}:${i + 1}`)
      })
    }
    expect(malos).toEqual([])
  })
})
