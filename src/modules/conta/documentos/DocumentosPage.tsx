// src/modules/conta/documentos/DocumentosPage.tsx
//
// D01 · N22 «Documentos › Facturas recibidas» (maqueta N22Documentos). Los tres
// niveles de Libros: el menú lateral (MarcoConta), las pestañas de área y la
// barra de acciones agrupadas (Traer · Esperadas · Leídas). Debajo, la banda de
// la IA con lo que ha pasado en una frase, las cinco cifras y la lista: cada
// fila con su porqué y un solo botón.
//
// Lo que no funciona no se enseña (R2): solo la pestaña «Facturas recibidas»
// (emitidas y otros documentos no tienen pantalla aquí), «Por correo» solo con
// el correo de la empresa encendido, «De Cocina» solo si la empresa recibe la
// mercancía con Folvy y la cuenta no es solo de contabilidad, y sin «Tuyos»
// (favoritos y buscar no existen en Documentos). Vendida sola, ni Cocina ni la
// palabra Folvy (producto.ts).
//
// Regla 7: «Todas» trae todas, también las repetidas; un filtro ordena y
// etiqueta, nunca decide qué existe. En el móvil, las filas son tarjetas y se
// sube con la cámara.

import { useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { rutaCompras, rutaDocumentos, rutaRevisarFactura } from '@/config/navegacion'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useIsMobile } from '@/shell/useIsMobile'
import { useLeer } from '@/modules/conta/libros/contexto'
import { Migas } from '@/modules/conta/proveedor/piezas'
import { ErrorConReintento, Hueso, Inicial, Vacio } from '@/modules/conta/ui/piezas'
import { eurosExactos, hoyEnMadrid, iniciales } from '@/modules/conta/lib/formato'
import {
  VERES, banda, barra, boton, comoLlego, diaMes, entendido, filtrar, limites, meses, nombreDelMes, porDonde, punto, textos, verDe,
  type DatosDocumentos, type FilaDocumento, type Ver,
} from '@/modules/conta/documentos/documentos'
import { useProducto } from '@/modules/conta/documentos/producto'
import { leerDocumentos, subirFacturas, urlDeLlegada, urlDePapelDeRecepcion, type Subida } from '@/modules/conta/services/documentosService'
import { Pedirselas } from '@/modules/conta/documentos/Pedirselas'

const ACEPTA = 'application/pdf,image/jpeg,image/png,image/webp'

