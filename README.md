# Andy App — Código Fuente

Panel de  control  para hostelería. Construido con React + TypeScript + Vite + Tailwind CSS.

## Estructura

```
src/
├── types/index.ts          # Tipos TypeScript globales
├── context/AppContext.tsx  # Estado global (localStorage)
├── components/ui.tsx       # Componentes UI reutilizables
├── pages/
│   ├── StaffPage.tsx       # Módulo Personal completo
│   ├── FichajesGlobalPage.tsx  # Control Horario global
│   ├── InformesPage.tsx    # Informes Gestoría
│   └── OtherPages.tsx      # Dashboard + páginas en migración
└── App.tsx                 # Shell, sidebar, routing
```

## Desarrollo

```bash
npm install
npm run dev
```

## Deploy

```bash
npm run build
# Copiar dist/ a la rama main del repo
```

## Ramas

- `main` — Build compilado (GitHub Pages)
- `source` — Este código fuente TypeScript
