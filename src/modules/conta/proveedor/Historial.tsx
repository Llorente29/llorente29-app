// src/modules/conta/proveedor/Historial.tsx
//
// Lo que ha pasado con este proveedor. Arriba, «Lo que ha hecho Folvy»: lo
// que ha aprendido u olvidado de sus facturas, y cuándo alguien lo cambió a
// mano (supplier_learning_log, C01b tarea 5). Debajo, lo que hicieron las
// personas: alta, contactos, datos confirmados o descartados, pagos y cambios
// de vencimiento, cada uno de la tabla que lo guarda (listarHistorial).

import { useEffect, useState } from 'react'
import { useFicha } from '@/modules/conta/proveedor/contexto'
import { ErrorConReintento, TarjetaCargando, Vacio } from '@/modules/conta/ui/piezas'
import { listarHechoPorFolvy, listarHistorial, type HechoPorFolvy, type Suceso } from '@/modules/conta/services/proveedorService'

const cuando = (iso: string) =>
  new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))

const QUE: Record<HechoPorFolvy['que'], string> = {
  aprendido: 'Aprendido',
  olvidado: 'Olvidado',
  fijado_a_mano: 'Cambiado a mano',
  devuelto_a_folvy: 'Devuelto a Folvy',
}

export default function Historial() {
  const { datos } = useFicha()
  const [sucesos, setSucesos] = useState<Suceso[] | null>(null)
  const [folvy, setFolvy] = useState<HechoPorFolvy[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [vuelta, setVuelta] = useState(0)

  useEffect(() => {
    let vivo = true
    Promise.all([listarHistorial(datos.ficha.accountId, datos.ficha, datos.facturas), listarHechoPorFolvy(datos.ficha.id)])
      .then(([s, f]) => { if (vivo) { setSucesos(s); setFolvy(f) } })
      .catch((e) => { if (vivo) setError(e instanceof Error ? e.message : 'No se pudo cargar el historial.') })
    return () => { vivo = false }
  }, [datos.ficha, datos.facturas, vuelta])

  if (error) return <ErrorConReintento mensaje={error} reintentar={() => { setError(null); setSucesos(null); setVuelta((v) => v + 1) }} />
  if (!sucesos || !folvy) return <TarjetaCargando />
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
    <section className="cxp-aprendido" aria-labelledby="cxp-hecho-folvy">
      <div className="cxp-aprendido-cabeza">
        <span className="cx-ia-punto" aria-hidden="true" />
        <h2 id="cxp-hecho-folvy">Lo que ha hecho Folvy</h2>
      </div>
      {folvy.length === 0 && <p className="cxp-aprendido-vacio" style={{ margin: 0 }}>Aún no ha aprendido nada de este proveedor.</p>}
      {folvy.map((h, i) => (
        <div key={i} className="cxp-aprendido-fila">
          <div className="cxp-aprendido-texto">
            <span className="cxp-aprendido-que">{QUE[h.que]}{h.etiqueta ? `: ${h.etiqueta}` : ''}</span>
            <span className="cxp-aprendido-porque">{h.porque} · {cuando(h.cuando)}{h.quien ? ` · ${h.quien}` : ''}</span>
          </div>
        </div>
      ))}
    </section>
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
    </div>
  )
}
