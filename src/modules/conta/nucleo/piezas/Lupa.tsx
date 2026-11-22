// src/modules/conta/nucleo/piezas/Lupa.tsx
//
// K12 · Pieza común 5: la lupa, como «Localización de registros» de ERP10 (capturas 08, 14 y 15). La misma para las
// cuentas, los terceros, los locales, las marcas, las plataformas, los tipos de operación y las claves:
//   · una lista ordenada por la descripción; se busca escribiendo (código, descripción, nombre comercial o N.I.F.);
//   · columnas: código y descripción, y nombre comercial y N.I.F. si los registros los tienen;
//   · ↑ ↓ se mueven, Intro elige, Esc cierra sin elegir;
//   · al final, «＋ Dar de alta» si la pantalla sabe darlo de alta (`alta`).
// Y la casilla con lupa (CasillaLupa): se escribe; Intro elige si lo escrito es un código o solo encaja uno, y si no,
// abre la lista con lo escrito; F4 o la lupa la abren. Lo elegido se ve como «código · descripción».

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { elegirConIntro, filtrarRegistros, type Registro } from './logica'

export function Lupa<T extends Registro>({ titulo = 'Localización de registros', registros, inicial = '', alElegir, alCerrar, alta }: {
  titulo?: string; registros: readonly T[]; inicial?: string; alElegir: (r: T) => void; alCerrar: () => void
  /** «＋ Dar de alta»: lo que se escribió, y la pantalla lo da de alta (o abre su alta). */
  alta?: (texto: string) => void
}) {
  const [q, setQ] = useState(inicial)
  const [i, setI] = useState(0)
  const lista = useMemo(() => filtrarRegistros(registros, q), [registros, q])
  const conComercial = registros.some((r) => r.comercial)
  const conNif = registros.some((r) => r.nif)
  const filas = useRef<HTMLTableSectionElement>(null)
  useEffect(() => { filas.current?.querySelector<HTMLElement>(`[data-i="${i}"]`)?.scrollIntoView({ block: 'nearest' }) }, [i])
  const teclas = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setI((x) => Math.min(lista.length - (alta ? 0 : 1), x + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setI((x) => Math.max(0, x - 1)) }
    else if (e.key === 'Enter') {
      e.preventDefault(); e.stopPropagation()
      if (i < lista.length) alElegir(lista[i]); else if (alta) alta(q)
    } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); alCerrar() }
  }
  return (
    <div className="kp-lupa-velo" onMouseDown={(e) => { if (e.target === e.currentTarget) alCerrar() }}>
      <div className="kp-lupa" role="dialog" aria-modal="true" aria-label={titulo} data-pieza="lupa" onKeyDown={teclas}>
        <header className="kp-lupa-titulo"><strong>{titulo}</strong><button type="button" className="kp-ventana-aspa" aria-label="Cerrar la lista" onClick={alCerrar}>✕</button></header>
        <label className="kp-lupa-buscar"><span>Buscar</span>
          <input autoFocus aria-label="Buscar" value={q} onChange={(e) => { setQ(e.target.value); setI(0) }} />
        </label>
        <div className="kp-lupa-lista">
          <table aria-label="Registros">
            <thead><tr><th>Código</th><th>Descripción</th>{conComercial && <th>Nombre comercial</th>}{conNif && <th>N.I.F.</th>}</tr></thead>
            <tbody ref={filas}>
              {lista.map((r, k) => (
                <tr key={r.id} data-i={k} aria-selected={k === i} onMouseEnter={() => setI(k)} onClick={() => alElegir(r)}>
                  <td>{r.codigo}</td><td>{r.descripcion}</td>{conComercial && <td>{r.comercial ?? ''}</td>}{conNif && <td>{r.nif ?? ''}</td>}
                </tr>
              ))}
              {lista.length === 0 && <tr><td colSpan={2 + (conComercial ? 1 : 0) + (conNif ? 1 : 0)} className="kp-lupa-nada">Ninguno encaja con «{q}».</td></tr>}
            </tbody>
          </table>
        </div>
        {alta && <button type="button" className="kp-lupa-alta" data-i={lista.length} aria-selected={i === lista.length} onClick={() => alta(q)}>＋ Dar de alta</button>}
      </div>
    </div>
  )
}