export default function DocumentosPage() {
  const { accountId, cargando, userName } = useCuentaConta()
  const { activa } = useEmpresas()
  const movil = useIsMobile()
  const producto = useProducto()
  const t = textos(producto.nombre)
  const navegar = useNavigate()
  const [query, setQuery] = useSearchParams()
  const hoy = hoyEnMadrid()
  const listaMeses = useMemo(() => meses(hoy), [hoy])
  const mes = listaMeses.some((m) => m.valor === query.get('mes')) ? query.get('mes')! : listaMeses[0].valor
  const ver = verDe(query.get('ver'))
  const [vuelta, setVuelta] = useState(0)
  const { desde, hasta } = limites(mes)
  const datos = useLeer(activa ? () => leerDocumentos(activa.id, desde, hasta) : null, `${activa?.id}:${mes}:${vuelta}`)

  const ficheros = useRef<HTMLInputElement>(null)
  const camara = useRef<HTMLInputElement>(null)
  const [subiendo, setSubiendo] = useState<{ i: number; de: number } | null>(null)
  const [subidas, setSubidas] = useState<Subida[] | null>(null)
  const [pidiendo, setPidiendo] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)

  const cambiar = (p: { ver?: Ver; mes?: string }) => {
    const q = new URLSearchParams(query)
    if (p.ver) q.set('ver', p.ver)
    if (p.mes) q.set('mes', p.mes)
    setQuery(q, { replace: true })
  }

  async function subir(lista: FileList | null) {
    const fs = lista ? [...lista] : []
    if (!fs.length || !accountId || !activa) return
    setSubidas(null); setFallo(null); setSubiendo({ i: 0, de: fs.length })
    try {
      const r = await subirFacturas(accountId, activa.id, fs, userName, (i) => setSubiendo({ i, de: fs.length }))
      setSubidas(r)
      setVuelta((v) => v + 1)
    } catch (e) {
      setFallo(e instanceof Error ? e.message : String(e))
    } finally {
      setSubiendo(null)
      if (ficheros.current) ficheros.current.value = ''
      if (camara.current) camara.current.value = ''
    }
  }

  async function abrirLlegada(f: FilaDocumento) {
    try {
      const url = f.tipo === 'recepcion' ? await urlDePapelDeRecepcion(f.papel) : await urlDeLlegada(f.id)
      if (!url) { setFallo('Ese documento no tiene fichero que enseñar.'); return }
      window.open(url, '_blank', 'noopener')
    } catch (e) { setFallo(e instanceof Error ? e.message : String(e)) }
  }

  if (!accountId && !cargando) return <Vacio titulo="No hay cuenta activa." explicacion="Elige una cuenta para ver sus documentos." />
  if (!activa) return <div className="cx-tarjeta"><Vacio titulo="Aún no hay ninguna empresa." explicacion="Da de alta tu empresa y aquí llegan sus facturas." /></div>

  const d = datos.datos
  const irA = (f: FilaDocumento) => (f.tipo === 'factura' ? navegar(`${rutaRevisarFactura(f.id)}?ver=${ver}&mes=${mes}`) : void abrirLlegada(f))
  const inputs = (
    <>
      <input ref={ficheros} type="file" multiple accept={ACEPTA} className="cx-oculto" aria-label="Elegir facturas para subir"
        onChange={(e) => void subir(e.target.files)} data-prueba="subir-ficheros" />
      <input ref={camara} type="file" accept="image/*" capture="environment" className="cx-oculto" aria-label="Hacer una foto a una factura"
        onChange={(e) => void subir(e.target.files)} />
    </>
  )

  return (
    <div className="cxl-pagina">
      <header className="cxl-cabeza">
        <div>
          <span className="cxl-ante">Contabilidad</span>
          <h1 className="cxl-titulo">Documentos</h1>
        </div>
        <label>
          <span className="cx-oculto">Mes</span>
          <select className="cx-input" value={mes} onChange={(e) => cambiar({ mes: e.target.value })}>
            {listaMeses.map((m) => <option key={m.valor} value={m.valor}>{m.nombre}</option>)}
          </select>
        </label>
      </header>

      {!movil && (
        <nav className="cxl-areas" aria-label="Áreas de Documentos">
          <Link to={rutaDocumentos()} className="cxl-area" aria-current="page">Facturas recibidas</Link>
        </nav>
      )}

      {inputs}
      {datos.error && <ErrorConReintento mensaje={datos.error} reintentar={datos.recargar} />}
      {!d && !datos.error && <div className="cx-tarjeta" aria-busy="true" aria-label="Cargando los documentos">{[0, 1, 2].map((i) => <Hueso key={i} alto={40} />)}</div>}

      {d && (
        <>
          {!movil && <Barra d={d} solo={producto.solo} producto={producto.nombre}
            alSubir={() => ficheros.current?.click()} alPedir={() => setPidiendo(true)} alVerApuntadas={() => cambiar({ ver: 'apuntadas' })} />}

          <div className="cxr-seccion">
            <div>
              <Migas migas={[{ etiqueta: 'Documentos' }, { etiqueta: 'Facturas recibidas' }]} />
              <h2>{VERES.find((v) => v.id === ver)!.nombre}</h2>
            </div>
            <div className="cxr-herramientas">
              <div className="cxl-segmento" role="group" aria-label="Qué facturas ver">
                {VERES.map((v) => <button key={v.id} type="button" aria-pressed={v.id === ver} onClick={() => cambiar({ ver: v.id })}>{v.nombre}</button>)}
              </div>
              {!movil && <button type="button" className="cx-boton" onClick={() => ficheros.current?.click()} disabled={!!subiendo}>Subir facturas</button>}
            </div>
          </div>

          {movil && (
            <div className="cxr-subir-movil">
              <button type="button" className="cx-boton" onClick={() => camara.current?.click()} disabled={!!subiendo}>Hacer foto</button>
              <button type="button" className="cx-boton-sec" onClick={() => ficheros.current?.click()} disabled={!!subiendo}>Subir PDF</button>
            </div>
          )}

          <div role="status" aria-live="polite">
            {subiendo && <div className="cx-tarjeta">Subiendo y leyendo {subiendo.de === 1 ? 'la factura' : `${subiendo.i + 1} de ${subiendo.de}`}…</div>}
            {subidas && <ResultadoSubida subidas={subidas} />}
          </div>
          {fallo && <div className="cx-error" role="alert">{fallo}</div>}

          <Banda d={d} alPedir={() => setPidiendo(true)} />
          <Cifras d={d} ver={ver} solo={producto.solo} alVer={(v) => cambiar({ ver: v })} alPedir={() => setPidiendo(true)} />
          <Lista d={d} ver={ver} movil={movil} solo={producto.solo} entendidoTitulo={t.entendido} pie={t.repetida} alIr={irA} alVerTodas={() => cambiar({ ver: 'todas' })} />
        </>
      )}

      {pidiendo && d && activa && (
        <Pedirselas companyId={activa.id} esperadas={d.esperadas.filter((e) => !e.pedida)} quien={userName}
          alCerrar={() => setPidiendo(false)} alPedir={() => setVuelta((v) => v + 1)} />
      )}
    </div>
  )
}

