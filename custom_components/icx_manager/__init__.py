"""ICX Manager integration for Home Assistant."""

import json
import logging
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
_LOGGER = logging.getLogger(__name__)
VERSION = json.loads((Path(__file__).parent / "manifest.json").read_text(encoding="utf-8"))["version"]


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
    await _async_ensure_lovelace_resource(hass)
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


async def _async_ensure_lovelace_resource(hass: HomeAssistant) -> None:
    """Update only our Lovelace resource URL with the manifest version.

    Always load resources before modifying them: older HA releases could
    otherwise overwrite the existing resource collection during startup.
    """
    lovelace = hass.data.get("lovelace")
    if lovelace is None:
        _LOGGER.debug("Lovelace not loaded; add ICX Manager resource manually")
        return
    mode = getattr(lovelace, "resource_mode", None)
    if mode is None:
        mode = getattr(lovelace, "mode", None)
    if mode != "storage":
        _LOGGER.debug("Lovelace resources are YAML-managed; cannot auto-update")
        return
    resources = getattr(lovelace, "resources", None)
    if resources is None:
        return
    try:
        if not resources.loaded:
            await resources.async_load()
        target_url = f"{CARD_RESOURCE}?v={VERSION}"
        existing = [
            item for item in resources.async_items()
            if item.get("url", "").split("?", 1)[0] == CARD_RESOURCE
        ]
        if existing:
            for item in existing:
                if item["url"] != target_url or item.get("res_type") != "module":
                    await resources.async_update_item(
                        item["id"], {"url": target_url, "res_type": "module"}
                    )
        else:
            await resources.async_create_item({
                "url": target_url, "res_type": "module"
            })
    except Exception:
        # A dashboard resource problem must not prevent SNMP entities from loading.
        _LOGGER.exception("Cannot automatically register ICX Manager Lovelace resource")
