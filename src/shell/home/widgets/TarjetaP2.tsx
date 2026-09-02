// src/shell/home/widgets/TarjetaP2.tsx
//
// El hueco de una tarjeta PROMETIDA Y AÚN SIN CABLEAR.
//
// No enseña «—» ni un cero: esa era exactamente la razón por la que el 02/09 se
// retiraron tres tarjetas del mosaico. Un guion se lee como «hoy no hay nada»,
// que es una afirmación sobre el negocio; esto dice que el dato todavía no
// existe en el producto, que es una afirmación sobre nosotros.
//
// Y se ve que es un hueco: punteado, sin cifra y sin pie pulsable. Si pareciera
// una tarjeta de verdad, alguien esperaría un número que no va a llegar.

import type { LucideIcon } from 'lucide-react'
import { Clock3 } from 'lucide-react'

export default function TarjetaP2({ titulo, icono: Icono = Clock3 }: {
  titulo: string
  icono?: LucideIcon
}) {
  return (
    <div
      style={{
        border: '1px dashed var(--color-border-default)',
        borderRadius: 'var(--radius-xl)',
        padding: '0.9375rem 1.0625rem',
        display: 'flex', flexDirection: 'column', gap: 6, height: '100%',
        background: 'transparent',
      }}
    >
      <p className="flex items-center" style={{
        fontSize: '0.8125rem', color: 'var(--color-text-secondary)', margin: 0, gap: 6,
      }}>
        <Icono size={15} /> {titulo}
      </p>
      <p style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', margin: 0 }}>
        Disponible — se cablea en el lote P2
      </p>
    </div>
  )
}
