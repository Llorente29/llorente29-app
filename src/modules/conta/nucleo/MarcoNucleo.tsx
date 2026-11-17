// src/modules/conta/nucleo/MarcoNucleo.tsx
//
// K02 · El marco del núcleo (maqueta aprobada por Julio el 16/11; encargo K02,
// 17/11). Detrás del interruptor `conta_nucleo` (MarcoSegun.tsx). De arriba
// abajo:
//   1. la barra de arriba (Arriba): la marca, la empresa y su ejercicio, la
//      caja del buscador y la persona;
//   2. la cinta (Cinta): las pestañas del módulo y, debajo, sus botones en
//      grupos, con sus contadores; se pliegan, y se recuerda;
//   3. a la izquierda, los módulos (Modulos), plegables;
//   4. las pestañas de trabajo (PestanasTrabajo): Inicio, fija, y la de la
//      dirección (las vivas, el K03);
//   5. abajo, la línea de estado, con lo que hoy ya se cuenta.
//
// LA PÁGINA NO SE MUEVE (Julio, 16/11): el marco ocupa el alto de la ventana y
// no rueda; cada pantalla de hoy rueda dentro de su panel. Ninguna pantalla se
// rehace aquí: dentro va con su aspecto de hoy, con lo que el marco de hoy le
// da (MarcoContexto: los huecos del periodo y de las acciones, la densidad…),
// para que nada se pierda.
//
// Lo que hace el marco de hoy y aquí sigue igual: Ctrl K abre el buscador;
// soltar un fichero en cualquier pantalla abre la puerta; el aviso de lo que
// ha pasado se va solo a los 8 s.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { rutaConta, rutaPuerta } from '@/config/navegacion'
import { dejarFicheros, llevaFicheros } from '@/modules/conta/puerta/entregas'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { FranjaDemo } from '@/modules/conta/cuenta/FranjaDemo'
import { useProductoSolo } from '@/modules/conta/cuenta/useProductoSolo'
import { MARCA } from '@/modules/conta/cuenta/marca'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useCuentasMenu } from '@/modules/conta/marco/useCuentasMenu'
import { TeTocaHoy } from '@/modules/conta/ui/marco/TeTocaHoy'
import { chipsDelInicio } from '@/modules/conta/marco/nuevo/teTocaHoy'
import { MarcoContexto, type DatosCinta, type EntradasCinta, type Marco as ValorMarco, type Propias } from '@/modules/conta/marco/nuevo/contexto'
import { Buscador } from '@/modules/conta/marco/nuevo/Buscador'
import { useContadoresPestanas } from '@/modules/conta/marco/nuevo/useContadoresPestanas'
import { dondeEsta, relativa } from '@/modules/conta/esqueleto/productos'
import { cintaDe, conConsulta } from '@/modules/conta/esqueleto/ordenes'
import { usePreferenciasEsqueleto, useContextoEsqueleto } from '@/modules/conta/esqueleto/useEsqueleto'
import { leerEjercicios } from '@/modules/conta/services/esqueletoService'
import { AccionesDePagina } from '@/modules/conta/marco/AccionesDePagina'
import { resolverGrupos } from '@/modules/conta/marco/resolverGrupos'
import type { Ejercicio } from '@/modules/conta/marco/periodo'
import { BARRA_PREGUNTAR } from '@/modules/conta/marco/muyPronto'
import { hoyEnMadrid } from '@/modules/conta/lib/formato'
import { baseDeDatos } from '@/services/versionApp'
import { cintaVisible, modulosVisibles, MODULOS, nombreDePestana, sitioDe, type Boton, type IdModulo, type Modulo } from './mapa'
import { conEjercicio, ejercicioAEnsenar } from './ejercicio'
import { frasesDeEstado } from './estado'
import { Arriba } from './Arriba'
import { Cinta } from './Cinta'
import { Modulos } from './Modulos'
import { PestanasTrabajo } from './PestanasTrabajo'
import './nucleo.css'

/** Por debajo de este alto, los botones de la cinta nacen plegados (decisión 13 de Julio). */
export const ALTO_CINTA_PLEGADA = 800

/** El módulo y la pestaña de la cinta por los que se entra a cada módulo al pulsarlo. */
const ENTRADA: Partial<Record<IdModulo, string>> = { contabilidad: 'asientos' }

