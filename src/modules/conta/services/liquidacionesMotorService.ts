// src/modules/conta/services/liquidacionesMotorService.ts
//
// V02 · Entrega 2 · El motor de liquidaciones, para quien lo use (las pantallas
// llegarán con los tableros 20 y 21 nuevos). Solo llama a las funciones de la
// base de la tanda del V02 E2 (nombres comprobados contra la migración 2253 y
// 2254: regla 40) y a los lectores puros:
//   · leer: conta_liquidaciones;
//   · registrar lo leído (el informe de Uber, Glovo, Just Eat): conta_liquidacion_registrar;
//   · «Apuntar a mano»: conta_liquidacion_apuntar;
//   · confirmar un cambio de tienda: conta_tienda_cambio_decidir;
//   · resolver una diferencia en una frase: conta_liquidacion_resolver;
//   · lo reclamado ha llegado: conta_reclamacion_llegada.
// Cada acción devuelve la frase que dice lo que ha hecho (regla 8).

import * as XLSX from 'xlsx'
import { rpc } from '@/modules/conta/services/bd'
import { filaMotor, type FilaMotor } from '@/modules/conta/lib/liquidacionesMotor'
import { esInformeUber, leerInformeUber, paraRegistrarInforme, type DatosRegistrar } from '@/modules/conta/lib/lectorUberPagos'
import { esExcelGlovo, leerExcelGlovo, leerPdfGlovo, paraRegistrarGlovo, type ExcelGlovo, type PdfGlovo } from '@/modules/conta/lib/lectorGlovo'
import { textoDePaginas, type PiezaPdf } from '@/modules/conta/lib/textoPdf'
import { pdfjs } from '@/modules/conta/plan/leerFicheros'

/** Las filas del motor de la empresa entre dos fechas (por defecto, los últimos tres meses hasta hoy). */
export async function leerLiquidacionesMotor(companyId: string, desde?: string | null, hasta?: string | null): Promise<FilaMotor[]> {
  const r = await rpc<Record<string, unknown>[] | null>('conta_liquidaciones', { p_company: companyId, p_desde: desde ?? null, p_hasta: hasta ?? null })
  return (r ?? []).map(filaMotor)
}

/** Lo que ha pasado con cada liquidación leída. */
export interface Registrada { tienda: string | null; desde: string; hasta: string; texto: string; yaEstaba: boolean; liquidacionId: string }

/** Registra, una a una, las liquidaciones leídas de un documento. */
export async function registrarLeidas(companyId: string, datos: readonly DatosRegistrar[], quien: string | null): Promise<Registrada[]> {
  const out: Registrada[] = []
  for (const d of datos) {
    const r = await rpc<{ liquidacion_id: string; ya_estaba: boolean; texto: string }>('conta_liquidacion_registrar', { p_company: companyId, p: d, p_quien_nombre: quien })
    out.push({ tienda: d.tienda, desde: d.desde, hasta: d.hasta, texto: r.texto, yaEstaba: r.ya_estaba, liquidacionId: r.liquidacion_id })
  }
  return out
}

/** Las piezas de texto de un PDF, página a página (pdfjs, en el navegador). */
async function textoPdf(bytes: Uint8Array): Promise<string> {
  // El tipo de pdfjs de leerFicheros solo declara lo que usa el plan contable; aquí, el texto.
  type Pagina = { getTextContent: () => Promise<{ items: unknown[] }> }
  type Documento = { numPages: number; getPage: (n: number) => Promise<Pagina> }
  const lib = (await pdfjs()) as unknown as { getDocument: (x: { data: Uint8Array }) => { promise: Promise<Documento> } }
  const doc = await lib.getDocument({ data: bytes }).promise
  const paginas: PiezaPdf[][] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const c = await (await doc.getPage(i)).getTextContent()
    paginas.push((c.items as { str?: string; transform?: number[]; width?: number }[])
      .filter((it) => typeof it.str === 'string' && it.transform)
      .map((it) => ({ str: it.str!, x: it.transform![4], y: it.transform![5], w: it.width ?? 0 })))
  }
  return textoDePaginas(paginas)
}

/**
 * Lee uno o varios ficheros de una liquidación y dice qué son: el informe
 * «Detalles del pago» de Uber (CSV), el Excel y el PDF de Glovo (juntos si son
 * del mismo número). Lo que no reconoce, lo dice.
 */
