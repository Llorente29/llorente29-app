// src/modules/conta/marco/useCuentasMenu.ts
//
// El número de cada entrada del menú (repaso de compras, 10/10): lo que hay
// por mirar en ella. Cuenta lo mismo que enseña su pantalla, con la misma
// vara (regla 31):
//   · Compras: las filas de «Qué tienes que mirar» (decisiones, no papeles).
//   · Clientes y proveedores: las cuentas 430 traídas sin revisar y los
//     acuerdos de cesión sin socio.
//   · Libros: los asientos propuestos que esperan que alguien los valide.
// Es un aviso que interrumpe (el badge del menú, regla 7): cuenta lo que pide
// una decisión, y si no hay nada no se pinta.
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

export type CuentasMenu = Partial<Record<string, number>>

const EVENTO = 'folvy:conta:cuentas-menu'
const cache = new Map<string, { cuando: number; valor: Promise<CuentasMenu> }>()

/** Tras decidir algo en una pantalla: el menú vuelve a contar. */
export function refrescarCuentasMenu(): void {
  cache.clear()
  window.dispatchEvent(new Event(EVENTO))
}

const seguro = <T,>(p: Promise<T>, si: T) => p.catch((e: unknown) => { console.error('[menú] no se pudo contar', e); return si })

async function contar(accountId: string, companyId: string | null): Promise<CuentasMenu> {
  const [compras, terceros, libros] = await Promise.all([
    seguro(cargarMirar(accountId).then((m) => agruparAMirar(m).length), 0),
    seguro((async () => {
      const acuerdos = (await acuerdosSinSocio(accountId)).length
      if (!companyId) return acuerdos
      const [rev, { terceros: ts }] = await Promise.all([cargarRevision430(accountId, companyId), listarTercerosBase(accountId)])
      const t430 = ts.map((t) => ({ id: t.id, nombre: t.nombre, nif: t.nif, papeles: t.papeles, supplierId: t.supplierId, archivado: !!t.archivadoEn, codigoProveedor: null }))
      return acuerdos + rev.cuentas.filter((c) => !hecha(c, t430)).length
    })(), 0),
    seguro(companyId
      ? tabla('journal_entry').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('status', 'propuesto')
          .then(({ count, error }: { count: number | null; error: { message: string } | null }) => { if (error) throw new Error(error.message); return count ?? 0 })
      : Promise.resolve(0), 0),
  ])
  return { compras, terceros, libros }
}

export function useCuentasMenu(): CuentasMenu {
  const { accountId } = useCuentaConta()
  const { activa } = useEmpresas()
  const [cuentas, setCuentas] = useState<CuentasMenu>({})
  const [vuelta, setVuelta] = useState(0)
  useEffect(() => {
    const f = () => setVuelta((v) => v + 1)
    window.addEventListener(EVENTO, f)
    return () => window.removeEventListener(EVENTO, f)
  }, [])
  useEffect(() => {
    if (!accountId) return
    const clave = `${accountId}|${activa?.id ?? ''}`
    let c = cache.get(clave)
    if (!c || Date.now() - c.cuando > 30_000) {
      c = { cuando: Date.now(), valor: contar(accountId, activa?.id ?? null) }
      cache.set(clave, c)
    }
    let vivo = true
    c.valor.then((v) => { if (vivo) setCuentas(v) })
    return () => { vivo = false }
  }, [accountId, activa?.id, vuelta])
  return cuentas
}
