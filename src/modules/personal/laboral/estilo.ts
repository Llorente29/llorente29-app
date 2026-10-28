// src/modules/personal/laboral/estilo.ts
//
// L1a · PR 2 (28/10/2026). Las pantallas nuevas de Laboral usan las piezas del
// sistema de diseño (src/modules/conta/diseno): se cargan sus valores y sus
// piezas, y lo poco propio de Laboral. Todo vive dentro de `.cx` (o de
// `.cx-colores`, en una pieza), así que no cambia nada del resto de Folvy.

import '../../conta/diseno/tokens.css'
import '../../conta/diseno/diseno.css'
import './laboral.css'

/** La clase del contenedor de una PANTALLA entera de Laboral (Registro de jornada, Inspección). */
export const RAIZ_LABORAL = 'cx s-raiz l-raiz'

/**
 * La de una PIEZA que va dentro de otra página («Para revisar» en Empleados,
 * las tarjetas del portal). W08 (28/10): con `.cx`, la hoja de componentes de
 * contabilidad (estilo/componentes.css) le da `min-height: 100vh` y el fondo de
 * página, y en Empleados quedaba un hueco en blanco de unos 300 px debajo de
 * «Para revisar». `.cx-colores` trae los mismos valores sin eso (como reparto).
 */
export const PIEZA_LABORAL = 'cx-colores s-raiz l-raiz'
