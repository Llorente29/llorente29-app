// src/modules/conta/ventas/LoQueDejaElCierre.tsx
//
// N2 · Ventas › Lo que deja el cierre del día (C11 y C11b, Julio, 23/10), con
// la plantilla BANDEJA: las cifras arriba y la cola con la acción de cada uno.
//   · «Para revisar»: pedidos del TPV y de la tienda que seguían abiertos a la
//     hora de cierre. El cierre no los toca: se cierran o se anulan en el TPV
//     (enlace a Pedidos). Mientras sigan abiertos, su día no se asienta.
//   · «Sin cobrar»: pedidos de plataforma cerrados sin confirmar que su
//     liquidación no trae cobrados: «Proponer la devolución» (al libro, para
//     validar) o «Se cobró por otro lado».
//   · Lo demás que cerró sin confirmar sigue a la vista con su estado
//     (cobrado, esperando su liquidación, devolución propuesta, descartado):
//     la pantalla se abre a propósito y no esconde filas (regla 7).
// Cada acción dice lo que ha hecho (regla 8).

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { rutaLibroDiario } from '@/config/navegacion'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useLeer } from '@/modules/conta/libros/contexto'
import { Boton, Chip } from '@/modules/conta/diseno'
import type { TonoChip } from '@/modules/conta/diseno/valores'
import { Bandeja, CifrasBandeja } from '@/modules/conta/diseno/plantillas'
import { eurosExactos } from '@/modules/conta/lib/formato'
import { ETIQUETA, cifras, esperaDecision, estadoDe, ordenar, porqueDe, tituloDe } from '@/modules/conta/lib/loQueDejaElCierre'
import { descartarAjuste, leerLoQueDejaElCierre, type FilaCierreConLocal } from '@/modules/conta/services/loQueDejaElCierreService'
import { proponerDevolucionSinCobrar } from '@/modules/conta/services/propuestasLibroService'

const TONO: Record<ReturnType<typeof estadoDe>, TonoChip> = {
  revisar: 'duda', sin_cobrar: 'falta', sin_liquidacion: 'neutro', devolucion_propuesta: 'propuesto', descartado: 'seguro', cobrado: 'seguro', revisar_resuelto: 'seguro',
}

/**
 * D01 (#221): sin canal de plataforma no hay pedidos de plataforma, así que sus
 * dos cifras no tienen nada que contar y no salen (ni la palabra «plataforma»).
 * Las filas se enseñan todas igual (regla 7).
 */
