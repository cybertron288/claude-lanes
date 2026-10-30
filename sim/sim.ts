// Fake WLED controller for the 16x8 matrix. Same idea as the contrib-matrix sim:
// accepts POST /json/state, keeps WLED state, draws it in a browser at GET /.
// With MQTT_TOPIC set it also subscribes to `${MQTT_TOPIC}/api` at BROKER_URL,
// as the real panel does. Understands segments (start/stop/startY/stopY, fx,
// col, i, bri as opacity) merged by id. Effects are approximated for the ids in FX.
import { FX } from "../worker/src/effects";
import { decodePublish, encodeConnect, encodePingReq, encodeSubscribe } from "../worker/src/mqtt";

const W = 16, H = 8;
const LOOKS: Record<number, string> = {
  [FX.solid.fx]: "solid", [FX.blink.fx]: "blink", [FX.breathe.fx]: "breathe", [FX.sonar.fx]: "sonar",
};
type RGB = [number, number, number];
type Seg = {
  id: number; start?: number; stop?: number; startY?: number; stopY?: number;
  fx?: number; col?: RGB[]; i?: (RGB | string)[]; bri?: number;
};
const state: { on: boolean; bri: number; seg: Map<number, Seg>; at: string } = {
  on: false, bri: 128, seg: new Map(), at: "never",
};

function apply(body: any) {
  if (typeof body.on === "boolean") state.on = body.on;
  if (typeof body.bri === "number") state.bri = body.bri;
  for (const s of body.seg ?? []) {
    const id = s.id ?? 0;
    if (s.stop === 0) { state.seg.delete(id); continue; }
    // WLED writes `i` pixels once; an update without them redraws the segment.
    const { i: _, ...kept } = state.seg.get(id) ?? {};
    state.seg.set(id, { ...kept, ...s, id });
  }
  state.at = new Date().toLocaleTimeString();
}

const page = `<!doctype html><title>status light sim</title>
<body style="background:#111;color:#aaa;font:14px sans-serif;padding:24px">
<div id=s></div>
<div id=g style="display:grid;grid-template-columns:repeat(${W},28px);gap:4px;margin-top:12px"></div>
<pre id=j style="font-size:11px;color:#666;max-width:720px;white-space:pre-wrap"></pre>
<script>
const W=${W},H=${H},LOOKS=${JSON.stringify(LOOKS)};
let st={on:false,bri:128,seg:[]};
const cells=[...Array(W*H)].map(()=>{const d=document.createElement('div');
  d.style.cssText='width:28px;height:28px;border-radius:50%;background:#1a1a1a';g.appendChild(d);return d});
const hex=c=>typeof c==='string'?[0,2,4].map(i=>parseInt(c.slice(i,i+2),16)):c;
// Sonar rings leave the segment's vertical center (ported from sonar_wled.py).
function sonar(t,y,y0,y1){
  const PERIOD=0.6,LIFE=0.6,SPEED=6,SHARP=0.9;
  const dist=Math.abs(y-y0-(y1-y0-1)/2),phase=t%PERIOD;let lv=0;
  for(let n=0;n<3;n++){const age=phase+n*PERIOD;if(age>LIFE)break;
    const ring=1-Math.abs(dist-age*SPEED)*SHARP;if(ring>0)lv=Math.max(lv,ring*(1-age/LIFE))}
  return lv;
}
function level(fx,t,y,y0,y1){
  const look=LOOKS[fx];
  if(look==='sonar')return sonar(t,y,y0,y1);
  if(look==='blink')return Math.sin(t*6)>0?1:0.08;
  if(look==='breathe')return 0.2+0.8*(0.5+0.5*Math.sin(t*3));
  return 1;
}
function draw(t){
  const k=st.on?st.bri/255:0, out=Array(W*H).fill(null);
  for(const s of st.seg){
    const x0=s.start??0,x1=s.stop??W,y0=s.startY??0,y1=s.stopY??H;
    const col=(s.col&&s.col[0])||[255,255,255],op=(s.bri??255)/255;
    for(let y=y0;y<Math.min(y1,H);y++)for(let x=x0;x<Math.min(x1,W);x++){
      let c;
      if(s.i&&s.i.length){const v=s.i[(y-y0)*(x1-x0)+(x-x0)];if(!v)continue;c=hex(v)}
      else c=col.map(v=>v*level(s.fx||0,t,y,y0,Math.min(y1,H)));
      c=c.map(v=>v*op);
      out[y*W+x]=c;
    }
  }
  out.forEach((c,i)=>cells[i].style.background=c?'rgb('+c.map(v=>Math.round(v*k))+')':'#1a1a1a');
  requestAnimationFrame(ms=>draw(ms/1000));
}
async function poll(){
  try{st=await (await fetch('/frame')).json();
    s.textContent='on='+st.on+'  bri='+st.bri+'  updated '+st.at+'  segments='+st.seg.length;
    j.textContent=JSON.stringify(st.seg)}catch{}
  setTimeout(poll,500);
}
poll();requestAnimationFrame(ms=>draw(ms/1000));
</script>`;

const json = () => ({ on: state.on, bri: state.bri, seg: [...state.seg.values()], at: state.at });

Bun.serve({
  port: Number(process.env.PORT ?? 8091),
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/json/state" && req.method === "POST") {
      apply(await req.json());
      console.log(`[${state.at}] on=${state.on} bri=${state.bri} segments=${state.seg.size}`);
      return Response.json({ success: true });
    }
    if (url.pathname === "/json/state" || url.pathname === "/frame") return Response.json(json());
    return new Response(page, { headers: { "Content-Type": "text/html" } });
  },
});
console.log(`status-light sim on http://localhost:${process.env.PORT ?? 8091}`);

// Subscribe like the panel does. Reconnects every 5 s when the socket drops.
function subscribe(broker: string, topic: string) {
  const ws = new WebSocket(broker, "mqtt");
  ws.binaryType = "arraybuffer";
  let ping: ReturnType<typeof setInterval> | undefined;
  ws.onopen = () => ws.send(encodeConnect(`ccsl-sim-${crypto.randomUUID().slice(0, 8)}`));
  ws.onmessage = (ev) => {
    const bytes = new Uint8Array(ev.data as ArrayBuffer);
    if (bytes[0] === 0x20) {
      ws.send(encodeSubscribe(`${topic}/api`, 1));
      ping = setInterval(() => ws.send(encodePingReq()), 20_000);
      console.log("mqtt: subscribed");
      return;
    }
    const msg = decodePublish(bytes);
    if (!msg) return;
    try {
      apply(JSON.parse(msg.payload));
      console.log(`[${state.at}] mqtt on=${state.on} bri=${state.bri} segments=${state.seg.size}`);
    } catch {
      console.log("mqtt: payload is not JSON, ignored");
    }
  };
  ws.onclose = () => {
    clearInterval(ping);
    console.log("mqtt: disconnected, retrying in 5 s");
    setTimeout(() => subscribe(broker, topic), 5000);
  };
}

if (process.env.MQTT_TOPIC) subscribe(process.env.BROKER_URL ?? "wss://broker.emqx.io:8084/mqtt", process.env.MQTT_TOPIC);
