// src/modules/conta/alta/ConversacionAlta.tsx
//
// El alta conversada, segunda vuelta (respuesta 3 del C00; maquetas N1bAlta y
// N1cAlta). UN SOLO COMPONENTE CON DOS MARCOS:
//
//   · «pantalla» (N1b): la cuenta aún no tiene ninguna empresa. Columna de
//     conversación de 760 px centrada y, a la derecha, «Lo que llevamos».
//   · «ventana» (N1c): otra empresa desde dentro de Folvy. La misma
//     conversación en una ventana sobre la app atenuada; lo apuntado son
//     píldoras en la cabecera, seis puntos de progreso y cerrar guarda.
//   · En el móvil, siempre a pantalla completa; «Lo que llevamos» es una hoja
//     que sube desde abajo al tocar «4 de 6».
//
// Lo que no cambia del alta de la tarea 6:
//   · la IA propone y la persona contesta de un toque, o lo escribe;
//   · nunca inventa: las actividades salen del IAE y la CNAE cargados;
//   · cada respuesta se guarda al momento y el paso va en la empresa: salir,
//     cerrar la pestaña o darle atrás al navegador no pierde nada;
//   · todo lo que hace el alta se puede hacer sin IA desde «Tu empresa».
//
// Lo nuevo:
//   · la IA nunca dice «Apuntado.» a secas: repite lo entendido en negrita, dice
//     qué ha hecho y encadena la siguiente pregunta en la misma burbuja;
//   · cada pregunta lleva su bocadillo «¿Por qué lo pregunto?», plegado;
//   · sin botón «anterior»: tocar un punto hecho de «Lo que llevamos» (o su
//     píldora), o decirlo («cambia la dirección»), vuelve a ese punto, y al
//     contestarlo se sigue donde se iba.

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useIsMobile } from '@/shell/useIsMobile'
import { rutaTuEmpresa } from '@/config/navegacion'
import { useCuentaConta, leerDatosDeLaCuenta, type DatosDeLaCuenta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useDatosEmpresa } from '@/modules/conta/empresa/useDatosEmpresa'
import { TarjetaCargando, ErrorConReintento, MarcaIA } from '@/modules/conta/ui/piezas'
import { Flecha, Microfono } from '@/modules/conta/ui/Icono'
import { TEXTO_MUY_PRONTO } from '@/modules/conta/marco/muyPronto'
import {
  PASOS, modelosDeRespuestas, pasoSiguiente, preguntaActual, territorioPorCp, textoDuda, todasLasPreguntas,
  type ClavePregunta, type ContextoAlta, type PasoAlta, type Pregunta,
} from '@/modules/conta/alta/guion'
import { gruposDe, proponer, type PropuestaActividad } from '@/modules/conta/alta/actividades'
import {
  TOTAL_PUNTOS, cuantosHechos, loQueLlevamos, puntoQuePide, respuestasParaVolver, sePuedeVolver,
  type ClavePunto, type Punto,
} from '@/modules/conta/alta/llevamos'
import { entender } from '@/modules/conta/alta/entender'
import {
  fraseActividadAMano, fraseActividades, fraseAlquiler, fraseCuentas, fraseDireccion, fraseDuda, fraseModelos, fraseNif,
  fraseNombre, frasePeriodo, fraseRetenido70, fraseRetiene, fraseSinNif, type Frase,
} from '@/modules/conta/alta/frases'
import {
  anadirBanco, apuntarDuda, buscarParaGrupos, crearEmpresa, ponerDireccion, ponerEnPerfil, ponerNombre, ponerPaso,
  quitarActividadesDelAlta, terminarAlta, type DireccionAlta,
} from '@/modules/conta/services/altaService'
import { anadirActividadConIa, ponerConIa } from '@/modules/conta/services/iaService'
import { leerReglasModelos } from '@/modules/conta/services/modelosService'
import type { ReglaModelo } from '@/modules/conta/lib/modelos'
import { abrirEjercicio, anadirActividad, buscarCnae, buscarIae, type OpcionCodigo } from '@/modules/conta/services/empresaDatosService'
import { validarNifEs } from '@/modules/conta/lib/nif'
import { validarIban } from '@/modules/conta/lib/iban'
import { provinciaPorCp } from '@/modules/conta/lib/direccion'
import { entenderDireccion, proponerPoblacion, type DireccionEntendida, type PoblacionPropuesta } from '@/modules/conta/lib/codigoPostal'
import { lugaresPorCp } from '@/modules/conta/services/codigoPostalService'
import { hoyEnMadrid } from '@/modules/conta/lib/formato'
import { proponerAlta } from '@/modules/conta/lib/propuestaAlta'
import { ivaDeVentas, type ActividadParaIva } from '@/modules/conta/lib/ivaVentas'
import { codigoIae, ejercicioActual, type DatosEmpresa } from '@/modules/conta/empresa/datosEmpresa'
import { Buscador } from '@/modules/conta/empresa/ApartadosActividad'

export type MarcoAlta = 'pantalla' | 'ventana'

interface Mensaje {
  id: number
  de: 'folvy' | 'persona'
  texto: ReactNode
  /** Lo que dijo la IA de lo que acaba de apuntar: va en la misma burbuja que la pregunta siguiente. */
  junto?: boolean
}

/** Volver a un punto: a qué paso se vuelve después y con qué respuestas. */
interface Vuelta { paso: PasoAlta; respuestas: Partial<Record<ClavePregunta, string>> }

const pintar = (f: Frase): ReactNode => f.map((x, i) => (x.b ? <b key={i}>{x.t}</b> : <span key={i}>{x.t}</span>))

