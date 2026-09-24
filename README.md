# AstroPlanner

Mobilny planner i dziennik projektów astrofotograficznych DSO.

## Aktualna wersja

**v0.14 R&D — baza produkcyjna v0.13.1**

> **Repozytorium rozwojowe v0.14.** Produkcja pozostaje w `MykonidPL/AstroPlanner`; to repo służy wyłącznie do testów aż do zakończenia v0.14. Dane lokalne R&D są odseparowane od produkcji.
> Repo R&D: `MykonidPL/AstroPlanner-v014-RD`.

AstroPlanner pomaga prowadzić wielonocne projekty astrofotograficzne: planować cele, oceniać warunki dla wybranej nocy, zapisywać wykonane sesje, śledzić postęp integracji oraz utrzymywać historię użytego sprzętu i materiału kalibracyjnego.

## Aplikacja

https://mykonidpl.github.io/AstroPlanner/

## Główne obszary

- **Projekty** — kolejka „Do realizacji”, aktywne i archiwalne cele wraz z postępem integracji.
- **Planner** — pełna mapa nieba **DSS2 Color** z katalogowymi nazwami DSO, siatką RA/Dec i FOV setupu oraz wysokość obiektu, kulminacja, użyteczne okno, tryb nocy, Księżyc i lokalizacja/GPS. Raster jest pasywnym tłem; sterowanie mapą, FOV, rotacją i mozaiką pozostaje po stronie AstroPlannera.
- **Dziennik** — historia wykonanych sesji pogrupowana według projektów.
- **Sprzęt** — własna biblioteka teleskopów, kamer, korektorów, filtrów, profili setupów i materiału kalibracyjnego. Profile automatycznie wyliczają światłosiłę, skalę obrazu i FOV.

AstroPlanner działa jako PWA i jest projektowany przede wszystkim do wygodnej obsługi na telefonie oraz pracy terenowej.

## Dane i backup

Dane użytkownika są przechowywane lokalnie w pamięci przeglądarki/PWA. Aktualizacja aplikacji nie powinna usuwać zapisanych projektów, sesji ani sprzętu, ale wyczyszczenie danych witryny może spowodować ich utratę.

W aplikacji dostępny jest eksport i import kopii zapasowej JSON. Przy regularnym korzystaniu zalecane jest okresowe wykonywanie backupu.

## Sprzęt w wersji publicznej

Nowa instalacja startuje z pustą biblioteką teleskopów, kamer, filtrów, korektorów i profili. Każdy użytkownik dodaje własny sprzęt. Aktualizacja nie usuwa sprzętu już zapisanego lokalnie w przeglądarce.

## Historia zmian

### v0.14 R&D — czysty Start / usunięcie FOUC

- minimalistyczny ekran Start jest teraz zapisany bezpośrednio w `index.html`, więc stary ekran nie może pojawić się na pierwszej klatce renderowania,
- finalne style Startu są statyczne w `ui-shell.css`; usunięto późną podmianę HTML/CSS przez `ui-state.js`,
- usunięto martwą logikę liczników i stare style ekranu Start,
- `app.js` pozostaje nieużywanym plikiem historycznym i może zostać bezpiecznie usunięty z repo,
- cache PWA R&D: `astroplanner-v014-rd-home-clean1`.

### v0.14 R&D — spójność Score Analiza ↔ ranking

- Score bieżącego projektu używa teraz tych samych współrzędnych projektu co ranking (w tym zapisanego środka kadru, jeśli istnieje),
- Analiza przygotowuje metadane sygnału przed liczeniem Score tak samo jak ranking,
- usunięto dodatkowy cache SQM/Bortle w Score bieżącego celu, który mógł trwale zapamiętać chwilowy brak danych i liczyć bez SQM,
- wzór `AstroRecommend.scoreTarget()` pozostaje bez zmian; poprawka ujednolica wyłącznie dane wejściowe,
- cache PWA R&D: `astroplanner-v014-rd-score-consistency1`.

### v0.14 R&D — przywrócenie ciągłej warstwy DSS2 HiPS

- usunięto regresję wprowadzoną przez walidowanie i wygaszanie rastra po każdej zmianie viewportu; pan i zoom ponownie korzystają z ciągłej, żywej warstwy Aladin HiPS,
- `gotoRaDec()` i `setFov()` działają na bieżąco jak w stabilnej implementacji sprzed regresji; Aladin może utrzymywać już pobrane kafle i niższe poziomy piramidy podczas doładowywania szczegółów,
- kontrola pustego/białego canvasa nadal chroni pierwsze uruchomienie: techniczny fallback nie jest przykrywany, dopóki DSS2 nie pokaże rzeczywistych danych,
- po pierwszym poprawnym potwierdzeniu DSS2 przejściowe stany ładowania podczas pan/zoom nie wygaszają rastra; fallback uruchamia się dopiero po trwałym błędzie/timeoutcie,
- usunięto tymczasową warstwę `hold`, ponieważ maskowała objaw wyłącznie podczas drag i nie rozwiązywała regresji zoomu,
- cache PWA R&D: `astroplanner-v014-rd-raster-continuous1`.

### v0.13.1

Hotfix interfejsu zarządzania danymi w Dzienniku i Archiwum.

- przywrócono bezpośrednio widoczny przycisk **Usuń** na każdej karcie sesji w Dzienniku; usunięcie nadal wymaga potwierdzenia i aktualizuje postęp projektu,
- projekty w **Archiwum** mają bezpośredni przycisk **Usuń projekt**; projekt zawierający sesje nadal korzysta z bezpiecznego modalu i może zostać trwale usunięty razem z przypisanymi sesjami,
- usunięto zbędne, głęboko zagnieżdżone menu „Zarządzaj sesją”, które ukrywało akcję usuwania,
- nie zmieniono modelu danych ani logiki rastra, snapshotów DSS2, Plannera, sprzętu i formularza sesji,
- cache PWA produkcji podniesiono do `astroplanner-v0131`.

