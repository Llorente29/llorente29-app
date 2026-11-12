// GD · nº94 · La puerta de la DEMO: el resumen del «comprobar» de la Gestoría Demo enseña cada paso con su texto
// (datos inventados de la demo), pero solo con la forma de sus pasos, sin nada que parezca un dato de una persona
// o una llave, y solo en el job «comprobar» de gd-video-qbo.yml. Datos inventados (T11).
import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
// @ts-expect-error módulo .mjs sin tipos
import { demoEnMarkdown, filtrarDemo } from '../../../scripts/conta/lib/salidaDemo.mjs'
// @ts-expect-error módulo .mjs sin tipos
import { jobDeLinea, revisar } from '../../../scripts/conta/workflows-salida.mjs'

describe('la puerta de la demo', () => {
  it('deja pasar los pasos, las secciones y la cuenta final', () => {
    const { lineas, retenidas } = filtrarDemo([
      'En verde: 37 bien, 0 fallan, 4 no tocan, 2 avisos.',
      '### 07c · En la contabilidad',
      '✓ 03.2 · el recibo del mes cuadra con la base: 250,00 €',
      '! 07c.3 · la 57200002 queda con solo la comisión: saldo validado 3.220,00 €',
      '— 07.1 · la factura carga: no toca (Talleres Ruiz, S.L. aún no tiene factura de 2026-12)',
      '✗ P.1 · el portal de la demo está preparado: Talleres Ruiz, S.L. no tiene a nadie con acceso',
    ].join('\n'))
    expect(lineas).toHaveLength(6)
    expect(retenidas).toBe(0)
    expect(demoEnMarkdown({ lineas, retenidas })).toContain('- ✓ 03.2 · el recibo del mes cuadra con la base: 250,00 €')
  })

  it('retiene el texto libre y lo que parece un dato o una llave, aunque tenga forma de paso', () => {
    const { lineas, retenidas } = filtrarDemo([
      'Error: algo con una traza larga',
      '✓ C.0 · entrar: tomas.ruiz@talleresruiz.example',
      '✓ 0.3 · cuenta ES00 9999 0000 0000 0000 0000',
      '✓ 0.3 · NIF B00001115',
      '✓ 0.3 · DNI 00000000T',
      '✓ 0.3 · teléfono 600 000 101',
      '✓ 0.3 · https://app.sumied.com/conta',
      '✓ 0.3 · token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9xyz',
      '### ' + 'x'.repeat(90),
    ].join('\n'))
    expect(lineas).toEqual([])
    expect(retenidas).toBe(9)
  })

  it('sin PUERTA_DEMO=gd-comprobar, no se abre', () => {
    const r = spawnSync('node', ['scripts/conta/salida-demo.mjs'], { input: '✓ 01 · algo\n', encoding: 'utf8', env: { ...process.env, PUERTA_DEMO: '' } })
    expect(r.status).toBe(2)
    expect(r.stdout).toBe('')
  })
})

describe('workflows-salida · la puerta de la demo, solo en su job', () => {
  const wf = (job: string) => `jobs:\n  ${job}:\n    environment: despliegue\n    steps:\n      - name: x\n        env:\n          SUPABASE_ACCESS_TOKEN: \${{ secrets.SUPABASE_ACCESS_TOKEN }}\n        run: |\n          cat comprobar-salida/resumen.txt | PUERTA_DEMO=gd-comprobar node scripts/conta/salida-demo.mjs >> "$GITHUB_STEP_SUMMARY"\n`
  it('en el job «comprobar» de gd-video-qbo.yml, sí', () => {
    expect(revisar(wf('comprobar'), '.github/workflows/gd-video-qbo.yml')).toEqual([])
  })
  it('en otro job, o en otro workflow, no', () => {
    expect(revisar(wf('grabar'), '.github/workflows/gd-video-qbo.yml')[0]).toMatch(/fuera del job/)
    expect(revisar(wf('comprobar'), '.github/workflows/otro.yml')[0]).toMatch(/fuera del job/)
  })
  it('sin su forma exacta (sin PUERTA_DEMO), no', () => {
    const y = wf('comprobar').replace('PUERTA_DEMO=gd-comprobar ', '')
    expect(revisar(y, '.github/workflows/gd-video-qbo.yml')[0]).toMatch(/la puerta de la demo va como/)
  })
  it('el workflow de verdad cumple, y su puerta de la demo está en el job «comprobar»', () => {
    const y = readFileSync('.github/workflows/gd-video-qbo.yml', 'utf8')
    expect(revisar(y, '.github/workflows/gd-video-qbo.yml')).toEqual([])
    const n = y.split('\n').findIndex((l) => l.includes('PUERTA_DEMO=gd-comprobar')) + 1
    expect(jobDeLinea(y, n)).toBe('comprobar')
  })
})
