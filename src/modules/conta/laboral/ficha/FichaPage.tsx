// src/modules/conta/laboral/ficha/FichaPage.tsx
//
// N1 · PR 2 · Paso 1 (02/11/2026) · La ficha nueva de una persona, en Sumied ›
// Laboral › Equipo. Fiel a las pantallas 1 a 3 de la maqueta aprobada:
// Resumen, Contrato y salario e Impuestos (IRPF). Las otras pestañas no salen
// hasta que su maqueta esté aprobada (Julio, N1·5): mientras, se ven en la
// ficha de antes, y la página lo dice con su enlace.
//
// Reglas de Julio del 02/11: la palabra de la calle primero y el nombre oficial
// después, en pequeño; el código delante y siempre a la vista; lo que falta se
// dice («Falta»), lo que Sumied aún no hace dice «Pendiente · …», y nada se
// inventa. Lo privado (documento, Seguridad Social, IBAN, lo que cobra, IRPF)
// solo lo recibe quien tiene el permiso de Laboral: lo decide lab_ficha.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useApp } from '@/context/AppContext'
import { Boton, Chip, Selector, Tarjeta } from '@/modules/conta/diseno'
import { CONTA, rutaConta } from '@/config/navegacion'
import { SUMIED, conProductoLaboral } from '@/modules/personal/laboral/productoLaboral'
import { fetchDocuments } from '@/services/documentsService'
import type { DocumentFile } from '@/types/personal'
import TiempoPestana from './tiempo/TiempoPestana'
import { cambiarPermisoLaboral, leerFicha, ponerCategoria, ponerIban, type Ficha } from './fichaService'
import {
  DE_DONDE, conCodigo, edad, euros, fecha, frasesMinimo, fraseResumen, ibanBonito, jornada, mesesDePagas,
  oficialSiDistinto, pais, porcentaje, proximoTrienio, finDePrueba, avisosDeLaFicha, vacacionesDelConvenio,
} from './fichaTextos'

type Pestana = 'resumen' | 'contrato' | 'irpf' | 'tiempo'
const PESTANAS: { id: Pestana; texto: string }[] = [
  { id: 'resumen', texto: 'Resumen' },
  { id: 'contrato', texto: 'Contrato y salario' },
  { id: 'irpf', texto: 'Impuestos (IRPF)' },
  // N1 · PR 3: el orden de la maqueta (Seguridad Social irá antes, cuando se construya).
  { id: 'tiempo', texto: 'Tiempo y turnos' },
]
const TITULO: Record<Pestana, string> = { resumen: '', contrato: 'Contrato y salario', irpf: 'Su IRPF, explicado', tiempo: 'Su tiempo y sus turnos' }

const PENDIENTE_SS = 'Pendiente · Sumied lo hará cuando conecte con la Seguridad Social'
const PENDIENTE_SEPE = 'Pendiente · Sumied lo hará cuando conecte con el SEPE'
const SOLO_CON_PERMISO = 'Solo lo ve quien tiene el permiso de Laboral'

const hoyISO = () => new Date().toISOString().slice(0, 10)
const fichaDeAntes = (id: string) => `${rutaConta(CONTA.rutas.laboral)}?employee=${encodeURIComponent(id)}`

/** Una fila «etiqueta · valor» de las tarjetas de datos. */
function Dato({ etiqueta, children, oficial, prueba }: { etiqueta: string; children: ReactNode; oficial?: string; prueba?: string }) {
  return (
    <div className="s-persona-dato" data-prueba={prueba}>
      <dt>{etiqueta}</dt>
      <dd>{children}{oficial && <small className="s-persona-oficial">{oficial}</small>}</dd>
    </div>
  )
}
const Falta = ({ children = 'Falta' }: { children?: ReactNode }) => <span className="s-persona-falta">{children}</span>

