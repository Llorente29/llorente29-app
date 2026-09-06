// src/modules/kitchen/components/EstadoDeLaConsulta.tsx
//
// B79 (06/09/2026). El estado «no hay nada» de una pantalla, contado de forma que
// no pueda mentir.
//
// LA FACTURA. Resumen, Rentabilidad e Ingeniería de menús llevaban desde junio
// diciéndole al cliente que su cocina estaba vacía: «Esta marca no tiene platos en
// carta todavía» sobre una marca con 23 productos activos. La causa estaba en la
// RPC —un INNER JOIN contra `menu_item.channel_id`, que está vacío en las 584
// filas de la cuenta— pero el daño lo hacía la PANTALLA, que convertía «la
// consulta no ha devuelto filas» en una afirmación sobre el negocio.
//
// Y hay un segundo modo, peor: cuando la carga FALLA, `rows` se queda vacío y el
// mismo cartel dice «no tiene platos». Un error de permisos, de red o de la RPC se
// disfrazaba de inventario vacío.
//
// LA REGLA QUE IMPLEMENTA: «no hay datos» sólo cuando de verdad no hay.
//   · Si falló, se dice que falló y se enseña el motivo.
//   · Si no se ha pedido nada todavía, se dice eso.
//   · Si de verdad vino vacío, se dice QUÉ se preguntó — no qué se concluye del
//     negocio del cliente.
// Es la familia de las reglas 7 y 8: la 7 prohíbe esconder filas que existen, la 8
// esconder que algo ha pasado; ésta prohíbe **afirmar sobre el negocio lo que sólo
// se sabe de la consulta**.

import { AlertTriangle, Loader2, Inbox } from 'lucide-react'

interface EstadoDeLaConsultaProps {
  /** La consulta está en vuelo. */
  cargando?: boolean
  /** Qué se está haciendo mientras carga. «Cargando…» a secas no dice nada. */
  textoCargando?: string
  /** El mensaje de error tal cual vino. null = no falló. */
  error?: string | null
  /**
   * Qué se preguntó, en castellano y sin identificadores. Se enseña cuando la
   * consulta vino vacía DE VERDAD. Ej.: «los platos de Ay Mamita Bowls».
   */
  queSePregunto: string
  /**
   * Lo que se sabe por otra vía y contradice al vacío, si se sabe. Ej.: «la marca
   * tiene 23 productos activos». Sin esto, el vacío se dice sin adornos.
   */
  matiz?: string | null
}

export default function EstadoDeLaConsulta({
  cargando, textoCargando, error, queSePregunto, matiz,
}: EstadoDeLaConsultaProps) {
  if (cargando) {
    return (
      <div className="bg-card border border-border-default rounded-xl p-8 text-center">
        <Loader2 className="w-5 h-5 mx-auto mb-2 animate-spin text-text-secondary" />
        <p className="text-sm text-text-secondary">{textoCargando ?? 'Cargando…'}</p>
      </div>
    )
  }

  // EL ERROR SE ENSEÑA, NO SE DISFRAZA DE VACÍO. Y va primero: si falló, lo que
  // haya o deje de haber en el negocio todavía no se sabe.
  if (error) {
    return (
      <div className="bg-card border border-danger/30 rounded-xl p-6">
        <div className="flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-danger mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-text-primary">
              No se ha podido cargar {queSePregunto}.
            </p>
            <p className="text-xs text-text-secondary mt-1 break-words">{error}</p>
            <p className="text-xs text-text-secondary mt-2">
              Esto <strong>no</strong> significa que no haya datos: significa que no se han podido leer.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-card border border-border-default rounded-xl p-8 text-center">
      <Inbox className="w-5 h-5 mx-auto mb-2 text-text-secondary" />
      <p className="text-sm text-text-secondary">
        La consulta de {queSePregunto} no ha devuelto ninguna fila.
      </p>
      {matiz && <p className="text-xs text-text-secondary mt-1.5">{matiz}</p>}
    </div>
  )
}
