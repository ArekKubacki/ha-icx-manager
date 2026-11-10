"""Expose ICX physical Ethernet link state to Home Assistant."""

from homeassistant.components.binary_sensor import BinarySensorDeviceClass, BinarySensorEntity

from .const import DOMAIN
from .entity import IcxEntity


async def async_setup_entry(hass, entry, async_add_entities):
    coordinator = hass.data[DOMAIN][entry.entry_id]
    async_add_entities([IcxOnline(coordinator, entry)])
    async_add_entities(
        IcxLink(coordinator, entry, port)
        for port in coordinator.data["ports"].values()
        if port["link"] is not None
    )


class IcxLink(IcxEntity, BinarySensorEntity):
    """Connectivity on when ifOperStatus == up(1)."""

    _attr_device_class = BinarySensorDeviceClass.CONNECTIVITY

    def __init__(self, coordinator, entry, port):
        super().__init__(coordinator, entry, f"port_{port['label']}_link", port)
        self._attr_name = f"Port {port['label']} link"
        self._icx_metric = "link"

    @property
    def is_on(self):
        return self.port["link"] if self.port else None




class IcxOnline(IcxEntity, BinarySensorEntity):
    """Show OFF after poll failure, rather than hiding status as unavailable."""

    _attr_name = "Online"
    _attr_device_class = BinarySensorDeviceClass.CONNECTIVITY

    def __init__(self, coordinator, entry):
        super().__init__(coordinator, entry, "online")

    @property
    def available(self) -> bool:
        # Network Flow Card should render an explicit OFF on SNMP failure.
        return True

    @property
    def is_on(self) -> bool:
        return bool(self.coordinator.last_update_success)
