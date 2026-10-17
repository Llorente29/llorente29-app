// src/modules/conta/muestra/SistemaDisenoPage.tsx
//
// S01 · La página del sistema de diseño: cada token y cada componente de
// src/modules/conta/diseno, pintados con datos INVENTADOS escritos aquí (no se
// lee ni se escribe nada). Es lo que se mira antes de pasar una pantalla al
// esqueleto, y lo que prueba y captura la e2e del S01. Con ?marca=sumied se ve
// en Sumied; sin ella, en la marca del dominio.
//
// Solo se monta fuera de producción (module.tsx): no es una pantalla del producto.

import { useState } from 'react'
import {
  Boton, Campo, Chip, Cifra, Cinta, Dialogo, Fecha, GrupoCinta, ICONOS, Icono, Importe, Selector, Subcuenta, Tarjeta, TarjetaCifra, Texto,
  type NombreIcono, type TonoChip,
} from '@/modules/conta/diseno'

const COLORES: { token: string; nombre: string }[] = [
  { token: '--s-tinta', nombre: 'Tinta' }, { token: '--s-apoyo', nombre: 'Apoyo' }, { token: '--s-fondo', nombre: 'Fondo' },
  { token: '--s-superficie', nombre: 'Superficie' }, { token: '--s-suave', nombre: 'Suave' }, { token: '--s-borde', nombre: 'Borde' },
  { token: '--s-borde-campo', nombre: 'Borde de campo' }, { token: '--s-accion', nombre: 'Acción' }, { token: '--s-accion-suave', nombre: 'Acción suave' },
  { token: '--s-acento', nombre: 'Acento (solo fondo)' }, { token: '--s-ok-fondo', nombre: 'Seguro' }, { token: '--s-duda-fondo', nombre: 'Duda' },
  { token: '--s-falta-fondo', nombre: 'Falta' }, { token: '--s-barra', nombre: 'Barra' }, { token: '--s-barra-activo', nombre: 'Barra, activo' },
]
const LETRAS: { token: string; texto: string }[] = [
  { token: '--s-t-titulo', texto: 'Título de página · 24' }, { token: '--s-t-xl', texto: 'Título de tarjeta · 18' },
  { token: '--s-t-l', texto: 'Título de bloque · 16' }, { token: '--s-t-m', texto: 'Texto, botones y campos · 14' },
  { token: '--s-t-s', texto: 'Apoyo y chips · 13' }, { token: '--s-t-xs', texto: 'CABECERAS DE TABLA Y GRUPOS · 12' },
]
const CHIPS: { tono: TonoChip; texto: string }[] = [
  { tono: 'seguro', texto: 'Seguro' }, { tono: 'duda', texto: 'Duda: ¿retención 19 %?' }, { tono: 'falta', texto: 'Falta el documento' },
  { tono: 'neutro', texto: 'Vence 16/11' }, { tono: 'accion', texto: 'Medio' }, { tono: 'oscuro', texto: 'Experto' },
]
const FILAS = [
  { fecha: '16/10', tipo: 'Recibida', concepto: 'Proveedor de ejemplo · F-2026-0412', apoyo: 'llegó por correo · PDF leído', importe: 482.89, chip: CHIPS[0] },
  { fecha: '16/10', tipo: 'Expedida', concepto: 'Resumen de ventas del día', apoyo: 'desde los tickets · 54 tickets', importe: 1240.5, chip: CHIPS[0] },
  { fecha: '15/10', tipo: 'Recibida', concepto: 'Alquiler del local · octubre', apoyo: 'recurrente · lleva retención', importe: 1815, chip: CHIPS[1] },
  { fecha: '14/10', tipo: 'Tesorería', concepto: 'Transferencia sin factura', apoyo: 'desde el banco', importe: 300, chip: CHIPS[2] },
]

