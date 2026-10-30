// src/modules/conta/bancos/BancosPage.tsx
//
// B01 · Bancos. S02 · PR 2: con el patrón único de pantallas. Sus páginas
// (Movimientos · Cuentas y extractos · Reglas) las pone el mapa en la barra (en
// el móvil, en el cajón), y CADA página pinta su encabezado (EncabezadoPagina):
// migas del mapa, su título, una frase con lo que se ve, UN principal azul
// —«Subir extracto»—, como mucho dos blancos y lo demás en «Más acciones ▾»
// (bancos/acciones.ts dice cuáles en cada página). Al pintarlo, el marco ya no
// pone su fila de acciones de serie: nada sale dos veces.
//   · «Tus bancos: BBVA ▾» (el selector del patrón) sale solo en Movimientos,
//     la única página que es de UN banco. Lista todos los bancos con sus dudas:
//     se acabó «y N más» (regla 7: el menú no esconde ninguno).
//   · El mes, en la cabecera con BotonPeriodo, solo donde se lee (Movimientos
//     y «Lo que he hecho»): decisión de Julio, 22/10.
//   · En el móvil, el principal abajo, bajo el pulgar (BotonPulgar).
// Se fue la portada por niveles del móvil (PortadaMovil): con las páginas en el
// cajón, el principal bajo el pulgar y Movimientos abriendo en «Para
// confirmar», enseñaba lo mismo que Movimientos con otra forma (sus dos cifras,
// la frase, las píldoras de los bancos y los apartados), y era la única pantalla
// que se saltaba el patrón.
// El cierre del mes del banco se mudó a Contabilidad › Cierre y Registro ›
// Cerrar el mes (al lado del de la contabilidad): bancos/cierre lleva allí.
//
// El gesto único (respuesta 3, punto 2): un extracto se puede SOLTAR en
// cualquier pantalla de Bancos; abre «Subir extracto» con él.
//
// Lo que no funciona no se enseña (respuestas 3 y 4): ni «Por correo», ni
// «Conectar» (llega con el contrato del agregador), ni tarjetas de crédito, ni
// la barra «Pregunta o pide algo» mientras solo diga «Muy pronto».
//
// El agente «Conciliación» (tarea 6): si hoy aún no ha pasado, la primera vez
// que alguien abre Bancos hace la pasada del día (con las guardas de siempre).

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { rutaBancos } from '@/config/navegacion'
import { mirarFicheros, tomarFicheros } from '@/modules/conta/puerta/entregas'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useIsMobile } from '@/shell/useIsMobile'
import { ErrorConReintento, Hueso, Vacio } from '@/modules/conta/ui/piezas'
import { hoyEnMadrid } from '@/modules/conta/lib/formato'
import { useLeerConservando } from '@/modules/conta/bancos/useLeerConservando'
import { estadoBanco, mesesElegibles, nombreCorto, nombreMes, ultimosIban } from '@/modules/conta/lib/bancosVista'
import { agenteTocaHoy, leerDatosBancos, leerHechos, pasarAgente } from '@/modules/conta/services/bancosPantallas'
import { refrescarCuentasMenu } from '@/modules/conta/marco/useCuentasMenu'
import { BancosCtx, type ContextoBancos } from '@/modules/conta/bancos/contexto'
import {
  PESTANA_CIERRE_ANTIGUA, bancoInicial, destinoDelCierre, encabezadoDe, leeElBanco, leeElMes, mesInicial, resolverVista, type VistaBancos,
} from '@/modules/conta/bancos/navegacion'
import { accionesDeLaPagina, type AccionBancos } from '@/modules/conta/bancos/acciones'
import { BotonPeriodo } from '@/modules/conta/marco/BotonPeriodo'
import { nombreDelMes } from '@/modules/conta/marco/periodo'
import { PeriodoEnBarra } from '@/modules/conta/ui/marco/PeriodoEnBarra'
import { BotonPulgar, EncabezadoPagina } from '@/modules/conta/marco/EncabezadoPagina'
import { BotonDeAccion, SelectorDePagina } from '@/modules/conta/marco/MasAcciones'
import type { Accion, GrupoDeAcciones, Selector } from '@/modules/conta/marco/acciones'
import { Boton } from '@/modules/conta/diseno'
import { Movimientos } from '@/modules/conta/bancos/Movimientos'
import { Reglas } from '@/modules/conta/bancos/Reglas'
import { CuentasYExtractos } from '@/modules/conta/bancos/CuentasYExtractos'
import { SubirExtracto } from '@/modules/conta/bancos/SubirExtracto'
import { HechoPorFolvy } from '@/modules/conta/bancos/HechoPorFolvy'
import { ACCION_NUEVO, PARAM_NUEVO, VALOR_NUEVO } from '@/modules/conta/bancos/bancoNuevo'
import { HECHO_POR, LO_HECHO } from '@/modules/conta/bancos/marca'

