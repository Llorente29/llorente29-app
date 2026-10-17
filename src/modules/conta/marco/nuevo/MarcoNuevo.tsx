// src/modules/conta/marco/nuevo/MarcoNuevo.tsx
//
// El marco de contabilidad. Desde el S01 es el ESQUELETO (encargo S01 y
// respuestas de Julio del 17/10): la barra de productos a la izquierda, la
// cabecera de una fila de 48 px, la cinta de la pestaña debajo y la pantalla.
// En el móvil, los productos van abajo y las pestañas en una fila que se
// desliza. Las piezas están en src/modules/conta/esqueleto; aquí se juntan.
//
// Envuelve las pantallas que ya existen SIN tocarlas: se ven dentro con su
// estilo de hoy hasta que el paso 3 las mude. Lo que ya les daba el M01 se
// queda igual (contexto.ts): la densidad, el documento oculto y los huecos del
// periodo, de la segunda fila (Libros) y de las acciones de la pantalla.
//
// Ctrl K es del marco: se escucha ANTES que las pantallas (en la captura) y
// no les llega. Sus botones de buscar siguen funcionando con el ratón.

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { useIsMobile } from '@/shell/useIsMobile'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useProductoSolo } from '@/modules/conta/cuenta/useProductoSolo'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useCuentasMenu } from '@/modules/conta/marco/useCuentasMenu'
import { TeTocaHoy } from '@/modules/conta/ui/marco/TeTocaHoy'
import { chipsDelInicio } from '@/modules/conta/marco/nuevo/teTocaHoy'
import { MarcoContexto, type Marco } from '@/modules/conta/marco/nuevo/contexto'
import { Buscador } from '@/modules/conta/marco/nuevo/Buscador'
import { dondeEsta, pestanasVisibles, productosVisibles } from '@/modules/conta/esqueleto/productos'
import { alternarFavorito, cintaDe, favoritosDe, ordenPorId, type Orden } from '@/modules/conta/esqueleto/ordenes'
import { usePreferenciasEsqueleto, useContextoEsqueleto } from '@/modules/conta/esqueleto/useEsqueleto'
import { BarraProductos } from '@/modules/conta/esqueleto/BarraProductos'
import { BarraInferior } from '@/modules/conta/esqueleto/BarraInferior'
import { Cabecera } from '@/modules/conta/esqueleto/Cabecera'
import { CintaDePestana } from '@/modules/conta/esqueleto/CintaDePestana'
import { Favoritos } from '@/modules/conta/esqueleto/Favoritos'
import { MenuUsuario } from '@/modules/conta/esqueleto/MenuUsuario'

/** Lo que hay por revisar de todos los productos; null si no se ha podido contar nada. */
function pendientesDe(cuentas: Record<string, number | null | undefined>): number | null {
  const ns = Object.values(cuentas).filter((n): n is number => typeof n === 'number')
  return ns.length === 0 ? null : ns.reduce((s, n) => s + n, 0)
}