export default function FichaPage() {
  const { id = '' } = useParams<{ id: string }>()
  const [params, setParams] = useSearchParams()
  const pestana: Pestana = (PESTANAS.find((p) => p.id === params.get('pestana'))?.id) ?? 'resumen'
  const irA = (p: Pestana) => setParams(p === 'resumen' ? {} : { pestana: p }, { replace: true })
  const { activeAccountId } = useApp()

  const [ficha, setFicha] = useState<Ficha | null>(null)
  const [error, setError] = useState('')
  const [docs, setDocs] = useState<DocumentFile[] | null>(null)
  const [hecho, setHecho] = useState<{ tono: 'seguro' | 'falta'; texto: string } | null>(null)

  // Cada recarga sube la vuelta; el efecto lee la ficha al cambiar la persona o la vuelta.
  const [vuelta, setVuelta] = useState(0)
  const recargar = useCallback(async () => { setError(''); setVuelta((v) => v + 1) }, [])

  useEffect(() => {
    let vivo = true
    leerFicha(id)
      .then((f) => { if (vivo) { setFicha(f); setError('') } })
      .catch((e: unknown) => { if (vivo) setError(e instanceof Error ? e.message : 'No se ha podido leer la ficha.') })
    return () => { vivo = false }
  }, [id, vuelta])
  useEffect(() => {
    let vivo = true
    fetchDocuments(id).then((d) => { if (vivo) setDocs(d ?? []) }).catch(() => { if (vivo) setDocs([]) })
    return () => { vivo = false }
  }, [id])

  const contenido = (
    <div className="s-persona" data-prueba="ficha-persona">
      <nav className="s-persona-migas" aria-label="Dónde estás">
        <Link to={rutaConta(CONTA.rutas.laboral)}>Equipo</Link>
        {ficha && <> › {pestana === 'resumen' ? <span>{ficha.persona.nombre}</span> : <button type="button" className="s-persona-miga" onClick={() => irA('resumen')}>{ficha.persona.nombre}</button>}</>}
        {pestana !== 'resumen' && <> › <span>{PESTANAS.find((p) => p.id === pestana)?.texto}</span></>}
      </nav>

      {error && (
        <Tarjeta titulo="No se ha podido leer la ficha" tono="falta" accion={<Boton onClick={() => void recargar()}>Volver a intentar</Boton>}>
          <p className="s-apoyo" role="alert">{error}</p>
        </Tarjeta>
      )}
      {!error && !ficha && <p className="s-apoyo" role="status">Leyendo la ficha…</p>}

      {ficha && (
        <>
          {pestana === 'resumen'
            ? <Cabecera ficha={ficha} cuenta={activeAccountId} alCambiar={recargar} irA={irA} setHecho={setHecho} />
            : <div className="s-persona-titulo-fila"><h1 className="s-persona-h1">{TITULO[pestana]}</h1>
                {pestana === 'contrato' && <Boton variante="principal" onClick={() => document.getElementById('ficha-convenio')?.scrollIntoView({ behavior: 'smooth' })}>Cambiar algo del contrato</Boton>}</div>}

          {hecho && <p className="s-aviso-lista" data-tono={hecho.tono} role={hecho.tono === 'seguro' ? 'status' : 'alert'} data-prueba="ficha-hecho">{hecho.texto}</p>}

          {pestana === 'resumen' && <Avisos ficha={ficha} />}

          <div role="tablist" aria-label="Qué ver de la persona" className="s-persona-pestanas">
            {PESTANAS.map((p) => (
              <button key={p.id} type="button" role="tab" aria-selected={pestana === p.id} onClick={() => irA(p.id)} data-prueba={`ficha-pestana-${p.id}`}>{p.texto}</button>
            ))}
          </div>

          {pestana === 'resumen' && <Resumen ficha={ficha} docs={docs} irA={irA} />}
          {pestana === 'contrato' && <ContratoYSalario ficha={ficha} alCambiar={recargar} setHecho={setHecho} />}
          {pestana === 'irpf' && <Irpf ficha={ficha} />}
          {pestana === 'tiempo' && <TiempoPestana ficha={ficha} />}
        </>
      )}
    </div>
  )
  return conProductoLaboral(SUMIED, contenido)
}

// ─── Cabecera (pantalla 1) ──────────────────────────────────────────────────

