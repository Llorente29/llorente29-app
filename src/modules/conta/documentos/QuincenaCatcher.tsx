// src/modules/conta/documentos/QuincenaCatcher.tsx
//
// E05 · «Sube la quincena de Catcher». Se arrastran juntos el ZIP de PDF y los
// dos Excel (FACTURAS y PEDIDOS); se leen en el navegador, y antes de subir
// nada se enseña lo leído en una línea. Al subir: cada PDF al almacén, una
// factura por PDF, el cruce con los pedidos y lo que ha pasado, dicho (regla 8).
// S02 · PR 3: vive en Compras y gastos › Liquidaciones (antes, al final de
// Facturas recibidas). Las quincenas ya subidas salen en la lista de esa
// página, con su estado: aquí solo se sube (cada cosa en un sitio).
//
// Lo que impide subir (un fichero que falta, periodos mezclados) se dice y no se
// sube; lo que no cuadra en una factura sube igual y queda «Por aclarar».

import { useRef, useState, type DragEvent } from 'react'
import { Link } from 'react-router-dom'
import { rutaLoteCatcher } from '@/config/navegacion'
import { resumen, LoteNoValido } from '@/modules/conta/lib/catcherQuincena'
import { contar, facturasPorGrupo } from '@/modules/conta/lib/catcherCuenta'
import { abrirQuincena, cruzarLote, subirQuincena, type QuincenaAbierta } from '@/modules/conta/services/catcherService'

const ACEPTA = '.zip,.xlsx,.xls,application/zip,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/** `alSubir`: la quincena ya está subida (y cruzada): la lista de la página la vuelve a leer. */
export function QuincenaCatcher({ accountId, companyId, quien, alSubir }: { accountId: string; companyId: string; quien: string | null; alSubir?: () => void }) {
  const entrada = useRef<HTMLInputElement>(null)
  const [encima, setEncima] = useState(false)
  const [paso, setPaso] = useState<string | null>(null)
  const [leida, setLeida] = useState<QuincenaAbierta | null>(null)
  const [hecho, setHecho] = useState<{ textos: string[]; loteId: string } | null>(null)
  const [fallo, setFallo] = useState<string | null>(null)

  async function leer(fs: File[]) {
    if (!fs.length) return
    setLeida(null); setHecho(null); setFallo(null); setPaso('Leyendo los ficheros…')
    try {
      setLeida(await abrirQuincena(accountId, companyId, fs))
    } catch (e) {
      setFallo(e instanceof LoteNoValido || e instanceof Error ? e.message : String(e))
    } finally {
      setPaso(null)
      if (entrada.current) entrada.current.value = ''
    }
  }

  async function subir() {
    if (!leida) return
    setFallo(null); setPaso(`Subiendo ${contar(leida.facturas.length, 'factura', 'facturas')}…`)
    try {
      const s = await subirQuincena(accountId, companyId, leida, quien)
      const textos = [s.texto]
      if (!s.yaEstaba) {
        setPaso('Cruzando con los pedidos…')
        textos.push((await cruzarLote(accountId, companyId, s.loteId, quien)).texto)
      }
      setHecho({ textos, loteId: s.loteId })
      setLeida(null)
      alSubir?.()
    } catch (e) {
      setFallo(e instanceof Error ? e.message : String(e))
    } finally { setPaso(null) }
  }

  const alSoltar = (e: DragEvent) => {
    e.preventDefault(); setEncima(false)
    void leer(Array.from(e.dataTransfer.files ?? []))
  }

  return (
    <section className="cx-tarjeta cxk-quincena" aria-labelledby="cxk-quincena-titulo">
      <h3 id="cxk-quincena-titulo">Subir una quincena de Catcher</h3>
      <div className={encima ? 'cxc-soltar cxc-soltar-encima' : 'cxc-soltar'} data-prueba="soltar-catcher"
        onDragOver={(e) => { e.preventDefault(); setEncima(true) }} onDragLeave={() => setEncima(false)} onDrop={alSoltar}>
        <span><strong>Sube la quincena de Catcher</strong>: el ZIP de las facturas y los dos Excel (FACTURAS y PEDIDOS), los tres a la vez.</span>
        <label className="cx-boton-sec cxk-elegir">Elegir los ficheros
          <input ref={entrada} type="file" multiple accept={ACEPTA} className="cx-oculto" aria-label="Elegir los ficheros de la quincena de Catcher"
            data-prueba="subir-catcher" onChange={(e) => void leer(Array.from(e.target.files ?? []))} />
        </label>
      </div>

      <div role="status" aria-live="polite">
        {paso && <div className="cx-tarjeta">{paso}</div>}
        {leida && (
          <div className="cxk-leida">
            <p className="cxk-resumen"><strong>{resumen(leida)}</strong></p>
            <p className="cxr-apoyo">
              {facturasPorGrupo({ rider: leida.totales.porTipo.rider.facturas, flota: leida.totales.porTipo.flota.facturas, catcher: leida.totales.porTipo.catcher.facturas })}
              {' · '}{contar(leida.pedidos.length, 'pedido', 'pedidos')} en el Excel
            </p>
            {leida.problemas.length > 0 && (
              <ul className="cxk-lista-avisos" aria-label="Lo que impide subirla">{leida.problemas.map((p) => <li key={p} className="cxr-mal">{p}</li>)}</ul>
            )}
            {leida.avisos.length > 0 && (
              <ul className="cxk-lista-avisos" aria-label="Lo que no cuadra al leerla">{leida.avisos.map((p) => <li key={p}>{p}</li>)}</ul>
            )}
            <div className="cxk-acciones">
              <button type="button" className="cx-boton" onClick={() => void subir()} disabled={!!paso || leida.problemas.length > 0}>Subir y cruzar con los pedidos</button>
              <button type="button" className="cx-boton-sec" onClick={() => setLeida(null)} disabled={!!paso}>No subirla</button>
            </div>
          </div>
        )}
        {hecho && (
          <div className="cx-tarjeta cxr-hecho">
            {hecho.textos.map((t) => <strong key={t} style={{ display: 'block' }}>{t}</strong>)}
            <Link className="cx-enlace" to={rutaLoteCatcher(hecho.loteId)}>Ver la quincena y lo que hay que aclarar</Link>
          </div>
        )}
      </div>
      {fallo && <div className="cx-error" role="alert">{fallo}</div>}
    </section>
  )
}
