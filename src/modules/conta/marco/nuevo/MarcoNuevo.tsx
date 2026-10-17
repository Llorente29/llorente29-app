// src/modules/conta/marco/nuevo/MarcoNuevo.tsx
//
// M01 · El marco nuevo de contabilidad (maqueta N30, aprobada por Julio el
// 15/10): módulos fijos a la izquierda, una barra arriba con la empresa, las
// pestañas del módulo, el buscador, la densidad y el usuario, y debajo la
// barra de acciones de la pantalla. En el móvil, los módulos van abajo.
//
// Envuelve las pantallas que ya existen SIN tocarlas: se ven dentro con su
// estilo de hoy (los tokens del marco viven aparte, en `.cxm`) hasta que su
// sesión las pase. Lo único que una pantalla vieja nota es que el marco ya no
// le pinta la barra «Pregunta o pide algo»: lo que hacía va al buscador.
//
// Ctrl K es del marco: se escucha ANTES que las pantallas (en la captura) y
// no les llega. Sus botones de buscar siguen funcionando con el ratón.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { useIsMobile } from '@/shell/useIsMobile'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useProductoSolo } from '@/modules/conta/cuenta/useProductoSolo'
import { useCuentasMenu } from '@/modules/conta/marco/useCuentasMenu'
import { TeTocaHoy } from '@/modules/conta/ui/marco/TeTocaHoy'
import { chipsDelInicio } from '@/modules/conta/marco/nuevo/teTocaHoy'
import { MarcoContexto, type Marco } from '@/modules/conta/marco/nuevo/contexto'
import { moduloDe, pestanasArriba } from '@/modules/conta/marco/nuevo/modulos'
import {
  almacenDelNavegador, guardarPreferencia, leerPreferencias, type Densidad, type PreferenciasMarco,
} from '@/modules/conta/marco/nuevo/preferencias'
import { BarraModulos } from '@/modules/conta/marco/nuevo/BarraModulos'
import { BarraSuperior } from '@/modules/conta/marco/nuevo/BarraSuperior'
import { BarraInferior } from '@/modules/conta/marco/nuevo/BarraInferior'
import { Buscador } from '@/modules/conta/marco/nuevo/Buscador'

/** Las preferencias de la persona; se vuelven a leer si cambia quién es (sin efecto: en el render). */
function usePreferencias(usuario: string) {
  const [estado, setEstado] = useState<{ usuario: string; p: PreferenciasMarco }>(() => ({ usuario, p: leerPreferencias(usuario, almacenDelNavegador()) }))
  const p = estado.usuario === usuario ? estado.p : leerPreferencias(usuario, almacenDelNavegador())
  const cambiar = useCallback((cambio: Partial<PreferenciasMarco>) => {
    setEstado({ usuario, p: guardarPreferencia(usuario, cambio, almacenDelNavegador()) })
  }, [usuario])
  return [p, cambiar] as const
}

export function MarcoNuevo({ children, sinPregunta = false }: { children: ReactNode; sinPregunta?: boolean }) {
  const movil = useIsMobile()
  const solo = useProductoSolo()
  const { userId, userName } = useCuentaConta()
  const { pathname } = useLocation()
  const cuentas = useCuentasMenu()
  const [prefs, cambiar] = usePreferencias(userId ?? 'sin-usuario')
  const [buscando, setBuscando] = useState(false)
  const [huecoAcciones, setHuecoAcciones] = useState<HTMLDivElement | null>(null)
  const [huecoPeriodo, setHuecoPeriodo] = useState<HTMLDivElement | null>(null)
  const [huecoSubpestanas, setHuecoSubpestanas] = useState<HTMLDivElement | null>(null)

  const modulo = moduloDe(pathname)
  const arriba = pestanasArriba(modulo, movil)

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

  const marco: Marco = useMemo(() => ({
    densidad: prefs.densidad,
    documentoOculto: prefs.documentoOculto,
    ocultarDocumento: (documentoOculto: boolean) => cambiar({ documentoOculto }),
    pestanasArriba: arriba,
    huecoAcciones,
    huecoPeriodo,
    huecoSubpestanas,
  }), [prefs.densidad, prefs.documentoOculto, cambiar, arriba, huecoAcciones, huecoPeriodo, huecoSubpestanas])

  const clases = ['cx', 'cxm', solo ? 'cx-solo' : null, movil ? 'cxm-es-movil' : null].filter(Boolean).join(' ')
  return (
    <MarcoContexto.Provider value={marco}>
      <div className={clases} data-densidad={prefs.densidad} data-barra={prefs.barraDesplegada ? 'desplegada' : 'plegada'}>
        {!movil && (
          <BarraModulos solo={solo} desplegada={prefs.barraDesplegada} cuentas={cuentas}
            alternar={() => cambiar({ barraDesplegada: !prefs.barraDesplegada })} />
        )}
        <div className="cxm-cuerpo">
          <BarraSuperior modulo={modulo} conPestanas={arriba} movil={movil} solo={solo} usuario={userName}
            densidad={prefs.densidad} cambiarDensidad={(densidad: Densidad) => cambiar({ densidad })}
            abrirBuscador={() => setBuscando(true)} huecoPeriodo={setHuecoPeriodo} />
          {/* La segunda fila de la barra de arriba (las acciones de la pestaña): la llena la pantalla; vacía, no se pinta. */}
          {!movil && <div className="cxm-subpestanas" ref={setHuecoSubpestanas} />}
          {/* La barra de acciones: la llena la pantalla (AccionesPantalla); vacía, no se pinta. */}
          <div className="cxm-acciones" ref={setHuecoAcciones} />
          <main className="cx-principal cxm-principal">
            {modulo?.id === 'inicio' && <TeTocaHoy chips={chipsDelInicio(cuentas)} />}
            {children}
          </main>
        </div>
        {movil && <BarraInferior solo={solo} cuentas={cuentas} />}
        {buscando && <Buscador cerrar={() => setBuscando(false)} solo={solo} conPregunta={!solo && !sinPregunta} />}
      </div>
    </MarcoContexto.Provider>
  )
}
