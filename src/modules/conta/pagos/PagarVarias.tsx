// src/modules/conta/pagos/PagarVarias.tsx
//
// B01 Revolut · PR 3b · PAGAR VARIAS FACTURAS A LA VEZ CON EL BANCO, desde
// Compras › Pagos (maqueta v2, pantalla 4, aprobada por Julio). Es la remesa
// de siempre con otra salida: las facturas marcadas, desde la cuenta de
// «Desde», un solo «Aprobar y pagar», y una sola segunda aprobación para todas.
//
//   · Cada factura, preparada por la base (conta_pago_preparar: lo que saldría
//     y por qué haría falta la segunda) y su titular, preguntado al banco.
//   · No sale lo que la base no deja pagar (sin IBAN, domiciliada…), ni un
//     titular que no coincide salvo «pagar igual» con su porqué. Se dice cuáles
//     y por qué; las demás salen juntas.
//   · Sin segunda aprobación, se mandan al banco en el mismo gesto; con ella,
//     la pantalla de la llave o el PIN (la da quien aprueba si es la única que
//     paga; si no, otra persona).
// Cada botón dice lo que ha pasado (regla 8).

import { useEffect, useState } from 'react'
import { Boton, Dialogo, Texto } from '@/modules/conta/diseno'
import { eurosExactos } from '@/modules/conta/lib/formato'
import {
  aprobarVarias, mandar, preparar, quienesSalen, textoTitular, titular, type FilaVarias,
} from '@/modules/conta/pagos/pagarService'
import { SegundaAprobacion } from '@/modules/conta/pagos/PagarConRevolut'

type Aviso = { tono: 'ok' | 'duda' | 'falta'; texto: string }
const ETIQUETA_IBAN: Record<string, string> = { comprobado: '✓ comprobado', primer_pago: 'nuevo', cambiado: 'cambiado' }

