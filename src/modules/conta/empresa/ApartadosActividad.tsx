// src/modules/conta/empresa/ApartadosActividad.tsx
//
// «Tu empresa» (maquetas N2Empresa y M2Empresa): A qué te dedicas, el
// ejercicio con sus meses y Socios y cargos. Se cambian en la misma tarjeta;
// cada cambio confirma con contenido o enseña el fallo.

import { useEffect, useState, type FormEvent } from 'react'
import { Chip, Inicial } from '@/modules/conta/ui/piezas'
import { fechaLarga, iniciales, porcentaje } from '@/modules/conta/lib/formato'
import { revisarSocios } from '@/modules/conta/lib/validacionesEmpresa'
import {
  CLASE_ACTIVIDAD, ROLES, codigoIae, ejercicioActual, ejercicioPropuesto, mesParaCerrar, mesParaReabrir, mesYAno,
  mesesConEstado, nombreMes, textoRoles, type Actividad, type DatosEmpresa, type Socio,
} from '@/modules/conta/empresa/datosEmpresa'
import type { Quien } from '@/modules/conta/empresa/apartados'
import {
  abrirEjercicio, anadirActividad, buscarCnae, buscarIae, cerrarMes, darDeBajaSocio, guardarSocio, hacerPrincipal,
  reabrirMes, terminarActividad, type CambiosSocio, type OpcionCodigo,
} from '@/modules/conta/services/empresaDatosService'
import { useHacer } from '@/modules/conta/empresa/useHacer'
import { CampoLista, CampoTexto, PieFormulario, Resultado, TarjetaApartado } from '@/modules/conta/empresa/campos'

interface Props { d: DatosEmpresa; quien: Quien; alCambiar: () => void; movil: boolean; hoy: string }

// ── A qué te dedicas ────────────────────────────────────────────────────────

function lineaCodigos(a: Actividad): string {
  return [
    a.iaeCode ? `Epígrafe ${codigoIae(a.iaeCode)}` : null,
    a.cnaeCode ? `CNAE ${a.cnaeCode}` : null,
    a.startedOn ? `desde ${mesYAno(a.startedOn)}` : null,
  ].filter(Boolean).join(' · ')
}