function contenido(v: VistaBancos): ReactNode {
  switch (v) {
    case 'movimientos': return <Movimientos />
    case 'reglas': return <Reglas />
    case 'cuentas': return <CuentasYExtractos />
    case 'subir': return <SubirExtracto />
    case 'hecho': return <HechoPorFolvy />
  }
}

export default function BancosPage() {
  const params = useParams()
  const { search } = useLocation()
  // La dirección de antes del cierre del mes: lleva a Contabilidad › Cierre y Registro, con su mes y su banco.
  if (params.pestana === PESTANA_CIERRE_ANTIGUA) return <Navigate to={destinoDelCierre(search)} replace />
  return <Bancos />
}

function Bancos() {
  const { accountId, cargando, userName } = useCuentaConta()
  const { pathname } = useLocation()
  const { activa } = useEmpresas()
  const movil = useIsMobile()
  const params = useParams()
  const [query, setQuery] = useSearchParams()
  const navegar = useNavigate()
  const [vuelta, setVuelta] = useState(0)
  // V02 · El extracto que la puerta deja para Bancos se abre en «Subir extracto», por su camino de siempre.
  const [archivo, setArchivo] = useState<File | null>(() => mirarFicheros('bancos')[0] ?? null)
  useEffect(() => { tomarFicheros('bancos') }, [])
  const [soltando, setSoltando] = useState(false)
  const vista = resolverVista(params.pestana)
  const hoy = hoyEnMadrid()

  const ambito = `${accountId}:${activa?.id}`
  const datos = useLeerConservando(accountId && activa ? () => leerDatosBancos(accountId, activa.id) : null, ambito, String(vuelta))
  const meses = useMemo(() => mesesElegibles(datos.datos?.primerMovimiento ?? null, hoy), [datos.datos, hoy])
  const bancos = datos.datos?.bancos ?? []
  // S01e: sin ?banco ni ?mes, se abre donde hay movimientos (el banco y el mes de su último extracto).
  const banco = bancos.find((b) => b.id === query.get('banco')) ?? bancoInicial(bancos, datos.datos?.dudas ?? {})
  // S01d · El banco, fijo en la dirección: si no, al validar cambian las dudas y al recargar
  // bancoInicial elegía otro banco («Validar y siguiente» saltaba de banco).
  const bancoFijo = banco?.id ?? null
  useEffect(() => {
    if (bancoFijo && !query.get('banco')) setQuery((p) => { const q = new URLSearchParams(p); q.set('banco', bancoFijo); return q }, { replace: true })
  }, [bancoFijo, query, setQuery])
  const mes = meses.includes(query.get('mes') ?? '') ? query.get('mes')! : mesInicial(meses, banco, hoy)
  const hechos = useLeerConservando(accountId && activa ? () => leerHechos(accountId, activa.id, mes) : null, ambito, `${mes}:${vuelta}`)
  // Lo casado solo que sigue vivo: lo deshecho ya no es «hecho por Folvy».
  const casadosSolos = (hechos.datos ?? []).filter((h) => h.porQuien === 'folvy' && h.accion === 'casado' && h.casadoVivo).length

  // La pasada del día del agente: una vez por empresa y visita, si hoy no ha corrido.
  const pasadaHecha = useRef<string | null>(null)
  const [pasando, setPasando] = useState(false)
  useEffect(() => {
    if (!accountId || !activa || pasadaHecha.current === activa.id) return
    pasadaHecha.current = activa.id
    let vivo = true
    agenteTocaHoy(activa.id).then(async (toca) => {
      if (!toca || !vivo) return
      setPasando(true)
      try { await pasarAgente(accountId, activa.id, hoy, 'diario'); refrescarCuentasMenu() } catch (e) { console.error('[bancos] la pasada del día no se ha podido hacer', e) }
      if (vivo) { setPasando(false); setVuelta((v) => v + 1) }
    }, (e: unknown) => console.error('[bancos] no sé si toca la pasada del día', e))
    return () => { vivo = false }
  }, [accountId, activa, hoy])

  const conQuery = useCallback((ruta: string, cambios: Record<string, string | null> = {}) => {
    const p = new URLSearchParams(query)
    for (const [k, v] of Object.entries(cambios)) { if (v === null) p.delete(k); else p.set(k, v) }
    const q = p.toString()
    return q ? `${ruta}?${q}` : ruta
  }, [query])

  const ctx: ContextoBancos | null = useMemo(() => (accountId && activa && datos.datos ? {
    accountId, companyId: activa.id, quien: userName ?? null, movil, hoy, datos: datos.datos, banco, mes,
    elegirBanco: (id: string) => { const p = new URLSearchParams(query); p.set('banco', id); setQuery(p, { replace: true }) },
    subir: (f?: File) => { if (f) setArchivo(f); navegar(conQuery(rutaBancos('subir'))) },
    archivo, tomarArchivo: () => { const f = archivo; setArchivo(null); return f },
    vuelta, recargar: () => setVuelta((v) => v + 1),
  } : null), [accountId, activa, datos.datos, banco, mes, movil, hoy, userName, query, setQuery, navegar, conQuery, archivo, vuelta])

  // El gesto único: soltar el fichero en cualquier sitio de Bancos.
  const alArrastrar = (e: DragEvent) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setSoltando(true) } }
  const alSoltar = (e: DragEvent) => {
    e.preventDefault(); setSoltando(false)
    const f = e.dataTransfer.files?.[0]
    if (f && ctx) ctx.subir(f)
  }

  const enc = encabezadoDe(vista, { banco, mes })
  // Mientras carga o falla, el encabezado ya está (con su título): la página no salta al llegar los datos.
  const encabezado = (cuerpo: ReactNode) => (
    <div className="s-pagina cxb-pagina">
      <EncabezadoPagina titulo={enc.titulo} frase={enc.frase} migasExtra={enc.migasExtra} />
      {cuerpo}
    </div>
  )
  if (!accountId && !cargando) return encabezado(<Vacio titulo="No hay cuenta activa." explicacion="Elige una cuenta para ver sus bancos." />)
  if (datos.error) return encabezado(<ErrorConReintento mensaje={datos.error} reintentar={datos.recargar} />)
  if (!ctx) return encabezado(<div className="cx-tarjeta" aria-busy="true" aria-label="Cargando los bancos">{[0, 1, 2].map((i) => <Hueso key={i} alto={40} />)}</div>)

  // Las acciones de la página, con lo que se sabe de cada una (sus números y avisos).
  const resolver = (a: AccionBancos): Accion => {
    switch (a) {
      // Un botón (abre el diálogo aquí mismo, por la dirección: ?nuevo=banco), no un enlace a otra página.
      case 'nuevo-banco': return { id: a, etiqueta: ACCION_NUEVO, alPulsar: () => navegar(conQuery(rutaBancos('cuentas'), { [PARAM_NUEVO]: VALOR_NUEVO }), { replace: true }), dato: 'Un banco o una tarjeta que aún no está en el plan', grupo: 'Tus bancos' }
      case 'casados': return {
        id: a, etiqueta: HECHO_POR, a: conQuery(rutaBancos(), { ver: 'casados', mov: null }), numero: casadosSolos,
        dato: `${casadosSolos} en ${nombreMes(mes).toLowerCase()}, en todos tus bancos`, grupo: 'Lo automático',
      }
      case 'reglas': return {
        id: a, etiqueta: 'Reglas', a: conQuery(rutaBancos('reglas'), { ver: null, mov: null }), numero: ctx.datos.reglas.activas,
        aviso: ctx.datos.reglas.nuevas > 0, dato: ctx.datos.reglas.nuevas ? `${ctx.datos.reglas.nuevas} nuevas para decidir` : 'Lo que se hace siempre igual', grupo: 'Lo automático',
      }
      case 'hecho': return { id: a, etiqueta: LO_HECHO, a: conQuery(rutaBancos('hecho'), { ver: null, mov: null }), dato: 'Todo lo que he hecho solo, con su porqué y «Deshacer»', grupo: 'Lo automático' }
    }
  }
  const reparto = accionesDeLaPagina(vista, movil)
  const blancos = reparto.blancos.map(resolver)
  // Dentro de «Más acciones», cada una con el título de su grupo (el patrón: ahí, y solo ahí).
  const mas: GrupoDeAcciones[] = []
  for (const a of reparto.mas.map(resolver)) {
    const g = mas.find((x) => x.titulo === a.grupo)
    if (g) g.acciones.push(a); else mas.push({ titulo: a.grupo, acciones: [a] })
  }

  // «Tus bancos: BBVA ▾»: todos, con sus dudas (el de ámbar pide algo).
  const selector: Selector | null = leeElBanco(vista) && bancos.length > 0 ? (() => {
    const acciones: Accion[] = bancos.map((b) => {
      const dudas = ctx.datos.dudas[b.id] ?? 0
      const e = estadoBanco(dudas, !!b.ultimoExtracto)
      const u = ultimosIban(b.iban)
      return {
        id: b.id, etiqueta: nombreCorto(b), a: conQuery(pathname, { banco: b.id, mov: null }), actual: b.id === banco?.id,
        aviso: e.tono === 'ambar', numero: dudas || undefined, dato: `${b.nombre}${u ? ` · ···${u}` : ''} · ${e.texto}`, grupo: 'Tus bancos',
      }
    })
    return { titulo: 'Tus bancos', actual: acciones.find((a) => a.actual) ?? null, opciones: [{ titulo: 'Tus bancos', acciones }] }
  })() : null

  const principal = reparto.principal
    ? <Boton variante="principal" icono="subir" onClick={() => ctx.subir()}>Subir extracto</Boton>
    : null

  return (
    <BancosCtx.Provider value={ctx}>
      <div className="s-pagina cxb-pagina" onDragOver={alArrastrar} onDragLeave={(e) => { if (e.currentTarget === e.target) setSoltando(false) }} onDrop={alSoltar}>
        <EncabezadoPagina
          titulo={enc.titulo}
          frase={enc.frase}
          migasExtra={enc.migasExtra}
          derecha={selector && <SelectorDePagina s={selector} />}
          secundarios={blancos.length > 0 && <>{blancos.map((a) => <BotonDeAccion key={a.id} a={a} />)}</>}
          masAcciones={mas}
          principal={principal}
        />
        {leeElMes(vista) && (
          // S02 · El periodo, con el mismo control y el mismo formato que en todas las páginas que lo leen.
          <PeriodoEnBarra>
            <BotonPeriodo tipo="mes" valor={mes} opciones={meses.map((m) => ({ valor: m, etiqueta: nombreDelMes(m) }))}
              alCambiar={(v) => { const p = new URLSearchParams(query); p.set('mes', v); p.delete('mov'); setQuery(p, { replace: true }) }} />
          </PeriodoEnBarra>
        )}

        {hechos.error && <div className="cx-error" role="alert">{hechos.error}</div>}
        <div key={vista}>{contenido(vista)}</div>

        {principal && <BotonPulgar>{principal}</BotonPulgar>}

        {soltando && (
          <div className="cxb-soltar" aria-hidden="true">
            <div className="cxb-soltar-caja">
              <strong>Suelta aquí el extracto</strong>
              <span>Norma 43 o Excel, de una cuenta o de varias. Lo leo, lo cuadro y te digo a qué cuenta va cada una.</span>
            </div>
          </div>
        )}
        {pasando && <div className="cx-ayuda" role="status">Haciendo la pasada del día: miro los movimientos pendientes…</div>}
      </div>
    </BancosCtx.Provider>
  )
}
