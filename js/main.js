import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.162.0/build/three.module.js";
import { makeMaze, bfsNextStep, resolveMazeCollision } from "./maze.js";
import { makeUI } from "./ui.js";
import { makeAudio } from "./audio.js";
import { loadStory, saveStory, resetStory, markNoteRead, noteAlreadyRead, applyChoice, computeEnding, endingText } from "./story.js";
import { buildWorldExtras } from "./worldgen.js";
import { spawnNPCs, updateNPCs, npcInteractPayload } from "./npcs.js";

const ui = makeUI();
const audio = makeAudio();
let story = loadStory();

const state = {
  started: false,
  pausedUI: false,
  level: 1,
  relics: story.relics || 0,
  dissonance: 0,     // 0..100
  warning: 0,        // 0..1
  wet: 1,
  time: 0,
  pointerLocked: false,

  // PS1-ish “snap” parameters
  posSnap: 0.04,      // meters
  rotSnap: 0.008,     // radians

  // Interiors
  inHouse: false,
  houseId: null,
  outsidePos: null,
};

const LEVELS = [
  { w: 11, h: 11, enemySpeed: 2.35, name: "The Polite Path", requireNote: true, npcCount: 2 },
  { w: 13, h: 13, enemySpeed: 2.75, name: "Trees That Watch", requireNote: true, npcCount: 3 },
  { w: 15, h: 15, enemySpeed: 3.15, name: "Bright Rain, Dark Work", requireNote: false, npcCount: 3 },
  { w: 17, h: 17, enemySpeed: 3.60, name: "The Gate Learns You", requireNote: false, npcCount: 4 },
];

// ---------- Three.js ----------
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = false;
document.getElementById("wrap").prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xaab2b8, 0.042);

const camera = new THREE.PerspectiveCamera(72, 1, 0.05, 160);
camera.position.set(0, 1.7, 0);

const clock = new THREE.Clock();

const light = new THREE.DirectionalLight(0xffffff, 0.95);
light.position.set(10, 20, 8);
scene.add(light);
scene.add(new THREE.AmbientLight(0xffffff, 0.30));

// Mild “cold daylight” tint
const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x2a2a2a, 0.35);
scene.add(hemi);

// PS1-ish resolution scale
let resScale = 0.62;

// ---------- World ----------
let world = null;

