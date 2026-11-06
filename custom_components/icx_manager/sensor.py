"""PoE power draw, 64-bit interface throughput, and system uptime."""

from homeassistant.components.sensor import SensorEntity, SensorDeviceClass, SensorStateClass
from homeassistant.const import UnitOfPower, UnitOfTime

from .const import DOMAIN
from .entity import IcxEntity


async def async_setup_entry(hass, entry, async_add_entities):
    coordinator = hass.data[DOMAIN][entry.entry_id]
    entities = [IcxUptime(coordinator, entry)]
    for port in coordinator.data["ports"].values():
        if port["poe_index"] is not None:
            entities.append(IcxPoeWatts(coordinator, entry, port))
        for direction, enabled in (("rx", port["has_rx"]), ("tx", port["has_tx"])):
            if enabled:
                entities.append(IcxThroughput(coordinator, entry, port, direction))
    async_add_entities(entities)


class IcxUptime(IcxEntity, SensorEntity):
    """sysUpTime expressed in seconds."""

    _attr_name = "Uptime"
    _attr_device_class = SensorDeviceClass.DURATION
    _attr_native_unit_of_measurement = UnitOfTime.SECONDS
    _attr_state_class = SensorStateClass.MEASUREMENT

    def __init__(self, coordinator, entry):
        super().__init__(coordinator, entry, "uptime")

    @property
    def native_value(self):
        return self.coordinator.data["uptime"]


class IcxPoeWatts(IcxEntity, SensorEntity):
    """Real PoE consumption from snAgentPoePortConsumed, in watts."""

    _attr_device_class = SensorDeviceClass.POWER
    _attr_native_unit_of_measurement = UnitOfPower.WATT
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_suggested_display_precision = 2

    def __init__(self, coordinator, entry, port):
        super().__init__(coordinator, entry, f"port_{port['label']}_poe_power", port)
        self._attr_name = f"Port {port['label']} PoE power"

    @property
    def native_value(self):
        return self.port["poe_watts"] if self.port else None


class IcxThroughput(IcxEntity, SensorEntity):
    """Throughput in Mbit/s, based on two consecutive counter polls."""

    _attr_native_unit_of_measurement = "Mbit/s"
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_suggested_display_precision = 2

    def __init__(self, coordinator, entry, port, direction):
        super().__init__(coordinator, entry, f"port_{port['label']}_{direction}", port)
        self.direction = direction
        self._attr_name = f"Port {port['label']} {direction.upper()}"

    @property
    def native_value(self):
        return self.port[f"{self.direction}_mbps"] if self.port else None
