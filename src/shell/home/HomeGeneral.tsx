// src/shell/home/HomeGeneral.tsx
//
// EL INICIO, ya como mosaico configurable — INICIO P1 · SUB-LOTE 2 (31/08/2026).
//
// Qué cambia respecto al Inicio de junio: las mismas siete tarjetas, pero ya no
// están escritas a mano en este fichero. Salen del CATÁLOGO (código) cruzado
// con el LAYOUT del usuario (`home_layout`). Los widgets no se han tocado —
// era la condición del RECON del 30/08, y son los que se escribieron en junio
// «preparados para configurabilidad sin reescribirlos».
//
// DE DÓNDE SALE LO QUE SE VE, en este orden:
//   1. `home_layout` del usuario, si ha personalizado alguna vez.
//   2. `home_role_default` de su rol, si la cuenta ha definido plantilla.
//   3. El defecto de fábrica del código — el orden de SHELL_HOME_CARDS, que es
//      exactamente el Inicio de hoy, para que nadie note el cambio hasta que
//      decida tocarlo.
//
// RESTAURAR BORRA LA FILA (no escribe el defecto): se deja de tener opinión
// propia y se cae al escalón siguiente. Ver homeLayoutService.
//
// SOLO ADMIN EN P1 (decisión de Julio): no existen `owner` ni `manager` en
// user_profiles.role — hay `admin` (3) y `worker` (9) — y no se inventan roles
// para personas que no existen. `worker` sigue en su portal.
//
// LA FRANJA DE ESTADO dice el ALCANCE y la FRESCURA de lo que hay debajo:
// de qué local son los números, de cuándo son, y si el mosaico es el tuyo o el
// defecto. Sin eso, un mosaico configurable es un montón de cifras sin decir
// de qué son. NO inventa estado de negocio: lo que no tiene fuente sigue
// diciendo «—» dentro de su tarjeta, como desde junio.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { LayoutGrid, RotateCcw, ChevronUp, ChevronDown, X, Check, AlertTriangle, MapPin } from 'lucide-react'

import { useIsMobile } from '../useIsMobile'
import { useApp } from '../../context/AppContext'
import { useLocationScope } from '../../modules/multitenancy/hooks/useLocationScope'
import {
  getHomeCatalog, catalogoDisponible, resolverMosaico, agrupadoPorModulo,
  mover, alternar, type CatalogEntry,
} from './homeCatalog'
import { LAYOUT_POR_DEFECTO } from './cards/shellCards'
import { HomeMetricsProvider } from './cards/HomeMetricsProvider'
import {
  getGating, getUserLayout, getRoleDefault, saveUserLayout, restoreUserLayout,
} from './homeLayoutService'

const INK = 'var(--color-accent)'
const MUTED = 'var(--color-text-secondary)'

interface HomeGeneralProps {
  userName?: string
  onOpenModule?: (moduleId: string) => void
}

function greeting(): string {
  const h = new Date().getHours()
  if (h < 6) return 'Buenas noches'
  if (h < 14) return 'Buenos días'
  if (h < 21) return 'Buenas tardes'
  return 'Buenas noches'
}
function todayLabel(): string {
  return new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })
}
function hora(d: Date): string {
  return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
}

/** De dónde viene el mosaico que se está viendo. Se dice, no se adivina. */
type Origen = 'usuario' | 'rol' | 'fabrica'
const ORIGEN_TEXTO: Record<Origen, string> = {
  usuario: 'tu Inicio',
  rol: 'el Inicio por defecto de tu rol',
  fabrica: 'el Inicio por defecto',
}

