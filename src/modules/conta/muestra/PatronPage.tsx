// src/modules/conta/muestra/PatronPage.tsx
//
// S02 · La muestra del patrón único: las seis plantillas (Bandeja, Lista,
// Ficha, Informe, Asistente y Hoja de líneas), los colores con nombre y los
// estados que tienen que existir (cargando, vacío, error con «Reintentar» y
// guardado), pintados con datos INVENTADOS escritos aquí (no se lee ni se
// escribe nada). Sustituye a las dos muestras de antes (la de las piezas del
// M01 y la del sistema de diseño del S01): una sola página, como un solo
// patrón. Es lo que se mira antes de mudar una pantalla.
//
// Solo se monta fuera de producción (module.tsx): no es una pantalla del producto.

import { useState } from 'react'
import { Boton, Chip, Tecla, type TonoChip } from '@/modules/conta/diseno'
import {
  AsientoQueSeCrea, Asistente, Bandeja, BloqueAsistente, BloqueFicha, CampoFicha, Casilla, CifrasBandeja, ComprobacionInforme, ControlesInforme,
  DeDondeSale, DocumentoFicha, FiltroBuscar, FiltroSelector, FiltrosLista, Ficha, FilaCampos, HechoAutomatico, HojaDeLineas, LeyendaCasillas,
  NavegaFicha, PasosAsistente, PestanasEstado, PieAsistente, TablaInforme, TablaLista, TeTocaHoy, Veredicto, VistaInforme, pestanasConTodas,
  type ColumnaLista,
} from '@/modules/conta/diseno/plantillas'
import { EncabezadoPagina } from '@/modules/conta/marco/EncabezadoPagina'
import { useIsMobile } from '@/shell/useIsMobile'

const COLORES: { token: string; nombre: string }[] = [
  { token: '--s-tinta', nombre: 'Títulos · #172443' }, { token: '--s-apoyo', nombre: 'Apoyo · #4A5B73' }, { token: '--s-fondo', nombre: 'Fondo · #F4F7FB' },
  { token: '--s-borde-decorativo', nombre: 'Bordes · #DCE5F0' }, { token: '--s-borde-control', nombre: 'Campos · #7F8FA6' }, { token: '--s-accion', nombre: 'Acción · #1E63C9' },
  { token: '--s-propuesto', nombre: 'Propuesto · #EAF9F8' }, { token: '--s-duda-fondo', nombre: 'Por revisar · #FFF1DC' }, { token: '--s-ok-fondo', nombre: 'Hecho · #E6F4EA' },
  { token: '--s-barra', nombre: 'Barra · #0B1F3B' },
]
const ESTADOS: { tono: TonoChip; texto: string }[] = [
  { tono: 'propuesto', texto: 'Propuesto' }, { tono: 'duda', texto: 'Por revisar' }, { tono: 'seguro', texto: 'Hecho' }, { tono: 'neutro', texto: 'Por pagar' },
]

interface Fila { id: string; fecha: string; proveedor: string; numero: string; total: string; estado: { texto: string; tono: TonoChip } }
const FILAS: Fila[] = [
  { id: '1', fecha: '19/10', proveedor: 'Distribuciones Ejemplo, S.L.', numero: 'A-2610/112', total: '149,44 €', estado: { texto: 'Por revisar', tono: 'duda' } },
  { id: '2', fecha: '14/10', proveedor: 'Panadería de Muestra, S.A.', numero: 'T0626/657', total: '248,61 €', estado: { texto: 'Por pagar', tono: 'neutro' } },
  { id: '3', fecha: '13/10', proveedor: 'Bebidas Inventadas, S.L.', numero: '24048027', total: '110,87 €', estado: { texto: 'Pagada', tono: 'seguro' } },
]