/** Nivel 3: Traer · Esperadas · Leídas. */
function Barra({ d, solo, producto, alSubir, alPedir, alVerApuntadas }: {
  d: DatosDocumentos; solo: boolean; producto: string | null; alSubir: () => void; alPedir: () => void; alVerApuntadas: () => void
}) {
  const accion: Record<string, (() => void) | undefined> = { subir: alSubir, fijas: alPedir, hecho: alVerApuntadas }
  return (
    <nav className="cxl-barra cxr-barra" aria-label="Acciones de Facturas recibidas">
      <div className="cxl-barra-grupos">
        {barra(d, { solo, producto }).map((g) => (
          <div key={g.etiqueta} className="cxl-grupo" role="group" aria-label={g.etiqueta}>
            <div className="cxl-grupo-acciones">
              {g.entradas.map((e) => {
                const dentro = (
                  <>
                    <span className="cxl-accion-nombre">{e.nombre} <span className={`cxl-punto cxl-punto-${e.tono}`} aria-hidden="true" /></span>
                    <span className="cxl-accion-dato">{e.dato}</span>
                  </>
                )
                // «De Cocina» lleva a sus recepciones; «Por correo» enseña su dirección (no hace nada más).
                if (e.id === 'cocina') return <Link key={e.id} to={rutaCompras()} className="cxl-accion">{dentro}</Link>
                const hacer = accion[e.id]
                return hacer
                  ? <button key={e.id} type="button" className="cxl-accion" onClick={hacer}>{dentro}</button>
                  : <span key={e.id} className="cxl-accion" title={e.id === 'correo' ? d.correo.direccion ?? undefined : undefined}>{dentro}</span>
              })}
            </div>
            <span className="cxl-grupo-etiqueta">{g.etiqueta}</span>
          </div>
        ))}
      </div>
    </nav>
  )
}

