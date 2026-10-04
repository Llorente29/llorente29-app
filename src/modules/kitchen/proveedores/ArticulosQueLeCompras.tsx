// src/modules/kitchen/proveedores/ArticulosQueLeCompras.tsx
//
// «Artículos que le compras» dentro de la ficha de proveedor del estilo nuevo
// (C01b): lo que hacía la pantalla vieja de Cocina sigue aquí, como bloque
// propio. Los artículos, su precio pactado y el principal se gestionan con
// SupplierItemsSection (la misma pieza de antes); «Migrar artículos» pasa a
// la ventana del estilo nuevo con la misma previsualización de siempre.
// Plegado por defecto cuando le compras más de 10 artículos (encargo §5).
//
// Es Cocina quien le da esta pieza a la ficha (extensiones): la ficha no
// importa nada de Cocina.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getSupplierById, listLinksBySupplier, listSuppliers, migrateSupplierArticles, previewSupplierMigration, updateSupplier,
  type SupplierMigrationPreview, type SupplierMigrationResult,
} from '@/modules/kitchen/services/purchaseFormatService'
import SupplierItemsSection from '@/modules/kitchen/components/SupplierItemsSection'
import { Dialogo } from '@/modules/conta/proveedor/piezas'
import { rutaListaProveedores } from '@/config/navegacion'
import type { ContextoExtension } from '@/modules/conta/extensiones'
import type { Supplier } from '@/types/kitchen'

const PLEGADO_DESDE = 10

export default function ArticulosQueLeCompras({ ctx }: { ctx: ContextoExtension }) {
  const [proveedor, setProveedor] = useState<Supplier | null>(null)
  const [cuantos, setCuantos] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [migrar, setMigrar] = useState(false)
  const [vuelta, setVuelta] = useState(0)

  useEffect(() => {
    let vivo = true
    Promise.all([getSupplierById(ctx.supplierId), listLinksBySupplier(ctx.supplierId)])
      .then(([s, links]) => { if (vivo) { setProveedor(s); setCuantos(links.length) } })
      .catch((e) => { if (vivo) setError(e instanceof Error ? e.message : 'No se pudieron cargar sus artículos.') })
    return () => { vivo = false }
  }, [ctx.supplierId, vuelta])

  const alCambiar = useCallback(() => { setVuelta((v) => v + 1); ctx.alCambiar() }, [ctx])

  if (error) return <section className="cx-tarjeta"><div className="cx-error" role="alert">{error}</div></section>
  if (!proveedor || cuantos === null) return <section className="cx-tarjeta" aria-busy="true"><span className="cx-hueso" style={{ height: 22, width: 240 }} /></section>

  return (
    <section className="cx-tarjeta" aria-labelledby="cxp-articulos">
      <details className="cxp-plegable" open={cuantos <= PLEGADO_DESDE}>
        <summary>
          <h2 id="cxp-articulos" className="cx-tarjeta-titulo">Artículos que le compras</h2>
          <span className="cx-ayuda">{cuantos === 1 ? '1 artículo' : `${cuantos} artículos`}</span>
        </summary>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 8 }}>
          {/* La pieza de Cocina de siempre: precio pactado, principal y quitar. */}
          <SupplierItemsSection supplier={proveedor} onChanged={alCambiar} sinCabecera />
          {cuantos > 0 && (
            <button type="button" className="cx-boton-sec" style={{ alignSelf: 'flex-start' }} onClick={() => setMigrar(true)}>
              Migrar artículos a otro proveedor
            </button>
          )}
        </div>
      </details>
      {migrar && <MigrarArticulos origen={proveedor} alCerrar={() => { setMigrar(false); alCambiar() }} />}
    </section>
  )
}

