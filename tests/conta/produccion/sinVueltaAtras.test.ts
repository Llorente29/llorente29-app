// tests/conta/produccion/sinVueltaAtras.test.ts — una tanda SIN VUELTA ATRÁS, a
// propósito (W02, Julio, 17/10).
//
// El ensayo #118 (0200 del relevo del secreto del despacho, sobre 61f7e037)
// paró en «la vuelta atrás automática funcionaría»: sin .down.sql, la cuenta
// no podía salir como antes. La salida no es quitar la protección: es
// declararlo en el manifiesto («sin-vuelta-atras:») con lo que se espera
// después («esperado:»), y que el ensayo compare con eso y pare si no sale.
// Para cualquier otra tanda, nada cambia.

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { compararEsperado, leerEsperado } from '../../../scripts/conta/produccion/cuentas-esperadas.mjs'
import { leerCuentas } from '../../../scripts/conta/produccion/cuentas-comparar.mjs'

const F0200 = 'supabase/migrations/20261120T0200_w02_secreto_despacho_fin_relevo.sql'
const F0100 = 'supabase/migrations/20261120T0100_w02_secreto_despacho_relevo.sql' // tiene .down.sql
const OTRA = 'supabase/migrations/20261117T0100_m01_motivos_para_validar.sql'
const CUENTA = 'cuenta: scripts/conta/produccion/cuentas/w02-secreto-despacho.sql'
const ESPERADO = [
  'esperado: w02-secreto-despacho · secretos del despacho en Vault = catcher_dispatch_secret',
  'esperado: w02-secreto-despacho · huella corta de catcher_dispatch_secret = como antes',
  'esperado: w02-secreto-despacho · huella corta de catcher_dispatch_secret_anterior = no existe',
]
const DECLARA = (f: string, motivo = 'borra el de antes, a propósito') => `sin-vuelta-atras: ${f}${motivo === '' ? '' : ` · motivo: ${motivo}`}`
const PAT_APLICAR = '^supabase/migrations/[A-Za-z0-9_./-]+\\.sql$'

const manifiesto = (lineas: string[], oblig = 'si') => {
  const d = mkdtempSync(join(tmpdir(), 'sinvuelta-'))
  const m = join(d, 'm.txt'); writeFileSync(m, lineas.join('\n') + '\n')
  try {
    const out = execFileSync('bash', ['scripts/conta/produccion/manifiesto.sh', m, join(d, 't'), join(d, 'c'), PAT_APLICAR, oblig, join(d, 'sv'), join(d, 'es')], { encoding: 'utf8', stdio: 'pipe' })
    return { rc: 0, out, tanda: readFileSync(join(d, 't'), 'utf8'), sv: readFileSync(join(d, 'sv'), 'utf8'), es: readFileSync(join(d, 'es'), 'utf8') }
  } catch (e) { const x = e as { status: number; stdout: string }; return { rc: x.status, out: x.stdout, tanda: '', sv: '', es: '' } }
}

