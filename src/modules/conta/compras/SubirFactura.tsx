// src/modules/conta/compras/SubirFactura.tsx
//
// Compras · subir una factura que llega sin recepción, y casarla con sus
// albaranes (pantallas no dibujadas, en el estilo de N18). Tres pasos:
//
//   1. Leer: el papel pasa por ocr-albaran (el mismo lector de las
//      recepciones) y el proveedor se casa por su NIF o su nombre.
//   2. Registrar: compras_factura_desde_papel (0140), que no crea dos veces la
//      misma factura y la deja «en revisión». Lo que contesta, se enseña.
//   3. Casar: compras_casar_candidatos propone las de su local; al casar,
//      compras_casar dice si cuadra o cuánto se diferencia (regla 8).
//
// S01d: si el proveedor no está, se da de alta aquí mismo (el formulario de
// Proveedores, con el nombre y el NIF que leyó el papel), se recarga la lista
// y queda elegido; y se dice.

import { useEffect, useMemo, useState } from 'react'
import { Dialogo } from '@/modules/conta/proveedor/piezas'
import { FormularioAltaProveedor } from '@/modules/conta/proveedor/NuevoProveedorDialogo'
import { fraseAltaEnFactura, textoBotonAlta } from '@/modules/conta/lib/altaProveedor'
import { eurosExactos } from '@/modules/conta/lib/formato'
import { diaCorto, elDocumento, mayuscula, papelConArticulo } from '@/modules/conta/lib/compras'
import { scanReceipt } from '@/modules/supply/services/goodsReceiptService'
import { resolveInvoiceHeader } from '@/modules/supply/services/supplierInvoiceService'
import { listarLocales, listarProveedores } from '@/modules/conta/services/proveedorService'
import { useAnalitica } from '@/modules/conta/marco/nuevo/contexto'
import {
  candidatasDeFactura, casarFactura, facturaDesdePapel, type Candidata, type ResultadoFactura,
} from '@/modules/conta/services/comprasService'

type Paso =
  | { que: 'elegir' }
  | { que: 'leyendo' }
  | { que: 'leida'; sesion: string; tipo: string | null; numero: string | null; base: number | null; total: number | null; proveedorLeido: string | null; nifLeido: string | null }
  | { que: 'casar'; factura: string; motivo: string; candidatas: Candidata[] }
  | { que: 'hecho'; frase: string }

interface Leido { paso: Paso; proveedor: string | null; local: string | null }

/** Sube y lee el papel (ocr-albaran) y casa su cabecera con tus proveedores. */
async function leerPapel(accountId: string, fs: File[]): Promise<Leido> {
  const r = await scanReceipt(accountId, fs)
  const cab = await resolveInvoiceHeader(accountId, r.document)
  return {
    proveedor: cab.supplierId || null, local: cab.locationId || null,
    paso: {
      que: 'leida', sesion: r.sessionId, tipo: r.document.doc_type ?? null, numero: cab.invoiceNumber,
      base: cab.taxBaseTotal, total: cab.grandTotal, proveedorLeido: cab.unmatchedSupplier ? cab.proposedSupplierName : null,
      nifLeido: cab.unmatchedSupplier ? cab.proposedSupplierNif : null,
    },
  }
}

