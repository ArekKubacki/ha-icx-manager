# ICX Manager — Home Assistant

Lokalna integracja **Brocade / Ruckus ICX** dla Home Assistant, opracowana początkowo dla **ICX6450-48P**, korzystająca z **SNMPv3**.

> **v0.1.0 — wersja testowa**. Kod sprawdzony pod kątem składni i testów funkcji pomocniczych. Wymaga jeszcze testów na fizycznym switchu przed normalnym użytkowaniem.

## Funkcje

- Włączanie i wyłączanie **PoE na poszczególnych portach** (nie wyłącza portu Ethernet).
- Stan połączenia fizycznego **Link UP/DOWN**.
- Pobór mocy PoE na port (**W**) — gdy switch udostępnia pomiar.
- Bieżące **RX i TX w Mbit/s**, z 64-bitowych liczników SNMP — gdy są dostępne.
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
- authPriv: SHA / SHA256 + AES128.

Do monitorowania wymagane jest SNMP **GET/WALK** na `1.3.6.1.2.1.1`, `1.3.6.1.2.1.2`, `1.3.6.1.2.1.31` oraz `1.3.6.1.4.1.1991.1.1.2.14`. Do sterowania PoE wymagane jest SNMP **SET** na `1.3.6.1.4.1.1991.1.1.2.14.2.2.1.2`.

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
