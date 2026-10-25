// src/modules/conta/marco/Marco.tsx
//
// S02 · El marco de Sumied: UNA sola forma de estar (encargo S02, «Marco
// común», tableros 1 a 9). Sustituye a los cuatro de antes (C00, F01/M01, S01
// y su auditoría S01b), que se habían apilado sin retirar ninguno:
//   · a la izquierda, la barra (Barra): los apartados del mapa, el activo
//     abierto con sus páginas, y abajo Favoritos y Ajustes;
//   · arriba, la cabecera (Cabecera): la franja del color de la empresa, la
//     empresa, el periodo SOLO donde la pantalla lo lee, «Buscar o hacer
//     algo», la Ayuda y el usuario;
//   · debajo, la página. Una página nueva pinta su encabezado
//     (EncabezadoPagina); una de antes, mientras se muda, lleva la fila de
//     acciones de serie (AccionesDePagina) con lo que antes iba en la cinta.
// Se acabaron las pestañas de área de la cabecera, la cinta de acciones con
// grupos y las etiquetas sueltas debajo de los botones.
//
// En el móvil (tablero 4): la barra en un cajón, la empresa y el periodo en
// una fila bajo la cabecera, y el botón principal de la página abajo.
//
// Ctrl K es del marco: se escucha ANTES que las pantallas (en la captura) y no
// les llega.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { rutaPuerta } from '@/config/navegacion'
import { dejarFicheros, llevaFicheros } from '@/modules/conta/puerta/entregas'
import { useIsMobile } from '@/shell/useIsMobile'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useProductoSolo } from '@/modules/conta/cuenta/useProductoSolo'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useCuentasMenu } from '@/modules/conta/marco/useCuentasMenu'
import { TeTocaHoy } from '@/modules/conta/ui/marco/TeTocaHoy'
import { chipsDelInicio } from '@/modules/conta/marco/nuevo/teTocaHoy'
import { MarcoContexto, type DatosCinta, type EntradasCinta, type Marco as ValorMarco, type Propias } from '@/modules/conta/marco/nuevo/contexto'
import { Buscador } from '@/modules/conta/marco/nuevo/Buscador'
import { useContadoresPestanas } from '@/modules/conta/marco/nuevo/useContadoresPestanas'
import { PRODUCTOS, dondeEsta, productosVisibles, type Producto } from '@/modules/conta/esqueleto/productos'
import { alternarFavorito, cintaDe, favoritosDe, ordenPorId, type Orden } from '@/modules/conta/esqueleto/ordenes'
import { usePreferenciasEsqueleto, useContextoEsqueleto } from '@/modules/conta/esqueleto/useEsqueleto'
import { cuentasDeLaBarra, frasesDeLaBarra } from '@/modules/conta/esqueleto/cuentasBarra'
import { Favoritos } from '@/modules/conta/esqueleto/Favoritos'
import { MenuUsuario } from '@/modules/conta/esqueleto/MenuUsuario'
import { leerEjercicios } from '@/modules/conta/services/esqueletoService'
import { Barra, type DatosBarra } from './Barra'
import { Cajon } from './Cajon'
import { Cabecera } from './Cabecera'
import { AccionesDePagina } from './AccionesDePagina'
import { resolverGrupos } from './resolverGrupos'
import type { Ejercicio } from './periodo'
import { barraAbierta } from '@/modules/conta/diseno/plantillas/anchos'
import { useTramoAncho } from '@/modules/conta/diseno/plantillas/useAncho'

/** Los apartados de la barra, con el activo dentro aunque no esté contratado, en el orden del mapa. */
function conElActivo(visibles: Producto[], activo: Producto | null): Producto[] {
  if (!activo || visibles.some((p) => p.id === activo.id)) return visibles
  return PRODUCTOS.filter((p) => p.id === activo.id || visibles.some((v) => v.id === p.id))
}

