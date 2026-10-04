// src/modules/conta/proveedor/Aprendido.tsx
//
// El bloque verde «Lo que he aprendido de este proveedor» (N4) y su frase del
// móvil (M4). Cada línea dice QUÉ ha aprendido Folvy, POR QUÉ («Lo confirmaste
// tú 3 veces», «Así vienen todas sus facturas») y trae «Cambiar». Es lo que
// se propone en la factura siguiente; nunca se apunta nada sin confirmación
// (C01b §4). Las reglas, en lib/aprendizaje.ts; lo guardado y su registro
// («Lo que ha hecho Folvy»), en la migración 20261006T0130.
//
// «Cambiar» fija el valor a mano (gana a lo aprendido y lo dice: «Lo fijó
// Julio a mano») o lo devuelve a Folvy para que vuelva a aprenderlo.

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useFicha } from '@/modules/conta/proveedor/contexto'
import { Dialogo, Pildoras } from '@/modules/conta/proveedor/piezas'
import { Guardado } from '@/modules/conta/ui/piezas'
import { useAvisoGuardado } from '@/modules/conta/hooks/useAvisoGuardado'
import { etiquetaIva, type Aprendido as UnAprendido } from '@/modules/conta/lib/aprendizaje'
import { porcentaje } from '@/modules/conta/lib/formato'
import { fijarAprendido } from '@/modules/conta/services/proveedorService'
import type { Apartado } from '@/modules/conta/lib/resumenFicha'

/** Adónde lleva lo que no se cambia aquí. */
const DONDE: Record<UnAprendido['campo'], { ap: Apartado; campo: string }> = {
  expense_category: { ap: 'contabilidad', campo: 'expenseCategoryId' },
  tax_rates: { ap: 'datos-fiscales', campo: 'usualTaxRateIds' },
  withholding: { ap: 'datos-fiscales', campo: 'irpfWithholdingPct' },
  payment: { ap: 'pago', campo: 'paymentMethod' },
  iban: { ap: 'pago', campo: 'iban' },
}

const VACIO = 'Aún no he aprendido nada de este proveedor. Cuando tres facturas suyas seguidas digan lo mismo, te lo propondré en la siguiente; nunca lo apunto sin preguntarte.'

export function BloqueAprendido() {
  const { aprendidos } = useFicha()
  const [cambiando, setCambiando] = useState<UnAprendido | null>(null)
  const [aviso, avisar] = useAvisoGuardado()
  return (
    <section className="cxp-aprendido" aria-labelledby="cxp-aprendido">
      <div className="cxp-aprendido-cabeza">
        <span className="cx-ia-punto" aria-hidden="true" />
        <h2 id="cxp-aprendido">Lo que he aprendido de este proveedor</h2>
      </div>
      {aprendidos.length === 0 && <p className="cxp-aprendido-vacio" style={{ margin: 0 }}>{VACIO}</p>}
      {aprendidos.map((a) => (
        <div key={a.campo} className="cxp-aprendido-fila">
          <div className="cxp-aprendido-texto">
            <span className="cxp-aprendido-que">{a.etiqueta}</span>
            <span className="cxp-aprendido-porque">{a.porque}.</span>
          </div>
          <button type="button" className="cx-enlace" onClick={() => setCambiando(a)} aria-label={`Cambiar: ${a.etiqueta}`}>Cambiar</button>
        </div>
      ))}
      <Guardado texto={aviso} />
      {cambiando && <DialogoCambiar a={cambiando} alCerrar={(t) => { setCambiando(null); if (t) avisar(t) }} />}
    </section>
  )
}

