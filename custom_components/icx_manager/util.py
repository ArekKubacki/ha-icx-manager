"""Small pure functions used to interpret interface data."""

import re

_PORT_PATTERN = re.compile(r"(?:^|[^0-9])(\d+/\d+/\d+)\s*$")


def physical_port(name: str) -> str | None:
    """Find a physical 1/1/7 style interface, excluding VLANs and loopbacks."""
    match = _PORT_PATTERN.search(name)
    return match.group(1) if match else None


def oid_row_index(base: str, full_oid: str) -> int | None:
    """Parse a single integer SNMP table index, rejecting other OID branches."""
    prefix = base + "."
    if not full_oid.startswith(prefix):
        return None
    suffix = full_oid[len(prefix):]
    return int(suffix) if suffix.isascii() and suffix.isdigit() else None


def mbps_from_octets(
    current: int | None, previous: int | None, seconds: float
) -> float | None:
    """Convert a valid 64-bit octet counter delta into megabits per second."""
    if current is None or previous is None or seconds <= 0 or current < previous:
        return None
    return round((current - previous) * 8 / seconds / 1_000_000, 3)
