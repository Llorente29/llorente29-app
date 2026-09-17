// src/modules/pase/components/HojaDelPase.tsx
//
// LA HOJA DE DETALLE · 16/09/2026, contra la maqueta aprobada del 14/09.
//
// Sube desde abajo al tocar una tarjeta. Es la respuesta a «¿y todo lo demás?»:
// el teléfono del que lleva el pedido, el del cliente con su código de
// centralita, los cinco tiempos, la dirección y las notas.
//
// LAS CINCO REGLAS DE LA MAQUETA, que son las que gobiernan este fichero:
//   1. El botón de la tarjeta NO abre la hoja. Abre el resto de la tarjeta.
//   2. Sube desde abajo, ocupa como mucho el 78 % del alto y deja ver la fila
//      de arriba: quien la abre tiene que seguir viendo dónde está.
//   3. NINGUNA acción que cambie el estado del pedido. Sólo reimprimir. Esta
//      pantalla se abre con las manos llenas y la bolsa en la otra: si desde
//      aquí se pudiera marcar «Listo», se marcaría sin querer.
//   4. Donde hay centralita y código, se dice, y el código va ESCRITO y grande.
//      La marcación con tonos no está verificada contra Uber ni JustEat; hasta
//      que lo esté, la persona tiene que poder teclearlo.
//   5. Donde no hay dato, se escribe por qué. Ni un hueco.
//
// Aquí sólo se pinta: qué se puede llamar y por qué no, en `lib/laFicha.ts`.

import { useEffect, useState } from 'react'
import { Phone, Printer, X, AlertTriangle } from 'lucide-react'
import {
  laFuenteDe, laDireccion, llamarAlCliente, llamarAlRepartidor, losCincoTiempos,
  type FichaDelPase, type Llamada,
} from '../lib/laFicha'
import { quienLoLleva } from '../lib/lasTresZonas'
import { getFicha } from '../services/paseService'

/** La hora de Madrid. La base manda UTC (regla 4): aquí se convierte, siempre. */
function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-ES', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid',
  })
}

/** Un botón de llamar, o el recuadro que dice por qué no lo hay. Nunca un hueco. */
function BotonDeLlamar({ l, quien, color }: {
  l: Llamada
  quien: 'repartidor' | 'cliente'
  color: 'verde' | 'azul'
}) {
  if (!l.hay || !l.marcacion) {
    return (
      <div className="rounded-xl border border-dashed border-linea-fuerte bg-lavado px-3 py-2.5">
        <p className="text-[13px] leading-snug text-text-secondary">{l.explicacion}</p>
      </div>
    )
  }
  const fondo = color === 'verde'
    ? 'bg-success text-white border-success'
    : 'bg-text-info text-white border-text-info'
  return (
    <div>
      <a href={l.marcacion}
         className={`w-full min-h-[58px] rounded-xl border-2 ${fondo} px-3
                     flex items-center justify-center gap-2.5 text-[17px] font-extrabold`}>
        <Phone size={20} strokeWidth={3} />
        <span className="truncate">
          Llamar al {quien}{l.nombre ? ` · ${l.nombre}` : ''}
        </span>
      </a>
      {/* El número, escrito. Si la marcación falla --y con centralita puede
          fallar-- la persona tiene que poder marcarlo a mano. */}
      {l.numero && (
        <p className="mt-1 text-[12px] text-text-tertiary tabular-nums text-center">{l.numero}</p>
      )}
      {l.codigo && (
        <div className="mt-1.5 rounded-xl bg-warning-bg border border-warning/40 px-3 py-2">
          <p className="text-[12.5px] leading-snug text-text-secondary">{l.explicacion}</p>
          <p className="mt-1 text-[26px] font-extrabold tracking-wider tabular-nums text-warning text-center">
            {l.codigo}
          </p>
        </div>
      )}
    </div>
  )
}

/** Las iniciales, igual que en la tarjeta: un hueco a la vista, no un icono roto. */
function LogoDeLaHoja({ url, marca }: { url: string | null; marca: string | null }) {
  const [roto, setRoto] = useState(false)
  if (!url || roto) {
    return (
      <div className="w-9 h-9 rounded-lg shrink-0 bg-lavado border border-dashed border-linea-fuerte
                      flex items-center justify-center text-[10.5px] font-extrabold text-text-tertiary">
        {(marca ?? '?').split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase()}
      </div>
    )
  }
  return <img src={url} alt="" onError={() => setRoto(true)}
              className="w-9 h-9 rounded-lg shrink-0 object-cover bg-lavado border border-default" />
}

