// src/modules/conta/plan/detalleRegistro.ts
//
// S01e · El historial del plan (company_account_log.detalle) lo escribe la
// base, y en los enlaces mete el nombre interno de la ficha y del papel
// («supplier pasa de ninguna a 40000002.», «… (principal).»). Al enseñarlo se
// dice en español; la base no se toca y lo demás pasa tal cual.

/** La ficha, con su artículo: «un proveedor», «una retención». */
const FICHA: Readonly<Record<string, [string, string]>> = {
  supplier: ['un', 'proveedor'],
  customer: ['un', 'cliente'],
  bank_account: ['un', 'banco'],
  expense_category: ['un', 'tipo de gasto'],
  tax_rate: ['un', 'tipo de IVA'],
  withholding_rate: ['una', 'retención'],
}

/** El papel del enlace; el principal no se dice (es lo normal). */
const PAPEL: Readonly<Record<string, string>> = {
  principal: '',
  soportado: ' (el IVA que pagas)',
  repercutido: ' (el IVA que cobras)',
  gasto: ' (su gasto)',
  pago: ' (sus pagos)',
  suplidos: ' (sus suplidos)',
}

const FICHAS = Object.keys(FICHA).join('|')
const PAPELES = Object.keys(PAPEL).join('|')
const mayuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const cuenta = (c: string) => (c === 'ninguna' ? 'ninguna cuenta' : c)

export function detalleEnPalabras(detalle: string): string {
  return detalle
    // «supplier pasa de ninguna a 40000002.» → «Un proveedor pasa de ninguna cuenta a 40000002.»
    .replace(new RegExp(`^(${FICHAS}) pasa de (\\S+) a (\\S+?)\\.$`), (_, f: string, de: string, a: string) =>
      `${mayuscula(FICHA[f][0])} ${FICHA[f][1]} pasa de ${cuenta(de)} a ${cuenta(a)}.`)
    // «supplier deja de ir a 40000002 (principal).» → «Un proveedor deja de ir a 40000002.»
    .replace(new RegExp(`^(${FICHAS}) deja de ir a`), (_, f: string) => `${mayuscula(FICHA[f][0])} ${FICHA[f][1]} deja de ir a`)
    // «Se ha borrado un supplier: …» → «Se ha borrado un proveedor: …»
    .replace(new RegExp(`\\bun (${FICHAS})\\b`), (_, f: string) => `${FICHA[f][0]} ${FICHA[f][1]}`)
    .replace(new RegExp(` \\((${PAPELES})\\)\\.$`), (_, p: string) => `${PAPEL[p]}.`)
}
