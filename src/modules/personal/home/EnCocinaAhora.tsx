// src/modules/personal/home/EnCocinaAhora.tsx
//
// TARJETA «EN COCINA AHORA» del Inicio.
//
// ── AVISO: EL COPY ES MI LECTURA, NO LA MAQUETA ────────────────────────────
// El bloque de esta tarjeta no estaba disponible al escribirla. La ESTRUCTURA
// es la de las otras cinco (`TarjetaInicio`), y las decisiones de contenido que
// he tomado y que el bloque puede querer cambiar son tres, todas de una línea:
//   · cifra grande = personas dentro ahora
//   · una fila por local con «1 de 4» / «nadie dentro»
//   · la nota dice quién lleva más tiempo dentro
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
import { leeEnCocinaAhora, type EstadoEmpleado } from './enCocinaAhora'
import { resumeEnCocina } from './resumeEnCocina'

const UMBRAL_MIN = 3

export default function EnCocinaAhora({ accountId, locationId, drillTo }: HomeCardProps) {
  const cargar = useCallback(
    (): Promise<EstadoEmpleado[]> =>
      accountId ? leeEnCocinaAhora(accountId, locationId) : Promise.resolve([]),
    [accountId, locationId],
  )

  const { datos, cargando, error, sello } = useDatoDeTarjeta(
    cargar, [accountId, locationId], UMBRAL_MIN,
  )

  const resumen = useMemo(() => resumeEnCocina(datos ?? []), [datos])

  return (
    <TarjetaInicio
      titulo="En cocina ahora"
      icono={Users}
      cifra={datos ? String(resumen.dentro) : '—'}
      cifraSufijo={datos && resumen.dentro > 0
        ? (resumen.dentro === 1 ? 'persona' : 'personas') : undefined}
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