/** LA BOLSA · el renglón que se fue de la tarjeta. Nunca vacío (regla 5). */
function laBolsa(f: FichaDelPase): string {
  const b = f.bolsa
  if (!b || b.estado === 'sin_pedir') return 'Todavía no se ha pedido la etiqueta.'
  const cuando = b.cuando ? ` ${b.cuando}` : ''
  if (b.estado === 'hecha') return `Impresa${cuando}`
  if (b.estado === 'esperando') return `Pedida${cuando}, esperando a la impresora`
  return `NO HA SALIDO${cuando}`
       + (b.intentos > 0 ? ` · intentado ${b.intentos} ${b.intentos === 1 ? 'vez' : 'veces'}` : '')
}

function Dato({ nombre, children }: { nombre: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 items-baseline py-1.5 border-b border-lavado last:border-0">
      <span className="text-[12.5px] text-text-tertiary shrink-0 w-[92px]">{nombre}</span>
      <span className="text-[13.5px] text-text-primary min-w-0 flex-1">{children}</span>
    </div>
  )
}

export default function HojaDelPase({ saleId, token, onCerrar, fichaDePrueba }: {
  saleId: string
  token: string
  onCerrar: () => void
  /** Sólo para la maqueta: entra la ficha ya hecha y no se llama a la base. */
  fichaDePrueba?: FichaDelPase
}) {
  const [ficha, setFicha] = useState<FichaDelPase | null>(fichaDePrueba ?? null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(!fichaDePrueba)
  const [reimprimiendo, setReimprimiendo] = useState(false)
  const [avisoBolsa, setAvisoBolsa] = useState<string | null>(null)

  useEffect(() => {
    if (fichaDePrueba) return
    let vivo = true
    // 🔴 Sin `setCargando(true)` aquí: llamar a setState dentro del cuerpo de un
    // efecto encadena renders, y el lint lo caza. El estado inicial ya nace
    // bien --`useState(!fichaDePrueba)`-- y el componente se monta de cero por
    // cada pedido, porque `PaseBoard` le pone `key={hoja}`. Abrir otra tarjeta
    // es una hoja NUEVA, no la misma hoja cambiando de pedido, que además es lo
    // correcto: si no, se vería un instante la ficha del pedido anterior.
    getFicha(saleId, token)
      .then(f => {
        if (!vivo) return
        setFicha(f)
        // 🔴 `null` NO es «no hay datos»: es «la base todavía no sabe de esto».
        // Se dice con esas palabras, porque son dos averías distintas.
        if (!f) setError('Esta tablet todavía no tiene la hoja de detalle. '
                       + 'Está en la base a partir de esta noche.')
      })
      .catch(e => { if (vivo) setError(`No se ha podido abrir la ficha: ${(e as Error).message}`) })
      .finally(() => { if (vivo) setCargando(false) })
    return () => { vivo = false }
  }, [saleId, token, fichaDePrueba])

  const pulsarReimprimir = async () => {
    setReimprimiendo(true); setAvisoBolsa(null)
    try {
      const { reimprimirBolsa } = await import('../services/paseService')
      const n = await reimprimirBolsa(saleId, token)
      setAvisoBolsa(n > 0
        ? `Pedida otra vez. ${n} ${n === 1 ? 'ticket' : 'tickets'} en cola.`
        : 'No hay ninguna impresora de bolsa configurada en este local.')
    } catch (e) {
      setAvisoBolsa(`No se ha podido reimprimir: ${(e as Error).message}`)
    } finally { setReimprimiendo(false) }
  }

  return (
    <div className="absolute inset-0 z-40 flex flex-col justify-end">
      {/* EL VELO. Se ve la fila de arriba a través de él, y cerrar tocándolo es
          el gesto que ya espera cualquiera que haya usado un móvil. */}
      <button aria-label="Cerrar" onClick={onCerrar}
              className="absolute inset-0 bg-black/55" />

      <section className="relative rounded-t-2xl bg-card border-t border-default shadow-2xl
                          flex flex-col min-h-0"
               style={{ maxHeight: '78%' }}>
        <header className="flex items-center gap-2.5 px-3 py-2.5 border-b border-default shrink-0">
          <LogoDeLaHoja url={ficha?.marca_logo_url ?? null} marca={ficha?.marca ?? null} />
          <div className="min-w-0">
            <b className="block text-[16px] font-extrabold truncate">{ficha?.marca ?? 'Sin marca'}</b>
            <span className="block text-[11.5px] text-text-tertiary tabular-nums truncate">
              {ficha?.codigo ?? '—'}
            </span>
          </div>
          <button onClick={onCerrar}
                  className="ml-auto shrink-0 min-h-[46px] min-w-[104px] px-3 rounded-xl
                             border border-linea-fuerte bg-card text-text-secondary
                             text-[14.5px] font-extrabold flex items-center justify-center gap-1.5">
            <X size={18} strokeWidth={3} /> Cerrar
          </button>
        </header>

        {/* 🔴 DOS COLUMNAS EN APAISADO. Con una sola, en la tablet de 1024×600
            la hoja llegaba hasta «Dirección» y había que arrastrar para ver las
            notas y el botón de reimprimir. Una pantalla que se abre con la
            bolsa en una mano no se arrastra: o cabe, o no está. Medido en la
            maqueta, no supuesto. En vertical --un móvil-- vuelve a una sola. */}
        <div className="overflow-y-auto min-h-0 px-3 py-3 grid gap-3 sm:grid-cols-2 items-start">
          {cargando && <p className="text-[13px] text-text-tertiary">Abriendo la ficha…</p>}

          {error && (
            <div className="flex gap-2 items-start rounded-xl bg-warning-bg border border-warning/40 px-3 py-2.5">
              <AlertTriangle size={16} className="text-warning shrink-0 mt-0.5" />
              <p className="text-[13px] leading-snug text-text-secondary">{error}</p>
            </div>
          )}

          {ficha && (
            <>
              <div className="flex flex-col gap-3 min-w-0">
                <BotonDeLlamar l={llamarAlRepartidor(ficha)} quien="repartidor" color="verde" />
                <BotonDeLlamar l={llamarAlCliente(ficha)} quien="cliente" color="azul" />
              </div>

              <div className="flex flex-col gap-3 min-w-0">
              <div className="rounded-xl border border-default px-3 py-1.5">
                <Dato nombre="Quién lo lleva">{quienLoLleva(ficha).texto}</Dato>
                <Dato nombre="Canal">{ficha.channel ?? 'Sin canal'}</Dato>
                <Dato nombre="Tiempos">
                  <span className="flex flex-wrap gap-x-3 gap-y-0.5 tabular-nums">
                    {losCincoTiempos(ficha, hhmm).map(i => (
                      <span key={i.etiqueta} className={i.hora ? '' : 'text-text-tertiary'}>
                        {i.etiqueta} {i.hora ?? '—'}
                        {/* QUIÉN LO DICE, pegado a SU hito (17/09). Antes toda
                            la frase colgaba del «Listo», y así un J191403139
                            --pulsado por una persona y recogido 38 s después--
                            decía «Listo · lo dice la flota». Lo que dice la
                            flota es la salida y la entrega. */}
                        {i.hora && laFuenteDe(ficha, i.etiqueta) && (
                          <span className="text-text-tertiary"> · {laFuenteDe(ficha, i.etiqueta)}</span>
                        )}
                      </span>
                    ))}
                  </span>
                </Dato>
                <Dato nombre="Bolsa">{laBolsa(ficha)}</Dato>
                <Dato nombre="Dirección">{laDireccion(ficha)}</Dato>
                <Dato nombre="Notas">
                  {ficha.notas ?? 'Sin notas. De alergias no nos llega nada en ningún pedido: '
                                + 'no hay campo en el conector.'}
                </Dato>
              </div>

              <div>
                <button onClick={() => void pulsarReimprimir()} disabled={reimprimiendo}
                        className="w-full min-h-[50px] rounded-xl border border-linea-fuerte bg-card
                                   text-text-secondary text-[15px] font-extrabold flex items-center
                                   justify-center gap-2 disabled:opacity-50">
                  <Printer size={18} /> {reimprimiendo ? '…' : 'Reimprimir la bolsa'}
                </button>
                {avisoBolsa && (
                  <p className="mt-1.5 text-[12.5px] text-text-secondary text-center">{avisoBolsa}</p>
                )}
              </div>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  )
}
