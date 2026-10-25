// src/modules/conta/puerta/QueEsperasPage.tsx
//
// V02d · Inicio › Documentos › Qué esperas cada mes (tablero 23, Julio 25/10).
// Una página, no un cuadro emergente. Se llega desde «Más» de Documentos.
//
//   · Arriba: «Avisarme cuando algo se retrase» y «Avisar si pasan [5 días]
//     del día en que suele llegar».
//   · Grupos plegables (Alquileres · Luz, agua y teléfono · Proveedores ·
//     Plataformas y reparto · Gestoría y nóminas · Banco), cada uno con su
//     recuento. Cada fila: su inicial, el nombre bien escrito, su ritmo («cada
//     mes, hacia el día 5») y su interruptor. El local, solo en alquileres y
//     suministros, y solo si la empresa tiene más de uno.
//   · Lo que lleva meses sin llegar sale apagado y lo dice («sin facturas desde julio»).
//   · «Añadir algo que espero»: el camino a mano.
//   · Las personas solo se ven aquí.
//   · «Guardar» guarda todo lo cambiado de una vez y dice qué (regla 8).

import { useEffect, useRef, useState } from 'react'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useLeer } from '@/modules/conta/libros/contexto'
import { hoyEnMadrid } from '@/modules/conta/lib/formato'
import { EncabezadoPagina } from '@/modules/conta/marco/EncabezadoPagina'
import { Boton, Dialogo } from '@/modules/conta/diseno'
import { proveedoresDeLaCuenta } from '@/modules/conta/services/documentosService'
import { alDia, anadirEsperado, avisarDe, leerFuentes, localDe, ponerAjustes } from '@/modules/conta/services/puertaService'
import { nombreDelLocal, type Local } from '@/modules/conta/lib/puerta'
import { gruposEsperas, ritmo, type FilaEsperas } from '@/modules/conta/lib/documentosMes'
import { MARCA } from '@/modules/conta/cuenta/marca'

const MARGENES = [1, 2, 3, 5, 7, 10, 15]
const PLEGADOS_DE_SERIE = new Set(['gestoria', 'banco'])

interface Cambio { activa?: boolean; local?: Local | null }

