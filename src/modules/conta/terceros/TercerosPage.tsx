// src/modules/conta/terceros/TercerosPage.tsx
//
// C03 · «Clientes y proveedores»: la lista ÚNICA de terceros (encargo §6).
// Filtros por papel (Todos · Proveedores · Clientes · Plataformas · Socios de
// marca · Archivados), columnas Nombre · Papeles · Te debe / Le debes ·
// Última operación · «···», y un buscador por nombre o NIF.
//
// Un tercero que solo es proveedor abre su ficha de siempre (la del C01b, en
// Cocina); con papel de cliente, plataforma o socio, la ficha N9/N10.
//
// Arriba, las dos revisiones que deja la importación: las cuentas 430 traídas
// de otro programa (TODAS, también las que quedaron como cuenta de pago de un
// proveedor: un enlace de pago no es un papel; respuesta 3) con el papel que
// propone Folvy, su porqué y su confianza; y los acuerdos de cesión que aún no
// apuntan a su socio. Nada se escribe sin «Confirmar» fila a fila.
// Regla 7 de CLAUDE.md: ningún filtro esconde filas que existen; los archivados
// están en su filtro y lo dicen.

import { forwardRef, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { rutaFichaTercero, rutaMayor } from '@/config/navegacion'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useIsMobile } from '@/shell/useIsMobile'
import { Campo, Dialogo } from '@/modules/conta/proveedor/piezas'
import { Chip, ErrorConReintento, Guardado, Hueso, Inicial, Vacio } from '@/modules/conta/ui/piezas'
import {
  FILTROS_TERCEROS, cuentaPorFiltro, filtrarTerceros, mismoNif, ordenarPapeles, rutaDeTercero, type FiltroTerceros, type Papel,
} from '@/modules/conta/lib/terceros'
import { teDebe } from '@/modules/conta/lib/liquidaciones'
import { calcularCifras } from '@/modules/conta/lib/cifras'
import { detectarRepetidas } from '@/modules/conta/lib/repetidas'
import { parecido } from '@/modules/conta/lib/importarPlan'
import { diaMesCorto, euros, hoyEnMadrid, iniciales } from '@/modules/conta/lib/formato'
import { normalizarNif, validarNifEs } from '@/modules/conta/lib/nif'
import {
  acuerdosSinSocio, anadirPapel, archivarTercero, enlazarAcuerdo, guardarCliente,
  liquidacionesDeLaCuenta, liquidacionesSocioDe, listarFacturasDeLaCuenta, listarTercerosBase, terceroDelMismoNif, type TerceroLista, asegurarCuentaLiquidacion } from '@/modules/conta/services/tercerosService'
import { cargarRevision430, confirmar430, type DatosRevision430 } from '@/modules/conta/services/revision430Service'
import {
  TIPO_430, elegida, hecha, proponer430, queHace, tarjetaPorRevisar, type Cuenta430, type Propuesta430, type Tercero430, type Tipo430,
} from '@/modules/conta/lib/revision430'

const PILDORA: Record<Papel, string> = {
  platform: 'Plataforma', brand_partner: 'Socio de marca', customer: 'Cliente', supplier: 'Proveedor',
}

function useTerceros(accountId: string | null, vuelta: number) {
  const [filas, setFilas] = useState<TerceroLista[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!accountId) return
    let vivo = true
    Promise.all([listarTercerosBase(accountId), liquidacionesDeLaCuenta(accountId), liquidacionesSocioDe(accountId, null), listarFacturasDeLaCuenta(accountId)])
      .then(([{ terceros }, liqs, socio, facturas]) => {
        if (!vivo) return
        const hoy = hoyEnMadrid()
        setFilas(terceros.map((t) => {
          const suyas = liqs.filter((l) => l.partyId === t.id)
          const deEl = t.supplierId ? facturas.filter((f) => f.supplierId === t.supplierId) : []
          const rep = detectarRepetidas(deEl.map((x) => ({ id: x.id, number: x.invoiceNumber, total: x.grandTotal, status: x.status, createdAt: x.createdAt, fecha: x.invoiceDate, noRepetidaConfirmada: x.noRepetidaConfirmada })))
          const buenas = deEl.filter((x) => !rep.has(x.id))
          const socioSin = socio.filter((s) => s.partyId === t.id && s.formula !== 'anterior' && s.estado === 'confirmada' && s.importe != null)
          const aFavorSuyo = socioSin.filter((s) => (s.importe ?? 0) > 0).reduce((a, s) => a + (s.importe ?? 0), 0)
          const aTuFavor = socioSin.filter((s) => (s.importe ?? 0) < 0).reduce((a, s) => a - (s.importe ?? 0), 0)
          const fechas: { fecha: string; texto: string }[] = [
            ...suyas.filter((l) => l.fecha).map((l) => ({ fecha: l.fecha!, texto: 'liquidación' })),
            ...socio.filter((s) => s.partyId === t.id).map((s) => ({ fecha: s.hasta, texto: 'liquidación del socio' })),
            ...buenas.filter((f) => f.invoiceDate).map((f) => ({ fecha: f.invoiceDate!, texto: 'factura' })),
          ].sort((a, b) => b.fecha.localeCompare(a.fecha))
          return {
            ...t,
            teDebe: Math.round((teDebe(suyas, hoy).total + aTuFavor) * 100) / 100,
            leDebes: Math.round(((calcularCifras(buenas, hoy).leDebes ?? 0) + aFavorSuyo) * 100) / 100,
            ultima: fechas[0] ?? null,
          }
        }))
      })
      .catch((e: unknown) => { if (vivo) setError(e instanceof Error ? e.message : String(e)) })
    return () => { vivo = false }
  }, [accountId, vuelta])
  return { filas, error }
}

