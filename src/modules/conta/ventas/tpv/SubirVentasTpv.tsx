// src/modules/conta/ventas/tpv/SubirVentasTpv.tsx
//
// R06 · «Subir las ventas del TPV» (maqueta 2): Suelta los ficheros → Mira lo que
// he leído → Contabilizado. Los cuatro ficheros de Revo se leen en el navegador
// (leerRevo, R04) y no se guardan en ningún sitio: solo lo leído de los días que
// cuadran, con conta_tpv_dia_guardar (R03). Lo que se decide, en lib/subirTpv.ts.
//
// R15 · «Contabilizar N días»: se guardan, se apunta la subida en ellos
// (conta_tpv_subida_apuntar) y los que la base da por listos se contabilizan con
// la MISMA pieza que «Validar los N listos» (validarDiaTpv: los dos asientos y su
// PDF). Los demás quedan en espera con su motivo. Si alguno espera por una cuenta
// sin elegir, primero se abre «A qué cuenta va cada forma de pago» y, al guardarla,
// sigue solo. Los días que ya estaban guardados y sin validar no se tocan: siguen
// en «Validar los N listos».

import { useEffect, useId, useMemo, useRef, useState, type DragEvent } from 'react'
import { Boton, Chip, Icono } from '@/modules/conta/diseno'
import { leerRevo, reconocer, type FicheroRevo } from '@/modules/conta/lib/lectorRevo'
import {
  ETIQUETA_COMO_ESTA, cifra, diaCorto, huecos, juntarFicheros, numeracion, esperaPorCuenta, prepararDias, queHacerAlSubir, textoContabilizado, textoGuardado,
  type DiaContabilizado, type DiaEnEspera, type DiaParaSubir, type DiaYaGuardado, type FormaCuenta, type ResultadoDia,
} from '@/modules/conta/lib/subirTpv'
import { apuntarSubida, guardarDia, leerFormas, leerGuardados } from '@/modules/conta/services/tpvSubirService'
import { validarDiaTpv } from '@/modules/conta/services/tpvDiaService'
import { VentanaAncha } from './VentanaAncha'
import { FormasDePago } from './FormasDePago'

const FRASE = 'Los días que cuadran y tienen la cuenta de cada forma de pago se contabilizan: la factura del día, su cobro y su PDF. Los demás quedan en espera, con su motivo.'

/** Lo que dice el paso 3: lo guardado, lo contabilizado (con sus asientos), lo que espera y lo que no se ha podido. */
interface Hecho { guardado: string; cuentas?: string | null; contabilizados: string | null; enEspera: string | null; fallos: string[]; espera: DiaEnEspera[] }

const PASOS = ['Suelta los ficheros', 'Mira lo que he leído', 'Contabilizado'] as const
const TONO = { bien: 'seguro', mal: 'falta', neutro: 'neutro', duda: 'duda' } as const
const tipoTexto = (t: number) => `${t.toLocaleString('es-ES')} %`

