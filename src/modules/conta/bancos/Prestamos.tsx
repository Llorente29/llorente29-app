// src/modules/conta/bancos/Prestamos.tsx
//
// S01e · Cada contrato de la lista abre su ficha (FichaContrato, tablero 5).
//
// S01d · Bancos › Préstamos y aplazamientos (tablero 3). Arriba, las cuotas
// del mes, la próxima y lo que queda por pagar; debajo, cada contrato con
// cómo se casa. «Subir el cuadro» lee el Excel del banco (con el mismo lector
// que el extracto) y lo enseña al lado para revisar: nada se guarda hasta
// «Confirmar y crear el contrato», y no se guarda un cuadro cuyo capital no
// sume lo aplazado (la base lo vuelve a comprobar).

import { useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { rutaBancos } from '@/config/navegacion'
import { useBancos } from '@/modules/conta/bancos/contexto'
import { useLeerConservando } from '@/modules/conta/bancos/useLeerConservando'
import { eurosExactos, diaMesCorto, fechaLarga } from '@/modules/conta/lib/formato'
import { ultimosIban } from '@/modules/conta/lib/bancosVista'
import { avisoDeCuotas, comoSeCasa, comprobarCuadroLeido, proximaCuota, quedaPorPagar, resumen, TIPOS } from '@/modules/conta/lib/contratos'
import { leerImporte, textoImporte } from '@/modules/conta/lib/reparto'
import { guardarContrato, leerContratos, type ContratoNuevo } from '@/modules/conta/services/contratosService'
import { leerFicheroCuadro, type Leido } from '@/modules/conta/bancos/leerFicheroCuadro'
import type { ContratoVista } from '@/modules/conta/lib/contratos'
import { ErrorConReintento, Hueso } from '@/modules/conta/ui/piezas'

const euros = (c: number) => eurosExactos(c / 100)
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

export function Prestamos() {
  const { accountId, companyId, hoy, datos, vuelta, recargar } = useBancos()
  const contratos = useLeerConservando(() => leerContratos(accountId, companyId), `${accountId}:${companyId}`, String(vuelta))
  const [leido, setLeido] = useState<Leido | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hecho, setHecho] = useState<string | null>(null)
  const [leyendo, setLeyendo] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const subir = async (f: File) => {
    setError(null); setHecho(null); setLeyendo(/\.pdf$/i.test(f.name))
    try { setLeido(await leerFicheroCuadro(accountId, f)) } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setLeyendo(false); if (input.current) input.current.value = '' }
  }

  // S01e · Cada fila abre su ficha (Bancos › Préstamos y aplazamientos › <nombre>), como página.
  const [query] = useSearchParams()
  const navegar = useNavigate()
  const enlaceFicha = (id: string) => { const p = new URLSearchParams(query); p.set('contrato', id); return `${rutaBancos('prestamos')}?${p.toString()}` }
  const abrir = (id: string) => navegar(enlaceFicha(id))
  const cs = contratos.datos ?? []
  const r = resumen(cs, hoy)
  const nombreBanco = (id: string | null) => {
    const b = datos.bancos.find((x) => x.id === id)
    if (!b) return null
    const u = ultimosIban(b.iban)
    return `${b.nombre}${u ? ` ·${u}` : ''}`
  }

  return (
    <div className="cxpr-pagina">
      <div className="cxpr-principal">
        <div className="cxpr-cabeza">
          <button type="button" className="cx-boton" onClick={() => input.current?.click()} disabled={leyendo}>{leyendo ? 'Leyendo el PDF…' : 'Subir el cuadro'}</button>
          <input ref={input} type="file" className="cx-oculto" accept=".xlsx,.xls,.pdf" aria-label="Fichero del cuadro"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void subir(f) }} />
        </div>
        {error && <div className="cx-error" role="alert">{error}</div>}
        {hecho && <div className="cxpr-hecho" role="status">{hecho}</div>}
        {contratos.error ? <ErrorConReintento mensaje={contratos.error} reintentar={contratos.recargar} /> : !contratos.datos ? (
          <div className="cx-tarjeta" aria-busy="true" aria-label="Cargando los contratos">{[0, 1, 2].map((i) => <Hueso key={i} alto={40} />)}</div>
        ) : (
          <>
            <div className="cxpr-cifras">
              <div className="cxpr-cifra">
                <span>Cuotas de {MESES[Number(hoy.slice(5, 7)) - 1]}</span>
                <strong className="cx-cifra">{euros(r.mes.totalCent)}</strong>
                <small>{r.mes.cuotas === 1 ? '1 cuota' : `${r.mes.cuotas} cuotas`}</small>
              </div>
              <div className="cxpr-cifra">
                <span>Próxima cuota</span>
                <strong className="cx-cifra">{r.proxima ? euros(r.proxima.fila.cuotaCent) : '—'}</strong>
                <small>{r.proxima ? `${diaMesCorto(r.proxima.fila.fecha)} · ${r.proxima.nombre}` : 'Ninguna por delante'}</small>
              </div>
              <div className="cxpr-cifra">
                <span>Lo que queda por pagar</span>
                <strong className="cx-cifra">{euros(r.quedaCent)}</strong>
                <small>{r.contratos === 1 ? '1 contrato' : `${r.contratos} contratos`}</small>
              </div>
            </div>
            {cs.length === 0 ? (
              <div className="cx-tarjeta cxpr-vacio">
                <p><strong>Aún no hay ningún préstamo ni aplazamiento.</strong></p>
                <p className="cx-ayuda">Sube su cuadro (el Excel del banco, con fecha, cuota, capital e intereses): cada cuota se casará sola con su fila.</p>
              </div>
            ) : (
              <table className="cxpr-tabla">
                <thead><tr><th>Contrato</th><th>Tipo</th><th className="cxpr-num">Queda por pagar</th><th>Próxima cuota</th><th>Cómo se casa</th></tr></thead>
                <tbody>
                  {cs.map((c) => {
                    const p = proximaCuota(c, hoy)
                    const queda = quedaPorPagar(c, hoy)
                    const como = comoSeCasa(c)
                    const banco = nombreBanco(c.bancoId)
                    return (
                      <tr key={c.id} className="cxpr-fila-enlace" onClick={() => abrir(c.id)}>
                        <td><Link to={enlaceFicha(c.id)} className="cxpr-nombre" onClick={(e) => e.stopPropagation()}><strong>{c.nombre}</strong></Link>{avisoDeCuotas(c) && <span className="cxpr-aviso">{avisoDeCuotas(c)}</span>}</td>
                        <td className="cxpr-tipo">{TIPOS[c.tipo]}{banco ? ` · ${banco}` : ''}</td>
                        <td className="cxpr-num cx-cifra">{queda === null ? '—' : euros(queda)}</td>
                        <td>{c.tipo === 'poliza' ? <span className="cx-ayuda">Sin cuota fija</span> : p ? `${diaMesCorto(p.fecha)} · ${euros(p.cuotaCent)}` : 'Pagado'}</td>
                        <td className={como.sola ? 'cxpr-sola' : 'cxpr-mano'}>{como.texto}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>
      {leido && (
        <CuadroLeido key={leido.fichero} leido={leido} contratos={cs.filter((c) => c.tipo !== 'poliza' && c.cuadro?.length)} alCerrar={() => setLeido(null)}
          alGuardar={async (c) => { const m = await guardarContrato(companyId, c); setLeido(null); setHecho(m); contratos.recargar(); recargar() }} />
      )}
    </div>
  )
}

/** El panel de la derecha: lo leído, para revisar y confirmar. */
function CuadroLeido({ leido, contratos, alCerrar, alGuardar }: {
  leido: Leido; contratos: readonly ContratoVista[]; alCerrar: () => void; alGuardar: (c: ContratoNuevo) => Promise<void>
}) {
  const { datos } = useBancos()
  const sumaCapital = leido.cuadro.reduce((t, f) => t + f.capitalCent, 0)
  const [tipo, setTipo] = useState<ContratoNuevo['tipo']>(leido.tipo ?? 'prestamo')
  const [nombre, setNombre] = useState(leido.tipo === 'aplazamiento' && leido.organismo ? `Aplazamiento ${leido.organismo}` : '')
  const [contiene, setContiene] = useState('')
  // Lo aplazado: lo que dice el documento; si no lo dice (el Excel del banco), la suma del capital, para revisar.
  const [importe, setImporte] = useState(textoImporte(leido.importeCent ?? sumaCapital))
  const [bancoId, setBancoId] = useState<string>(datos.bancos[0]?.id ?? '')
  const [largo, setLargo] = useState('')
  const [corto, setCorto] = useState('')
  const [intereses, setIntereses] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // S01d-b · El total de cuotas (el del texto, si el cuadro trae menos) y la deuda pendiente del cuadro.
  const [cuotas, setCuotas] = useState(String(Math.max(leido.cuotas ?? 0, leido.cuadro.length)))
  const [pendiente, setPendiente] = useState(leido.pendienteCent == null ? '' : textoImporte(leido.pendienteCent))
  // S01d-b · «Subir el cuadro» sobre un contrato que ya existe: el del mismo nombre que dice el documento, si lo hay.
  const [destino, setDestino] = useState<string>(() => contratos.find((c) => leido.organismo && c.nombre.includes(leido.organismo))?.id ?? '')
  const existente = contratos.find((c) => c.id === destino) ?? null

  const importeCent = existente ? existente.principalCent : leerImporte(importe)
  const nCuotas = Math.max(Number(cuotas) || 0, leido.cuadro.length)
  const pendienteCent = pendiente.trim() ? leerImporte(pendiente) : null
  // Al añadir a un contrato, lo que se comprueba son todas sus filas: las que tiene y las nuevas (después de la última).
  const filasTodas = existente ? [...(existente.cuadro ?? []), ...leido.cuadro.filter((f) => f.fecha > (existente.cuadro?.at(-1)?.fecha ?? ''))] : leido.cuadro
  const cuadre = importeCent === null ? null : comprobarCuadroLeido(filasTodas, importeCent, existente ? Math.max(existente.cuotas ?? 0, filasTodas.length) : nCuotas, pendienteCent)
  const nuevas = existente ? filasTodas.length - (existente.cuadro?.length ?? 0) : leido.cuadro.length
  const aviso = cuadre?.parcial ? avisoDeCuotas({ tipo: 'aplazamiento', cuotas: existente ? Math.max(existente.cuotas ?? 0, filasTodas.length) : nCuotas, cuadro: filasTodas }) : null
  const existe = (c: string) => datos.nombres[c.trim()] !== undefined
  const plan = useMemo(() => Object.entries(datos.nombres).filter(([c]) => c.length >= 8).map(([codigo, n]) => ({ codigo, n })), [datos.nombres])
  const falta = existente ? (nuevas === 0 ? `Este cuadro no trae ninguna cuota después de la última que ya tiene «${existente.nombre}».` : !cuadre?.cuadra ? 'El cuadro no cuadra.' : null)
    : !nombre.trim() ? 'Ponle un nombre.' : !contiene.trim() ? 'Di qué pone el banco en el concepto de la cuota.'
    : !corto.trim() || !existe(corto) ? 'Elige la cuenta del capital a corto (520).' : !intereses.trim() || !existe(intereses) ? 'Elige la cuenta de los intereses (662).'
    : largo.trim() && !existe(largo) ? `La cuenta ${largo.trim()} no está en el plan.` : !cuadre?.cuadra ? (cuadre?.parcial ? 'El cuadro no cuadra con lo pendiente.' : 'El capital del cuadro no suma lo aplazado.') : null

  const confirmar = async () => {
    setOcupado(true); setError(null)
    try {
      await alGuardar({ contratoId: existente?.id ?? null, cuotas: nCuotas, pendienteCent, tipo, nombre: nombre.trim(), contiene: contiene.trim(), importeCent, cuadro: leido.cuadro, bancoId: bancoId || null,
        cuentaCorto: corto.trim(), cuentaLargo: largo.trim() || null, cuentaIntereses: intereses.trim(), documento: leido.fichero, documentoTipo: leido.tipoDoc })
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setOcupado(false) }
  }

  return (
    <aside className="cxpr-panel" aria-label="Cuadro leído">
      <header className="cxpr-panel-cabeza">
        <h2>{leido.tipo === 'aplazamiento' ? 'Resolución leída' : 'Cuadro leído'} · {leido.organismo ?? leido.fichero}</h2>
        <p className="cx-ayuda">Revisa y confirma. Nada se guarda hasta que confirmes.</p>
      </header>
      <datalist id="cxpr-plan">{plan.map((c) => <option key={c.codigo} value={c.codigo}>{c.n}</option>)}</datalist>
      <dl className="cxpr-datos">
        {contratos.length > 0 && (
          <div><dt>Es de</dt><dd>
            <select className="cx-input" value={destino} onChange={(e) => setDestino(e.target.value)} aria-label="Es de">
              <option value="">Un contrato nuevo</option>
              {contratos.map((c) => <option key={c.id} value={c.id}>{c.nombre} (añadir las cuotas nuevas)</option>)}
            </select></dd></div>
        )}
        {existente ? (
          <>
            <div><dt>Importe aplazado</dt><dd className="cx-cifra">{existente.principalCent === null ? '—' : euros(existente.principalCent)}</dd></div>
            <div><dt>Número de cuotas</dt><dd className="cx-cifra">{existente.cuotas ?? '—'}</dd></div>
            <div><dt>Cuotas nuevas</dt><dd className="cx-cifra">{nuevas} (ya tiene {existente.cuadro?.length ?? 0})</dd></div>
          </>
        ) : (
          <>
            <div><dt>Qué es</dt><dd>
              <select className="cx-input" value={tipo} onChange={(e) => setTipo(e.target.value as ContratoNuevo['tipo'])} aria-label="Qué es">
                <option value="prestamo">Préstamo</option><option value="aplazamiento">Aplazamiento</option>
              </select></dd></div>
            <div><dt>Nombre</dt><dd><input className="cx-input" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Préstamo del banco" aria-label="Nombre" /></dd></div>
            <div><dt>Lo que pone el banco</dt><dd><input className="cx-input" value={contiene} onChange={(e) => setContiene(e.target.value)} placeholder="AMORTIZACION PRESTAMO" aria-label="Lo que pone el banco" /></dd></div>
            <div><dt>Importe aplazado</dt><dd><input className="cx-input cxpr-num" value={importe} onChange={(e) => setImporte(e.target.value)} inputMode="decimal" aria-label="Importe aplazado" /></dd></div>
            <div><dt>Número de cuotas</dt><dd><input className="cx-input cxpr-num" value={cuotas} onChange={(e) => setCuotas(e.target.value.replace(/\D/g, ''))} inputMode="numeric" aria-label="Número de cuotas" /></dd></div>
          </>
        )}
        {(existente ? (existente.cuotas ?? 0) > filasTodas.length : nCuotas > leido.cuadro.length) && (
          <div><dt>Deuda pendiente del cuadro</dt><dd><input className="cx-input cxpr-num" value={pendiente} onChange={(e) => setPendiente(e.target.value)} inputMode="decimal" aria-label="Deuda pendiente del cuadro" /></dd></div>
        )}
        <div><dt>Primera cuota</dt><dd className="cx-cifra">{fechaLarga(leido.cuadro[0].fecha)}</dd></div>
        {!existente && (
          <>
            <div><dt>Se carga en</dt><dd>
              <select className="cx-input" value={bancoId} onChange={(e) => setBancoId(e.target.value)} aria-label="Se carga en">
                {datos.bancos.map((b) => <option key={b.id} value={b.id}>{b.nombre}{ultimosIban(b.iban) ? ` ·${ultimosIban(b.iban)}` : ''}</option>)}
              </select></dd></div>
            <div><dt>Capital a largo</dt><dd><input className="cx-input" list="cxpr-plan" value={largo} onChange={(e) => setLargo(e.target.value)} placeholder="170…" aria-label="Capital a largo" /></dd></div>
            <div><dt>Capital a corto</dt><dd><input className="cx-input" list="cxpr-plan" value={corto} onChange={(e) => setCorto(e.target.value)} placeholder="520…" aria-label="Capital a corto" /></dd></div>
            <div><dt>Intereses</dt><dd><input className="cx-input" list="cxpr-plan" value={intereses} onChange={(e) => setIntereses(e.target.value)} placeholder="662…" aria-label="Intereses" /></dd></div>
          </>
        )}
      </dl>
      <div className="cxpr-cuadro">
        <table>
          <thead><tr><th>Fecha</th><th className="cxpr-num">Cuota</th><th className="cxpr-num">Capital</th><th className="cxpr-num">Intereses</th></tr></thead>
          <tbody>
            {leido.cuadro.map((f) => (
              <tr key={f.fecha}><td>{fechaLarga(f.fecha)}</td><td className="cxpr-num cx-cifra">{euros(f.cuotaCent)}</td>
                <td className="cxpr-num cx-cifra">{euros(f.capitalCent)}</td><td className="cxpr-num cx-cifra">{euros(f.interesesCent)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      {cuadre && (
        <p className={cuadre.cuadra ? 'cxpr-cuadra' : 'cxpr-no-cuadra'} role="status">{cuadre.texto}</p>
      )}
      {aviso && cuadre?.cuadra && <p className="cxpr-aviso-panel">{aviso}</p>}
      {falta && <p className="cx-ayuda">{falta}</p>}
      {error && <div className="cx-error" role="alert">{error}</div>}
      <footer className="cxpr-panel-pie">
        {leido.url ? <a className="cx-boton-sec" href={leido.url} target="_blank" rel="noreferrer">Ver el PDF</a>
          : <button type="button" className="cx-boton-sec" onClick={alCerrar} disabled={ocupado}>Cancelar</button>}
        <button type="button" className="cx-boton" disabled={falta !== null || ocupado} onClick={confirmar}>{ocupado ? 'Guardando…' : existente ? `Añadir ${nuevas === 1 ? '1 cuota' : `${nuevas} cuotas`} a «${existente.nombre}»` : 'Confirmar y crear el contrato'}</button>
      </footer>
    </aside>
  )
}