export default function TercerosPage() {
  const { accountId, cargando } = useCuentaConta()
  const { activa } = useEmpresas()
  const movil = useIsMobile()
  const [params, setParams] = useSearchParams()
  const filtro = (FILTROS_TERCEROS.some((f) => f.id === params.get('ver')) ? params.get('ver') : 'todos') as FiltroTerceros
  const [busca, setBusca] = useState('')
  const [vuelta, setVuelta] = useState(0)
  const [nuevo, setNuevo] = useState(false)
  // Lo que viene hecho de la ficha (archivar): se dice aquí, con su contenido (regla 8).
  const llegada = useLocation().state as { aviso?: string } | null
  const [hecho, setHecho] = useState<string | null>(llegada?.aviso ?? null)
  const [fallo, setFallo] = useState<string | null>(null)
  const [archivar, setArchivar] = useState<TerceroLista | null>(null)
  const { filas, error } = useTerceros(cargando ? null : accountId, vuelta)
  const revision = useRevision430(cargando ? null : accountId, activa?.id ?? null, vuelta)
  const [revisionAbierta, setRevisionAbierta] = useState(false)
  const cajaRevision = useRef<HTMLElement>(null)
  const pendientes430 = useMemo(() => (revision && filas ? revision.cuentas.filter((c) => !hecha(c, aTerceros430(filas, revision))).length : 0), [revision, filas])
  const revisarAhora = () => {
    setRevisionAbierta(true)
    requestAnimationFrame(() => cajaRevision.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }
  const visibles = useMemo(() => (filas ? filtrarTerceros(filas, filtro, busca) : []), [filas, filtro, busca])
  const cuantos = useMemo(() => (filas ? cuentaPorFiltro(filas) : null), [filas])
  const tarjeta = filas ? tarjetaPorRevisar(filtro, visibles.length, busca, pendientes430, revision?.programa ?? null) : null
  const recargar = () => setVuelta((v) => v + 1)

  async function cambiarArchivo(t: TerceroLista, archivarlo: boolean) {
    setFallo(null); setHecho(null)
    try {
      await archivarTercero(t.id, archivarlo)
      setHecho(archivarlo
        ? `${t.nombre} archivado. Ya no sale en las listas; está en «Archivados» con sus cuentas y su histórico.`
        : `${t.nombre} recuperado: vuelve a salir en la lista.`)
      recargar()
    } catch (e) { setFallo(e instanceof Error ? e.message : 'No se pudo cambiar.') }
  }

  return (
    <div className="cxt-pagina">
      <header className="cxp-cabecera">
        <div className="cxp-titulos">
          <h1 className="cxp-nombre">Clientes y proveedores</h1>
          <span className="cx-ayuda" style={{ fontSize: 15 }}>Con quién trabajas, qué papel tiene cada uno y quién debe a quién.</span>
        </div>
        <button type="button" className="cx-boton" onClick={() => setNuevo(true)} disabled={!accountId}>Nuevo cliente</button>
      </header>
      <Guardado texto={hecho} />
      {fallo && <div className="cx-error" role="alert">{fallo}</div>}

      {accountId && filas && activa && revision && revision.cuentas.length > 0 && (
        <RevisionCuentas ref={cajaRevision} accountId={accountId} companyId={activa.id} terceros={filas} datos={revision}
          abierta={revisionAbierta} setAbierta={setRevisionAbierta} alCambiar={(t) => { setHecho(t); recargar() }} />
      )}
      {accountId && filas && <RevisionAcuerdos accountId={accountId} terceros={filas} alCambiar={(t) => { setHecho(t); recargar() }} />}

      <div className="cxp-lista-barra">
        <label htmlFor="buscar-tercero" className="cx-oculto">Buscar por nombre o NIF</label>
        <input id="buscar-tercero" className="cx-input cxp-buscar" type="search" value={busca} onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por nombre o NIF" />
        <div className="cx-tablas-filtros" role="group" aria-label="Qué terceros ver">
          {FILTROS_TERCEROS.map((f) => (
            <button key={f.id} type="button" className="cx-pildora" aria-pressed={filtro === f.id}
              onClick={() => setParams(f.id === 'todos' ? {} : { ver: f.id }, { replace: true })}>
              {f.texto}{cuantos ? ` · ${cuantos[f.id]}` : ''}
            </button>
          ))}
        </div>
      </div>

      {error && <ErrorConReintento mensaje={error} reintentar={recargar} />}
      {!error && !filas && (
        <div className="cx-tarjeta" aria-busy="true" aria-label="Cargando clientes y proveedores" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[0, 1, 2, 3, 4].map((i) => <Hueso key={i} alto={44} />)}
        </div>
      )}
      {tarjeta && (
        <div className="cx-tarjeta cxt-revision-aviso" role="status">
          <span>{tarjeta}</span>
          <button type="button" className="cx-boton" onClick={revisarAhora}>Revisar ahora</button>
        </div>
      )}
      {filas && visibles.length === 0 && !tarjeta && (
        <div className="cx-tarjeta">
          {busca.trim()
            ? <Vacio titulo={`Nadie coincide con «${busca.trim()}».`} explicacion="Prueba con otra parte del nombre o con su NIF." />
            : filtro === 'archivados'
              ? <Vacio titulo="No hay nadie archivado." explicacion="Lo que archives sale aquí, con su histórico, y se recupera con un clic." />
              : <Vacio titulo="Aún no hay nadie aquí." explicacion="Los proveedores llegan con sus albaranes; los clientes, con «Nuevo cliente»; las plataformas y los socios, añadiéndoles el papel en su ficha." />}
        </div>
      )}
      {visibles.length > 0 && (
        <section className="cx-tarjeta" style={{ padding: '10px 10px' }} aria-label="Clientes y proveedores">
          <div className="cxp-tabla">
            {!movil && (
              <div className="cxp-tabla-cabeza cxt-fila" aria-hidden="true">
                <span>Nombre</span><span>Papeles</span><span style={{ textAlign: 'right' }}>Te debe / Le debes</span><span style={{ textAlign: 'right' }}>Última operación</span>
              </div>
            )}
            {visibles.map((t) => (
              <div key={t.id} className="cxp-tabla-envoltura">
                <Link to={rutaDeTercero(t)} className="cxp-tabla-fila cxt-fila">
                  <span className="cxp-tabla-nombre">
                    <Inicial texto={iniciales(t.nombre)} />
                    <span>
                      <span className="cxp-tabla-titulo">{t.nombre}</span>
                      <span className="cxp-tabla-apoyo">{t.nif ?? 'Sin NIF'}{t.archivadoEn && t.notaArchivado ? ` · ${t.notaArchivado}` : ''}</span>
                    </span>
                  </span>
                  <span className="cxt-papeles">
                    {ordenarPapeles(t.papeles).map((p) => <Chip key={p} tono={p === 'platform' || p === 'brand_partner' ? 'azul' : 'neutro'}>{PILDORA[p]}</Chip>)}
                    {t.archivadoEn && <Chip tono="ambar">Archivado</Chip>}
                  </span>
                  <span className="cxt-debe">
                    {t.teDebe > 0 && <span className="cxp-tabla-cifra">Te debe {euros(t.teDebe)}</span>}
                    {t.leDebes > 0 && <span className="cxp-tabla-cifra">Le debes {euros(t.leDebes)}</span>}
                    {t.teDebe === 0 && t.leDebes === 0 && <span className="cxp-tabla-cifra-apoyo">Nada pendiente</span>}
                  </span>
                  <span className="cxp-tabla-ultima">
                    {t.ultima ? <><span className="cxp-tabla-cifra-apoyo">{diaMesCorto(t.ultima.fecha)}</span><span className="cxp-tabla-apoyo">{t.ultima.texto}</span></>
                      : <span className="cxp-tabla-apoyo">—</span>}
                  </span>
                </Link>
                <MenuFila t={t} alArchivar={() => setArchivar(t)} alRecuperar={() => void cambiarArchivo(t, false)} />
              </div>
            ))}
          </div>
        </section>
      )}
      {filas && filas.length > 0 && (
        <p className="cx-ayuda" style={{ margin: 0 }}>
          {visibles.length === 1 ? '1 tercero' : `${visibles.length} terceros`}
          {filtro !== 'todos' ? ` en «${FILTROS_TERCEROS.find((f) => f.id === filtro)!.texto}»` : ''}
          {busca.trim() ? ` con «${busca.trim()}»` : ''}
          {filtro !== 'archivados' && cuantos?.archivados ? ` · ${cuantos.archivados} archivado${cuantos.archivados === 1 ? '' : 's'} en su filtro` : ''}
        </p>
      )}
      {archivar && (
        <Dialogo titulo={`¿Archivar ${archivar.nombre}?`} alCerrar={() => setArchivar(null)}>
          <p style={{ margin: 0, fontSize: 15 }}>Dejará de salir en las listas y en las propuestas (sale en «Archivados» y se recupera con un clic). No se borra nada: sus cuentas, liquidaciones, facturas y movimientos se quedan.</p>
          <div className="cx-pie">
            <button type="button" className="cx-boton-sec" onClick={() => setArchivar(null)}>Cancelar</button>
            <button type="button" className="cx-boton" onClick={() => { const t = archivar; setArchivar(null); void cambiarArchivo(t, true) }}>Archivar</button>
          </div>
        </Dialogo>
      )}
      {nuevo && accountId && <NuevoCliente accountId={accountId} terceros={filas ?? []} alCerrar={() => setNuevo(false)} />}
    </div>
  )
}

