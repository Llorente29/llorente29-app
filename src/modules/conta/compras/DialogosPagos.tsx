// src/modules/conta/compras/DialogosPagos.tsx
//
// PC01 · Entrega 2 · Los diálogos de Compras › Pagos:
//   · «Ya la he pagado»: el pago a mano de una factura suelta (fecha, banco e
//     importe, que puede ser parcial). Queda esperando el cargo para casarse
//     en Bancos y tener su asiento (PC01 · E1: sin asiento no está pagada).
//   · «Ponerles vencimiento»: el plazo de pago de cada proveedor; a los que no
//     lo tienen en su ficha se les pregunta, y se guarda allí.
//   · «El banco lo ha rechazado»: el motivo; la factura vuelve a «Por pagar».
// Cada uno dice lo que ha pasado con la frase que escribe la base (regla 8), o
// el fallo, dentro del diálogo.

import { useState } from 'react'
import { Boton, Campo, Dialogo, Fecha, Importe, Selector, Texto } from '@/modules/conta/diseno'
import { importeDeTexto, textoDeImporte } from '@/modules/conta/diseno/valores'
import { diaMesCorto, eurosExactos } from '@/modules/conta/lib/formato'
import { libre, type FilaPago } from '@/modules/conta/lib/pagos'
import type { BancoFolvy } from '@/modules/conta/services/bancosService'
import { pagoAMano, pagoRechazado, ponerVencimiento } from '@/modules/conta/services/pagosService'

const ultimos4 = (iban: string | null) => (iban ? ` ···${iban.replace(/\s/g, '').slice(-4)}` : '')

export function DialogoYaLaHePagado({ empresaId, hoy, bancos, facturas, elegida, alCerrar }: {
  empresaId: string
  hoy: string
  bancos: readonly BancoFolvy[]
  facturas: readonly FilaPago[]
  elegida: string | null
  alCerrar: (frase: string | null) => void
}) {
  const [facturaId, setFacturaId] = useState(elegida ?? facturas[0]?.id ?? '')
  const f = facturas.find((x) => x.id === facturaId) ?? null
  // Sin elegir, el primero: también si los bancos llegan después de abrir el diálogo (e2e 945).
  const [bancoElegido, setBancoId] = useState('')
  const bancoId = bancoElegido || (bancos[0]?.id ?? '')
  const [fecha, setFecha] = useState(hoy)
  const [importe, setImporte] = useState(f ? textoDeImporte(libre(f)) : '')
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const n = importeDeTexto(importe)

  const guardar = async () => {
    if (!f || !bancoId || n === null || n <= 0) { setError('Elige la factura, el banco y un importe mayor que cero.'); return }
    setOcupado(true); setError(null)
    try { alCerrar((await pagoAMano(empresaId, f.id, bancoId, fecha, n)).frase) } catch (e) { setError((e as Error).message) } finally { setOcupado(false) }
  }

  return (
    <Dialogo titulo="Ya la he pagado" alCerrar={() => alCerrar(null)}
      explicacion="Apunta un pago que ya has hecho en tu banco. Queda esperando el cargo: cuando lo cases en Bancos, el pago tiene su asiento y la factura queda pagada."
      acciones={<>
        <Boton onClick={() => alCerrar(null)}>Cancelar</Boton>
        <Boton variante="principal" onClick={() => void guardar()} disabled={ocupado || !f}>{ocupado ? 'Apuntando…' : 'Apuntar el pago'}</Boton>
      </>}>
      {facturas.length === 0 && <p className="cx-ayuda">No hay ninguna factura por pagar que no esté ya en una remesa.</p>}
      {facturas.length > 0 && (
        <div className="pg-dialogo-campos">
          <Campo etiqueta="Factura">{(c) => (
            <Selector {...c} valor={facturaId} alCambiar={(id) => { setFacturaId(id); const x = facturas.find((y) => y.id === id); if (x) setImporte(textoDeImporte(libre(x))) }}
              opciones={facturas.map((x) => ({ valor: x.id, texto: `${x.proveedor} · ${x.numero ?? 'sin número'} · ${eurosExactos(libre(x))}` }))} />
          )}</Campo>
          <Campo etiqueta="Desde qué banco">{(c) => (
            <Selector {...c} valor={bancoId} alCambiar={setBancoId} opciones={bancos.map((b) => ({ valor: b.id, texto: `${b.alias ?? b.nombre}${ultimos4(b.iban)}` }))} />
          )}</Campo>
          <Campo etiqueta="El día que la pagaste">{(c) => <Fecha {...c} valor={fecha} alCambiar={setFecha} max={hoy} />}</Campo>
          <Campo etiqueta="Importe" ayuda={f ? `Le quedan ${eurosExactos(libre(f))}; puedes apuntar una parte.` : undefined}>{(c) => <Importe {...c} valor={importe} alCambiar={setImporte} />}</Campo>
        </div>
      )}
      {error && <p className="s-aviso-lista" data-tono="falta" role="alert">{error}</p>}
    </Dialogo>
  )
}