export default function PatronPage() {
  const movil = useIsMobile()
  const [pestana, setPestana] = useState('por-revisar')
  const [q, setQ] = useState('')
  const [vista, setVista] = useState<'oficial' | 'detallada' | 'local'>('oficial')
  const [doc, setDoc] = useState(false)
  const columnas: ColumnaLista<Fila>[] = [
    { id: 'fecha', titulo: 'Fecha', celda: (f) => f.fecha },
    { id: 'proveedor', titulo: 'Proveedor', celda: (f) => <strong>{f.proveedor}</strong> },
    { id: 'numero', titulo: 'Nº de factura', celda: (f) => f.numero },
    { id: 'total', titulo: 'Total', cifra: true, celda: (f) => f.total },
    { id: 'estado', titulo: 'Estado', celda: (f) => <Chip tono={f.estado.tono}>{f.estado.texto}</Chip> },
  ]
  return (
    <div className="s-pagina">
      <EncabezadoPagina titulo="El patrón único" sinMigas
        frase="Una sola forma de estar en Sumied: el marco, las seis plantillas y las reglas. Datos inventados: aquí no se lee ni se escribe nada."
        secundarios={<Boton>Un botón blanco</Boton>} principal={<Boton variante="principal">El único principal</Boton>} />

      <section className="s-tarjeta-blanca s-muestra" aria-label="Colores con nombre">
        <h2>Colores con nombre</h2>
        <ul className="s-muestra-colores">
          {COLORES.map((c) => <li key={c.token}><span className="s-muestra-color" style={{ background: `var(${c.token})` }} aria-hidden="true" />{c.nombre}<code>{c.token}</code></li>)}
        </ul>
        <p className="s-muestra-estados">{ESTADOS.map((e) => <Chip key={e.texto} tono={e.tono}>{e.texto}</Chip>)} <Tecla>Intro</Tecla> <Tecla>Ctrl K</Tecla></p>
      </section>

      <h2 className="s-muestra-titulo">1 · Bandeja</h2>
      <Bandeja
        cifras={<CifrasBandeja cifras={[
          { etiqueta: 'En tus bancos', valor: '1.496,17 €', apoyo: 'Banco Ejemplo ···0133', a: '#' },
          { etiqueta: 'Te deben', valor: '19.944,75 €', apoyo: 'Clientes y plataformas', a: '#' },
          { etiqueta: 'Debes', valor: '43.148,20 €', apoyo: 'Proveedores y acreedores', a: '#' },
          { etiqueta: 'IVA del 4.º trimestre', valor: '1.510,03 €', apoyo: 'A pagar, calculado hoy', a: '#' },
        ]} />}
        principal={<TeTocaHoy filas={[
          { id: 'f', icono: 'compras', titulo: '9 facturas recibidas por revisar', apoyo: 'Compras y gastos · Sumied ha propuesto la cuenta de las 9', n: 9, a: '#' },
          { id: 'b', icono: 'bancos', titulo: '24 movimientos del banco por aclarar', apoyo: 'Bancos', n: 24, a: '#' },
        ]} />}
        lateral={<HechoAutomatico verTodo="#" lotes={[{ id: 'l', texto: 'Casó 6 movimientos del banco con sus facturas.', ver: '#', deshacer: { texto: 'Deshacer los 6', alPulsar: () => undefined } }]} />}
      />

      <h2 className="s-muestra-titulo">2 · Lista</h2>
      <PestanasEstado etiqueta="Estado" actual={pestana} alCambiar={setPestana}
        pestanas={pestanasConTodas([{ id: 'por-revisar', etiqueta: 'Por revisar', n: 1, siempre: true }, { id: 'por-pagar', etiqueta: 'Por pagar', n: 1, siempre: true }, { id: 'pagadas', etiqueta: 'Pagadas', n: 1, siempre: true }])} />
      <FiltrosLista>
        <FiltroBuscar valor={q} alCambiar={setQ} placeholder="Proveedor, número o importe" />
        <FiltroSelector etiqueta="Fecha" valor="" alCambiar={() => undefined} opciones={[{ valor: '', texto: 'Octubre' }]} />
      </FiltrosLista>
      <TablaLista<Fila> etiqueta="Lista de muestra" columnas={columnas} filas={FILAS} clave={(f) => f.id} nombre={(f) => f.proveedor} alAbrir={() => undefined}
        filaActual="2" movil={movil} tarjeta={(f) => <><strong>{f.proveedor}</strong><span className="s-tarjeta-apoyo">{f.numero} · {f.fecha}</span></>}
        vacio="Todo al día." pie={<><span>3 facturas</span><span className="s-lista-pie-totales"><span>Total <strong>508,92 €</strong></span></span></>} />
      <TablaLista<Fila> etiqueta="Lista vacía" columnas={columnas} filas={[]} clave={(f) => f.id} nombre={(f) => f.proveedor} alAbrir={() => undefined}
        movil={movil} tarjeta={() => null} vacio={<><strong>Todo al día.</strong> No queda ninguna por revisar. <Boton variante="enlace">Subir factura</Boton></>} />
      <div className="s-lista-cargando" aria-label="Así se ve cargando" />
      <p className="s-aviso-lista" data-tono="falta" role="alert">Así se ve un error: no se han podido leer. <Boton variante="enlace">Reintentar</Boton></p>
      <p className="s-aviso-lista" data-tono="ok">Así se ve lo guardado: «Validada. Ya está en tu contabilidad».</p>

      <h2 className="s-muestra-titulo">3 · Ficha</h2>
      <NavegaFicha pos={3} total={9} anterior={() => undefined} siguiente={() => undefined} />
      <Ficha documentoOculto={doc}
        datos={<>
          <Veredicto tipo="lista" titulo="Lista para contabilizar" porque="El proveedor, el IVA y la cuenta coinciden con sus facturas anteriores, y los importes del PDF cuadran."
            detalle={[{ ok: true, texto: 'Cuadra: bases + IVA = total, al céntimo.' }, { ok: null, texto: 'Cuenta de gasto: la de su ficha.' }]} />
          <BloqueFicha titulo="Proveedor y factura">
            <FilaCampos>
              <CampoFicha etiqueta="Proveedor" valor="Bebidas Inventadas, S.L." tono="ok" marca="NIF de su ficha" />
              <CampoFicha etiqueta="Nº de factura" valor="24048027" />
              <CampoFicha etiqueta="Fecha de la factura" valor="13/10/2026" />
            </FilaCampos>
          </BloqueFicha>
          <BloqueFicha titulo="A qué gasto va">
            <FilaCampos columnas={2}>
              <CampoFicha etiqueta="Gasto" valor="Compras de mercaderías" codigo="60000001" tono="propuesto" motivo="Lo usaste en sus facturas anteriores." />
              <CampoFicha etiqueta="Local" valor="Sin decir" tono="revisar" motivo="No sé de qué local es: dímelo." />
            </FilaCampos>
          </BloqueFicha>
          <AsientoQueSeCrea nota="Al validar se envía también a Diez" lineas={[
            { nombre: 'Compras de mercaderías', codigo: '60000001', debe: '100,79', haber: null },
            { nombre: 'IVA soportado', codigo: '472', debe: '10,08', haber: null },
            { nombre: 'Bebidas Inventadas, S.L.', codigo: '400', debe: null, haber: '110,87' },
          ]} />
        </>}
        documento={<DocumentoFicha titulo="24048027.pdf" oculto={doc} alOcultar={setDoc}><p className="s-documento-nada">Aquí va el PDF, grande.</p></DocumentoFicha>} />

      <h2 className="s-muestra-titulo">4 · Informe</h2>
      <ControlesInforme>
        <FiltroSelector etiqueta="Periodo" valor="" alCambiar={() => undefined} opciones={[{ valor: '', texto: 'Enero a septiembre 2026' }]} />
        <VistaInforme vistas={[{ id: 'oficial', nombre: 'Oficial' }, { id: 'detallada', nombre: 'Detallada' }, { id: 'local', nombre: 'Por local' }]} actual={vista} alCambiar={setVista} />
      </ControlesInforme>
      <ComprobacionInforme cuadra><strong>Cuadra con sumas y saldos.</strong> Datos de ejemplo.</ComprobacionInforme>
      <TablaInforme etiqueta="Pérdidas y ganancias de muestra" columnas={['2026', '2025']} lineas={[
        { id: 'v', calle: 'Ventas', oficial: '1. Importe neto de la cifra de negocios', valores: ['612.480,15', '548.902,33'], cuentas: [{ nombre: 'Ventas de mercaderías', codigo: '70000000', valores: ['598.215,40', '536.110,08'] }] },
        { id: 'r', calle: 'Resultado del negocio', oficial: 'A.1 Resultado de explotación', valores: ['67.438,13', '52.306,76'], total: true },
      ]} />

      <h2 className="s-muestra-titulo">5 · Asistente</h2>
      <Asistente
        pasos={<PasosAsistente pasos={[{ id: '1', titulo: 'Comprobar los libros', apoyo: 'Todo revisado', estado: 'hecho' }, { id: '2', titulo: 'Revisar las casillas', apoyo: 'Estás aquí', estado: 'actual' }, { id: '3', titulo: 'Cómo pagas', estado: 'pendiente' }]} />}>
        <LeyendaCasillas />
        <BloqueAsistente titulo="IVA que has cobrado en tus ventas" verificado>
          <p>Al 10 % <Casilla numero="04" valor="172.350,00" origen="libros" etiqueta="Base al 10 %" /> <DeDondeSale a="#" /></p>
        </BloqueAsistente>
        <PieAsistente atras={<Boton>Atrás</Boton>} guardar={<Boton variante="enlace">Guardar y seguir luego</Boton>} siguiente={<Boton variante="principal">Siguiente: cómo pagas</Boton>} />
      </Asistente>

      <h2 className="s-muestra-titulo">6 · Hoja de líneas</h2>
      <HojaDeLineas cabecera={<><span>Fecha · 05/10/2026</span><span>Concepto · Cuota del préstamo</span><span>Documento · opcional</span></>}
        columnas={[{ titulo: 'Cuenta' }, { titulo: 'Debe', cifra: true }, { titulo: 'Haber', cifra: true }]}
        totales={{ debe: '908,75', haber: '908,75' }} cuadra alAnadir={() => undefined}
        enPalabras="Pagas 908,75 € desde el banco. De eso, 812,45 € devuelven parte del préstamo y 96,30 € son intereses."
        aviso="El banco ya tiene un cargo de 908,75 € del 05/10 sin casar: al guardar, Sumied los une.">
        <tr><td>1</td><td>Préstamos a corto plazo <span className="s-campo-ficha-codigo">52000000</span></td><td className="s-lista-cifra">812,45</td><td /></tr>
        <tr><td>2</td><td>Intereses de préstamos <span className="s-campo-ficha-codigo">66230000</span></td><td className="s-lista-cifra">96,30</td><td /></tr>
        <tr><td>3</td><td>Banco Ejemplo ···0133 <span className="s-campo-ficha-codigo">57200001</span></td><td /><td className="s-lista-cifra">908,75</td></tr>
      </HojaDeLineas>
    </div>
  )
}
