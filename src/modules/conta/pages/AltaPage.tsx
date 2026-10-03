// src/modules/conta/pages/AltaPage.tsx
//
// El alta conversada (encargo C00 §6.4; maquetas N1Alta y M1Alta). Pantalla
// propia, sin el menú del módulo: a la izquierda la conversación, a la
// derecha «Tu empresa» rellenándose con sus marcas (en el móvil, una tarjeta
// con lo último que se apuntó y «Ver todo»).
//
// · La IA propone y la persona contesta de un toque: cada pregunta trae la
//   respuesta normal (la primera) y un «No lo sé» que deja la normal y la
//   apunta como duda para el asesor.
// · Nunca inventa: las actividades salen del IAE y la CNAE cargados; si no
//   encuentra nada, lo dice y deja buscar a mano.
// · Cada respuesta se guarda al momento; el paso va en la empresa y se sigue
//   desde otro dispositivo.
// · Todo lo que hace el alta se puede hacer sin IA desde «Tu empresa».
// · Sin asesor en el alta (D4). La voz responde «Muy pronto».

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useIsMobile } from '@/shell/useIsMobile'
import { rutaTuEmpresa } from '@/config/navegacion'
import { useCuentaConta, leerDatosDeLaCuenta, type DatosDeLaCuenta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useDatosEmpresa } from '@/modules/conta/empresa/useDatosEmpresa'
import { MarcaIA, TarjetaCargando, ErrorConReintento } from '@/modules/conta/ui/piezas'
import { Microfono } from '@/modules/conta/ui/Icono'
import { TEXTO_MUY_PRONTO } from '@/modules/conta/marco/muyPronto'
import {
  NUMERO_PASO, TOTAL_PASOS, modelosDeRespuestas, pasoSiguiente, preguntaActual, territorioPorCp, textoDuda,
  type ClavePregunta, type ContextoAlta, type PasoAlta, type Pregunta,
} from '@/modules/conta/alta/guion'
import { gruposDe, proponer, type PropuestaActividad } from '@/modules/conta/alta/actividades'
import {
  anadirBanco, apuntarDuda, buscarParaGrupos, crearEmpresa, ponerDireccion, ponerEnPerfil, ponerNombre, ponerPaso, terminarAlta,
  type DireccionAlta,
} from '@/modules/conta/services/altaService'
import { anadirActividadConIa, ponerConIa } from '@/modules/conta/services/iaService'
import { abrirEjercicio, anadirActividad, buscarCnae, buscarIae, type OpcionCodigo } from '@/modules/conta/services/empresaDatosService'
import { validarNifEs } from '@/modules/conta/lib/nif'
import { validarIban } from '@/modules/conta/lib/iban'
import { provinciaPorCp } from '@/modules/conta/lib/direccion'
import { hoyEnMadrid } from '@/modules/conta/lib/formato'
import { proponerAlta } from '@/modules/conta/lib/propuestaAlta'
import { marcaDe } from '@/modules/conta/ia/tipos'
import {
  codigoIae, direccionEnUnaLinea, ejercicioActual, textoIva, type DatosEmpresa,
} from '@/modules/conta/empresa/datosEmpresa'
import { Buscador } from '@/modules/conta/empresa/ApartadosActividad'

interface Mensaje { id: number; de: 'folvy' | 'persona'; texto: ReactNode }

const PASOS_VALIDOS: PasoAlta[] = ['nif', 'nombre', 'actividad', 'impuestos', 'cuentas', 'banco', 'hecho']

