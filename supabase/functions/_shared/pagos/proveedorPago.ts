// supabase/functions/_shared/pagos/proveedorPago.ts
//
// B01 Revolut · PR 2b · EL CONTRATO DE UN BANCO CON EL QUE SUMIED PAGA. Igual
// que ProveedorAgregador para leer (bancoAgregador.ts): añadir un banco con el
// que pagar es escribir uno de estos, sin tocar pantallas ni la función que
// paga (conta-pagar). Hoy, Revolut (_shared/revolut/pago.ts).
//
// Lo llama SOLO conta-pagar, después de comprobar en la base que el lote está
// «listo» (aprobado y, si hacía falta, con su segunda aprobación con la llave
// o el PIN), de pasar por cuentaPuedeSalir (la demo, DM1) y con el
// request_id del pago. Una prueba vigila que nadie más llame a pagar().

/** Lo que dice el banco del titular de un IBAN (VoP / CoP). */
export type Titular =
  | { resultado: 'coincide' }
  | { resultado: 'se_parece'; nombreReal: string }
  | { resultado: 'no_coincide' }
  | { resultado: 'no_se_puede'; porque: string }
  | { resultado: 'ahora_no'; porque: string }

/** El estado de un pago en el banco, ya en las palabras de Sumied. */
export type EstadoBanco =
  | { estado: 'enviada'; bancoId: string }
  | { estado: 'esperando_banco'; bancoId: string }
  | { estado: 'pagada'; bancoId: string; at: string }
  | { estado: 'rechazada'; bancoId: string | null; porque: string }
  | { estado: 'devuelta'; bancoId: string; porque: string }

export interface PagoAlBanco {
  /** El id del pago en Sumied: el banco no lo hace dos veces (idempotencia). */
  requestId: string
  /** La cuenta del banco desde la que sale (su id en el banco). */
  cuentaOrigen: string
  beneficiario: string
  iban: string
  importe: number
  /** Lo que verá el proveedor en su banco (máx. 140): el número de la factura. */
  concepto: string
}

export interface ProveedorPago {
  /** «revolut», mañana «qonto»… */
  readonly id: string
  /** El nombre para el botón: «Pagar con Revolut». */
  readonly nombre: string
  /** ¿Es de verdad de quien dice? Antes de aprobar, para la pantalla. */
  comprobarTitular(d: { beneficiario: string; iban: string }): Promise<Titular>
  /** Manda el pago. Si el banco ya lo tenía (mismo requestId), devuelve ese. */
  pagar(p: PagoAlBanco): Promise<EstadoBanco>
  /** Cómo va un pago ya mandado. */
  estado(bancoId: string): Promise<EstadoBanco>
}

/** El IBAN, sin espacios y en mayúsculas. */
export const ibanLimpio = (s: string) => s.replace(/\s+/g, '').toUpperCase()
/** El país del IBAN (sus dos letras). */
export const paisDelIban = (s: string) => ibanLimpio(s).slice(0, 2)
/** Lo que se puede escribir en un registro: los cuatro últimos. */
export const iban4 = (s: string) => `···· ${ibanLimpio(s).slice(-4)}`