function useAltoVentana(): number {
  const [alto, setAlto] = useState(() => (typeof window === 'undefined' ? 1000 : window.innerHeight))
  useEffect(() => {
    const f = () => setAlto(window.innerHeight)
    window.addEventListener('resize', f)
    return () => window.removeEventListener('resize', f)
  }, [])
  return alto
}

export function MarcoNucleo({ children, sinPregunta = false }: { children: ReactNode; sinPregunta?: boolean }) {
  const solo = useProductoSolo()
  const { accountId, userId, userName } = useCuentaConta()
  const { activa } = useEmpresas()
  const { pathname, search } = useLocation()
  const navegar = useNavigate()
  const cuentas = useCuentasMenu()
  const { prefs, cambiar, aviso, quitarAviso } = usePreferenciasEsqueleto(accountId, userId)
  const { ctx: ctxBase, error: errorCtx, listo: ctxListo } = useContextoEsqueleto(accountId, activa?.id ?? null)
  const ctx = useMemo(() => ({ ...ctxBase, solo }), [ctxBase, solo])
  const produccion = baseDeDatos().tipo === 'produccion'

  const [buscando, setBuscando] = useState(false)
  const abrirBuscador = useCallback(() => setBuscando(true), [])
  const [huecoAcciones, setHuecoAcciones] = useState<HTMLDivElement | null>(null)
  const [huecoPeriodo, setHuecoPeriodo] = useState<HTMLDivElement | null>(null)
  const [datosCinta, setDatosCinta] = useState<DatosCinta | null>(null)
  const [entradasCinta, setEntradasCinta] = useState<EntradasCinta | null>(null)
  const [propias, setPropias] = useState<Propias | null>(null)
  const [ejercicios, setEjercicios] = useState<{ empresa: string; lista: Ejercicio[] } | null>(null)

  // ── Dónde está la dirección: en el mapa del núcleo y, para las acciones de la página, en el de hoy.
  const rel = relativa(pathname)
  const [modulo, setModulo] = useState<IdModulo>(() => {
    const s = sitioDe(rel, search)
    return s?.tipo === 'cinta' ? s.modulo.id : 'contabilidad'
  })
  const sitio = sitioDe(rel, search, modulo)
  const [pestana, setPestana] = useState<string>(() => (sitio?.tipo === 'cinta' ? sitio.pestana.id : 'asientos'))
  // Al cambiar de dirección, la cinta enseña el módulo y la pestaña de la pantalla abierta.
  const [vista, setVista] = useState(`${pathname}${search}`)
  if (vista !== `${pathname}${search}`) {
    setVista(`${pathname}${search}`)
    if (sitio?.tipo === 'cinta') { setModulo(sitio.modulo.id); setPestana(sitio.pestana.id) }
  }

  const donde = dondeEsta(pathname, undefined, search)
  const catalogo = donde?.producto && donde.pestana ? cintaDe(donde.producto.id, donde.pestana.id, ctx) : []
  const grupos = resolverGrupos(catalogo, { datos: datosCinta, entradas: entradasCinta, pathname, search, abrirBuscador })

  // ── Los módulos y la cinta que salen. El elegido sale aunque la empresa no lo tenga (se llega por la dirección).
  const visibles = modulosVisibles(ctx)
  const modulos = visibles.some((m) => m.id === modulo) ? visibles : MODULOS.filter((m) => m.id === modulo || visibles.includes(m))
  const moduloActual = MODULOS.find((m) => m.id === modulo) ?? MODULOS[0]
  const cinta = cintaVisible(moduloActual, ctx, { produccion })
  const pestanaActual = cinta.some((p) => p.id === pestana) ? pestana : cinta[0]?.id ?? ''
  const conImpuestos = modulo === 'impuestos' || pestanaActual === 'impuestos'
  const contadores = useContadoresPestanas(conImpuestos ? 'impuestos' : null, activa?.id ?? null, cuentas)

  // ── El ejercicio, arriba (decisión 3): el marco lo enseña, lo cambia y lo escribe en la dirección.
  useEffect(() => {
    if (!accountId || !activa) return
    let vivo = true
    leerEjercicios(accountId, activa.id).then((lista) => { if (vivo) setEjercicios({ empresa: activa.id, lista }) })
    return () => { vivo = false }
  }, [accountId, activa])
  const listaEjercicios = useMemo(() => (ejercicios && ejercicios.empresa === activa?.id ? ejercicios.lista : []), [ejercicios, activa?.id])
  const [elegido, setElegido] = useState<{ empresa: string; codigo: string } | null>(null)
  const delMarco = elegido && elegido.empresa === activa?.id ? elegido.codigo : null
  const ejercicio = ejercicioAEnsenar(new URLSearchParams(search).get('ejercicio'), delMarco, listaEjercicios, hoyEnMadrid())
  const elegirEjercicio = (codigo: string) => {
    if (!activa) return
    setElegido({ empresa: activa.id, codigo })
    navegar(`${pathname}${conEjercicio(search, codigo)}`, { replace: true })
  }
  /** Lo que viaja de una pantalla a otra: lo de hoy (el ejercicio, el mes, el banco) y el ejercicio elegido arriba. */
  const consulta = delMarco && !new URLSearchParams(search).has('ejercicio') ? conEjercicio(search, delMarco) : search

  const pulsar = (x: Boton) => {
    if (x.accion === 'buscar') { setBuscando(true); return }
    if (x.ruta) navegar(conConsulta(rutaConta(x.ruta), consulta))
  }
  const elegirModulo = (m: Modulo) => {
    setModulo(m.id)
    const suya = cintaVisible(m, ctx, { produccion })
    const p = suya.find((x) => x.id === ENTRADA[m.id]) ?? suya[0]
    if (!p) return
    setPestana(p.id)
    const primero = p.grupos.flatMap((g) => g.botones).find((x) => x.ruta)
    if (primero) pulsar(primero)
  }

  // ── Plegar los botones (se recuerda: conta_user_pref.cintaOculta). Por debajo de 800 de alto nacen plegados.
  const alto = useAltoVentana()
  const bajo = alto < ALTO_CINTA_PLEGADA
  const [cintaAMano, setCintaAMano] = useState<boolean | null>(null)
  const plegada = cintaAMano ?? (bajo || prefs.cintaOculta)
  const alternarCinta = () => {
    if (bajo) { setCintaAMano(!plegada); return }
    setCintaAMano(null)
    cambiar({ cintaOculta: !prefs.cintaOculta })
  }
  const plegados = !prefs.barraDesplegada
  const alternarModulos = () => cambiar({ barraDesplegada: !prefs.barraDesplegada })

  // ── El alto: el de la ventana menos lo que haya encima (la franja del entorno de pruebas, la de la plataforma).
  const raiz = useRef<HTMLDivElement | null>(null)
  const [encima, setEncima] = useState(0)
  useLayoutEffect(() => {
    const medir = () => { if (raiz.current) setEncima(Math.max(0, Math.round(raiz.current.getBoundingClientRect().top + window.scrollY))) }
    medir()
    window.addEventListener('resize', medir)
    return () => window.removeEventListener('resize', medir)
  }, [])
  // La página no rueda: mientras el núcleo está a la vista, el documento no tiene rueda.
  useEffect(() => {
    document.documentElement.classList.add('k-sin-rueda')
    window.scrollTo(0, 0)
    return () => document.documentElement.classList.remove('k-sin-rueda')
  }, [])
  // Cada pantalla nueva empieza arriba de su panel.
  const zona = useRef<HTMLElement | null>(null)
  useEffect(() => { zona.current?.scrollTo?.(0, 0) }, [pathname])

  // ── Lo del marco de hoy que sigue igual.
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        e.stopImmediatePropagation()
        setBuscando(true)
      }
    }
    window.addEventListener('keydown', tecla, true)
    return () => window.removeEventListener('keydown', tecla, true)
  }, [])
  useEffect(() => {
    const sobre = (e: DragEvent) => { if (llevaFicheros(e.dataTransfer?.types)) e.preventDefault() }
    const soltar = (e: DragEvent) => {
      if (e.defaultPrevented || !llevaFicheros(e.dataTransfer?.types)) return
      const fs = Array.from(e.dataTransfer?.files ?? [])
      if (!fs.length) return
      e.preventDefault()
      dejarFicheros('puerta', fs)
      navegar(rutaPuerta())
    }
    window.addEventListener('dragover', sobre)
    window.addEventListener('drop', soltar)
    return () => { window.removeEventListener('dragover', sobre); window.removeEventListener('drop', soltar) }
  }, [navegar])
  useEffect(() => {
    if (!aviso || aviso.tono === 'falta') return
    const t = window.setTimeout(quitarAviso, 8000)
    return () => window.clearTimeout(t)
  }, [aviso, quitarAviso])

  const clave = JSON.stringify(grupos.map((g) => [g.titulo, g.acciones.map((a) => [a.id, a.numero, a.aviso, a.actual])]))
  const marco: ValorMarco = useMemo(() => ({
    densidad: prefs.densidad,
    documentoOculto: prefs.documentoOculto,
    ocultarDocumento: (documentoOculto: boolean) => cambiar({ documentoOculto }),
    huecoAcciones,
    huecoPeriodo,
    ponerDatosCinta: setDatosCinta,
    ponerEntradasCinta: setEntradasCinta,
    hosteleria: ctxListo ? ctx.hosteleria : null,
    gestoria: ctxListo ? ctx.gestoria === true : null,
    analitica: ctxListo ? ctx.analitica ?? null : null,
    nivel: prefs.nivel,
    ponerConPropias: setPropias,
    accionesDelCatalogo: grupos,
    ejercicios: listaEjercicios,
    diez: ctxListo ? ctx.diez : null,
    abrirBuscador,
    colorEmpresa: ctx.colorEmpresa ?? null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [prefs.nivel, prefs.densidad, prefs.documentoOculto, cambiar, huecoAcciones, huecoPeriodo, ctxListo, ctx.hosteleria, ctx.gestoria, ctx.analitica, ctx.diez, ctx.colorEmpresa, clave, listaEjercicios, abrirBuscador])

  const enInicio = sitio?.tipo === 'inicio'
  const avisoVisible = aviso ?? (errorCtx ? { texto: `${errorCtx}. Mientras, no sale lo que depende de la empresa (hostelería, Diez).`, tono: 'falta' as const } : null)
  const estado = frasesDeEstado(cuentas, { recibidas: rutaConta('documentos'), bancos: rutaConta('bancos'), asientos: rutaConta('libros/diario') })
  const actual = sitio?.tipo === 'cinta' ? sitio.boton.id : null
  return (
    <MarcoContexto.Provider value={marco}>
      <div ref={raiz} className="cx cxm s-esqueleto s-marco k-nucleo" data-densidad={prefs.densidad} style={{ height: `calc(100dvh - ${encima}px)` }}>
        <Arriba marca={MARCA.nombre} ejercicios={listaEjercicios} ejercicio={ejercicio} elegirEjercicio={elegirEjercicio} abrirBuscador={abrirBuscador}
          nombre={userName ?? 'Tú'} prefs={prefs} cambiar={cambiar} solo={solo} ctx={ctx} />
        <Cinta pestanas={cinta} elegida={pestanaActual} elegir={setPestana} plegada={plegada} alternarPlegada={alternarCinta}
          actual={actual} contadores={contadores} pulsar={pulsar} />
        <div className="k-cuerpo">
          <Modulos modulos={modulos} elegido={modulo} elegir={elegirModulo} plegados={plegados} alternar={alternarModulos} />
          <div className="k-trabajo">
            <PestanasTrabajo enInicio={enInicio} nombre={nombreDePestana(sitio)} irAInicio={() => navegar(rutaConta('inicio'))}
              cerrar={() => navegar(rutaConta('inicio'))} abrirOtra={abrirBuscador} />
            <div className="k-panel">
              <p className="s-esq-aviso" role="status" aria-live="polite" data-tono={avisoVisible?.tono}>{avisoVisible?.texto ?? ''}</p>
              <main ref={zona} className="cx-principal cxm-principal s-principal k-zona">
                <FranjaDemo />
                <div className="k-periodo" ref={setHuecoPeriodo} />
                {propias !== 'encabezado' && (
                  <AccionesDePagina grupos={grupos} conBarra={propias === 'barra'} hueco={setHuecoAcciones}
                    etiqueta={`Acciones de ${nombreDePestana(sitio)}`} />
                )}
                {enInicio && <TeTocaHoy chips={chipsDelInicio(cuentas)} />}
                {children}
              </main>
            </div>
          </div>
        </div>
        <footer className="k-estado" aria-label="Cómo va la empresa">
          {estado.map((f) => (
            <button key={f.id} type="button" className="k-estado-frase" data-tono={f.tono} onClick={() => navegar(f.ruta)}>
              <span className="k-estado-punto" aria-hidden="true" /><strong>{f.fuerte}</strong> {f.resto}
            </button>
          ))}
        </footer>
        {buscando && <Buscador cerrar={() => setBuscando(false)} solo={solo} conPregunta={BARRA_PREGUNTAR && !solo && !sinPregunta} ctx={ctxListo ? ctx : undefined} />}
      </div>
    </MarcoContexto.Provider>
  )
}