describe('manifiesto.sh · «sin-vuelta-atras:» y «esperado:», con sus cerrojos', () => {
  it('el manifiesto de la 0200 (su copia, ya aplicada) se lee: un fichero, declarado, con su motivo y lo esperado', () => {
    const r = manifiesto(readFileSync('tests/conta/produccion/tanda-w02-secreto-despacho-20261017.txt', 'utf8').split('\n'))
    expect(r.rc).toBe(0)
    expect(r.tanda).toBe(`${F0200}\n`)
    expect(r.sv.split('\t')[0]).toBe(F0200)
    expect(r.sv.split('\t')[1]).toMatch(/no hay a qué volver/)
    expect(r.es.trim().split('\n')).toEqual(ESPERADO.map((l) => l.replace(/^esperado:\s*/, '')))
  })
  it('sin declarar nada, como hoy: los ficheros de sin-vuelta y esperado salen vacíos', () => {
    const r = manifiesto([CUENTA, F0200])
    expect(r.rc).toBe(0)
    expect(r.sv).toBe('')
    expect(r.es).toBe('')
  })
  it('sin motivo, PARA', () => {
    const r = manifiesto([CUENTA, F0200, DECLARA(F0200, ''), ...ESPERADO])
    expect(r.rc).toBe(1); expect(r.out).toMatch(/sin motivo/)
  })
  it('un fichero que no está en la tanda, PARA', () => {
    const r = manifiesto([CUENTA, F0200, DECLARA(OTRA), ...ESPERADO])
    expect(r.rc).toBe(1); expect(r.out).toMatch(/no está en la tanda/)
  })
  it('un fichero que SÍ tiene .down.sql, PARA (o tiene vuelta atrás o no la tiene)', () => {
    const r = manifiesto([CUENTA, F0100, DECLARA(F0100), ...ESPERADO])
    expect(r.rc).toBe(1); expect(r.out).toMatch(/existe supabase\/vuelta-atras\/20261120T0100_w02_secreto_despacho_relevo\.down\.sql/)
  })
  it('acompañada de otro fichero, PARA: va SOLA', () => {
    const r = manifiesto([CUENTA, OTRA, F0200, DECLARA(F0200), ...ESPERADO])
    expect(r.rc).toBe(1); expect(r.out).toMatch(/va SOLA/)
  })
  it('sin ningún «esperado:», PARA', () => {
    const r = manifiesto([CUENTA, F0200, DECLARA(F0200)])
    expect(r.rc).toBe(1); expect(r.out).toMatch(/sin ningún «esperado:»/)
  })
  it('«esperado:» sin «sin-vuelta-atras:», PARA', () => {
    const r = manifiesto([CUENTA, F0200, ...ESPERADO])
    expect(r.rc).toBe(1); expect(r.out).toMatch(/«esperado:» sin «sin-vuelta-atras:»/)
  })
  it('un «esperado:» de una cuenta que no se declara, o mal escrito, PARA', () => {
    expect(manifiesto([CUENTA, F0200, DECLARA(F0200), 'esperado: otra-cuenta · x = 1']).out).toMatch(/la cuenta otra-cuenta no está declarada/)
    expect(manifiesto([CUENTA, F0200, DECLARA(F0200), 'esperado: w02-secreto-despacho sin forma']).out).toMatch(/va «<cuenta> · <clave> = <valor>»/)
  })
  it('en la vuelta atrás (cuentas no obligatorias) no vale, PARA', () => {
    const r = manifiesto([CUENTA, F0200, DECLARA(F0200), ...ESPERADO], 'no')
    expect(r.rc).toBe(1); expect(r.out).toMatch(/solo vale en la tanda de aplicar/)
  })
})

describe('cuentas-esperadas.mjs · lo que hay después, contra lo esperado', () => {
  // La forma real de la cuenta (cuentas.sh): «cuenta,clave,valor». Huellas inventadas.
  const antes = leerCuentas([
    'w02-secreto-despacho,secretos del despacho en Vault,catcher_dispatch_secret · catcher_dispatch_secret_anterior',
    'w02-secreto-despacho,huella corta de catcher_dispatch_secret,1b441be2d80e',
    'w02-secreto-despacho,huella corta de catcher_dispatch_secret_anterior,8c8024759e69',
  ].join('\n'))
  const esperado = leerEsperado(ESPERADO.map((l) => l.replace(/^esperado:\s*/, '')).join('\n'))
  const despues = (vivo: string, anterior: string, nombres: string) => leerCuentas([
    `w02-secreto-despacho,secretos del despacho en Vault,${nombres}`,
    `w02-secreto-despacho,huella corta de catcher_dispatch_secret,${vivo}`,
    `w02-secreto-despacho,huella corta de catcher_dispatch_secret_anterior,${anterior}`,
  ].join('\n'))

  it('la 0200 que hace lo que dice: pasa', () => {
    const r = compararEsperado(antes, despues('1b441be2d80e', 'no existe', 'catcher_dispatch_secret'), esperado)
    expect(r.ok).toBe(true)
    expect(r.medidas).toBe(3)
  })
  it('una tanda declarada que cambia algo distinto de lo esperado (el vivo), PARA', () => {
    const r = compararEsperado(antes, despues('1c6bcd4e2b7b', 'no existe', 'catcher_dispatch_secret'), esperado)
    expect(r.ok).toBe(false)
    expect(r.mal).toEqual(['w02-secreto-despacho · huella corta de catcher_dispatch_secret: se esperaba 1b441be2d80e y sale 1c6bcd4e2b7b'])
  })
  it('una tanda declarada que borra el vivo en vez del _anterior, PARA (las tres medidas)', () => {
    const r = compararEsperado(antes, despues('no existe', '8c8024759e69', 'catcher_dispatch_secret_anterior'), esperado)
    expect(r.ok).toBe(false)
    expect(r.mal).toHaveLength(3)
  })
  it('una medida sin esperado, PARA: lo que no se dice que cambia también se comprueba', () => {
    const incompleto = new Map([...esperado].slice(0, 2))
    const r = compararEsperado(antes, despues('1b441be2d80e', 'no existe', 'catcher_dispatch_secret'), incompleto)
    expect(r.ok).toBe(false)
    expect(r.mal).toEqual(['w02-secreto-despacho · huella corta de catcher_dispatch_secret_anterior: no tiene esperado'])
  })
  it('un esperado que no es ninguna medida, PARA; y sin medidas, PARA', () => {
    const sobra = new Map([...esperado, ['w02-secreto-despacho · otra', 'x']])
    expect(compararEsperado(antes, despues('1b441be2d80e', 'no existe', 'catcher_dispatch_secret'), sobra).ok).toBe(false)
    expect(compararEsperado(new Map(), new Map(), esperado).ok).toBe(false)
  })
})

