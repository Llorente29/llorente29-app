// supabase/functions/conta-gocardless-leer/motivo.ts
//
// G05 · nº 77, punto 2 (10/11/2026) · EL MOTIVO DE UN COBRO DEVUELTO, EN PALABRAS
// DE OFICINA. GoCardless lo da en inglés en su evento (details.description) y con
// un código (details.cause). Se guarda en el recibo para que lo enseñe el portal
// del cliente (Code 3) y la ficha: «Sin saldo en la cuenta», no «insufficient_funds».
// Primero el código; si no lo hay o no se conoce, la descripción; si nada encaja,
// una frase general (nunca el inglés tal cual).
// Puro. Lo prueba tests/unit/modules/conta/gestoria/g05/motivoDevuelto.test.ts, con
// las descripciones que GoCardless dio de verdad (medidas el 10/11, sin datos de nadie).

const POR_CAUSA: Record<string, string> = {
  insufficient_funds: 'Sin saldo en la cuenta',
  refer_to_payer: 'El banco lo ha devuelto: el cliente tiene que hablar con su banco',
  bank_account_closed: 'La cuenta está cerrada',
  bank_account_disabled: 'La cuenta está bloqueada',
  account_blocked_for_any_financial_transaction: 'La cuenta está bloqueada',
  mandate_cancelled: 'El cliente canceló la domiciliación en su banco',
  mandate_expired: 'La domiciliación ha caducado',
  invalid_bank_details: 'Los datos de la cuenta no son válidos',
  direct_debit_not_enabled: 'La cuenta no admite domiciliaciones',
  authorisation_disputed: 'El cliente lo reclamó a su banco: dice que no lo autorizó',
  refund_requested: 'El cliente lo reclamó a su banco (en las 8 semanas que tiene para hacerlo)',
  return_on_odfi_request: 'El banco lo ha devuelto',
  payment_cancelled: 'Cancelado antes de cobrarse',
  reason_not_specified: 'El banco lo ha devuelto sin decir por qué',
}

const POR_TEXTO: [RegExp, string][] = [
  [/insufficient funds/i, POR_CAUSA.insufficient_funds],
  [/account\b.*\bclosed/i, POR_CAUSA.bank_account_closed],
  [/account was blocked|blocked/i, POR_CAUSA.bank_account_disabled],
  [/cancelled their mandate/i, POR_CAUSA.mandate_cancelled],
  [/disputed authoris/i, POR_CAUSA.authorisation_disputed],
  [/cool-off period/i, POR_CAUSA.refund_requested],
  [/cancelled at your request/i, POR_CAUSA.payment_cancelled],
  [/reason for the failure was not provided/i, POR_CAUSA.reason_not_specified],
]

export function motivoEnPalabras(causa: string | null | undefined, descripcion: string | null | undefined): string | null {
  if (!causa && !descripcion) return null
  if (causa && POR_CAUSA[causa]) return POR_CAUSA[causa]
  for (const [re, frase] of POR_TEXTO) if (descripcion && re.test(descripcion)) return frase
  return 'El banco lo ha devuelto'
}
