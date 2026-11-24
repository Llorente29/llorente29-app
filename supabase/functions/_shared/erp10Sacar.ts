// supabase/functions/_shared/erp10Sacar.ts
//
// X10f (20/11) · LA MISMA PIEZA PARA EL BOTÓN Y PARA LA COLA. Lo que hacía conta-erp10-escribir
// después de leer la base, aquí, para que conta-erp10-cola (lo validado que sale solo) haga
// exactamente lo mismo:
//   · sacarYApuntar: cada uno de lo que sale (sacarUno: la recibida, la emitida, el asiento o el día
//     del TPV), en orden, y si uno falla los demás siguen; lo que ha entrado (o ya estaba sin apuntar)
//     se apunta en la salida de Sumied en un lote, con la huella de su fila (la misma que el Excel), y el
//     número de ERP10 va a su partida y a su envío;
//   · pasadaDeLaCola: lo que le toca salir solo (conta_erp10_cola, en el orden en que se validó),
//     por empresa y mes, con sacarYApuntar. Lo que no puede salir por la conexión (lleva retención, no
//     cabe su cuenta…) se queda parado con su porqué y no se vuelve a coger.
// Los dos, con puertos: sin red ni base aquí (las pruebas, con el ERP10 simulado).

import { loQueSaleDesdeLaBase, type BaseCruda } from './erp10DesdeLaBase.ts'
import { partidasDeLoQueSale, sacarUno, type PuertoEscribir, type Resultado } from './erp10Escribir.ts'

export type Partida = { entry_id: string; clase: 'recibida' | 'emitida' | 'asiento'; huella: string }

/** Cómo se apunta un lote en la salida de Sumied, y qué se hace con cada uno cuando ya está apuntado. */
export interface PuertoApuntar {
  apuntar(partidas: Partida[], huellaLote: string): Promise<{ lote: string } | { error: string }>
  apuntado(lote: string, r: Resultado): Promise<void>
}

const huellaDe = async (t: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)))].map((b) => b.toString(16).padStart(2, '0')).join('')

/**
 * Saca a ERP10 lo que sale (armado desde la base) y lo apunta. `tope`: si dice que no queda tiempo, lo
 * que falta vuelve en «quedan» (la siguiente llamada lo saca).
 */
export async function sacarYApuntar(base: Awaited<ReturnType<typeof loQueSaleDesdeLaBase>>, p: PuertoEscribir & PuertoApuntar, tope: () => boolean = () => false): Promise<{
  resultados: Resultado[]; quedan: string[]; sinApuntar: string | null
}> {
  const resultados: Resultado[] = base.noSalen.map((x) => ({ entryId: x.entryId, numero: '', estado: 'no_pudo' as const, porque: x.porque }))
  const quedan: string[] = []
  for (const x of base.salen) {
    if (tope()) { quedan.push(x.entryId); continue }
    // Si uno falla, los demás siguen: cada uno dice lo suyo. Un día puede dar dos (su factura y su cobro, si va aparte).
    resultados.push(...(await sacarUno(x, base.cuentasNuevas, p)))
  }
  // Lo que ha entrado (o ya estaba) y no está apuntado en la salida de Sumied: un lote, con la huella de su fila (de la base).
  const porApuntar = resultados.filter((r) => (r.estado === 'en_erp10' || r.estado === 'ya_estaba') && r.sinApuntar)
  let sinApuntar: string | null = null
  if (porApuntar.length) {
    const deLaBase = partidasDeLoQueSale(base.salen)
    const partidas = porApuntar.map((r) => ({ entry_id: r.entryId, clase: deLaBase.get(r.entryId)!.clase, huella: deLaBase.get(r.entryId)!.huella }))
    const l = await p.apuntar(partidas, await huellaDe(partidas.map((x) => x.huella).join('|')))
    if ('error' in l) {
      sinApuntar = `Están en ERP10, pero no se han apuntado en la salida de Sumied (${l.error}). Vuelve a pulsar: no se meten otra vez, solo se apuntan.`
    } else {
      for (const r of porApuntar) { await p.apuntado(l.lote, r); r.sinApuntar = false }
    }
  }
  return { resultados, quedan, sinApuntar }
}