export function Actividades({ d, quien, alCambiar, movil, hoy }: Props) {
  const [anadiendo, setAnadiendo] = useState(false)
  const [abierta, setAbierta] = useState<string | null>(null)
  const [dejando, setDejando] = useState<string | null>(null)
  const h = useHacer(alCambiar)
  const vivas = d.actividades.filter((a) => a.endedOn === null)
  const pasadas = d.actividades.filter((a) => a.endedOn !== null)

  return (
    <TarjetaApartado titulo="A qué te dedicas" movil={movil}
      accion={!anadiendo ? <button type="button" className="cx-enlace" onClick={() => { setAnadiendo(true); h.limpiar() }}>+ Añadir</button> : undefined}>
      {anadiendo && (
        <FormActividad primera={vivas.length === 0} hoy={hoy} guardando={h.guardando}
          cancelar={() => { setAnadiendo(false); h.limpiar() }}
          guardar={async (a) => {
            if (await h.hacer(() => anadirActividad(quien.accountId, quien.companyId, quien.userId, a),
              `Añadida «${a.description}»${a.isMain ? ' como tu actividad principal' : ''}.`)) setAnadiendo(false)
          }} />
      )}
      {vivas.length === 0 && !anadiendo && (
        <p className="cx-vacio">Aún no has dicho a qué te dedicas. Con «+ Añadir» pones tu actividad y su epígrafe.</p>
      )}
      <ul className="cx-actividades">
        {vivas.map((a) => {
          const abiertaEsta = abierta === a.id
          return (
            <li key={a.id} className="cx-actividad">
              <button type="button" className="cx-actividad-cabeza" aria-expanded={abiertaEsta} onClick={() => { setAbierta(abiertaEsta ? null : a.id); setDejando(null); h.limpiar() }}>
                <span className="cx-actividad-nombre">{a.description}</span>
                {a.isMain && <Chip>Principal</Chip>}
              </button>
              {lineaCodigos(a) && <span className="cx-fila-apoyo">{lineaCodigos(a)}</span>}
              {abiertaEsta && (
                <div className="cx-actividad-detalle">
                  {a.iaeTitle && <span className="cx-ayuda">IAE: {a.iaeTitle}</span>}
                  {a.cnaeTitle && <span className="cx-ayuda">CNAE-2025: {a.cnaeTitle}</span>}
                  <span className="cx-ayuda">{CLASE_ACTIVIDAD[a.kind]}</span>
                  {dejando === a.id ? (
                    <FormDejar a={a} hoy={hoy} guardando={h.guardando} cancelar={() => setDejando(null)}
                      guardar={async (fecha) => {
                        if (await h.hacer(() => terminarActividad(a.id, fecha), `«${a.description}» terminó el ${fechaLarga(fecha)}. Queda en el historial.`)) {
                          setDejando(null); setAbierta(null)
                        }
                      }} />
                  ) : (
                    <div className="cx-pie" style={{ justifyContent: 'flex-start' }}>
                      {!a.isMain && (
                        <button type="button" className="cx-boton-sec" disabled={h.guardando}
                          onClick={() => void h.hacer(() => hacerPrincipal(a.id), `«${a.description}» es ahora tu actividad principal.`)}>
                          Hacer principal
                        </button>
                      )}
                      {a.isMain && vivas.length > 1 ? (
                        <span className="cx-ayuda">Para dejarla, haz antes principal otra.</span>
                      ) : (
                        <button type="button" className="cx-boton-sec" onClick={() => setDejando(a.id)}>Ya no me dedico a esto</button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {pasadas.length > 0 && (
        <details className="cx-pasadas">
          <summary>Actividades que ya dejaste · {pasadas.length}</summary>
          <ul>{pasadas.map((a) => <li key={a.id}>{a.description} · hasta {fechaLarga(a.endedOn!)}</li>)}</ul>
        </details>
      )}
      <Resultado hecho={h.hecho} fallo={h.fallo} />
    </TarjetaApartado>
  )
}

function FormDejar({ a, hoy, guardando, cancelar, guardar }: {
  a: Actividad; hoy: string; guardando: boolean; cancelar: () => void; guardar: (fecha: string) => void
}) {
  const [fecha, setFecha] = useState(hoy)
  const [fallo, setFallo] = useState<string | undefined>()
  return (
    <form className="cx-formulario" noValidate aria-label={`Dejar ${a.description}`} onSubmit={(e) => {
      e.preventDefault()
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) { setFallo('Esa fecha no es válida.'); return }
      if (a.startedOn && fecha < a.startedOn) { setFallo(`No puede terminar antes de empezar (${fechaLarga(a.startedOn)}).`); return }
      guardar(fecha)
    }}>
      <CampoTexto etiqueta="¿Desde cuándo ya no?" tipo="date" valor={fecha} cambiar={setFecha} fallo={fallo} deshabilitado={guardando}
        ayuda="No se borra: queda en el historial con su fecha de fin." />
      <PieFormulario guardando={guardando} cancelar={cancelar} textoGuardar="Dejarla" />
    </form>
  )
}

/** Busca en una lista oficial mientras se escribe y deja elegir uno. */
function Buscador({ etiqueta, ayuda, buscar, elegido, elegir, mostrarCodigo, deshabilitado }: {
  etiqueta: string; ayuda: string; buscar: (t: string) => Promise<OpcionCodigo[]>
  elegido: OpcionCodigo | null; elegir: (o: OpcionCodigo | null) => void
  mostrarCodigo: (c: string) => string; deshabilitado: boolean
}) {
  const [texto, setTexto] = useState('')
  const [res, setRes] = useState<{ para: string; opciones: OpcionCodigo[]; error: string | null }>({ para: '', opciones: [], error: null })
  useEffect(() => {
    const t = texto.trim()
    if (t.length < 2) return
    let vivo = true
    const reloj = setTimeout(() => {
      buscar(t).then((opciones) => { if (vivo) setRes({ para: t, opciones, error: null }) })
        .catch((e: unknown) => { if (vivo) setRes({ para: t, opciones: [], error: e instanceof Error ? e.message : String(e) }) })
    }, 250)
    return () => { vivo = false; clearTimeout(reloj) }
  }, [texto, buscar])
  const visibles = res.para === texto.trim() && texto.trim().length >= 2

  if (elegido) {
    return (
      <div className="cx-campo">
        <span className="cx-etiqueta">{etiqueta}</span>
        <div className="cx-elegido">
          <span><span className="cx-cifra">{mostrarCodigo(elegido.code)}</span> · {elegido.title}</span>
          <button type="button" className="cx-enlace" onClick={() => elegir(null)} disabled={deshabilitado}>Cambiar</button>
        </div>
      </div>
    )
  }
  return (
    <div className="cx-campo">
      <CampoTexto etiqueta={etiqueta} ayuda={ayuda} valor={texto} cambiar={setTexto} deshabilitado={deshabilitado} />
      {visibles && res.error && <span className="cx-error" role="alert">{res.error}</span>}
      {visibles && !res.error && (
        <ul className="cx-resultados" aria-label={`Resultados de ${etiqueta.toLowerCase()}`}>
          {res.opciones.length === 0 && <li className="cx-ayuda">Nada con «{texto.trim()}».</li>}
          {res.opciones.map((o) => (
            <li key={o.code}>
              <button type="button" className="cx-resultado" onClick={() => elegir(o)}>
                <span className="cx-cifra">{mostrarCodigo(o.code)}</span> {o.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function FormActividad({ primera, hoy, guardando, cancelar, guardar }: {
  primera: boolean; hoy: string; guardando: boolean; cancelar: () => void
  guardar: (a: { description: string; kind: Actividad['kind']; iaeCode: string | null; cnaeCode: string | null; startedOn: string | null; isMain: boolean }) => void
}) {
  const [descripcion, setDescripcion] = useState('')
  const [kind, setKind] = useState<Actividad['kind']>('business')
  const [iae, setIae] = useState<OpcionCodigo | null>(null)
  const [cnae, setCnae] = useState<OpcionCodigo | null>(null)
  const [desde, setDesde] = useState('')
  const [fallos, setFallos] = useState<Record<string, string>>({})
  const enviar = (e: FormEvent) => {
    e.preventDefault()
    const f: Record<string, string> = {}
    if (descripcion.trim() === '') f.descripcion = 'Di a qué te dedicas con tus palabras: «Restaurante», «Comida a domicilio».'
    if (desde !== '' && desde > hoy) f.desde = 'Todavía no ha llegado esa fecha.'
    setFallos(f)
    if (Object.keys(f).length === 0) {
      guardar({ description: descripcion.trim(), kind, iaeCode: iae?.code ?? null, cnaeCode: cnae?.code ?? null, startedOn: desde || null, isMain: primera })
    }
  }
  return (
    <form className="cx-formulario cx-apartado-formulario" noValidate aria-label="Añadir una actividad" onSubmit={enviar}>
      <CampoTexto etiqueta="A qué te dedicas" valor={descripcion} cambiar={setDescripcion} fallo={fallos.descripcion} deshabilitado={guardando} />
      <CampoLista etiqueta="Cómo es" valor={kind} cambiar={(v) => setKind(v as Actividad['kind'])} deshabilitado={guardando}
        opciones={[{ valor: 'business', texto: 'Empresarial (un negocio)' }, { valor: 'professional', texto: 'Profesional (un oficio titulado)' }, { valor: 'other', texto: 'Otra' }]} />
      <Buscador etiqueta="Epígrafe del IAE" ayuda="Escribe lo que haces («restaurante») o el número («671»)." buscar={buscarIae}
        elegido={iae} elegir={setIae} mostrarCodigo={codigoIae} deshabilitado={guardando} />
      <Buscador etiqueta="CNAE" ayuda="La clasificación de actividades del INE (CNAE-2025)." buscar={buscarCnae}
        elegido={cnae} elegir={setCnae} mostrarCodigo={(c) => c} deshabilitado={guardando} />
      <CampoTexto etiqueta="Desde cuándo (si lo sabes)" tipo="date" valor={desde} cambiar={setDesde} fallo={fallos.desde} deshabilitado={guardando} />
      {primera && <p className="cx-ayuda" style={{ margin: 0 }}>Es la primera: queda como tu actividad principal.</p>}
      <PieFormulario guardando={guardando} cancelar={cancelar} textoGuardar="Añadir" />
    </form>
  )
}

// ── El ejercicio ────────────────────────────────────────────────────────────

export function EjercicioMeses({ d, quien, alCambiar, movil, hoy }: Props) {
  const h = useHacer(alCambiar)
  const [reabriendo, setReabriendo] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [falloMotivo, setFalloMotivo] = useState<string | undefined>()
  const [verAnteriores, setVerAnteriores] = useState(false)
  const ej = ejercicioActual(d.ejercicios, hoy)

  if (!ej) {
    const propuesto = ejercicioPropuesto(hoy)
    const anterior = [...d.ejercicios].sort((a, b) => b.endsOn.localeCompare(a.endsOn))[0]
    return (
      <TarjetaApartado titulo="Ejercicio" movil={movil}>
        <p className="cx-vacio">
          Aún no hay ejercicio abierto. El de {propuesto.code} va del {fechaLarga(propuesto.startsOn)} al {fechaLarga(propuesto.endsOn)}.
        </p>
        <div className="cx-pie" style={{ justifyContent: 'flex-start' }}>
          <button type="button" className="cx-boton" disabled={h.guardando}
            onClick={() => void h.hacer(() => abrirEjercicio(quien.accountId, quien.companyId, quien.userId, propuesto,
              anterior && anterior.endsOn < propuesto.startsOn ? anterior.id : null), `Abierto el ejercicio ${propuesto.code}.`)}>
            {h.guardando ? 'Abriendo…' : `Abrir el ejercicio ${propuesto.code}`}
          </button>
        </div>
        <Resultado hecho={h.hecho} fallo={h.fallo} />
      </TarjetaApartado>
    )
  }

  const meses = mesesConEstado(ej, d.cierres, hoy)
  const paraCerrar = mesParaCerrar(ej, d.cierres, hoy)
  const paraReabrir = mesParaReabrir(ej, d.cierres)
  const anteriores = d.ejercicios.filter((e) => e.id !== ej.id)
  const estadoTexto = { cerrado: 'cerrado', abierto: 'abierto', futuro: 'aún no ha llegado' } as const

  return (
    <TarjetaApartado titulo={`Ejercicio ${ej.code}`} movil={movil}
      accion={anteriores.length > 0 ? <button type="button" className="cx-enlace" aria-expanded={verAnteriores} onClick={() => setVerAnteriores((v) => !v)}>Años anteriores</button> : undefined}>
      {verAnteriores && (
        <ul className="cx-anteriores" aria-label="Años anteriores">
          {anteriores.map((e) => <li key={e.id}>Ejercicio {e.code} · del {fechaLarga(e.startsOn)} al {fechaLarga(e.endsOn)} · {e.status === 'closed' ? 'cerrado' : 'abierto'}</li>)}
        </ul>
      )}
      <ol className="cx-meses" aria-label={`Meses del ejercicio ${ej.code}`}>
        {meses.map((m) => (
          <li key={m.mes} className={`cx-mes cx-mes-${m.estado}`} aria-label={`${nombreMes(m.mes)}: ${estadoTexto[m.estado]}`}>
            <span>{movil ? m.corto.charAt(0) : m.corto}</span>
            {!movil && <span aria-hidden="true">{m.estado === 'cerrado' ? '✓' : m.estado === 'abierto' ? '•' : '·'}</span>}
          </li>
        ))}
      </ol>
      <div className="cx-meses-pie">
        <span className="cx-ayuda">✓ cerrado, ya no se puede cambiar sin reabrirlo · • abierto</span>
        {paraCerrar && (
          <button type="button" className="cx-boton" disabled={h.guardando}
            onClick={() => void h.hacer(() => cerrarMes(quien.companyId, paraCerrar),
              `Cerrado ${nombreMes(paraCerrar)}: ya no se puede cambiar nada con fecha de ${nombreMes(paraCerrar)} sin reabrirlo.`)}>
            {h.guardando ? 'Cerrando…' : `Cerrar ${nombreMes(paraCerrar)}`}
          </button>
        )}
      </div>
      {!paraCerrar && meses.some((m) => m.estado === 'abierto') && (
        <p className="cx-ayuda" style={{ margin: 0 }}>El mes en curso se cierra cuando termine.</p>
      )}
      {paraReabrir && !reabriendo && (
        <button type="button" className="cx-enlace" style={{ alignSelf: 'flex-start' }} onClick={() => { setReabriendo(true); h.limpiar() }}>
          Reabrir {nombreMes(paraReabrir)}
        </button>
      )}
      {paraReabrir && reabriendo && (
        <form className="cx-formulario" noValidate aria-label={`Reabrir ${nombreMes(paraReabrir)}`} onSubmit={async (e) => {
          e.preventDefault()
          if (motivo.trim() === '') { setFalloMotivo('Para reabrir un mes hay que decir por qué. Queda apuntado.'); return }
          setFalloMotivo(undefined)
          if (await h.hacer(() => reabrirMes(quien.companyId, paraReabrir, motivo),
            `Reabierto ${nombreMes(paraReabrir)}. Queda apuntado quién y por qué: «${motivo.trim()}».`)) { setReabriendo(false); setMotivo('') }
        }}>
          <CampoTexto etiqueta={`Por qué reabres ${nombreMes(paraReabrir)}`} valor={motivo} cambiar={setMotivo} fallo={falloMotivo}
            ayuda="Queda apuntado, con tu nombre y la hora." deshabilitado={h.guardando} />
          <PieFormulario guardando={h.guardando} cancelar={() => { setReabriendo(false); setMotivo('') }} textoGuardar="Reabrir" />
        </form>
      )}
      <Resultado hecho={h.hecho} fallo={h.fallo} />
    </TarjetaApartado>
  )
}

// ── Socios y cargos ─────────────────────────────────────────────────────────

const SOCIO_VACIO: CambiosSocio = { fullName: '', taxId: '', roles: [], ownershipPct: '' }

export function Socios({ d, quien, alCambiar, movil, hoy }: Props) {
  const [editando, setEditando] = useState<string | 'nuevo' | null>(null)
  const h = useHacer(alCambiar)
  if (d.socios === null) {
    return (
      <TarjetaApartado titulo="Socios y cargos" movil={movil}>
        <p className="cx-vacio">Los socios y los cargos solo los ve un administrador de la cuenta.</p>
      </TarjetaApartado>
    )
  }
  const vivos = d.socios.filter((s) => s.endedOn === null)
  const total = vivos.reduce((t, s) => t + (s.ownershipPct ?? 0), 0)
  const enEdicion = editando && editando !== 'nuevo' ? d.socios.find((s) => s.id === editando) ?? null : null

  return (
    <TarjetaApartado titulo="Socios y cargos" movil={movil}
      accion={editando === null ? <button type="button" className="cx-enlace" onClick={() => { setEditando('nuevo'); h.limpiar() }}>+ Añadir</button> : undefined}>
      {editando !== null && (
        <FormSocio inicial={enEdicion} guardando={h.guardando} otros={vivos.filter((s) => s.id !== editando)}
          cancelar={() => { setEditando(null); h.limpiar() }}
          guardar={async (c) => {
            if (await h.hacer(() => guardarSocio(quien.accountId, quien.companyId, quien.userId, enEdicion?.id ?? null, c),
              `Guardado ${c.fullName.trim()}${c.ownershipPct.trim() ? ` con el ${c.ownershipPct.trim()} %` : ''}.`)) setEditando(null)
          }}
          darDeBaja={enEdicion ? async () => {
            if (await h.hacer(() => darDeBajaSocio(enEdicion.id, hoy), `${enEdicion.fullName} deja de estar desde hoy. Queda en el historial.`)) setEditando(null)
          } : undefined} />
      )}
      {vivos.length === 0 && editando === null && <p className="cx-vacio">Aún no has puesto socios ni cargos.</p>}
      <ul className="cx-socios">
        {vivos.map((s) => (
          <li key={s.id}>
            <button type="button" className="cx-socio" onClick={() => { setEditando(s.id); h.limpiar() }} aria-label={`Cambiar ${s.fullName}`}>
              <Inicial texto={iniciales(s.fullName)} redonda />
              <span className="cx-fila-texto">
                <span className="cx-fila-titulo">{s.fullName}</span>
                {s.roles.length > 0 && <span className="cx-fila-apoyo">{textoRoles(s.roles)}</span>}
              </span>
              {s.ownershipPct !== null && <span className="cx-cifra">{porcentaje(s.ownershipPct)}</span>}
            </button>
          </li>
        ))}
      </ul>
      {vivos.length > 0 && total > 0 && total < 100 && (
        <p className="cx-ayuda" style={{ margin: 0 }}>Entre todos suman {porcentaje(total)}: falta {porcentaje(Math.round((100 - total) * 100) / 100)} por repartir.</p>
      )}
      <Resultado hecho={h.hecho} fallo={h.fallo} />
    </TarjetaApartado>
  )
}

function FormSocio({ inicial, otros, guardando, cancelar, guardar, darDeBaja }: {
  inicial: Socio | null; otros: Socio[]; guardando: boolean; cancelar: () => void
  guardar: (c: CambiosSocio) => void; darDeBaja?: () => void
}) {
  const [c, setC] = useState<CambiosSocio>(inicial
    ? { fullName: inicial.fullName, taxId: inicial.taxId ?? '', roles: inicial.roles, ownershipPct: inicial.ownershipPct === null ? '' : String(inicial.ownershipPct).replace('.', ',') }
    : SOCIO_VACIO)
  const [fallos, setFallos] = useState<Record<string, string>>({})
  const alternar = (r: string) => setC((x) => ({ ...x, roles: x.roles.includes(r) ? x.roles.filter((y) => y !== r) : [...x.roles, r] }))
  return (
    <form className="cx-formulario cx-apartado-formulario" noValidate aria-label={inicial ? `Cambiar ${inicial.fullName}` : 'Añadir una persona'} onSubmit={(e) => {
      e.preventDefault()
      const f: Record<string, string> = {}
      if (c.fullName.trim() === '') f.fullName = 'Falta el nombre.'
      const pct = c.ownershipPct.trim() === '' ? null : Number(c.ownershipPct.replace(',', '.'))
      if (pct !== null && (!Number.isFinite(pct) || pct < 0 || pct > 100)) f.ownershipPct = 'El porcentaje va de 0 a 100.'
      if (c.roles.length === 0 && pct === null) f.roles = 'Di si es socio (con su porcentaje) o qué cargo tiene.'
      if (!f.ownershipPct) {
        const r = revisarSocios([...otros.map((o) => ({ pct: o.ownershipPct, vigente: true })), { pct, vigente: true }])
        if (r.length) f.ownershipPct = r[0].texto
      }
      setFallos(f)
      if (Object.keys(f).length === 0) guardar(c)
    }}>
      <CampoTexto etiqueta="Nombre y apellidos" valor={c.fullName} cambiar={(v) => setC((x) => ({ ...x, fullName: v }))} fallo={fallos.fullName} deshabilitado={guardando} />
      <CampoTexto etiqueta="NIF (si quieres)" valor={c.taxId} cambiar={(v) => setC((x) => ({ ...x, taxId: v }))} deshabilitado={guardando} />
      <fieldset className="cx-fieldset" disabled={guardando} aria-describedby={fallos.roles ? 'socio-roles-fallo' : undefined}>
        <legend className="cx-etiqueta">Qué es en la empresa</legend>
        <div className="cx-casillas">
          {Object.entries(ROLES).map(([r, t]) => (
            <label key={r} className="cx-casilla">
              <input type="checkbox" checked={c.roles.includes(r)} onChange={() => alternar(r)} /><span>{t}</span>
            </label>
          ))}
        </div>
        {fallos.roles && <span id="socio-roles-fallo" className="cx-error" role="alert">{fallos.roles}</span>}
      </fieldset>
      <CampoTexto etiqueta="Porcentaje de la empresa (si es socio)" valor={c.ownershipPct} cambiar={(v) => setC((x) => ({ ...x, ownershipPct: v }))}
        modo="decimal" fallo={fallos.ownershipPct} deshabilitado={guardando} />
      <div className="cx-pie">
        {darDeBaja && <button type="button" className="cx-boton-sec" onClick={darDeBaja} disabled={guardando} style={{ marginRight: 'auto' }}>Ya no está</button>}
        <button type="button" className="cx-boton-sec" onClick={cancelar} disabled={guardando}>Cancelar</button>
        <button type="submit" className="cx-boton" disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar'}</button>
      </div>
    </form>
  )
}
