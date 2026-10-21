// src/modules/conta/impuestos/Sociedades.tsx
//
// Impuestos › Impuesto de sociedades. I01b: la pestaña, con sus plazos. I01h
// (Julio, 21/10): con el molde del 303, el 111 y el 115,
//   · los pagos a cuenta (202), cada uno con el 200 del que sale (art. 40.2:
//     el 18 % de su cuota) y en qué punto está; uno a cero dice «No hay que
//     presentarlo» con el porqué, y no cuenta como pendiente;
//   · los 200 guardados (cuándo, la base imponible, la cuota y el resultado),
//     escritos a mano con su motivo: el lector de justificantes no lee el 200;
//   · lo que salió a devolver, pendiente de cobrar hasta que llega al banco.
// Cada botón dice lo que ha hecho (regla 8).

import { useEffect, useState } from 'react'
import { Boton, Campo, Chip, Fecha, Importe, Selector, Tarjeta } from '@/modules/conta/diseno'
import { useNivel } from '@/modules/conta/marco/nuevo/contexto'
import { diaMesCorto, eurosExactos, fechaLarga, hoyEnMadrid } from '@/modules/conta/lib/formato'
import { calcular202, leerSociedades, poner200 } from '@/modules/conta/services/impuestosService'
import { nombreDeOficina, periodoEnPalabras } from './calendario'
import { useCalendario } from './useCalendario'
import { estado202, fraseDevolucion, resultado200, validar200, type Formulario200, type Pago202, type Sociedades as DatosSociedades } from './sociedades'

const DE_SOCIEDADES = ['200', '202']
const PRESENTADAS = ['filed', 'booked', 'paid', 'offset', 'refunded']
const MES_DEL_PAGO: Record<Pago202['periodo'], string> = { '1P': 'abril', '2P': 'octubre', '3P': 'diciembre' }
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))
type Hecho = { tono: 'ok' | 'falta'; texto: string }

