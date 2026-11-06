/* ICX Manager card v0.2.1 — dependency-free Lovelace custom element. */
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
        ["Link", this._value(current.link)],
        ["Prędkość łącza", this._value(current.speed, " Mbit/s")],
        ["RX", this._value(current.rx_mbps, " Mbit/s")],
        ["TX", this._value(current.tx_mbps, " Mbit/s")],
        ["Wykorzystanie RX", this._value(current.rx_utilization, " %")],
        ["Wykorzystanie TX", this._value(current.tx_utilization, " %")],
        ["PoE", this._value(current.poe)],
        ["Moc PoE", this._value(current.poe_watts, " W")],
        ["Błędy RX/TX", this._value(current.rx_errors) + " / " + this._value(current.tx_errors)],
        ["Odrzucone RX/TX", this._value(current.rx_discards) + " / " + this._value(current.tx_discards)]
      ];
      const rows = metrics.map(([label, value]) =>
        '<div class="metric"><span>' + this._escape(label) + '</span><strong>' +
        value + '</strong></div>').join("");
      const controls = [];
      for (const [metric, caption, danger] of [
        ["poe", "Zasilanie PoE", false],
        ["admin", "Port Ethernet", true]
      ]) {
        const entity = current[metric];
        if (!entity) continue;
        const pending = this._pending.get(entity.entity_id);
        const state = pending ? pending.desired : entity.state;
        const good = state === "on";
        const valid = !pending && ["on", "off"].includes(entity.state);
        controls.push('<button class="toggle ' + (good ? "on" : "") +
          (danger ? " caution" : "") + '" data-action="' + metric +
          '" data-entity="' + this._escape(entity.entity_id) +
          '"' + (valid ? "" : " disabled") + '>' +
          this._escape(caption) + ': ' + (pending ? "Zmieniam… " : "") +
          (good ? "ON" : state === "off" ? "OFF" : "—") +
          '</button>');
      }
      detail = '<div class="detail-title"><div><h3>Port ' + this._escape(this._selected) +
        '</h3><div class="description">' + this._escape(description) + '</div></div></div>' +
        '<div class="metrics">' + rows + '</div>' +
        '<div class="controls">' + controls.join("") + '</div>';
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
      '</style><ha-card><div class="heading"><div><h2>' + title +
      '</h2><div class="subtitle">' + subtitle + '</div></div><div class="power">' +
      this._value(power, " W") + '<small>Łącznie PoE' + (partial ? " (częściowo)" : "") +
      '</small></div></div><div class="stats">' +
      '<span class="badge">Porty: ' + labels.length + '</span>' +
      '<span class="badge">Link UP: ' + activeCount + '</span>' +
      '<span class="badge">PoE ON: ' + poeCount + '</span></div>' +
      info + (this._error ? '<p class="warning">' + this._escape(this._error) + '</p>' : '') +
      '<div class="grid">' + cells + '</div>' +
      '<div class="legend">🟩 aktywny · 🟥 administracyjnie wyłączony · ⚡ PoE</div>' +
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
      '</select></label><fieldset><legend>Układ i szerokość</legend><div class="two">' +
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
