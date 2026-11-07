/* ICX Manager card v0.2.6 — dependency-free Lovelace custom element. */
class IcxManagerCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._selected = null;
    this._pending = new Map();
    this._error = "";
    this._scheduled = false;
    this._prior = new Map();
    this._device = null;
    this.shadowRoot.addEventListener("click", (event) => this._click(event));
  }

  setConfig(config) {
    if (!config || typeof config !== "object") {
      throw new Error("ICX Manager: card config must be an object");
    }
    this._config = { ...config };
    this._schedule();
  }

  set hass(value) {
    this._hass = value;
    if (!this._config) return;
    // Avoid rebuilding the DOM on every unrelated HA entity update.
    const current = new Map(Object.entries(value.states || {})
      .filter(([, state]) => state.attributes?.icx_device));
    const changed = current.size !== this._prior.size ||
      [...current].some(([id, state]) => this._prior.get(id) !== state);
    this._prior = current;
    if (changed) this._schedule();
  }

  getCardSize() {
    return 8;
  }

  // Native card resizing in Home Assistant Sections dashboards.
  getGridOptions() {
    return { columns: 12, min_columns: 3 };
  }

  static getConfigElement() {
    return document.createElement("icx-manager-card-editor");
  }

  _schedule() {
    if (this._scheduled) return;
    this._scheduled = true;
    const raf = typeof requestAnimationFrame === "function"
      ? requestAnimationFrame : (fn) => setTimeout(fn, 0);
    raf(() => { this._scheduled = false; this._render(); });
  }

  _displayName(label, port) {
    const custom = this._config.port_names?.[label];
    const alias = port?.link?.attributes?.description ||
      port?.poe?.attributes?.description || "";
    return (typeof custom === "string" && custom.trim()) ||
      alias || "Port " + label;
  }

  static getStubConfig() {
    return { type: "custom:icx-manager-card", title: "ICX Manager" };
  }

  _escape(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  _metric(port, key) {
    return port ? port[key] : undefined;
  }

  _value(entity, suffix = "") {
    if (!entity || ["unknown", "unavailable"].includes(entity.state)) {
      return "—";
    }
    return this._escape(entity.state) + suffix;
  }

  _switchText(entity, yes, no) {
    if (entity?.state === "on") return yes;
    if (entity?.state === "off") return no;
    return "—";
  }

  _click(event) {
    const button = event.target.closest("button");
    if (!button || button.disabled) return;
    const select = button.getAttribute("data-select");
    if (select !== null) {
      this._selected = select;
      this._schedule();
      return;
    }
    const action = button.getAttribute("data-action");
    const entityId = button.getAttribute("data-entity");
    if (!action || !entityId || !this._hass) return;
    const stateObj = this._hass.states[entityId];
    if (!stateObj || !["on", "off"].includes(stateObj.state) || this._pending.has(entityId)) return;
    const target = stateObj.state === "on" ? "turn_off" : "turn_on";
    if (action === "admin") {
      const verb = target === "turn_off" ? "WYŁĄCZYSZ" : "WŁĄCZYSZ";
      const warning = "Uwaga: " + verb + " port Ethernet " + (this._selected || "") +
        ". Wyłączenie uplinku może odciąć switch oraz Home Assistant. Kontynuować?";
      if (!window.confirm(warning)) return;
    }
    // Immediate visual feedback; the real status remains unconfirmed.
    const pending = { desired: target === "turn_on" ? "on" : "off" };
    this._pending.set(entityId, pending);
    this._error = "";
    this._schedule();
    setTimeout(() => {
      if (this._pending.get(entityId) !== pending) return;
      this._pending.delete(entityId);
      this._error = "Brak potwierdzenia z portu. Sprawdź połączenie SNMP.";
      this._schedule();
    }, 15000);
    this._hass.callService("switch", target, { entity_id: entityId })
      .catch((error) => {
        if (this._pending.get(entityId) === pending) {
          this._pending.delete(entityId);
          this._error = "Błąd zmiany stanu portu. Sprawdź logi HA.";
          this._schedule();
        }
        console.error("ICX Manager: switch action failed", error);
      });
  }

  _render() {
    if (!this._config || !this._hass) return;

    const all = Object.values(this._hass.states)
      .filter((state) => state.attributes && state.attributes.icx_device);
    const devices = [...new Set(all.map((state) => state.attributes.icx_device))].sort();
    const device = this._config.device || devices[0];
    const states = all.filter((state) => state.attributes.icx_device === device);
    for (const [id, pending] of this._pending) {
      if (this._hass.states[id]?.state === pending.desired) this._pending.delete(id);
    }
    const ports = new Map();
    const system = {};
    for (const entity of states) {
      const attrs = entity.attributes;
      if (attrs.icx_port) {
        if (!ports.has(attrs.icx_port)) ports.set(attrs.icx_port, {});
        ports.get(attrs.icx_port)[attrs.icx_metric] = entity;
      } else {
        system[attrs.icx_metric] = entity;
      }
    }

    const labels = [...ports.keys()].sort((a, b) => {
      const n = (s) => s.split("/").map(Number);
      const x = n(a), y = n(b);
      return (x[0] - y[0]) || (x[1] - y[1]) || (x[2] - y[2]);
    });
    if (!labels.includes(this._selected)) this._selected = labels[0] || null;
    const activeCount = labels.filter((name) => ports.get(name).link?.state === "on").length;
    const poeCount = labels.filter((name) => ports.get(name).poe?.state === "on").length;
    const power = system.poe_total_watts;
    const partial = power?.attributes?.partial;
    const title = this._escape(this._config.title || "ICX Manager");
    const int = (v, fallback, min, max) => {
      const n = Number(v);
      return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : fallback;
    };
    const cols = Math.min(int(this._config.columns, 12, 1, 24), Math.max(labels.length, 1));
    const mobile = Math.min(int(this._config.mobile_columns, 6, 1, 12), Math.max(labels.length, 1));
    const height = int(this._config.port_height, 40, 28, 90);
    const maxWidth = int(this._config.max_width, 0, 0, 2400);
    const subtitle = device ? this._escape(device) : "Nie znaleziono encji ICX Manager";
    const cells = labels.map((label) => {
      const p = ports.get(label);
      const link = p.link?.state === "on";
      const shut = p.admin?.state === "off";
      const poe = p.poe?.state === "on";
      const selected = label === this._selected;
      const description = this._displayName(label, p);
      return '<button class="port ' +
        (shut ? "shut " : link ? "active " : "offline ") +
        (selected ? "selected" : "") +
        '" data-select="' + this._escape(label) + '" title="' + this._escape(description) + '">' +
        '<span class="portnum">' + this._escape(label.split("/").pop()) + '</span>' +
        '<span class="portpoe">' + (poe ? "⚡" : "&nbsp;") + '</span></button>';
    }).join("");

    const current = ports.get(this._selected);
    let detail = '<div class="empty">Brak portów. Sprawdź, czy integracja jest poprawnie załadowana.</div>';
    if (current) {
      const description = this._displayName(this._selected, current);
      const metrics = [
        ["mdi:lan-connect", "Link", this._switchText(current.link, "Aktywny", "Nieaktywny"), false],
        ["mdi:speedometer", "Prędkość łącza", this._value(current.speed, " Mbit/s"), false],
        ["mdi:download", "RX", this._value(current.rx_mbps, " Mbit/s"), false],
        ["mdi:upload", "TX", this._value(current.tx_mbps, " Mbit/s"), false],
        ["mdi:chart-line", "Wykorzystanie RX", this._value(current.rx_utilization, " %"), true],
        ["mdi:chart-line", "Wykorzystanie TX", this._value(current.tx_utilization, " %"), true],
        ["mdi:flash", "PoE", this._switchText(current.poe, "Włączone", "Wyłączone"), false],
        ["mdi:power-plug", "Moc PoE", this._value(current.poe_watts, " W"), false],
        ["mdi:alert-circle-outline", "Błędy RX/TX", this._value(current.rx_errors) + " / " + this._value(current.tx_errors), true],
        ["mdi:delete-off-outline", "Odrzucone RX/TX", this._value(current.rx_discards) + " / " + this._value(current.tx_discards), true]
      ];
      const rows = metrics.map(([icon, label, value, extra]) =>
        '<div class="metric' + (extra ? ' extra' : '') + '">' +
        '<ha-icon icon="' + icon + '" aria-hidden="true"></ha-icon>' +
        '<span class="metric-label">' + this._escape(label) + '</span><strong>' +
        value + '</strong></div>').join("");
      // Keep both controls side by side, even when SNMP admin writes are disabled.
      const controls = [];
      for (const [metric, danger] of [["poe", false], ["admin", true]]) {
        const entity = current[metric];
        const pending = entity ? this._pending.get(entity.entity_id) : null;
        const state = pending ? pending.desired : entity?.state;
        const good = state === "on";
        const valid = !!entity && !pending && ["on", "off"].includes(entity.state);
        const caption = danger
          ? (state === "off" ? "Włącz port" : "Wyłącz port")
          : "Zasilanie PoE";
        const stateLabel = !entity ? (danger ? "Zablokowane" : "Brak PoE")
          : pending ? "Zmieniam…"
          : good ? "ON"
          : state === "off" ? "OFF" : "—";
        const icon = danger ? (good ? "mdi:lan-disconnect" : "mdi:lan-connect") : "mdi:flash";
        const reason = !entity && danger
          ? "Sterowanie Ethernet włączysz w Opcjach integracji ICX Manager"
          : !entity ? "Ten port nie ma encji PoE" : "";
        controls.push('<button type="button" class="toggle ' + (good ? "on " : "") +
          (danger ? "caution ethernet" : "poe") +
          '" data-action="' + metric + '"' +
          (entity ? ' data-entity="' + this._escape(entity.entity_id) + '"' : '') +
          ' aria-label="' + this._escape(caption + " — " + stateLabel) + '"' +
          (reason ? ' title="' + this._escape(reason) + '"' : '') +
          (valid ? '' : ' disabled') + '>' +
          '<ha-icon icon="' + icon + '" aria-hidden="true"></ha-icon>' +
          '<span class="toggle-text">' + this._escape(caption) + '</span>' +
          '<span class="toggle-state">' + this._escape(stateLabel) + '</span></button>');
      }
      const controlHint = !current.admin
        ? '<div class="controls-note">Wyłączanie portu: włącz sterowanie portami Ethernet w Opcjach integracji ICX Manager.</div>'
        : '';
      const portStatus = current.admin?.state === "off" ? "Wyłączony" :
        current.link?.state === "on" ? "Aktywny" : "Brak linku";
      const statusClass = current.admin?.state === "off" ? "disabled" :
        current.link?.state === "on" ? "up" : "down";
      detail = '<div class="detail-title"><div><h3>Port ' + this._escape(this._selected) +
        '</h3><div class="description">' + this._escape(description) + '</div></div>' +
        '<span class="port-status ' + statusClass + '">' + portStatus + '</span></div>' +
        '<div class="metrics">' + rows + '</div>' +
        '<div class="controls">' + controls.join("") + '</div>' + controlHint;
    }

    const info = devices.length && !states.length
      ? '<p class="warning">Nie znaleziono switcha: ' + subtitle + '</p>'
      : '';
    this.shadowRoot.innerHTML = '<style>' +
      ':host{display:block;font-family:var(--paper-font-body1_-_font-family,inherit)}' +
      'ha-card{padding:18px 18px 20px;color:var(--primary-text-color);overflow:hidden;' +
      (maxWidth ? 'max-width:' + maxWidth + 'px;margin:0 auto;' : '') + '}' +
      '.heading{display:flex;justify-content:space-between;align-items:start;gap:10px;margin-bottom:18px}' +
      'h2{font-size:20px;line-height:1.3;margin:0;font-weight:650}.subtitle{font-size:12px;opacity:.6;margin-top:3px}' +
      '.power{font-weight:700;font-size:24px;color:var(--primary-color);white-space:nowrap}' +
      '.power small{font-size:12px;display:block;text-align:right;font-weight:400;opacity:.75}' +
      '.stats{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px}' +
      '.badge{padding:6px 12px;background:var(--secondary-background-color);border-radius:20px;font-size:12px}' +
      '.grid{display:grid;grid-template-columns:repeat(' + cols + ',minmax(0,1fr));gap:6px}' +
      '.port{height:' + height + 'px;min-width:0;border:1px solid var(--divider-color);border-radius:7px;cursor:pointer;' +
      'font-weight:700;display:flex;align-items:center;justify-content:center;flex-direction:column;' +
      'background:var(--secondary-background-color);color:var(--primary-text-color)}' +
      '.port.active{background:#21623c;color:white;border-color:#21623c}' +
      '.port.shut{background:#9e3131;color:white;border-color:#9e3131}' +
      '.port.selected{outline:3px solid var(--primary-color);outline-offset:1px}' +
      '.portnum{font-size:13px}.portpoe{font-size:10px;line-height:12px}' +
      '.legend{margin:12px 0 18px;font-size:12px;opacity:.75}' +
      '.details{background:var(--secondary-background-color);border-radius:12px;padding:14px}' +
      '.details h3{margin:0;font-size:17px}.description{font-size:12px;opacity:.7;margin:4px 0 12px}' +
      '.metrics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 16px}' +
      '.metric{display:flex;justify-content:space-between;gap:8px;border-bottom:1px solid var(--divider-color);' +
      'padding:6px 0;font-size:12px}.metric strong{text-align:right}' +
      '.controls{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}' +
      '.toggle{cursor:pointer;border:1px solid var(--divider-color);background:var(--card-background-color);' +
      'color:var(--primary-text-color);padding:9px 12px;border-radius:8px;font-weight:600}' +
      '.toggle.on{border-color:#26824c}.toggle.caution{border-color:#c78227}.toggle:disabled{opacity:.5}' +
      '.warning{color:var(--error-color)}.empty{padding:15px}' +
      '@media(max-width:640px){.grid{grid-template-columns:repeat(' +
      mobile + ',minmax(0,1fr))}.metrics{grid-template-columns:1fr}}' +
      "ha-icon{--mdc-icon-size:18px;flex-shrink:0}ha-card{padding:20px}.heading{flex-wrap:wrap;align-items:center;margin-bottom:17px}.power{padding:9px 13px;border:1px solid var(--divider-color);border-radius:12px;background:var(--card-background-color);font-size:23px}.stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin-bottom:18px}.badge{display:flex;flex-direction:row;align-items:center;justify-content:center;gap:7px;min-width:0;padding:10px 8px;border-radius:12px;border:1px solid var(--divider-color);background:var(--card-background-color);white-space:nowrap}.badge small{font-size:11px;color:var(--secondary-text-color);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.badge strong{font-size:19px;line-height:1.15;font-weight:700;font-variant-numeric:tabular-nums;flex-shrink:0}.badge ha-icon{color:var(--primary-color);--mdc-icon-size:21px;flex-shrink:0}.badge.link ha-icon{color:#32865e}.badge.poe ha-icon{color:#d18a25}.grid{gap:7px}.port{border-radius:9px;transition:transform .15s,box-shadow .15s}.port:hover{transform:translateY(-1px);box-shadow:0 2px 9px rgba(0,0,0,.12)}.port:focus-visible{outline:3px solid var(--primary-color);outline-offset:2px}.legend{display:flex;flex-wrap:wrap;align-items:center;gap:13px;opacity:1;color:var(--secondary-text-color);margin:13px 0 17px}.legend>span{display:inline-flex;align-items:center;gap:6px}.dot{width:9px;height:9px;border-radius:50%;display:inline-block;background:var(--divider-color)}.dot.up{background:#248458}.dot.off{background:#b34a4a}.dot.poe{background:#d68a23}.details{background:var(--card-background-color);border:1px solid var(--divider-color);border-radius:15px;padding:17px 18px;box-shadow:0 3px 12px rgba(0,0,0,.025)}.detail-title{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}.description{margin:4px 0 0;color:var(--secondary-text-color);opacity:1}.port-status{border:1px solid var(--divider-color);border-radius:20px;padding:5px 9px;font-size:11px;white-space:nowrap;color:var(--secondary-text-color)}.port-status.up{color:#248458;border-color:#248458}.port-status.disabled{color:#b34a4a;border-color:#b34a4a}.metrics{gap:0 20px}.metric{display:grid;grid-template-columns:18px minmax(0,1fr) auto;align-items:center;gap:8px;padding:10px 0}.metric ha-icon{--mdc-icon-size:17px;color:var(--secondary-text-color)}.metric-label{min-width:0;color:var(--secondary-text-color)}.metric strong{font-variant-numeric:tabular-nums;font-weight:650;font-size:12px}.controls{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));margin-top:17px;gap:10px}.toggle{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0;min-height:42px;padding:9px 10px;border-radius:10px;font:inherit;font-size:12px;font-weight:600}.toggle ha-icon{--mdc-icon-size:17px;color:#d18a25}.toggle.caution ha-icon{color:#b34a4a}.toggle-state{padding:3px 7px;border-radius:999px;background:var(--secondary-background-color);color:var(--secondary-text-color)}.toggle.on:not(.caution) .toggle-state{color:#248458}.toggle.on.caution .toggle-state{color:#b34a4a}.toggle:disabled{cursor:not-allowed;opacity:.55}.toggle-text{flex:1;text-align:left;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.toggle-state{flex-shrink:0}.toggle.ethernet{border-color:#b34a4a}.controls-note{font-size:11px;color:var(--secondary-text-color);margin-top:8px}.toggle.ethernet:hover:not(:disabled){border-color:var(--error-color)}@media(max-width:340px){.controls{grid-template-columns:1fr}}.compact .metric.extra{display:none}.compact .metric{padding:7px 0}.compact .details{padding:12px 15px}.compact .detail-title{margin-bottom:6px}@media(max-width:640px){ha-card{padding:14px}.stats{gap:6px}.badge{padding:8px 6px;gap:5px}.badge ha-icon{--mdc-icon-size:16px}.badge strong{font-size:16px}.badge small{font-size:10px}.heading{align-items:flex-start}.details{padding:12px}}" +
      '</style><ha-card class="' + (this._config.view === "compact" ? "compact" : "detailed") +
      '"><div class="heading"><div><h2>' + title +
      '</h2><div class="subtitle">' + subtitle + '</div></div><div class="power">' +
      this._value(power, " W") + '<small>Łącznie PoE' + (partial ? " (częściowo)" : "") +
      '</small></div></div><div class="stats">' +
      '<span class="badge"><ha-icon icon="mdi:ethernet" aria-hidden="true"></ha-icon>' +
      '<strong>' + labels.length + '</strong><small>Porty</small></span>' +
      '<span class="badge link"><ha-icon icon="mdi:lan-connect" aria-hidden="true"></ha-icon>' +
      '<strong>' + activeCount + '</strong><small>Link UP</small></span>' +
      '<span class="badge poe"><ha-icon icon="mdi:flash" aria-hidden="true"></ha-icon>' +
      '<strong>' + poeCount + '</strong><small>PoE ON</small></span></div>' +
      info + (this._error ? '<p class="warning">' + this._escape(this._error) + '</p>' : '') +
      '<div class="grid">' + cells + '</div>' +
      '<div class="legend">' +
      '<span><i class="dot up"></i>Aktywny</span>' +
      '<span><i class="dot off"></i>Ethernet OFF</span>' +
      '<span><i class="dot poe"></i>PoE ON</span></div>' +
      '<div class="details">' + detail + '</div></ha-card>';
  }
}