function DialogoCambiar({ a, alCerrar }: { a: UnAprendido; alCerrar: (texto?: string) => void }) {
  const { datos, actor, recargar, rutaApartado } = useFicha()
  const [ocupado, setOcupado] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)
  const [rates, setRates] = useState<string[]>(a.campo === 'tax_rates' ? a.valor.split(',') : [])
  const [forma, setForma] = useState<string[]>(a.campo === 'payment' ? [a.valor] : [])

  async function hacer(valor: string | null, etiqueta: string | null, texto: string) {
    setOcupado(true); setFallo(null)
    try { await fijarAprendido(datos.ficha.id, a.campo, valor, etiqueta, actor.name); await recargar(); alCerrar(texto) }
    catch (e) { setFallo(e instanceof Error ? e.message : 'No se pudo cambiar.'); setOcupado(false) }
  }

  let editor: React.ReactNode
  let guardar: (() => void) | null = null
  if (a.campo === 'tax_rates') {
    const opciones = [...new Set([...datos.opciones.tiposIva.map((t) => String(t.valor)), ...rates])]
      .sort((x, y) => Number(x) - Number(y)).map((r) => ({ valor: r, texto: porcentaje(Number(r)) }))
    editor = <Pildoras campo="cambiar-iva" etiqueta="Sus facturas llevan" varias opciones={opciones} elegidas={rates} alCambiar={setRates} />
    const ord = [...rates].sort((x, y) => Number(x) - Number(y))
    guardar = ord.length ? () => void hacer(ord.join(','), etiquetaIva(ord.map(Number)), `Fijado a mano: ${etiquetaIva(ord.map(Number))}.`) : null
  } else if (a.campo === 'payment') {
    const opciones = datos.opciones.formasPago.map((f) => ({ valor: f.valor as string, texto: f.nombre }))
    editor = <Pildoras campo="cambiar-pago" etiqueta="Le pagas por" opciones={opciones} elegidas={forma} alCambiar={setForma} />
    const elegida = datos.opciones.formasPago.find((f) => f.valor === forma[0])
    guardar = elegida ? () => void hacer(elegida.valor, `Le pagas por ${elegida.nombre.toLowerCase()}`, `Fijado a mano: le pagas por ${elegida.nombre.toLowerCase()}.`) : null
  } else {
    editor = <p style={{ margin: 0 }}>Esto se cambia en su ficha: <Link to={rutaApartado(DONDE[a.campo].ap, DONDE[a.campo].campo)}>ir al campo</Link>.</p>
  }

  return (
    <Dialogo titulo="Cambiar lo que he aprendido" alCerrar={() => alCerrar()}>
      <p className="cx-ayuda" style={{ margin: 0, fontSize: 15 }}>Ahora: <strong>{a.etiqueta}</strong>. {a.porque}.</p>
      {editor}
      <p className="cx-ayuda" style={{ margin: 0 }}>Lo que fijes a mano gana a lo que aprenda de sus facturas, y queda en «Lo que ha hecho Folvy».</p>
      {fallo && <div className="cx-error" role="alert">{fallo}</div>}
      <div className="cx-pie">
        {a.aMano && (
          <button type="button" className="cx-boton-sec" disabled={ocupado}
            onClick={() => void hacer(null, null, 'Devuelto a Folvy: lo vuelvo a aprender de sus facturas.')}>Que lo aprenda Folvy</button>
        )}
        <button type="button" className="cx-boton-sec" onClick={() => alCerrar()}>Cancelar</button>
        {guardar && <button type="button" className="cx-boton" disabled={ocupado} onClick={guardar}>{ocupado ? 'Guardando…' : 'Fijar así'}</button>}
      </div>
    </Dialogo>
  )
}

/** M4: la misma información en una tarjeta verde de una frase. */
export function FraseAprendido() {
  const { aprendidos } = useFicha()
  const [primero, ...resto] = aprendidos
  return (
    <section className="cx-ia-bloque cxm-aprendido" aria-label="Lo que he aprendido de este proveedor">
      <span className="cx-ia-punto" aria-hidden="true" />
      <div className="cx-ia-texto">
        {primero ? (
          <>
            <span className="cx-ia-titulo">{primero.etiqueta}</span>
            <span className="cx-ia-porque">{[primero.porque, ...resto.map((r) => r.etiqueta)].join(' · ')}</span>
          </>
        ) : <span className="cx-ia-porque">{VACIO}</span>}
      </div>
    </section>
  )
}
