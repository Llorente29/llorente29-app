// src/modules/conta/nucleo/terceros/TerceroSegun.tsx
//
// X27 · Qué ficha de proveedor o de cliente se pinta: con `conta_nucleo` encendido y en el ordenador, la del núcleo
// (FichaTercero, como ERP10); si no, la de hoy, tal cual (reglas comunes: «Apagado, la pantalla de hoy byte a byte.
// Encendido en el móvil, también la de hoy»). La misma regla que el asiento (AsientoSegun). La de Cocina (Folvy) no
// pasa por aquí: se queda con la suya.
// La de un tercero: solo la de un cliente (o «nuevo»). Una plataforma o una marca asociada que no es cliente sigue
// en la ficha de hoy, que es la que sabe de sus liquidaciones.

import { useEffect, useState, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { useIsMobile } from '@/shell/useIsMobile'
import { cualMarco, useNucleoEncendido } from '@/modules/conta/nucleo/interruptor'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { FichaTercero } from './FichaTercero'
import { esCliente } from './servicio'

export function ProveedorSegun({ hoy }: { hoy: ReactNode }) {
  const movil = useIsMobile()
  const encendido = useNucleoEncendido()
  const { supplierId = '' } = useParams()
  if (cualMarco({ encendido, movil }) !== 'nucleo') return <>{hoy}</>
  return <FichaTercero key={supplierId} tipo="proveedor" id={supplierId} />
}

export function ClienteSegun({ hoy }: { hoy: ReactNode }) {
  const movil = useIsMobile()
  const encendido = useNucleoEncendido()
  const { partyId = '' } = useParams()
  const { accountId } = useCuentaConta()
  const nucleo = cualMarco({ encendido, movil }) === 'nucleo'
  const [es, setEs] = useState<{ id: string; cliente: boolean } | null>(null)
  useEffect(() => {
    if (!nucleo || !accountId || partyId === 'nuevo') return
    let vivo = true
    esCliente(accountId, partyId).then((c) => { if (vivo) setEs({ id: partyId, cliente: c }) }, () => { if (vivo) setEs({ id: partyId, cliente: false }) })
    return () => { vivo = false }
  }, [nucleo, accountId, partyId])
  if (!nucleo) return <>{hoy}</>
  if (partyId === 'nuevo') return <FichaTercero key="nuevo" tipo="cliente" id="nuevo" />
  if (es?.id !== partyId) return <div className="kp-ventana" aria-busy="true" aria-label="Cargando la ficha"><p className="ft-cargando">Abriendo la ficha…</p></div>
  return es.cliente ? <FichaTercero key={partyId} tipo="cliente" id={partyId} /> : <>{hoy}</>
}
