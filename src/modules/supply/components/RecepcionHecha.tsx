// src/modules/supply/components/RecepcionHecha.tsx
//
// Compras · N21 (maqueta Recepcion.dc.html, repaso del 11/10): al terminar una
// recepción, quien recibe ve «Recibido», de quién y por cuánto, y en su
// tarjeta qué pasa con el papel («Este papel es un albarán. La oficina
// esperará la factura.»). Antes la frase iba al final del mensaje de
// confirmación y en el asistente del móvil no salía.
//
// Si la base no sabe decir la frase, la tarjeta no se pinta: la recepción no
// depende de ella. Lo que haya que revisar (líneas sin postear, que la mire la
// oficina) va debajo en pequeño: un aviso no se calla porque la pantalla sea
// de éxito (regla 8).
//
// El botón principal es el azul del estilo nuevo (#2F5BFF, `--cx-azul` en
// conta), no el `accent` negro de Cocina: decisión de Julio, respuesta 2 del
// repaso (11/10). Va escrito aquí porque supply no carga los tokens de conta.

import { Check, FileText } from 'lucide-react'
import { partirFrase } from '@/modules/supply/lib/fraseRecepcion'

export interface RecepcionHechaDatos {
  proveedor: string | null
  productos: number
  total: number | null
  frase: string | null
  /** Lo que queda por revisar, si hay algo. */
  aviso: string | null
  /** El mensaje de siempre, para la lista a la que se vuelve. */
  mensaje: string
}

const eur = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' })

export default function RecepcionHecha({ datos, local, onRecibirOtro, onVolver }: {
  datos: RecepcionHechaDatos
  local?: string | null
  onRecibirOtro?: () => void
  onVolver: () => void
}) {
  const [fuerte, resto] = datos.frase ? partirFrase(datos.frase) : ['', '']
  return (
    <div className="min-h-[calc(100dvh-3rem)] sm:min-h-0 max-w-md mx-auto w-full px-4 py-6 flex flex-col gap-4" role="status" aria-live="polite">
      <span className="text-sm text-text-secondary">Recepción{local ? ` · ${local}` : ''}</span>
      <div className="rounded-3xl border border-border-default bg-card px-5 py-7 flex flex-col items-center gap-3 text-center">
        <span className="w-16 h-16 rounded-full bg-success-bg text-success flex items-center justify-center" aria-hidden="true">
          <Check size={30} strokeWidth={2.6} />
        </span>
        <h1 className="m-0 text-2xl font-display font-medium text-text-primary">Recibido</h1>
        <p className="m-0 text-base text-text-secondary leading-snug">
          {datos.proveedor ?? 'Proveedor sin identificar'} ·{'\u00A0'}{datos.productos}{'\u00A0'}{datos.productos === 1 ? 'producto' : 'productos'}
          {datos.total != null && <><br />{eur.format(datos.total)}</>}
        </p>
      </div>
      {datos.frase && (
        <div className="rounded-2xl border border-border-default bg-card px-4 py-4 flex gap-3 items-start">
          <FileText size={22} className="text-accent shrink-0 mt-0.5" aria-hidden="true" />
          <p className="m-0 text-[15px] leading-snug text-text-secondary">
            <strong className="font-semibold text-text-primary">{fuerte}</strong>{resto ? ` ${resto}` : ''}
          </p>
        </div>
      )}
      {datos.aviso && <p className="m-0 text-sm text-warning">{datos.aviso}</p>}
      <div className="flex-1" />
      {onRecibirOtro && (
        <button type="button" onClick={onRecibirOtro}
          className="h-14 rounded-2xl bg-[#2F5BFF] text-white text-[17px] font-semibold focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#2F5BFF]">Recibir otro</button>
      )}
      <button type="button" onClick={onVolver}
        className="h-[52px] rounded-2xl border border-border-default bg-card text-base font-semibold text-text-primary">Volver</button>
    </div>
  )
}
