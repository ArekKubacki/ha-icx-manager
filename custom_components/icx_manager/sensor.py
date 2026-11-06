"""PoE power draw, 64-bit interface throughput, and system uptime."""

from homeassistant.components.sensor import SensorEntity, SensorDeviceClass, SensorStateClass
from homeassistant.const import UnitOfPower, UnitOfTime

from .const import DOMAIN
from .entity import IcxEntity


async def async_setup_entry(hass, entry, async_add_entities):
    coordinator = hass.data[DOMAIN][entry.entry_id]
    entities = [IcxUptime(coordinator, entry), IcxPoeTotal(coordinator, entry)]
    for port in coordinator.data["ports"].values():
        if port["poe_index"] is not None:
            entities.append(IcxPoeWatts(coordinator, entry, port))
        for direction, enabled in (("rx", port["has_rx"]), ("tx", port["has_tx"])):
            if enabled:
                entities.append(IcxThroughput(coordinator, entry, port, direction))
        for field, metric, unit in (
            ("speed_mbps", "speed", "Mbit/s"),
            ("rx_percent", "rx_utilization", "%"),
            ("tx_percent", "tx_utilization", "%"),
            ("in_errors", "rx_errors", None),
            ("out_errors", "tx_errors", None),
            ("in_discards", "rx_discards", None),
            ("out_discards", "tx_discards", None),
        ):
            if port[field] is not None or (
                field in ("rx_percent", "tx_percent") and port["speed_mbps"]
            ):
                entities.append(IcxPortMetric(coordinator, entry, port, field, metric, unit))
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
        self._icx_metric = "poe_watts"

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
        self._icx_metric = f"{direction}_mbps"
        self._attr_name = f"Port {port['label']} {direction.upper()}"

    @property
    def native_value(self):
        return self.port[f"{self.direction}_mbps"] if self.port else None


class IcxPoeTotal(IcxEntity, SensorEntity):
    """Sum of measured PoE power; this is not the power supply budget."""

    _attr_name = "Total PoE consumption"
    _attr_device_class = SensorDeviceClass.POWER
    _attr_native_unit_of_measurement = UnitOfPower.WATT
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_suggested_display_precision = 2

    def __init__(self, coordinator, entry):
        super().__init__(coordinator, entry, "poe_total_watts")

    @property
    def native_value(self):
        return self.coordinator.data["poe_total_watts"]

    @property
    def extra_state_attributes(self):
        return {
            **super().extra_state_attributes,
            "measured_ports": self.coordinator.data["poe_measured_count"],
            "poe_ports": self.coordinator.data["poe_port_count"],
            "partial": self.coordinator.data["poe_measured_count"]
            < self.coordinator.data["poe_port_count"],
        }


class IcxPortMetric(IcxEntity, SensorEntity):
    """SNMP physical port diagnostic counter or utilization."""

    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_suggested_display_precision = 2

    def __init__(self, coordinator, entry, port, field, metric, unit):
        super().__init__(coordinator, entry, f"port_{port['label']}_{metric}", port)
        self._attr_name = f"Port {port['label']} {metric.replace('_', ' ')}"
        self._icx_metric = metric
        self._field = field
        if unit:
            self._attr_native_unit_of_measurement = unit

    @property
    def native_value(self):
        return self.port[self._field] if self.port else None