export function ConversacionAlta({ marco }: { marco: MarcoAlta }) {
  const movil = useIsMobile()
  const navigate = useNavigate()
  const { accountId, userId, esAdmin } = useCuentaConta()
  const { empresas, cargando: cargandoEmpresas, elegir, recargar: recargarEmpresas } = useEmpresas()
  const hoy = hoyEnMadrid()
  const idTitulo = useId()

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

  // La regla de los anuales y del 347 vive en la tabla de modelos.
  const [reglas, setReglas] = useState<ReglaModelo[] | null>(null)
  const [falloReglas, setFalloReglas] = useState<string | null>(null)
  const [vueltaReglas, setVueltaReglas] = useState(0)
  useEffect(() => {
    let vivo = true
    leerReglasModelos()
      .then((r) => { if (vivo) { setReglas(r); setFalloReglas(null) } })
      .catch((e: unknown) => { if (vivo) setFalloReglas(e instanceof Error ? e.message : String(e)) })
    return () => { vivo = false }
  }, [vueltaReglas])

  const [respuestas, setRespuestas] = useState<Partial<Record<ClavePregunta, string>>>({})
  const [mensajes, setMensajes] = useState<Mensaje[]>([])
  const [ocupado, setOcupado] = useState(false)
  const [propuestas, setPropuestas] = useState<{ texto: string; lista: PropuestaActividad[]; marcadas: string[] } | null>(null)
  const [aMano, setAMano] = useState(false)
  const [muyPronto, setMuyPronto] = useState(false)
  const [hoja, setHoja] = useState(false)
  const [texto, setTexto] = useState('')
  const [vuelta, setVuelta] = useState<Vuelta | null>(null)
  /** La dirección dicha en una frase, repartida en los campos; la vuelta cambia la clave del formulario. */
  const [direccionDicha, setDireccionDicha] = useState<{ vuelta: number; d: DireccionEntendida } | null>(null)
  const fin = useRef<HTMLDivElement>(null)
  const entrada = useRef<HTMLInputElement>(null)
  const sigId = useRef(1)

  // El paso lo fija quien avanza, en el momento (si se esperase a la base,
  // entre medias volvería la pregunta anterior). Al volver a entrar, manda el
  // de la base.
  const [pasoLocal, setPasoLocal] = useState<PasoAlta | null>(null)
  const paso: PasoAlta = !companyId ? 'nif'
    : pasoLocal ?? (d && PASOS.includes(d.empresa.setupStep as PasoAlta) ? d.empresa.setupStep as PasoAlta : 'nombre')

  const ctx: ContextoAlta | null = cuenta ? {
    cuenta, tipo: d?.empresa.entityKind ?? null, cp: d?.empresa.fiscalPostalCode ?? null,
    clases: (d?.actividades ?? []).filter((a) => a.endedOn === null).map((a) => a.kind), respuestas, hoy,
  } : null
  const pregunta = ctx && !propuestas && !aMano ? preguntaActual(paso, ctx) : null

  useEffect(() => { fin.current?.scrollIntoView?.({ block: 'end' }) }, [mensajes.length, pregunta?.clave, propuestas, aMano])

  // Cerrar la ventana con Escape: se guarda solo, como la cruz.
  const salir = () => navigate(rutaTuEmpresa())
  useEffect(() => {
    if (marco !== 'ventana') return
    const alPulsar = (e: KeyboardEvent) => { if (e.key === 'Escape') navigate(rutaTuEmpresa()) }
    window.addEventListener('keydown', alPulsar)
    return () => window.removeEventListener('keydown', alPulsar)
  }, [marco, navigate])

  const decir = (de: Mensaje['de'], t: ReactNode, junto = false) => setMensajes((m) => [...m, { id: sigId.current++, de, texto: t, junto }])
  /**
   * Lo que la IA acaba de apuntar: se pinta en la misma burbuja que la pregunta
   * siguiente. Mientras se guarda una respuesta, se retiene y sale cuando TODO
   * está guardado, también el paso: antes salía «Entendido» y el paso se
   * escribía después, y cerrar la pestaña en ese hueco hacía repetir la
   * pregunta al volver (e2e 129, regla 8: confirmar es haberlo guardado).
   */
  const pendientes = useRef<ReactNode[] | null>(null)
  const apuntado = (f: Frase) => {
    if (pendientes.current) pendientes.current.push(pintar(f))
    else decir('folvy', pintar(f), true)
  }
  const soltarPendientes = () => {
    const p = pendientes.current ?? []
    pendientes.current = null
    p.forEach((t) => decir('folvy', t, true))
  }

  /**
   * Al contestar, la pregunta se queda en la conversación tal como se vio: con
   * lo que la IA acababa de apuntar delante, en la misma burbuja.
   */
  function fijarPregunta(p: Pregunta) {
    const primera = ctx ? todasLasPreguntas(paso, ctx)[0]?.clave === p.clave : false
    setMensajes((m) => {
      const previo = m[m.length - 1]?.junto ? m[m.length - 1] : null
      const base = previo ? m.slice(0, -1) : m
      return [...base, { id: sigId.current++, de: 'folvy', texto: <BurbujaPregunta previo={previo?.texto ?? null} pregunta={p} primera={primera} /> }]
    })
  }

  /** Hace algo y lo cuenta; si falla, lo dice en la conversación (regla 8). */
  async function paso_(accion: () => Promise<void>) {
    setOcupado(true)
    pendientes.current = []
    try { await accion(); soltarPendientes() } catch (e) {
      // Lo que sí se guardó antes del fallo se dice; luego, el fallo.
      soltarPendientes()
      decir('folvy', <span className="cx-alta-fallo">No lo he podido guardar: {e instanceof Error ? e.message : String(e)}</span>)
    } finally { pendientes.current = null; setOcupado(false) }
  }

  async function avanzar(siguiente: PasoAlta, id = companyId) {
    if (!id) return
    // Si se había vuelto a un punto, se sigue donde se iba, con lo que ya se había contestado allí.
    const destino = vuelta ? vuelta.paso : siguiente
    await ponerPaso(id, destino)
    setPasoLocal(destino)
    setRespuestas(vuelta ? vuelta.respuestas : {})
    setVuelta(null)
    datos.recargar()
  }

  /** Quedan preguntas en este paso después de contestar esta. */
  const quedan = (clave: ClavePregunta) => {
    if (!ctx) return false
    return preguntaActual(paso, { ...ctx, respuestas: { ...respuestas, [clave]: 'x' } }) !== null
  }

  /** El IVA de las ventas que sale de las actividades, puesto por la IA con su porqué. */
  async function ponerIvaVentas(id: string, acts: ActividadParaIva[]): Promise<string | null> {
    const iva = ivaDeVentas(acts, territorioPorCp(ctx?.cp ?? null).territorio)
    if (!iva) return null
    await ponerConIa(id, 'company_tax_profile', 'sales_tax_rate_code', iva.codigo, iva.porque)
    return iva.codigo
  }

  async function responder(p: Pregunta, valor: string, mostrado: string, extra?: { direccion?: DireccionAlta; deducido?: DeducidoDireccion }) {
    if (!ctx || !accountId) return
    const noLoSe = valor === '__nolose'
    fijarPregunta(p)
    decir('persona', mostrado)
    await paso_(async () => {
      let id = companyId
      switch (p.clave) {
        case 'nif': {
          const nif = valor === 'cuenta' ? ctx.cuenta.nif : noLoSe ? null : valor
          id = await crearEmpresa(accountId, userId, nif)
          setCreada(id); setPasoLocal('nombre'); recargarEmpresas()
          if (noLoSe) await apuntarDuda(accountId, id, userId, 'nif', p.texto, 'Sin NIF')
          apuntado(nif ? fraseNif(nif) : fraseSinNif())
          return // crearEmpresa ya deja el paso en «nombre»
        }
        case 'nombre': {
          const nombre = valor === 'cuenta' ? (ctx.cuenta.razonSocial ?? ctx.cuenta.nombre ?? '') : valor
          if (noLoSe) await apuntarDuda(accountId, id!, userId, 'nombre', p.texto, 'Sin nombre')
          else await ponerNombre(id!, nombre, valor === 'cuenta')
          apuntado(noLoSe ? fraseDuda(textoDuda(p)) : fraseNombre(nombre))
          break
        }
        case 'direccion': {
          let linea = ''
          if (noLoSe) await apuntarDuda(accountId, id!, userId, 'direccion', p.texto, 'Sin dirección')
          else if (valor === 'cuenta' && ctx.cuenta.direccion) {
            const c = ctx.cuenta.direccion
            await ponerDireccion(id!, { calle: c.calle ?? '', numero: '', codigoPostal: c.codigoPostal ?? '', poblacion: c.poblacion ?? '', provincia: c.provincia ?? provinciaPorCp(c.codigoPostal ?? '') ?? '' }, true)
            linea = [c.calle, [c.codigoPostal, c.poblacion].filter(Boolean).join(' ')].filter(Boolean).join(', ')
          } else if (extra?.direccion) {
            await ponerDireccion(id!, extra.direccion, false, extra.deducido)
            setDireccionDicha(null)
            const x = extra.direccion
            linea = `${[x.calle, x.numero].filter((s) => s.trim() !== '').join(' ')}, ${x.codigoPostal} ${x.poblacion}`.trim()
          }
          apuntado(noLoSe ? [{ t: 'Sigo sin dirección; la pones luego en «Tu empresa». Mientras, cuento con IVA.' }] : fraseDireccion(linea))
          break
        }
        case 'actividad': {
          if (noLoSe) {
            await apuntarDuda(accountId, id!, userId, 'actividad', p.texto, 'Sin actividad')
            apuntado([{ t: 'Se lo apunto a tu asesor. La actividad la añades luego en «Tu empresa».' }])
            break
          }
          const grupos = gruposDe(valor)
          const lista = grupos.length ? proponer(grupos, await buscarParaGrupos(grupos)) : []
          if (lista.length === 0) {
            decir('folvy', <>No encuentro nada en el catálogo oficial con «<b>{valor}</b>». Búscalo a mano: escribe lo que haces o el número del epígrafe.</>)
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
          apuntado(noLoSe ? fraseDuda(textoDuda(p)) : frasePeriodo(valor))
          break
        }
        case 'cuentas': {
          const prop = proponerAlta({ tipo: ctx.tipo ?? 'company', territorio: territorioPorCp(ctx.cp).territorio, actividades: ctx.clases,
            retiene: null, alquilaConRetencion: null, volumenAnoAnterior: null, inicioActividad: null, hoy })
          const plan = valor === 'normal' ? 'normal' : 'pymes'
          if (plan === 'normal') await ponerEnPerfil(accountId, id!, 'chart_kind', 'normal')
          else await ponerConIa(id!, 'company_tax_profile', 'chart_kind', 'pymes', prop.plan.porque)
          await ponerConIa(id!, 'company_tax_profile', 'account_digits', prop.digitos.valor, prop.digitos.porque)
          if (d && !d.ejercicios.some((e) => e.code === prop.ejercicio.valor.code)) {
            await abrirEjercicio(accountId, id!, userId, prop.ejercicio.valor, null)
          }
          if (noLoSe) await apuntarDuda(accountId, id!, userId, 'cuentas', p.texto, 'Plan de pymes, 8 dígitos')
          apuntado(noLoSe ? fraseDuda(textoDuda(p)) : fraseCuentas(plan, prop.digitos.valor, prop.ejercicio.valor))
          break
        }
        case 'banco': {
          if (!noLoSe) await anadirBanco(accountId, id!, userId, valor)
          await terminarAlta(id!)
          setPasoLocal('hecho')
          elegir(id!)
          recargarEmpresas()
          decir('folvy', <>Listo: <b>{d?.empresa.legalName ?? 'tu empresa'}</b> está montada. {noLoSe ? 'El banco lo pones cuando quieras en «Tablas generales». ' : 'Apuntado el banco como cuenta principal. '}Todo lo que he puesto lleva la marca «IA» y su porqué, y lo puedes cambiar o deshacer en <Link to={rutaTuEmpresa()}>Tu empresa</Link>.</>)
          datos.recargar()
          return
        }
        default: {
          // retiene, alquiler, retenido70: se guardan al terminar el paso, como modelos.
          if (noLoSe) {
            await apuntarDuda(accountId, id!, userId, p.clave, p.texto, p.opciones.find((o) => o.valor === p.normal)?.texto ?? '')
            apuntado(fraseDuda(textoDuda(p)))
          } else if (p.clave === 'retiene') apuntado(fraseRetiene(valor === 'si'))
          else if (p.clave === 'alquiler') apuntado(fraseAlquiler(valor === 'si'))
          else if (p.clave === 'retenido70') apuntado(fraseRetenido70(valor === 'si'))
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
      const m = modelosDeRespuestas({ ...ctx, respuestas: r }, reglas ?? [])
      await ponerConIa(id, 'company_tax_profile', 'tax_forms', m.modelos, m.porque)
      apuntado(fraseModelos(m.modelos))
    }
    await avanzar(pasoSiguiente(paso), id)
  }

  async function confirmarActividades() {
    if (!propuestas || !companyId) return
    const elegidas = propuestas.lista.filter((x) => propuestas.marcadas.includes(x.clave))
    decir('persona', elegidas.length ? elegidas.map((x) => x.descripcion).join(' y ') : 'Ninguna de esas')
    await paso_(async () => {
      if (elegidas.length === 0) { setPropuestas(null); setAMano(true); decir('folvy', 'Búscala a mano: escribe lo que haces o el número del epígrafe.'); return }
      if (vuelta) await quitarActividadesDelAlta(companyId)
      for (const [i, x] of elegidas.entries()) {
        await anadirActividadConIa(companyId, {
          descripcion: x.descripcion, clase: 'business', iae: x.iae?.code ?? null, cnae: x.cnae?.code ?? null, principal: i === 0,
          motivo: `Dijiste «${propuestas.texto}»${x.iae ? `: en el IAE es el ${codigoIae(x.iae.code)}, «${x.iae.title}»` : ''}${x.cnae ? `; en la CNAE-2025, ${x.cnae.code} «${x.cnae.title}»` : ''}.`,
        })
      }
      const iva = await ponerIvaVentas(companyId, elegidas.map((x) => ({ iaeCode: x.iae?.code ?? null, cnaeCode: x.cnae?.code ?? null })))
      apuntado(fraseActividades(propuestas.texto, elegidas.map((x) => ({ descripcion: x.descripcion, iae: x.iae?.code ?? null })), iva))
      setPropuestas(null)
      await avanzar('impuestos')
    })
  }

  async function guardarAMano(a: { descripcion: string; iae: OpcionCodigo | null; cnae: OpcionCodigo | null }) {
    if (!companyId) return
    decir('persona', a.descripcion)
    await paso_(async () => {
      if (vuelta) await quitarActividadesDelAlta(companyId)
      // Lo eligió la persona en el catálogo: es suyo, no de la IA.
      await anadirActividad(accountId!, companyId, userId, {
        description: a.descripcion, kind: 'business', iaeCode: a.iae?.code ?? null, cnaeCode: a.cnae?.code ?? null, startedOn: null,
        isMain: vuelta ? true : !(d?.actividades.some((x) => x.endedOn === null && x.isMain) ?? false),
      })
      const iva = await ponerIvaVentas(companyId, [{ iaeCode: a.iae?.code ?? null, cnaeCode: a.cnae?.code ?? null }])
      setAMano(false)
      apuntado(fraseActividadAMano(a.descripcion, a.iae?.code ?? null, iva))
      await avanzar('impuestos')
    })
  }

  // ── Volver a un punto ─────────────────────────────────────────────────
  function volverA(clave: ClavePunto, dicho: string | null) {
    const punto = puntos.find((x) => x.clave === clave)
    if (!punto || ocupado) return
    if (dicho) { if (pregunta) fijarPregunta(pregunta); decir('persona', dicho) }
    if (punto.estado === 'actual') { decir('folvy', <>Es lo que te estoy preguntando ahora: <b>{punto.etiqueta.toLowerCase()}</b>.</>); return }
    if (!sePuedeVolver(punto, paso)) {
      decir('folvy', paso === 'hecho'
        ? <>El alta ya está terminada: <b>{punto.etiqueta.toLowerCase()}</b> se cambia en <Link to={rutaTuEmpresa()}>Tu empresa</Link>.</>
        : <>A <b>{punto.etiqueta.toLowerCase()}</b> llegamos enseguida; primero terminamos lo de ahora.</>)
      return
    }
    // Lo que ya estaba contestado del paso en curso se guarda, menos lo del punto al que se vuelve.
    const guardadas = Object.fromEntries(Object.entries(respuestas).filter(([k]) => !punto.preguntas.includes(k as ClavePregunta)))
    setVuelta((v) => v ?? { paso, respuestas: guardadas })
    setPropuestas(null); setAMano(false)
    setPasoLocal(punto.paso)
    setRespuestas(ctx ? respuestasParaVolver(punto, todasLasPreguntas(punto.paso, ctx).map((q) => q.clave)) : {})
    apuntado([{ t: 'Volvemos a ' }, { t: `«${punto.etiqueta}»`, b: true }, { t: '. Cuando lo cambies, sigo donde íbamos.' }])
    setHoja(false)
  }

  function enviarTexto(e?: FormEvent) {
    e?.preventDefault()
    const t = texto.trim()
    if (t === '' || ocupado) return
    setTexto('')
    // «Cambia la dirección»: vale decirlo además de tocarlo.
    const pide = puntoQuePide(t)
    if (pide) { volverA(pide, t); return }
    if (!pregunta) {
      decir('persona', t)
      decir('folvy', propuestas ? 'Marca las que sean y pulsa «Añadir las marcadas», o «Ninguna» para buscarla a mano.'
        : aMano ? 'Escríbela en el buscador de arriba y pulsa «Añadir».' : 'Tu empresa ya está montada. Lo que quieras cambiar, en «Tu empresa».')
      return
    }
    const ent = entender(pregunta, t)
    if (ent.tipo === 'nolose') { void responder(pregunta, '__nolose', t); return }
    if (pregunta.entrada === 'nif') {
      if (ent.tipo === 'opcion') { void responder(pregunta, ent.valor, t); return }
      const v = validarNifEs(t)
      if (!v.ok) { fijarPregunta(pregunta); decir('persona', t); decir('folvy', <span className="cx-alta-fallo">{v.motivo}</span>); return }
      void responder(pregunta, v.normalizado, v.normalizado); return
    }
    if (pregunta.entrada === 'iban') {
      const v = validarIban(t)
      if (!v.ok) { fijarPregunta(pregunta); decir('persona', t); decir('folvy', <span className="cx-alta-fallo">{v.motivo}</span>); return }
      void responder(pregunta, v.normalizado, t); return
    }
    if (pregunta.entrada === 'direccion') {
      if (ent.tipo === 'opcion') { void responder(pregunta, ent.valor, t); return }
      fijarPregunta(pregunta)
      decir('persona', t)
      const dir = entenderDireccion(t)
      if (!dir) { decir('folvy', 'No he sacado una dirección de eso. Ponla en los campos de abajo: calle, número, código postal y población.'); return }
      setDireccionDicha((x) => ({ vuelta: (x?.vuelta ?? 0) + 1, d: dir }))
      decir('folvy', <>La he repartido en los campos de abajo: <b>{[dir.calle, dir.numero].filter(Boolean).join(' ')}</b>{dir.codigoPostal ? <>, código postal <b>{dir.codigoPostal}</b></> : null}{dir.poblacion ? <>, <b>{dir.poblacion}</b></> : dir.codigoPostal ? ' y la población por el código postal' : null}. Mírala y pulsa «Es esta».</>)
      return
    }
    if (pregunta.entrada === 'texto' || pregunta.entrada === 'actividad') {
      if (ent.tipo === 'opcion' && pregunta.opciones.length > 0 && /^(s[ií]|vale|ok|correcto|esa|ese)\b/i.test(t)) { void responder(pregunta, ent.valor, t); return }
      void responder(pregunta, t, t); return
    }
    if (ent.tipo === 'opcion') { void responder(pregunta, ent.valor, t); return }
    fijarPregunta(pregunta)
    decir('persona', t)
    decir('folvy', 'No te he entendido. Elige una de las respuestas, o dime «ni idea» y se lo apunto a tu asesor.')
  }

  // ── Lo que llevamos ───────────────────────────────────────────────────
  const actual: ClavePregunta | null = pregunta?.clave ?? (propuestas || aMano ? 'actividad' : null)
  const puntos = loQueLlevamos({ paso, actual, valores: valoresDe(d, hoy), contestadas: Object.keys(respuestas) as ClavePregunta[] })
  const hechos = cuantosHechos(puntos)

  // ── Intro envía (respuesta 4) ─────────────────────────────────────────
  // Intro envía desde la caja, se haya escrito o pegado, en los dos marcos y
  // en el móvil. Y si el foco se ha ido de la caja (se tocó una respuesta
  // rápida que ya no existe, o la etiqueta «Intro»), Intro sigue enviando lo
  // que hay escrito: nunca un Intro que no hace nada.
  const enviarAhora = useRef(enviarTexto)
  useEffect(() => { enviarAhora.current = enviarTexto })
  useEffect(() => {
    const alPulsar = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.isComposing || e.defaultPrevented) return
      const a = document.activeElement
      const libre = !a || a === document.body || !(a instanceof HTMLElement) || !a.closest('input, textarea, select, button, a, [contenteditable="true"]')
      if (!libre || (entrada.current?.value.trim() ?? '') === '') return
      e.preventDefault()
      enviarAhora.current()
    }
    window.addEventListener('keydown', alPulsar)
    return () => window.removeEventListener('keydown', alPulsar)
  }, [])
  // Al acabar de guardar, si el foco se quedó en el aire, vuelve a la caja (no en el móvil: abriría el teclado).
  const claveActual = pregunta?.clave ?? null
  useEffect(() => {
    if (movil || ocupado || !claveActual) return
    const a = document.activeElement
    if (!a || a === document.body) entrada.current?.focus()
  }, [movil, ocupado, claveActual])

  // ── Pintar ────────────────────────────────────────────────────────────
  const cargandoTodo = cargandoEmpresas || !cuenta || (!reglas && !falloReglas) || (companyId !== null && datos.cargando && !d)
  const fallo = falloReglas ?? (companyId && !datos.cargando ? (datos.error ?? (d ? null : 'No se ha podido leer.')) : null)

  const ultimo = mensajes[mensajes.length - 1]
  const juntoConPregunta = pregunta && ultimo?.de === 'folvy' && ultimo.junto ? ultimo : null
  const visibles = juntoConPregunta ? mensajes.slice(0, -1) : mensajes
  const primeraDelPaso = pregunta && ctx ? todasLasPreguntas(paso, ctx)[0]?.clave === pregunta.clave : false

  const bocadillo = pregunta ? <Bocadillo key={pregunta.clave} texto={pregunta.ayuda} fuera={marco === 'ventana' && !movil} /> : null

  const conversacion = (
    <>
      <div className="cx-alta-mensajes" role="log" aria-live="polite" aria-label="Conversación del alta">
        {aMedias && !creada && mensajes.length === 0 && paso !== 'hecho' && (
          <Burbuja de="folvy">Seguimos donde lo dejaste{aMedias.nombre && aMedias.razonSocial ? <> con <b>{aMedias.nombre}</b></> : ''}.</Burbuja>
        )}
        {visibles.map((m) => <Burbuja key={m.id} de={m.de}>{m.texto}</Burbuja>)}
        {pregunta && (
          <Burbuja de="folvy"><BurbujaPregunta previo={juntoConPregunta?.texto ?? null} pregunta={pregunta} primera={primeraDelPaso} /></Burbuja>
        )}
        {pregunta && !(marco === 'ventana' && !movil) && bocadillo}
        {paso === 'hecho' && mensajes.length === 0 && (
          <Burbuja de="folvy">Tu empresa ya está dada de alta. La ves y la cambias en <Link to={rutaTuEmpresa()}>Tu empresa</Link>.</Burbuja>
        )}
        {pregunta && !ocupado && (pregunta.opciones.length > 0 || pregunta.noLoSe) && (
          <div className="cx-alta-respuestas">
            {pregunta.opciones.map((o, i) => (
              <button key={o.valor} type="button" className={i === 0 ? 'cx-boton' : 'cx-boton-sec'}
                onClick={() => void responder(pregunta, o.valor, o.texto)}>{o.texto}</button>
            ))}
            {/* En el móvil, «No lo sé» a secas (M1), para que quepa; la frase entera, para quien lee con lector. */}
            <button type="button" className="cx-boton-sec" aria-label={pregunta.noLoSe}
              onClick={() => void responder(pregunta, '__nolose', pregunta.noLoSe)}>{movil && pregunta.noLoSe.length > 14 ? 'No lo sé' : pregunta.noLoSe}</button>
          </div>
        )}
        {pregunta?.entrada === 'direccion' && !ocupado && (
          <FormDireccion key={direccionDicha?.vuelta ?? 0} inicial={direccionDicha?.d ?? null}
            guardar={(dir, ia) => void responder(pregunta, 'escrita', `${dir.calle} ${dir.numero}, ${dir.codigoPostal} ${dir.poblacion}`, { direccion: dir, deducido: ia })} />
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
        {ocupado && <p className="cx-ayuda cx-alta-guardando" role="status">Guardando…</p>}
        <div ref={fin} />
      </div>

      <div className="cx-alta-escribir">
        <form className="cx-alta-entrada" onSubmit={enviarTexto} aria-label="Escribe tu respuesta">
          <input ref={entrada} className="cx-alta-input" value={texto} onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && !e.shiftKey) { e.preventDefault(); enviarTexto() } }}
            placeholder={movil ? 'Contesta con tus palabras' : 'Contesta con tus palabras, como se lo dirías a tu gestor'}
            aria-label="Tu respuesta" disabled={ocupado || paso === 'hecho'}
            inputMode={pregunta?.entrada === 'nif' || pregunta?.entrada === 'iban' ? 'text' : undefined} autoComplete="off" />
          {/* Solo con texto escrito (respuesta 5). No se selecciona ni se lleva el foco: tocarla envía, como la tecla. */}
          {!movil && texto.trim() !== '' && (
            <kbd className="cx-alta-tecla" aria-hidden="true" onMouseDown={(e) => e.preventDefault()} onClick={() => enviarTexto()}>↵ Intro</kbd>
          )}
          <button type="submit" className="cx-alta-enviar" aria-label="Enviar" disabled={texto.trim() === '' || ocupado || paso === 'hecho'}
            onMouseDown={(e) => e.preventDefault()}><Flecha /></button>
          <button type="button" className="cx-voz" aria-label="Hablar" onClick={() => setMuyPronto(true)}><Microfono /></button>
          <div role="status" aria-live="polite">{muyPronto && <span className="cx-muy-pronto">{TEXTO_MUY_PRONTO}</span>}</div>
        </form>
        <span className="cx-alta-pista">Vale escribir «ni idea» o «pregúntaselo a mi asesor». Nada se da por bueno sin que lo confirmes.</span>
      </div>
    </>
  )

  const cuerpo = cargandoTodo ? <TarjetaCargando />
    : fallo ? <ErrorConReintento mensaje={fallo} reintentar={() => { if (falloReglas) setVueltaReglas((v) => v + 1); else datos.recargar() }} />
      : conversacion

  // ── Ventana flotante (N1c) ────────────────────────────────────────────
  if (marco === 'ventana' && !movil) {
    return (
      <div className="cx cx-alta-velo">
        <div className="cx-alta-ventana" role="dialog" aria-modal="true" aria-labelledby={idTitulo}>
          <header className="cx-alta-ventana-cabeza">
            <div>
              <span className="cx-antetitulo">Nueva empresa en tu cuenta</span>
              <h1 id={idTitulo} className="cx-alta-ventana-titulo">Cuéntame la empresa y la dejo montada</h1>
            </div>
            <div className="cx-alta-ventana-derecha">
              <PuntosProgreso puntos={puntos} />
              <button type="button" className="cx-alta-cerrar" aria-label="Cerrar: se guarda solo" onClick={salir}>×</button>
            </div>
          </header>
          <Pildoras puntos={puntos} volver={(c) => volverA(c, null)} />
          <section className="cx-alta-ventana-cuerpo" aria-label="Conversación">{cuerpo}</section>
          {bocadillo && <div className="cx-alta-fuera cx-alta-fuera-porque">{bocadillo}</div>}
          <div className="cx-alta-fuera cx-alta-fuera-pildoras" aria-hidden="true">
            <b>Cada píldora es un dato ya apuntado.</b> Tócala para cambiarlo sin salir de la conversación.
          </div>
          <div className="cx-alta-fuera cx-alta-fuera-cerrar" aria-hidden="true">
            Puedes cerrar la ventana cuando quieras: <b>se guarda solo</b> y la retomas desde «Tu empresa».
          </div>
        </div>
      </div>
    )
  }

  // ── Pantalla completa (N1b), y el móvil ──────────────────────────────
  return (
    <div className={`cx cx-alta${movil ? ' cx-alta-movil' : ''}`}>
      <header className="cx-alta-cabeza">
        <span className="cx-alta-logo">folvy</span>
        <div className="cx-alta-cabeza-derecha">
          {movil ? (
            <button type="button" className="cx-alta-cuantos" aria-haspopup="dialog" aria-expanded={hoja}
              aria-label={`Lo que llevamos: ${hechos} de ${TOTAL_PUNTOS}`} onClick={() => setHoja(true)}>
              <span className="cx-cifra">{hechos} de {TOTAL_PUNTOS}</span>
            </button>
          ) : <span className="cx-ayuda">Se guarda solo · sigue cuando quieras</span>}
          <button type="button" className="cx-boton-sec cx-alta-salir" onClick={salir}>Salir y seguir luego</button>
        </div>
      </header>
      <div className="cx-alta-cuerpo">
        <section className="cx-alta-columna" aria-label="Conversación">
          {!movil && (
            <div className="cx-alta-titular">
              <h1 className="cx-alta-h1">Cuéntame tu negocio y lo dejo montado.</h1>
              <p className="cx-ayuda cx-alta-subtitulo">Tres minutos. Sin saber de contabilidad. Lo que vayas diciendo se apunta a la derecha.</p>
            </div>
          )}
          {cuerpo}
        </section>
        {!movil && <LoQueLlevamos puntos={puntos} hechos={hechos} companyId={companyId} volver={(c) => volverA(c, null)} />}
      </div>
      {movil && hoja && (
        <HojaLlevamos puntos={puntos} hechos={hechos} companyId={companyId} volver={(c) => volverA(c, null)} cerrar={() => setHoja(false)} />
      )}
    </div>
  )
}

// ── Lo apuntado de cada punto, en una línea ─────────────────────────────────

function valoresDe(d: DatosEmpresa | null, hoy: string): Partial<Record<ClavePunto, string | null>> {
  if (!d) return {}
  const e = d.empresa
  const p = d.perfil
  const vivas = d.actividades.filter((a) => a.endedOn === null)
  const calle = [e.fiscalStreet, e.fiscalNumber].filter((x) => x && x.trim() !== '').join(' ')
  const ej = ejercicioActual(d.ejercicios, hoy)
  const impuesto = p?.taxTerritory === 'canarias' ? 'IGIC' : p?.taxTerritory === 'ceuta_melilla' ? 'IPSI' : 'IVA'
  return {
    quien: e.legalName ? [e.legalName, e.taxId].filter(Boolean).join(' · ') : null,
    donde: calle ? [calle, e.fiscalCity].filter((x) => x && x.trim() !== '').join(', ') : null,
    actividad: vivas.length
      ? `${vivas[0].description}${vivas[0].iaeCode ? ` · ${codigoIae(vivas[0].iaeCode)}` : ''}${vivas.length > 1 ? ` y ${vivas.length - 1} más` : ''}`
      : null,
    impuestos: p ? `${impuesto}${impuesto === 'IVA' ? ` ${p.vatPeriod === 'monthly' ? 'cada mes' : 'cada tres meses'}` : ''}${p.taxForms.length ? ` · ${p.taxForms.join(', ')}` : ''}` : null,
    cuentas: p && ej ? `Plan ${p.chartKind === 'pymes' ? 'de pymes' : 'general'} · ${p.accountDigits} dígitos · ${ej.code}` : null,
    banco: null,
  }
}

const textoDelPunto = (p: Punto): string =>
  p.estado === 'actual' ? 'Te lo estoy preguntando'
    : p.estado === 'hecho' ? p.valor ?? (p.clave === 'banco' ? 'Hecho' : 'Sin poner por ahora')
      : p.falta

// ── Piezas ──────────────────────────────────────────────────────────────────

/** Lo que la IA acaba de apuntar, la transición del paso y la pregunta, en una burbuja. */
function BurbujaPregunta({ previo, pregunta, primera }: { previo: ReactNode; pregunta: Pregunta; primera: boolean }) {
  return (
    <>
      {previo && <>{previo}<br /><br /></>}
      {primera && pregunta.transicion && <>{pregunta.transicion} </>}
      <b>{pregunta.texto}</b>
    </>
  )
}

function Burbuja({ de, children }: { de: 'folvy' | 'persona'; children: ReactNode }) {
  return de === 'folvy'
    ? <div className="cx-alta-folvy"><span className="cx-alta-punto" aria-hidden="true"><span /></span><div className="cx-alta-burbuja">{children}</div></div>
    : <div className="cx-alta-persona"><div className="cx-alta-burbuja">{children}</div></div>
}

/** «¿Por qué lo pregunto?»: plegado con el enlace; se abre al tocarlo. */
function Bocadillo({ texto, fuera }: { texto: string; fuera: boolean }) {
  const [abierto, setAbierto] = useState(false)
  const id = useId()
  return (
    <div className={`cx-bocadillo${fuera ? ' cx-bocadillo-fuera' : ''}${abierto ? ' cx-bocadillo-abierto' : ''}`}>
      <span className="cx-bocadillo-pico" aria-hidden="true" />
      <button type="button" className="cx-bocadillo-enlace" aria-expanded={abierto} aria-controls={id} onClick={() => setAbierto((v) => !v)}>
        ¿Por qué lo pregunto?
      </button>
      {abierto && <span id={id} className="cx-bocadillo-texto"> {texto}</span>}
    </div>
  )
}

function Marca({ estado }: { estado: Punto['estado'] }) {
  return estado === 'hecho' ? <span className="cx-llevamos-marca cx-llevamos-hecho" aria-hidden="true">✓</span>
    : estado === 'actual' ? <span className="cx-llevamos-marca cx-llevamos-actual" aria-hidden="true"><span /></span>
      : <span className="cx-llevamos-marca cx-llevamos-falta" aria-hidden="true" />
}

const ESTADO_LEIDO: Record<Punto['estado'], string> = { hecho: 'hecho', actual: 'te lo estoy preguntando', falta: 'falta' }

function FilaLlevamos({ p, volver }: { p: Punto; volver: (c: ClavePunto) => void }) {
  const contenido = (
    <>
      <Marca estado={p.estado} />
      <span className="cx-llevamos-texto">
        <span className="cx-llevamos-etiqueta">{p.etiqueta}</span>
        <span className="cx-llevamos-valor">{textoDelPunto(p)}</span>
      </span>
    </>
  )
  const clase = `cx-llevamos-fila cx-llevamos-fila-${p.estado}`
  return p.estado === 'hecho'
    ? <button type="button" className={clase} aria-label={`${p.etiqueta}: ${textoDelPunto(p)}. Cambiar`} onClick={() => volver(p.clave)}>{contenido}</button>
    : <div className={clase} aria-label={`${p.etiqueta}: ${ESTADO_LEIDO[p.estado]}`} role="group">{contenido}</div>
}

function Progreso({ hechos }: { hechos: number }) {
  return (
    <div className="cx-llevamos-barra" role="progressbar" aria-valuemin={0} aria-valuemax={TOTAL_PUNTOS} aria-valuenow={hechos}
      aria-label={`${hechos} de ${TOTAL_PUNTOS}`}>
      <span style={{ width: `${(hechos / TOTAL_PUNTOS) * 100}%` }} />
    </div>
  )
}

function LoQueLlevamos({ puntos, hechos, companyId, volver }: { puntos: Punto[]; hechos: number; companyId: string | null; volver: (c: ClavePunto) => void }) {
  return (
    <aside className="cx-llevamos" aria-label="Lo que llevamos">
      <div className="cx-llevamos-cabeza"><span className="cx-llevamos-titulo">Lo que llevamos</span><span className="cx-cifra cx-llevamos-cuenta">{hechos} de {TOTAL_PUNTOS}</span></div>
      <Progreso hechos={hechos} />
      {puntos.map((p) => <FilaLlevamos key={p.clave} p={p} volver={volver} />)}
      {companyId && <Link to={rutaTuEmpresa()} className="cx-llevamos-ficha">Ver la ficha completa</Link>}
      <span className="cx-ayuda cx-llevamos-pie">Toca cualquier punto hecho para cambiarlo.</span>
    </aside>
  )
}

function HojaLlevamos({ puntos, hechos, companyId, volver, cerrar }: {
  puntos: Punto[]; hechos: number; companyId: string | null; volver: (c: ClavePunto) => void; cerrar: () => void
}) {
  const id = useId()
  useEffect(() => {
    const alPulsar = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrar() }
    window.addEventListener('keydown', alPulsar)
    return () => window.removeEventListener('keydown', alPulsar)
  }, [cerrar])
  return (
    <div className="cx-hoja-velo" onClick={cerrar}>
      <div className="cx-hoja" role="dialog" aria-modal="true" aria-labelledby={id} onClick={(e) => e.stopPropagation()}>
        <span className="cx-hoja-asa" aria-hidden="true" />
        <div className="cx-llevamos-cabeza">
          <span id={id} className="cx-llevamos-titulo">Lo que llevamos</span>
          <span className="cx-cifra cx-llevamos-cuenta">{hechos} de {TOTAL_PUNTOS}</span>
        </div>
        <Progreso hechos={hechos} />
        {puntos.map((p) => <FilaLlevamos key={p.clave} p={p} volver={volver} />)}
        <div className="cx-hoja-pie">
          {companyId && <Link to={rutaTuEmpresa()} className="cx-llevamos-ficha">Ver la ficha completa</Link>}
          <button type="button" className="cx-boton-sec" onClick={cerrar}>Cerrar</button>
        </div>
      </div>
    </div>
  )
}

