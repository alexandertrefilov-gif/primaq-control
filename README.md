# PrimaQ Control

## E2E-Regression

Lokale App starten:

```bash
npm run dev
```

Playwright-Regression ausführen:

```bash
npm run test:e2e
```

Der E2E-Test löscht vor dem Szenario den Browser-LocalStorage und setzt definierte Testdaten. Dadurch hängt der Test nicht von alten lokalen Browserdaten ab.
