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

import { useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { ENTRADA_DE_APARTADO, entradaAjustes, rutaAjustes, rutaTablasGenerales } from '@/config/navegacion'
import { ErrorConReintento, TarjetaCargando, Vacio } from '@/modules/conta/ui/piezas'
import { CabeceraEntradaMovil, MarcoAjustes } from '@/modules/conta/ajustes/MarcoAjustes'
import { useAjustes } from '@/modules/conta/ajustes/contextoAjustes'
import { DetalleContable, QuienEres, TusImpuestos } from '@/modules/conta/empresa/ApartadosEmpresa'
import { ApartadoAsesoria } from '@/modules/conta/empresa/ApartadoAsesoria'
import { Actividades, EjercicioMeses, Socios } from '@/modules/conta/empresa/ApartadosActividad'
import { RegistroIA, Sugerencias } from '@/modules/conta/ia/PiezasIA'
import { ParaPresentar } from '@/modules/conta/empresa/ApartadoPresentar'
import { RegistroPlan } from '@/modules/conta/plan/RegistroPlan'
import { DeshacerTraido } from '@/modules/conta/plan/DeshacerTraido'
import { ApartadoCorte } from '@/modules/conta/empresa/ApartadoCorte'
import { ApartadoEnviarDiez } from '@/modules/conta/empresa/ApartadoEnviarDiez'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { ApartadoCierreDelDia } from '@/modules/conta/empresa/ApartadoCierreDelDia'
import { VerifactuAjustes } from '@/modules/conta/verifactu/VerifactuAjustes'
import { CobrosAjustes } from '@/modules/conta/ventas/CobrosAjustes'
import { CorreoFacturasAjustes } from '@/modules/conta/compras/CorreoFacturas'
import { ApuntarSoloAjustes } from '@/modules/conta/compras/ApuntarSoloAjustes'
import { ApartadoRoi } from '@/modules/conta/empresa/ApartadoRoi'
import { Resultado } from '@/modules/conta/empresa/campos'
import { ejercicioActual } from '@/modules/conta/empresa/datosEmpresa'
import { ApartadoHosteleria } from '@/modules/conta/empresa/ApartadoHosteleria'
import { ApartadoLogo } from '@/modules/conta/empresa/ApartadoLogo'
import { ApartadoColor } from '@/modules/conta/empresa/ApartadoColor'
import { Usuarios } from '@/modules/conta/ajustes/Usuarios'
import { useHosteleria } from '@/modules/conta/marco/nuevo/contexto'

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
  const hosteleria = useHosteleria()
  const { userName } = useCuentaConta()
  // C02c: lo que ha hecho «Deshacer entero» del plan traído, en una frase (el botón desaparece al recargar).
  const [aviso, setAviso] = useState<string | null>(null)
  const e = entradaAjustes(id)!
  const d = datos.datos
  const titulo = id === 'ejercicio' && d ? (() => { const ej = ejercicioActual(d.ejercicios, hoy); return ej ? `Ejercicio ${ej.code}` : 'Ejercicio' })() : e.etiqueta
  // En el ordenador, el título del panel solo donde la primera tarjeta no lo
  // repite (Tus impuestos, Socios y cargos, Ejercicio y Lo que ha hecho Folvy ya lo llevan arriba).
  const conTitulo = !['impuestos', 'socios', 'ejercicio', 'folvy'].includes(id)
  const cabeza = movil ? <CabeceraEntradaMovil titulo={titulo} /> : conTitulo ? <TituloPanel titulo={titulo} /> : null

  // V03 E2 · Verifactu (tablero 25): lleva su propio título y no necesita los datos de la empresa de Ajustes.
  if (id === 'verifactu') return <>{movil && cabeza}<VerifactuAjustes /></>
  // PC01 E4 · Cobros: los recordatorios; no necesita los datos de la empresa de Ajustes.
  if (id === 'cobros') return <>{cabeza}<CobrosAjustes /></>
  // S01c · Correo de facturas: la dirección, el reenvío de Gmail y lo que ha llegado; no necesita los datos de la empresa de Ajustes.
  if (id === 'correo-facturas') return <>{cabeza}<CorreoFacturasAjustes /></>
  // S01o · Apuntar solo lo seguro: el interruptor de la empresa; no necesita los datos de la empresa de Ajustes.
  if (id === 'apuntar-solo') return <>{cabeza}<ApuntarSoloAjustes /></>
  // DM1 · PR 1 · Usuarios: quién entra e «Invitar a una persona»; no necesita los datos de la empresa de Ajustes.
  if (id === 'personas') return <>{cabeza}<Usuarios /></>
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
            <div className="cx-columna">
              <Actividades {...p} />
              {/* S01: la marca de hostelería de la empresa, al lado de lo que hace. */}
              <ApartadoHosteleria {...p} />
              {/* S01: el logo de la empresa, el de la cabecera. */}
              <ApartadoLogo {...p} />
              <ApartadoColor quien={p.quien} movil={p.movil} />
            </div>
          </div>
        </>
      )
    case 'impuestos':
      return (
        <>
          {cabeza}
          <TusImpuestos {...p} />
          {/* S01o·2 · ¿Estás en el ROI? */}
          <ApartadoRoi quien={quien} movil={movil} />
          {/* P01 · La marca de la CUENTA: con ella sale Impuestos › Tus clientes. */}
          <ApartadoAsesoria quien={quien} movil={movil} />
          <ParaPresentar d={d} movil={movil} hoy={hoy} />
          <DetalleContable {...p} planActivo={plan.datos?.activo ?? false} />
        </>
      )
    case 'socios': return <>{cabeza}<Socios {...p} /></>
    // La hora de cierre del día es de pedidos: solo en una empresa de hostelería (inventario del S01, §3).
    // C07: «Enviar a Diez», junto a «Desde cuándo asienta» (solo en una empresa que trabaja con Diez).
    case 'ejercicio': return <>{cabeza}<EjercicioMeses {...p} /><ApartadoCorte quien={quien} movil={movil} alCambiar={datos.recargar} /><ApartadoEnviarDiez quien={quien} movil={movil} nombre={userName ?? null} />{hosteleria && <ApartadoCierreDelDia quien={quien} movil={movil} />}</>
    case 'folvy':
      return (
        <>
          {cabeza}
          <RegistroIA registro={d.ia.registro} alCambiar={datos.recargar} movil={movil} enElPlan={plan.datos?.registro.length ?? 0} />
          {aviso && <Resultado hecho={aviso} fallo={null} />}
          <RegistroPlan registro={plan.datos?.registro ?? []} accion={(r) => (r.que === 'importado' && plan.datos?.importacion
            ? <DeshacerTraido importacion={plan.datos.importacion} alDeshacer={(f) => { setAviso(f); plan.recargar() }} /> : null)} />
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
  // S01e: la dirección vieja de «Numeración» va a su tabla, donde se crean las series.
  if (entrada === 'numeracion') return <Navigate to={rutaTablasGenerales('numeracion')} replace />
  return (
    <MarcoAjustes entrada={entrada ?? null}>
      <Entrada id={entrada ?? 'empresa'} />
    </MarcoAjustes>
  )
}
