// src/modules/personal/laboral/ubicacionAproximada.ts
//
// L1a · PR 3 (28/10/2026). La «ubicación aproximada» del móvil.
//
// Lo de Alcalá no era otro sitio: era el móvil de Natacha con la ubicación
// aproximada del navegador. Tres fichajes el 28/10 a exactamente 670 m (mínimo
// = máximo) y sus compañeras a 4–6 m. El navegador dice cuánto se fía de su
// posición (coords.accuracy, en metros): con más de 100 m no sirve para decir
// si alguien está dentro o fuera del radio del local.
//
// La misma frontera que fichar() en la base (la 1923): con más de 100 m, el
// fichaje se guarda con su precisión, no cuenta como «fuera del radio», no
// bloquea y no avisa al encargado. A la persona se le dice en el momento cómo
// activar la ubicación precisa.

/** Metros: con una precisión peor, la ubicación es aproximada. Igual que en fichar(). */
export const PRECISION_MAXIMA_M = 100

/** La precisión del navegador, en metros enteros; null si no la da. */
export function precisionDe(accuracy: number | null | undefined): number | null {
  if (accuracy == null || !Number.isFinite(accuracy) || accuracy < 0) return null
  return Math.round(accuracy)
}

/** ¿Es una ubicación aproximada? Sin precisión, no se sabe: no lo es. */
export function esAproximada(accuracy: number | null | undefined): boolean {
  const p = precisionDe(accuracy)
  return p != null && p > PRECISION_MAXIMA_M
}

/** «± 1,5 km» o «± 120 m». */
export function textoPrecision(m: number): string {
  return m >= 1000
    ? `± ${(m / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 })} km`
    : `± ${Math.round(m)} m`
}

export const AVISO_APROXIMADA = 'Tu móvil está dando una ubicación aproximada: activa la ubicación precisa'

export interface PasosUbicacion { sistema: 'Android' | 'iPhone'; pasos: string[] }

/** Los pasos para activar la ubicación precisa, en el orden en que se tocan. */
export const PASOS_UBICACION_PRECISA: PasosUbicacion[] = [
  {
    sistema: 'Android',
    pasos: [
      'Abre Ajustes › Ubicación y comprueba que está activada.',
      'En Ajustes › Ubicación › Servicios de ubicación, activa «Precisión de la ubicación de Google» (en algunos móviles, «Mejorar la precisión»).',
      'En Ajustes › Aplicaciones › Chrome (o el navegador con el que fichas) › Permisos › Ubicación, elige «Permitir solo mientras se usa la aplicación» y activa «Usar ubicación precisa».',
      'Vuelve aquí y recarga la página.',
    ],
  },
  {
    sistema: 'iPhone',
    pasos: [
      'Abre Ajustes › Privacidad y seguridad › Localización y comprueba que está activada.',
      'Entra en «Safari» (o en el navegador con el que fichas) dentro de esa lista, elige «Mientras se usa la app» y activa «Ubicación exacta».',
      'Si Safari no pregunta, en Ajustes › Safari › Ubicación, elige «Preguntar» o «Permitir».',
      'Vuelve aquí y recarga la página.',
    ],
  },
]