function PuntosProgreso({ puntos }: { puntos: Punto[] }) {
  const hechos = cuantosHechos(puntos)
  return (
    <span className="cx-alta-puntos" role="img" aria-label={`${hechos} de ${TOTAL_PUNTOS}`}>
      {puntos.map((p) => <span key={p.clave} className={`cx-alta-puntito cx-alta-puntito-${p.estado}`} />)}
    </span>
  )
}

function Pildoras({ puntos, volver }: { puntos: Punto[]; volver: (c: ClavePunto) => void }) {
  return (
    <ul className="cx-alta-pildoras" aria-label="Lo que llevamos">
      {puntos.map((p) => (
        <li key={p.clave}>
          {p.estado === 'hecho' ? (
            <button type="button" className="cx-pildora cx-pildora-hecho" aria-label={`${p.etiqueta}: ${textoDelPunto(p)}. Cambiar`} onClick={() => volver(p.clave)}>
              ✓ {p.valor ?? p.etiqueta}
            </button>
          ) : (
            <span className={`cx-pildora cx-pildora-${p.estado}`}>{p.estado === 'actual' ? '● ' : ''}{p.etiqueta}</span>
          )}
        </li>
      ))}
    </ul>
  )
}

/** Lo que la IA dedujo de la dirección: va con su marca «IA» y su porqué. */
interface DeducidoDireccion { poblacion: string | null; provincia: string | null }

