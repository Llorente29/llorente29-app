// src/modules/conta/libros/YaEstaEnErp10.tsx
//
// X31 · 2 · «Ya está en ERP10» (en «Qué mirar» de la salida): lo que la salida encontró ya escrito en ERP10 y no ha mandado.
// Lo decide una persona (respuesta de Julio, 24/11):
//   · de una factura, un solo botón, «Es la misma, no la mandes»; si el total no es el mismo, los dos totales uno al lado
//     del otro y la diferencia en rojo, y el botón no se puede pulsar sin marcar «He mirado la diferencia»;
//   · de un asiento, los dos: «Es el mismo, no lo mandes» y «Es otro, mándalo».
// Cada botón confirma o falla en pantalla, con contenido (regla 8). Nada se esconde (regla 7): todas, las más recientes arriba.

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { rutaAsiento } from '@/config/navegacion'
import { botones, queEs, sePuedeLaMisma, textoBoton, textoYaEsta, totales, type DudaVista } from '@/modules/conta/erp10/dudas'
import { decirEsLaMisma, decirEsOtro } from '@/modules/conta/services/erp10ApiService'

export function YaEstaEnErp10({ dudas, quien, decidido }: { dudas: readonly DudaVista[]; quien: string | null; decidido: () => void }) {
  const [miradas, setMiradas] = useState<Set<string>>(new Set())
  const [haciendo, setHaciendo] = useState<string | null>(null)
  const [dicho, setDicho] = useState<{ bien: boolean; texto: string } | null>(null)
  if (!dudas.length && !dicho) return null

  async function decir(d: DudaVista, b: 'la_misma' | 'otro') {
    setHaciendo(d.envioId); setDicho(null)
    try {
      const t = b === 'otro' ? await decirEsOtro(d.envioId, quien) : await decirEsLaMisma(d.envioId, miradas.has(d.envioId), quien)
      setDicho({ bien: true, texto: `${queEs(d)}: ${t}` })
      decidido()
    } catch (e) {
      setDicho({ bien: false, texto: `No se ha podido apuntar lo de ${queEs(d).replace(/^./, (x) => x.toLowerCase())}: ${e instanceof Error ? e.message : 'no ha contestado'}` })
    } finally {
      setHaciendo(null)
    }
  }

  return (
    <div className="cxe-aviso cxe-ya-esta" role="note" data-prueba="ya-esta-en-erp10">
      {dudas.length > 0 && <p><strong>Ya está en ERP10 · {dudas.length}</strong> No se {dudas.length === 1 ? 'ha mandado' : 'han mandado'}: dilo tú.</p>}
      {dudas.map((d) => {
        const t = totales(d)
        const mirada = miradas.has(d.envioId)
        return (
          <div key={d.envioId} className="cxe-ya-esta-una" data-prueba="duda-erp10" data-que={d.que}>
            <p className="cxe-ya-esta-que">
              <Link className="cx-enlace" to={rutaAsiento(d.entryId)}>{queEs(d)}</Link>
            </p>
            <p className="cxe-ya-esta-dice"><strong>{textoYaEsta(d)}.</strong></p>
            {t && (
              <dl className="cxe-ya-esta-totales" data-prueba="totales-erp10">
                <div><dt>En Sumied</dt><dd className="cxe-num">{t.sumied}</dd></div>
                <div><dt>En ERP10</dt><dd className="cxe-num">{t.erp10}</dd></div>
                {t.diferencia && <div className="cxe-ya-esta-dif" data-prueba="diferencia-erp10"><dt>Diferencia</dt><dd className="cxe-num">{t.diferencia}</dd></div>}
              </dl>
            )}
            {t?.diferencia && (
              <label className="cxe-ya-esta-mirada">
                <input type="checkbox" checked={mirada} onChange={(e) => setMiradas((m) => { const n = new Set(m); if (e.target.checked) n.add(d.envioId); else n.delete(d.envioId); return n })} />
                He mirado la diferencia
              </label>
            )}
            <div className="cxe-aviso-botones">
              {botones(d).map((b) => {
                const cerrado = b === 'la_misma' && !sePuedeLaMisma(d, mirada)
                return (
                  <button key={b} type="button" className={b === 'otro' ? 'cxe-ambar-sec' : 'cxe-ambar'} disabled={!!haciendo || cerrado}
                    title={cerrado ? 'Los totales no son iguales: mira antes la diferencia.' : undefined} onClick={() => { void decir(d, b) }}>
                    {haciendo === d.envioId ? 'Apuntando…' : textoBoton(d, b)}
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
      {dicho && <p className={dicho.bien ? 'cxe-conexion-bien' : 'cxe-conexion-mal'} role="status" data-prueba="duda-dicho">{dicho.texto}</p>}
    </div>
  )
}