// ── La cola ─────────────────────────────────────────────────────────────────────────

export type EnCola = { entry_id: string; account_id: string; company_id: string; entry_date: string }

/** Lo de una empresa para la cola: su base de un mes y sus puertos de ese mes (o null: ya no está conectada). */
export type EmpresaEnCola = { base(mes: string): Promise<BaseCruda>; puerto(mes: string): PuertoEscribir & PuertoApuntar }

export interface PuertoCola {
  pendientes(limite: number): Promise<EnCola[]>
  empresa(companyId: string, accountId: string): Promise<EmpresaEnCola | null>
}

export type Pasada = { cogidos: number; en_erp10: number; ya_estaban: number; no_pudo: number; parados: number; sin_conexion: number; para_la_siguiente: number; sin_apuntar: number }

/**
 * Una pasada de la cola: lo que le toca, agrupado por empresa y mes en el orden en que llegó (el de
 * validar), y cada grupo con sacarYApuntar. Lo que no puede salir por la conexión se deja parado con su
 * porqué. Un fallo de una empresa (su conexión, su base) no para a las demás.
 */
export async function pasadaDeLaCola(p: PuertoCola, o: { limite?: number; tope?: () => boolean; aviso?: (texto: string) => void } = {}): Promise<Pasada> {
  const tope = o.tope ?? (() => false)
  const r: Pasada = { cogidos: 0, en_erp10: 0, ya_estaban: 0, no_pudo: 0, parados: 0, sin_conexion: 0, para_la_siguiente: 0, sin_apuntar: 0 }
  const cola = await p.pendientes(o.limite ?? 20)
  r.cogidos = cola.length
  const grupos = new Map<string, { companyId: string; accountId: string; meses: Map<string, string[]> }>()
  for (const x of cola) {
    const g = grupos.get(x.company_id) ?? { companyId: x.company_id, accountId: x.account_id, meses: new Map() }
    const mes = `${x.entry_date.slice(0, 7)}-01`
    g.meses.set(mes, [...(g.meses.get(mes) ?? []), x.entry_id])
    grupos.set(x.company_id, g)
  }
  for (const g of grupos.values()) {
    try {
      const e = await p.empresa(g.companyId, g.accountId)
      if (!e) { r.sin_conexion += [...g.meses.values()].flat().length; continue }
      for (const [mes, ids] of g.meses) {
        if (tope()) { r.para_la_siguiente += ids.length; continue }
        const base = await loQueSaleDesdeLaBase(await e.base(mes), ids)
        const puerto = e.puerto(mes)
        // Lo que no puede salir por la conexión: parado con su porqué (y la cola no lo vuelve a coger).
        for (const x of base.noSalen) {
          if (!x.parado) continue
          const t = await puerto.tomar(x.entryId, x.parado)
          if (!t.tomado) continue
          await puerto.poner(t.envio.id, { estado: 'no_pudo', motivo: x.porque, como: 'excel' })
          r.parados++
        }
        const hecho = await sacarYApuntar({ ...base, noSalen: [] }, puerto, tope)
        r.en_erp10 += hecho.resultados.filter((x) => x.estado === 'en_erp10').length
        r.ya_estaban += hecho.resultados.filter((x) => x.estado === 'ya_estaba').length
        r.no_pudo += hecho.resultados.filter((x) => x.estado === 'no_pudo').length
        r.para_la_siguiente += hecho.quedan.length
        if (hecho.sinApuntar) { r.sin_apuntar++; o.aviso?.(hecho.sinApuntar) }
      }
    } catch (err) {
      // La conexión de esta empresa (un freno, las claves): sus envíos no se han cogido; la siguiente pasada lo intenta.
      r.sin_conexion += [...g.meses.values()].flat().length
      o.aviso?.(`${g.companyId}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return r
}
