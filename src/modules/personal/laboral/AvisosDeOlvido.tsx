// src/modules/personal/laboral/AvisosDeOlvido.tsx
//
// L1a · PR 3 (28/10/2026). En Equipo, debajo de «Para revisar»:
//   · si los avisos de olvido han dejado de salir (lo dice el vigía, el mismo
//     día), una tarjeta en rojo con el motivo en palabras de oficina. Del
//     05/08 al 17/09 no salió ninguno y nadie se enteró: esto es para que no
//     vuelva a pasar;
//   · el contador de la semana: enviados, fallidos, sin teléfono y los que
//     solo vio la persona en su portal (fuera de hora o sin querer WhatsApp).
// Regla 7: el contador cuenta todos; con fallos o sin teléfono no se pinta
// en verde.

import { useEffect, useState } from 'react'
import { useApp } from '@/context/AppContext'
import { Chip, Tarjeta } from '@/modules/conta/diseno'
import { avisosEmpresa, contadorDeLaSemana, type AvisoEmpresa, type ContadorAvisos } from './avisosOlvidoServicio'
import { fechaYHora } from './calculoJornada'
import { PIEZA_LABORAL } from './estilo'

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`

export default function AvisosDeOlvido() {
  const { activeAccountId } = useApp()
  const [contador, setContador] = useState<ContadorAvisos | null>(null)
  const [fallan, setFallan] = useState<AvisoEmpresa | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!activeAccountId) return
    let vivo = true
    const t = window.setTimeout(async () => {
      try {
        const [c, avisos] = await Promise.all([contadorDeLaSemana(activeAccountId), avisosEmpresa(activeAccountId, 2)])
        if (!vivo) return
        setContador(c)
        setFallan(avisos.find(a => a.tipo === 'avisos_olvido_fallan') ?? null)
        setError('')
      } catch (e) {
        if (vivo) setError(e instanceof Error ? e.message : String(e))
      }
    }, 0)
    return () => { vivo = false; window.clearTimeout(t) }
  }, [activeAccountId])

  if (error) {
    return <div className={PIEZA_LABORAL}><Tarjeta tono="falta" compacta titulo="Avisos de olvido" apoyo={`No se han podido leer: ${error}`} /></div>
  }
  if (!contador) return null

  const problemas = contador.fallidos + contador.sinTelefono
  return (
    <div className={`${PIEZA_LABORAL} l-avisos`} data-prueba="avisos-de-olvido">
      {fallan && (
        <div data-prueba="avisos-no-salen">
          <Tarjeta tono="falta" titulo={fallan.titulo} apoyo={`${fallan.texto} Visto el ${fechaYHora(fallan.creadoAt)}.`} />
        </div>
      )}
      <Tarjeta compacta tono={contador.fallidos > 0 ? 'duda' : 'normal'}
        titulo="Avisos de olvido de fichaje · últimos 7 días"
        apoyo={contador.total === 0
          ? 'Esta semana nadie se ha dejado una entrada abierta pasado su turno.'
          : 'Por WhatsApp entre las 08:00 y las 22:00; fuera de esa hora, sin teléfono o si la persona no lo quiere, lo ve al abrir su portal. Su respuesta llega a «Peticiones».'}>
        <div className="l-avisos-cifras" data-prueba="contador-avisos">
          <span><Chip tono="seguro">{plural(contador.enviados, 'enviado', 'enviados')}</Chip></span>
          <span><Chip tono={contador.fallidos > 0 ? 'falta' : 'neutro'}>{plural(contador.fallidos, 'fallido', 'fallidos')}</Chip></span>
          <span><Chip tono={contador.sinTelefono > 0 ? 'duda' : 'neutro'}>{`${contador.sinTelefono} sin teléfono`}</Chip></span>
          <span><Chip tono="neutro">{`${contador.soloPortal} solo en el portal`}</Chip></span>
          <span><Chip tono="neutro">{plural(contador.respondidos, 'respondido', 'respondidos')}</Chip></span>
        </div>
        {problemas > 0 && (
          <p className="l-nota l-avisos-nota">
            {contador.sinTelefono > 0 ? `${plural(contador.sinTelefono, 'persona no tiene', 'personas no tienen')} teléfono en su ficha. ` : ''}
            {contador.fallidos > 0 ? 'Los fallidos los ve la persona en su portal.' : ''}
          </p>
        )}
      </Tarjeta>
    </div>
  )
}