/** «···» de una fila: Abrir y Archivar o Recuperar. */
function MenuFila({ t, alArchivar, alRecuperar }: { t: TerceroLista; alArchivar: () => void; alRecuperar: () => void }) {
  const [abierto, setAbierto] = useState(false)
  const caja = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!abierto) return
    const fuera = (e: MouseEvent) => { if (!caja.current?.contains(e.target as Node)) setAbierto(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAbierto(false) }
    document.addEventListener('mousedown', fuera)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', fuera); document.removeEventListener('keydown', esc) }
  }, [abierto])
  return (
    <div className="cxp-tabla-mas" ref={caja}>
      <button type="button" className="cx-boton-sec cx-mas" aria-haspopup="menu" aria-expanded={abierto}
        aria-label={`Más acciones de ${t.nombre}`} onClick={() => setAbierto((v) => !v)}>···</button>
      {abierto && (
        <div className="cxp-menu" role="menu" aria-label={`Acciones de ${t.nombre}`}>
          <Link role="menuitem" to={rutaDeTercero(t)}>Abrir</Link>
          {t.archivadoEn
            ? <button type="button" role="menuitem" onClick={() => { setAbierto(false); alRecuperar() }}>Recuperar</button>
            : <button type="button" role="menuitem" onClick={() => { setAbierto(false); alArchivar() }}>Archivar</button>}
        </div>
      )}
    </div>
  )
}

