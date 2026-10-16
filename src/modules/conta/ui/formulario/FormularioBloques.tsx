// src/modules/conta/ui/formulario/FormularioBloques.tsx
//
// M01 · Pieza común · El formulario por bloques (maqueta N30 §5, como el de
// factura de ERP10). Lo usarán las pantallas que rellenan un documento
// (facturas recibidas, el asiento a mano…) cuando su sesión las pase al marco.
//   · Arriba: ← → con «3 de 12», el título del documento y su estado.
//   · Una línea que explica lo azul: «● propuesto por la máquina: Tab lo
//     acepta, escribir lo cambia».
//   · Bloques con título en 12 px mayúsculas grises; campos de 30 px con la
//     etiqueta encima, en una rejilla de 6 columnas. Un bloque puede llevar
//     dentro otra cosa (el «Asiento que se crea», como tabla).
//   · Teclado (formulario.ts): Tab e Intro, siguiente campo; F4, buscar
//     subcuenta; Ctrl S, guardar; Ctrl Intro, validar y pasar al siguiente;
//     Av Pág / Re Pág, documento siguiente o anterior. Ni F5, ni F10, ni F11,
//     ni F12.
//   · A la derecha, si la pantalla lo da, el panel del documento.
//
// La pantalla tiene los valores y decide qué hace guardar o validar; la pieza
// pinta, mueve el foco y dice qué ha aceptado la persona. Lo que pasa al
// guardar lo dice la pantalla en `aviso` (regla 8).

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Tecla } from '@/modules/conta/ui/marco/Tecla'
import { accionDeTecla, buscarSubcuentas, estadoCampo, textoPosicion, type Subcuenta } from '@/modules/conta/ui/formulario/formulario'

export interface CampoBloque {
  id: string
  etiqueta: string
  /** Cuántas de las 6 columnas ocupa (2 de serie). */
  columnas?: 1 | 2 | 3 | 4 | 5 | 6
  tipo?: 'texto' | 'importe' | 'fecha' | 'subcuenta' | 'opciones'
  opciones?: readonly { valor: string; texto: string }[]
  /** Lo que propone la máquina: sale en azul claro hasta que se acepta o se cambia. */
  propuesto?: string
  soloLectura?: boolean
  pista?: string
}

export interface Bloque {
  id: string
  titulo: string
  campos?: readonly CampoBloque[]
  /** Lo que va debajo de los campos del bloque (una tabla, una nota). */
  contenido?: ReactNode
  /** Cuántas columnas de la rejilla grande ocupa el bloque (6 de serie). */
  ancho?: 2 | 3 | 4 | 6
}

export interface PropsFormularioBloques {
  titulo: string
  estado?: { texto: string; tono: 'ambar' | 'verde' | 'azul' | 'gris' }
  posicion?: { actual: number; total: number; anterior?: () => void; siguiente?: () => void }
  bloques: readonly Bloque[]
  valores: Readonly<Record<string, string>>
  alCambiar: (id: string, valor: string) => void
  /** Ctrl S. */
  alGuardar?: () => void
  /** Ctrl Intro: validar y pasar al siguiente. */
  alValidar?: () => void
  /** Para F4 en los campos de subcuenta. */
  subcuentas?: readonly Subcuenta[]
  /** Lo que ha pasado al guardar o validar (regla 8), con contenido. */
  aviso?: { texto: string; tono: 'ok' | 'mal' } | null
  /** El panel del documento, a la derecha. */
  documento?: ReactNode
}

