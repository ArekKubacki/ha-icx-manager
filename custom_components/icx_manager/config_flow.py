"""Connection form for a local Brocade / Ruckus ICX SNMPv3 device."""

from __future__ import annotations

import logging

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.const import CONF_HOST, CONF_PORT, CONF_USERNAME
from homeassistant.helpers import selector

from .const import (
    CONF_AUTH_PASSWORD, CONF_AUTH_PROTOCOL,
    CONF_PRIV_PASSWORD, CONF_PRIV_PROTOCOL, DEFAULT_PORT, DOMAIN,
)
from .snmp import IcxSnmpClient, SnmpError

_LOGGER = logging.getLogger(__name__)


def _schema(defaults: dict | None = None):
    defaults = defaults or {}
    password_selector = selector.TextSelector(
        selector.TextSelectorConfig(type=selector.TextSelectorType.PASSWORD)
    )
    return vol.Schema({
        vol.Required(CONF_HOST, default=defaults.get(CONF_HOST, "")): str,
        vol.Required(CONF_PORT, default=defaults.get(CONF_PORT, DEFAULT_PORT)):
            vol.All(vol.Coerce(int), vol.Range(min=1, max=65535)),
        vol.Required(CONF_USERNAME, default=defaults.get(CONF_USERNAME, "")): str,
        vol.Required(CONF_AUTH_PROTOCOL, default=defaults.get(CONF_AUTH_PROTOCOL, "SHA")):
            vol.In(["NONE", "SHA", "SHA256"]),
        vol.Optional(CONF_AUTH_PASSWORD): password_selector,
        vol.Required(CONF_PRIV_PROTOCOL, default=defaults.get(CONF_PRIV_PROTOCOL, "DES")):
            vol.In(["NONE", "DES", "AES128"]),
        vol.Optional(CONF_PRIV_PASSWORD): password_selector,
    })


class IcxConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """SNMPv3 setup wizard."""

    VERSION = 1

    async def async_step_user(self, user_input=None):
        errors = {}
        if user_input is not None:
            auth = user_input[CONF_AUTH_PROTOCOL]
            priv = user_input[CONF_PRIV_PROTOCOL]
            if (
                (auth != "NONE" and not user_input.get(CONF_AUTH_PASSWORD))
                or (priv != "NONE" and not user_input.get(CONF_PRIV_PASSWORD))
                or (priv != "NONE" and auth == "NONE")
            ):
                errors["base"] = "invalid_security"
            else:
                client = IcxSnmpClient(user_input)
                try:
                    name = await client.check_connection()
                except (SnmpError, OSError, TimeoutError, ValueError) as exc:
                    _LOGGER.debug(
                        "ICX validation failed for %s: %s", user_input[CONF_HOST], exc
                    )
                    errors["base"] = "cannot_connect"
                else:
                    await self.async_set_unique_id(
                        f"{user_input[CONF_HOST].strip().lower()}:{user_input[CONF_PORT]}"
                    )
                    self._abort_if_unique_id_configured()
                    return self.async_create_entry(title=name, data=user_input)
                finally:
                    client.close()
        return self.async_show_form(
            step_id="user", data_schema=_schema(user_input), errors=errors
        )
