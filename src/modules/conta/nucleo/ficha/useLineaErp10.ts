// src/modules/conta/nucleo/ficha/useLineaErp10.ts
//
// X10f (20/11) · Lo que la ficha sabe de ERP10 de un asiento: para su línea (LineaErp10) y para avisar al
// anular. Mientras sale (o se va a reintentar sola), se vuelve a mirar cada 10 segundos, sin parpadear:
// se enseña lo último leído hasta que llega lo nuevo.

import { useEffect, useState } from 'react'
import { useLeerConservando } from '@/modules/conta/libros/contexto'
import { lineaErp10, type Linea } from '@/modules/conta/erp10/salidaSola'
import { leerLineaErp10 } from '@/modules/conta/services/erp10ApiService'

const CADA_MS = 10_000

export function useLineaErp10(o: { accountId: string | null; companyId: string | null; entryId: string | null; validado: boolean; fecha: string | null }) {
  const { accountId, companyId, entryId, validado, fecha } = o
  const [vuelta, setVuelta] = useState(0)
  const leido = useLeerConservando(accountId && companyId && entryId && validado ? () => leerLineaErp10(accountId, companyId, entryId) : null,
    `${accountId}:${companyId}:${entryId}:erp10:${vuelta}`, `${entryId}`)
  const datos = validado ? leido.datos : null
  const linea: Linea | null = datos && fecha ? lineaErp10({ ...datos, validado, fecha }) : null
  useEffect(() => {
    if (!linea?.vigilar) return
    const t = setTimeout(() => setVuelta((v) => v + 1), CADA_MS)
    return () => clearTimeout(t)
  }, [linea?.vigilar, linea?.texto, vuelta])
  return { datos, linea, releer: () => setVuelta((v) => v + 1) }
}
