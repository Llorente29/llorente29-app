// src/modules/conta/verifactu/ComprobarConHacienda.tsx
//
// V03 · E3 · «Comprobar con Hacienda»: se elige un mes (y, desde el despacho de
// la asesoría, la empresa), se pregunta a la AEAT qué registros tiene de ese
// mes y se cuadran con los de Sumied. La pregunta la hace conta-verifactu
// (verifactu_cuadre): aquí se pide y se mira cada pocos segundos hasta que hay
// resultado. Lo que hay de antes de ese mes se enseña al abrir. Siempre dice
// algo (regla 8): esperando, cuánto lleva; si falla, por qué; si cuadra, con
// cuántos; si no, cuál y qué hacer.

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { rutaFacturaVenta } from '@/config/navegacion'
import { Boton, Campo, Dialogo, Selector } from '@/modules/conta/diseno'
import { type CuadreVisto, filasDescuadre, mesesParaComprobar, textoCuadre } from '@/modules/conta/lib/verifactu/correccion'
import { pedirCuadre, verCuadre } from '@/modules/conta/services/verifactuService'

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))
const CADA_MS = 3000

export function DialogoComprobarHacienda({ empresas, desdeAccount, quien, alCerrar }: {
  /** Una sola (Facturas) o las de la asesoría (el despacho): entonces se elige. */
  empresas: readonly { id: string; nombre: string }[]
  /** La cuenta de la asesoría que pregunta por una empresa que lleva; null si es la propia. */
  desdeAccount: string | null
  quien: string | null
  alCerrar: () => void
}) {
  const meses = useMemo(() => mesesParaComprobar(new Date()), [])
  const [empresa, setEmpresa] = useState(empresas[0]?.id ?? '')
  const [mes, setMes] = useState(meses[0]?.valor ?? '')
  const [cuadre, setCuadre] = useState<CuadreVisto | null>(null)
  const [leido, setLeido] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [ahora, setAhora] = useState(() => new Date())

  // Al cambiar de empresa o de mes se olvida lo de antes, y se lee lo último
  // que se preguntó de ese mes.
  const olvidar = () => { setCuadre(null); setLeido(false); setFallo(null) }
  useEffect(() => {
    let vale = true
    if (!empresa || !mes) return
    verCuadre(empresa, { mes, desdeAccount })
      .then((c) => { if (vale) { setCuadre(c); setLeido(true) } })
      .catch((e) => { if (vale) { setFallo(msg(e)); setLeido(true) } })
    return () => { vale = false }
  }, [empresa, mes, desdeAccount])

  const texto = cuadre ? textoCuadre(cuadre, ahora) : null
  // Mientras espera, vuelve a mirar ese mismo cuadre.
  useEffect(() => {
    if (!cuadre || !texto?.esperando) return
    const t = setTimeout(() => {
      verCuadre(empresa, { cuadre: cuadre.id, desdeAccount })
        .then((c) => { setAhora(new Date()); if (c) setCuadre(c) })
        .catch((e) => setFallo(msg(e)))
    }, CADA_MS)
    return () => clearTimeout(t)
  }, [cuadre, texto?.esperando, empresa, desdeAccount])

  const preguntar = () => {
    setOcupado(true); setFallo(null)
    void pedirCuadre(empresa, mes, desdeAccount, quien)
      .then((p) => verCuadre(empresa, { cuadre: p.id, desdeAccount }))
      .then((c) => { setAhora(new Date()); setCuadre(c) })
      .catch((e) => setFallo(msg(e)))
      .finally(() => setOcupado(false))
  }

  const filas = cuadre?.estado === 'hecho' && cuadre.resultado ? filasDescuadre(cuadre.resultado) : []
  const nombre = empresas.find((e) => e.id === empresa)?.nombre ?? ''
  return (
    <Dialogo titulo="Comprobar con Hacienda" alCerrar={alCerrar}
      explicacion={`Pregunta a Hacienda qué registros tiene de un mes${empresas.length > 1 ? '' : ` de ${nombre}`} y los compara uno a uno con los de Sumied: si falta alguno, si sobra o si dice otra cosa.`}
      acciones={<>
        <Boton variante="secundario" onClick={alCerrar}>Cerrar</Boton>
        <Boton variante="principal" data-prueba="cuadre-preguntar" disabled={ocupado || !empresa || !mes || !!texto?.esperando} onClick={preguntar}>
          {ocupado ? 'Preguntando…' : cuadre && !texto?.esperando ? 'Volver a preguntar' : 'Preguntar a Hacienda'}
        </Boton>
      </>}>
      {empresas.length > 1 && (
        <Campo etiqueta="Empresa">
          {(c) => <Selector {...c} valor={empresa} alCambiar={(v) => { olvidar(); setEmpresa(v) }} opciones={empresas.map((e) => ({ valor: e.id, texto: e.nombre }))} />}
        </Campo>
      )}
      {empresas.length === 0 && <p className="s-apoyo">Ninguna de las empresas que llevas tiene Verifactu encendido: no hay nada que comprobar.</p>}
      <Campo etiqueta="Mes" ayuda="El de la fecha de las facturas.">
        {(c) => <Selector {...c} valor={mes} alCambiar={(v) => { olvidar(); setMes(v) }} opciones={meses.map((m) => ({ valor: m.valor, texto: m.texto }))} />}
      </Campo>
      <div className="cxvf-cuadre" data-prueba="cuadre" data-estado={cuadre?.estado} data-tono={texto?.tono} role="status" aria-live="polite">
        {!leido && !fallo && <p className="s-apoyo">Mirando si ya se preguntó…</p>}
        {leido && !cuadre && !fallo && <p className="s-apoyo">Ese mes todavía no se ha comprobado.</p>}
        {texto && cuadre && (
          <>
            <p className="cxvf-cuadre-titulo" data-prueba="cuadre-titulo">{texto.titulo}</p>
            <p>{texto.frase}</p>
            {cuadre.terminado_at && <p className="s-tarjeta-apoyo">Preguntado por {cuadre.pedido_por ?? 'alguien de la cuenta'} · {new Date(cuadre.pedido_at).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })}</p>}
          </>
        )}
        {filas.length > 0 && (
          <ul className="cxvf-descuadre" data-prueba="cuadre-descuadre">
            {filas.map((f) => (
              <li key={`${f.numero}:${f.fecha}`}>
                <span><span className="cxvf-descuadre-num">{f.invoiceId && !desdeAccount ? <Link to={rutaFacturaVenta(f.invoiceId)}>{f.numero}</Link> : f.numero}</span> · {f.fecha}</span>
                <span>{f.que}</span>
                <span className="s-tarjeta-apoyo">{f.hacer}</span>
              </li>
            ))}
          </ul>
        )}
        {fallo && <p className="s-aviso-lista" data-tono="falta" role="alert">{fallo}</p>}
      </div>
    </Dialogo>
  )
}
