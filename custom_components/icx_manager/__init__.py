"""ICX Manager integration for Home Assistant."""

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.const import Platform

from .const import DOMAIN
from .coordinator import IcxCoordinator
from .snmp import IcxSnmpClient

PLATFORMS = (Platform.SWITCH, Platform.BINARY_SENSOR, Platform.SENSOR)


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Start SNMP client, fetch initial data and register the platforms."""
    client = IcxSnmpClient(dict(entry.data))
    coordinator = IcxCoordinator(hass, client)
    try:
        await coordinator.async_config_entry_first_refresh()
    except Exception:
        client.close()
        raise
    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = coordinator
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload entities and close the SNMP transport."""
    if not await hass.config_entries.async_unload_platforms(entry, PLATFORMS):
        return False
    coordinator = hass.data[DOMAIN].pop(entry.entry_id)
    coordinator.client.close()
    return True
