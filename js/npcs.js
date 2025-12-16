import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.162.0/build/three.module.js";
import { bfsNextStep } from "./maze.js";

export function spawnNPCs({ rng, maze, cellSize, level }){
  const count = 1 + Math.min(3, level); // 2..4-ish across game
  const npcs = [];

  for(let i=0;i<count;i++){
    const cell = { x: (rng()*maze.w)|0, y: (rng()*maze.h)|0 };
    const pos = cellCenter(cell.x, cell.y, cellSize);
    const npc = makeNPCMesh(rng, pickArchetype(rng, level, i));
    npc.position.set(pos.x, 0.95, pos.z);
    npc.userData.cell = cell;
    npc.userData.targetCell = cell;
    npc.userData.timer = 0;
    npc.userData.speed = 1.3 + rng()*0.6 + level*0.06;
    npc.userData.id = `NPC_L${level}_${i}`;
    npc.userData.lastSpoke = 0;
    npcs.push(npc);
  }

  return npcs;
}

export function updateNPCs({ dt, time, npcs, maze, cellSize, playerPos, dissonanceRef }){
  for(const n of npcs){
    n.userData.timer -= dt;

    // If close, sometimes stop + stare (psych pressure)
    const dist = n.position.distanceTo(playerPos);
    const stare = dist < 3.4;

    if(stare){
      // freeze wander a bit
      n.userData.timer = Math.min(n.userData.timer, 0.0);
      // add a little dissonance pressure (small)
      dissonanceRef.add( (3.4 - dist) * 0.6 * dt );
      // face player
      n.rotation.y = Math.atan2(playerPos.x - n.position.x, playerPos.z - n.position.z);
    }else{
      // wander target update
      if(n.userData.timer <= 0){
        n.userData.targetCell = {
          x: clamp((rngish(n.userData.id, time*0.07)*maze.w)|0, 0, maze.w-1),
          y: clamp((rngish(n.userData.id, time*0.09+3)*maze.h)|0, 0, maze.h-1),
        };
        n.userData.timer = 2.0 + (hash01(n.userData.id)*3.0);
      }

      const curCell = getCell(n.position, cellSize, maze);
      const step = bfsNextStep(maze, curCell, n.userData.targetCell);
      const targetPos = cellCenter(step.x, step.y, cellSize);

      const ex = targetPos.x - n.position.x;
      const ez = targetPos.z - n.position.z;
      const ed = Math.hypot(ex, ez) || 1;

      n.position.x += (ex/ed) * n.userData.speed * dt;
      n.position.z += (ez/ed) * n.userData.speed * dt;

      n.rotation.y = Math.atan2(ex, ez);
    }

    // subtle jitter (PS1-ish “bad animation”)
    n.position.y = 0.95 + Math.sin(time*3 + hash01(n.userData.id)*10)*0.02;
  }
}

export function npcInteractPayload(npc, level, story){
  const a = npc.userData.archetype;

  const lead = `<p>You address them in your head, because saying it out loud feels like summoning.</p>`;
  const hint = directionHint(a, level);

  // Some NPCs can force a choice (experimental bargain)
  if(a.kind === "BUTCHER"){
    return {
      title: "A PERSON WHO SMELLS LIKE IRON",
      html: `${lead}
        <p>They smile as if they’ve practiced on people who begged.</p>
        <p><b>“You want the relic? Then stop running from it.”</b></p>
        <p>They point, not quite at a direction—more like a memory.</p>
        <p style="color:#ffffff77;">${hint}</p>`,
      choices: [
        { label: "Ask for help (cost: +guilt)", onPick: ()=> ({ effect:"HELP", delta:{ guilt:+10 }, hint:true }) },
        { label: "Back away (cost: +obsession)", onPick: ()=> ({ effect:"BACK", delta:{ obsession:+10 }, hint:false }) },
      ]
    };
  }

  if(a.kind === "SINGER"){
    return {
      title: "A PERSON SINGING TO THE RAIN",
      html: `${lead}
        <p>Their song is not melody. It’s counting. One. Two. You.</p>
        <p><b>“Don’t look at it when it wants you to look.”</b></p>
        <p style="color:#ffffff77;">${hint}</p>`,
      choices: [
        { label: "Listen (Dissonance - a little)", onPick: ()=> ({ effect:"CALM", delta:{}, calm:true }) },
        { label: "Interrupt (Dissonance + a little)", onPick: ()=> ({ effect:"SPIKE", delta:{}, spike:true }) },
      ]
    };
  }

  if(a.kind === "NURSE"){
    return {
      title: "A PERSON WITH DRY HANDS IN THE RAIN",
      html: `${lead}
        <p>They stand too still, like a prop nobody moved.</p>
        <p><b>“You are in second-person because you are being instructed.”</b></p>
        <p style="color:#ffffff77;">${hint}</p>`,
      choices: [
        { label: "Answer: 'I obey' (entity learns you faster)", onPick: ()=> ({ effect:"OBEY", delta:{ obsession:+12 }, learn:true }) },
        { label: "Answer: 'I refuse' (gate later, but safer)", onPick: ()=> ({ effect:"REFUSE", delta:{ guilt:+6 }, delay:true }) },
      ]
    };
  }

  // default: Prophet
  return {
    title: "A PERSON WHO POINTS AT NOTHING",
    html: `${lead}
      <p>They whisper your footsteps back to you, perfectly.</p>
      <p><b>“The houses aren’t shelter. They’re receipts.”</b></p>
      <p style="color:#ffffff77;">${hint}</p>`,
    choices: [
      { label: "Ask: 'Where is it?'", onPick: ()=> ({ effect:"HINT", delta:{}, hint:true }) },
      { label: "Leave them to their weather", onPick: ()=> ({ effect:"LEAVE", delta:{}, hint:false }) },
    ]
  };
}