export function DialogoPonerVencimiento({ empresaId, sinPlazo, sinVencimiento, alCerrar }: {
  empresaId: string
  sinPlazo: readonly { id: string; nombre: string }[]
  sinVencimiento: number
  alCerrar: (frase: string | null) => void
}) {
  const [dias, setDias] = useState<Record<string, string>>(() => Object.fromEntries(sinPlazo.map((p) => [p.id, '30'])))
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const guardar = async () => {
    const plazos = sinPlazo.map((p) => ({ proveedor: p.id, dias: Number(dias[p.id]) }))
    if (plazos.some((p) => !Number.isInteger(p.dias) || p.dias < 0 || p.dias > 365)) { setError('El plazo es un número de días, de 0 a 365.'); return }
    setOcupado(true); setError(null)
    try { alCerrar((await ponerVencimiento(empresaId, plazos)).frase) } catch (e) { setError((e as Error).message) } finally { setOcupado(false) }
  }
  return (
    <Dialogo titulo="Ponerles vencimiento" alCerrar={() => alCerrar(null)}
      explicacion={<>A {sinVencimiento === 1 ? 'la factura sin vencimiento' : `las ${sinVencimiento} facturas sin vencimiento`} les pongo el día de la factura más el plazo de pago de su proveedor.
        {sinPlazo.length > 0 ? ' Estos proveedores no tienen plazo en su ficha: dime cuántos días, y lo guardo allí.' : ' Todos sus proveedores tienen plazo en su ficha.'}</>}
      acciones={<>
        <Boton onClick={() => alCerrar(null)}>Cancelar</Boton>
        <Boton variante="principal" onClick={() => void guardar()} disabled={ocupado}>{ocupado ? 'Poniendo…' : 'Ponerles vencimiento'}</Boton>
      </>}>
      {sinPlazo.length > 0 && (
        <div className="pg-dialogo-campos">
          {sinPlazo.map((p) => (
            <Campo key={p.id} etiqueta={`${p.nombre} · días de plazo`}>{(c) => <Texto {...c} inputMode="numeric" valor={dias[p.id] ?? ''} alCambiar={(v) => setDias((d) => ({ ...d, [p.id]: v.replace(/\D/g, '') }))} />}</Campo>
          ))}
        </div>
      )}
      {error && <p className="s-aviso-lista" data-tono="falta" role="alert">{error}</p>}
    </Dialogo>
  )
}

export function DialogoRechazado({ linea, alCerrar }: { linea: { id: string; proveedor: string; numero: string | null; importe: number; vence: string | null }; alCerrar: (frase: string | null) => void }) {
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const guardar = async () => {
    if (!motivo.trim()) { setError('Escribe el motivo que da el banco.'); return }
    setOcupado(true); setError(null)
    try { alCerrar((await pagoRechazado(linea.id, motivo.trim())).frase) } catch (e) { setError((e as Error).message) } finally { setOcupado(false) }
  }
  return (
    <Dialogo titulo="El banco lo ha rechazado" alCerrar={() => alCerrar(null)}
      explicacion={<>El pago de {eurosExactos(linea.importe)} a {linea.proveedor} (factura {linea.numero ?? 'sin número'}{linea.vence ? `, vence ${diaMesCorto(linea.vence)}` : ''}) vuelve a «Por pagar» con el motivo. Los demás pagos de la remesa siguen su curso.</>}
      acciones={<>
        <Boton onClick={() => alCerrar(null)}>Cancelar</Boton>
        <Boton variante="principal" onClick={() => void guardar()} disabled={ocupado}>{ocupado ? 'Apuntando…' : 'Apuntar el rechazo'}</Boton>
      </>}>
      <Campo etiqueta="El motivo que da el banco">{(c) => <Texto {...c} valor={motivo} alCambiar={setMotivo} placeholder="Cuenta cancelada, IBAN erróneo…" />}</Campo>
      {error && <p className="s-aviso-lista" data-tono="falta" role="alert">{error}</p>}
    </Dialogo>
  )
}
