# ICX Manager — Home Assistant

Lokalna integracja **Brocade / Ruckus ICX** dla Home Assistant, opracowana początkowo dla **ICX6450-48P**, korzystająca z **SNMPv3**.

> **v0.2.5 — wersja testowa**. Kod sprawdzony pod kątem składni i testów funkcji pomocniczych. Wymaga jeszcze testów na fizycznym switchu przed normalnym użytkowaniem.

## Funkcje

- Włączanie i wyłączanie **PoE na poszczególnych portach** (nie wyłącza portu Ethernet).
- Stan połączenia fizycznego **Link UP/DOWN**.
- Pobór mocy PoE na port (**W**) — gdy switch udostępnia pomiar.
- Bieżące **RX i TX w Mbit/s**, z 64-bitowych liczników SNMP — gdy są dostępne.
- Sumaryczny **pobór mocy PoE (W)** z pomiarów portów (nie maksymalny budżet zasilacza).
- Prędkość negocjacji łącza, wykorzystanie RX/TX (%) oraz liczniki błędów i odrzuconych pakietów — o ile urządzenie je raportuje.
- **Administracyjne ON/OFF portu Ethernet** (niezależnie od PoE) przez SNMP ifAdminStatus; domyślnie wyłączone, wymaga włączenia w Opcjach integracji.
- **Karta dashboardu** pokazująca podsumowanie wszystkich portów i szczegóły.
- **Uptime** switcha i konfiguracja SNMPv3 w UI Home Assistant.
- Odpytywanie co 30 sekund, wyłącznie lokalnie.

**Niezaimplementowane:** CPU, temperatura, całkowity budżet PoE, SNMPv2c, aktualizowanie listy encji przy wykryciu nowych portów bez ponownego załadowania integracji.

## Instalacja

### HACS

W HACS dodaj własne repozytorium **Integration**:

https://github.com/ArekKubacki/ha-icx-manager

Zainstaluj **ICX Manager**, uruchom ponownie Home Assistant, następnie przejdź do **Ustawienia → Urządzenia i usługi → Dodaj integrację → ICX Manager**.

### Ręczna

Skopiuj katalog `custom_components/icx_manager` do `<config>/custom_components/icx_manager` i zrestartuj Home Assistant.

## Ustawienia SNMPv3

W formularzu podaj adres switcha, port UDP (domyślnie 161), nazwę użytkownika, protokół autoryzacji i szyfrowania wraz z hasłami. Obsługiwane są:
- noAuthNoPriv,
- authNoPriv: SHA / SHA256,
- authPriv: SHA / SHA256 + DES lub AES128.

Do monitorowania wymagane jest SNMP **GET/WALK** na `1.3.6.1.2.1.1`, `1.3.6.1.2.1.2`, `1.3.6.1.2.1.31` oraz `1.3.6.1.4.1.1991.1.1.2.14`. Do sterowania PoE wymagane jest SNMP **SET** na `1.3.6.1.4.1.1991.1.1.2.14.2.2.1.2`.

W konfiguracji ICX 6450 polecenie `snmp-server user ... v3 encrypted auth sha ... priv encrypted des ...` oznacza uwierzytelnianie SHA oraz szyfrowanie DES. Słowo `encrypted` opisuje zapis kluczy w konfiguracji switcha — do Home Assistant należy wpisać **oryginalne hasło uwierzytelniania oraz oryginalne hasło prywatności**, a nie zaszyfrowany ciąg z `show running-config`.

Sprawdź też listę ACL przypisaną do grupy SNMPv3: **adres źródłowy Home Assistant** musi mieć dostęp do switcha po UDP 161. ACL dla zapisu może być bardziej restrykcyjna niż dla odczytu. Gdy `snmpwalk` działa z innego komputera, nie oznacza to, że zadziała z HA.

Hasła są zapisane we wpisie konfiguracji HA — **nie publikuj ich w Issues, logach ani zrzutach ekranu**.

## Indeksy i sterowanie PoE

Tabela **FDRY-POE-MIB**:

| OID kolumny | Działanie |
| --- | --- |
| `1.3.6.1.4.1.1991.1.1.2.14.2.2.1.1` | Powiązany `ifIndex` |
| `1.3.6.1.4.1.1991.1.1.2.14.2.2.1.2` | PoE control: `2=OFF`, `3=ON`, `4=legacy ON` |
| `1.3.6.1.4.1.1991.1.1.2.14.2.2.1.6` | Pobór mocy w mW (HA pokazuje W) |

**Nie zgadujemy indeksu OID na podstawie oznaczenia portu** (np. `1/1/7`). Porty PoE są łączone z portami fizycznymi przez SNMP `ifIndex`. Odczytany tryb legacy `4` jest traktowany jako ON, ale przełączenie ON z interfejsu ustawia standardowy tryb `3`.

