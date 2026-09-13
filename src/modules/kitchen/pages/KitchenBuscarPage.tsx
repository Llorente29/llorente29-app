// src/modules/kitchen/pages/KitchenBuscarPage.tsx
//
// UNA SOLA CAJA. Encargo de Julio, 13/09 20:05 §2.
//
// «Escribo harissa y salen la pregunta, las respuestas y los platos.»
//
// Y cada fila dice POR QUÉ ha salido, porque si no, escribes «harissa» y te
// aparece un plato que no la menciona en ninguna parte y no sabes si es un
// acierto o un fallo de la búsqueda.
//
// Los títulos llevan el total DE VERDAD; la lista va cortada y lo dice. Un
// umbral ordena, no esconde (regla 7).

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import {
  CabeceraCocina, PanelCocina, RotuloDePanel, PastillaCocina,
} from '@/modules/kitchen/components/PatronDeKitchen'
import { buscar } from '@/modules/kitchen/services/gestorDeLaCartaService'
import type { LoEncontrado } from '@/modules/kitchen/lib/laBusqueda'
import {
  LA_CAJA, elAntesDeBuscar, laReglaDeLaBusqueda, porQueHaSalido,
  tituloDePreguntas, tituloDeRespuestas, tituloDePlatos,
  lasCopiasDeUnaRespuesta, loApagadoDeUnaRespuesta, loQueNoCabe,
} from '@/modules/kitchen/lib/laBusqueda'

const TOPE = 12

function Grupo({
  titulo, mostrados, total, children,
}: {
  titulo: string; mostrados: number; total: number; children: React.ReactNode
}) {
  const falta = loQueNoCabe(mostrados, total)
  return (
    <div className="mt-4">
      <PanelCocina>
        <RotuloDePanel>{titulo}</RotuloDePanel>
        {children}
        {falta && (
          <div className="px-4 py-2.5 border-t border-cocina-linea text-[12px] text-cocina-tinta-3">
            {falta}
          </div>
        )}
      </PanelCocina>
    </div>
  )
}

function Fila({
  nombre, debajo, motivo, apagado, onAbrir,
}: {
  nombre: string; debajo: string; motivo: string
  apagado?: string | null; onAbrir: () => void
}) {
  return (
    <button
      type="button"
      onClick={onAbrir}
      className="w-full text-left px-4 py-2.5 border-t border-cocina-linea first:border-t-0 hover:bg-cocina-superficie-2 transition-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cocina-acento focus-visible:ring-inset"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[13.5px] font-semibold text-cocina-tinta truncate">{nombre}</div>
          <div className="text-[12px] text-cocina-tinta-3 mt-0.5">{debajo}</div>
        </div>
        <div className="shrink-0 flex items-center gap-1.5">
          {apagado && <PastillaCocina tono="apagado">{apagado}</PastillaCocina>}
          <span className="text-[11.5px] text-cocina-acento font-semibold">{motivo}</span>
        </div>
      </div>
    </button>
  )
}

export default function KitchenBuscarPage() {
  const { activeAccountId } = useActiveAccount()
  const navigate = useNavigate()
  const [texto, setTexto] = useState('')
  const [r, setR] = useState<LoEncontrado | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [buscando, setBuscando] = useState(false)

  // Se busca al dejar de escribir, no en cada tecla: con 244 opciones y 591
  // platos detrás, una consulta por pulsación es ruido para la base y parpadeo
  // para quien mira.
  useEffect(() => {
    let vivo = true
    const t = setTimeout(() => {
      void (async () => {
        if (!activeAccountId) return
        if (texto.trim().length < 2) { if (vivo) { setR(null); setError(null) } ; return }
        setBuscando(true); setError(null)
        try {
          const d = await buscar(activeAccountId, texto, TOPE)
          if (vivo) setR(d)
        } catch (e) {
          if (vivo) setError(e instanceof Error ? e.message : String(e))
        } finally {
          if (vivo) setBuscando(false)
        }
      })()
    }, 250)
    return () => { vivo = false; clearTimeout(t) }
  }, [activeAccountId, texto])

  const q = r?.texto ?? texto.trim()
  const nada = r && !r.corto
    && r.cuantas.preguntas === 0 && r.cuantas.respuestasDistintas === 0 && r.cuantas.platos === 0

  return (
    <div className="cocina">
      <CabeceraCocina
        migaja="Preguntas de la carta"
        pregunta="Buscar"
        regla={r ? laReglaDeLaBusqueda(r) : elAntesDeBuscar()}
      />

      <div className="mt-4 relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-cocina-tinta-3" />
        <input
          type="search"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder={LA_CAJA}
          aria-label={LA_CAJA}
          className="w-full h-[42px] pl-9 pr-3 rounded-cocina border border-cocina-linea bg-cocina-superficie text-[14px] text-cocina-tinta placeholder:text-cocina-tinta-3 focus:outline-none focus:ring-2 focus:ring-cocina-acento"
        />
      </div>

      {error && <div className="mt-3 text-[13px] text-cocina-rojo">{error}</div>}
      {buscando && <div className="mt-3 text-[12.5px] text-cocina-tinta-3">Buscando…</div>}

      {r && r.fichas.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {r.fichas.map((f) => (
            <PastillaCocina key={f.id} tono="verde">{f.nombre}</PastillaCocina>
          ))}
        </div>
      )}

      {nada && (
        <div className="mt-4 text-[13px] text-cocina-tinta-2">
          {laReglaDeLaBusqueda(r)}
        </div>
      )}

      {r && !r.corto && r.respuestas.length > 0 && (
        <Grupo titulo={tituloDeRespuestas(r)} mostrados={r.respuestas.length} total={r.cuantas.respuestasDistintas}>
          {r.respuestas.map((x) => (
            <Fila
              key={x.id}
              nombre={x.nombre}
              debajo={`${lasCopiasDeUnaRespuesta(x)}${x.ficha ? ` · lleva ${x.ficha}` : ''}`}
              motivo={porQueHaSalido(x.porque, q)}
              apagado={loApagadoDeUnaRespuesta(x)}
              onAbrir={() => navigate(`/kitchen/respuestas/${x.id}`)}
            />
          ))}
        </Grupo>
      )}

      {r && !r.corto && r.preguntas.length > 0 && (
        <Grupo titulo={tituloDePreguntas(r)} mostrados={r.preguntas.length} total={r.cuantas.preguntas}>
          {r.preguntas.map((x) => (
            <Fila
              key={x.id}
              nombre={x.nombre}
              debajo={`${x.marca}${x.cedida ? ' · cedida' : ''} · ${x.respuestas} respuestas`}
              motivo={porQueHaSalido(x.porque, q)}
              apagado={x.activa ? null : 'Apagada'}
              onAbrir={() => navigate(`/kitchen/preguntas/${x.id}`)}
            />
          ))}
        </Grupo>
      )}

      {r && !r.corto && r.platos.length > 0 && (
        <Grupo titulo={tituloDePlatos(r)} mostrados={r.platos.length} total={r.cuantas.platos}>
          {r.platos.map((x) => (
            <Fila
              key={x.id}
              nombre={x.nombre}
              debajo={`${x.marca}${x.cedida ? ' · cedida' : ''}`}
              motivo={porQueHaSalido(x.porque, q)}
              onAbrir={() => navigate(`/kitchen/platos/${x.id}`)}
            />
          ))}
        </Grupo>
      )}
    </div>
  )
}
