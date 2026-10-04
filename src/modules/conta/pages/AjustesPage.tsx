// src/modules/conta/pages/AjustesPage.tsx
//
// Ajustes de contabilidad como índice (C02 §5a, maqueta N6Ajustes). Las
// entradas de EMPRESA son lo que antes eran bloques de «Tu empresa» (C00,
// maquetas N2/M2), repartidos sin cambiar nada por dentro:
//   Tu empresa (quién eres, actividad y registro) · Tus impuestos (y lo que
//   piden el 200 y el depósito, y el detalle contable) · Socios y cargos ·
//   Ejercicio.  Y «Lo que ha hecho Folvy», con el historial del plan.
// Las que aún no tienen pantalla dicen «aún no» y por qué.
//
// El bloque verde de la IA es una SUGERENCIA (§6.2 del C00): solo si se puede
// fundamentar con datos de la propia cuenta.

import { Navigate, useParams } from 'react-router-dom'
import { ENTRADA_DE_APARTADO, entradaAjustes, rutaAjustes } from '@/config/navegacion'
import { ErrorConReintento, TarjetaCargando, Vacio } from '@/modules/conta/ui/piezas'
import { CabeceraEntradaMovil, MarcoAjustes } from '@/modules/conta/ajustes/MarcoAjustes'
import { useAjustes } from '@/modules/conta/ajustes/contextoAjustes'
import { DetalleContable, QuienEres, TusImpuestos } from '@/modules/conta/empresa/ApartadosEmpresa'
import { Actividades, EjercicioMeses, Socios } from '@/modules/conta/empresa/ApartadosActividad'
import { RegistroIA, Sugerencias } from '@/modules/conta/ia/PiezasIA'
import { ParaPresentar } from '@/modules/conta/empresa/ApartadoPresentar'
import { RegistroPlan } from '@/modules/conta/plan/RegistroPlan'
import { ejercicioActual } from '@/modules/conta/empresa/datosEmpresa'

function TituloPanel({ titulo, apoyo }: { titulo: string; apoyo?: string }) {
  return (
    <div className="cx-ajustes-panel-cabeza">
      <h2 className="cx-ajustes-panel-titulo">{titulo}</h2>
      {apoyo && <p className="cx-ayuda" style={{ margin: 0 }}>{apoyo}</p>}
    </div>
  )
}

function Entrada({ id }: { id: string }) {
  const { datos, plan, quien, movil, hoy } = useAjustes()
  const e = entradaAjustes(id)!
  const d = datos.datos
  const titulo = id === 'ejercicio' && d ? (() => { const ej = ejercicioActual(d.ejercicios, hoy); return ej ? `Ejercicio ${ej.code}` : 'Ejercicio' })() : e.etiqueta
  // En el ordenador, el título del panel solo donde la primera tarjeta no lo
  // repite (Tus impuestos, Socios y cargos, Ejercicio y Lo que ha hecho Folvy ya lo llevan arriba).
  const conTitulo = !['impuestos', 'socios', 'ejercicio', 'folvy'].includes(id)
  const cabeza = movil ? <CabeceraEntradaMovil titulo={titulo} /> : conTitulo ? <TituloPanel titulo={titulo} /> : null

  if (e.hueco) {
    return <>{cabeza}<div className="cx-tarjeta"><Vacio titulo="Aún no." explicacion={e.hueco} /></div></>
  }
  if (datos.cargando) return <>{cabeza}<TarjetaCargando /></>
  if (datos.error || !d) return <>{cabeza}<ErrorConReintento mensaje={datos.error ?? 'No se ha podido leer.'} reintentar={datos.recargar} /></>
  const p = { d, quien, alCambiar: datos.recargar, movil, hoy }
  switch (id) {
    case 'empresa':
      return (
        <>
          {cabeza}
          <Sugerencias sugerencias={d.ia.sugerencias} alCambiar={datos.recargar} />
          <div className={movil ? 'cx-columna' : 'cx-rejilla-2'}>
            <QuienEres {...p} />
            <Actividades {...p} />
          </div>
        </>
      )
    case 'impuestos':
      return (
        <>
          {cabeza}
          <TusImpuestos {...p} />
          <ParaPresentar d={d} movil={movil} hoy={hoy} />
          <DetalleContable {...p} planActivo={plan.datos?.activo ?? false} />
        </>
      )
    case 'socios': return <>{cabeza}<Socios {...p} /></>
    case 'ejercicio': return <>{cabeza}<EjercicioMeses {...p} /></>
    case 'folvy':
      return (
        <>
          {cabeza}
          <RegistroIA registro={d.ia.registro} alCambiar={datos.recargar} movil={movil} />
          <RegistroPlan registro={plan.datos?.registro ?? []} />
        </>
      )
    default: return <Navigate to={rutaAjustes()} replace />
  }
}

export default function AjustesPage() {
  const { entrada, apartado } = useParams()
  // Las direcciones viejas de «Tu empresa» en el móvil (ajustes/empresa/:apartado) van a su entrada.
  if (apartado !== undefined) return <Navigate to={rutaAjustes(ENTRADA_DE_APARTADO[apartado] ?? 'empresa')} replace />
  if (entrada !== undefined && !entradaAjustes(entrada)) return <Navigate to={rutaAjustes()} replace />
  return (
    <MarcoAjustes entrada={entrada ?? null}>
      <Entrada id={entrada ?? 'empresa'} />
    </MarcoAjustes>
  )
}
