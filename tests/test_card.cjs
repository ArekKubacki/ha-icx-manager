const assert = require("node:assert/strict");
const fs = require("node:fs");
const code = fs.readFileSync("custom_components/icx_manager/www/icx-manager-card.js","utf8");
class FakeElement {
  constructor() {
    this.shadowRoot = {innerHTML:"", addEventListener(){}, activeElement:null};
    this.events = [];
  }
  attachShadow() { return this.shadowRoot; }
  dispatchEvent(event) { this.events.push(event); return true; }
}
const registry = new Map(), customElements = {
  get: key=>registry.get(key), define:(key,value)=>registry.set(key,value)
};
const app = new Function("HTMLElement","customElements","window","document","requestAnimationFrame","CustomEvent",
  code+"\nreturn {IcxManagerCard,IcxManagerCardEditor};");
const {IcxManagerCard,IcxManagerCardEditor} = app(FakeElement,customElements,{customCards:[],confirm:()=>true},
  {createElement:()=>({})},f=>f(),class Event {constructor(name,props){this.type=name;this.detail=props.detail;}});
function item(entity_id,icx_metric,state) {
  return {entity_id,state,attributes:{icx_device:"test:161",icx_port:"1/1/7",icx_metric}};
}
const states = {
  link:item("binary_sensor.link","link","on"),
  poe:item("switch.poe","poe","on"),
  admin:item("switch.admin","admin","on")
};
function render(config,adminState="on"){
  const card = new IcxManagerCard();
  card.setConfig({title:"Test",...config});
  card.hass = {states:{...states,admin:item("switch.admin","admin",adminState)},callService(){throw Error("unexpected action")}};
  const html=card.shadowRoot.innerHTML;
  const admin=html.match(/<button[^>]*data-action="admin"[^>]*>/)?.[0];
  const poe=html.match(/<button[^>]*data-action="poe"[^>]*>/)?.[0];
  assert.ok(admin && poe,"buttons must exist");
  return {card,html,admin,poe};
}
assert.match(render({}).admin,/ disabled/);
assert.doesNotMatch(render({}).poe,/ disabled/);
assert.doesNotMatch(render({port_shutdown_allowed:{"1/1/7":true}}).admin,/ disabled/);
assert.match(render({port_shutdown_allowed:{"1/1/8":true}}).admin,/ disabled/);
assert.match(render({port_shutdown_allowed:{"1/1/7":true},block_all_port_shutdown:true}).admin,/ disabled/);
assert.doesNotMatch(render({block_all_port_shutdown:true}).poe,/ disabled/);
const disabled=render({block_all_port_shutdown:true},"off");
assert.doesNotMatch(disabled.admin,/ disabled/);
assert.match(disabled.admin,/Włącz port/);
const editor=new IcxManagerCardEditor();
editor.setConfig({type:"custom:icx-manager-card",port_names:{},port_shutdown_allowed:{}});
editor.hass={states};
assert.match(editor.shadowRoot.innerHTML,/data-field="port_shutdown_allowed"/);
assert.match(editor.shadowRoot.innerHTML,/data-field="block_all_port_shutdown"/);
editor._change({target:{dataset:{field:"port_shutdown_allowed"},checked:true}});
assert.equal(editor.events.at(-1).detail.config.port_shutdown_allowed["1/1/7"],true);
editor._change({target:{dataset:{field:"block_all_port_shutdown"},checked:true}});
assert.equal(editor.events.at(-1).detail.config.block_all_port_shutdown,true);
assert.match(editor.shadowRoot.innerHTML,/data-field="port_shutdown_allowed"[^>]* disabled/);
editor._change({target:{dataset:{field:"block_all_port_shutdown"},checked:false}});
assert.equal(editor.events.at(-1).detail.config.port_shutdown_allowed["1/1/7"],true);
console.log("ICX Manager card permission tests passed");
