// src/modules/conta/verifactu/MeHeEquivocado.tsx
//
// V03 · E3 · «Me he equivocado en…» (tablero 27), en una factura emitida que ya
// tiene registro en Hacienda. Tres caminos, y cada uno dice ANTES qué va a pasar
// (verifactu_previsto, la misma función que comprueba la base al hacerlo):
//   · La factura de mi cliente está mal → la rectificativa de la V01 (el
//     diálogo de «Corregir» de la ficha).
//   · No tenía que haberla emitido → anulada, su contrasiento del mismo día y
//     el registro de anulación; con el motivo y escribiendo ANULAR.
//   · Solo está mal lo que tiene Hacienda → subsanación (un registro nuevo que
//     sustituye al que tiene); se puede cambiar la descripción.
// Después, lo que ha pasado, con su contenido (regla 8).

import { useEffect, useState } from 'react'
import { Boton, Campo, Dialogo, Texto } from '@/modules/conta/diseno'
import { type AccionCorreccion, OPCIONES_CORRECCION, type Previsto } from '@/modules/conta/lib/verifactu/correccion'
import { anularFactura, previsto as leerPrevisto, subsanar } from '@/modules/conta/services/verifactuService'

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function MeHeEquivocado({ factura, quien, alRectificar, alHacer }: {
  factura: { id: string; numero: string | null }
  quien: string | null
  /** Abre la rectificativa (el diálogo «Corregir» de la ficha). Null si la factura no se rectifica desde aquí. */
  alRectificar: (() => void) | null
  /** Ya está hecho: el texto de lo que ha pasado, para que la ficha lo enseñe y vuelva a leer. */
  alHacer: (texto: string) => void
}) {
  const [accion, setAccion] = useState<AccionCorreccion | null>(null)
  return (
    <>
      <details className="cxvf-equivocado" data-prueba="me-he-equivocado">
        <summary>Me he equivocado en…</summary>
        <ul className="cxvf-opciones">
          {OPCIONES_CORRECCION.map((o) => (
            <li key={o.accion}>
              <Boton variante="secundario" data-prueba={`equivocado-${o.accion}`} onClick={() => setAccion(o.accion)}>{o.titulo}</Boton>
              <span className="s-tarjeta-apoyo">{o.cuando}</span>
            </li>
          ))}
        </ul>
      </details>
      {accion && (
        <DialogoEquivocado accion={accion} factura={factura} quien={quien} alCerrar={() => setAccion(null)}
          alRectificar={alRectificar} alHacer={(t) => { setAccion(null); alHacer(t) }} />
      )}
    </>
  )
}

