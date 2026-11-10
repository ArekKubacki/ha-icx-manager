"""Pure helpers for switch-wide network diagnostics and Network Flow Card.

Counts represent link-up physical ports, not client devices. Uplink traffic is
read from the chosen port instead of summing counters (which double-counts).
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping


def get_port(ports: Mapping[int, dict], name: str | None) -> dict | None:
    """Find an interface by physical label (never assume ifIndex)."""
    if not name or name == "none":
        return None
    return next((p for p in ports.values() if p.get("label") == name), None)


def count_link_up(ports: Mapping[int, dict], excluded: Iterable[str] = ()) -> int:
    """Count interfaces with ifOperStatus explicitly up."""
    blocked = set(excluded)
    return sum(
        1 for p in ports.values()
        if p.get("link") is True and p.get("label") not in blocked
    )


def active_downlinks(
    ports: Mapping[int, dict], uplink: str | None = None,
    excluded: Iterable[str] = (),
) -> int:
    """Count active links excluding the uplink and user-excluded ports."""
    blocked = set(excluded)
    if uplink and uplink != "none":
        blocked.add(uplink)
    return count_link_up(ports, blocked)


def uplink_mbps(
    ports: Mapping[int, dict], uplink: str | None, direction: str,
) -> float | None:
    """Only one port's RX/TX data; None when not configured or unavailable."""
    if direction not in ("rx", "tx"):
        raise ValueError("direction must be rx or tx")
    port = get_port(ports, uplink)
    return port.get(f"{direction}_mbps") if port is not None else None