export function SubirVentasTpv({ companyId, quien, alCerrar, alGuardar, alElegirCuentas }: {
  companyId: string
  quien: string | null
  alCerrar: () => void
  /** Después de guardar: la lista de detrás se vuelve a leer. */
  alGuardar: () => void
  /** «Cuenta sin elegir»: abre «A qué cuenta va cada forma de pago». */
  alElegirCuentas: () => void
}) {
  const [ficheros, setFicheros] = useState<FicheroRevo[]>([])
  const [guardados, setGuardados] = useState<DiaYaGuardado[] | null>(null)
  const [cuentas, setCuentas] = useState<FormaCuenta[]>([])
  const [error, setError] = useState<string | null>(null)
  const [elegido, setElegido] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [hecho, setHecho] = useState<Hecho | null>(null)
  const [progreso, setProgreso] = useState<string | null>(null)
  /** Mientras está abierta «A qué cuenta va cada forma de pago»: el día de ejemplo y lo que sigue al cerrarla. */
  const [cuentasPara, setCuentasPara] = useState<{ diaId: string | null; seguir: (texto?: string) => void } | null>(null)
  const [encima, setEncima] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const idInput = useId()

  useEffect(() => {
    let vivo = true
    Promise.all([leerGuardados(companyId), leerFormas(companyId)])
      .then(([g, f]) => { if (vivo) { setGuardados(g); setCuentas(f.formas) } })
      .catch((e: unknown) => { if (vivo) setError(e instanceof Error ? e.message : String(e)) })
    return () => { vivo = false }
  }, [companyId])

  const recon = useMemo(() => (ficheros.length ? reconocer(ficheros) : null), [ficheros])
  const dias = useMemo<DiaParaSubir[]>(() => {
    if (!recon?.ok || !guardados) return []
    const r = leerRevo(ficheros)
    return r.ok ? prepararDias(r.lectura.dias, guardados, cuentas) : []
  }, [recon, ficheros, guardados, cuentas])
  const sel = dias.find((d) => d.dia === elegido) ?? dias.find((d) => d.como !== 'no_cuadra') ?? dias[0] ?? null
  const aGuardar = dias.filter((d) => d.seGuarda)
  const paso = hecho ? 3 : dias.length ? 2 : 1

  async function soltar(lista: FileList | null) {
    if (!lista?.length) return
    const nuevos = await Promise.all([...lista].map(async (f) => ({ nombre: f.name, contenido: new Uint8Array(await f.arrayBuffer()) })))
    setFicheros((antes) => juntarFicheros(antes, nuevos))
    setElegido(null)
  }

  /** Contabilizar los días recién guardados que la base da por listos; los demás, en espera con su motivo. */
  async function contabilizarGuardados(ids: string[], base: Omit<Hecho, 'contabilizados' | 'enEspera' | 'espera'>) {
    const ahora = await leerGuardados(companyId)
    const plan = queHacerAlSubir(ahora, ids)
    const hechos: DiaContabilizado[] = []
    const fallos = [...base.fallos]
    const espera = [...plan.espera]
    for (const [i, d] of plan.contabilizar.entries()) {
      setProgreso(`Contabilizando ${i + 1} de ${plan.contabilizar.length}…`)
      try {
        const v = await validarDiaTpv(d.id, quien)
        hechos.push({ dia: d.dia, numeros: v.cobroNumero != null ? [v.numero, v.cobroNumero] : [v.numero] })
      } catch (e) {
        espera.push({ dia: d.dia, motivo: `no se ha podido contabilizar: ${e instanceof Error ? e.message : String(e)}` })
      }
    }
    const t = textoContabilizado(hechos, espera)
    setHecho({ ...base, fallos, ...t, espera })
    setProgreso(null)
    setGuardando(false)
    alGuardar()
  }

  async function contabilizar() {
    setGuardando(true)
    setProgreso('Guardando…')
    const r: ResultadoDia[] = []
    const ids: string[] = []
    for (const d of aGuardar) {
      const g = await guardarDia(companyId, d.dia, d.lectura, quien)
      if (g.ok) ids.push(g.id)
      r.push(g.ok ? { dia: d.dia, ok: true, facturas: g.facturas, total: g.total } : { dia: d.dia, ok: false, facturas: d.facturas, total: d.total, error: g.error })
    }
    for (const d of dias.filter((x) => x.como === 'no_cuadra' || x.como === 'validado_distinto')) r.push({ dia: d.dia, ok: false, facturas: d.facturas, total: d.total })
    const sinTocar = dias.filter((d) => d.como === 'igual').map((d) => d.dia)
    const base = { guardado: textoGuardado(r, sinTocar), fallos: [] as string[] }
    if (!ids.length) { setHecho({ ...base, contabilizados: null, enEspera: null, espera: [] }); setProgreso(null); setGuardando(false); alGuardar(); return }
    try {
      await apuntarSubida(companyId, ids, quien)
    } catch (e) {
      base.fallos.push(`No se ha podido apuntar la subida en sus días: ${e instanceof Error ? e.message : String(e)}`)
    }
    try {
      const plan = queHacerAlSubir(await leerGuardados(companyId), ids)
      if (plan.faltaCuenta) {
        // La primera vez con formas sin cuenta: primero las cuentas, y al guardarlas sigue solo.
        setProgreso(null)
        const ejemplo = plan.espera.find((x) => esperaPorCuenta(x.motivo))?.id ?? null
        setCuentasPara({ diaId: ejemplo, seguir: (texto) => { setCuentasPara(null); void contabilizarGuardados(ids, { ...base, cuentas: texto ?? null }) } })
        return
      }
      await contabilizarGuardados(ids, base)
    } catch (e) {
      base.fallos.push(e instanceof Error ? e.message : String(e))
      setHecho({ ...base, contabilizados: null, enEspera: null, espera: [] })
      setProgreso(null)
      setGuardando(false)
      alGuardar()
    }
  }

  const soltarProps = {
    onDragOver: (e: DragEvent) => { e.preventDefault(); setEncima(true) },
    onDragLeave: () => setEncima(false),
    onDrop: (e: DragEvent) => { e.preventDefault(); setEncima(false); void soltar(e.dataTransfer.files) },
  }

  const zona = (
    <>
      <div className="tpv-soltar" data-encima={encima ? '' : undefined} data-prueba="soltar-ficheros" {...soltarProps}>
        <span className="tpv-soltar-icono"><Icono nombre="subir" grande /></span>
        <div className="tpv-soltar-texto">
          <strong>Suelta aquí los cuatro ficheros que te da Revo</strong>
          <span>Órdenes, documentos, impuestos y pagos, del día o de los días que quieras. No hace falta cambiarles el nombre ni elegir columnas.</span>
        </div>
        <Boton variante="secundario" onClick={() => input.current?.click()}>Elegir ficheros</Boton>
        <input ref={input} id={idInput} type="file" multiple accept=".csv,text/csv,text/plain" hidden aria-label="Elegir los ficheros de Revo"
          onChange={(e) => { void soltar(e.target.files); e.target.value = '' }} />
      </div>
      {ficheros.length > 0 && recon && (
        <ul className="tpv-ficheros" aria-label="Los ficheros">
          {huecos(recon.clases).map((h) => (
            <li key={h.clase} className="tpv-fichero" data-falta={h.nombre ? undefined : ''} data-mal={h.repetido ? '' : undefined}>
              <span className="tpv-fichero-visto" aria-hidden="true"><Icono nombre={h.repetido ? 'aviso' : 'ok'} /></span>
              <span className="tpv-fichero-clase">{h.etiqueta}</span>
              <span className="tpv-fichero-nombre">{h.nombre ?? 'falta'}</span>
            </li>
          ))}
        </ul>
      )}
      {recon && !recon.ok && (
        <div className="tpv-aviso" role="alert" data-prueba="aviso-ficheros">
          {recon.problemas.map((p) => <p key={p}>{p}</p>)}
        </div>
      )}
    </>
  )

  const tabla = dias.length > 0 && (
    <>
      <h3 className="tpv-seccion-titulo">Lo que he leído · {dias.length} {dias.length === 1 ? 'día' : 'días'}</h3>
      <div className="tpv-tabla-caja">
        <table className="tpv-tabla" aria-label="Lo que he leído">
          <thead><tr><th>Día</th><th className="tpv-cifra">Facturas</th><th>Numeración</th><th className="tpv-cifra">Total</th><th>Cómo está</th></tr></thead>
          <tbody>
            {dias.map((d) => (
              <tr key={d.dia} aria-selected={sel?.dia === d.dia} tabIndex={0} onClick={() => setElegido(d.dia)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setElegido(d.dia) } }}>
                <td>{diaCorto(d.dia)}</td>
                <td className="tpv-cifra">{d.facturas}</td>
                <td>{numeracion(d.primero, d.ultimo)}</td>
                <td className="tpv-cifra"><strong>{cifra(d.total)}</strong></td>
                <td><Chip tono={TONO[ETIQUETA_COMO_ESTA[d.como].tono]}>{ETIQUETA_COMO_ESTA[d.como].texto}</Chip></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {dias.filter((d) => d.aviso).map((d) => (
        <div key={d.dia} className="tpv-aviso" data-tono={d.como === 'distinto' ? 'duda' : undefined} data-prueba={`aviso-${d.dia}`}>
          <p><strong>{d.aviso!.titulo}</strong> {d.aviso!.frases.join(' ')}</p>
          {d.aviso!.queHacer && <p>{d.aviso!.queHacer}</p>}
        </div>
      ))}
    </>
  )

  const porDentro = sel && (
    <>
      <h3 className="tpv-der-titulo">El {diaCorto(sel.dia)}, por dentro</h3>
      <div className="tpv-tarjeta">
        <div className="tpv-fila"><span>{sel.facturas} {sel.facturas === 1 ? 'factura' : 'facturas'}{sel.primero != null && (sel.primero === sel.ultimo ? `, la ${sel.primero}` : `, de la ${sel.primero} a la ${sel.ultimo}`)}</span><span /></div>
        <div className="tpv-fila"><span>Base</span><span>{cifra(sel.dentro.base)}</span></div>
        {sel.dentro.ivaPorTipo.map((t) => <div key={t.tipo} className="tpv-fila"><span>IVA al {tipoTexto(t.tipo)}</span><span>{cifra(t.cuota)}</span></div>)}
        <div className="tpv-fila tpv-fila-total"><span>Total vendido</span><span>{cifra(sel.dentro.total)}</span></div>
      </div>
      <div className="tpv-tarjeta">
        <h4 className="tpv-tarjeta-titulo">Cómo se cobró</h4>
        {sel.dentro.cobros.map((c) => (
          <div key={`${c.forma}|${c.canal ?? ''}`} className="tpv-fila">
            <span>{c.etiqueta}{c.porDeliverect && <span className="tpv-fila-apoyo"> · por Deliverect</span>}</span>
            {c.sinCuenta && <button type="button" className="tpv-sin-cuenta" onClick={alElegirCuentas}>Cuenta sin elegir</button>}
            <span>{cifra(c.importe)}</span>
          </div>
        ))}
        <div className="tpv-fila tpv-fila-total"><span>Total cobrado</span><span>{cifra(sel.dentro.cobrado)}</span></div>
      </div>
      {(sel.dentro.conNif > 0 || sel.dentro.devoluciones.n > 0) && (
        <div className="tpv-tarjeta">
          {sel.dentro.conNif > 0 && <div className="tpv-fila"><span>Facturas con NIF <span className="tpv-fila-apoyo">· van una a una al libro</span></span><span>{sel.dentro.conNif}</span></div>}
          {sel.dentro.devoluciones.n > 0 && <div className="tpv-fila"><span>Devoluciones <span className="tpv-fila-apoyo">· restan</span></span><span>{sel.dentro.devoluciones.n} · {cifra(sel.dentro.devoluciones.total)}</span></div>}
        </div>
      )}
      {sel.comprobaciones.length > 0 && (
        <ul className="tpv-comprobaciones" aria-label="Comprobaciones">
          {sel.comprobaciones.map((x) => <li key={x.texto} data-tono={x.ok ? undefined : 'duda'}><Icono nombre={x.ok ? 'ok' : 'aviso'} /> {x.texto}</li>)}
        </ul>
      )}
    </>
  )

  if (cuentasPara) {
    // Sigue solo: al guardar las cuentas (o al cerrar sin elegirlas, y esos días quedan en espera).
    return <FormasDePago companyId={companyId} quien={quien} diaId={cuentasPara.diaId} alCerrar={() => cuentasPara.seguir()} alGuardar={(t) => cuentasPara.seguir(t)} />
  }

  if (hecho) {
    const porCuenta = hecho.espera.some((x) => esperaPorCuenta(x.motivo))
    return (
      <VentanaAncha titulo="Subir las ventas del TPV" pasos={PASOS} paso={3} alCerrar={alCerrar}
        izquierda={(
          <div className="tpv-hecho" data-prueba="resultado-subir">
            {hecho.cuentas && <p className="tpv-nota" data-prueba="resultado-cuentas">{hecho.cuentas}</p>}
            {hecho.contabilizados && <p className="tpv-hecho-frase" role="status" data-prueba="resultado-contabilizados">{hecho.contabilizados}</p>}
            {hecho.enEspera && (
              <div className="tpv-aviso" data-tono="duda" data-prueba="resultado-en-espera">
                <p>{hecho.enEspera}</p>
                {porCuenta && <p><Boton variante="secundario" onClick={alElegirCuentas}>Elegir la cuenta</Boton></p>}
              </div>
            )}
            {!hecho.contabilizados && !hecho.enEspera && <p className="tpv-hecho-frase" role="status">No se ha contabilizado ningún día.</p>}
            {hecho.fallos.map((f) => <div key={f} className="tpv-aviso" role="alert"><p>{f}</p></div>)}
            <p className="tpv-nota" data-prueba="resultado-guardado">{hecho.guardado}</p>
            <p className="tpv-nota">Los contabilizados ya están en «Cierres del día», validados, y en «Facturas emitidas»; los que esperan, en «En espera».</p>
          </div>
        )}
        frase={FRASE}
        acciones={<>
          <Boton variante="secundario" onClick={() => { setHecho(null); setFicheros([]) }}>Subir más</Boton>
          <Boton variante="principal" data-autofocus onClick={alCerrar}>Ver la lista</Boton>
        </>} />
    )
  }

  return (
    <VentanaAncha titulo="Subir las ventas del TPV" pasos={PASOS} paso={paso} alCerrar={alCerrar}
      izquierda={<>
        {error && <div className="tpv-aviso" role="alert"><p>{error}</p></div>}
        {zona}
        {tabla}
      </>}
      derecha={porDentro || undefined}
      frase={FRASE}
      acciones={<>
        <Boton variante="secundario" onClick={alCerrar} disabled={guardando}>Cancelar</Boton>
        <Boton variante="principal" disabled={!aGuardar.length || guardando} onClick={() => void contabilizar()}>
          {guardando ? (progreso ?? 'Contabilizando…') : aGuardar.length === 1 ? 'Contabilizar 1 día' : `Contabilizar ${aGuardar.length} días`}
        </Boton>
      </>} />
  )
}
