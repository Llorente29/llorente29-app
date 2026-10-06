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
// Arriba, las dos revisiones que deja la importación: las cuentas de cliente
// traídas de otro programa que no son de nadie (propone la ficha por nombre;
// la persona confirma) y los acuerdos de cesión que aún no apuntan a su socio.
// Nada se enlaza sin «Es este».
// Regla 7 de CLAUDE.md: ningún filtro esconde filas que existen; los archivados
// están en su filtro y lo dicen.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
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
  acuerdosSinSocio, anadirPapel, archivarTercero, cuentas430SinFicha, enlazarAcuerdo, enlazarCuentaCliente, guardarCliente,
  liquidacionesDeLaCuenta, liquidacionesSocioDe, listarFacturasDeLaCuenta, listarTercerosBase, terceroDelMismoNif, type TerceroLista,
} from '@/modules/conta/services/tercerosService'

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
  const [hecho, setHecho] = useState<string | null>(null)
  const [fallo, setFallo] = useState<string | null>(null)
  const [archivar, setArchivar] = useState<TerceroLista | null>(null)
  const { filas, error } = useTerceros(cargando ? null : accountId, vuelta)
  const visibles = useMemo(() => (filas ? filtrarTerceros(filas, filtro, busca) : []), [filas, filtro, busca])
  const cuantos = useMemo(() => (filas ? cuentaPorFiltro(filas) : null), [filas])
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

      {accountId && filas && activa && <RevisionCuentas accountId={accountId} companyId={activa.id} terceros={filas} alCambiar={(t) => { setHecho(t); recargar() }} />}
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
      {filas && visibles.length === 0 && (
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

/**
 * La revisión de las cuentas de cliente traídas de otro programa sin ficha
 * (encargo §10: «Julio enlaza las 430 de Diez a sus fichas desde la revisión
 * que propondrá Folvy»). Propone por nombre; nada se enlaza sin «Es este».
 */
function RevisionCuentas({ accountId, companyId, terceros, alCambiar }: { accountId: string; companyId: string; terceros: TerceroLista[]; alCambiar: (t: string) => void }) {
  const { userName } = useCuentaConta()
  const [cuentas, setCuentas] = useState<{ id: string; code: string; name: string }[] | null>(null)
  const [abierta, setAbierta] = useState(false)
  const [ocupada, setOcupada] = useState<string | null>(null)
  const [fallo, setFallo] = useState<string | null>(null)
  useEffect(() => {
    let vivo = true
    cuentas430SinFicha(accountId, companyId).then((c) => { if (vivo) setCuentas(c) }).catch(() => { if (vivo) setCuentas([]) })
    return () => { vivo = false }
  }, [accountId, companyId, terceros])
  if (!cuentas || cuentas.length === 0) return null
  const activos = terceros.filter((t) => !t.archivadoEn)
  const nombreDe = (c: { name: string }) => c.name.replace(/^Clientes · /, '')

  async function hacer(cuenta: { id: string; code: string; name: string }, partyId: string | null) {
    setOcupada(cuenta.id); setFallo(null)
    try {
      let id = partyId
      if (!id) id = (await guardarCliente(accountId, null, nombreDe(cuenta), null, {}, userName)).party_id
      else if (!terceros.find((t) => t.id === id)?.papeles.includes('customer')) await anadirPapel(id, 'customer')
      await enlazarCuentaCliente(companyId, id, cuenta.id, userName)
      alCambiar(`${cuenta.code} enlazada a ${partyId ? terceros.find((t) => t.id === partyId)?.nombre : nombreDe(cuenta)} como su cuenta de cliente.`)
    } catch (e) { setFallo(e instanceof Error ? e.message : 'No se pudo enlazar.') }
    setOcupada(null)
  }

  return (
    <section className="cx-tarjeta cxt-revision" aria-label="Cuentas de cliente sin ficha">
      <div className="cxt-revision-cabeza">
        <div>
          <strong>{cuentas.length === 1 ? '1 cuenta de cliente traída sin ficha' : `${cuentas.length} cuentas de cliente traídas sin ficha`}</strong>
          <div className="cx-ayuda">Vienen de tu programa anterior. Dime de quién es cada una: así su saldo y sus movimientos van a su ficha.</div>
        </div>
        <button type="button" className="cx-boton-sec" aria-expanded={abierta} onClick={() => setAbierta((v) => !v)}>{abierta ? 'Cerrar' : 'Revisar'}</button>
      </div>
      {fallo && <div className="cx-error" role="alert">{fallo}</div>}
      {abierta && cuentas.map((c) => {
        const propuesta = activos.find((t) => parecido(t.nombre, nombreDe(c)) === 'igual') ?? activos.find((t) => parecido(t.nombre, nombreDe(c)) === 'parecido') ?? null
        return <FilaRevision key={c.id} titulo={<><Link to={rutaMayor(c.code)} className="cx-cifra">{c.code}</Link> · {c.name}</>}
          propuesta={propuesta} terceros={activos} ocupada={ocupada === c.id}
          alElegir={(id) => void hacer(c, id)} crearTexto="Crear cliente con este nombre" alCrear={() => void hacer(c, null)} />
      })}
    </section>
  )
}

/** Los acuerdos de cesión que aún apuntan a un nombre suelto: a qué socio van. */
function RevisionAcuerdos({ accountId, terceros, alCambiar }: { accountId: string; terceros: TerceroLista[]; alCambiar: (t: string) => void }) {
  const { userName } = useCuentaConta()
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
      alCambiar(`El acuerdo de ${a.marca} va a ${partyId ? terceros.find((t) => t.id === partyId)?.nombre : a.dueno}, socio de marca.`)
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

