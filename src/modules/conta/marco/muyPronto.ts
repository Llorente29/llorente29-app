// src/modules/conta/marco/muyPronto.ts
//
// La barra «Pregunta o pide algo» y la voz se dibujan pero aún no funcionan
// (encargo C00 §6.5): al usarlas dicen «Muy pronto». No se simula ninguna
// respuesta.
//
// S01 · PR 2 (menú limpio): lo que solo diría «Muy pronto» no se enseña. El
// código se queda, apagado por este interruptor: el grupo «Preguntar» del
// buscador (Ctrl K, que sí funciona) y el botón de la voz. Vuelven con el S09,
// cuando contesten de verdad.
export const BARRA_PREGUNTAR = false

export const TEXTO_MUY_PRONTO = 'Muy pronto: todavía no puedo contestar desde aquí.'
export const DURACION_MUY_PRONTO_MS = 3500
