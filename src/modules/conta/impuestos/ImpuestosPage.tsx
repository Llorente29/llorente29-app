// src/modules/conta/impuestos/ImpuestosPage.tsx
//
// I01b · Impuestos (tableros 8, 9 y 10). Una pantalla por pestaña de la
// cabecera (productos.ts): Calendario, Presentados, Impuesto de sociedades y
// Certificados y accesos; y Trimestre (I01c), que tiene su ruta. El IVA de un periodo
// (impuestos/iva/2026/3T) cuelga del Calendario.
//
// Los datos los lee la pantalla de cada pestaña; aquí solo se elige cuál.

import { useParams } from 'react-router-dom'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { Tarjeta } from '@/modules/conta/diseno'
import { Calendario } from './Calendario'
import { Certificados } from './Certificados'
import { Presentados } from './Presentados'
import { Sociedades } from './Sociedades'
import { TrimestrePorDefecto } from './TrimestrePage'
import { Despacho } from './despacho/Despacho'

export default function ImpuestosPage() {
  const { pestana } = useParams<{ pestana?: string }>()
  const { activa } = useEmpresas()
  const { accountId } = useCuentaConta()
  // P01 · Los impuestos de los clientes de una asesoría: no dependen de su propia empresa.
  if (pestana === 'clientes') return accountId ? <Despacho accountId={accountId} /> : null
  if (!activa) {
    return (
      <div className="s-pantalla">
        <h1 className="cx-oculto">Impuestos</h1>
        <Tarjeta titulo="Aún no hay ninguna empresa">
          <p className="s-apoyo">Da de alta tu empresa y aquí verás qué impuestos le tocan y cuándo.</p>
        </Tarjeta>
      </div>
    )
  }
  // impuestos/trimestre sin año ni trimestre: al último acabado (TrimestrePage, I01c).
  if (pestana === 'trimestre') return <TrimestrePorDefecto />
  if (pestana === 'sociedades') return <Sociedades companyId={activa.id} />
  if (pestana === 'presentados') return <Presentados companyId={activa.id} />
  if (pestana === 'certificados') return <Certificados companyId={activa.id} />
  return <Calendario companyId={activa.id} />
}