export default function AltaPage() {
  const movil = useIsMobile()
  const { accountId, userId, esAdmin } = useCuentaConta()
  const { empresas, cargando: cargandoEmpresas, elegir, recargar: recargarEmpresas } = useEmpresas()
  const hoy = hoyEnMadrid()

  // La empresa del alta: la que se acaba de crear o la que quedó a medias.
  const [creada, setCreada] = useState<string | null>(null)
  const aMedias = empresas.find((e) => !e.completa) ?? null
  const companyId = creada ?? aMedias?.id ?? null
  const datos = useDatosEmpresa(accountId, companyId, esAdmin)
  const d = datos.datos

  const [cuenta, setCuenta] = useState<DatosDeLaCuenta | null>(null)
  useEffect(() => {
    if (!accountId) return
    let vivo = true
    leerDatosDeLaCuenta(accountId)
      .then((c) => { if (vivo) setCuenta(c) })
      .catch(() => { if (vivo) setCuenta({ nombre: null, razonSocial: null, nif: null, direccion: null }) })
    return () => { vivo = false }
  }, [accountId])

  const [respuestas, setRespuestas] = useState<Partial<Record<ClavePregunta, string>>>({})
  const [mensajes, setMensajes] = useState<Mensaje[]>([])
  const [ocupado, setOcupado] = useState(false)
  const [propuestas, setPropuestas] = useState<{ texto: string; lista: PropuestaActividad[]; marcadas: string[] } | null>(null)
  const [aMano, setAMano] = useState(false)
  const [verTodo, setVerTodo] = useState(false)
  const [muyPronto, setMuyPronto] = useState(false)
  const [texto, setTexto] = useState('')
  const fin = useRef<HTMLDivElement>(null)
  const sigId = useRef(1)

  const paso: PasoAlta = !companyId ? 'nif'
    : d && PASOS_VALIDOS.includes(d.empresa.setupStep as PasoAlta) ? d.empresa.setupStep as PasoAlta : 'nombre'

  const ctx: ContextoAlta | null = cuenta ? {
    cuenta, tipo: d?.empresa.entityKind ?? null, cp: d?.empresa.fiscalPostalCode ?? null,
    clases: (d?.actividades ?? []).filter((a) => a.endedOn === null).map((a) => a.kind), respuestas, hoy,
  } : null
  const pregunta = ctx && !propuestas ? preguntaActual(paso, ctx) : null

  useEffect(() => { fin.current?.scrollIntoView?.({ block: 'end' }) }, [mensajes.length, pregunta?.clave, propuestas])

  const decir = (de: Mensaje['de'], t: ReactNode) => setMensajes((m) => [...m, { id: sigId.current++, de, texto: t }])

  /** Hace algo y lo cuenta; si falla, lo dice en la conversación (regla 8). */
  async function paso_(accion: () => Promise<void>) {
    setOcupado(true)
    try { await accion() } catch (e) { decir('folvy', <span className="cx-alta-fallo">No lo he podido guardar: {e instanceof Error ? e.message : String(e)}</span>) }
    finally { setOcupado(false) }
  }

  async function avanzar(siguiente: PasoAlta, id = companyId) {
    if (!id) return
    await ponerPaso(id, siguiente)
    setRespuestas({})
    datos.recargar()
  }

  /** Quedan preguntas en este paso después de contestar esta. */
  const quedan = (clave: ClavePregunta) => {
    if (!ctx) return false
    return preguntaActual(paso, { ...ctx, respuestas: { ...respuestas, [clave]: 'x' } }) !== null
  }

  async function responder(p: Pregunta, valor: string, mostrado: string, extra?: { direccion?: DireccionAlta }) {
    if (!ctx || !accountId) return
    const noLoSe = valor === '__nolose'
    decir('persona', mostrado)
    await paso_(async () => {
      let id = companyId
      switch (p.clave) {
        case 'nif': {
          const nif = valor === 'cuenta' ? ctx.cuenta.nif : noLoSe ? null : valor
          id = await crearEmpresa(accountId, userId, nif)
          setCreada(id); elegir(id); recargarEmpresas()
          if (noLoSe) await apuntarDuda(accountId, id, userId, 'nif', p.texto, 'Sin NIF')
          decir('folvy', nif ? 'Apuntado. Ahora, el nombre.' : 'Lo dejo sin NIF por ahora; se lo apunto a tu asesor. Sin él no se puede terminar el alta.')
          return // crearEmpresa ya deja el paso en «nombre»
        }
        case 'nombre': {
          const nombre = valor === 'cuenta' ? (ctx.cuenta.razonSocial ?? ctx.cuenta.nombre ?? '') : valor
          if (noLoSe) await apuntarDuda(accountId, id!, userId, 'nombre', p.texto, 'Sin nombre')
          else await ponerNombre(id!, nombre, valor === 'cuenta')
          decir('folvy', noLoSe ? textoDuda(p) : `Apuntado: ${nombre}.`)
          break
        }
        case 'direccion': {
          if (noLoSe) await apuntarDuda(accountId, id!, userId, 'direccion', p.texto, 'Sin dirección')
          else if (valor === 'cuenta' && ctx.cuenta.direccion) {
            const c = ctx.cuenta.direccion
            await ponerDireccion(id!, { calle: c.calle ?? '', numero: '', codigoPostal: c.codigoPostal ?? '', poblacion: c.poblacion ?? '', provincia: c.provincia ?? provinciaPorCp(c.codigoPostal ?? '') ?? '' }, true)
          } else if (extra?.direccion) await ponerDireccion(id!, extra.direccion, false)
          decir('folvy', noLoSe ? 'La pones luego en «Tu empresa».' : 'Apuntada la dirección.')
          break
        }
        case 'actividad': {
          if (noLoSe) {
            await apuntarDuda(accountId, id!, userId, 'actividad', p.texto, 'Sin actividad')
            decir('folvy', 'Se lo apunto a tu asesor. La puedes añadir luego en «Tu empresa».')
            break
          }
          const grupos = gruposDe(valor)
          const lista = grupos.length ? proponer(grupos, await buscarParaGrupos(grupos)) : []
          if (lista.length === 0) {
            decir('folvy', 'No encuentro nada en el catálogo oficial con eso. Búscalo a mano: escribe lo que haces o el número del epígrafe.')
            setAMano(true)
          } else {
            decir('folvy', lista.length === 1 ? 'En el catálogo oficial esto es lo que encaja. Desmárcalo si no es:' : 'En el catálogo oficial encajan estas. Desmarca las que no sean:')
            setPropuestas({ texto: valor, lista, marcadas: lista.map((x) => x.clave) })
          }
          return
        }
        case 'periodo': {
          const porque = p.porque ?? ''
          if (valor === p.normal || noLoSe) {
            await ponerConIa(id!, 'company_tax_profile', 'vat_period', p.normal, noLoSe ? `${porque} Dijiste «No lo sé»: queda como duda para tu asesor.` : porque)
            if (noLoSe) await apuntarDuda(accountId, id!, userId, 'periodo', p.texto, 'Cada tres meses')
          } else await ponerEnPerfil(accountId, id!, 'vat_period', valor)
          decir('folvy', noLoSe ? textoDuda(p) : 'Apuntado.')
          break
        }
        case 'cuentas': {
          const prop = proponerAlta({ tipo: ctx.tipo ?? 'company', territorio: territorioPorCp(ctx.cp).territorio, actividades: ctx.clases,
            retiene: null, alquilaConRetencion: null, volumenAnoAnterior: null, inicioActividad: null, hoy })
          await ponerConIa(id!, 'company_tax_profile', 'chart_kind', prop.plan.valor, prop.plan.porque)
          await ponerConIa(id!, 'company_tax_profile', 'account_digits', prop.digitos.valor, prop.digitos.porque)
          if (d && !d.ejercicios.some((e) => e.code === prop.ejercicio.valor.code)) {
            await abrirEjercicio(accountId, id!, userId, prop.ejercicio.valor, null)
          }
          if (noLoSe) await apuntarDuda(accountId, id!, userId, 'cuentas', p.texto, 'Plan de pymes, 8 dígitos')
          decir('folvy', noLoSe ? textoDuda(p) : `Hecho: plan de pymes, cuentas de 8 dígitos y el ejercicio ${prop.ejercicio.valor.code} abierto.`)
          break
        }
        case 'banco': {
          if (!noLoSe) await anadirBanco(accountId, id!, userId, valor)
          await terminarAlta(id!)
          recargarEmpresas()
          decir('folvy', <>Listo: tu empresa está montada. {noLoSe ? 'El banco lo pones cuando quieras en «Tablas generales».' : ''} Todo lo que he puesto lleva la marca «IA» y su porqué, y lo puedes cambiar o deshacer en <Link to={rutaTuEmpresa()}>Tu empresa</Link>.</>)
          datos.recargar()
          return
        }
        default: {
          // retiene, alquiler, retenido70: se guardan al terminar el paso, como modelos.
          if (noLoSe) await apuntarDuda(accountId, id!, userId, p.clave, p.texto, p.opciones.find((o) => o.valor === p.normal)?.texto ?? '')
          if (noLoSe) decir('folvy', textoDuda(p))
          break
        }
      }
      const r = { ...respuestas, [p.clave]: noLoSe ? '__nolose' : valor }
      setRespuestas(r)
      if (!quedan(p.clave)) await terminarPaso(r, id!)
    })
  }

  /** Lo que se guarda al acabar cada paso, y el paso siguiente. */
  async function terminarPaso(r: Partial<Record<ClavePregunta, string>>, id: string) {
    if (!ctx || !accountId) return
    if (paso === 'impuestos') {
      const t = territorioPorCp(ctx.cp)
      await ponerConIa(id, 'company_tax_profile', 'tax_territory', t.territorio, t.porque)
      if (t.territorio === 'peninsula_baleares') {
        await ponerConIa(id, 'company_tax_profile', 'vat_scheme_code', 'general',
          ctx.tipo === 'self_employed' ? 'Lo normal es el régimen general; si tu actividad está en módulos, lo confirma tu asesor.' : 'Una sociedad va en el régimen general (Ley 37/1992, art. 122).')
      }
      const m = modelosDeRespuestas({ ...ctx, respuestas: r })
      await ponerConIa(id, 'company_tax_profile', 'tax_forms', m.modelos, m.porque)
      decir('folvy', m.modelos.length ? `Con eso, presentas los modelos ${m.modelos.join(', ')}. El porqué de cada uno está en «Tu empresa».` : 'Con eso no presentas ningún modelo de los que conozco.')
    }
    await avanzar(pasoSiguiente(paso), id)
  }

  async function confirmarActividades() {
    if (!propuestas || !companyId) return
    const elegidas = propuestas.lista.filter((x) => propuestas.marcadas.includes(x.clave))
    decir('persona', elegidas.length ? elegidas.map((x) => x.descripcion).join(' y ') : 'Ninguna de esas')
    await paso_(async () => {
      if (elegidas.length === 0) { setPropuestas(null); setAMano(true); decir('folvy', 'Búscala a mano: escribe lo que haces o el número del epígrafe.'); return }
      for (const [i, x] of elegidas.entries()) {
        await anadirActividadConIa(companyId, {
          descripcion: x.descripcion, clase: 'business', iae: x.iae?.code ?? null, cnae: x.cnae?.code ?? null, principal: i === 0,
          motivo: `Dijiste «${propuestas.texto}»${x.iae ? `: en el IAE es el ${codigoIae(x.iae.code)}, «${x.iae.title}»` : ''}${x.cnae ? `; en la CNAE-2025, ${x.cnae.code} «${x.cnae.title}»` : ''}.`,
        })
      }
      decir('folvy', `Hecho: ${elegidas.length === 1 ? 'una actividad' : `${elegidas.length} actividades`}. Ahora, tus impuestos.`)
      setPropuestas(null)
      await avanzar('impuestos')
    })
  }

  async function guardarAMano(a: { descripcion: string; iae: OpcionCodigo | null; cnae: OpcionCodigo | null }) {
    if (!companyId) return
    decir('persona', a.descripcion)
    await paso_(async () => {
      // Lo eligió la persona en el catálogo: es suyo, no de la IA.
      await anadirActividad(accountId!, companyId, userId, {
        description: a.descripcion, kind: 'business', iaeCode: a.iae?.code ?? null, cnaeCode: a.cnae?.code ?? null, startedOn: null,
        isMain: !(d?.actividades.some((x) => x.endedOn === null && x.isMain) ?? false),
      })
      setAMano(false)
      decir('folvy', 'Apuntada. Ahora, tus impuestos.')
      await avanzar('impuestos')
    })
  }

  function enviarTexto(e: FormEvent) {
    e.preventDefault()
    const t = texto.trim()
    if (!pregunta || !pregunta.entrada || pregunta.entrada === 'direccion' || t === '') return
    if (pregunta.entrada === 'nif') {
      const v = validarNifEs(t)
      if (!v.ok) { decir('persona', t); decir('folvy', <span className="cx-alta-fallo">{v.motivo}</span>); return }
      setTexto(''); void responder(pregunta, v.normalizado, v.normalizado); return
    }
    if (pregunta.entrada === 'iban') {
      const v = validarIban(t)
      if (!v.ok) { decir('persona', t); decir('folvy', <span className="cx-alta-fallo">{v.motivo}</span>); return }
      setTexto(''); void responder(pregunta, v.normalizado, t); return
    }
    setTexto(''); void responder(pregunta, t, t)
  }

  // ── Pintar ────────────────────────────────────────────────────────────
  if (cargandoEmpresas || !cuenta || (companyId && datos.cargando)) {
    return <div className="cx cx-alta"><div className="cx-alta-conversacion"><TarjetaCargando /></div></div>
  }
  if (companyId && (datos.error || !d)) {
    return <div className="cx cx-alta"><div className="cx-alta-conversacion"><ErrorConReintento mensaje={datos.error ?? 'No se ha podido leer.'} reintentar={datos.recargar} /></div></div>
  }

  const numero = NUMERO_PASO[paso]
  const progreso = (
    <div className="cx-alta-progreso" role="progressbar" aria-valuemin={1} aria-valuemax={TOTAL_PASOS} aria-valuenow={numero}
      aria-label={`Paso ${numero} de ${TOTAL_PASOS}`}>
      <span className="cx-alta-barra"><span style={{ width: `${(Math.max(numero - (paso === 'hecho' ? 0 : 1), 0) / TOTAL_PASOS) * 100}%` }} /></span>
      <span className="cx-cifra">{numero} de {TOTAL_PASOS}</span>
    </div>
  )

  const saludo = !companyId && mensajes.length === 0
  const panel = <PanelEmpresa d={d} paso={paso} pregunta={pregunta} progreso={movil ? null : progreso} />
  const ultimo = d?.ia.registro.find((r) => !r.undoneAt)

  return (
    <div className="cx cx-alta">
      <div className="cx-alta-conversacion">
        <header className="cx-alta-cabeza">
          <span className="cx-alta-logo">folvy</span>
          {movil ? progreso : <span className="cx-ayuda">Se guarda solo · sigue cuando quieras</span>}
        </header>
        {movil && d && (
          <section className="cx-tarjeta cx-alta-ultimo" aria-label="Tu empresa">
            <div className="cx-fila-texto">
              <span className="cx-ayuda">Tu empresa{ultimo ? ' · acabo de apuntar' : ''}</span>
              {ultimo && <span className="cx-fila-titulo">{ultimo.reason.length > 60 ? `${ultimo.reason.slice(0, 60)}…` : ultimo.reason}</span>}
            </div>
            <button type="button" className="cx-enlace" aria-expanded={verTodo} onClick={() => setVerTodo((v) => !v)}>{verTodo ? 'Cerrar' : 'Ver todo'}</button>
          </section>
        )}
        {movil && verTodo && panel}
        {!movil && saludo && (
          <div className="cx-alta-titular">
            <h1 className="cx-alta-h1">Cuéntame tu negocio y lo dejo montado.</h1>
            <p className="cx-ayuda" style={{ fontSize: 17 }}>Tres minutos. No hace falta saber de contabilidad.</p>
          </div>
        )}
        <div className="cx-alta-mensajes" role="log" aria-live="polite" aria-label="Conversación del alta">
          {aMedias && !creada && mensajes.length === 0 && (
            <Burbuja de="folvy">Seguimos donde lo dejaste{aMedias.nombre ? <> con <b>{aMedias.nombre}</b></> : ''}.</Burbuja>
          )}
          {mensajes.map((m) => <Burbuja key={m.id} de={m.de}>{m.texto}</Burbuja>)}
          {pregunta && (
            <Burbuja de="folvy">
              <b>{pregunta.texto}</b>
              {pregunta.porque && <span className="cx-alta-porque">{pregunta.porque}</span>}
            </Burbuja>
          )}
          {paso === 'hecho' && mensajes.length === 0 && (
            <Burbuja de="folvy">Tu empresa ya está dada de alta. La ves y la cambias en <Link to={rutaTuEmpresa()}>Tu empresa</Link>.</Burbuja>
          )}
          <div ref={fin} />
        </div>

        {pregunta && !ocupado && (
          <div className="cx-alta-respuestas">
            {pregunta.opciones.map((o, i) => (
              <button key={o.valor} type="button" className={i === 0 ? 'cx-boton' : 'cx-boton-sec'}
                onClick={() => void responder(pregunta, o.valor, o.texto)}>{o.texto}</button>
            ))}
            <button type="button" className="cx-boton-sec" onClick={() => void responder(pregunta, '__nolose', pregunta.noLoSe)}>{pregunta.noLoSe}</button>
          </div>
        )}
        {pregunta?.entrada === 'direccion' && !ocupado && (
          <FormDireccion guardar={(dir) => void responder(pregunta, 'escrita', `${dir.calle} ${dir.numero}, ${dir.codigoPostal} ${dir.poblacion}`, { direccion: dir })} />
        )}
        {propuestas && !ocupado && (
          <fieldset className="cx-fieldset cx-alta-propuestas">
            <legend className="cx-oculto">Actividades del catálogo oficial</legend>
            {propuestas.lista.map((x) => (
              <label key={x.clave} className="cx-alta-propuesta">
                <input type="checkbox" checked={propuestas.marcadas.includes(x.clave)}
                  onChange={() => setPropuestas((p) => p && ({ ...p, marcadas: p.marcadas.includes(x.clave) ? p.marcadas.filter((k) => k !== x.clave) : [...p.marcadas, x.clave] }))} />
                <span className="cx-fila-texto">
                  <span className="cx-fila-titulo">{x.descripcion}</span>
                  <span className="cx-fila-apoyo">
                    {x.iae ? `Epígrafe ${codigoIae(x.iae.code)} · ${x.iae.title}` : 'Sin epígrafe del IAE que encaje'}
                    {x.cnae ? ` · CNAE ${x.cnae.code} · ${x.cnae.title}` : ''}
                  </span>
                  <span className="cx-fila-apoyo">Porque dijiste «{x.porLaPalabra}»</span>
                </span>
              </label>
            ))}
            <div className="cx-alta-respuestas">
              <button type="button" className="cx-boton" onClick={() => void confirmarActividades()}>Añadir las marcadas</button>
              <button type="button" className="cx-boton-sec" onClick={() => { setPropuestas(null); setAMano(true) }}>Ninguna: la busco a mano</button>
            </div>
          </fieldset>
        )}
        {aMano && !ocupado && <ActividadAMano guardar={(a) => void guardarAMano(a)} />}
        {ocupado && <p className="cx-ayuda" role="status">Guardando…</p>}

        <form className="cx-alta-entrada" onSubmit={enviarTexto} aria-label="Escribe tu respuesta">
          <input className="cx-alta-input" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Escribe o dímelo hablando"
            aria-label="Tu respuesta" disabled={!pregunta?.entrada || pregunta.entrada === 'direccion' || ocupado}
            inputMode={pregunta?.entrada === 'nif' || pregunta?.entrada === 'iban' ? 'text' : undefined} autoComplete="off" />
          <button type="button" className="cx-voz" aria-label="Hablar" onClick={() => setMuyPronto(true)}><Microfono /></button>
          <div role="status" aria-live="polite">{muyPronto && <span className="cx-muy-pronto">{TEXTO_MUY_PRONTO}</span>}</div>
        </form>
      </div>
      {!movil && panel}
    </div>
  )
}

