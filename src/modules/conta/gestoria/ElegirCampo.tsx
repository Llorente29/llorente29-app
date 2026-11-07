// src/modules/conta/gestoria/ElegirCampo.tsx
//
// G01c · Elegir un campo de Bitrix24 en «Qué es cada campo» sin ver códigos y
// sin bajar por una lista de 297: lo elegido, con su etiqueta y su tipo en
// palabras («Texto», «Lista», «Dirección»…) y «Cambiar»; al cambiar, se
// escribe y la lista se filtra al momento. Es el patrón del buscador de
// actividades (empresa/ApartadosActividad.tsx · Buscador).

import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { buscarCampos, type CampoParaElegir } from './queEsCadaCampo'

export function ElegirCampo({ etiqueta, valor, campos, alCambiar, deshabilitado }: {
  /** Para quien no ve la pantalla: «NIF: campo de Bitrix24». */
  etiqueta: string
  valor: string | null
  campos: readonly CampoParaElegir[]
  alCambiar: (v: string | null) => void
  deshabilitado?: boolean
}) {
  const [abierto, setAbierto] = useState(false)
  const [texto, setTexto] = useState('')
  const caja = useRef<HTMLInputElement | null>(null)
  const elegido = campos.find((c) => c.valor === valor) ?? null
  const hallados = useMemo(() => buscarCampos(campos, texto).slice(0, 40), [campos, texto])
  const total = useMemo(() => buscarCampos(campos, texto).length, [campos, texto])
  const elegir = (v: string | null) => { alCambiar(v); setAbierto(false); setTexto('') }
  const teclas = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { e.preventDefault(); setAbierto(false); setTexto('') }
    if (e.key === 'Enter' && hallados[0]) { e.preventDefault(); elegir(hallados[0].valor) }
  }

  if (!abierto) {
    return (
      <div className="cxg-elegir" data-prueba="elegir-campo">
        {/* G01c (Julio, 07/11) · «Cambiar» siempre pegado al nombre del campo; el tipo, debajo. */}
        <span className="cxg-elegir-linea">
          {elegido ? <strong>{elegido.etiqueta}</strong> : <span className="cxg-mapa-falta">Ningún campo</span>}
          <button type="button" className="cx-enlace" aria-label={`Cambiar · ${etiqueta}`} disabled={deshabilitado}
            onClick={() => { setAbierto(true); setTimeout(() => caja.current?.focus(), 0) }}>{elegido ? 'Cambiar' : 'Elegir'}</button>
        </span>
        {elegido && <span className="cxg-elegir-tipo">{elegido.tipo}{elegido.propio ? '' : ' · de serie en Bitrix24'}</span>}
      </div>
    )
  }
  return (
    <div className="cxg-elegir-abierto" role="group" aria-label={etiqueta}>
      <input ref={caja} className="s-control" type="search" value={texto} onChange={(e) => setTexto(e.target.value)} onKeyDown={teclas}
        placeholder={`Busca entre los ${campos.length} campos por su nombre o su tipo`} aria-label={`Buscar · ${etiqueta}`} autoComplete="off" spellCheck={false} />
      <ul className="cxg-elegir-lista" aria-label={`Campos de Bitrix24 · ${etiqueta}`}>
        <li><button type="button" className="cxg-elegir-op" onClick={() => elegir(null)}><span>Ningún campo</span></button></li>
        {hallados.map((c) => (
          <li key={c.valor}>
            <button type="button" className="cxg-elegir-op" aria-current={c.valor === valor || undefined} onClick={() => elegir(c.valor)}>
              <span>{c.etiqueta}</span><span className="cxg-elegir-tipo">{c.tipo}{c.propio ? '' : ' · de serie'}</span>
            </button>
          </li>
        ))}
        {hallados.length === 0 && <li className="cxg-apoyo">Ningún campo con «{texto.trim()}».</li>}
        {total > hallados.length && <li className="cxg-apoyo">Y {total - hallados.length} más: escribe algo más para afinar.</li>}
      </ul>
      <div><button type="button" className="cx-enlace" onClick={() => { setAbierto(false); setTexto('') }}>Cancelar</button></div>
    </div>
  )
}
