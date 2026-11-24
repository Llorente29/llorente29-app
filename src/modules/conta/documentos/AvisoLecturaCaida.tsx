// src/modules/conta/documentos/AvisoLecturaCaida.tsx
//
// E02 · La franja de arriba de Documentos y de Facturas recibidas mientras la
// lectura de facturas está caída (para todos): una frase y nada más, sin botón,
// sin aspa y sin código de error. Dice cuántas de ESTA empresa esperan. Se mira
// cada minuto: cuando la lectura vuelve, se quita sola. No esconde nada (regla
// 7): las llegadas sin leer siguen en su lista, con su etiqueta.
//
// La franja es la de los avisos de una página del sistema de diseño
// (.s-aviso-lista, tono «duda», ámbar). En el móvil va en su sitio, sin fijarse.
//
// Nombre dentro de cadena (regla 40): conta_lectura_estado, de la 20261118T0600 (E02).

import { useEffect, useState } from 'react'
import { rpc } from '@/modules/conta/services/bd'
import { FRASE_CAIDA } from '../../../../supabase/functions/_shared/lecturaFallo'

const CADA_MS = 60_000

export function AvisoLecturaCaida({ companyId }: { companyId: string | null | undefined }) {
  const [estado, setEstado] = useState<{ caida: boolean; esperando: number } | null>(null)
  useEffect(() => {
    if (!companyId) return
    let vivo = true
    const mirar = () => rpc<{ caida: boolean; esperando: number }>('conta_lectura_estado', { p_company: companyId })
      .then((r) => { if (vivo) setEstado({ caida: !!r?.caida, esperando: Number(r?.esperando ?? 0) }) })
      .catch(() => { /* si no se puede mirar, no se pinta nada: no es un aviso que interrumpa */ })
    mirar()
    const t = setInterval(mirar, CADA_MS)
    return () => { vivo = false; clearInterval(t) }
  }, [companyId])
  if (!estado?.caida) return null
  const n = estado.esperando
  return (
    <p className="s-aviso-lista" data-tono="duda" role="status" data-prueba="aviso-lectura-caida">
      {FRASE_CAIDA}{n > 0 ? ` ${n === 1 ? 'Va 1 esperando' : `Van ${n} esperando`}.` : ''}
    </p>
  )
}
