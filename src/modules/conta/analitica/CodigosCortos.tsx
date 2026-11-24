// src/modules/conta/analitica/CodigosCortos.tsx
//
// K13 · El código corto de cada local, marca y plataforma (003, MIL, GLO; 20261123T2347): el que se escribe en la
// analítica de la recibida, como en ERP10. Sale propuesto a partir del nombre y se puede cambiar aquí, uno a uno; no se
// repite dentro de la cuenta. Vacío vuelve al propuesto. Regla 8: cada cambio dice lo que ha quedado, o por qué no.

import { useCallback, useEffect, useState } from 'react'
import { Boton, Tarjeta } from '@/modules/conta/diseno'
import { localesDeLaCuenta } from '@/modules/conta/services/diarioService'
import { plataformasDeLaCuenta } from '@/modules/conta/services/asientoGeneralService'
import { leerCodigosCortos, marcasParaPoner, ponerCodigoCorto, type CodigoCorto, type TablaCodigo } from '@/modules/conta/nucleo/recibida/servicio'

interface Fila { tabla: TablaCodigo; id: string; nombre: string }
const QUE: Record<TablaCodigo, string> = { locations: 'Locales', brand: 'Marcas', sales_channel: 'Plataformas' }
const ORIGEN: Record<CodigoCorto['origen'], string> = { propuesto: 'propuesto', a_mano: 'a mano', erp10: 'de ERP10' }

export function CodigosCortos({ accountId }: { accountId: string }) {
  const [filas, setFilas] = useState<Fila[] | null>(null)
  const [codigos, setCodigos] = useState<CodigoCorto[]>([])
  const [error, setError] = useState<string | null>(null)
  const [vuelta, setVuelta] = useState(0)
  const recargar = useCallback(() => setVuelta((v) => v + 1), [])

  useEffect(() => {
    let vivo = true
    Promise.all([localesDeLaCuenta(accountId), marcasParaPoner(accountId), plataformasDeLaCuenta(accountId), leerCodigosCortos(accountId)])
      .then(([l, m, p, c]) => {
        if (!vivo) return
        setFilas([
          ...l.map((x) => ({ tabla: 'locations' as const, id: x.id, nombre: x.nombre })),
          ...m.map((x) => ({ tabla: 'brand' as const, id: x.id, nombre: x.nombre })),
          ...p.map((x) => ({ tabla: 'sales_channel' as const, id: x.id, nombre: x.descripcion })),
        ])
        setCodigos(c); setError(null)
      }, (e: unknown) => { if (vivo) setError(e instanceof Error ? e.message : String(e)) })
    return () => { vivo = false }
  }, [accountId, vuelta])

  return (
    <Tarjeta titulo="Códigos cortos" apoyo="El código de cada local, marca y plataforma: se escribe en la analítica de la recibida (código e Intro), como en ERP10. Sale propuesto a partir del nombre; aquí lo cambias. No se repite en la cuenta.">
      {error && <p className="s-fallo" role="alert">No se han podido leer los códigos: {error}</p>}
      {!error && !filas && <p className="s-apoyo" aria-busy="true">Leyendo los códigos…</p>}
      {!error && filas && !codigos.length && <p className="s-apoyo">Esta base aún no tiene los códigos cortos (la tanda del K13).</p>}
      {!error && filas && codigos.length > 0 && (['locations', 'brand', 'sales_channel'] as const).map((t) => {
        const suyas = filas.filter((f) => f.tabla === t)
        if (!suyas.length) return null
        return (
          <table key={t} className="s-tabla" aria-label={`Códigos cortos · ${QUE[t]}`} data-prueba={`codigos-${t}`}>
            <thead><tr><th>{QUE[t]}</th><th>Código</th><th>Origen</th><th /></tr></thead>
            <tbody>{suyas.map((f) => <FilaCodigo key={f.id} fila={f} codigo={codigos.find((c) => c.tabla === t && c.id === f.id) ?? null} alGuardar={recargar} />)}</tbody>
          </table>
        )
      })}
    </Tarjeta>
  )
}

function FilaCodigo({ fila, codigo, alGuardar }: { fila: Fila; codigo: CodigoCorto | null; alGuardar: () => void }) {
  const [texto, setTexto] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [dice, setDice] = useState<{ bien: boolean; texto: string } | null>(null)
  const valor = texto ?? codigo?.codigo ?? ''
  const guardar = async () => {
    setOcupado(true); setDice(null)
    try { const r = await ponerCodigoCorto(fila.tabla, fila.id, valor); setDice({ bien: true, texto: r.texto }); setTexto(null); alGuardar() }
    catch (e) { setDice({ bien: false, texto: `No se ha guardado: ${e instanceof Error ? e.message : String(e)}` }) }
    finally { setOcupado(false) }
  }
  return (
    <tr>
      <td>{fila.nombre}</td>
      <td><input aria-label={`Código corto de ${fila.nombre}`} value={valor} maxLength={8} size={8} disabled={ocupado} autoCapitalize="characters"
        onChange={(e) => setTexto(e.target.value.toUpperCase())} onKeyDown={(e) => { if (e.key === 'Enter' && texto !== null) { e.preventDefault(); void guardar() } }} /></td>
      <td>{codigo ? ORIGEN[codigo.origen] : 'sin código'}</td>
      <td>
        <Boton variante="secundario" disabled={ocupado || texto === null || texto === (codigo?.codigo ?? '')} onClick={() => void guardar()}>{ocupado ? 'Guardando…' : 'Guardar'}</Boton>
        <span role="status" aria-live="polite">{dice && <span className={dice.bien ? 's-hecho' : 's-fallo'}> {dice.texto}</span>}</span>
      </td>
    </tr>
  )
}
