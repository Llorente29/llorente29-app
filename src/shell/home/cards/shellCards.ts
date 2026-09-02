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
import ResumenAgentes from '@/modules/agentes/home/ResumenAgentes'

/**
 * El catálogo del shell. El ORDEN de este array es el defecto de fábrica del
 * mosaico — el mismo que el Inicio tiene hoy, para que nadie note el cambio
 * hasta que decida personalizarlo.
 */
export const SHELL_HOME_CARDS: HomeCardDefinition[] = [
  // «Resumen de agentes» la aporta el SHELL porque no hay módulo `agentes`: los
  // agentes son cinco `cron.job` y una RPC, no una pantalla con su registro.
  // Comparte `home_agentes_estado` con el panel «Mis agentes» de abajo, así que
  // los dos no pueden discrepar — que es lo que pasaría con dos consultas.
  {
    key: 'agentes.resumen',
    title: 'Resumen de agentes',
    grupo: 'Agentes',
    size: 'md',
    source: 'cron.job_run_details',
    drill: { ruta: '/agentes', etiqueta: 'Abrir Agentes →' },
    requiredRole: 'manager',
    component: ResumenAgentes,
  },
  // (02/09) Las CUATRO de junio. Las cuatro que quedaban de junio —Ventas hoy, Trabajando
  // ahora, Resumen de Team y Resumen de Sales— se retiran ahora que existen sus
  // sustitutas de la maqueta. No se borran del producto: se les pone lápida
  // abajo, así que quien las tuviera ve el aviso con su nombre y su porqué en
  // vez de encontrarse un hueco.
  //
  // Sus componentes siguen en shellCardComponents.tsx. Volver a enchufar
  // cualquiera es añadir aquí su línea; borrarlos ahora sería tirar trabajo por
  // una decisión de catálogo, que es reversible.
]

/**
 * El defecto de fábrica: lo que ve quien nunca ha personalizado nada.
 *
 * (02/09) Ya son EXACTAMENTE las seis de la maqueta, en su orden. Las cuatro
 * heredadas de junio han salido: existen sus sustitutas, y mantenerlas habría
 * dejado un Inicio con dos tarjetas de ventas de hoy y dos de quién trabaja.
 *
 * La lista es explícita porque las aportan los módulos y no aparecerían solas:
 * el orden del mosaico es una decisión de producto, no el resultado de en qué
 * orden se cargue el registro de módulos.
 */
export const LAYOUT_POR_DEFECTO: string[] = [
  'ventas.ayer',                   // §1.1
  'ventas.semana',                 // §1.2
  'ventas.grafica_14_dias',        // §1.3 (ancha)
  'personal.en_cocina_ahora',      // §1.4
  'personal.cuadrantes',           // §1.6
  'kitchen.productos_86',          // §1.5
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
  // Las cuatro de junio, sustituidas por las seis de la maqueta el 02/09. El
  // motivo dice por CUÁL se sustituye: «se retiró» a secas dejaría al usuario
  // buscando algo que ahora se llama de otra forma.
  'shell.ventas_hoy':       { titulo: 'Ventas hoy',        motivo: 'la sustituyen «Ventas de ayer» y «Ventas · esta semana»' },
  'shell.trabajando_ahora': { titulo: 'Trabajando ahora',  motivo: 'la sustituye «En cocina ahora»' },
  'shell.resumen_team':     { titulo: 'Resumen de Team',   motivo: 'lo sustituyen «En cocina ahora» y «Cuadrantes»' },
  'shell.resumen_sales':    { titulo: 'Resumen de Sales',  motivo: 'lo sustituye «Ventas por día · últimas dos semanas»' },
}

/**
 * El nombre para enseñar. Si la clave no tiene lápida —una tarjeta retirada sin
 * anotarla, o un dato corrupto— se devuelve la clave: enseñar algo raro es
 * mejor que inventar un nombre bonito para algo que no sabemos qué era.
 */
export function nombreDeTarjetaRetirada(key: string): string {
  return TARJETAS_RETIRADAS[key]?.titulo ?? key
}
