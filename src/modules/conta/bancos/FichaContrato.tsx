// src/modules/conta/bancos/FichaContrato.tsx
//
// S01e · La ficha de un préstamo o aplazamiento, con su cuadro (tablero 5 del
// lienzo «Sumied · S01d · Repartir y préstamos», aprobado por Julio el 30/10).
// Es una página (Bancos › Préstamos y aplazamientos › <nombre>), no una
// ventana: la abre cada fila de la lista con ?contrato=<id>.
//
//   · Cabecera: nombre; tipo, día y cuenta de cargo; documento y fecha de
//     subida. «Subir un cuadro nuevo» y «Más acciones» (las cuentas, lo que
//     pone el banco, dar por terminado, descargar).
//   · Cuatro cifras: lo que queda (con su corto y su largo), la próxima cuota,
//     las cuotas pagadas y los intereses que quedan.
//   · El cuadro entero, con su estado por fila (pagada con su asiento y su
//     movimiento, por aclarar si el banco cobró otra cifra, la próxima,
//     pendiente), filtros y «Descargar Excel». En móvil, en tarjetas.
//
// Sin inventar: un aplazamiento con el cuadro de un solo año dice «a corto, al
// menos …» y que faltan las cuotas del año siguiente; de las cuotas de antes del
// cuadro solo se dice que están en contabilidad.

import { useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { rutaAsiento, rutaBancos } from '@/config/navegacion'
import { useBancos } from '@/modules/conta/bancos/contexto'
import { useLeerConservando } from '@/modules/conta/bancos/useLeerConservando'
import { leerFicheroCuadro, type Leido } from '@/modules/conta/bancos/leerFicheroCuadro'
import { EncabezadoPagina, BotonPulgar } from '@/modules/conta/marco/EncabezadoPagina'
import type { GrupoDeAcciones } from '@/modules/conta/marco/acciones'
import { Boton, Chip, Dialogo } from '@/modules/conta/diseno'
import { eurosExactos } from '@/modules/conta/lib/formato'
import { ultimosIban } from '@/modules/conta/lib/bancosVista'
import { comprobarCuadroLeido, TIPOS, type ContratoVista } from '@/modules/conta/lib/contratos'
import { cambioDeCuadro, cifrasDeLaFicha, filasDeLaFicha, filtrarFilas, nombreExcelCuadro, quedaDespues, type FilaFicha, type FiltroFicha, type PagoDeFila } from '@/modules/conta/lib/fichaContrato'
import { leerImporte, textoImporte } from '@/modules/conta/lib/reparto'
import { cambiarCuadro, cambiarDatosContrato, leerFicha } from '@/modules/conta/services/contratosService'
import { exportarTabla } from '@/modules/conta/ui/tabla/exportar'
import { ErrorConReintento, Hueso } from '@/modules/conta/ui/piezas'

const euros = (c: number) => eurosExactos(c / 100)
const corta = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}`

type QueDialogo = 'cuentas' | 'banco' | 'terminar' | null

export function FichaContrato({ id, alVolver }: { id: string; alVolver: string }) {
  const { accountId, companyId, hoy, datos, movil, vuelta, recargar } = useBancos()
  const [paso, setPaso] = useState(0)
  const ficha = useLeerConservando(() => leerFicha(accountId, companyId, id), `${accountId}:${companyId}:${id}`, `${vuelta}:${paso}`)
  const [filtro, setFiltro] = useState<FiltroFicha>('todas')
  const [hecho, setHecho] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [leido, setLeido] = useState<Leido | null>(null)
  const [leyendo, setLeyendo] = useState(false)
  const [dialogo, setDialogo] = useState<QueDialogo>(null)
  const input = useRef<HTMLInputElement>(null)

  const c = ficha.datos?.contrato ?? null
  const filas = useMemo(() => (c?.cuadro ? filasDeLaFicha(c.cuadro, ficha.datos!.pagos, ficha.datos!.sinCasar, hoy) : []), [c, ficha.datos, hoy])
  const cifras = c ? cifrasDeLaFicha(c, filas, hoy) : null
  const despues = useMemo(() => (c?.cuadro ? quedaDespues(c, c.cuadro) : []), [c])
  const banco = c ? datos.bancos.find((b) => b.id === c.bancoId) ?? null : null
  const nombreBanco = banco ? `${banco.nombre}${ultimosIban(banco.iban) ? ` ·${ultimosIban(banco.iban)}` : ''}` : null

  const subir = async (f: File) => {
    setError(null); setHecho(null); setLeyendo(/\.pdf$/i.test(f.name))
    try { setLeido(await leerFicheroCuadro(accountId, f)) } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setLeyendo(false); if (input.current) input.current.value = '' }
  }
  const tras = (m: string) => { setHecho(m); setDialogo(null); setLeido(null); setPaso((p) => p + 1); recargar() }

  const descargar = () => {
    if (!c) return
    exportarTabla('xlsx', {
      nombre: nombreExcelCuadro(c.nombre), titulo: `Cuadro de amortización · ${c.nombre}`, subtitulo: `${TIPOS[c.tipo]} · ${c.cuotas ?? filas.length} cuotas`,
      columnas: [{ titulo: 'Fecha' }, { titulo: 'Cuota', cifra: true }, { titulo: 'Capital', cifra: true }, { titulo: 'Intereses', cifra: true }, { titulo: 'Queda después', cifra: true }, { titulo: 'Estado' }],
      filas: filas.map((f, i) => [corta(f.fecha), f.cuotaCent / 100, f.capitalCent / 100, f.interesesCent / 100, despues[i] === null ? null : despues[i]! / 100, textoEstado(f)]),
    })
  }

  const mas: GrupoDeAcciones[] = c ? [
    { titulo: 'El contrato', acciones: [
      { id: 'cuentas', etiqueta: 'Cambiar las cuentas', alPulsar: () => setDialogo('cuentas'), dato: 'El capital a corto y a largo, y los intereses', grupo: 'El contrato' },
      { id: 'banco', etiqueta: 'Lo que pone el banco', alPulsar: () => setDialogo('banco'), dato: `Ahora: «${c.contiene}»`, grupo: 'El contrato' },
      ...(c.activo !== false ? [{ id: 'terminar', etiqueta: 'Dar por terminado', alPulsar: () => setDialogo('terminar'), dato: 'Deja de salir en la lista y de casar cuotas', grupo: 'El contrato' }] : []),
    ] },
    { titulo: 'Descargar', acciones: [{ id: 'excel', etiqueta: 'Descargar el cuadro (Excel)', alPulsar: descargar, grupo: 'Descargar' }] },
  ] : []
  const principal = c && c.tipo !== 'poliza'
    ? <Boton variante="principal" icono="subir" disabled={leyendo} onClick={() => input.current?.click()}>{leyendo ? 'Leyendo el PDF…' : 'Subir un cuadro nuevo'}</Boton>
    : null

  const encabezado = (cuerpo: ReactNode) => (
    <div className="s-pagina cxb-pagina">
      <EncabezadoPagina titulo={c?.nombre ?? 'Préstamo o aplazamiento'} frase={c ? fraseDe(c, nombreBanco) : ''} migasExtra={[{ etiqueta: c?.nombre ?? '…' }]}
        masAcciones={mas} principal={principal} />
      {cuerpo}
      {principal && <BotonPulgar>{principal}</BotonPulgar>}
    </div>
  )
  if (ficha.error) return encabezado(<ErrorConReintento mensaje={ficha.error} reintentar={ficha.recargar} />)
  if (!ficha.datos && ficha.leyendo) return encabezado(<div className="cx-tarjeta" aria-busy="true" aria-label="Cargando el contrato">{[0, 1, 2].map((i) => <Hueso key={i} alto={40} />)}</div>)
  if (!c || !cifras) return encabezado(<div className="cx-tarjeta"><p><strong>Ese contrato no está.</strong></p><Link to={alVolver}>Volver a Préstamos y aplazamientos</Link></div>)

  const vistas = filtrarFilas(filas, filtro)

  return encabezado(
    <div className={`cxfc-pagina${leido ? ' cxfc-con-panel' : ''}`}>
      <input ref={input} type="file" className="cx-oculto" accept=".xlsx,.xls,.pdf" aria-label="Fichero del cuadro nuevo"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void subir(f) }} />
      <div className="cxfc-principal">
        {error && <div className="cx-error" role="alert">{error}</div>}
        {hecho && <div className="cxpr-hecho" role="status">{hecho}</div>}
        {c.activo === false && <div className="cxfc-terminado" role="status">Dado por terminado: no sale en la lista ni casa cuotas.</div>}

        <div className="cxfc-cifras">
          <div className="cxpr-cifra">
            <span>Queda por pagar</span>
            <strong className="cx-cifra">{cifras.quedaCent === null ? '—' : euros(cifras.quedaCent)}</strong>
            <small>{cifras.parcial
              ? `a corto, al menos ${euros(cifras.cortoCent)}: faltan las cuotas de ${cifras.anioQueFalta}`
              : `a corto ${euros(cifras.cortoCent)} · a largo ${cifras.largoCent === null ? '—' : euros(cifras.largoCent)}`}</small>
          </div>
          <div className="cxpr-cifra">
            <span>Próxima cuota</span>
            <strong className="cx-cifra">{cifras.proxima ? euros(cifras.proxima.cuotaCent) : '—'}</strong>
            <small>{cifras.proxima ? `${corta(cifras.proxima.fecha).slice(0, 5)} · ${euros(cifras.proxima.capitalCent)} capital + ${euros(cifras.proxima.interesesCent)} intereses` : 'Ninguna por delante'}</small>
          </div>
          <div className="cxpr-cifra">
            <span>Cuotas</span>
            <strong className="cx-cifra">{cifras.pagadas} de {cifras.filas} pagadas</strong>
            <small>{cifras.parcial ? `el contrato tiene ${cifras.cuotas}; la última del cuadro, el ${cifras.ultimaFecha ? corta(cifras.ultimaFecha) : '—'}` : `la última, el ${cifras.ultimaFecha ? corta(cifras.ultimaFecha) : '—'}`}</small>
          </div>
          <div className="cxpr-cifra">
            <span>Intereses que quedan</span>
            <strong className="cx-cifra">{euros(cifras.interesesQuedanCent)}</strong>
            <small>{cifras.parcial ? `de las cuotas del cuadro · este año: ${euros(cifras.interesesEsteAnioCent)}` : `este año: ${euros(cifras.interesesEsteAnioCent)}`}</small>
          </div>
        </div>

        <p className="cxfc-cuentas">
          Cuentas: capital a corto <strong>{c.cuentaCorto ?? '—'}</strong>
          {c.cuentaLargo && <> · a largo <strong>{c.cuentaLargo}</strong></>}
          {' · '}intereses <strong>{c.cuentaIntereses ?? '—'}</strong> · el banco pone «{c.contiene}»
        </p>

        <section className="cxfc-cuadro" aria-label="Cuadro de amortización">
          <header className="cxfc-cuadro-cabeza">
            <h2>Cuadro de amortización</h2>
            <div className="cxfc-filtros" role="group" aria-label="Qué cuotas">
              {(['todas', 'pagadas', 'pendientes'] as const).map((f) => (
                <button key={f} type="button" className="cxfc-filtro" aria-pressed={filtro === f} onClick={() => setFiltro(f)}>
                  {f === 'todas' ? 'Todas' : f === 'pagadas' ? 'Pagadas' : 'Pendientes'} · {filtrarFilas(filas, f).length}
                </button>
              ))}
              <button type="button" className="cxfc-filtro" onClick={descargar}>Descargar Excel</button>
            </div>
          </header>
          <p className="cxfc-antes">Las cuotas de antes del cuadro están en contabilidad.</p>
          {movil ? (
            <ul className="cxfc-tarjetas">
              {vistas.map((f) => (
                <li key={f.fecha} className={f.estado.tipo === 'proxima' ? 'cxfc-tarjeta cxfc-es-proxima' : 'cxfc-tarjeta'}>
                  <div className="cxfc-tarjeta-arriba"><strong>{corta(f.fecha)}</strong><strong className="cx-cifra">{euros(f.cuotaCent)}</strong></div>
                  <div className="cxfc-tarjeta-abajo">
                    <span>{euros(f.capitalCent)} capital · {euros(f.interesesCent)} intereses</span>
                    <Estado f={f} />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <table className="cxfc-tabla">
              <thead><tr><th>Fecha</th><th className="cxpr-num">Cuota</th><th className="cxpr-num">Capital</th><th className="cxpr-num">Intereses</th><th className="cxpr-num">Queda después</th><th>Estado</th></tr></thead>
              <tbody>
                {vistas.map((f) => {
                  const i = filas.indexOf(f)
                  return (
                    <tr key={f.fecha} className={f.estado.tipo === 'proxima' ? 'cxfc-es-proxima' : undefined}>
                      <td>{corta(f.fecha)}</td>
                      <td className="cxpr-num cx-cifra">{euros(f.cuotaCent)}</td>
                      <td className="cxpr-num cx-cifra">{euros(f.capitalCent)}</td>
                      <td className="cxpr-num cx-cifra">{euros(f.interesesCent)}</td>
                      <td className="cxpr-num cx-cifra">{despues[i] === null || despues[i] === undefined ? '—' : euros(despues[i]!)}</td>
                      <td><Estado f={f} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          {vistas.length === 0 && <p className="cxfc-vacio">{filtro === 'pagadas' ? 'Aún no hay ninguna cuota pagada.' : 'No queda ninguna cuota por pagar.'}</p>}
          {cifras.parcial && (
            <footer className="cxfc-falta">
              <span>Faltan las cuotas de {cifras.anioQueFalta}: sube el cuadro de ese año cuando llegue.</span>
              <Boton variante="secundario" icono="subir" onClick={() => input.current?.click()}>Subir el cuadro de {cifras.anioQueFalta}</Boton>
            </footer>
          )}
        </section>
      </div>

      {leido && <CuadroNuevo key={leido.fichero} c={c} pagos={ficha.datos!.pagos} leido={leido} alCerrar={() => setLeido(null)}
        alGuardar={async (modo, o) => tras(await cambiarCuadro(companyId, c.id, modo, leido.cuadro, { ...o, documento: leido.fichero }))} />}

      {dialogo === 'cuentas' && <DialogoCuentas c={c} alCerrar={() => setDialogo(null)}
        alGuardar={async (d) => tras(await cambiarDatosContrato(companyId, c.id, d))} />}
      {dialogo === 'banco' && <DialogoBanco c={c} alCerrar={() => setDialogo(null)}
        alGuardar={async (contiene) => tras(await cambiarDatosContrato(companyId, c.id, { contiene }))} />}
      {dialogo === 'terminar' && <DialogoTerminar c={c} alCerrar={() => setDialogo(null)}
        alGuardar={async () => tras(await cambiarDatosContrato(companyId, c.id, { activo: false }))} />}
    </div>,
  )
}

/** «Préstamo · se carga el día 3 en Cuenta principal ·6536 · cuadro de «…» subido el 30/10/2026». */
function fraseDe(c: ContratoVista, banco: string | null): string {
  const dia = c.cuadro?.[0]?.fecha ? Number(c.cuadro[0].fecha.slice(8, 10)) : null
  const partes = [TIPOS[c.tipo]]
  if (dia) partes.push(`se carga el día ${dia}${banco ? ` en ${banco}` : ''}`)
  if (c.documento || c.subidoEl) partes.push(`cuadro${c.documento ? ` de «${c.documento}»` : ''}${c.subidoEl ? ` subido el ${corta(c.subidoEl.slice(0, 10))}` : ''}`)
  return partes.join(' · ')
}

function textoEstado(f: FilaFicha): string {
  switch (f.estado.tipo) {
    case 'pagada': return f.estado.pago.asiento !== null ? `Pagada · asiento ${f.estado.pago.asiento}` : 'Pagada'
    case 'aclarar': return `El banco cobró ${euros(f.estado.cargo.importeCent)}: por aclarar`
    case 'proxima': return 'Próxima'
    case 'pendiente': return 'Pendiente'
  }
}

function enlaceMovimiento(p: { movimientoId: string; bancoId: string | null }, mes: string): string {
  const q = new URLSearchParams()
  if (p.bancoId) q.set('banco', p.bancoId)
  q.set('mes', mes); q.set('mov', p.movimientoId)
  return `${rutaBancos('movimientos')}?${q.toString()}`
}

function Estado({ f }: { f: FilaFicha }) {
  const e = f.estado
  if (e.tipo === 'pagada') {
    return (
      <span className="cxfc-estado">
        {e.pago.asientoId ? <Link to={rutaAsiento(e.pago.asientoId)} className="cxfc-chip-enlace"><Chip tono="seguro">{textoEstado(f)}</Chip></Link> : <Chip tono="seguro">Pagada</Chip>}
        <Link to={enlaceMovimiento(e.pago, e.pago.mesMovimiento)} className="cxfc-mov">el movimiento</Link>
      </span>
    )
  }
  if (e.tipo === 'aclarar') return <Link to={enlaceMovimiento(e.cargo, e.cargo.fechaCargo.slice(0, 7))} className="cxfc-chip-enlace"><Chip tono="duda">{textoEstado(f)}</Chip></Link>
  if (e.tipo === 'proxima') return <span className="cxfc-proxima">Próxima</span>
  return <span className="cxfc-pendiente">Pendiente</span>
}

/** «Subir un cuadro nuevo»: lo que cambia (lo que entra y lo que se va) antes de guardar. */
function CuadroNuevo({ c, pagos, leido, alCerrar, alGuardar }: {
  c: ContratoVista; pagos: readonly PagoDeFila[]; leido: Leido; alCerrar: () => void
  alGuardar: (modo: 'anadir' | 'sustituir', o: { amortizadoCent?: number | null; pendienteCent?: number | null }) => Promise<void>
}) {
  const cambio = cambioDeCuadro(c, leido.cuadro, pagos)
  const [amortizado, setAmortizado] = useState(cambio.amortizadoCent !== null && cambio.amortizadoCent > 0 ? textoImporte(cambio.amortizadoCent) : '0,00')
  const [pendiente, setPendiente] = useState(leido.pendienteCent == null ? '' : textoImporte(leido.pendienteCent))
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const amortizadoCent = leerImporte(amortizado) ?? 0
  const pendienteCent = pendiente.trim() ? leerImporte(pendiente) : null

  // Un aplazamiento: la misma comprobación que al darlo de alta, sobre todas sus filas (las que tiene y las nuevas).
  const todas = [...(c.cuadro ?? []), ...cambio.entran]
  const cuadreAnadir = cambio.modo === 'anadir' && c.principalCent !== null ? comprobarCuadroLeido(todas, c.principalCent, Math.max(c.cuotas ?? 0, todas.length), pendienteCent) : null
  const capitalNuevo = cambio.entran.reduce((t, f) => t + f.capitalCent, 0)
  const restoCent = c.principalCent === null ? null : c.principalCent - (c.cuadro ?? []).filter((f) => f.fecha < (leido.cuadro[0]?.fecha ?? '')).reduce((t, f) => t + f.capitalCent, 0) - amortizadoCent
  const cuadraSustituir = cambio.modo === 'sustituir' && restoCent === capitalNuevo
  const falta = cambio.entran.length === 0 ? 'Este cuadro no trae ninguna cuota nueva.'
    : cambio.pagadaQueSeIria ? `La cuota del ${corta(cambio.pagadaQueSeIria)} ya está pagada: el cuadro nuevo tiene que empezar después de ella.`
    : cambio.modo === 'anadir' ? (cuadreAnadir?.cuadra ? null : 'El cuadro no cuadra.')
    : amortizadoCent < 0 ? 'Lo amortizado de golpe no puede ser negativo.'
    : cuadraSustituir ? null : 'No cuadra: revisa lo amortizado de golpe.'

  const guardar = async () => {
    setOcupado(true); setError(null)
    try { await alGuardar(cambio.modo, cambio.modo === 'sustituir' ? { amortizadoCent } : { pendienteCent }) } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setOcupado(false) }
  }
  const rango = (fs: readonly { fecha: string }[]) => fs.length === 0 ? '' : fs.length === 1 ? ` (el ${corta(fs[0].fecha)})` : ` (del ${corta(fs[0].fecha)} al ${corta(fs.at(-1)!.fecha)})`

  return (
    <aside className="cxpr-panel" aria-label="Cuadro nuevo">
      <header className="cxpr-panel-cabeza">
        <h2>Cuadro nuevo · {leido.fichero}</h2>
        <p className="cx-ayuda">Lo que cambia en «{c.nombre}». Nada se guarda hasta que confirmes.</p>
      </header>
      <dl className="cxpr-datos">
        <div><dt>Entran</dt><dd className="cx-cifra">{cambio.entran.length} {cambio.entran.length === 1 ? 'cuota' : 'cuotas'}{rango(cambio.entran)}</dd></div>
        {cambio.modo === 'sustituir' && <div><dt>Se van</dt><dd className="cx-cifra">{cambio.seVan.length} pendientes{rango(cambio.seVan)}</dd></div>}
        {cambio.modo === 'sustituir' && (
          <div><dt>Amortizado de golpe antes de este cuadro</dt><dd><input className="cx-input cxpr-num" value={amortizado} onChange={(e) => setAmortizado(e.target.value)} inputMode="decimal" aria-label="Amortizado de golpe" /></dd></div>
        )}
        {cambio.modo === 'anadir' && cuadreAnadir?.parcial && (
          <div><dt>Deuda pendiente del cuadro</dt><dd><input className="cx-input cxpr-num" value={pendiente} onChange={(e) => setPendiente(e.target.value)} inputMode="decimal" aria-label="Deuda pendiente del cuadro" /></dd></div>
        )}
      </dl>
      {cambio.modo === 'sustituir' && restoCent !== null && (
        <p className={cuadraSustituir ? 'cxpr-cuadra' : 'cxpr-no-cuadra'} role="status">
          {cuadraSustituir
            ? `Lo prestado menos el capital de las cuotas que se quedan y lo amortizado de golpe da ${euros(restoCent)}: es el capital del cuadro nuevo.`
            : `Lo prestado menos el capital de las cuotas que se quedan y lo amortizado de golpe da ${euros(restoCent)}, y el cuadro nuevo suma ${euros(capitalNuevo)}.`}
        </p>
      )}
      {cuadreAnadir && <p className={cuadreAnadir.cuadra ? 'cxpr-cuadra' : 'cxpr-no-cuadra'} role="status">{cuadreAnadir.texto}</p>}
      {falta && <p className="cx-ayuda">{falta}</p>}
      {error && <div className="cx-error" role="alert">{error}</div>}
      <footer className="cxpr-panel-pie">
        <button type="button" className="cx-boton-sec" onClick={alCerrar} disabled={ocupado}>Cancelar</button>
        <button type="button" className="cx-boton" disabled={falta !== null || ocupado} onClick={guardar}>
          {ocupado ? 'Guardando…' : cambio.modo === 'sustituir' ? `Cambiar el cuadro: entran ${cambio.entran.length}, se van ${cambio.seVan.length}` : `Añadir ${cambio.entran.length === 1 ? '1 cuota' : `${cambio.entran.length} cuotas`}`}
        </button>
      </footer>
    </aside>
  )
}

function useGuardar(alGuardar: () => Promise<void>) {
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ir = async () => { setOcupado(true); setError(null); try { await alGuardar() } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setOcupado(false) } }
  return { ocupado, error, ir }
}

function DialogoCuentas({ c, alCerrar, alGuardar }: { c: ContratoVista; alCerrar: () => void; alGuardar: (d: { capitalCorto: string; capitalLargo: string | null; intereses: string }) => Promise<void> }) {
  const { datos } = useBancos()
  const [corto, setCorto] = useState(c.cuentaCorto ?? '')
  const [largo, setLargo] = useState(c.cuentaLargo ?? '')
  const [intereses, setIntereses] = useState(c.cuentaIntereses ?? '')
  const g = useGuardar(() => alGuardar({ capitalCorto: corto.trim(), capitalLargo: largo.trim() || null, intereses: intereses.trim() }))
  const existe = (x: string) => datos.nombres[x.trim()] !== undefined
  const falta = !existe(corto) ? 'Elige la cuenta del capital a corto (520).' : !existe(intereses) ? 'Elige la cuenta de los intereses (662).' : largo.trim() && !existe(largo) ? `La cuenta ${largo.trim()} no está en el plan.` : null
  const plan = useMemo(() => Object.entries(datos.nombres).filter(([k]) => k.length >= 8), [datos.nombres])
  return (
    <Dialogo titulo="Cambiar las cuentas" explicacion={`Las de «${c.nombre}». Las cuotas que ya están en contabilidad no cambian.`} alCerrar={alCerrar}
      acciones={<><Boton variante="secundario" onClick={alCerrar} disabled={g.ocupado}>Cancelar</Boton><Boton variante="principal" onClick={() => void g.ir()} disabled={falta !== null || g.ocupado}>{g.ocupado ? 'Guardando…' : 'Guardar las cuentas'}</Boton></>}>
      <datalist id="cxfc-plan">{plan.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</datalist>
      <dl className="cxpr-datos">
        <div><dt>Capital a corto</dt><dd><input className="cx-input" list="cxfc-plan" value={corto} onChange={(e) => setCorto(e.target.value)} aria-label="Capital a corto" /></dd></div>
        <div><dt>Capital a largo</dt><dd><input className="cx-input" list="cxfc-plan" value={largo} onChange={(e) => setLargo(e.target.value)} aria-label="Capital a largo" /></dd></div>
        <div><dt>Intereses</dt><dd><input className="cx-input" list="cxfc-plan" value={intereses} onChange={(e) => setIntereses(e.target.value)} aria-label="Intereses" /></dd></div>
      </dl>
      {falta && <p className="cx-ayuda">{falta}</p>}
      {g.error && <div className="cx-error" role="alert">{g.error}</div>}
    </Dialogo>
  )
}

function DialogoBanco({ c, alCerrar, alGuardar }: { c: ContratoVista; alCerrar: () => void; alGuardar: (contiene: string) => Promise<void> }) {
  const [contiene, setContiene] = useState(c.contiene)
  const g = useGuardar(() => alGuardar(contiene.trim()))
  return (
    <Dialogo titulo="Lo que pone el banco" explicacion="Lo que trae el concepto del cargo de cada cuota: con eso lo reconozco." alCerrar={alCerrar}
      acciones={<><Boton variante="secundario" onClick={alCerrar} disabled={g.ocupado}>Cancelar</Boton><Boton variante="principal" onClick={() => void g.ir()} disabled={!contiene.trim() || g.ocupado}>{g.ocupado ? 'Guardando…' : 'Guardar'}</Boton></>}>
      <input className="cx-input" value={contiene} onChange={(e) => setContiene(e.target.value)} aria-label="Lo que pone el banco" />
      {g.error && <div className="cx-error" role="alert">{g.error}</div>}
    </Dialogo>
  )
}

function DialogoTerminar({ c, alCerrar, alGuardar }: { c: ContratoVista; alCerrar: () => void; alGuardar: () => Promise<void> }) {
  const g = useGuardar(alGuardar)
  return (
    <Dialogo titulo={`Dar por terminado «${c.nombre}»`} explicacion="Deja de salir en la lista y sus cuotas ya no se casan solas. Lo que ya está en contabilidad no cambia." alCerrar={alCerrar}
      acciones={<><Boton variante="secundario" onClick={alCerrar} disabled={g.ocupado}>Cancelar</Boton><Boton variante="principal" onClick={() => void g.ir()} disabled={g.ocupado}>{g.ocupado ? 'Guardando…' : 'Dar por terminado'}</Boton></>}>
      {g.error && <div className="cx-error" role="alert">{g.error}</div>}
    </Dialogo>
  )
}
