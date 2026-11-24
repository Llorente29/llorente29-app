// src/modules/conta/services/decisionesQboService.ts
//
// Q08 · Paso 2 · «Cargar decisiones de QBO»: lee en el navegador el Excel que
// sube Julio (nunca pasa por el repositorio, T11), entiende cada fila
// (gestoria/decisionesQbo.ts) y la escribe con las dos funciones de la 1220:
// conta_gc_enlace_decision_externa (atar, con «QBO, Excel del 12/11» como quien
// lo decidió) y conta_gc_enlace_pendiente_externo (lo que no se entiende, con
// su texto). Lo que ya decidió una persona no se pisa (lo dice la base).
//
// Nombres de la base entre comillas (regla 40), comprobados el 24/11:
// conta_gc_cliente (company_id, gc_id, account_id, nombre, correo),
// conta_gestoria_cliente (account_id, bitrix_id único por cuenta, party_id →
// party), party (id, name).

import * as XLSX from 'xlsx'
import { mensaje, rpc, tabla } from '@/modules/conta/services/bd'
import { ORIGEN_QBO, clienteGcDe, emisorDe, fichaPorNombre, filasDeLaHoja, resumen, type Linea } from '@/modules/conta/gestoria/decisionesQbo'

interface ClienteGc { companyId: string; gcId: string; nombre: string | null; correo: string | null }
interface Ficha { partyId: string; bitrixId: string | null; nombre: string }

async function todas<T>(leer: (desde: number, hasta: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>, que: string): Promise<T[]> {
  const fuera: T[] = []
  for (let a = 0; ; a += 1000) {
    const { data, error } = await leer(a, a + 999)
    if (error) throw new Error(mensaje(`No se han podido leer ${que}`, error))
    const filas = (data ?? []) as T[]
    fuera.push(...filas)
    if (filas.length < 1000) return fuera
  }
}

/** Carga el Excel de QBO: devuelve el resumen (regla 8) y, fila a fila, qué ha pasado. */
export async function cargarDecisionesQbo(accountId: string, empresas: readonly { id: string; nombre: string }[], fichero: File): Promise<{ frase: string; lineas: Linea[] }> {
  const libro = XLSX.read(new Uint8Array(await fichero.arrayBuffer()), { type: 'array' })
  const hoja = libro.Sheets['Para atar']
  if (!hoja) throw new Error('El Excel no tiene la hoja «Para atar»: ¿es el «Atar clientes GoCardless» contestado por QBO?')
  const filas = filasDeLaHoja(XLSX.utils.sheet_to_json<unknown[]>(hoja, { header: 1, raw: false, defval: '' }))

  const clientes = (await todas<{ company_id: string; gc_id: string; nombre: string | null; correo: string | null }>(
    (a, b) => tabla('conta_gc_cliente').select('company_id, gc_id, nombre, correo').eq('account_id', accountId).order('gc_id').range(a, b), 'los clientes de GoCardless'))
    .map((c): ClienteGc => ({ companyId: c.company_id, gcId: c.gc_id, nombre: c.nombre, correo: c.correo }))
  const fichas = (await todas<{ party_id: string; bitrix_id: string | null; party: { name: string } | null }>(
    (a, b) => tabla('conta_gestoria_cliente').select('party_id, bitrix_id, party(name)').eq('account_id', accountId).order('party_id').range(a, b), 'las fichas'))
    .map((f): Ficha => ({ partyId: f.party_id, bitrixId: f.bitrix_id, nombre: f.party?.name ?? '' }))

  const lineas: Linea[] = []
  for (const f of filas) {
    const base = { fila: f.fila, emisor: f.emisor, cliente: f.cliente }
    if (f.intencion.que === 'solo') { lineas.push({ ...base, resultado: 'solo', frase: 'Se ata solo: no se toca.' }); continue }
    const emisor = emisorDe(f.emisor, empresas)
    const gc = emisor ? clienteGcDe(f, clientes.filter((c) => c.companyId === emisor.id)) : null
    if (!emisor || !gc) {
      lineas.push({ ...base, resultado: 'sin_cliente', frase: emisor ? 'No está en lo leído de GoCardless (ni por su nombre ni por su correo).' : `No sé qué empresa es «${f.emisor}».` })
      continue
    }
    try {
      let party: Ficha | null = null
      let pendiente: string | null = null
      if (f.intencion.que === 'por_numero') {
        const n = f.intencion.bitrixId
        party = fichas.find((x) => x.bitrixId === n) ?? null
        if (!party) pendiente = `${f.decision} (la ficha nº ${n} no está en lo leído de Bitrix24)`
      } else if (f.intencion.que === 'por_nombre') {
        party = fichaPorNombre(f.intencion.nombre, fichas)
        if (!party) pendiente = f.decision
      } else {
        pendiente = f.intencion.texto
      }
      if (party) {
        const r = await rpc<{ frase: string }>('conta_gc_enlace_decision_externa', { p_company: emisor.id, p_gc_cliente: gc.gcId, p_party: party.partyId, p_origen: ORIGEN_QBO })
        lineas.push({ ...base, resultado: 'atado', frase: r.frase })
      } else {
        const r = await rpc<{ frase: string; sin_cambios?: boolean }>('conta_gc_enlace_pendiente_externo', { p_company: emisor.id, p_gc_cliente: gc.gcId, p_texto: pendiente, p_origen: ORIGEN_QBO })
        lineas.push({ ...base, resultado: r.sin_cambios ? 'solo' : 'pendiente', frase: r.frase })
      }
    } catch (e) {
      lineas.push({ ...base, resultado: 'error', frase: e instanceof Error ? e.message : String(e) })
    }
  }
  return { frase: resumen(lineas), lineas }
}
