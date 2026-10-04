// src/modules/conta/proveedor/Historial.tsx
//
// Lo que ha pasado con este proveedor: alta, contactos, datos confirmados o
// descartados, pagos y cambios de vencimiento. Cada suceso sale de la tabla
// que lo guarda (listarHistorial); no hay una tabla de historial aparte.

import { useEffect, useState } from 'react'
import { useFicha } from '@/modules/conta/proveedor/contexto'
import { ErrorConReintento, TarjetaCargando, Vacio } from '@/modules/conta/ui/piezas'
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

  if (error) return <ErrorConReintento mensaje={error} reintentar={() => { setError(null); setSucesos(null); setVuelta((v) => v + 1) }} />
  if (!sucesos) return <TarjetaCargando />
  return (
    <div className="cx-tarjeta" style={{ padding: '6px 18px' }}>
      {sucesos.length === 0 && <div style={{ padding: '12px 0' }}><Vacio titulo="Aún no hay nada apuntado." explicacion="Aquí sale quién lo dio de alta, quién confirmó sus datos y quién apuntó sus pagos." /></div>}
      {sucesos.map((s, i) => (
        <div key={i} className="cxp-contacto">
          <div className="cxp-contacto-texto">
            <div style={{ fontSize: 15 }}>{s.que}</div>
            <div className="cxp-contacto-apoyo">{cuando(s.cuando)}{s.quien ? ` · ${s.quien}` : ''}</div>
          </div>
        </div>
      ))}
    </div>
  )
}
