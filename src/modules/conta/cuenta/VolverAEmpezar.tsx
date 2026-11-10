// src/modules/conta/cuenta/VolverAEmpezar.tsx
//
// GD · Ajustes › Tu cuenta, en una cuenta de demostración: «Volver a empezar»
// (Julio, nº51). Solo el administrador. Pide confirmación diciendo qué va a
// pasar, va paso a paso diciendo por cuál va, y acaba con «Hecho: la demo está
// como el primer día» y lo que ha hecho cada paso. Si un paso falla, lo dice y
// deja seguir desde ese paso (regla 8: confirma o falla en pantalla).

import { useState } from 'react'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { PASOS, TANDAS_MAX, pasoDeVolverAEmpezar } from '@/modules/conta/cuenta/volverAEmpezar'

type Estado =
  | { fase: 'quieto' }
  | { fase: 'confirmar' }
  | { fase: 'yendo'; paso: number; hechos: string[] }
  | { fase: 'hecho'; hechos: string[] }
  | { fase: 'fallo'; paso: number; hechos: string[]; texto: string }

export function VolverAEmpezar() {
  const { accountId, esAdmin } = useCuentaConta()
  const [e, setE] = useState<Estado>({ fase: 'quieto' })

  async function ir(desde: number, hechos: string[]) {
    if (!accountId) return
    const ya = [...hechos]
    for (let i = desde; i < PASOS.length; i++) {
      setE({ fase: 'yendo', paso: i, hechos: ya })
      // Los pasos del portal van por tandas: mientras digan «sigue», se vuelven a llamar.
      for (let tanda = 1; ; tanda++) {
        const r = await pasoDeVolverAEmpezar(accountId, PASOS[i].id)
        if (!r.ok) { setE({ fase: 'fallo', paso: i, hechos: ya, texto: r.texto }); return }
        if (!r.sigue) { ya.push(r.frase); break }
        if (tanda >= TANDAS_MAX) { setE({ fase: 'fallo', paso: i, hechos: ya, texto: `Después de ${TANDAS_MAX} tandas aún queda trabajo: ${r.frase}` }); return }
      }
    }
    setE({ fase: 'hecho', hechos: ya })
  }

  async function empezar() {
    if (!accountId) return
    setE({ fase: 'yendo', paso: -1, hechos: [] })
    const r = await pasoDeVolverAEmpezar(accountId, 'comprobar')
    if (!r.ok) { setE({ fase: 'fallo', paso: -1, hechos: [], texto: r.texto }); return }
    await ir(0, [])
  }

  return (
    <div className="cx-tarjeta" data-prueba="volver-a-empezar">
      <h3 className="cx-tarjeta-titulo">Volver a empezar</h3>
      <p className="cx-ayuda">
        Deja esta cuenta de demostración como el primer día: los clientes del Bitrix24 de pruebas y del sandbox de GoCardless,
        y en Sumied lo leído de ellos, la tarifa, la contabilidad y el banco, sin nada de lo que se haya hecho después.
      </p>
      {!esAdmin && <p className="cx-ayuda">Solo un administrador de la cuenta puede volver a empezar.</p>}

      {esAdmin && e.fase === 'quieto' && (
        <button type="button" className="cx-boton-sec" onClick={() => setE({ fase: 'confirmar' })}>Volver a empezar</button>
      )}

      {e.fase === 'confirmar' && (
        <div className="cx-aviso" role="alertdialog" aria-label="Confirmar volver a empezar">
          <p style={{ margin: 0 }}><b>¿Volver a empezar la demo?</b> Se borra todo lo hecho en esta cuenta y en sus dos sistemas de pruebas:</p>
          <ul style={{ margin: '6px 0' }}>
            <li>el Bitrix24 de pruebas y el sandbox de GoCardless vuelven a sus 40 clientes de siempre;</li>
            <li>en Sumied se van los clientes, cobros, recibos, facturas, movimientos del banco y asientos, y se vuelven a leer;</li>
            <li>el portal de la demo vuelve a quedar preparado, con el acceso de Tomás Ruiz para Talleres Ruiz y el de Felipe Herrera para Electricidad Voltio;</li>
            <li>se quedan las empresas, su plan contable, las conexiones y las personas de la cuenta.</li>
          </ul>
          <p className="cx-ayuda" style={{ margin: '0 0 8px' }}>Tarda unos minutos. Solo toca esta cuenta de demostración.</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="cx-boton" onClick={() => void empezar()}>Sí, volver a empezar</button>
            <button type="button" className="cx-boton-sec" onClick={() => setE({ fase: 'quieto' })}>Cancelar</button>
          </div>
        </div>
      )}

      {e.fase === 'yendo' && (
        <p role="status" aria-live="polite">
          {e.paso < 0 ? 'Comprobando que se puede…' : `${PASOS[e.paso].que}… (${e.paso + 1} de ${PASOS.length})`}
        </p>
      )}

      {e.fase === 'hecho' && (
        <div role="status" aria-live="polite">
          <p><b>Hecho: la demo está como el primer día.</b></p>
          <ul className="cx-ayuda">{e.hechos.filter(Boolean).map((h, i) => <li key={i}>{h}</li>)}</ul>
          <button type="button" className="cx-boton-sec" onClick={() => setE({ fase: 'quieto' })}>Cerrar</button>
        </div>
      )}

      {e.fase === 'fallo' && (
        <div className="cx-aviso" role="alert">
          <p style={{ margin: 0 }}>
            <b>No se ha podido {e.paso < 0 ? 'empezar' : `acabar «${PASOS[e.paso].que.toLowerCase()}» (paso ${e.paso + 1} de ${PASOS.length})`}.</b> {e.texto}
          </p>
          {e.hechos.length > 0 && <ul className="cx-ayuda">{e.hechos.filter(Boolean).map((h, i) => <li key={i}>{h}</li>)}</ul>}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            {e.paso >= 0 && <button type="button" className="cx-boton" onClick={() => void ir(e.paso, e.hechos)}>Seguir desde este paso</button>}
            <button type="button" className="cx-boton-sec" onClick={() => setE({ fase: 'quieto' })}>Cerrar</button>
          </div>
        </div>
      )}
    </div>
  )
}
