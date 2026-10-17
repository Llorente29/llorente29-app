// src/modules/conta/ui/documento/zoom.ts
//
// M01 · El − y el + del panel del documento: pasos fijos, sin pasarse ni por
// abajo (que no se lea) ni por arriba (que no quepa una línea).

export const PASOS_ZOOM = [50, 75, 100, 125, 150, 200] as const
export const ZOOM_INICIAL = 100

export function siguienteZoom(actual: number, paso: 1 | -1): number {
  const i = PASOS_ZOOM.findIndex((z) => z >= actual)
  const aqui = i < 0 ? PASOS_ZOOM.length - 1 : PASOS_ZOOM[i] === actual ? i : paso > 0 ? i - 1 : i
  return PASOS_ZOOM[Math.max(0, Math.min(PASOS_ZOOM.length - 1, aqui + paso))]
}