/**
 * La casilla con lupa. `valor` es el id elegido (o ''); lo que se ve, «código · descripción» del elegido o lo que se
 * está escribiendo. `alIntro` se llama después de elegir con Intro (la pantalla pasa a la casilla siguiente).
 */
export function CasillaLupa<T extends Registro>({ id, etiqueta, registros, valor, poner, alIntro, gris = false, ambar = false, alta, vista, teclas, titulo, resolver }: {
  id: string; etiqueta: string; registros: readonly T[]; valor: string | null; poner: (r: T | null) => void
  alIntro?: () => void; gris?: boolean; ambar?: boolean; alta?: (texto: string, elegir: (r: T) => void) => void
  /** Cómo se ve lo elegido (por defecto, el código). */
  vista?: (r: T) => string
  /** Otras teclas de la pantalla (después de las de la lupa). */
  teclas?: (e: KeyboardEvent<HTMLInputElement>) => void
  titulo?: string
  /** Cómo se resuelve lo escrito (la subcuenta: el atajo de ERP10, «572.1» → 57200001). Por defecto, el código o el único que encaja. */
  resolver?: (texto: string) => { registro: T | null; abrir: boolean }
}) {
  const resolverlo = resolver ?? ((t: string) => elegirConIntro(registros, t))
  const elegido = registros.find((r) => r.id === valor) ?? null
  const ver = (r: T | null) => (r ? (vista ? vista(r) : r.codigo) : '')
  const [texto, setTexto] = useState<string | null>(null)
  const [abierta, setAbierta] = useState(false)
  const yo = useRef<HTMLInputElement>(null)
  const ayuda = useId()
  const elegir = (r: T | null, siguiente: boolean) => {
    poner(r); setTexto(null); setAbierta(false)
    if (siguiente) alIntro?.(); else yo.current?.focus()
  }
  const alPulsar = (e: KeyboardEvent<HTMLInputElement>) => {
    if (gris) { teclas?.(e); return }
    if (e.key === 'F4' && !e.ctrlKey && !e.altKey && !e.metaKey) { e.preventDefault(); e.stopPropagation(); setAbierta(true); return }
    if (e.key === 'Enter' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
      if (texto === null) { teclas?.(e); return }
      e.preventDefault(); e.stopPropagation()
      if (!texto.trim()) { elegir(null, true); return }
      const r = resolverlo(texto)
      if (r.registro) elegir(r.registro, true); else setAbierta(true)
      return
    }
    teclas?.(e)
  }
  return (
    <>
      <span className="kp-con-lupa">
        <input ref={yo} id={id} aria-label={etiqueta} aria-describedby={ayuda} readOnly={gris} data-ambar={ambar ? 'si' : undefined}
          value={texto ?? ver(elegido)} title={titulo ?? (elegido ? `${elegido.codigo} · ${elegido.descripcion}` : undefined)}
          onChange={(e) => setTexto(e.target.value)}
          onBlur={() => { if (texto !== null && !abierta) { const r = resolverlo(texto); if (!texto.trim()) poner(null); else if (r.registro) poner(r.registro); setTexto(null) } }}
          onKeyDown={alPulsar} aria-keyshortcuts="F4" />
        {!gris && <button type="button" className="kp-lupa-boton" tabIndex={-1} aria-label={`Buscar ${etiqueta.toLowerCase()}`} onClick={() => setAbierta(true)}>
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="2.4" /><path d="M15.5 15.5l5 5" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" /></svg>
        </button>}
        <span id={ayuda} hidden>F4 abre la lista</span>
      </span>
      {abierta && (
        <Lupa registros={registros} inicial={texto ?? ''} alElegir={(r) => elegir(r, true)} alCerrar={() => { setAbierta(false); yo.current?.focus() }}
          alta={alta ? (q) => { setAbierta(false); alta(q, (r) => elegir(r, true)) } : undefined} />
      )}
    </>
  )
}