if (!customElements.get("icx-manager-card")) {
  customElements.define("icx-manager-card", IcxManagerCard);
}
window.customCards = window.customCards || [];
if (!window.customCards.some((card) => card.type === "icx-manager-card")) {
  window.customCards.push({
    type: "icx-manager-card",
    name: "ICX Manager",
    description: "Brocade ICX port overview, PoE and Ethernet management"
  });
}


/** Native Home Assistant custom-card visual editor. */
class IcxManagerCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._port = "";
    this.shadowRoot.addEventListener("input", (e) => this._input(e));
    this.shadowRoot.addEventListener("change", (e) => this._change(e));
  }
  setConfig(config) {
    const next = { ...config, port_names: { ...(config.port_names || {}) } };
    const changed = JSON.stringify(this._config) !== JSON.stringify(next);
    this._config = next;
    if (changed && !this.shadowRoot.activeElement?.matches("input")) this._render();
  }
  set hass(hass) {
    this._hass = hass;
    const signature = JSON.stringify(this._devices().map(([d, p]) => [d, p.map(x => x.label)]));
    if (signature !== this._signature) {
      this._signature = signature;
      this._render();
    }
  }
  _devices() {
    const found = new Map();
    for (const state of Object.values(this._hass?.states || {})) {
      const a = state.attributes || {};
      if (!a.icx_device || !a.icx_port) continue;
      if (!found.has(a.icx_device)) found.set(a.icx_device, new Map());
      const ports = found.get(a.icx_device);
      if (!ports.has(a.icx_port)) ports.set(a.icx_port, { label: a.icx_port, alias: "" });
      if (a.description) ports.get(a.icx_port).alias = a.description;
    }
    const numeric = (a, b) => {
      const x = a.label.split("/").map(Number), y = b.label.split("/").map(Number);
      return (x[0] - y[0]) || (x[1] - y[1]) || (x[2] - y[2]);
    };
    return [...found].sort(([a], [b]) => a.localeCompare(b))
      .map(([name, ports]) => [name, [...ports.values()].sort(numeric)]);
  }
  _esc(text) {
    return String(text ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  _emit() {
    this.dispatchEvent(new CustomEvent("config-changed", {
      detail: { config: { ...this._config, port_names: { ...this._config.port_names } } },
      bubbles: true, composed: true
    }));
  }
  _input(e) {
    const field = e.target?.dataset?.field;
    if (!field) return;
    if (field === "port_name") {
      if (!this._port) return;
      const text = e.target.value.trim();
      if (text) this._config.port_names[this._port] = text;
      else delete this._config.port_names[this._port];
    } else if (field === "title") {
      this._config.title = e.target.value;
    } else if (["columns", "mobile_columns", "port_height", "max_width"].includes(field)) {
      const limits = { columns: [1,24], mobile_columns: [1,12],
        port_height: [28,90], max_width: [0,2400] };
      const n = Number(e.target.value);
      if (!Number.isInteger(n)) return;
      this._config[field] = Math.max(limits[field][0], Math.min(limits[field][1], n));
    } else return;
    this._emit();  // No DOM rebuild during input: keyboard focus is preserved.
  }
  _change(e) {
    const field = e.target?.dataset?.field;
    if (field === "device") {
      this._config.device = e.target.value;
      this._port = "";
      this._emit(); this._render();
    } else if (field === "port") {
      this._port = e.target.value;
      this._render();
    } else if (field === "view") {
      this._config.view = e.target.value === "compact" ? "compact" : "detailed";
      this._emit(); this._render();
    }
  }
  _render() {
    if (!this._config) return;
    const devices = this._devices();
    const device = this._config.device || devices[0]?.[0] || "";
    const ports = devices.find(([id]) => id === device)?.[1] || [];
    if (!ports.some(p => p.label === this._port)) this._port = ports[0]?.label || "";
    const options = (items, selected) => items.map(([value, text]) =>
      '<option value="' + this._esc(value) + '"' +
      (value === selected ? ' selected' : '') + '>' + this._esc(text) + '</option>'
    ).join("");
    const number = (label, field, fallback, min, max) =>
      '<label><span>' + label + '</span><input type="number" min="' + min +
      '" max="' + max + '" data-field="' + field + '" value="' +
      this._esc(this._config[field] ?? fallback) + '"></label>';
    this.shadowRoot.innerHTML =
      '<style>:host{display:block;color:var(--primary-text-color)}' +
      '.settings{display:grid;gap:14px}label{display:grid;gap:5px;font-size:13px}' +
      'input,select{width:100%;box-sizing:border-box;padding:9px 10px;border-radius:6px;' +
      'border:1px solid var(--divider-color);background:var(--card-background-color);' +
      'color:var(--primary-text-color);font:inherit}fieldset{border:1px solid var(--divider-color);' +
      'border-radius:10px;padding:12px}legend{font-weight:600}.two{display:grid;' +
      'grid-template-columns:1fr 1fr;gap:10px}.hint{font-size:12px;opacity:.7;margin-top:8px}' +
      '</style><div class="settings">' +
      '<label>Tytuł<input data-field="title" value="' +
      this._esc(this._config.title ?? "ICX Manager") + '"></label>' +
      '<label>Switch<select data-field="device">' +
      (options(devices.map(([id]) => [id,id]), device) || '<option>Brak switchy</option>') +
      '</select></label><fieldset><legend>Układ i szerokość</legend>' +
      '<label>Tryb wyświetlania<select data-field="view">' +
      options([["detailed","Pełny"],["compact","Kompaktowy"]],
        this._config.view === "compact" ? "compact" : "detailed") +
      '</select></label><div class="two">' +
      number('Portów w rzędzie', 'columns', 12, 1, 24) +
      number('Portów w rzędzie na telefonie', 'mobile_columns', 6, 1, 12) +
      number('Wysokość portu (px)', 'port_height', 40, 28, 90) +
      number('Max szerokość karty (0 = auto)', 'max_width', 0, 0, 2400) +
      '</div><div class="hint">W widoku Sekcje możesz też przeciągnąć uchwyt szerokości karty.</div>' +
      '</fieldset><fieldset><legend>Nazwy portów</legend>' +
      '<label>Wybierz port<select data-field="port">' +
      (options(ports.map(p => [p.label, p.label + (p.alias ? ' — ' + p.alias : '')]), this._port) ||
       '<option>Brak portów</option>') + '</select></label>' +
      '<label>Twoja nazwa<input data-field="port_name" maxlength="80" ' +
      'value="' + this._esc(this._config.port_names?.[this._port] ?? "") +
      '" placeholder="np. Kamera podjazd"></label>' +
      '<div class="hint">Nazwa dotyczy tej karty i nie zmienia konfiguracji switcha. ' +
      'Puste pole: opis SNMP lub numer portu.</div></fieldset></div>';
  }
}
if (!customElements.get("icx-manager-card-editor")) {
  customElements.define("icx-manager-card-editor", IcxManagerCardEditor);
}
