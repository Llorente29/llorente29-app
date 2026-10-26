// src/modules/conta/services/liquidacionesMotorService.ts
//
// V02 · El motor de liquidaciones, para Ventas › Liquidaciones (tableros 28 y
// 29). Solo llama a las funciones de la base de la tanda del V02 E2 (nombres
// comprobados contra las migraciones 2253, 2254 y 0125: regla 40) y a los
// lectores puros:
//   · leer: conta_liquidaciones;
//   · registrar lo leído (el informe de Uber, Glovo, Just Eat): conta_liquidacion_registrar;
//   · «Apuntar a mano»: conta_liquidacion_apuntar;
//   · confirmar un cambio de tienda: conta_tienda_cambio_decidir;
//   · resolver una diferencia en una frase: conta_liquidacion_resolver_tienda (con su marca, 0125);
//   · lo reclamado ha llegado: conta_reclamacion_llegada;
//   · quien te paga, con su ritmo: party_role (id, party_id, channel_id,
//     settlement_every, payout_days_after) y party (id, name), de la C03;
//   · dar de alta a quien te paga: conta_intermediario_asegurar (2253).
// Cada acción devuelve la frase que dice lo que ha hecho (regla 8).

import * as XLSX from 'xlsx'
import { mensaje, rpc, tabla } from '@/modules/conta/services/bd'
import { cargarContexto } from '@/modules/conta/services/propuestasLibroService'
import { asientoDeGasto } from '@/modules/conta/lib/liquidacionesPlataforma'
import type { Periodo } from '@/modules/conta/lib/plazoPlataforma'
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

/**
 * Resolver una diferencia en una frase: «Lo reclamo» (se recuerda hasta que
 * llegue) o «Es un gasto», con su asiento (la 629 contra la 430 de quien te
 * paga, en el local de la fila), como el V01. Solo es un gasto lo que te pagan
 * de menos. La base lo valida y lo dice (regla 8).
 */
export async function resolverDiferencia(accountId: string, companyId: string, f: Pick<FilaMotor, 'intermediarioId' | 'intermediario' | 'localId' | 'marcaId' | 'desde' | 'hasta'>,
  partyId: string | null, x: { tipo: 'gasto' | 'reclamacion'; importe: number; frase: string }, quien: string | null): Promise<string> {
  if (!f.intermediarioId) throw new Error('Esta fila no sabe quién te paga: no se puede resolver.')
  const frase = x.frase.trim()
  if (!frase) throw new Error('Escribe en una frase por qué.')
  let lineas: unknown = null
  if (x.tipo === 'gasto') {
    if (!partyId) throw new Error(`${f.intermediario} no está en Contactos: no se le puede poner el gasto.`)
    const ctx = await cargarContexto(accountId, companyId)
    const cliente430 = ctx.enlace('customer', partyId, 'principal')
    if (!cliente430) throw new Error(`${f.intermediario} no tiene su cuenta de cliente (430): ponla en Contactos.`)
    const gasto = ctx.hoja('629')
    if (!gasto) throw new Error('Falta en tu plan una cuenta de otros servicios (629) para el gasto.')
    lineas = asientoDeGasto(x.importe, { gasto, cliente430 }, { localId: f.localId, terceroId: partyId, concepto: `Diferencia de ${f.intermediario}: ${frase}` })
    if (!lineas) throw new Error('Solo es un gasto lo que te pagan de menos.')
  }
  const r = await rpc<{ texto: string }>('conta_liquidacion_resolver_tienda', {
    p_company: companyId, p_intermediario: f.intermediarioId, p_local: f.localId, p_marca: f.marcaId, p_desde: f.desde, p_hasta: f.hasta,
    p_tipo: x.tipo, p_importe: Math.round(x.importe * 100) / 100, p_frase: frase, p_fecha: null, p_lineas: lineas, p_quien_nombre: quien,
  })
  return r.texto
}

/** Quien te paga, con su ritmo (party_role «platform» y su contacto): para «Cuándo te pagan» y «Apuntar a mano». */
export interface Intermediario { id: string; partyId: string; nombre: string; canalId: string | null; cada: Periodo | null; dias: number | null }

export async function leerIntermediarios(accountId: string): Promise<Intermediario[]> {
  const { data: roles, error } = await tabla('party_role').select('id, party_id, channel_id, settlement_every, payout_days_after')
    .eq('account_id', accountId).eq('role', 'platform')
  if (error) throw new Error(mensaje('No se han podido leer quienes te pagan', error))
  const ids = [...new Set((roles ?? []).map((r: Record<string, unknown>) => String(r.party_id)))]
  const nombres = new Map<string, string>()
  if (ids.length) {
    const { data: ps, error: e2 } = await tabla('party').select('id, name').eq('account_id', accountId).in('id', ids)
    if (e2) throw new Error(mensaje('No se han podido leer quienes te pagan', e2))
    for (const p of (ps ?? []) as Record<string, unknown>[]) nombres.set(String(p.id), String(p.name))
  }
  return ((roles ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id), partyId: String(r.party_id), nombre: nombres.get(String(r.party_id)) ?? 'Intermediario',
    canalId: r.channel_id ? String(r.channel_id) : null,
    cada: (['weekly', 'fortnightly', 'monthly'] as const).find((c) => c === r.settlement_every) ?? null,
    dias: r.payout_days_after === null || r.payout_days_after === undefined ? null : Number(r.payout_days_after),
  })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
}

/** Alguien que te paga y aún no está (Amazon, Stripe, PayPal, el datáfono…): de alta con su nombre, para apuntarle la liquidación. */
export async function darDeAltaIntermediario(companyId: string, nombre: string, quien: string | null): Promise<string> {
  const n = nombre.trim()
  if (!n) throw new Error('Di quién te paga.')
  return rpc<string>('conta_intermediario_asegurar', { p_company: companyId, p_provider: n, p_canal: null, p_nombre: n, p_nif: null, p_quien_nombre: quien })
}

/** Lo reclamado ha llegado. */
export async function reclamacionLlegada(resolucionId: string, fecha: string, importe: number | null, nota: string | null, quien: string | null): Promise<string> {
  const r = await rpc<{ texto: string }>('conta_reclamacion_llegada', { p_resolucion: resolucionId, p_fecha: fecha, p_importe: importe, p_nota: nota, p_quien_nombre: quien })
  return r.texto
}

/** Los locales de la cuenta (locations: id, name, active), para «Apuntar a mano». */
export async function leerLocales(accountId: string): Promise<{ id: string; nombre: string; abierto: boolean }[]> {
  const { data, error } = await tabla('locations').select('id, name, active').eq('account_id', accountId).order('name')
  if (error) throw new Error(mensaje('No se han podido leer tus locales', error))
  return ((data ?? []) as Record<string, unknown>[]).map((l) => ({ id: String(l.id), nombre: String(l.name), abierto: l.active !== false }))
}
