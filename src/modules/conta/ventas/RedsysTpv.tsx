// src/modules/conta/ventas/RedsysTpv.tsx
//
// S01 · PR 1 · El TPV del banco (Redsys) en «Cómo te pagan»: el segundo
// proveedor del enlace de pago, al lado de Stripe y con el mismo patrón
// (tableros 15 a 18): logo, estado en palabras («Activo», «Falta el número de
// comercio», «Falta la clave del comercio», «En pruebas») y un solo botón.
//
//   · En Ajustes › Cobros (editar): número de comercio, terminal y clave, si el
//     banco tiene Bizum en el TPV y, si también cobras con Stripe, por cuál
//     cobra el enlace. Nada se guarda solo: la pieza común «Cambios sin
//     guardar» con «Guardar cambios». La clave va a la caja fuerte y no vuelve
//     a la pantalla: el campo sale vacío y dice que hay una guardada.
//   · En Ventas › Cobros: el estado y «Ir a Ajustes › Cobros».
// Al guardar, la frase de lo que ha pasado (regla 8): «Guardado. Redsys en
// pruebas, comercio 999008881.»

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { rutaAjustes } from '@/config/navegacion'
import { Chip } from '@/modules/conta/diseno'
import { Campo, Selector, Texto } from '@/modules/conta/diseno/Campo'
import { BarraCambios, MarcaCambiado, type MensajeGuardado } from '@/modules/conta/diseno/plantillas/CambiosSinGuardar'
import { useCambiosSinGuardar } from '@/modules/conta/diseno/plantillas/cambios'
import { errorClave, errorComercio, errorTerminal, notaRedsys, textoRedsys, tonoRedsys, type CobroRedsys } from '@/modules/conta/lib/cobros'
import { guardarRedsys } from '@/modules/conta/services/cobrosService'

export function LogoRedsys() {
  return (
    <svg className="pg-logo-pago" width="40" height="28" viewBox="0 0 40 28" role="img" aria-label="TPV del banco">
      <rect x="0" y="0" width="40" height="28" rx="6" fill="#fff" stroke="currentColor" strokeWidth="1.5" />
      <text x="20" y="18" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontSize="9.5" fontWeight="700" fill="#D2232A">redsys</text>
    </svg>
  )
}

type Datos = { comercio: string; terminal: string; clave: string; bizum: 'si' | 'no'; enlace: 'redsys' | 'stripe' }

