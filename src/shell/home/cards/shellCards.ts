// src/shell/home/cards/shellCards.ts
//
// LAS TARJETAS TRANSVERSALES DEL INICIO, ya en el catálogo.
//
// (02/09 · §0) LAS SIN FUENTE, FUERA. Eran tres —Solicitudes, APPCC hoy y
// Resumen de Safety— y no enseñaban un dato: enseñaban «—» y la palabra
// «próximamente». En junio eso era honesto porque el Inicio era interno. Hoy
// esta pantalla es la cara de la demo del cliente 2, y una casilla que dice
// «próximamente» no comunica transparencia: comunica producto a medias.
//
// No es la regla 7 al revés. La regla 7 prohíbe esconder FILAS QUE EXISTEN; una
// tarjeta sin fuente no tiene filas que esconder, tiene un hueco. Y siguen en el
// catálogo del cajón cuando se cableen: quitarlas del mosaico por defecto no es
// borrarlas del producto.
//
// Se quedan CUATRO, que son las que tienen dato de verdad, hasta que las
// sustituyan las seis de la maqueta.
//
// Eran las siete que el Inicio enseñaba desde junio, sin reescribir
// ni un widget: los componentes de shellCardComponents.tsx envuelven
// `MetricCard` y `ModuleSummaryCard` tal cual. Lo dice el RECON del 30/08 y es
// la razón de que existan como estaban — «preparado para configurabilidad por
// usuario sin reescribir los widgets». Reescribirlos ahora sería tirar el
// trabajo que se hizo para no hacerlo dos veces, y cambiaría el aspecto del
// Inicio en un lote que no va de eso.
//
// Viven en el SHELL y no en un módulo porque su dato sale de
// homeMetricsService, que es del shell. Las de módulo llegan por
// `ModuleDefinition.homeCards` y entran en el mismo catálogo sin tocar esto.

import type { HomeCardDefinition } from '../../types'
import {
  VentasHoy, TrabajandoAhora, ResumenTeam, ResumenSales,
} from './shellCardComponents'

/**
 * El catálogo del shell. El ORDEN de este array es el defecto de fábrica del
 * mosaico — el mismo que el Inicio tiene hoy, para que nadie note el cambio
 * hasta que decida personalizarlo.
 */
export const SHELL_HOME_CARDS: HomeCardDefinition[] = [
  { key: 'shell.ventas_hoy',       title: 'Ventas hoy',        size: 'sm', source: 'sale',
    drill: { ruta: '/ventas', etiqueta: 'Abrir Ventas →' }, component: VentasHoy },
  { key: 'shell.trabajando_ahora', title: 'Trabajando ahora',  size: 'sm', source: 'employee_clock_status',
    drill: { ruta: '/personal/ahora-mismo', etiqueta: 'Abrir Team · Ahora mismo →' }, component: TrabajandoAhora },
  { key: 'shell.resumen_team',     title: 'Resumen de Team',   size: 'md', source: 'employee_clock_status',
    drill: { ruta: '/personal/ahora-mismo', etiqueta: 'Abrir Team · Ahora mismo →' }, component: ResumenTeam },
  { key: 'shell.resumen_sales',    title: 'Resumen de Sales',  size: 'md', source: 'sale',
    drill: { ruta: '/ventas', etiqueta: 'Abrir Ventas →' }, component: ResumenSales },
]

/**
 * El defecto de fábrica: lo que ve quien nunca ha personalizado nada.
 *
 * (02/09) Deja de ser «las del shell» y pasa a ser una LISTA EXPLÍCITA, porque
 * las tarjetas de la maqueta las aportan los módulos y no aparecerían solas.
 * Según entren las seis aprobadas, las cuatro heredadas de junio salen de aquí
 * hasta que el defecto sea exactamente esas seis.
 */
export const LAYOUT_POR_DEFECTO: string[] = [
  'ventas.ayer',                   // §1.1 de la maqueta
  'ventas.grafica_14_dias',        // §1.3 de la maqueta (ancha)
  'kitchen.productos_86',          // §1.4 de la maqueta
  'personal.en_cocina_ahora',      // §1.x de la maqueta
  'personal.cuadrantes',           // §1.6 de la maqueta
  ...SHELL_HOME_CARDS.map(c => c.key),
]

// ── LÁPIDAS: las tarjetas que se retiraron, con su nombre y su motivo ───────
//
// Cuando una tarjeta sale del catálogo, la clave sigue guardada en el
// `home_layout` de quien la tuviera puesta. El Inicio lo dice —regla 7, no se
// descarta en silencio— pero decía «shell.appcc_hoy» y «nadie sabe ya
// dibujarlas»: una clave interna y una frase que suena a avería, en la pantalla
// del dueño. La pantalla habla el idioma del negocio.
//
// Así que cada retirada deja su lápida: cómo se llamaba y por qué se fue. Es la
// misma idea que la firma vieja de `set_brand_status`, que en vez de
// desaparecer contesta explicando que está retirada y qué hacer.
export interface TarjetaRetirada {
  titulo: string
  motivo: string
}

export const TARJETAS_RETIRADAS: Record<string, TarjetaRetirada> = {
  'shell.solicitudes':    { titulo: 'Solicitudes',       motivo: 'no tenía fuente de datos' },
  'shell.appcc_hoy':      { titulo: 'APPCC de hoy',      motivo: 'no tenía fuente de datos' },
  'shell.resumen_safety': { titulo: 'Resumen de Safety', motivo: 'no tenía fuente de datos' },
}

/**
 * El nombre para enseñar. Si la clave no tiene lápida —una tarjeta retirada sin
 * anotarla, o un dato corrupto— se devuelve la clave: enseñar algo raro es
 * mejor que inventar un nombre bonito para algo que no sabemos qué era.
 */
export function nombreDeTarjetaRetirada(key: string): string {
  return TARJETAS_RETIRADAS[key]?.titulo ?? key
}