function resize(){
  const W = window.innerWidth, H = window.innerHeight;
  const iw = Math.max(320, Math.floor(W * resScale));
  const ih = Math.max(240, Math.floor(H * resScale));
  renderer.setSize(iw, ih, false);
  renderer.domElement.style.width = W + "px";
  renderer.domElement.style.height = H + "px";
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

// ---------- Input ----------
const keys = new Set();
window.addEventListener("keydown", (e)=>{
  if(e.code === "KeyQ") toggleJournal();
  keys.add(e.code);
});
window.addEventListener("keyup", (e)=> keys.delete(e.code));

const look = { yaw: 0, pitch: 0 };
window.addEventListener("mousemove", (e)=>{
  if(!state.pointerLocked || state.pausedUI) return;
  const sens = 0.0022;
  look.yaw -= e.movementX * sens;
  look.pitch -= e.movementY * sens;
  look.pitch = Math.max(-1.25, Math.min(1.25, look.pitch));
});

renderer.domElement.addEventListener("click", ()=>{
  if(!state.started){
    startGame();
    return;
  }
  if(!state.pointerLocked && !state.pausedUI){
    renderer.domElement.requestPointerLock();
  }
});

document.addEventListener("pointerlockchange", ()=>{
  state.pointerLocked = (document.pointerLockElement === renderer.domElement);
  ui.setHint(state.pointerLocked ? "" : "Click to re-enter. (WASD, SHIFT, E interact, Q journal)", !state.pointerLocked && !state.pausedUI);
});

ui.els.retry.onclick = ()=>{ ui.showDeath(false); loadLevel(state.level); };
ui.els.restartGame.onclick = ()=>{
  ui.showEnding(false);
  resetStory();
  story = loadStory();
  state.relics = 0;
  state.level = 1;
  loadLevel(1);
  renderer.domElement.requestPointerLock();
};

function startGame(){
  state.started = true;
  audio.resume();
  ui.setHint("You step into daylight that feels staged. Find relics. Avoid the dark figure.", true);
  setTimeout(()=> ui.setHint("", false), 2300);
  loadLevel(state.level);
  renderer.domElement.requestPointerLock();
}

// ---------- Level building ----------
function clearWorld(){
  if(!world) return;
  scene.remove(world.group);
  if(world.interiors){
    for(const it of world.interiors) scene.remove(it);
  }
  world = null;
}

function loadLevel(level){
  clearWorld();
  state.inHouse = false;
  state.houseId = null;
  state.outsidePos = null;

  const L = LEVELS[level-1];
  const rng = mulberry32(1000 + level*999 + (story.guilt|0)*7 + (story.obsession|0)*11);

  const maze = makeMaze(L.w, L.h, rng);
  const cellSize = 3.2;

  const group = new THREE.Group();
  scene.add(group);

  // Ground: more atmospheric variation
  const groundGeo = new THREE.PlaneGeometry(L.w*cellSize + 40, L.h*cellSize + 40, 1, 1);
  const groundMat = new THREE.MeshLambertMaterial({ color: 0x56615c });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI/2;
  ground.position.set((L.w*cellSize)/2, 0, (L.h*cellSize)/2);
  group.add(ground);

  // Stylized gore/aftermath patches (non-graphic)
  const bloodGeo = new THREE.CircleGeometry(1.2, 14);
  const bloodMat = new THREE.MeshBasicMaterial({ color: 0x4a0b12, transparent:true, opacity:0.62 });
  for(let i=0;i<4+level;i++){
    const b = new THREE.Mesh(bloodGeo, bloodMat);
    b.rotation.x = -Math.PI/2;
    b.position.set(rng()*(L.w*cellSize), 0.02, rng()*(L.h*cellSize));
    group.add(b);
  }

  // Maze walls
  const wallH = 2.4;
  const wallT = 0.18;
  const wallMat = new THREE.MeshLambertMaterial({ color: 0x262c31 });
  const wallGeoH = new THREE.BoxGeometry(cellSize + wallT, wallH, wallT);
  const wallGeoV = new THREE.BoxGeometry(wallT, wallH, cellSize + wallT);

  for(let y=0;y<L.h;y++){
    for(let x=0;x<L.w;x++){
      const c = maze.cells[maze.idx(x,y)];
      const ox = x*cellSize;
      const oz = y*cellSize;

      if(c.N){
        const m = new THREE.Mesh(wallGeoH, wallMat);
        m.position.set(ox + cellSize/2, wallH/2, oz);
        group.add(m);
      }
      if(c.W){
        const m = new THREE.Mesh(wallGeoV, wallMat);
        m.position.set(ox, wallH/2, oz + cellSize/2);
        group.add(m);
      }
      if(x === L.w-1 && c.E){
        const m = new THREE.Mesh(wallGeoV, wallMat);
        m.position.set(ox + cellSize, wallH/2, oz + cellSize/2);
        group.add(m);
      }
      if(y === L.h-1 && c.S){
        const m = new THREE.Mesh(wallGeoH, wallMat);
        m.position.set(ox + cellSize/2, wallH/2, oz + cellSize);
        group.add(m);
      }
    }
  }

  // Rain particles (Points)
  const rainCount = 1400 + level*520;
  const rainGeo = new THREE.BufferGeometry();
  const rainPos = new Float32Array(rainCount*3);
  const Wm = L.w*cellSize, Hm = L.h*cellSize;
  for(let i=0;i<rainCount;i++){
    rainPos[i*3+0] = (rng()*(Wm+30)) - 10;
    rainPos[i*3+1] = 2 + rng()*20;
    rainPos[i*3+2] = (rng()*(Hm+30)) - 10;
  }
  rainGeo.setAttribute("position", new THREE.BufferAttribute(rainPos, 3));
  const rainMat = new THREE.PointsMaterial({ color: 0xd9e6ee, size: 0.07 });
  const rain = new THREE.Points(rainGeo, rainMat);
  group.add(rain);

  // Start/exit
  const start = { x:0, y:0 };
  const exit = maze.farthestFrom(start.x, start.y);

  // Player spawn
  const spawn = cellCenter(start.x,start.y,cellSize);
  camera.position.set(spawn.x, 1.7, spawn.z);
  look.yaw = 0; look.pitch = 0;

  // Gate
  const gateGeo = new THREE.BoxGeometry(1.6, 2.2, 0.22);
  const gateMat = new THREE.MeshLambertMaterial({ color: 0x6b747b });
  const gate = new THREE.Mesh(gateGeo, gateMat);
  const gpos = cellCenter(exit.x, exit.y, cellSize);
  gate.position.set(gpos.x, 1.1, gpos.z);
  group.add(gate);

  // World extras: trees + crooked houses (with interiors + candles)
  const extras = buildWorldExtras({ group, rng, maze, cellSize, level });
  const interiors = extras.houses.map(h => h.interior);
  for(const it of interiors) scene.add(it);

  // Relic placement: sometimes inside a random house interior (experimental “indoor weather”)
  const relicInHouse = (rng() < 0.45);
  let relicPos;
  let relicHouseId = null;

  if(relicInHouse && extras.houses.length){
    relicHouseId = (rng()*extras.houses.length)|0;
    const h = extras.houses[relicHouseId];
    relicPos = new THREE.Vector3(h.interior.position.x, 1.0, h.interior.position.z);
    // inside room offset
    relicPos.x += 1.7;
    relicPos.z += 0.4;
  }else{
    const relicCell = pickRelicCell(maze, start, exit, rng);
    const rp = cellCenter(relicCell.x, relicCell.y, cellSize);
    relicPos = new THREE.Vector3(rp.x, 1.0, rp.z);
  }

  const relic = makeRelicMesh(level);
  relic.position.copy(relicPos);
  group.add(relic);

  // Notes: 3 per level (kept), still in maze
  const notes = [];
  for(let i=0;i<3;i++){
    const nc = pickNoteCell(maze, start, exit, rng);
    const np = cellCenter(nc.x, nc.y, cellSize);
    const n = makeNoteMesh();
    n.position.set(np.x + (rng()*0.6-0.3), 0.6, np.z + (rng()*0.6-0.3));
    n.userData.noteId = `L${level}_N${i}`;
    n.userData.noteIndex = i;
    notes.push(n);
    group.add(n);

    // Add a little candle near one note occasionally
    if(i===0 && rng()<0.65){
      const candle = makeCandleMesh(rng);
      candle.mesh.position.set(n.position.x + 0.7, 0.0, n.position.z + 0.3);
      group.add(candle.mesh);
      const pl = new THREE.PointLight(0xffd7a6, 0.55, 9, 2.5);
      pl.position.set(candle.mesh.position.x, 1.05, candle.mesh.position.z);
      group.add(pl);
      candle.light = pl;
      // store for flicker
      notes[i].userData.candle = candle;
    }
  }

  // NPCs
  const npcs = spawnNPCs({ rng, maze, cellSize, level });
  for(const n of npcs) group.add(n);

  // Entity (dark figure)
  const enemyCell = maze.farthestFrom(exit.x, exit.y);
  const enemyPos = cellCenter(enemyCell.x, enemyCell.y, cellSize);
  const enemy = makeDarkFigure(level);
  enemy.position.set(enemyPos.x, 1.25, enemyPos.z);
  group.add(enemy);

  world = {
    group,
    interiors,
    maze, cellSize,
    start, exit,
    gate, gateOpen: false,
    relic, relicTaken: false,
    relicInHouse,
    relicHouseId,
    notes,
    npcs,
    enemy,
    enemyCell,
    enemyTargetCell: enemyCell,
    enemyPathTimer: 0,
    enemySpeed: L.enemySpeed,
    requireNote: L.requireNote,
    requiredNoteRead: !L.requireNote,
    levelName: L.name,
    rain,
    rainVel: 10.5 + level*1.6,
    extras,
  };

  ui.setTop({
    level: state.level,
    relics: state.relics,
    mission: `MISSION: FIND RELIC • ${world.levelName}`,
    dissonance: state.dissonance
  });

  const intro = [
    `You walk into daylight that feels staged. The rain is too consistent.`,
    `You notice houses that do not belong here. You suspect you do.`,
    `You hear candles through walls. That’s not how sound works.`,
    `You begin to understand: this place is training you.`
  ];
  ui.setHint(intro[level-1] || intro[0], true);
  setTimeout(()=> ui.setHint("", false), 2600);

  if(world.requireNote){
    world.gate.material.color.setHex(0x566068);
  }else{
    world.gate.material.color.setHex(0x7c878f);
  }

  if(level >= 3) audio.stinger(0.55);
}

// ---------- Mesh factories ----------
function makeRelicMesh(level){
  const g = new THREE.IcosahedronGeometry(0.45 + level*0.03, 0);
  const m = new THREE.MeshLambertMaterial({ color: 0xc6c0a3, emissive: 0x0c0a08 });
  const mesh = new THREE.Mesh(g,m);
  mesh.userData.type = "relic";
  return mesh;
}

function makeNoteMesh(){
  const g = new THREE.BoxGeometry(0.5, 0.25, 0.04);
  const m = new THREE.MeshLambertMaterial({ color: 0xd8d1c4 });
  const mesh = new THREE.Mesh(g,m);
  mesh.userData.type = "note";
  return mesh;
}

function makeCandleMesh(rng){
  const g = new THREE.Group();
  const wax = new THREE.Mesh(
    new THREE.CylinderGeometry(0.10, 0.12, 0.35, 8),
    new THREE.MeshLambertMaterial({ color: 0xd9d0be })
  );
  wax.position.y = 0.18;
  g.add(wax);

  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.07, 0.18, 7),
    new THREE.MeshBasicMaterial({ color: 0xffe1b3 })
  );
  flame.position.y = 0.45;
  flame.rotation.x = Math.PI;
  g.add(flame);

  g.userData.candle = true;
  g.userData.flicker = 0.6 + rng()*0.7;

  return { mesh:g, wax, flame, light:null };
}

