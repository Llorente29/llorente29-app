// src/modules/conta/compras/LiquidacionPage.tsx
//
// La liquidación mensual y su contraste (encargo de compras, maqueta N19).
//
//   · compras/liquidacion/nueva?proveedor&local&mes: se sueltan sus cinco PDF,
//     se leen aquí (celdasPdf + leerLiquidacion, con el NIF de tu empresa
//     para saber cuál es tu factura) y se guarda con compras_liquidacion_guardar.
//   · compras/liquidacion/:liqId: lo leído, el contraste con lo que sabe
//     Folvy (compras, ventas, producto a producto), «Decirle cuál es cuál» y
//     «Contabilizar» (compras_liquidacion_confirmar). Los tres asientos los
//     propone el libro, como todo lo demás.
//
// Lo que no cuadra o no se sabe qué es, para (bloqueos) y se dice.

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { rutaCompras, rutaLibroDiario, rutaLiquidacion } from '@/config/navegacion'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { Cabecera, ErrorConReintento, Guardado, Tarjeta, TarjetaCargando } from '@/modules/conta/ui/piezas'
import { Dialogo } from '@/modules/conta/proveedor/piezas'
import { eurosExactos } from '@/modules/conta/lib/formato'
import {
  diaConNombre, documentosLeidos, fraseSaldo, mesLargo, veredictoCompras, veredictoProductos, veredictoVentas,
  type EstadoVeredicto, type Veredicto,
} from '@/modules/conta/lib/compras'
import { albaranesDeLiquidacion, type AlbaranLiquidacion } from '@/modules/conta/services/comprasService'
import { VerPapel } from '@/modules/conta/compras/VerPapel'
import { celdasPdf } from '@/modules/conta/lib/celdasPdf'
import { pdfjs } from '@/modules/conta/plan/leerFicheros'
import { leerLiquidacion, type FacturaLeida, type LiquidacionLeida } from '@/modules/conta/lib/lectorLiquidacionMensual'
import { rpc, tabla } from '@/modules/conta/services/bd'

interface Liq {
  id: string; status: string; settlement_ref: string | null; period_from: string; period_to: string
  net_settlement: number | null; supplier_id: string; location_id: string | null; company_id: string | null
  detail: LiquidacionLeida; confirmed_by_name: string | null
}
interface Contraste {
  compras: { folvy: number; recepciones: number; sin_base: number; documento: number | null; diferencia: number | null }
  ventas: { plataforma: string; documento: number | null; folvy: number | null; pedidos: number | null; diferencia: number }[]
  productos: { casados: number; no_nuestros: number; sin_casar: number; sin_casar_con_compras: number; no_coinciden: { nombre: string; documento: number; unidad: string; folvy: number | null; comparable: boolean }[] }
  marcas: string; marcas_frase: string
}
interface Producto { nombre: string; compras: number; unidad: string; articulo: string | null; articulo_nombre: string | null; no_es_nuestro: boolean }

async function nombreDe(tablaNombre: 'supplier' | 'locations', id: string | null): Promise<string | null> {
  if (!id) return null
  const { data } = await tabla(tablaNombre).select('name').eq('id', id).maybeSingle()
  return (data as { name: string } | null)?.name ?? null
}

export default function LiquidacionPage() {
  const { liqId } = useParams()
  return liqId && liqId !== 'nueva' ? <VerLiquidacion liqId={liqId} /> : <NuevaLiquidacion />
}

// ── Subir sus documentos ───────────────────────────────────────────────────

