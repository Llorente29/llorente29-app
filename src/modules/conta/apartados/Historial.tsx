// src/modules/conta/apartados/Historial.tsx
//
// Lo que ha pasado con este proveedor: alta, contactos, datos confirmados o
// descartados, pagos y cambios de vencimiento. Cada suceso sale de la tabla
// que lo guarda (ver listarHistorial); no hay una tabla de historial aparte.

import { useEffect, useState } from 'react'
import { useFicha } from '@/modules/conta/components/FichaContexto'
import { ErrorConReintento, Hueso } from '@/modules/conta/components/ui'
import { listarHistorial, type Suceso } from '@/modules/conta/services/proveedorService'

const cuando = (iso: string) =>
  new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))

export default function Historial() {
  const { datos } = useFicha()
  const [sucesos, setSucesos] = useState<Suceso[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [vuelta, setVuelta] = useState(0)

  useEffect(() => {
    let vivo = true
    listarHistorial(datos.ficha.accountId, datos.ficha, datos.facturas)
      .then((s) => { if (vivo) setSucesos(s) })
      .catch((e) => { if (vivo) setError(e instanceof Error ? e.message : 'No se pudo cargar el historial.') })
    return () => { vivo = false }
  }, [datos.ficha, datos.facturas, vuelta])

  if (error) return <ErrorConReintento mensaje={error} alReintentar={() => { setError(null); setSucesos(null); setVuelta((v) => v + 1) }} />
  if (!sucesos) return <div aria-busy="true"><Hueso alto={44} /><div style={{ height: 8 }} /><Hueso alto={44} /></div>
  if (sucesos.length === 0) return <p className="cf-nota">Aún no hay nada apuntado.</p>
  return (
    <div className="cf-tarjeta" style={{ gap: 0, maxWidth: 820 }}>
      {sucesos.map((s, i) => (
        <div key={i} className="cf-suceso">
          <span className="cf-nota">{cuando(s.cuando)}</span>
          <span>{s.que}{s.quien ? <span className="cf-nota"> · {s.quien}</span> : null}</span>
        </div>
      ))}
    </div>
  )
}