export function Sociedades({ companyId }: { companyId: string }) {
  const { datos: cal, error: errorCal, recargar: recargarCal } = useCalendario(companyId)
  const nivel = useNivel()
  const [vuelta, setVuelta] = useState(0)
  const [leido, setLeido] = useState<{ para: string; datos: DatosSociedades | null; error: string | null } | null>(null)
  const [hecho, setHecho] = useState<Hecho | null>(null)
  const para = `${companyId}/${vuelta}`
  useEffect(() => {
    let vivo = true
    leerSociedades(companyId).then(
      (d) => { if (vivo) setLeido({ para, datos: d, error: null }) },
      (e: unknown) => { if (vivo) setLeido({ para, datos: null, error: msg(e) }) })
    return () => { vivo = false }
  }, [companyId, para])
  const datos = leido?.para === para ? leido.datos : null
  const error = leido?.para === para ? leido.error : null
  const alHacer = (h: Hecho) => { setHecho(h); if (h.tono === 'ok') { setVuelta((v) => v + 1); recargarCal() } }

  const presenta = cal?.modelos.filter((m) => DE_SOCIEDADES.includes(m.modelo)) ?? []
  const noPresenta = cal?.no_presenta.filter((m) => DE_SOCIEDADES.includes(m.modelo)) ?? []
  const devoluciones = (datos?.declaraciones_200 ?? []).filter((d) => d.devolucion)

  return (
    <div className="s-pantalla s-impuestos s-sociedades">
      <h1 className="cx-oculto">Impuestos · Impuesto de sociedades</h1>
      {(error || errorCal) && (
        <Tarjeta titulo="No se ha podido leer el Impuesto de sociedades" tono="falta" accion={<Boton onClick={() => { setVuelta((v) => v + 1); recargarCal() }}>Volver a intentar</Boton>}>
          <p className="s-apoyo">{error ?? errorCal}</p>
        </Tarjeta>
      )}
      {!error && !errorCal && (!datos || !cal) && <Tarjeta titulo="Leyendo tus impuestos…"><p className="s-apoyo">Un momento.</p></Tarjeta>}
      {hecho && <p className={hecho.tono === 'ok' ? 's-impuestos-hecho' : 's-impuestos-fallo'} role={hecho.tono === 'ok' ? 'status' : 'alert'}>{hecho.texto}</p>}

      {datos && cal && presenta.length === 0 && (
        <Tarjeta compacta titulo="Impuesto de sociedades">
          <p className="s-apoyo s-impuestos-vacio">
            {noPresenta.length > 0 ? noPresenta.map((m) => `No te sale el ${m.modelo}: ${m.por_que}`).join(' ') : 'Esta empresa no presenta el impuesto de sociedades.'}
          </p>
        </Tarjeta>
      )}

      {datos && cal && presenta.length > 0 && (
        <>
          {devoluciones.map((d) => {
            const f = fraseDevolucion(d.ejercicio, d.devolucion!)
            return <p key={d.ejercicio} className={f.tono === 'ok' ? 's-trimestre-ok' : 's-impuestos-porque-no'} role="note" data-prueba="devolucion">{f.texto}</p>
          })}

          <Tarjeta compacta titulo="Pagos a cuenta (202)" apoyo="Cada pago es el 18 % de la cuota del último Impuesto de sociedades con el plazo vencido (art. 40.2): el de abril sale del de dos años antes; los de octubre y diciembre, del año anterior.">
            <table className="s-tabla s-impuestos-tabla" data-prueba="pagos-202">
              <thead><tr><th scope="col">Qué</th><th scope="col">Hasta</th><th scope="col">En qué punto está</th></tr></thead>
              <tbody>
                {datos.pagos_202.map((p) => (
                  <FilaPago key={`${p.ejercicio}-${p.periodo}`} p={p} companyId={companyId} puede={datos.puede_gestionar} nivel={nivel} alHacer={alHacer} />
                ))}
              </tbody>
            </table>
          </Tarjeta>

          <Tarjeta compacta titulo="Declaraciones del año (200)" apoyo="Sumied aún no lee el justificante del 200: sus datos se escriben a mano, con de dónde salen.">
            {datos.declaraciones_200.length === 0 && <p className="s-apoyo s-impuestos-vacio">Aún no hay ninguno. Escribe el último que presentaste: de su cuota salen los pagos a cuenta.</p>}
            {datos.declaraciones_200.length > 0 && (
              <ul className="s-sociedades-200" data-prueba="declaraciones-200">
                {datos.declaraciones_200.map((d) => (
                  <li key={d.ejercicio} data-prueba={`declaracion-200-${d.ejercicio}`}>
                    <p className="s-impuestos-nombre">Impuesto de sociedades de {d.ejercicio} · {resultado200(d)}</p>
                    <p className="s-apoyo">
                      Presentado el {fechaLarga(d.presentado)} · base imponible <span className="s-cifra">{eurosExactos(d.base_imponible)}</span> · cuota <span className="s-cifra">{eurosExactos(d.cuota)}</span>
                    </p>
                    {d.motivo && <p className="s-tabla-apoyo">Escrito a mano: {d.motivo}</p>}
                  </li>
                ))}
              </ul>
            )}
            {datos.puede_gestionar && <Escribir200 companyId={companyId} hoy={datos.hoy || hoyEnMadrid()} alHacer={alHacer} />}
          </Tarjeta>

          <ul className="s-impuestos-porque s-impuestos-vacio">
            {presenta.map((m) => <li key={m.modelo}><strong>{nombreDeOficina(m.modelo, m.cadencia, m.nombre)} ({m.modelo})</strong> · {m.por_que}</li>)}
          </ul>
        </>
      )}
    </div>
  )
}

function FilaPago({ p, companyId, puede, nivel, alHacer }: { p: Pago202; companyId: string; puede: boolean; nivel: string; alHacer: (h: Hecho) => void }) {
  const [haciendo, setHaciendo] = useState(false)
  const e = estado202(p)
  const presentado = !!p.declaracion && PRESENTADAS.includes(p.declaracion.estado)
  // Se puede calcular si el 200 del que sale está y el 202 aún no tiene sus casillas.
  const sinCalcular = !presentado && p.cuota_200 !== null && (!p.declaracion || (p.declaracion.c03 === null && p.declaracion.estado !== 'not_required'))
  return (
    <tr data-prueba={`pago-${p.periodo}-${p.ejercicio}`}>
      <td data-titulo="Qué">
        <span className="s-impuestos-nombre">Pago a cuenta de {MES_DEL_PAGO[p.periodo]} de {p.ejercicio}</span>
        <span className="s-tabla-apoyo">{periodoEnPalabras(p.periodo)}{nivel !== 'experto' ? ' · modelo 202' : ''} · sale del Impuesto de sociedades de {p.ejercicio_base}</span>
      </td>
      <td data-titulo="Hasta">{p.plazo ? `${diaMesCorto(p.plazo)}/${p.plazo.slice(0, 4)}` : '—'}</td>
      <td data-titulo="En qué punto está">
        <Chip tono={e.tono === 'ok' ? 'seguro' : e.tono === 'neutro' ? 'neutro' : 'accion'}>{e.texto}</Chip>
        {puede && sinCalcular && (
          <Boton variante="enlace" disabled={haciendo} onClick={async () => {
            setHaciendo(true)
            try {
              const r = await calcular202(companyId, p.ejercicio, p.periodo)
              alHacer({ tono: 'ok', texto: r.no_hace_falta
                ? `Calculado el 202 del ${p.periodo} de ${p.ejercicio}: no hay que presentarlo, el impuesto de ${r.ejercicio_base} salió a cero.`
                : `Calculado el 202 del ${p.periodo} de ${p.ejercicio}: ${eurosExactos(r.importe ?? 0)} a ingresar (el 18 % de la cuota de ${r.ejercicio_base}).` })
            } catch (x) { alHacer({ tono: 'falta', texto: `No se ha calculado el 202 del ${p.periodo}: ${msg(x)}` }) } finally { setHaciendo(false) }
          }}>{haciendo ? 'Calculando…' : `Calcular el ${p.periodo}`}</Boton>
        )}
      </td>
    </tr>
  )
}

