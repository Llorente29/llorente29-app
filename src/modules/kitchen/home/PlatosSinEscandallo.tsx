// Tarjeta «Platos sin escandallo» (§Cocina del cajón).
//
// ── LO QUE LA TARJETA CUENTA DE VERDAD, Y NO ES LO QUE DICE EL TÍTULO ──────
// Cuenta PRODUCTOS DE CARTA VENDIDOS SIN COSTE, que es un conjunto un poco más
// ancho que «platos sin escandallo»: incluye productos con escandallo enlazado
// pero sin coste, y packs y menús a los que nadie declaró el combo. El título
// viene de la lista de veintiuna aprobada, así que no se cambia aquí por mi
// cuenta — queda propuesto como frente («Vendido sin coste») para que lo decida
// Julio. Mientras tanto la tarjeta dice en su propia letra qué está contando,
// que es lo que evita que alguien lea mal la cifra.
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

export default function PlatosSinEscandallo({ accountId, locationId, drillTo }: HomeCardProps) {
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
      titulo="Platos sin escandallo"
      icono={ReceiptText}
      cifra={!datos ? undefined : datos.platos.productos.toLocaleString('es-ES')}
      cifraSufijo={datos
        ? (datos.platos.productos === 1 ? 'producto vendido sin coste' : 'productos vendidos sin coste')
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
