// src/modules/pase/components/AjustesDelPase.tsx
//
// EL INTERRUPTOR DEL PASE · 15/09/2026
//
// Vive en los ajustes del local, junto a los horarios, porque es donde una
// persona de oficina busca «cómo funciona este local».
//
// ── LAS CUATRO REGLAS DE DISEÑO, Y SON DEL ENCARGO ────────────────────────
//
//  1. NADA DE JERGA. Ni «flag», ni «feature», ni `pase_activo`. En pantalla se
//     llama EL PASE, y lo que hace se cuenta en las palabras de la cocina.
//  2. EL ESTADO SE LEE SIN PULSAR NADA. Los locales de la cuenta, todos a la
//     vez, con su estado a la vista. La pregunta real es «¿dónde está
//     encendido?» y hasta hoy no se podía contestar sin entrar uno por uno.
//  3. ENCENDER Y APAGAR SE VEN IGUAL DE FÁCILES. La retirada no se esconde: es
//     la que da confianza para probar.
//  4. FIEL A LA MAQUETA de la tablet --tarjetas, negro, tipografía gorda-- y no
//     al estilo seco del resto de la app.
//
// 🔴 Y NADA SE ANCLA EN EL NOMBRE. Medido hoy: la cuenta plantilla tiene tres
// locales con los MISMOS NOMBRES que producción --«Foodint Alcalá» existe dos
// veces en la base--. Aquí se ancla en `location_id` y el nombre es sólo lo que
// se pinta. La RLS ya deja fuera los de otras cuentas (comprobado con la sesión
// de Julio: ve tres, los suyos), pero el día que alguien vea dos con el mismo
// nombre, el botón seguirá encendiendo el correcto (regla 9).

import { useCallback, useEffect, useState } from 'react'
import { Check, Power, AlertTriangle } from 'lucide-react'
import {
  getLocalesYSuPase, encenderElPase, type ElLocalYSuPase,
} from '../services/paseService'

/** «ayer a las 21:34». Sin librería: es una frase, no un formato. */
function cuandoEnPalabras(iso: string | null): string | null {
  if (!iso) return null
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return null
  const hora = t.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
  const hoy = new Date()
  const mismoDia = t.toDateString() === hoy.toDateString()
  const ayer = new Date(hoy.getTime() - 86_400_000).toDateString() === t.toDateString()
  if (mismoDia) return `hoy a las ${hora}`
  if (ayer) return `ayer a las ${hora}`
  return `el ${t.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })} a las ${hora}`
}

/**
 * LA LÍNEA QUE CUENTA LA HISTORIA. «Apagado» a secas no dice nada; «Apagado
 * desde ayer a las 21:34, por la tablet del Pase» dice todo lo que hace falta
 * para decidir si se vuelve a encender.
 */
function laHistoria(l: ElLocalYSuPase): string {
  const cuando = cuandoEnPalabras(l.cuando)
  if (!cuando) {
    return l.activo
      ? 'Encendido. No consta desde cuándo: se encendió antes de que hubiera registro.'
      : 'Nunca se ha encendido en este local.'
  }
  const quien = l.quien ?? (l.desde === 'tablet' ? 'una tablet' : 'alguien de la oficina')
  const via = l.desde === 'tablet' ? `por ${quien}` : `desde la oficina, por ${quien}`
  return l.activo
    ? `Encendido desde ${cuando}, ${via}.`
    : `Apagado desde ${cuando}, ${via}.`
}