export function DialogoPagarVarias({ empresaId, cuenta, facturas, alCerrar }: {
  empresaId: string
  cuenta: { id: string; nombre: string; iban4: string | null; banco: string }
  facturas: readonly { id: string; proveedor: string; numero: string | null }[]
  alCerrar: (a: Aviso | null) => void
}) {
  const [filas, setFilas] = useState<FilaVarias[]>(() => facturas.map((f) => ({
    facturaId: f.id, proveedor: f.proveedor, numero: f.numero, preparado: null, error: null, titular: null, titularError: null, pagarIgual: false, porque: '',
  })))
  const [lote, setLote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [haciendo, setHaciendo] = useState(false)
  const cambiar = (id: string, c: Partial<FilaVarias>) => setFilas((xs) => xs.map((x) => (x.facturaId === id ? { ...x, ...c } : x)))

  // Una a una (el banco pregunta el titular de cada IBAN): primero lo que dice la base, después el titular.
  useEffect(() => {
    let vivo = true
    void (async () => {
      for (const f of facturas) {
        let p
        try { p = await preparar(empresaId, f.id, cuenta.id) } catch (e) { if (vivo) cambiar(f.id, { error: e instanceof Error ? e.message : String(e) }); continue }
        if (!vivo) return
        cambiar(f.id, { preparado: p })
        if (!p.sePuede) continue
        const t = await titular(empresaId, f.id, cuenta.id)
        if (!vivo) return
        cambiar(f.id, t.ok ? { titular: t.titular ?? { resultado: 'ahora_no', porque: 'sin respuesta' } } : { titularError: t.texto })
      }
    })()
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- una vez, al abrir
  }, [])

  const { salen, fuera, comprobando } = quienesSalen(filas)
  const total = salen.reduce((s, f) => s + (f.preparado?.importe ?? 0), 0)
  const motivos = [...new Set(salen.flatMap((f) => [...(f.preparado?.motivosTexto ?? []), ...(f.pagarIgual && f.titular?.resultado === 'no_coincide' ? ['pagar igual con un titular que no coincide'] : [])]))]
  const otra = salen.some((f) => f.preparado?.quien.segunda === 'otra')

  const aprobarYPagar = async () => {
    if (!salen.length) return
    setHaciendo(true); setError(null)
    try {
      const r = await aprobarVarias(empresaId, cuenta.id, salen.map((f) => ({ id: f.facturaId, pagarIgualPorque: f.pagarIgual && f.titular?.resultado === 'no_coincide' ? f.porque.trim() : null })))
      if (r.estado === 'listo') {
        const m = await mandar(empresaId, r.lote)
        alCerrar({ tono: m.ok ? 'ok' : 'falta', texto: `${r.frase} ${m.texto}` })
      } else if (r.segunda?.quien === 'otra') {
        alCerrar({ tono: 'duda', texto: r.frase })
      } else {
        setLote(r.lote)
      }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    setHaciendo(false)
  }

  if (lote) return <SegundaAprobacion empresaId={empresaId} lote={lote} alCerrar={(a) => alCerrar(a)} />
  const n = salen.length
  return (
    <Dialogo titulo={`Pagar con ${cuenta.banco}`} alCerrar={() => alCerrar(null)}
      explicacion={`Desde ${cuenta.nombre}${cuenta.iban4 ? ` ···${cuenta.iban4}` : ''}. Salen al momento, no en la fecha de pago de la remesa. Cada IBAN se comprueba con ${cuenta.banco} antes de aprobar.`}
      acciones={<>
        <Boton onClick={() => alCerrar(null)}>Cancelar</Boton>
        <Boton variante="principal" disabled={haciendo || comprobando > 0 || n === 0} onClick={() => void aprobarYPagar()} data-prueba="aprobar-y-pagar-varias">
          {haciendo ? 'Aprobando…' : comprobando > 0 ? `Comprobando ${comprobando}…` : n === 1 ? 'Aprobar y pagar 1' : `Aprobar y pagar las ${n}`}
        </Boton>
      </>}>
      <ul className="s-lista" data-prueba="lista-varias">
        {filas.map((f) => {
          const p = f.preparado
          const tt = f.titularError ? { tono: 'duda' as const, texto: f.titularError } : textoTitular(f.titular, p?.beneficiario ?? f.proveedor, cuenta.banco)
          const sale = salen.includes(f)
          const porQueNo = fuera.find((x) => x.fila === f)?.porque
          return (
            <li key={f.facturaId} data-prueba="fila-varias" data-sale={sale ? 'si' : porQueNo ? 'no' : 'comprobando'}>
              {/* Cada parte en su bloque: el aviso no puede quedar encima de la casilla (e2e 41357286790, en el ordenador). */}
              <div>
                <strong>{p?.beneficiario ?? f.proveedor}</strong> · {f.numero ?? 'sin número'}{p?.sePuede ? <> · IBAN ···{p.iban4} · {ETIQUETA_IBAN[p.ibanCheck ?? ''] ?? p.ibanCheck} · <strong>{eurosExactos(p.importe)}</strong></> : null}
                {p?.sePuede && <span className="s-apoyo"> · {tt.texto}</span>}
                {p?.sePuede && p.motivosTexto.length > 0 && <span className="s-apoyo"> · pide segunda: {p.motivosTexto.join(', ')}</span>}
                {!p && !f.error && <span className="s-apoyo"> · comprobando…</span>}
              </div>
              {porQueNo && <p className="s-aviso-lista" data-tono="duda" role="status">No sale: {porQueNo}</p>}
              {f.titular?.resultado === 'no_coincide' && (
                <div className="pg-dialogo-campos">
                  <label className="s-check"><input type="checkbox" checked={f.pagarIgual} onChange={(e) => cambiar(f.facturaId, { pagarIgual: e.target.checked })} /> Lo he comprobado con el proveedor: pagar igual</label>
                  {f.pagarIgual && <Texto aria-label={`Por qué pagar igual a ${f.proveedor}`} valor={f.porque} alCambiar={(v) => cambiar(f.facturaId, { porque: v })} maxLength={200} />}
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {comprobando === 0 && (
        <p className="s-apoyo" role="status" data-prueba="resumen-varias">
          {n === 0 ? 'No sale ninguna: mira por qué en cada una.' : `Salen ${n === 1 ? '1 pago' : `${n} pagos`}, ${eurosExactos(total)}, con una sola aprobación.`}
          {fuera.length > 0 ? ` ${fuera.length === 1 ? '1 se queda' : `${fuera.length} se quedan`} por pagar.` : ''}
        </p>
      )}
      {comprobando === 0 && motivos.length > 0 && (
        <p className="s-aviso-lista" data-tono="duda" role="status" data-prueba="pide-segunda-varias">
          {`Hace falta una segunda aprobación (${motivos.join(', ')}). `}
          {otra ? 'La da otra persona que pueda pagar, con su llave o su PIN: una sola para todos. Hasta entonces no sale nada.'
            : 'La confirmas tú con tu llave, o con tu PIN de pago: una sola para todos. Hasta entonces no sale nada.'}
        </p>
      )}
      {error && <p className="s-aviso-lista" data-tono="falta" role="alert">{error}</p>}
    </Dialogo>
  )
}
