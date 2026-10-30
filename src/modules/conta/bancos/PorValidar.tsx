// src/modules/conta/bancos/PorValidar.tsx
//
// S02 · PR 2 (Julio, 22/10) · Bancos › Movimientos › «Por validar»: lo casado
// cuyo asiento sigue propuesto. Contabilidad › Asientos ya no lo enseña
// (lib/diario.ts, SE_DECIDE_EN), así que se valida aquí y no se queda sin sitio.
//
// Cada fila: el movimiento, con qué se casó y su veredicto con el porqué
// («Lista para contabilizar», «Revisa esto» o «Aún no se puede validar»:
// lib/validarBanco.ts). Uno a uno: «Validar y siguiente», o Intro sobre la fila
// elegida (↑↓ para moverse); al validar, la elegida pasa a la siguiente. En
// bloque: «Validar los N», solo los «Lista para contabilizar». Todo lo que se
// pulsa dice lo que ha pasado o el fallo (regla 8), desde Movimientos.

import { useRef, useState, type KeyboardEvent } from 'react'
import { diaMesCorto, eurosExactos } from '@/modules/conta/lib/formato'
import type { MovimientoBanco } from '@/modules/conta/lib/bancosVista'
import { quienEs } from '@/modules/conta/lib/conciliarVista'
import { finDeCuenta, listosParaValidar, siguienteTras, type VeredictoBanco } from '@/modules/conta/lib/validarBanco'

const euros = (c: number) => eurosExactos(c / 100)
const TONO: Record<VeredictoBanco['tipo'], string> = { lista: 'propuesto', revisa: 'duda' }

