"""Expose ICX physical Ethernet link state to Home Assistant."""

from homeassistant.components.binary_sensor import BinarySensorDeviceClass, BinarySensorEntity

from .const import DOMAIN
from .entity import IcxEntity


async def async_setup_entry(hass, entry, async_add_entities):
    coordinator = hass.data[DOMAIN][entry.entry_id]
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

    @property
    def is_on(self):
        return self.port["link"] if self.port else None

    @property
    def extra_state_attributes(self):
        return (
            {"description": self.port["alias"]}
            if self.port and self.port["alias"] else None
        )