### v0.13

Pełna integracja nowego interfejsu AstroPlannera po zakończonym cyklu testów rozwojowych. Wydanie zachowuje model danych produkcyjnego v0.12 i konsoliduje przebudowę UI, stabilizację mapy DSS2 oraz podglądy projektów.

- dodano ekran startowy z podsumowaniem lokalnych danych oraz stałą dolną nawigację **Planer / Projekty / Dziennik / Sprzęt**,
- przebudowano Projekty na przepływ **Do realizacji → Aktywne → Archiwum**; pierwszy zapis sesji nadal automatycznie aktywuje projekt,
- Planner działa jako czysty, tymczasowy workspace: przy zwykłym wejściu nie odtwarza starego celu ani kadru, a zapis projektu lub wyjście z Plannera resetuje stan roboczy,
- przed wyborem obiektu mapa pozostaje pusta; po wyborze celu DSS2 Color jest głównym tłem, a warunki nocy, analiza i tworzenie projektu są dostępne w zwijanych panelach,
- warstwa DSS2 otrzymała ograniczony mechanizm recovery po błędach inicjalizacji/synchronizacji; w razie niedostępności sieci lub Aladin Lite nadal działa techniczny fallback,
- zapis projektu/kadru może tworzyć statyczny podgląd **DSS2 + FOV / marker celu** przechowywany jako regenerowalny cache w IndexedDB; ten sam podgląd jest używany w Projekcie i Dzienniku bez uruchamiania dodatkowych instancji Aladin/WebGL,
- formularz sesji zapisuje bezpośrednio liczbę **użytecznych LIGHT**; starsze sesje zachowują historyczne dane o odrzuconych klatkach,
- Sprzęt i dane zostały przebudowane na zwijane kategorie z licznikami; formularze pojawiają się dopiero przy dodawaniu lub edycji elementu,
- Dziennik startuje ze zwiniętymi grupami; wejście przez **Historia sesji** otwiera wyłącznie wskazany projekt, a destrukcyjne usuwanie sesji zostało przeniesione do drugorzędnej sekcji zarządzania,
- dodano moduły `ui-shell.css`, `ui-state.js` i `snapshot-store.js`; `raster-layer.js` zawiera stabilizację lifecycle'u rastra i eksport podglądu,
- zachowano istniejące klucze danych projektów, sesji, sprzętu, lokalizacji i bibliotek kalibracji; aktualizacja z v0.12 nie wymaga destrukcyjnej migracji danych,
- cache PWA produkcji podniesiono do `astroplanner-v013`.

### v0.12

- dodano pełnoekranową warstwę rastrową **DSS2 Color** (`P/DSS2/color`) do głównej mapy Plannera; pokrycie jest pełnosferyczne, więc mapa nie ma już granicy deklinacji ani przełączania między surveyami,
- raster jest renderowany przez **Aladin Lite** jako pasywna warstwa pod istniejącym SVG AstroPlannera; nie przejmuje gestów ani logiki mapy — pan/zoom, RA/Dec, FOV, rotacja, mozaika, target i zapis kadru zachowują mechanikę v0.11.5.6,
- przy aktywnym rasterze ukrywane są duplikujące obraz syntetyczne gwiazdy oraz symbole/footprinty DSO; pozostają nazwy obiektów, własna siatka RA/Dec, FOV/mozaika, target i orientacja,
- zachowano techniczne warstwy HYG i DSO jako **fallback**: jeżeli Aladin Lite lub DSS2 nie są dostępne online, AstroPlanner nadal może wyświetlić mapę techniczną z v0.11.5.6,
- ujednolicono grubość centralnych linii siatki RA/Dec z pozostałymi liniami; linie główne pozostają nieco jaśniejsze, ale nie są grubsze,
- dodano osobny moduł `raster-layer.js`; zaktualizowano PWA cache do `astroplanner-v012`, manifest, informacje o wersji i eksport backupu,
- uzupełniono `THIRD_PARTY-NOTICES.md` oraz README o Aladin Lite i DSS2 Color,
- **brak migracji danych użytkownika**: projekty, planowane projekty, sesje, sprzęt, profile setupów, kadry, mozaiki, materiał, lokalizacje, darki i backupy z v0.11.5.6 pozostają kompatybilne.

### v0.11.5.6

- naprawiono regresję etykiet DSO wprowadzoną przez screen-space decluttering v0.11.5.5: etykieta obiektu nie jest już blokowana przez bufor kolizji własnego symbolu,
- duże footprinty katalogowe nie rezerwują już całej swojej elipsy jako „zajętego ekranu”; do declutteringu używany jest mały obszar wokół centrum, dzięki czemu np. footprint M42 nie blokuje podpisów pobliskich DSO przy mocnym zoomie,
- etykiety nadal unikają kolizji z innymi symbolami DSO i innymi etykietami, więc odszumienie szerokiego pola pozostaje aktywne,
- nie zmieniono progów LOD, warstwy gwiazd, katalogów ani modelu danych; cache PWA: `astroplanner-v01156`.

### v0.11.5.5

- odszumiono warstwę DSO na mapie Plannera przy szerokich polach, szczególnie na telefonach: liczba symboli jest teraz dodatkowo ograniczana według rzeczywistej powierzchni viewportu, zamiast opierać się wyłącznie na polu kątowym mapy,
- dodano **screen-space decluttering** symboli DSO: drobne markery konkurujące o to samo miejsce na ekranie są odfiltrowywane, a priorytet zachowują target, obiekty Messiera/użytkownika oraz duże footprinty katalogowe,
- zaostrzono LOD etykiet DSO przy szerokich polach; dla promienia mapy powyżej około 6° etykiety ograniczają się do ważniejszych obiektów, zamiast podpisywać wiele NGC/IC jednocześnie,
- etykiety DSO unikają teraz również kolizji z już narysowanymi symbolami, a nie tylko z innymi etykietami,
- nie zmieniono katalogów, modelu danych projektów ani rzeczywistej geometrii footprintów DSO; cache PWA: `astroplanner-v01155`.

