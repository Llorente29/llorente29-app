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
// HAY DOS FRANJAS, y son cosas distintas a propósito:
//   · ATENCIÓN (atencionService) — lo que hay que hacer: conteos sin cerrar,
//     tablets mudas, cuadrantes sin publicar. SOLO aparece cuando hay algo; si
//     no hay nada no ocupa sitio y NO dice «todo bien». El silencio es el
//     estado normal, y un «todo correcto» diario enseña a no mirarla.
//   · PROCEDENCIA — la de abajo. Siempre visible.
//
// LA FRANJA DE PROCEDENCIA dice el ALCANCE y la FRESCURA de lo que hay debajo:
// de qué local son los números, de cuándo son, y si el mosaico es el tuyo o el
// defecto. Sin eso, un mosaico configurable es un montón de cifras sin decir
// de qué son. NO inventa estado de negocio: lo que no tiene fuente sigue
// diciendo «—» dentro de su tarjeta, como desde junio.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LayoutGrid, RotateCcw, ChevronUp, ChevronDown, X, Check, AlertTriangle, MapPin, ClipboardList, TabletSmartphone, CalendarClock, Sparkles, Plus } from 'lucide-react'

import { useIsMobile } from '../useIsMobile'
import { useApp } from '../../context/AppContext'
import { useLocationScope } from '../../modules/multitenancy/hooks/useLocationScope'
import {
  getHomeCatalog, catalogoDisponible, resolverMosaico, agrupadoPorGrupo, novedades,
  mover, alternar, type CatalogEntry,
} from './homeCatalog'
import { LAYOUT_POR_DEFECTO, TARJETAS_RETIRADAS, nombreDeTarjetaRetirada } from './cards/shellCards'
import { enumeraNombres } from '../../lib/texto'
import { construyeUrl } from './drill'
import { HomeMetricsProvider } from './cards/HomeMetricsProvider'
import {
  getGating, getUserLayout, getRoleDefault, saveUserLayout, restoreUserLayout,
  getDescartadas,
  descartarNovedad,
} from './homeLayoutService'
import { getAvisosAtencion, type AvisoAtencion, type TipoAviso } from './atencionService'
import TarjetaP2 from './widgets/TarjetaP2'

const INK = 'var(--color-accent)'
const MUTED = 'var(--color-text-secondary)'