// Creepier entity: tall silhouette + arms + “void face”
// It also “leans” toward your look direction when you stare.
function makeDarkFigure(level){
  const group = new THREE.Group();

  const mat = new THREE.MeshLambertMaterial({ color: 0x0b0d10 });
  const voidMat = new THREE.MeshBasicMaterial({ color: 0x000000 });

  const height = 2.8 + level*0.25;

  const torso = new THREE.Mesh(
    new THREE.CylinderGeometry(0.20, 0.32, height, 6),
    mat
  );
  torso.position.y = height/2;
  group.add(torso);

  const head = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.22 + level*0.01, 0),
    mat
  );
  head.position.y = height + 0.2;
  group.add(head);

  const voidFace = new THREE.Mesh(
    new THREE.CircleGeometry(0.11, 9),
    voidMat
  );
  voidFace.position.set(0, height + 0.2, 0.21);
  group.add(voidFace);

  const armGeo = new THREE.BoxGeometry(0.08, height*0.75, 0.08);
  const armL = new THREE.Mesh(armGeo, mat);
  const armR = new THREE.Mesh(armGeo, mat);
  armL.position.set(-0.35, height*0.62, 0);
  armR.position.set( 0.35, height*0.62, 0);
  armL.rotation.z = -0.25;
  armR.rotation.z =  0.25;
  group.add(armL); group.add(armR);

  // ragged “coat” spikes
  const spikeGeo = new THREE.ConeGeometry(0.22, 0.7, 5);
  for(let i=0;i<4;i++){
    const sp = new THREE.Mesh(spikeGeo, mat);
    sp.position.set((i-1.5)*0.18, 1.0 + i*0.35, -0.10);
    sp.rotation.x = Math.PI;
    sp.rotation.y = i*0.7;
    group.add(sp);
  }

  group.userData.type = "enemy";
  return group;
}

