// src/modules/conta/bancos/BancosPage.tsx
//
// B01 · Bancos. Desde el paso 3 del S01 vive en el esqueleto: sus pestañas
// (Movimientos · Reglas · Cuentas y extractos · Cierre del mes) van en la
// cabecera, y su barra de acciones en la cinta de la pestaña: TUS BANCOS (los
// pone esta pantalla: useEntradasEnCinta) · TRAER MOVIMIENTOS · AUTOMÁTICO ·
// REVISAR. «Tuyos» se va: Favoritos y Ctrl K son del esqueleto, para todo.
// El mes, en la cabecera (PeriodoEnBarra), como el ejercicio de Libros.
//
// El gesto único (respuesta 3, punto 2): un extracto se puede SOLTAR en
// cualquier pantalla de Bancos; abre «Subir extracto» con él.
//
// Lo que no funciona no se enseña (respuestas 3 y 4): ni «Por correo», ni
// «Conectar» (llega con el contrato del agregador), ni tarjetas de crédito, ni
// la barra «Pregunta o pide algo» mientras solo diga «Muy pronto».
//
// Respuesta 4: los bancos con su nombre corto; a partir de cinco, tres a la
// vista (el de más dudas siempre) y «y N más».
//
// El agente «Conciliación» (tarea 6): si hoy aún no ha pasado, la primera vez
// que alguien abre Bancos hace la pasada del día (con las guardas de siempre).
//
// En el móvil (patrón M4): la portada con dos cifras, la frase verde y los
// apartados de 56 px; cada apartado abre su pantalla con «‹ Bancos». Ahí el
// esqueleto no pone ni pestañas ni cinta (productos.ts: portadaMovil).

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { rutaBancos } from '@/config/navegacion'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useIsMobile } from '@/shell/useIsMobile'
import { Dialogo } from '@/modules/conta/proveedor/piezas'
import { ErrorConReintento, Hueso, Vacio } from '@/modules/conta/ui/piezas'
import { hoyEnMadrid } from '@/modules/conta/lib/formato'
import { useLeerConservando } from '@/modules/conta/bancos/useLeerConservando'
import { bancosEnBarra, estadoBanco, mesesElegibles, nombreCorto, nombreMes, ultimosIban } from '@/modules/conta/lib/bancosVista'
import { agenteTocaHoy, leerDatosBancos, leerHechos, pasarAgente } from '@/modules/conta/services/bancosPantallas'
import { refrescarCuentasMenu } from '@/modules/conta/marco/useCuentasMenu'
import { BancosCtx, type ContextoBancos } from '@/modules/conta/bancos/contexto'
import { bancoInicial, mesInicial, resolverVista, type VistaBancos } from '@/modules/conta/bancos/navegacion'
import { BotonPeriodo } from '@/modules/conta/marco/BotonPeriodo'
import { nombreDelMes } from '@/modules/conta/marco/periodo'
import { PeriodoEnBarra } from '@/modules/conta/ui/marco/PeriodoEnBarra'
import { useDatosEnCinta, useEntradasEnCinta, type EntradaPantalla } from '@/modules/conta/marco/nuevo/contexto'
import { Movimientos } from '@/modules/conta/bancos/Movimientos'
import { PortadaMovil } from '@/modules/conta/bancos/PortadaMovil'
import { Reglas } from '@/modules/conta/bancos/Reglas'
import { CuentasYExtractos } from '@/modules/conta/bancos/CuentasYExtractos'
import { CierreDelMes } from '@/modules/conta/bancos/CierreDelMes'
import { SubirExtracto } from '@/modules/conta/bancos/SubirExtracto'
import { HechoPorFolvy } from '@/modules/conta/bancos/HechoPorFolvy'
import { PARAM_NUEVO, VALOR_NUEVO } from '@/modules/conta/bancos/bancoNuevo'


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
  const { pathname } = useLocation()
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
  const bancos = datos.datos?.bancos ?? []
  // S01e: sin ?banco ni ?mes, se abre donde hay movimientos (el banco y el mes de su último extracto).
  const banco = bancos.find((b) => b.id === query.get('banco')) ?? bancoInicial(bancos, datos.datos?.dudas ?? {})
  const mes = meses.includes(query.get('mes') ?? '') ? query.get('mes')! : mesInicial(meses, banco, hoy)
  const hechos = useLeerConservando(accountId && activa ? () => leerHechos(accountId, activa.id, mes) : null, ambito, `${mes}:${vuelta}`)
  // Lo casado solo que sigue vivo: lo deshecho ya no es «hecho por Folvy».
  const casadosSolos = (hechos.datos ?? []).filter((h) => h.porQuien === 'folvy' && h.accion === 'casado' && h.casadoVivo).length

  // La pasada del día del agente: una vez por empresa y visita, si hoy no ha corrido.
  const pasadaHecha = useRef<string | null>(null)
  const [pasando, setPasando] = useState(false)
  useEffect(() => {
    if (!accountId || !activa || pasadaHecha.current === activa.id) return
    pasadaHecha.current = activa.id
    let vivo = true
    agenteTocaHoy(activa.id).then(async (toca) => {
      if (!toca || !vivo) return
      setPasando(true)
      try { await pasarAgente(accountId, activa.id, hoy, 'diario'); refrescarCuentasMenu() } catch (e) { console.error('[bancos] la pasada del día no se ha podido hacer', e) }
      if (vivo) { setPasando(false); setVuelta((v) => v + 1) }
    }, (e: unknown) => console.error('[bancos] no sé si toca la pasada del día', e))
    return () => { vivo = false }
  }, [accountId, activa, hoy])
  const [masBancos, setMasBancos] = useState(false)

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

  // La cinta: los bancos de la empresa en «Tus bancos» y lo que se sabe de las demás órdenes.
  const dudasDe = (id: string) => datos.datos?.dudas[id] ?? 0
  const entradas: EntradaPantalla[] = (() => {
    if (!datos.datos) return []
    if (bancos.length === 0) return [{ id: 'alta', etiqueta: 'Dar de alta un banco', a: conQuery(rutaBancos('cuentas'), { [PARAM_NUEVO]: VALOR_NUEVO }), dato: 'En Cuentas y extractos' }]
    const { visibles, resto } = bancosEnBarra(bancos, datos.datos.dudas, banco?.id ?? null)
    const lista: EntradaPantalla[] = visibles.map((b) => {
      const e = estadoBanco(dudasDe(b.id), !!b.ultimoExtracto)
      const u = ultimosIban(b.iban)
      return {
        id: b.id, etiqueta: nombreCorto(b), a: conQuery(pathname, { banco: b.id }), actual: b.id === banco?.id,
        aviso: e.tono === 'ambar', numero: dudasDe(b.id) || undefined, titulo: `${b.nombre}${u ? ` · ···${u}` : ''} · ${e.texto}`,
      }
    })
    if (resto.length > 0) {
      const dudas = resto.reduce((t, b) => t + dudasDe(b.id), 0)
      lista.push({ id: 'mas', etiqueta: `y ${resto.length} más`, alPulsar: () => setMasBancos(true), aviso: dudas > 0, titulo: `${dudas} dudas en los demás` })
    }
    return lista
  })()
  useEntradasEnCinta(datos.datos ? { bancos: entradas } : null)
  useDatosEnCinta(datos.datos ? {
    'bancos.subir': { dato: 'Norma 43 · Excel' },
    'bancos.reglas': { numero: datos.datos.reglas.activas, dato: datos.datos.reglas.nuevas ? `${datos.datos.reglas.nuevas} nuevas` : undefined, aviso: datos.datos.reglas.nuevas > 0 },
    // S01e: dice qué cuenta (el mes elegido, todos los bancos), como la banda de «Lo que he hecho».
    'bancos.casados': { numero: casadosSolos, dato: `${casadosSolos} en ${nombreMes(mes).toLowerCase()}, en todos tus bancos` },
  } : null)

  if (!accountId && !cargando) return <Vacio titulo="No hay cuenta activa." explicacion="Elige una cuenta para ver sus bancos." />
  if (datos.error) return <ErrorConReintento mensaje={datos.error} reintentar={datos.recargar} />
  if (!ctx) return <div className="cx-tarjeta" aria-busy="true" aria-label="Cargando los bancos">{[0, 1, 2].map((i) => <Hueso key={i} alto={40} />)}</div>

  const dudasMes = (id: string) => ctx.datos.dudas[id] ?? 0

  return (
    <BancosCtx.Provider value={ctx}>
      <div className="cxl-pagina cxb-pagina" onDragOver={alArrastrar} onDragLeave={(e) => { if (e.currentTarget === e.target) setSoltando(false) }} onDrop={alSoltar}>
        {movil ? (
          <header className="cxl-cabeza">
            <div>
              <span className="cxl-ante">Contabilidad</span>
              <h1 className="cxl-titulo">Bancos</h1>
            </div>
            {!enPortadaMovil && (
              // S02 · El mismo botón del periodo que en el ordenador, en la fila de la empresa.
              <PeriodoEnBarra>
                <BotonPeriodo tipo="mes" valor={mes} opciones={meses.map((m) => ({ valor: m, etiqueta: nombreDelMes(m) }))}
                  alCambiar={(v) => { const p = new URLSearchParams(query); p.set('mes', v); setQuery(p, { replace: true }) }} />
              </PeriodoEnBarra>
            )}
          </header>
        ) : (
          <>
            <h1 className="cx-oculto">Bancos</h1>
            {/* S02 · El periodo, con el mismo control y el mismo formato que en todas las páginas que lo leen. */}
            <PeriodoEnBarra>
              <BotonPeriodo tipo="mes" valor={mes} opciones={meses.map((m) => ({ valor: m, etiqueta: nombreDelMes(m) }))}
                alCambiar={(v) => { const p = new URLSearchParams(query); p.set('mes', v); setQuery(p, { replace: true }) }} />
            </PeriodoEnBarra>
          </>
        )}

        {enPortadaMovil ? <PortadaMovil /> : (
          <>
            {movil && <Link to={conQuery(rutaBancos())} className="cx-enlace">‹ Bancos</Link>}
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
        {masBancos && (
          <Dialogo titulo="Tus bancos" alCerrar={() => setMasBancos(false)}>
            <ul className="cxl-buscar-lista">
              {bancos.map((b) => {
                const e = estadoBanco(dudasMes(b.id), !!b.ultimoExtracto)
                return (
                  <li key={b.id}><a href="#" onClick={(ev) => { ev.preventDefault(); ctx.elegirBanco(b.id); setMasBancos(false) }}>
                    <span><span className={`cxl-punto cxl-punto-${e.tono}`} aria-hidden="true" /> {b.nombre}</span><span className="cx-ayuda">{e.texto}</span></a></li>
                )
              })}
            </ul>
          </Dialogo>
        )}
        {pasando && <div className="cx-ayuda" role="status">Haciendo la pasada del día: miro los movimientos pendientes…</div>}
      </div>
    </BancosCtx.Provider>
  )
}
