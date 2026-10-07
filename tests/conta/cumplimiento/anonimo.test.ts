// tests/conta/cumplimiento/anonimo.test.ts
//
// C04 · respuesta 2: en producción, el resumen público de los agentes va sin
// conceptos ni nombres (scripts/conta/lib/anonimo.mjs). Se prueba contra el
// volcado REAL de staging que ya usa la prueba de coherencia (regla 31): con
// todos sus hallazgos, el informe anónimo no contiene ni una razón social, un
// nombre de proveedor, un NIF ni una descripción de actividad de la entrada.

import { describe, expect, it } from 'vitest'
import staging from './datos/coherencia-staging-20261003.json'
import { revisarCoherencia } from '../../../scripts/conta/lib/coherencia.mjs'
import { anonimizar, cuentaCorta, informeAnonimo } from '../../../scripts/conta/lib/anonimo.mjs'

type Fila = Record<string, unknown>
const textos = (x: unknown): string[] => {
  if (typeof x === 'string') return [x]
  if (Array.isArray(x)) return x.flatMap(textos)
  if (x && typeof x === 'object') return Object.values(x as Fila).flatMap(textos)
  return []
}

describe('informe anónimo de los agentes (producción)', () => {
  const hallazgos = revisarCoherencia(staging as never, { ficheros: [], hoy: '2026-10-07' })
  const filas = anonimizar('coherencia', hallazgos)
  const texto = informeAnonimo('Datos maestros, coherencia y terceros', filas, { donde: 'producción', hoy: '2026-10-07', mirado: 'Mirados: 3 empresas.' })

  it('el volcado real da hallazgos (si no, la prueba no prueba nada)', () => {
    expect(hallazgos.length).toBeGreaterThan(0)
    expect(filas).toHaveLength(hallazgos.length)
  })

  it('no sale ninguna razón social, nombre, NIF ni descripción de la entrada', () => {
    const e = staging as unknown as { empresas: Fila[]; proveedores_plazo?: Fila[]; plazos?: Fila[] }
    const prohibidos = [
      ...e.empresas.flatMap((x) => [x.legal_name, x.trade_name, x.tax_id]),
      ...e.empresas.flatMap((x) => textos((x as { actividades?: unknown }).actividades ?? []).filter((s) => s.length > 12)),
      ...(e.proveedores_plazo ?? []).flatMap((x) => [x.name, x.tax_id]),
      ...hallazgos.map((h) => h.detalle),
    ].filter((s): s is string => typeof s === 'string' && s.trim().length > 3)
    expect(prohibidos.length).toBeGreaterThan(3)
    for (const p of prohibidos) expect(texto, `sale «${p}»`).not.toContain(p)
  })

  it('cada hallazgo queda con su nivel, su tipo, la cuenta abreviada y la norma', () => {
    for (const [i, f] of filas.entries()) {
      expect(f.nivel).toBe(hallazgos[i].nivel)
      expect(f.tipo).toBe(hallazgos[i].tipo)
      expect(f.norma).toBe(hallazgos[i].norma)
      if (/cuenta [0-9a-f]{8}/.test(hallazgos[i].donde)) expect(f.cuenta).toMatch(/^[0-9a-f]{8}$/)
    }
    expect(texto).toContain('| coherencia |')
  })

  it('las otras dos formas de hallazgo (datos maestros y plan contable) también', () => {
    const otras = [...anonimizar('datos maestros', [{ tabla: 'tax_rate', fila: 'iva_general', tipo: 'valor', detalle: 'rate 21 ≠ 20' }]),
      ...anonimizar('plan contable', [{ nivel: 'rojo', texto: 'Empresa · Razón Inventada, S.L. (cuenta c01a0000): le faltan 3 cuentas' }])]
    expect(otras).toEqual([
      { agente: 'datos maestros', nivel: 'rojo', tipo: 'valor', cuenta: null, norma: null },
      { agente: 'plan contable', nivel: 'rojo', tipo: 'Empresa', cuenta: 'c01a0000', norma: null },
    ])
    expect(informeAnonimo('x', otras, { donde: 'p', hoy: 'h', mirado: 'm' })).not.toContain('Razón Inventada')
    expect(cuentaCorta('sin cuenta')).toBeNull()
  })
})
