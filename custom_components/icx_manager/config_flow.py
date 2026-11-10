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
    CONF_ENABLE_PORT_CONTROL, CONF_UPLINK_PORT, CONF_EXCLUDED_PORTS,
    NO_UPLINK,
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


    @staticmethod
    def async_get_options_flow(config_entry):
        return IcxOptionsFlow()


def _port_sort(label: str) -> tuple[int, ...]:
    """Sort interfaces numerically, e.g. 1/1/2 before 1/1/10."""
    try:
        return tuple(int(chunk) for chunk in label.split("/"))
    except ValueError:
        return (99999,)


class IcxOptionsFlow(config_entries.OptionsFlow):
    """Dangerous Ethernet control and optional network-flow aggregates."""

    async def async_step_init(self, user_input=None):
        if user_input is not None:
            return self.async_create_entry(title="", data={
                CONF_ENABLE_PORT_CONTROL: user_input.get(CONF_ENABLE_PORT_CONTROL, False),
                CONF_UPLINK_PORT: user_input.get(CONF_UPLINK_PORT, NO_UPLINK),
                CONF_EXCLUDED_PORTS: user_input.get(CONF_EXCLUDED_PORTS, []),
            })

        saved = self.config_entry.options
        coordinator = self.hass.data.get(DOMAIN, {}).get(self.config_entry.entry_id)
        ports = coordinator.data.get("ports", {}) if coordinator and coordinator.data else {}
        names = {p["label"]: p.get("alias", "") for p in ports.values()}

        saved_uplink = saved.get(CONF_UPLINK_PORT, NO_UPLINK)
        saved_excluded = list(saved.get(CONF_EXCLUDED_PORTS, []))
        # Preserve selected interfaces if the SNMP table is temporarily incomplete.
        for label in (saved_uplink, *saved_excluded):
            if label and label != NO_UPLINK:
                names.setdefault(label, "")

        port_options = [
            selector.SelectOptionDict(
                value=label,
                label=f"{label} — {alias}" if alias else label,
            )
            for label, alias in sorted(names.items(), key=lambda x: _port_sort(x[0]))
        ]
        uplink_options = [
            selector.SelectOptionDict(value=NO_UPLINK, label="— Not configured —"),
            *port_options,
        ]

        return self.async_show_form(
            step_id="init",
            data_schema=vol.Schema({
                vol.Required(
                    CONF_ENABLE_PORT_CONTROL,
                    default=saved.get(CONF_ENABLE_PORT_CONTROL, False),
                ): bool,
                vol.Required(
                    CONF_UPLINK_PORT,
                    default=saved_uplink,
                ): selector.SelectSelector(selector.SelectSelectorConfig(
                    options=uplink_options,
                    mode=selector.SelectSelectorMode.DROPDOWN,
                )),
                vol.Optional(
                    CONF_EXCLUDED_PORTS,
                    default=saved_excluded,
                ): selector.SelectSelector(selector.SelectSelectorConfig(
                    options=port_options,
                    multiple=True,
                    mode=selector.SelectSelectorMode.DROPDOWN,
                )),
            }),
        )
