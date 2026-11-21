// src/modules/conta/nucleo/interruptor.ts
//
// K02 · El interruptor del núcleo: `conta_nucleo`, por CUENTA, en
// feature_flags, apagado de fábrica (decisión 2 de Julio, 17/11). Apagado: el
// marco de hoy, byte a byte. Encendido en el móvil: también el de hoy, hasta
// que haya maqueta de móvil.
//
// Se lee del gate de la aplicación (platform/feature-gate), el mismo que
// decide si sale la contabilidad (`conta`): ya ha leído TODOS los interruptores
// de la cuenta al entrar, así que no hay ni una lectura más ni una espera. No
// pasa por esqueletoService ni por la lista de interruptores de lo común: lo de
// hoy no cambia, y el #710 (sesión R), que toca esos ficheros, no choca.

import { useFeatureGate } from '@/platform/feature-gate/useFeatureGate'

export const INTERRUPTOR_NUCLEO = 'conta_nucleo'

export type CualMarco = 'hoy' | 'nucleo'

/**
 * Qué marco se pinta. Solo el núcleo si se SABE encendido y no es el móvil:
 * mientras no se sabe (null), el de hoy. Núcleo puro: lo prueba la unitaria
 * (tests/unit/modules/conta/k02/interruptor.test.ts).
 */
export function cualMarco({ encendido, movil }: { encendido: boolean | null; movil: boolean }): CualMarco {
  return encendido === true && !movil ? 'nucleo' : 'hoy'
}

/** ¿La cuenta tiene el núcleo encendido? null mientras el gate no está cargado. */
export function useNucleoEncendido(): boolean | null {
  const gate = useFeatureGate()
  return gate.ready ? gate.has(INTERRUPTOR_NUCLEO) : null
}
