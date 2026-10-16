// src/modules/conta/bancos/Reglas.tsx
//
// B01 · Bancos › Reglas, rehecha en el B02 («reglas que no hacen daño»). Cada
// regla en palabras («Cuando el concepto tenga "PLENITUDE" → Luz y agua ·
// 62800000») con aquello en lo que se basa (cuántos movimientos, «Ver
// ejemplos») y lo que cambiaría (cuántos pendientes pasarían a propuesta).
//   · Lo que propongo (lo hecho al menos 3 veces igual): Guardar / No.
//   · Lo que NO propongo porque el texto lo comparten varias contrapartes o
//     cuentas, con el porqué.
//   · Las guardadas: Corregir (el texto o la cuenta) y Apagar; apagada,
//     Encender o Borrar. «Casa sola» cuando la has confirmado 3 veces sin
//     corregir. Si una guardada es genérica, se dice («Revísala»).
// Ningún texto nombra la marca: en primera persona. Todo cambio queda en el
// registro de la regla (bank_rule_log).

import { useMemo, useState } from 'react'
import { ErrorConReintento, Hueso } from '@/modules/conta/ui/piezas'
import { eurosExactos, fechaLarga } from '@/modules/conta/lib/formato'
import { useLeer } from '@/modules/conta/libros/contexto'
import { borrarRegla, cambiarEstadoRegla, datosDeReglas, guardarRegla, leerReglas, rechazarPropuesta, type Regla } from '@/modules/conta/services/bancosPantallas'
import { casaSola, examinarRegla, type Examen } from '@/modules/conta/lib/reglasBanco'
import { useBancos } from '@/modules/conta/bancos/contexto'