function Banda({ d, alPedir }: { d: DatosDocumentos; alPedir: () => void }) {
  const b = banda(d)
  return (
    <section className={`cx-ia-bloque${b.tono === 'ambar' ? ' cxr-ia-ambar' : ''}`} aria-label="Lo que ha pasado con tus facturas">
      <span className="cx-ia-punto" aria-hidden="true" />
      <div className="cx-ia-texto">
        <span className="cx-ia-titulo">{b.titulo}</span>
        {b.porque && <span className="cx-ia-porque">{b.porque}</span>}
      </div>
      {b.pedir && <div className="cx-ia-acciones"><button type="button" className="cx-boton-sec" onClick={alPedir}>Pedírselas</button></div>}
    </section>
  )
}

function Cifras({ d, ver, solo, alVer, alPedir }: { d: DatosDocumentos; ver: Ver; solo: boolean; alVer: (v: Ver) => void; alPedir: () => void }) {
  const c = d.cifras
  const faltan = d.esperadas.filter((e) => !e.pedida)
  const cifra = (etiqueta: string, valor: number, apoyo: string, alPulsar: () => void, actual = false, ia = false) => (
    <button type="button" className={`cxr-cifra${ia ? ' cxr-cifra-ia' : ''}`} onClick={alPulsar} aria-pressed={actual}>
      <span className="cxr-cifra-etiqueta">{etiqueta}</span>
      <span className="cxr-cifra-valor">{valor.toLocaleString('es-ES')}</span>
      <span className="cxr-cifra-apoyo">{apoyo}</span>
    </button>
  )
  return (
    <div className="cxr-cifras">
      {cifra(`Llegadas en ${nombreDelMes(d.desde)}`, c.llegadas, porDonde(c.llegadas_por_canal, solo), () => alVer('todas'), ver === 'todas')}
      {cifra('Apuntadas solas', c.apuntadas_solas, c.apuntadas_solas ? 'las ves en Apuntadas' : 'ninguna esta vez', () => alVer('apuntadas'), ver === 'apuntadas', true)}
      {cifra('Para mirar', c.para_mirar, 'una pantalla cada una', () => alVer('para-mirar'), ver === 'para-mirar')}
      {cifra('Por aclarar', c.por_aclarar, 'falta algo: te digo qué', () => alVer('por-aclarar'), ver === 'por-aclarar')}
      {cifra('Esperadas y no llegadas', c.esperadas_no_llegadas,
        d.esperadas.length ? d.esperadas.slice(0, 3).map((e) => (e.label ?? e.supplier_name).toLowerCase()).join(' · ') : 'ninguna',
        () => { if (faltan.length) alPedir() })}
    </div>
  )
}

