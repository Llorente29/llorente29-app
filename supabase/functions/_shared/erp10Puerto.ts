// supabase/functions/_shared/erp10Puerto.ts
//
// X10f (20/11) · Los puertos de verdad del envío a ERP10 (la base y el cliente de ERP10), los mismos
// para el botón (conta-erp10-escribir) y para la cola (conta-erp10-cola). Solo cambia «cómo»: el
// botón apunta «a_mano» y con la sesión de quien pulsa; la cola, «sola» y con la clave de servicio.

import { clienteErp10 } from './erp10Despacho.ts'
import { carpetaDe, type BaseCruda } from './erp10DesdeLaBase.ts'
import type { Envio, PuertoEscribir } from './erp10Escribir.ts'
import type { PuertoApuntar } from './erp10Sacar.ts'

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

const hoyMadrid = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date())

/** Lo que sale ese mes, DESDE LA BASE: las cinco funciones de la pantalla y la carpeta de los PDF. */
export async function leerLaBase(db: Db, companyId: string, mes: string): Promise<BaseCruda> {
  const leer = async (fn: string) => {
    const { data, error } = await db.rpc(fn, { p_company: companyId, p_mes: mes })
    if (error) throw new Error(`no se ha podido leer lo que sale (${fn}): ${error.message}`)
    return (data ?? {}) as Record<string, unknown>
  }
  const { data: sal } = await db.from('conta_erp10_salida_empresa').select('carpeta_pdf, codigo_erp10').eq('company_id', companyId).maybeSingle()
  // R16 · Y el libro de IVA de cada día del TPV (conta_erp10_dias_tpv_libro, de la 20261122T0810): un día repartido no sale por
  // la conexión como una sola factura (Julio, 22/11).
  const [porSalir, recibidas, emitidas, asientos, dias, libroDias] = await Promise.all([
    leer('conta_erp10_por_salir'), leer('conta_erp10_recibidas_por_salir'), leer('conta_erp10_emitidas_por_salir'),
    leer('conta_erp10_asientos_por_salir'), leer('conta_erp10_dias_tpv_por_salir'), leer('conta_erp10_dias_tpv_libro'),
  ])
  return { porSalir, recibidas, emitidas, asientos, dias, libroDias, carpeta: carpetaDe(sal?.carpeta_pdf ?? null, sal?.codigo_erp10 ?? null) }
}

/**
 * El puerto del servidor para una empresa: su cliente de ERP10 (null si ya no está conectada), el envío
 * en conta_erp10_envio (con «como») y el lote en la salida de Sumied (con `apuntaCon`: la sesión de quien
 * pulsa, o el servidor en la cola).
 */
export async function puertosDelServidor(srv: Db, o: { accountId: string; companyId: string; quien: string | null; como: 'sola' | 'a_mano'; apuntaCon: Db }):
  Promise<((mes: string) => PuertoEscribir & PuertoApuntar) | null> {
  const c = await clienteErp10(srv, o.accountId, o.companyId, { escribir: true })
  if (!c) return null
  return (mes) => ({
    hoy: hoyMadrid(),
    tomar: async (entryId, clase) => {
      const { data, error } = await srv.rpc('conta_erp10_envio_tomar', { p_company: o.companyId, p_entry: entryId, p_clase: clase, p_quien_nombre: o.quien })
      if (error) throw new Error(`no se ha podido coger el asiento: ${error.message}`)
      return data as { tomado: boolean; envio: Envio }
    },
    poner: async (id, cambios) => {
      const { error } = await srv.from('conta_erp10_envio').update({ como: o.como, ...cambios, cambiado_en: new Date().toISOString() }).eq('id', id).eq('account_id', o.accountId)
      if (error) throw new Error(`no se ha podido apuntar lo que ha pasado: ${error.message}`)
    },
    pdf: async (ruta) => {
      const { data, error } = await srv.storage.from('conta-documentos').download(ruta)
      if (error || !data) throw new Error(`no se ha podido leer el PDF guardado: ${error?.message ?? 'vacío'}`)
      return new Uint8Array(await data.arrayBuffer())
    },
    erp10: {
      tieneSubcuenta: (k) => c.cliente.tieneSubcuenta(k),
      crearSubcuenta: (sc) => c.cliente.crearSubcuenta(sc),
      facturasDelMes: (m) => c.cliente.facturasDelMes(m),
      altaFactura: (fd) => c.cliente.altaFactura(fd),
      subirDocumento: (d) => c.cliente.subirDocumento(d),
      apuntesDelMes: (m) => c.cliente.apuntesDelMes(m),
      altaApunte: (ap) => c.cliente.altaApunte(ap),
    },
    // Los números de ERP10 que ya son de otro asiento de Sumied (y el cobro de un día de un solo asiento): un asiento no se enlaza a su gemelo.
    usados: async (entryId) => {
      const { data } = await srv.from('conta_erp10_envio').select('erp10_serie, erp10_documento, cobro_serie, cobro_documento').eq('company_id', o.companyId).eq('account_id', o.accountId)
        .eq('estado', 'en_erp10').neq('entry_id', entryId)
      type U = { erp10_serie: string | null; erp10_documento: number | null; cobro_serie: string | null; cobro_documento: number | null }
      return new Set(((data ?? []) as U[]).flatMap((x) => [`${x.erp10_serie ?? ''}/${x.erp10_documento ?? ''}`, ...(x.cobro_documento ? [`${x.cobro_serie ?? ''}/${x.cobro_documento}`] : [])]))
    },
    apuntar: async (partidas, huellaLote) => {
      const { data, error } = await o.apuntaCon.rpc('conta_erp10_lote_apuntar', {
        p_company: o.companyId, p_mes: mes, p_partidas: partidas, p_quien_nombre: o.quien,
        p_ficheros: [{ nombre: o.como === 'sola' ? 'ERP10 (salida sola)' : 'ERP10 (por la conexión)', filas: partidas.length, huella: huellaLote }],
      })
      if (error) return { error: String(error.message) }
      return { lote: String((data as { lote: string }).lote) }
    },
    apuntado: async (lote, r) => {
      await srv.from('conta_erp10_salida_partida').update({ erp10_serie: r.serie ?? null, erp10_documento: r.documento ?? null })
        .eq('lote_id', lote).eq('entry_id', r.entryId).eq('account_id', o.accountId)
      await srv.from('conta_erp10_envio').update({ lote_id: lote, cambiado_en: new Date().toISOString() }).eq('entry_id', r.entryId).eq('account_id', o.accountId)
    },
  })
}
