// src/modules/conta/proveedor/LineasDeSuLiquidacion.tsx
//
// S01p·18 · punto 1 (Respuesta S01p·18.1, 4): lo que se ha contestado de las
// líneas de la transacción de un socio de marca se ve también en su ficha, y se
// cambia desde aquí. «Una regla que solo aparece cuando el caso se repite es
// una regla escondida.» Sale en los proveedores que liquidan cada mes (los
// únicos con liquidación, y por eso con reglas), aunque aún no tengan ninguna.

import { useEffect, useState } from 'react'
import { useFicha } from '@/modules/conta/proveedor/contexto'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { Guardado } from '@/modules/conta/ui/piezas'
import { useAvisoGuardado } from '@/modules/conta/hooks/useAvisoGuardado'
import { tabla } from '@/modules/conta/services/bd'
import { QUE_ES_LINEA, type QueEsLinea } from '@/modules/conta/lib/lectorLiquidacionMensual'
import { FRASE_QUE_ES, guardarReglaSocio, leerReglasSocio, TEXTO_QUE_ES, type ReglaSocio } from '@/modules/conta/compras/reglasSocio'

function fechaCorta(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}`
}

export function LineasDeSuLiquidacion() {
  const { datos } = useFicha()
  const { activa } = useEmpresas()
  const proveedor = datos.ficha.id
  const [liquida, setLiquida] = useState<boolean | null>(null)
  const [reglas, setReglas] = useState<ReglaSocio[] | null>(null)
  const [fallo, setFallo] = useState<string | null>(null)
  const [cambiando, setCambiando] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [aviso, avisar] = useAvisoGuardado()

  // Solo los que liquidan cada mes traen esas líneas: las reglas se guardan desde su liquidación.
  useEffect(() => {
    let vivo = true
    void tabla('supplier').select('invoicing_mode').eq('id', proveedor).maybeSingle()
      .then(({ data }: { data: { invoicing_mode: string | null } | null }) => {
        if (!vivo) return
        const si = data?.invoicing_mode === 'monthly_settlement'
        setLiquida(si)
        if (si && activa?.id) {
          leerReglasSocio(activa.id, proveedor).then((r) => { if (vivo) setReglas(r ?? []) })
            .catch((e: unknown) => { if (vivo) setFallo(`No he podido leer lo que sé de sus líneas: ${e instanceof Error ? e.message : String(e)}`) })
        }
      })
    return () => { vivo = false }
  }, [proveedor, activa?.id])

  if (!liquida) return null

  async function cambiar(r: ReglaSocio, q: QueEsLinea | null) {
    if (!activa?.id) return
    setOcupado(true); setFallo(null)
    try {
      const nueva = await guardarReglaSocio(activa.id, proveedor, r.concepto, q)
      setReglas((rs) => (rs ?? []).flatMap((x) => (x.clave !== r.clave ? [x] : nueva ? [nueva] : [])))
      setCambiando(null)
      avisar(q ? `Cambiado: «${r.concepto}» ahora ${FRASE_QUE_ES[q]}.` : `Olvidado: la próxima vez que traiga «${r.concepto}», te preguntaré qué es.`)
    } catch (e) {
      setFallo(`No he podido cambiarlo: ${e instanceof Error ? e.message : String(e)}`)
    } finally { setOcupado(false) }
  }

  return (
    <section className="cxp-aprendido" aria-labelledby="cxp-lineas-socio" data-prueba="lineas-de-su-liquidacion">
      <div className="cxp-aprendido-cabeza">
        <span className="cx-ia-punto" aria-hidden="true" />
        <h2 id="cxp-lineas-socio">Lo que sé de las líneas de su liquidación</h2>
      </div>
      {reglas === null && !fallo && <p className="cxp-aprendido-vacio" style={{ margin: 0 }}>Mirando…</p>}
      {reglas?.length === 0 && (
        <p className="cxp-aprendido-vacio" style={{ margin: 0 }}>
          Aún no sé nada de sus líneas. Cuando su liquidación traiga una línea que no es ninguna de las dos facturas, te preguntaré qué es y lo recordaré aquí.
        </p>
      )}
      {(reglas ?? []).map((r) => (
        <div key={r.clave} className="cxp-aprendido-fila">
          <div className="cxp-aprendido-texto">
            <span className="cxp-aprendido-que">«{r.concepto}» {FRASE_QUE_ES[r.queEs]}</span>
            <span className="cxp-aprendido-porque">Lo dijo {r.quien ?? 'alguien'} el {fechaCorta(r.fecha)} al leer su liquidación.</span>
            {cambiando === r.clave && (
              <div className="cxc-ops" style={{ marginTop: 8 }}>
                {QUE_ES_LINEA.filter((q) => q !== r.queEs).map((q) => (
                  <button key={q} type="button" className="cxc-op" disabled={ocupado} onClick={() => void cambiar(r, q)}>
                    <span className="cxc-op-t">{TEXTO_QUE_ES[q]}</span>
                  </button>
                ))}
                <button type="button" className="cxc-op" disabled={ocupado} onClick={() => void cambiar(r, null)}>
                  <span className="cxc-op-t">Que me lo pregunte la próxima vez</span>
                </button>
              </div>
            )}
          </div>
          <button type="button" className="cx-enlace" onClick={() => setCambiando(cambiando === r.clave ? null : r.clave)}
            aria-label={`Cambiar: «${r.concepto}»`}>{cambiando === r.clave ? 'Cancelar' : 'Cambiar'}</button>
        </div>
      ))}
      {fallo && <div className="cx-error" role="alert">{fallo}</div>}
      <Guardado texto={aviso} />
    </section>
  )
}
