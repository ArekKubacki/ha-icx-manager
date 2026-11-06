"""Turn PoE power on and off; leave Ethernet link configuration unchanged."""

from homeassistant.components.switch import SwitchEntity
from homeassistant.exceptions import HomeAssistantError

from .const import CONF_ENABLE_PORT_CONTROL, DOMAIN, IF_ADMIN_STATUS, POE_DISABLED, POE_ENABLED, POE_PORT_CONTROL
from .entity import IcxEntity
from .snmp import SnmpError


def _apply_accepted_command(coordinator, ifindex: int, **changes) -> None:
    """Publish a successful SNMP SET without waiting for all SNMP walks.

    The next scheduled poll will independently reconcile real device state.
    """
    current = coordinator.data
    port = current["ports"].get(ifindex)
    if port is None:
        return
    ports = dict(current["ports"])
    ports[ifindex] = {**port, **changes}
    coordinator.async_set_updated_data({**current, "ports": ports})


async def async_setup_entry(hass, entry, async_add_entities):
    coordinator = hass.data[DOMAIN][entry.entry_id]
    entities = [
        IcxPoeSwitch(coordinator, entry, port)
        for port in coordinator.data["ports"].values()
        if port["poe_index"] is not None
    ]
    if entry.options.get(CONF_ENABLE_PORT_CONTROL, False):
        entities.extend(
            IcxAdminSwitch(coordinator, entry, port)
            for port in coordinator.data["ports"].values()
            if port["admin_on"] is not None
        )
    async_add_entities(entities)


class IcxPoeSwitch(IcxEntity, SwitchEntity):
    """SNMP SET on a validated row index in the FDRY-POE-MIB."""

    def __init__(self, coordinator, entry, port):
        super().__init__(coordinator, entry, f"port_{port['label']}_poe", port)
        self._attr_name = f"Port {port['label']} PoE"
        self._poe_index = port["poe_index"]
        self._icx_metric = "poe"

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
        _apply_accepted_command(
            self.coordinator, self.port_index,
            poe_mode=POE_ENABLED if enabled else POE_DISABLED,
        )

    async def async_turn_on(self, **kwargs) -> None:
        await self._set_poe(True)

    async def async_turn_off(self, **kwargs) -> None:
        await self._set_poe(False)


class IcxAdminSwitch(IcxEntity, SwitchEntity):
    """Opt-in SNMP SET for interface administrative status, not PoE."""

    def __init__(self, coordinator, entry, port):
        super().__init__(coordinator, entry, f"port_{port['label']}_admin", port)
        self._attr_name = f"Port {port['label']} Ethernet enabled"
        self._attr_icon = "mdi:ethernet"
        self._icx_metric = "admin"

    @property
    def is_on(self) -> bool | None:
        return self.port["admin_on"] if self.port else None

    async def _set_admin(self, enabled: bool) -> None:
        # No retries: this SET can disconnect the switch from HA.
        try:
            await self.coordinator.client.set_integer(
                f"{IF_ADMIN_STATUS}.{self.port_index}", 1 if enabled else 2
            )
        except (SnmpError, OSError, TimeoutError) as exc:
            raise HomeAssistantError(
                f"Cannot change Ethernet state for {self._label}: {exc}"
            ) from exc
        _apply_accepted_command(self.coordinator, self.port_index, admin_on=enabled)

    async def async_turn_on(self, **kwargs) -> None:
        await self._set_admin(True)

    async def async_turn_off(self, **kwargs) -> None:
        await self._set_admin(False)
