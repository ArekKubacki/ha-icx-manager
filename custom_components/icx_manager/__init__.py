"""ICX Manager integration for Home Assistant."""

from pathlib import Path

from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.const import Platform

from .const import DOMAIN
from .coordinator import IcxCoordinator
from .snmp import IcxSnmpClient

PLATFORMS = (Platform.SWITCH, Platform.BINARY_SENSOR, Platform.SENSOR)
CARD_RESOURCE = "/icx-manager/icx-manager-card.js"


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Start SNMP client, fetch initial data and register the platforms."""
    client = IcxSnmpClient(dict(entry.data))
    coordinator = IcxCoordinator(hass, client)
    try:
        await coordinator.async_config_entry_first_refresh()
    except Exception:
        client.close()
        raise
    if not hass.data.get(f"{DOMAIN}_card_registered"):
        await hass.http.async_register_static_paths([
            StaticPathConfig(
                CARD_RESOURCE,
                str(Path(__file__).parent / "www" / "icx-manager-card.js"),
                False,
            )
        ])
        hass.data[f"{DOMAIN}_card_registered"] = True
    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = coordinator
    entry.async_on_unload(entry.add_update_listener(_async_options_updated))
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload entities and close the SNMP transport."""
    if not await hass.config_entries.async_unload_platforms(entry, PLATFORMS):
        return False
    coordinator = hass.data[DOMAIN].pop(entry.entry_id)
    coordinator.client.close()
    return True


async def _async_options_updated(hass: HomeAssistant, entry: ConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)