interface HomeGeneralProps {
  userName?: string
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

const ICONO_AVISO: Record<TipoAviso, typeof ClipboardList> = {
  conteo: ClipboardList,
  tablet: TabletSmartphone,
  cuadrante: CalendarClock,
}

/** De dónde viene el mosaico que se está viendo. Se dice, no se adivina. */
type Origen = 'usuario' | 'rol' | 'fabrica'
const ORIGEN_TEXTO: Record<Origen, string> = {
  usuario: 'tu Inicio',
  rol: 'el Inicio por defecto de tu rol',
  fabrica: 'el Inicio por defecto',
}

// (02/09) YA NO RECIBE `onOpenModule`. Navegaba por ID DE MÓDULO, y el id de
// las tarjetas del shell es 'shell', que no existe en el registro: el click no
// hacía nada. El Inicio navega ahora por RUTA (drill.ts), que es un dato que se
// puede pegar en la barra del navegador y comprobar. Se quita la prop en vez de
// dejarla sin usar: una puerta tapiada que sigue teniendo pomo se vuelve a abrir.
export default function HomeGeneral({ userName }: HomeGeneralProps) {
  const isMobile = useIsMobile()
  const { activeAccountId, authUserId, roleInActiveAccount } = useApp()
  const { resolvedLocationId, isConsolidated } = useLocationScope()

  const catalogo = useMemo(() => getHomeCatalog(), [])

  const [disponibles, setDisponibles] = useState<CatalogEntry[]>([])
  const [claves, setClaves] = useState<string[]>(LAYOUT_POR_DEFECTO)
  /** Las novedades que este usuario ya rechazó. Se declara aquí, con los demás
   *  estados, porque `cargar()` la rellena y usarla antes de declararla deja de
   *  actualizarse cuando cambia. */
  const [descartadas, setDescartadas] = useState<string[]>([])
  const [origen, setOrigen] = useState<Origen>('fabrica')
  const [cargadoA, setCargadoA] = useState<Date | null>(null)
  // `cargando` se DERIVA de si lo cargado corresponde al alcance actual, en vez
  // de asignarse al empezar el efecto. Además de no dejar un setState síncrono
  // en el cuerpo del efecto, quita el instante en el que la pantalla enseñaría
  // el mosaico de la cuenta anterior como si fuera el de la nueva.
  const [cargadoPara, setCargadoPara] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [avisos, setAvisos] = useState<AvisoAtencion[]>([])
  const [cajonAbierto, setCajonAbierto] = useState(false)
  const [guardando, setGuardando] = useState(false)

  const navigate = useNavigate()
  const alcance = `${activeAccountId ?? '-'}|${authUserId ?? '-'}|${roleInActiveAccount ?? '-'}|${resolvedLocationId ?? 'todos'}`
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
      // Lo que este usuario ya dijo que NO quiere que se le vuelva a ofrecer.
      if (authUserId) setDescartadas(await getDescartadas(activeAccountId, authUserId))
      setAvisos(await getAvisosAtencion(activeAccountId, resolvedLocationId))
      setCargadoA(new Date())
      setError(null)   // solo cuando se sabe que la recarga ha funcionado
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar tu Inicio.')
    } finally {
      setCargadoPara(alcance)
    }
  }, [activeAccountId, authUserId, roleInActiveAccount, catalogo, alcance, resolvedLocationId])

  useEffect(() => { void cargar() }, [cargar])

  const { tarjetas, huerfanas } = useMemo(
    () => resolverMosaico(claves, disponibles), [claves, disponibles],
  )
  const grupos = useMemo(() => agrupadoPorGrupo(disponibles), [disponibles])

  // ── NOVEDADES: LO QUE HA LLEGADO Y NO TIENES ─────────────────────────────
  // El aviso de huérfanas sabía hablar de lo que SE FUE. Ésta es su simétrica.
  // Sin ella, un layout personalizado deja fuera para siempre cada tarjeta que
  // se añada: quien más ha usado el producto es quien deja de ver lo nuevo.
  const nuevas = useMemo(
    () => novedades(claves, disponibles, descartadas), [claves, disponibles, descartadas],
  )

  // El PORQUÉ de las retiradas, en una frase. Si todas comparten motivo —el
  // caso normal, porque se retiran por lotes— se dice una vez en vez de repetir
  // «no tenía fuente de datos» tres veces. Y no se dice «nadie sabe dibujarlas»,
  // que suena a avería del programa cuando fue una decisión de producto.
  const motivoDeRetirada = useMemo(() => {
    const motivos = [...new Set(huerfanas.map(k => TARJETAS_RETIRADAS[k]?.motivo).filter(Boolean))]
    if (motivos.length === 1) return `${motivos[0]} y se retiraron hasta cablearlas`
    if (motivos.length > 1) return `${enumeraNombres(motivos as string[])}, y se retiraron hasta cablearlas`
    // Sin lápida no se inventa una explicación: se dice lo único que se sabe.
    return 'se retiraron del catálogo'
  }, [huerfanas])

  /** Guarda y lo DICE. Si falla, no se da por bueno (regla 8). */
  async function guardar(siguientes: string[], queSeHizo: string) {
    const antes = claves
    setClaves(siguientes)                   // respuesta inmediata al toque
    // GARANTÍA (e): sin cuenta o sin usuario NO se puede escribir, así que la
    // pantalla vuelve a lo que había y lo dice. Antes se quedaba movida y
    // volvía en silencio: el usuario veía su cambio hecho y no se había
    // guardado nada. Un éxito silencioso que además era falso.
    if (!activeAccountId || !authUserId) {
      setClaves(antes)
      setError('No se ha guardado: no hay sesión o cuenta activa. Vuelve a entrar e inténtalo.')
      return
    }
    setGuardando(true); setError(null); setAviso(null)
    try {
      await saveUserLayout(activeAccountId, authUserId, siguientes)
      // Añadir una tarjeta la saca de las descartadas: si la pides, deja de
      // ser algo que dijiste que no querías.
      setDescartadas(d => d.filter(k => !siguientes.includes(k)))
      setOrigen('usuario')
      setAviso(queSeHizo)
    } catch (e) {
      // No entró: la pantalla vuelve a lo que hay en la BASE, no se queda
      // optimista. Enseñar el cambio después de que la escritura falle es
      // exactamente cómo alguien cierra el navegador creyendo que guardó.
      setClaves(antes)
      setError(e instanceof Error
        ? `No se ha guardado tu Inicio: ${e.message}`
        : 'No se ha guardado tu Inicio.')
    } finally {
      setGuardando(false)
    }
  }

  /**
   * «No, gracias» a las novedades.
   *
   * SE RECUERDA, y esa es la decisión importante: si no, el aviso reaparece en
   * cada carga y a la tercera se ignora — y con él se ignora el de huérfanas,
   * que sí importa. Un aviso que no se puede apagar enseña a no leer los avisos.
   */
  async function rechazarNovedades() {
    if (!activeAccountId || !authUserId) {
      setError('No se ha guardado: no hay sesión o cuenta activa. Vuelve a entrar e inténtalo.')
      return
    }
    const claveS = nuevas.map(c => c.key)
    setDescartadas(d => [...d, ...claveS])   // respuesta inmediata al toque
    setGuardando(true); setError(null); setAviso(null)
    try {
      for (const k of claveS) {
        await descartarNovedad(activeAccountId, authUserId, k, claves)
      }
      setAviso(claveS.length === 1
        ? 'No se volverá a ofrecer. Sigue en «Personalizar» si cambias de idea.'
        : 'No se volverán a ofrecer. Siguen en «Personalizar» si cambias de idea.')
    } catch (e) {
      setDescartadas(d => d.filter(k => !claveS.includes(k)))   // no entró
      setError(e instanceof Error ? e.message : 'No se pudo guardar.')
    } finally {
      setGuardando(false)
    }
  }

  async function restaurar() {
    if (!activeAccountId || !authUserId) {
      setError('No se ha restaurado: no hay sesión o cuenta activa. Vuelve a entrar e inténtalo.')
      return
    }
    setGuardando(true); setError(null); setAviso(null)
    try {
      await restoreUserLayout(activeAccountId, authUserId)
      setCargadoPara(null)
      await cargar()
      // Con CONTENIDO: cuántas tarjetas tienes ahora. «Restaurado» a secas
      // obliga a mirar la pantalla para saber si pasó algo.
      setAviso(`Inicio restaurado: vuelves al que trae tu rol por defecto.`)
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
      {/* ══ FRANJA DE ATENCIÓN ══
          Una franja, no cinco banners. Solo si hay algo: sin avisos no se
          pinta nada, y no existe el caso «todo bien».
          Regla 7: se listan TODOS. Si hay cinco, dice cinco — nunca «y 3 más»,
          porque la franja ordena y etiqueta, no decide qué existe. */}
      {avisos.length > 0 && (
        <div className="mb-4 rounded-xl border border-warning/40 bg-warning-bg overflow-hidden">
          <div className="px-4 py-2 border-b border-warning/25 flex items-center gap-2">
            <AlertTriangle size={15} className="text-warning shrink-0" />
            <span className="text-[12px] font-bold uppercase tracking-wide text-text-primary">
              {avisos.length === 1 ? 'Una cosa pide atención' : `${avisos.length} cosas piden atención`}
            </span>
          </div>
          <ul className="divide-y divide-warning/20">
            {avisos.map(a => {
              const Icono = ICONO_AVISO[a.tipo]
              return (
                <li key={a.id}>
                  <button type="button" onClick={() => navigate(a.ruta)}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left hover:bg-warning/10 transition-colors">
                    <Icono size={15} className="text-text-secondary shrink-0" />
                    <span className="text-[13.5px] text-text-primary flex-1 min-w-0">{a.texto}</span>
                    <span className="text-[12px] font-semibold text-accent shrink-0">Resolver →</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {/* ══ FRANJA DE PROCEDENCIA ══
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
            {nuevas.length > 0 && (
              // El contador cuenta lo NO descartado: si dijiste que no a una,
              // no vuelve a contar. Un contador que no baja deja de mirarse.
              <span className="ml-1 px-1.5 py-0.5 rounded-full text-[11px] font-bold bg-accent text-text-on-accent">
                {nuevas.length} {nuevas.length === 1 ? 'nueva' : 'nuevas'}
              </span>
            )}
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
            {enumeraNombres(huerfanas.map(nombreDeTarjetaRetirada))}{' '}
            {huerfanas.length === 1 ? 'ya no está' : 'ya no están'} en tu Inicio:{' '}
            {motivoDeRetirada}. {huerfanas.length === 1 ? 'Volverá' : 'Volverán'} al cajón cuando{' '}
            {huerfanas.length === 1 ? 'se cablee' : 'se cableen'}.
          </span>
          <button type="button" disabled={guardando}
            onClick={() => void guardar(claves.filter(k => !huerfanas.includes(k)), 'Quitadas de tu Inicio.')}
            className="shrink-0 px-2.5 py-1 rounded-md text-xs font-semibold border border-border-default bg-card hover:bg-page disabled:opacity-50">
            Quitarlas de mi Inicio
          </button>
        </div>
      )}

      {/* La simétrica del aviso de huérfanas: lo que HA LLEGADO. Se ofrece, no
          se impone — un layout personalizado es del usuario— pero no se calla,
          porque callarlo es como una tarjeta nueva se vuelve invisible justo
          para quien más usa el producto. */}
      {nuevas.length > 0 && (
        <div className="mb-3 p-3 rounded-md bg-card border border-accent/40 text-sm text-text-primary flex items-start gap-2 flex-wrap">
          <Sparkles size={16} className="shrink-0 mt-0.5 text-accent" />
          <span className="flex-1">
            {enumeraNombres(nuevas.map(c => c.title))}{' '}
            {nuevas.length === 1 ? 'es nueva y no la tienes' : 'son nuevas y no las tienes'}{' '}
            en tu Inicio.
          </span>
          <button type="button" disabled={guardando}
            onClick={() => void guardar(
              [...claves, ...nuevas.map(c => c.key)],
              nuevas.length === 1 ? 'Añadida al final de tu Inicio.' : `${nuevas.length} añadidas al final de tu Inicio.`,
            )}
            className="shrink-0 px-2.5 py-1 rounded-md text-xs font-semibold bg-accent text-text-on-accent disabled:opacity-50">
            {nuevas.length === 1 ? 'Añadirla' : 'Añadirlas'}
          </button>
          <button type="button" disabled={guardando}
            onClick={() => void rechazarNovedades()}
            className="shrink-0 px-2.5 py-1 rounded-md text-xs font-semibold border border-border-default bg-card hover:bg-page disabled:opacity-50">
            No, gracias
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
          {/* LA FANTASMA. Ocupa una celda al final del mosaico y no finge ser
              una tarjeta: es un hueco punteado que dice a dónde lleva. Sin
              ella, la única puerta al cajón es un botón en la esquina de
              arriba, que es donde no está mirando quien acaba de recorrer sus
              tarjetas y piensa «me falta una». */}
          {tarjetas.map(c => {
            const Card = c.component
            return (
              <div key={c.key} style={{ gridColumn: `span ${span(c.size)}` }}>
                {/* Sin componente = P2: prometida y aún sin cablear. Se pinta
                    el hueco punteado, que dice que el dato no existe TODAVÍA —
                    no un «—», que se leería como «hoy no hay nada». */}
                {Card ? (
                  <Card
                    accountId={activeAccountId}
                    locationId={resolvedLocationId}
                    drillTo={c.drill ? (d) => navigate(construyeUrl(d)) : undefined}
                  />
                ) : (
                  <TarjetaP2 titulo={c.title} />
                )}
              </div>
            )
          })}

          <button
            type="button"
            onClick={() => setCajonAbierto(true)}
            style={{ gridColumn: 'span 1', minHeight: 120 }}
            className="rounded-xl border border-dashed border-border-default text-text-secondary hover:text-text-primary hover:border-accent/60 flex flex-col items-center justify-center gap-1.5 text-sm"
          >
            <Plus size={18} />
            Añadir tarjeta
            {nuevas.length > 0 && (
              <span className="text-[11px] font-semibold text-accent">
                {nuevas.length} {nuevas.length === 1 ? 'nueva disponible' : 'nuevas disponibles'}
              </span>
            )}
          </button>
        </div>
      )}

      {/* ══ CAJÓN «PERSONALIZAR» ══ agrupado por GRUPO DE NEGOCIO —Ventas,
          Team, Cocina, Almacén, Canales, Agentes— que es el idioma con el que
          se habla del negocio, no el nombre de nuestros módulos. */}
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
                      {c.component == null ? (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-page text-text-secondary shrink-0">P2</span>
                      ) : (
                        <span className="text-[11px] text-text-secondary shrink-0">{c.grupo ?? c.moduleName}</span>
                      )}
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

            {/* El catálogo entero, agrupado por GRUPO DE NEGOCIO: Ventas,
                Team, Cocina, Almacén, Canales, Agentes. Añadir una homeCard a
                un módulo la hace aparecer AQUÍ sin tocar el Inicio. */}
            <div className="px-4 pb-6">
              <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary mb-2">
                Todas las tarjetas
              </p>
              {grupos.map(g => (
                <div key={g.grupo} className="mb-3">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-text-secondary mb-1">{g.grupo}</p>
                  <div className="flex flex-col gap-1">
                    {g.tarjetas.map(c => {
                      const puesta = claves.includes(c.key)
                      const esPromesa = c.component == null
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
                            <span className="block text-sm text-text-primary truncate">
                              {c.title}
                              {/* La etiqueta gris de la maqueta. Va junto al
                                  nombre y no en un rincón: quien lee el título
                                  tiene que enterarse ahí mismo de que todavía
                                  no da dato, no después de marcarla. */}
                              {esPromesa && (
                                <span className="ml-1.5 align-middle text-[10px] font-bold px-1.5 py-0.5 rounded bg-page text-text-secondary">
                                  P2
                                </span>
                              )}
                            </span>
                            {c.description && <span className="block text-[11px] text-text-secondary truncate">{c.description}</span>}
                          </span>
                          {c.drill && (
                            <span
                              role="link" tabIndex={0}
                              onClick={e => { e.stopPropagation(); navigate(c.drill!.ruta) }}
                              onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); navigate(c.drill!.ruta) } }}
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
