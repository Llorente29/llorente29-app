// scripts/conta/lib/salidaDemo.mjs
//
// GD · nº94 · LA PUERTA DE LA DEMO. La puerta de salida (salidaSegura.mjs) solo
// deja pasar números y huellas, y así el resumen del «comprobar» de la Gestoría
// Demo salía vacío: había que bajarse el adjunto para ver qué paso fallaba. Lo
// que dice ese recorrido son datos INVENTADOS de la cuenta demo (Talleres Ruiz,
// sus importes, sus trabajadores de mentira), así que esta puerta deja pasar su
// texto, pero solo con la forma de sus pasos y solo en ese job.
//
// Lo que pasa, una línea cada cosa (lo escribe scripts/video/gd/comprobar.mjs):
//
//   ### <sección>                         hasta 80 caracteres
//   <marca> <id> · <qué>[: <detalle>]     marca ✓ ✗ — !, id como «07c.3», hasta 240
//   En verde|En rojo: N bien, N fallan, N no tocan, N avisos.
//
// Y aun con esa forma, se retiene la línea que lleve algo que parezca un dato de
// una persona o una llave: un correo, un IBAN, un NIF/NIE/DNI, un teléfono, un
// enlace o una cadena larga (un token). Lo retenido se cuenta al final.
//
// Dónde se puede usar: lo vigila scripts/conta/workflows-salida.mjs
// (PUERTA_DE_LA_DEMO): solo en el job «comprobar» de gd-video-qbo.yml. En
// cualquier otro sitio, ese paso de antes-de-subir falla.

const SECCION = /^### [^\n]{1,80}$/
const PASO = /^[✓✗—!] [0-9A-Za-z.]{1,12} · [^\n]{1,240}$/
const CUENTA = /^En (?:verde|rojo): \d+ bien, \d+ fallan, \d+ no tocan, \d+ avisos\.$/

/** Lo que parece un dato de una persona o una llave: con cualquiera de estos, la línea no sale. */
export const PARECE_UN_DATO = [
  /@/,                                                  // un correo
  /\b[A-Z]{2}\d{2}(?:[ ]?[0-9A-Z]{4}){4,7}\b/,          // un IBAN
  /\b[0-9XYZ]\d{7}[A-Z]\b/,                             // DNI / NIE
  /\b[A-HJ-NP-SUVW]\d{7}[0-9A-J]\b/,                    // NIF de sociedad
  /(?:\+\d{2}[ ]?)?\b[6789]\d{2}[ ]?\d{3}[ ]?\d{3}\b/,  // un teléfono
  /https?:\/\/|www\./i,                                 // un enlace
  /[A-Za-z0-9_-]{28,}/,                                 // una cadena larga: un token, una clave
]

export function filtrarDemo(texto) {
  const lineas = []
  let retenidas = 0
  for (const bruta of String(texto ?? '').split(/\r?\n/)) {
    const l = bruta.trim()
    if (l === '') continue
    const forma = SECCION.test(l) || PASO.test(l) || CUENTA.test(l)
    if (!forma || PARECE_UN_DATO.some((r) => r.test(l))) { retenidas++; continue }
    lineas.push(l)
  }
  return { lineas, retenidas }
}

/** En Markdown: las secciones como títulos y los pasos como lista. */
export function demoEnMarkdown({ lineas, retenidas }) {
  const out = ['## Comprobar la Gestoría Demo (datos inventados de la demo)', '']
  for (const l of lineas) out.push(l.startsWith('### ') ? `\n${l}\n` : `- ${l}`)
  out.push('', `Líneas retenidas por la puerta de la demo: ${retenidas}`)
  return out.join('\n') + '\n'
}
