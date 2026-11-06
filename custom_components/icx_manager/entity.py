"""Base entity and device registry metadata for the switch."""

from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN


class IcxEntity(CoordinatorEntity):
    """Entities for the same switch share a Home Assistant device."""

    _attr_has_entity_name = True

    def __init__(self, coordinator, entry, suffix: str, port: dict | None = None):
        super().__init__(coordinator)
        self.port_index = port["ifindex"] if port is not None else None
        self._label = port["label"] if port is not None else None
        self._attr_unique_id = f"{entry.unique_id}_{suffix}"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, entry.unique_id)},
            name=coordinator.data["name"],
            manufacturer="Brocade / Ruckus",
            model="ICX",
        )

    @property
    def port(self):
        """Read the latest port snapshot, not the initial one."""
        if self.port_index is None:
            return None
        return self.coordinator.data["ports"].get(self.port_index)

    @property
    def available(self) -> bool:
        return super().available and (
            self.port_index is None or self.port is not None
        )
