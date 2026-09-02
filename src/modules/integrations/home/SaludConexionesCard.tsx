// Tarjeta «Salud de conexiones» (§Canales de la maqueta).
//
// Cuelga de `listAccountConnectors`, que ya usa la pantalla de Integraciones.
//
// ── QUÉ CUENTA LA CIFRA, Y POR QUÉ NO ES «CUÁNTAS HAY» ─────────────────────
// La cifra son las conexiones SANAS sobre el total, «6 de 7». Un número suelto
// —«7 conexiones»— no dice nada: siete conexiones de las que dos están rotas es
// una noticia mala disfrazada de inventario.
//
// `AccountConnectorStatus` tiene seis valores y solo uno es «va»: `connected`.
// `error` y `paused` son problemas distintos y se cuentan aparte —una pausa la
// puso alguien, un error no— y `available`/`requested`/`connecting` no son
// fallos: son conexiones a medio montar, y decir que están rotas sería mentir
// sobre un trabajo en curso.
import { useCallback, useMemo } from 'react'
import { PlugZap } from 'lucide-react'
import TarjetaInicio from '@/shell/home/widgets/TarjetaInicio'
import { useDatoDeTarjeta } from '@/shell/home/cards/useDatoDeTarjeta'
import type { HomeCardProps } from '@/shell/types'
import { listAccountConnectors } from '../services/connectorService'
import type { AccountConnector } from '@/types/integrations'

export default function SaludConexionesCard({ accountId, drillTo }: HomeCardProps) {
  const cargar = useCallback(
    () => (accountId ? listAccountConnectors({ accountId }) : Promise.resolve([] as AccountConnector[])),
    [accountId],
  )
  const { datos, cargando, error, sello } = useDatoDeTarjeta(cargar, [accountId], 15)

  const { vivas, total, filas, nota } = useMemo(() => {
    // Las archivadas no cuentan: se retiraron a propósito y contarlas como
    // rotas dejaría la tarjeta en rojo para siempre por algo ya resuelto.
    const cs = (datos ?? []).filter(c => c.isActive && !c.archivedAt)
    const conectadas = cs.filter(c => c.status === 'connected')
    const conError = cs.filter(c => c.status === 'error')
    const pausadas = cs.filter(c => c.status === 'paused')
    const montando = cs.filter(c => ['available', 'requested', 'connecting'].includes(c.status))

    return {
      vivas: conectadas.length,
      total: cs.length,
      filas: [
        ...conError.map(c => ({
          etiqueta: c.connectorId,
          // El error de verdad, recortado. «Con error» a secas obliga a entrar
          // para saber si es el token o la red.
          valor: (c.lastError ?? 'con error').slice(0, 40),
          tono: 'bad' as const,
        })),
        ...pausadas.map(c => ({
          etiqueta: c.connectorId, valor: 'en pausa', tono: 'attention' as const,
        })),
      ],
      nota: cs.length === 0 ? 'No hay conexiones configuradas'
        : conError.length > 0 ? undefined
        : montando.length > 0
          ? `${montando.length} a medio conectar, ninguna rota`
          : 'Todas las conexiones responden',
    }
  }, [datos])

  return (
    <TarjetaInicio
      titulo="Salud de conexiones"
      icono={PlugZap}
      cifra={datos ? String(vivas) : undefined}
      cifraSufijo={datos ? `de ${total}` : undefined}
      cargando={cargando && datos == null}
      error={error}
      hayDato={datos != null}
      filas={filas}
      nota={nota}
      sello={sello}
      pie={drillTo ? {
        etiqueta: 'Abrir Integraciones →',
        onClick: () => drillTo({ ruta: '/integraciones', etiqueta: 'Abrir Integraciones →' }),
      } : undefined}
    />
  )
}
