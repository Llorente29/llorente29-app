// src/modules/personal/home/EnCocinaAhora.tsx
//
// TARJETA «EN COCINA AHORA» del Inicio.
//
// Ajustada al bloque aprobado (02/09). Tres cosas cambiaron respecto a mi
// primera lectura, y en las tres mandó la maqueta:
//   · la cifra es «N de M», con el denominador pequeño — no «2 personas»
//   · la fila de contexto es «Ayer cerró · Pamela 00:15», no quién lleva más
//     tiempo dentro
//   · el estado vacío da la primera entrada prevista, sacada del cuadrante
//
// El desglose por local NO está en la maqueta y se conserva solo en
// consolidado, que es donde aporta; con un local seleccionado manda el bloque.
//
// ── EL UMBRAL DE FRESCURA: EL MÁS CORTO DE LAS SEIS ────────────────────────
// Tres minutos. Esto cambia cada vez que alguien ficha, y un número de hace un
// cuarto de hora puede decir que hay dos personas en una cocina donde ya no
// queda ninguna. Es la tarjeta donde un dato viejo se parece más a una mentira.

import { useCallback, useMemo } from 'react'
import { Users } from 'lucide-react'
import TarjetaInicio from '@/shell/home/widgets/TarjetaInicio'
import { useDatoDeTarjeta } from '@/shell/home/cards/useDatoDeTarjeta'
import type { HomeCardProps } from '@/shell/types'
import { diaNatural, diaDelNegocio, lunesDeLaSemana } from '@/lib/fechas'
import {
  leeAmbito, leeEnCocinaAhora, leeContextoDelDia,
  type EstadoEmpleado, type ContextoDelDia,
} from './enCocinaAhora'
import { resumeEnCocina } from './resumeEnCocina'

const UMBRAL_MIN = 3

export default function EnCocinaAhora({ accountId, locationId, drillTo }: HomeCardProps) {
  const { lunes, diaIndex, inicioDeHoy, hoy } = useMemo(() => {
    const ahora = new Date()
    const dia = diaDelNegocio(ahora)
    // 0 = lunes … 6 = domingo, como `DayOfWeek`. `getUTCDay` da 0 = domingo.
    const [y, m, d] = dia.ymd.split('-').map(Number)
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
    return {
      lunes: lunesDeLaSemana(ahora),
      diaIndex: dow === 0 ? 6 : dow - 1,
      inicioDeHoy: dia.desde,
      hoy: diaNatural(ahora),
    }
  }, [])

  const cargar = useCallback(
    async (): Promise<{ estados: EstadoEmpleado[]; contexto: ContextoDelDia }> => {
      if (!accountId) return { estados: [], contexto: { primeraEntradaPrevista: null, ayerCerro: null } }
      const ambito = await leeAmbito(accountId, locationId)
      const [estados, contexto] = await Promise.all([
        leeEnCocinaAhora(ambito),
        leeContextoDelDia(ambito, lunes, diaIndex, inicioDeHoy),
      ])
      return { estados, contexto }
    },
    [accountId, locationId, lunes, diaIndex, inicioDeHoy],
  )

  const { datos, cargando, error, sello } = useDatoDeTarjeta(
    cargar, [accountId, locationId, hoy], UMBRAL_MIN,
  )

  const resumen = useMemo(
    () => resumeEnCocina(datos?.estados ?? [], {
      consolidado: locationId == null,
      primeraEntradaPrevista: datos?.contexto.primeraEntradaPrevista,
      ayerCerro: datos?.contexto.ayerCerro,
    }),
    [datos, locationId],
  )

  return (
    <TarjetaInicio
      titulo="En cocina ahora"
      icono={Users}
      // «0 de 6», con el denominador pequeño al lado, como la maqueta.
      cifra={datos ? String(resumen.dentro) : '—'}
      cifraSufijo={datos ? `de ${resumen.total}` : undefined}
      cargando={cargando && datos == null}
      error={error}
      filas={resumen.filas}
      nota={resumen.nota}
      sello={sello}
      pie={drillTo
        ? {
            etiqueta: 'Abrir Team · Ahora mismo →',
            onClick: () => drillTo({
              ruta: '/personal/ahora-mismo',
              etiqueta: 'Abrir Team · Ahora mismo →',
              filtros: { local: locationId },
            }),
          }
        : undefined}
    />
  )
}