### v0.11.5.4

- naprawiono skalowanie mapy Plannera na telefonach: renderer SVG używa teraz rzeczywistego rozmiaru viewportu zamiast stałego układu `800×500` zmniejszanego przez CSS,
- gwiazdy zachowują dzięki temu zaprojektowaną hierarchię wielkości w rzeczywistych pikselach ekranu; jasne gwiazdy nie są już dodatkowo pomniejszane przez końcowe skalowanie całego SVG,
- symbole i progi ekranowe DSO są oceniane w tej samej skali co faktyczny viewport; rzeczywiste footprinty kątowe DSO nadal wynikają z geometrii nieba,
- atlas bez FOV zachowuje zbliżony kątowy zasięg widoku i dotychczasową logikę LOD mimo zmiany proporcji ekranu,
- poprawiono przeliczanie dragowania Mapa/Kadr: ruch palca jest przeliczany według faktycznego `viewBox`, bez stałych współczynników `800/500`,
- dodano reakcję mapy Plannera na zmianę rozmiaru/orientacji viewportu z zachowaniem bieżącego procentu zoomu,
- brak zmian w modelu danych projektów i sesji; cache PWA: `astroplanner-v01154`.

### v0.11.5.3

- dodano dynamiczny **LOD DSO** oparty na rzeczywistym polu mapy w stopniach, a nie na procentowym zoomie interfejsu; przy szerokim widoku gęste katalogi (np. LDN/LBN/Barnard) są automatycznie ograniczane,
- symbole i etykiety DSO mają osobne progi szczegółowości: mapa może zachować istotny marker bez zalewania ekranu nazwami,
- Messier, obiekty użytkownika oraz duże/jasne DSO mają wyższy priorytet i pozostają widoczne wcześniej niż drobne obiekty katalogowe,
- zaostrzono dynamiczny limit magnitudo gwiazd przy szerokich polach, aby ograniczyć „śnieżycę” punktów,
- przebudowano wizualną hierarchię gwiazd: jasne gwiazdy są wyraźnie większe i jaśniejsze, słabsze coraz mniejsze i subtelniejsze; najjaśniejsze dostają delikatne halo,
- poprawiono normalizację oznaczeń Sharpless (`Sh2-...`) w warstwie mapy,
- brak zmian w modelu danych projektów i sesji; cache PWA: `astroplanner-v01153`.

### v0.11.5.2

- rozdzielono tryby **Mapa / Kadr** na poziomie całej interakcji, a nie tylko dragowania jednym palcem,
- w trybie **Mapa** można przesuwać atlas i wykonywać pinch zoom; FOV, jego środek i rotacja pozostają zablokowane,
- w trybie **Kadr** można przesuwać FOV oraz obracać go gestem dwóch palców; środek mapy i zoom pozostają zablokowane,
- dwupalcowy gest nie łączy już zoomu mapy z rotacją kadru: jego działanie zależy wyłącznie od aktualnego trybu,
- kontrolki niepasujące do aktywnego trybu są wyłączane w UI, m.in. zoom i centrowanie widoku w trybie Kadr oraz rotacja/centrowanie FOV w trybie Mapa,
- dodano twarde guardy w funkcjach sterujących, aby zablokowanych operacji nie dało się uruchomić również poza gestami,
- brak zmian w modelu danych projektów i sesji; cache PWA: `astroplanner-v01152`.

### v0.11.5.1

- naprawiono pipeline geometrii DSO, aby rozmiary kątowe mogły być odczytywane z większej liczby wariantów pól katalogowych,
- dodano bezpieczne fallbacki rozmiaru dla wybranych popularnych obiektów, w tym M31, dzięki czemu nie są przedstawiane wyłącznie jako punkt, gdy źródłowy eksport nie dostarcza geometrii w oczekiwanym polu,
- fallback jest używany tylko przy braku geometrii katalogowej; dane katalogowe pozostają źródłem preferowanym,
- brak zmian w danych użytkownika; cache PWA: `astroplanner-v01151`.

### v0.11.5

- dodano **warstwę obiektów DSO** do wspólnego silnika mapy Plannera i podglądów kadru; mapa korzysta z tych samych rekordów katalogowych co wyszukiwarka zamiast utrzymywać drugi katalog,
- obiekty są rysowane według rzeczywistych RA/Dec; przy szerokim polu działa adaptacyjne ograniczanie liczby markerów i etykiet, aby mapa mobilna pozostała czytelna i płynna,
- galaktyki, gromady, mgławice planetarne, mgławice/SNR i grupy galaktyk mają rozróżnialne techniczne symbole; etykiety są ograniczane dynamicznie i unikają prostych kolizji,
- jeżeli źródłowy rekord zawiera wiarygodny rozmiar katalogowy, AstroPlanner rysuje footprint z osiami; dla OpenNGC obsługiwane są osie główna/poboczna oraz position angle. Brak rozmiaru skutkuje symbolem stałej wielkości — aplikacja nie wymyśla geometrii,
- mgławice nadal **nie otrzymują sztucznych konturów**; rzeczywiste kontury wektorowe pozostają osobnym etapem mapy,
- wyszukiwarka/atlas łączą teraz polskie nazwy i aliasy wbudowanego Messiera z dokładniejszymi współrzędnymi i geometrią katalogu rozszerzonego, gdy istnieje jednoznaczne dopasowanie katalogowe; istniejące projekty nie są automatycznie modyfikowane,
- dodano osobny moduł `dso-layer.js` z przestrzennym indeksem 5° oraz dynamicznym budżetem obiektów, zamiast skanowania całego katalogu przy każdej klatce przesuwania mapy,
- uzupełniono `THIRD_PARTY-NOTICES.md` o źródła i granice licencyjne danych DSO,
- brak nowych kluczy danych użytkownika i brak migracji projektów/sesji; zaktualizowano wersję aplikacji, manifest, cache PWA do `astroplanner-v0115`, README i instrukcję instalacji.

