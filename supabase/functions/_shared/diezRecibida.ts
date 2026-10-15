// supabase/functions/_shared/diezRecibida.ts
//
// D01 · Tarea 5 · El asiento de una FACTURA RECIBIDA de Folvy → la factura de la
// serie 2 de Diez. Núcleo puro: sin red ni base. Lo usan la prueba en C0009 y,
// después, el envío al validar.
//
// La forma es la de Diez, medida en la C0009 el 13/10 (1.432 recibidas de la
// serie 2 de tres meses, scripts/conta/diez/prueba-c0009-recibida-molde.ts):
//   · Serie 2, TipoAsiento 2, TipoFactura 1 (las 6 y 7 son abonos: no se han
//     medido, no se mandan);
//   · CuentaCliente = la 400/410 del proveedor, con CifCliente (1.427 de 1.432)
//     y NombreCliente (todas);
//   · hasta tres tipos de IVA (BaseImponibleN, PorcentajeIVAN, CuotaIVAN): 1.404
//     con uno, 19 con dos, 9 con tres;
//   · Apuntes = las cuentas de gasto con su base; su suma es la suma de las
//     bases (1.432 de 1.432). La 472 y la 400/410 las pone Diez: en todas, una
//     sola 472 (47200000), aunque Folvy lleve una por tipo;
//   · Fecha (del asiento) = FechaFactura en 833, posterior en 599: se manda la
//     del asiento de Folvy; FechaIntroduccionFactura, el día en que se mete;
//   · Descripcion «<número>-<nombre del proveedor>»;
//   · sin analítica en ninguna recibida: no se manda.
// Lo NO medido no se manda (se lanza, y se dice): retención (12 de 1.432, con
// TipoRetencion sin descifrar), recargo (0), abonos, más de tres tipos, o una
// línea que una factura recibida no lleva.

import type { FacturaData } from './diezCliente.ts'
import { FORMA_ANULACION } from './diezFactura.ts'

export type LineaRecibida = { cuenta: string; debe: number; haber: number; tipoIva?: number | null; baseIva?: number | null }
export type AsientoRecibida = {
  /** AAAA-MM-DD, la fecha del asiento en Folvy. */
  fecha: string
  /** AAAA-MM-DD, la de la factura del proveedor. */
  fechaFactura: string
  numero: string
  proveedor: { nombre: string; nif: string | null }
  lineas: LineaRecibida[]
}
export type FacturaRecibida = { factura: FacturaData; esperado: { total: number; bases: number; cuotas: number; tipos: number[] } }

const c = (x: number) => Math.round(x * 100)
const e = (x: number) => x / 100
const aaaammdd = (iso: string) => Number(iso.replaceAll('-', ''))
const FECHA = /^\d{4}-\d{2}-\d{2}$/

/**
 * La factura de la serie 2 de Diez de un asiento de factura recibida. Lanza si
 * no se puede mandar tal cual: nada a medias.
 */
