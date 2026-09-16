// src/modules/kds/components/LaCocinaDelLocal.tsx
//
// «LA COCINA DE <LOCAL>» · 15/09/2026 · maqueta «Una página por cocina»
//
// Estaciones, Ruteo familias y Dispositivos eran la misma cosa mirada tres
// veces. Una estación tiene nombre, papel, qué platos le tocan y qué tablet la
// mira; hoy eso vive en tres listas y configurar una estación son tres sitios.
// La página se organizaba por el TIPO DE CAMPO en vez de por LA COSA.
//
// ── LO QUE LA MAQUETA RESUELVE Y CONVIENE NO PERDER ───────────────────────
//
//  · `kind` se dice con DOS palabras y sólo dos: «Salida» y «Preparación».
//    Fuera «Expo», «Pase», «Prep» y «Expo / Pase» — cuatro palabras vivas para
//    dos conceptos es la enfermedad de las cuatro definiciones de «listo»,
//    trasladada al vocabulario.
//  · El nombre grande es el DEL CLIENTE (`kitchen_station.name`): «Pase» aquí,
//    «Embolsado» en otra cocina. El producto no nombra la estación de nadie.
//  · La de salida DICE POR QUÉ «Qué prepara» está vacío, en vez de enseñar una
//    lista en blanco que parece rota.
//  · El radio sin etiqueta desaparece: «Recibe los platos sin ruteo» se dice
//    con palabras donde es verdad, y es una ACCIÓN donde no lo es.
//  · Acciones en palabras, la destructiva en rojo y la última.
//  · NINGÚN SELECTOR DE LOCAL NUEVO. Ya hay uno general arriba a la derecha; el
//    título lleva el nombre. Dos controles para una cosa es como acaban
//    diciendo cosas distintas.
//
// ✅ LA BASE YA ESTÁ. `kitchen_station.pase_activo` y sus cuatro columnas de
// traza existen desde la migración `20260915225209`, aplicada el 16/09 a las
// 00:52. Mientras no estuvo, este fichero llevaba aquí el aviso de que no se
// podía fusionar.

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Check, Plus, QrCode, X } from 'lucide-react'
import QRCode from 'qrcode'
import {
  getLaCocina, hayQuePintarQuePrepara, porQueNoHayFamilias,
  type LaCocina, type LaEstacion, type LaTabletQueMira,
} from '../services/laCocina'
import {
  createStation, setDefaultStation, updateStation,
  createDevice, updateDevice, revokeDevice, generateDeviceToken, listDevices,
  setFamilyRoute,
} from '../services/kdsService'

/** Dibuja el QR y sólo entonces devuelve lo que hay que enseñar. */
async function elCuadroDelQr(label: string, token: string) {
  const url = urlDeEstacion(token)
  return {
    label, url, urlTv: urlDeTv(token),
    img: await QRCode.toDataURL(url, { width: 320, margin: 1 }),
  }
}

/**
 * LA URL QUE SE ABRE EN LA TABLET PARA VINCULARLA. La misma que usaba
 * «Dispositivos»: no se inventa una nueva ni se cambia la forma, porque hay
 * tablets vivas vinculadas con ella.
 */
function urlDeEstacion(token: string): string {
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  return `${origin}/estacion?token=${token}`
}

/**
 * LA OTRA URL: el modo TV. «Dispositivos» ofrecía las dos y una TV colgada de
 * la pared no escanea nada, así que sin esto la retirada se llevaba por delante
 * la única forma de enchufar una pantalla de pared.
 */
function urlDeTv(token: string): string {
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  return `${origin}/cocina-tv?token=${token}`
}

/** Las DOS palabras. No hay una tercera. */
const PAPEL: Record<'expo' | 'prep', string> = { expo: 'Salida', prep: 'Preparación' }

/** Qué hace, en una línea y en las palabras de la cocina. */
function queHace(e: LaEstacion): string {
  return e.kind === 'expo'
    ? 'Aquí se entrega. Cuando el pedido se completa en esta estación, se da por servido.'
    : 'Aquí se cocina.'
}

