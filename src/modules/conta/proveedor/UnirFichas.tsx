// src/modules/conta/proveedor/UnirFichas.tsx
//
// «Unir con otra ficha» (encargo de compras, pantalla no dibujada, en el
// estilo de la ficha): el mismo proveedor dado de alta dos veces. Queda ESTA
// ficha; la otra se archiva y todo lo suyo pasa aquí (supplier_merge_do, 0100,
// que también mueve lo de compras desde la 0120). Lo que no se puede mover
// porque esta ya lo tiene, se queda en la archivada y se dice. Se puede
// deshacer (supplier_merge_undo).

import { useEffect, useMemo, useState } from 'react'
import { Dialogo } from '@/modules/conta/proveedor/piezas'
import { listarProveedores } from '@/modules/conta/services/proveedorService'
import { unirFichas } from '@/modules/conta/services/comprasService'
import { normalizarNif } from '@/modules/conta/lib/nif'

export default function UnirFichas({ accountId, queda, nombre, nif, alCerrar, alUnir }: {
  accountId: string; queda: string; nombre: string; nif: string | null
  alCerrar: () => void
  alUnir: (r: { fusion: string; resumen: string }) => void
}) {
  const [otras, setOtras] = useState<{ id: string; name: string; taxId: string | null }[]>([])
  const [seVa, setSeVa] = useState('')
  const [fallo, setFallo] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  useEffect(() => {
    listarProveedores(accountId).then((ps) => setOtras(ps.filter((p) => p.id !== queda).map((p) => ({ id: p.id, name: p.name, taxId: p.taxId }))))
      .catch((e: unknown) => setFallo(e instanceof Error ? e.message : String(e)))
  }, [accountId, queda])

  // Primero las que tienen su mismo NIF: ordena, no decide (regla 7).
  const ordenadas = useMemo(() => {
    const mio = nif ? normalizarNif(nif) : null
    return [...otras].sort((a, b) => {
      const ma = mio && a.taxId && normalizarNif(a.taxId) === mio ? 0 : 1
      const mb = mio && b.taxId && normalizarNif(b.taxId) === mio ? 0 : 1
      return ma - mb || a.name.localeCompare(b.name, 'es')
    })
  }, [otras, nif])
  const elegida = otras.find((o) => o.id === seVa)

  return (
    <Dialogo titulo={`Unir con otra ficha de ${nombre}`} alCerrar={alCerrar}>
      <p style={{ margin: 0 }}>Para cuando el mismo proveedor está dado de alta dos veces. Se queda esta ficha; la otra se archiva y sus recepciones, facturas, artículos y contactos pasan aquí. Se puede deshacer.</p>
      <label className="cx-campo">
        <span className="cx-etiqueta">La otra ficha</span>
        <select className="cx-input" value={seVa} onChange={(e) => setSeVa(e.target.value)}>
          <option value="">Elige cuál</option>
          {ordenadas.map((o) => <option key={o.id} value={o.id}>{o.name}{o.taxId ? ` · ${o.taxId}` : ''}</option>)}
        </select>
      </label>
      {elegida && <p className="cx-aviso" style={{ margin: 0 }}>«{elegida.name}» se archivará y todo lo suyo pasará a «{nombre}».</p>}
      {fallo && <div className="cx-error" role="alert">{fallo}</div>}
      <div className="cx-pie">
        <button type="button" className="cx-boton-sec" onClick={alCerrar}>Cancelar</button>
        <button type="button" className="cx-boton" disabled={!seVa || ocupado} onClick={async () => {
          setOcupado(true); setFallo(null)
          try { alUnir(await unirFichas(queda, seVa)) }
          catch (e) { setFallo(e instanceof Error ? e.message : 'No se pudieron unir.') }
          finally { setOcupado(false) }
        }}>{ocupado ? 'Uniendo…' : 'Unir'}</button>
      </div>
    </Dialogo>
  )
}