/** Alta de cliente. Regla 1: con el NIF de otro tercero, propone añadirle el papel en vez de crear otro. */
function NuevoCliente({ accountId, terceros, alCerrar }: { accountId: string; terceros: TerceroLista[]; alCerrar: () => void }) {
  const { userName } = useCuentaConta()
  const navigate = useNavigate()
  const [nombre, setNombre] = useState('')
  const [nif, setNif] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)
  const [errNombre, setErrNombre] = useState<string | null>(null)
  const nifMal = useMemo(() => {
    if (!nif.trim()) return null
    const r = validarNifEs(nif)
    return r.ok ? null : `${r.motivo} Si es de otro país, déjalo vacío y ponlo en sus datos fiscales.`
  }, [nif])
  const mismo = useMemo(() => (nif.trim() && !nifMal ? mismoNif(terceros, normalizarNif(nif), 'customer') : null), [nif, nifMal, terceros])

  async function crear(e: React.FormEvent) {
    e.preventDefault()
    if (!nombre.trim()) { setErrNombre('Pon el nombre con el que lo conocéis.'); return }
    if (nifMal || mismo) return
    setOcupado(true); setFallo(null)
    try {
      const r = await guardarCliente(accountId, null, nombre.trim(), nif.trim() ? normalizarNif(nif) : null, nif.trim() ? { taxIdType: 'nif_es' } : {}, userName)
      navigate(rutaFichaTercero(r.party_id, 'datos-fiscales'), { state: { aviso: `${nombre.trim()} dado de alta como cliente. Completa sus datos fiscales y su cobro.` } })
    } catch (e2) {
      const otro = terceroDelMismoNif(e2)
      setFallo(otro ? 'Ese NIF ya es de otro tercero: añádele el papel de cliente en vez de crear otro.' : e2 instanceof Error ? e2.message : 'No se pudo crear.')
      setOcupado(false)
    }
  }

  async function anadir() {
    if (!mismo) return
    setOcupado(true); setFallo(null)
    try {
      await anadirPapel(mismo.tercero.id, 'customer')
      navigate(rutaFichaTercero(mismo.tercero.id, 'datos-fiscales'), { state: { aviso: `${mismo.tercero.nombre} ya es también cliente: un solo tercero con los dos papeles.` } })
    } catch (e2) { setFallo(e2 instanceof Error ? e2.message : 'No se pudo añadir el papel.'); setOcupado(false) }
  }

  return (
    <Dialogo titulo="Nuevo cliente" alCerrar={alCerrar}>
      <form className="cx-formulario" onSubmit={crear} noValidate>
        {fallo && <div className="cx-error" role="alert">{fallo}</div>}
        <Campo campo="cli-nombre" etiqueta="Nombre con el que lo conocéis" error={errNombre ?? undefined}>
          {(p) => <input {...p} className="cx-input" value={nombre} onChange={(e) => { setNombre(e.target.value); setErrNombre(null) }} placeholder="Catering Eventos Norte" />}
        </Campo>
        <Campo campo="cli-nif" etiqueta="NIF (opcional)" error={nifMal ?? undefined} ayuda="Con el NIF miro si ya lo tienes como proveedor u otra cosa.">
          {(p) => <input {...p} className="cx-input" value={nif} onChange={(e) => setNif(e.target.value)} autoCapitalize="characters" placeholder="B12345678" />}
        </Campo>
        {mismo && (
          <div className="cx-aviso cx-aviso-ia" role="status">
            <strong>{mismo.texto}</strong>
            {!mismo.yaLoEs && <div className="cx-pie" style={{ marginTop: 8 }}>
              <button type="button" className="cx-boton" onClick={() => void anadir()} disabled={ocupado}>Añadirle el papel de cliente</button>
            </div>}
            {mismo.yaLoEs && <div style={{ marginTop: 8 }}><Link to={rutaDeTercero(mismo.tercero as TerceroLista)}>Abrir su ficha</Link></div>}
          </div>
        )}
        <div className="cx-pie">
          <button type="button" className="cx-boton-sec" onClick={alCerrar}>Cancelar</button>
          <button type="submit" className="cx-boton" disabled={ocupado || !!mismo}>{ocupado ? 'Creando…' : 'Crear y completar su ficha'}</button>
        </div>
      </form>
    </Dialogo>
  )
}

