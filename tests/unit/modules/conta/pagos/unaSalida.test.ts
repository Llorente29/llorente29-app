// B01 Revolut · PR 2b · Solo conta-pagar llega a pagar() de un banco. Ella es
// la que comprueba antes en la base que el lote está «listo» (aprobado y, si
// hacía falta, con la segunda con la llave o el PIN) y pasa por la puerta de
// la demo. Si otra función llama a pagar() de un ProveedorPago, o a POST /pay
// de Revolut, se salta todo eso: esta prueba lo dice, con su nombre.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const RAIZ = 'supabase/functions'
function ficheros(d: string): string[] {
  return readdirSync(d).flatMap((n) => { const f = join(d, n); return statSync(f).isDirectory() ? ficheros(f) : /\.ts$/.test(n) ? [f] : [] })
}

describe('una sola salida a pagar', () => {
  it('solo conta-pagar llama a pagar() de un banco', () => {
    const quien = ficheros(RAIZ).filter((f) => !f.includes('/_shared/') && /\.pagar\(\s*\{/.test(readFileSync(f, 'utf8')))
    expect(quien).toEqual([join(RAIZ, 'conta-pagar/index.ts')])
  })

  it('POST /pay de Revolut, solo en la salida de Revolut (_shared/revolut/pago.ts)', () => {
    const quien = ficheros(RAIZ).filter((f) => /['"`]\/pay['"`]/.test(readFileSync(f, 'utf8')))
    expect(quien).toEqual([join(RAIZ, '_shared/revolut/pago.ts')])
  })

  it('conta-pagar pasa por la puerta de la demo antes de hablar con el banco', () => {
    const t = readFileSync(join(RAIZ, 'conta-pagar/index.ts'), 'utf8')
    const puerta = t.indexOf('cuentaPuedeSalir(srv, co.account_id)')
    expect(puerta).toBeGreaterThan(0)
    expect(puerta).toBeLessThan(t.indexOf('tokenDeAcceso(srv, fetch, conexion)'))
  })
})
