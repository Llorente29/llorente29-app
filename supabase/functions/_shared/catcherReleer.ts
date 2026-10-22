// supabase/functions/_shared/catcherReleer.ts
//
// E05 · Volver a leer los PDF de una quincena de Catcher en el servidor
// (Julio, 22/10), con el mismo código que el front (catcherPdf.ts y
// catcherCruces.ts), y volver a cruzar. Lo hace la función conta-lote-releer;
// aquí no hay red ni base: lo hacen los puertos, y las pruebas los cambian por
// dobles (tests/conta/e05/releer.test.ts).
//
//   1. Las facturas del lote que siguen en revisión, con PDF: se baja cada PDF,
//      se saca su texto por posición y se comprueba contra lo que dijo el Excel
//      (guardado en su lectura al subir: número, fecha, importes, NIF, pedidos
//      y periodo). Las ya decididas no se releen: la base no las tocaría.
//   2. Se guarda (conta_lote_relectura_guardar): las comprobaciones pdf_* y la
//      confianza al leer.
//   3. Se vuelve a cruzar, como «Volver a comprobar» (conta_lote_cruce_guardar,
//      que rehace lo abierto y respeta lo que ya decidió una persona).

import { comprobarPdf } from './catcherPdf.ts'
import { cruzar, type Cruce, type PedidoApp, type Tarifa } from './catcherCruces.ts'
import type { Comprobacion, FacturaExcel, PedidoExcel, TipoFactura } from './catcherTipos.ts'

/** Una factura del lote tal como está en la base (supplier_invoice). */
export interface FacturaGuardada {
  id: string
  numero: string
  estado: string
  ruta: string | null
  base: number
  total: number
  lectura: LecturaGuardada | null
}

/** Lo que guardó conta_lote_registrar al subir (supplier_invoice.reading), lo que hace falta aquí. */
export interface LecturaGuardada {
  factura?: { numero?: string; fecha?: string | null; base?: number; cuota?: number; total?: number; proveedor?: { nombre?: string | null; nif?: string | null } }
  lote?: { tipo?: string; pedidos?: number | null; periodo?: { desde?: string | null; hasta?: string | null } }
  confianza?: string
}

export interface Lote { id: string; desde: string; hasta: string; total: number | null }

export interface PuertoReleer {
  lote(): Promise<Lote>
  facturas(): Promise<FacturaGuardada[]>
  /** El texto del PDF, por posición, página a página. */
  texto(ruta: string): Promise<{ texto: string; sha256: string }>
  guardarLecturas(l: { factura: string; contraPdf: Comprobacion[]; sha256: string }[]): Promise<{ releidas: number; seguras: number; sin_tocar: number }>
  pedidos(): Promise<PedidoExcel[]>
  app(): Promise<PedidoApp[]>
  tarifas(): Promise<Tarifa[]>
  guardarCruce(c: Cruce): Promise<{ texto: string }>
}

export interface Releido { releidas: number; seguras: number; sinTocar: number; sinPdf: number; fallidas: { numero: string; motivo: string }[]; cruce: string }

/** Lo que el Excel dijo de una factura, de su lectura guardada al subir (conta_lote_registrar). */
export function excelDeLaLectura(f: FacturaGuardada): FacturaExcel {
  const fa = f.lectura?.factura ?? {}
  const lo = f.lectura?.lote ?? {}
  return {
    numero: String(fa.numero ?? f.numero),
    base: Number(fa.base), cuota: Number(fa.cuota), total: Number(fa.total),
    emisor: { nombre: String(fa.proveedor?.nombre ?? ''), nif: fa.proveedor?.nif ?? null, domicilio: null },
    destinatario: { nombre: '', nif: null, domicilio: null },
    pedidos: lo.pedidos == null ? null : Number(lo.pedidos),
    desde: lo.periodo?.desde ?? null, hasta: lo.periodo?.hasta ?? null,
    fecha: fa.fecha ?? null,
  }
}

const motivo = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200)

export async function releerLote(p: PuertoReleer): Promise<Releido> {
  const [lote, todas] = await Promise.all([p.lote(), p.facturas()])
  const enRevision = todas.filter((f) => f.estado === 'en_revision')
  const sinPdf = enRevision.filter((f) => !f.ruta).length
  const lecturas: { factura: string; contraPdf: Comprobacion[]; sha256: string }[] = []
  const fallidas: Releido['fallidas'] = []
  for (const f of enRevision.filter((x) => x.ruta)) {
    try {
      const { texto, sha256 } = await p.texto(f.ruta!)
      lecturas.push({ factura: f.id, contraPdf: comprobarPdf(excelDeLaLectura(f), texto), sha256 })
    } catch (e) {
      fallidas.push({ numero: f.numero, motivo: motivo(e) })
    }
  }
  const g = lecturas.length ? await p.guardarLecturas(lecturas) : { releidas: 0, seguras: 0, sin_tocar: 0 }

  // El cruce, con las facturas como han quedado.
  const [ahora, pedidos, app, tarifas] = await Promise.all([p.facturas(), p.pedidos(), p.app(), p.tarifas()])
  const cruce = cruzar({
    facturas: ahora.map((f) => ({
      numero: f.numero, tipo: (f.lectura?.lote?.tipo ?? 'rider') as TipoFactura, base: Number(f.base), total: Number(f.total),
      seguraAlLeer: f.lectura?.confianza === 'seguro',
    })),
    pedidos, app, tarifas, periodo: { desde: lote.desde, hasta: lote.hasta }, totalLote: lote.total,
  })
  const r = await p.guardarCruce(cruce)
  return { releidas: g.releidas, seguras: g.seguras, sinTocar: todas.length - enRevision.length, sinPdf, fallidas, cruce: r.texto }
}

/** «Releídas 83 facturas: 70 cuadran con su PDF… Cruzada la …». */
export function textoReleido(r: Releido): string {
  const partes = [`Releídos los PDF de ${r.releidas} ${r.releidas === 1 ? 'factura' : 'facturas'}: ${r.seguras} ${r.seguras === 1 ? 'dice' : 'dicen'} lo mismo que el Excel.`]
  if (r.sinTocar) partes.push(`${r.sinTocar} ya ${r.sinTocar === 1 ? 'estaba decidida' : 'estaban decididas'} y no se ${r.sinTocar === 1 ? 'ha tocado' : 'han tocado'}.`)
  if (r.sinPdf) partes.push(`${r.sinPdf} sin PDF guardado.`)
  if (r.fallidas.length) partes.push(`${r.fallidas.length} no se ${r.fallidas.length === 1 ? 'ha podido' : 'han podido'} leer: ${r.fallidas.map((f) => `${f.numero} (${f.motivo})`).join('; ')}.`)
  if (r.cruce) partes.push(r.cruce)
  return partes.join(' ')
}
