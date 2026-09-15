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
// ⚠️ DEPENDE DE UNA MIGRACIÓN SIN APLICAR: lee `kitchen_station.pase_activo`,
// que todavía vive en `kitchen_time_config`. Ver `laCocina.ts`. Esta página no
// se fusiona antes que `docs/propuestas/una-pagina-por-cocina-base.sql`.

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Check, Plus } from 'lucide-react'
import {
  getLaCocina, hayQuePintarQuePrepara, porQueNoHayFamilias,
  type LaCocina, type LaEstacion,
} from '../services/laCocina'
import { createStation, setDefaultStation, updateStation } from '../services/kdsService'

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
                    ve todos los pedidos del local en vez de los suyos. Asígnale una abajo.
                  </span>
                ))}
              </span>
            </div>
          )}

          {activas.map(e => (
            <article key={e.id}
                     className={`border-b border-default border-l-[3px] px-5 py-4 ${
                       e.kind === 'expo'
                         ? 'bg-background-success/40 border-l-success'
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
                        {e.familias.map(f => (
                          <span key={f.id} className="text-[13px] border border-default rounded-md px-2.5 py-0.5">
                            {f.nombre}
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

      {cocina && activas.length === 0 && (
        <p className="text-[13.5px] text-text-secondary">
          <Check size={14} className="inline" /> Este local no tiene ninguna estación activa:
          todos los pedidos van a la tablet que los mire, sin repartir.
        </p>
      )}
    </div>
  )
}