export default function QueEsperasPage() {
  const { accountId, userName } = useCuentaConta()
  const { activa } = useEmpresas()
  const hoy = hoyEnMadrid()
  const quien = userName ?? null
  const [vuelta, setVuelta] = useState(0)
  const fuentes = useLeer(activa ? () => leerFuentes(activa.id) : null, `${accountId}:${activa?.id}:${vuelta}`)
  const [cambios, setCambios] = useState<Map<string, Cambio>>(new Map())
  // Lo que se ha cambiado de los avisos (sin guardar); lo demás, lo de la base.
  const [cambioAjustes, setCambioAjustes] = useState<{ on?: boolean; margen?: number }>({})
  const [aviso, setAviso] = useState<{ texto: string; tono?: 'falta' } | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [anadir, setAnadir] = useState(false)
  const puestaAlDia = useRef<string | null>(null)

  useEffect(() => {
    if (!activa || puestaAlDia.current === activa.id) return
    puestaAlDia.current = activa.id
    alDia(activa.id).then((cambio) => { if (cambio) setVuelta((v) => v + 1) }, () => null)
  }, [activa])

  const d = fuentes.datos
  const ajustes = d ? { on: cambioAjustes.on ?? d.ajustes.lo_que_falta, margen: cambioAjustes.margen ?? d.ajustes.margen } : null

  const grupos = d ? gruposEsperas(d, hoy) : null
  const locales = (d?.locales ?? []).filter((l) => l.activo !== false || (d?.fuentes ?? []).some((f) => f.local?.id === l.id))
  const cambiar = (x: FilaEsperas, c: Cambio) => setCambios((m) => new Map(m).set(x.clave, { ...m.get(x.clave), ...c }))
  const ajustesCambiados = !!d && !!ajustes && (ajustes.on !== d.ajustes.lo_que_falta || ajustes.margen !== d.ajustes.margen)
  const hayCambios = cambios.size > 0 || ajustesCambiados

  const guardar = async () => {
    if (!activa || !d || !grupos) return
    if (!hayCambios) { setAviso({ texto: 'No habías cambiado nada: no hay nada que guardar.' }); return }
    setGuardando(true); setAviso(null)
    const hechos: string[] = []
    try {
      const filas = grupos.flatMap((g) => g.filas)
      for (const [clave, c] of cambios) {
        const x = filas.find((y) => y.clave === clave)
        if (!x) continue
        if (c.activa !== undefined && c.activa !== x.activa) { await avisarDe(activa.id, x.ids, c.activa, quien); hechos.push(`${x.nombre} ${c.activa ? 'encendido' : 'apagado'}`) }
        if (c.local !== undefined && (c.local?.id ?? null) !== (x.local?.id ?? null)) {
          await localDe(activa.id, x.ids, c.local, quien)
          hechos.push(c.local ? `${x.nombre} en ${nombreDelLocal(c.local)}` : `${x.nombre} sin local`)
        }
      }
      if (ajustes && ajustesCambiados) {
        await ponerAjustes(activa.id, ajustes.on, ajustes.margen, quien)
        hechos.push(ajustes.on ? `avisar a los ${ajustes.margen} ${ajustes.margen === 1 ? 'día' : 'días'}` : 'avisos apagados')
      }
      setAviso({ texto: hechos.length ? `Guardado: ${hechos.join('; ')}.` : 'No había nada distinto que guardar.' })
      setCambios(new Map()); setCambioAjustes({}); setVuelta((v) => v + 1)
    } catch (e) {
      setAviso({ texto: `${hechos.length ? `Guardado a medias (${hechos.join('; ')}). ` : ''}No se ha podido guardar el resto: ${e instanceof Error ? e.message : String(e)}`, tono: 'falta' })
    } finally { setGuardando(false) }
  }

  const ejemplo = d?.fuentes.find((f) => f.tipo === 'alquiler' && f.local)?.local
  return (
    <div className="s-pagina cxdo cxqe">
      <EncabezadoPagina titulo="Qué esperas cada mes" migasExtra={[{ etiqueta: 'Qué esperas cada mes' }]}
        frase={`${MARCA.nombre} lo ha sacado de tus últimos meses. Quita lo que no quieras vigilar y añade lo que falte.`}
        secundarios={<Boton onClick={() => setAnadir(true)} disabled={!d}>Añadir algo que espero</Boton>}
        principal={<Boton variante="principal" disabled={guardando || !d} onClick={() => void guardar()}>{guardando ? 'Guardando…' : 'Guardar'}</Boton>} />

      {aviso && <p className="s-aviso-lista" data-tono={aviso.tono} role={aviso.tono ? 'alert' : 'status'} data-prueba="esperas-aviso">{aviso.texto}</p>}
      {fuentes.error && <p className="s-aviso-lista" data-tono="falta" role="alert">No se ha podido leer lo que esperas: {fuentes.error}</p>}

      <section className="cxqe-ajustes" aria-label="Avisos">
        <Interruptor on={ajustes?.on ?? true} etiqueta="Avisarme cuando algo se retrase" alCambiar={(on) => setCambioAjustes((a) => ({ ...a, on }))} />
        <span className="cxqe-ajustes-texto">
          <strong>Avisarme cuando algo se retrase</strong>
          <span>Si lo apagas no se borra nada: solo dejamos de avisar.</span>
        </span>
        <label className="cxqe-margen">
          <span>Avisar si pasan</span>
          <select className="s-control" value={ajustes?.margen ?? 5} aria-label="Días de margen" onChange={(e) => setCambioAjustes((a) => ({ ...a, margen: Number(e.target.value) }))}>
            {MARGENES.map((m) => <option key={m} value={m}>{m} {m === 1 ? 'día' : 'días'}</option>)}
          </select>
          <span>del día en que suele llegar</span>
        </label>
      </section>

      {!grupos && <div className="s-lista-cargando" aria-busy="true" aria-label="Leyendo lo que esperas" />}
      {grupos && grupos.length === 0 && <p className="cxdo-vacio">Aún no sé qué te tiene que llegar: con un par de meses de facturas, extractos o liquidaciones, lo saco solo. Mientras, añádelo a mano.</p>}
      {grupos?.map((g) => (
        <details key={g.familia} className="cxqe-grupo" open={!PLEGADOS_DE_SERIE.has(g.familia)} data-prueba={`grupo-${g.familia}`}>
          <summary className="cxqe-grupo-cabeza"><span className="cxqe-grupo-titulo">{g.titulo}</span><span className="cxqe-grupo-recuento">{g.recuento}</span></summary>
          <ul className="cxdo-filas">
            {g.filas.map((x) => {
              const c = cambios.get(x.clave)
              const on = c?.activa ?? x.activa
              const local = c && 'local' in c ? c.local ?? null : x.local
              return (
                <li key={x.clave} className="cxdo-fila cxqe-fila" data-prueba="fila-espera">
                  <span className="cxdo-inicial" data-color={colorDe(x.nombre)} aria-hidden="true">{x.inicial}</span>
                  <span className="cxdo-fila-texto">
                    <span className="cxdo-fila-nombre">{x.nombre}</span>
                    <span className="cxdo-fila-que">{x.detalle}{x.dormida ? ` · ${x.dormida}` : ''}</span>
                  </span>
                  {x.pideLocal && (
                    <select className="s-control cxqe-local" value={local?.id ?? ''} aria-label={`Local de ${x.nombre}`}
                      onChange={(e) => cambiar(x, { local: locales.find((l) => l.id === e.target.value) ?? null })}>
                      <option value="">Sin local</option>
                      {locales.map((l) => <option key={l.id} value={l.id}>{nombreDelLocal(l)}</option>)}
                    </select>
                  )}
                  <Interruptor on={on} etiqueta={`Avisar de ${x.nombre}`} alCambiar={(v) => cambiar(x, { activa: v })} />
                </li>
              )
            })}
          </ul>
        </details>
      ))}

      {grupos && grupos.length > 0 && (
        <p className="cxqe-nota">Las personas solo se ven aquí. En Documentos se nombra el local, no la persona{ejemplo ? `: «Alquiler de ${nombreDelLocal(ejemplo)}»` : ''}.</p>
      )}

      {anadir && activa && accountId && (
        <AnadirEsperado accountId={accountId} locales={locales.length > 1 ? locales : []} alCerrar={() => setAnadir(false)}
          alGuardar={async (x) => {
            const texto = await anadirEsperado(activa.id, x, quien)
            setAnadir(false); setAviso({ texto: `${texto.replace(/ se espera \w+\.$/, '')}: ${ritmo({ cadencia: x.cadencia, dia: x.dia, dia_semana: x.diaSemana, cada: x.cada, tipo: 'proveedor' })}. Te aviso si se retrasa.` })
            setVuelta((v) => v + 1)
          }} />
      )}
    </div>
  )
}

