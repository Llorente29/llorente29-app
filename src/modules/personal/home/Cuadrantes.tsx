// src/modules/personal/home/Cuadrantes.tsx
//
// TARJETA «CUADRANTES» del Inicio (§1.6 de la maqueta aprobada).
//
// SIN CIFRA GRANDE, a propósito y por indicación expresa: una fila por local
// con su estado. Un número único tendría que sumar «borrador» y «sin empezar»,
// que son problemas distintos con arreglos distintos.
//
// El umbral de frescura es largo (30 min): publicar un cuadrante es un acto
// deliberado de una persona, no algo que cambie solo durante el servicio.

import { useCallback, useMemo } from 'react'
import { CalendarDays } from 'lucide-react'
import TarjetaInicio from '@/shell/home/widgets/TarjetaInicio'
import { useDatoDeTarjeta } from '@/shell/home/cards/useDatoDeTarjeta'
import { diaNatural, lunesDeLaSemana } from '@/lib/fechas'
import type { HomeCardProps } from '@/shell/types'
import { leeCuadrantes, type DatosCuadrantes } from './cuadrantesService'
import { construyeFilas, detectaSoledad } from './estadoCuadrantes'

const UMBRAL_MIN = 30

export default function Cuadrantes({ accountId, locationId, drillTo }: HomeCardProps) {
  const { lunes, hoy, desdeLunes } = useMemo(() => {
    const ahora = new Date()
    const l = lunesDeLaSemana(ahora)
    // Ocho semanas hacia atrás: suficiente para decir «4 sem.» sin traerse el
    // histórico entero en cada carga del Inicio.
    const [y, m, d] = l.split('-').map(Number)
    const atras = new Date(Date.UTC(y, m - 1, d - 56)).toISOString().slice(0, 10)
    return { lunes: l, hoy: diaNatural(ahora), desdeLunes: atras }
  }, [])

  const cargar = useCallback((): Promise<DatosCuadrantes> => {
    if (!accountId) throw new Error('sin cuenta activa')
    return leeCuadrantes(accountId, locationId, desdeLunes, hoy)
  }, [accountId, locationId, desdeLunes, hoy])

  const { datos, cargando, error, sello } = useDatoDeTarjeta(
    cargar, [accountId, locationId, lunes], UMBRAL_MIN,
  )

  const filas = useMemo(
    () => (datos ? construyeFilas(datos.locales, datos.schedules, lunes) : []),
    [datos, lunes],
  )

  // Si hoy no hay ningún caso de soledad, NO se pinta línea y no se inventa
  // otra. Una tarjeta que siempre tiene algo que decir acaba diciendo cosas que
  // no importan, y entonces tampoco se lee el día que sí.
  const nota = useMemo(
    () => (datos ? detectaSoledad(datos.locales, datos.empleados, datos.ausencias, hoy) ?? undefined : undefined),
    [datos, hoy],
  )

  return (
    <TarjetaInicio
      titulo="Cuadrantes"
      icono={CalendarDays}
      cargando={cargando && datos == null}
      error={error}
      filas={filas.map(f => ({ etiqueta: f.etiqueta, valor: f.valor, tono: f.tono }))}
      nota={nota}
      sello={sello}
      pie={drillTo
        ? {
            etiqueta: 'Abrir Team · Calendario →',
            onClick: () => drillTo({
              ruta: '/personal/calendario',
              etiqueta: 'Abrir Team · Calendario →',
              filtros: { local: locationId },
            }),
          }
        : undefined}
    />
  )
}