function NuevaLiquidacion() {
  const [q] = useSearchParams()
  const navigate = useNavigate()
  const { activa } = useEmpresas()
  const proveedor = q.get('proveedor') ?? ''
  const local = q.get('local')
  const mes = q.get('mes') ?? ''
  const [nombres, setNombres] = useState<{ proveedor: string | null; local: string | null }>({ proveedor: null, local: null })
  const [lectura, setLectura] = useState<LiquidacionLeida | null>(null)
  const [leyendo, setLeyendo] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    void Promise.all([nombreDe('supplier', proveedor), nombreDe('locations', local)]).then(([p, l]) => setNombres({ proveedor: p, local: l }))
  }, [proveedor, local])

  async function leer(fs: File[]) {
    if (!activa?.nif) { setFallo('Tu empresa no tiene NIF en Ajustes: sin él no sé cuál de las dos facturas es la tuya.'); return }
    setLeyendo(true); setFallo(null); setLectura(null)
    try {
      const pdf = await pdfjs()
      const docs = []
      for (const f of fs) docs.push({ nombre: f.name, paginas: await celdasPdf(pdf, await f.arrayBuffer()) })
      setLectura(leerLiquidacion(docs, activa.nif))
    } catch (e) {
      setFallo(`No he podido leer los documentos: ${e instanceof Error ? e.message : String(e)}`)
    } finally { setLeyendo(false) }
  }

  const titulo = `${nombres.proveedor ?? 'Liquidación'}${mes ? ` · ${mesLargo(mes)}` : ''}`
  return (
    <div className="cxc">
      <Link className="cx-enlace cx-mayor-volver" to={rutaCompras()}>‹ Compras</Link>
      <Cabecera antetitulo={`Liquidación del mes${nombres.local ? ` · ${nombres.local}` : ''}`} titulo={titulo} />
      <Tarjeta titulo="Sus documentos">
        <p style={{ marginTop: 0 }}>Suelta los cinco PDF que te manda: tu factura, la suya, la cuenta, las ventas y el inventario. Los leo aquí, en tu navegador.</p>
        <label className="cx-campo">
          <span className="cx-etiqueta">Los PDF de la liquidación</span>
          <input type="file" accept="application/pdf" multiple className="cx-input" disabled={leyendo}
            onChange={(e) => void leer(Array.from(e.target.files ?? []))} />
        </label>
        {leyendo && <p role="status">Leyendo…</p>}
        {fallo && <div className="cx-error" role="alert">{fallo}</div>}
      </Tarjeta>
      {lectura && (
        <>
          <TresCifras lectura={lectura} saldo={lectura.transaccion?.saldo?.importe ?? null} />
          <Documentos lectura={lectura} />
          <Facturas lectura={lectura} />
          {lectura.noReconocidos.length > 0 && <p className="cx-aviso">No sé qué son: {lectura.noReconocidos.join(', ')}. No los he usado.</p>}
          {lectura.avisos.map((a) => <p key={a} className="cx-ayuda" style={{ margin: 0 }}>{a}</p>)}
          {lectura.bloqueos.length > 0 && (
            <div className="cx-error" role="alert">
              <strong>No se puede guardar todavía:</strong>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{lectura.bloqueos.map((b) => <li key={b}>{b}</li>)}</ul>
            </div>
          )}
          <div className="cx-pie" style={{ justifyContent: 'flex-start' }}>
            <button type="button" className="cx-boton" disabled={guardando || lectura.bloqueos.length > 0 || !activa || !proveedor || !local}
              onClick={async () => {
                if (!activa || !local) return
                setGuardando(true); setFallo(null)
                try {
                  const id = await rpc<string>('compras_liquidacion_guardar', { p_empresa: activa.id, p_proveedor: proveedor, p_local: local, p_lectura: lectura })
                  navigate(rutaLiquidacion(id), { state: { aviso: `Guardada la liquidación ${lectura.emitida?.numero ?? ''}: ahora la comparo con lo que sabe Folvy.` } })
                } catch (e) { setFallo(e instanceof Error ? e.message : 'No se pudo guardar.') } finally { setGuardando(false) }
              }}>{guardando ? 'Guardando…' : 'Guardar y comparar'}</button>
          </div>
        </>
      )}
    </div>
  )
}

/** Las tres cifras de arriba (N19). */
function TresCifras({ lectura, saldo }: { lectura: LiquidacionLeida; saldo: number | null }) {
  const e = lectura.emitida
  const r = lectura.recibida
  const s = saldo ?? (e?.total != null && r?.total != null ? Math.round((e.total - r.total) * 100) / 100 : null)
  return (
    <div className="cxc-tres">
      <Tarjeta><span className="cx-etiqueta">Tú le facturas</span><div className="cxc-tres-cifra">{e?.total != null ? eurosExactos(e.total) : '—'}</div>
        <span className="cx-ayuda">Tu servicio por sus ventas y el género que pusiste tú. La extiende él en tu nombre.</span></Tarjeta>
      <Tarjeta><span className="cx-etiqueta">Él te factura</span><div className="cxc-tres-cifra">{r?.total != null ? eurosExactos(r.total) : '—'}</div>
        <span className="cx-ayuda">El género suyo que queda en tu local a fin de mes.</span></Tarjeta>
      <Tarjeta><span className="cx-etiqueta">{s == null ? 'La diferencia' : fraseSaldo(s)?.replace(/ [\d.,]+ €$/, '')}</span>
        <div className="cxc-tres-cifra">{s == null ? '—' : eurosExactos(Math.abs(s))}</div>
        <span className="cx-ayuda">La diferencia.{lectura.transaccion?.saldo ? ' Coincide con la cuenta que te manda.' : ''}</span></Tarjeta>
    </div>
  )
}