function Burbuja({ de, children }: { de: 'folvy' | 'persona'; children: ReactNode }) {
  return de === 'folvy'
    ? <div className="cx-alta-folvy"><span className="cx-alta-punto" aria-hidden="true"><span /></span><div className="cx-alta-burbuja">{children}</div></div>
    : <div className="cx-alta-persona"><div className="cx-alta-burbuja">{children}</div></div>
}

function FormDireccion({ guardar }: { guardar: (d: DireccionAlta) => void }) {
  const [v, setV] = useState<DireccionAlta>({ calle: '', numero: '', codigoPostal: '', poblacion: '', provincia: '' })
  const [fallo, setFallo] = useState<string | null>(null)
  const pon = (k: keyof DireccionAlta) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }))
  return (
    <form className="cx-formulario cx-alta-direccion" noValidate aria-label="Dirección fiscal" onSubmit={(e) => {
      e.preventDefault()
      if (v.calle.trim() === '' || !/^\d{5}$/.test(v.codigoPostal.trim())) { setFallo('Pon al menos la calle y un código postal de cinco cifras.'); return }
      guardar({ ...v, provincia: v.provincia || provinciaPorCp(v.codigoPostal.trim()) || '' })
    }}>
      <div className="cx-formulario-fila">
        <div className="cx-campo"><label htmlFor="alta-calle">Calle</label><input id="alta-calle" className="cx-input" value={v.calle} onChange={pon('calle')} /></div>
        <div className="cx-campo"><label htmlFor="alta-num">Número</label><input id="alta-num" className="cx-input" value={v.numero} onChange={pon('numero')} /></div>
        <div className="cx-campo"><label htmlFor="alta-cp">Código postal</label><input id="alta-cp" className="cx-input" inputMode="numeric" value={v.codigoPostal} onChange={pon('codigoPostal')} /></div>
        <div className="cx-campo"><label htmlFor="alta-pob">Población</label><input id="alta-pob" className="cx-input" value={v.poblacion} onChange={pon('poblacion')} /></div>
      </div>
      {fallo && <span className="cx-error" role="alert">{fallo}</span>}
      <div className="cx-pie"><button type="submit" className="cx-boton">Es esta</button></div>
    </form>
  )
}

