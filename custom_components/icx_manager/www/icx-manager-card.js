/* ICX Manager card v0.2.0 — dependency-free Lovelace custom element. */
class IcxManagerCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._selected = null;
    this.shadowRoot.addEventListener("click", (event) => this._click(event));
  }

  setConfig(config) {
    if (!config || typeof config !== "object") {
      throw new Error("ICX Manager: card config must be an object");
    }
    this._config = { ...config };
    this._render();
  }

  set hass(value) {
    this._hass = value;
    this._render();
  }

  getCardSize() {
    return 8;
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
      this._render();
      return;
    }
    const action = button.getAttribute("data-action");
    const entityId = button.getAttribute("data-entity");
    if (!action || !entityId || !this._hass) return;
    const stateObj = this._hass.states[entityId];
    if (!stateObj || !["on", "off"].includes(stateObj.state)) return;
    const target = stateObj.state === "on" ? "turn_off" : "turn_on";
    if (action === "admin") {
      const verb = target === "turn_off" ? "WYŁĄCZYSZ" : "WŁĄCZYSZ";
      const warning = "Uwaga: " + verb + " port Ethernet " + (this._selected || "") +
        ". Wyłączenie uplinku może odciąć switch oraz Home Assistant. Kontynuować?";
      if (!window.confirm(warning)) return;
    }
    this._hass.callService("switch", target, { entity_id: entityId })
      .catch((error) => console.error("ICX Manager: switch action failed", error));
  }

  _render() {
    if (!this._config || !this._hass) return;

    const all = Object.values(this._hass.states)
      .filter((state) => state.attributes && state.attributes.icx_device);
    const devices = [...new Set(all.map((state) => state.attributes.icx_device))].sort();
    const device = this._config.device || devices[0];
    const states = all.filter((state) => state.attributes.icx_device === device);
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
    const subtitle = device ? this._escape(device) : "Nie znaleziono encji ICX Manager";
    const cells = labels.map((label) => {
      const p = ports.get(label);
      const link = p.link?.state === "on";
      const shut = p.admin?.state === "off";
      const poe = p.poe?.state === "on";
      const selected = label === this._selected;
      const description = p.link?.attributes?.description || p.poe?.attributes?.description || "";
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
      const description = current.link?.attributes?.description ||
                          current.poe?.attributes?.description || "";
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
        const state = entity.state;
        const good = state === "on";
        const valid = ["on", "off"].includes(state);
        controls.push('<button class="toggle ' + (good ? "on" : "") +
          (danger ? " caution" : "") + '" data-action="' + metric +
          '" data-entity="' + this._escape(entity.entity_id) +
          '"' + (valid ? "" : " disabled") + '>' +
          this._escape(caption) + ': ' + (good ? "ON" : state === "off" ? "OFF" : "—") +
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
      'ha-card{padding:18px 18px 20px;color:var(--primary-text-color);overflow:hidden}' +
      '.heading{display:flex;justify-content:space-between;align-items:start;gap:10px;margin-bottom:18px}' +
      'h2{font-size:20px;line-height:1.3;margin:0;font-weight:650}.subtitle{font-size:12px;opacity:.6;margin-top:3px}' +
      '.power{font-weight:700;font-size:24px;color:var(--primary-color);white-space:nowrap}' +
      '.power small{font-size:12px;display:block;text-align:right;font-weight:400;opacity:.75}' +
      '.stats{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px}' +
      '.badge{padding:6px 12px;background:var(--secondary-background-color);border-radius:20px;font-size:12px}' +
      '.grid{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:6px}' +
      '.port{height:40px;border:1px solid var(--divider-color);border-radius:7px;cursor:pointer;' +
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
      '@media(max-width:640px){.grid{grid-template-columns:repeat(8,minmax(0,1fr))}.metrics{grid-template-columns:1fr}}' +
      '</style><ha-card><div class="heading"><div><h2>' + title +
      '</h2><div class="subtitle">' + subtitle + '</div></div><div class="power">' +
      this._value(power, " W") + '<small>Łącznie PoE' + (partial ? " (częściowo)" : "") +
      '</small></div></div><div class="stats">' +
      '<span class="badge">Porty: ' + labels.length + '</span>' +
      '<span class="badge">Link UP: ' + activeCount + '</span>' +
      '<span class="badge">PoE ON: ' + poeCount + '</span></div>' +
      info + '<div class="grid">' + cells + '</div>' +
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
