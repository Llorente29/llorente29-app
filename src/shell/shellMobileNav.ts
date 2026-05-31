// src/shell/shellMobileNav.ts
//
// R1.3b — Configuración compartida de la navegación móvil del Shell.
//
// Con la IA como héroe central de la barra inferior, quedan 4 ranuras de
// pestaña (2 izquierda + 2 derecha). Los destinos diarios de planta/servicio
// + Inicio van en la barra; los menos usados en el móvil se mueven al "Más"
// (hoy: el menú del avatar del TopBar en móvil).
//
// Decisión de producto (31/05, Julio): Team (módulo `personal`) es de encargado
// y puntual (aprobar vacaciones, cambios de turno), no una acción por turno →
// va al overflow. Safety/Sales/Kitchen + Inicio se quedan en la barra.
//
// Fuente de verdad ÚNICA del reparto: la leen ShellBottomNav (para EXCLUIR los
// overflow de la barra) y ShellTopBar (para INCLUIRLOS en el menú del avatar).
// Cambiar el reparto = tocar solo este array.

export const MOBILE_OVERFLOW_MODULE_IDS: readonly string[] = ['personal']

/** ¿Este módulo va al "Más" (fuera de la barra inferior) en móvil? */
export function isMobileOverflowModule(moduleId: string): boolean {
  return MOBILE_OVERFLOW_MODULE_IDS.includes(moduleId)
}
