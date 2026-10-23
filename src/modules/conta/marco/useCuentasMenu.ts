// src/modules/conta/marco/useCuentasMenu.ts
//
// El número de cada entrada del menú (repaso de compras, 10/10): lo que hay
// por mirar en ella. Cuenta lo mismo que enseña su pantalla, con la misma
// vara (regla 31).
//
// S02 · PR 3 («las cifras»): UNA fuente. Todo lo que espera una acción sale de
// conta_pendientes (la base lo cuenta una vez, con la regla de la pantalla a
// la que lleva), y de aquí lo leen la barra, las pestañas, el «Te toca hoy» y
// el «Pendiente de ti» del Inicio:
//   · compras: las filas de «Qué tienes que mirar» (compras_decidir).
//   · recibidas: las facturas recibidas para mirar, 12 meses (facturas_para_mirar).
//   · aclarar: las facturas recibidas por aclarar (facturas_por_aclarar): antes
//     no las contaba nadie, y esperan una acción («Aclarar»).
//   · libros: los asientos por validar, menos lo que se decide en su sitio y
//     menos lo que espera (asientos_por_validar).
//   · bancos: para confirmar + por aclarar + por validar, con sus tres partes
//     al lado (bancosConfirmar, bancosAclarar, bancosValidar) para que el chip
//     diga qué son.
//   · terceros (Clientes y proveedores): las cuentas 430 traídas sin revisar y
//     los acuerdos de cesión sin socio. Sigue contado AQUÍ: la regla hecha()
//     vive en el cliente (contrato del PR 3).
// Si conta_pendientes aún no está en esa base (staging antes de aplicar), se
// cuenta como hasta ahora y se dice en la consola (services/cifrasService).
// Es un aviso que interrumpe (el badge del menú, regla 7): cuenta lo que pide
// una decisión, y si no hay nada no se pinta.
//
// M01: si un número no se ha podido contar es null, no 0. El badge no se pinta
// igual, pero el «Te toca hoy» del Inicio no dice «al día» de lo que no sabe.
// Y no se cuenta hasta saber la empresa: sin ella, Libros y Bancos salían 0
// (e2e 375: «0 asientos para revisar» con 6 esperando). Lo contado es de una
// cuenta y una empresa: al cambiar de empresa no se enseña el de la otra.
//
// Se recuerda 30 s por cuenta y empresa; una pantalla que decide algo avisa
// con `refrescarCuentasMenu()` y el número cambia sin esperar.

import { useEffect, useState } from 'react'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { agruparAMirar } from '@/modules/conta/lib/compras'
import { hecha } from '@/modules/conta/lib/revision430'
import { tabla } from '@/modules/conta/services/bd'
import { cargarMirar } from '@/modules/conta/services/comprasService'
import { acuerdosSinSocio, listarTercerosBase } from '@/modules/conta/services/tercerosService'
import { cargarRevision430 } from '@/modules/conta/services/revision430Service'
import { leerEsperan } from '@/modules/conta/services/esperanService'
import { recibidasPorEstado } from '@/modules/conta/services/inicioService'
import { cuentaRecibidas } from '@/modules/conta/documentos/colaRecibidas'
import { leerPendientes } from '@/modules/conta/services/cifrasService'
import { cuentasDePendientes } from '@/modules/conta/lib/cifrasLibro'
import { hoyEnMadrid } from '@/modules/conta/lib/formato'
import { delLibroDiario, type AsientoDiario } from '@/modules/conta/lib/diario'

export type CuentasMenu = Partial<Record<string, number | null>>

/** El aviso de «vuelve a contar» (lo escuchan también los contadores de las pestañas). */
export const EVENTO_CUENTAS_MENU = 'folvy:conta:cuentas-menu'
const EVENTO = EVENTO_CUENTAS_MENU
const NADA: CuentasMenu = {}
const cache = new Map<string, { cuando: number; valor: Promise<CuentasMenu> }>()

/** Tras decidir algo en una pantalla: el menú vuelve a contar. */
export function refrescarCuentasMenu(): void {
  cache.clear()
  window.dispatchEvent(new Event(EVENTO))
}

const seguro = (p: Promise<number>): Promise<number | null> => p.catch((e: unknown) => { console.error('[menú] no se pudo contar', e); return null })

/** Clientes y proveedores: se cuenta en el cliente (la regla hecha() vive aquí). */
async function contarTerceros(accountId: string, companyId: string | null): Promise<number> {
  const acuerdos = (await acuerdosSinSocio(accountId)).length
  if (!companyId) return acuerdos
  const [rev, { terceros: ts }] = await Promise.all([cargarRevision430(accountId, companyId), listarTercerosBase(accountId)])
  const t430 = ts.map((t) => ({ id: t.id, nombre: t.nombre, nif: t.nif, papeles: t.papeles, supplierId: t.supplierId, archivado: !!t.archivadoEn, codigoProveedor: null }))
  return acuerdos + rev.cuentas.filter((c) => !hecha(c, t430)).length
}

