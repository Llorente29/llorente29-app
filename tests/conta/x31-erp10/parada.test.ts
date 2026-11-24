// tests/conta/x31-erp10/parada.test.ts
//
// X31 · 0 · La salida a ERP10, parada en todas las empresas hasta que esté la comprobación de lo que ya hay en ERP10: las
// dos salidas reales (conta-erp10-escribir y conta-erp10-cola) paran antes de tocar nada, y la pantalla apaga los
// botones con el motivo. Que nadie la quite sin querer: se quita en el mismo cambio que pone la comprobación.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MOTIVO_SALIDA_PARADA, SALIDA_ERP10_PARADA } from '@/modules/conta/erp10/parada'
import { fraseErp10Barra } from '@/modules/conta/erp10/salidaSola'

const leer = (f: string) => readFileSync(f, 'utf8')

describe('la salida a ERP10, parada', () => {
  it('parada, con su motivo', () => {
    expect(SALIDA_ERP10_PARADA).toBe(true)
    expect(MOTIVO_SALIDA_PARADA).toBe('Falta la comprobación de lo que ya hay en ERP10')
  })
  it('el botón y la ficha: conta-erp10-escribir contesta 409 con el motivo, después de la sesión y antes de leer nada', () => {
    const f = leer('supabase/functions/conta-erp10-escribir/index.ts')
    const guarda = f.indexOf('if (SALIDA_ERP10_PARADA) return json(')
    expect(guarda).toBeGreaterThan(f.indexOf('if (!u?.user)'))
    expect(guarda).toBeLessThan(f.indexOf('await req.json()'))
    expect(f.slice(guarda, guarda + 200)).toContain('409')
  })
  it('lo que sale solo: conta-erp10-cola no coge nada (para antes de leer la cola)', () => {
    const f = leer('supabase/functions/conta-erp10-cola/index.ts')
    const guarda = f.indexOf('if (SALIDA_ERP10_PARADA) return json(')
    expect(guarda).toBeGreaterThan(f.indexOf('no autorizado'))
    expect(guarda).toBeLessThan(f.indexOf('srv.rpc("conta_erp10_cola"'))
  })
  it('la pantalla: «Sacar a ERP10» y «Volver a intentarlo», apagados con el motivo', () => {
    expect(leer('src/modules/conta/libros/SalidaErp10.tsx')).toMatch(/porQueNoSacar = \(SALIDA_ERP10_PARADA \? `\$\{MOTIVO_SALIDA_PARADA\}\.` : null\)/)
    expect(leer('src/modules/conta/nucleo/ficha/LineaErp10.tsx')).toMatch(/disabled=\{SALIDA_ERP10_PARADA\} title=\{SALIDA_ERP10_PARADA \? `\$\{MOTIVO_SALIDA_PARADA\}\.`/)
  })
  it('la barra de abajo: sin «Mandarla», en gris y con el motivo al pasar el ratón', () => {
    const f = fraseErp10Barra({ atascados: 1, salida: { encendida: true }, pruebaHecha: false, parada: true })
    expect(f).toEqual({ tono: 'gris', fuerte: 'La salida a ERP10 está parada', resto: '· falta comprobar lo que ya hay en ERP10', title: 'Falta la comprobación de lo que ya hay en ERP10.' })
    expect(fraseErp10Barra({ atascados: 0, salida: { encendida: true }, pruebaHecha: false, parada: true }), 'nada esperando: nada').toBeNull()
  })
})