function useRevision430(accountId: string | null, companyId: string | null, vuelta: number): DatosRevision430 | null {
  const [datos, setDatos] = useState<DatosRevision430 | null>(null)
  useEffect(() => {
    if (!accountId || !companyId) return
    let vivo = true
    cargarRevision430(accountId, companyId).then((d) => { if (vivo) setDatos(d) })
      .catch(() => { if (vivo) setDatos({ cuentas: [], codigoDeProveedor: new Map(), canales: [], programa: null }) })
    return () => { vivo = false }
  }, [accountId, companyId, vuelta])
  return datos
}

/** Los terceros como los ve la revisión: con su cuenta de proveedor, para decir cuál es. */
function aTerceros430(terceros: readonly TerceroLista[], d: DatosRevision430): Tercero430[] {
  return terceros.map((t) => ({
    id: t.id, nombre: t.nombre, nif: t.nif, papeles: t.papeles, supplierId: t.supplierId, archivado: !!t.archivadoEn,
    codigoProveedor: t.supplierId ? d.codigoDeProveedor.get(t.supplierId) ?? null : null,
  }))
}

/**
 * La revisión de las 430 traídas de otro programa (encargo §10 y respuesta 3):
 * TODAS, con el papel que propone Folvy, su porqué y su confianza. Las hechas
 * se quedan a la vista, al final, con lo que son (regla 7).
 */