const colorDe = (n: string) => String([...n].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % 6)

function Interruptor({ on, etiqueta, alCambiar }: { on: boolean; etiqueta: string; alCambiar: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={etiqueta} className="cxqe-interruptor" data-on={on || undefined} onClick={() => alCambiar(!on)}>
      <span className="cxqe-interruptor-bola" />
    </button>
  )
}

const DIAS_SEMANA = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']

function AnadirEsperado({ accountId, locales, alCerrar, alGuardar }: {
  accountId: string; locales: readonly Local[]; alCerrar: () => void
  alGuardar: (x: Parameters<typeof anadirEsperado>[1]) => Promise<void>
}) {
  const [proveedores, setProveedores] = useState<{ id: string; nombre: string }[] | null>(null)
  const [proveedorId, setProveedorId] = useState('')
  const [otro, setOtro] = useState('')
  const [tipo, setTipo] = useState<'proveedor' | 'alquiler' | 'otro'>('proveedor')
  const [cadencia, setCadencia] = useState<'mensual' | 'quincenal' | 'semanal' | 'varias'>('mensual')
  const [dia, setDia] = useState(1)
  const [diaSemana, setDiaSemana] = useState(1)
  const [cada, setCada] = useState(10)
  const [localId, setLocalId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  useEffect(() => { proveedoresDeLaCuenta(accountId).then(setProveedores, () => setProveedores([])) }, [accountId])
  const nombre = proveedorId ? proveedores?.find((p) => p.id === proveedorId)?.nombre ?? '' : otro.trim()
  const vale = nombre.length > 1
  return (
    <Dialogo titulo="Añadir algo que espero" explicacion="Quién te lo manda, cada cuánto y qué día suele llegar. Te aviso si se retrasa." alCerrar={alCerrar}
      acciones={<><Boton onClick={alCerrar}>Cancelar</Boton><Boton variante="principal" disabled={!vale || guardando} onClick={() => {
        setGuardando(true); setError(null)
        alGuardar({
          nombre, proveedorId: proveedorId || null, tipo, cadencia,
          dia: cadencia === 'mensual' ? dia : null, diaSemana: cadencia === 'semanal' ? diaSemana : null, cada: cadencia === 'varias' ? cada : null,
          localId: localId || null,
        }).catch((e: unknown) => { setError(e instanceof Error ? e.message : String(e)); setGuardando(false) })
      }}>{guardando ? 'Apuntando…' : 'Apuntarlo'}</Boton></>}>
      {error && <p className="s-aviso-lista" data-tono="falta" role="alert">{error}</p>}
      <label className="s-campo"><span className="s-campo-etiqueta">Quién</span>
        <select className="s-control" value={proveedorId} onChange={(e) => setProveedorId(e.target.value)} aria-label="Quién te lo manda">
          <option value="">Otro (escríbelo)</option>
          {(proveedores ?? []).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
      </label>
      {!proveedorId && <label className="s-campo"><span className="s-campo-etiqueta">Nombre</span><input className="s-control" value={otro} onChange={(e) => setOtro(e.target.value)} placeholder="La gestoría, el alquiler del local…" /></label>}
      <label className="s-campo"><span className="s-campo-etiqueta">Qué es</span>
        <select className="s-control" value={tipo} onChange={(e) => setTipo(e.target.value as typeof tipo)}>
          <option value="proveedor">Una factura de un proveedor</option><option value="alquiler">Un alquiler</option><option value="otro">Otra cosa</option>
        </select>
      </label>
      <label className="s-campo"><span className="s-campo-etiqueta">Cada cuánto</span>
        <select className="s-control" value={cadencia} onChange={(e) => setCadencia(e.target.value as typeof cadencia)}>
          <option value="mensual">Cada mes</option><option value="quincenal">Cada quincena</option><option value="semanal">Cada semana</option><option value="varias">Varias al mes</option>
        </select>
      </label>
      {cadencia === 'mensual' && <label className="s-campo"><span className="s-campo-etiqueta">Qué día del mes</span><input className="s-control" type="number" min={1} max={31} value={dia} onChange={(e) => setDia(Math.max(1, Math.min(31, Number(e.target.value) || 1)))} /></label>}
      {cadencia === 'semanal' && <label className="s-campo"><span className="s-campo-etiqueta">Qué día de la semana</span>
        <select className="s-control" value={diaSemana} onChange={(e) => setDiaSemana(Number(e.target.value))}>{DIAS_SEMANA.map((x, i) => <option key={x} value={i + 1}>{x}</option>)}</select></label>}
      {cadencia === 'varias' && <label className="s-campo"><span className="s-campo-etiqueta">Avisar si pasan estos días sin ninguna</span><input className="s-control" type="number" min={1} max={90} value={cada} onChange={(e) => setCada(Math.max(1, Math.min(90, Number(e.target.value) || 1)))} /></label>}
      {locales.length > 0 && (
        <label className="s-campo"><span className="s-campo-etiqueta">Local</span>
          <select className="s-control" value={localId} onChange={(e) => setLocalId(e.target.value)}>
            <option value="">Sin local</option>{locales.map((l) => <option key={l.id} value={l.id}>{nombreDelLocal(l)}</option>)}
          </select>
        </label>
      )}
    </Dialogo>
  )
}