// ---------- Placement helpers ----------
function cellCenter(x,y,cellSize){
  return { x: x*cellSize + cellSize/2, z: y*cellSize + cellSize/2 };
}

function pickRelicCell(maze, start, exit, rng){
  // choose far-ish cell
  let best = exit;
  for(let i=0;i<22;i++){
    const x = (rng()*maze.w)|0;
    const y = (rng()*maze.h)|0;
    if((x===start.x&&y===start.y) || (x===exit.x&&y===exit.y)) continue;
    best = {x,y};
  }
  return best;
}

function pickNoteCell(maze, start, exit, rng){
  for(let tries=0; tries<80; tries++){
    const x = (rng()*maze.w)|0;
    const y = (rng()*maze.h)|0;
    if((x===start.x&&y===start.y) || (x===exit.x&&y===exit.y)) continue;
    return {x,y};
  }
  return {x:1,y:1};
}

// ---------- Journal + Notes ----------
function toggleJournal(){
  if(!state.started) return;
  if(ui.els.journal.classList.contains("hidden")){
    state.pausedUI = true;
    document.exitPointerLock?.();
    ui.openJournal(renderJournal());
    ui.setHint("", false);
  }else{
    ui.closeJournal();
    state.pausedUI = false;
    ui.setHint("Click to re-enter.", true);
  }
}

function renderJournal(){
  const c = story.choices;
  const pick = (v)=> v ? `<b>${v}</b>` : `<i>unanswered</i>`;
  return `
    <p>You keep a record because the forest edits memory.</p>
    <p><b>Relics recovered:</b> ${state.relics}/4</p>
    <p><b>Notes read:</b> ${story.notesRead.length}</p>
    <hr style="border:none;border-top:1px solid rgba(255,255,255,0.16);margin:12px 0;">
    <p><b>Answers you gave (the rain keeps them):</b></p>
    <p>• Mercy: ${pick(c.mercy)}</p>
    <p>• Truth: ${pick(c.truth)}</p>
    <p>• Name: ${pick(c.name)}</p>
    <p>• Hunger: ${pick(c.hunger)}</p>
    <p style="margin-top:10px;"><b>Private meters:</b></p>
    <p>• Guilt: ${story.guilt}/100</p>
    <p>• Obsession: ${story.obsession}/100</p>
    <p style="margin-top:10px;color:#ffffff77;">Second-person is not style. It’s surveillance.</p>
  `;
}

function openNote(noteMesh){
  const id = noteMesh.userData.noteId;
  const idx = noteMesh.userData.noteIndex;

  const already = noteAlreadyRead(story, id);
  if(!already){
    markNoteRead(story, id);
    saveStory(story);
  }
  if(world && world.requireNote) world.requiredNoteRead = true;

  const payload = buildNotePayload(state.level, idx, already);

  state.pausedUI = true;
  document.exitPointerLock?.();

  ui.openModal({
    title: payload.title,
    html: payload.html,
    choices: payload.choices || []
  });
}

