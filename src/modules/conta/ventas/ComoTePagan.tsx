// src/modules/conta/ventas/ComoTePagan.tsx
//
// PC01 · Entrega 4 · «Cómo te pagan» (Respuesta 10 al PC01): la tarjeta del
// cobro con tarjeta y Bizum, en Ajustes › Cobros y en Ventas › Cobros.
//   · Tarjeta y Bizum, con su logo y su estado en palabras: «Activo», «Falta tu
//     alta en Stripe» o «Stripe está revisando».
//   · UN solo botón, que lleva al formulario de alta de Stripe (nunca uno
//     nuestro con sus datos). Con los dos activos, no sale.
//   · Al volver de Stripe (?stripe=vuelta), mira el estado otra vez y lo dice.
// Nada de palabras de técnico: ni «capacidad», ni «v2», ni «Connect». Cada
// pulsación dice lo que ha pasado (regla 8).
//
// S01 · PR 1 · Debajo, el TPV del banco (Redsys, RedsysTpv): el segundo
// proveedor, con el mismo patrón. En Ajustes › Cobros se ponen sus datos
// (editar); en Ventas › Cobros, solo su estado y el camino a Ajustes.
// Al guardar el TPV se vuelve a leer, y mientras tanto se queda a la vista lo
// último leído de esa empresa (useLeerConservando): si se quitara, el TPV se
// montaría otra vez sin el «Guardado. Redsys en pruebas…» y el botón callaría
// (regla 8; S01, Respuesta 3, la e2e #997).

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Boton, Chip, Tarjeta } from '@/modules/conta/diseno'
import { useLeer } from '@/modules/conta/libros/contexto'
import { useLeerConservando } from '@/modules/conta/bancos/useLeerConservando'
import { avisoBizum, botonAltaStripe, textoMetodoPago, type EstadoMetodoPago } from '@/modules/conta/lib/cobros'
import { cobroStripe, leerCobroRedsys, leerCobroStripe } from '@/modules/conta/services/cobrosService'
import { RedsysTpv } from './RedsysTpv'

const tono = (e: EstadoMetodoPago | null) => (e === 'activo' ? 'seguro' : e === 'revisando' ? 'duda' : 'falta')

function LogoTarjeta() {
  return (
    <svg className="pg-logo-pago" width="40" height="28" viewBox="0 0 40 28" role="img" aria-label="Tarjeta">
      <rect x="1" y="1" width="38" height="26" rx="4" fill="#fff" stroke="currentColor" strokeWidth="1.5" />
      <rect x="1" y="7" width="38" height="5" fill="currentColor" />
      <rect x="6" y="17" width="12" height="3" rx="1" fill="currentColor" opacity=".5" />
    </svg>
  )
}

function LogoBizum() {
  return (
    <svg className="pg-logo-pago" width="40" height="28" viewBox="0 0 40 28" role="img" aria-label="Bizum">
      <rect x="0" y="0" width="40" height="28" rx="6" fill="#05C3DD" />
      <text x="20" y="18.5" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontSize="10.5" fontWeight="700" fill="#fff">bizum</text>
    </svg>
  )
}