function ActividadAMano({ guardar }: { guardar: (a: { descripcion: string; iae: OpcionCodigo | null; cnae: OpcionCodigo | null }) => void }) {
  const [descripcion, setDescripcion] = useState('')
  const [iae, setIae] = useState<OpcionCodigo | null>(null)
  const [cnae, setCnae] = useState<OpcionCodigo | null>(null)
  const [fallo, setFallo] = useState<string | null>(null)
  return (
    <form className="cx-formulario cx-alta-direccion" noValidate aria-label="Buscar la actividad a mano" onSubmit={(e) => {
      e.preventDefault()
      if (descripcion.trim() === '') { setFallo('Di a qué te dedicas con tus palabras.'); return }
      guardar({ descripcion: descripcion.trim(), iae, cnae })
    }}>
      <div className="cx-campo"><label htmlFor="alta-act">A qué te dedicas</label>
        <input id="alta-act" className="cx-input" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} /></div>
      <Buscador etiqueta="Epígrafe del IAE" ayuda="Escribe lo que haces o el número." buscar={buscarIae} elegido={iae} elegir={setIae} mostrarCodigo={codigoIae} deshabilitado={false} />
      <Buscador etiqueta="CNAE" ayuda="La clasificación del INE (CNAE-2025)." buscar={buscarCnae} elegido={cnae} elegir={setCnae} mostrarCodigo={(c) => c} deshabilitado={false} />
      {fallo && <span className="cx-error" role="alert">{fallo}</span>}
      <div className="cx-pie"><button type="submit" className="cx-boton">Añadir</button></div>
    </form>
  )
}

