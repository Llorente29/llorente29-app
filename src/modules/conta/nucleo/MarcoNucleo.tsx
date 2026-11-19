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
//   4. las pestañas de trabajo (PestanasTrabajo, PestanaViva);
//   5. abajo, la línea de estado, con lo que hoy ya se cuenta.
//
// LA PÁGINA NO SE MUEVE (Julio, 16/11): el marco ocupa el alto de la ventana y
// no rueda; cada pantalla rueda dentro de su panel.
//
// K03 · LAS PESTAÑAS VIVAS (encargo K03, decisiones 10 a 12). Cada pantalla
// que se abre es una pestaña (pestanas.ts dice de cuál es cada dirección) y
// su pantalla SIGUE MONTADA mientras se mira otra: al volver, está lo escrito,
// el filtro, la fila elegida, la rueda y el foco donde se dejaron. La dirección
// del navegador es la de la pestaña que se ve: atrás, recargar y un enlace
// directo hacen lo que dijo el inventario, y recargar no pierde las abiertas
// (se guardan en la sesión del navegador; vuelven dormidas, y despiertan al
// mirarlas). El aspa pregunta si hay algo sin guardar. El teclado común
// (teclado.ts): F5 el mayor de la cuenta elegida, F4 buscar, F8 cambiar de
// clase de documento, Esc volver a la pantalla, Alt Av Pág / Re Pág moverse
// entre pestañas.
//
// K05 · 0b · LAS PESTAÑAS SON DE SU EMPRESA (Julio, 19/11). Cada pestaña es
// de la empresa con la que se abrió. Al cambiar de empresa arriba, solo se ven
// las de la nueva (o su Inicio); las de la otra se aparcan tal cual, montadas y
// con lo escrito, y vuelven al volver. Cada pestaña lleva SU empresa en el
// contexto (PestanaViva): lo que lee y guarda su pantalla (el plan, las
// sugerencias, el mayor, validar) es de su empresa, se vea la que se vea
// arriba. Abajo, «N pestañas abiertas en …», que lleva a esa empresa.
//
// Por eso aquí NO se pinta `children` (la pantalla de la ruta): la pintan las
// pestañas, cada una con su dirección (rutas.ts).
//
// Lo que hace el marco de hoy y aquí sigue igual: Ctrl K abre el buscador;
// soltar un fichero en cualquier pantalla abre la puerta; el aviso de lo que
// ha pasado se va solo a los 8 s.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate, type Location } from 'react-router-dom'
import { rutaConta, rutaPuerta } from '@/config/navegacion'
import { dejarFicheros, llevaFicheros } from '@/modules/conta/puerta/entregas'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useProductoSolo } from '@/modules/conta/cuenta/useProductoSolo'
import { MARCA } from '@/modules/conta/cuenta/marca'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useCuentasMenu } from '@/modules/conta/marco/useCuentasMenu'
import type { Marco as ValorMarco } from '@/modules/conta/marco/nuevo/contexto'
import { Buscador } from '@/modules/conta/marco/nuevo/Buscador'
import { useContadoresPestanas } from '@/modules/conta/marco/nuevo/useContadoresPestanas'
import { relativa } from '@/modules/conta/esqueleto/productos'
import { conConsulta } from '@/modules/conta/esqueleto/ordenes'
import { usePreferenciasEsqueleto, useContextoEsqueleto } from '@/modules/conta/esqueleto/useEsqueleto'
import { leerEjercicios } from '@/modules/conta/services/esqueletoService'
import type { Ejercicio } from '@/modules/conta/marco/periodo'
import { BARRA_PREGUNTAR } from '@/modules/conta/marco/muyPronto'
import { hoyEnMadrid } from '@/modules/conta/lib/formato'
import { baseDeDatos } from '@/services/versionApp'
import type { CambiosDePestana } from '@/modules/conta/diseno/plantillas/pestana'
import { cintaVisible, modulosVisibles, MODULOS, sitioDe, type Boton, type IdModulo, type Modulo } from './mapa'
import { conEjercicio, ejercicioAEnsenar } from './ejercicio'
import { frasesDeEstado } from './estado'
import { useLeer } from '@/modules/conta/libros/contexto'
import { bancosCuadrados } from './bancos/servicio'
import {
  abiertasEnOtras, aGuardarPorEmpresa, alNavegar, cambiarDeEmpresa, cerrar, claveDe, deAlLado, fraseAbiertasEn, INICIO, llaveDe, nombrePorDefecto, pestanasDeEmpresasGuardadas,
  type EstadoPestanas, type PestanasDeEmpresas,
} from './pestanas'
import { cuentaDe, teclaDelMarco } from './teclado'
import { Arriba } from './Arriba'
import { Cinta } from './Cinta'
import { Modulos } from './Modulos'
import { PestanasTrabajo } from './PestanasTrabajo'
import { PestanaViva } from './PestanaViva'
import { DialogoCerrar } from './DialogoCerrar'
import './nucleo.css'

