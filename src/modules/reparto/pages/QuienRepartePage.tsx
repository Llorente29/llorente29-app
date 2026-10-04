// src/modules/reparto/pages/QuienRepartePage.tsx
//
// R02 · Ajustes › Reparto › «Quién reparte». Maqueta docs/reparto/maquetas/r02
// (R1Reparto v2). Estilo nuevo (guía del C00): es la primera pantalla de Cocina
// con él y no se adapta al viejo.
//
//   · Marcas en filas, plataformas en columnas; arriba de cada grupo, «Si no
//     dices nada» (la herencia por tipo de marca: propias y cedidas).
//   · Cada celda, «Plataforma | Nosotros»: azul relleno si lo decidió alguien;
//     contorno gris y «hereda» si viene de «Si no dices nada»; punto ámbar «!»
//     si en esa celda llegan pedidos «propios» sin dirección.
//   · Se guarda al tocar, dice qué ha guardado y a qué se aplica, y tiene
//     «Deshacer» (regla 8). Si falla, lo dice EN la celda y vuelve a lo de antes.
//   · «por local»: las tiendas que se separan; se abre solo si hay alguna.
//   · A la derecha, «Qué ve la cocina» y lo que propone Folvy.
//   · Móvil: una tarjeta por marca con las plataformas en vertical (reparto.css).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import '@/modules/conta/estilo'
import '../reparto.css'
import { BloqueIA, Chip, ErrorConReintento, Inicial, TarjetaCargando } from '@/modules/conta/ui/piezas'
import EtiquetaReparto from '../components/EtiquetaReparto'
import {
  TODOS_LOS_LOCALES, esDecidida, localesQueSeSeparan, resolver, resolverHerencia,
  type Celda, type QuienReparte, type Resolucion, type TipoDeMarca,
} from '../lib/resolucion'
import {
  cargarQuienReparte, claveCelda, guardarCelda, guardarHerencia, nombreCorto, responderSugerencia,
  type DatosQuienReparte, type Marca,
} from '../services/quienReparteService'

type Cambio =
  | { tipo: 'celda'; brandId: string; channelSlug: string; locationId: string | null; antes: Celda | null }
  | { tipo: 'herencia'; tipoMarca: TipoDeMarca; channelSlug: string; antes: QuienReparte }

const iniciales = (nombre: string) =>
  nombre.split(/\s+/).filter(p => /^[\p{L}\p{N}]/u.test(p)).slice(0, 2).map(p => p[0]!.toUpperCase()).join('') || '·'

