# Cheeky Reader

Cheeky Reader is a private, offline-first Expo mobile document reader for local PDF, EPUB, and TXT files.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- `pnpm --filter @workspace/bussy-reader run dev` — run the Expo mobile preview
- `pnpm --filter @workspace/bussy-reader run typecheck` — typecheck the mobile app

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/bussy-reader/app/index.tsx` — local library screen, import flow, sorting, layout, and preferences
- `artifacts/bussy-reader/app/reader/[id].tsx` — reader surface, progress restore, bookmarks, and read-aloud controls
- `artifacts/bussy-reader/components/PdfReaderView.tsx` — native URI-backed PDF page renderer and page/text event bridge
- `artifacts/bussy-reader/modules/bussy-reader-pdf/` — local Expo native module for page-scoped PDF opening, rendering, text extraction, and cleanup
- `artifacts/bussy-reader/lib/pdfjs-source.ts` — bundled PDF.js runtime source used by the WebView
- `artifacts/bussy-reader/context/LibraryContext.tsx` — AsyncStorage metadata and local file persistence
- `artifacts/bussy-reader/constants/colors.ts` — app palette

## Architecture decisions

- The first build is frontend-only and intentionally does not use the shared API or database; documents and metadata remain on-device.
- Imported files are copied into the app's document directory before they are added to the library, so the library does not depend on a picker cache.
- Reading progress and bookmarks are persisted after reader movement and restore when the document is reopened.
- The app targets a coherent Expo SDK 54 dependency graph. Expo SDK 54's current toolchain requires React 19.1 and React Native 0.81.5; keeping React 18 / React Native 0.76 causes Metro and Expo Go incompatibilities.
- PDFs render locally through the `bussy-reader-pdf` Expo native module. The module keeps the local URI native, renders one page at a time, extracts one page of text at a time, and exposes explicit session cleanup; JavaScript never receives a complete PDF buffer.

## Product

The app provides a private shelf for local documents, grid/list browsing with sorting, a reader overlay with themes and typography controls, progress restoration, bookmarks, screen-awake mode, and offline read-aloud controls.

## User preferences

- Keep document content and reading metadata local to the device; do not add network sync without an explicit request.

## Gotchas

- `expo-file-system` uses the `/legacy` import for the classic document-directory APIs used by local import and deletion.
- Keep the Expo SDK 54 package graph aligned; do not reintroduce the older React 18 / React Native 0.76 combination because it causes duplicate modules and phone bundle failures.
- Thumbnail generation still uses bounded PDF.js range reads, but thumbnail parser, timeout, and write failures must resolve to a missing cover so the library can persist the imported book.
- The reader PDF module is a native-only capability in development builds; Expo Go/web previews use the existing unsupported/error path rather than silently buffering the full file.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