### v0.11.4

- przeniesiono pełną **Mapę nieba** do głównego przepływu Plannera; mapa pojawia się bezpośrednio po wybraniu obiektu, a nie dopiero wewnątrz projektu,
- dla dowolnego obiektu bez projektu mapa działa od razu jako atlas gwiazd z prawdziwą siatką RA/Dec, panowaniem i zoomem; FOV nie jest zgadywany, gdy nie wybrano setupu,
- dodano w mapie Plannera pole **Setup kadru**, zsynchronizowane z planowanym setupem nowego projektu; po wybraniu profilu pojawia się rzeczywisty FOV wynikający z teleskopu/korektora/kamery,
- Planner korzysta z tego samego silnika projekcji, warstwy gwiazd, siatki RA/Dec i geometrii FOV co dotychczasowy edytor kadru; nie powstał osobny silnik mapy,
- zachowano tryby **Mapa / Kadr**, live pan, pinch zoom, obrót dwoma palcami, suwak rotacji i przyciski ±90°; dla mozaiki dostępne są również wiersze, kolumny i overlap,
- przy otwarciu istniejącego projektu Planner ładuje jego zapisany kadr do kopii roboczej; samo eksplorowanie mapy niczego nie zapisuje, a zmiany FOV trafiają do projektu dopiero przez **Zapisz kadr w projekcie**,
- podczas planowania nowego projektu roboczy kadr jest przejmowany przy tworzeniu projektu, dzięki czemu można najpierw dobrać kompozycję, a dopiero potem utworzyć projekt,
- przycisk na miniaturze kadru w karcie projektu został zmieniony na **Otwórz w Plannerze**, aby pełna praca z mapą odbywała się w jednym miejscu,
- wybranie innego obiektu z katalogu podczas oglądania projektu odłącza kontekst projektu i przechodzi do niezależnego planowania nowego celu, zamiast mieszać nowy target ze statystykami starego projektu,
- brak nowych kluczy danych użytkownika i brak destrukcyjnej migracji; projekty oraz sesje z v0.11.3.3 pozostają kompatybilne,
- zaktualizowano numer aplikacji i eksportu JSON, manifest, cache PWA do `astroplanner-v0114`, README oraz instrukcję instalacji.

### v0.11.3.3

- przebudowano panowanie mapy tak, aby **gwiazdy i siatka RA/Dec były przeliczane już podczas ruchu palca**, a nie dopiero po zakończeniu gestu,
- usunięto efekt przesuwania „zamrożonego kafla” nieba: aktualny środek mapy RA/Dec jest aktualizowany w cyklu `requestAnimationFrame`, a renderer pobiera gwiazdy dla bieżącego pola jeszcze w trakcie dragowania,
- końcowa pozycja po puszczeniu palca pozostaje zgodna z ostatnią pozycją widoczną podczas gestu, bez dodatkowego skoku warstw mapy,
- zwiększono czytelność siatki współrzędnych: mocniejszy kontrast linii, wyraźniejsze linie główne, większe etykiety RA/Dec oraz ciemny obrys tekstu poprawiający czytelność na tle gwiazd,
- nie zmieniono geometrii FOV, trybu Mapa/Kadr, rotacji ani zoomu; brak zmian w modelu danych projektów i sesji,
- zaktualizowano numer aplikacji, eksport JSON, manifest, cache PWA, README i instrukcję instalacji.

### v0.11.3.2

- dodano jednoznaczny przełącznik **Mapa / Kadr** w edytorze kadrowania; w trybie Mapa gest jednym palcem przesuwa niebo, a w trybie Kadr ten sam gest przesuwa FOV/mozaikę,
- zachowano szybkie przeciąganie FOV po jego obrysie lub żółtym środku również w trybie mapy; powiększono strefy dotykowe obrysu i środka dla telefonu,
- dodano **zoom/oddalenie mapy** gestem pinch oraz przyciskami `− / +`; bieżący zoom jest pokazywany procentowo nad mapą,
- gest dwóch palców łączy teraz pinch zoom mapy z dotychczasowym obrotem kadru; środek kadru RA/Dec nie zmienia się podczas samego pinch/rotate,
- dodano zoom kółkiem myszy dla wersji desktopowej,
- skala mapy jest ograniczona do bezpiecznego zakresu względem domyślnego widoku, aby projekcja i katalog gwiazd pozostawały użyteczne,
- brak zmian w modelu danych projektów i sesji; aktualizacja jest kompatybilna z v0.11.3.1,
- zaktualizowano numer aplikacji, manifest, cache PWA, README i instrukcję instalacji.

### v0.11.3.1

- naprawiono kierunek przeliczania środka ruchomej mapy po puszczeniu palca; widok nie powinien już odskakiwać ani wracać w przeciwną stronę po dragowaniu,
- rozdzielono obszary dotykowe mapy i FOV: przeciągnięcie tła lub wnętrza prostokąta przesuwa mapę, natomiast sam kadr przesuwa się po złapaniu jego obrysu albo żółtego znacznika środka,
- przyciski **Widok na obiekt** i **Widok na kadr** zostały nazwane jednoznacznie: zmieniają wyłącznie środek mapy i nie modyfikują zapisanego RA/Dec kadru,
- zachowano dotychczasową rotację gestem dwóch palców, suwakiem i przyciskami ±90°,
- brak zmian w modelu danych; pełna kompatybilność z v0.11.3,
- zaktualizowano numer aplikacji, eksport JSON, manifest, cache PWA, README i instrukcję instalacji.

