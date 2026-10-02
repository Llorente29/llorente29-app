// src/modules/conta/marco/BarraPregunta.tsx
//
// La barra flotante «Pregunta o pide algo» (ordenador) y el botón central de
// la IA (móvil). Se dibujan fieles a la maqueta y, al usarlos, dicen «Muy
// pronto» (encargo C00 §6.5). Ctrl K (o ⌘K) lleva el foco a la barra.

import { useEffect, useRef, useState } from 'react'
import { Microfono } from '@/modules/conta/ui/Icono'
import { DURACION_MUY_PRONTO_MS, TEXTO_MUY_PRONTO } from '@/modules/conta/marco/muyPronto'

function useMuyPronto() {
  const [visible, setVisible] = useState(false)
  const temporizador = useRef<number | null>(null)
  useEffect(() => () => { if (temporizador.current) window.clearTimeout(temporizador.current) }, [])
  function avisar() {
    setVisible(true)
    if (temporizador.current) window.clearTimeout(temporizador.current)
    temporizador.current = window.setTimeout(() => setVisible(false), DURACION_MUY_PRONTO_MS)
  }
  return { visible, avisar }
}

function Aviso({ visible }: { visible: boolean }) {
  return (
    <div role="status" aria-live="polite">
      {visible && <span className="cx-muy-pronto">{TEXTO_MUY_PRONTO}</span>}
    </div>
  )
}

export function BarraPregunta({ ejemplo }: { ejemplo: string }) {
  const { visible, avisar } = useMuyPronto()
  const entrada = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    function alPulsar(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        entrada.current?.focus()
      }
    }
    window.addEventListener('keydown', alPulsar)
    return () => window.removeEventListener('keydown', alPulsar)
  }, [])

  return (
    <form className="cx-pregunta" role="search" aria-label="Pregunta a Folvy"
      onSubmit={(e) => { e.preventDefault(); avisar() }}>
      <Aviso visible={visible} />
      <div className="cx-pregunta-barra">
        <span className="cx-pregunta-punto" aria-hidden="true" />
        <label htmlFor="cx-pregunta" className="cx-oculto">Pregunta a Folvy</label>
        <input id="cx-pregunta" ref={entrada} type="text" className="cx-pregunta-input"
          placeholder={`Pregunta o pide algo. «${ejemplo}»`} autoComplete="off" />
        <span className="cx-tecla" aria-hidden="true">Ctrl K</span>
        <button type="button" className="cx-voz" aria-label="Hablar" onClick={avisar}>
          <Microfono />
        </button>
      </div>
    </form>
  )
}

/** El botón central de la IA en la barra inferior del móvil. */
export function BotonIAMovil() {
  const { visible, avisar } = useMuyPronto()
  return (
    <>
      <Aviso visible={visible} />
      <button type="button" className="cx-barra-ia" aria-label="Preguntar a Folvy" onClick={avisar}
        style={{ color: 'var(--cx-blanco)' }}>
        <Microfono />
      </button>
    </>
  )
}