/** Los cinco documentos leídos: cuáles han llegado y, si falta uno, qué no se comprueba sin él. */
function Documentos({ lectura }: { lectura: LiquidacionLeida }) {
  const docs = documentosLeidos(lectura)
  const faltan = docs.filter((d) => !d.llegado)
  return (
    <section className="cxc-docs" aria-label="Los cinco documentos">
      <span className="cx-etiqueta">{faltan.length === 0 ? 'Los cinco documentos, leídos' : `Leídos ${docs.length - faltan.length} de 5`}</span>
      <div className="cx-chips">
        {docs.map((d) => <span key={d.nombre} className={d.llegado ? 'cx-chip cx-chip-ia' : 'cx-chip cx-chip-ambar'}>{d.llegado ? '✓' : 'Falta'} {d.nombre}</span>)}
      </div>
      {faltan.map((d) => <p key={d.nombre} className="cx-aviso" style={{ margin: 0 }}>Falta {d.nombre.toLowerCase()}: {d.sinEl}.</p>)}
    </section>
  )
}

/** Las dos facturas, línea a línea. */
function Facturas({ lectura }: { lectura: LiquidacionLeida }) {
  return (
    <div className="cxc-dos">
      {lectura.emitida && <Factura titulo="Lo que le facturas" f={lectura.emitida} />}
      {lectura.recibida && <Factura titulo="Lo que te factura" f={lectura.recibida} />}
    </div>
  )
}

function Factura({ titulo, f }: { titulo: string; f: FacturaLeida }) {
  const iva = new Map<number, number>()
  for (const l of f.lineas) iva.set(l.tipo, (iva.get(l.tipo) ?? 0) + Math.round((l.total - l.base) * 100))
  return (
    <Tarjeta titulo={`${titulo}${f.numero ? ` ${f.numero}` : ''}`}>
      <div className="cxc-lineas">
        {f.lineas.map((l, i) => <FilaLinea key={i} texto={l.concepto} cifra={l.base} />)}
        {[...iva.entries()].filter(([, c]) => c !== 0).map(([t, c]) => <FilaLinea key={`iva-${t}`} texto={`IVA al ${String(t).replace('.', ',')} %`} cifra={c / 100} />)}
        <span className="cxc-lineas-total">Total</span><span className="cxc-lineas-total cx-cifra">{f.total != null ? eurosExactos(f.total) : '—'}</span>
      </div>
    </Tarjeta>
  )
}
function FilaLinea({ texto, cifra }: { texto: string; cifra: number }) {
  return <><span>{texto}</span><span className="cx-cifra">{eurosExactos(cifra)}</span></>
}

// ── Una liquidación guardada ───────────────────────────────────────────────