### v0.11.3

- mapa kadrowania w edytorze stała się **pełnym ruchomym viewportem**: tło mapy można przesuwać niezależnie od kadru, dzięki czemu nie jest już zablokowane do obszaru wokół początkowego podglądu,
- przeciąganie działa teraz kontekstowo: przeciągnięcie **samego kadru** zmienia środek RA/Dec kadru, a przeciągnięcie **tła mapy** przesuwa widok nieba bez zmiany zapisanego kadru,
- dodano właściwą **siatkę współrzędnych RA/Dec** rysowaną w tej samej projekcji co gwiazdy i FOV, wraz z etykietami osi dostosowanymi automatycznie do skali widoku,
- warstwa gwiazd została przełączona z lokalnego pola obiektu na aktualny środek mapy, więc po przesunięciu widoku gwiazdy nadal odpowiadają temu, co widać na ekranie,
- dodano szybkie przyciski **Pokaż obiekt** i **Pokaż kadr**, aby jednym tapnięciem wrócić do celu projektu albo do aktualnego środka kadru,
- istniejący gest dwóch palców do rotacji kadru został zachowany; nie obraca on mapy ani nie zmienia jej skali,
- brak zmian w modelu danych projektów i sesji; aktualizacja pozostaje kompatybilna z zapisami v0.11.2,
- zaktualizowano numer aplikacji, manifest, cache PWA, README i instrukcję instalacji.

### v0.11.2

- dodano pierwszą właściwą warstwę mapy kadrowania: **realne gwiazdy katalogowe** są rysowane jako techniczne punkty bez fotograficznego tła i bez elementów planetarium,
- źródłem warstwy jest HYG v4.1; aplikacja korzysta z kompaktowego katalogu binarnego i wyświetla tylko gwiazdy znajdujące się w aktualnym lokalnym polu mapy,
- jasność punktów i ich rozmiar zależą od magnitudo, a limit jasności jest dobierany automatycznie do skali widoku, aby mapa pozostała czytelna,
- warstwa gwiazd jest wspólna dla pojedynczego kadru i mozaiki oraz pojawia się także w miniaturowym podglądzie kadru na karcie projektu,
- katalog gwiazd jest pobierany asynchronicznie i nie blokuje uruchomienia AstroPlannera; po pierwszym udanym pobraniu jest przechowywany w osobnym cache `astroplanner-stars-v01` i może być używany offline,
- brak sieci lub niedostępność katalogu nie blokuje kadrowania: geometria FOV, przesuwanie, obrót, overlap i zapis RA/Dec działają nadal bez warstwy gwiazd,
- nie zmieniono modelu projektów ani sesji; nie jest wymagana migracja istniejących danych,
- dodano `star-layer.js`, zaktualizowano cache aplikacji do `astroplanner-v0112`, numer eksportu JSON, manifest, README i instrukcję instalacji.

### v0.11.1.2

- dodano płynną rotację kadru i całej mozaiki gestem dwóch palców; obrót odbywa się wokół zapisanego środka i nie zmienia FOV ani położenia środka,
- dodano suwak rotacji `-180°…+180°`, zsynchronizowany z dotychczasowym polem liczbowym i przyciskami ±90°,
- gest jednym palcem nadal służy wyłącznie do przesuwania kadru; pojawienie się drugiego palca przełącza interakcję w tryb rotacji bez przypadkowego przesunięcia,
- po zakończeniu gestu dwupalcowego pozostały palec nie rozpoczyna automatycznie dragowania, co zapobiega skokom środka kadru,
- brak zmian w modelu danych; pełna kompatybilność z v0.11.1.1,
- zaktualizowano numer aplikacji, eksport JSON, manifest, cache PWA, README oraz instrukcję instalacji.

### v0.11.1.1

- naprawiono przeciąganie kadru na ekranie dotykowym: kadr przesuwa się płynnie podczas ruchu palca zamiast przeskakiwać dopiero po jego puszczeniu,
- skala widoku edytora jest teraz stała podczas przesuwania, dzięki czemu FOV nie zmniejsza się ani nie powiększa wskutek odsuwania kadru od środka obiektu,
- przeciąganie używa wizualnego przesunięcia SVG w trakcie gestu i dopiero po jego zakończeniu przelicza środek kadru na RA/Dec, co ogranicza koszt renderowania i eliminuje skoki,
- dodano obsługę `pointercancel` i pojedynczego aktywnego wskaźnika, aby gesty dotykowe nie pozostawiały kadru w stanie pośrednim,
- brak zmian w modelu danych; pełna kompatybilność z v0.11.1,
- zaktualizowano numer aplikacji, eksport JSON, manifest, cache PWA, README oraz instrukcję instalacji.

### v0.11.1

- dodano fundament **Kadrowania** wspólny dla projektów pojedynczego kadru i mozaik; mapa nieba nie jest jeszcze częścią tej wersji,
- projekt z poprawnym targetem RA/Dec i planowanym setupem automatycznie otrzymuje techniczny podgląd FOV na karcie projektu,
- pojedynczy kadr może zapisać własny środek RA/Dec i rotację niezależnie od środka obiektu,
- mozaika korzysta z tego samego silnika kadru: użytkownik ustawia liczbę wierszy i kolumn, overlap oraz rotację całego układu,
- liczba pól siatki mozaiki musi odpowiadać liczbie istniejących paneli projektu; aplikacja nie tworzy ani nie usuwa paneli podczas kadrowania,
- po zapisaniu kadru AstroPlanner oblicza i zapisuje RA/Dec środka każdego panelu oraz jego FOV i rotację, bez zmiany nazw i celów czasowych paneli,
- dodano przesuwanie kadru gestem/przeciągnięciem oraz szybkie wyśrodkowanie na obiekcie i obrót ±90°,
- geometria korzysta z lokalnej projekcji gnomonicznej/tangent-plane zamiast liniowego przybliżenia RA/Dec,
- stary projekt bez pola `framing` pozostaje w pełni zgodny: podgląd jest wyliczany domyślnie z targetu i setupu, a dane kadru są zapisywane dopiero przy świadomej zmianie/zapisie,
- przy zmianie planowanego setupu zapisany środek i rotacja kadru są zachowane, natomiast FOV oraz geometria paneli są przeliczane z aktualnego setupu,
- kod geometrii i renderera wydzielono do `framing-engine.js` i `framing-renderer.js`, aby kolejne warstwy mapy (gwiazdy i kontury DSO) nie rozbudowywały monolitycznego `index.html`,
- nowe moduły są częścią cache PWA i działają offline po aktualizacji,
- zaktualizowano numer aplikacji, eksport JSON, manifest, cache PWA, README oraz instrukcję instalacji.

