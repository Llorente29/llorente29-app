// src/modules/conta/lib/errorBase.ts
//
// Lo que se enseña cuando la base falla. Las funciones del módulo paran con
// frases escritas para quien usa la pantalla («Ese proveedor no existe o no es
// de tu cuenta.»): ésas pasan tal cual. Lo que NO está escrito para nadie —el
// texto técnico de Postgres o del navegador— se cambia por una frase normal, y
// el texto técnico va a la consola, no a la vista.
//
// Por qué (09/10): el libro diario de producción enseñaba «conta_dias_por_
// asentar: canceling statement due to statement timeout». Para quien lo lee no
// dice nada, y no le dice qué hacer.

export interface ErrorDeBase {
  message: string
  code?: string | null
}

/** Un fallo técnico conocido: su frase y si tiene sentido volver a intentarlo. */
const TECNICOS: { es: (e: ErrorDeBase) => boolean; texto: string }[] = [
  {
    // 57014 = query_canceled: el límite de tiempo de la consulta (8 s para authenticated).
    es: (e) => e.code === '57014' || /canceling statement due to statement timeout|statement timeout/i.test(e.message),
    texto: 'Está tardando más de lo normal. Vuelve a intentarlo en un momento.',
  },
  {
    es: (e) => /failed to fetch|networkerror|load failed|fetch failed|network request failed/i.test(e.message),
    texto: 'No llega la respuesta del servidor. Comprueba la conexión y vuelve a intentarlo.',
  },
  {
    es: (e) => /JWT expired|invalid JWT/i.test(e.message),
    texto: 'La sesión ha caducado. Vuelve a entrar y repítelo.',
  },
]

/** La frase que se enseña, o null si el error ya está escrito para la pantalla. */
export function fraseDeErrorTecnico(e: ErrorDeBase): string | null {
  return TECNICOS.find((t) => t.es(e))?.texto ?? null
}

/**
 * El texto para la pantalla. Si el error es técnico, la frase normal y el
 * técnico a la consola (con `donde` para encontrarlo); si no, el de siempre.
 */
export function textoParaPantalla(donde: string, e: ErrorDeBase, deSiempre: string): string {
  const frase = fraseDeErrorTecnico(e)
  if (frase === null) return deSiempre
  console.error(`[conta] ${donde}: ${e.code ? `${e.code} ` : ''}${e.message}`)
  return frase
}
