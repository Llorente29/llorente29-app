// src/modules/multitenancy/components/brands/BrandCartaTab.tsx
//
// F01 · PR 3 · tablero 3: «Las recetas que faltan, en la ficha de la marca».
// Arriba, cuántas faltan y «Subir mis recetas» (Excel, PDF o foto, con la
// lectura de Cocina: Folvy las lee y las enseña para confirmar antes de
// guardar). Cada plato se puede hacer a mano («Hacer receta»). Lo vendido sin
// receta no se pierde: descuenta almacén en cuanto la pones, solo, sin botón
// «Recasar» (nunca por debajo del último recuento cerrado, regla 6, y se dice).
// Cada acción confirma con lo que ha hecho o falla en pantalla (regla 8).

import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Brand } from '../../../../types/multitenancy'
import RecipeImportReviewModal from '@/modules/kitchen/components/RecipeImportReviewModal'
import { extractRecipeSession, type ExtractedRecipeSession } from '@/modules/kitchen/services/recipeImportService'
import { euros } from '../../lib/cambiosCarta'
import {
  fraseColocadas, fraseRecetaGuardada, pistaProgreso, platoParaLectura, porcentaje, progreso, subtituloMarca,
  type CartaMarca, type PlatoCarta,
} from '../../lib/cartaMarca'
import { fechaCorta } from '../../lib/marcasLast'
import { colocarRecetas, destinoLectura, leerCartaMarca, prepararReceta } from '../../services/cartaMarcaService'
import './altaMarcaLast.css'

interface Props {
  brand: Brand
  onBrandChange: (updated: Brand) => void
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))
/** Cuántos platos se ven antes de «Ver todos» (la maqueta: los que faltan, primero). */
const PRIMEROS = 8
const ACEPTA = '.pdf,.xlsx,.xls,.csv,.docx,image/*'

interface Lectura { fichero: File; sesion: ExtractedRecipeSession | null; platoId: string; error: string | null }

