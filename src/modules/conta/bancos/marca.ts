// src/modules/conta/bancos/marca.ts
//
// Los textos de Bancos que nombran al producto, con la marca de la pestaña
// (C06): el módulo no escribe «Folvy» a mano, lo pide a la marca. Con Folvy
// dicen lo de siempre; con una marca propia, lo automático se llama
// «automático», como en el libro diario (lib/autor.ts).

import { CON_MARCA, MARCA } from '@/modules/conta/cuenta/marca'

/** El nombre del producto («Folvy», o el de la marca propia). */
export const NOMBRE = MARCA.nombre
/** El registro de lo que hizo solo: «Lo que ha hecho Folvy». */
export const LO_HECHO = CON_MARCA ? 'Lo hecho automáticamente' : `Lo que ha hecho ${NOMBRE}`
/** La entrada corta de la barra: «Hecho por Folvy». */
export const HECHO_POR = CON_MARCA ? 'Automático' : `Hecho por ${NOMBRE}`
/** Quién lo hizo, cuando no fue una persona. */
export const QUIEN_AUTOMATICO = CON_MARCA ? 'automático' : NOMBRE
/** El filtro de lo que hizo solo. */
export const SOLO_AUTOMATICO = CON_MARCA ? 'Solo lo automático' : `Solo ${NOMBRE}`
/** Una regla que no escribió la persona. */
export const PROPUESTA_POR = CON_MARCA ? 'Propuesta automáticamente' : `Propuesta por ${NOMBRE}`
export const LA_PROPUSO = CON_MARCA ? 'propuesta automáticamente' : `la propuso ${NOMBRE}`
/** La cabecera de la columna de la propuesta. */
export const LO_QUE_CREE = CON_MARCA ? 'Lo que parece' : `Lo que ${NOMBRE} cree que es`
