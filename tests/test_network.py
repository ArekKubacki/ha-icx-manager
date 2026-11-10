"""Unit tests for switch aggregate logic, without Home Assistant."""

import importlib.util
from pathlib import Path

import pytest

FILE = Path(__file__).parents[1] / "custom_components" / "icx_manager" / "network.py"
spec = importlib.util.spec_from_file_location("icx_network", FILE)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

PORTS = {
    101: {"label": "1/1/1", "link": True, "rx_mbps": 1.0, "tx_mbps": 2.0},
    107: {"label": "1/1/7", "link": False, "rx_mbps": 0.0, "tx_mbps": 0.0},
    148: {"label": "1/1/48", "link": True, "rx_mbps": 125.5, "tx_mbps": 12.25},
    201: {"label": "1/2/1", "link": True, "rx_mbps": 987.0, "tx_mbps": 250.0},
    202: {"label": "1/2/2", "link": None, "rx_mbps": None, "tx_mbps": None},
}


def test_all_active_links():
    assert module.count_link_up(PORTS) == 3


def test_uplink_not_counted_downstream():
    assert module.active_downlinks(PORTS, "1/2/1") == 2


def test_excluded_downlinks():
    assert module.active_downlinks(PORTS, "1/2/1", ["1/1/1"]) == 1


def test_exclusions_do_not_affect_all_ports_metric():
    assert module.count_link_up(PORTS) == 3
    assert module.count_link_up(PORTS, ["1/1/1", "1/2/1"]) == 1


def test_absent_uplink_returns_unknown():
    assert module.uplink_mbps(PORTS, "none", "rx") is None
    assert module.uplink_mbps(PORTS, "1/1/99", "tx") is None


def test_uplink_measures_exact_port():
    assert module.uplink_mbps(PORTS, "1/2/1", "rx") == 987.0
    assert module.uplink_mbps(PORTS, "1/2/1", "tx") == 250.0
    assert module.uplink_mbps(PORTS, "1/1/7", "rx") == 0.0


def test_ifindex_independent_of_port_number():
    assert module.get_port(PORTS, "1/1/1")["rx_mbps"] == 1.0


def test_invalid_direction():
    with pytest.raises(ValueError):
        module.uplink_mbps(PORTS, "1/1/1", "other")


def test_no_active_ports():
    assert module.active_downlinks({1: {"label": "1/1/1", "link": False}}) == 0
