// src/modules/kitchen/pages/KitchenPlatoPreguntasPage.tsx
//
// DESDE EL PLATO. Encargo de Julio, 13/09 20:05 §1.
//
// «La lista de sus preguntas, con lo que pregunta cada una, y quitar una desde
// ahí con su número actualizándose. Nada de abrir otra pantalla para quitarla.»
//
// Así que quitar pasa AQUÍ, con lo que va a pasar escrito antes de pulsar y el
// número nuevo llegando de la base — no restando 1 en el navegador, que es
// como una pantalla acaba diciendo algo distinto de lo que hay guardado.

import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import EstadoDeLaConsulta from '@/modules/kitchen/components/EstadoDeLaConsulta'
import {
  CabeceraCocina, PanelCocina, RotuloDePanel, BotonCocina,
  PastillaCocina, AvisoCocina,
} from '@/modules/kitchen/components/PatronDeKitchen'
import {
  getLoQuePreguntaElPlato, quitarPreguntaDelPlato,
} from '@/modules/kitchen/services/gestorDeLaCartaService'
import type { LoQuePreguntaElPlato, PreguntaDelPlato } from '@/modules/kitchen/lib/desdeElPlato'
import {
  tituloDelPlato, laReglaDelPlato, deQuienEsLaCarta, respuestasEnTexto,
  dondeMasEsta, loQueHayQueMirar, textoDeQuitar, loQuePasaSiQuitas,
  laConfirmacionDeQuitar, elVacioDelPlato,
} from '@/modules/kitchen/lib/desdeElPlato'
import { quePuedeHacerElCliente, queHaceEnElPlato } from '@/modules/kitchen/lib/preguntasDeCocina'
import { fmtMoney } from '@/lib/format'

const TONO = { rojo: 'rojo', ambar: 'ambar', apagado: 'apagado' } as const

function Fila({
  p, plato, onQuitar, quitando,
}: {
  p: PreguntaDelPlato
  plato: LoQuePreguntaElPlato['plato']
  onQuitar: (p: PreguntaDelPlato) => void
  quitando: string | null
}) {
  const [vaAQuitar, setVaAQuitar] = useState(false)
  const avisos = loQueHayQueMirar(p)
  return (
    <div className="px-4 py-3 border-t border-cocina-linea first:border-t-0">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[14px] font-semibold text-cocina-tinta truncate">{p.nombre}</div>
          <div className="text-[12px] text-cocina-tinta-2 mt-0.5">
            {queHaceEnElPlato(p)} · {quePuedeHacerElCliente(p)}
          </div>
          <div className="text-[12px] text-cocina-tinta-3 mt-0.5">
            {respuestasEnTexto(p)} · {dondeMasEsta(p)}
          </div>
          {avisos.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {avisos.map((a) => (
                <PastillaCocina key={a.texto} tono={TONO[a.tono]}>{a.texto}</PastillaCocina>
              ))}
            </div>
          )}
        </div>
        <div className="shrink-0 flex flex-col items-end gap-1.5">
          <BotonCocina
            peso={vaAQuitar ? 'aviso' : 'borde'}
            disabled={!p.sePuedeQuitar || quitando === p.id}
            onClick={() => (vaAQuitar ? onQuitar(p) : setVaAQuitar(true))}
          >
            {quitando === p.id ? 'Quitando…' : vaAQuitar ? 'Sí, quitarla' : textoDeQuitar(p)}
          </BotonCocina>
          {vaAQuitar && p.sePuedeQuitar && (
            <button
              type="button"
              onClick={() => setVaAQuitar(false)}
              className="text-[11.5px] text-cocina-tinta-3 hover:text-cocina-tinta-2"
            >
              Mejor no
            </button>
          )}
        </div>
      </div>
      {/* Un botón apagado SIEMPRE lleva su frase al lado, y lo que va a pasar
          se lee ANTES de pulsar, no después. */}
      {(vaAQuitar || !p.sePuedeQuitar) && (
        <div className="mt-2 text-[12px] text-cocina-tinta-2 bg-cocina-superficie-2 rounded-cocina px-3 py-2">
          {loQuePasaSiQuitas(p, plato)}
        </div>
      )}
    </div>
  )
}

export default function KitchenPlatoPreguntasPage() {
  const { platoId } = useParams<{ platoId: string }>()
  const { activeAccountId } = useActiveAccount()
  const navigate = useNavigate()
  const [d, setD] = useState<LoQuePreguntaElPlato | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [quitando, setQuitando] = useState<string | null>(null)
  const [confirmacion, setConfirmacion] = useState<string | null>(null)
  const [refresco, setRefresco] = useState(0)

  useEffect(() => {
    let vivo = true
    void (async () => {
      if (!activeAccountId || !platoId) return
      setCargando(true); setError(null)
      try {
        const r = await getLoQuePreguntaElPlato(activeAccountId, platoId)
        if (vivo) setD(r)
      } catch (e) {
        if (vivo) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (vivo) setCargando(false)
      }
    })()
    return () => { vivo = false }
  }, [activeAccountId, platoId, refresco])

  async function quitar(p: PreguntaDelPlato) {
    if (!activeAccountId || !platoId) return
    setQuitando(p.id)
    try {
      const r = await quitarPreguntaDelPlato({
        accountId: activeAccountId, groupId: p.id, menuItemId: platoId, actor: 'Oficina',
      })
      // El número lo dice la BASE, no una resta en el navegador.
      setConfirmacion(laConfirmacionDeQuitar(r))
      setRefresco((x) => x + 1)
    } catch (e) {
      setConfirmacion(e instanceof Error ? e.message : String(e))
    } finally {
      setQuitando(null)
    }
  }

  return (
    <div className="cocina">
      <CabeceraCocina
        migaja="Preguntas de la carta"
        pregunta={d ? tituloDelPlato(d.plato) : 'Qué pregunta este plato'}
        regla={d ? `${laReglaDelPlato(d)} ${deQuienEsLaCarta(d.plato)}.` : ''}
      >
        {d && (
          <div className="text-[12.5px] text-cocina-tinta-3">{fmtMoney(d.plato.precio)}</div>
        )}
      </CabeceraCocina>

      {confirmacion && (
        <div className="mt-3">
          <AvisoCocina onCerrar={() => setConfirmacion(null)}>{confirmacion}</AvisoCocina>
        </div>
      )}

      <div className="mt-4">
        <EstadoDeLaConsulta
          cargando={cargando}
          textoCargando="Mirando qué pregunta este plato…"
          error={error}
          queSePregunto="las preguntas de este plato"
          hayFilas={(d?.preguntas.length ?? 0) > 0}
          matiz={d ? elVacioDelPlato(d.plato) : undefined}
        />
      </div>

      {d && d.preguntas.length > 0 && (
        <div className="mt-4">
          <PanelCocina>
            <RotuloDePanel derecha={<>{d.cuantas} en total</>}>
              En el orden en que las ve el cliente
            </RotuloDePanel>
            {d.preguntas.map((p) => (
              <Fila key={p.id} p={p} plato={d.plato} onQuitar={quitar} quitando={quitando} />
            ))}
          </PanelCocina>
          <div className="mt-3">
            <BotonCocina peso="fantasma" onClick={() => navigate('/kitchen/modificadores')}>
              Ver todas las preguntas de la carta
            </BotonCocina>
          </div>
        </div>
      )}
    </div>
  )
}
