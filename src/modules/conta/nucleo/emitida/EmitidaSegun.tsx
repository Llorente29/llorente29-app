// src/modules/conta/nucleo/emitida/EmitidaSegun.tsx
//
// K05 · Qué ficha de la factura emitida sale: dentro de una pestaña del núcleo
// (el interruptor conta_nucleo encendido y en ordenador: lo decide el marco),
// la nueva; fuera, la de hoy, sin un cambio. Y Asientos › «Emitidas»
// (PorRevisar): en el núcleo, la primera de la cola o una a mano; fuera, la
// lista de hoy. Y la de un asiento, fuera del núcleo, lleva a su asiento.

import { useEffect, useState, type ReactNode } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { rutaAsiento, rutaEmitidaAMano, rutaEmitidaAsiento, rutaFacturasVenta } from '@/config/navegacion'
import { usePestana } from '@/modules/conta/diseno/plantillas'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import FichaEmitida from './FichaEmitida'
import { colaEmitidas } from './servicio'

export default function EmitidaSegun({ de, hoy }: { de: 'nueva' | 'factura' | 'asiento'; hoy: ReactNode }) {
  return usePestana() ? <FichaEmitida de={de} hoy={hoy} /> : <>{hoy}</>
}

/** Fuera del núcleo, la emitida de un asiento es su asiento. */
export function LlevarAlAsiento() {
  const { entryId = '' } = useParams()
  return <Navigate to={rutaAsiento(entryId)} replace />
}

/** Asientos › «Emitidas»: la primera por revisar o, si no hay, una a mano. Fuera del núcleo, la lista de hoy. */
export function EmitidasPorRevisar() {
  const pestana = usePestana()
  const navegar = useNavigate()
  const { accountId } = useCuentaConta()
  const { activa } = useEmpresas()
  const [fallo, setFallo] = useState<string | null>(null)
  useEffect(() => {
    if (!pestana || !accountId || !activa) return
    let vivo = true
    colaEmitidas(accountId, activa.id).then(
      (ids) => { if (vivo) navegar(ids.length ? rutaEmitidaAsiento(ids[0]) : rutaEmitidaAMano(), { replace: true, state: ids.length ? undefined : { aviso: 'No hay emitidas por revisar: escribe una.' } }) },
      (e: unknown) => { if (vivo) setFallo(e instanceof Error ? e.message : String(e)) })
    return () => { vivo = false }
  }, [pestana, accountId, activa, navegar])
  if (!pestana) return <Navigate to={rutaFacturasVenta()} replace />
  return <div className="kf-ficha"><p className="kf-aviso" data-tono={fallo ? 'mal' : 'ok'} aria-busy={!fallo || undefined}>{fallo ? `No se han podido leer las emitidas por revisar: ${fallo}` : 'Buscando las emitidas por revisar…'}</p></div>
}