Źródło OID: [RUCKUS Power over Ethernet port table](https://docs.ruckusnetworks.com/prod/ruckus-docs/fastiron-10010-mibref/%24/PowerOverEthernetporttableGUID-A3075DE9-3F1D-4F62-B928-C27ECE0E0B525en-US).

## Test po instalacji

1. Sprawdź nazwy i liczby wykrytych portów w urządzeniu ICX.
2. Zweryfikuj, że encje portu np. `1/1/7` faktycznie odpowiadają temu portowi.
3. PoE przełącz **wyłącznie na porcie testowym**, który nie zapewnia dostępu do Home Assistant, switcha lub sieci.
4. Sprawdź moc: 12500 mW powinno dać 12,5 W.
5. RX/TX będą miały wartość dopiero po co najmniej dwóch odczytach liczników.

Gdy brakuje PoE lub odczyt jest błędny, prześlij **wyłącznie wyniki odczytów tabel OID bez haseł SNMP**. Po zmianie wykrywanych portów przeładuj integrację.

## Dla programistów

`python -m compileall -q custom_components/icx_manager`

`python -m pytest -q tests`

Projekt nie wykorzystuje SSH i nie wysyła żadnych poleceń konfiguracji switcha poza SNMP SET w tabeli PoE. 

## Karta ICX Manager do Home Assistant

Po załadowaniu integracji adres karty to `/icx-manager/icx-manager-card.js`.
W **Ustawienia → Dashboardy → Zasoby (Resources)** dodaj ten adres jako zasób **JavaScript module**. Potem w edytorze dashboardu dodaj kartę ręcznie:

```yaml
type: custom:icx-manager-card
title: Brocade ICX6450-48P
```

Gdy masz więcej niż jeden switch, podaj dodatkowo `device: "adres-IP:161"`.

**Uwaga:** do wyłączania całych portów Ethernet przejdź do **Opcji integracji** i włącz odpowiednią funkcję. Karta poprosi o potwierdzenie administracyjnego włączenia lub wyłączenia portu. Standardowa encja HA może jednak zostać przełączona bez tego potwierdzenia. Nie wyłączaj uplinku ani portu zapewniającego dostęp do Home Assistant.

Całkowita moc PoE to suma odczytanych wartości. Jeśli brakuje odczytów dla niektórych portów, sensor ma atrybut `partial: true` i liczby `measured_ports`, `poe_ports`; nie jest to gwarantowany budżet PoE.

## Edytor wizualny i szybsza karta (v0.2.1)

Edytuj kartę, aby ustawić: tytuł, switch, liczbę portów w rzędzie na komputerze i telefonie, wysokość kafelków, maksymalną szerokość oraz własną nazwę każdego portu. W widoku Sekcje szerokość całej karty ustawisz również narzędziem rozmiaru karty Home Assistant. Przy mniejszej liczbie portów siatka sama skróci liczbę kolumn. Nazwy zapisywane są w konfiguracji tej karty (`port_names`), a nie na switchu. W przypadku braku nazwy pojawi się opis SNMP, a następnie numer portu.

Karta ignoruje zmiany niezwiązanych encji HA. Po kliknięciu PoE lub przełącznika Ethernet od razu pokazuje stan przejściowy `Zmieniam…`, aż HA potwierdzi zmianę; po 15 sekundach bez potwierdzenia zgłaszany jest problem. To szybka informacja wizualna, nie natychmiastowe potwierdzenie wykonania operacji na switchu. Administracyjne przełączniki całych portów nadal wymagają wcześniejszego włączenia w Opcjach integracji oraz potwierdzenia w karcie.

```yaml
type: custom:icx-manager-card
title: ICX6450
columns: 12
mobile_columns: 6
port_height: 40
max_width: 0
port_names:
  1/1/1: AP parter
  1/1/2: Kamera podjazd
```

## Szybsze przełączanie PoE i Ethernetu (v0.2.2)

Po udanym SNMP SET integracja publikuje stan poleconej zmiany natychmiast w encji, bez uruchamiania pełnego odczytu 16 tabel SNMP. Kolejny cykliczny odczyt weryfikuje rzeczywisty stan przełącznika. Pozwala to szybciej uaktualnić kartę; sam czas odpowiedzi SNMP i przełączenia sprzętowego pozostaje zależny od switcha.


## Odświeżony wygląd (v0.2.3)

Karta otrzymała subtelne panele zamiast ciężkiego szarego tła, nowe podsumowanie z ikonami, ikony przy metrykach, czytelniejsze przełączniki oraz nową legendę.

Widok **Szczegółowy** wyświetla komplet metryk portu. Widok **Kompaktowy** pokazuje Link, prędkość, RX/TX, PoE i moc — ukrywa procenty wykorzystania, błędy i odrzucone pakiety. Oba zachowują przyciski sterowania PoE i administracyjne ON/OFF portu.

Tryb wyświetlania ustawisz **wyłącznie w ustawieniach karty** (edytor wizualny lub YAML). Na samej karcie nie ma przycisku przełączania:

```yaml
type: custom:icx-manager-card
title: ICX6450
view: compact  # albo detailed
```

Jeżeli po aktualizacji karta nadal wygląda jak wcześniej, wyczyść cache (Ctrl+Shift+R), a po aktualizacji HACS uruchom ponownie Home Assistant.


## Poprawki układu (v0.2.4)

- Widok Pełny lub Kompaktowy wybiera się tylko w **Edytuj kartę → Układ i szerokość → Tryb wyświetlania**. Brak przełącznika w treści karty.
- W podsumowaniu Porty używana jest ikona `mdi:ethernet` (zastępuje poprzednią ikonę).
- Liczby portów, aktywnych łączy i portów PoE są na **tej samej linii, bezpośrednio obok ikon**. Opisy znajdują się za liczbami.
- YAML pozostaje kompatybilny: `view: compact` lub `view: detailed`.


## Automatyczna aktualizacja zasobu karty (v0.2.5)

Po aktualizacji i restarcie HA integracja w trybie **Lovelace Resources: storage** tworzy lub aktualizuje istniejący zasób `/icx-manager/icx-manager-card.js?v=0.2.5` automatycznie, na podstawie wersji manifestu. Nie trzeba ręcznie zwiększać cyferek w ustawieniach Zasoby. Modyfikowany jest tylko własny adres zasobu ICX Manager, inne karty pozostają nietknięte. W trybie YAML zarządzanie zasobami pozostaje ręczne.

Odświeżenie strony lub aplikacji może być nadal wymagane, jeśli interfejs przechowuje starszy kod w pamięci podręcznej.