### v0.11.0

- rozbudowano istniejące **Profile setupów** w automatyczne zestawy optyczne: na podstawie teleskopu, korektora/reduktora i kamery AstroPlanner wylicza efektywną ogniskową, światłosiłę, skalę obrazu oraz pole widzenia,
- profil pokazuje obliczone parametry już podczas tworzenia i edycji; brakujące dane kamery (pixel size lub wymiary sensora) są sygnalizowane bez zgadywania wartości,
- projekt może mieć opcjonalny **Planowany setup** wskazujący istniejący profil; starsze projekty bez `profileId` działają bez migracji,
- karta projektu i Planner pokazują parametry planowanego zestawu automatycznie, bez ręcznego przepisywania ogniskowej, piksela ani wymiarów sensora,
- Planner dostał sekcję **Kadr zestawu** z nazwą setupu, f/, skalą obrazu i FOV,
- nowa sesja projektu z przypisanym setupem automatycznie dziedziczy teleskop, korektor i kamerę z profilu; ręczna zmiana optyki odłącza sesję od profilu zamiast błędnie zachowywać jego nazwę,
- zapis sesji przechowuje historyczny snapshot parametrów optycznych (m.in. efektywną ogniskową, f/, skalę i FOV), dzięki czemu późniejsza edycja profilu nie zmienia historii,
- Dziennik pokazuje zapisane parametry setupu w szczegółach sesji,
- zachowano pełną zgodność z istniejącymi projektami, sesjami, kamerami, profilami i backupami v0.10.6.x; nie jest wymagana destrukcyjna migracja,
- zaktualizowano numer aplikacji, eksport JSON, manifest, cache PWA, README oraz instrukcję instalacji.

### v0.10.6.5

- ujednolicono prezentację planowanej liczby klatek na kartach projektów: ekspozycja i **Cel materiału** są teraz pokazywane w osobnych wierszach,
- projekt z **Planem materiału** pokazuje od razu również łączny minimalny cel liczby klatek, obliczony jako suma celów poszczególnych składników, np. `400 + 120 = 520 klatek`,
- projekt pojedynczy i mozaika korzystają z tego samego układu: `Ekspozycja planowana` oraz osobno `Cel materiału: min. X klatek`,
- jeżeli w Planie materiału tylko część składników ma podaną ekspozycję, aplikacja nie pokazuje mylącej niepełnej sumy i prosi o uzupełnienie ekspozycji wszystkich składników,
- brak zmian w modelu danych i logice postępu; pełna kompatybilność z v0.10.6.4,
- zaktualizowano numer aplikacji, eksport JSON, manifest, cache PWA, README oraz instrukcję instalacji.

### v0.10.6.4

- ujednolicono prezentację planowanych ekspozycji na kartach projektów: projekt z **Planem materiału** pokazuje teraz od razu skrót ekspozycji poszczególnych składników, np. `HII + OIII 180 s · RGB 60 s`, bez konieczności rozwijania sekcji,
- szczegółowa liczba planowanych klatek dla każdego składnika nadal pozostaje w rozwijanym **Planie materiału**, dzięki czemu karta projektu pozostaje kompaktowa,
- projekt pojedynczy i mozaika zachowują dotychczasową prezentację wspólnej planowanej ekspozycji i minimalnej liczby klatek,
- brak zmian w modelu danych; pełna kompatybilność z v0.10.6.3,
- zaktualizowano numer aplikacji, eksport JSON, manifest, cache PWA, README oraz instrukcję instalacji.

### v0.10.6.3

- dodano opcjonalną **planowaną ekspozycję** do projektu pojedynczego kadru i jako wspólną ekspozycję projektu mozaikowego,
- składniki **Planu materiału** mogą mieć własne czasy ekspozycji, dzięki czemu np. narrowband i RGB są liczone niezależnie,
- Planner pokazuje nową sekcję **Klatki w użytecznym oknie**: teoretyczną maksymalną liczbę klatek możliwych do wykonania tej nocy przy zadanej ekspozycji oraz orientacyjną liczbę klatek pozostałych do celu,
- liczba klatek jest liczona z faktycznego użytecznego okna Plannera; wynik jest jawnie opisany jako maksimum teoretyczne bez ditheringu, autofocusu, meridian flipa i innych przerw,
- przy tworzeniu nowego projektu obliczenie liczby klatek działa jeszcze przed jego zapisaniem; w projekcie z Planem materiału wspólne pole ekspozycji jest zastępowane ekspozycjami poszczególnych składników,
- w kartach projektów i rozwijanych panelach/składnikach pokazano planowaną ekspozycję oraz wynikającą z niej minimalną liczbę klatek potrzebną do realizacji celu godzinowego,
- przy dodawaniu nowej sesji planowana ekspozycja projektu lub wybranego składnika Planu materiału jest automatycznie podpowiadana; edycja istniejącej sesji nie jest nadpisywana,
- nowe pola są opcjonalne, więc starsze projekty bez planowanej ekspozycji działają bez migracji i zachowują dotychczasowe zachowanie,
- zaktualizowano numer aplikacji, eksport JSON, manifest, cache PWA, README oraz instrukcję instalacji.