function Fila({ etiqueta, valor, apoyo, marca, actual }: { etiqueta: string; valor: ReactNode; apoyo?: ReactNode; marca?: ReactNode; actual?: boolean }) {
  return (
    <div className={`cx-alta-fila${actual ? ' cx-alta-fila-actual' : ''}`}>
      <span className="cx-alta-fila-etiqueta">{etiqueta}</span>
      <span className="cx-alta-fila-valor">
        <span className="cx-alta-fila-linea">{valor}{marca}</span>
        {apoyo && <span className="cx-fila-apoyo">{apoyo}</span>}
      </span>
    </div>
  )
}

function PanelEmpresa({ d, paso, pregunta, progreso }: { d: DatosEmpresa | null; paso: PasoAlta; pregunta: Pregunta | null; progreso: ReactNode }) {
  const o = d?.ia.origenes ?? []
  const e = d?.empresa
  const m = (tabla: string, fila: string | undefined, campo: string, valor: unknown) => {
    if (!fila) return null
    const x = marcaDe(o, tabla, fila, campo, valor)
    return x ? <MarcaIA motivo={x.reason} importado={x.source === 'import'} /> : null
  }
  const vivas = d?.actividades.filter((a) => a.endedOn === null) ?? []
  const p = d?.perfil
  const preguntando = (claves: ClavePregunta[]) => pregunta !== null && claves.includes(pregunta.clave)
  const pendiente = (de: PasoAlta) => PASOS_VALIDOS.indexOf(paso) < PASOS_VALIDOS.indexOf(de)
  const valor = (claves: ClavePregunta[], de: PasoAlta, v: ReactNode) =>
    preguntando(claves) ? <span className="cx-alta-preguntando">Te lo estoy preguntando</span>
      : v ?? <span className="cx-dato-vacio">{de === 'banco' && pendiente('hecho') ? 'En el último paso' : pendiente(de) ? 'Enseguida' : 'Sin poner'}</span>
  const ej = d ? ejercicioActual(d.ejercicios, hoyEnMadrid()) : null
  return (
    <aside className="cx-tarjeta cx-alta-panel" aria-label="Tu empresa">
      <header className="cx-alta-panel-cabeza">
        <h2 className="cx-titulo" style={{ fontSize: 28 }}>Tu empresa</h2>
        {progreso}
      </header>
      <Fila etiqueta="Quién eres" actual={preguntando(['nif', 'nombre'])}
        valor={valor(['nif', 'nombre'], 'nombre', e?.legalName ?? null)} marca={m('company', e?.id, 'legal_name', e?.legalName)}
        apoyo={e?.taxId ? `NIF ${e.taxId}` : undefined} />
      <Fila etiqueta="Dónde" actual={preguntando(['direccion'])}
        valor={valor(['direccion'], 'nombre', e ? direccionEnUnaLinea(e) : null)}
        marca={m('company', e?.id, 'fiscal_street', e?.fiscalStreet)} />
      <Fila etiqueta="A qué te dedicas" actual={preguntando(['actividad'])}
        valor={valor(['actividad'], 'actividad', vivas.length ? vivas.map((a) => a.description).join(' · ') : null)}
        marca={vivas[0] ? m('company_activity', vivas[0].id, 'description', vivas[0].description) : null}
        apoyo={vivas.some((a) => a.iaeCode) ? `Epígrafes ${vivas.filter((a) => a.iaeCode).map((a) => codigoIae(a.iaeCode!)).join(' y ')}` : undefined} />
      <Fila etiqueta="Cada cuánto presentas el IVA" actual={preguntando(['periodo'])}
        valor={valor(['periodo'], 'impuestos', p && !pendiente('cuentas') ? textoIva(p, d?.regimenes ?? []) : null)}
        marca={p ? m('company_tax_profile', e?.id, 'vat_period', p.vatPeriod) : null} />
      <Fila etiqueta="Qué modelos presentas" actual={preguntando(['retiene', 'alquiler', 'retenido70'])}
        valor={valor(['retiene', 'alquiler', 'retenido70'], 'impuestos', p && p.taxForms.length ? p.taxForms.join(', ') : null)}
        marca={p ? m('company_tax_profile', e?.id, 'tax_forms', p.taxForms) : null} />
      <Fila etiqueta="Tus cuentas" actual={preguntando(['cuentas'])}
        valor={valor(['cuentas'], 'cuentas', p && !pendiente('banco') ? (p.chartKind === 'pymes' ? 'Plan de pymes' : 'Plan general') : null)}
        marca={p ? m('company_tax_profile', e?.id, 'chart_kind', p.chartKind) : null}
        apoyo={ej ? `Ejercicio ${ej.code} · puedes verlo o cambiarlo después` : undefined} />
      <Fila etiqueta="Tu banco" actual={preguntando(['banco'])}
        valor={valor(['banco'], 'banco', null)} />
    </aside>
  )
}
