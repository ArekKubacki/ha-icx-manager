"""Turn PoE power on and off; leave Ethernet link configuration unchanged."""

from homeassistant.components.switch import SwitchEntity
from homeassistant.exceptions import HomeAssistantError

from .const import DOMAIN, POE_DISABLED, POE_ENABLED, POE_PORT_CONTROL
from .entity import IcxEntity
from .snmp import SnmpError


async def async_setup_entry(hass, entry, async_add_entities):
    coordinator = hass.data[DOMAIN][entry.entry_id]
    async_add_entities(
        IcxPoeSwitch(coordinator, entry, port)
        for port in coordinator.data["ports"].values()
        if port["poe_index"] is not None
    )


class IcxPoeSwitch(IcxEntity, SwitchEntity):
    """SNMP SET on a validated row index in the FDRY-POE-MIB."""

    def __init__(self, coordinator, entry, port):
        super().__init__(coordinator, entry, f"port_{port['label']}_poe", port)
        self._attr_name = f"Port {port['label']} PoE"
        self._poe_index = port["poe_index"]

    @property
    def is_on(self) -> bool | None:
        if not self.port:
            return None
        mode = self.port["poe_mode"]
        return mode in (3, 4) if mode is not None else None

    async def _set_poe(self, enabled: bool) -> None:
        oid = f"{POE_PORT_CONTROL}.{self._poe_index}"
        try:
            await self.coordinator.client.set_integer(
                oid, POE_ENABLED if enabled else POE_DISABLED
            )
        except (SnmpError, OSError, TimeoutError) as exc:
            raise HomeAssistantError(
                f"Failed to change PoE for {self._label}: {exc}"
            ) from exc
        await self.coordinator.async_request_refresh()

    async def async_turn_on(self, **kwargs) -> None:
        await self._set_poe(True)

    async def async_turn_off(self, **kwargs) -> None:
        await self._set_poe(False)