### v0.10.6.2

- dodano czytelny stan **„Cel osiągnięty ✓”** dla projektu po dojściu do 100% celu, bez automatycznej zmiany statusu projektu,
- dla aktywnego projektu po osiągnięciu celu dostępny jest bezpośredni przycisk **Oznacz jako ukończony**; decyzja o zamknięciu projektu nadal należy do użytkownika,
- panele mozaiki i składniki Planu materiału pokazują **„Cel osiągnięty ✓”** po dojściu do 100%; nadmiar nadal jest prezentowany jako czas dodatkowy zamiast procentu powyżej 100%,
- dodano nieblokujące sanity checks przy zapisie sesji dla wyraźnie podejrzanych danych, m.in. daty w przyszłości, zerowego zaakceptowanego materiału, skrajnie długiej integracji, ekspozycji lub liczby klatek oraz bardzo wysokiego odsetka odrzuceń,
- podejrzaną, ale świadomie poprawną sesję nadal można zapisać po potwierdzeniu ostrzeżenia,
- wzmocniono ochronę historii przy usuwaniu używanego panelu lub składnika Planu materiału: komunikat pokazuje liczbę powiązanych sesji i jasno informuje o utracie przypisania do postępu,
- bez zmian w modelu danych; zachowana jest kompatybilność z v0.10.6.1,
- zaktualizowano numer aplikacji, eksport JSON, manifest, cache PWA, README oraz instrukcję instalacji.

### v0.10.6.1

- zmniejszono wysokość kart projektów z Planem materiału i projektów mozaikowych: szczegółowy postęp składników/paneli jest teraz domyślnie zwinięty,
- dodano kompaktowy nagłówek sekcji z nazwą, postępem czasu, procentem realizacji oraz liczbą składników lub paneli,
- po rozwinięciu zachowano dotychczasowy niezależny postęp każdego składnika/panelu, paski postępu, czas pozostały oraz czas dodatkowy ponad plan,
- stan rozwinięcia sekcji jest pamiętany podczas bieżącej pracy aplikacji i kolejnych renderów listy projektów,
- bez zmian w modelu danych projektów i sesji; aktualizacja jest kompatybilna z danymi v0.10.6,
- zaktualizowano numer aplikacji, eksport JSON, manifest, cache PWA, README oraz instrukcję instalacji.

### v0.10.6

- dodano **Mozaikę v1**: projekt może być zwykłym pojedynczym kadrem albo mozaiką z własną listą paneli, edytowalnymi nazwami i osobnym celem godzinowym każdego panelu,
- dla mozaiki łączny cel projektu jest automatycznie sumą celów paneli; postęp każdego panelu jest liczony niezależnie i nie przekracza 100%, a nadmiar jest pokazywany jako czas dodatkowy,
- sesja projektu mozaikowego wymaga przypisania do panelu; panel jest zapisywany również w Dzienniku i zachowywany podczas edycji sesji,
- starsze projekty bez pola typu projektu są nadal traktowane jako zwykłe projekty i nie wymagają destrukcyjnej migracji,
- Planner pokazuje **szczyt widoczności** dla wybranego obiektu i potwierdzonej lokalizacji: miesiąc najlepszej nocnej widoczności oraz geometryczną maksymalną wysokość obiektu,
- wynik szczytu widoczności jest natychmiast unieważniany po zmianie celu, rozpoczęciu nowego wyszukiwania, zmianie lokalizacji albo utracie poprawnych współrzędnych,
- poprawiono formularz katalogu ZWO: po dodaniu nowej kamery wybór katalogowy, podgląd i formularz są czyszczone; zapis edycji istniejącej kamery nie uruchamia tego resetu,
- zaktualizowano numer aplikacji, eksport JSON, manifest, cache PWA, README oraz instrukcję instalacji.

### v0.10.5

- poprawiono logikę terminów projektów planowanych: domyślna data Plannera nie jest terminem projektu, miesiąc i dokładna data są synchronizowane bez sprzecznych wartości, a termin można wyczyścić,
- dodano opcjonalny **Plan materiału** z osobnymi składnikami (np. Hα/OIII, RGB), ich celami godzinowymi oraz opcjonalnym przypisaniem filtrów,
- przy Planie materiału łączny cel projektu jest automatycznie sumą celów składników; nie wpisuje się go osobno,
- dodano postęp każdego składnika, czas pozostały oraz osobny czas zebrany ponad plan; procent postępu nie przekracza 100%,
- sesje projektów z Planem materiału są przypisywane do konkretnego składnika, z automatyczną podpowiedzią na podstawie filtra,
- zachowano pełną zgodność ze starszymi projektami bez Planu materiału,
- dodano pierwszą lokalną bazę sprzętu: katalog 20 kamer ZWO z podstawowymi parametrami sensora, rozdzielczością, pikselem i informacją o chłodzeniu,
- wybór kamery z katalogu tylko uzupełnia edytowalny formularz; nowy użytkownik nadal startuje z pustą własną biblioteką sprzętu,
- katalog kamer ZWO jest dołączony do cache PWA i dostępny również offline po instalacji.

### v0.10.4.4

- ukryto przycisk **Dodaj ukończoną sesję** w samodzielnym Plannerze bez kontekstu projektu,
- utwardzono przejście **Historia** z karty projektu do właściwej grupy w Dzienniku,
- po imporcie backupu ponownie uruchamiana jest migracja integralności danych, dzięki czemu stare sesje bez poprawnych RA/Dec nie zachowują błędnie wyliczonych danych Księżyca.

### v0.10.4.3