/** Por debajo de este alto, los botones de la cinta nacen plegados (decisión 13 de Julio). */
export const ALTO_CINTA_PLEGADA = 800

/** Donde se guardan las pestañas abiertas para recargar (la sesión de esta pestaña del navegador). */
export const CLAVE_PESTANAS = 'folvy.conta.nucleo.pestanas'

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

function leerGuardadas(): unknown {
  try { const t = window.sessionStorage.getItem(CLAVE_PESTANAS); return t ? JSON.parse(t) : null } catch { return null }
}

/** La dirección de una pestaña que aún no se ha mirado en esta carga (vuelve de recargar). */
function ubicacionDe(url: string, id: string): Location {
  const [pathname, search = ''] = url.split('?')
  return { pathname, search: search ? `?${search}` : '', hash: '', state: null, key: `k03-${id}` }
}

export function MarcoNucleo({ sinPregunta = false }: { children?: ReactNode; sinPregunta?: boolean }) {
  const solo = useProductoSolo()
  const { accountId, userId, userName } = useCuentaConta()
  const { activa, empresas, elegir: elegirEmpresa } = useEmpresas()
  const ubicacion = useLocation()
  const { pathname, search } = ubicacion
  const navegar = useNavigate()
  const cuentas = useCuentasMenu()
  const { prefs, cambiar, aviso, quitarAviso } = usePreferenciasEsqueleto(accountId, userId)
  const { ctx: ctxBase, error: errorCtx, listo: ctxListo } = useContextoEsqueleto(accountId, activa?.id ?? null)
  const ctx = useMemo(() => ({ ...ctxBase, solo }), [ctxBase, solo])
  const produccion = baseDeDatos().tipo === 'produccion'

  const [buscando, setBuscando] = useState(false)
  const abrirBuscador = useCallback(() => setBuscando(true), [])
  const [ejercicios, setEjercicios] = useState<{ empresa: string; lista: Ejercicio[] } | null>(null)

  // ── K03 · Las pestañas de trabajo. La de la dirección es la que se ve.
  const url = `${pathname}${search}`
  // K05 · 0b · Las de la empresa de arriba se ven; las de las demás, aparcadas (pestanas.ts, cambiarDeEmpresa).
  const [todas, setTodas] = useState<PestanasDeEmpresas>(() => pestanasDeEmpresasGuardadas(leerGuardadas(), url, Date.now()))
  const estado = todas.estado
  const empresaVista = todas.empresa
  const setEstado = useCallback((f: (e: EstadoPestanas) => EstadoPestanas) => setTodas((x) => ({ ...x, estado: f(x.estado) })), [])
  const [ubicaciones, setUbicaciones] = useState<Record<string, Location>>(() => ({ [llaveDe(todas.empresa, claveDe(url))]: ubicacion }))
  if (activa && empresaVista !== activa.id) {
    const nueva = activa.id
    // La primera vez que se sabe la empresa, la dirección de lo que se ve pasa a ser suya.
    if (empresaVista === null) setUbicaciones((u) => Object.fromEntries(Object.entries(u).map(([k, v]) => [k.startsWith('|') ? `${nueva}${k}` : k, v])))
    setTodas((x) => cambiarDeEmpresa(x, nueva, Date.now()).t)
  }
  // Al cambiar de empresa, la dirección es la de la pestaña que queda activa (la suya de antes, o su Inicio).
  const empresaAntes = useRef(empresaVista)
  const activaAhora = estado.abiertas.find((p) => p.id === estado.activa)?.url ?? null
  useEffect(() => {
    const antes = empresaAntes.current
    empresaAntes.current = empresaVista
    if (antes === null || antes === empresaVista || !activaAhora) return
    if (activaAhora !== `${window.location.pathname}${window.location.search}`) navegar(activaAhora)
  }, [empresaVista, activaAhora, navegar])
  const [vistaUbicacion, setVistaUbicacion] = useState(ubicacion)
  if (vistaUbicacion !== ubicacion) {
    setVistaUbicacion(ubicacion)
    setTodas((x) => ({ ...x, estado: alNavegar(x.estado, url, Date.now()) }))
    setUbicaciones((u) => ({ ...u, [llaveDe(empresaVista, claveDe(url))]: ubicacion }))
  }
  useEffect(() => {
    try { window.sessionStorage.setItem(CLAVE_PESTANAS, JSON.stringify(aGuardarPorEmpresa(todas))) } catch { /* sin almacén: no se recuerdan al recargar */ }
  }, [todas])
  const [nombres, setNombres] = useState<Record<string, string>>({})
  const [cambios, setCambios] = useState<Record<string, CambiosDePestana>>({})
  const ponerNombre = useCallback((id: string, n: string | null) => setNombres((x) => {
    if ((x[id] ?? null) === n) return x
    const y = { ...x }
    if (n) y[id] = n; else delete y[id]
    return y
  }), [])
  const ponerCambios = useCallback((id: string, c: CambiosDePestana | null) => setCambios((x) => {
    if (!c && !(id in x)) return x
    const y = { ...x }
    if (c) y[id] = c; else delete y[id]
    return y
  }), [])
  /** El nombre de una pestaña de las que se ven, por su clave. */
  const nombreDe = useCallback((id: string) => {
    const p = estado.abiertas.find((x) => x.id === id)
    return nombres[llaveDe(empresaVista, id)] ?? (p ? nombrePorDefecto(p) : 'Sumied')
  }, [estado.abiertas, nombres, empresaVista])

  // El aspa: si hay algo sin guardar, pregunta antes (DialogoCerrar).
  const [preguntando, setPreguntando] = useState<string | null>(null)
  // K05 · 0b · Se cierra por su llave (empresa y clave), y solo una de las que se ven (las aparcadas no se cierran desde aquí).
  const empresaAhora = useRef(empresaVista)
  useEffect(() => { empresaAhora.current = empresaVista }, [empresaVista])
  const hacerCerrar = useCallback((llave: string) => {
    setPreguntando(null)
    const id = llave.slice(llave.indexOf('|') + 1)
    if (llaveDe(empresaAhora.current, id) !== llave) return
    setEstado((e) => {
      const { estado: n, ir } = cerrar(e, id)
      if (ir) queueMicrotask(() => navegar(ir))
      return n
    })
    setUbicaciones((u) => { const v = { ...u }; delete v[llave]; return v })
    setNombres((x) => { if (!(llave in x)) return x; const y = { ...x }; delete y[llave]; return y })
    setCambios((x) => { if (!(llave in x)) return x; const y = { ...x }; delete y[llave]; return y })
  }, [navegar, setEstado])
  // K04 · Estable (la pide también la pantalla, con Esc): lee los cambios de una referencia.
  const cambiosAhora = useRef(cambios)
  useEffect(() => { cambiosAhora.current = cambios }, [cambios])
  const pedirCerrar = useCallback((llave: string) => (cambiosAhora.current[llave] ? setPreguntando(llave) : hacerCerrar(llave)), [hacerCerrar])
  const pedirCerrarVista = useCallback((id: string) => pedirCerrar(llaveDe(empresaAhora.current, id)), [pedirCerrar])
  const irA = (id: string) => {
    const p = estado.abiertas.find((x) => x.id === id)
    if (p && p.url !== url) navegar(p.url)
  }

  // ── Dónde está la dirección en el mapa: el módulo y la pestaña de la cinta.
  const rel = relativa(pathname)
  const [modulo, setModulo] = useState<IdModulo>(() => {
    const s = sitioDe(rel, search)
    return s?.tipo === 'cinta' ? s.modulo.id : 'contabilidad'
  })
  const sitio = sitioDe(rel, search, modulo)
  const [pestanaCinta, setPestanaCinta] = useState<string>(() => (sitio?.tipo === 'cinta' ? sitio.pestana.id : 'asientos'))
  // Al cambiar de dirección, la cinta enseña el módulo y la pestaña de la pantalla abierta.
  const [vista, setVista] = useState(url)
  if (vista !== url) {
    setVista(url)
    if (sitio?.tipo === 'cinta') { setModulo(sitio.modulo.id); setPestanaCinta(sitio.pestana.id) }
  }

  // ── Los módulos y la cinta que salen. El elegido sale aunque la empresa no lo tenga (se llega por la dirección).
  const visibles = modulosVisibles(ctx)
  const modulos = visibles.some((m) => m.id === modulo) ? visibles : MODULOS.filter((m) => m.id === modulo || visibles.includes(m))
  const moduloActual = MODULOS.find((m) => m.id === modulo) ?? MODULOS[0]
  const cinta = cintaVisible(moduloActual, ctx, { produccion })
  const pestanaActual = cinta.some((p) => p.id === pestanaCinta) ? pestanaCinta : cinta[0]?.id ?? ''
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
    setPestanaCinta(p.id)
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

  // ── K03 · La cuenta elegida en cada pestaña (F5 y «El mayor»): la de lo último que se pulsó o enfocó en ella.
  const [cuentaPorPestana, setCuentaPorPestana] = useState<Record<string, string | null>>({})
  useEffect(() => {
    const alTocar = (e: Event) => {
      const t = e.target as Element | null
      const zona = t?.closest?.('.k-zona[data-activa="si"]')
      if (!zona) return
      const id = zona.getAttribute('data-llave') ?? ''
      const c = cuentaDe(t)
      setCuentaPorPestana((x) => ((x[id] ?? null) === c ? x : { ...x, [id]: c }))
    }
    document.addEventListener('focusin', alTocar)
    document.addEventListener('pointerdown', alTocar)
    return () => { document.removeEventListener('focusin', alTocar); document.removeEventListener('pointerdown', alTocar) }
  }, [])
  const cuenta = cuentaPorPestana[llaveDe(empresaVista, estado.activa)] ?? null
  const abrirMayor = useCallback((c: string | null) => {
    if (!c) return
    navegar(conConsulta(rutaConta(`plan/${encodeURIComponent(c)}`), consulta))
  }, [navegar, consulta])

  // ── K03 · El teclado común (teclado.ts). Después de las pantallas: lo que una pantalla coge, lo marca y aquí no se toca.
  const ultimo = useRef({ estado, cuenta, pathname, abrirMayor, navegar })
  useEffect(() => { ultimo.current = { estado, cuenta, pathname, abrirMayor, navegar } })
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      const u = ultimo.current
      const foco = document.activeElement
      const zona = document.querySelector<HTMLElement>('.k-zona[data-activa="si"]')
      const enLaZona = !!(foco && zona?.contains(foco))
      const enElMarco = !!(foco && foco.closest('.k-nucleo') && !enLaZona)
      const a = teclaDelMarco(e, { cuenta: (enLaZona ? cuentaDe(foco) : null) ?? u.cuenta, pathname: u.pathname, enElMarco })
      if (!a) return
      e.preventDefault()
      if (a.que === 'mayor') u.abrirMayor(a.cuenta)
      else if (a.que === 'buscar') setBuscando(true)
      else if (a.que === 'clase') u.navegar(rutaConta(a.a))
      else if (a.que === 'pestana') u.navegar(deAlLado(u.estado, a.paso).url)
      else if (a.que === 'volver') zona?.focus({ preventScroll: true })
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [])

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

  // Lo del marco que se comparte con todas las pestañas (lo de cada pestaña lo pone PestanaViva).
  const base = useMemo(() => ({
    densidad: prefs.densidad,
    documentoOculto: prefs.documentoOculto,
    ocultarDocumento: (documentoOculto: boolean) => cambiar({ documentoOculto }),
    hosteleria: ctxListo ? ctx.hosteleria : null,
    ventasPorDia: ctxListo ? ctx.ventasPorDia === true : null,
    gestoria: ctxListo ? ctx.gestoria === true : null,
    analitica: ctxListo ? ctx.analitica ?? null : null,
    nivel: prefs.nivel,
    ejercicios: listaEjercicios,
    diez: ctxListo ? ctx.diez : null,
    abrirBuscador,
    colorEmpresa: ctx.colorEmpresa ?? null,
  } satisfies Partial<ValorMarco>), [prefs.nivel, prefs.densidad, prefs.documentoOculto, cambiar, ctxListo, ctx.hosteleria, ctx.ventasPorDia, ctx.gestoria, ctx.analitica, ctx.diez, ctx.colorEmpresa, listaEjercicios, abrirBuscador])

  // K05 · 0b · Una pestaña aparcada sigue con lo del marco de SU empresa (los ejercicios, la analítica…), no con lo de la de arriba.
  const [bases, setBases] = useState<Record<string, typeof base>>({})
  if (empresaVista && activa?.id === empresaVista && bases[empresaVista] !== base) setBases((b) => ({ ...b, [empresaVista]: base }))
  const resumenDe = (id: string | null) => empresas.find((e) => e.id === id) ?? null
  const vivas = [
    ...estado.abiertas.filter((p) => p.montada).map((p) => ({ p, empresa: empresaVista, activa: p.id === estado.activa })),
    ...Object.entries(todas.aparcadas).flatMap(([empresa, e]) => e.abiertas.filter((p) => p.montada).map((p) => ({ p, empresa, activa: false }))),
  ]
  const otras = abiertasEnOtras(todas)

  const avisoVisible = aviso ?? (errorCtx ? { texto: `${errorCtx}. Mientras, no sale lo que depende de la empresa (hostelería, Diez).`, tono: 'falta' as const } : null)
  // E05 · «Bancos cuadrados», con la misma regla que la cabecera de Bancos; se vuelve a contar cuando cambia lo que hay por revisar.
  const cuadrados = useLeer(accountId && activa ? () => bancosCuadrados(accountId, activa.id, hoyEnMadrid()) : null, `${accountId}:${activa?.id}:${String(cuentas.bancos ?? '')}:cuadrados`).datos
  const estadoFrases = frasesDeEstado(cuentas, { recibidas: rutaConta('documentos'), bancos: rutaConta('bancos'), asientos: rutaConta('libros/diario') }, cuadrados)
  const actual = sitio?.tipo === 'cinta' ? sitio.boton.id : null
  const enFila = estado.abiertas.map((p) => ({ id: p.id, nombre: nombreDe(p.id), conCambios: !!cambios[llaveDe(empresaVista, p.id)], cerrable: p.id !== INICIO }))
  return (
    <div ref={raiz} className="cx cxm s-esqueleto s-marco k-nucleo" data-densidad={prefs.densidad} style={{ height: `calc(100dvh - ${encima}px)` }}>
      <Arriba marca={MARCA.nombre} ejercicios={listaEjercicios} ejercicio={ejercicio} elegirEjercicio={elegirEjercicio} abrirBuscador={abrirBuscador}
        nombre={userName ?? 'Tú'} prefs={prefs} cambiar={cambiar} solo={solo} ctx={ctx} />
      <Cinta pestanas={cinta} elegida={pestanaActual} elegir={setPestanaCinta} plegada={plegada} alternarPlegada={alternarCinta}
        actual={actual} contadores={contadores} pulsar={pulsar} />
      <div className="k-cuerpo">
        <Modulos modulos={modulos} elegido={modulo} elegir={elegirModulo} plegados={plegados} alternar={alternarModulos} />
        <div className="k-trabajo">
          <PestanasTrabajo pestanas={enFila} activa={estado.activa} ir={irA} cerrar={pedirCerrarVista} abrirOtra={abrirBuscador}
            cuenta={cuenta} abrirMayor={() => abrirMayor(cuenta)} />
          <div className="k-panel">
            <p className="s-esq-aviso" role="status" aria-live="polite" data-tono={avisoVisible?.tono}>{avisoVisible?.texto ?? ''}</p>
            {vivas.map(({ p, empresa, activa: vista }) => {
              const llave = llaveDe(empresa, p.id)
              return (
                <PestanaViva key={llave} id={p.id} llave={llave} empresa={resumenDe(empresa)} ubicacion={ubicaciones[llave] ?? ubicacionDe(p.url, p.id)} activa={vista}
                  base={(empresa && bases[empresa]) || base} ctx={ctx} cuentas={cuentas} abrirBuscador={abrirBuscador} ponerNombre={ponerNombre} ponerCambios={ponerCambios} cerrar={pedirCerrar}
                  nombre={nombres[llave] ?? nombrePorDefecto(p)} />
              )
            })}
          </div>
        </div>
      </div>
      <footer className="k-estado" aria-label="Cómo va la empresa">
        {estadoFrases.map((f) => (
          <button key={f.id} type="button" className="k-estado-frase" data-tono={f.tono} onClick={() => navegar(f.ruta)}>
            <span className="k-estado-punto" aria-hidden="true" /><strong>{f.fuerte}</strong> {f.resto}
          </button>
        ))}
        {otras.map((o) => (
          <button key={o.empresa} type="button" className="k-estado-frase" data-prueba="abiertas-en-otra" onClick={() => elegirEmpresa(o.empresa)}>
            {fraseAbiertasEn(o.n, resumenDe(o.empresa)?.nombre ?? 'otra empresa')}
          </button>
        ))}
      </footer>
      {preguntando && cambios[preguntando] && (
        <DialogoCerrar nombre={nombres[preguntando] ?? nombreDe(preguntando.slice(preguntando.indexOf('|') + 1))} c={cambios[preguntando]} alCerrar={() => hacerCerrar(preguntando)} alSeguir={() => setPreguntando(null)} />
      )}
      {buscando && <Buscador cerrar={() => setBuscando(false)} solo={solo} conPregunta={BARRA_PREGUNTAR && !solo && !sinPregunta} ctx={ctxListo ? ctx : undefined} />}
    </div>
  )
}
