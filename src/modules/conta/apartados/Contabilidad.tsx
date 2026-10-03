// src/modules/conta/apartados/Contabilidad.tsx
//
// «Contabilidad» (nunca «gestor», §6): en qué se apuntan sus facturas (tipo de
// gasto, con su cuenta del PGC en pequeño), el local habitual y el registro
// sanitario. «Su cuenta» solo con el interruptor `conta` activo, y vacía hasta
// el C02: «Se asigna al activar el plan contable».
//
// El catálogo de tipos de gasto es de Folvy y cada cuenta oculta los que no
// usa: esa lista también se maneja desde aquí.

import { useState } from 'react'
import { useFicha } from '@/modules/conta/components/FichaContexto'
import { Campo, Dato, Guardado } from '@/modules/conta/components/ui'
import { useAvisoGuardado } from '@/modules/conta/hooks/useAvisoGuardado'
import { cuentaPgc } from '@/modules/conta/lib/pgc'
import { ocultarTipoGastoUnificado } from '@/modules/conta/services/fichaTablasService'

export default function Contabilidad() {
  const { datos, guardar, actor, recargar } = useFicha()
  const f = datos.ficha
  const [tipo, setTipo] = useState(f.expenseCategoryId ?? '')
  const [local, setLocal] = useState(f.defaultLocationId ?? '')
  const [rgseaa, setRgseaa] = useState(f.healthRegistryNo ?? '')
  const [ocupado, setOcupado] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)
  const [aviso, avisar] = useAvisoGuardado()
  const [verLista, setVerLista] = useState(false)

  // Se ofrecen los que la cuenta usa, y siempre el que ya tiene puesto aunque
  // esté oculto: ocultar un tipo no puede borrar en silencio lo ya elegido.
  const opciones = datos.tiposGasto.filter((t) => !t.oculto || t.id === f.expenseCategoryId)
  const elegido = datos.tiposGasto.find((t) => t.id === tipo)

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    setOcupado(true); setFallo(null)
    try {
      const r = await guardar({ expenseCategoryId: tipo || null, defaultLocationId: local || null, healthRegistryNo: rgseaa.trim() || null })
      if (r.errores.length) setFallo(r.errores.map((x) => x.mensaje).join(' '))
      else avisar(elegido ? `Guardado. Sus facturas se apuntan en ${elegido.name}.` : 'Contabilidad guardada.')
    } catch (e2) {
      setFallo(e2 instanceof Error ? e2.message : 'No se pudo guardar.')
    } finally {
      setOcupado(false)
    }
  }

  return (
    <>
      <form className="cf-form" onSubmit={enviar} noValidate>
        {fallo && <div className="cf-error" role="alert">{fallo}</div>}
        <Campo campo="expenseCategoryId" etiqueta="Sus facturas se apuntan en" ayuda={elegido ? cuentaPgc(elegido.pgcAccountHint) : 'El tipo de gasto que son casi todas sus facturas.'}>
          {(p) => (
            <select {...p} className="cf-select" value={tipo} onChange={(e) => setTipo(e.target.value)}>
              <option value="">Sin decir</option>
              {opciones.map((t) => <option key={t.id} value={t.id}>{t.name}{t.oculto ? ' (oculto en tu cuenta)' : ''}</option>)}
            </select>
          )}
        </Campo>
        <Campo campo="defaultLocationId" etiqueta="Local habitual" ayuda="El local al que suele servir. «Todos» si reparte a todos.">
          {(p) => (
            <select {...p} className="cf-select" value={local} onChange={(e) => setLocal(e.target.value)}>
              <option value="">Todos</option>
              {datos.locales.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          )}
        </Campo>
        <Campo campo="healthRegistryNo" etiqueta="Registro sanitario (RGSEAA)" ayuda="Lo encuentras en sus facturas o albaranes. Sirve para el control de proveedores del APPCC.">
          {(p) => <input {...p} className="cf-input" value={rgseaa} onChange={(e) => setRgseaa(e.target.value)} placeholder="10.00000/M" />}
        </Campo>
        {datos.conta && (
          <Dato etiqueta="Su cuenta" valor={f.ledgerAccountCode} vacio="Se asigna al activar el plan contable" />
        )}
        <div className="cf-pie-form">
          <button type="submit" className="cf-boton" disabled={ocupado}>{ocupado ? 'Guardando…' : 'Guardar'}</button>
          <Guardado texto={aviso} />
        </div>
      </form>

      <div className="cf-form">
        <button type="button" className="cf-boton-texto" aria-expanded={verLista} onClick={() => setVerLista((v) => !v)} style={{ alignSelf: 'flex-start' }}>
          {verLista ? 'Cerrar' : 'Elegir qué tipos de gasto usa tu negocio'}
        </button>
        {verLista && (
          <div className="cf-tarjeta" style={{ gap: 4 }}>
            <p className="cf-nota" style={{ margin: 0 }}>Los que quites no saldrán al elegir. Afecta a todos los proveedores de tu cuenta.</p>
            {datos.tiposGasto.map((t) => (
              <label key={t.id} className="cf-casilla" style={{ border: 'none', padding: 0 }}>
                <input type="checkbox" checked={!t.oculto} onChange={async (e) => {
                  // Se lee UNA vez y antes de esperar: tras el primer await, React ya
                  // ha devuelto la casilla (controlada) a su valor y el aviso salía
                  // al revés («vuelve a salir» al quitarlo). Lo cazó el e2e de la T7.
                  const ocultar = !e.target.checked
                  try { await ocultarTipoGastoUnificado(f.accountId, datos.opciones.empresa?.id ?? null, t.id, ocultar, actor.id); await recargar(); avisar(ocultar ? `${t.name}: ya no sale al elegir.` : `${t.name}: vuelve a salir.`) }
                  catch (e2) { setFallo(e2 instanceof Error ? e2.message : 'No se pudo cambiar.') }
                }} />
                <span>{t.name} <span className="cf-nota">· {cuentaPgc(t.pgcAccountHint)}</span></span>
              </label>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