export default function SubirFactura({ accountId, empresaId, ficheros, alCerrar, alTerminar }: {
  accountId: string
  empresaId: string | null
  /** Si llegan ya (soltados en la zona), se leen sin pedirlos otra vez. */
  ficheros?: File[]
  alCerrar: () => void
  /** Se llama con la frase de lo que ha pasado, para el aviso de la página. */
  alTerminar: (frase: string) => void
}) {
  const [paso, setPaso] = useState<Paso>(ficheros && ficheros.length > 0 ? { que: 'leyendo' } : { que: 'elegir' })
  const [fallo, setFallo] = useState<string | null>(null)
  const [proveedores, setProveedores] = useState<{ id: string; name: string; taxId: string | null }[]>([])
  const [locales, setLocales] = useState<{ id: string; name: string }[]>([])
  const [proveedor, setProveedor] = useState('')
  const [local, setLocal] = useState('')
  // S01: con el eje «local» apagado (Definiciones › Analítica), ni se pide ni se guarda.
  const { local: ejeLocal } = useAnalitica()
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set())
  const [ocupado, setOcupado] = useState(false)
  // S01d: el alta del proveedor que no está, dentro de este mismo diálogo.
  const [alta, setAlta] = useState(false)
  const [altaHecha, setAltaHecha] = useState<string | null>(null)

  async function dadoDeAlta(p: { id: string; name: string; taxId: string | null }) {
    setAlta(false); setFallo(null)
    // La lista otra vez, de la base; si no contesta, el nuevo se añade a mano: ya existe.
    try {
      const ps = await listarProveedores(accountId)
      setProveedores(ps.map((x) => ({ id: x.id, name: x.name, taxId: x.taxId })))
    } catch {
      setProveedores((ps) => [...ps.filter((x) => x.id !== p.id), { id: p.id, name: p.name, taxId: p.taxId }].sort((a, b) => a.name.localeCompare(b.name)))
    }
    setProveedor(p.id)
    setAltaHecha(fraseAltaEnFactura(p.name))
  }

  useEffect(() => {
    let vivo = true
    Promise.all([listarProveedores(accountId), listarLocales(accountId)]).then(([ps, ls]) => {
      if (!vivo) return
      setProveedores(ps.map((p) => ({ id: p.id, name: p.name, taxId: p.taxId })))
      setLocales(ls)
      if (ls.length === 1) setLocal(ls[0].id)
    }).catch((e: unknown) => { if (vivo) setFallo(e instanceof Error ? e.message : String(e)) })
    return () => { vivo = false }
  }, [accountId])

  function aplicar(l: Leido) {
    if (l.proveedor) setProveedor(l.proveedor)
    if (l.local) setLocal(l.local)
    setPaso(l.paso)
  }
  function noLeido(e: unknown) {
    setFallo(e instanceof Error ? e.message : 'No se pudo leer la factura.')
    setPaso({ que: 'elegir' })
  }
  function leer(fs: File[]) {
    if (fs.length === 0) return
    setFallo(null); setPaso({ que: 'leyendo' })
    leerPapel(accountId, fs).then(aplicar, noLeido)
  }

  // Lo soltado en la zona empieza a leerse al abrir (el diálogo ya está en «leyendo»).
  const [inicio] = useState(() => (ficheros && ficheros.length > 0 ? leerPapel(accountId, ficheros) : null))
  useEffect(() => {
    if (!inicio) return
    let vivo = true
    inicio.then((l) => { if (vivo) aplicar(l) }, (e: unknown) => { if (vivo) noLeido(e) })
    return () => { vivo = false }
  }, [inicio])

  async function registrar(sesion: string) {
    if (!proveedor) { setFallo('Elige de qué proveedor es.'); return }
    setOcupado(true); setFallo(null)
    try {
      const r: ResultadoFactura = await facturaDesdePapel(sesion, proveedor, ejeLocal ? local || null : null, empresaId)
      if (!r.factura) { setFallo(r.motivo); return }
      const cs = await candidatasDeFactura(r.factura)
      setMarcadas(new Set(cs.filter((c) => c.proposed).map((c) => c.goods_receipt_id)))
      setPaso({ que: 'casar', factura: r.factura, motivo: r.motivo, candidatas: cs })
    } catch (e) {
      setFallo(e instanceof Error ? e.message : 'No se pudo registrar la factura.')
    } finally { setOcupado(false) }
  }

  const nombreLocal = useMemo(() => new Map(locales.map((l) => [l.id, l.name])), [locales])

  return (
    // S01e: con su ✕ y su «Cancelar» a la vista (en el móvil no se veía cómo salir); Escape también cierra.
    <Dialogo titulo="Subir una factura" alCerrar={alCerrar} cerrable>
      <div className="cxc-pasos">
        {paso.que === 'elegir' && (
          <>
            <p style={{ margin: 0 }}>Una factura que llega por correo o impresa, sin recepción. La leo, busco a qué albaranes corresponde y te digo si cuadra.</p>
            <label className="cx-campo">
              <span className="cx-etiqueta">La factura (foto o PDF)</span>
              <input type="file" accept="image/*,application/pdf" multiple className="cx-input"
                onChange={(e) => leer(Array.from(e.target.files ?? []))} />
            </label>
            <div className="cx-pie"><button type="button" className="cx-boton-sec" onClick={alCerrar}>Cancelar</button></div>
          </>
        )}
        {paso.que === 'leyendo' && <p role="status" style={{ margin: 0 }}>Leyendo la factura…</p>}
        {paso.que === 'leida' && (
          <>
            <p style={{ margin: 0 }}>
              Es {papelConArticulo(paso.tipo)}{paso.numero ? ` con número ${paso.numero}` : ' sin número'}
              {paso.base != null ? `, ${eurosExactos(paso.base)} de base` : ''}{paso.total != null ? ` y ${eurosExactos(paso.total)} en total` : ''}.
              {paso.tipo && paso.tipo !== 'factura' && paso.tipo !== 'albaran_factura' ? ' No parece una factura: si lo es, sigue; si es un albarán, súbelo como recepción desde el local.' : ''}
            </p>
            {paso.proveedorLeido && !altaHecha && !alta && <p className="cx-aviso" style={{ margin: 0 }}>{mayuscula(elDocumento(paso.tipo))} dice «{paso.proveedorLeido}» y no lo encuentro entre tus proveedores. Elige cuál es o dalo de alta aquí mismo.</p>}
            {altaHecha && <p role="status" className="cx-guardado" style={{ margin: 0 }}>{altaHecha}</p>}
            {alta ? (
              <div role="group" aria-label="Nuevo proveedor" className="cx-campo">
                <span className="cx-etiqueta">Nuevo proveedor</span>
                <FormularioAltaProveedor accountId={accountId} otros={proveedores} nombreInicial={paso.proveedorLeido} nifInicial={paso.nifLeido}
                  textoCrear="Dar de alta y elegirlo" alCancelar={() => setAlta(false)} alCrear={(p) => void dadoDeAlta(p)} />
              </div>
            ) : (
              <>
                <label className="cx-campo">
                  <span className="cx-etiqueta">Proveedor</span>
                  <select className="cx-input" value={proveedor} onChange={(e) => setProveedor(e.target.value)}>
                    <option value="">Elige uno</option>
                    {proveedores.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
                {!altaHecha && (
                  <button type="button" className="cx-enlace" style={{ alignSelf: 'flex-start' }} onClick={() => { setFallo(null); setAlta(true) }}>
                    {textoBotonAlta(paso.proveedorLeido)}
                  </button>
                )}
              </>
            )}
            {ejeLocal && (
              <label className="cx-campo">
                <span className="cx-etiqueta">{ejeLocal.nombre}</span>
                <select className="cx-input" value={local} onChange={(e) => setLocal(e.target.value)}>
                  <option value="">De todos (sin {ejeLocal.nombre.toLowerCase()})</option>
                  {locales.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </label>
            )}
            {!alta && <div className="cx-pie">
              <button type="button" className="cx-boton-sec" onClick={alCerrar}>Cancelar</button>
              <button type="button" className="cx-boton" disabled={ocupado} onClick={() => void registrar(paso.sesion)}>
                {ocupado ? 'Registrando…' : 'Registrar la factura'}
              </button>
            </div>}
          </>
        )}
        {paso.que === 'casar' && (
          <>
            <p role="status" style={{ margin: 0 }}>{paso.motivo}</p>
            {paso.candidatas.length === 0 ? (
              <>
                <p style={{ margin: 0 }}>No hay albaranes suyos esperando factura. Si es un gasto sin género (el alquiler, la luz), ya está: queda en revisión con las demás.</p>
                <div className="cx-pie"><button type="button" className="cx-boton" onClick={() => alTerminar(paso.motivo)}>Hecho</button></div>
              </>
            ) : (
              <>
                <p style={{ margin: 0 }}>¿A qué albaranes corresponde? Marco los de su local; cambia lo que no sea.</p>
                <div role="group" aria-label="Albaranes que esperan su factura">
                  {paso.candidatas.map((c) => (
                    <label key={c.goods_receipt_id} className="cxc-candidata">
                      <input type="checkbox" checked={marcadas.has(c.goods_receipt_id)} onChange={(e) => {
                        const n = new Set(marcadas)
                        if (e.target.checked) n.add(c.goods_receipt_id); else n.delete(c.goods_receipt_id)
                        setMarcadas(n)
                      }} />
                      <span className="cxc-candidata-texto">
                        {c.code ?? 'Recepción'} · {diaCorto(c.receipt_date)}{c.location_id ? ` · ${nombreLocal.get(c.location_id) ?? 'otro local'}` : ''}
                      </span>
                      <span className="cx-cifra">{c.base == null ? 'sin importe' : eurosExactos(c.base)}</span>
                    </label>
                  ))}
                </div>
                <p className="cx-ayuda" style={{ margin: 0 }}>
                  Marcadas: {marcadas.size}, por {eurosExactos(paso.candidatas.filter((c) => marcadas.has(c.goods_receipt_id)).reduce((s, c) => s + (c.base ?? 0), 0))}.
                </p>
                <div className="cx-pie">
                  <button type="button" className="cx-boton-sec" onClick={() => alTerminar(`${paso.motivo} Sin casar todavía: sus albaranes siguen esperando.`)}>Casarla luego</button>
                  <button type="button" className="cx-boton" disabled={ocupado || marcadas.size === 0} onClick={async () => {
                    setOcupado(true); setFallo(null)
                    try {
                      const r = await casarFactura(paso.factura, [...marcadas])
                      setPaso({ que: 'hecho', frase: r.frase })
                    } catch (e) { setFallo(e instanceof Error ? e.message : 'No se pudo casar.') } finally { setOcupado(false) }
                  }}>{ocupado ? 'Casando…' : `Casar con ${marcadas.size}`}</button>
                </div>
              </>
            )}
          </>
        )}
        {paso.que === 'hecho' && (
          <>
            <p role="status" style={{ margin: 0, fontWeight: 600 }}>{paso.frase}</p>
            <div className="cx-pie"><button type="button" className="cx-boton" onClick={() => alTerminar(paso.frase)}>Hecho</button></div>
          </>
        )}
        {fallo && <div className="cx-error" role="alert">{fallo}</div>}
      </div>
    </Dialogo>
  )
}
