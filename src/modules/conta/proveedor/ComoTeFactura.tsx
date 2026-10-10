// src/modules/conta/proveedor/ComoTeFactura.tsx
//
// «Cómo te factura» (encargo de compras, maqueta N20): con cada entrega,
// entrega con albarán y factura después, o liquidación mensual. Arriba, lo que
// dicen sus últimos papeles contra lo que pone la ficha. Guarda por
// compras_forma_facturar, que además vuelve a decidir sus recepciones abiertas,
// y lo dice (regla 8).

import { useEffect, useState } from 'react'
import { useFicha } from '@/modules/conta/proveedor/contexto'
import { tabla } from '@/modules/conta/services/bd'
import { cambiarFormaFacturar, ultimosPapeles } from '@/modules/conta/services/comprasService'
import { FORMAS, chocaConLaFicha, fraseUltimosPapeles, papelConArticulo, tituloForma, type FormaFacturar } from '@/modules/conta/lib/compras'
import { Guardado } from '@/modules/conta/ui/piezas'

interface Costumbre { modo: FormaFacturar | null; porLocal: boolean | null; frecuencia: string | null }

export default function ComoTeFactura() {
  const { datos, recargar } = useFicha()
  const id = datos.ficha.id
  const [guardada, setGuardada] = useState<Costumbre | null>(null)
  const [elegida, setElegida] = useState<Costumbre | null>(null)
  const [papeles, setPapeles] = useState<string[] | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [fallo, setFallo] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  useEffect(() => {
    let vivo = true
    Promise.all([
      tabla('supplier').select('invoicing_mode, invoicing_per_location, invoicing_frequency').eq('id', id).single(),
      ultimosPapeles(id, 5).catch(() => [] as string[]),
    ]).then(([{ data, error }, ps]) => {
      if (!vivo) return
      if (error) { setFallo(`No se pudo leer cómo factura: ${error.message}`); return }
      const r = data as { invoicing_mode: FormaFacturar | null; invoicing_per_location: boolean | null; invoicing_frequency: string | null }
      const c = { modo: r.invoicing_mode, porLocal: r.invoicing_per_location, frecuencia: r.invoicing_frequency }
      setGuardada(c); setElegida(c); setPapeles(ps)
    })
    return () => { vivo = false }
  }, [id])

  if (!guardada || !elegida) {
    return fallo ? <div className="cx-error" role="alert">{fallo}</div> : null
  }
  const cambiado = elegida.modo !== guardada.modo || (elegida.modo === 'delivery_note_then_invoice'
    && (elegida.porLocal !== guardada.porLocal || elegida.frecuencia !== guardada.frecuencia))
  const dicen = papeles ? fraseUltimosPapeles(papeles) : null
  const choca = papeles ? chocaConLaFicha(papeles, guardada.modo) : false
  const nombre = datos.ficha.name

  return (
    <fieldset className="cx-fieldset cxc-como" aria-describedby="cxc-como-dice">
      <legend className="cx-tarjeta-titulo" style={{ fontSize: 16, marginBottom: 6 }}>Cómo te factura</legend>
      <p id="cxc-como-dice" className={choca ? 'cxc-dice cxc-dice-choca' : 'cxc-dice'}>
        {dicen ?? 'Todavía no hay papeles suyos leídos.'}{' '}
        {guardada.modo
          ? <>Aquí pone que {guardada.modo === 'monthly_settlement' ? 'liquida cada mes' : `factura ${tituloForma(guardada.modo)?.toLowerCase()}`}.{choca ? ' Si no es así, cámbialo y dejaré de preguntártelo.' : ''}</>
          : <>Su ficha no dice cómo factura{papeles?.[0] ? `; su último papel fue ${papelConArticulo(papeles[0])}` : ''}.</>}
      </p>
      <div className="cxc-formas" role="radiogroup" aria-label={`Cómo te factura ${nombre}`}>
        {FORMAS.map((f) => {
          const activa = elegida.modo === f.valor
          return (
            <div key={f.valor} className={activa ? 'cxc-forma cxc-forma-activa' : 'cxc-forma'}>
              <button type="button" role="radio" aria-checked={activa} className="cxc-forma-boton"
                onClick={() => setElegida({ ...elegida, modo: f.valor })}>
                <span className="cxc-forma-titulo">{f.titulo}</span>
                <span className="cxc-forma-explica">{f.explicacion}</span>
              </button>
              {activa && f.valor === 'delivery_note_then_invoice' && (
                <div className="cxc-forma-mas" role="group" aria-label="Suele mandar la factura">
                  <span className="cx-etiqueta">Suele mandar la factura</span>
                  <div className="cx-chips">
                    <button type="button" className={elegida.frecuencia === 'monthly' ? 'cx-pildora cx-pildora-actual' : 'cx-pildora'}
                      aria-pressed={elegida.frecuencia === 'monthly'} onClick={() => setElegida({ ...elegida, frecuencia: 'monthly' })}>una vez al mes</button>
                    <button type="button" className={elegida.porLocal ? 'cx-pildora cx-pildora-actual' : 'cx-pildora'}
                      aria-pressed={!!elegida.porLocal} onClick={() => setElegida({ ...elegida, porLocal: !elegida.porLocal })}>una por cada local</button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div className="cx-pie" style={{ justifyContent: 'flex-start' }}>
        <button type="button" className="cx-boton-sec" disabled={!cambiado || ocupado} onClick={() => { setElegida(guardada); setAviso(null) }}>Dejarlo como estaba</button>
        <button type="button" className="cx-boton" disabled={!cambiado || ocupado || !elegida.modo} onClick={async () => {
          if (!elegida.modo) return
          setOcupado(true); setFallo(null); setAviso(null)
          try {
            const r = await cambiarFormaFacturar(id, elegida.modo,
              elegida.modo === 'delivery_note_then_invoice' ? !!elegida.porLocal : null,
              elegida.modo === 'delivery_note_then_invoice' ? elegida.frecuencia : null)
            const nueva = { ...elegida, porLocal: elegida.modo === 'delivery_note_then_invoice' ? !!elegida.porLocal : null }
            setGuardada(nueva); setElegida(nueva)
            setAviso(`Guardado: ${nombre} factura «${tituloForma(elegida.modo)}».${r.recepciones > 0 ? ` He vuelto a mirar ${r.recepciones === 1 ? 'su recepción abierta' : `sus ${r.recepciones} recepciones abiertas`} con esta costumbre.` : ''}`)
            await recargar()
          } catch (e) {
            setFallo(e instanceof Error ? e.message : 'No se pudo guardar cómo factura.')
          } finally { setOcupado(false) }
        }}>{ocupado ? 'Guardando…' : 'Guardar'}</button>
      </div>
      <p className="cx-ayuda" style={{ margin: 0 }}>Esto es la costumbre. Si un día trae otro tipo de papel, lo veré y te lo preguntaré en Compras.</p>
      <Guardado texto={aviso} />
      {fallo && <div className="cx-error" role="alert">{fallo}</div>}
    </fieldset>
  )
}
