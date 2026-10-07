# Encargo C04 — Libro diario (asientos que se hacen solos, por local y marca)

> Copia de trabajo del encargo de Julio (06/10/2026). El texto íntegro está en la
> conversación; aquí va el índice que se sigue tarea a tarea. Maquetas en
> `docs/conta/maquetas/c04/`. Comprobaciones previas en
> `docs/conta/C04_comprobaciones_previas.md`.

Rama `conta/c04-libro-diario`, desde `main` (lleva C00–C03 y los PR #157–#159).
PR en borrador desde el primer commit. Una cosa cada vez; lo que surja fuera, al
PR como pendiente. Nada en producción hasta el visto bueno de Julio; después,
migraciones por el workflow (ensayo, real, `autorizo` si algo para) antes de
fusionar, y fusión con Vercel READY. Vista previa con variables de rama hacia
staging-conta comprobadas antes de darla por lista.

1. Para qué: cada venta, compra, liquidación, nómina y pago asentado en un diario
   que cuadra siempre, con su documento; asientos que se hacen solos con
   confianza y porqué; local y marca en cada apunte; vale igual para una
   ferretería (lo de hostelería aparece solo si la empresa lo tiene).
2. Contraste: Holded, Cegid Diez, Pennylane, Digits/Puzzle.
3. Hechos de negocio: desde 2023 (C04b trae Diez); ventas propias a 70x y
   cedidas por la liquidación del socio; resultado por local (y marca); nóminas
   de la gestoría; impuestos los presenta la aplicación; socios con resumen mensual.
4. Norma: CCom 25–30 (28.2, 29, 30), Ley 14/2013 art. 18; RIVA 62–69 (63.4,
   64.5); LIVA 8.Dos.6º, 11.Dos.15º, 78.Tres.3º, 91.Uno.2.2º; PGC NRV 14.ª;
   Ley 35/2006 y RD 439/2007; LGT 29.2.j y RD 1007/2023; PGC apertura,
   regularización y cierre.
5. Modelo: `fiscal_year`, `period_lock`, `journal_entry`, `journal_line`,
   `allocation_rule`, `sales_summary`, generadores por origen, manual y
   predefinidos, anulación, traído de Diez, Mayor leyendo del libro.
6. Reglas 1–13 (núcleo puro con pruebas).
7. Diseño: N11 (libro), N12 (asiento), móvil por niveles, estados, capturas y
   `docs/conta/capturas/c04/COMPARACION.md` con semillas inventadas.
8. Agente «Libro diario» a las 03:40 (staging y producción en solo lectura).
9. Pruebas: unitarias, migración (antes = después, vuelta atrás), e2e A y B
   (ordenador y móvil), RLS, `antes-de-subir.sh`.
10. Tareas: (1) comprobaciones previas y parar; (2) modelo y migraciones;
    (3) núcleo; (4) pantallas; (5) agente, e2e, RLS, contraste, informe.
11. Entrega: vista previa A y B → «fusiona» → workflow → fusión con Vercel
    READY → comprobación en solo lectura. Después Foodint asienta desde octubre
    de 2026; C04b justo detrás.
