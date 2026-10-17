// src/modules/reparto/components/ListaSinDireccion.tsx
//
// R03 · «Sin dirección completa» en Despacho (Julio, 16/10): los pedidos de
// reparto propio de hoy que llegaron sin dirección completa, juntos, para la
// oficina. Diseño para la oficina: una frase por pedido y un solo botón
// («Completar dirección»). No esconde filas (regla 7): los ya completados
// siguen, con quién y qué; si no hay ninguno, lo dice.
// Orden (Julio, 17/10): primero, en rojo y con el teléfono del cliente, los
// que necesitan a alguien (no han salido a Catcher, o falta decidir quién
// reparte); después, en gris, los que han salido con el punto del mapa.
//
// Sale de public.pedidos_sin_direccion (día de servicio con el corte de 4 h).
import { useCallback, useEffect, useState } from 'react'
import { Phone } from 'lucide-react'
import {
  enlaceTel, fraseDeLaLista, necesitaAAlguien, ordenarLaLista, puedeCompletar, quienEsElPedido, telefonoDelCliente,
  type PedidoSinDireccion,
} from '../lib/direccionFalta'
import { pedidosSinDireccion } from '../services/direccionFaltaService'
import CompletarDireccion from './CompletarDireccion'
import '@/modules/conta/estilo/tokens.css'
import '../reparto.css'

const POLL_MS = 20_000

export default function ListaSinDireccion({ locationId }: { locationId: string }) {
  const [pedidos, setPedidos] = useState<PedidoSinDireccion[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Los que se acaban de completar aquí: su confirmación (y «Llamar») se queda
  // a la vista aunque la lista ya los traiga completados (regla 8).
  const [recien, setRecien] = useState<Set<string>>(new Set())

  const cargar = useCallback(async () => {
    try {
      setPedidos(await pedidosSinDireccion(locationId, null))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se ha podido cargar la lista.')
    }
  }, [locationId])

  useEffect(() => {
    void cargar()
    const id = window.setInterval(() => void cargar(), POLL_MS)
    return () => window.clearInterval(id)
  }, [cargar])

  return (
    <section className="cx-colores mb-5 rounded-xl border border-default bg-card px-4 py-3" aria-label="Sin dirección completa"
      data-testid="lista-sin-direccion">
      <div className="flex items-center gap-2 font-extrabold text-[14px] text-text-primary">
        Sin dirección completa · hoy
        <span className="ml-auto bg-accent-bg text-text-secondary text-[12px] font-extrabold px-2 py-px rounded-full tabular-nums">
          {pedidos?.length ?? '…'}
        </span>
      </div>
      {error && <p className="mt-2 text-[12.5px] text-danger">{error}</p>}
      {pedidos && pedidos.length === 0 && !error && (
        <p className="mt-2 text-[12.5px] text-text-secondary">Hoy no ha llegado ningún pedido de reparto propio sin dirección completa.</p>
      )}
      {pedidos && pedidos.length > 0 && (
        <ul className="mt-2 divide-y divide-[var(--cx-borde)]">
          {ordenarLaLista(pedidos).map(p => {
            const rojo = necesitaAAlguien(p)
            const tel = rojo ? telefonoDelCliente(p.customer_phone, p.customer_phone_code) : null
            return (
              <li key={p.sale_id} data-testid="lista-sin-direccion-pedido" data-rojo={rojo ? 'si' : 'no'}
                className={`py-2 px-2 flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3 ${rojo ? 'cx-lsd-rojo' : 'cx-lsd-gris'}`}>
                {/* Recién completada aquí: la línea de «Completar dirección» ya dice quién (sin repetirla). */}
                <span className="cx-lsd-frase text-[13px] flex-1">{recien.has(p.sale_id) ? quienEsElPedido(p) : fraseDeLaLista(p)}</span>
                {tel && p.customer_phone && (
                  <a href={enlaceTel(p.customer_phone)} className="cx-lsd-tel" data-testid="lista-sin-direccion-llamar">
                    <Phone size={13} /> {tel} · Llamar
                  </a>
                )}
                {(puedeCompletar(p) || recien.has(p.sale_id)) && (
                  <CompletarDireccion saleId={p.sale_id}
                    onGuardada={() => { setRecien(prev => new Set(prev).add(p.sale_id)); void cargar() }} />
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
