"""Unit tests that do not require Home Assistant or a network switch."""

import importlib.util
from pathlib import Path

import pytest

FILE = Path(__file__).parents[1] / "custom_components" / "icx_manager" / "util.py"
spec = importlib.util.spec_from_file_location("icx_util", FILE)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


@pytest.mark.parametrize("value,expected", [
    ("1/1/7", "1/1/7"),
    ("ethernet 1/1/48", "1/1/48"),
    ("GigabitEthernet1/3/1", "1/3/1"),
    ("Ve 10", None),
    ("Vlan12", None),
    ("loopback 1", None),
])
def test_port(value, expected):
    assert module.physical_port(value) == expected


def test_oid_index():
    assert module.oid_row_index("1.2.3", "1.2.3.7") == 7
    assert module.oid_row_index("1.2.3", "1.2.30.7") is None
    assert module.oid_row_index("1.2.3", "1.2.3.4.5") is None


def test_traffic_rate():
    assert module.mbps_from_octets(1_500_000, 500_000, 4) == 2.0
    assert module.mbps_from_octets(1, 10, 4) is None
    assert module.mbps_from_octets(1, None, 4) is None
    assert module.mbps_from_octets(10, 1, 0) is None
