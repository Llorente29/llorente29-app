// src/modules/conta/plan/PropuestasPlan.tsx
//
// C02, tarea 5 · Lo que propone la IA sobre el plan (maqueta N5: tarjeta verde
// arriba con el texto, el porqué con los códigos y dos respuestas). Lo decide
// el núcleo (lib/propuestasPlan.ts); aquí se pinta y se contesta.
//
//   · Confianza alta y media: tarjeta, la primera a la vista y «N más» debajo.
//   · Confianza baja: NO sale como tarjeta (encargo §4, como Digits); se queda
//     en «Para revisar», plegada, con su número. Es la bandeja hasta que haya
//     pantalla «Por hacer». Un umbral ordena, no esconde (regla 7): la bandeja
//     dice cuántas hay.
//   · Contestar dice lo que ha hecho, con contenido (regla 8), y queda en el
//     historial del plan («Lo que ha hecho Folvy»).

import { useState } from 'react'
import { BloqueIA, Chip } from '@/modules/conta/ui/piezas'
import { fraseHecha, repartirPropuestas, type Confianza, type OpPlan, type Propuesta } from '@/modules/conta/lib/propuestasPlan'
import { responderPropuesta } from '@/modules/conta/services/planService'

const CONFIANZA: Record<Confianza, string> = { alta: 'Confianza alta', media: 'Confianza media', baja: 'Confianza baja' }

function Tarjeta({ p, contestar, ocupado }: { p: Propuesta; contestar: (acepta: boolean, ops: OpPlan[]) => void; ocupado: boolean }) {
  return (
    <BloqueIA
      titulo={<>{p.titulo} <Chip tono={p.confianza === 'baja' ? 'ambar' : 'ia'}>{CONFIANZA[p.confianza]}</Chip></>}
      porque={p.porque}
      acciones={(
        <>
          <button type="button" className="cx-boton" disabled={ocupado} onClick={() => contestar(true, p.ops)}>{p.si}</button>
          {p.alternativa && <button type="button" className="cx-boton-sec" disabled={ocupado} onClick={() => contestar(true, p.alternativa!.ops)}>{p.alternativa.texto}</button>}
          <button type="button" className="cx-boton-sec" disabled={ocupado} onClick={() => contestar(false, [])}>{p.no}</button>
        </>
      )} />
  )
}

export function PropuestasPlan({ propuestas, companyId, quien, alCambiar }: {
  propuestas: readonly Propuesta[]; companyId: string; quien: string | null; alCambiar: () => void
}) {
  const [ocupado, setOcupado] = useState(false)
  const [hecho, setHecho] = useState<string | null>(null)
  const [fallo, setFallo] = useState<string | null>(null)
  const [todas, setTodas] = useState(false)
  const { tarjetas, revisar } = repartirPropuestas(propuestas)

  const contestar = (p: Propuesta) => async (acepta: boolean, ops: OpPlan[]) => {
    setOcupado(true); setHecho(null); setFallo(null)
    try {
      await responderPropuesta(companyId, p, acepta, ops, quien)
      setHecho(acepta ? fraseHecha(ops) : 'Entendido: no te lo vuelvo a proponer por lo mismo.')
      alCambiar()
    } catch (e) {
      setFallo(e instanceof Error ? e.message : 'No se ha podido contestar.')
    } finally { setOcupado(false) }
  }

  if (!propuestas.length && !hecho && !fallo) return null
  const vista = todas ? tarjetas : tarjetas.slice(0, 1)
  return (
    <div className="cx-plan-propuestas">
      {vista.map((p) => <Tarjeta key={p.clave} p={p} contestar={contestar(p)} ocupado={ocupado} />)}
      {tarjetas.length > 1 && (
        <button type="button" className="cx-enlace" aria-expanded={todas} onClick={() => setTodas((v) => !v)} style={{ alignSelf: 'flex-start' }}>
          {todas ? 'Ver solo la primera' : `Folvy propone ${tarjetas.length - 1} ${tarjetas.length - 1 === 1 ? 'cosa más' : 'cosas más'}`}
        </button>
      )}
      <div role="status" aria-live="polite">{hecho && <div className="cx-guardado">{hecho}</div>}</div>
      {fallo && <div className="cx-error" role="alert">{fallo}</div>}
      {revisar.length > 0 && (
        <details className="cx-tarjeta cx-plan-revisar">
          <summary>
            <span className="cx-tarjeta-titulo">Para revisar</span> <span className="cx-tablas-cuenta">{revisar.length}</span>
            <span className="cx-ayuda"> · propuestas de confianza baja: no salen como tarjeta, míralas cuando puedas</span>
          </summary>
          <div className="cx-columna" style={{ paddingTop: 10 }}>
            {revisar.map((p) => <Tarjeta key={p.clave} p={p} contestar={contestar(p)} ocupado={ocupado} />)}
          </div>
        </details>
      )}
    </div>
  )
}