function Lista({ d, ver, movil, solo, entendidoTitulo, pie, alIr, alVerTodas }: {
  d: DatosDocumentos; ver: Ver; movil: boolean; solo: boolean; entendidoTitulo: string; pie: string; alIr: (f: FilaDocumento) => void; alVerTodas: () => void
}) {
  const filas = filtrar(d.filas, ver)
  const repetidas = d.filas.filter((f) => f.estado === 'repetida').length
  const nombre = (f: FilaDocumento) => f.proveedor.nombre ?? (f.tipo === 'llegada' ? 'Documento sin leer' : 'No reconozco el emisor')
  const ini = (f: FilaDocumento) => (f.proveedor.nombre ? iniciales(f.proveedor.nombre) : '??')
  // R5 · 7 y 9: cómo llegó, en minúscula y lo que pasó de verdad; en el móvil, la fecha junto al número.
  const apoyo = (f: FilaDocumento) => [f.numero ?? 'sin número', movil ? diaMes(f.fecha) : null, comoLlego(f.canal, f.llegada_tipo, solo)].filter(Boolean).join(' · ')
  const vacio = ver === 'todas' ? 'Este mes no ha llegado ninguna factura.' : `No hay ninguna ${VERES.find((v) => v.id === ver)!.nombre.toLowerCase()}.`
  const piePagina = (
    <div className="cxr-pie">
      <span>{pie}</span>
      {repetidas > 0 && ver !== 'todas' && <button type="button" className="cx-enlace" onClick={alVerTodas}>Ver {repetidas === 1 ? 'la repetida' : `las ${repetidas} repetidas`}</button>}
    </div>
  )
  const botonDe = (f: FilaDocumento) => {
    const b = boton(f)
    return <button type="button" className={b.principal ? 'cx-boton' : 'cx-boton-sec'} onClick={() => alIr(f)} aria-label={`${b.texto}: ${nombre(f)}${f.numero ? ` ${f.numero}` : ''}`}>{b.texto}</button>
  }

  if (movil) {
    return (
      <section aria-label="Facturas">
        {filas.length === 0 && <div className="cx-tarjeta cxr-vacio">{vacio}</div>}
        <div className="cxr-tarjetas">
          {filas.map((f) => {
            const e = entendido(f, solo)
            return (
              <article key={f.id} className={`cxr-tarjeta${f.estado === 'para_mirar' ? ' cxr-fila-mirar' : ''}`}>
                <div className="cxr-tarjeta-cabeza">
                  <div className="cxr-quien">
                    <Inicial texto={ini(f)} redonda={false} tono={f.proveedor.nombre ? undefined : 6} />
                    <div className="cxr-quien-texto"><span className="cxr-nombre">{nombre(f)}</span><span className="cxr-apoyo">{apoyo(f)}</span></div>
                  </div>
                  <span className="cx-cifra">{f.total !== null ? eurosExactos(f.total) : '—'}</span>
                </div>
                <div className="cxr-entendido">
                  <span className="cxr-entendido-titulo"><span className={`cxl-punto cxl-punto-${punto(f)}`} aria-hidden="true" /> {e.titulo}</span>
                  {e.porque && <span className="cxr-apoyo">{e.porque}</span>}
                </div>
                {botonDe(f)}
              </article>
            )
          })}
        </div>
        {piePagina}
      </section>
    )
  }

  return (
    <section className="cx-tarjeta" aria-label="Facturas">
      <table className="cxr-tabla">
        <thead>
          <tr><th colSpan={2}>Proveedor · factura</th><th>Fecha</th><th className="cxr-der">Total</th><th aria-label="Seguridad" /><th>{entendidoTitulo}</th><th aria-label="Qué hacer" /></tr>
        </thead>
        <tbody>
          {filas.length === 0 && <tr><td colSpan={7} className="cxr-vacio">{vacio}</td></tr>}
          {filas.map((f) => {
            const e = entendido(f, solo)
            return (
              <tr key={f.id} className={f.estado === 'para_mirar' ? 'cxr-fila-mirar' : undefined}>
                <td style={{ width: 48 }}><Inicial texto={ini(f)} tono={f.proveedor.nombre ? undefined : 6} /></td>
                <td><div className="cxr-quien-texto"><span className="cxr-nombre">{nombre(f)}</span><span className="cxr-apoyo">{apoyo(f)}</span></div></td>
                <td className="cxr-mono">{diaMes(f.fecha)}</td>
                <td className="cxr-der">{f.total !== null ? eurosExactos(f.total) : '—'}</td>
                <td><span className={`cxl-punto cxl-punto-${punto(f)}`} aria-hidden="true" /></td>
                <td><div className="cxr-entendido"><span className="cxr-entendido-titulo">{e.titulo}</span>{e.porque && <span className="cxr-apoyo">{e.porque}</span>}</div></td>
                <td style={{ textAlign: 'right' }}>{botonDe(f)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {piePagina}
    </section>
  )
}

function ResultadoSubida({ subidas }: { subidas: Subida[] }) {
  const bien = subidas.filter((s) => s.bien).length
  return (
    <div className="cx-tarjeta cxr-hecho">
      <strong>{bien === subidas.length
        ? `${subidas.length === 1 ? 'Subida y leída' : `Subidas y leídas las ${subidas.length}`}.`
        : `${bien} de ${subidas.length} han entrado.`}</strong>
      <ul>{subidas.map((s, i) => <li key={i} className={s.bien ? undefined : 'cxr-mal'}>{s.texto}</li>)}</ul>
    </div>
  )
}