export function FormularioBloques(p: PropsFormularioBloques) {
  const forma = useRef<HTMLFormElement | null>(null)
  const [aceptados, setAceptados] = useState<ReadonlySet<string>>(new Set())
  const [buscando, setBuscando] = useState<string | null>(null)
  const hayPropuestos = p.bloques.some((b) => b.campos?.some((c) => c.propuesto && estadoCampo(p.valores[c.id] ?? '', c.propuesto, aceptados.has(c.id)) === 'propuesto'))

  const campos = () => Array.from(forma.current?.querySelectorAll<HTMLElement>('[data-campo]:not([disabled]):not([readonly])') ?? [])
  const siguiente = (desde: HTMLElement) => {
    const lista = campos()
    const i = lista.indexOf(desde)
    lista[i + 1]?.focus()
  }

  function tecla(e: KeyboardEvent<HTMLFormElement>) {
    const el = e.target as HTMLElement
    const id = el.getAttribute('data-campo')
    // Tab sobre lo propuesto lo acepta (y el navegador pasa al siguiente).
    if (e.key === 'Tab' && !e.shiftKey && id) setAceptados((s) => (s.has(id) ? s : new Set(s).add(id)))
    const accion = accionDeTecla(e, el.tagName === 'TEXTAREA')
    if (!accion) return
    if (accion === 'siguiente') { if (id) { e.preventDefault(); setAceptados((s) => new Set(s).add(id)); siguiente(el) } return }
    if (accion === 'buscar') { if (id && el.getAttribute('data-tipo') === 'subcuenta' && p.subcuentas) { e.preventDefault(); setBuscando(id) } return }
    if (accion === 'guardar' && p.alGuardar) { e.preventDefault(); p.alGuardar(); return }
    if (accion === 'validar' && p.alValidar) { e.preventDefault(); p.alValidar(); return }
    if (accion === 'documento-siguiente' && p.posicion?.siguiente) { e.preventDefault(); p.posicion.siguiente(); return }
    if (accion === 'documento-anterior' && p.posicion?.anterior) { e.preventDefault(); p.posicion.anterior() }
  }

  const formulario = (
    <form ref={forma} className="cxf" onKeyDown={tecla} onSubmit={(e) => { e.preventDefault(); p.alGuardar?.() }} aria-label={p.titulo}>
      <header className="cxf-cabeza">
        {p.posicion && (
          <div className="cxf-posicion" role="group" aria-label="Documentos">
            <button type="button" className="cxf-flecha" onClick={p.posicion.anterior} disabled={!p.posicion.anterior} aria-label="Documento anterior" aria-keyshortcuts="PageUp">←</button>
            <span className="cxm-cifra">{textoPosicion(p.posicion.actual, p.posicion.total)}</span>
            <button type="button" className="cxf-flecha" onClick={p.posicion.siguiente} disabled={!p.posicion.siguiente} aria-label="Documento siguiente" aria-keyshortcuts="PageDown">→</button>
          </div>
        )}
        <h2 className="cxf-titulo">{p.titulo}</h2>
        {p.estado && <span className={`cxf-estado cxf-estado-${p.estado.tono}`}>{p.estado.texto}</span>}
      </header>
      {hayPropuestos && (
        <p className="cxf-leyenda"><span className="cxf-punto" aria-hidden="true">●</span> propuesto por la máquina: <Tecla>Tab</Tecla> lo acepta, escribir lo cambia</p>
      )}
      <div className="cxf-bloques">
        {p.bloques.map((b) => (
          <section key={b.id} className="cxf-bloque" style={{ gridColumn: `span ${b.ancho ?? 6}` }} aria-labelledby={`${b.id}-t`}>
            <h3 id={`${b.id}-t`} className="cxf-bloque-titulo">{b.titulo}</h3>
            {b.campos && b.campos.length > 0 && (
              <div className="cxf-rejilla">
                {b.campos.map((c) => (
                  <Campo key={c.id} c={c} valor={p.valores[c.id] ?? ''} aceptado={aceptados.has(c.id)} alCambiar={(v) => p.alCambiar(c.id, v)}
                    buscando={buscando === c.id} subcuentas={p.subcuentas}
                    alElegir={(s) => { p.alCambiar(c.id, s.codigo); setBuscando(null); setAceptados((x) => new Set(x).add(c.id)) }}
                    alCerrarBusqueda={() => setBuscando(null)} />
                ))}
              </div>
            )}
            {b.contenido}
          </section>
        ))}
      </div>
      {p.aviso && <p className={p.aviso.tono === 'ok' ? 'cxf-aviso cxf-aviso-ok' : 'cxf-aviso cxf-aviso-mal'} role={p.aviso.tono === 'ok' ? 'status' : 'alert'}>{p.aviso.texto}</p>}
      <footer className="cxf-pie">
        {p.alGuardar && <button type="submit" className="cxm-boton" aria-keyshortcuts="Control+S"><span>Guardar</span><Tecla>Ctrl S</Tecla></button>}
        {p.alValidar && <button type="button" className="cxm-boton cxm-boton-principal" onClick={p.alValidar} aria-keyshortcuts="Control+Enter"><span>Validar y siguiente</span><Tecla>Ctrl Intro</Tecla></button>}
        <span className="cxf-teclas">Intro siguiente campo · F4 buscar subcuenta · Av Pág / Re Pág documento</span>
      </footer>
    </form>
  )
  if (!p.documento) return formulario
  return <div className="cxf-con-documento">{formulario}{p.documento}</div>
}

