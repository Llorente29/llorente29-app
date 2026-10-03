// src/modules/conta/pages/AltaPage.tsx
//
// La ruta del alta (respuesta 3 del C00). Elige el marco de la conversación:
//   · la cuenta aún no tiene ninguna empresa dada de alta → pantalla completa
//     (maqueta N1bAlta);
//   · ya tiene alguna → ventana flotante sobre «Tu empresa», atenuada detrás
//     (maqueta N1cAlta). Cerrar guarda y deja en «Tu empresa».
//   · En el móvil, siempre a pantalla completa.
//
// La conversación es la misma en los dos: alta/ConversacionAlta.tsx.

import { useState } from 'react'
import { useIsMobile } from '@/shell/useIsMobile'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { ConversacionAlta } from '@/modules/conta/alta/ConversacionAlta'
import { MarcoConta } from '@/modules/conta/marco/MarcoConta'
import TuEmpresaPage from '@/modules/conta/pages/TuEmpresaPage'

export default function AltaPage() {
  const movil = useIsMobile()
  const { empresas, cargando } = useEmpresas()
  // El marco se decide UNA vez, al cargar: al terminar la primera empresa la
  // cuenta ya «tiene otra», y cambiar de marco ahí borraría la conversación.
  const [marco, setMarco] = useState<'pantalla' | 'ventana' | null>(null)
  if (marco === null && !cargando) setMarco(empresas.some((e) => e.completa) ? 'ventana' : 'pantalla')
  if (marco === null) return <ConversacionAlta marco="pantalla" />
  if (movil || marco === 'pantalla') return <ConversacionAlta marco="pantalla" />
  return (
    <>
      {/* Folvy detrás, atenuado y sin poder tocarse: la ventana manda. */}
      <div inert aria-hidden="true" className="cx-alta-detras">
        <MarcoConta ejemplo="Añade a Pablo como apoderado"><TuEmpresaPage /></MarcoConta>
      </div>
      <ConversacionAlta marco="ventana" />
    </>
  )
}