- przebudowano sekcję Księżyca w Plannerze: skrót jest widoczny od razu, a pełne informacje są rozwijane,
- usunięto mało użyteczną średnią wysokość Księżyca; dodano wschód, zachód, górowanie i wysokość podczas górowania,
- dodano kontekst Księżyca względem użytecznego okna sesji, m.in. informację o zachodzie lub wschodzie w trakcie okna,
- w Dzienniku przyciski **Edytuj** i **Usuń** są dostępne bez rozwijania całej sesji,
- szczegóły sesji podzielono na osobno rozwijane sekcje: Materiał, Sprzęt, Warunki, Kalibracja i Pozostałe.

### v0.10.4.2

- zablokowano zapisywanie nowych sesji bez przypisanego projektu,
- obiekt i współrzędne sesji są teraz zawsze pobierane z projektu, a zapis jest blokowany, jeśli projekt nie ma poprawnego targetu,
- poprawiono parser RA/Dec: puste pola nie są już interpretowane jako RA 0h / Dec 0°,
- brak poprawnych współrzędnych celu oznacza brak obliczeń danych Księżyca,
- dodano jednorazową migrację czyszczącą błędnie wyliczone dane Księżyca w starszych sesjach bez poprawnych współrzędnych celu.

### v0.10.4.1

- naprawiono błąd Plannera, który mógł wykonywać obliczenia dla starych współrzędnych mimo braku aktualnie wybranego obiektu,
- Planner nie oblicza planu nocy bez świadomie wybranego celu i pokazuje komunikat „Wybierz obiekt, aby obliczyć plan nocy”,
- unieważnienie celu czyści poprzednie wyniki Plannera, wykres oraz osierocone współrzędne celu,
- zapis preferencji nie utrwala już współrzędnych jako celu, jeśli żaden obiekt nie jest wybrany.

### v0.10.4

- rozdzielono **obiekt astronomiczny** od dowolnej **nazwy projektu**,
- projekt wymaga świadomie wybranego obiektu z katalogu albo własnego obiektu,
- data wybrana w Plannerze może zostać przeniesiona do terminu nowego planowanego projektu,
- rozpoczęcie nowego planowania resetuje datę do bieżącego dnia,
- dodano przycisk **Dzisiaj** przy wyborze daty,
- status i dopasowanie Master Dark przeniesiono do sekcji **Kalibracja**.

### v0.10.3

- poprawiono responsywność wykresu Plannera na ekranach mobilnych i HiDPI,
- dodano automatyczny zapis roboczy formularza sesji oraz jego przywracanie po ponownym uruchomieniu aplikacji,
- dodano jednoznaczny komunikat o braku nocy astronomicznej,
- rozszerzono obsługę katalogu obiektów w trybie offline,
- poprawiono komunikaty błędów geolokalizacji i możliwość ręcznego wpisania współrzędnych,
- dodano wyraźne ostrzeżenie o konieczności wykonywania backupu danych lokalnych.

### v0.10.2

- dodano planowany miesiąc/rok oraz opcjonalną dokładną datę dla planowanych projektów,
- dodano chronologiczne sortowanie planowanych projektów,
- rozbudowano szczegóły sesji w Dzienniku przy zachowaniu krótkiego widoku domyślnego,
- poprawiono obsługę darków sesyjnych oraz Master Dark / Master Dark Flat,
- dodano historyczny snapshot użytego materiału kalibracyjnego,
- poprawiono aktywowanie planowanego projektu dopiero po faktycznym zapisie pierwszej sesji,
- poprawiono integralność danych GPS i deduplikację obiektów katalogowych,
- usunięto pozostałe godziny dziesiętne z interfejsu.

### v0.10.1

- naprawiono krytyczny błąd inicjalizacji powodujący brak działania interfejsu po uruchomieniu v0.10.0.

### v0.10.0

- uporządkowano workflow i statusy projektów,
- dodano planowane projekty i archiwum,
- Planner przestał wymagać wyboru projektu,
- poprawiono przeglądanie katalogów na ekranach dotykowych,
- dodano ocenę widoczności obiektu oraz rozbudowane informacje o Księżycu,
- wprowadzono czytelny format czasu h/min,
- dodano zwijane sesje w Dzienniku,
- rozróżniono kamery astro oraz DSLR/mirrorless z Gain/ISO,
- dodano edycję sprzętu i poprawki GPS,
- zmieniono ikonę aplikacji na aktualne logo AstroPlannera.

### v0.9.4

- poprawiono usuwanie projektów z historią,
- projekt z zapisanymi sesjami można zachować jako ukończony albo trwale usunąć razem z przypisanymi sesjami.

## Dane astronomiczne i licencje zewnętrzne

Główna mapa AstroPlannera korzysta z **DSS2 Color** (`P/DSS2/color`) przygotowanego jako HiPS przez CDS na podstawie danych Digitized Sky Survey/STScI. Metadane CDS wskazują licencję HiPS **ODbL 1.0** oraz wymagane informacje o pochodzeniu danych. Raster jest wyświetlany przez **Aladin Lite** rozwijany przez CDS; aktualny kod Aladin Lite jest udostępniany jako **LGPL-3.0-or-later**.

Techniczna warstwa fallback gwiazd nadal korzysta z **HYG v4.1** (David Nash / Astronexus), udostępnianego na licencji **CC BY-SA 4.0**. AstroPlanner pobiera kompaktową reprezentację katalogu przygotowaną w projekcie `bryancurran/celestial-cartography`. Warstwy DSO pozostają oparte na źródłach OpenNGC / Stellarium / SIMBAD opisanych wcześniej.

Pełne informacje o źródłach, licencjach i attribution znajdują się w [`THIRD_PARTY-NOTICES.md`](THIRD_PARTY-NOTICES.md).

## Copyright

AstroPlanner © 2026 Mykonid. Kod źródłowy nie jest udostępniany na licencji open source. Szczegóły: [LICENSE](LICENSE).