export function facturaRecibida(a: AsientoRecibida, o: { hoy: string }): FacturaRecibida {
  if (!FECHA.test(a.fecha) || !FECHA.test(a.fechaFactura) || !FECHA.test(o.hoy)) throw new Error('fechas que no son AAAA-MM-DD')
  if (a.fechaFactura > a.fecha) throw new Error(`la factura (${a.fechaFactura}) es posterior a su asiento (${a.fecha})`)
  const numero = a.numero.trim()
  if (!numero) throw new Error('sin número de factura no se manda: Diez la busca por él')
  const nombre = a.proveedor.nombre.trim()
  if (!nombre) throw new Error('sin el nombre del proveedor no se manda')

  const de = (re: RegExp) => a.lineas.filter((l) => re.test(l.cuenta))
  if (de(/^4751/).length) throw new Error('lleva retención: Diez la guarda con un TipoRetencion que no se ha medido; no se envía hasta medirlo')
  const otras = a.lineas.filter((l) => !/^(6|472|400|410)/.test(l.cuenta))
  if (otras.length) throw new Error(`líneas que una factura recibida no lleva: ${otras.map((l) => l.cuenta).join(', ')}`)

  const prov = de(/^4(00|10)/)
  const cuentasProv = [...new Set(prov.map((l) => l.cuenta))]
  if (cuentasProv.length !== 1) throw new Error(`la factura tiene que ir a UNA cuenta de proveedor (lleva ${cuentasProv.join(', ') || 'ninguna'})`)
  const total = prov.reduce((t, l) => t + c(l.haber) - c(l.debe), 0)
  if (total <= 0) throw new Error('un abono (total negativo o cero): Diez los guarda con otro TipoFactura, no medido; no se envía')

  // Las cuentas de gasto, al debe: los Apuntes.
  const porCuenta = new Map<string, number>()
  for (const l of de(/^6/)) porCuenta.set(l.cuenta, (porCuenta.get(l.cuenta) ?? 0) + c(l.debe) - c(l.haber))
  const cuentas = [...porCuenta.keys()].sort()
  const sumaGastos = cuentas.reduce((t, k) => t + porCuenta.get(k)!, 0)

  // El IVA, por tipo.
  const porTipo = new Map<number, { base: number; cuota: number }>()
  for (const l of de(/^472/)) {
    if (l.tipoIva == null || l.baseIva == null) throw new Error(`la 472 ${l.cuenta} no lleva su tipo y su base`)
    const x = porTipo.get(l.tipoIva) ?? { base: 0, cuota: 0 }
    x.base += c(l.baseIva)
    x.cuota += c(l.debe) - c(l.haber)
    porTipo.set(l.tipoIva, x)
  }
  const tipos = [...porTipo.keys()].sort((x, y) => y - x)
  if (tipos.length === 0) throw new Error('sin IVA soportado: no se ha medido cómo guarda Diez una recibida exenta; no se envía')
  if (tipos.length > 3) throw new Error(`${tipos.length} tipos de IVA: Diez guarda hasta tres en las medidas`)
  const bases = tipos.reduce((t, k) => t + porTipo.get(k)!.base, 0)
  const cuotas = tipos.reduce((t, k) => t + porTipo.get(k)!.cuota, 0)
  if (sumaGastos !== bases) throw new Error(`el gasto (${e(sumaGastos)}) no es la suma de las bases (${e(bases)}): Diez exige que los Apuntes sumen las bases`)
  if (bases + cuotas !== total) throw new Error(`no cuadra: bases ${e(bases)} + cuotas ${e(cuotas)} ≠ total ${e(total)}`)

  const descripcion = `${numero}-${nombre}`
  const fecha = aaaammdd(a.fecha)
  const slots: Record<string, number> = {}
  tipos.forEach((t, i) => {
    slots[`BaseImponible${i + 1}`] = e(porTipo.get(t)!.base)
    slots[`PorcentajeIVA${i + 1}`] = t
    slots[`CuotaIVA${i + 1}`] = e(porTipo.get(t)!.cuota)
  })
  const factura: FacturaData = {
    Ejercicio: a.fecha.slice(0, 4), Serie: '2', TipoAsiento: 2, TipoFactura: 1,
    Fecha: fecha, FechaFactura: aaaammdd(a.fechaFactura), FechaIntroduccionFactura: aaaammdd(o.hoy),
    CuentaCliente: cuentasProv[0], ...(a.proveedor.nif ? { CifCliente: a.proveedor.nif } : {}), NombreCliente: nombre,
    NumeroFactura: numero, Descripcion: descripcion,
    ...slots,
    TotalFactura: e(total), TotalGastosIngresos: e(bases),
    Apuntes: cuentas.map((k, i) => ({ Linea: i + 1, Cuenta: k, Concepto: descripcion, Fecha: fecha, Importe: e(porCuenta.get(k)!) })),
  }
  return { factura, esperado: { total: e(total), bases: e(bases), cuotas: e(cuotas), tipos } }
}

// ── D01 · La factura que ANULA una recibida ya enviada (su contraasiento) ──────
//
// Julio (15/10): «anular una recibida ya enviada a Diez con su "-ANUL", igual
// que las ventas». Es la forma de facturaQueAnula (diezFactura.ts, medida en la
// C0009 el 14/10): el número de la original con «-ANUL», la descripción con
// «ANUL » delante, todos los importes en negativo, la fecha del contraasiento,
// el mismo TipoFactura y SIN campos de rectificativa. En la serie 2 se niegan
// los TRES tipos (base y cuota; el porcentaje se queda) y cada Apunte; la
// cuenta, el NIF y el nombre del proveedor, los de la original.

/** La recibida de la serie 2 que anula `original`. `fecha`: la del contraasiento; `hoy`: el día en que se mete. */
export function facturaRecibidaQueAnula(original: FacturaData, o: { fecha: string; hoy: string }): FacturaData {
  if (!FECHA.test(o.fecha) || !FECHA.test(o.hoy)) throw new Error('fechas que no son AAAA-MM-DD')
  if (String(original.Serie) !== '2') throw new Error('no es una factura recibida (serie 2): no se anula como recibida')
  const numero = String(original.NumeroFactura ?? '').trim()
  if (!numero) throw new Error('la factura que se anula no tiene número: no se puede decir cuál anula')
  const neg = (x: unknown) => (Number(x ?? 0) === 0 ? 0 : e(-c(Number(x))))
  const fecha = aaaammdd(o.fecha)
  const descripcion = `${FORMA_ANULACION.prefijoDescripcion}${String(original.Descripcion ?? '')}`.slice(0, 40)
  const tipos: Record<string, number> = {}
  for (const i of [1, 2, 3]) {
    if (original[`BaseImponible${i}`] != null) tipos[`BaseImponible${i}`] = neg(original[`BaseImponible${i}`])
    if (original[`CuotaIVA${i}`] != null) tipos[`CuotaIVA${i}`] = neg(original[`CuotaIVA${i}`])
  }
  const apuntes = ((original.Apuntes as { Linea: number; Cuenta: string; Concepto: string; Fecha: number; Importe: number }[] | undefined) ?? [])
    .map((a) => ({ ...a, Concepto: descripcion, Fecha: fecha, Importe: neg(a.Importe) }))
  return {
    ...original,
    Ejercicio: o.fecha.slice(0, 4), Documento: undefined,
    Fecha: fecha, FechaFactura: fecha, FechaIntroduccionFactura: aaaammdd(o.hoy),
    NumeroFactura: `${numero}${FORMA_ANULACION.sufijo}`, Descripcion: descripcion,
    ...tipos, TotalFactura: neg(original.TotalFactura), TotalGastosIngresos: neg(original.TotalGastosIngresos),
    Apuntes: apuntes,
  }
}
