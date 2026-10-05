// src/modules/conta/plan/DeshacerTraido.tsx
//
// C02c · «Deshacer entero» del plan traído de otro programa, en la entrada
// «Plan traído de …» de «Lo que ha hecho Folvy» (y del historial del plan).
// Pregunta antes (borra el plan y las fichas nuevas), y dice lo que ha hecho o
// por qué no ha podido (regla 8: una ficha nueva ya usada lo bloquea).

import { useState } from 'react'
import { Resultado } from '@/modules/conta/empresa/campos'
import { deshacerImportacion, type Importacion } from '@/modules/conta/services/importarService'

/** alDeshacer: lo que se ha hecho, en una frase; quien lo contiene lo enseña (este botón desaparece al recargar). */
export function DeshacerTraido({ importacion, alDeshacer }: { importacion: Importacion; alDeshacer: (frase: string) => void }) {
  const [haciendo, setHaciendo] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)
  if (importacion.estado !== 'traida') return null
  return (
    <div className="cx-registro-accion">
      <button type="button" className="cx-boton-sec" disabled={haciendo} onClick={() => {
        if (!window.confirm('¿Deshaces el plan traído? Se quitan todas sus cuentas y las fichas de proveedor que creó, y el plan vuelve a estar sin activar. Tus proveedores y bancos de siempre no se tocan.')) return
        setHaciendo(true); setFallo(null)
        deshacerImportacion(importacion.id, null)
          .then((x) => alDeshacer(`Deshecho el plan traído: se han quitado ${x.cuentas} cuentas y ${x.fichas} ${x.fichas === 1 ? 'ficha nueva' : 'fichas nuevas'}. El plan está sin activar: puedes volver a traerlo.`))
          .catch((e) => setFallo(e instanceof Error ? e.message : String(e)))
          .finally(() => setHaciendo(false))
      }}>{haciendo ? 'Deshaciendo…' : 'Deshacer entero'}</button>
      <Resultado hecho={null} fallo={fallo} />
    </div>
  )
}