function haceCuanto(min: number | null): string {
  if (min == null) return 'sin señal todavía'
  if (min < 2) return 'vista hace 1 min'
  if (min < 60) return `vista hace ${min} min`
  const h = Math.round(min / 60)
  return h < 48 ? `vista hace ${h} h` : `vista hace ${Math.round(h / 24)} días`
}

function cuandoEnPalabras(iso: string | null): string | null {
  if (!iso) return null
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return null
  const hora = t.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
  const hoy = new Date()
  if (t.toDateString() === hoy.toDateString()) return `hoy a las ${hora}`
  if (new Date(hoy.getTime() - 86_400_000).toDateString() === t.toDateString()) return `ayer a las ${hora}`
  return `el ${t.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })} a las ${hora}`
}

export default function LaCocinaDelLocal({ accountId, locationId }: {
  accountId: string
  locationId: string
}) {
  const [cocina, setCocina] = useState<LaCocina | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [nueva, setNueva] = useState({ nombre: '', kind: 'prep' as 'prep' | 'expo' })
  const [nuevaTablet, setNuevaTablet] = useState('')
  // El QR que se está enseñando, YA DIBUJADO.
  //
  // 🔴 La imagen se genera ANTES de abrir el cuadro, no en un efecto que
  // reacciona a que se haya abierto. La primera versión llevaba ese efecto y el
  // lint lo paró con razón: un `setState` dentro del cuerpo de un efecto
  // encadena renders, y aquí no hacía falta ninguno — dibujar el QR es parte de
  // abrirlo, no una consecuencia de haberlo abierto.
  //
  // `url` lleva la llave del aparato: se pinta y se copia, no se registra.
  const [qr, setQr] = useState<{ label: string; url: string; urlTv: string; img: string } | null>(null)

  const cargar = useCallback(async () => {
    try { setCocina(await getLaCocina(accountId, locationId)); setError(null) }
    catch (e) { setError((e as Error).message) }
  }, [accountId, locationId])

  // Primera carga fuera del cuerpo del efecto (`set-state-in-effect`).
  useEffect(() => {
    const t = setTimeout(() => { void cargar() }, 0)
    return () => clearTimeout(t)
  }, [cargar])

  const conAviso = async (que: () => Promise<void>, dicho: string) => {
    setOcupado(true)
    try { await que(); setAviso(dicho); await cargar() }
    catch (e) { setAviso(`No se ha podido: ${(e as Error).message}`) }
    finally { setOcupado(false) }
  }

  const renombrar = (e: LaEstacion) => {
    const nombre = window.prompt('¿Cómo se llama esta estación?', e.name)?.trim()
    if (!nombre || nombre === e.name) return
    void conAviso(
      async () => { await updateStation(e.id, { name: nombre }) },
      `Ahora se llama «${nombre}».`)
  }

  const cambiarPapel = (e: LaEstacion) => {
    const a = e.kind === 'expo' ? 'prep' : 'expo'
    void conAviso(
      async () => { await updateStation(e.id, { kind: a }) },
      `«${e.name}» pasa a ser de ${PAPEL[a].toLowerCase()}.`)
  }

  const desactivar = (e: LaEstacion) => {
    if (!window.confirm(`¿Desactivar «${e.name}»? Deja de recibir pedidos.`)) return
    void conAviso(
      async () => { await updateStation(e.id, { isActive: false }) },
      `«${e.name}» desactivada. Ya no recibe pedidos.`)
  }

  // ── LAS TABLETS ─────────────────────────────────────────────────────────
  //
  // 🔴 ESTO NO ESTABA, Y SIN ELLO LA RETIRADA NO SE PODÍA HACER. «Dispositivos»
  // no sólo listaba tablets: las daba de alta con su token, enseñaba el QR para
  // vincularlas, copiaba la URL y las revocaba. Quitar esa pestaña sin traerlo
  // aquí habría dejado la cuenta sin ninguna forma de enchufar una tablet
  // nueva, y el aviso de «asígnale una abajo» apuntaba a algo que no existía.

  const ponerEnEstacion = (t: LaTabletQueMira, estacionId: string) => {
    const ya = t.estacionIds.includes(estacionId)
    const ids = ya ? t.estacionIds.filter(x => x !== estacionId) : [...t.estacionIds, estacionId]
    const comoQueda = ids.length === 0
      ? `«${t.label}» no mira ninguna estación: verá todos los pedidos del local.`
      : `«${t.label}» mira ahora ${ids.length} ${ids.length === 1 ? 'estación' : 'estaciones'}.`
    void conAviso(async () => { await updateDevice(t.id, { stationIds: ids }) }, comoQueda)
  }

  const darDeBaja = (t: LaTabletQueMira) => {
    if (!window.confirm(`¿Dar de baja «${t.label}»? Dejará de poder abrir la pantalla.`)) return
    void conAviso(async () => { await revokeDevice(t.id) },
                  `«${t.label}» dada de baja. Su enlace deja de valer.`)
  }

  const quitarFamilia = (e: LaEstacion, familiaId: string, nombre: string) => {
    void conAviso(async () => { await setFamilyRoute(accountId, familiaId, null) },
                  `«${nombre}» ya no va a «${e.name}»: vuelve a la estación por defecto.`)
  }

  /** Alta de tablet: crea, y deja el QR delante para vincularla ahí mismo. */
  const altaDeTablet = async () => {
    const etiqueta = nuevaTablet.trim()
    if (etiqueta === '') return
    setOcupado(true)
    try {
      const token = generateDeviceToken()
      await createDevice({ accountId, locationId, label: etiqueta, stationIds: null, token })
      setNuevaTablet('')
      await cargar()
      // El QR se saca del token recién creado, sin volver a pedirlo a la base.
      setQr(await elCuadroDelQr(etiqueta, token))
      setAviso(`Tablet «${etiqueta}» dada de alta. Escanea el QR en ella para vincularla.`)
    } catch (e) {
      setAviso(`No se ha podido dar de alta: ${(e as Error).message}`)
    } finally { setOcupado(false) }
  }

  /** El QR de una tablet YA creada: hay que ir a buscar su token. */
  const verQr = (t: LaTabletQueMira) => {
    void conAviso(async () => {
      const todos = await listDevices(accountId, locationId)
      const d = todos.find(x => x.id === t.id)
      if (!d) throw new Error('esa tablet ya no está')
      setQr(await elCuadroDelQr(t.label, d.token))
    }, `QR de «${t.label}».`)
  }

  const activas = (cocina?.estaciones ?? []).filter(e => e.isActive)
  const conFamilias = hayQuePintarQuePrepara(activas)
  const unaSolaPrep = activas.filter(e => e.kind === 'prep').length === 1

  return (
    <div className="space-y-4">
      {/* 🔴 Ningún selector de local: el título dice dónde estás y basta. */}
      <div>
        <h2 className="text-[21px] font-extrabold tracking-tight text-text-primary">
          La cocina de {cocina?.local ?? '…'}
        </h2>
        <p className="text-[14px] text-text-secondary mt-0.5">
          Las estaciones, qué prepara cada una y qué tablet la mira.
        </p>
      </div>

      {aviso && (
        <div className="rounded-xl border border-default bg-card px-3.5 py-2.5 text-[13px] flex gap-2">
          <span className="min-w-0">{aviso}</span>
          <button onClick={() => setAviso(null)} className="ml-auto underline shrink-0">cerrar</button>
        </div>
      )}
      {error && (
        <div className="rounded-xl border border-danger/40 bg-danger-bg/30 px-3.5 py-2.5 text-[13px]">
          <b>No se ha podido leer la cocina.</b> {error}
        </div>
      )}

      {cocina == null ? (
        <p className="text-text-tertiary text-[13px] py-6">Cargando…</p>
      ) : (
        <div className="rounded-xl border border-default bg-card overflow-hidden">

          {/* 🔴 EL AVISO DE TABLET SIN ESTACIÓN · sólo activas y sólo aquí.
              Regla 39: sale donde se puede arreglar, o no sale. Una tablet de
              otro local no se arregla desde esta página. */}
          {cocina.tabletsSinEstacion.length > 0 && (
            <div className="flex gap-3 px-5 py-3.5 bg-warning-bg border-b border-default text-[13.5px]">
              <AlertTriangle size={17} className="shrink-0 mt-0.5 text-warning" />
              <span className="min-w-0">
                {cocina.tabletsSinEstacion.map(t => (
                  <span key={t.id} className="block">
                    <b className="text-text-primary">La tablet «{t.label}» no tiene estación.</b>{' '}
                    Está encendida ({haceCuanto(t.vistoHaceMin)}) pero no mira ninguna, así que
                    ve todos los pedidos del local en vez de los suyos. Se le asigna abajo, en
                    «Las tablets de este local».
                  </span>
                ))}
              </span>
            </div>
          )}

          {activas.map(e => (
            <article key={e.id}
                     className={`border-b border-default border-l-[3px] px-5 py-4 ${
                       e.kind === 'expo'
                         // 🔴 `bg-success-bg`, no `bg-background-success`. Ese
                         // token NO EXISTE en el tema --sólo existe
                         // `background-info`-- y Tailwind no se queja: la clase
                         // se escribe, no casa con nada y la fila de salida se
                         // queda sin su tinte. Nadie lo ve hasta que alguien
                         // compara la pantalla con la maqueta.
                         //
                         // Es la regla 40 fuera del SQL: un nombre dentro de
                         // una cadena de texto que ni `tsc` ni el lint miran.
                         // Comprobado contra `tailwind.config.js` el 16/09.
                         ? 'bg-success-bg/40 border-l-success'
                         : 'border-l-transparent'}`}>
              <div className="flex flex-wrap gap-y-2.5 gap-x-5 items-start justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <b className="text-[17px] font-extrabold tracking-tight">{e.name}</b>
                    <span className={`text-[11.5px] font-extrabold uppercase tracking-wider
                                      px-2.5 py-0.5 rounded-full border ${
                      e.kind === 'expo'
                        ? 'bg-success text-text-on-accent border-success'
                        : 'border-default text-text-secondary bg-card'}`}>
                      {PAPEL[e.kind]}
                    </span>
                    {e.isDefault && (
                      <span className="text-[12px] text-text-secondary border border-dashed
                                       border-default rounded-full px-2.5 py-0.5">
                        Recibe los platos sin ruteo
                      </span>
                    )}
                  </div>
                  <p className="text-[13.5px] text-text-secondary mt-1 max-w-[58ch]">{queHace(e)}</p>
                </div>

                {/* La pantalla, sólo en la de salida y sólo si el Pase existe. */}
                {e.kind === 'expo' && (
                  <div className="text-right max-w-[25ch] shrink-0">
                    <span className="flex items-center justify-end gap-2 font-bold text-[14.5px]">
                      <span className={`w-2.5 h-2.5 rounded-full ${
                        e.paseActivo ? 'bg-success' : 'bg-text-tertiary'}`} />
                      {e.paseActivo ? 'Pantalla encendida' : 'Pantalla apagada'}
                    </span>
                    <span className="block text-[12.5px] text-text-secondary leading-snug mt-0.5">
                      {cuandoEnPalabras(e.paseCuando) ?? 'Nunca se ha encendido'}
                      {e.paseCuando && e.paseDesde === 'tablet' && ', desde la tablet'}
                      {e.paseCuando && e.paseDesde === 'pantalla' && ', desde la oficina'}
                      {e.paseActivo && <><br />Se apaga desde la tablet.</>}
                    </span>
                  </div>
                )}
              </div>

              <div className={`grid gap-x-6 gap-y-2.5 mt-3.5 ${conFamilias ? 'sm:grid-cols-2' : ''}`}>
                {/* «Qué prepara» sólo con DOS O MÁS estaciones de preparación:
                    con una, todo va ahí por definición y un «+ familia» invita
                    a configurar algo que no puede hacer nada. */}
                {conFamilias && (
                  <div>
                    <span className="block text-[11px] uppercase tracking-[0.12em] text-text-tertiary mb-1.5">
                      Qué prepara
                    </span>
                    {porQueNoHayFamilias(e, unaSolaPrep) ? (
                      <span className="text-[14px] text-text-secondary">
                        {porQueNoHayFamilias(e, unaSolaPrep)}
                      </span>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {/* Quitables aquí mismo (§3 del encargo). Quitar una
                            familia no la borra: la devuelve a la estación por
                            defecto, y eso es lo que dice el aviso. */}
                        {e.familias.map(f => (
                          <span key={f.id}
                                className="text-[13px] border border-default rounded-md pl-2.5 pr-1 py-0.5
                                           inline-flex items-center gap-1.5">
                            {f.nombre}
                            <button onClick={() => quitarFamilia(e, f.id, f.nombre)} disabled={ocupado}
                                    title={`Quitar «${f.nombre}» de ${e.name}`}
                                    className="text-text-tertiary hover:text-danger disabled:opacity-50">
                              <X size={13} />
                            </button>
                          </span>
                        ))}
                        {e.familias.length === 0 && (
                          <span className="text-[13.5px] text-text-secondary">
                            Nada todavía. Lo que no se rutee aquí va a la estación por defecto.
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <div>
                  <span className="block text-[11px] uppercase tracking-[0.12em] text-text-tertiary mb-1.5">
                    Quién la mira
                  </span>
                  {e.laMiran.length === 0 ? (
                    <span className="text-[13.5px] text-text-secondary">
                      Ninguna tablet. Los pedidos de esta estación no se ven en ningún sitio.
                    </span>
                  ) : e.laMiran.map(t => (
                    <span key={t.id} className="flex items-center gap-2 text-[14px]">
                      <span className={`w-1.5 h-1.5 rounded-full ${t.activa ? 'bg-success' : 'bg-text-tertiary'}`} />
                      Tablet «{t.label}»
                      <span className="text-text-secondary text-[12.5px]">· {haceCuanto(t.vistoHaceMin)}</span>
                    </span>
                  ))}
                </div>
              </div>

              {/* Acciones en palabras, la destructiva en rojo y la última. */}
              <div className="flex flex-wrap items-center gap-3.5 mt-3.5 text-[13px]">
                <button onClick={() => renombrar(e)} disabled={ocupado}
                        className="underline underline-offset-[3px] text-text-secondary disabled:opacity-50">
                  Renombrar
                </button>
                <span className="text-text-tertiary">·</span>
                <button onClick={() => cambiarPapel(e)} disabled={ocupado}
                        className="underline underline-offset-[3px] text-text-secondary disabled:opacity-50">
                  Pasarla a {e.kind === 'expo' ? 'preparación' : 'salida'}
                </button>
                {!e.isDefault && e.kind === 'prep' && (
                  <>
                    <span className="text-text-tertiary">·</span>
                    <button onClick={() => void conAviso(
                              async () => { await setDefaultStation(accountId, locationId, e.id) },
                              `«${e.name}» recibe ahora los platos sin ruteo.`)}
                            disabled={ocupado}
                            className="underline underline-offset-[3px] text-text-secondary disabled:opacity-50">
                      Que reciba los platos sin ruteo
                    </button>
                  </>
                )}
                <span className="text-text-tertiary">·</span>
                <button onClick={() => desactivar(e)} disabled={ocupado}
                        className="underline underline-offset-[3px] text-danger disabled:opacity-50">
                  Desactivar
                </button>
              </div>
            </article>
          ))}

          <div className="flex flex-wrap items-end gap-2.5 px-5 py-4 bg-page">
            <label className="flex flex-col gap-1.5">
              <span className="text-[12.5px] text-text-secondary">Nombre</span>
              <input value={nueva.nombre} onChange={ev => setNueva({ ...nueva, nombre: ev.target.value })}
                     placeholder="Plancha, Fríos, Postres…"
                     className="min-w-[210px] text-[14.5px] border border-default bg-card rounded-lg px-3 py-2" />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[12.5px] text-text-secondary">Qué hace</span>
              <select value={nueva.kind}
                      onChange={ev => setNueva({ ...nueva, kind: ev.target.value as 'prep' | 'expo' })}
                      className="text-[14.5px] border border-default bg-card rounded-lg px-3 py-2">
                <option value="prep">Preparación</option>
                <option value="expo">Salida</option>
              </select>
            </label>
            <button disabled={ocupado || nueva.nombre.trim() === ''}
                    onClick={() => void conAviso(async () => {
                      await createStation({
                        accountId, locationId,
                        name: nueva.nombre.trim(), kind: nueva.kind,
                      })
                      setNueva({ nombre: '', kind: 'prep' })
                    }, `Estación «${nueva.nombre.trim()}» añadida.`)}
                    className="text-[14px] font-bold bg-accent text-text-on-accent rounded-lg
                               px-4 py-2 flex items-center gap-1.5 disabled:opacity-50">
              {ocupado ? '…' : <><Plus size={16} /> Añadir estación</>}
            </button>
          </div>
        </div>
      )}

      {/* ═══ LAS TABLETS DE ESTE LOCAL ═══════════════════════════════════
          Un bloque aparte y no una columna de la estación, porque una tablet
          NO es una estación: es un aparato que mira una o varias. Mezclarlas
          en la misma fila es lo que hacía que «Dispositivos» pareciera otra
          pantalla distinta. */}
      {cocina && (
        <div className="rounded-xl border border-default bg-card overflow-hidden">
          <div className="px-5 pt-4 pb-1">
            <h3 className="text-[15px] font-extrabold tracking-tight">Las tablets de este local</h3>
            <p className="text-[13px] text-text-secondary mt-0.5">
              Cada tablet abre su pantalla con un enlace propio. Marca qué estaciones mira;
              si no marcas ninguna, verá todos los pedidos del local.
            </p>
          </div>

          {cocina.tablets.length === 0 ? (
            <p className="px-5 py-4 text-[13.5px] text-text-secondary">
              Ninguna tablet dada de alta. Los pedidos de este local no se ven en ningún sitio.
            </p>
          ) : cocina.tablets.map(t => (
            <article key={t.id} className="border-t border-default px-5 py-3.5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span className={`w-2 h-2 rounded-full shrink-0 ${
                  t.vistoHaceMin != null && t.vistoHaceMin < 5 ? 'bg-success' : 'bg-text-tertiary'}`} />
                <b className="text-[15px]">{t.label}</b>
                <span className="text-[12.5px] text-text-secondary">{haceCuanto(t.vistoHaceMin)}</span>
                {/* 🔴 QUÉ PAQUETE CORRE, SIN FILTRAR. Esta pantalla se abre a
                    propósito, así que sale el estado de todas; el umbral de 24 h
                    vive sólo en el vigía que interrumpe (regla 7). Y no se
                    reescribe el castellano: sale de `loQueLeeLaOficina`. */}
                {t.paquete && (
                  <span className={`text-[12.5px] inline-flex items-center gap-1 ${
                    t.paquete.rojo ? 'text-danger font-bold' : 'text-text-secondary'}`}>
                    {t.paquete.rojo && <AlertTriangle size={12} />}
                    · {t.paquete.texto}
                  </span>
                )}
                <div className="ml-auto flex items-center gap-3.5 text-[13px]">
                  <button onClick={() => verQr(t)} disabled={ocupado}
                          className="underline underline-offset-[3px] text-text-secondary
                                     disabled:opacity-50 inline-flex items-center gap-1.5">
                    <QrCode size={14} /> Ver su QR
                  </button>
                  <span className="text-text-tertiary">·</span>
                  <button onClick={() => darDeBaja(t)} disabled={ocupado}
                          className="underline underline-offset-[3px] text-danger disabled:opacity-50">
                    Dar de baja
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5 mt-2.5">
                {activas.map(e => {
                  const mira = t.estacionIds.includes(e.id)
                  return (
                    <button key={e.id} onClick={() => ponerEnEstacion(t, e.id)} disabled={ocupado}
                            className={`text-[13px] rounded-md px-2.5 py-1 border disabled:opacity-50 ${
                              mira ? 'bg-accent text-text-on-accent border-accent'
                                   : 'border-default text-text-secondary'}`}>
                      {mira && <Check size={12} className="inline mr-1" />}
                      {e.name} · {PAPEL[e.kind].toLowerCase()}
                    </button>
                  )
                })}
                {t.estacionIds.length === 0 && (
                  <span className="text-[13px] text-warning self-center ml-1">
                    No mira ninguna: ve todos los pedidos del local.
                  </span>
                )}
              </div>
            </article>
          ))}

          <div className="flex flex-wrap items-end gap-2.5 px-5 py-4 bg-page border-t border-default">
            <label className="flex flex-col gap-1.5">
              <span className="text-[12.5px] text-text-secondary">Nombre de la tablet</span>
              <input value={nuevaTablet} onChange={ev => setNuevaTablet(ev.target.value)}
                     placeholder="Pase, Cocina, TV del pase…"
                     className="min-w-[210px] text-[14.5px] border border-default bg-card rounded-lg px-3 py-2" />
            </label>
            <button disabled={ocupado || nuevaTablet.trim() === ''}
                    onClick={() => void altaDeTablet()}
                    className="text-[14px] font-bold bg-accent text-text-on-accent rounded-lg
                               px-4 py-2 flex items-center gap-1.5 disabled:opacity-50">
              {ocupado ? '…' : <><Plus size={16} /> Dar de alta una tablet</>}
            </button>
          </div>
        </div>
      )}

      {/* El QR, para vincular la tablet escaneándolo desde ella. */}
      {qr && (
        <div className="fixed inset-0 z-50 bg-black/55 grid place-items-center p-4"
             onClick={() => setQr(null)}>
          <div className="bg-card rounded-2xl border border-default p-6 max-w-sm w-full text-center"
               onClick={ev => ev.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <b className="text-[15.5px]">Vincular «{qr.label}»</b>
              <button onClick={() => setQr(null)} className="p-1.5 rounded-md hover:bg-page text-text-secondary">
                <X size={18} />
              </button>
            </div>
            <img src={qr.img} alt={`QR de ${qr.label}`} width={280} height={280}
                 className="mx-auto rounded-xl bg-white p-2" />
            <p className="text-[13px] text-text-secondary mt-3 leading-snug">
              Escanéalo <b className="text-text-primary">desde la tablet</b> y se queda vinculada.
              El enlace lleva su llave: no lo compartas fuera del local.
            </p>
            {/* Copiar el enlace: lo tenía «Dispositivos» y hace falta para la
                tablet que no puede escanear --una TV, por ejemplo--. */}
            <div className="flex items-center justify-center gap-3.5 mt-3 text-[13px]">
              <button onClick={() => { void navigator.clipboard?.writeText(qr.url)
                                       setAviso(`Enlace de «${qr.label}» copiado.`) }}
                      className="underline underline-offset-[3px] text-text-secondary">
                Copiar el enlace
              </button>
              <span className="text-text-tertiary">·</span>
              <button onClick={() => { void navigator.clipboard?.writeText(qr.urlTv)
                                       setAviso(`Enlace de TV de «${qr.label}» copiado.`) }}
                      className="underline underline-offset-[3px] text-text-secondary">
                Copiar el de TV
              </button>
            </div>
          </div>
        </div>
      )}

      {cocina && activas.length === 0 && (
        <p className="text-[13.5px] text-text-secondary">
          <Check size={14} className="inline" /> Este local no tiene ninguna estación activa:
          todos los pedidos van a la tablet que los mire, sin repartir.
        </p>
      )}
    </div>
  )
}