export default function HomeGeneral({ userName, onOpenModule }: HomeGeneralProps) {
  const isMobile = useIsMobile()
  const { activeAccountId, authUserId, roleInActiveAccount } = useApp()
  const { resolvedLocationId, isConsolidated } = useLocationScope()

  const catalogo = useMemo(() => getHomeCatalog(), [])

  const [disponibles, setDisponibles] = useState<CatalogEntry[]>([])
  const [claves, setClaves] = useState<string[]>(LAYOUT_POR_DEFECTO)
  const [origen, setOrigen] = useState<Origen>('fabrica')
  const [cargadoA, setCargadoA] = useState<Date | null>(null)
  // `cargando` se DERIVA de si lo cargado corresponde al alcance actual, en vez
  // de asignarse al empezar el efecto. Además de no dejar un setState síncrono
  // en el cuerpo del efecto, quita el instante en el que la pantalla enseñaría
  // el mosaico de la cuenta anterior como si fuera el de la nueva.
  const [cargadoPara, setCargadoPara] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [cajonAbierto, setCajonAbierto] = useState(false)
  const [guardando, setGuardando] = useState(false)

  const alcance = `${activeAccountId ?? '-'}|${authUserId ?? '-'}|${roleInActiveAccount ?? '-'}`
  // Sin cuenta no hay nada que cargar, así que tampoco se está cargando: se
  // deriva en vez de marcarlo, y el efecto se puede ir sin tocar estado.
  const cargando = activeAccountId != null && cargadoPara !== alcance

  const cargar = useCallback(async () => {
    if (!activeAccountId) return
    try {
      const [{ espejo, porCuenta }, delUsuario] = await Promise.all([
        getGating(activeAccountId),
        authUserId ? getUserLayout(activeAccountId, authUserId) : Promise.resolve(null),
      ])
      const disp = catalogoDisponible(catalogo, espejo, porCuenta, roleInActiveAccount)
      setDisponibles(disp)

      if (delUsuario && delUsuario.length > 0) {
        setClaves(delUsuario); setOrigen('usuario')
      } else {
        const delRol = roleInActiveAccount
          ? await getRoleDefault(activeAccountId, roleInActiveAccount)
          : null
        if (delRol && delRol.length > 0) { setClaves(delRol); setOrigen('rol') }
        else { setClaves(LAYOUT_POR_DEFECTO); setOrigen('fabrica') }
      }
      setCargadoA(new Date())
      setError(null)   // solo cuando se sabe que la recarga ha funcionado
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar tu Inicio.')
    } finally {
      setCargadoPara(alcance)
    }
  }, [activeAccountId, authUserId, roleInActiveAccount, catalogo, alcance])

  useEffect(() => { void cargar() }, [cargar])

  const { tarjetas, huerfanas } = useMemo(
    () => resolverMosaico(claves, disponibles), [claves, disponibles],
  )
  const grupos = useMemo(() => agrupadoPorModulo(disponibles), [disponibles])

  /** Guarda y lo DICE. Si falla, no se da por bueno (regla 8). */
  async function guardar(nuevas: string[], queSeHizo: string) {
    const antes = claves
    setClaves(nuevas)                       // respuesta inmediata al toque
    if (!activeAccountId || !authUserId) return
    setGuardando(true); setError(null); setAviso(null)
    try {
      await saveUserLayout(activeAccountId, authUserId, nuevas)
      setOrigen('usuario')
      setAviso(queSeHizo)
    } catch (e) {
      setClaves(antes)                      // no entró: se vuelve a lo que había
      setError(e instanceof Error ? e.message : 'No se pudo guardar tu Inicio.')
    } finally {
      setGuardando(false)
    }
  }

  async function restaurar() {
    if (!activeAccountId || !authUserId) return
    setGuardando(true); setError(null); setAviso(null)
    try {
      await restoreUserLayout(activeAccountId, authUserId)
      setCargadoPara(null)
      await cargar()
      setAviso('Inicio restaurado. Vuelves al que trae tu rol por defecto.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo restaurar tu Inicio.')
    } finally {
      setGuardando(false)
    }
  }

  const saludo = userName ? `${greeting()}, ${userName}` : greeting()
  const cols = isMobile ? 2 : 4
  const span = (s: CatalogEntry['size']) => (s === 'lg' ? cols : s === 'md' ? Math.min(2, cols) : 1)

  return (
    <HomeMetricsProvider accountId={activeAccountId} locationId={resolvedLocationId}>
      {/* ══ FRANJA DE ESTADO ══
          Alcance y frescura de todo lo de abajo. Un mosaico configurable sin
          esto es un montón de cifras sin decir de qué son ni de cuándo. */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <div style={{ flex: '1 1 240px' }}>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.75rem', color: INK, margin: '0 0 2px', fontWeight: 500 }}>
            {saludo}
          </h1>
          <p style={{ fontSize: '0.875rem', color: MUTED, margin: 0, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span>{todayLabel()}</span>
            <span aria-hidden>·</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <MapPin size={13} /> {isConsolidated ? 'todos los locales' : 'este local'}
            </span>
            <span aria-hidden>·</span>
            <span>
              {cargando ? 'cargando…' : cargadoA ? `datos de las ${hora(cargadoA)}` : 'sin datos'}
            </span>
            <span aria-hidden>·</span>
            <span>{ORIGEN_TEXTO[origen]}</span>
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={() => setCajonAbierto(true)} disabled={cargando}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border border-border-default bg-card text-text-primary hover:bg-page disabled:opacity-50">
            <LayoutGrid size={16} /> Personalizar
          </button>
          {origen === 'usuario' && (
            <button type="button" onClick={() => void restaurar()} disabled={guardando}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border border-border-default bg-card text-text-secondary hover:bg-page disabled:opacity-50">
              <RotateCcw size={16} /> Restaurar
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-3 p-3 rounded-md bg-danger-bg text-danger border border-danger/20 text-sm flex items-start gap-2">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" /> {error}
        </div>
      )}
      {aviso && (
        <div className="mb-3 p-3 rounded-md bg-success-bg text-text-primary border border-success/20 text-sm flex items-start gap-2">
          <Check size={16} className="text-success shrink-0 mt-0.5" />
          <span className="flex-1">{aviso}</span>
          <button type="button" onClick={() => setAviso(null)} className="text-xs font-medium text-text-secondary hover:text-text-primary">Vale</button>
        </div>
      )}

      {/* Una tarjeta guardada que ya no existe en el código NO se pinta —la BBDD
          no puede inventar una tarjeta— pero tampoco se calla (regla 7). */}
      {huerfanas.length > 0 && (
        <div className="mb-3 p-3 rounded-md bg-warning-bg border border-warning/30 text-sm text-text-primary flex items-start gap-2 flex-wrap">
          <AlertTriangle size={16} className="shrink-0 mt-0.5 text-warning" />
          <span className="flex-1">
            {huerfanas.length === 1 ? 'Una tarjeta que tenías' : `${huerfanas.length} tarjetas que tenías`} ya no
            {huerfanas.length === 1 ? ' existe' : ' existen'} ({huerfanas.join(', ')}). No se pintan porque nadie
            sabe ya dibujarlas.
          </span>
          <button type="button" disabled={guardando}
            onClick={() => void guardar(claves.filter(k => !huerfanas.includes(k)), 'Quitadas las tarjetas que ya no existen.')}
            className="shrink-0 px-2.5 py-1 rounded-md text-xs font-semibold border border-border-default bg-card hover:bg-page disabled:opacity-50">
            Quitarlas de mi Inicio
          </button>
        </div>
      )}

      {/* ══ MOSAICO ══ */}
      {tarjetas.length === 0 && !cargando ? (
        <div className="rounded-xl border border-dashed border-border-default p-8 text-center text-text-secondary">
          <p className="text-sm">Tu Inicio está vacío.</p>
          <button type="button" onClick={() => setCajonAbierto(true)}
            className="mt-2 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-accent text-text-on-accent">
            <LayoutGrid size={16} /> Elegir tarjetas
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 12, alignItems: 'start' }}>
          {tarjetas.map(c => {
            const Card = c.component
            return (
              <div key={c.key} style={{ gridColumn: `span ${span(c.size)}` }}>
                <Card
                  accountId={activeAccountId}
                  locationId={resolvedLocationId}
                  onDrill={c.drillRoute ? () => onOpenModule?.(c.moduleId) : undefined}
                />
              </div>
            )
          })}
        </div>
      )}

      {/* ══ CAJÓN «PERSONALIZAR» ══ agrupado por módulo, que es como el usuario
          entiende de dónde sale cada cosa. */}
      {cajonAbierto && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={() => setCajonAbierto(false)}>
          <div className="w-full max-w-md h-full bg-card overflow-y-auto shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 bg-card border-b border-border-default px-4 py-3 flex items-center gap-2">
              <LayoutGrid size={17} className="text-text-secondary" />
              <h2 className="text-base font-semibold text-text-primary flex-1">Personalizar mi Inicio</h2>
              <button type="button" onClick={() => setCajonAbierto(false)} className="text-text-secondary hover:text-text-primary">
                <X size={18} />
              </button>
            </div>

            {/* Lo que tienes puesto, EN ORDEN, con subir y bajar. */}
            <div className="px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary mb-2">
                En tu Inicio ({tarjetas.length})
              </p>
              {tarjetas.length === 0 ? (
                <p className="text-sm text-text-secondary">Ninguna. Elige abajo.</p>
              ) : (
                <div className="flex flex-col gap-1">
                  {tarjetas.map((c, i) => (
                    <div key={c.key} className="flex items-center gap-2 px-2.5 py-2 rounded-lg border border-border-default">
                      <span className="text-sm text-text-primary flex-1 truncate">{c.title}</span>
                      <span className="text-[11px] text-text-secondary shrink-0">{c.moduleName}</span>
                      <button type="button" disabled={i === 0 || guardando} title="Subir"
                        onClick={() => void guardar(mover(claves, c.key, 'arriba'), `«${c.title}» sube una posición.`)}
                        className="p-1 rounded text-text-secondary hover:text-text-primary disabled:opacity-30">
                        <ChevronUp size={16} />
                      </button>
                      <button type="button" disabled={i === tarjetas.length - 1 || guardando} title="Bajar"
                        onClick={() => void guardar(mover(claves, c.key, 'abajo'), `«${c.title}» baja una posición.`)}
                        className="p-1 rounded text-text-secondary hover:text-text-primary disabled:opacity-30">
                        <ChevronDown size={16} />
                      </button>
                      <button type="button" disabled={guardando} title="Quitar"
                        onClick={() => void guardar(alternar(claves, c.key), `«${c.title}» quitada de tu Inicio.`)}
                        className="p-1 rounded text-text-secondary hover:text-danger disabled:opacity-30">
                        <X size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* El catálogo entero, agrupado por módulo. Añadir una homeCard a un
                módulo la hace aparecer AQUÍ sin tocar el Inicio. */}
            <div className="px-4 pb-6">
              <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary mb-2">
                Todas las tarjetas
              </p>
              {grupos.map(g => (
                <div key={g.moduleId} className="mb-3">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-text-secondary mb-1">{g.moduleName}</p>
                  <div className="flex flex-col gap-1">
                    {g.tarjetas.map(c => {
                      const puesta = claves.includes(c.key)
                      return (
                        <button key={c.key} type="button" disabled={guardando}
                          onClick={() => void guardar(
                            alternar(claves, c.key),
                            puesta ? `«${c.title}» quitada de tu Inicio.` : `«${c.title}» añadida al final de tu Inicio.`,
                          )}
                          className={`flex items-center gap-2 text-left px-2.5 py-2 rounded-lg border disabled:opacity-50 ${puesta ? 'border-accent bg-accent-bg' : 'border-border-default hover:bg-page'}`}>
                          <span className={`w-4 h-4 rounded border grid place-items-center shrink-0 ${puesta ? 'bg-accent border-accent' : 'border-border-default'}`}>
                            {puesta && <Check size={11} className="text-text-on-accent" />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm text-text-primary truncate">{c.title}</span>
                            {c.description && <span className="block text-[11px] text-text-secondary truncate">{c.description}</span>}
                          </span>
                          {c.drillRoute && (
                            <span
                              role="link" tabIndex={0}
                              onClick={e => { e.stopPropagation(); onOpenModule?.(c.moduleId) }}
                              onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); onOpenModule?.(c.moduleId) } }}
                              className="text-[11px] text-text-secondary underline shrink-0 cursor-pointer">
                              ver
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </HomeMetricsProvider>
  )
}