function VerLiquidacion({ liqId }: { liqId: string }) {
  const { accountId } = useCuentaConta()
  const { state } = useLocation()
  const [liq, setLiq] = useState<Liq | null>(null)
  const [nombres, setNombres] = useState<{ proveedor: string | null; local: string | null }>({ proveedor: null, local: null })
  const [contraste, setContraste] = useState<Contraste | null>(null)
  const [productos, setProductos] = useState<Producto[]>([])
  const [error, setError] = useState<string | null>(null)
  const [vuelta, setVuelta] = useState(0)
  const [aviso, setAviso] = useState<string | null>((state as { aviso?: string } | null)?.aviso ?? null)
  const [casar, setCasar] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    ;(async () => {
      const { data, error: e } = await tabla('licensed_settlement')
        .select('id, status, settlement_ref, period_from, period_to, net_settlement, supplier_id, location_id, company_id, detail, confirmed_by_name')
        .eq('id', liqId).maybeSingle()
      if (e) throw new Error(e.message)
      if (!data) throw new Error('Esa liquidación no existe o no es de tu cuenta.')
      const l = data as Liq
      const [c, ps, p, lo] = await Promise.all([
        rpc<Contraste>('compras_liquidacion_contraste', { p_liq: liqId }),
        rpc<Producto[] | null>('compras_liquidacion_productos', { p_liq: liqId }),
        nombreDe('supplier', l.supplier_id), nombreDe('locations', l.location_id),
      ])
      if (!vivo) return
      setError(null); setLiq(l); setContraste(c); setProductos(ps ?? []); setNombres({ proveedor: p, local: lo })
    })().catch((e: unknown) => { if (vivo) setError(e instanceof Error ? e.message : String(e)) })
    return () => { vivo = false }
  }, [liqId, vuelta])

  if (error) return <div className="cxc"><Link className="cx-enlace cx-mayor-volver" to={rutaCompras()}>‹ Compras</Link><ErrorConReintento mensaje={error} reintentar={() => setVuelta((v) => v + 1)} /></div>
  if (!liq || !contraste) return <div className="cxc"><TarjetaCargando /><TarjetaCargando /></div>

  const lec = liq.detail
  const confirmada = liq.status !== 'borrador'
  const bloqueos = lec.bloqueos ?? []
  return (
    <div className="cxc">
      <Link className="cx-enlace cx-mayor-volver" to={rutaCompras()}>‹ Compras</Link>
      <Cabecera antetitulo={`Liquidación del mes${nombres.local ? ` · ${nombres.local}` : ''}${liq.settlement_ref ? ` · referencia ${liq.settlement_ref}` : ''}`}
        titulo={`${nombres.proveedor ?? 'Liquidación'} · ${mesLargo(liq.period_from)}`} />
      <Guardado texto={aviso} />
      <TresCifras lectura={lec} saldo={liq.net_settlement == null ? null : Number(liq.net_settlement)} />
      <Documentos lectura={lec} />

      <Tarjeta titulo="¿Es verdad lo que dice?">
        <p className="cx-ayuda" style={{ marginTop: 0 }}>Lo he comparado con lo que sabe Folvy.</p>
        <Compras c={contraste.compras} liqId={liqId} />
        <Ventas v={contraste.ventas} marcas={contraste.marcas} />
        <Productos p={contraste.productos} total={productos.length} abrir={() => setCasar(true)} />
      </Tarjeta>

      <Facturas lectura={lec} />

      <Tarjeta titulo="Lo que voy a apuntar">
        <p style={{ marginTop: 0 }}>
          Su factura, como compra de género. Tu factura, como venta, en tu libro de facturas emitidas con el número que trae.
          Una se descuenta de la otra y {liq.net_settlement != null && Number(liq.net_settlement) >= 0
            ? <>quedan <strong>{eurosExactos(Number(liq.net_settlement))} por cobrar</strong></>
            : <>quedan <strong>{eurosExactos(Math.abs(Number(liq.net_settlement ?? 0)))} por pagar</strong></>}, que se cerrarán cuando lleguen al banco.
          {contraste.compras.recepciones > 0 ? ` Los ${contraste.compras.recepciones} albaranes no se apuntan aparte.` : ''}
        </p>
        {bloqueos.length > 0 && (
          <div className="cx-error" role="alert"><strong>No se puede contabilizar:</strong>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{bloqueos.map((b) => <li key={b}>{b}</li>)}</ul></div>
        )}
        {fallo && <div className="cx-error" role="alert">{fallo}</div>}
        <div className="cx-pie" style={{ justifyContent: 'flex-start' }}>
          <Link className="cx-boton-sec" to={rutaLibroDiario('compras')}>Ver los asientos</Link>
          {confirmada
            ? <span className="cx-ayuda">Contabilizada{liq.confirmed_by_name ? ` por ${liq.confirmed_by_name}` : ''}.</span>
            : <button type="button" className="cx-boton" disabled={confirmando || bloqueos.length > 0} onClick={async () => {
                setConfirmando(true); setFallo(null)
                try {
                  const r = await rpc<{ frase: string }>('compras_liquidacion_confirmar', { p_liq: liqId })
                  setAviso(r.frase); setVuelta((v) => v + 1)
                } catch (e) { setFallo(e instanceof Error ? e.message : 'No se pudo contabilizar.') } finally { setConfirmando(false) }
              }}>{confirmando ? 'Contabilizando…' : 'Contabilizar'}</button>}
        </div>
      </Tarjeta>

      {casar && accountId && (
        <CualEsCual accountId={accountId} proveedor={liq.supplier_id} productos={productos}
          alCerrar={() => setCasar(false)} alGuardar={(n) => { setCasar(false); setAviso(n); setVuelta((v) => v + 1) }} />
      )}
    </div>
  )
}

