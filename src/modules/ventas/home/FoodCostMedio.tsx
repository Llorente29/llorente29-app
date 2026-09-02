// Tarjeta «Food cost medio» (§Cocina del cajón, pantalla de Ventas).
//
// ── EL PIE LLEVA A `/ventas/margen`, NO A `/kitchen/rentabilidad` ──────────
// El catálogo P2 la declaraba apuntando a Cocina · Rentabilidad. Se cambia, y
// no es un detalle de navegación: Rentabilidad pinta `menu_item_economics`
// —media de medias por marca— y esta tarjeta pinta `food_cost_dashboard`
// —ponderado por dinero—. Son dos números distintos del mismo concepto. Una
// tarjeta que dice 27,4 % y abre una pantalla que dice otra cosa enseña al
// operario que el Inicio no es de fiar, y eso no se arregla luego.
//
// ── SIN FILTRO DE LOCAL EN EL ENLACE ───────────────────────────────────────
// `/ventas/margen` NO lee parámetros de la URL (comprobado: no usa
// useSearchParams). Así que el enlace va sin filtros en vez de mandar un
// `local` que se perdería en silencio — que es justo lo que prohíbe la tabla de
// contratos de `drill.ts`. La pantalla tiene su propio selector. Anotado como
// frente: los tres destinos de Ventas no leen la URL.
import { useCallback } from 'react'
import { Percent } from 'lucide-react'
import TarjetaInicio from '@/shell/home/widgets/TarjetaInicio'
import { useDatoDeTarjeta } from '@/shell/home/cards/useDatoDeTarjeta'
import { deltaEnPuntos } from '@/shell/home/espejo'
import type { HomeCardProps } from '@/shell/types'
import { leeFoodCostMedio, VENTANA_DIAS, type FoodCostMedio as Dato } from './foodCostMedio'

function pct(n: number | null): string {
  return n == null ? '—' : `${n.toLocaleString('es-ES', { maximumFractionDigits: 1 })} %`
}

export default function FoodCostMedio({ accountId, locationId, drillTo }: HomeCardProps) {
  const cargar = useCallback((): Promise<Dato> => {
    if (!accountId) throw new Error('sin cuenta activa')
    return leeFoodCostMedio(accountId, locationId)
  }, [accountId, locationId])

  // Ventana de 30 días cerrada: caduca despacio. Una hora es de sobra, y un
  // sello en rojo cada quince minutos por un dato mensual sería ruido.
  const { datos, cargando, error, sello } = useDatoDeTarjeta(cargar, [accountId, locationId], 60)

  const sospechosas = datos?.sospechosas ?? []
  const consecuencia = !datos ? undefined
    : datos.pct == null
      // No hay ni una línea costeada. Decir «0 %» sería decir que se cocina
      // gratis; lo que pasa es que no se sabe.
      ? `Ninguna de las ${datos.unidades.toLocaleString('es-ES')} ventas del periodo tiene coste: no hay food cost que calcular.`
      : [
          sospechosas.length > 0
            ? `${sospechosas.slice(0, 2).join(' y ')} sale${sospechosas.length > 1 ? 'n' : ''} fuera de rango: revisa su escandallo antes de creerte su margen.`
            : null,
          // La cobertura se dice por DINERO, que es la que decide si el
          // porcentaje de arriba se puede creer. Los euros que faltan por
          // costear los lista «Platos sin escandallo»: no se repiten aquí.
          datos.coberturaDineroPct != null
            ? `Cubre el ${datos.coberturaDineroPct.toLocaleString('es-ES', { maximumFractionDigits: 1 })} % del dinero vendido (${datos.unidadesCosteadas.toLocaleString('es-ES')} ventas de ${datos.unidades.toLocaleString('es-ES')}).`
            : `Sale de ${datos.unidadesCosteadas.toLocaleString('es-ES')} ventas de ${datos.unidades.toLocaleString('es-ES')}.`,
        ].filter(Boolean).join(' ')

  return (
    <TarjetaInicio
      titulo="Food cost medio"
      icono={Percent}
      cifra={!datos ? undefined : pct(datos.pct)}
      cifraSufijo={datos && datos.pct != null ? 'de la venta costeada' : undefined}
      delta={datos
        ? deltaEnPuntos(datos.pct, datos.pctEspejo, {
            desde: datos.espejoDesde, hasta: datos.espejoHasta,
            etiqueta: `los ${VENTANA_DIAS} días anteriores`,
          }, { subirEsMalo: true, conCifraDelEspejo: true }) ?? undefined
        : undefined}
      cargando={cargando && datos == null}
      error={error}
      hayDato={datos != null}
      filas={(datos?.marcas ?? []).map(m => ({
        etiqueta: m.marca,
        valor: pct(m.pct),
        tono: m.sospechoso ? ('bad' as const) : ('neutral' as const),
      }))}
      maxFilas={4}
      nota={consecuencia}
      sello={sello}
      pie={drillTo ? {
        etiqueta: 'Abrir Ventas · Margen por plato →',
        onClick: () => drillTo({ ruta: '/ventas/margen', etiqueta: 'Abrir Ventas · Margen por plato →' }),
      } : undefined}
    />
  )
}
