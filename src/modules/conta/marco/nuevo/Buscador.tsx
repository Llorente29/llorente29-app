// src/modules/conta/marco/nuevo/Buscador.tsx
//
// M01 · El buscador general (Ctrl K, maqueta N30 §8): facturas, asientos,
// clientes y proveedores, subcuentas y las opciones del módulo, agrupados por
// tipo. ↑ ↓ para moverse, Intro para abrir, Escape para cerrar.
//
// Lo que abrían Libros y Bancos con su Ctrl K entra aquí como «Opciones», y lo
// de la barra de la IA como «Preguntar» (decisión de Julio, F01 respuesta 4).
// «Preguntar» solo sale donde salía la barra, y dice lo mismo que ella: que
// todavía no puedo contestar desde aquí.
//
// Regla 8: cada grupo dice si está buscando o si ha fallado, y una búsqueda
// sin nada lo dice con lo que se ha buscado.

import type { Contexto } from '@/modules/conta/esqueleto/productos'
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { TEXTO_MUY_PRONTO } from '@/modules/conta/marco/muyPronto'
import { busquedas } from '@/modules/conta/services/buscadorService'
import {
  NOMBRE_GRUPO, buscaEnLaBase, enFila, interpretar, mover, opciones, ordenar, pregunta, type Grupo, type Resultado,
} from '@/modules/conta/marco/nuevo/buscar'
import { Tecla } from '@/modules/conta/ui/marco/Tecla'

const ESPERA_MS = 200

/** Lo que trae la base para lo escrito, grupo a grupo y según va llegando. */
function useBase(q: string): Grupo[] {
  const { accountId } = useCuentaConta()
  const { activa } = useEmpresas()
  const companyId = activa?.id ?? null
  const [r, setR] = useState<{ q: string; grupos: Grupo[] }>({ q: '', grupos: [] })
  useEffect(() => {
    const c = interpretar(q)
    if (!accountId || !buscaEnLaBase(c)) return
    const lista = busquedas(accountId, companyId, c)
    let vivo = true
    const t = window.setTimeout(() => {
      setR({ q, grupos: lista.map((b) => ({ tipo: b.tipo, nombre: NOMBRE_GRUPO[b.tipo], resultados: [], buscando: true, error: null })) })
      for (const b of lista) {
        b.buscar().then(
          (resultados) => { if (vivo) setR((x) => (x.q === q ? { q, grupos: x.grupos.map((g) => (g.tipo === b.tipo ? { ...g, resultados, buscando: false } : g)) } : x)) },
          (e: unknown) => { if (vivo) setR((x) => (x.q === q ? { q, grupos: x.grupos.map((g) => (g.tipo === b.tipo ? { ...g, buscando: false, error: e instanceof Error ? e.message : String(e) } : g)) } : x)) },
        )
      }
    }, ESPERA_MS)
    return () => { vivo = false; window.clearTimeout(t) }
  }, [q, accountId, companyId])
  // Mientras no ha llegado lo de esta búsqueda, los grupos «buscando».
  if (!accountId || !buscaEnLaBase(interpretar(q))) return []
  if (r.q !== q) return busquedas(accountId, companyId, interpretar(q)).map((b) => ({ tipo: b.tipo, nombre: NOMBRE_GRUPO[b.tipo], resultados: [], buscando: true, error: null }))
  return r.grupos
}

