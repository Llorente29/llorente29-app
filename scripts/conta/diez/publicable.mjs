// scripts/conta/diez/publicable.mjs
//
// C04b · Lo que el lector de Diez puede escribir en un registro PÚBLICO.
//
// El repositorio es público y el registro y el resumen de cada run también.
// El 12/10 (run 10) dos subcuentas de banco llevaban el IBAN entero en el
// nombre y salieron en el registro. Desde entonces:
//
//   · El nombre de una subcuenta de tercero (40, 41, 43, 44) o de banco (57) no
//     sale nunca: solo su código.
//   · El de cualquier otra pasa por limpiar(), y TODA la salida del lector
//     vuelve a pasar por limpiar() antes de escribirse (cinturón y tirantes).
//
// limpiar() tapa, en mayúsculas o minúsculas y con o sin separadores (espacio,
// punto, guion):
//   · IBAN de cualquier país, y el número de cuenta español sin el ES (CCC);
//   · NIF de persona (DNI), NIE y CIF, también con el ES delante (NIF-IVA);
//   · cualquier tira de 9 cifras o más (teléfonos, cuentas, referencias);
//   · importes con céntimos (1.234,56) y cualquier cifra con €.
// Prefiere tapar de más: un nombre de cuenta propio mal tapado se lee igual;
// un IBAN publicado no se puede despublicar.
//
// Lo que NO tapa, a propósito: los códigos de subcuenta (8 cifras), los años,
// los meses (202609) y los recuentos del informe. La prueba está en
// tests/conta/diez/publicable.test.ts.

const S = '[ .\\-]?' // un separador opcional entre bloques

// IBAN: dos letras de país, dos de control y de 11 a 30 alfanuméricos, en
// bloques o seguidos. Va primero: si no, el NIF se comería un trozo.
const IBAN = /\b[A-Z]{2}\d{2}(?:[ \-]?[0-9A-Z]){11,30}\b/gi

// DNI (NIF de persona): 7 u 8 cifras (con o sin puntos de millar) y la letra.
// Pegada o con guion, en cualquier caja; separada por un espacio, solo en
// mayúscula: «1209599 s» son segundos, no un DNI.
const DNI = new RegExp(`\\b(?:ES${S})?\\d{1,2}\\.?\\d{3}\\.?\\d{3}[.\\-]?[A-Z]\\b`, 'gi')
const DNI_ESPACIO = /\b(?:ES[ .\-]?)?\d{1,2}\.?\d{3}\.?\d{3} [A-Z]\b/g
// NIE: X, Y o Z, 7 cifras y la letra.
const NIE = new RegExp(`\\b(?:ES${S})?[XYZ]${S}\\d{7}${S}[A-Z]\\b`, 'gi')
// CIF: letra de sociedad, 7 cifras y el control (cifra o letra A–J). También
// escrito con puntos de millar (B-12.345.678).
const CIF = new RegExp(`\\b(?:ES${S})?[A-HJ-NP-SUVW]${S}(?:\\d{2}\\.\\d{3}\\.\\d{3}|\\d{7}${S}[0-9A-J])\\b`, 'gi')
// Nueve cifras o más seguidas, con un separador simple entre medias (CCC,
// teléfonos). Los códigos de subcuenta son de 8 y quedan fuera.
const CIFRAS = /\b\d(?:[ \-]?\d){8,}\b/g
// Importes: con céntimos a la española, o cualquier número pegado a €.
const IMPORTE = /(?:\b\d{1,3}(?:\.\d{3})*,\d{2}\b|\d[\d.,]*\s?€|€\s?\d[\d.,]*)/g

export const esTercero = (codigo) => /^(40|41|43|44)/.test(String(codigo ?? ''))
export const esBanco = (codigo) => /^57/.test(String(codigo ?? ''))

/** Tapa todo lo que parezca un dato de alguien en un texto libre. */
export function limpiar(texto) {
  return String(texto ?? '')
    .replace(IBAN, '[IBAN]')
    .replace(NIE, '[NIF]')
    .replace(CIF, '[NIF]')
    .replace(DNI, '[NIF]')
    .replace(DNI_ESPACIO, '[NIF]')
    .replace(CIFRAS, '[NÚMERO]')
    .replace(IMPORTE, '[IMPORTE]')
}

/** El nombre de una subcuenta, tal como puede salir en el informe. */
export function nombrePublicable(codigo, nombre) {
  if (esTercero(codigo)) return '*(tercero: no se publica)*'
  if (esBanco(codigo)) return '*(cuenta de banco: no se publica)*'
  return limpiar(nombre).replace(/\|/g, '/')
}
