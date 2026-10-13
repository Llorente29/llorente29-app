// src/modules/conta/bancos/BancosPage.tsx
//
// B01 · Bancos en tres niveles (maqueta N17Bancos). Nivel 1, el menú lateral
// (MarcoConta). Nivel 2, las pestañas: Movimientos · Reglas · Cuentas y
// extractos · Cierre del mes. Nivel 3, la barra de acciones agrupadas con su
// etiqueta debajo: TUS BANCOS · TRAER MOVIMIENTOS · AUTOMÁTICO, y «Tuyos» a la
// derecha (favoritos y Ctrl K), como Libros.
//
// El gesto único (respuesta 3, punto 2): un extracto se puede SOLTAR en
// cualquier pantalla de Bancos; abre «Subir extracto» con él.
//
// Lo que no funciona no se enseña (respuesta 3, punto 4): ni «Por correo» en
// la barra, ni tarjetas de crédito. «Conectar» sale en gris con «pronto»,
// como en la maqueta, y no se puede pulsar.
//
// En el móvil (patrón M4): la portada con dos cifras, la frase verde y los
// apartados de 56 px; cada apartado abre su pantalla con «‹ Bancos».

import { useCallback, useEffect, useMemo, useState, type DragEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { rutaBancos } from '@/config/navegacion'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useIsMobile } from '@/shell/useIsMobile'
import { Dialogo } from '@/modules/conta/proveedor/piezas'
import { ErrorConReintento, Hueso, Vacio } from '@/modules/conta/ui/piezas'
import { hoyEnMadrid } from '@/modules/conta/lib/formato'
import { useLeerConservando } from '@/modules/conta/bancos/useLeerConservando'
import { estadoBanco, mesesElegibles, nombreMes, ultimosIban } from '@/modules/conta/lib/bancosVista'
import { leerDatosBancos, leerHechos } from '@/modules/conta/services/bancosPantallas'
import { BancosCtx, type ContextoBancos } from '@/modules/conta/bancos/contexto'
import {
  NOMBRE_VISTA, PESTANAS_BANCOS, alternarFavorito, buscarEnBancos, leerFavoritos, pestanaDe, resolverVista, type VistaBancos,
} from '@/modules/conta/bancos/navegacion'
import { Movimientos } from '@/modules/conta/bancos/Movimientos'
import { PortadaMovil } from '@/modules/conta/bancos/PortadaMovil'
import { Reglas } from '@/modules/conta/bancos/Reglas'
import { CuentasYExtractos } from '@/modules/conta/bancos/CuentasYExtractos'
import { CierreDelMes } from '@/modules/conta/bancos/CierreDelMes'
import { SubirExtracto } from '@/modules/conta/bancos/SubirExtracto'
import { HechoPorFolvy } from '@/modules/conta/bancos/HechoPorFolvy'

const almacen = (): Storage | null => { try { return window.localStorage } catch { return null } }

function contenido(v: VistaBancos): ReactNode {
  switch (v) {
    case 'movimientos': return <Movimientos />
    case 'reglas': return <Reglas />
    case 'cuentas': return <CuentasYExtractos />
    case 'cierre': return <CierreDelMes />
    case 'subir': return <SubirExtracto />
    case 'hecho': return <HechoPorFolvy />
  }
}