function buildNotePayload(level, idx, already){
  const commonLead = `<p>You read it because it feels safer than thinking.</p>`;
  const seen = already ? `<p style="color:#ffffff66;">(You’ve read this before. It reads you back.)</p>` : "";
  const isChoice = (idx === 1);

  if(level === 1){
    if(!isChoice){
      return {
        title: "NOTE: DAYLIGHT IS A MASK",
        html: `${commonLead}${seen}
          <p><b>“If you can see clearly, it’s because the forest wants you to.</b>”</p>
          <p>The paper is damp in a way your hands didn’t cause.</p>`
      };
    }
    return {
      title: "QUESTION: MERCY",
      html: `${commonLead}${seen}
        <p><b>“If the dark figure follows you, do you let it come close so it can be understood?”</b></p>
        <p>You feel the rain waiting for your answer.</p>`,
      choices: [
        { label: "Answer: MERCY", onPick: ()=> pickChoice("mercy","mercy") },
        { label: "Answer: STRICT", onPick: ()=> pickChoice("mercy","strict") },
      ]
    };
  }

  if(level === 2){
    if(!isChoice){
      return {
        title: "NOTE: HOUSES ARE RECEIPTS",
        html: `${commonLead}${seen}
          <p><b>“Shelter is what you call a confession when you’re tired.”</b></p>
          <p>You smell candle smoke where there is only rain.</p>`
      };
    }
    return {
      title: "QUESTION: TRUTH",
      html: `${commonLead}${seen}
        <p><b>“When you are found, do you confess what you were looking for?”</b></p>
        <p>Your mouth already knows the lie.</p>`,
      choices: [
        { label: "Answer: CONFESS", onPick: ()=> pickChoice("truth","confess") },
        { label: "Answer: DENY", onPick: ()=> pickChoice("truth","deny") },
      ]
    };
  }

  if(level === 3){
    if(!isChoice){
      return {
        title: "NOTE: CONSEQUENCES ONLY",
        html: `${commonLead}${seen}
          <p>You find dark stains on bark—old, rain-fed, stubborn.</p>
          <p><b>“The body is a rumor here. Only consequences remain.”</b></p>`
      };
    }
    return {
      title: "QUESTION: NAME",
      html: `${commonLead}${seen}
        <p><b>“If the forest offers you a new name, do you accept it?”</b></p>
        <p>Daylight makes it feel administrative.</p>`,
      choices: [
        { label: "Answer: ACCEPT", onPick: ()=> pickChoice("name","accept") },
        { label: "Answer: REFUSE", onPick: ()=> pickChoice("name","refuse") },
      ]
    };
  }

  if(!isChoice){
    return {
      title: "NOTE: THE GATE LEARNS YOU",
      html: `${commonLead}${seen}
        <p><b>“Keys are metaphors for permission. You’ve been granting permission.”</b></p>
        <p>The ink looks recent. That’s impossible.</p>`
    };
  }
  return {
    title: "QUESTION: HUNGER",
    html: `${commonLead}${seen}
      <p><b>“If it follows you because it’s hungry, do you feed it?”</b></p>
      <p>You can almost hear it swallowing the distance.</p>`,
    choices: [
      { label: "Answer: FEED IT", onPick: ()=> pickChoice("hunger","feed") },
      { label: "Answer: STARVE IT", onPick: ()=> pickChoice("hunger","starve") },
    ]
  };
}

function pickChoice(key, value){
  applyChoice(story, key, value);
  saveStory(story);
  ui.closeModal();
  state.pausedUI = false;
  ui.setHint("Click to re-enter.", true);
  audio.stinger(0.55);
}

// ---------- NPC interaction ----------
function openNPC(npc){
  const payload = npcInteractPayload(npc, state.level, story);
  state.pausedUI = true;
  document.exitPointerLock?.();

  ui.openModal({
    title: payload.title,
    html: payload.html,
    choices: (payload.choices || []).map(ch => ({
      label: ch.label,
      onPick: ()=>{
        const result = ch.onPick();
        applyNPCResult(result);
        ui.closeModal();
        state.pausedUI = false;
        ui.setHint("Click to re-enter.", true);
      }
    }))
  });
}

function applyNPCResult(result){
  if(!result) return;

  // update story meters
  if(result.delta){
    if(typeof result.delta.guilt === "number") story.guilt = clamp(story.guilt + result.delta.guilt, 0, 100);
    if(typeof result.delta.obsession === "number") story.obsession = clamp(story.obsession + result.delta.obsession, 0, 100);
    saveStory(story);
  }

  if(result.calm){
    state.dissonance = Math.max(0, state.dissonance - 10);
    audio.stinger(0.35);
    ui.setHint("Their counting syncs with your breath. You feel slightly less watched.", true);
    setTimeout(()=> ui.setHint("", false), 1600);
  }
  if(result.spike){
    state.dissonance = Math.min(100, state.dissonance + 12);
    audio.stinger(0.65);
    ui.setHint("They flinch like you hit the weather. The rain gets louder.", true);
    setTimeout(()=> ui.setHint("", false), 1600);
  }
  if(result.learn){
    // entity learns you faster: shorter path timer (harder)
    if(world) world.enemyPathTimer = Math.min(world.enemyPathTimer, 0.15);
    ui.setHint("You feel your routes being memorized by something that doesn’t sleep.", true);
    setTimeout(()=> ui.setHint("", false), 1700);
  }
  if(result.delay){
    // gate demands more reading this level (softer chase compensation)
    if(world){
      world.requireNote = true;
      world.requiredNoteRead = false;
      world.gateOpen = false;
      world.gate.material.color.setHex(0x566068);
      world.enemySpeed *= 0.95;
    }
    ui.setHint("Refusal has a cost. The gate becomes stubborn.", true);
    setTimeout(()=> ui.setHint("", false), 1700);
  }
}