const RevisionCuentas = forwardRef<HTMLElement, {
  accountId: string; companyId: string; terceros: TerceroLista[]; datos: DatosRevision430
  abierta: boolean; setAbierta: (v: boolean) => void; alCambiar: (t: string) => void
}>(function RevisionCuentas({ accountId, companyId, terceros, datos, abierta, setAbierta, alCambiar }, ref) {
  const { userName } = useCuentaConta()
  const [ocupada, setOcupada] = useState<string | null>(null)
  const [fallo, setFallo] = useState<string | null>(null)
  const t430 = useMemo(() => aTerceros430(terceros, datos), [terceros, datos])
  const filas = datos.cuentas.map((c) => ({ c, hecha: hecha(c, t430) }))
  const pendientes = filas.filter((f) => !f.hecha)
  const de = datos.programa ? ` de ${datos.programa}` : ''

  async function confirmar(c: Cuenta430, p: Propuesta430, archivar: boolean) {
    setOcupada(c.id); setFallo(null)
    try {
      alCambiar(await confirmar430({ accountId, companyId, quien: userName }, c, p, { archivar }))
    } catch (e) {
      const otro = terceroDelMismoNif(e)
      setFallo(`${c.code}: ${otro ? 'ese NIF ya es de otro tercero; elige esa ficha con «Cambiar».' : e instanceof Error ? e.message : 'no se pudo confirmar.'}`)
    }
    setOcupada(null)
  }

  return (
    <section ref={ref} className="cx-tarjeta cxt-revision" aria-label="Cuentas de clientes traídas por revisar">
      <div className="cxt-revision-cabeza">
        <div>
          <strong>{pendientes.length === 0
            ? `Las ${filas.length} cuentas de clientes traídas${de} están revisadas`
            : pendientes.length === 1 ? `1 cuenta de cliente traída${de} por revisar` : `${pendientes.length} cuentas de clientes traídas${de} por revisar`}</strong>
          <div className="cx-ayuda">Para cada una te propongo qué es —plataforma, socio de marca, cliente o cuenta tuya— y por qué. Nada se guarda hasta que confirmas.</div>
        </div>
        <button type="button" className="cx-boton-sec" aria-expanded={abierta} onClick={() => setAbierta(!abierta)}>{abierta ? 'Cerrar' : 'Revisar'}</button>
      </div>
      {fallo && <div className="cx-error" role="alert">{fallo}</div>}
      {abierta && [...pendientes, ...filas.filter((f) => f.hecha)].map(({ c, hecha: yaEsta }) => (
        <FilaCuenta430 key={c.id} c={c} hecha={yaEsta} terceros={t430} datos={datos} ocupada={ocupada === c.id} alConfirmar={confirmar} />
      ))}
    </section>
  )
})

const CONFIANZA: Record<Propuesta430['confianza'], string> = { seguro: 'Seguro', probable: 'Probable' }

