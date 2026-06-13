# PrimaQ Control Architecture

## Zielbild Phase 1

PrimaQ Control ist als mobile-first PWA fuer einen Softeis-Verkaufsbetrieb angelegt. Die technische Struktur trennt Routen, UI-Komponenten, fachliche Feature-Module, Typen und Datenbankzugriff.

## Hauptbereiche

- `src/app`: Next.js App Router mit den Dashboard-Seiten.
- `src/components`: Wiederverwendbare Navigation und UI-Bausteine.
- `src/features`: Fachliche Module fuer Einsatz, Verkauf, Lager, Tagesabschluss, Berichte und Einstellungen.
- `src/lib/supabase`: Supabase-Client und Datenbanktypen.
- `src/types`: Gemeinsame Domain-Typen.
- `supabase/migrations`: PostgreSQL-Schema fuer spaetere Supabase-Nutzung.
- `public`: PWA-Manifest und App-Icon.

## Datenmodell vorbereitet

Das Startschema deckt Einsaetze, Teammitglieder, Verkaufsvorgaenge, Softeis-Zaehler, Warenbewegungen und Tagesabschluesse ab. Steuerberater-Export ist ueber `day_closes.export_ready` und exportfreundliche Tagesdaten vorbereitet, aber noch nicht fachlich umgesetzt.