export function MarcoNuevo({ children, sinPregunta = false }: { children: ReactNode; sinPregunta?: boolean }) {
  const movil = useIsMobile()
  const solo = useProductoSolo()
  const { accountId, userId, userName, logoCuenta } = useCuentaConta()
  const { activa } = useEmpresas()
  const { pathname } = useLocation()
  const cuentas = useCuentasMenu()
  const { prefs, cambiar, aviso, quitarAviso } = usePreferenciasEsqueleto(accountId, userId)
  const { ctx, error: errorCtx } = useContextoEsqueleto(accountId, activa?.id ?? null)
  const [buscando, setBuscando] = useState(false)
  const [huecoAcciones, setHuecoAcciones] = useState<HTMLDivElement | null>(null)
  const [huecoPeriodo, setHuecoPeriodo] = useState<HTMLDivElement | null>(null)
  const [huecoSubpestanas, setHuecoSubpestanas] = useState<HTMLDivElement | null>(null)

  const donde = dondeEsta(pathname)
  const producto = donde?.producto ?? null
  const productos = productosVisibles(ctx)
  const pestanas = producto && !producto.pestanasEnLaPantalla ? pestanasVisibles(producto, ctx) : []
  const pestana = donde?.pestana ?? null
  const cinta = producto ? cintaDe(producto.id, pestana?.id ?? null, ctx) : []

  // Ctrl K (⌘K): del marco. En la captura, para que no llegue a Libros ni a Bancos.
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

  // El aviso de lo que ha pasado se va solo a los 8 s (el siguiente lo pisa antes).
  useEffect(() => {
    if (!aviso || aviso.tono === 'falta') return
    const t = window.setTimeout(quitarAviso, 8000)
    return () => window.clearTimeout(t)
  }, [aviso, quitarAviso])

  const marco: Marco = useMemo(() => ({
    densidad: prefs.densidad,
    documentoOculto: prefs.documentoOculto,
    ocultarDocumento: (documentoOculto: boolean) => cambiar({ documentoOculto }),
    // Las áreas de Libros siguen dentro de su pantalla hasta el paso 3: la cabecera ya no las pinta.
    pestanasArriba: false,
    huecoAcciones,
    huecoPeriodo,
    huecoSubpestanas,
  }), [prefs.densidad, prefs.documentoOculto, cambiar, huecoAcciones, huecoPeriodo, huecoSubpestanas])

  // Lo que se puede fijar desde aquí: esta pantalla y lo de su cinta.
  const fijables: Orden[] = [
    ordenPorId(producto ? (pestana && producto.pestanas.length > 0 ? `ir.${producto.id}.${pestana.id}` : `ir.${producto.id}`) : ''),
    ...cinta.flatMap((g) => g.ordenes),
  ].filter((o): o is Orden => !!o)
  const fijar = ({ id, etiqueta }: { id: string; etiqueta: string }) => {
    const ya = prefs.favoritos.includes(id)
    cambiar({ favoritos: alternarFavorito(prefs.favoritos, id) }, ya ? `Quitado de Favoritos: «${etiqueta}».` : `Fijado en Favoritos: «${etiqueta}». Lo tienes arriba, en Favoritos.`)
  }

  const clases = ['cx', 'cxm', 's-esqueleto', solo ? 'cx-solo' : null, movil ? 'cxm-es-movil' : null].filter(Boolean).join(' ')
  const avisoVisible = aviso ?? (errorCtx ? { texto: `${errorCtx}. Mientras, no sale lo que depende de la empresa (hostelería, Diez).`, tono: 'falta' as const } : null)
  return (
    <MarcoContexto.Provider value={marco}>
      <div className={clases} data-densidad={prefs.densidad}>
        {!movil && (
          <BarraProductos productos={productos} activo={producto?.id ?? null} pendientes={pendientesDe(cuentas)}
            desplegada={prefs.barraDesplegada} alternar={() => cambiar({ barraDesplegada: !prefs.barraDesplegada })} />
        )}
        <div className="s-esq-cuerpo">
          <Cabecera producto={producto} pestanas={pestanas} pestanaActiva={pestana?.id ?? null} movil={movil} logoCliente={logoCuenta}
            huecoPeriodo={setHuecoPeriodo} abrirBuscador={() => setBuscando(true)}
            favoritos={<Favoritos favoritos={favoritosDe(prefs.favoritos, ctx)} fijables={fijables} movil={movil} alternar={fijar} alAbrirBuscador={() => setBuscando(true)} />}
            usuario={<MenuUsuario nombre={userName ?? 'Tú'} prefs={prefs} solo={solo} movil={movil} cambiar={cambiar} />} />
          <p className="s-esq-aviso" role="status" aria-live="polite" data-tono={avisoVisible?.tono}>{avisoVisible?.texto ?? ''}</p>
          {producto && pestana && (
            <CintaDePestana etiqueta={`Acciones de ${pestana.etiqueta}`} grupos={cinta} oculta={prefs.cintaOculta}
              alCambiarOculta={(cintaOculta) => cambiar({ cintaOculta }, cintaOculta ? 'Cinta oculta: «Mostrar la cinta» la saca otra vez.' : 'La cinta vuelve a estar a la vista.')}
              alBuscar={() => setBuscando(true)} />
          )}
          {/* La segunda fila (las acciones de un área de Libros): la llena la pantalla; vacía, no se pinta. */}
          {!movil && <div className="cxm-subpestanas" ref={setHuecoSubpestanas} />}
          {/* La barra de acciones de la pantalla (AccionesPantalla); vacía, no se pinta. */}
          <div className="cxm-acciones" ref={setHuecoAcciones} />
          <main className="cx-principal cxm-principal">
            {producto?.id === 'inicio' && <TeTocaHoy chips={chipsDelInicio(cuentas)} />}
            {children}
          </main>
        </div>
        {movil && <BarraInferior productos={productos} activo={producto?.id ?? null} solo={solo} />}
        {buscando && <Buscador cerrar={() => setBuscando(false)} solo={solo} conPregunta={!solo && !sinPregunta} />}
      </div>
    </MarcoContexto.Provider>
  )
}