// ---------- Houses: enter/exit ----------
function enterHouse(house){
  if(state.inHouse) return;
  state.inHouse = true;
  state.houseId = house.id;
  state.outsidePos = camera.position.clone();

  // show interior group
  house.interior.visible = true;

  // teleport player into pocket space
  camera.position.set(house.interior.position.x, 1.7, house.interior.position.z + 1.8);
  look.yaw = Math.PI;
  look.pitch = 0;

  // psychological: indoors “quiet rain” = lower enemy pressure, higher whisper
  state.dissonance = clamp(state.dissonance + 6, 0, 100); // claustrophobia bump
  audio.stinger(0.4);

  ui.setHint("You enter. The rain stays outside like a rule. Candles pretend they’re safe.", true);
  setTimeout(()=> ui.setHint("", false), 2400);
}

function exitHouse(house){
  if(!state.inHouse) return;
  state.inHouse = false;
  state.houseId = null;

  house.interior.visible = false;

  if(state.outsidePos){
    camera.position.copy(state.outsidePos);
    state.outsidePos = null;
  }

  ui.setHint("You step back into daylight. It feels less honest than the dark.", true);
  setTimeout(()=> ui.setHint("", false), 2200);
}

// ---------- Gameplay loop ----------
function update(dt){
  if(!world) return;
  state.time += dt;

  // Rain motion
  const p = world.rain.geometry.attributes.position;
  for(let i=0;i<p.count;i++){
    let y = p.getY(i) - world.rainVel*dt;
    if(y < 0.2) y = 20 + Math.random()*6;
    p.setY(i, y);
  }
  p.needsUpdate = true;

  // Candle flicker (houses + note candles)
  let candlePresence = 0.0;

  for(const h of world.extras.houses){
    if(h.outLight){
      const flick = 0.7 + Math.sin(state.time*6 + h.id*10)*0.2 + (Math.random()*0.08);
      h.outLight.intensity = 0.70 * flick;
    }
    if(h.inLight){
      const flick = 0.7 + Math.sin(state.time*7 + h.id*11)*0.25 + (Math.random()*0.10);
      h.inLight.intensity = 0.95 * flick;
    }
    // candle presence based on distance
    const doorWorld = new THREE.Vector3();
    h.door.getWorldPosition(doorWorld);
    const d = doorWorld.distanceTo(camera.position);
    candlePresence = Math.max(candlePresence, clamp01((9 - d)/9));
  }

  for(const n of world.notes){
    if(n.userData.candle?.light){
      const pl = n.userData.candle.light;
      const flick = 0.65 + Math.sin(state.time*8 + pl.id*3)*0.2 + (Math.random()*0.10);
      pl.intensity = 0.52 * flick;
      candlePresence = Math.max(candlePresence, clamp01((8 - n.position.distanceTo(camera.position))/8));
    }
  }

  // If inside, candle presence full
  if(state.inHouse) candlePresence = 1.0;
  audio.setCandlePresence(candlePresence);

  // Player movement
  const speedWalk = 3.15;
  const speedSprint = 5.15;
  const sprint = keys.has("ShiftLeft") || keys.has("ShiftRight");
  const speed = sprint ? speedSprint : speedWalk;

  const d = state.dissonance/100;
  const sluggish = 1 - d*0.16;

  const forward = (keys.has("KeyW")?1:0) - (keys.has("KeyS")?1:0);
  const strafe  = (keys.has("KeyD")?1:0) - (keys.has("KeyA")?1:0);

  const vx = (Math.sin(look.yaw)*forward + Math.sin(look.yaw + Math.PI/2)*strafe);
  const vz = (Math.cos(look.yaw)*forward + Math.cos(look.yaw + Math.PI/2)*strafe);
  const len = Math.hypot(vx, vz) || 1;

  const mx = (vx/len) * speed * dt * sluggish;
  const mz = (vz/len) * speed * dt * sluggish;

  if(!state.pausedUI){
    camera.position.x += mx;
    camera.position.z += mz;

    // collision only when outside maze (interior is pocket room)
    if(!state.inHouse){
      resolveMazeCollision(camera.position, world.maze, world.cellSize, 0.35);
    }else{
      // keep within pocket room
      camera.position.x = clamp(camera.position.x, world.extras.houses[state.houseId].interior.position.x - 3.0, world.extras.houses[state.houseId].interior.position.x + 3.0);
      camera.position.z = clamp(camera.position.z, world.extras.houses[state.houseId].interior.position.z - 3.0, world.extras.houses[state.houseId].interior.position.z + 3.0);
    }
  }

  // PS1 “snap” on camera transforms (visual vibe, not controls)
  if(!state.pausedUI){
    camera.position.x = snap(camera.position.x, state.posSnap);
    camera.position.z = snap(camera.position.z, state.posSnap);
    look.yaw = snap(look.yaw, state.rotSnap);
    look.pitch = snap(look.pitch, state.rotSnap);
  }

  camera.rotation.order = "YXZ";
  camera.rotation.y = look.yaw;
  camera.rotation.x = look.pitch + Math.sin(state.time*0.9)*0.012*(d*1.5);

  // Interactions
  if(!state.pausedUI && keys.has("KeyE")){
    tryInteract();
  }

  // NPC updates (only outside; inside is solitary)
  const dissonanceRef = { add:(x)=> { state.dissonance = clamp(state.dissonance + x*10, 0, 100); } };
  if(!state.inHouse){
    updateNPCs({
      dt,
      time: state.time,
      npcs: world.npcs,
      maze: world.maze,
      cellSize: world.cellSize,
      playerPos: camera.position,
      dissonanceRef
    });
  }

  // Entity AI (outside only, but its presence leaks in)
  let dist = 999;

  if(!state.inHouse){
    const playerCell = getCell(camera.position, world.cellSize, world.maze);
    const enemyCell = getCell(world.enemy.position, world.cellSize, world.maze);
    world.enemyCell = enemyCell;

    world.enemyPathTimer -= dt;
    if(world.enemyPathTimer <= 0){
      world.enemyTargetCell = bfsNextStep(world.maze, enemyCell, playerCell);

      // learns faster if obsession high
      const learnBoost = (story.obsession > 60) ? 0.32 : 0.0;
      world.enemyPathTimer = 0.45 - learnBoost;
      if(world.enemyPathTimer < 0.18) world.enemyPathTimer = 0.18;
    }

    const targetPos = cellCenter(world.enemyTargetCell.x, world.enemyTargetCell.y, world.cellSize);
    const ex = targetPos.x - world.enemy.position.x;
    const ez = targetPos.z - world.enemy.position.z;
    const ed = Math.hypot(ex, ez) || 1;

    let eSpeed = world.enemySpeed;

    // story consequences
    if(story.choices.mercy === "mercy") eSpeed *= 0.92;
    if(story.choices.truth === "deny") eSpeed *= 1.07;

    // dissonance makes it “thicker”
    if(d > 0.72) eSpeed *= 1.06;

    world.enemy.position.x += (ex/ed) * eSpeed * dt;
    world.enemy.position.z += (ez/ed) * eSpeed * dt;

    // face player
    world.enemy.rotation.y = Math.atan2(
      camera.position.x - world.enemy.position.x,
      camera.position.z - world.enemy.position.z
    );

    // when you stare at it, it “leans” (experimental)
    const toEnemy = new THREE.Vector3().subVectors(world.enemy.position, camera.position).normalize();
    const lookDir = new THREE.Vector3(0,0,-1).applyEuler(camera.rotation).normalize();
    const stare = Math.max(0, lookDir.dot(toEnemy));
    world.enemy.rotation.x = -stare*0.25;

    dist = world.enemy.position.distanceTo(camera.position);

    const close = smoothstep(10, 2.7, dist);
    state.warning = close;

    // Dissonance rises with proximity + stare + NPC pressure already applied
    const baseline = (story.guilt*0.25 + story.obsession*0.18);
    const targetD = clamp01(close*0.92 + stare*0.40) * 100;
    const desired = Math.max(targetD, baseline);

    state.dissonance += (desired - state.dissonance) * (1 - Math.exp(-dt*0.85));
    state.dissonance = clamp(state.dissonance, 0, 100);

    // Catch/death
    if(dist < 1.18 && !state.pausedUI){
      onDeath();
    }
  }else{
    // inside: calm-ish but psychologically loud
    const baseline = 18 + story.guilt*0.12;
    state.dissonance += (baseline - state.dissonance) * (1 - Math.exp(-dt*0.65));
    state.dissonance = clamp(state.dissonance, 0, 100);
    state.warning *= 0.92;

    // optional: “knock” hint when entity is close outside (fictional pressure)
    if(Math.sin(state.time*0.9) > 0.995 && state.dissonance > 35){
      audio.stinger(0.25);
    }
  }

  audio.setDissonance(state.dissonance/100);

  // Gate logic
  if(world.requireNote && world.requiredNoteRead && !world.gateOpen){
    world.gateOpen = true;
    world.gate.material.color.setHex(0x8e999f);
  }

  // Relic animation
  if(!world.relicTaken){
    world.relic.rotation.y += dt*0.8;
    world.relic.position.y = 1.0 + Math.sin(state.time*2.4)*0.08;
  }

  // Update HUD & FX
  ui.setTop({
    level: state.level,
    relics: state.relics,
    mission: buildMission(),
    dissonance: state.dissonance
  });

  ui.drawFX({
    dissonance: state.dissonance,
    wet: state.wet,
    t: state.time,
    warning: state.warning
  });
}

