# AstroPlanner Signal Dataset Builder

To narzędzie developerskie R&D. **Nie jest uruchamiane w PWA** i nie zmienia danych użytkownika.

Buduje ilościową warstwę Hα z dwóch niezależnych ścieżek:

1. **HII / mgławice emisyjne / SNR** — pomiar na pełnosferycznej mapie Hα Finkbeinera (WHAM + VTSS + SHASSA), Nside=512, 6′ FWHM. Dla każdego celu zapisywane są statystyki apertury i lokalnego tła; brak detekcji nie jest zamieniany na zero.
2. **Mgławice planetarne** — HASH / VizieR `V/163`, wyłącznie Galactic PN o statusie T/L/P i z opublikowanym `logFHa`. Gdy dostępny jest rozmiar kątowy, z całkowitego strumienia Hα wyliczana jest średnia jasność powierzchniowa i równoważna wartość w Rayleighach.

Generator **nie zgaduje OIII**, nie zmienia Score i nie zapisuje wyników do repozytorium. Wynik służy do audytu i do późniejszego, osobno kalibrowanego patcha runtime.

## Ograniczenie czasu

Każde pobranie ma timeout i maksymalnie 2 ponowienia. Workflow GitHub Actions ma limit 15 minut. Nie ma nieskończonych retry.

## Wyniki

Workflow tworzy artefakt `astroplanner-signal-data` zawierający:

- `target-signal-data.json`
- `signal-data-audit.json`
- `signal-data-audit.md`

## Źródła

- Finkbeiner 2003 / NASA LAMBDA: Composite All-Sky H-alpha, WHAM + VTSS + SHASSA, 6′.
- HASH planetary-nebula database / VizieR V/163, Parker, Bojičić & Frew.
- `acocalypso/celestia_atlas`, commit `ef52c7ea920191d45fe0da4711dd3b1cc9220c18`, jako ta sama warstwa identyfikacji/geometrii, którą wykorzystuje AstroPlanner.

Przed promocją jakiegokolwiek datasetu opartego o VizieR/HASH do publicznej wersji produkcyjnej należy osobno zweryfikować warunki redystrybucji danych. R&D generator przechowuje pełną proweniencję źródeł.