// Origen = el proveedor abierto. Se elige el destino → previsualización
// (cuántos se mueven, cuántos se fusionan) → confirmación reforzada → migra
// (modo 'fill': rellena huecos en las colisiones) → ofrece archivar el origen,
// que queda vacío. La previsualización ES el guardián: se ve qué va a pasar
// antes de tocar nada. Misma lógica que la pantalla vieja.
function MigrarArticulos({ origen, alCerrar }: { origen: Supplier; alCerrar: () => void }) {
  const navigate = useNavigate()
  const [todos, setTodos] = useState<Supplier[]>([])
  const [destId, setDestId] = useState('')
  const [preview, setPreview] = useState<SupplierMigrationPreview | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const [migrando, setMigrando] = useState(false)
  const [resultado, setResultado] = useState<SupplierMigrationResult | null>(null)
  const [archivando, setArchivando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    listSuppliers(origen.accountId).then((s) => { if (vivo) setTodos(s) }).catch(() => { if (vivo) setTodos([]) })
    return () => { vivo = false }
  }, [origen.accountId])

  const destinos = useMemo(() => todos.filter((s) => s.id !== origen.id), [todos, origen.id])
  const destNombre = destinos.find((s) => s.id === destId)?.name ?? ''

  function elegir(id: string) {
    setDestId(id); setConfirmando(false); setPreview(null); setError(null)
    if (!id) return
    setPreviewing(true)
    previewSupplierMigration(origen.id, id)
      .then(setPreview)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'No se pudo previsualizar.'))
      .finally(() => setPreviewing(false))
  }

  async function migrarYa() {
    setMigrando(true); setError(null)
    try { setResultado(await migrateSupplierArticles(origen.id, destId, 'fill')) }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo migrar.') }
    finally { setMigrando(false) }
  }

  async function archivarOrigen() {
    setArchivando(true); setError(null)
    try {
      await updateSupplier(origen.id, { isActive: false, archivedAt: new Date().toISOString() })
      navigate(rutaListaProveedores(), { state: { aviso: `${origen.name} archivado tras mover sus artículos a ${destNombre}. Está en «Archivados».` } })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo archivar.')
      setArchivando(false)
    }
  }

  return (
    <Dialogo titulo="Migrar artículos a otro proveedor" alCerrar={alCerrar}>
      {!resultado ? (
        <>
          <p style={{ margin: 0, fontSize: 15 }}>Mover todos los artículos de <strong>{origen.name}</strong> a otro proveedor.</p>
          <div className="cx-campo">
            <label htmlFor="migrar-destino">Mover a</label>
            <select id="migrar-destino" className="cx-input" value={destId} disabled={migrando} onChange={(e) => elegir(e.target.value)}>
              <option value="">Elige el proveedor destino</option>
              {destinos.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            {destinos.length === 0 && <span className="cx-ayuda">No hay otros proveedores a los que mover.</span>}
          </div>
          {previewing && <div role="status" className="cx-ayuda">Calculando…</div>}
          {preview && !previewing && (
            <div className="cx-tarjeta" style={{ padding: '12px 14px', fontSize: 15 }}>
              {preview.origenTotal === 0 ? <span className="cx-ayuda">Este proveedor no tiene artículos que mover.</span> : (
                <>
                  <div>· <strong>{preview.migranLimpio}</strong> se mueven directamente.</div>
                  {preview.colisiones > 0 && (
                    <div>· <strong>{preview.colisiones}</strong> ya existen en {destNombre}: se fusionan conservando los datos del destino y rellenando solo lo que le falte.</div>
                  )}
                  <div className="cx-ayuda" style={{ paddingTop: 4 }}>Se recalculará el coste de {preview.origenTotal} artículo(s) y de los platos que los usan.</div>
                </>
              )}
            </div>
          )}
          {confirmando && preview && preview.origenTotal > 0 && (
            <div className="cx-aviso">Vas a mover {preview.origenTotal} artículo(s) a {destNombre}. ¿Confirmas?</div>
          )}
          {error && <div className="cx-error" role="alert">{error}</div>}
          <div className="cx-pie">
            <button type="button" className="cx-boton-sec" onClick={alCerrar} disabled={migrando}>Cancelar</button>
            {!confirmando
              ? <button type="button" className="cx-boton" disabled={!destId || previewing || !preview || preview.origenTotal === 0} onClick={() => setConfirmando(true)}>Migrar</button>
              : <button type="button" className="cx-boton" disabled={migrando} onClick={migrarYa}>{migrando ? 'Migrando…' : 'Sí, migrar'}</button>}
          </div>
        </>
      ) : (
        <>
          <div role="status" className="cx-guardado">
            Listo: {resultado.moved} movido(s){resultado.merged > 0 ? `, ${resultado.merged} fusionado(s)` : ''} a {destNombre}. Costes recalculados.
          </div>
          <p style={{ margin: 0, fontSize: 15 }}>{origen.name} se ha quedado sin artículos. ¿Quieres archivarlo?</p>
          {error && <div className="cx-error" role="alert">{error}</div>}
          <div className="cx-pie">
            <button type="button" className="cx-boton-sec" onClick={alCerrar}>Cerrar</button>
            <button type="button" className="cx-boton" disabled={archivando} onClick={archivarOrigen}>{archivando ? 'Archivando…' : `Archivar ${origen.name}`}</button>
          </div>
        </>
      )}
    </Dialogo>
  )
}
