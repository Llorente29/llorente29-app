// src/modules/reparto/lib/entregaTicket.ts
//
// R03 · El bloque «ENTREGA» del ticket de la bolsa (Julio, 16/10): todo lo que
// necesita el repartidor, arriba y en grande. Pura: la usan los tres que
// pintan la bolsa (la imagen que imprime la tablet, el texto de la impresora y
// la previsualización) y la tarjeta, para que el papel y la pantalla digan lo
// mismo. Prueba: tests/unit/modules/reparto/entregaTicket.test.ts.
//
//   · Solo en reparto propio. Lo que reparte la plataforma no cambia.
//   · La dirección en dos líneas: la calle y el número; y el piso, la puerta y
//     el portal (lo que va en negrita).
//   · «Tel. 900 000 000 · código 12345678», en su línea.
//   · Las indicaciones de entrega y la nota del cliente, aparte.
//   · Sin dirección: «SIN DIRECCIÓN · LLAMAR AL CLIENTE», con el teléfono.
//
// La dirección pegada por la cocina manda sobre la de la plataforma. Las
// etiquetas se traducen con direccionParaMostrar (sitio único).
import { direccionParaMostrar } from '@/lib/direccionEntrega'

export interface PedidoParaEntrega {
  service_type: string | null
  delivery_address: string | null
  delivery_address_fixed?: string | null
  customer_phone: string | null
  customer_phone_code?: string | null
  delivery_instructions?: string | null
  order_customer_note?: string | null
  customer_note?: string | null
}

export interface BloqueEntrega {
  sinDireccion: boolean
  /** Calle, número, código postal. */
  calle: string | null
  /** Piso, puerta, portal, escalera, edificio… (en negrita). */
  detalles: string | null
  /** «Tel. … · código …», o null sin teléfono. */
  telefono: string | null
  /** «Indicaciones: …», «Nota del cliente: …» (sin repetir). */
  notas: string[]
}

export const SIN_DIRECCION = 'SIN DIRECCIÓN · LLAMAR AL CLIENTE'

// Lo que, en un trozo de la dirección, es piso/puerta/portal y no calle. Ya
// traducido (Piso, Puerta…) o tal cual llega sin traducción (Unit, Bldg.).
const DETALLE = /^\s*(piso|puerta|portal|escalera|edificio|bloque|apartamento|timbre|portero autom[aá]tico|ascensor|planta|unit|bldg\.?|unidad)\b/i

const limpio = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim()

export function esRepartoPropio(serviceType: string | null | undefined): boolean {
  return (serviceType ?? '').toLowerCase() === 'own_delivery'
}

/** «Tel. 900 000 000 · código 12345678». */
export function lineaTelefono(telefono: string | null | undefined, codigo: string | null | undefined): string | null {
  const t = limpio(telefono)
  if (!t) return null
  const c = limpio(codigo)
  return c ? `Tel. ${t} · código ${c}` : `Tel. ${t}`
}

/** Parte la dirección en la calle y los detalles (piso, puerta, portal…). */
export function partirDireccion(direccion: string | null | undefined): { calle: string | null; detalles: string | null } {
  const d = limpio(direccionParaMostrar(direccion ?? null))
  if (!d) return { calle: null, detalles: null }
  const trozos = d.split(/\s*,\s*/).filter(Boolean)
  const det = trozos.filter(t => DETALLE.test(t))
  const calle = trozos.filter(t => !DETALLE.test(t))
  return { calle: calle.join(', ') || null, detalles: det.join(', ') || null }
}

/** null = no es reparto propio: el ticket no cambia. */
export function bloqueEntrega(p: PedidoParaEntrega): BloqueEntrega | null {
  if (!esRepartoPropio(p.service_type)) return null
  const direccion = limpio(p.delivery_address_fixed) || limpio(p.delivery_address)
  const { calle, detalles } = partirDireccion(direccion)

  const notas: string[] = []
  const ind = limpio(p.delivery_instructions)
  // La nota del cliente: la suya si se ha leído aparte; si no, la de siempre.
  const nota = limpio(p.order_customer_note) || limpio(p.customer_note)
  if (ind) notas.push(`Indicaciones: ${ind}`)
  if (nota && nota !== ind) notas.push(`Nota del cliente: ${nota}`)

  return {
    sinDireccion: !calle && !detalles,
    calle,
    detalles,
    telefono: lineaTelefono(p.customer_phone, p.customer_phone_code),
    notas,
  }
}