export function RedsysTpv({ empresaId, c, conStripe, editar, alGuardar }: {
  empresaId: string
  /** null: aún no hay TPV guardado. */
  c: CobroRedsys | null
  /** ¿La empresa cobra también con Stripe (tarjeta activa)? Entonces se elige por cuál cobra el enlace. */
  conStripe: boolean
  editar: boolean
  alGuardar: () => void
}) {
  const original: Datos = {
    comercio: c?.comercio ?? '', terminal: c?.terminal ?? '1', clave: '', bizum: c?.bizum ? 'si' : 'no', enlace: c && !c.enEnlace ? 'stripe' : 'redsys',
  }
  const cambios = useCambiosSinGuardar<Datos>(original,
    { comercio: 'Número de comercio', terminal: 'Terminal', clave: 'Clave', bizum: 'Bizum en el TPV', enlace: 'El enlace cobra por' },
    (campo, v) => campo === 'clave' ? (v ? 'una nueva' : c?.conClave ? 'la guardada' : 'sin clave')
      : campo === 'bizum' ? (v === 'si' ? 'Sí' : 'No') : campo === 'enlace' ? (v === 'stripe' ? 'Stripe' : 'Tu TPV') : (String(v) || 'Sin poner'))
  const [guardando, setGuardando] = useState(false)
  const [mensaje, setMensaje] = useState<MensajeGuardado | null>(null)
  const v = cambios.valor
  const errores = { comercio: errorComercio(v.comercio), terminal: errorTerminal(v.terminal), clave: errorClave(v.clave) }
  const nota = notaRedsys(c)

  async function guardar() {
    const fallo = errores.comercio ?? errores.terminal ?? errores.clave
    if (fallo) { setMensaje({ tono: 'falta', texto: fallo }); return }
    setGuardando(true); setMensaje(null)
    const r = await guardarRedsys(empresaId, { comercio: v.comercio.replace(/\s/g, ''), terminal: v.terminal.trim(), clave: v.clave, bizum: v.bizum === 'si', enEnlace: v.enlace === 'redsys' }, null)
    setMensaje({ tono: r.ok ? 'ok' : 'falta', texto: r.texto })
    if (r.ok) { cambios.reiniciar({ ...v, clave: '' }); alGuardar() }
    setGuardando(false)
  }

  return (
    <div className="pg-dialogo-campos" data-prueba="redsys">
      <ul className="pg-metodos-pago" aria-label="Tu TPV">
        <li className="pg-metodo-pago">
          <LogoRedsys />
          <span className="pg-metodo-nombre">Tarjeta{c?.bizum ? ' y Bizum' : ''} con tu banco</span>
          <Chip tono={tonoRedsys(c)}>{textoRedsys(c)}</Chip>
        </li>
      </ul>
      {nota && <p className="pg-dialogo-nota">{nota}</p>}
      {!editar && (
        <p className="pg-dialogo-nota"><Link className="pg-enlace" to={rutaAjustes('cobros')}>{c ? 'Cambiar los datos del TPV' : 'Poner los datos de tu TPV'}</Link> en Ajustes › Cobros.</p>
      )}
      {editar && (
        <section aria-label="Los datos de tu TPV" className="pg-dialogo-campos">
          <BarraCambios cambios={cambios.cambios} onDescartar={() => { cambios.descartar(); setMensaje(null) }} onGuardar={() => void guardar()} guardando={guardando} mensaje={mensaje} />
          <Campo etiqueta="Número de comercio" error={errores.comercio} ayuda="9 cifras. Te lo da tu banco con el TPV virtual.">{(p) => (
            <Texto {...p} valor={v.comercio} alCambiar={(x) => cambios.poner('comercio', x)} inputMode="numeric" autoComplete="off" placeholder="999008881" />
          )}</Campo>
          <MarcaCambiado parte="antes" cambio={cambios.cambioDe('comercio')} onDeshacer={() => cambios.deshacer('comercio')} />
          <Campo etiqueta="Terminal" error={errores.terminal} ayuda="Casi siempre, 1.">{(p) => (
            <Texto {...p} valor={v.terminal} alCambiar={(x) => cambios.poner('terminal', x)} inputMode="numeric" autoComplete="off" />
          )}</Campo>
          <Campo etiqueta="Clave del comercio" error={errores.clave}
            ayuda={c?.conClave ? 'Hay una guardada en la caja fuerte de Sumied. Escribe otra solo si tu banco te la ha cambiado.' : 'La «clave SHA-256» del panel de tu banco. Sumied la guarda en su caja fuerte y no la vuelve a enseñar.'}>{(p) => (
            <Texto {...p} type="password" valor={v.clave} alCambiar={(x) => cambios.poner('clave', x)} autoComplete="new-password" placeholder={c?.conClave ? '•••••••• (guardada)' : ''} />
          )}</Campo>
          <Campo etiqueta="¿Tu banco tiene Bizum en el TPV?">{(p) => (
            <Selector {...p} valor={v.bizum} alCambiar={(x) => cambios.poner('bizum', x === 'si' ? 'si' : 'no')}
              opciones={[{ valor: 'no', texto: 'No, solo tarjeta' }, { valor: 'si', texto: 'Sí, también Bizum' }]} />
          )}</Campo>
          {conStripe && (
            <Campo etiqueta="El enlace de pago cobra por" ayuda="Tus clientes pagan con uno de los dos; el otro se queda para cuando lo cambies.">{(p) => (
              <Selector {...p} valor={v.enlace} alCambiar={(x) => cambios.poner('enlace', x === 'stripe' ? 'stripe' : 'redsys')}
                opciones={[{ valor: 'redsys', texto: 'Tu TPV (Redsys)' }, { valor: 'stripe', texto: 'Stripe' }]} />
            )}</Campo>
          )}
        </section>
      )}
    </div>
  )
}
