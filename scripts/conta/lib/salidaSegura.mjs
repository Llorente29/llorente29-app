// scripts/conta/lib/salidaSegura.mjs
//
// D01 · R2 punto 1 · LA PUERTA DE SALIDA de todo workflow que lee producción o
// Diez. El repositorio es público y el registro y el resumen de cada run
// también: lo que sale ahí no se despublica.
//
// Por qué una lista de lo que PASA y no de lo que se tapa: el 13/10 el run 60
// sacó el texto de la descripción de cinco facturas recibidas —nombres de
// proveedores y de tres personas— y limpiar() (publicable.mjs) no lo tapó,
// porque tapa lo que PARECE un dato (NIF, IBAN, importes) y un nombre no se
// parece a nada. Un nombre solo se para no dejando pasar texto.
//
// Lo único que pasa, una línea cada cosa:
//
//   @@ <clave> <valor>
//
//   · <clave>: un identificador escrito en el código, minúsculas, cifras, «_»
//     y «.», hasta 48 caracteres (p. ej. «recibidas.tipos_2»);
//   · <valor>: un número ENTERO (un recuento, un documento, un sí/no como
//     1/0) o una huella hexadecimal de 16 a 64 caracteres. Nada de decimales:
//     un decimal es un importe suelto.
//   · «@@ # <título>» abre una sección; el título también es una clave.
//
// Todo lo demás (texto libre, importes, números de factura, NIF, nombres, la
// traza de un error) NO sale: se cuenta y al final se dice cuántas líneas se
// han retenido. La clave no puede llevar un dato porque solo admite [a-z0-9_.]
// y la escribe el código; la comprobación de antes-de-subir mira además que
// los workflows que leen producción o Diez pasen por aquí.

export const CLAVE = /^[a-z][a-z0-9_.]{0,47}$/
export const VALOR = /^(?:-?\d{1,15}|[0-9a-f]{16,64})$/

/**
 * Filtra una salida entera. Devuelve las líneas que pasan, ya en Markdown, y
 * cuántas se han retenido.
 */
export function filtrar(texto) {
  const filas = []
  let retenidas = 0
  for (const bruta of String(texto ?? '').split(/\r?\n/)) {
    const l = bruta.trim()
    if (l === '') continue
    const m = /^@@ (#\s+)?(\S+)(?: (\S+))?$/.exec(l)
    if (!m) { retenidas++; continue }
    const [, titulo, clave, valor] = m
    if (!CLAVE.test(clave)) { retenidas++; continue }
    if (titulo) {
      if (valor !== undefined) { retenidas++; continue }
      filas.push({ seccion: clave })
      continue
    }
    if (valor === undefined || !VALOR.test(valor)) { retenidas++; continue }
    filas.push({ clave, valor })
  }
  return { filas, retenidas }
}

/** Las filas como Markdown: una tabla por sección. */
export function enMarkdown({ filas, retenidas }) {
  const out = []
  let abierta = false
  const abrir = () => { out.push('| clave | valor |', '|---|---:|'); abierta = true }
  for (const f of filas) {
    if (f.seccion) { out.push('', `### ${f.seccion}`, ''); abierta = false; continue }
    if (!abierta) abrir()
    out.push(`| ${f.clave} | ${f.valor} |`)
  }
  out.push('', `Líneas retenidas por la puerta de salida: ${retenidas}`)
  return out.join('\n') + '\n'
}
