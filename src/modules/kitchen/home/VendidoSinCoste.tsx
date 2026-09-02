// Tarjeta «Vendido sin coste» (§Cocina del cajón).
//
// ── SE LLAMABA «Platos sin escandallo», Y PROMETÍA UNA CAUSA QUE NO ENTREGA ─
// Nació con ese nombre porque venía de la lista de veintiuna aprobada, y con un
// frente abierto (el 17) diciendo que el nombre engañaba. Julio lo cerró el
// 02/09: se llama «Vendido sin coste», que es lo que mide.
//
// La diferencia importa. «Platos sin escandallo» nombra UNA CAUSA —falta la
// receta— y manda a quien lo lee a escribir escandallos. Lo que la tarjeta
// cuenta son PRODUCTOS DE CARTA VENDIDOS SIN COSTE, y ahí dentro hay al menos
// tres causas distintas: productos sin receta enlazada, productos con receta
// enlazada y sin coste, y packs y menús a los que nadie declaró el combo — que
// además NO se arreglan con un escandallo. Un título que nombra el síntoma deja
// que la fila diga cuál es la causa; uno que nombra una causa manda a la mitad
// de la gente a hacer el trabajo equivocado.
//
// LA CLAVE NO CAMBIA. Sigue siendo `kitchen.platos_sin_escandallo`. Una clave
// es identidad —es lo que hay guardado en `home_layout` y lo que compara el
// aviso de «tarjetas nuevas»— y un título es etiqueta. Cambiar la clave para
// que «haga juego» con el nombre haría desaparecer la tarjeta del Inicio de
// quien ya la tuviera puesta, sin decir nada. Es exactamente el fallo que
// costó el sub-lote del cajón.
//
// ── POR QUÉ LOS COMBOS VAN CONTADOS Y NO LISTADOS ─────────────────────────
// Un combo declarado no lleva escandallo propio: su coste sale de sus
// componentes. Ponerlo en la lista de «arréglame» mandaría a alguien a hacer un
// trabajo equivocado. Van en la línea de consecuencia, con su dinero — se
// cuentan, no se esconden: el umbral ordena, no decide la existencia (regla 7).
import { useCallback } from 'react'
import { ReceiptText } from 'lucide-react'
import TarjetaInicio from '@/shell/home/widgets/TarjetaInicio'
import { useDatoDeTarjeta } from '@/shell/home/cards/useDatoDeTarjeta'
import { eurEntero } from '@/lib/dinero'
import type { HomeCardProps } from '@/shell/types'
import { leeVendidoSinCoste, type VendidoSinCoste as Dato } from './vendidoSinCoste'

export default function VendidoSinCoste({ accountId, locationId, drillTo }: HomeCardProps) {
  const cargar = useCallback((): Promise<Dato> => {
    if (!accountId) throw new Error('sin cuenta activa')
    return leeVendidoSinCoste(accountId, locationId)
  }, [accountId, locationId])

  const { datos, cargando, error, sello } = useDatoDeTarjeta(cargar, [accountId, locationId], 60)

  const consecuencia = !datos ? undefined
    : datos.platos.productos === 0 && datos.combos.productos === 0
      // Cero de verdad, y con la prueba al lado: se han mirado N líneas.
      ? `Las ${datos.lineas.toLocaleString('es-ES')} líneas de producto de los últimos 30 días tienen coste.`
      : [
          `${eurEntero(datos.platos.venta)} vendidos en 30 días sin poder costearlos.`,
          datos.combos.productos > 0
            ? `Aparte, ${datos.combos.productos} combos (${eurEntero(datos.combos.venta)}): su coste son sus componentes, no un escandallo propio — hoy no sale.`
            : null,
        ].filter(Boolean).join(' ')

  return (
    <TarjetaInicio
      titulo="Vendido sin coste"
      icono={ReceiptText}
      cifra={!datos ? undefined : datos.platos.productos.toLocaleString('es-ES')}
      // El sufijo ya no repite el título: con «Vendido sin coste» arriba,
      // «productos» basta y la cifra se lee de un golpe.
      cifraSufijo={datos
        ? (datos.platos.productos === 1 ? 'producto' : 'productos')
        : undefined}
      cargando={cargando && datos == null}
      error={error}
      hayDato={datos != null}
      filas={(datos?.top ?? []).map(p => ({
        etiqueta: p.marca ? `${p.nombre} · ${p.marca}` : p.nombre,
        valor: eurEntero(p.venta),
        tono: 'attention' as const,
      }))}
      maxFilas={4}
      nota={consecuencia}
      sello={sello}
      pie={drillTo ? {
        etiqueta: 'Abrir Cocina · Platos →',
        onClick: () => drillTo({ ruta: '/kitchen/recetas', etiqueta: 'Abrir Cocina · Platos →' }),
      } : undefined}
    />
  )
}