export default function BancosPage() {
  const { accountId, cargando, userName } = useCuentaConta()
  const { activa } = useEmpresas()
  const movil = useIsMobile()
  const params = useParams()
  const [query, setQuery] = useSearchParams()
  const navegar = useNavigate()
  const [vuelta, setVuelta] = useState(0)
  const [archivo, setArchivo] = useState<File | null>(null)
  const [soltando, setSoltando] = useState(false)
  const vista = resolverVista(params.pestana)
  const enPortadaMovil = movil && !params.pestana
  const hoy = hoyEnMadrid()

  const ambito = `${accountId}:${activa?.id}`
  const datos = useLeerConservando(accountId && activa ? () => leerDatosBancos(accountId, activa.id) : null, ambito, String(vuelta))
  const meses = useMemo(() => mesesElegibles(datos.datos?.primerMovimiento ?? null, hoy), [datos.datos, hoy])
  const mes = meses.includes(query.get('mes') ?? '') ? query.get('mes')! : meses[0] ?? hoy.slice(0, 7)
  const bancos = datos.datos?.bancos ?? []
  const banco = bancos.find((b) => b.id === query.get('banco')) ?? bancos[0] ?? null
  const hechos = useLeerConservando(accountId && activa ? () => leerHechos(accountId, activa.id, mes) : null, ambito, `${mes}:${vuelta}`)
  const casadosSolos = (hechos.datos ?? []).filter((h) => h.porQuien === 'folvy' && h.accion === 'casado').length

  const usuario = userName ?? 'yo'
  const [favoritos, setFavoritos] = useState<VistaBancos[]>(() => leerFavoritos(usuario, almacen()))
  const [buscando, setBuscando] = useState(false)
  useEffect(() => {
    const tecla = (ev: KeyboardEvent) => { if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k') { ev.preventDefault(); setBuscando(true) } }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [])

  const conQuery = useCallback((ruta: string, cambios: Record<string, string> = {}) => {
    const p = new URLSearchParams(query)
    for (const [k, v] of Object.entries(cambios)) p.set(k, v)
    const q = p.toString()
    return q ? `${ruta}?${q}` : ruta
  }, [query])

  const ctx: ContextoBancos | null = useMemo(() => (accountId && activa && datos.datos ? {
    accountId, companyId: activa.id, quien: userName ?? null, movil, hoy, datos: datos.datos, banco, mes,
    elegirBanco: (id: string) => { const p = new URLSearchParams(query); p.set('banco', id); setQuery(p, { replace: true }) },
    subir: (f?: File) => { if (f) setArchivo(f); navegar(conQuery(rutaBancos('subir'))) },
    archivo, tomarArchivo: () => { const f = archivo; setArchivo(null); return f },
    vuelta, recargar: () => setVuelta((v) => v + 1),
  } : null), [accountId, activa, datos.datos, banco, mes, movil, hoy, userName, query, setQuery, navegar, conQuery, archivo, vuelta])

  // El gesto único: soltar el fichero en cualquier sitio de Bancos.
  const alArrastrar = (e: DragEvent) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setSoltando(true) } }
  const alSoltar = (e: DragEvent) => {
    e.preventDefault(); setSoltando(false)
    const f = e.dataTransfer.files?.[0]
    if (f && ctx) ctx.subir(f)
  }

  if (!accountId && !cargando) return <Vacio titulo="No hay cuenta activa." explicacion="Elige una cuenta para ver sus bancos." />
  if (datos.error) return <ErrorConReintento mensaje={datos.error} reintentar={datos.recargar} />
  if (!ctx) return <div className="cx-tarjeta" aria-busy="true" aria-label="Cargando los bancos">{[0, 1, 2].map((i) => <Hueso key={i} alto={40} />)}</div>

  const pestana = pestanaDe(vista)
  const dudasMes = (id: string) => ctx.datos.dudas[id] ?? 0

  return (
    <BancosCtx.Provider value={ctx}>
      <div className="cxl-pagina cxb-pagina" onDragOver={alArrastrar} onDragLeave={(e) => { if (e.currentTarget === e.target) setSoltando(false) }} onDrop={alSoltar}>
        <header className="cxl-cabeza">
          <div>
            <span className="cxl-ante">Contabilidad</span>
            <h1 className="cxl-titulo">Bancos</h1>
          </div>
          {!enPortadaMovil && (
            <label>
              <span className="cx-oculto">Mes</span>
              <select className="cx-input cxb-mes" value={mes} onChange={(e) => { const p = new URLSearchParams(query); p.set('mes', e.target.value); setQuery(p, { replace: true }) }}>
                {meses.map((m) => <option key={m} value={m}>{nombreMes(m)} {m.slice(0, 4)}</option>)}
              </select>
            </label>
          )}
        </header>

        {enPortadaMovil ? <PortadaMovil casadosSolos={casadosSolos} /> : (
          <>
            {movil ? <Link to={conQuery(rutaBancos())} className="cx-enlace">‹ Bancos</Link> : (
              <nav className="cxl-areas" aria-label="Pestañas de Bancos">
                {PESTANAS_BANCOS.map((p) => (
                  <Link key={p.id} to={conQuery(rutaBancos(p.id === 'movimientos' ? undefined : p.id))} className="cxl-area" aria-current={p.id === pestana ? 'page' : undefined}>{p.nombre}</Link>
                ))}
              </nav>
            )}

            {!movil && (
              <nav className="cxl-barra" aria-label="Acciones de Bancos">
                <div className="cxl-barra-grupos">
                  <div className="cxl-grupo" role="group" aria-label="Tus bancos">
                    <div className="cxl-grupo-acciones">
                      {bancos.map((b) => {
                        const e = estadoBanco(dudasMes(b.id), !!b.ultimoExtracto)
                        const u = ultimosIban(b.iban)
                        return (
                          <button key={b.id} type="button" className="cxl-accion" aria-current={b.id === banco?.id ? 'page' : undefined} onClick={() => ctx.elegirBanco(b.id)}>
                            <span className="cxl-accion-nombre">{b.nombre} <span className={`cxl-punto cxl-punto-${e.tono}`} aria-hidden="true" /></span>
                            <span className="cxl-accion-dato">{u ? `··· ${u} · ` : ''}{e.texto}</span>
                          </button>
                        )
                      })}
                      {bancos.length === 0 && <Link to={conQuery(rutaBancos('cuentas'))} className="cxl-accion"><span className="cxl-accion-nombre">Dar de alta un banco</span><span className="cxl-accion-dato">en Cuentas y extractos</span></Link>}
                    </div>
                    <span className="cxl-grupo-etiqueta">Tus bancos</span>
                  </div>
                  <div className="cxl-grupo" role="group" aria-label="Traer movimientos">
                    <div className="cxl-grupo-acciones">
                      <Link to={conQuery(rutaBancos('subir'))} className="cxl-accion" aria-current={vista === 'subir' ? 'page' : undefined}>
                        <span className="cxl-accion-nombre">Subir extracto <span className="cxl-punto cxl-punto-verde" aria-hidden="true" /></span>
                        <span className="cxl-accion-dato">Norma 43 · Excel</span>
                      </Link>
                      <span className="cxl-accion cxl-accion-gris" aria-disabled="true" title="La conexión directa con el banco llega más adelante">
                        <span className="cxl-accion-nombre">Conectar <span className="cxl-punto" aria-hidden="true" /></span>
                        <span className="cxl-accion-dato">pronto</span>
                      </span>
                    </div>
                    <span className="cxl-grupo-etiqueta">Traer movimientos</span>
                  </div>
                  <div className="cxl-grupo" role="group" aria-label="Automático">
                    <div className="cxl-grupo-acciones">
                      <Link to={conQuery(rutaBancos('reglas'))} className="cxl-accion" aria-current={vista === 'reglas' ? 'page' : undefined}>
                        <span className="cxl-accion-nombre">Reglas <span className={`cxl-punto${ctx.datos.reglas.activas ? ' cxl-punto-verde' : ''}`} aria-hidden="true" /></span>
                        <span className="cxl-accion-dato">{ctx.datos.reglas.activas}{ctx.datos.reglas.nuevas ? ` · ${ctx.datos.reglas.nuevas} nuevas` : ''}</span>
                      </Link>
                      <Link to={conQuery(rutaBancos('hecho'))} className="cxl-accion" aria-current={vista === 'hecho' ? 'page' : undefined}>
                        <span className="cxl-accion-nombre">Hecho por Folvy <span className={`cxl-punto${casadosSolos ? ' cxl-punto-verde' : ''}`} aria-hidden="true" /></span>
                        <span className="cxl-accion-dato">{casadosSolos} este mes</span>
                      </Link>
                    </div>
                    <span className="cxl-grupo-etiqueta">Automático</span>
                  </div>
                </div>
                <div className="cxl-tuyos" role="group" aria-label="Tuyos">
                  <div className="cxl-grupo-acciones">
                    <button type="button" className="cxl-accion" aria-pressed={favoritos.includes(vista)}
                      onClick={() => setFavoritos(alternarFavorito(usuario, vista, almacen()))}
                      title={favoritos.includes(vista) ? `Quitar «${NOMBRE_VISTA[vista]}» de favoritos` : `Guardar «${NOMBRE_VISTA[vista]}» en favoritos`}>
                      <span className="cxl-accion-nombre">{favoritos.includes(vista) ? '★' : '☆'} <span className={`cxl-punto${favoritos.length ? ' cxl-punto-verde' : ''}`} aria-hidden="true" /></span>
                      <span className="cxl-accion-dato">favoritos</span>
                    </button>
                    <button type="button" className="cxl-accion" onClick={() => setBuscando(true)} aria-keyshortcuts="Control+K">
                      <span className="cxl-accion-nombre">⌕</span><span className="cxl-accion-dato">Ctrl K</span>
                    </button>
                  </div>
                  <span className="cxl-grupo-etiqueta">Tuyos</span>
                </div>
              </nav>
            )}
            {!movil && favoritos.length > 0 && (
              <div className="cx-tablas-filtros" role="group" aria-label="Tus favoritos">
                {favoritos.map((f) => <Link key={f} to={conQuery(rutaBancos(f === 'movimientos' ? undefined : f))} className="cx-pildora" aria-pressed={f === vista}>★ {NOMBRE_VISTA[f]}</Link>)}
              </div>
            )}
            {hechos.error && <div className="cx-error" role="alert">{hechos.error}</div>}
            <div key={vista}>{contenido(vista)}</div>
          </>
        )}

        {soltando && (
          <div className="cxb-soltar" aria-hidden="true">
            <div className="cxb-soltar-caja">
              <strong>Suelta aquí el extracto</strong>
              <span>Norma 43 o Excel, de una cuenta o de varias. Lo leo, lo cuadro y te digo a qué cuenta va cada una.</span>
            </div>
          </div>
        )}
        {buscando && <Buscar alCerrar={() => setBuscando(false)} alElegir={(v) => { setBuscando(false); navegar(conQuery(rutaBancos(v === 'movimientos' ? undefined : v))) }} />}
      </div>
    </BancosCtx.Provider>
  )
}

function Buscar({ alCerrar, alElegir }: { alCerrar: () => void; alElegir: (v: VistaBancos) => void }) {
  const [q, setQ] = useState('')
  const r = buscarEnBancos(q)
  return (
    <Dialogo titulo="Buscar en Bancos" alCerrar={alCerrar}>
      <input className="cx-input" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Escribe: extracto, tarjetas, reglas, cierre…"
        aria-label="Qué buscas" onKeyDown={(e) => { if (e.key === 'Enter' && r[0]) alElegir(r[0].vista) }} />
      {q && r.length === 0 && <p className="cx-ayuda">No hay ninguna opción que se llame así.</p>}
      <ul className="cxl-buscar-lista">
        {r.map((x) => (
          <li key={`${x.vista}:${x.nombre}`}><a href="#" onClick={(e) => { e.preventDefault(); alElegir(x.vista) }}>
            <span>{x.nombre}</span><span className="cx-ayuda">Bancos › {x.donde}</span></a></li>
        ))}
      </ul>
    </Dialogo>
  )
}