export function LoQueDejaElCierre({ conPlataformas = true, soloDe }: {
  conPlataformas?: boolean
  /** V01 · En la ficha de un cierre: solo lo de su local y su día (y nada si no hay). */
  soloDe?: { localId: string; dia: string }
}) {
  const { accountId, userName } = useCuentaConta()
  const { activa } = useEmpresas()
  const [vuelta, setVuelta] = useState(0)
  const [haciendo, setHaciendo] = useState<string | null>(null)
  const [hecho, setHecho] = useState<Record<string, { texto: string; bien: boolean }>>({})
  const datos = useLeer(accountId && activa ? () => leerLoQueDejaElCierre(accountId, activa.id) : null, `${accountId}:${activa?.id}:cierre-del-dia:${vuelta}`)

  if (datos.error) return <p className="s-aviso-lista" data-tono="falta" role="alert">No he podido leer lo que dejó el cierre del día: {datos.error}</p>
  if (!datos.datos) return soloDe ? null : <p className="s-apoyo" aria-busy="true">Leyendo lo que dejó el cierre del día…</p>
  const filas = (ordenar(datos.datos) as FilaCierreConLocal[]).filter((f) => !soloDe || (f.locationId === soloDe.localId && f.dia === soloDe.dia))
  if (soloDe && filas.length === 0) return null
  const c = cifras(filas)

  const hacer = async (f: FilaCierreConLocal, que: 'devolucion' | 'descartar') => {
    if (!accountId || !activa) return
    setHaciendo(f.saleId)
    try {
      const texto = que === 'devolucion'
        ? await proponerDevolucionSinCobrar(accountId, activa.id, { saleId: f.saleId, locationId: f.locationId, dia: f.dia, liquidacion: f.liquidacion ?? { ref: null, fecha: null } }, userName)
        : await descartarAjuste(accountId, activa.id, f.saleId, userName)
      setHecho((h) => ({ ...h, [f.saleId]: { texto, bien: true } }))
      setVuelta((v) => v + 1)
    } catch (e) {
      setHecho((h) => ({ ...h, [f.saleId]: { texto: `No se ha hecho: ${e instanceof Error ? e.message : String(e)}`, bien: false } }))
    } finally { setHaciendo(null) }
  }

  const aqui = '?ver=cierre-del-dia'
  return (
    <section aria-label="Lo que deja el cierre del día" data-prueba="cierre-del-dia">
      <h2 className="s-bandeja-titulo">{soloDe ? 'Lo que dejó el cierre de este día' : 'Lo que deja el cierre del día'}</h2>
      <Bandeja
        cifras={soloDe ? null : <CifrasBandeja cifras={[
          { etiqueta: 'Para revisar', valor: c.revisar.toLocaleString('es-ES'), apoyo: 'del TPV y de la tienda, abiertos al cierre', a: aqui },
          ...(conPlataformas ? [
            { etiqueta: 'Sin cobrar', valor: eurosExactos(c.sinCobrar.total), apoyo: `${c.sinCobrar.n} cerrado${c.sinCobrar.n === 1 ? '' : 's'} sin confirmar que su liquidación no cobra`, a: aqui },
            { etiqueta: 'Cerrados sin confirmar', valor: eurosExactos(c.sinConfirmar.total), apoyo: `${c.sinConfirmar.n} pedido${c.sinConfirmar.n === 1 ? '' : 's'} de plataforma, en ventas de su día`, a: aqui },
          ] : []),
        ]} />}
        principal={
          <section className="s-bandeja-bloque" aria-label="Pedidos que dejó el cierre del día">
            <div className="s-bandeja-bloque-cabeza">
              <h2>Te toca</h2>
              <span className="s-bandeja-total">{c.revisar + c.sinCobrar.n === 0 ? 'Todo al día' : `${(c.revisar + c.sinCobrar.n).toLocaleString('es-ES')} esperan una decisión`}</span>
            </div>
            {filas.length === 0 && <p className="s-bandeja-nada">El cierre del día no ha dejado nada: ningún pedido abierto a su hora.</p>}
            {filas.length > 0 && c.revisar + c.sinCobrar.n === 0 && <p className="s-bandeja-nada">Nada espera una decisión tuya. Debajo, lo que cerró sin confirmar y cómo está.</p>}
            <ul className="s-bandeja-filas">
              {filas.map((f) => {
                const e = estadoDe(f)
                const h = hecho[f.saleId]
                return (
                  <li key={f.saleId} className="s-bandeja-fila" data-fila={f.saleId} data-estado={e}>
                    <span className="s-bandeja-fila-texto">
                      <span className="s-bandeja-fila-titulo">{tituloDe(f)} <Chip tono={TONO[e]}>{ETIQUETA[e]}</Chip></span>
                      <span className="s-bandeja-fila-apoyo">{porqueDe(f)}</span>
                      {h && <span className="s-aviso-lista" data-tono={h.bien ? 'ok' : 'falta'} role="status">{h.texto}</span>}
                    </span>
                    {esperaDecision(e) && (
                      <span className="s-bandeja-hecho-acciones">
                        {e === 'revisar' && <Link to="/pedidos" className="s-boton s-boton-secundario">Abrir en Pedidos</Link>}
                        {e === 'sin_cobrar' && (
                          <>
                            <Boton variante="principal" onClick={() => void hacer(f, 'devolucion')} disabled={haciendo !== null}>{haciendo === f.saleId ? 'Proponiendo…' : 'Proponer la devolución'}</Boton>
                            <Boton variante="secundario" onClick={() => void hacer(f, 'descartar')} disabled={haciendo !== null}>Se cobró por otro lado</Boton>
                          </>
                        )}
                      </span>
                    )}
                    {e === 'devolucion_propuesta' && <Link to={rutaLibroDiario('ventas')} className="s-boton s-boton-secundario">Ver en el libro</Link>}
                  </li>
                )
              })}
            </ul>
          </section>
        }
      />
    </section>
  )
}