const normal = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const ESTADO: Record<Regla['estado'], string> = { activa: 'Encendida', apagada: 'Apagada', propuesta: 'Propuesta', rechazada: 'Rechazada' }
const veces = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`

/** «Se basa en 7 movimientos · Si la guardas, 3 pendientes pasarían a propuesta», y los ejemplos plegados. */
function EnQueSeBasa({ ex, guardada, id }: { ex: Examen; guardada: boolean; id: string }) {
  const [abierto, setAbierto] = useState(false)
  const n = ex.ejemplos.length
  return (
    <span className="cxb-regla-base">
      <span className="cx-ayuda">
        {n ? `Se basa en ${veces(n, 'movimiento', 'movimientos')}` : 'Ningún movimiento de los últimos meses tiene ese texto'}
        {' · '}
        {ex.cambiaria ? `${guardada ? 'Hoy hace' : 'Si la guardas,'} ${veces(ex.cambiaria, 'pendiente pasaría', 'pendientes pasarían')} a propuesta` : 'no cambiaría nada de lo pendiente'}
      </span>
      {n > 0 && (
        <button type="button" className="cx-enlace" aria-expanded={abierto} aria-controls={`ejemplos-${id}`} onClick={() => setAbierto(!abierto)}>
          {abierto ? 'Ocultar ejemplos' : 'Ver ejemplos'}
        </button>
      )}
      {abierto && (
        <ul id={`ejemplos-${id}`} className="cxb-ejemplos">
          {ex.ejemplos.slice(0, 8).map((m) => (
            <li key={m.id}>
              <span>{fechaLarga(m.fecha)} · {m.contraparte ?? m.concepto}</span>
              <span className="cx-cifra">{eurosExactos(m.importeCent / 100)}</span>
            </li>
          ))}
          {n > 8 && <li className="cx-ayuda">y {veces(n - 8, 'más', 'más')}</li>}
        </ul>
      )}
    </span>
  )
}

export function Reglas() {
  const { accountId, companyId, hoy, datos, vuelta, recargar } = useBancos()
  const reglas = useLeer(() => leerReglas(accountId, companyId), `${companyId}:${vuelta}`)
  const base = useLeer(() => datosDeReglas(accountId, companyId, hoy), `${companyId}:${vuelta}:datos`)
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [contiene, setContiene] = useState('')
  const [q, setQ] = useState('')
  const [cuenta, setCuenta] = useState('')
  const [corrigiendo, setCorrigiendo] = useState<{ id: string; contiene: string; cuenta: string } | null>(null)
  const [borrando, setBorrando] = useState<string | null>(null)
  const nombre = (c: string) => `${datos.nombres[c] ?? c} · ${c}`
  const opciones = (filtro: string) => Object.keys(datos.nombres).filter((c) => c.length >= 8 && !c.startsWith('572')).sort()
    .filter((c) => !filtro.trim() || normal(`${datos.nombres[c]} ${c}`).includes(normal(filtro.trim()))).slice(0, 60)
  const cuentas = useMemo(() => opciones(q), [datos.nombres, q]) // eslint-disable-line react-hooks/exhaustive-deps

  const con = async (id: string, f: () => Promise<string>) => {
    setOcupado(id); setAviso(null)
    try { const t = await f(); setAviso({ tipo: 'ok', texto: t }); reglas.recargar(); base.recargar(); recargar() }
    catch (e) { setAviso({ tipo: 'error', texto: e instanceof Error ? e.message : String(e) }) }
    finally { setOcupado(null) }
  }

  if (reglas.error) return <ErrorConReintento mensaje={reglas.error} reintentar={reglas.recargar} />
  if (!reglas.datos) return <div className="cx-tarjeta" aria-busy="true" aria-label="Cargando las reglas">{[0, 1, 2].map((i) => <Hueso key={i} alto={44} />)}</div>
  const vivas = reglas.datos.filter((r) => r.estado !== 'rechazada')
  const yaHay = new Set(reglas.datos.map((r) => normal(r.contiene)))
  const nuevas = (base.datos?.propongo ?? []).filter((p) => !yaHay.has(normal(p.contiene)))
  const noPropongo = (base.datos?.noPropongo ?? []).filter((p) => !yaHay.has(normal(p.contiene)))
  const examen = (r: { contiene: string; signo?: 1 | -1 | null }) => (base.datos ? examinarRegla(r, base.datos.movs, base.datos.casados) : null)
  const textoNuevo = contiene.trim().toUpperCase()
  const exNueva = textoNuevo ? examen({ contiene: textoNuevo }) : null

  return (
    <section className="cxb-seccion" aria-labelledby="cxb-reglas-titulo">
      <div className="cxl-seccion"><div><h2 id="cxb-reglas-titulo">Reglas</h2><p className="cx-ayuda">Lo que se hace siempre igual. Las uso para proponer; una regla casa sola cuando la has confirmado 3 veces sin corregirla.</p></div></div>
      {aviso && <div className={aviso.tipo === 'ok' ? 'cx-guardado' : 'cx-error'} role={aviso.tipo === 'ok' ? 'status' : 'alert'}>{aviso.texto}</div>}

      <div className="cxb-banda" role="note">
        <span className="cx-ia-punto" aria-hidden="true" />
        <div className="cxb-banda-texto">
          <strong>{base.datos ? (nuevas.length ? `Te propongo ${veces(nuevas.length, 'regla nueva', 'reglas nuevas')}: lo has hecho igual al menos 3 veces.` : 'No tengo reglas nuevas que proponerte.') : 'Mirando lo que se repite…'}</strong>
          <span>Guardarla no cambia nada de lo ya hecho: solo propone igual la próxima vez, con su porqué.</span>
        </div>
      </div>
      {base.error && <div className="cx-error" role="alert">{base.error}</div>}
      {nuevas.length > 0 && (
        <div className="cx-tarjeta cxb-lista" aria-label="Reglas que te propongo">
          {nuevas.map((p) => {
            const ex = examen(p)
            return (
              <div key={p.contiene} className="cxb-lista-fila">
                <span className="cxb-lista-texto">
                  <strong>{p.palabras}</strong>
                  <span className="cx-ayuda">Te la propongo yo: lo has hecho {veces(p.veces, 'vez', 'veces')} así</span>
                  {ex && <EnQueSeBasa ex={ex} guardada={false} id={`p-${p.contiene}`} />}
                </span>
                <span className="cxb-botones">
                  <button type="button" className="cx-boton" disabled={!!ocupado} onClick={() => con(p.contiene, async () => {
                    await guardarRegla(companyId, { palabras: p.palabras, contiene: p.contiene, cuenta: p.cuenta, origen: 'folvy' })
                    return `Guardada: ${p.palabras}.${ex?.cambiaria ? ` ${veces(ex.cambiaria, 'pendiente pasa', 'pendientes pasan')} a propuesta.` : ''}`
                  })}>{ocupado === p.contiene ? 'Guardando…' : 'Guardar'}</button>
                  <button type="button" className="cx-boton-sec" disabled={!!ocupado} onClick={() => con(`no-${p.contiene}`, async () => {
                    await rechazarPropuesta(companyId, p)
                    return `De acuerdo: no te vuelvo a proponer «${p.contiene}».`
                  })}>No</button>
                </span>
              </div>
            )
          })}
        </div>
      )}
      {noPropongo.length > 0 && (
        <details className="cx-tarjeta cxb-lista cxb-no-propongo">
          <summary>{veces(noPropongo.length, 'regla que no te propongo', 'reglas que no te propongo')}, y por qué</summary>
          {noPropongo.map((p) => (
            <div key={p.contiene} className="cxb-lista-fila">
              <span className="cxb-lista-texto"><strong>«{p.contiene}» → {nombre(p.cuenta)}</strong><span className="cx-ayuda">No la propongo: {p.porque}</span></span>
            </div>
          ))}
        </details>
      )}

      <div className="cx-tarjeta cxb-lista" aria-label="Tus reglas">
        <h3 className="cxl-subtitulo">Tus reglas · {vivas.length}</h3>
        {vivas.length === 0 && <p className="cx-ayuda">Aún no hay ninguna. Al decirme a qué va un movimiento, puedes marcar «Guárdalo como regla».</p>}
        {vivas.map((r) => {
          const ex = examen(r)
          if (corrigiendo?.id === r.id) {
            const t = corrigiendo.contiene.trim().toUpperCase()
            const exC = t ? examen({ contiene: t, signo: r.signo }) : null
            return (
              <form key={r.id} className="cxb-lista-fila cx-formulario" aria-label={`Corregir la regla «${r.contiene}»`} onSubmit={(e) => {
                e.preventDefault()
                if (!t || !corrigiendo.cuenta) return
                con(r.id, async () => {
                  await guardarRegla(companyId, { id: r.id, palabras: `Cuando el concepto tenga «${t}» → ${nombre(corrigiendo.cuenta)}`, contiene: t, cuenta: corrigiendo.cuenta, signo: r.signo, origen: r.origen })
                  setCorrigiendo(null)
                  return `Corregida: cuando el concepto tenga «${t}» → ${nombre(corrigiendo.cuenta)}. Empieza de cero: propone hasta que la confirmes 3 veces.`
                })
              }}>
                <div className="cx-formulario-fila">
                  <label className="cx-campo"><span>Cuando el concepto tenga</span><input className="cx-input" value={corrigiendo.contiene} onChange={(e) => setCorrigiendo({ ...corrigiendo, contiene: e.target.value })} /></label>
                  <label className="cx-campo"><span>Va a</span>
                    <select className="cx-input" value={corrigiendo.cuenta} onChange={(e) => setCorrigiendo({ ...corrigiendo, cuenta: e.target.value })}>
                      {[...new Set([corrigiendo.cuenta, ...opciones('')])].map((c) => <option key={c} value={c}>{nombre(c)}</option>)}
                    </select>
                  </label>
                </div>
                {exC?.generica && <p className="cxb-ambar">{exC.generica}</p>}
                <div className="cx-pie">
                  <button type="button" className="cx-boton-sec" onClick={() => setCorrigiendo(null)}>Cancelar</button>
                  <button type="submit" className="cx-boton" disabled={!t || !!ocupado || !!exC?.generica}>{ocupado === r.id ? 'Guardando…' : 'Guardar la corrección'}</button>
                </div>
              </form>
            )
          }
          return (
            <div key={r.id} className={`cxb-lista-fila${r.estado === 'apagada' ? ' cxb-apagada' : ''}`}>
              <span className="cxb-lista-texto">
                <strong>Cuando el concepto tenga «{r.contiene}» → {nombre(r.cuenta)}</strong>
                <span className="cx-ayuda">
                  {ESTADO[r.estado]}{r.estado === 'activa' && casaSola(r.veces) ? ' · Casa sola' : ''} · {r.origen === 'folvy' ? 'te la propuse yo' : 'la pusiste tú'}
                  {' · '}{r.veces ? `confirmada ${veces(r.veces, 'vez', 'veces')}` : 'aún sin confirmar'}{r.ultimaVez ? ` · última, el ${fechaLarga(r.ultimaVez)}` : ''}
                </span>
                {ex && <EnQueSeBasa ex={ex} guardada={true} id={r.id} />}
                {ex?.generica && r.estado === 'activa' && <span className="cxb-ambar">Revísala: {ex.generica}</span>}
              </span>
              <span className="cxb-botones">
                {r.estado === 'propuesta' && <button type="button" className="cx-boton" disabled={!!ocupado} onClick={() => con(r.id, async () => { await cambiarEstadoRegla(r.id, 'activa'); return `Encendida: «${r.contiene}» → ${nombre(r.cuenta)}.` })}>Guardar</button>}
                {r.estado === 'propuesta' && <button type="button" className="cx-boton-sec" disabled={!!ocupado} onClick={() => con(r.id, async () => { await cambiarEstadoRegla(r.id, 'rechazada'); return `De acuerdo: no te vuelvo a proponer «${r.contiene}».` })}>No</button>}
                {(r.estado === 'activa' || r.estado === 'apagada') && <button type="button" className="cx-boton-sec" disabled={!!ocupado} onClick={() => { setBorrando(null); setCorrigiendo({ id: r.id, contiene: r.contiene, cuenta: r.cuenta }) }}>Corregir</button>}
                {r.estado === 'activa' && <button type="button" className="cx-boton-sec" disabled={!!ocupado} onClick={() => con(r.id, async () => { await cambiarEstadoRegla(r.id, 'apagada'); return `Apagada: «${r.contiene}». Ya no la uso para proponer.` })}>Apagar</button>}
                {r.estado === 'apagada' && <button type="button" className="cx-boton-sec" disabled={!!ocupado} onClick={() => con(r.id, async () => { await cambiarEstadoRegla(r.id, 'activa'); return `Encendida otra vez: «${r.contiene}» → ${nombre(r.cuenta)}.` })}>Encender</button>}
                {r.estado === 'apagada' && (borrando === r.id
                  ? <button type="button" className="cx-boton-sec cxb-peligro" disabled={!!ocupado} onClick={() => con(r.id, async () => { await borrarRegla(r.id); setBorrando(null); return `Borrada: «${r.contiene}» → ${nombre(r.cuenta)}.` })}>Sí, borrarla</button>
                  : <button type="button" className="cx-boton-sec" disabled={!!ocupado} onClick={() => setBorrando(r.id)}>Borrar…</button>)}
              </span>
            </div>
          )
        })}
      </div>

      <form className="cx-tarjeta cx-formulario" aria-label="Regla nueva" onSubmit={(e) => {
        e.preventDefault()
        if (!textoNuevo || !cuenta || exNueva?.generica) return
        con('nueva', async () => {
          await guardarRegla(companyId, { palabras: `Cuando el concepto tenga «${textoNuevo}» → ${nombre(cuenta)}`, contiene: textoNuevo, cuenta, origen: 'persona' })
          setContiene(''); setCuenta(''); setQ('')
          return `Guardada: cuando el concepto tenga «${textoNuevo}» → ${nombre(cuenta)}.${exNueva?.cambiaria ? ` ${veces(exNueva.cambiaria, 'pendiente pasa', 'pendientes pasan')} a propuesta.` : ''}`
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
        {exNueva && (exNueva.generica ? <p className="cxb-ambar">No la guardo así: {exNueva.generica}</p> : <EnQueSeBasa ex={exNueva} guardada={false} id="nueva" />)}
        <div className="cx-pie"><button type="submit" className="cx-boton" disabled={!textoNuevo || !cuenta || !!ocupado || !!exNueva?.generica}>{ocupado === 'nueva' ? 'Guardando…' : 'Guardar la regla'}</button></div>
      </form>
    </section>
  )
}