export function ComoTePagan({ empresaId, nivel = 2, editar = false }: { empresaId: string; nivel?: 2 | 3; editar?: boolean }) {
  const [vuelta, setVuelta] = useState(0)
  // Envuelto: «sin alta» (null) no es lo mismo que «aún leyendo».
  const datos = useLeer(() => leerCobroStripe(empresaId).then((c) => ({ c })), `${empresaId}:${vuelta}:cobro-stripe`)
  const tpv = useLeerConservando(() => leerCobroRedsys(empresaId).then((c) => ({ c })), empresaId, `${vuelta}:cobro-redsys`)
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [query, setQuery] = useSearchParams()
  const mirado = useRef(false)

  // Al volver del alta de Stripe: mirar el estado y decirlo.
  const deStripe = query.get('stripe')
  useEffect(() => {
    if (!deStripe || mirado.current) return
    mirado.current = true
    void cobroStripe(empresaId, 'estado').then((r) => {
      setAviso({ ok: r.ok, texto: deStripe === 'otra' ? `El enlace de Stripe había caducado: vuelve a pulsar el botón. ${r.texto}` : r.texto })
      setVuelta((v) => v + 1)
      setQuery((q) => { const n = new URLSearchParams(q); n.delete('stripe'); return n }, { replace: true })
    })
  }, [deStripe, empresaId, setQuery])

  const leido = datos.datos !== null
  const c = datos.datos?.c ?? null
  const boton = leido ? botonAltaStripe(c) : null
  const ir = async () => {
    setOcupado(true); setAviso(null)
    const r = await cobroStripe(empresaId, 'alta')
    if (r.ok && r.url) { setAviso({ ok: true, texto: r.texto }); window.location.assign(r.url); return }
    setAviso({ ok: false, texto: r.texto }); setOcupado(false)
  }

  const fila = (logo: ReactNode, nombre: string, e: EstadoMetodoPago | null) => (
    <li className="pg-metodo-pago">
      {logo}
      <span className="pg-metodo-nombre">{nombre}</span>
      <Chip tono={tono(e)}>{textoMetodoPago(e)}</Chip>
    </li>
  )

  return (
    <Tarjeta nivel={nivel} titulo="Cómo te pagan"
      apoyo="Tus clientes te pagan las facturas con tarjeta o con Bizum desde el enlace del recordatorio, por Stripe o por el TPV de tu banco. La factura queda cobrada sola, y cuando llega el dinero al banco se casa en Bancos con su comisión."
      accion={boton ? <Boton variante="principal" onClick={() => void ir()} disabled={ocupado}>{ocupado ? 'Abriendo Stripe…' : boton}</Boton> : undefined}>
      <div className="pg-dialogo-campos" data-prueba="como-te-pagan">
        {datos.error && <p className="s-aviso-lista" data-tono="falta" role="alert">No se ha podido leer cómo te pagan: {datos.error}</p>}
        {!datos.error && !leido && <div className="s-lista" aria-busy="true" aria-label="Cargando cómo te pagan"><div className="s-lista-cargando" /></div>}
        {leido && (
          <ul className="pg-metodos-pago" aria-label="Métodos de pago">
            {fila(<LogoTarjeta />, 'Tarjeta', c?.tarjeta ?? null)}
            {fila(<LogoBizum />, 'Bizum', c?.bizum ?? null)}
          </ul>
        )}
        {leido && avisoBizum(c) && <p className="pg-dialogo-nota" data-prueba="aviso-bizum"><strong>{avisoBizum(c)}</strong></p>}
        {leido && !c && <p className="pg-dialogo-nota">Aún no te has dado de alta en Stripe. Tus datos y los de tu empresa los pide Stripe en su propia página; Sumied no los ve.</p>}
        {c && c.tarjeta !== 'activo' && c.pendiente > 0 && <p className="pg-dialogo-nota">A tu alta en Stripe le faltan {c.pendiente} {c.pendiente === 1 ? 'dato' : 'datos'}.</p>}
        {c?.modo === 'prueba' && <p className="pg-dialogo-nota">Aún en pruebas: no se cobra de verdad hasta que lo abramos para tu empresa.</p>}
        {aviso && <p className="s-aviso-lista" data-tono={aviso.ok ? 'seguro' : 'falta'} role={aviso.ok ? 'status' : 'alert'}>{aviso.texto}</p>}
        {tpv.error && <p className="s-aviso-lista" data-tono="falta" role="alert">No se ha podido leer tu TPV: {tpv.error}</p>}
        {tpv.datos && <RedsysTpv empresaId={empresaId} c={tpv.datos.c} conStripe={c?.tarjeta === 'activo'} editar={editar} alGuardar={() => setVuelta((x) => x + 1)} />}
      </div>
    </Tarjeta>
  )
}
