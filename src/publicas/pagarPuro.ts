// src/publicas/pagarPuro.ts
//
// Las piezas de la página de pago (pagar.ts) que no arrancan nada: los textos
// y el formulario hacia Redsys. Aparte para poder probarlas sin la página
// (tests/unit/modules/conta/pc01/cobrosRedsys.test.ts).

/** S01 · Dónde se paga, para ir dentro de una frase: «la página segura de Stripe» o «la página segura de tu banco». */
export const dondeSePaga = (p: string | null | undefined): string => (p === 'redsys' ? 'la página segura del banco (Redsys)' : 'la página segura de Stripe')
/** S01 · Quién confirma el pago a la vuelta. */
export const quienConfirma = (p: string | null | undefined): string => (p === 'redsys' ? 'el banco' : 'Stripe')

/** S01 · Manda al cliente al TPV del banco: un formulario con los tres campos firmados (por POST, como pide Redsys). */
export function irARedsys(r: { url: string; campos: Record<string, string> }, doc: Pick<Document, 'createElement' | 'body'> = document): HTMLFormElement {
  if (!/^https:\/\/sis(-t)?\.redsys\.es(:\d+)?\//.test(r.url)) throw new Error('No se ha podido abrir el pago.')
  const f = doc.createElement('form')
  f.method = 'POST'; f.action = r.url; f.hidden = true
  for (const [k, v] of Object.entries(r.campos)) {
    const i = doc.createElement('input')
    i.type = 'hidden'; i.name = k; i.value = v
    f.append(i)
  }
  doc.body.append(f)
  return f
}

/** «tarjeta» o «tarjeta y Bizum»: con qué deja pagar el enlace, para ir dentro de una frase. */
export function metodosEnFrase(m: readonly string[] | undefined): string {
  const xs = (m ?? []).map((x) => (x === 'bizum' ? 'Bizum' : 'tarjeta'))
  return xs.length === 2 ? `${xs[0]} y ${xs[1]}` : xs[0] ?? 'tarjeta'
}
