// supabase/functions/_shared/diezFactura.ts
//
// C04b · R13 · El asiento de ventas de Folvy → la FACTURA EMITIDA de Diez.
// Núcleo puro: sin red ni base. Lo usan la prueba en C0009 y, después, el
// envío al validar.
//
// La forma es la de Diez, medida en la C0009 el 13/10 (97 emitidas de Uber de
// septiembre, scripts/conta/diez/prueba-c0009-emitida-molde.ts):
//   · serie 1, TipoAsiento 1, TipoFactura 1, IVA al 10 %, sin claves de IVA;
//   · CuentaCliente = la 430 de la plataforma, sin NIF y con su NombreCliente;
//   · NumeroFactura «UBR-<local>-<AAAAMMDD>» y Descripcion «UBER EATS <local>
//     <dd/mm>» (97 de 97);
//   · Fecha = FechaFactura = el día de la venta; FechaIntroduccionFactura, el
//     día en que se mete;
//   · Apuntes: una línea por marca a su 7000000x con la base, y el reembolso
//     en la MISMA factura, en negativo, a la 7080000x; su suma es la base y
//     TotalGastosIngresos (97 de 97);
//   · el asiento (430 D, 700 H, 708 D, 477 H) lo genera Diez.
// Solo las plataformas con el patrón MEDIDO: lo que no se ha medido no se
// inventa, y se dice.
//
// Lo que NO se manda porque la factura no tiene dónde: la subcuenta de IVA.
// La pone Diez por el tipo (10 %). Se mira al leerla de vuelta.

import { analiticaParaEnviar, type Correspondencia } from './diezAnalitica.ts'
import type { FacturaData } from './diezCliente.ts'

export type LineaVentas = { cuenta: string; debe: number; haber: number; marca?: string | null; tipoIva?: number | null }
export type AsientoVentas = {
  /** AAAA-MM-DD, el día de la venta. */
  fecha: string
  /** El nombre del local en Folvy (como en la correspondencia). */
  local: string
  /** sales_channel.slug: uber, glovo, justeat. */
  canal: string
  lineas: LineaVentas[]
}
type Patron = { prefijoNumero: string; descripcion: string; cuentaCliente: string }
/**
 * El patrón de cada plataforma, solo si se ha medido en Diez.
 *
 * Medido en C0008, solo GET, el 15/10 (scripts/conta/diez/patrones-ventas-c0008.ts,
 * runs 38700752691 y 38703072135; agosto a octubre, 1.543 facturas emitidas):
 *   · Uber (43000002): las 126, «UBR-<grupo>-<AAAAMMDD>» con la fecha de la
 *     factura y «UBER EATS <grupo> dd/mm»; una por local y día. El testigo.
 *   · Just Eat (43000003): las 31 de agosto y septiembre, «JUS-<grupo>-<AAAAMMDD>»
 *     con la fecha de la factura y «JUST EAT <grupo> dd/mm»; una por local y día.
 *     (Las de siete cifras sueltas son de mayo a julio: la forma de antes.)
 */
export const PATRONES: Record<string, Patron> = {
  uber: { prefijoNumero: 'UBR', descripcion: 'UBER EATS', cuentaCliente: '43000002' },
  justeat: { prefijoNumero: 'JUS', descripcion: 'JUST EAT', cuentaCliente: '43000003' },
}

/**
 * Lo medido que NO se puede mandar como está, con su porqué.
 *
 * Glovo (43000001), en C0008: las 275 de agosto y septiembre son
 * «GLV<seis cifras>-<AAAAMMDD>», con la fecha de la factura. Las seis cifras
 * toman 14 valores, cada uno siempre con el mismo local: la gestoría hace UNA
 * FACTURA POR TIENDA DE GLOVO Y DÍA, no por local. El asiento de Folvy es uno
 * por local y día con todas sus marcas. Mandarlo así sería una factura que la
 * gestoría no hace (y no se encontraría al buscarla). Lo decide Julio:
 * partir el asiento por tienda de Glovo (y saber qué código es cada una) o
 * mandar uno por local con otra numeración.
 */
