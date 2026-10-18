// src/modules/conta/bancos/textosBancos.ts
//
// S01e · Frases de Bancos que cuentan algo, sin React (se prueban sueltas).
// Cada una dice QUÉ cuenta (qué bancos, qué meses), para que dos pantallas
// que cuentan cosas distintas no parezcan contradecirse (regla 31).

const de = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`

/** La banda de «Lo que he hecho»: todos los bancos, por el día en que lo hice. */
export function fraseHecho(casados: number, siguen: number, mes: string): string {
  if (casados === 0) return `En ${mes} no he casado nada solo en ninguno de tus bancos.`
  return `En ${mes}, en todos tus bancos, he casado yo ${de(casados, 'movimiento', 'movimientos')}; ${siguen === casados ? (casados === 1 ? 'sigue' : 'siguen todos') : `${siguen} ${siguen === 1 ? 'sigue' : 'siguen'}`} como ${casados === 1 ? 'lo dejé' : 'los dejé'}.`
}
