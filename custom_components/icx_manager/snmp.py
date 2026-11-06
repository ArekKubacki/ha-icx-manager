"""Asynchronous SNMPv3 client based on the PySNMP 7.1 API."""

from __future__ import annotations

from pysnmp.hlapi.v3arch.asyncio import (
    ContextData,
    ObjectIdentity,
    ObjectType,
    SnmpEngine,
    UdpTransportTarget,
    UsmUserData,
    USM_AUTH_HMAC96_SHA,
    USM_AUTH_HMAC192_SHA256,
    USM_AUTH_NONE,
    USM_PRIV_CBC56_DES,
    USM_PRIV_CFB128_AES,
    USM_PRIV_NONE,
    bulk_walk_cmd,
    get_cmd,
    set_cmd,
)
from pysnmp.proto.rfc1902 import Integer32
from pysnmp.proto.rfc1905 import EndOfMibView, NoSuchInstance, NoSuchObject

from .const import (
    CONF_AUTH_PASSWORD,
    CONF_AUTH_PROTOCOL,
    CONF_PRIV_PASSWORD,
    CONF_PRIV_PROTOCOL,
    SYS_NAME,
)


class SnmpError(Exception):
    """An SNMP request or response failed."""


class IcxSnmpClient:
    """One switch; credentials are never written to the logs."""

    def __init__(self, config: dict) -> None:
        self.host = config["host"]
        self.port = int(config["port"])
        self.engine = SnmpEngine()
        auth_protocol = {
            "NONE": USM_AUTH_NONE,
            "SHA": USM_AUTH_HMAC96_SHA,
            "SHA256": USM_AUTH_HMAC192_SHA256,
        }[config[CONF_AUTH_PROTOCOL]]
        priv_protocol = {
            "NONE": USM_PRIV_NONE,
            "DES": USM_PRIV_CBC56_DES,
            "AES128": USM_PRIV_CFB128_AES,
        }[config[CONF_PRIV_PROTOCOL]]
        self.credentials = UsmUserData(
            config["username"],
            authKey=config.get(CONF_AUTH_PASSWORD) or None,
            privKey=config.get(CONF_PRIV_PASSWORD) or None,
            authProtocol=auth_protocol,
            privProtocol=priv_protocol,
        )
        self.target = None

    async def connect(self) -> None:
        """Create the UDP target once, then reuse the transport."""
        if self.target is None:
            self.target = await UdpTransportTarget.create(
                (self.host, self.port), timeout=2, retries=1
            )

    def close(self) -> None:
        """Close the dispatcher when the config entry is removed."""
        self.engine.close_dispatcher()

    @staticmethod
    def _check(error_indication, error_status, var_binds) -> None:
        if error_indication:
            raise SnmpError(str(error_indication))
        if error_status:
            raise SnmpError(str(error_status))
        if not var_binds:
            raise SnmpError("SNMP returned no values")

    @staticmethod
    def _value(value):
        if isinstance(value, (NoSuchObject, NoSuchInstance, EndOfMibView)):
            return None
        return value

    async def get(self, oid: str):
        """Read one scalar OID."""
        await self.connect()
        error, status, _index, binds = await get_cmd(
            self.engine,
            self.credentials,
            self.target,
            ContextData(),
            ObjectType(ObjectIdentity(oid)),
        )
        self._check(error, status, binds)
        return self._value(binds[0][1])

    async def walk(self, oid: str) -> dict[int, object]:
        """Walk an OID column and return values by numeric row index."""
        from .util import oid_row_index

        await self.connect()
        results = {}
        async for error, status, _index, binds in bulk_walk_cmd(
            self.engine,
            self.credentials,
            self.target,
            ContextData(),
            0,
            20,
            ObjectType(ObjectIdentity(oid)),
            lexicographicMode=False,
        ):
            self._check(error, status, binds)
            for name, value in binds:
                row_index = oid_row_index(oid, str(name))
                cleaned = self._value(value)
                if row_index is not None and cleaned is not None:
                    results[row_index] = cleaned
        return results

    async def set_integer(self, oid: str, value: int) -> None:
        """Issue a single SNMP SET and raise if it fails."""
        await self.connect()
        error, status, _index, binds = await set_cmd(
            self.engine,
            self.credentials,
            self.target,
            ContextData(),
            ObjectType(ObjectIdentity(oid), Integer32(value)),
        )
        self._check(error, status, binds)

    async def check_connection(self) -> str:
        """Check read access before saving configuration."""
        result = await self.get(SYS_NAME)
        if result is None:
            raise SnmpError("sysName is unavailable")
        return str(result)