export async function leerFicherosLiquidacion(ficheros: readonly File[]): Promise<{ datos: DatosRegistrar[]; noReconocidos: string[] }> {
  const datos: DatosRegistrar[] = []
  const noReconocidos: string[] = []
  const excels: ExcelGlovo[] = []
  const pdfs: PdfGlovo[] = []
  for (const f of ficheros) {
    const nombre = f.name.toLowerCase()
    try {
      if (nombre.endsWith('.csv')) {
        const t = await f.text()
        if (esInformeUber(t)) { datos.push(...leerInformeUber(t).map(paraRegistrarInforme)); continue }
      } else if (/\.xlsx?$/.test(nombre)) {
        const wb = XLSX.read(new Uint8Array(await f.arrayBuffer()), { type: 'array', cellDates: true })
        const filas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null }) as Record<string, unknown>[]
        if (esExcelGlovo(filas)) { excels.push(...leerExcelGlovo(filas)); continue }
      } else if (nombre.endsWith('.pdf')) {
        const t = await textoPdf(new Uint8Array(await f.arrayBuffer()))
        if (/glovoapp/i.test(t) && /Ingreso a cuenta colaborador/i.test(t)) { pdfs.push(leerPdfGlovo(t)); continue }
      }
      noReconocidos.push(f.name)
    } catch (e) {
      noReconocidos.push(`${f.name} (${(e as Error).message})`)
    }
  }
  // Glovo: el Excel y el PDF del mismo número van juntos.
  const numeros = new Set([...excels.map((x) => x.numero), ...pdfs.map((x) => x.numero)])
  for (const num of numeros) datos.push(paraRegistrarGlovo({ excel: excels.find((x) => x.numero === num) ?? null, pdf: pdfs.find((x) => x.numero === num) ?? null }))
  return { datos, noReconocidos }
}

/** «Apuntar a mano»: periodo, lo vendido, la comisión y lo cobrado. */
export async function apuntarLiquidacion(companyId: string, a: {
  intermediarioId: string; localId: string | null; desde: string; hasta: string; vendido: number; comision: number; cobrado: number
  pedidos?: number | null; referencia?: string | null; factura?: string | null; nota?: string | null
}, quien: string | null): Promise<{ liquidacionId: string; texto: string }> {
  const r = await rpc<{ liquidacion_id: string; texto: string }>('conta_liquidacion_apuntar', {
    p_company: companyId, p_quien_nombre: quien,
    p: { intermediario: a.intermediarioId, local: a.localId, desde: a.desde, hasta: a.hasta, vendido: a.vendido, comision: a.comision, cobrado: a.cobrado,
         pedidos: a.pedidos ?? null, referencia: a.referencia ?? null, factura: a.factura ?? null, nota: a.nota ?? null },
  })
  return { liquidacionId: r.liquidacion_id, texto: r.texto }
}

/** Confirmar (o descartar) con un clic que una tienda ha cambiado de nombre o de dirección. */
export async function decidirCambioTienda(cambioId: string, confirmar: boolean, x: { marcaId?: string | null; localId?: string | null; desde?: string | null }, quien: string | null): Promise<string> {
  const r = await rpc<{ texto: string }>('conta_tienda_cambio_decidir', {
    p_cambio: cambioId, p_confirmar: confirmar, p_marca: x.marcaId ?? null, p_local: x.localId ?? null, p_desde: x.desde ?? null, p_quien_nombre: quien,
  })
  return r.texto
}

/** Resolver una diferencia en una frase: «Es un gasto» (con su asiento) o «Lo reclamo». */
export async function resolverDiferencia(companyId: string, f: Pick<FilaMotor, 'intermediarioId' | 'localId' | 'desde' | 'hasta'>, x: {
  tipo: 'gasto' | 'reclamacion'; importe: number; frase: string; fecha?: string | null; lineas?: unknown[] | null
}, quien: string | null): Promise<string> {
  if (!f.intermediarioId) throw new Error('Esta fila no sabe quién te paga: no se puede resolver.')
  const r = await rpc<{ texto: string }>('conta_liquidacion_resolver', {
    p_company: companyId, p_intermediario: f.intermediarioId, p_local: f.localId, p_desde: f.desde, p_hasta: f.hasta,
    p_tipo: x.tipo, p_importe: x.importe, p_frase: x.frase, p_fecha: x.fecha ?? null, p_lineas: x.lineas ?? null, p_quien_nombre: quien,
  })
  return r.texto
}

/** Lo reclamado ha llegado. */
export async function reclamacionLlegada(resolucionId: string, fecha: string, importe: number | null, nota: string | null, quien: string | null): Promise<string> {
  const r = await rpc<{ texto: string }>('conta_reclamacion_llegada', { p_resolucion: resolucionId, p_fecha: fecha, p_importe: importe, p_nota: nota, p_quien_nombre: quien })
  return r.texto
}