/**
 * La dirección en sus campos. Con un código postal, la población se propone
 * sola desde la tabla de serie, marcada «IA» y confirmable con «Es esta» (la
 * regla de Julio: lo que la IA puede deducir nunca se deja en blanco). Si la
 * persona dijo la ciudad en la frase, manda lo que dijo.
 */
function FormDireccion({ inicial, guardar }: { inicial: DireccionEntendida | null; guardar: (d: DireccionAlta, ia: DeducidoDireccion) => void }) {
  const [v, setV] = useState<DireccionAlta>({
    calle: inicial?.calle ?? '', numero: inicial?.numero ?? '', codigoPostal: inicial?.codigoPostal ?? '', poblacion: inicial?.poblacion ?? '', provincia: '',
  })
  /** La propuesta de la IA, mientras la población sea la que propuso (al escribir encima, deja de serlo). */
  const [propuesta, setPropuesta] = useState<PoblacionPropuesta | null>(null)
  const [falloCp, setFalloCp] = useState<string | null>(null)
  const [fallo, setFallo] = useState<string | null>(null)
  const pon = (k: keyof DireccionAlta) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }))
  const cp = v.codigoPostal.trim()
  const deLaIa = propuesta !== null && v.poblacion === propuesta.valor
  const vacia = v.poblacion.trim() === ''

  // Lo que hay en pantalla cuando llega la respuesta: lo escrito por la persona mientras tanto no se pisa.
  const ahora = useRef({ poblacion: v.poblacion, deLaIa })
  useEffect(() => { ahora.current = { poblacion: v.poblacion, deLaIa } })

  useEffect(() => {
    if (!/^\d{5}$/.test(cp)) return
    let vivo = true
    lugaresPorCp(cp)
      .then((l) => {
        if (!vivo) return
        const libre = ahora.current.poblacion.trim() === '' || ahora.current.deLaIa
        if (!libre) return
        const p = proponerPoblacion(cp, l)
        setFalloCp(p ? null : `No tengo el código postal ${cp} en la tabla de códigos postales: escribe la población.`)
        setPropuesta(p)
        setV((x) => ({ ...x, poblacion: p ? p.valor : '' }))
      })
      .catch((e: unknown) => { if (vivo) setFalloCp(`No he podido mirar la población del código postal: ${e instanceof Error ? e.message : String(e)}. Escríbela.`) })
    return () => { vivo = false }
  }, [cp, vacia])

  const provincia = provinciaPorCp(cp)
  const idOtras = useId()
  return (
    <form className="cx-formulario cx-alta-direccion" noValidate aria-label="Dirección fiscal" onSubmit={(e) => {
      e.preventDefault()
      if (v.calle.trim() === '' || !/^\d{5}$/.test(cp)) { setFallo('Pon al menos la calle y un código postal de cinco cifras.'); return }
      if (v.poblacion.trim() === '') { setFallo('Falta la población.'); return }
      guardar({ ...v, codigoPostal: cp, provincia: provincia ?? '' }, {
        poblacion: deLaIa ? propuesta.porque : null,
        provincia: provincia ? `Por el código postal ${cp}: sus dos primeras cifras, ${cp.slice(0, 2)}, son de la provincia de ${provincia}.` : null,
      })
    }}>
      <div className="cx-formulario-fila">
        <div className="cx-campo"><label htmlFor="alta-calle">Calle</label><input id="alta-calle" className="cx-input" value={v.calle} onChange={pon('calle')} /></div>
        <div className="cx-campo"><label htmlFor="alta-num">Número</label><input id="alta-num" className="cx-input" value={v.numero} onChange={pon('numero')} /></div>
        <div className="cx-campo"><label htmlFor="alta-cp">Código postal</label><input id="alta-cp" className="cx-input" inputMode="numeric" value={v.codigoPostal} onChange={pon('codigoPostal')} /></div>
        <div className="cx-campo">
          <span className="cx-alta-etiqueta-ia">
            <label htmlFor="alta-pob">Población</label>
            {deLaIa && <MarcaIA motivo={propuesta.porque} />}
          </span>
          <input id="alta-pob" className="cx-input" value={v.poblacion} onChange={pon('poblacion')}
            list={deLaIa && propuesta.otras.length > 0 ? idOtras : undefined} />
          {deLaIa && propuesta.otras.length > 0 && <datalist id={idOtras}>{[propuesta.valor, ...propuesta.otras].map((o) => <option key={o} value={o} />)}</datalist>}
        </div>
      </div>
      {deLaIa && (
        <span className="cx-ayuda" role="status">
          La población la he puesto por el código postal{provincia ? <> (provincia de {provincia})</> : null}. Si no es, cámbiala; si es, pulsa «Es esta».
        </span>
      )}
      {falloCp && <span className="cx-error" role="alert">{falloCp}</span>}
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