export default function SistemaDisenoPage() {
  const [texto, setTexto] = useState('Proveedor de ejemplo S.A.')
  const [importe, setImporte] = useState('438,99')
  const [fecha, setFecha] = useState('2026-10-16')
  const [cuenta, setCuenta] = useState('60000001')
  const [subcuenta, setSubcuenta] = useState('')
  const [local, setLocal] = useState('L9')
  const [cintaOculta, setCintaOculta] = useState(false)
  const [dialogo, setDialogo] = useState(false)
  const [hecho, setHecho] = useState<string | null>(null)

  return (
    <div className="s-raiz s-muestra">
      <header className="s-muestra-cabeza">
        <h1 className="s-muestra-titulo">Sistema de diseño</h1>
        <p className="s-muestra-apoyo">Los tokens y los componentes de contabilidad, con datos inventados: no se lee ni se guarda nada. Solo existe fuera de producción.</p>
      </header>

      <Cinta etiqueta="Acciones de Asientos" oculta={cintaOculta} alCambiarOculta={setCintaOculta}>
        <GrupoCinta titulo="Nuevo">
          <Boton icono="expedida">Expedida</Boton><Boton icono="recibida">Recibida</Boton>
          <Boton icono="tesoreria">Tesorería</Boton><Boton icono="general">General</Boton><Boton icono="predefinidos">Predefinidos</Boton>
        </GrupoCinta>
        <GrupoCinta titulo="Revisar">
          <Boton aria-pressed="true" contador={12}>Para revisar</Boton><Boton>Libro diario</Boton><Boton icono="vigilancia">Vigilancia</Boton>
        </GrupoCinta>
        <GrupoCinta titulo="Utilidades">
          <Boton>Búsqueda</Boton><Boton>Digitalizar</Boton><Boton>Anular</Boton>
        </GrupoCinta>
      </Cinta>

      <div className="s-muestra-cuerpo">
        <Tarjeta titulo="Colores" apoyo="Los de la marca que se está viendo. Ninguna pantalla escribe un color: usa estos nombres.">
          <ul className="s-muestra-rejilla" aria-label="Colores">
            {COLORES.map((c) => (
              <li key={c.token} className="s-muestra-color">
                <span className="s-muestra-muestra" style={{ background: `var(${c.token})` }} aria-hidden="true" />
                <span>{c.nombre}</span><code>{c.token}</code>
              </li>
            ))}
          </ul>
        </Tarjeta>

        <Tarjeta titulo="Letra" apoyo="Una sola familia (Inter en Sumied), cifras tabulares en los importes.">
          {LETRAS.map((l) => <p key={l.token} className="s-muestra-letra" style={{ fontSize: `var(${l.token})` }}>{l.texto}</p>)}
          <p className="s-muestra-letra"><Cifra valor={1240.5} /> · <Cifra valor={-121} /> · <Cifra valor={438.99} lado="D" /> · <Cifra valor={null} /> · <Cifra valor={18420} exacta={false} grande /></p>
        </Tarjeta>

        <Tarjeta titulo="Botones" apoyo="Uno principal por pantalla. La tecla va dibujada y en aria-keyshortcuts.">
          <div className="s-muestra-fila">
            <Boton variante="principal" tecla="↵" atajo="Enter" onClick={() => setHecho('Validada (de muestra: no se escribe nada).')}>Validar y siguiente</Boton>
            <Boton icono="anterior">Anterior</Boton>
            <Boton>No es una factura</Boton>
            <Boton variante="enlace">Ver el correo</Boton>
            <Boton variante="fantasma" icono="plegar">Ocultar</Boton>
            <Boton disabled>Sin permiso</Boton>
          </div>
          <div className="s-muestra-fila"><Boton variante="principal" grande>Validar los 9 seguros</Boton></div>
          <div role="status" aria-live="polite" className="s-muestra-aviso">{hecho}</div>
        </Tarjeta>

        <Tarjeta titulo="Campos" apoyo="Etiqueta encima; debajo, la ayuda, la duda o lo que falta.">
          <div className="s-muestra-campos">
            <Campo etiqueta="Proveedor">{(p) => <Texto {...p} valor={texto} alCambiar={setTexto} />}</Campo>
            <Campo etiqueta="Base" ayuda="Al salir se escribe con sus céntimos.">{(p) => <Importe {...p} valor={importe} alCambiar={setImporte} />}</Campo>
            <Campo etiqueta="Fecha factura">{(p) => <Fecha {...p} valor={fecha} alCambiar={setFecha} />}</Campo>
            <Campo etiqueta="Cuenta de gasto">{(p) => (
              <Selector {...p} valor={cuenta} alCambiar={setCuenta}
                opciones={[{ valor: '60000001', texto: '60000001 · Compras de mercaderías' }, { valor: '62100000', texto: '62100000 · Arrendamientos' }]} />
            )}</Campo>
            <Campo etiqueta="Local" aviso="Lo guardado ya no está entre los locales que se ofrecen: sale igual y lo dice.">{(p) => (
              <Selector {...p} valor={local} alCambiar={setLocal} textoGuardado="Local 9 (cerrado)"
                opciones={[{ valor: 'L1', texto: 'Local 1' }, { valor: 'comun', texto: 'Común' }]} />
            )}</Campo>
            <Campo etiqueta="Cuenta de pago" error={subcuenta === '' ? 'Falta la cuenta de pago: escribe «57.1» y sale 57000001.' : null}>
              {(p) => <Subcuenta {...p} valor={subcuenta} alCambiar={setSubcuenta} />}
            </Campo>
          </div>
        </Tarjeta>

        <Tarjeta titulo="Chips" apoyo="El color nunca va solo: el texto dice lo mismo.">
          <div className="s-muestra-fila">{CHIPS.map((c) => <Chip key={c.tono} tono={c.tono}>{c.texto}</Chip>)}</div>
        </Tarjeta>

        <Tarjeta titulo="Iconos" apoyo="lucide, 16 px, trazo 1,75. Por nombre: ninguna pantalla elige un dibujo suelto.">
          <ul className="s-muestra-rejilla" aria-label="Iconos">
            {(Object.keys(ICONOS) as NombreIcono[]).map((n) => <li key={n} className="s-muestra-icono"><Icono nombre={n} /><code>{n}</code></li>)}
          </ul>
        </Tarjeta>

        <div className="s-muestra-cifras">
          <TarjetaCifra etiqueta="Banco hoy"><Cifra valor={24310.4} exacta={false} /></TarjetaCifra>
          <TarjetaCifra etiqueta="Pendiente de cobrar"><Cifra valor={3630} exacta={false} /></TarjetaCifra>
          <TarjetaCifra etiqueta="Vencidas" tono="duda">1 · <Cifra valor={2420} exacta={false} /></TarjetaCifra>
          <TarjetaCifra etiqueta="Verifactu" tono="ok" texto>Todo enviado a la AEAT</TarjetaCifra>
        </div>

        <Tarjeta compacta titulo="Para revisar · 12" apoyo="La IA los ha preparado; tú solo confirmas o corriges."
          accion={<Boton variante="principal" onClick={() => setDialogo(true)}>Validar los 9 seguros</Boton>}>
          <table className="s-tabla" aria-label="Para revisar">
            <thead><tr><th>Fecha</th><th>Tipo</th><th>Concepto</th><th className="s-tabla-cifra">Importe</th><th>La IA dice</th></tr></thead>
            <tbody>
              {FILAS.map((f) => (
                <tr key={f.concepto}>
                  <td>{f.fecha}</td><td>{f.tipo}</td>
                  <td><Boton variante="enlace">{f.concepto}</Boton><span className="s-tabla-apoyo">{f.apoyo}</span></td>
                  <td className="s-tabla-cifra"><Cifra valor={f.importe} /></td>
                  <td><Chip tono={f.chip.tono}>{f.chip.texto}</Chip></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Tarjeta>

        <div className="s-muestra-dos">
          <Tarjeta nivel={2} titulo="Numeración sin huecos" tono="ok">Correcta · Código de Comercio, art. 29</Tarjeta>
          <Tarjeta nivel={2} titulo="Retención del alquiler" tono="duda">Alquiler de local: lleva retención del 19 % · RD 439/2007, arts. 75 y 101</Tarjeta>
        </div>
      </div>

      {dialogo && (
        <Dialogo titulo="Validar los 9 seguros" explicacion="Se validan los 9 que la IA marca como seguros. Los 3 con duda o con algo que falta se quedan para ti."
          alCerrar={() => setDialogo(false)}
          acciones={<>
            <Boton onClick={() => setDialogo(false)}>Cancelar</Boton>
            <Boton variante="principal" onClick={() => { setDialogo(false); setHecho('Validados 9 asientos; quedan 3 para revisar (de muestra: no se escribe nada).') }}>Validar 9</Boton>
          </>} />
      )}
    </div>
  )
}