function buildMission(){
  const L = LEVELS[state.level-1];
  if(!world) return "MISSION: ...";
  if(state.inHouse) return "MISSION: LEAVE OR SEARCH THE ROOM";
  if(!world.relicTaken){
    if(world.relicInHouse) return "MISSION: THE RELIC PREFERS INDOOR WEATHER";
    return (L.requireNote && !world.requiredNoteRead)
      ? "MISSION: READ A NOTE • THEN FIND RELIC"
      : "MISSION: FIND THE RELIC";
  }
  return "MISSION: REACH THE GATE";
}

function tryInteract(){
  if(world._eLatch) return;
  world._eLatch = true;
  setTimeout(()=> world && (world._eLatch=false), 140);

  const here = camera.position;

  // If in house: interact with inside door to exit
  if(state.inHouse){
    const h = world.extras.houses[state.houseId];
    const inDoorWorld = new THREE.Vector3(
      h.interior.position.x + h.inDoor.position.x,
      h.interior.position.y + h.inDoor.position.y,
      h.interior.position.z + h.inDoor.position.z
    );
    if(inDoorWorld.distanceTo(here) < 2.1){
      exitHouse(h);
      return;
    }
  }

  // Outside: doors
  for(const h of world.extras.houses){
    const dpos = new THREE.Vector3();
    h.door.getWorldPosition(dpos);
    if(dpos.distanceTo(here) < 2.2){
      enterHouse(h);
      return;
    }
  }

  // NPCs
  if(!state.inHouse){
    for(const n of world.npcs){
      if(n.position.distanceTo(here) < 2.0){
        openNPC(n);
        return;
      }
    }
  }

  // Notes
  for(const n of world.notes){
    if(!n.visible) continue;
    if(n.position.distanceTo(here) < 1.5){
      openNote(n);
      return;
    }
  }

  // Relic
  if(!world.relicTaken && world.relic.position.distanceTo(here) < 1.85){
    world.relicTaken = true;
    world.relic.visible = false;
    state.relics += 1;
    story.relics = state.relics;
    saveStory(story);

    audio.stinger(0.75);
    ui.setHint("You take the relic. It feels like taking a memory out of your own throat.", true);
    setTimeout(()=> ui.setHint("", false), 2400);
    return;
  }

  // Gate
  if(!state.inHouse && world.gate.position.distanceTo(here) < 2.2){
    if(world.requireNote && !world.requiredNoteRead){
      ui.setHint("The gate is inert. The forest wants you to read first.", true);
      setTimeout(()=> ui.setHint("", false), 1400);
      return;
    }
    if(!world.relicTaken){
      ui.setHint("You reach for the gate, but you are missing something.", true);
      setTimeout(()=> ui.setHint("", false), 1400);
      return;
    }
    nextLevelOrEnd();
  }
}