function Campo({ c, valor, aceptado, alCambiar, buscando, subcuentas, alElegir, alCerrarBusqueda }: {
  c: CampoBloque; valor: string; aceptado: boolean; alCambiar: (v: string) => void
  buscando: boolean; subcuentas?: readonly Subcuenta[]; alElegir: (s: Subcuenta) => void; alCerrarBusqueda: () => void
}) {
  const id = useId()
  const estado = estadoCampo(valor, c.propuesto, aceptado)
  // Al cerrar la búsqueda de F4, el foco vuelve al campo: así Tab, Intro y Ctrl S siguen en el formulario.
  const volver = () => requestAnimationFrame(() => document.getElementById(id)?.focus())
  const clase = `cxf-input cxf-${estado}${c.tipo === 'importe' ? ' cxm-cifra cxf-derecha' : ''}${c.tipo === 'subcuenta' ? ' cxm-cifra' : ''}`
  const comun = {
    id, 'data-campo': c.id, 'data-tipo': c.tipo ?? 'texto', className: clase, value: valor, readOnly: c.soloLectura,
    'aria-describedby': estado === 'propuesto' ? `${id}-p` : undefined,
  }
  return (
    <div className="cxf-campo" style={{ gridColumn: `span ${c.columnas ?? 2}` }}>
      <label htmlFor={id} className="cxf-etiqueta">{c.etiqueta}{c.tipo === 'subcuenta' && <span className="cxf-f4"> · F4</span>}</label>
      {c.tipo === 'opciones'
        ? <select {...comun} onChange={(e) => alCambiar(e.target.value)}>{(c.opciones ?? []).map((o) => <option key={o.valor} value={o.valor}>{o.texto}</option>)}</select>
        : <input {...comun} type={c.tipo === 'fecha' ? 'date' : 'text'} inputMode={c.tipo === 'importe' ? 'decimal' : c.tipo === 'subcuenta' ? 'numeric' : undefined}
          placeholder={c.pista} onChange={(e) => alCambiar(e.target.value)} />}
      {estado === 'propuesto' && <span id={`${id}-p`} className="cx-oculto">Propuesto por la máquina</span>}
      {buscando && subcuentas && (
        <BuscarSubcuenta lista={subcuentas} inicial={valor} alElegir={(s) => { alElegir(s); volver() }} alCerrar={() => { alCerrarBusqueda(); volver() }} />
      )}
    </div>
  )
}

/** F4: una lista que se filtra al escribir; ↑ ↓ e Intro, o Esc para volver. */
function BuscarSubcuenta({ lista, inicial, alElegir, alCerrar }: { lista: readonly Subcuenta[]; inicial: string; alElegir: (s: Subcuenta) => void; alCerrar: () => void }) {
  const [q, setQ] = useState(inicial)
  const [i, setI] = useState(0)
  const r = buscarSubcuentas(lista, q)
  const id = useId()
  return (
    <div className="cxf-buscar" role="dialog" aria-label="Buscar subcuenta">
      <input className="cxf-input" autoFocus value={q} aria-label="Número o nombre de la subcuenta" role="combobox" aria-expanded="true" aria-controls={id}
        aria-activedescendant={r[i] ? `${id}-${i}` : undefined}
        onChange={(e) => { setQ(e.target.value); setI(0) }}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'ArrowDown') { e.preventDefault(); setI((x) => Math.min(r.length - 1, x + 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setI((x) => Math.max(0, x - 1)) }
          else if (e.key === 'Enter') { e.preventDefault(); if (r[i]) alElegir(r[i]) }
          else if (e.key === 'Escape') { e.preventDefault(); alCerrar() }
        }} />
      <ul id={id} role="listbox" className="cxf-buscar-lista">
        {r.length === 0 && <li className="cxf-buscar-nada">Ninguna subcuenta se llama así.</li>}
        {r.map((s, k) => (
          <li key={s.codigo} id={`${id}-${k}`} role="option" aria-selected={k === i} onMouseDown={(e) => { e.preventDefault(); alElegir(s) }}>
            <span className="cxm-cifra">{s.codigo}</span> <span>{s.nombre}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
