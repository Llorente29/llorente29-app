// supabase/functions/_shared/queEs.ts
//
// V02 · Qué es un documento, por su NOMBRE o por su CONTENIDO, sin abrirlo con
// la IA. Lo usan la puerta por correo (facturasEntrada.ts) y la del navegador
// (src/modules/conta/lib/puerta.ts): la misma regla en los dos sitios. Sin
// dependencias, para que el front no arrastre nada del servidor.

/** Lo que es un documento (document_inbox.doc_kind). */
export type QueEs = 'factura' | 'ticket' | 'liquidacion' | 'extracto' | 'nomina' | 'riders' | 'otro'

/** Lo que dice el NOMBRE de un fichero que es (o null si no dice nada). Solo lo que no admite dudas. */
export function queDiceElNombre(nombre: string | null | undefined): QueEs | null {
  const n = (nombre ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  if (/\.(n43|q43|c43|aeb|ofx|qif)$/.test(n) || /(extracto|movimientos|norma[ _-]?43|cuaderno[ _-]?43)/.test(n)) return 'extracto'
  if (/n[o]mina/.test(n) || /\bnominas?\b/.test(n)) return 'nomina'
  if (/\.zip$/.test(n) && /(catcher|rider)/.test(n)) return 'riders'
  if (/(liquidacion|settlement|payout|monthly_statement|resumen[ _-]de[ _-]pagos)/.test(n)) return 'liquidacion'
  if (/\.xsig$/.test(n) || /facturae/.test(n)) return 'factura'
  return null
}

/**
 * Lo que dice el CONTENIDO cuando el nombre no dice nada. Un zip cuyos ficheros
 * son las facturas de los riders de Catcher (invoice_<n>_ES_I_<…>.pdf, el nombre
 * con que llegan, medido en las 83 de la quincena del 1 al 15/10) es la quincena
 * de riders. Los nombres de dentro de un zip van sin comprimir: no hace falta abrirlo.
 */
export function queDiceElContenido(nombre: string | null | undefined, bytes: Uint8Array): QueEs | null {
  if (!/\.zip$/i.test(nombre ?? '') && !(bytes[0] === 0x50 && bytes[1] === 0x4b)) return null
  if (/\.(xlsx|xls)$/i.test(nombre ?? '')) return null // un Excel también empieza por PK
  let t = ''
  for (let i = 0; i < bytes.length; i += 0x8000) t += String.fromCharCode(...bytes.subarray(i, Math.min(bytes.length, i + 0x8000)))
  const riders = t.match(/invoice_[A-Za-z0-9]+(?:_[A-Za-z0-9]+)*_ES_I_[A-Za-z0-9_]+\.pdf/g) ?? []
  return riders.length >= 2 ? 'riders' : null
}

