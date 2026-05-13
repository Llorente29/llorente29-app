// src/platform/feature-gate/gateEvents.ts
// Bus de eventos simple para notificar cambios del feature gate a los hooks.
// Vive en archivo separado para evitar ciclos de import entre el servicio y el hook.

type Listener = () => void
const listeners = new Set<Listener>()

export function subscribeFeatureGate(listener: Listener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function notifyFeatureGateChanged(): void {
  listeners.forEach(l => l())
}