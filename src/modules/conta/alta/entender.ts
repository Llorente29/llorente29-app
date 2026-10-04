// src/modules/conta/alta/entender.ts
//
// Lo que escribe la persona cuando la pregunta es de botones (respuesta 3 del
// C00: «Vale escribir "ni idea" o "pregúntaselo a mi asesor"»). Puro.
//
// No adivina: o lo que escribe encaja con UNA de las respuestas, o es un «no
// lo sé», o se le dice que no se ha entendido. Nada se da por bueno sin que la
// persona lo confirme: lo entendido se repite en la conversación.

import { normalizar } from '@/modules/conta/alta/actividades'
import type { Pregunta } from '@/modules/conta/alta/guion'

export type Entendido =
  | { tipo: 'opcion'; valor: string; texto: string }
  | { tipo: 'nolose' }
  | { tipo: 'nada' }

const limpio = (s: string) => ` ${normalizar(s).replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim()} `

const NO_LO_SE = [' ni idea ', ' no lo se ', ' no se ', ' nose ', ' asesor ', ' gestor ', ' gestoria ', ' preguntaselo ', ' luego ', ' despues ', ' ahora no ']

const SI = [' si ', ' sip ', ' vale ', ' claro ', ' correcto ', ' eso es ', ' exacto ', ' ok ', ' de acuerdo ']
const NO = [' no ', ' nop ', ' para nada ', ' ninguno ', ' ninguna ']

export function entender(p: Pregunta, texto: string): Entendido {
  const t = limpio(texto)
  if (t.trim() === '') return { tipo: 'nada' }
  if (NO_LO_SE.some((x) => t.includes(x))) return { tipo: 'nolose' }

  // Una respuesta cuyo texto entero (o su palabra que la distingue) aparece.
  const conTexto = p.opciones.filter((o) => {
    const palabras = limpio(o.texto).trim().split(' ').filter((w) => w.length >= 4 && !['cada', 'esta', 'esto', 'normal'].includes(w))
    return t.includes(limpio(o.texto)) || palabras.some((w) => t.includes(` ${w} `))
  })
  if (conTexto.length === 1) return { tipo: 'opcion', valor: conTexto[0].valor, texto: conTexto[0].texto }

  // Un sí o un no a secas, si la pregunta tiene esa respuesta.
  const si = p.opciones.find((o) => o.valor === 'si' || /^s[ií]\b/i.test(o.texto))
  const no = p.opciones.find((o) => o.valor === 'no' || /^no\b/i.test(o.texto))
  const diceSi = SI.some((x) => t.includes(x))
  const diceNo = NO.some((x) => t.includes(x))
  if (diceSi && !diceNo && si) return { tipo: 'opcion', valor: si.valor, texto: si.texto }
  if (diceNo && !diceSi && no) return { tipo: 'opcion', valor: no.valor, texto: no.texto }
  return { tipo: 'nada' }
}