export function Marco({ children, sinPregunta = false }: { children: ReactNode; sinPregunta?: boolean }) {
  const movil = useIsMobile()
  const solo = useProductoSolo()
  const { accountId, userId, userName, logoCuenta } = useCuentaConta()
  const { activa } = useEmpresas()
  const { pathname, search } = useLocation()
  const cuentas = useCuentasMenu()
  const { prefs, cargadas, cambiar, aviso, quitarAviso } = usePreferenciasEsqueleto(accountId, userId)
  const { ctx: ctxBase, error: errorCtx, listo: ctxListo } = useContextoEsqueleto(accountId, activa?.id ?? null)
  const ctx = useMemo(() => ({ ...ctxBase, solo }), [ctxBase, solo])
  const [buscando, setBuscando] = useState(false)
  const abrirBuscador = useCallback(() => setBuscando(true), [])
  const [cajon, setCajon] = useState(false)
  const cerrarCajon = useCallback(() => setCajon(false), [])
  const [huecoAcciones, setHuecoAcciones] = useState<HTMLDivElement | null>(null)
  const [huecoPeriodo, setHuecoPeriodo] = useState<HTMLDivElement | null>(null)
  const [datosCinta, setDatosCinta] = useState<DatosCinta | null>(null)
  const [entradasCinta, setEntradasCinta] = useState<EntradasCinta | null>(null)
  const [propias, setPropias] = useState<Propias | null>(null)
  const [ejercicios, setEjercicios] = useState<{ empresa: string; lista: Ejercicio[] } | null>(null)

  const donde = dondeEsta(pathname, undefined, search)
  const producto = donde?.producto ?? null
  const pestana = donde?.pestana ?? null
  // El apartado en el que estás sale siempre, aunque la empresa no lo tenga
  // contratado (se llega por la dirección): si no, sus páginas no estarían en
  // ninguna parte (antes iban en las pestañas de la cabecera).
  const productos = conElActivo(productosVisibles(ctx), producto)
  const pendientes = cuentasDeLaBarra(cuentas)
  const frases = frasesDeLaBarra(cuentas)
  const contadores = useContadoresPestanas(producto?.id ?? null, activa?.id ?? null, cuentas)
  const catalogo = producto && pestana ? cintaDe(producto.id, pestana.id, ctx) : []
  const grupos = resolverGrupos(catalogo, { datos: datosCinta, entradas: entradasCinta, pathname, search, abrirBuscador })

  // Los ejercicios de la empresa, para el botón del periodo.
  useEffect(() => {
    if (!accountId || !activa) return
    let vivo = true
    leerEjercicios(accountId, activa.id).then((lista) => { if (vivo) setEjercicios({ empresa: activa.id, lista }) })
    return () => { vivo = false }
  }, [accountId, activa])

  // Ctrl K (⌘K): del marco. En la captura, para que no llegue a las pantallas.
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

  // V02 · Soltar un fichero en CUALQUIER pantalla abre la puerta con él. Las
  // pantallas que ya saben qué hacer con un fichero (Bancos, la quincena de
  // Catcher, la puerta misma) lo cogen antes y lo marcan (preventDefault): esas
  // no se tocan. El resto, en vez de abrirlo el navegador, va a la puerta.
  const navegarA = useNavigate()
  useEffect(() => {
    const encima = (e: DragEvent) => { if (llevaFicheros(e.dataTransfer?.types)) e.preventDefault() }
    const soltar = (e: DragEvent) => {
      if (e.defaultPrevented || !llevaFicheros(e.dataTransfer?.types)) return
      const fs = Array.from(e.dataTransfer?.files ?? [])
      if (!fs.length) return
      e.preventDefault()
      dejarFicheros('puerta', fs)
      navegarA(rutaPuerta())
    }
    window.addEventListener('dragover', encima)
    window.addEventListener('drop', soltar)
    return () => { window.removeEventListener('dragover', encima); window.removeEventListener('drop', soltar) }
  }, [navegarA])

  // El aviso de lo que ha pasado se va solo a los 8 s (el siguiente lo pisa antes).
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
    analitica: ctxListo ? ctx.analitica ?? null : null,
    nivel: prefs.nivel,
    ponerConPropias: setPropias,
    accionesDelCatalogo: grupos,
    ejercicios: ejercicios && ejercicios.empresa === activa?.id ? ejercicios.lista : [],
    diez: ctxListo ? ctx.diez : null,
    abrirBuscador,
    colorEmpresa: ctx.colorEmpresa ?? null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [prefs.nivel, prefs.densidad, prefs.documentoOculto, cambiar, huecoAcciones, huecoPeriodo, ctxListo, ctx.hosteleria, ctx.analitica, ctx.diez, ctx.colorEmpresa, clave, ejercicios, activa?.id, abrirBuscador])

  // Lo que se puede fijar desde aquí: esta página y sus acciones.
  const fijables: Orden[] = [
    ordenPorId(producto ? (pestana && producto.pestanas.length > 0 ? `ir.${producto.id}.${pestana.id}` : `ir.${producto.id}`) : ''),
    ...catalogo.flatMap((g) => g.ordenes),
  ].filter((o): o is Orden => !!o)
  const fijar = ({ id, etiqueta }: { id: string; etiqueta: string }) => {
    const ya = prefs.favoritos.includes(id)
    cambiar({ favoritos: alternarFavorito(prefs.favoritos, id) }, ya ? `Quitado de Favoritos: «${etiqueta}».` : `Fijado en Favoritos: «${etiqueta}». Lo tienes abajo, en Favoritos.`)
  }

  // N5 · La regla de anchos (Julio, 23/10), por ahora en Compras y gastos: con 1600 px o más, la barra
  // como la deje cada persona; por debajo, plegada sola (abrirla a mano vale mientras no cambie de tramo).
  const tramo = useTramoAncho()
  const [barraAMano, setBarraAMano] = useState<boolean | null>(null)
  // Al cambiar de tramo se olvida lo de a mano: volver a 1366 desde 1920 la pliega otra vez.
  const [tramoVisto, setTramoVisto] = useState(tramo)
  if (tramoVisto !== tramo) { setTramoVisto(tramo); setBarraAMano(null) }
  // N5 · La regla de anchos: Compras y, desde el V01, Ventas (nacen con ella).
  const conRegla = producto?.id === 'compras' || producto?.id === 'facturacion'
  const desplegada = conRegla ? barraAbierta(tramo, prefs.barraDesplegada, barraAMano) : prefs.barraDesplegada
  const alternarBarra = () => (conRegla && tramo !== 'ancho'
    ? setBarraAMano(!desplegada)
    : cambiar({ barraDesplegada: !prefs.barraDesplegada }))
  const favoritos = (enCajon: boolean) => (
    <Favoritos favoritos={favoritosDe(prefs.favoritos, ctx)} cargando={!cargadas} fijables={fijables} alternar={fijar}
      alAbrirBuscador={() => { setCajon(false); setBuscando(true) }} enCajon={enCajon} plegada={!enCajon && !desplegada} />
  )
  const usuario = (enCajon: boolean) => <MenuUsuario nombre={userName ?? 'Tú'} prefs={prefs} solo={solo} movil={movil} cambiar={cambiar} enCajon={enCajon} />

  const datosBarra: DatosBarra = { productos, activo: producto?.id ?? null, pagina: pestana?.id ?? null, ctx, pendientes, frases, contadores, search }
  const clases = ['cx', 'cxm', 's-esqueleto', 's-marco', solo ? 'cx-solo' : null, movil ? 'cxm-es-movil' : null].filter(Boolean).join(' ')
  const avisoVisible = aviso ?? (errorCtx ? { texto: `${errorCtx}. Mientras, no sale lo que depende de la empresa (hostelería, Diez).`, tono: 'falta' as const } : null)
  const nombrePagina = pestana?.etiqueta ?? producto?.etiqueta ?? 'la página'
  return (
    <MarcoContexto.Provider value={marco}>
      <div className={clases} data-densidad={prefs.densidad}>
        {!movil && (
          <Barra d={datosBarra} desplegada={desplegada} alternar={alternarBarra}
            favoritos={favoritos(false)} />
        )}
        <div className="s-esq-cuerpo">
          <Cabecera movil={movil} logoEmpresa={ctx.logoEmpresa ?? logoCuenta} colorEmpresa={ctx.colorEmpresa ?? null}
            huecoPeriodo={setHuecoPeriodo} abrirBuscador={abrirBuscador} abrirMenu={() => setCajon(true)} menuAbierto={cajon}
            usuario={usuario(false)} />
          <p className="s-esq-aviso" role="status" aria-live="polite" data-tono={avisoVisible?.tono}>{avisoVisible?.texto ?? ''}</p>
          <main className="cx-principal cxm-principal s-principal">
            {propias !== 'encabezado' && (
              <AccionesDePagina grupos={grupos} conBarra={propias === 'barra'} hueco={setHuecoAcciones} etiqueta={`Acciones de ${nombrePagina}`} />
            )}
            {producto?.id === 'inicio' && <TeTocaHoy chips={chipsDelInicio(cuentas)} />}
            {children}
          </main>
        </div>
        {movil && cajon && <Cajon d={datosBarra} solo={solo} cerrar={cerrarCajon} tuyo={<>{favoritos(true)}{usuario(true)}</>} />}
        {buscando && <Buscador cerrar={() => setBuscando(false)} solo={solo} conPregunta={!solo && !sinPregunta} ctx={ctxListo ? ctx : undefined} />}
      </div>
    </MarcoContexto.Provider>
  )
}
