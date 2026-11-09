// Cola 2 (Julio, 02/11) · La versión del motor de Bancos sube con cada cambio
// del motor. Una propuesta guardada lleva la versión con la que se calculó y,
// si no es la de hoy, Bancos la vuelve a calcular antes de aceptarla
// (Movimientos.tsx, confirmarPropuesta). Si esta prueba sale en rojo es que
// conciliacion.ts ha cambiado: sube MOTOR_BANCOS y pon aquí su huella nueva.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MOTOR_BANCOS } from '@/modules/conta/lib/conciliacion'
import { PROPUESTA_RECALCULADA } from '@/modules/conta/lib/bancosVista'

const VERSIONES: Record<string, string> = {
  '2026-11-02.1': 'ddacc80511990c6ea52c0fc8d4b8ce4d',
  // G05 · nº 43: el ingreso de GoCardless (abonoDeGocardless).
  '2026-11-09.1': '0f0d0c2f949ad683ee1cdb52196a40ea',
}

describe('Cola 2 · la versión del motor de Bancos', () => {
  it('la huella de conciliacion.ts es la de su versión (si cambia el motor, sube MOTOR_BANCOS)', () => {
    const huella = createHash('md5').update(readFileSync('src/modules/conta/lib/conciliacion.ts')).digest('hex')
    expect(VERSIONES[MOTOR_BANCOS], `MOTOR_BANCOS = «${MOTOR_BANCOS}» no está en la lista: añádela con su huella`).toBeDefined()
    expect(huella, `conciliacion.ts ha cambiado y MOTOR_BANCOS sigue en «${MOTOR_BANCOS}»: súbela y apunta aquí la huella nueva (${huella})`).toBe(VERSIONES[MOTOR_BANCOS])
  })
  it('lo que dice Bancos de una propuesta vieja lleva contenido, no un «Hecho»', () => {
    expect(PROPUESTA_RECALCULADA).toContain('se ha vuelto a calcular')
  })
})