export const PATRONES_PENDIENTES: Record<string, string> = {
  glovo: 'Glovo va en Diez con una factura por tienda de Glovo y día («GLV» + el código de la tienda + la fecha), y el asiento de Folvy es uno por local con todas sus marcas: falta decidir cómo se parte antes de enviarlo',
}
const c = (x: number) => Math.round(x * 100)
const e = (x: number) => x / 100
const aaaammdd = (iso: string) => Number(iso.replaceAll('-', ''))

export type FacturaVentas = { factura: FacturaData; sinPoner: string[]; esperado: { cobro: number; base: number; cuota: number } }

/**
 * La factura emitida de Diez de un asiento de ventas. Lanza si el asiento no
 * se puede mandar tal cual (otra plataforma, otro tipo, sin cuadrar): nada a
 * medias.
 */
export function facturaDeVentas(a: AsientoVentas, o: { correspondencia: Correspondencia; nombreCliente: string; hoy: string; conAnalitica: boolean }): FacturaVentas {
  const p = PATRONES[a.canal.toLowerCase()]
  if (!p) throw new Error(PATRONES_PENDIENTES[a.canal.toLowerCase()] ?? `la plataforma «${a.canal}» no tiene su patrón de factura medido en Diez: no se envía`)
  const grupo = o.correspondencia.localAlEnviar[a.local]
  if (!grupo) throw new Error(`el local «${a.local}» no tiene grupo en Diez: no se puede numerar la factura`)
  const de = (pref: string) => a.lineas.filter((l) => l.cuenta.startsWith(pref))
  const otras = a.lineas.filter((l) => !/^(430|700|708|477)/.test(l.cuenta))
  if (otras.length) throw new Error(`líneas que una factura de ventas no lleva: ${otras.map((l) => l.cuenta).join(', ')}`)
  const clientes = [...new Set(de('430').map((l) => l.cuenta))]
  if (clientes.length !== 1 || clientes[0] !== p.cuentaCliente) throw new Error(`la 430 del asiento (${clientes.join(', ') || 'ninguna'}) no es la de ${a.canal} (${p.cuentaCliente})`)
  const tipos = [...new Set(de('477').map((l) => l.tipoIva ?? 10))]
  if (tipos.length !== 1 || tipos[0] !== 10) throw new Error(`IVA a otro tipo que el 10 % (${tipos.join(', ')}): no se envía hasta medirlo`)

  const fecha = aaaammdd(a.fecha)
  const [y, m, d] = a.fecha.split('-')
  const descripcion = `${p.descripcion} ${grupo} ${d}/${m}`
  // Ventas (700, al haber) en positivo y reembolsos (708, al debe) en negativo, por cuenta.
  const porCuenta = new Map<string, { importe: number; marca: string | null }>()
  for (const l of [...de('700'), ...de('708')]) {
    const x = porCuenta.get(l.cuenta) ?? { importe: 0, marca: l.marca ?? null }
    x.importe += c(l.haber) - c(l.debe)
    porCuenta.set(l.cuenta, x)
  }
  const cuentas = [...porCuenta.keys()].sort()
  const base = cuentas.reduce((t, k) => t + porCuenta.get(k)!.importe, 0)
  const cuota = de('477').reduce((t, l) => t + c(l.haber) - c(l.debe), 0)
  const cobro = de('430').reduce((t, l) => t + c(l.debe) - c(l.haber), 0)
  if (base + cuota !== cobro) throw new Error(`no cuadra: base ${e(base)} + cuota ${e(cuota)} ≠ cobro ${e(cobro)}`)

  const sinPoner: string[] = []
  const analitica = o.conAnalitica
    ? cuentas.map((k) => {
        const x = porCuenta.get(k)!
        const r = analiticaParaEnviar({ local: a.local, marca: x.marca, canal: a.canal }, o.correspondencia)
        for (const s of r.sinPoner) sinPoner.push(`${k}: ${s}`)
        return { Subcuenta: k, ...r.analitica, Descripcion: descripcion, Fecha: fecha, ImporteDebe: x.importe < 0 ? e(-x.importe) : 0, ImporteHaber: x.importe > 0 ? e(x.importe) : 0 }
      })
    : []
  const factura: FacturaData = {
    Ejercicio: y, Serie: '1', TipoAsiento: 1, TipoFactura: 1,
    Fecha: fecha, FechaFactura: fecha, FechaIntroduccionFactura: aaaammdd(o.hoy),
    CuentaCliente: p.cuentaCliente, NombreCliente: o.nombreCliente,
    NumeroFactura: `${p.prefijoNumero}-${grupo}-${fecha}`, Descripcion: descripcion,
    BaseImponible1: e(base), PorcentajeIVA1: 10, CuotaIVA1: e(cuota), TotalFactura: e(cobro), TotalGastosIngresos: e(base),
    Apuntes: cuentas.map((k, i) => ({ Linea: i + 1, Cuenta: k, Concepto: descripcion, Fecha: fecha, Importe: e(porCuenta.get(k)!.importe) })),
    Analitica: analitica,
  }
  return { factura, sinPoner, esperado: { cobro: e(cobro), base: e(base), cuota: e(cuota) } }
}