function Cabecera({ ficha, cuenta, alCambiar, irA, setHecho }: {
  ficha: Ficha; cuenta: string | null; alCambiar: () => Promise<void>; irA: (p: Pestana) => void
  setHecho: (h: { tono: 'seguro' | 'falta'; texto: string } | null) => void
}) {
  const p = ficha.persona
  const [abierto, setAbierto] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const iniciales = p.nombre.split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]?.toUpperCase()).join('')
  const puedeDarPermiso = p.con_permiso_laboral !== null && p.usuario_id !== null && cuenta !== null

  async function permiso() {
    if (!puedeDarPermiso || !p.usuario_id || !cuenta) return
    const dar = !p.con_permiso_laboral
    setOcupado(true); setHecho(null)
    try {
      const n = await cambiarPermisoLaboral(cuenta, p.usuario_id, dar)
      setHecho({ tono: 'seguro', texto: `${dar ? 'Dado' : 'Quitado'}: ${p.nombre} ${dar ? 'ya puede' : 'ya no puede'} ver lo privado de Laboral (documentos, lo que cobra, IRPF). Lo tienen ${n} ${n === 1 ? 'persona' : 'personas'} en la cuenta.` })
      await alCambiar()
    } catch (e) {
      setHecho({ tono: 'falta', texto: e instanceof Error ? e.message : 'No se ha podido cambiar el permiso.' })
    } finally { setOcupado(false); setAbierto(false) }
  }

  return (
    <section className="s-tarjeta s-persona-cabecera" aria-label="La persona">
      <div className="s-persona-avatar" aria-hidden="true">{p.foto ? <img src={p.foto} alt="" /> : iniciales}</div>
      <div className="s-persona-quien">
        <h1 className="s-persona-h1">{p.nombre}
          <Chip tono={p.activa ? 'seguro' : 'neutro'}>{p.activa ? 'De alta' : 'De baja'}</Chip>
          <Chip tono="neutro">{p.portal ? 'Entra en su portal' : 'No entra en su portal'}</Chip>
          {p.con_permiso_laboral && <Chip tono="accion">Con permiso de Laboral</Chip>}
        </h1>
        <p className="s-persona-frase" data-prueba="ficha-frase">{fraseResumen(ficha) || 'Aún no hay contrato en Sumied.'}</p>
      </div>
      <div className="s-persona-botones">
        <Boton variante="principal" onClick={() => irA('contrato')}>Cambiar algo del contrato</Boton>
        <div className="s-persona-menu">
          <Boton variante="secundario" aria-expanded={abierto} onClick={() => setAbierto((x) => !x)} data-prueba="ficha-mas-acciones">Más acciones</Boton>
          {abierto && (
            <ul className="s-persona-menu-lista" role="menu">
              {puedeDarPermiso && (
                <li role="none"><button type="button" role="menuitem" onClick={() => void permiso()} disabled={ocupado} data-prueba="ficha-permiso">
                  {p.con_permiso_laboral ? 'Quitarle el permiso de Laboral' : 'Darle el permiso de Laboral'}
                </button></li>
              )}
              {p.con_permiso_laboral !== null && p.usuario_id === null && (
                <li role="none" className="s-persona-menu-nota">El permiso de Laboral solo se puede dar a quien entra en su portal.</li>
              )}
              <li role="none"><Link role="menuitem" to={fichaDeAntes(p.id)}>Abrir la ficha de antes</Link></li>
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}

function Avisos({ ficha }: { ficha: Ficha }) {
  const avisos = avisosDeLaFicha(ficha, hoyISO())
  if (avisos.length === 0) return null
  return (
    <div className="s-persona-avisos" data-prueba="ficha-avisos">
      {avisos.map((a) => <p key={a.clave} className="s-aviso-lista" data-tono={a.tono}>{a.texto}</p>)}
    </div>
  )
}

// ─── Resumen (pantalla 1) ───────────────────────────────────────────────────

function Resumen({ ficha, docs, irA }: { ficha: Ficha; docs: DocumentFile[] | null; irA: (p: Pestana) => void }) {
  const p = ficha.persona, ct = ficha.contrato, s = ficha.salario, i = ficha.irpf
  const priv = ficha.privado
  const hoy = hoyISO()
  const prueba = ct ? finDePrueba(ct, hoy) : null
  return (
    <div className="s-persona-rejilla">
      <Tarjeta titulo="Quién es" nivel={2}>
        <dl className="s-persona-datos">
          <Dato etiqueta="Documento">{priv ? (p.documento ?? <Falta />) : <Falta>{SOLO_CON_PERMISO}</Falta>}</Dato>
          <Dato etiqueta="Nacimiento">{priv ? (p.nacimiento ? `${fecha(p.nacimiento)} · ${edad(p.nacimiento, hoy)} años` : <Falta />) : <Falta>{SOLO_CON_PERMISO}</Falta>}</Dato>
          <Dato etiqueta="Nacionalidad">{pais(p.nacionalidad) ?? <Falta />}</Dato>
          <Dato etiqueta="Nº Seguridad Social">{priv ? (p.naf ?? <Falta />) : <Falta>{SOLO_CON_PERMISO}</Falta>}</Dato>
          <Dato etiqueta="Domicilio">{priv ? (p.domicilio ?? <Falta />) : <Falta>{SOLO_CON_PERMISO}</Falta>}</Dato>
          <Dato etiqueta="Móvil">{p.movil ?? <Falta />}</Dato>
          <Dato etiqueta="Correo">{p.correo ?? <Falta />}</Dato>
          <Dato etiqueta="Estudios" prueba="ficha-estudios"><Falta /></Dato>
        </dl>
        {p.de_cegid && <p className="s-persona-nota">Estos datos vinieron del fichero de Cegid. «Estudios» falta porque el que traía Cegid era su valor por defecto, no el de la persona.</p>}
      </Tarjeta>

      <Tarjeta titulo="Su contrato" accion={<button type="button" className="s-persona-enlace" onClick={() => irA('contrato')}>Ver entero</button>}>
        {!ct ? <p className="s-apoyo">Aún no hay contrato en Sumied.</p> : (
          <>
            <dl className="s-persona-datos">
              <Dato etiqueta="Tipo">{ct.tipo ? conCodigo(ct.tipo) : <Falta />}</Dato>
              <Dato etiqueta="Desde">{ct.desde ? `${fecha(ct.desde)}${prueba ? ` · ${prueba.texto}` : ''}` : <Falta />}</Dato>
              <Dato etiqueta="Puesto">{ct.puesto ?? p.puesto ?? <Falta />}</Dato>
              <Dato etiqueta="Centro">{ct.centro?.nombre ?? <Falta />}</Dato>
              <Dato etiqueta="Convenio">{ct.convenio ? (ct.convenio.nombre ?? `Código ${ct.convenio.codigo}`) : <Falta />}</Dato>
              <Dato etiqueta="Grupo">{ct.grupo ? conCodigo(ct.grupo, 'Grupo') : <Falta />}</Dato>
              <Dato etiqueta="Jornada">{jornada(ct) || <Falta />}{ct.horas_semana ? ` · ${ct.horas_semana} h a la semana` : ''}</Dato>
            </dl>
            <ul className="s-persona-chips">
              <li><Chip tono="neutro" titulo={PENDIENTE_SS}>Su alta en la Seguridad Social: pendiente</Chip></li>
              <li><Chip tono="neutro" titulo={PENDIENTE_SEPE}>Aviso del contrato al SEPE: pendiente</Chip></li>
            </ul>
            <p className="s-persona-nota">{PENDIENTE_SS}. El aviso al SEPE (Contrat@), igual.</p>
          </>
        )}
      </Tarjeta>

      <Tarjeta titulo="Lo que cobra" accion={priv && <button type="button" className="s-persona-enlace" onClick={() => irA('contrato')}>Ver los conceptos</button>}>
        {!priv || !s ? <p className="s-apoyo">{SOLO_CON_PERMISO}.</p> : (
          <>
            <p className="s-persona-grande" data-prueba="ficha-bruto">{s.bruto_mes != null ? euros(s.bruto_mes) : <Falta />}</p>
            <p className="s-persona-sub">brutos al mes · en {s.pagas} pagas</p>
            <dl className="s-persona-datos s-persona-datos-cifras">
              <Dato etiqueta="Neto al mes, aproximado">{s.nomina_cegid?.liquido != null ? euros(s.nomina_cegid.liquido) : <Falta />}</Dato>
              <Dato etiqueta="Le cuesta a la empresa al mes">{s.nomina_cegid?.coste != null ? euros(s.nomina_cegid.coste) : <Falta />}</Dato>
              <Dato etiqueta="Cobra por">{p.iban ? `Transferencia · ${ibanBonito(p.iban, true)}` : <Falta>Falta su IBAN</Falta>}</Dato>
            </dl>
            {s.nomina_cegid && <p className="s-persona-nota">El neto y el coste son los de su última nómina de Cegid ({s.nomina_cegid.periodo}).</p>}
          </>
        )}
      </Tarjeta>

      <Tarjeta titulo="Su IRPF" accion={priv && <button type="button" className="s-persona-enlace" onClick={() => irA('irpf')}>Ver por qué</button>}>
        {!priv || !i ? <p className="s-apoyo">{SOLO_CON_PERMISO}.</p> : (
          <>
            <p className="s-persona-grande">{i.pct != null ? porcentaje(i.pct) : <Falta />} {i.nomina_cegid && <Chip tono="neutro">de su nómina de Cegid · {i.nomina_cegid.periodo}</Chip>}</p>
            {i.modelo_145?.situacion
              ? <p className="s-apoyo">{conCodigo(i.modelo_145.situacion)}.</p>
              : <p className="s-apoyo"><Falta>Faltan sus datos para el IRPF (familia, hijos…)</Falta> <small className="s-persona-oficial">modelo 145</small></p>}
            <p className="s-persona-nota">Pendiente · Sumied lo calculará solo cuando haga las nóminas. Hasta entonces, es el que puso Cegid.</p>
          </>
        )}
      </Tarjeta>

      <Tarjeta titulo="Este mes" accion={<button type="button" className="s-persona-enlace" onClick={() => irA('tiempo')}>Ver fichajes</button>}>
        <p className="s-apoyo">Sus horas, sus fichajes y su bolsa de horas, en «Tiempo y turnos». Sus vacaciones, de momento, en la ficha de antes.</p>
      </Tarjeta>

      <Tarjeta titulo="Sus documentos" accion={docs && docs.length > 0 && <Link className="s-persona-enlace" to={fichaDeAntes(p.id)}>Ver los {docs.length}</Link>}>
        {docs === null ? <p className="s-apoyo" role="status">Leyendo…</p>
          : docs.length === 0 ? <p className="s-apoyo">No tiene ningún documento todavía.</p>
          : (
            <ul className="s-persona-docs" data-prueba="ficha-documentos">
              {docs.slice(0, 4).map((d) => <li key={d.id}><span>{d.name}</span><span className="s-persona-sub">{fecha(d.createdAt)}</span></li>)}
            </ul>
          )}
      </Tarjeta>
    </div>
  )
}

// ─── Contrato y salario (pantalla 2) ────────────────────────────────────────

function ContratoYSalario({ ficha, alCambiar, setHecho }: {
  ficha: Ficha; alCambiar: () => Promise<void>; setHecho: (h: { tono: 'seguro' | 'falta'; texto: string } | null) => void
}) {
  const ct = ficha.contrato, s = ficha.salario, p = ficha.persona
  const hoy = hoyISO()
  if (!ct) return <Tarjeta titulo="Aún no hay contrato en Sumied"><p className="s-apoyo">Cuando se pase su contrato desde Cegid o se dé de alta, saldrá aquí.</p></Tarjeta>
  const prueba = finDePrueba(ct, hoy)
  const trienio = proximoTrienio(ct.antiguedad, hoy)
  const mensuales = (s?.conceptos ?? []).filter((c) => c.periodicidad === 'mes')
  const extras = (s?.pagas ?? 12) - 12
  const meses = mesesDePagas(ct.convenio)
  const minimo = s ? frasesMinimo(s) : null

  return (
    <div className="s-persona-columnas">
      <div className="s-persona-principal">
        <Tarjeta titulo="El contrato">
          <dl className="s-persona-datos s-persona-datos-anchos">
            <Dato etiqueta="Tipo de contrato" oficial={oficialSiDistinto(ct.tipo)} prueba="ficha-tipo">{ct.tipo ? conCodigo(ct.tipo) : <Falta />}</Dato>
            <Dato etiqueta="Empieza">{ct.desde ? `${fecha(ct.desde)} · ${ct.hasta ? `acaba el ${fecha(ct.hasta)}` : 'sin fecha de fin'}` : <Falta />}</Dato>
            <Dato etiqueta="Periodo de prueba">{ct.prueba_dias ? `${ct.prueba_dias} días${prueba ? ` · ${prueba.texto}` : ''}` : <Falta />}</Dato>
            <Dato etiqueta="Antigüedad para trienios">{ct.antiguedad ? fecha(ct.antiguedad) : <Falta />}</Dato>
            <Dato etiqueta="Puesto y funciones">{ct.puesto ?? p.puesto ?? <Falta />}</Dato>
            <Dato etiqueta="Centro de trabajo">{ct.centro?.nombre ?? <Falta />}{ct.cuenta_cotizacion ? ` · cuenta de cotización ${ct.cuenta_cotizacion}` : ''}</Dato>
            <Dato etiqueta="Grupo de cotización" oficial={oficialSiDistinto(ct.grupo)} prueba="ficha-grupo">{ct.grupo ? conCodigo(ct.grupo, 'Grupo') : <Falta />}</Dato>
            <Dato etiqueta="Ocupación" oficial={ct.ocupacion ? (oficialSiDistinto(ct.ocupacion) || 'CNO') : 'CNO'}>{ct.ocupacion ? conCodigo(ct.ocupacion) : <Falta>Falta: Cegid no la trae</Falta>}</Dato>
            <Dato etiqueta="Bonificaciones">{Array.isArray(ct.bonificaciones) && ct.bonificaciones.length > 0 ? `${ct.bonificaciones.length} apuntadas` : 'Ninguna apuntada'}</Dato>
          </dl>
        </Tarjeta>

        <span id="ficha-convenio" />
        <Tarjeta titulo="Convenio y jornada">
          <dl className="s-persona-datos s-persona-datos-anchos">
            <Dato etiqueta="Convenio">{ct.convenio ? `${ct.convenio.nombre ?? `Código ${ct.convenio.codigo}`}${ct.convenio.cargado ? '' : ' · sin cargar en Sumied'}` : <Falta />}</Dato>
            <Dato etiqueta="Categoría" prueba="ficha-categoria">
              {ct.categoria ? (ct.categoria_nombre ?? ct.categoria) : <ElegirCategoria ficha={ficha} alCambiar={alCambiar} setHecho={setHecho} />}
            </Dato>
            <Dato etiqueta="Jornada">{jornada(ct) || <Falta />}{ct.horas_semana ? ` · ${ct.horas_semana} horas a la semana` : ''}</Dato>
            <Dato etiqueta="Vacaciones">{vacacionesDelConvenio(ct.convenio?.vacaciones) ? `${vacacionesDelConvenio(ct.convenio?.vacaciones)}, según convenio` : <Falta />}</Dato>
          </dl>
        </Tarjeta>
      </div>

      <div className="s-persona-lateral">
        <Tarjeta titulo="Lo que cobra cada mes" compacta={false}>
          {!s ? <p className="s-apoyo">{SOLO_CON_PERMISO}.</p> : mensuales.length === 0 ? <p className="s-apoyo"><Falta>Aún no tiene conceptos de salario.</Falta></p> : (
            <>
              <table className="s-tabla s-persona-conceptos" data-prueba="ficha-conceptos">
                <thead><tr><th>Concepto</th><th>De dónde sale</th><th className="s-num">€ al mes</th></tr></thead>
                <tbody>
                  {mensuales.map((c) => <tr key={`${c.origen}-${c.codigo}`}><td>{c.nombre ?? c.codigo}</td><td>{DE_DONDE[c.origen]}</td><td className="s-num">{euros(c.importe)}</td></tr>)}
                </tbody>
                <tfoot><tr><th colSpan={2}>Total bruto</th><th className="s-num">{euros(s.bruto_mes)}</th></tr></tfoot>
              </table>
              {extras > 0 && <p className="s-persona-nota">Además, {extras} {extras === 1 ? 'paga extra' : 'pagas extra'}: se cobran aparte{meses ? `, en ${meses}` : ''}.</p>}
            </>
          )}
        </Tarjeta>

        {minimo && (
          <Tarjeta titulo={minimo.titulo} tono={minimo.tono === 'seguro' ? 'ok' : minimo.tono}>
            <p className="s-apoyo" data-prueba="ficha-minimo">{minimo.texto}</p>
          </Tarjeta>
        )}

        <Tarjeta titulo="Lo que va a cambiar">
          {(() => {
            const filas: [string, string][] = []
            if (prueba && !prueba.superado) filas.push([prueba.fecha, 'Acaba su periodo de prueba'])
            if (trienio) filas.push([trienio, 'Cumple un trienio de antigüedad: mira lo que le sube su convenio'])
            if (ct.hasta && ct.hasta >= hoy) filas.push([ct.hasta, 'Acaba su contrato'])
            filas.sort((a, b) => a[0].localeCompare(b[0]))
            return filas.length === 0 ? <p className="s-apoyo">Nada apuntado.</p> : (
              <dl className="s-persona-datos">{filas.map(([f, t]) => <Dato key={f + t} etiqueta={fecha(f)}>{t}</Dato>)}</dl>
            )
          })()}
        </Tarjeta>

        <ComoCobra ficha={ficha} alCambiar={alCambiar} setHecho={setHecho} />
      </div>
    </div>
  )
}

function ElegirCategoria({ ficha, alCambiar, setHecho }: {
  ficha: Ficha; alCambiar: () => Promise<void>; setHecho: (h: { tono: 'seguro' | 'falta'; texto: string } | null) => void
}) {
  const ct = ficha.contrato!
  const [valor, setValor] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const opciones = useMemo(() => [{ valor: '', texto: 'Elige su categoría…' }, ...ct.categorias.map((c) => ({ valor: c.categoria, texto: c.nombre ?? c.categoria }))], [ct.categorias])
  if (!ct.convenio) return <Falta>Falta la categoría: primero, su convenio</Falta>
  if (ct.categorias.length === 0) return <Falta>Falta la categoría: las tablas de su convenio no están en Sumied</Falta>

  async function guardar() {
    if (!valor) return
    setOcupado(true); setHecho(null)
    try {
      const r = await ponerCategoria(ct.id, valor)
      setHecho({ tono: 'seguro', texto: `Guardada: su categoría es ${r.nombre ?? r.categoria}, desde hoy. Queda en el historial.` })
      await alCambiar()
    } catch (e) {
      setHecho({ tono: 'falta', texto: e instanceof Error ? e.message : 'No se ha podido guardar la categoría.' })
    } finally { setOcupado(false) }
  }
  return (
    <span className="s-persona-elegir">
      <Falta>Falta la categoría</Falta>
      <Selector valor={valor} alCambiar={setValor} opciones={opciones} aria-label="Su categoría del convenio" data-prueba="ficha-categoria-elegir" />
      <Boton variante="secundario" onClick={() => void guardar()} disabled={!valor || ocupado} data-prueba="ficha-categoria-guardar">{ocupado ? 'Guardando…' : 'Guardar'}</Boton>
    </span>
  )
}

function ComoCobra({ ficha, alCambiar, setHecho }: {
  ficha: Ficha; alCambiar: () => Promise<void>; setHecho: (h: { tono: 'seguro' | 'falta'; texto: string } | null) => void
}) {
  const p = ficha.persona
  const [editando, setEditando] = useState(false)
  const [texto, setTexto] = useState('')
  const [ocupado, setOcupado] = useState(false)
  if (!ficha.privado) return <Tarjeta titulo="Cómo cobra"><p className="s-apoyo">{SOLO_CON_PERMISO}.</p></Tarjeta>

  async function guardar() {
    setOcupado(true); setHecho(null)
    try {
      const r = await ponerIban(p.id, texto)
      setHecho({ tono: 'seguro', texto: r.cambia ? `Guardado: cobrará en ${ibanBonito(r.iban, true)}. Queda en el historial con tu nombre y la hora.` : 'Era el mismo IBAN: no ha cambiado nada.' })
      setEditando(false); setTexto('')
      await alCambiar()
    } catch (e) {
      setHecho({ tono: 'falta', texto: e instanceof Error ? e.message : 'No se ha podido guardar el IBAN.' })
    } finally { setOcupado(false) }
  }

  return (
    <Tarjeta titulo="Cómo cobra" accion={!editando && <Boton variante="enlace" onClick={() => { setEditando(true); setTexto(p.iban ?? '') }} data-prueba="ficha-iban-cambiar">{p.iban ? 'Cambiar el IBAN' : 'Poner el IBAN'}</Boton>}>
      {!editando && (p.iban
        ? <p className="s-apoyo" data-prueba="ficha-iban">Transferencia a <strong>{ibanBonito(p.iban)}</strong></p>
        : <p className="s-apoyo" data-prueba="ficha-iban"><Falta>Falta su IBAN</Falta></p>)}
      {editando && (
        <form className="s-persona-iban" onSubmit={(e) => { e.preventDefault(); void guardar() }}>
          <label>
            <span>Su IBAN (cuenta donde cobra)</span>
            <input className="s-control" value={texto} onChange={(e) => setTexto(e.target.value)} autoComplete="off" spellCheck={false}
              placeholder="ES00 0000 0000 0000 0000 0000" data-prueba="ficha-iban-campo" />
          </label>
          <div className="s-persona-iban-botones">
            <Boton variante="principal" type="submit" disabled={ocupado || !texto.trim()} data-prueba="ficha-iban-guardar">{ocupado ? 'Guardando…' : 'Guardar'}</Boton>
            <Boton variante="fantasma" onClick={() => setEditando(false)}>Cancelar</Boton>
          </div>
        </form>
      )}
      <p className="s-persona-nota">Solo lo cambia quien tiene el permiso de Laboral, y queda en el historial quién y cuándo. Las nóminas se pagan a esta cuenta.</p>
    </Tarjeta>
  )
}

// ─── Impuestos (IRPF) (pantalla 3) ──────────────────────────────────────────

function Irpf({ ficha }: { ficha: Ficha }) {
  const i = ficha.irpf
  if (!ficha.privado || !i) return <Tarjeta titulo="Su IRPF"><p className="s-apoyo">{SOLO_CON_PERMISO}.</p></Tarjeta>
  const m = i.modelo_145
  return (
    <div className="s-persona-columnas">
      <div className="s-persona-principal">
        <Tarjeta>
          <p className="s-persona-enorme" data-prueba="ficha-irpf">{i.pct != null ? porcentaje(i.pct) : <Falta />}
            {i.nomina_cegid && <Chip tono="neutro">De su nómina de Cegid · {i.nomina_cegid.periodo}</Chip>}</p>
          <p className="s-persona-frase">
            {i.nomina_cegid?.retencion != null
              ? <>En su última nómina de Cegid le retuvimos <strong>{euros(i.nomina_cegid.retencion)}</strong>{i.nomina_cegid.base_irpf != null ? <> sobre <strong>{euros(i.nomina_cegid.base_irpf)}</strong> que cuentan para el IRPF</> : null}.</>
              : 'Es el tipo que puso Cegid en su última nómina.'}
          </p>
        </Tarjeta>
        <Tarjeta titulo="Cómo se ha calculado, paso a paso">
          <p className="s-apoyo"><Chip tono="neutro">Pendiente</Chip> Sumied lo calculará solo, con el mismo cálculo que el programa de Hacienda, cuando haga las nóminas. Hasta entonces, el tipo es el que puso Cegid y no se explica aquí.</p>
        </Tarjeta>
      </div>
      <div className="s-persona-lateral">
        <Tarjeta titulo={<>Sus datos para el IRPF (familia, hijos…) <small className="s-persona-oficial">modelo 145</small></>}>
          {!m ? <p className="s-apoyo" data-prueba="ficha-145"><Falta>Falta: aún no nos los ha dado.</Falta></p> : (
            <dl className="s-persona-datos" data-prueba="ficha-145">
              <Dato etiqueta="Situación familiar" oficial={oficialSiDistinto(m.situacion)}>{m.situacion ? conCodigo(m.situacion) : <Falta />}</Dato>
              <Dato etiqueta="Hijos">{m.hijos === 0 ? 'Ninguno' : m.hijos}</Dato>
              <Dato etiqueta="Ascendientes">{m.ascendientes === 0 ? 'Ninguno a su cargo' : m.ascendientes}</Dato>
              <Dato etiqueta="Discapacidad" oficial={oficialSiDistinto(m.discapacidad)}>{m.discapacidad ? conCodigo(m.discapacidad) : 'No'}</Dato>
              {m.tipo_voluntario != null && <Dato etiqueta="Ha pedido un tipo más alto">{porcentaje(m.tipo_voluntario)}</Dato>}
            </dl>
          )}
          {m && <p className="s-persona-nota">{m.firmado_at ? `Lo firmó el ${fecha(m.firmado_at)}.` : 'Sin firmar.'} Vale desde el {fecha(m.efecto_desde)}.</p>}
        </Tarjeta>
      </div>
    </div>
  )
}
