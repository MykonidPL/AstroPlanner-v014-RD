AstroPlanner v0.14 R&D — repozytorium testowe

Nazwa repozytorium:
MykonidPL/AstroPlanner-v014-RD

Baza:
- dokładny stan produkcyjnego AstroPlannera v0.13.1 z commita 475b010e296a35d7eb6e3d702eb5960932649644,
- dodany automatyczny wskaźnik Bortle dla wybranej lokalizacji,
- produkcyjne repozytorium MykonidPL/AstroPlanner pozostaje bez zmian.

Instalacja:
1. Utwórz nowe repo AstroPlanner-v014-RD.
2. Wgraj całą zawartość tej paczki bezpośrednio do root repozytorium.
3. Nie twórz dodatkowego folderu nadrzędnego.
4. Zrób commit.
5. W Settings -> Pages ustaw publikację z branch main / root, jeśli Pages nie jest jeszcze aktywne.
6. Otwórz GitHub Pages -> Visit site.

Izolacja R&D:
- localStorage używa osobnej przestrzeni nazw aprd014:,
- snapshoty projektów mają osobny IndexedDB astroplanner-v014-rd-project-snapshots,
- cache statyczny PWA to astroplanner-v014-rd-bortle1,
- R&D nie powinno modyfikować lokalnych danych produkcyjnego AstroPlannera.

Jeśli chcesz testować v0.14 na kopii prawdziwych danych, wyeksportuj JSON z produkcji i zaimportuj go w R&D. Import zapisze dane wyłącznie w przestrzeni R&D.

Bortle:
- po wyborze zapisanej lokalizacji, wpisaniu współrzędnych lub użyciu GPS pojawia się prosty wskaźnik „Bortle ≈ X”,
- wynik jest przybliżeniem; nie jest pomiarem SQM na miejscu,
- wynik jest buforowany lokalnie przez 30 dni,
- błąd sieci/API nie blokuje aplikacji.

Smoke test po pierwszym uruchomieniu:
1. Planner otwiera się poprawnie.
2. Wybór obiektu -> DSS2 -> FOV/rotacja/mozaika działa jak w produkcji.
3. Zapis projektu, sesje, Dziennik i Sprzęt działają.
4. Bortle reaguje na zapisaną lokalizację.
5. Bortle reaguje na ręczne współrzędne.
6. Bortle reaguje na GPS.
7. Po zamknięciu i ponownym wejściu R&D zachowuje własne dane i nie narusza produkcji.