const RESULTADOS = [
  { valor: '', texto: 'Elige…' },
  { valor: 'to_pay', texto: 'A ingresar' },
  { valor: 'to_refund', texto: 'A devolver' },
  { valor: 'zero', texto: 'Cero' },
] as const

function Escribir200({ companyId, hoy, alHacer }: { companyId: string; hoy: string; alHacer: (h: Hecho) => void }) {
  const vacio: Formulario200 = { ejercicio: String(Number(hoy.slice(0, 4)) - 1), presentado: '', base: '', cuota: '', resultado: '', importe: '', motivo: '' }
  const [abierto, setAbierto] = useState(false)
  const [f, setF] = useState<Formulario200>(vacio)
  const [visto, setVisto] = useState(false)
  const [haciendo, setHaciendo] = useState(false)
  const v = validar200(f, hoy)
  const err = (k: keyof Formulario200) => (visto ? v.errores[k] ?? null : null)
  const poner = (k: keyof Formulario200) => (x: string) => setF((a) => ({ ...a, [k]: x }))
  const cerrar = () => { setAbierto(false); setF(vacio); setVisto(false) }
  if (!abierto) return <p><Boton onClick={() => setAbierto(true)}>Escribir un 200</Boton></p>
  return (
    <form className="s-sociedades-form" data-prueba="escribir-200" onSubmit={async (e) => {
      e.preventDefault()
      setVisto(true)
      if (!v.datos) return
      setHaciendo(true)
      try {
        const r = await poner200(companyId, v.datos.ejercicio, v.datos.datos, v.datos.motivo)
        cerrar()
        alHacer({ tono: 'ok', texto: r.mensaje })
      } catch (x) { alHacer({ tono: 'falta', texto: `No se ha guardado el 200: ${msg(x)}` }) } finally { setHaciendo(false) }
    }}>
      <p className="s-trimestre-perceptores-titulo">Los datos del 200, del justificante</p>
      <div className="s-sociedades-campos">
        <Campo etiqueta="Ejercicio" error={err('ejercicio')}>{(p) => <input {...p} className="s-control s-cifra" inputMode="numeric" value={f.ejercicio} onChange={(e) => poner('ejercicio')(e.target.value)} />}</Campo>
        <Campo etiqueta="Presentado el" error={err('presentado')}>{(p) => <Fecha {...p} valor={f.presentado} alCambiar={poner('presentado')} />}</Campo>
        <Campo etiqueta="Base imponible (€)" ayuda="Si salió negativa, con el signo." error={err('base')}>{(p) => <Importe {...p} valor={f.base} alCambiar={poner('base')} />}</Campo>
        <Campo etiqueta="Cuota (€)" ayuda="La que sirve de base al 202. Si salió negativa, 0." error={err('cuota')}>{(p) => <Importe {...p} valor={f.cuota} alCambiar={poner('cuota')} />}</Campo>
        <Campo etiqueta="Resultado" error={err('resultado')}>{(p) => <Selector {...p} valor={f.resultado} alCambiar={poner('resultado')} opciones={RESULTADOS} />}</Campo>
        {f.resultado !== 'zero' && <Campo etiqueta="Importe (€)" error={err('importe')}>{(p) => <Importe {...p} valor={f.importe} alCambiar={poner('importe')} />}</Campo>}
        <Campo etiqueta="De dónde salen" ayuda="Por ejemplo: «el justificante de la gestoría»." error={err('motivo')}>{(p) => <input {...p} className="s-control" value={f.motivo} onChange={(e) => poner('motivo')(e.target.value)} />}</Campo>
      </div>
      <div className="s-impuestos-fila-botones">
        <Boton type="submit" variante="principal" disabled={haciendo}>{haciendo ? 'Guardando…' : 'Guardar el 200'}</Boton>
        <Boton variante="enlace" onClick={cerrar}>Cancelar</Boton>
      </div>
    </form>
  )
}