export function PorValidar({ filas, donde, movil, ocupado, banco, otros, alSeguir, alValidar, alValidarLos, alVerAsiento, alDeshacer }: {
  filas: readonly { m: MovimientoBanco; v: VeredictoBanco; espera: boolean }[]
  donde: string
  movil: boolean
  ocupado: string | null
  /** S01d · «BBVA ·6536», y los demás bancos con lo que les queda por validar (la tarjeta de fin de cuenta). */
  banco: string
  otros: readonly { id: string; nombre: string; n: number }[]
  alSeguir: (bancoId: string) => void
  /** Valida su asiento; su número si se ha validado, null si no (la pantalla dice el resultado). */
  alValidar: (m: MovimientoBanco) => Promise<number | null>
  alValidarLos: (ms: readonly MovimientoBanco[]) => void
  alVerAsiento: (m: MovimientoBanco) => void
  alDeshacer: (m: MovimientoBanco) => void
}) {
  const [elegida, setElegida] = useState<string | null>(null)
  // S01d · Lo validado aquí, uno a uno: los números de sus asientos, para la tarjeta de fin de cuenta.
  const [hechos, setHechos] = useState<number[]>([])
  const lista = useRef<HTMLDivElement>(null)
  const ids = filas.map((f) => f.m.id)
  const actual = filas.find((f) => f.m.id === elegida) ?? filas[0] ?? null
  const listos = listosParaValidar(filas.filter((f) => !f.espera))

  const enfocar = (id: string | null) => {
    setElegida(id)
    if (id) requestAnimationFrame(() => document.getElementById(`cxv-fila-${id}`)?.scrollIntoView({ block: 'nearest' }))
  }
  const validarYSiguiente = async (m: MovimientoBanco) => {
    const sig = siguienteTras(ids, m.id)
    const numero = await alValidar(m)
    if (numero !== null) { setHechos((h) => [...h, numero]); enfocar(sig); lista.current?.focus() }
  }
  const teclado = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('input, button, a, select, textarea, summary') || !actual) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const i = Math.max(0, Math.min(ids.length - 1, ids.indexOf(actual.m.id) + (e.key === 'ArrowDown' ? 1 : -1)))
      enfocar(ids[i])
    } else if (e.key === 'Enter' && !actual.espera && !ocupado) {
      e.preventDefault(); void validarYSiguiente(actual.m)
    }
  }

  if (!filas.length) {
    // S01d · Al acabar la cuenta, en vez de saltar a otro banco, lo dice en su sitio (tablero 4).
    if (hechos.length > 0) return <FinDeCuenta banco={banco} numeros={hechos} otros={otros} alSeguir={alSeguir} alVolver={() => setHechos([])} />
    return <div className="cx-tarjeta"><p className="cxb-vacio">Nada por validar {donde}: cada asiento casado ya está en el libro diario.</p></div>
  }
  return (
    <>
      {listos.length > 0 && (
        <div className="cxn-bloque-barra" role="region" aria-label="Validar en bloque">
          <span>
            <strong>{listos.length === 1 ? '1 lista para contabilizar' : `${listos.length} listas para contabilizar`}</strong>
            {!movil && <span className="cx-ayuda"> · cada una se valida como si fuera sola; lo que hay que revisar se queda</span>}
          </span>
          <button type="button" className="cx-boton" disabled={!!ocupado} onClick={() => alValidarLos(listos)}>
            {ocupado === 'validar-bloque' ? 'Validando…' : listos.length === 1 ? 'Validar la 1' : `Validar los ${listos.length}`}
          </button>
        </div>
      )}
      <div ref={lista} className="cx-tarjeta cxn-casados cxv-lista" role="grid" tabIndex={0} aria-label={`Por validar ${donde}`}
        aria-keyshortcuts="ArrowUp ArrowDown Enter" onKeyDown={teclado}>
        {filas.map(({ m, v, espera }) => {
          const esta = actual?.m.id === m.id
          return (
            <div key={m.id} id={`cxv-fila-${m.id}`} role="row" aria-selected={esta} data-testid={`validar-${m.id}`}
              className={`cxn-casado cxv-fila${esta ? ' cxn-elegida' : ''}`} onClick={() => setElegida(m.id)}>
              <span role="gridcell" className="cxn-casado-que">
                <span className="cxn-casado-mov"><span className="cx-cifra">{diaMesCorto(m.fecha)}</span> · <strong>{quienEs(m)}</strong> · <span className={`cx-cifra${m.importeCent > 0 ? ' cxb-entra' : ''}`}>{euros(m.importeCent)}</span></span>
                <span>Casado con <strong>{m.casado?.asientoConcepto ?? m.propuesta?.que ?? 'su asiento'}</strong></span>
                <span className="cxv-veredicto" data-tono={TONO[v.tipo]}><strong>{v.titulo}.</strong> {v.porque}</span>
              </span>
              <span role="gridcell" className="cxb-botones" onClick={(e) => e.stopPropagation()}>
                <button type="button" className={esta ? 'cx-boton' : 'cx-boton-sec'} disabled={!!ocupado || espera} onClick={() => { setElegida(m.id); void validarYSiguiente(m) }}>
                  {ocupado === m.id ? 'Validando…' : 'Validar y siguiente'}
                </button>
                <button type="button" className="cx-boton-sec" onClick={() => alVerAsiento(m)}>Ver el asiento</button>
                <button type="button" className="cx-boton-sec" disabled={!!ocupado} onClick={() => alDeshacer(m)}>Deshacer</button>
              </span>
            </div>
          )
        })}
        {!movil && <p className="cxb-pie"><span>↑↓ para moverse; Intro valida la elegida y pasa a la siguiente. Lo validado va al libro diario.</span></p>}
      </div>
    </>
  )
}

/** S01d · El fin de cuenta de «Validar y siguiente» (tablero 4): una tarjeta en el sitio del movimiento, no una ventana. */
function FinDeCuenta({ banco, numeros, otros, alSeguir, alVolver }: {
  banco: string; numeros: readonly number[]; otros: readonly { id: string; nombre: string; n: number }[]
  alSeguir: (bancoId: string) => void; alVolver: () => void
}) {
  const f = finDeCuenta(banco, numeros, otros)
  return (
    <section className="cx-tarjeta cxv-fin" aria-label={f.titulo} data-prueba="fin-de-cuenta"
      onKeyDown={(e) => { if (e.key === 'Enter' && f.seguir && !(e.target as HTMLElement).closest('button')) { e.preventDefault(); alSeguir(f.seguir.id) } }}>
      <span className="cxv-fin-chip">{f.chip}</span>
      <h2 className="cxv-fin-titulo">{f.titulo}</h2>
      <p className="cxv-fin-texto">{f.texto}</p>
      <div className="cxv-fin-botones">
        {f.seguir && (
          <button type="button" className="cx-boton" autoFocus onClick={() => alSeguir(f.seguir!.id)}>Seguir con {f.seguir.nombre} · Intro</button>
        )}
        <button type="button" className="cx-boton-sec" onClick={alVolver}>Volver a la lista</button>
      </div>
    </section>
  )
}
