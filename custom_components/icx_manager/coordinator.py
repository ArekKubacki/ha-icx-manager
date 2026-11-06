"""Poll ICX and correlate physical ports with PoE interfaces."""

from __future__ import annotations

import asyncio
import logging
from datetime import timedelta
from time import monotonic

from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .const import (
    DOMAIN, IF_ADMIN_STATUS, IF_ALIAS, IF_HC_IN_OCTETS, IF_HC_OUT_OCTETS,
    IF_HIGH_SPEED, IF_IN_DISCARDS, IF_IN_ERRORS, IF_NAME, IF_OPER_STATUS,
    IF_OUT_DISCARDS, IF_OUT_ERRORS, POE_PORT_CONSUMED, POE_PORT_CONTROL,
    POE_PORT_IFINDEX, SCAN_INTERVAL, SYS_NAME, SYS_UPTIME,
)
from .snmp import IcxSnmpClient, SnmpError
from .util import mbps_from_octets, physical_port

_LOGGER = logging.getLogger(__name__)


class IcxCoordinator(DataUpdateCoordinator):
    """Coordinated snapshot of link, traffic, errors and power."""

    def __init__(self, hass, client: IcxSnmpClient) -> None:
        super().__init__(
            hass, _LOGGER, name=DOMAIN,
            update_interval=timedelta(seconds=SCAN_INTERVAL),
        )
        self.client = client
        self._previous_counters: dict[int, tuple[int | None, int | None]] = {}
        self._previous_time: float | None = None
        self._previous_uptime: int | None = None

    async def _async_update_data(self) -> dict:
        async def optional_walk(oid):
            try:
                return await self.client.walk(oid)
            except (SnmpError, OSError, TimeoutError) as exc:
                _LOGGER.debug("Optional ICX OID %s unavailable: %s", oid, exc)
                return {}

        try:
            (
                sysname, uptime, names, statuses, poe_ifindex,
                poe_controls, aliases, consumed, in_octets, out_octets,
                admin, speeds, in_errors, out_errors, in_discards, out_discards,
            ) = await asyncio.gather(
                self.client.get(SYS_NAME),
                self.client.get(SYS_UPTIME),
                self.client.walk(IF_NAME),
                self.client.walk(IF_OPER_STATUS),
                optional_walk(POE_PORT_IFINDEX),
                optional_walk(POE_PORT_CONTROL),
                optional_walk(IF_ALIAS),
                optional_walk(POE_PORT_CONSUMED),
                optional_walk(IF_HC_IN_OCTETS),
                optional_walk(IF_HC_OUT_OCTETS),
                optional_walk(IF_ADMIN_STATUS),
                optional_walk(IF_HIGH_SPEED),
                optional_walk(IF_IN_ERRORS),
                optional_walk(IF_OUT_ERRORS),
                optional_walk(IF_IN_DISCARDS),
                optional_walk(IF_OUT_DISCARDS),
            )
        except (SnmpError, OSError, TimeoutError) as exc:
            raise UpdateFailed(f"ICX SNMP unavailable: {exc}") from exc

        if not names:
            raise UpdateFailed("ICX did not return ifName")

        now = monotonic()
        elapsed = now - self._previous_time if self._previous_time is not None else 0
        ticks = int(uptime) if uptime is not None else None
        rebooted = (
            self._previous_uptime is not None
            and ticks is not None and ticks < self._previous_uptime
        )
        if rebooted:
            self._previous_counters.clear()

        ports = {}
        for ifindex, raw_name in names.items():
            label = physical_port(str(raw_name))
            if label is None:
                continue
            current_in = int(in_octets[ifindex]) if ifindex in in_octets else None
            current_out = int(out_octets[ifindex]) if ifindex in out_octets else None
            previous_in, previous_out = self._previous_counters.get(
                ifindex, (None, None)
            )
            rx = mbps_from_octets(current_in, previous_in, elapsed)
            tx = mbps_from_octets(current_out, previous_out, elapsed)
            speed = int(speeds[ifindex]) if ifindex in speeds else None
            if speed is not None and speed <= 0:
                speed = None
            ports[ifindex] = {
                "ifindex": ifindex,
                "label": label,
                "alias": str(aliases.get(ifindex, "")),
                "link": int(statuses[ifindex]) == 1 if ifindex in statuses else None,
                "admin_on": int(admin[ifindex]) == 1 if ifindex in admin else None,
                "speed_mbps": speed,
                "rx_mbps": rx,
                "tx_mbps": tx,
                "rx_percent": round(rx / speed * 100, 2)
                if rx is not None and speed else None,
                "tx_percent": round(tx / speed * 100, 2)
                if tx is not None and speed else None,
                "in_errors": int(in_errors[ifindex]) if ifindex in in_errors else None,
                "out_errors": int(out_errors[ifindex]) if ifindex in out_errors else None,
                "in_discards": int(in_discards[ifindex]) if ifindex in in_discards else None,
                "out_discards": int(out_discards[ifindex]) if ifindex in out_discards else None,
                "has_rx": current_in is not None,
                "has_tx": current_out is not None,
                "poe_index": None,
                "poe_mode": None,
                "poe_watts": None,
            }
            self._previous_counters[ifindex] = (current_in, current_out)

        # The PoE table is indexed separately; use the actual ifIndex mapping.
        for poe_index, raw_ifindex in poe_ifindex.items():
            try:
                ifindex = int(raw_ifindex)
            except (TypeError, ValueError):
                continue
            port = ports.get(ifindex)
            if port is None:
                continue
            mode = int(poe_controls[poe_index]) if poe_index in poe_controls else None
            if mode not in (2, 3, 4):
                continue
            port["poe_index"] = poe_index
            port["poe_mode"] = mode
            port["poe_watts"] = (
                round(int(consumed[poe_index]) / 1000, 3)
                if poe_index in consumed else None
            )

        poe_ports = [p for p in ports.values() if p["poe_index"] is not None]
        measured = [p["poe_watts"] for p in poe_ports if p["poe_watts"] is not None]
        self._previous_time = now
        self._previous_uptime = ticks
        return {
            "name": str(sysname) if sysname is not None else self.client.host,
            "uptime": ticks / 100 if ticks is not None else None,
            "poe_total_watts": round(sum(measured), 3) if measured else None,
            "poe_port_count": len(poe_ports),
            "poe_measured_count": len(measured),
            "ports": ports,
        }