// ── C06b · Respuesta 8: la factura que ANULA una emitida (el contraasiento) ─────
//
// Es la misma factura con todos los importes en negativo (base, cuota, total,
// cada línea y su analítica al otro lado), con la fecha del contraasiento y su
// propio número. La forma es la de la gestoría, MEDIDA en la C0009 el 14/10
// (scripts/conta/diez/prueba-c0009-rectificativas-molde.ts, run 38615160577:
// 6820 facturas de 2023-01 a 2026-10):
//   · la anulación que hay (un duplicado) va con el número de la original y
//     «-ANUL», la descripción empieza por «ANUL», los importes en negativo,
//     TipoFactura 1 y SIN campos de rectificativa;
//   · en la serie 1 (ventas, la 430) ninguna factura lleva campos de
//     rectificativa (TipoRectificativa 0 en las 143 negativas; solo 3 abonos
//     de compras, serie 2, llevan NumeroFacturaRectificativa).
// Así que no se rellena ninguno: lo que no se ha visto no se inventa.

/** Cómo se anula en Diez una factura emitida (lo medido; ver arriba). */
export const FORMA_ANULACION = { sufijo: '-ANUL', prefijoDescripcion: 'ANUL ' } as const

/**
 * La factura emitida que anula `original` en Diez. `fecha`: la del
 * contraasiento (AAAA-MM-DD); `hoy`: el día en que se mete. Lanza si la
 * original no trae lo que hace falta: nada a medias.
 */
export function facturaQueAnula(original: FacturaData, o: { fecha: string; hoy: string }): FacturaData {
  const numero = String(original.NumeroFactura ?? '')
  if (!numero) throw new Error('la factura que se anula no tiene número: no se puede decir cuál anula')
  const neg = (x: unknown) => (Number(x ?? 0) === 0 ? 0 : e(-c(Number(x))))
  const fecha = aaaammdd(o.fecha)
  const descripcion = `${FORMA_ANULACION.prefijoDescripcion}${String(original.Descripcion ?? '')}`.slice(0, 40)
  const apuntes = ((original.Apuntes as { Linea: number; Cuenta: string; Concepto: string; Fecha: number; Importe: number }[] | undefined) ?? [])
    .map((a) => ({ ...a, Concepto: descripcion, Fecha: fecha, Importe: neg(a.Importe) }))
  const analitica = ((original.Analitica as Record<string, unknown>[] | undefined) ?? [])
    .map((a) => ({ ...a, Descripcion: descripcion, Fecha: fecha, ImporteDebe: Number(a.ImporteHaber ?? 0), ImporteHaber: Number(a.ImporteDebe ?? 0) }))
  return {
    ...original,
    Ejercicio: o.fecha.slice(0, 4), Documento: undefined,
    Fecha: fecha, FechaFactura: fecha, FechaIntroduccionFactura: aaaammdd(o.hoy),
    NumeroFactura: `${numero}${FORMA_ANULACION.sufijo}`, Descripcion: descripcion,
    BaseImponible1: neg(original.BaseImponible1), CuotaIVA1: neg(original.CuotaIVA1), TotalFactura: neg(original.TotalFactura), TotalGastosIngresos: neg(original.TotalGastosIngresos),
    Apuntes: apuntes, Analitica: analitica,
  }
}