export default function AjustesDelPase() {
  const [locales, setLocales] = useState<ElLocalYSuPase[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  // El local que se está a punto de encender. null = no se ha pedido nada.
  const [preguntando, setPreguntando] = useState<ElLocalYSuPase | null>(null)
  const [ocupado, setOcupado] = useState(false)

  const cargar = useCallback(async () => {
    try {
      setLocales(await getLocalesYSuPase())
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  // La primera carga sale del cuerpo del efecto a propósito: pintar estado
  // dentro del efecto es lo que canta `react-hooks/set-state-in-effect`, y la
  // regla tiene razón. Mismo remedio que en `PaseBoard`: se difiere un tic.
  useEffect(() => {
    const primero = setTimeout(() => { void cargar() }, 0)
    return () => clearTimeout(primero)
  }, [cargar])

  const encender = async (l: ElLocalYSuPase) => {
    setOcupado(true)
    try {
      const r = await encenderElPase(l.location_id)
      // Regla 8: confirma con CONTENIDO y con el nombre que devolvió la BASE,
      // no el que yo tenía pintado. Si no coinciden, es que se encendió otro.
      setAviso(`Pase encendido en ${r.local ?? l.local}. La tablet del Pase cambia de pantalla en su próximo refresco.`)
      setPreguntando(null)
      await cargar()
    } catch (e) {
      setAviso(`No se ha podido encender: ${(e as Error).message}`)
    } finally {
      setOcupado(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-extrabold tracking-tight text-text-primary">El Pase</h2>
        <p className="text-[13.5px] leading-snug text-text-secondary mt-1 max-w-2xl">
          Con el Pase encendido, la tablet del pase enseña los pedidos por dónde está la
          comida —Sigue aquí · En ruta · Entregados— y el «Listo» se pulsa ahí.{' '}
          <b className="text-text-primary">Se puede apagar desde la propia tablet en cualquier
          momento</b>, sin perder ningún pedido.
        </p>
      </div>

      {aviso && (
        <div className="rounded-xl border border-default bg-card px-3.5 py-2.5 text-[13px]
                        flex items-start gap-2">
          <span className="min-w-0">{aviso}</span>
          <button onClick={() => setAviso(null)} className="ml-auto underline shrink-0">cerrar</button>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-danger/40 bg-danger-bg/30 px-3.5 py-2.5 text-[13px]">
          <b>No se han podido leer los locales.</b> {error}
        </div>
      )}

      {locales == null ? (
        /* Primer pintado: cargando, nunca una lista vacía. Decir «no hay
           locales» y media décima después enseñar tres se paga en confianza. */
        <p className="text-text-tertiary text-[13px] py-6">Cargando…</p>
      ) : locales.length === 0 ? (
        <p className="text-text-secondary text-[13px] py-6 border border-dashed border-default
                      rounded-xl px-4 leading-relaxed">
          <b className="block text-text-primary mb-1">No hay ningún local que puedas configurar.</b>
          Los ajustes del Pase los lleva quien administra la cuenta o gestiona el local.
        </p>
      ) : (
        <div className="space-y-2.5">
          {locales.map(l => (
            <article key={l.location_id}
                     className="rounded-2xl border border-default bg-card p-3.5 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <b className="text-[15.5px] font-extrabold tracking-tight truncate">{l.local}</b>
                  <span className={`shrink-0 px-2 py-0.5 rounded-full text-[11.5px] font-extrabold ${
                    l.activo ? 'bg-accent text-text-on-accent' : 'bg-page text-text-secondary border border-default'
                  }`}>
                    {l.activo ? 'Encendido' : 'Apagado'}
                  </span>
                </div>
                <p className="text-[12.5px] text-text-secondary mt-0.5 leading-snug">{laHistoria(l)}</p>
                {l.motivo && (
                  <p className="text-[12.5px] text-text-secondary mt-0.5 leading-snug">
                    <b className="text-text-primary">Lo apagaron porque:</b> «{l.motivo}»
                  </p>
                )}
              </div>

              {l.activo ? (
                /* La retirada NO se esconde, pero desde aquí no se apaga: apagar
                   es de quien está delante de la tablet, que es quien sabe si
                   hay un problema. Se dice dónde está, no se deja el hueco. */
                <span className="shrink-0 text-[12px] text-text-tertiary text-right leading-snug max-w-[170px]">
                  Se apaga desde la tablet del Pase, en el pie de la pantalla.
                </span>
              ) : (
                <button onClick={() => setPreguntando(l)}
                        className="shrink-0 min-h-[44px] px-4 rounded-xl bg-accent text-text-on-accent
                                   text-[14px] font-extrabold flex items-center gap-2">
                  <Power size={16} strokeWidth={2.6} /> Encender el Pase
                </button>
              )}
            </article>
          ))}
        </div>
      )}

      {preguntando && (
        /* 🔴 DICE QUÉ VA A PASAR ANTES DE HACERLO, y en las palabras de la
           cocina. Y el botón lleva el NOMBRE DEL LOCAL dentro: un «Aceptar» a
           secas es como se enciende el local equivocado. */
        <div className="fixed inset-0 z-50 bg-black/55 flex items-end sm:items-center sm:justify-center"
             onClick={() => { if (!ocupado) setPreguntando(null) }}>
          <div className="w-full sm:max-w-md bg-card rounded-t-2xl sm:rounded-2xl p-4"
               onClick={e => e.stopPropagation()}>
            <b className="block text-[17px] font-extrabold tracking-tight mb-2">
              ¿Encender el Pase en {preguntando.local}?
            </b>
            <ul className="text-[13.5px] leading-relaxed text-text-secondary space-y-1 mb-3.5">
              <li><b className="text-text-primary">La tablet del Pase cambia de pantalla.</b></li>
              <li>Verá tres pestañas —Sigue aquí · En ruta · Entregados— y el «Listo» se pulsará ahí.</li>
              <li>«Pedidos» sigue estando, con todo, pero sin el botón.</li>
              <li>El ticket de cocina y el de la bolsa salen igual que hoy.</li>
              <li className="flex gap-1.5">
                <AlertTriangle size={15} className="shrink-0 mt-0.5 text-text-tertiary" />
                <span><b className="text-text-primary">Se puede deshacer desde la propia tablet</b>, en
                cualquier momento, sin perder ningún pedido.</span>
              </li>
            </ul>
            <div className="flex gap-2.5">
              <button onClick={() => setPreguntando(null)} disabled={ocupado}
                      className="min-w-[110px] min-h-[48px] px-3 rounded-xl border border-linea-fuerte
                                 bg-card text-text-secondary text-[14px] font-extrabold disabled:opacity-50">
                No, dejarlo
              </button>
              <button onClick={() => void encender(preguntando)} disabled={ocupado}
                      className="flex-1 min-h-[48px] px-3 rounded-xl bg-accent text-text-on-accent
                                 text-[14.5px] font-extrabold flex items-center justify-center gap-2
                                 disabled:opacity-50">
                {ocupado ? '…' : <><Check size={17} strokeWidth={3} /> Encender en {preguntando.local}</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
