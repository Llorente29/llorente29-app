// src/modules/conta/bancos/Reglas.tsx
//
// B01 · Bancos › Reglas (sin maqueta, en el estilo de N17). Las reglas en
// palabras («Cuando el concepto tenga "PLENITUDE" → Luz y agua · 62800000»),
// quién la puso, cuántas veces ha servido y Apagar / Encender. Arriba, lo que
// Folvy propone por lo aprendido (al menos dos veces lo mismo), con
// «Guardar la regla». Todo cambio queda en su registro (bank_rule_log).

import { useMemo, useState } from 'react'
import { ErrorConReintento, Hueso } from '@/modules/conta/ui/piezas'
import { fechaLarga } from '@/modules/conta/lib/formato'
import { useLeer } from '@/modules/conta/libros/contexto'
import { cambiarEstadoRegla, guardarRegla, leerReglas, reglasPropuestas, type Regla } from '@/modules/conta/services/bancosPantallas'
import { useBancos } from '@/modules/conta/bancos/contexto'
import { LA_PROPUSO, NOMBRE, PROPUESTA_POR } from '@/modules/conta/bancos/marca'

const normal = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const ESTADO: Record<Regla['estado'], string> = { activa: 'Encendida', apagada: 'Apagada', propuesta: 'Propuesta', rechazada: 'Rechazada' }