function nextLevelOrEnd(){
  if(state.level < 4){
    state.level += 1;
    loadLevel(state.level);
    return;
  }
  const ending = computeEnding(story);
  const html = endingText(ending, story);
  ui.showEnding(true, html);
  state.pausedUI = true;
  document.exitPointerLock?.();
}

function onDeath(){
  state.pausedUI = true;
  document.exitPointerLock?.();
  ui.showDeath(true);
  audio.stinger(0.9);
}

// ---------- Loop ----------
function animate(){
  requestAnimationFrame(animate);
  const dt = Math.min(0.033, clock.getDelta());
  if(state.started){
    update(dt);
    renderer.render(scene, camera);
  }else{
    ui.drawFX({ dissonance: 0, wet: 1, t: performance.now()/1000, warning: 0 });
  }
}
animate();

// ---------- Helpers ----------
function getCell(pos, cellSize, maze){
  const x = clamp(Math.floor(pos.x / cellSize), 0, maze.w-1);
  const y = clamp(Math.floor(pos.z / cellSize), 0, maze.h-1);
  return {x,y};
}
function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
function clamp01(v){ return clamp(v,0,1); }
function smoothstep(edge0, edge1, x){
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t*t*(3 - 2*t);
}
function snap(v, step){ return Math.round(v/step)*step; }

function mulberry32(a){
  return function(){
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Close modal/journal resumes hint
ui.els.closeModal.addEventListener("click", ()=>{
  state.pausedUI = false;
  ui.setHint("Click to re-enter.", true);
});
ui.els.closeJournal.addEventListener("click", ()=>{
  state.pausedUI = false;
  ui.setHint("Click to re-enter.", true);
});