export default function BrandCartaTab({ brand }: Props) {
  const accountId = brand.accountId
  const navigate = useNavigate()
  const [carta, setCarta] = useState<CartaMarca | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [vuelta, setVuelta] = useState(0)
  const [hecho, setHecho] = useState<{ ok: boolean; texto: string }[]>([])
  const [todos, setTodos] = useState(false)
  const [ocupado, setOcupado] = useState<string | null>(null)
  // «Subir mis recetas»: los ficheros que faltan por leer y el que se está confirmando.
  const [cola, setCola] = useState<File[]>([])
  const [lectura, setLectura] = useState<Lectura | null>(null)
  const [revisando, setRevisando] = useState<{ sesion: ExtractedRecipeSession; plato: PlatoCarta } | null>(null)
  const fichero = useRef<HTMLInputElement>(null)
  const colocando = useRef(false)

  const decir = (ok: boolean, texto: string) => setHecho((h) => [...h, { ok, texto }])

  useEffect(() => {
    let vivo = true
    leerCartaMarca(accountId, brand.id)
      .then((c) => { if (vivo) { setCarta(c); setError(null) } })
      .catch((e: unknown) => { if (vivo) setError(msg(e)) })
    return () => { vivo = false }
  }, [accountId, brand.id, vuelta])

  // Recetas puestas desde otro sitio (Cocina) y aún sin colocar: se colocan al
  // abrir la carta, y se dice (sin botón «Recasar»).
  useEffect(() => {
    if (!carta || carta.porColocar === 0 || colocando.current) return
    colocando.current = true
    colocarRecetas(accountId)
      .then((r) => { setHecho((h) => [...h, { ok: true, texto: `Recetas puestas: ${fraseColocadas(r)}` }]); setVuelta((v) => v + 1) })
      .catch((e: unknown) => setHecho((h) => [...h, { ok: false, texto: `No se ha podido colocar lo vendido: ${msg(e)}` }]))
      .finally(() => { colocando.current = false })
  }, [accountId, carta])

  const hacerReceta = async (p: PlatoCarta) => {
    setOcupado(p.id); setHecho([])
    try {
      const r = await prepararReceta(accountId, p.id)
      navigate(`/kitchen/recetas?recipe=${encodeURIComponent(r.recipeItemId)}&tab=escandallo`)
    } catch (e) {
      decir(false, `No se ha podido abrir la receta de ${p.nombre}: ${msg(e)}`)
      setOcupado(null)
    }
  }

  // ── «Subir mis recetas» ──────────────────────────────────────────────────
  const leerSiguiente = useCallback(async (pendientes: File[], c: CartaMarca) => {
    const [primero, ...resto] = pendientes
    setCola(resto)
    if (!primero) { setLectura(null); setVuelta((v) => v + 1); return }
    setLectura({ fichero: primero, sesion: null, platoId: '', error: null })
    try {
      const sesion = await extractRecipeSession(accountId, primero, { brandHint: c.marca.nombre })
      const plato = platoParaLectura(sesion.dishName, c.platos)
      setLectura({ fichero: primero, sesion, platoId: plato?.id ?? '', error: null })
    } catch (e) {
      setLectura({ fichero: primero, sesion: null, platoId: '', error: msg(e) })
    }
  }, [accountId])

  const elegirFicheros = (lista: FileList | null) => {
    if (!lista || !carta || lista.length === 0) return
    setHecho([])
    void leerSiguiente(Array.from(lista), carta)
    if (fichero.current) fichero.current.value = ''
  }

  const seguir = async () => {
    if (!lectura?.sesion || !carta) return
    const plato = carta.platos.find((p) => p.id === lectura.platoId)
    if (!plato) return
    setOcupado('lectura')
    try {
      await destinoLectura(accountId, lectura.sesion.sessionId, plato.id)
      setRevisando({ sesion: lectura.sesion, plato })
    } catch (e) {
      setLectura({ ...lectura, error: `No se ha podido apuntar la lectura a ${plato.nombre}: ${msg(e)}` })
    } finally {
      setOcupado(null)
    }
  }

  const guardada = async (plato: PlatoCarta, recipeId: string, lineas: number) => {
    setRevisando(null)
    try {
      decir(true, fraseRecetaGuardada(plato.nombre, lineas, await colocarRecetas(accountId, recipeId)))
    } catch (e) {
      decir(false, `Receta de ${plato.nombre} guardada, pero no se ha podido colocar lo vendido: ${msg(e)}`)
    }
    if (carta) void leerSiguiente(cola, carta)
  }

  if (error) return <p className="ml-error" role="alert">No se ha podido leer la carta de {brand.name}: {error}</p>
  if (!carta) return <p className="ml-cargando" aria-busy="true">Leyendo la carta de {brand.name}…</p>

  const canales = carta.marca.canales
  const visibles = todos ? carta.platos : carta.platos.slice(0, PRIMEROS)
  const sinReceta = carta.platos.filter((p) => p.estado === 'sin_receta')

  return (
    <div className="cc-pagina rc-carta" data-prueba="carta-marca">
      <p className="cc-sub rc-sub">{subtituloMarca(carta)}</p>
      {hecho.map((h, i) => (
        <div key={i} className={h.ok ? 'ml-hecho' : 'ml-error'} role={h.ok ? 'status' : 'alert'} data-prueba="carta-hecho">{h.texto}</div>
      ))}

      <div className="rc-progreso" data-completa={carta.resumen.sinReceta === 0 ? 'si' : undefined}>
        <div className="rc-fila">
          <b data-prueba="carta-progreso">{progreso(carta)}</b>
          {sinReceta.length > 0 && (
            <>
              <button type="button" className="ml-boton" data-principal="si" disabled={!!ocupado || !!lectura || !!revisando}
                onClick={() => fichero.current?.click()}>Subir mis recetas</button>
              <input ref={fichero} type="file" accept={ACEPTA} multiple hidden aria-label="Ficheros de recetas"
                data-prueba="subir-recetas" onChange={(e) => elegirFicheros(e.target.files)} />
            </>
          )}
        </div>
        <div className="rc-barra" aria-hidden><i style={{ width: `${porcentaje(carta)}%` }} /></div>
        {pistaProgreso(carta) && <span className="ml-pista">{pistaProgreso(carta)}</span>}
        {carta.colocadas.length > 0 && (
          <span className="ml-pista" data-prueba="carta-colocadas">
            Esta semana: {carta.colocadas.map((c) => `${c.plato}, ${c.colocadas === 1 ? '1 venta colocada' : `${c.colocadas} ventas colocadas`}${c.colocadaAt ? ` (${fechaCorta(c.colocadaAt)})` : ''}`).join(' · ')}.
          </span>
        )}
      </div>

      {lectura && (
        <div className="rc-lectura" role="group" aria-label="Receta leída" data-prueba="receta-leida">
          {!lectura.sesion && !lectura.error && <p className="ml-cargando" aria-busy="true">Leyendo {lectura.fichero.name}…</p>}
          {lectura.error && (
            <>
              <p className="ml-error" role="alert">{lectura.fichero.name}: {lectura.error}</p>
              <div className="cc-acciones">
                <button type="button" className="ml-boton" onClick={() => void leerSiguiente(cola, carta)}>{cola.length ? 'Seguir con el siguiente' : 'Cerrar'}</button>
              </div>
            </>
          )}
          {lectura.sesion && !lectura.error && (
            <>
              <p className="rc-leido">He leído <b>«{lectura.sesion.dishName}»</b> en {lectura.fichero.name}: {lectura.sesion.lines.length === 1 ? '1 ingrediente' : `${lectura.sesion.lines.length} ingredientes`}.</p>
              <label className="ml-campo">
                <span className="ml-etiqueta">¿De qué plato es?</span>
                <select className="ml-entrada" value={lectura.platoId} onChange={(e) => setLectura({ ...lectura, platoId: e.target.value })} disabled={!!ocupado}>
                  <option value="">Elige el plato…</option>
                  {sinReceta.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
              </label>
              <div className="cc-acciones">
                <button type="button" className="ml-boton" data-principal="si" disabled={!lectura.platoId || !!ocupado} onClick={() => void seguir()}>
                  {ocupado === 'lectura' ? 'Abriendo…' : 'Revisar y guardar'}
                </button>
                <button type="button" className="ml-boton" disabled={!!ocupado} onClick={() => void leerSiguiente(cola, carta)}>
                  {cola.length ? 'Saltar este fichero' : 'No guardar'}
                </button>
              </div>
              <span className="ml-pista">Antes de guardar te enseño cada ingrediente para que lo confirmes.{cola.length ? ` Quedan ${cola.length} ${cola.length === 1 ? 'fichero' : 'ficheros'}.` : ''}</span>
            </>
          )}
        </div>
      )}

      <div className="cc-tabla">
        <table>
          <thead>
            <tr>
              <th>Plato</th>
              {canales.map((c) => <th key={c.slug} className="cc-num">{c.nombre}</th>)}
              <th>Receta</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {visibles.map((p) => (
              <tr key={p.id} data-estado={p.estado}>
                <td>{p.nombre}</td>
                {canales.map((c) => <td key={c.slug} className="cc-num">{p.precios[c.slug] != null ? euros(p.precios[c.slug]) : '—'}</td>)}
                <td>
                  {p.estado === 'sin_receta' && <span className="ml-chip" data-tono="aviso">Sin receta</span>}
                  {p.estado === 'almacen' && <span className="ml-chip" data-tono="ok">Del almacén</span>}
                  {p.estado === 'receta' && <span className="ml-chip" data-tono="ok">Con receta</span>}
                  {p.estado === 'sin_receta' && p.ventasEsperando > 0 && (
                    <span className="ml-pista rc-espera">{p.ventasEsperando === 1 ? '1 venta esperando' : `${p.ventasEsperando} ventas esperando`}</span>
                  )}
                </td>
                <td className="cc-num">
                  {p.estado === 'sin_receta' && (
                    <button type="button" className="rc-enlace" disabled={!!ocupado} onClick={() => void hacerReceta(p)} aria-label={`Hacer receta: ${p.nombre}`}>
                      {ocupado === p.id ? 'Abriendo…' : 'Hacer receta'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {carta.platos.length > PRIMEROS && (
        <button type="button" className="rc-enlace rc-todos" onClick={() => setTodos((t) => !t)}>
          {todos ? 'Ver solo los primeros' : `Y ${carta.platos.length - PRIMEROS} más · Ver todos`}
        </button>
      )}
      {carta.platos.length === 0 && <p className="cc-vacio">Esta marca todavía no tiene platos en su carta.</p>}

      {revisando && (
        <RecipeImportReviewModal
          accountId={accountId}
          sessionId={revisando.sesion.sessionId}
          dishName={revisando.plato.nombre}
          lines={revisando.sesion.lines}
          onCancel={() => { setRevisando(null); void leerSiguiente(cola, carta) }}
          onCompleted={(r) => void guardada(revisando.plato, r.recipeId, r.linesCreated)}
        />
      )}
    </div>
  )
}
