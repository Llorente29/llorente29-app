// src/modules/conta/terceros/CuandoPaga.tsx
//
// PC01 · Entrega 1 · «Cuándo te paga» en la ficha de una plataforma (Contactos ›
// su ficha › Cobro). El plazo es un dato de cada plataforma, no del código
// (Julio, 25/10): el periodo que liquida, el día aproximado de pago (los días
// después de cerrar el periodo) y el margen antes de darla por vencida (5 si
// no se dice). Con eso vence la factura de cada cierre: hasta entonces sale
// «Esperando liquidación»; pasado sin cobrar, «Vencida».
//
// Nada se guarda solo: la pieza común «Cambios sin guardar» (la barra con
// «Guardar cambios»). Al guardar, la base recoloca el vencimiento de sus
// facturas por cobrar y lo dice con contenido (regla 8): «Guardado: Uber paga
// cada semana, hacia 1 día después de cerrarlo, con 5 de margen. 37 facturas
// por cobrar cambian de vencimiento.»

import { useState } from 'react'
import { BarraCambios, MarcaCambiado, type MensajeGuardado } from '@/modules/conta/diseno/plantillas/CambiosSinGuardar'
import { useCambiosSinGuardar } from '@/modules/conta/diseno/plantillas/cambios'
import { Pildoras } from '@/modules/conta/proveedor/piezas'
import { useTercero, papelesDe } from '@/modules/conta/terceros/contextoTercero'
import { guardarPlazoPlataforma } from '@/modules/conta/services/tercerosService'
import { MARGEN_POR_DEFECTO, ejemploDePlazo, textoGuardado, type Periodo } from '@/modules/conta/lib/plazoPlataforma'
import { hoyEnMadrid } from '@/modules/conta/lib/formato'

type Plazo = { cada: Periodo | null; dias: string; margen: string }
const NOMBRE_CADA: Record<Periodo, string> = { weekly: 'Cada semana', fortnightly: 'Cada quincena', monthly: 'Cada mes' }
const AYUDA_CADA: Record<Periodo, string> = { weekly: 'de lunes a domingo', fortnightly: 'del 1 al 15 y del 16 a fin de mes', monthly: 'del 1 a fin de mes' }

const entero = (s: string): number | null => (s.trim() === '' ? null : Number(s.trim()))
const malEntero = (s: string, max: number): string | null => {
  if (s.trim() === '') return null
  const n = Number(s.trim())
  return Number.isInteger(n) && n >= 0 && n <= max ? null : `Un número de días entre 0 y ${max}.`
}

export function CuandoPaga() {
  const { ficha, recargar } = useTercero()
  const { rolPlataforma } = papelesDe(ficha)
  const original: Plazo = {
    cada: rolPlataforma?.settlementEvery ?? null,
    dias: rolPlataforma?.payoutDaysAfter != null ? String(rolPlataforma.payoutDaysAfter) : '',
    margen: rolPlataforma?.payoutMarginDays != null ? String(rolPlataforma.payoutMarginDays) : '',
  }
  const c = useCambiosSinGuardar<Plazo>(original, { cada: 'Liquida', dias: 'Paga después de cerrar', margen: 'Margen' },
    (campo, v) => campo === 'cada' ? (v ? NOMBRE_CADA[v as Periodo] : 'Sin decir') : (v === '' || v == null ? (campo === 'margen' ? `${MARGEN_POR_DEFECTO} (por defecto)` : 'Sin decir') : `${v} días`))
  const [guardando, setGuardando] = useState(false)
  const [mensaje, setMensaje] = useState<MensajeGuardado | null>(null)
  const v = c.valor
  const errDias = malEntero(v.dias, 90)
  const errMargen = malEntero(v.margen, 60)
  const dias = entero(v.dias)
  const ejemplo = v.cada && dias != null && !errDias && !errMargen ? ejemploDePlazo(v.cada, dias, entero(v.margen), hoyEnMadrid()) : null

  async function guardar() {
    if (errDias || errMargen) { setMensaje({ tono: 'falta', texto: errDias ?? errMargen ?? '' }); return }
    setGuardando(true); setMensaje(null)
    try {
      const r = await guardarPlazoPlataforma(ficha.tercero.id, v.cada, dias, entero(v.margen))
      setMensaje({ tono: 'ok', texto: textoGuardado(ficha.tercero.nombre, v.cada, dias, entero(v.margen), r.facturas) })
      c.reiniciar(v)
      recargar()
    } catch (e) {
      setMensaje({ tono: 'falta', texto: e instanceof Error ? e.message : 'No se pudo guardar cuándo paga.' })
    } finally {
      setGuardando(false)
    }
  }

  return (
    <section className="cx-formulario" aria-labelledby="cuando-paga-titulo" data-prueba="cuando-paga">
      <h2 className="cx-tarjeta-titulo" id="cuando-paga-titulo">Cuándo te paga</h2>
      <BarraCambios cambios={c.cambios} onDescartar={() => { c.descartar(); setMensaje(null) }} onGuardar={() => void guardar()} guardando={guardando} mensaje={mensaje} />
      <Pildoras campo="plazo-cada" etiqueta="Liquida" elegidas={v.cada ? [v.cada] : []}
        opciones={(Object.keys(NOMBRE_CADA) as Periodo[]).map((p) => ({ valor: p, texto: NOMBRE_CADA[p], nota: AYUDA_CADA[p] }))}
        alCambiar={(x) => c.poner('cada', (x[0] ?? null) as Periodo | null)}
        ayuda={v.cada ? `El periodo va ${AYUDA_CADA[v.cada]}.` : 'Sin periodo, sus facturas vencen el día que se emiten.'} />
      <MarcaCambiado cambio={c.cambioDe('cada')} onDeshacer={() => c.deshacer('cada')} />
      <div className="cx-formulario-fila">
        <div className="cx-campo">
          <label htmlFor="plazo-dias">Paga unos … días después de cerrar el periodo <MarcaCambiado parte="etiqueta" cambio={c.cambioDe('dias')} onDeshacer={() => c.deshacer('dias')} /></label>
          <input id="plazo-dias" className="cx-input s-cifra" inputMode="numeric" value={v.dias} placeholder="1" aria-invalid={!!errDias}
            onChange={(e) => c.poner('dias', e.target.value)} />
          {errDias ? <div className="cx-error" role="alert">{errDias}</div> : <span className="cx-ayuda">Aproximado: el día que suele llegar al banco.</span>}
          <MarcaCambiado parte="antes" cambio={c.cambioDe('dias')} onDeshacer={() => c.deshacer('dias')} />
        </div>
        <div className="cx-campo">
          <label htmlFor="plazo-margen">Margen antes de darla por vencida (días) <MarcaCambiado parte="etiqueta" cambio={c.cambioDe('margen')} onDeshacer={() => c.deshacer('margen')} /></label>
          <input id="plazo-margen" className="cx-input s-cifra" inputMode="numeric" value={v.margen} placeholder={String(MARGEN_POR_DEFECTO)} aria-invalid={!!errMargen}
            onChange={(e) => c.poner('margen', e.target.value)} />
          {errMargen ? <div className="cx-error" role="alert">{errMargen}</div> : <span className="cx-ayuda">Vacío: {MARGEN_POR_DEFECTO} días.</span>}
          <MarcaCambiado parte="antes" cambio={c.cambioDe('margen')} onDeshacer={() => c.deshacer('margen')} />
        </div>
      </div>
      {ejemplo && <p className="cx-ayuda" style={{ margin: 0 }} data-prueba="ejemplo-plazo">{ejemplo}</p>}
    </section>
  )
}