export function Reglas() {
  const { accountId, companyId, hoy, datos, vuelta, recargar } = useBancos()
  const reglas = useLeer(() => leerReglas(accountId, companyId), `${companyId}:${vuelta}`)
  const propuestas = useLeer(() => reglasPropuestas(accountId, companyId, hoy), `${companyId}:${vuelta}:propuestas`)
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [contiene, setContiene] = useState('')
  const [q, setQ] = useState('')
  const [cuenta, setCuenta] = useState('')
  const nombre = (c: string) => `${datos.nombres[c] ?? c} · ${c}`
  const cuentas = useMemo(() => Object.keys(datos.nombres).filter((c) => c.length >= 8 && !c.startsWith('572')).sort()
    .filter((c) => !q.trim() || normal(`${datos.nombres[c]} ${c}`).includes(normal(q.trim()))).slice(0, 60), [datos.nombres, q])

  const con = async (id: string, f: () => Promise<string>) => {
    setOcupado(id); setAviso(null)
    try { const t = await f(); setAviso({ tipo: 'ok', texto: t }); reglas.recargar(); propuestas.recargar(); recargar() }
    catch (e) { setAviso({ tipo: 'error', texto: e instanceof Error ? e.message : String(e) }) }
    finally { setOcupado(null) }
  }

  if (reglas.error) return <ErrorConReintento mensaje={reglas.error} reintentar={reglas.recargar} />
  if (!reglas.datos) return <div className="cx-tarjeta" aria-busy="true" aria-label="Cargando las reglas">{[0, 1, 2].map((i) => <Hueso key={i} alto={44} />)}</div>
  const vivas = reglas.datos.filter((r) => r.estado !== 'rechazada')
  const yaHay = new Set(reglas.datos.map((r) => normal(r.contiene)))
  const nuevas = (propuestas.datos ?? []).filter((p) => !yaHay.has(normal(p.contiene)))

  return (
    <section className="cxb-seccion" aria-labelledby="cxb-reglas-titulo">
      <div className="cxl-seccion"><div><h2 id="cxb-reglas-titulo">Reglas</h2><p className="cx-ayuda">Lo que se hace siempre igual. {NOMBRE} las usa para proponer; ninguna casa sola si no es segura.</p></div></div>
      {aviso && <div className={aviso.tipo === 'ok' ? 'cx-guardado' : 'cx-error'} role={aviso.tipo === 'ok' ? 'status' : 'alert'}>{aviso.texto}</div>}

      <div className="cxb-banda" role="note">
        <span className="cx-ia-punto" aria-hidden="true" />
        <div className="cxb-banda-texto">
          <strong>{propuestas.datos ? (nuevas.length ? `Te propongo ${nuevas.length} ${nuevas.length === 1 ? 'regla nueva' : 'reglas nuevas'}: lo has hecho igual al menos dos veces.` : 'No tengo reglas nuevas que proponerte.') : 'Mirando lo que se repite…'}</strong>
          <span>Guardarla no cambia nada de lo ya hecho: solo propone igual la próxima vez, con su porqué.</span>
        </div>
      </div>
      {propuestas.error && <div className="cx-error" role="alert">{propuestas.error}</div>}
      {nuevas.length > 0 && (
        <div className="cx-tarjeta cxb-lista">
          {nuevas.map((p) => (
            <div key={p.contiene} className="cxb-lista-fila">
              <span className="cxb-lista-texto"><strong>{p.palabras}</strong><span className="cx-ayuda">{PROPUESTA_POR}</span></span>
              <button type="button" className="cx-boton" disabled={!!ocupado} onClick={() => con(p.contiene, async () => {
                await guardarRegla(companyId, { palabras: p.palabras, contiene: p.contiene, cuenta: p.cuenta, origen: 'folvy' })
                return `Guardada: ${p.palabras}.`
              })}>{ocupado === p.contiene ? 'Guardando…' : 'Guardar la regla'}</button>
            </div>
          ))}
        </div>
      )}

      <div className="cx-tarjeta cxb-lista" aria-label="Tus reglas">
        <h3 className="cxl-subtitulo">Tus reglas · {vivas.length}</h3>
        {vivas.length === 0 && <p className="cx-ayuda">Aún no hay ninguna. Al decirle a {NOMBRE} a qué va un movimiento, puedes marcar «Hazlo siempre así».</p>}
        {vivas.map((r) => (
          <div key={r.id} className={`cxb-lista-fila${r.estado === 'apagada' ? ' cxb-apagada' : ''}`}>
            <span className="cxb-lista-texto">
              <strong>Cuando el concepto tenga «{r.contiene}» → {nombre(r.cuenta)}</strong>
              <span className="cx-ayuda">{ESTADO[r.estado]} · {r.origen === 'folvy' ? LA_PROPUSO : 'la pusiste tú'} · {r.veces ? `ha servido ${r.veces} ${r.veces === 1 ? 'vez' : 'veces'}` : 'aún no ha servido'}{r.ultimaVez ? ` · última, el ${fechaLarga(r.ultimaVez)}` : ''}</span>
            </span>
            <span className="cxb-botones">
              {r.estado === 'propuesta' && <button type="button" className="cx-boton" disabled={!!ocupado} onClick={() => con(r.id, async () => { await cambiarEstadoRegla(r.id, 'activa'); return `Encendida: «${r.contiene}» → ${nombre(r.cuenta)}.` })}>Aceptar</button>}
              {r.estado === 'propuesta' && <button type="button" className="cx-boton-sec" disabled={!!ocupado} onClick={() => con(r.id, async () => { await cambiarEstadoRegla(r.id, 'rechazada'); return `Rechazada: «${r.contiene}». No te la vuelvo a proponer.` })}>No</button>}
              {r.estado === 'activa' && <button type="button" className="cx-boton-sec" disabled={!!ocupado} onClick={() => con(r.id, async () => { await cambiarEstadoRegla(r.id, 'apagada'); return `Apagada: «${r.contiene}». Ya no la uso para proponer.` })}>Apagar</button>}
              {r.estado === 'apagada' && <button type="button" className="cx-boton-sec" disabled={!!ocupado} onClick={() => con(r.id, async () => { await cambiarEstadoRegla(r.id, 'activa'); return `Encendida otra vez: «${r.contiene}» → ${nombre(r.cuenta)}.` })}>Encender</button>}
            </span>
          </div>
        ))}
      </div>

      <form className="cx-tarjeta cx-formulario" aria-label="Regla nueva" onSubmit={(e) => {
        e.preventDefault()
        const t = contiene.trim().toUpperCase()
        if (!t || !cuenta) return
        con('nueva', async () => {
          await guardarRegla(companyId, { palabras: `Cuando el concepto tenga «${t}» → ${nombre(cuenta)}`, contiene: t, cuenta, origen: 'persona' })
          setContiene(''); setCuenta(''); setQ('')
          return `Guardada: cuando el concepto tenga «${t}» → ${nombre(cuenta)}.`
        })
      }}>
        <h3 className="cxl-subtitulo">Regla nueva</h3>
        <div className="cx-formulario-fila">
          <label className="cx-campo"><span>Cuando el concepto tenga</span><input className="cx-input" value={contiene} onChange={(e) => setContiene(e.target.value)} placeholder="Ej.: PLENITUDE" /></label>
          <label className="cx-campo"><span>Busca a qué va</span><input className="cx-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Escribe: luz, alquiler, 628…" /></label>
        </div>
        <label className="cx-campo"><span>Va a</span>
          <select className="cx-input" value={cuenta} onChange={(e) => setCuenta(e.target.value)}>
            <option value="">Elige…</option>
            {cuentas.map((c) => <option key={c} value={c}>{nombre(c)}</option>)}
          </select>
        </label>
        <div className="cx-pie"><button type="submit" className="cx-boton" disabled={!contiene.trim() || !cuenta || !!ocupado}>{ocupado === 'nueva' ? 'Guardando…' : 'Guardar la regla'}</button></div>
      </form>
    </section>
  )
}