export function makeNPCMesh(rng, archetype){
  const g = new THREE.Group();

  // low poly body
  const body = new THREE.Mesh(
    new THREE.ConeGeometry(0.35, 1.4, 6),
    new THREE.MeshLambertMaterial({ color: archetype.color })
  );
  body.position.y = 0.7;
  g.add(body);

  // head
  const head = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.18, 0),
    new THREE.MeshLambertMaterial({ color: archetype.head })
  );
  head.position.y = 1.35;
  g.add(head);

  // “wrong face”
  const face = new THREE.Mesh(
    new THREE.BoxGeometry(0.10, 0.06, 0.02),
    new THREE.MeshBasicMaterial({ color: archetype.face })
  );
  face.position.set(0, 1.34, 0.16);
  g.add(face);

  // arms (janky)
  const armGeo = new THREE.BoxGeometry(0.06, 0.5, 0.06);
  const armMat = new THREE.MeshLambertMaterial({ color: archetype.color });
  const a1 = new THREE.Mesh(armGeo, armMat);
  const a2 = new THREE.Mesh(armGeo, armMat);
  a1.position.set(0.28, 0.85, 0);
  a2.position.set(-0.28, 0.85, 0);
  a1.rotation.z = 0.6 + rng()*0.3;
  a2.rotation.z = -0.6 - rng()*0.3;
  g.add(a1); g.add(a2);

  g.userData.type = "npc";
  g.userData.archetype = archetype;

  return g;
}

function pickArchetype(rng, level, i){
  const kinds = ["PROPHET","SINGER","BUTCHER","NURSE"];
  const kind = kinds[(rng()*kinds.length)|0];

  // palette per kind
  if(kind==="BUTCHER") return { kind, color:0x3a2a2a, head:0x6e5c52, face:0xffe2d0 };
  if(kind==="SINGER") return { kind, color:0x27313a, head:0x5c6570, face:0xe9e2d8 };
  if(kind==="NURSE")  return { kind, color:0x1f242c, head:0x6a6e75, face:0xffffff };
  return { kind:"PROPHET", color:0x1f2a24, head:0x5a5f66, face:0xdad2c6 };
}

function directionHint(a, level){
  // deliberately unreliable hints (experimental)
  const base = [
    "They gesture: “Closer to where the rain sounds thinner.”",
    "They gesture: “Toward the candles. Toward pretending.”",
    "They gesture: “Away from the widest path.”",
    "They gesture: “Find a house. The relic likes indoor weather.”",
  ];
  let line = base[(hash01(a.kind+level)*base.length)|0];
  if(a.kind === "PROPHET") line += " (It could be true. It could be rehearsal.)";
  return line;
}

function cellCenter(x,y,cellSize){
  return { x: x*cellSize + cellSize/2, z: y*cellSize + cellSize/2 };
}

function getCell(pos, cellSize, maze){
  const x = clamp(Math.floor(pos.x / cellSize), 0, maze.w-1);
  const y = clamp(Math.floor(pos.z / cellSize), 0, maze.h-1);
  return {x,y};
}

function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
function hash01(s){
  // deterministic float 0..1
  let h = 2166136261;
  for(let i=0;i<s.length;i++){
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h>>>0) % 100000) / 100000;
}
function rngish(seed, t){
  // small pseudo-rand from seed + time
  const x = Math.sin((hash01(seed)*999 + t)*12.9898)*43758.5453;
  return x - Math.floor(x);
}