function DialogoEquivocado({ accion, factura, quien, alCerrar, alRectificar, alHacer }: {
  accion: AccionCorreccion
  factura: { id: string; numero: string | null }
  quien: string | null
  alCerrar: () => void
  alRectificar: (() => void) | null
  alHacer: (texto: string) => void
}) {
  const [p, setP] = useState<Previsto | null>(null)
  const [fallo, setFallo] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [confirmacion, setConfirmacion] = useState('')
  const [descripcion, setDescripcion] = useState<string | null>(null)
  // Lo que va a pasar: al abrir, y en la subsanación cada vez que cambia la descripción (con pausa).
  useEffect(() => {
    let vale = true
    const t = setTimeout(() => {
      leerPrevisto(factura.id, accion, accion === 'subsanar' ? descripcion : null)
        .then((x) => { if (vale) { setP(x); setFallo(null) } })
        .catch((e) => { if (vale) setFallo(msg(e)) })
    }, descripcion === null ? 0 : 400)
    return () => { vale = false; clearTimeout(t) }
  }, [factura.id, accion, descripcion])

  const titulo = OPCIONES_CORRECCION.find((o) => o.accion === accion)?.titulo ?? ''
  const numero = factura.numero ?? 'la factura'
  const hacer = () => {
    setOcupado(true); setFallo(null)
    const paso = accion === 'anular'
      ? anularFactura(factura.id, motivo, confirmacion.trim().toUpperCase(), quien).then((r) =>
        `Anulada la ${r.numero}: su asiento nº ${r.numero_anulado ?? '?'} queda deshecho con el nº ${r.numero_contraasiento ?? '?'} (mismo día), ya no cuenta en tus ventas ni en el IVA, y Hacienda recibe su registro de anulación en el próximo envío${r.sin_registro_previo ? ' («sin registro previo»: Hacienda no la tenía)' : ''}.`)
      : subsanar(factura.id, descripcion, quien).then((r) =>
        `Subsanada la ${r.numero} en Hacienda: sale un registro nuevo en el próximo envío${r.cambios.length ? `, que cambia ${r.cambios.map((c) => c.que.toLowerCase()).join(', ')}` : ', igual que el anterior'}${r.rechazo_previo === 'S' ? ' y dice que la otra vez se rechazó' : ''}. La factura de tu cliente no cambia.`)
    void paso.then(alHacer).catch((e) => setFallo(msg(e))).finally(() => setOcupado(false))
  }
  const listo = !!p?.puede && !ocupado && (accion !== 'anular' || (motivo.trim().length > 0 && confirmacion.trim().toUpperCase() === 'ANULAR'))

  const acciones = (
    <>
      <Boton variante="secundario" onClick={alCerrar}>{p && !p.puede ? 'Cerrar' : 'Cancelar'}</Boton>
      {p?.puede && accion === 'rectificar' && alRectificar && (
        <Boton variante="principal" data-prueba="equivocado-hacer" onClick={() => { alCerrar(); alRectificar() }}>Hacer la rectificativa</Boton>
      )}
      {p?.puede && accion !== 'rectificar' && (
        <Boton variante="principal" data-prueba="equivocado-hacer" disabled={!listo} onClick={hacer}>
          {ocupado ? (accion === 'anular' ? 'Anulando…' : 'Subsanando…') : accion === 'anular' ? `Anular la ${numero}` : 'Mandar el registro nuevo'}
        </Boton>
      )}
    </>
  )

  return (
    <Dialogo titulo={titulo} alCerrar={alCerrar} acciones={acciones}>
      <div data-prueba="previsto" data-puede={p ? String(p.puede) : undefined}>
        {!p && !fallo && <p className="s-apoyo">Mirando qué va a pasar…</p>}
        {p && (
          <>
            <p className="cxvf-previsto-frase" data-tono={p.puede ? undefined : 'falta'}><strong>{p.puede ? 'Lo que va a pasar: ' : 'No se puede: '}</strong>{p.frase}</p>
            {p.aviso && <p className="s-tarjeta-apoyo">{p.aviso}</p>}
            {p.cambios.length > 0 && (
              <ul className="cxvf-cambios" data-prueba="previsto-cambios">
                {p.cambios.map((c) => <li key={c.campo}>{c.que}{c.antes !== null || c.despues !== null ? `: «${c.antes ?? '—'}» → «${c.despues ?? '—'}»` : ' cambia'}</li>)}
              </ul>
            )}
          </>
        )}
        {accion === 'subsanar' && p && (p.puede || descripcion !== null || p.frase.startsWith('No hay nada que subsanar')) && (
          <Campo etiqueta="Descripción de la operación (opcional)" ayuda="Lo que dice el registro de qué vendiste. Déjala vacía para mandar el registro como está.">
            {(c) => <Texto {...c} valor={descripcion ?? ''} alCambiar={(v) => setDescripcion(v === '' ? null : v)} maxLength={500} placeholder="La que tiene ahora" />}
          </Campo>
        )}
        {accion === 'anular' && p?.puede && (
          <>
            <Campo etiqueta="Por qué no tenía que emitirse" ayuda="Queda en el historial de la factura y en el contrasiento.">
              {(c) => <Texto {...c} valor={motivo} alCambiar={setMotivo} maxLength={300} placeholder="La hice dos veces" />}
            </Campo>
            <Campo etiqueta="Escribe ANULAR" ayuda="No se puede deshacer: su número no se vuelve a usar.">
              {(c) => <Texto {...c} valor={confirmacion} alCambiar={setConfirmacion} autoComplete="off" />}
            </Campo>
          </>
        )}
        {accion === 'rectificar' && p?.puede && !alRectificar && <p className="s-apoyo">Esta factura se rectifica desde su ficha, con «Corregir».</p>}
        {fallo && <p className="s-aviso-lista" data-tono="falta" role="alert">{fallo}</p>}
      </div>
    </Dialogo>
  )
}
