// tests/unit/modules/conta/v03/consulta.test.ts
//
// V03 · E1 · La prueba de conexión (2351, el candado): la consulta valida contra
// ConsultaLR.xsd, y solo una respuesta de consulta sin Fault cuenta como bien.

import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cuerpoConsulta, leerConexion } from '../../../../../supabase/functions/_shared/verifactu/consulta'

const raiz = resolve(__dirname, '../../../../..')
function valida(xml: string): boolean {
  const f = join(mkdtempSync(join(tmpdir(), 'v03-con-')), 'c.xml')
  writeFileSync(f, xml)
  const r = spawnSync('xmllint', ['--nonet', '--noout', '--schema', join(raiz, 'docs/conta/v03/aeat/ConsultaLR.xsd'), f],
    { encoding: 'utf8', env: { ...process.env, XML_CATALOG_FILES: join(raiz, 'tests/unit/modules/conta/v03/xsd/catalogo.xml') } })
  if (r.error) throw r.error
  return r.status === 0
}

describe('V03 · la prueba de conexión', () => {
  it('la consulta valida contra el XSD oficial, con el mes de Madrid (el 31/10 a las 23:30 UTC ya es noviembre)', () => {
    const x = cuerpoConsulta({ nombre: 'Prueba & Cía', nif: 'B28000016' }, new Date('2026-10-31T23:30:00Z'))
    expect(valida(x)).toBe(true)
    expect(x).toContain('<sf:Ejercicio>2026</sf:Ejercicio><sf:Periodo>11</sf:Periodo>')
    expect(x).toContain('Prueba &amp; Cía')
    expect(valida(x.replace('<sf:IDVersion>1.0</sf:IDVersion>', ''))).toBe(false)
  })

  it('solo una respuesta de consulta sin Fault abre el candado', () => {
    expect(leerConexion(200, '<env:Envelope><env:Body><tikLRRC:RespuestaConsultaFactuSistemaFacturacion xmlns:tikLRRC="x"><tikLRRC:Cabecera/></tikLRRC:RespuestaConsultaFactuSistemaFacturacion></env:Body></env:Envelope>').ok).toBe(true)
    const f = leerConexion(500, '<env:Envelope><env:Body><env:Fault><faultcode>env:Client</faultcode><faultstring>Codigo[4112].El titular del certificado debe ser Obligado Emision</faultstring></env:Fault></env:Body></env:Envelope>')
    expect(f).toEqual({ ok: false, codigo: 4112, motivo: 'fault' })
    expect(leerConexion(403, '<html>Forbidden</html>')).toEqual({ ok: false, codigo: null, motivo: 'http_403' })
  })
})
