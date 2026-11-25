// src/modules/conta/gestoria/g05/FrenteAGocardless.tsx
//
// Q08 · Paso 3 · En «Revisar el cobro», lo que cobraría Sumied al lado de lo
// que va a cobrar GoCardless, cliente a cliente (frenteAGocardless.ts). Las
// diferencias, arriba y en ámbar, con su motivo en palabras de la calle; las
// que son iguales, debajo y plegadas. «Descargar en Excel» con lo mismo, para
// que QBO lo revise y apunte los cambios en GoCardless. Solo pinta.

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { nombreDelMes } from '../../../../../supabase/functions/_shared/cobro/recibo'
import { euros } from '../../../../../supabase/functions/_shared/tarifa/precio'
import { motivoEnPalabras, type Frente, type FilaFrente } from './frenteAGocardless'

export function FrenteAGocardless({ frente, rutaFicha, alDescargar, preparado }: {
  frente: Frente
  rutaFicha: (clienteId: string) => string
  alDescargar: () => string
  /** El cobro de Sumied de este mes está preparado: si no, todo sale «nueva» y se dice por qué. */
  preparado: boolean
}) {
  const [verIguales, setVerIguales] = useState(false)
  const [bajado, setBajado] = useState<string | null>(null)
  const mes = nombreDelMes(frente.mes)
  const nombre = (f: FilaFrente) => (f.partyId ? <Link to={rutaFicha(f.partyId)}>{f.cliente}</Link> : f.cliente)
  const fila = (f: FilaFrente) => (
    <tr key={f.clave} data-motivo={f.motivo ?? 'igual'}>
      <td>{nombre(f)}</td>
      <td>{f.motivo ? <span className="g5-etiqueta" data-tono="aviso">{motivoEnPalabras(f.motivo, frente.mes)}</span> : <span className="g5-etiqueta" data-tono="bien">Igual</span>}</td>
      <td className="g5-num">{f.sumiedCent ? euros(f.sumiedCent) : '—'}</td>
      <td className="g5-num">{f.gcCent ? euros(f.gcCent) : '—'}</td>
      <td className="g5-num">{f.gcCent !== f.sumiedCent ? euros(f.gcCent - f.sumiedCent) : ''}</td>
      <td>{f.fechas.join(', ')}</td>
    </tr>
  )
  const cabeza = (
    <thead><tr><th scope="col">Cliente</th><th scope="col">Qué pasa</th><th scope="col" className="g5-num">Cobraría Sumied</th><th scope="col" className="g5-num">Cobrará GoCardless</th><th scope="col" className="g5-num">Diferencia</th><th scope="col">Día del cargo</th></tr></thead>
  )
  const c = frente.cuantas
  return (
    <section className="g4-bloque g5-frente" aria-labelledby="g5-frente" data-prueba="frente-a-gocardless">
      <div className="g4-bloque-cabecera">
        <h2 id="g5-frente" className="g4-bloque-titulo">Frente a GoCardless · {mes}</h2>
        <div className="g4-cabecera-acciones">
          <span className="g5-estado" data-tono={frente.diferencias.length ? 'aviso' : 'bien'}>
            {frente.diferencias.length ? `${frente.diferencias.length} ${frente.diferencias.length === 1 ? 'diferencia' : 'diferencias'}` : '✓ Igual que GoCardless'}
          </span>
          <button type="button" className="g4-boton" onClick={() => setBajado(alDescargar())}>Descargar en Excel</button>
        </div>
      </div>
      <p className="g5-apoyo">
        Sumied cobraría {euros(frente.totalSumiedCent)} y GoCardless va a cobrar {euros(frente.totalGcCent)} en {mes}.
        {frente.diferencias.length > 0 && ` ${[c.nueva ? `${c.nueva} ${motivoEnPalabras('nueva', frente.mes).toLowerCase()}` : null, c.no_se_cobra ? `${c.no_se_cobra} que no se cobran en ${mes}` : null,
          c.importe_distinto ? `${c.importe_distinto} con importe distinto` : null, c.sin_atar ? `${c.sin_atar} sin atar a su ficha` : null].filter(Boolean).join(', ')}.`}
      </p>
      {!preparado && <p className="g5-frase" data-tono="aviso">El cobro de Sumied de {mes} aún no está preparado: hasta entonces, todo lo de GoCardless sale como nuevo.</p>}
      {bajado && <p className="g5-frase" data-tono="bien" role="status">{bajado}</p>}
      {frente.diferencias.length > 0 && (
        <div className="g5-tabla-caja">
          <table className="g5-tabla" aria-label={`Diferencias con GoCardless en ${mes}`}>{cabeza}<tbody>{frente.diferencias.map(fila)}</tbody></table>
        </div>
      )}
      {frente.iguales.length > 0 && (
        <>
          <button type="button" className="g4-enlace" onClick={() => setVerIguales(!verIguales)} aria-expanded={verIguales}>
            {frente.iguales.length === 1 ? `${verIguales ? 'Ocultar' : 'Ver'} el que cobra lo mismo` : `${verIguales ? 'Ocultar' : 'Ver'} los ${frente.iguales.length} que cobran lo mismo`}
          </button>
          {verIguales && <div className="g5-tabla-caja"><table className="g5-tabla" aria-label={`Iguales que GoCardless en ${mes}`}>{cabeza}<tbody>{frente.iguales.map(fila)}</tbody></table></div>}
        </>
      )}
    </section>
  )
}