export default function QuienRepartePage() {
  const { activeAccountId } = useActiveAccount()
  const [datos, setDatos] = useState<DatosQuienReparte | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState<string | null>(null)
  const [errorCelda, setErrorCelda] = useState<Record<string, string>>({})
  const [aviso, setAviso] = useState<{ texto: string; tono: 'ok' | 'aviso' } | null>(null)
  const [ultimo, setUltimo] = useState<Cambio | null>(null)
  const [abiertas, setAbiertas] = useState<Set<string>>(new Set())
  const [respuestaIA, setRespuestaIA] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    if (!activeAccountId) return
    setError(null)
    try { setDatos(await cargarQuienReparte(activeAccountId)) }
    catch (e) { setError(e instanceof Error ? e.message : 'No se ha podido cargar quién reparte.') }
  }, [activeAccountId])
  useEffect(() => { void cargar() }, [cargar])

  const marcasPorTipo = useMemo(() => {
    const m = datos?.marcas ?? []
    return { own: m.filter(x => x.ownershipType === 'own'), licensed: m.filter(x => x.ownershipType === 'licensed') }
  }, [datos])

  if (!activeAccountId) return null
  if (error) return <div className="cx cx-rp"><ErrorConReintento mensaje={error} reintentar={cargar} /></div>
  if (!datos) return <div className="cx cx-rp"><TarjetaCargando /></div>

  const d = datos
  const columnas = d.plataformas.length || 1
  const nombreMarca = (id: string) => d.marcas.find(m => m.id === id)?.nombre ?? 'esta marca'
  const nombrePlat = (slug: string) => d.plataformas.find(p => p.slug === slug)?.nombre ?? slug

  async function tocarCelda(marca: Marca, slug: string, locationId: string | null, valor: QuienReparte) {
    const clave = `${marca.id}|${slug}|${locationId ?? ''}`
    const loc = locationId ?? TODOS_LOS_LOCALES
    const antes = d.celdas.find(c => c.brandId === marca.id && c.channelSlug === slug && c.locationId === loc) ?? null
    const actual = resolver(d.celdas, d.herencias, marca, slug, locationId)
    if (actual.deliveryBy === valor && esDecidida(actual) && (actual.nivel === 'local') === Boolean(locationId)) return
    setGuardando(clave); setErrorCelda(e => { const n = { ...e }; delete n[clave]; return n })
    try {
      await guardarCelda({ accountId: activeAccountId!, brandId: marca.id, channelSlug: slug, locationId, deliveryBy: valor })
      setUltimo({ tipo: 'celda', brandId: marca.id, channelSlug: slug, locationId, antes })
      const donde = locationId ? ` en ${d.locales.find(l => l.id === locationId)?.nombre ?? 'ese local'}` : ''
      const quien = valor === 'own' ? 'Nosotros' : `la reparte ${nombreCorto(slug)}`
      const cedida = marca.ownershipType === 'licensed' && valor === 'own'
      setAviso({
        tono: cedida ? 'aviso' : 'ok',
        texto: `Guardado: ${marca.nombre} en ${nombrePlat(slug)}${donde} → ${quien}. Se aplica a los pedidos siguientes; los que ya están abiertos no cambian.`
          + (cedida ? ' Ojo: es una marca cedida, y a las cedidas normalmente las reparte la plataforma.' : ''),
      })
      await cargar()
    } catch (e) {
      setErrorCelda(x => ({ ...x, [clave]: e instanceof Error ? e.message : 'No se ha guardado.' }))
    } finally { setGuardando(null) }
  }

  async function tocarHerencia(tipo: TipoDeMarca, slug: string, valor: QuienReparte) {
    const clave = `herencia|${tipo}|${slug}`
    const antes = resolverHerencia(d.herencias, tipo, slug, null).deliveryBy
    if (antes === valor && d.herencias.some(h => h.channelSlug === slug && h.ownershipType === tipo && h.locationId === null)) return
    setGuardando(clave)
    try {
      await guardarHerencia({ accountId: activeAccountId!, channelSlug: slug, tipo, locationId: null, deliveryBy: valor })
      setUltimo({ tipo: 'herencia', tipoMarca: tipo, channelSlug: slug, antes })
      const cuantas = (tipo === 'own' ? marcasPorTipo.own : marcasPorTipo.licensed)
        .filter(m => !esDecidida(resolver(d.celdas, d.herencias, m, slug, null))).length
      setAviso({
        tono: tipo === 'licensed' && valor === 'own' ? 'aviso' : 'ok',
        texto: `Guardado: si no dices nada, las marcas ${tipo === 'own' ? 'propias' : 'cedidas'} en ${nombrePlat(slug)} → `
          + `${valor === 'own' ? 'Nosotros' : `la reparte ${nombreCorto(slug)}`}. Afecta a ${cuantas} ${cuantas === 1 ? 'marca' : 'marcas'} en gris; `
          + 'se aplica a los pedidos siguientes.'
          + (tipo === 'licensed' && valor === 'own' ? ' Ojo: a las cedidas normalmente las reparte la plataforma.' : ''),
      })
      await cargar()
    } catch (e) {
      setErrorCelda(x => ({ ...x, [clave]: e instanceof Error ? e.message : 'No se ha guardado.' }))
    } finally { setGuardando(null) }
  }

  async function deshacer() {
    if (!ultimo) return
    try {
      if (ultimo.tipo === 'celda') {
        await guardarCelda({
          accountId: activeAccountId!, brandId: ultimo.brandId, channelSlug: ultimo.channelSlug,
          locationId: ultimo.locationId, deliveryBy: ultimo.antes?.deliveryBy ?? null,
        })
        setAviso({ tono: 'ok', texto: `Deshecho: ${nombreMarca(ultimo.brandId)} en ${nombrePlat(ultimo.channelSlug)} vuelve a ${ultimo.antes ? (ultimo.antes.deliveryBy === 'own' ? '«Nosotros»' : '«Plataforma»') : 'heredar'}.` })
      } else {
        await guardarHerencia({ accountId: activeAccountId!, channelSlug: ultimo.channelSlug, tipo: ultimo.tipoMarca, locationId: null, deliveryBy: ultimo.antes })
        setAviso({ tono: 'ok', texto: `Deshecho: «Si no dices nada» de las ${ultimo.tipoMarca === 'own' ? 'propias' : 'cedidas'} en ${nombrePlat(ultimo.channelSlug)} vuelve a ${ultimo.antes === 'own' ? '«Nosotros»' : '«Plataforma»'}.` })
      }
      setUltimo(null)
      await cargar()
    } catch (e) {
      setAviso({ tono: 'aviso', texto: e instanceof Error ? e.message : 'No se ha podido deshacer.' })
    }
  }

  async function responder(s: DatosQuienReparte['sugerencias'][number], aceptar: boolean) {
    try {
      setRespuestaIA(await responderSugerencia({
        accountId: activeAccountId!, brandId: s.brandId, channelSlug: s.channelSlug, lastSaleId: s.lastSaleId, aceptar,
      }))
      await cargar()
    } catch (e) {
      setRespuestaIA(e instanceof Error ? e.message : 'No se ha podido responder.')
    }
  }

  const fila = (marca: Marca) => {
    const separados = new Set(d.plataformas.flatMap(p => localesQueSeSeparan(d.celdas, marca.id, p.slug)))
    const abierta = abiertas.has(marca.id) || separados.size > 0
    const apoyo = marca.ownershipType === 'own'
      ? `Marca propia · ${d.locales.length} ${d.locales.length === 1 ? 'local' : 'locales'}`
      : 'Marca cedida'
    return (
      <div key={marca.id}>
        <div role="row" className="cx-rp-fila" data-testid={`fila-${marca.nombre}`}>
          <div className="cx-rp-marca">
            <Inicial texto={iniciales(marca.nombre)} />
            <div style={{ minWidth: 0 }}>
              <div className="cx-rp-marca-nombre">{marca.nombre}</div>
              <div className="cx-rp-marca-apoyo">
                {apoyo}
                {d.locales.length > 1 && (<> · <button type="button" className="cx-rp-enlace" aria-expanded={abierta}
                  onClick={() => setAbiertas(a => { const n = new Set(a); if (n.has(marca.id)) n.delete(marca.id); else n.add(marca.id); return n })}>
                  por local</button></>)}
              </div>
            </div>
          </div>
          {d.plataformas.map(p => (
            <CeldaQuien key={p.slug} plataforma={p.nombre}
              r={resolver(d.celdas, d.herencias, marca, p.slug, null)}
              aviso={(d.sinDireccion[claveCelda(marca.id, p.slug)] ?? 0) > 0}
              avisoTexto={`${d.sinDireccion[claveCelda(marca.id, p.slug)] ?? 0} pedidos «propios» sin dirección en 7 días: ${nombrePlat(p.slug)} no manda la dirección en esta tienda`}
              ocupada={guardando === `${marca.id}|${p.slug}|`}
              error={errorCelda[`${marca.id}|${p.slug}|`] ?? null}
              etiqueta={`${marca.nombre} en ${p.nombre}`}
              onElegir={v => tocarCelda(marca, p.slug, null, v)} />
          ))}
        </div>
        {abierta && d.locales.map(l => (
          <div role="row" key={l.id} className="cx-rp-fila cx-rp-fila-local" data-testid={`fila-${marca.nombre}-${l.nombre}`}>
            <div className="cx-rp-marca-apoyo">{l.nombre}</div>
            {d.plataformas.map(p => {
              const r = resolver(d.celdas, d.herencias, marca, p.slug, l.id)
              return (
                <CeldaQuien key={p.slug} plataforma={p.nombre} r={r} aviso={false}
                  heredaTexto={r.nivel === 'local' ? undefined : 'como la marca'}
                  ocupada={guardando === `${marca.id}|${p.slug}|${l.id}`}
                  error={errorCelda[`${marca.id}|${p.slug}|${l.id}`] ?? null}
                  etiqueta={`${marca.nombre} en ${p.nombre}, ${l.nombre}`}
                  decididaSoloSiNivel="local"
                  onElegir={v => tocarCelda(marca, p.slug, l.id, v)} />
              )
            })}
          </div>
        ))}
      </div>
    )
  }

  const filaHerencia = (tipo: TipoDeMarca) => (
    <div role="row" className="cx-rp-fila cx-rp-fila-herencia" data-testid={`herencia-${tipo}`}>
      <div>
        <div className="cx-rp-marca-nombre">Si no dices nada</div>
        <div className="cx-rp-marca-apoyo">{tipo === 'own'
          ? 'Marcas propias · se aplica a las celdas en gris'
          : 'Marcas cedidas · las reparte la plataforma'}</div>
      </div>
      {d.plataformas.map(p => {
        const h = resolverHerencia(d.herencias, tipo, p.slug, null)
        return (
          <CeldaQuien key={p.slug} plataforma={p.nombre}
            r={{ deliveryBy: h.deliveryBy, source: 'manual', nivel: 'marca', celda: null }}
            aviso={false} ocupada={guardando === `herencia|${tipo}|${p.slug}`}
            error={errorCelda[`herencia|${tipo}|${p.slug}`] ?? null}
            etiqueta={`Si no dices nada, marcas ${tipo === 'own' ? 'propias' : 'cedidas'} en ${p.nombre}`}
            onElegir={v => tocarHerencia(tipo, p.slug, v)} />
        )
      })}
    </div>
  )

  // «Qué ve la cocina»: tres ejemplos con marcas de la cuenta.
  const ejemplo = (pred: (r: Resolucion) => boolean) => {
    for (const m of d.marcas) for (const p of d.plataformas) {
      const r = resolver(d.celdas, d.herencias, m, p.slug, null)
      if (pred(r)) return { marca: m.nombre, plataforma: p.nombre, slug: p.slug }
    }
    return null
  }
  const exPlat = ejemplo(r => r.deliveryBy === 'platform')
  const exOwn = ejemplo(r => r.deliveryBy === 'own')

  return (
    <div className="cx cx-rp" style={{ ['--cx-rp-columnas' as string]: columnas } as React.CSSProperties}>
      <header className="cx-rp-cabeza">
        <div>
          <span className="cx-rp-miga">Ajustes › Reparto</span>
          <h1 className="cx-rp-titulo">Quién reparte</h1>
        </div>
        <Chip tono="ia">Se guarda al tocar</Chip>
      </header>
      <p className="cx-rp-intro">
        Para cada marca y plataforma, quién lleva el pedido a casa. «Nosotros» = Folvy lo manda a Catcher con la
        dirección; «Plataforma» = lo reparte Glovo, Uber o Just Eat y Folvy no hace nada.
      </p>

      <div className="cx-rp-cuerpo">
        <div className="cx-rp-izq">
          <section className="cx-rp-tabla" role="table" aria-label="Quién reparte cada marca en cada plataforma">
            <div role="row" className="cx-rp-fila cx-rp-fila-cabeza">
              <span className="cx-rp-col cx-rp-col-marca">MARCA</span>
              {d.plataformas.map(p => (
                <div key={p.slug} className="cx-rp-col">
                  <div className="cx-rp-col-nombre">{p.nombre}</div>
                  <div className="cx-rp-col-ayuda">dirección solo si la tienda está como «reparto propio»</div>
                </div>
              ))}
            </div>
            {filaHerencia('own')}
            {marcasPorTipo.own.map(fila)}
            {(marcasPorTipo.licensed.length > 0 || d.herencias.some(h => h.ownershipType === 'licensed')) && filaHerencia('licensed')}
            {marcasPorTipo.licensed.map(fila)}
            <div className="cx-rp-pie">
              <span><span className="cx-rp-muestra cx-rp-muestra-decidida" />Lo has decidido tú</span>
              <span><span className="cx-rp-muestra cx-rp-muestra-heredada" />Hereda de «Si no dices nada»</span>
              <span><span className="cx-rp-muestra cx-rp-muestra-aviso" />Aviso: la plataforma no manda la dirección en esta tienda</span>
              <span className="cx-rp-hueco" />
              <span>Se guarda al tocar{ultimo && <> · <button type="button" className="cx-rp-enlace" onClick={deshacer}>Deshacer</button></>}</span>
            </div>
          </section>
          <div role="status" aria-live="polite">
            {aviso && <div className={`cx-rp-guardado${aviso.tono === 'aviso' ? ' cx-rp-guardado-aviso' : ''}`}>{aviso.texto}</div>}
          </div>
        </div>

        <aside className="cx-rp-der">
          <h2>Qué ve la cocina</h2>
          <span className="cx-rp-apoyo">El reparto nunca pinta el pedido en rojo. La cocina cocina; lo del reparto va en su propia etiqueta.</span>
          {exPlat && <Ejemplo numero="#705" donde={`${exPlat.marca} · ${exPlat.plataforma}`}
            pedido={{ service_type: 'platform_delivery', channel: exPlat.plataforma, delivery_address: null }} />}
          {exOwn && <Ejemplo numero="#118" donde={`${exOwn.marca} · ${exOwn.plataforma}`}
            pedido={{ service_type: 'own_delivery', channel: exOwn.plataforma, delivery_address: 'Calle', carrier_code: 'catcher', has_courier: true, rider_name: 'Ana llega 12:40' }} />}
          {exOwn && <Ejemplo numero="#112" donde={`${exOwn.marca} · ${exOwn.plataforma}`}
            pedido={{ service_type: 'own_delivery', channel: exOwn.plataforma, delivery_address: null }} />}

          {d.sugerencias.map(s => (
            <BloqueIA key={`${s.brandId}|${s.channelSlug}|${s.lastSaleId}`}
              titulo={`En ${nombreCorto(s.channelSlug)}, ${s.marca} lleva ${s.pedidos} pedidos seguidos sin dirección.`}
              porque={<>Parece que en {s.channelSlug === 'uber' ? 'Uber Eats Manager' : nombrePlat(s.channelSlug)} la tienda está como «reparto de {nombreCorto(s.channelSlug)}». ¿La paso a «Plataforma» aquí? <span className="cx-rp-apoyo">(pedidos {s.codigos.join(', ')})</span></>}
              acciones={<>
                <button type="button" className="cx-boton" onClick={() => responder(s, true)}>Sí, la reparte {nombreCorto(s.channelSlug)}</button>
                <button type="button" className="cx-boton-sec" onClick={() => responder(s, false)}>No, lo arreglo en {nombreCorto(s.channelSlug)}</button>
              </>} />
          ))}
          <div role="status" aria-live="polite">{respuestaIA && <div className="cx-rp-guardado">{respuestaIA}</div>}</div>

          {d.respondidas.length > 0 && (
            <section className="cx-rp-folvy" aria-label="Lo que ha hecho Folvy">
              <h3>Lo que ha hecho Folvy</h3>
              <ul>
                {d.respondidas.map(r => (
                  <li key={r.id}>
                    <b>{r.status === 'accepted' ? 'Aceptado' : 'No aceptado'}</b> · {nombreMarca(r.brandId)} en {nombrePlat(r.channelSlug)} · {new Date(r.answeredAt).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    {r.answeredByName ? ` · ${r.answeredByName}` : ''}<br />{r.reason}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </div>
  )
}

function CeldaQuien({
  plataforma, r, aviso, avisoTexto, ocupada, error, etiqueta, onElegir, heredaTexto = 'hereda', decididaSoloSiNivel,
}: {
  plataforma: string; r: Resolucion; aviso: boolean; avisoTexto?: string; ocupada: boolean; error: string | null
  etiqueta: string; onElegir: (v: QuienReparte) => void; heredaTexto?: string; decididaSoloSiNivel?: 'local'
}) {
  const decidida = decididaSoloSiNivel ? r.nivel === decididaSoloSiNivel : esDecidida(r)
  const clase = decidida ? 'cx-rp-decidida' : 'cx-rp-heredada'
  return (
    <div className="cx-rp-celda" role="cell">
      <span className="cx-rp-celda-plataforma">{plataforma}</span>
      <div className="cx-rp-seg" role="group" aria-label={etiqueta} data-valor={r.deliveryBy} data-decidida={decidida}>
        <button type="button" aria-pressed={r.deliveryBy === 'platform'} className={r.deliveryBy === 'platform' ? clase : undefined}
          disabled={ocupada} onClick={() => onElegir('platform')}>Plataforma</button>
        <button type="button" aria-pressed={r.deliveryBy === 'own'} className={r.deliveryBy === 'own' ? clase : undefined}
          disabled={ocupada} onClick={() => onElegir('own')}>Nosotros</button>
        {aviso && <span className="cx-rp-aviso" title={avisoTexto} aria-label={avisoTexto}>!</span>}
      </div>
      {!decidida && <span className="cx-rp-hereda">{heredaTexto}</span>}
      {error && <span className="cx-rp-celda-error" role="alert">{error}</span>}
    </div>
  )
}

function Ejemplo({ numero, donde, pedido }: {
  numero: string; donde: string
  pedido: { service_type: string; channel: string; delivery_address: string | null; carrier_code?: string; has_courier?: boolean; rider_name?: string }
}) {
  return (
    <div className="cx-rp-pedido">
      <div className="cx-rp-pedido-cabeza">
        <span className="cx-rp-pedido-numero">{numero}</span>
        <span className="cx-rp-pedido-donde">{donde}</span>
      </div>
      <EtiquetaReparto franja={false} pedido={{
        sale_id: numero, service_type: pedido.service_type, delivery_address: pedido.delivery_address, channel: pedido.channel,
        carrier_code: pedido.carrier_code ?? null, has_courier: pedido.has_courier ?? null, rider_name: pedido.rider_name ?? null,
        delivery_state: null, dispatch_mode: 'auto', dispatch_error: null,
      }} />
    </div>
  )
}