const MARCA: Record<EstadoVeredicto, [string, string]> = { coincide: ['bien', '✓'], se_parece: ['casi', '≈'], no_se_puede: ['no', '?'] }

/** Un veredicto del contraste: coincide · se parece · no lo puedo comprobar. */
function BloqueContraste({ v, children }: { v: Veredicto; children?: ReactNode }) {
  const [tono, signo] = MARCA[v.estado]
  return (
    <div className="cxc-contraste" data-estado={v.estado}>
      <span className={`cxc-marca cxc-marca-${tono}`} aria-hidden="true">{signo}</span>
      <div className="cxc-cosa-texto" style={{ gap: 8 }}>
        <span className="cxc-cosa-frase">{v.titulo}</span>
        <span className="cxc-cosa-apoyo">{v.detalle}</span>
        {children}
      </div>
    </div>
  )
}

function Compras({ c, liqId }: { c: Contraste['compras']; liqId: string }) {
  const [abiertos, setAbiertos] = useState(false)
  const [albaranes, setAlbaranes] = useState<AlbaranLiquidacion[] | null>(null)
  const [fallo, setFallo] = useState<string | null>(null)
  return (
    <BloqueContraste v={veredictoCompras(c)}>
      {c.recepciones > 0 && (
        <div>
          <button type="button" className="cx-boton-sec" aria-expanded={abiertos} onClick={() => {
            setAbiertos(!abiertos)
            if (!albaranes) albaranesDeLiquidacion(liqId).then(setAlbaranes, (e: unknown) => setFallo(e instanceof Error ? e.message : String(e)))
          }}>{abiertos ? 'Ocultar los albaranes' : `Ver los ${c.recepciones} albaranes`}</button>
        </div>
      )}
      {abiertos && fallo && <div className="cx-error" role="alert">{fallo}</div>}
      {abiertos && albaranes && (
        <ul className="cxc-albaranes">
          {albaranes.map((a) => (
            <li key={a.recepcion}>
              <span>{diaConNombre(a.fecha)} · {a.base == null ? 'sin importe' : eurosExactos(a.base)} <span className="cxc-cosa-codigo">{a.codigo}</span></span>
              <VerPapel recepcion={a.recepcion} titulo={`Albarán · ${diaConNombre(a.fecha)}`} />
            </li>
          ))}
        </ul>
      )}
    </BloqueContraste>
  )
}

function Ventas({ v, marcas }: { v: Contraste['ventas']; marcas: string }) {
  return (
    <BloqueContraste v={veredictoVentas(v, marcas)}>
      {v.length > 0 && (
        <div className="cxc-tabla" style={{ gridTemplateColumns: 'minmax(0,1.4fr) repeat(3, minmax(0,1fr))' }} role="table" aria-label="Ventas por plataforma">
          <span className="cxc-tabla-cabeza" role="columnheader">Plataforma</span>
          <span className="cxc-tabla-cabeza cx-cifra" role="columnheader">Él dice</span>
          <span className="cxc-tabla-cabeza cx-cifra" role="columnheader">Folvy tiene</span>
          <span className="cxc-tabla-cabeza cx-cifra" role="columnheader">Diferencia</span>
          {v.flatMap((x) => [
            <span key={`${x.plataforma}-p`} role="cell">{x.plataforma}</span>,
            <span key={`${x.plataforma}-d`} role="cell" className="cx-cifra">{x.documento == null ? '—' : eurosExactos(x.documento)}</span>,
            <span key={`${x.plataforma}-f`} role="cell" className="cx-cifra">{x.folvy == null ? '—' : eurosExactos(x.folvy)}</span>,
            <span key={`${x.plataforma}-x`} role="cell" className="cx-cifra">{x.folvy == null || x.documento == null ? '—' : `${x.diferencia > 0 ? '+' : x.diferencia < 0 ? '−' : ''}${eurosExactos(Math.abs(x.diferencia))}`}</span>,
          ])}
        </div>
      )}
    </BloqueContraste>
  )
}