describe('aplicar-produccion-conta.yml · la tanda declarada va por su camino; las demás, como estaban', () => {
  const texto = readFileSync('.github/workflows/aplicar-produccion-conta.yml', 'utf8')
  const pasos = texto.split(/\n {6}- (?:name|uses): /).slice(1)
  const paso = (re: RegExp) => pasos.find((p) => re.test(p)) ?? ''

  it('el manifiesto se lee con las dos salidas nuevas', () => {
    expect(paso(/^Leer y validar el manifiesto/)).toContain('manifiesto.sh "$M" /tmp/tanda.txt /tmp/cuentas.txt "$PAT" "$OBLIG" /tmp/sin-vuelta.txt /tmp/esperado.txt')
  })
  it('la tanda declarada necesita «autorizo» siempre (entra en los autorizables), y un BLOQUEA sigue bloqueando', () => {
    const a = paso(/^Análisis · qué hace cada fichero/)
    const i = a.indexOf('cut -f1 /tmp/sin-vuelta.txt >> /tmp/autorizables.txt')
    expect(i).toBeGreaterThan(a.indexOf('> /tmp/autorizables.txt'))
    expect(i).toBeLessThan(a.indexOf('Necesita «autorizo» y no está escrito'))
    expect(a).toContain('BLOQUEA (no lo abre «autorizo»')
  })
  it('el paso 14 solo se desvía si hay declaración; debajo, el de siempre, que para si no sale como antes', () => {
    const p = paso(/^ENSAYO · la vuelta atrás automática funcionaría/)
    const desvio = p.indexOf('if [ -s /tmp/sin-vuelta.txt ]; then')
    const deSiempre = p.indexOf('sin=""')
    expect(desvio).toBeGreaterThan(0)
    expect(desvio).toBeLessThan(deSiempre)
    expect(p.slice(desvio, deSiempre)).toContain('ensayo-sin-vuelta.sh /tmp/tanda.txt /tmp/cuentas.txt /tmp/sin-vuelta.txt /tmp/esperado.txt /tmp/cuentas-antes.csv')
    // La protección de siempre, intacta: distinto de antes → para.
    expect(p.slice(deSiempre)).toMatch(/elif \[ "\$rc" -eq 0 \] && \[ "\$igual" -eq 0 \]; then[\s\S]*NO deja los datos como estaban[\s\S]*exit 1/)
  })
  it('el script de la tanda declarada para si la tanda falla o no deja lo esperado, y todo acaba en ROLLBACK', () => {
    const s = readFileSync('scripts/conta/produccion/ensayo-sin-vuelta.sh', 'utf8')
    expect(s).toContain("echo 'rollback;'")
    expect(s).toMatch(/if \[ "\$rc" -ne 0 \]; then[\s\S]*exit 1/)
    expect(s).toMatch(/cuentas-esperadas\.mjs "\$antes" "\$dir\/despues\.csv" "\$esperado"[\s\S]*exit 0[\s\S]*exit 1\s*$/)
  })
  it('deshacer.sh recibe lo declarado, y lo dice: queda aplicado y sale en rojo', () => {
    expect(paso(/^Después · comprobación/)).toContain('SIN_VUELTA: /tmp/sin-vuelta.txt')
    const d = mkdtempSync(join(tmpdir(), 'deshacer-'))
    writeFileSync(join(d, 'ap'), `${F0200}\n`)
    writeFileSync(join(d, 'sv'), `${F0200}\tborra el de antes, a propósito\n`)
    writeFileSync(join(d, 'inf'), '')
    let rc = 0
    let out: string
    try { out = execFileSync('bash', ['scripts/conta/produccion/deshacer.sh', join(d, 'ap')], { encoding: 'utf8', stdio: 'pipe', env: { ...process.env, INFORME: join(d, 'inf'), SIN_VUELTA: join(d, 'sv') } }) }
    catch (e) { const x = e as { status: number; stdout: string }; rc = x.status; out = x.stdout }
    expect(rc).toBe(1)
    expect(out).toContain('va sin vuelta atrás, declarada (borra el de antes, a propósito): queda aplicado')
    expect(readFileSync(join(d, 'inf'), 'utf8')).toContain('**sin vuelta atrás declarada: queda aplicado** (borra el de antes, a propósito)')
  })
})
