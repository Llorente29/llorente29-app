// src/modules/social/lib/laFichaDeLaCuenta.ts
//
// LA FICHA DE LA CUENTA DE INSTAGRAM · 14/09/2026
//
// Todo el castellano de la ficha vive aquí, no en la pantalla: la RPC devuelve
// claves y fechas, y las frases se pueden leer y discutir sin abrir React.
//
// ── POR QUÉ EXISTE ────────────────────────────────────────────────────────
//
// La llave de Instagram de Foodint vive 60 días. Eso está MEDIDO, no supuesto:
// se creó el 05/07 a las 16:17 PDT y Meta dijo que caducó el 03/09 a las
// 16:12:45 PDT. Sesenta días clavados.
//
// Cuando murió, no lo dijo nadie. Estuvo muerta desde el 04/09 a la 01:12 de
// Madrid hasta que Julio la renovó a mano el 13/09 a las 21:12: NUEVE DÍAS Y
// VEINTE HORAS. En ese tiempo la fila de la base seguía diciendo `linked`, y
// --lo que es peor-- no había ninguna pantalla donde verlo. No es que la ficha
// mintiera: es que no había ficha.
//
// Lo único que quedaba de la avería eran cinco publicaciones en `error` con el
// mensaje de Meta dentro, que hay que ir a buscar de una en una.
//
// ── LO QUE ENSEÑA, Y EN QUÉ ORDEN ─────────────────────────────────────────
//
// Primero si se puede publicar, que es la pregunta. Después desde cuándo se
// sabe. Y sólo al final, cuándo hay que volver a renovarla. Los identificadores
// no salen: el `ig_user_id` no le dice nada a nadie.

export type EstadoDeLaLlave = 'publicando' | 'rota' | 'sin_estrenar' | 'sin_enlazar'

export interface CuentaDeRed {
  red: string
  enlazada: boolean
  enlazadaEl: string | null
  llaveNombre: string | null
  llaveOkAt: string | null
  llaveFalloAt: string | null
  llaveFalloClase: string | null
  llaveCaducaEl: string | null
  diasParaCaducar: number | null
  ultimaPublicacion: string | null
}

export const REDES: Record<string, string> = {
  instagram: 'Instagram', tiktok: 'TikTok', facebook: 'Facebook',
}

/**
 * EN QUÉ ESTÁ LA LLAVE.
 *
 * `rota` cuando el último fallo es MÁS NUEVO que el último acierto. No se
 * borra el fallo al volver a funcionar --se apuntan los dos y se comparan--
 * porque borrar la prueba de que algo se rompió es lo que hacía A2c, y ya lo
 * pagamos una vez.
 */
export function enQueEstaLaLlave(c: CuentaDeRed): EstadoDeLaLlave {
  if (!c.enlazada) return 'sin_enlazar'
  const ok = c.llaveOkAt ? new Date(c.llaveOkAt).getTime() : null
  const mal = c.llaveFalloAt ? new Date(c.llaveFalloAt).getTime() : null
  if (mal !== null && (ok === null || mal > ok)) return 'rota'
  if (ok === null) return 'sin_estrenar'
  return 'publicando'
}

/**
 * LA FRASE DE ARRIBA: si se puede publicar o no, y desde cuándo se sabe.
 *
 * `sin_estrenar` no dice «todo bien»: dice que no lo sabemos. Una llave que no
 * ha publicado nunca y una que publica cada día no son lo mismo, y enseñarlas
 * iguales es cómo se está nueve días sin enterarse (regla 8).
 */
export function comoEstaLaCuenta(c: CuentaDeRed, fecha: (iso: string) => string): string {
  switch (enQueEstaLaLlave(c)) {
    case 'sin_enlazar':
      return 'No está enlazada. Lo de esta red se publica a mano.'
    case 'rota':
      return `La llave no vale: Meta la rechazó${c.llaveFalloAt ? ` el ${fecha(c.llaveFalloAt)}` : ''}.`
        + ' Hasta que se renueve no se publica nada.'
    case 'sin_estrenar':
      return 'Enlazada, pero todavía no ha publicado nada desde que se vigila la llave.'
        + ' Hasta que salga una publicación, que esté bien es una suposición.'
    default:
      return `Publicando. La última vez que Meta aceptó la llave fue el ${fecha(c.llaveOkAt!)}.`
  }
}

/** El color del cartel. Rojo sólo cuando de verdad no se publica. */
export function elTonoDeLaCuenta(c: CuentaDeRed): 'ok' | 'aviso' | 'malo' | 'apagado' {
  const e = enQueEstaLaLlave(c)
  if (e === 'sin_enlazar') return 'apagado'
  if (e === 'rota') return 'malo'
  if (e === 'sin_estrenar') return 'aviso'
  return laCuentaAtras(c) === null ? 'ok' : 'aviso'
}

/** Los días que avisan. 14 y 5, los mismos que el vigía de las 06:10. */
export const DIAS_DE_AVISO = 14
export const DIAS_CRITICOS = 5

/**
 * LA CUENTA ATRÁS. `null` mientras falte mucho: un aviso que sale los 60 días
 * deja de leerse justo el día que importa.
 *
 * Pero abajo, en el renglón de la caducidad, la fecha SE DICE SIEMPRE. El
 * umbral decide si esto interrumpe, no si el dato existe (regla 7).
 */
export function laCuentaAtras(c: CuentaDeRed): string | null {
  const d = c.diasParaCaducar
  if (d === null || d === undefined) return null
  if (d < 0) return 'La llave ya ha caducado. Hay que renovarla en Meta.'
  if (d === 0) return 'La llave caduca HOY.'
  if (d <= DIAS_CRITICOS) return `La llave caduca en ${d} ${d === 1 ? 'día' : 'días'}. Renuévala ya.`
  if (d <= DIAS_DE_AVISO) return `La llave caduca en ${d} días. Conviene renovarla esta semana.`
  return null
}

/** El renglón de siempre: la fecha, pase lo que pase, y dónde se renueva. */
export function elRenglonDeLaCaducidad(c: CuentaDeRed, fecha: (iso: string) => string): string | null {
  if (!c.enlazada || !c.llaveCaducaEl) return null
  const d = c.diasParaCaducar
  const cuantos = d === null || d === undefined ? ''
    : d < 0 ? ' (ya pasó)'
    : ` (faltan ${d} ${d === 1 ? 'día' : 'días'})`
  return `La llave caduca el ${fecha(c.llaveCaducaEl)}${cuantos}.`
    + ' Se renueva en Meta, en la app Folvy Social, y se guarda en el Vault'
    + (c.llaveNombre ? ` con el nombre ${c.llaveNombre}.` : '.')
}

/** Lo último que salió de verdad. Es la otra mitad de la prueba. */
export function loUltimoQueSalio(c: CuentaDeRed, fecha: (iso: string) => string): string | null {
  if (!c.enlazada) return null
  if (!c.ultimaPublicacion) return 'Todavía no ha salido ninguna publicación por aquí.'
  return `La última publicación salió el ${fecha(c.ultimaPublicacion)}.`
}