export function Buscador({ cerrar, solo, conPregunta, ctx }: {
  cerrar: () => void; solo: boolean; conPregunta: boolean
  /** S01: lo que sale en esta empresa (hostelería, Diez, interruptores); sin él, lo seguro. */
  ctx?: Contexto
}) {
  const navegar = useNavigate()
  const [q, setQ] = useState('')
  const [indice, setIndice] = useState(-1)
  const [aviso, setAviso] = useState<string | null>(null)
  const idLista = useId()
  const idTitulo = useId()
  const antes = useRef<Element | null>(typeof document === 'undefined' ? null : document.activeElement)
  const base = useBase(q)

  const grupos = useMemo(() => {
    const deAqui: Grupo[] = [{ tipo: 'opcion', nombre: NOMBRE_GRUPO.opcion, resultados: opciones(q, solo, ctx).slice(0, 8) }]
    const p = conPregunta ? pregunta(q) : null
    if (p) deAqui.push({ tipo: 'pregunta', nombre: NOMBRE_GRUPO.pregunta, resultados: [p] })
    return ordenar([...base, ...deAqui])
  }, [base, q, solo, conPregunta, ctx])
  const fila = enFila(grupos)
  const activo = indice >= 0 && indice < fila.length ? indice : fila.length ? 0 : -1
  const buscando = grupos.some((g) => g.buscando)

  // Al cerrar, el foco vuelve a donde estaba.
  useEffect(() => {
    const previo = antes.current
    return () => { if (previo instanceof HTMLElement) previo.focus() }
  }, [])

  function abrir(r: Resultado | undefined) {
    if (!r) return
    if (r.tipo === 'pregunta') { setAviso(TEXTO_MUY_PRONTO); return }
    if (r.ruta) { cerrar(); navegar(r.ruta) }
  }

  function tecla(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setIndice(mover(activo, e.key === 'ArrowDown' ? 1 : -1, fila.length))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      abrir(fila[activo])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cerrar()
    }
  }

  const idDe = (r: Resultado) => `${idLista}-${r.clave.replace(/[^A-Za-z0-9_-]/g, '_')}`
  const vacio = q.trim() !== '' && !buscando && fila.length === 0

  return (
    <div className="cxm-velo" onMouseDown={(e) => { if (e.target === e.currentTarget) cerrar() }}>
      <div className="cxm-buscador" role="dialog" aria-modal="true" aria-labelledby={idTitulo}>
        <h2 id={idTitulo} className="cx-oculto">Buscar todo</h2>
        <div className="cxm-buscador-entrada">
          <span className="cxm-lupa" aria-hidden="true">⌕</span>
          <input
            autoFocus className="cxm-buscador-input" value={q} placeholder="Busca una factura, un asiento, un proveedor, una subcuenta o una opción"
            role="combobox" aria-expanded={fila.length > 0} aria-controls={idLista} aria-autocomplete="list"
            aria-activedescendant={activo >= 0 ? idDe(fila[activo]) : undefined} aria-label="Qué buscas"
            onChange={(e) => { setQ(e.target.value); setIndice(-1); setAviso(null) }} onKeyDown={tecla} />
          <Tecla>Esc</Tecla>
        </div>

        <div role="status" aria-live="polite" className="cxm-buscador-estado">
          {aviso && <span className="cxm-buscador-aviso">{aviso}</span>}
          {vacio && <span>No encuentro nada que se llame «{q.trim()}».</span>}
        </div>

        {q.trim() === '' && <p className="cxm-buscador-ayuda">Facturas por número, proveedor o importe; asientos por número o concepto; clientes y proveedores por nombre o NIF; subcuentas por código o nombre; y cualquier pantalla por su nombre.</p>}

        <div id={idLista} role="listbox" aria-label="Resultados" className="cxm-buscador-lista">
          {grupos.map((g) => (
            <div key={g.tipo} role="group" aria-label={g.nombre} className="cxm-buscador-grupo">
              <div className="cxm-buscador-grupo-titulo" aria-hidden="true">
                {g.nombre}{g.buscando && <span className="cxm-apoyo"> · buscando…</span>}
              </div>
              {g.error && <div className="cxm-buscador-error" role="alert">{g.error}</div>}
              {g.resultados.map((r) => {
                const i = fila.indexOf(r)
                return (
                  <div key={r.clave} id={idDe(r)} role="option" aria-selected={i === activo} className={r.apagado ? 'cxm-buscador-opcion cxm-buscador-opcion-apagada' : 'cxm-buscador-opcion'}
                    onMouseEnter={() => setIndice(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => abrir(r)}>
                    <span className="cxm-buscador-titulo">{r.titulo}</span>
                    {r.apoyo && <span className="cxm-apoyo">{r.apoyo}</span>}
                    {r.cifra && <span className="cxm-cifra cxm-buscador-cifra">{r.cifra}</span>}
                  </div>
                )
              })}
            </div>
          ))}
        </div>

        <div className="cxm-buscador-pie" aria-hidden="true">
          <span><Tecla>↑</Tecla> <Tecla>↓</Tecla> moverse</span>
          <span><Tecla>Intro</Tecla> abrir</span>
          <span><Tecla>Esc</Tecla> cerrar</span>
        </div>
      </div>
    </div>
  )
}