function Productos({ p, total, abrir }: { p: Contraste['productos']; total: number; abrir: () => void }) {
  return (
    <BloqueContraste v={veredictoProductos(p, total)}>
      {p.sin_casar > 0 && <div><button type="button" className="cx-boton-sec" onClick={abrir}>Decirle cuál es cuál</button></div>}
    </BloqueContraste>
  )
}

// ── Decirle cuál es cuál ───────────────────────────────────────────────────

function CualEsCual({ accountId, proveedor, productos, alCerrar, alGuardar }: {
  accountId: string; proveedor: string; productos: Producto[]; alCerrar: () => void; alGuardar: (aviso: string) => void
}) {
  const [articulos, setArticulos] = useState<{ id: string; name: string }[]>([])
  const [eleccion, setEleccion] = useState<Record<string, string>>({})
  const [fallo, setFallo] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const sinCasar = useMemo(() => productos.filter((p) => !p.articulo && !p.no_es_nuestro), [productos])
  const porNombre = useMemo(() => new Map(articulos.map((a) => [a.name.toLowerCase(), a.id])), [articulos])

  useEffect(() => {
    void tabla('recipe_item').select('id, name').eq('account_id', accountId).is('archived_at', null).order('name')
      .then(({ data, error }: { data: unknown; error: { message: string } | null }) => {
        if (error) setFallo(`No se pudieron cargar tus artículos: ${error.message}`)
        else setArticulos((data as { id: string; name: string }[] | null) ?? [])
      })
  }, [accountId])

  const listos = Object.entries(eleccion).filter(([, v]) => v === '__no__' || porNombre.has(v.toLowerCase()))
  return (
    <Dialogo titulo="Decirle cuál es cuál" alCerrar={alCerrar}>
      <p style={{ margin: 0 }}>Escribe cómo se llama en tu cocina, o marca que no es nuestro. Lo recuerdo para sus próximas liquidaciones.</p>
      <datalist id="cxc-articulos">{articulos.map((a) => <option key={a.id} value={a.name} />)}</datalist>
      <div style={{ maxHeight: '50vh', overflowY: 'auto' }}>
        {sinCasar.map((p) => (
          <div key={p.nombre} className="cxc-producto">
            <span className="cxc-producto-nombre">{p.nombre} <span className="cx-ayuda">· {String(p.compras).replace('.', ',')} {p.unidad}</span></span>
            <input className="cx-input" list="cxc-articulos" aria-label={`Cómo se llama ${p.nombre} en tu cocina`} style={{ maxWidth: 220 }}
              value={eleccion[p.nombre] === '__no__' ? '' : eleccion[p.nombre] ?? ''} disabled={eleccion[p.nombre] === '__no__'}
              onChange={(e) => setEleccion({ ...eleccion, [p.nombre]: e.target.value })} />
            <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
              <input type="checkbox" checked={eleccion[p.nombre] === '__no__'}
                onChange={(e) => setEleccion({ ...eleccion, [p.nombre]: e.target.checked ? '__no__' : '' })} />No es nuestro
            </label>
          </div>
        ))}
      </div>
      {fallo && <div className="cx-error" role="alert">{fallo}</div>}
      <div className="cx-pie">
        <button type="button" className="cx-boton-sec" onClick={alCerrar}>Cancelar</button>
        <button type="button" className="cx-boton" disabled={ocupado || listos.length === 0} onClick={async () => {
          setOcupado(true); setFallo(null)
          try {
            for (const [nombre, v] of listos) {
              await rpc('compras_liquidacion_casar_producto', {
                p_proveedor: proveedor, p_nombre: nombre, p_articulo: v === '__no__' ? null : porNombre.get(v.toLowerCase()), p_no_es_nuestro: v === '__no__',
              })
            }
            alGuardar(`Guardado: ${listos.length} producto${listos.length === 1 ? '' : 's'} con su nombre de tu cocina. Lo recordaré para sus próximas liquidaciones.`)
          } catch (e) { setFallo(e instanceof Error ? e.message : 'No se pudo guardar.') } finally { setOcupado(false) }
        }}>{ocupado ? 'Guardando…' : `Guardar ${listos.length}`}</button>
      </div>
    </Dialogo>
  )
}