function FilaCuenta430({ c, hecha: yaEsta, terceros, datos, ocupada, alConfirmar }: {
  c: Cuenta430; hecha: boolean; terceros: Tercero430[]; datos: DatosRevision430; ocupada: boolean
  alConfirmar: (c: Cuenta430, p: Propuesta430, archivar: boolean) => void
}) {
  const propuesta = useMemo(() => proponer430(c, terceros, datos.canales), [c, terceros, datos.canales])
  const [eleccion, setEleccion] = useState<Propuesta430 | null>(null)
  const [cambiando, setCambiando] = useState(false)
  const [tipo, setTipo] = useState<Tipo430>(propuesta.tipo)
  const [q, setQ] = useState('')
  const [archivar, setArchivar] = useState(false)
  const p = eleccion ?? propuesta
  const titulo = <><Link to={rutaMayor(c.code)} className="cx-cifra">{c.code}</Link> · {c.name}{c.nif ? <span className="cx-ayuda"> · {c.nif}</span> : null}</>

  if (yaEsta) {
    const t = terceros.find((x) => x.id === c.clienteDe)
    return (
      <div className="cxt-revision-fila" data-cuenta={c.code}>
        <span className="cxt-revision-titulo">{titulo}</span>
        <span className="cxt-revision-propuesta">
          <Chip tono="azul">Hecha</Chip>{' '}
          {c.propia ? 'Cuenta tuya, sin ficha.' : <>Cuenta de cliente de <strong>{t?.nombre ?? 'su ficha'}</strong>{t ? ` · ${t.papeles.filter((x) => x !== 'supplier').map((x) => PILDORA[x]).join(', ')}` : ''}.</>}
        </span>
        <span />
      </div>
    )
  }

  const candidatos = filtrarTerceros(terceros.map((t) => ({ ...t, archivadoEn: t.archivado ? 'sí' : null, notaArchivado: null, papeles: [...t.papeles] })), 'todos', q).slice(0, 8)
  return (
    <div className="cxt-revision-fila" data-cuenta={c.code} role="group" aria-label={`Cuenta ${c.code}`}>
      <span className="cxt-revision-titulo">{titulo}</span>
      <span className="cxt-revision-propuesta">
        <Chip tono="ia">{TIPO_430[p.tipo]}</Chip>{' '}
        {p.tercero ? <>→ <strong>{p.tercero.nombre}</strong>{p.tercero.codigoProveedor ? ` (${p.tercero.codigoProveedor})` : ''} </> : p.tipo === 'cliente' ? <>→ <strong>ficha nueva</strong> </> : null}
        <Chip tono={p.confianza === 'seguro' ? 'azul' : 'ambar'}>{CONFIANZA[p.confianza]}</Chip>
        <span className="cxt-revision-porque">{p.porque}</span>
        {p.tipo === 'socio' && (
          <label className="cxt-revision-archivar">
            <input type="checkbox" checked={archivar} onChange={(e) => setArchivar(e.target.checked)} /> Archivarlo: ya no trabajáis con él (histórico)
          </label>
        )}
        <span className="cx-ayuda">Al confirmar: {queHace(c, p, archivar)}</span>
      </span>
      <span className="cxt-revision-acciones">
        <button type="button" className="cx-boton" disabled={ocupada || (p.tipo !== 'propia' && p.tipo !== 'cliente' && !p.tercero)}
          aria-label={`Confirmar ${c.code}`} onClick={() => alConfirmar(c, p, archivar)}>{ocupada ? 'Guardando…' : 'Confirmar'}</button>
        <button type="button" className="cx-boton-sec" disabled={ocupada} aria-expanded={cambiando} onClick={() => { setCambiando((v) => !v); setTipo(p.tipo) }}>Cambiar</button>
      </span>
      {cambiando && (
        <div className="cxt-revision-cambiar" role="group" aria-label={`Cambiar ${c.code}`}>
          <div className="cx-tablas-filtros" role="radiogroup" aria-label="Qué es">
            {(Object.keys(TIPO_430) as Tipo430[]).map((x) => (
              <button key={x} type="button" className="cx-pildora" role="radio" aria-checked={tipo === x} onClick={() => {
                setTipo(x)
                if (x === 'propia') { setEleccion(elegida('propia', null, datos.canales)); setCambiando(false) }
              }}>{TIPO_430[x]}</button>
            ))}
          </div>
          {tipo !== 'propia' && (
            <>
              <input className="cx-input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="¿De quién es? Busca por nombre o NIF" aria-label="Buscar su ficha" />
              <div className="cxt-revision-lista">
                {candidatos.map((t) => {
                  const t430 = terceros.find((x) => x.id === t.id)!
                  return <button key={t.id} type="button" className="cx-enlace" onClick={() => { setEleccion(elegida(tipo, t430, datos.canales)); setCambiando(false) }}>Es {t.nombre}{t.nif ? ` · ${t.nif}` : ''}</button>
                })}
                {tipo === 'cliente' && <button type="button" className="cx-enlace" onClick={() => { setEleccion(elegida('cliente', null, datos.canales)); setCambiando(false) }}>Ficha nueva con el nombre de la cuenta</button>}
                {candidatos.length === 0 && <span className="cx-ayuda">Nadie se llama así.</span>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

/** Los acuerdos de cesión que aún apuntan a un nombre suelto: a qué socio van. */
function RevisionAcuerdos({ accountId, terceros, alCambiar }: { accountId: string; terceros: TerceroLista[]; alCambiar: (t: string) => void }) {
  const { userName } = useCuentaConta()
  const { activa } = useEmpresas()
  const [acuerdos, setAcuerdos] = useState<{ id: string; dueno: string; marca: string; pct: number }[] | null>(null)
  const [abierta, setAbierta] = useState(false)
  const [ocupada, setOcupada] = useState<string | null>(null)
  const [fallo, setFallo] = useState<string | null>(null)
  useEffect(() => {
    let vivo = true
    acuerdosSinSocio(accountId).then((a) => { if (vivo) setAcuerdos(a) }).catch(() => { if (vivo) setAcuerdos([]) })
    return () => { vivo = false }
  }, [accountId, terceros])
  if (!acuerdos || acuerdos.length === 0) return null
  const activos = terceros.filter((t) => !t.archivadoEn)

  async function hacer(a: { id: string; dueno: string; marca: string }, partyId: string | null) {
    setOcupada(a.id); setFallo(null)
    try {
      let id = partyId
      if (!id) id = (await guardarCliente(accountId, null, a.dueno, null, {}, userName)).party_id
      if (!terceros.find((t) => t.id === id)?.papeles.includes('brand_partner')) await anadirPapel(id, 'brand_partner')
      await enlazarAcuerdo(a.id, id)
      const nombre = (partyId ? terceros.find((t) => t.id === partyId)?.nombre : null) ?? a.dueno
      const cuenta = activa ? await asegurarCuentaLiquidacion(activa.id, id, nombre, userName) : null
      alCambiar(`El acuerdo de ${a.marca} va a ${nombre}, socio de marca.${cuenta?.nueva ? ` Lo que cobres por su cuenta irá a la ${cuenta.code} «Liquidación pendiente con ${nombre}».` : ''}`)
    } catch (e) { setFallo(e instanceof Error ? e.message : 'No se pudo enlazar.') }
    setOcupada(null)
  }

  return (
    <section className="cx-tarjeta cxt-revision" aria-label="Acuerdos de cesión sin socio">
      <div className="cxt-revision-cabeza">
        <div>
          <strong>{acuerdos.length === 1 ? '1 acuerdo de cesión sin su socio' : `${acuerdos.length} acuerdos de cesión sin su socio`}</strong>
          <div className="cx-ayuda">Dime qué socio de marca es cada uno: su liquidación mensual sale de aquí.</div>
        </div>
        <button type="button" className="cx-boton-sec" aria-expanded={abierta} onClick={() => setAbierta((v) => !v)}>{abierta ? 'Cerrar' : 'Revisar'}</button>
      </div>
      {fallo && <div className="cx-error" role="alert">{fallo}</div>}
      {abierta && acuerdos.map((a) => {
        const propuesta = activos.find((t) => parecido(t.nombre, a.dueno) === 'igual') ?? activos.find((t) => parecido(t.nombre, a.dueno) === 'parecido') ?? null
        return <FilaRevision key={a.id} titulo={<>{a.marca} · {a.dueno} · {String(a.pct).replace('.', ',')} %</>}
          propuesta={propuesta} terceros={activos} ocupada={ocupada === a.id}
          alElegir={(id) => void hacer(a, id)} crearTexto="Crear socio con este nombre" alCrear={() => void hacer(a, null)} />
      })}
    </section>
  )
}

function FilaRevision({ titulo, propuesta, terceros, ocupada, alElegir, crearTexto, alCrear }: {
  titulo: React.ReactNode; propuesta: TerceroLista | null; terceros: TerceroLista[]; ocupada: boolean
  alElegir: (partyId: string) => void; crearTexto: string; alCrear: () => void
}) {
  const [cambiando, setCambiando] = useState(false)
  const [q, setQ] = useState('')
  const lista = filtrarTerceros(terceros, 'todos', q).slice(0, 8)
  return (
    <div className="cxt-revision-fila">
      <span className="cxt-revision-titulo">{titulo}</span>
      <span className="cxt-revision-propuesta">
        {propuesta ? <>Propongo <strong>{propuesta.nombre}</strong> <Chip tono="ia">por el nombre</Chip></> : <span className="cx-ayuda">No encuentro a nadie con ese nombre.</span>}
      </span>
      <span className="cxt-revision-acciones">
        {propuesta && <button type="button" className="cx-boton" disabled={ocupada} onClick={() => alElegir(propuesta.id)}>Es este</button>}
        <button type="button" className="cx-boton-sec" disabled={ocupada} aria-expanded={cambiando} onClick={() => setCambiando((v) => !v)}>Cambiar</button>
        <button type="button" className="cx-boton-sec" disabled={ocupada} onClick={alCrear}>{crearTexto}</button>
      </span>
      {cambiando && (
        <div className="cxt-revision-cambiar">
          <input className="cx-input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Busca por nombre o NIF" aria-label="Buscar tercero" autoFocus />
          <div className="cxt-revision-lista">
            {lista.map((t) => <button key={t.id} type="button" className="cx-enlace" onClick={() => { setCambiando(false); alElegir(t.id) }}>Es {t.nombre}{t.nif ? ` · ${t.nif}` : ''}</button>)}
            {lista.length === 0 && <span className="cx-ayuda">Nadie se llama así.</span>}
          </div>
        </div>
      )}
    </div>
  )
}