async function contar(accountId: string, companyId: string | null): Promise<CuentasMenu> {
  const [pendientes, terceros, colas] = await Promise.all([
    companyId ? leerPendientes(companyId) : Promise.resolve(null),
    seguro(contarTerceros(accountId, companyId)),
    // D04: las facturas, de la MISMA lectura que la ficha cuenta su «1 de N» (colaRecibidas).
    companyId ? cuentaRecibidas(accountId, companyId, hoyEnMadrid()).catch((e: unknown) => { console.error('[menú] no se pudo contar', e); return null }) : Promise.resolve(null),
  ])
  const base = pendientes ? cuentasDePendientes(pendientes) : await contarComoHoy(accountId, companyId)
  return { ...base, ...(colas ? { recibidas: colas.porRevisar, aclarar: colas.porAclarar } : {}), terceros }
}

/**
 * La cuenta de antes de conta_pendientes, para la base que aún no la tiene.
 * Con dos arreglos que no esperan a la tanda: las facturas por aclarar
 * también cuentan (de la misma lectura que las para mirar), y Bancos filtra
 * por cuenta Y empresa (regla 9).
 */
async function contarComoHoy(accountId: string, companyId: string | null): Promise<CuentasMenu> {
  const recibidas = companyId
    ? recibidasPorEstado(companyId, hoyEnMadrid()).catch((e: unknown) => { console.error('[menú] no se pudo contar', e); return null })
    : Promise.resolve({ paraMirar: 0, porAclarar: 0 })
  const [compras, libros, bancos, r] = await Promise.all([
    seguro(cargarMirar(accountId).then((m) => agruparAMirar(m).length)),
    // M01 («Esperan», Julio, 16/10): lo propuesto que la validación pararía no
    // es una tarea; no cuenta. La regla la dice la base (conta_esperan). Si aún
    // no se puede leer (la función no está en esa base), cuenta todo lo
    // propuesto, como antes, y lo dice en la consola.
    // S02 · PR 2: la misma vara que la lista «Para revisar» de Asientos
    // (paraRevisar): también los borradores, y fuera lo que tiene su sitio en
    // otro apartado (delLibroDiario).
    seguro(companyId
      ? (async () => {
          const { data, error } = await tabla('journal_entry').select('id, status, source_type')
            .eq('account_id', accountId).eq('company_id', companyId).in('status', ['propuesto', 'borrador'])
          if (error) throw new Error(error.message)
          const filas = ((data ?? []) as { id: string; status: string; source_type: string }[])
            .map((f) => ({ id: f.id, estado: f.status as AsientoDiario['estado'], origen: f.source_type as AsientoDiario['origen'] }))
          const ids = delLibroDiario(filas).map((f) => f.id)
          if (ids.length === 0) return 0
          const esperan = await leerEsperan(companyId).catch((e: unknown) => { console.warn('[menú] no se pudo leer lo que espera', e); return null })
          return esperan ? ids.filter((id) => !esperan.has(id)).length : ids.length
        })()
      : Promise.resolve(0)),
    // S02 · PR 2: y lo casado cuyo asiento espera en «Por validar» (la misma vara que leerDatosBancos).
    seguro(companyId
      ? Promise.all([
          tabla('bank_movement').select('id', { count: 'exact', head: true }).eq('account_id', accountId).eq('company_id', companyId).in('status', ['propuesto', 'por_aclarar', 'posible_repetido']),
          tabla('bank_movement').select('id, bank_match!inner(status, journal_entry!inner(status))', { count: 'exact', head: true })
            .eq('account_id', accountId).eq('company_id', companyId).eq('status', 'casado').eq('bank_match.status', 'vivo').eq('bank_match.journal_entry.status', 'propuesto'),
        ]).then((rs: { count: number | null; error: { message: string } | null }[]) => rs.reduce((t, { count, error }) => { if (error) throw new Error(error.message); return t + (count ?? 0) }, 0))
      : Promise.resolve(0)),
    recibidas,
  ])
  return { compras, libros, bancos, recibidas: r ? r.paraMirar : null, aclarar: r ? r.porAclarar : null }
}

export function useCuentasMenu(): CuentasMenu {
  const { accountId } = useCuentaConta()
  const { activa, cargando } = useEmpresas()
  const [cuentas, setCuentas] = useState<{ clave: string; valor: CuentasMenu } | null>(null)
  const clave = accountId && !cargando ? `${accountId}|${activa?.id ?? ''}` : null
  const [vuelta, setVuelta] = useState(0)
  useEffect(() => {
    const f = () => setVuelta((v) => v + 1)
    window.addEventListener(EVENTO, f)
    return () => window.removeEventListener(EVENTO, f)
  }, [])
  useEffect(() => {
    if (!accountId || !clave) return
    let c = cache.get(clave)
    if (!c || Date.now() - c.cuando > 30_000) {
      c = { cuando: Date.now(), valor: contar(accountId, activa?.id ?? null) }
      cache.set(clave, c)
    }
    let vivo = true
    c.valor.then((v) => { if (vivo) setCuentas({ clave, valor: v }) })
    return () => { vivo = false }
  }, [accountId, activa?.id, clave, vuelta])
  // Hasta que no está contado para ESTA cuenta y empresa: nada (el «Te toca hoy» dice «…»).
  return cuentas && cuentas.clave === clave ? cuentas.valor : NADA
}
